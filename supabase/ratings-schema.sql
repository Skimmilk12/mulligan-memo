-- Mulligan Memo — first-party golfer ratings. Schema v1.
-- Run ONCE in the Supabase SQL editor (Cowork applies it; nothing here needs a secret).
--
-- THE THREAT MODEL THIS IS BUILT AGAINST
-- Cowork found the project defaults: Data API on, new tables auto-exposed, RLS
-- OFF. In that state any table is publicly readable AND writable with the anon
-- key that ships in every page. So:
--   * RLS is enabled on every table before any policy exists (deny-all default)
--   * the public can read ONLY the aggregate summary view, never raw ballots
--   * the public can NEVER insert/update/delete a row directly — the only
--     write path is one SECURITY DEFINER function that validates everything
--   * the anon key can call exactly two functions: submit_rating and my_rating
--
-- CONTROLS FROM THE ADOPTED PLAN, ENFORCED HERE NOT IN THE WIDGET
--   one mutable ballot per (product, account)  -> UNIQUE + upsert
--   product must exist in the catalogue          -> FK to catalog_products
--   score 1..5, basis own|used|demoed            -> CHECK constraints
--   max 5 new product ratings / account / 24h    -> checked in submit_rating
--   24-hour pending window before publishing     -> status + promotion job
--   score displayed only at n>=5                 -> rating_summaries.display_state
--   every change audited                         -> rating_events, trigger-written
--   moderation holds neg and pos identically     -> status machine, no score check

begin;

-- ---------------------------------------------------------------------------
-- 1. Catalogue mirror. Only immutable identity crosses from the repo registry:
--    product_id (never changes), canonical name, status. The repo stays the
--    source of truth; this exists so a rating can FK to a real product and the
--    public cannot invent one.
-- ---------------------------------------------------------------------------
create table if not exists public.catalog_products (
  product_id     text primary key,
  canonical_name text not null,
  slug           text not null,
  status         text not null default 'provisional' check (status in ('provisional','active','retired')),
  updated_at     timestamptz not null default now()
);
alter table public.catalog_products enable row level security;
-- Public may read the catalogue (it is already public on the site).
create policy "catalog readable by all" on public.catalog_products
  for select using (true);
-- Nobody writes through the API. Sync happens with the service role from CI.

-- ---------------------------------------------------------------------------
-- 2. Ballots. One row per (product, user). Never publicly readable.
-- ---------------------------------------------------------------------------
create table if not exists public.ratings (
  rating_id        uuid primary key default gen_random_uuid(),
  product_id       text not null references public.catalog_products(product_id),
  user_id          uuid not null references auth.users(id) on delete cascade,
  score            smallint not null check (score between 1 and 5),
  experience_basis text not null check (experience_basis in ('own','used','demoed')),
  variant_note     text check (variant_note is null or char_length(variant_note) <= 80),
  status           text not null default 'pending'
                   check (status in ('pending','published','held','rejected','withdrawn')),
  moderation_reason text,
  submitted_at     timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  published_at     timestamptz,
  unique (product_id, user_id)
);
create index if not exists ratings_product_status_idx on public.ratings (product_id, status);
create index if not exists ratings_user_submitted_idx on public.ratings (user_id, submitted_at);
alter table public.ratings enable row level security;
-- No policies for anon/authenticated => nobody reads or writes rows directly.
-- (A user reads their own ballot only through my_rating() below.)

-- ---------------------------------------------------------------------------
-- 3. Audit trail. Written by trigger only.
-- ---------------------------------------------------------------------------
create table if not exists public.rating_events (
  event_id    bigserial primary key,
  rating_id   uuid not null,
  actor       text not null check (actor in ('user','rule','moderator')),
  action      text not null,
  prev_value  jsonb,
  new_value   jsonb,
  occurred_at timestamptz not null default now()
);
alter table public.rating_events enable row level security;

