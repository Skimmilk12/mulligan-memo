// Mulligan Memo price bot — nightly logger of golf gear sale prices.
// Sources are login-free public endpoints only. We store derived facts we
// observed (product, price, compare-at, url, timestamp) — never raw feed dumps.
// Usage: node scripts/price-bot.mjs
import fs from 'fs';
import path from 'path';

const UA = 'MulliganMemoPriceBot/1.0 (+https://mulliganmemo.com/deals.html)';
const OUT_DIR = path.join(process.cwd(), 'data', 'prices');
const LATEST = path.join(process.cwd(), 'data', 'deals-latest.json');

// Shopify stores expose /products.json publicly. `collection` limits the crawl
// to a sale collection where the store has one; otherwise we walk the catalog
// and keep only items with compare_at_price > price.
const SOURCES = [
  { retailer: 'PlayBetter', base: 'https://www.playbetter.com', collection: null, maxPages: 12 },
  { retailer: 'Shop Indoor Golf', base: 'https://shopindoorgolf.com', collection: null, maxPages: 12 },
  { retailer: 'Rain or Shine Golf', base: 'https://rainorshinegolf.com', collection: 'sale', maxPages: 6 },
  { retailer: 'Top Shelf Golf', base: 'https://www.topshelfgolf.com', collection: 'sale', maxPages: 6 },
];

const JUNK = /gift card|gift certificate|warranty|insurance|shipping protection/i;

function nyDateStamp() {
  // File names use the America/New_York calendar date of the run.
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date());
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function bestSaleVariant(product) {
  let best = null;
  for (const v of product.variants || []) {
    const price = parseFloat(v.price);
    const compare = v.compare_at_price ? parseFloat(v.compare_at_price) : null;
    if (!compare || !(compare > price) || !(price > 0)) continue;
    const pct = (compare - price) / compare;
    if (!best || pct > best.pct) best = { price, compare, pct, available: v.available !== false };
  }
  return best;
}

async function crawlShopify(src) {
  const rows = [];
  const pathBase = src.collection ? `/collections/${src.collection}/products.json` : '/products.json';
  for (let page = 1; page <= src.maxPages; page++) {
    const url = `${src.base}${pathBase}?limit=250&page=${page}`;
    const data = await fetchJson(url);
    const products = data.products || [];
    if (products.length === 0) break;
    for (const p of products) {
      if (JUNK.test(p.title)) continue;
      const deal = bestSaleVariant(p);
      if (!deal) continue;
      rows.push({
        retailer: src.retailer,
        title: p.title,
        vendor: p.vendor || '',
        type: p.product_type || '',
        price: deal.price,
        compare_at: deal.compare,
        pct_off: Math.round(deal.pct * 100),
        available: deal.available,
        url: `${src.base}/products/${p.handle}`,
      });
    }
    if (products.length < 250) break;
  }
  return rows;
}

const run = { generated_at: new Date().toISOString(), date: nyDateStamp(), sources: [], items: [] };
for (const src of SOURCES) {
  try {
    const rows = await crawlShopify(src);
    run.sources.push({ retailer: src.retailer, status: 'ok', on_sale_items: rows.length });
    run.items.push(...rows);
    console.log(`${src.retailer}: ${rows.length} on-sale items`);
  } catch (e) {
    run.sources.push({ retailer: src.retailer, status: 'error', error: String(e.message || e) });
    console.error(`${src.retailer}: FAILED — ${e.message || e}`);
  }
}

// Basic schema sanity before writing anything.
const bad = run.items.filter(i => !(i.price > 0) || !(i.compare_at > i.price) || !i.title || !i.url);
if (bad.length) { console.error(`schema check failed on ${bad.length} rows`); process.exit(1); }
const okSources = run.sources.filter(s => s.status === 'ok').length;
if (okSources === 0) { console.error('all sources failed — refusing to write'); process.exit(1); }

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, `${run.date}.json`), JSON.stringify(run));

// Curation candidates: meaningful cuts only, biggest first.
const candidates = run.items
  .filter(i => i.available && (i.pct_off >= 15 || i.compare_at - i.price >= 50))
  .sort((a, b) => b.pct_off - a.pct_off);
fs.writeFileSync(LATEST, JSON.stringify({ generated_at: run.generated_at, date: run.date, sources: run.sources, candidates }, null, 1));

console.log(`\nlogged ${run.items.length} on-sale items from ${okSources}/${SOURCES.length} sources; ${candidates.length} curation candidates`);
