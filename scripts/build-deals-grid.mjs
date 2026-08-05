/* build-deals-grid.mjs — the Deals Desk product grid.
 *
 * Pulls products from the CJ Affiliate product feed for advertisers we are
 * approved with, then VERIFIES every price against the retailer's own live
 * product page before anything is allowed to publish.
 *
 * The verification step is not optional politeness. The Puma/Cobra feed — our
 * best-stocked one — was last rebuilt 2026-03-31, and spot checks found real
 * drift: SLIPSTREAM G listed at $68.99 in the feed was $59.99 on the site. A
 * card that quotes a price the reader does not see when they land is the one
 * mistake this desk cannot make, so a product ships only when the feed price
 * appears verbatim in the live page's own price data.
 *
 * Output: data/deals-grid.json  { checked_at, items[], dropped[] }
 * Nothing is silently discarded — every rejection is recorded with a reason.
 *
 * Usage: node scripts/build-deals-grid.mjs [--limit N]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECRETS = 'C:\\Users\\kinsm\\.secrets\\cj.env';
const ENDPOINT = 'https://ads.api.cj.com/query';
const PID = '101818675';           // our CJ property id — appears in every tracking link
const OUT = join(ROOT, 'data', 'deals-grid.json');

/* Advertisers we are approved with AND whose feed actually returns products.
   TGW (4671274) is deliberately absent: its feed lists 35,590 products but
   returns 0 to us in both the API and the CJ member UI — an account-level
   entitlement, chased under CJ case 01906438. Pinemeadow (565703) publishes no
   feed to CJ at all. Both come back here the day that changes. */
const ADVERTISERS = [
  { id: '6530791', label: 'Cobra Golf',  rate: 4, stale: true  },  // feed rebuilt 2026-03-31 — verify hard
  { id: '6305438', label: 'SQAIRZ',      rate: 5, stale: false },
  { id: '7686132', label: 'SWAG Golf',   rate: 5, stale: false },
];

/* Accessories and consumables that make a deals grid look like a jumble sale.
   The grid is small; every card should be something a golfer would actually
   set out to buy. */
const NOT_A_HEADLINE = [
  'weight', 'wrench', 'tool kit', 'grip tape', 'headcover', 'towel',
  'shoe bag', 'sock', 'lace', 'insole', 'decal', 'sticker', 'gift card',
];

/* ---------------------------------------------------------------------------
   Display titles.

   Feed titles are variant rows, not product names:
     "DARKSPEED LS Driver | Right 8.0 / graphite stiff / project x hzrdus…"
     "FUSION CRUSH SPORT Wide Spikeless Golf Shoes Puma black / electric lime / 10.5"
   Printed as-is they read like a warehouse manifest. We cut the variant tail,
   stop after the product noun, and let the shouty model names sit in title case
   so a Fraunces card reads as a product and not as a SKU.
   --------------------------------------------------------------------------- */

/* Longest first, so "Fairway Wood" wins over "Fairway" and "Golf Shoes" over "Shoes". */
const PRODUCT_NOUNS = [
  'Golf Shoes', 'Golf Shorts', 'Golf Pants', 'Golf Skirt', 'Golf Polo', 'Golf Bag',
  'Golf Jacket', 'Golf Vest', 'Golf Hoodie', '1/4 Zip', 'Quarter Zip', 'Crewneck',
  'Fairway Wood', 'Driver', 'Fairway', 'Hybrid', 'Irons', 'Iron', 'Putter', 'Wedge',
];

/* Model designations that are genuinely initialisms and must stay shouting. */
const KEEP_CAPS = new Set(['LS', 'LX', 'XL', 'GT', 'SL', 'MAX', 'X', 'G', 'TD', 'AIT', 'PGX']);

function deShout(word) {
  if (word.includes('-')) return word;                 // DS-ADAPT reads as a model code
  if (KEEP_CAPS.has(word)) return word;
  if (word.length < 4 || word !== word.toUpperCase()) return word;
  if (!/[A-Z]/.test(word)) return word;
  return word[0] + word.slice(1).toLowerCase();
}

