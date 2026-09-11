// Renders the "where to buy" card under each article's short answer, from
// data/inline-modules.json, between <!-- mm-buy:start --> / <!-- mm-buy:end -->
// markers. Also makes sure every page loads /mm-track.js, the sitewide
// outbound-click tracker, so human affiliate clicks are counted in GA4
// instead of inferred from Amazon's agent-polluted report.
//
// Why it exists (2026-09-11): on a phone the first tappable Amazon button on
// our best-read pages sat 1,300px down inside a table, and the big CTAs sat
// 13,000px down. The verdict box named the winner in bold with no link.
//
// Fail-closed rules:
//   - an `asin` item must be a resolved ASIN in data/amazon-asins.csv, the list
//     Cowork verified by hand; an unknown ASIN aborts the whole run;
//   - an `href` item must be an absolute https URL;
//   - a price renders ONLY from data/amazon-prices.json and only if that file was
//     checked within the last 36 hours. There is no remembered price. Today that
//     file does not exist, so no card shows a price; when the Amazon product API
//     lands, the price appears here with no template change.
//   - generated html must never contain the marker strings.
//
// Usage: node scripts/build-inline-modules.mjs [--dry]
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const START = '<!-- mm-buy:start -->';
const END = '<!-- mm-buy:end -->';
const TRACK_TAG = '<script src="/mm-track.js" defer></script>';
const PRICE_MAX_AGE_H = 36;

const manifest = JSON.parse(readFileSync(join(ROOT, 'data', 'inline-modules.json'), 'utf8'));
// The Associates tracking ID lives in the manifest so the cards can get their
// own ID (Amazon reports earnings per tracking ID) without touching code.
const TAG = manifest.tag;
if (!/^[a-z0-9]+-2[01]$/.test(TAG || '')) throw new Error(`manifest.tag is not an Associates tracking ID: ${TAG}`);

// The allowlist: ASINs that were resolved to an exact product by hand. The
// asin column is the second field and is never quoted, so a plain split is safe.
const known = new Set();
for (const line of readFileSync(join(ROOT, 'data', 'amazon-asins.csv'), 'utf8').split(/\r?\n/).slice(1)) {
  const a = (line.split(',')[1] || '').trim();
  if (/^B0[A-Z0-9]{8}$/.test(a)) known.add(a);
}

