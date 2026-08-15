// Regenerate sitemap.xml for Mulligan Memo from the actual files on disk.
// Usage: node scripts/gen-sitemap.mjs
//
// This lives in scripts/ rather than the .claude toolkit because it runs in CI.
// .claude/ is gitignored, so anything in there is invisible to the nightly
// Action — which is why the sitemap sat on Aug 2 dates while /deals rebuilt
// every night advertising changefreq=daily. One copy, tracked, run by both the
// authoring pipeline and the price bot.
//
// If the site moves to a custom domain, update BASE below.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();          // was a hardcoded Windows path; CI runs on ubuntu
const BASE = 'https://mulliganmemo.com';
const date = new Date().toLocaleDateString('en-CA'); // local (ET) YYYY-MM-DD, avoids UTC future-date

// Per-file lastmod from the last commit that touched each file. Stamping today's
// date on every page at every regen is a false freshness signal across the whole
// archive — Google is told 60+ posts changed when one did.
// Reserved for pages that genuinely change on their own schedule: the homepage
// (aggregates new posts) and /deals (rewritten nightly by the price bot).
const gitDates = (() => {
  const map = new Map();
  try {
    const raw = execSync('git log --pretty=format:%cs --name-only', {
      cwd: ROOT, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    let cur = null;
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) { cur = t; continue; }
      if (cur && !map.has(t)) map.set(t, cur); // first hit = most recent commit
    }
  } catch { /* not a git checkout — fall back to mtime below */ }
  return map;
})();

/* FAIL CLOSED ON A SHALLOW CLONE.
   actions/checkout defaults to fetch-depth: 1, which leaves `git log` able to
   see only the tip commit. Every other file would miss its commit date, fall
   through to mtime — and in CI mtime is checkout time, i.e. today. The sitemap
   would then tell Google that all 94 pages changed, every single night, which
   is a worse lie than a stale date and trains Google to ignore lastmod.
   So: if the history is too shallow to date the archive, refuse to write. */
if (isShallow()) {
  console.error(
    'gen-sitemap: refusing to run on a shallow clone.\n' +
    '  git log can only see the tip commit, so per-file lastmod would fall back to\n' +
    '  mtime (= checkout time) and stamp every page as changed today.\n' +
    '  Fix: set `fetch-depth: 0` on actions/checkout.'
  );
  process.exit(1);
}

