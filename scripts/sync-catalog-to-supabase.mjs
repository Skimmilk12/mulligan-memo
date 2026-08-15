// Mirror the repo product registry into Supabase catalog_products.
// Usage: SUPABASE_SERVICE_ROLE_KEY=... node scripts/sync-catalog-to-supabase.mjs
//
// Only immutable identity crosses: product_id, canonical_name, slug, status.
// The repo registry stays the source of truth; Supabase holds this mirror so a
// rating can foreign-key to a REAL product and nobody can rate an invented one.
//
// Uses the service_role key because catalog_products has RLS on and no write
// policy — by design, the public API cannot create products. That key exists
// only as a GitHub secret / in Robert's password manager. It is never in the
// repo and never in a page.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const cfg = JSON.parse(readFileSync(join(ROOT, 'data', 'ratings-config.json'), 'utf8'));
const registry = JSON.parse(readFileSync(join(ROOT, 'data', 'products.json'), 'utf8'));
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!key) { console.log('no SUPABASE_SERVICE_ROLE_KEY — catalog sync skipped'); process.exit(0); }

const rows = registry.products.map(p => ({
  product_id: p.product_id,
  canonical_name: p.canonical_name,
  slug: p.slug,
  status: p.status || 'provisional',
}));

const res = await fetch(`${cfg.supabase_url}/rest/v1/catalog_products?on_conflict=product_id`, {
  method: 'POST',
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  },
  body: JSON.stringify(rows),
});
if (!res.ok) {
  console.error(`catalog sync failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
console.log(`catalog synced: ${rows.length} products upserted`);
