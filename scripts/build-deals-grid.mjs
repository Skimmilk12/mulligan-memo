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

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/* Overridable so the no-credentials path can actually be tested, rather than
   assumed to work. */
const SECRETS = process.env.MM_CJ_SECRETS_PATH || 'C:\\Users\\kinsm\\.secrets\\cj.env';
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
/* PRICE BANDS.

   A flat "top N by saving" makes every product compete against $15,000
   simulator packages, and the arithmetic is brutal: PlayBetter cut the Uneekor
   EYE MINI from $4,500 to $2,999 — a genuine $1,501 off a thing people actually
   buy — and it did not make a 24-item board, because two dozen packages beat it
   on absolute dollars. A golfer shopping for a launch monitor under $3,000 would
   never have seen it.

   So the board is grouped. Within a band the biggest saving wins, but a band
   only competes with itself, and the cheap end always gets shelf space. */
const BANDS = [
  { id: 'dropped',  label: 'Just dropped',                              lo: 0,    hi: Infinity, max: 6, newOnly: true },
  { id: 'flagship', label: 'Simulators &amp; flagship launch monitors', lo: 5000, hi: Infinity, max: 6 },
  { id: 'serious',  label: 'Serious kit, $2,000 to $5,000',            lo: 2000, hi: 5000,     max: 6 },
  { id: 'midrange', label: 'Clubs and gear, $250 to $2,000',           lo: 250,  hi: 2000,     max: 6 },
  { id: 'everyday', label: 'Under $250',                                lo: 0,    hi: 250,      max: 6 },
];

/* A deals grid is a shop window. Below this, a product is an impulse add-on,
   not something a golfer comes to the page to buy — and a $9.95 gel pack
   sitting beside a $15,000 launch monitor makes the whole shelf look like a
   clearance bin. */
const MIN_HEADLINE_PRICE = 50;

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

/* Retailer titles are written for search engines, not for a card. PlayBetter's
   run to 180 characters — "…BYO (Build Your Own) Package – Custom Home Golf
   Simulator Studio Builder with Impact Screen, Enclosure, Optional Mats,
   Projector & More". Clamping that to two lines just hides the mess; the fix is
   to cut it back to the thing being sold. */
function tidyRetailTitle(t) {
  t = t.split(/\s+[–—]\s+/)[0];                       // drop the marketing tail after an en/em dash
  t = t.replace(/\s*\((?:build your own|byo)\)/ig, ''); // "BYO (Build Your Own)" says it twice
  t = t.replace(/\bgolf launch monitor (?:and|&) simulator\b/ig, 'Launch Monitor');
  t = t.replace(/\blaunch monitor (?:and|&) simulator\b/ig, 'Launch Monitor');
  t = t.replace(/\bgolf simulator studio builder\b/ig, 'Simulator Studio');
  t = t.replace(/\(certified pre-?owned\)/ig, '(Pre-Owned)');
  t = t.replace(/\s*\|\s*.*$/, '');                   // trailing pipe-delimited blurb
  return t.replace(/\s{2,}/g, ' ').replace(/[,\s]+$/, '').trim();
}

/* Last resort once the rules above have run: cut on a word boundary so a card
   never shows half a word. */
function capLength(t, max) {
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,\s]+$/, '') + '…';
}