function isShallow() {
  try {
    const out = execSync('git rev-parse --is-shallow-repository', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (out === 'true') return true;
  } catch { return false; }   // not a git checkout at all; mtime fallback is the best we have
  return false;
}

// Files edited but not yet committed: the last commit date would understate them,
// so use the working-copy mtime instead.
const dirty = (() => {
  const s = new Set();
  try {
    const raw = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    for (const line of raw.split('\n')) {
      const p = line.slice(3).trim().replace(/^"|"$/g, '');
      if (p) s.add(p.split(' -> ').pop());
    }
  } catch { /* not a git checkout */ }
  return s;
})();

function lastmod(rel) {
  const k = rel.replace(/\\/g, '/');
  if (!dirty.has(k)) {
    const git = gitDates.get(k);
    if (git) return git;
  }
  try { return fs.statSync(path.join(ROOT, rel)).mtime.toLocaleDateString('en-CA'); }
  catch { return date; }
}

const lines = ['<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  `  <url><loc>${BASE}/</loc><lastmod>${date}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>`];

if (fs.existsSync(path.join(ROOT, 'about.html')))
  lines.push(`  <url><loc>${BASE}/about.html</loc><lastmod>${lastmod('about.html')}</lastmod><changefreq>yearly</changefreq><priority>0.5</priority></url>`);
if (fs.existsSync(path.join(ROOT, 'author.html')))
  lines.push(`  <url><loc>${BASE}/author.html</loc><lastmod>${lastmod('author.html')}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>`);
for (const hub of ['beginners.html', 'clubs.html', 'tech.html', 'accessories.html', 'golf-balls.html'])
  if (fs.existsSync(path.join(ROOT, hub)))
    lines.push(`  <url><loc>${BASE}/${hub}</loc><lastmod>${lastmod(hub)}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`);
if (fs.existsSync(path.join(ROOT, 'glossary.html')))
  lines.push(`  <url><loc>${BASE}/glossary.html</loc><lastmod>${lastmod('glossary.html')}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>`);
if (fs.existsSync(path.join(ROOT, 'distance-chart.html')))
  lines.push(`  <url><loc>${BASE}/distance-chart.html</loc><lastmod>${lastmod('distance-chart.html')}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>`);
if (fs.existsSync(path.join(ROOT, 'my-bag.html')))
  lines.push(`  <url><loc>${BASE}/my-bag.html</loc><lastmod>${lastmod('my-bag.html')}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`);
if (fs.existsSync(path.join(ROOT, 'yardage-card.html')))
  lines.push(`  <url><loc>${BASE}/yardage-card.html</loc><lastmod>${lastmod('yardage-card.html')}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>`);
if (fs.existsSync(path.join(ROOT, 'launch-monitors.html')))
  lines.push(`  <url><loc>${BASE}/launch-monitors.html</loc><lastmod>${lastmod('launch-monitors.html')}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`);
if (fs.existsSync(path.join(ROOT, 'privacy-policy.html')))
  lines.push(`  <url><loc>${BASE}/privacy-policy.html</loc><lastmod>${lastmod('privacy-policy.html')}</lastmod><changefreq>yearly</changefreq><priority>0.3</priority></url>`);

// Product catalogue — regenerated nightly with tonight's verified offer, so
// lastmod is honestly "today" the same way /deals is.
if (fs.existsSync(path.join(ROOT, 'products'))) {
  lines.push(`  <url><loc>${BASE}/products/</loc><lastmod>${date}</lastmod><changefreq>daily</changefreq><priority>0.7</priority></url>`);
  for (const f of fs.readdirSync(path.join(ROOT, 'products')).filter(f => f.endsWith('.html') && f !== 'index.html').sort())
    lines.push(`  <url><loc>${BASE}/products/${f}</loc><lastmod>${date}</lastmod><changefreq>daily</changefreq><priority>0.6</priority></url>`);
}

// Deals Desk + department ledgers (audit P1-1: these were missing entirely)
if (fs.existsSync(path.join(ROOT, 'deals.html')))
  lines.push(`  <url><loc>${BASE}/deals.html</loc><lastmod>${date}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`);
if (fs.existsSync(path.join(ROOT, 'deals')))
  for (const f of fs.readdirSync(path.join(ROOT, 'deals')).filter(f => f.endsWith('.html')).sort())
    lines.push(`  <url><loc>${BASE}/deals/${f}</loc><lastmod>${date}</lastmod><changefreq>daily</changefreq><priority>0.7</priority></url>`);

for (const f of fs.readdirSync(path.join(ROOT, 'posts')).filter(f => f.endsWith('.html')).sort())
  lines.push(`  <url><loc>${BASE}/posts/${f}</loc><lastmod>${lastmod(`posts/${f}`)}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>`);

if (fs.existsSync(path.join(ROOT, 'memo.html')))
  lines.push(`  <url><loc>${BASE}/memo.html</loc><lastmod>${lastmod('memo.html')}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>`);
if (fs.existsSync(path.join(ROOT, 'memo')))
  for (const f of fs.readdirSync(path.join(ROOT, 'memo')).filter(f => f.endsWith('.html')).sort()) {
    // Sent issues are never edited (memo contract), so lastmod = the issue date
    // in the filename — today's date would fake freshness on every regen.
    const issueDate = (f.match(/^(\d{4}-\d{2}-\d{2})\.html$/) || [])[1] || date;
    lines.push(`  <url><loc>${BASE}/memo/${f}</loc><lastmod>${issueDate}</lastmod><changefreq>yearly</changefreq><priority>0.5</priority></url>`);
  }

lines.push('</urlset>', '');
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), lines.join('\n'), 'utf8');
console.log(`sitemap.xml written: ${lines.length - 4} article URLs + homepage` + (fs.existsSync(path.join(ROOT, 'about.html')) ? ' + about' : ''));
