// The canonical product registry — the spine the ratings and product pages hang off.
// Usage: node scripts/build-product-registry.mjs
//
// WHY THIS EXISTS
// A rating is a permanent contribution from a real person. If the thing it is
// attached to is a retailer URL, then the rating dies the day the retailer
// reorganises its store, and it silently transfers to the wrong club the day a
// URL is reused. So ratings attach to a product_id that this file mints once and
// never changes, and everything volatile — URL, price, winning variant, display
// title — hangs off that instead.
//
// Codex's rule, adopted verbatim:
//   "A product is what gets rated. A variant is the configuration being bought.
//    A listing is a merchant page. An offer is a merchant selling a
//    configuration. A price is a timestamped observation of that offer."
//
// And the reason this file is paranoid about merging:
//   "A false split is repairable. A false merge contaminates deals, history and
//    ratings simultaneously."
// So every ambiguous case fails closed into a review queue rather than guessing.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const ROOT = process.cwd();
const GRID = join(ROOT, 'data', 'deals-grid.json');
const REG = join(ROOT, 'data', 'products.json');

const registry = existsSync(REG)
  ? JSON.parse(readFileSync(REG, 'utf8'))
  : { version: 1, generated_at: null, products: [], quarantine: [] };

const byId = new Map(registry.products.map(p => [p.product_id, p]));

/* IDENTITY KEY. item_group_id is the advertiser's own model-level grouping, so
   it is scoped to that advertiser and never compared across merchants. GTINs
   are variant-level and are collected for later cross-merchant matching, which
   is a separate problem and deliberately not attempted here. */
const keyOf = (retailer, groupId) => `${retailer}::${groupId}`;
const byKey = new Map();
for (const p of registry.products) {
  for (const b of p.bindings || []) byKey.set(keyOf(b.retailer, b.item_group_id), p);
}

/* Slugs are for humans and may change; they are never identity. Kept on the
   record so a rename leaves a redirectable alias behind rather than a 404. */
function slugify(s) {
  return String(s).toLowerCase()
    .replace(/[‘’'"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}

/* Display titles already start with the brand for most merchants, so naively
   prefixing it produced "sqairz-sqairz-freedom-micro". The first fix compared
   against the FULL brand slug and still produced "cobra-golf-cobra-ds-adapt-
   hybrid", because the brand is "COBRA Golf" while the title leads with plain
   "Cobra". Compare on the brand's first token instead: if the title already
   opens with it, the brand is present and no prefix is needed. These become
   permanent URLs the moment product pages ship, so this has to be right before
   first publication, not after. */
function productSlug(brand, title) {
  const t = slugify(title);
  const b = slugify(brand || '');
  if (!b || t === b || t.startsWith(b + '-')) return t;
  if (t.split('-')[0] === b.split('-')[0]) return t;
  return `${b}-${t}`;
}

const grid = JSON.parse(readFileSync(GRID, 'utf8'));
const now = new Date(grid.checked_at || Date.now()).toISOString();

let created = 0, updated = 0, skipped = 0;
const quarantine = [];

for (const item of grid.items || []) {
  const groupId = item.item_group_id;
  const retailer = item.retailer;

  /* No advertiser-scoped group id means no defensible identity yet. PlayBetter
     is the whole of this bucket today: it arrives through the price bot rather
     than CJ and carries no identifiers at all. Quarantine rather than invent an
     identity from the title — a title match here would be exactly the false
     merge the rule above warns about. */
  if (!groupId) {
    quarantine.push({
      reason: 'no_item_group_id',
      retailer, title: item.title, url: item.url,
      note: 'source provides no advertiser-scoped product id; needs an approved feed or a manual binding',
    });
    skipped++;
    continue;
  }

  const variants = (item.variants || []).map(v => ({
    gtin: v.gtin || null, mpn: v.mpn || null, feed_title: v.title,
  }));

  const key = keyOf(retailer, groupId);
  const found = byKey.get(key);

  if (found) {
    /* Existing product. Update the volatile parts, never the id or the slug.
       This is the property the rating system depends on: the same physical club
       keeps its product_id when its URL, its winning variant, or its display
       title changes underneath. */
    found.brand = item.brand || found.brand;
    found.last_seen = now;
    const binding = found.bindings.find(b => keyOf(b.retailer, b.item_group_id) === key);
    binding.url = item.url;
    binding.display_title = item.title;
    // Union of variants ever seen; a variant going out of stock must not erase it.
    const seen = new Set(binding.variants.map(v => v.gtin).filter(Boolean));
    for (const v of variants) if (v.gtin && !seen.has(v.gtin)) { binding.variants.push(v); seen.add(v.gtin); }
    updated++;
  } else {
    /* New product. UUID, not a hash of the title, URL or GTIN — all three of
       those change, and an id that changes is not an id. */
    const product = {
      product_id: `prd_${randomUUID()}`,
      canonical_name: item.title,
      brand: item.brand || null,
      slug: productSlug(item.brand, item.title),
      slug_aliases: [],
      status: 'provisional',      // promoted by hand once the generation is confirmed
      rating_scope: 'product',
      first_seen: now,
      last_seen: now,
      bindings: [{
        retailer,
        item_group_id: groupId,
        url: item.url,
        display_title: item.title,
        variants,
      }],
    };
    registry.products.push(product);
    byId.set(product.product_id, product);
    byKey.set(key, product);
    created++;
  }
}

registry.version = 1;
registry.generated_at = now;
registry.quarantine = quarantine;

/* VALIDATE BEFORE WRITING. A duplicate id or a duplicate binding would mean two
   products claiming the same physical club, which is the false merge in its
   most direct form. Refuse to write rather than persist it. */
const ids = registry.products.map(p => p.product_id);
if (new Set(ids).size !== ids.length) throw new Error('duplicate product_id in registry — refusing to write');
const keys = registry.products.flatMap(p => (p.bindings || []).map(b => keyOf(b.retailer, b.item_group_id)));
if (new Set(keys).size !== keys.length) throw new Error('two products claim the same retailer+item_group_id — refusing to write');
const slugs = registry.products.map(p => p.slug);
if (new Set(slugs).size !== slugs.length) console.warn('  WARNING: duplicate slugs present; product pages would collide');

mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(REG, JSON.stringify(registry, null, 2), 'utf8');

console.log(`products: ${registry.products.length} total  (+${created} new, ${updated} updated)`);
console.log(`quarantined this run: ${skipped}`);
const byReason = {};
for (const q of quarantine) byReason[q.reason] = (byReason[q.reason] || 0) + 1;
for (const [r, n] of Object.entries(byReason)) console.log(`  ${r}: ${n}`);