function displayTitle(rawTitle, brand) {
  let t = rawTitle.split(' | ')[0].split(' / ')[0].trim();

  /* Stop after the product noun — everything past it is colour or handedness. */
  let cut = -1;
  let noun = '';
  for (const n of PRODUCT_NOUNS) {
    const i = t.toLowerCase().lastIndexOf(n.toLowerCase());
    if (i > -1 && i + n.length > cut) { cut = i + n.length; noun = n; }
  }
  if (cut > -1) t = t.slice(0, cut).trim();
  if (/\bfairway$/i.test(t)) t += ' Wood';              // "Darkspeed LS Fairway" -> "…Fairway Wood"

  t = t.split(/\s+/).map(deShout).join(' ');

  /* Prefix the maker unless the name already carries it. */
  const maker = (brand || '').replace(/\s+golf$/i, '').trim();
  const makerNice = maker ? deShout(maker) : '';
  if (makerNice && !new RegExp(`\\b${makerNice}\\b`, 'i').test(t)) t = `${makerNice} ${t}`;

  return t.replace(/\s{2,}/g, ' ').trim();
}

/* The CJ advertiser "Puma Golf and Cobra Golf" covers two storefronts, so the
   advertiser label would print Puma shoes as sold by Cobra. Use the host. */
const STOREFRONTS = [
  [/(^|\.)cobragolf\.com$/i, 'Cobra Golf'],
  [/(^|\.)pumagolf\.com$/i, 'Puma Golf'],
  [/(^|\.)sqairz\.com$/i, 'SQAIRZ'],
  [/(^|\.)swag\.golf$/i, 'SWAG Golf'],
];

function storefront(url, fallback) {
  let host = '';
  try { host = new URL(url).hostname; } catch { return fallback; }
  for (const [re, name] of STOREFRONTS) if (re.test(host)) return name;
  return fallback;
}

function loadToken() {
  let raw;
  try {
    raw = readFileSync(SECRETS, 'utf8');
  } catch {
    throw new Error(`Cannot read ${SECRETS}. The CJ token lives there and is never committed.`);
  }
  const token = /^CJ_PERSONAL_ACCESS_TOKEN=(.+)$/m.exec(raw)?.[1]?.trim();
  const company = /^CJ_COMPANY_ID=(.+)$/m.exec(raw)?.[1]?.trim();
  if (!token || !company) throw new Error('cj.env is missing CJ_PERSONAL_ACCESS_TOKEN or CJ_COMPANY_ID.');
  return { token, company };
}

async function cj(query, token) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`CJ ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  if (json.errors) throw new Error(`CJ GraphQL: ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.data;
}

/* `products` returns the Product INTERFACE — availability lives on the Shopping
   implementation, hence the inline fragment. price/salePrice are objects. */
function productQuery(company, partnerId, offset, limit) {
  return `{products(companyId:"${company}",partnerIds:["${partnerId}"],offset:${offset},limit:${limit}){
    resultList{ title brand advertiserName price{amount} salePrice{amount}
    imageLink link linkCode(pid:"${PID}"){clickUrl} ... on Shopping{availability} }}}`;
}

async function fetchAdvertiser(adv, company, token) {
  const byUrl = new Map();
  for (let offset = 0; offset < 4000; offset += 1000) {
    const data = await cj(productQuery(company, adv.id, offset, 1000), token);
    const list = data.products.resultList;
    for (const p of list) {
      const listPrice = Number(p.price?.amount);
      const sale = Number(p.salePrice?.amount);
      if (!Number.isFinite(listPrice) || !Number.isFinite(sale)) continue;
      if (sale >= listPrice) continue;                       // not actually discounted
      if (p.availability !== 'in stock') continue;
      if (!p.imageLink || !p.linkCode?.clickUrl) continue;    // no photo or no commission = no card
      const title = (p.title || '').trim();
      if (NOT_A_HEADLINE.some((w) => title.toLowerCase().includes(w))) continue;

      /* One card per product page. The feed lists every size and colour as its
         own row, so without this a single shoe would fill the whole grid. */
      const prev = byUrl.get(p.link);
      const pct = (listPrice - sale) / listPrice;
      if (!prev || pct > prev.pct) {
        byUrl.set(p.link, {
          title: displayTitle(title, p.brand),
          feed_title: title,
          brand: p.brand || null,
          retailer: storefront(p.link, adv.label),
          rate: adv.rate,
          stale_feed: adv.stale,
          list: listPrice,
          sale,
          pct,
          image: p.imageLink,
          url: p.link,
          track: p.linkCode.clickUrl,
        });
      }
    }
    if (list.length < 1000) break;
  }
  return [...byUrl.values()];
}

/* Read the retailer's own page and collect every price it states. Shopify
   renders these as integer cents ("price":29900) and/or decimal strings. We are
   only asking one question: does our number appear on their page? */
