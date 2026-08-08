// Renders data/deals-curated.json into deals.html between the auto markers.
// Daily rhythm: edit deals-curated.json, run `node scripts/build-deals.mjs`, deploy.
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const cur = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'deals-curated.json'), 'utf8'));
const killlist = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'deals-killlist.json'), 'utf8')).killed;
const feed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'deals-latest.json'), 'utf8'));
const PAGE = path.join(ROOT, 'deals.html');

// A curated pick must never be on the kill list.
for (const d of [cur.deal_of_the_day, ...cur.deals]) {
  if (killlist.some(k => k.url === d.url)) { console.error(`ABORT: curated deal is on the kill list: ${d.title}`); process.exit(1); }
}

// The verdicts are hand-written and stay that way — that is the editorial value.
// The PRICES are not: a hand-typed price silently rots the moment the retailer
// moves it, which is how this board came to advertise a $850 bundle that had
// gone back to $975. Reconcile every curated price against tonight's feed, and
// drop anything the feed can no longer see rather than publish a dead deal.
const live = new Map((feed.candidates || []).map((c) => [c.url, c]));
function reconcile(d) {
  const hit = live.get(d.url);
  if (!hit) return null;
  const price = Number(hit.price);
  const compare_at = hit.compare_at != null ? Number(hit.compare_at) : d.compare_at;
  if (Math.round(price) !== Math.round(Number(d.price))) {
    console.log(`  price refreshed: $${Math.round(Number(d.price))} -> $${Math.round(price)}  ${String(d.title).slice(0, 48)}`);
  }
  /* pct_off IS DERIVED, SO DERIVE IT. Reconciling the prices and then spreading
     the old object over them kept the stale discount badge, which is how the
     board came to advertise a Mevo+ Pro package at "43% off" when the refreshed
     prices made it 35% — overstating the cut by eight points on a live page
     whose entire promise is verified numbers. Same class of rot as the
     hand-typed price above, one layer further out. */
  const pct_off = Math.round(100 * (1 - price / compare_at));
  return { ...d, price, compare_at, pct_off };
}

/* THE VERDICTS ARE HAND-WRITTEN AND SOME OF THEM QUOTE NUMBERS.
   "$2,600 under its usual ask" was true when it was typed and false by the time
   the retailer moved the price. We cannot rewrite editorial prose from a script
   without inventing copy, so this fails closed instead: if a figure in the
   verdict contradicts tonight's prices, the deal is held back and reported,
   exactly like the grid's variant gate. Fix the sentence or drop the pick —
   never publish the contradiction. */
function verdictConflict(d) {
  const v = String(d.verdict || '');
  const price = Math.round(d.price), compare = Math.round(d.compare_at);
  const saving = compare - price;
  const near = (a, b) => Math.abs(a - b) <= Math.max(2, b * 0.01);

  for (const m of v.matchAll(/\$([\d,]+(?:\.\d\d)?)/g)) {
    const n = Math.round(Number(m[1].replace(/,/g, '')));
    if (n <= 100) continue;                       // "$100 a club" style asides
    if (near(n, price) || near(n, compare) || near(n, saving)) continue;
    return `verdict cites $${m[1]} — tonight the price is $${price.toLocaleString()}, was $${compare.toLocaleString()}, saving $${saving.toLocaleString()}`;
  }
  for (const m of v.matchAll(/(\d{1,2})\s?%/g)) {
    if (!near(Number(m[1]), d.pct_off)) {
      return `verdict claims ${m[1]}% — tonight's prices give ${d.pct_off}%`;
    }
  }
  return null;
}
const dropped = [];
const conflicted = [];
function vet(d) {
  const r = reconcile(d);
  if (!r) { dropped.push(d.title); return null; }
  const why = verdictConflict(r);
  if (why) { conflicted.push({ title: r.title, why }); return null; }
  return r;
}
cur.deal_of_the_day = vet(cur.deal_of_the_day);
cur.deals = cur.deals.map(vet).filter(Boolean);
if (dropped.length) console.log(`  DROPPED (no longer in feed): ${dropped.join(' | ')}`);
if (conflicted.length) {
  console.log(`  HELD BACK (verdict contradicts tonight's prices) — fix the sentence in data/deals-curated.json:`);
  for (const c of conflicted) console.log(`    ${String(c.title).slice(0, 52)}\n      ${c.why}`);
}
if (!cur.deal_of_the_day && cur.deals.length) cur.deal_of_the_day = cur.deals.shift();
// The stamp is the feed's own check date, never a hand-typed one. checked_label
// used to be typed into deals-curated.json by hand, so it kept saying July 13
// while the bot ran nightly underneath it.
if (feed.date) {
  const [y, m, d] = feed.date.split('-').map(Number);
  cur.checked_label = new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = n => '$' + (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2 }));

