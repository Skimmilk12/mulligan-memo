// THE GATE. Codex: "Do not build the rating widget until that product remains
// the same product when its URL, winning variant, or display title changes."
//
// A rating is permanent and cannot be un-orphaned, so this is not a style check.
// It simulates each of those three changes against the real registry and fails
// if any product_id moves.
// Usage: node scripts/test-product-identity.mjs
import { readFileSync, writeFileSync, copyFileSync, unlinkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const GRID = join(ROOT, 'data', 'deals-grid.json');
const REG = join(ROOT, 'data', 'products.json');
const GRID_BAK = GRID + '.identitytest', REG_BAK = REG + '.identitytest';

copyFileSync(GRID, GRID_BAK);
copyFileSync(REG, REG_BAK);
const rebuild = () => execFileSync(process.execPath, ['scripts/build-product-registry.mjs'], { cwd: ROOT, stdio: 'ignore' });
const ids = () => {
  const r = JSON.parse(readFileSync(REG, 'utf8'));
  // key products by their identity binding, so we can tell if the ID moved
  return new Map(r.products.flatMap(p => (p.bindings || []).map(b => [`${b.retailer}::${b.item_group_id}`, p.product_id])));
};

let failures = 0;
const check = (label, before, after) => {
  const moved = [...before].filter(([k, v]) => after.has(k) && after.get(k) !== v);
  const lost = [...before].filter(([k]) => !after.has(k));
  const ok = moved.length === 0 && lost.length === 0;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (moved.length) console.log(`        ${moved.length} product_id(s) CHANGED — ratings would be orphaned`);
  if (lost.length) console.log(`        ${lost.length} product(s) disappeared from the registry`);
};

const baseline = ids();
console.log(`baseline: ${baseline.size} identified products\n`);

function mutateGrid(fn) {
  const g = JSON.parse(readFileSync(GRID_BAK, 'utf8'));
  g.items = (g.items || []).map(fn);
  writeFileSync(GRID, JSON.stringify(g), 'utf8');
  rebuild();
  return ids();
}

// 1. The retailer reorganises its store and every URL changes.
check('URL changes on every product',
  baseline,
  mutateGrid(it => ({ ...it, url: String(it.url).replace('/products/', '/shop/p/') + '?v=2' })));

// 2. A different variant wins tonight's discount, so the display title changes.
check('display title changes (a different variant wins)',
  baseline,
  mutateGrid(it => ({ ...it, title: `${it.title} — Left Hand 2026 Edition` })));

// 3. Variants come and go as stock moves.
check('variant set changes (stock moves)',
  baseline,
  mutateGrid(it => ({ ...it, variants: (it.variants || []).slice(0, 1) })));

// 4. All three at once, which is what a real month looks like.
check('all three at once',
  baseline,
  mutateGrid(it => ({
    ...it,
    url: String(it.url).replace('/products/', '/p/') + '?ref=x',
    title: `${it.brand || ''} ${it.title} (2027)`.trim(),
    variants: (it.variants || []).slice(0, 1),
  })));

// 5. Control: a genuinely different product must NOT collide with an existing id.
const g = JSON.parse(readFileSync(GRID_BAK, 'utf8'));
const first = (g.items || []).find(i => i.item_group_id);
g.items = [...g.items, { ...first, item_group_id: '999999999999', title: 'Totally Different Club', url: 'https://example.com/x' }];
writeFileSync(GRID, JSON.stringify(g), 'utf8');
rebuild();
const withNew = ids();
const grew = withNew.size === baseline.size + 1;
if (!grew) failures++;
console.log(`  ${grew ? 'PASS' : 'FAIL'}  a new item_group_id creates a NEW product (${baseline.size} -> ${withNew.size})`);

// restore
copyFileSync(GRID_BAK, GRID);
copyFileSync(REG_BAK, REG);
unlinkSync(GRID_BAK); unlinkSync(REG_BAK);

console.log(failures
  ? `\n  ${failures} FAILURE(S) — identity is not stable, do not collect ratings yet`
  : `\n  ALL PASS — product_id survives URL, title and variant churn. Ratings can attach safely.`);
process.exit(failures ? 1 : 0);
