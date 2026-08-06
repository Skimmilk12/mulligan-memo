/* build-drop-email.mjs — "The Drop", the weekly price-drop email.
 *
 * Builds a ready-to-send issue from the SAME verified data the deals grid uses,
 * so the email can never quote a price the site has not checked against the
 * retailer's own page. If deals-grid.json is stale, this refuses to write an
 * issue rather than mailing yesterday's numbers to the list — a wrong price in
 * an inbox is worse than a wrong price on a page, because nobody can correct it
 * after it has sent.
 *
 * Output: drafts/the-drop-YYYY-MM-DD.md  (drafts/ is gitignored)
 * Format: Buttondown markdown. Deliberately not HTML — mail clients mangle CSS,
 * and a plain list of prices is what the reader came for anyway.
 *
 * Usage: node scripts/build-drop-email.mjs [--max 6] [--force]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GRID = join(ROOT, 'data', 'deals-grid.json');
const SITE = 'https://mulliganmemo.com';

/* An issue built on prices older than this is not worth sending. */
const MAX_AGE_HOURS = 36;

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const MAX = Number(arg('max', 6));
const FORCE = process.argv.includes('--force');

const grid = JSON.parse(readFileSync(GRID, 'utf8'));
const ageHours = (Date.now() - new Date(grid.checked_at).getTime()) / 3600000;

if (ageHours > MAX_AGE_HOURS && !FORCE) {
  console.error(
    `Refusing to build an issue: prices were last verified ${ageHours.toFixed(1)} hours ago `
    + `(limit ${MAX_AGE_HOURS}h). Run build-deals-grid.mjs first, or pass --force if you `
    + 'genuinely want to send prices this old.',
  );
  process.exit(1);
}

const money = (n) => `$${n.toLocaleString('en-US', {
  minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2,
})}`;

/* Built from both ends, like the grid. Sorting purely by dollars saved fills the
   whole issue with $10,000 simulators, which is a spectacular list and a useless
   one — most of the people on this list are not buying a launch monitor this
   week. Lead with the big numbers, then give the sharpest percentage cuts on
   things a normal golfer might actually buy. */
const byMoney = [...grid.items].sort((a, b) => (b.list - b.sale) - (a.list - a.sale));
const byPercent = [...grid.items].sort((a, b) => b.pct - a.pct);

const HEADLINE_SLOTS = Math.min(3, Math.ceil(MAX / 2));
const picks = [];
const taken = new Set();
for (const src of [byMoney.slice(0, HEADLINE_SLOTS), byPercent]) {
  for (const it of src) {
    if (picks.length >= MAX) break;
    if (taken.has(it.url)) continue;
    taken.add(it.url);
    picks.push(it);
  }
}

if (!picks.length) {
  console.error('No verified deals to send. Not writing an empty issue.');
  process.exit(1);
}

const lead = picks[0];
const leadSaving = lead.list - lead.sale;
const checkedNice = new Date(grid.checked_at).toLocaleDateString('en-US', {
  month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York',
});
const stamp = new Date(grid.checked_at).toISOString().slice(0, 10);

/* Subject: the single biggest number, then the count. No "Newsletter #7". */
const subject = `${money(leadSaving)} off the ${lead.title.replace(/\s*\(.*?\)\s*$/, '')}`
  + (picks.length > 1 ? `, and ${picks.length - 1} more` : '');

const lines = [];
lines.push(`# The Drop`);
lines.push('');
/* A date, not an explanation. The reader wants to know the prices are current,
   not how we established that. */
lines.push(`Prices as of ${checkedNice}.`);
lines.push('');

for (const it of picks) {
  const off = it.list - it.sale;
  const from = it.from ? 'from ' : '';
  lines.push(`### [${it.title}](${it.track})`);
  lines.push(`**${from}${money(it.sale)}** — was ${money(it.list)} · **save ${money(off)}** (${it.pct}% off)  `);
  lines.push(`_${it.retailer}_`);
  lines.push('');
}

lines.push('---');
lines.push('');
lines.push(`[See the full board →](${SITE}/deals.html)`);
lines.push('');
lines.push('Stock and prices move without notice — if something has changed by the time you '
  + 'click, that is the retailer, not a typo on our end.');
lines.push('');
lines.push('Some links here earn us a commission.');

const body = lines.join('\n');

const OUTDIR = join(ROOT, 'drafts');
mkdirSync(OUTDIR, { recursive: true });
const out = join(OUTDIR, `the-drop-${stamp}.md`);
writeFileSync(out, `SUBJECT: ${subject}\n\n---\n\n${body}\n`);

console.log(`prices verified ${ageHours.toFixed(1)}h ago — ok\n`);
console.log(`SUBJECT: ${subject}\n`);
for (const it of picks) {
  console.log(`  save ${money(it.list - it.sale).padStart(8)}  ${money(it.sale).padStart(9)}  ${it.title.slice(0, 46)}`);
}
console.log(`\nwrote ${out}`);
console.log('Paste into Buttondown as markdown. Nothing sends from this script.');