async function readProductPage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'MulliganMemoPriceCheck/1.0 (+https://mulliganmemo.com/deals.html)' },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) return null;
  const html = await res.text();

  const prices = new Set();
  for (const m of html.matchAll(/"price":(\d{3,7})[,}]/g)) prices.add(Number(m[1]) / 100);
  for (const m of html.matchAll(/"price":"([0-9.]+)"/g)) prices.add(Number(m[1]));

  /* The page's own current hero image, used only when the feed's URL has rotted.
     Same page, same request we already make for the price. */
  const og = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html)
          || /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(html);
  /* Shopify emits og:image protocol-relative or on bare http. The site is
     served over https, so an http src is silently blocked as mixed content —
     it survived local testing (localhost is http) and shipped two empty wells
     to production. Force https here, always. */
  let ogImage = og?.[1] || null;
  if (ogImage) {
    if (ogImage.startsWith('//')) ogImage = `https:${ogImage}`;
    else ogImage = ogImage.replace(/^http:\/\//i, 'https://');
  }

  return { prices: prices.size ? prices : null, ogImage };
}

/* The feed's image URLs rot the same way its prices do: Cobra rotated their CDN
   filenames after this feed was built, so two of the first eight cards pointed
   at 404s. A card with a dead photo is worse than no card, so the image has to
   clear the same gate the price does. */
async function imageLoads(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MulliganMemoPriceCheck/1.0 (+https://mulliganmemo.com/deals.html)' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return `image ${res.status}`;
    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return `image served as ${type || 'unknown type'}`;
    return null;
  } catch (err) {
    return `image fetch failed (${err.name})`;
  }
}