function displayTitle(rawTitle, brand) {
  let t = tidyRetailTitle(rawTitle.split(' | ')[0].split(' / ')[0].trim());

  /* Stop after the product noun — everything past it is colour or handedness. */
  let cut = -1;
  let noun = '';
  for (const n of PRODUCT_NOUNS) {
    const i = t.toLowerCase().lastIndexOf(n.toLowerCase());
    if (i > -1 && i + n.length > cut) { cut = i + n.length; noun = n; }
  }
  if (cut > -1) t = t.slice(0, cut).trim();
  if (/\bfairway$/i.test(t)) t += ' Wood';              // "Darkspeed LS Fairway" -> "…Fairway Wood"

  /* Strip a trailing colourway. Sqairz name one shoe five ways — "Speed Mesh
     Light Gray & Blue", "… White & Navy" — and without this the grid fills up
     with the same shoe wearing different paint. */
  const COLOUR = '(black|white|navy|gray|grey|blue|red|green|pink|tan|brown|silver|gold|charcoal|cream|sand|teal|purple|orange|yellow|olive|khaki|light|dark|mint|coral|lime|steel|slate)';
  t = t.replace(new RegExp(`(?:\\s+(?:&|and))?\\s+${COLOUR}(?:\\s+(?:&|and)?\\s*${COLOUR})*\\s*$`, 'i'), '').trim();

  t = t.split(/\s+/).map(deShout).join(' ');

  /* Prefix the maker unless the name already carries it. Match on the maker's
     FIRST word, not the whole string, or "Foresight Sports" fails to match a
     title starting "Foresight QuadMAX" and we print the brand twice. */
  const maker = (brand || '').replace(/\s+golf$/i, '').trim();
  const makerNice = maker ? maker.split(/\s+/).map(deShout).join(' ') : '';
  const firstWord = makerNice.split(/\s+/)[0] || '';
  if (firstWord && !new RegExp(`\\b${firstWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t)) {
    t = `${makerNice} ${t}`;
  }

  return capLength(t.replace(/\s{2,}/g, ' ').trim(), 58);
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

/* ---------------------------------------------------------------------------
   PlayBetter.

   PlayBetter is not on CJ and publishes no product feed we can reach, so their
   products come from the nightly price bot instead (data/deals-latest.json).
   They earn their place here on arithmetic: 5% of a $14,999 launch monitor is
   $750, against $12 for 4% of a $299 driver. 127 of their in-stock sale items
   are over $1,000. A deals grid that leads with golf shoes while that inventory
   sits in a text list below it is merchandising the cheapest thing we sell.
   --------------------------------------------------------------------------- */
const PB_REF = 'ghref=2301%3A1337756';   // our GrowthHero tracking ref
const PB_RATE = 5;

function playbetterLink(url) {
  const clean = String(url).split('#')[0];
  if (clean.includes(PB_REF)) return clean;
  return clean + (clean.includes('?') ? '&' : '?') + PB_REF;
}

/* What changed SINCE YESTERDAY.

   A price cut announced this morning looks identical to one that has been
   running for a month, and the newer one is the reason somebody opens a deals
   page. The nightly price log has 25 days of per-product history keyed by URL,
   so the difference is just a diff — and it works: the run on 2026-08-05 caught
   all six SportScreen Vanish enclosures dropping overnight, which was exactly
   the promotion PlayBetter emailed their list about that evening. */
function loadYesterdayPrices() {
  let files = [];
  try {
    files = readdirSync(join(ROOT, 'data', 'prices')).filter((f) => f.endsWith('.json')).sort();
  } catch { return new Map(); }
  if (files.length < 2) return new Map();
  const prev = JSON.parse(readFileSync(join(ROOT, 'data', 'prices', files[files.length - 2]), 'utf8'));
  const map = new Map();
  for (const it of prev.items || []) {
    if (it.url && Number.isFinite(Number(it.price))) map.set(it.url, Number(it.price));
  }
  return map;
}
const YESTERDAY = loadYesterdayPrices();

function loadPlayBetter() {
  let raw;
  try {
    raw = JSON.parse(readFileSync(join(ROOT, 'data', 'deals-latest.json'), 'utf8'));
  } catch {
    console.log('  PlayBetter      (no price-bot data — skipped)');
    return [];
  }
  const out = [];
  for (const c of raw.candidates || []) {
    if (c.retailer !== 'PlayBetter' || !c.available) continue;
    const list = Number(c.compare_at);
    const sale = Number(c.price);
    if (!Number.isFinite(list) || !Number.isFinite(sale) || sale >= list) continue;
    if (sale < MIN_HEADLINE_PRICE) continue;
    const title = (c.title || '').trim();
    if (NOT_A_HEADLINE.some((w) => title.toLowerCase().includes(w))) continue;
    out.push({
      title: displayTitle(title, c.vendor),
      feed_title: title,
      brand: c.vendor || null,
      retailer: 'PlayBetter',
      rate: PB_RATE,
      stale_feed: false,
      list,
      sale,
      pct: (list - sale) / list,
      image: null,            // no feed image — taken from the product page at verify time
      url: c.url,
      track: playbetterLink(c.url),
      dropped_from: (YESTERDAY.get(c.url) > sale) ? YESTERDAY.get(c.url) : null,
    });
  }
  return out;
}

/* Credentials come from the environment first so this runs on a CI runner, and
   fall back to the local secrets file so it still runs by hand on Robert's
   machine. Neither path ever puts the token in the repo. */
function loadToken() {
  let token = process.env.CJ_PERSONAL_ACCESS_TOKEN?.trim();
  let company = process.env.CJ_COMPANY_ID?.trim();

  if (!token || !company) {
    let raw = '';
    try {
      raw = readFileSync(SECRETS, 'utf8');
    } catch { /* no local secrets file; see the note below */ }
    token ||= /^CJ_PERSONAL_ACCESS_TOKEN=(.+)$/m.exec(raw)?.[1]?.trim();
    company ||= /^CJ_COMPANY_ID=(.+)$/m.exec(raw)?.[1]?.trim();
  }

  /* CJ IS OPTIONAL, AND THAT MATTERS.

     CJ covers Cobra/Puma, SQAIRZ and SWAG — the cheap end of the shelf. The
     launch monitors and simulators, which are the whole commercial point of
     this grid, come from PlayBetter via the price bot and need no CJ
     credential whatsoever.

     An earlier version threw here when credentials were missing, which would
     have taken every PlayBetter card down with it over a token they do not
     use. Missing CJ now costs us the Cobra half and nothing else. */
  if (!token || !company) return null;
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
      if (sale < MIN_HEADLINE_PRICE) continue;
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
    /* Simulator packages and launch monitor bundles legitimately price by
       configuration, and rejecting them outright throws away the most valuable
       inventory on the board. The honest middle is what the retailers
       themselves print: if our number is the ENTRY price, say "from $X" and the
       reader knows the shape of it. If our number sits somewhere in the middle
       of the range, it is neither the price they will land on nor the cheapest
       one, and the card still goes. */
    if (item.sale === spread[0]) {
      item.from = true;
      item.spread_high = spread[spread.length - 1];
    } else {
      return {
        ok: false,
        reason: `price varies by variant ($${spread[0].toFixed(2)}–$${spread[spread.length - 1].toFixed(2)}) — our $${item.sale.toFixed(2)} is neither the entry price nor what every buyer sees`,
      };
    }
  }

  /* PlayBetter items arrive with no image at all — the price bot does not carry
     one — so they go straight to the product page's own hero. */
  let imgProblem = item.image ? await imageLoads(item.image) : 'no image in source';
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

const creds = loadToken();

let pool = [];
if (creds) {
  for (const adv of ADVERTISERS) {
    const rows = await fetchAdvertiser(adv, creds.company, creds.token);
    console.log(`  ${adv.label.padEnd(12)} ${String(rows.length).padStart(4)} distinct discounted in-stock products`);
    pool = pool.concat(rows);
  }
} else {
  console.log('  CJ           SKIPPED — no CJ_PERSONAL_ACCESS_TOKEN / CJ_COMPANY_ID.');
  console.log('               Cobra, SQAIRZ and SWAG are out of tonight\'s shelf; PlayBetter is unaffected.');
}

const pb = loadPlayBetter();
if (pb.length) console.log(`  ${'PlayBetter'.padEnd(12)} ${String(pb.length).padStart(4)} distinct discounted in-stock products`);
pool = pool.concat(pb);

if (!pool.length) {
  throw new Error('No candidate products from any source — refusing to publish an empty grid.');
}

const saved = (x) => x.list - x.sale;

/* Two shelves, deliberately.

   Ranking purely by percentage buries the things that matter: 45% off a $6,345
   simulator is a bigger event, for the reader AND for us, than 50% off a $100
   shoe — $2,850 saved against $50, and $175 of commission against $2. But a
   grid of nothing but $10,000 launch monitors is no use to a golfer who came
   looking for shoes.

   So the shelf is built from both ends: the biggest real savings first, then
   the sharpest percentage cuts from what is left. High-ticket leads, affordable
   follows, and every card is a genuine discount either way. */
const byMoney = [...pool].sort((a, b) => saved(b) - saved(a) || a.title.localeCompare(b.title));
const byPercent = [...pool].sort((a, b) => (b.pct - a.pct) || (b.list - a.list) || a.title.localeCompare(b.title));

/* Verify in discount order and stop once the grid is full, so we spend requests
   on the products most likely to lead the page. Verify a few extra so a couple
   of failures do not leave a short grid. */
const HERO_SLOTS = Math.ceil(WANTED / 2);   // half the grid reserved for big-ticket

/* Dedupe on the DISPLAYED name as well as the URL. Sqairz sell one shoe across
   several product pages, one per colourway, and a URL-only check happily put
   the same "Sqairz Speed Mesh" on four consecutive cards. */
const shortlist = [];
const seenUrl = new Set();
const seenName = new Set();
for (const item of [...byMoney.slice(0, WANTED * 4), ...byPercent.slice(0, WANTED * 4)]) {
  const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (seenUrl.has(item.url) || seenName.has(key)) continue;
  seenUrl.add(item.url);
  seenName.add(key);
  shortlist.push(item);
}

console.log(`\nverifying ${shortlist.length} candidates against retailer pages…`);
const verdicts = await mapLimit(shortlist, 4, async (item) => ({ item, ...(await verify(item)) }));

const okByUrl = new Map();
const dropped = [];
for (const v of verdicts) {
  if (v.ok) okByUrl.set(v.item.url, v.item);
  else dropped.push({ title: v.item.title, url: v.item.url, reason: v.reason });
}

/* Fill the big-ticket half first, then top up with the sharpest percentage cuts
   that are not already on the shelf. */
const chosen = [];
const taken = new Set();
for (const src of [byMoney.slice(0, HERO_SLOTS === 0 ? 0 : Infinity), byPercent]) {
  const cap = chosen.length < HERO_SLOTS ? HERO_SLOTS : WANTED;
  for (const cand of src) {
    if (chosen.length >= cap) break;
    if (taken.has(cand.url) || !okByUrl.has(cand.url)) continue;
    taken.add(cand.url);
    chosen.push(okByUrl.get(cand.url));
  }
}

const items = [];
const surplus = [];
for (const v of [...chosen.map((item) => ({ item, ok: true })),
                 ...verdicts.filter((x) => x.ok && !taken.has(x.item.url))]) {
  if (items.length < WANTED) {
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

/* Thousands separators matter more here than anywhere else on the site: a
   launch monitor card reading "$14999" looks like a typo, not a price. */
const money = (n) => {
  const whole = Number.isInteger(n);
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
};

/* Dollars beat percentages on a $549 driver; percentages beat dollars on a $70
   pair of shorts. Show whichever number is actually the persuasive one. */
function savingLabel(list, sale, pct) {
  const off = list - sale;
  return off >= 50 ? `SAVE $${Math.round(off).toLocaleString('en-US')}` : `${pct}% OFF`;
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
            <span class="dg-now">${it.from ? '<span class="dg-from">from</span> ' : ''}${money(it.sale)}</span>
          </span>
          <span class="dg-cta"><span class="dg-go">GET THE DEAL &rarr;</span></span>
        </span>
      </a>`;
}

/* The page's existing analytics only listens for a.dd-buy, which is the old
   text ledger. Every card in this grid is an a.dg-card, so without this the
   most valuable clicks on the site — a $15,000 launch monitor among them — are
   invisible. Shipped with the block so it can never drift away from the markup
   it measures. */
const trackingScript = `  <script>
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a.dg-card');
      if (!a || typeof gtag !== 'function') return;
      var name = a.querySelector('.dg-name');
      var store = a.querySelector('.dg-store');
      var now = a.querySelector('.dg-now');
      gtag('event', 'deal_click', {
        item_name: name ? name.textContent.trim() : a.href,
        retailer: store ? store.textContent.trim() : '',
        price: now ? now.textContent.trim() : '',
        placement: document.querySelector('.dg-strip') && a.closest('.dg-strip') ? 'homepage_strip' : 'deals_grid',
        page_path: location.pathname
      });
    });
  <\/script>`;

const checkedNice = new Date(checked).toLocaleDateString('en-US', {
  month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York',
});

/* Group the verified items into price bands. Biggest saving first inside each
   band, and a band only renders if it has something in it — an empty
   "Under $250" heading is worse than no heading at all. */
const bandSections = BANDS.map((band) => {
  const inBand = items
    .filter((it) => (band.newOnly ? !!it.dropped_from : it.sale >= band.lo && it.sale < band.hi))
    .sort((a, b) => (b.list - b.sale) - (a.list - a.sale))
    .slice(0, band.max);
  if (!inBand.length) return '';
  return `    <h3 class="dg-band">${band.label}</h3>\n    <div class="dg-grid">\n`
    + inBand.map(card).join('\n')
    + `\n    </div>`;
}).filter(Boolean).join('\n');

const block = `<!-- dealsgrid:auto:start -->
  <section class="dg-wrap" aria-label="Golf deals on the board">
    <div class="dg-head">
      <div>
        <p class="dg-kick">FROM THE DEALS DESK &#10038; THE RESEARCH DESK</p>
        <h2 class="dg-title">On the Board</h2>
      </div>
      <span class="dg-checked">Prices checked ${esc(checkedNice)}</span>
    </div>
${bandSections}
    <p class="dg-foot">Stock and prices move without notice.</p>
  </section>
${trackingScript}
  <!-- dealsgrid:auto:end -->`;

/* ------------------------------------------------------- homepage strip ----
   The grid only earns anything if people reach it, and /deals took 3 search
   impressions last month. Readers arrive for a loft chart or a shaft question,
   so the big-ticket deals go where that traffic already lands. Four cards, the
   largest savings only, then out to the full board. */
const stripItems = [...items]
  .sort((a, b) => (b.list - b.sale) - (a.list - a.sale))
  .slice(0, 4);

const strip = `<!-- dealsstrip:auto:start -->
  <section class="home-sec dg-strip" aria-label="Golf deals on the board">
    <div class="home-sec-head">
      <div>
        <p class="sec-kick">FROM THE DEALS DESK &#10038; CHECKED ${esc(checkedNice.toUpperCase())}</p>
        <h2 class="sec-title">On the Board</h2>
      </div>
      <a class="link-plain" href="/deals.html">SEE THE FULL BOARD &rarr;</a>
    </div>
    <div class="dg-grid">
${stripItems.map(card).join('\n')}
    </div>
  </section>
${trackingScript}
  <!-- dealsstrip:auto:end -->`;

const HOME = join(ROOT, 'index.html');
let home = readFileSync(HOME, 'utf8');
const stripMarker = /<!-- dealsstrip:auto:start -->[\s\S]*?<!-- dealsstrip:auto:end -->/;
if (stripMarker.test(home)) {
  home = home.replace(stripMarker, () => strip);
} else {
  const anchor = /(\n\s*<!-- latest from the desk -->)/;
  if (!anchor.test(home)) {
    throw new Error('index.html: could not find the "latest from the desk" comment to seat the deals strip.');
  }
  home = home.replace(anchor, (m) => `\n\n  ${strip}\n${m}`);
}
writeFileSync(HOME, home);
console.log(`rendered ${stripItems.length} cards into index.html`);

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