// Optional fresh price feed. Absent or stale => no prices anywhere.
let prices = null;
const priceFile = join(ROOT, 'data', 'amazon-prices.json');
if (existsSync(priceFile)) {
  const p = JSON.parse(readFileSync(priceFile, 'utf8'));
  const ageH = (Date.now() - new Date(p.checked_at).getTime()) / 36e5;
  if (Number.isFinite(ageH) && ageH >= 0 && ageH <= PRICE_MAX_AGE_H) prices = p.prices || {};
  else console.log(`amazon-prices.json is ${ageH.toFixed(1)}h old — ignored (limit ${PRICE_MAX_AGE_H}h)`);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function renderItem(it, page) {
  let href, merchant;
  if (it.asin) {
    if (!known.has(it.asin)) throw new Error(`${page}: ASIN ${it.asin} (${it.label}) is not a resolved ASIN in data/amazon-asins.csv`);
    href = `https://www.amazon.com/dp/${it.asin}?tag=${TAG}`;
    merchant = 'Amazon';
  } else if (it.href) {
    if (!/^https:\/\//.test(it.href)) throw new Error(`${page}: href must be absolute https (${it.label})`);
    href = it.href;
    merchant = it.merchant || 'the retailer';
  } else {
    throw new Error(`${page}: item "${it.label}" has neither asin nor href`);
  }
  if (!it.label || !it.for) throw new Error(`${page}: item needs label and for`);

  let price = '';
  if (it.asin && prices && prices[it.asin] && Number.isFinite(prices[it.asin].price)) {
    const p = prices[it.asin];
    const was = Number.isFinite(p.list) && p.list > p.price ? ` <s>${money(p.list)}</s>` : '';
    price = `<span class="price">${money(p.price)}${was}</span>`;
  }

  return `        <li>
          <a class="cta" href="${esc(href)}" target="_blank" rel="nofollow sponsored" aria-label="${esc(it.label)} on ${esc(merchant)}" data-mm-placement="buybox">${esc(it.label)} on ${esc(merchant)} &rarr;</a>
          <p class="for">${esc(it.for)}${price ? ' ' + price : ''}</p>${it.note ? `\n          <p class="note">${esc(it.note)}</p>` : ''}
        </li>`;
}

function renderCard(cfg, page) {
  if (!Array.isArray(cfg.items) || cfg.items.length === 0) throw new Error(`${page}: no items`);
  const items = cfg.items.map((it) => renderItem(it, page)).join('\n');
  const html = `${START}
    <aside class="buy" aria-label="${esc(cfg.heading || 'Where to buy')}">
      <div class="h">${esc(cfg.heading || 'Where to buy')}</div>${cfg.lead ? `\n      <p class="lead">${esc(cfg.lead)}</p>` : ''}
      <ul>
${items}
      </ul>
    </aside>
    ${END}`;
  const body = html.slice(START.length, html.length - END.length);
  if (body.includes('mm-buy:')) throw new Error(`${page}: generated html contains marker text`);
  return html;
}

function placeCard(html, card, page) {
  const startCount = html.split(START).length - 1;
  const endCount = html.split(END).length - 1;
  if (startCount !== endCount || startCount > 1) throw new Error(`${page}: corrupted markers (${startCount} start / ${endCount} end)`);
  if (startCount === 1) {
    return html.replace(/<!-- mm-buy:start -->[\s\S]*?<!-- mm-buy:end -->/, () => card);
  }
  const tldr = html.indexOf('<div class="tldr">');
  if (tldr < 0) throw new Error(`${page}: no .tldr to anchor the card under`);
  const byline = html.indexOf('<div class="byline">', tldr);
  if (byline < 0 || byline - tldr > 6000) throw new Error(`${page}: no .byline within reach of .tldr`);
  return html.slice(0, byline) + card + '\n    ' + html.slice(byline);
}

// 1. Cards.
let cards = 0;
for (const [page, cfg] of Object.entries(manifest.pages)) {
  const file = join(ROOT, page);
  if (!existsSync(file)) throw new Error(`${page}: file not found`);
  const before = readFileSync(file, 'utf8');
  const after = placeCard(before, renderCard(cfg, page), page);
  if (after !== before) {
    cards++;
    if (!DRY) writeFileSync(file, after);
  }
  console.log(`${DRY ? '[dry] ' : ''}${page}: ${cfg.items.length} items${after === before ? ' (unchanged)' : ''}`);
}

// 2. Tracker tag on every page that has the sitewide search script and does not
//    already report outbound clicks itself (product pages do, and are rebuilt
//    nightly from their own template).
const targets = [];
for (const dir of ['', 'posts', 'deals']) {
  const d = join(ROOT, dir);
  if (!existsSync(d)) continue;
  for (const f of readdirSync(d)) if (f.endsWith('.html')) targets.push(join(dir, f));
}
let tagged = 0;
for (const rel of targets) {
  const file = join(ROOT, rel);
  const html = readFileSync(file, 'utf8');
  if (html.includes('/mm-track.js') || !html.includes('<script src="/search.js" defer></script>')) continue;
  if (/outbound_click/.test(html)) continue;
  const out = html.replace('<script src="/search.js" defer></script>', '<script src="/search.js" defer></script>\n' + TRACK_TAG);
  if (!DRY) writeFileSync(file, out);
  tagged++;
}
console.log(`${DRY ? '[dry] ' : ''}cards written: ${cards}; tracker tag added to ${tagged} page(s); prices: ${prices ? 'fresh feed' : 'none (no fresh feed)'}`);