async function verify(item) {
  let page;
  try {
    page = await readProductPage(item.url);
  } catch (err) {
    return { ok: false, reason: `fetch failed (${err.name})` };
  }
  if (!page) return { ok: false, reason: 'product page unreachable' };
  if (!page.prices) return { ok: false, reason: 'no price found on live page' };
  if (!page.prices.has(item.sale)) {
    const low = Math.min(...page.prices);
    return { ok: false, reason: `feed says $${item.sale.toFixed(2)}, live page shows $${low.toFixed(2)}` };
  }

  /* Codex's catch, and it is the right one: price accuracy is VARIANT accuracy.
     A page can legitimately contain our number while only one loft, flex, hand
     or shoe size actually sells at it — the reader clicks a $299 card and lands
     on the default configuration at $399. Our links go to the product, not a
     variant, so the only price we can honestly print is one that holds across
     every variant on the page. Anything else needs a "select lofts" caveat we
     have no reliable way to generate, so it is dropped instead. */
  if (page.prices.size > 1) {
    const spread = [...page.prices].sort((a, b) => a - b);
    return {
      ok: false,
      reason: `price varies by variant ($${spread[0].toFixed(2)}–$${spread[spread.length - 1].toFixed(2)}) — our $${item.sale.toFixed(2)} is not what every buyer sees`,
    };
  }

  let imgProblem = await imageLoads(item.image);
  if (imgProblem && page.ogImage && page.ogImage !== item.image) {
    const fallbackProblem = await imageLoads(page.ogImage);
    if (!fallbackProblem) {
      item.image = page.ogImage;      // feed URL rotted; use the page's current hero
      item.image_source = 'product page';
      imgProblem = null;
    }
  }
  if (imgProblem) return { ok: false, reason: imgProblem };
  return { ok: true };
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

const wantedRaw = process.argv.indexOf('--limit');
const WANTED = wantedRaw > -1 ? Number(process.argv[wantedRaw + 1]) : 8;

const { token, company } = loadToken();

let pool = [];
for (const adv of ADVERTISERS) {
  const rows = await fetchAdvertiser(adv, company, token);
  console.log(`  ${adv.label.padEnd(12)} ${String(rows.length).padStart(4)} distinct discounted in-stock products`);
  pool = pool.concat(rows);
}
/* Deterministic order. Discount first, then the dearer item, then title as a
   final tiebreak — otherwise two products tied at the same percentage swap
   places between runs and the shelf changes for no reason. */
pool.sort((a, b) => (b.pct - a.pct) || (b.list - a.list) || a.title.localeCompare(b.title));

/* Verify in discount order and stop once the grid is full, so we spend requests
   on the products most likely to lead the page. Verify a few extra so a couple
   of failures do not leave a short grid. */
const shortlist = pool.slice(0, WANTED * 5);
console.log(`\nverifying ${shortlist.length} candidates against retailer pages…`);
const verdicts = await mapLimit(shortlist, 4, async (item) => ({ item, ...(await verify(item)) }));

const items = [];
const dropped = [];
const surplus = [];
for (const v of verdicts) {
  if (!v.ok) {
    dropped.push({ title: v.item.title, url: v.item.url, reason: v.reason });
  } else if (items.length < WANTED) {
    const { pct, stale_feed, ...rest } = v.item;
    items.push({ ...rest, pct: Math.round(pct * 100), verified: true });
  } else {
    /* Verified but beyond the grid size. Recorded rather than dropped on the
       floor — a cap that is not written down reads later as "nothing else
       qualified", which is not what happened. */
    surplus.push({ title: v.item.title, url: v.item.url, pct: Math.round(v.item.pct * 100) });
  }
}

mkdirSync(dirname(OUT), { recursive: true });
const checked = new Date().toISOString();
writeFileSync(OUT, JSON.stringify({ checked_at: checked, items, surplus_verified: surplus, dropped }, null, 2));

/* ------------------------------------------------------------------ render */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const money = (n) => `$${n.toFixed(2).replace(/\.00$/, '')}`;

/* Dollars beat percentages on a $549 driver; percentages beat dollars on a $70
   pair of shorts. Show whichever number is actually the persuasive one. */
function savingLabel(list, sale, pct) {
  const off = list - sale;
  return off >= 50 ? `SAVE $${Math.round(off)}` : `${pct}% OFF`;
}

function card(it) {
  return `      <a class="dg-card" href="${esc(it.track)}" rel="nofollow sponsored noopener" target="_blank">
        <span class="dg-well">
          <img src="${esc(it.image)}" alt="${esc(it.title)}" loading="lazy" decoding="async">
          <span class="dg-save">${esc(savingLabel(it.list, it.sale, it.pct))}</span>
        </span>
        <span class="dg-body">
          <span class="dg-store">${esc(it.retailer)}</span>
          <span class="dg-name">${esc(it.title)}</span>
          <span class="dg-prices">
            <span class="dg-was">${money(it.list)}</span>
            <span class="dg-now">${money(it.sale)}</span>
          </span>
          <span class="dg-cta"><span class="dg-go">GET THE DEAL &rarr;</span><span class="dg-paid">paid link</span></span>
        </span>
      </a>`;
}

const checkedNice = new Date(checked).toLocaleDateString('en-US', {
  month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York',
});

const block = `<!-- dealsgrid:auto:start -->
  <section class="dg-wrap" aria-label="Golf deals on the board">
    <div class="dg-head">
      <div>
        <p class="dg-kick">FROM THE DEALS DESK &#10038; THE RESEARCH DESK</p>
        <h2 class="dg-title">On the Board</h2>
      </div>
      <span class="dg-checked">Prices checked ${esc(checkedNice)}</span>
    </div>
    <div class="dg-grid">
${items.map(card).join('\n')}
    </div>
    <p class="dg-foot">Every price above was read off the retailer&rsquo;s own product page on ${esc(checkedNice)}. Stock and prices move without notice.</p>
  </section>
  <!-- dealsgrid:auto:end -->`;

const PAGE = join(ROOT, 'deals.html');
let html = readFileSync(PAGE, 'utf8');
const marker = /<!-- dealsgrid:auto:start -->[\s\S]*?<!-- dealsgrid:auto:end -->/;

/* Replacer FUNCTIONS, not strings. Every price in `block` starts with a dollar
   sign, and String.replace reads "$1" / "$&" in a replacement string as capture
   references — the first run spliced the disclosure markup into a price tag. */
if (marker.test(html)) {
  html = html.replace(marker, () => block);
} else {
  /* First run: seat the grid directly under the disclosure banner, above the
     existing ledger, so it is the first thing on the page. */
  const anchor = /(<div class="dd-disclosure">[\s\S]*?<\/div>)/;
  if (!anchor.test(html)) {
    throw new Error('deals.html: could not find .dd-disclosure to anchor the grid. Not guessing — insert the markers by hand.');
  }
  html = html.replace(anchor, (m) => `${m}\n\n    ${block}`);
}
writeFileSync(PAGE, html);
console.log(`rendered ${items.length} cards into deals.html`);

console.log(`\nverified and publishable: ${items.length}`);
for (const it of items) {
  console.log(`  -${String(it.pct).padStart(2)}%  $${it.list.toFixed(2)} -> $${it.sale.toFixed(2)}  ${it.title.slice(0, 46)}`);
}
if (dropped.length) {
  console.log(`\nheld back (${dropped.length}) — recorded in the json, not silently binned:`);
  for (const d of dropped.slice(0, 10)) console.log(`  ${d.reason}  ::  ${d.title.slice(0, 44)}`);
}
console.log(`\nwrote ${OUT}`);
