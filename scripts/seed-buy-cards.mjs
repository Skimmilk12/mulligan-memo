// Seeds data/inline-modules.json with a "where to buy" card for every post that
// already carries a shortlist (mm-glance) table with exact-product Amazon links
// and has no card yet. The card reuses the page's own shortlist: the pick's
// name and the category line the article already gives it ("Best for raw
// beginners"), and the /dp/ASIN link the article already carries. Nothing is
// invented; the card only moves buttons the page already has up to the verdict.
//
// Search-page links (/s?k=) are skipped: the rewriter left those by ruling.
// Usage: node scripts/seed-buy-cards.mjs [--dry] [--max 4]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const MAX = Number((process.argv.find((a) => a.startsWith('--max=')) || '--max=4').slice(6));
const file = join(ROOT, 'data', 'inline-modules.json');
const manifest = JSON.parse(readFileSync(file, 'utf8'));
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&mdash;/g, ', ').replace(/&ndash;/g, '-').replace(/\s+/g, ' ').trim();

let seeded = 0;
for (const f of readdirSync(join(ROOT, 'posts')).filter((x) => x.endsWith('.html')).sort()) {
  const page = 'posts/' + f;
  if (manifest.pages[page]) continue;
  const html = readFileSync(join(ROOT, page), 'utf8');
  const glance = html.match(/<!-- mm-glance:start -->([\s\S]*?)<!-- mm-glance:end -->/);
  if (!glance || !html.includes('<div class="tldr">')) continue;
  const items = [];
  const seen = new Set();
  const rowRe = /<tr>\s*<td class="g-cat">([\s\S]*?)<\/td>\s*<td>[\s\S]*?>([^<]+)<\/a><\/td>\s*<td class="g-go">([\s\S]*?)<\/td>\s*<\/tr>/g;
  let m;
  while ((m = rowRe.exec(glance[1])) && items.length < MAX) {
    const cat = decode(m[1].replace(/<[^>]+>/g, ''));
    const name = decode(m[2]);
    const asin = (m[3].match(/amazon\.com\/dp\/(B0[A-Z0-9]{8})/) || [])[1];
    if (!asin || seen.has(asin)) continue;
    seen.add(asin);
    items.push({ asin, label: name, for: cat.replace(/^Best for /i, 'For ').replace(/^Best /i, 'Best ') + '.' });
  }
  if (items.length < 2) continue;
  manifest.pages[page] = { heading: items.length > 2 ? 'Where to buy the picks' : 'Where to buy the pick', seeded_from: 'glance', items };
  seeded++;
  console.log(`${DRY ? '[dry] ' : ''}${page}: ${items.length} items`);
}
if (!DRY) writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
console.log(`${DRY ? '[dry] ' : ''}seeded ${seeded} page(s)`);