create or replace function public.ratings_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into rating_events (rating_id, actor, action, new_value)
      values (new.rating_id, 'user', 'submit', to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    insert into rating_events (rating_id, actor, action, prev_value, new_value)
      values (new.rating_id,
              case when new.status <> old.status and new.status in ('held','rejected','published') then 'rule' else 'user' end,
              case when new.status <> old.status then 'status:' || new.status else 'edit' end,
              to_jsonb(old), to_jsonb(new));
  end if;
  return new;
end $$;
drop trigger if exists ratings_audit_trg on public.ratings;
create trigger ratings_audit_trg after insert or update on public.ratings
  for each row execute function public.ratings_audit();

-- ---------------------------------------------------------------------------
-- 4. THE ONLY WRITE PATH. Validates identity, product, limits; upserts the
--    caller's single ballot; always lands as 'pending'.
-- ---------------------------------------------------------------------------
create or replace function public.submit_rating(
  p_product_id text,
  p_score      int,
  p_basis      text,
  p_variant    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_new_today int;
  v_existing public.ratings%rowtype;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;
  if p_score is null or p_score < 1 or p_score > 5 then
    raise exception 'score must be 1-5' using errcode = '22023';
  end if;
  if p_basis not in ('own','used','demoed') then
    raise exception 'basis must be own, used or demoed' using errcode = '22023';
  end if;
  if not exists (select 1 from catalog_products where product_id = p_product_id and status <> 'retired') then
    raise exception 'unknown product' using errcode = '22023';
  end if;

  select * into v_existing from ratings where product_id = p_product_id and user_id = v_uid;

  if v_existing.rating_id is null then
    -- velocity: max five NEW product ratings per account per rolling 24h
    select count(*) into v_new_today from ratings
      where user_id = v_uid and submitted_at > now() - interval '24 hours';
    if v_new_today >= 5 then
      raise exception 'rating limit reached for today' using errcode = '54000';
    end if;
    insert into ratings (product_id, user_id, score, experience_basis, variant_note)
      values (p_product_id, v_uid, p_score, p_basis, nullif(trim(p_variant), ''));
  else
    -- editing replaces the ballot and sends it back through the pending window
    update ratings set
      score = p_score, experience_basis = p_basis,
      variant_note = nullif(trim(p_variant), ''),
      status = 'pending', published_at = null, moderation_reason = null,
      updated_at = now()
    where rating_id = v_existing.rating_id;
  end if;

  return jsonb_build_object('ok', true, 'status', 'pending');
end $$;

-- Read back the caller's own ballot for one product (so the widget can show
-- "you rated this 4 — pending" and offer edit/withdraw).
create or replace function public.my_rating(p_product_id text) returns jsonb
language sql security definer set search_path = public stable as $$
  select coalesce(
    (select jsonb_build_object('score', score, 'basis', experience_basis,
                               'status', status, 'submitted_at', submitted_at)
       from ratings where product_id = p_product_id and user_id = auth.uid()),
    'null'::jsonb);
$$;

create or replace function public.withdraw_rating(p_product_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  update ratings set status = 'withdrawn', updated_at = now()
    where product_id = p_product_id and user_id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

-- Lock everything down, then open exactly the three RPCs to signed-in users.
revoke all on function public.submit_rating(text,int,text,text) from public, anon;
revoke all on function public.my_rating(text) from public, anon;
revoke all on function public.withdraw_rating(text) from public, anon;
grant execute on function public.submit_rating(text,int,text,text) to authenticated;
grant execute on function public.my_rating(text) to authenticated;
grant execute on function public.withdraw_rating(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Public aggregate. The ONLY rating data anyone unauthenticated can read.
--    Counts only PUBLISHED ballots. display_state encodes the plan's thresholds
--    so the widget cannot "accidentally" show a mean at n=3.
-- ---------------------------------------------------------------------------
create table if not exists public.rating_summaries (
  product_id     text primary key references public.catalog_products(product_id),
  eligible_count int not null default 0,
  mean_score     numeric(3,2),
  star_1 int not null default 0, star_2 int not null default 0, star_3 int not null default 0,
  star_4 int not null default 0, star_5 int not null default 0,
  display_state  text not null default 'hidden' check (display_state in ('hidden','early','established')),
  updated_at     timestamptz not null default now()
);
alter table public.rating_summaries enable row level security;
create policy "summaries readable by all" on public.rating_summaries
  for select using (true);

-- ---------------------------------------------------------------------------
-- 6. Promotion + aggregation. Runs on a schedule (pg_cron, every hour).
--    Publishes clean pending ballots older than 24h, holds bursts from fresh
--    accounts on low-volume products, rebuilds summaries. If this job fails,
--    ratings stay pending — it can never fail by publishing.
-- ---------------------------------------------------------------------------
create or replace function public.promote_and_summarise() returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Hold: 5+ pending ratings within 24h on a product that has < 5 published,
  -- from accounts younger than 7 days. That is the brigading shape.
  update ratings r set status = 'held', moderation_reason = 'burst from new accounts on low-volume product'
  where r.status = 'pending'
    and exists (
      select 1 from ratings x join auth.users u on u.id = x.user_id
      where x.product_id = r.product_id and x.status = 'pending'
        and x.submitted_at > now() - interval '24 hours'
        and u.created_at > now() - interval '7 days'
      group by x.product_id having count(*) >= 5
    )
    and (select count(*) from ratings p where p.product_id = r.product_id and p.status = 'published') < 5
    and exists (select 1 from auth.users u where u.id = r.user_id and u.created_at > now() - interval '7 days');

  -- Publish everything clean and older than 24h.
  update ratings set status = 'published', published_at = now(), updated_at = now()
  where status = 'pending' and submitted_at <= now() - interval '24 hours';

  -- Rebuild summaries for every catalogued product.
  insert into rating_summaries (product_id, eligible_count, mean_score, star_1, star_2, star_3, star_4, star_5, display_state, updated_at)
  select c.product_id,
         count(r.rating_id),
         case when count(r.rating_id) >= 5 then round(avg(r.score)::numeric, 2) else null end,
         count(*) filter (where r.score = 1), count(*) filter (where r.score = 2),
         count(*) filter (where r.score = 3), count(*) filter (where r.score = 4),
         count(*) filter (where r.score = 5),
         case when count(r.rating_id) >= 25 then 'established'
              when count(r.rating_id) >= 5  then 'early'
              else 'hidden' end,
         now()
  from catalog_products c
  left join ratings r on r.product_id = c.product_id and r.status = 'published'
  group by c.product_id
  on conflict (product_id) do update set
    eligible_count = excluded.eligible_count, mean_score = excluded.mean_score,
    star_1 = excluded.star_1, star_2 = excluded.star_2, star_3 = excluded.star_3,
    star_4 = excluded.star_4, star_5 = excluded.star_5,
    display_state = excluded.display_state, updated_at = now();
end $$;
revoke all on function public.promote_and_summarise() from public, anon, authenticated;

-- Schedule hourly. pg_cron is available on Supabase; if this line errors because
-- the extension is not enabled, enable it under Database > Extensions and re-run
-- just this statement.
create extension if not exists pg_cron;
select cron.schedule('mm-ratings-promote', '17 * * * *', $$select public.promote_and_summarise()$$);

commit;