// PlayBetter is an affiliate partner (GrowthHero, live 2026-08-01). Detect their
// URLs and tag them automatically rather than trusting a hand-set flag — the flag
// was missed on every entry, so we sent them free traffic.
const PB_REF = 'ghref=2301%3A1337756';
function outbound(url) {
  const u = String(url);
  if (!/^https?:\/\/(www\.)?playbetter\.com\//i.test(u)) return { href: u, paid: false };
  const clean = u.split('#')[0];
  if (clean.includes(PB_REF)) return { href: clean, paid: true };
  return { href: clean + (clean.includes('?') ? '&' : '?') + PB_REF, paid: true };
}

function linkTag(d) {
  /* Disclosure lives once, in the banner at the top of the page. It used to be
     repeated as a "paid link" chip beside every button, which on a page of ten
     deals means telling the reader ten more times something they read on
     arrival and did not care about the first time. The rel attribute still
     carries sponsored, which is the part that actually matters. */
  const link = outbound(d.url);
  const paid = d.affiliate || link.paid;
  const rel = paid ? 'nofollow sponsored noopener' : 'nofollow noopener';
  return `<a class="dd-buy" href="${esc(link.href)}" rel="${rel}" target="_blank">GET THE DEAL →</a>`;
}

function dealRow(d) {
  return `      <div class="dd-row">
        <div class="dd-row-top">
          <span class="dd-chip">${esc(d.category)}</span>
          <span class="dd-retailer">${esc(d.retailer)}</span>
        </div>
        <h3 class="dd-item">${esc(d.title)}</h3>
        <p class="dd-verdict">“${esc(d.verdict)}”</p>
        <div class="dd-row-price">
          <span class="dd-was">${money(d.compare_at)}</span>
          <span class="dd-now">${money(d.price)}</span>
          <span class="dd-pct">${d.pct_off}% OFF</span>
          ${linkTag(d)}
        </div>
      </div>`;
}

const all = [cur.deal_of_the_day, ...cur.deals];
const topCuts = [...all].sort((a, b) => b.pct_off - a.pct_off).slice(0, 3);
const dod = cur.deal_of_the_day;

const html = `
    <p class="dd-stamp">Prices checked <strong>${esc(cur.checked_label)}</strong> · verified against the retailer's own listed prices · subject to change after posting</p>

    <section class="dd-hero" aria-label="Deal of the day">
      <div class="dd-seal">DEAL<br>OF THE<br>DAY</div>
      <div class="dd-hero-body">
        <div class="dd-row-top"><span class="dd-chip">${esc(dod.category)}</span><span class="dd-retailer">${esc(dod.retailer)}</span></div>
        <h3 class="dd-item">${esc(dod.title)}</h3>
        <p class="dd-verdict">“${esc(dod.verdict)}”</p>
        <div class="dd-row-price">
          <span class="dd-was">${money(dod.compare_at)}</span>
          <span class="dd-now">${money(dod.price)}</span>
          <span class="dd-pct">${dod.pct_off}% OFF</span>
          ${linkTag(dod)}
        </div>
      </div>
    </section>

    <h2><span class="kick">The Ledger</span>The board</h2>
    <div class="dd-ledger">
${cur.deals.map(dealRow).join('\n')}
    </div>

    <section class="dd-cuts" aria-label="Biggest cuts">
      <p class="dd-cuts-label">THE BIGGEST CUTS ON THE DESK</p>
      <div class="dd-cuts-grid">
${topCuts.map(d => `        <div class="dd-cut"><span class="dd-cut-pct">${d.pct_off}%</span><span class="dd-cut-name">${esc(d.title)}</span></div>`).join('\n')}
      </div>
    </section>

`;
/* The Kill List used to print here — the fake-anchor deals we rejected and why.
   Removed 2026-08-04 on Robert's instruction, for the third time this pattern
   has been caught: a reader came for prices, not for an account of our editing.
   The kill list still runs and still keeps those deals off the page; it just
   does its work without being narrated. The data stays in the price-bot log. */

// Guard: generated content must never contain the markers themselves — a
// corrupted injection here is how the 2026-07-11 page scramble happened.
if (html.includes('deals:auto:start') || html.includes('deals:auto:end')) {
  console.error('ABORT: generated html contains marker text'); process.exit(1);
}
// Guard: every rendered price must be a complete dollar figure.
for (const m of html.matchAll(/class="dd-(?:was|now)">([^<]*)</g)) {
  if (!/^\$[\d,]+(\.\d{2})?$/.test(m[1])) { console.error(`ABORT: malformed price "${m[1]}"`); process.exit(1); }
}

let page = fs.readFileSync(PAGE, 'utf8');
const count = s => (page.match(new RegExp(s, 'g')) || []).length;
if (count('<!-- deals:auto:start -->') !== 1 || count('<!-- deals:auto:end -->') !== 1) {
  console.error(`ABORT: deals.html shell is corrupted (${count('<!-- deals:auto:start -->')} start / ${count('<!-- deals:auto:end -->')} end markers; need exactly 1 of each). Restore the shell before rebuilding.`);
  process.exit(1);
}
const re = /(<!-- deals:auto:start -->)[\s\S]*?(<!-- deals:auto:end -->)/;
// Replacer FUNCTION, not a string: dollar amounts in deal copy ("$1,099")
// would otherwise be eaten as $1/$2 capture-group references.
page = page.replace(re, (_m, start, end) => `${start}${html}    ${end}`);
fs.writeFileSync(PAGE, page);
console.log(`deals.html rebuilt: 1 deal of the day + ${cur.deals.length} ledger rows + ${killlist.filter(k => !k.expired).length} kill-list items (checked ${cur.checked_label})`);
