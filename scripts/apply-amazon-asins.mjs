// Rewrite Amazon search-page links into exact product links where a verified
// ASIN exists. Usage: node scripts/apply-amazon-asins.mjs [--dry]
//
// WHY: all 574 Amazon links on the site pointed at a SEARCH RESULTS page
// (/s?k=Cleveland+CBX+golf). A reader had to find the product themselves. That
// is the most plausible reason 682 clicks produced 6 orders. The API that would
// resolve these automatically needs 10 sales in a trailing 30 days, which we do
// not have — so the ASINs come from Amazon's own link tool in Associates
// Central, recorded by hand into data/amazon-asins.csv, and this script applies
// them.
//
// FAIL-CLOSED: a term with no ASIN row, or an ASIN that does not look like one,
// keeps its existing search link untouched. A wrong product link is worse than
// a search link; a missing one is merely the status quo.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const TAG = 'mulliganmemo-20';
const DRY = process.argv.includes('--dry');
const MAP = join(ROOT, 'data', 'amazon-asins.csv');
if (!existsSync(MAP)) { console.log('no data/amazon-asins.csv yet — nothing to apply'); process.exit(0); }

// csv: search_term,asin,amazon_title,checked_on  (header row; quotes optional)
function parseCsv(t) {
  const out = []; let row = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"' && t[i+1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); out.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out;
}
const rows = parseCsv(readFileSync(MAP, 'utf8')).filter(r => r.length >= 2 && r[0].trim());
const head = rows[0].map(s => s.trim().toLowerCase());
const iTerm = head.indexOf('search_term'), iAsin = head.indexOf('asin');
if (iTerm < 0 || iAsin < 0) { console.error('amazon-asins.csv needs search_term and asin columns'); process.exit(1); }

const ASIN_RE = /^[A-Z0-9]{10}$/;
const map = new Map();
let badAsin = 0;
for (const r of rows.slice(1)) {
  const term = r[iTerm].trim(), asin = (r[iAsin] || '').trim().toUpperCase();
  if (!term) continue;
  if (!ASIN_RE.test(asin)) { badAsin++; console.log(`  skipped (not an ASIN): "${term}" -> "${asin}"`); continue; }
  map.set(term.toLowerCase(), asin);
}

const files = [...readdirSync(join(ROOT, 'posts')).filter(f => f.endsWith('.html')).map(f => 'posts/' + f), 'index.html'];
let rewritten = 0, left = 0, touched = 0;
const unresolved = new Map();
for (const rel of files) {
  const fp = join(ROOT, rel);
  const before = readFileSync(fp, 'utf8');
  const after = before.replace(/https:\/\/www\.amazon\.com\/s\?k=([^&"]+)(&[^"]*)?/g, (m, k) => {
    const term = decodeURIComponent(k).replace(/\+/g, ' ').trim();
    const asin = map.get(term.toLowerCase());
    if (!asin) { left++; unresolved.set(term, (unresolved.get(term) || 0) + 1); return m; }
    rewritten++;
    return `https://www.amazon.com/dp/${asin}?tag=${TAG}`;
  });
  if (after !== before) { touched++; if (!DRY) writeFileSync(fp, after, 'utf8'); }
}
console.log(`${DRY ? '[dry] ' : ''}rewritten ${rewritten} link(s) in ${touched} file(s); ${left} still search links; ${badAsin} bad ASIN row(s) ignored`);
if (unresolved.size) console.log(`unresolved terms: ${unresolved.size} (see drafts/amazon-asin-worklist.csv)`);
