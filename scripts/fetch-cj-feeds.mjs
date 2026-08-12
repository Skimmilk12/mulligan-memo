// Pull the daily CJ Product Export files and store a compact price snapshot.
// Usage: node scripts/fetch-cj-feeds.mjs [YYYY-MM-DD]
//
// WHY THIS EXISTS, AND WHAT IT DELIBERATELY DOES NOT DO
//
// TGW's feed publishes PRICE for all 35,699 rows and SALE_PRICE for exactly
// zero of them. No promotion ids, no custom labels. So there is no "was" number
// anywhere in the file, and the deals board — whose entire premise is a
// verified discount — cannot be fed from it directly. A card reading "golf club,
// $90" is not a deal.
//
// The honest route is to derive the "was" ourselves by diffing consecutive
// days, which is what the price bot already does for PlayBetter. That is also
// better evidence than a merchant-supplied compare-at price, which is the exact
// fake-anchor problem the kill list was built for.
//
// This script therefore only ACCUMULATES. It writes id->price snapshots and
// touches nothing that publishes. Wiring drops into the board is a separate
// decision, and needs at least two snapshots to be possible at all.
//
// The URL shape was recovered by resolving the delivery mail's tracking
// redirect; it is constructible from the date, so this needs no email:
//   https://datatransfer.cj.com/datatransfer/files/{CID}/outgoing/productcatalog/{subId}/{Name}-shopping-{YYYYMMDD}.zip
// Directory listing is disabled (404), so the filename must be built, not found.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const ROOT = process.cwd();
const SECRETS = process.env.MM_CJ_FEED_SECRETS_PATH || 'C:\\Users\\kinsm\\.secrets\\cj-feed.env';
const OUTDIR = join(ROOT, 'data', 'feeds');
const KEEP_DAYS = 25;

/* Below about $100 this is accessories and consumables — TGW's median row is
   $90 — and carrying all 15k in-stock items costs 340 KB a day in the repo for
   inventory the board would never show. $100 still feeds the "under $250"
   band. */
const PRICE_FLOOR = 100;

const SUBSCRIPTIONS = [
  { id: '320166', slug: 'tgw',        name: 'TGW_Daily_Product_Feed' },
  /* 320167 exists but has never delivered — no "export is ready" mail, and the
     constructed URL 404s. It comes back the day it starts producing files. */
  { id: '320167', slug: 'puma-cobra', name: 'Puma_Cobra_Daily_Product_Feed', optional: true },
];

/* Environment first, local file second — same order as build-deals-grid.mjs.
   CI has no .secrets directory, so without the env path this could only ever
   run on Robert's machine and the nightly snapshot would never accumulate. */
function creds() {
  let user = process.env.CJ_FEED_USER?.trim();
  let pass = process.env.CJ_FEED_PASS?.trim();
  if (!user || !pass) {
    let raw = '';
    try { raw = readFileSync(SECRETS, 'utf8'); } catch { /* no local secrets file */ }
    const get = k => (new RegExp('^' + k + '=(.*)$', 'm').exec(raw) || [])[1]?.trim() || '';
    user ||= get('CJ_FEED_USER');
    pass ||= get('CJ_FEED_PASS');
  }
  return user && pass ? { user, pass } : null;
}

const money = s => { const n = parseFloat(String(s).split(' ')[0]); return Number.isFinite(n) ? n : null; };

async function fetchSnapshot(sub, day, c) {
  const stamp = day.replace(/-/g, '');
  /* CJ's own redirect points at http://. Force https so the basic-auth
     credentials are never sent in cleartext. */
  const url = `https://datatransfer.cj.com/datatransfer/files/${c.user}/outgoing/productcatalog/${sub.id}/${sub.name}-shopping-${stamp}.zip`;
  const auth = 'Basic ' + Buffer.from(`${c.user}:${c.pass}`).toString('base64');
  const res = await fetch(url, { headers: { Authorization: auth } });
  if (res.status === 404) return { missing: true };
  if (!res.ok) throw new Error(`${sub.slug}: HTTP ${res.status}`);

  const zip = Buffer.from(await res.arrayBuffer());
  const text = unzipSingle(zip);

  /* CJ ships a stub zip containing no_updates.txt when a catalogue has not
     changed since the last export. That is a normal outcome, not a failure —
     Puma/Cobra returned one the first day it started delivering, and its
     catalogue has been stale since March. Treat it as "nothing today" so it
     does not surface as a parse error every night. */
  if (/^\s*No updated Product Catalogs found/i.test(text)) return { noUpdates: true };

  const records = parseCsv(text);
  const head = records[0];
  const iId = head.indexOf('ID'), iPrice = head.indexOf('PRICE'), iAvail = head.indexOf('AVAILABILITY');
  if (iId < 0 || iPrice < 0 || iAvail < 0) throw new Error(`${sub.slug}: expected columns missing from header`);
  const prices = {};
  let inStock = 0;
  for (let i = 1; i < records.length; i++) {
    const f = records[i];
    if (f[iAvail] !== 'in stock') continue;
    inStock++;
    const p = money(f[iPrice]);
    if (p !== null && p >= PRICE_FLOOR) prices[f[iId]] = p;
  }

  return { prices, inStock, rows: records.length - 1, bytes: zip.length };
}

/* Node has no zip reader in core. The first version shelled out to PowerShell's
   Expand-Archive, which does not exist on the ubuntu runner — so the nightly job
   would have failed the moment it ran in CI. Read the archive in-process
   instead: no temp files, no platform branch, nothing to clean up on crash.
   Sizes come from the central directory rather than the local header, because
   the local header carries zeroes whenever the streaming-descriptor flag is set. */
function unzipSingle(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip (no end-of-central-directory record)');
  const cd = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error('bad central directory signature');

  const method = buf.readUInt16LE(cd + 10);
  const compSize = buf.readUInt32LE(cd + 20);
  const nameLen = buf.readUInt16LE(cd + 28);
  const lho = buf.readUInt32LE(cd + 42);
  const name = buf.toString('utf8', cd + 46, cd + 46 + nameLen);

  if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error('bad local header signature');
  const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const data = buf.subarray(start, start + compSize);

  if (method === 0) return data.toString('utf8');            // stored
  if (method === 8) return inflateRawSync(data, { maxOutputLength: 512 * 1024 * 1024 }).toString('utf8');
  throw new Error(`unsupported zip compression method ${method} for ${name}`);
}

/* RFC4180 over the WHOLE file, not line by line. These feeds quote product
   descriptions, and those quoted fields contain literal newlines — splitting on
   \n first shreds records and silently yields zero in-stock rows, which is
   exactly what the first version of this did. */
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); cur = ''; rows.push(row); row = []; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const c = creds();
if (!c) { console.log('no CJ feed credentials — nothing to do'); process.exit(0); }
mkdirSync(OUTDIR, { recursive: true });
const day = process.argv[2] || new Date().toLocaleDateString('en-CA');

for (const sub of SUBSCRIPTIONS) {
  try {
    const r = await fetchSnapshot(sub, day, c);
    if (r.missing) { console.log(`  ${sub.slug}: no file for ${day} — CJ has not delivered it yet today, or it has already rotated away`); continue; }
    if (r.noUpdates) { console.log(`  ${sub.slug}: CJ reports no catalogue changes for ${day}`); continue; }
    const file = join(OUTDIR, `${sub.slug}-${day}.json`);
    writeFileSync(file, JSON.stringify({ date: day, subscription: sub.id, floor: PRICE_FLOOR, in_stock: r.inStock, tracked: Object.keys(r.prices).length, prices: r.prices }), 'utf8');
    console.log(`  ${sub.slug}: ${r.rows.toLocaleString()} rows, ${r.inStock.toLocaleString()} in stock, ${Object.keys(r.prices).length.toLocaleString()} tracked >= $${PRICE_FLOOR}`);
  } catch (e) {
    console.error(`  ${sub.slug}: ${e.message}`);
  }
}

// Keep the window bounded, same as the price logs.
for (const slug of SUBSCRIPTIONS.map(s => s.slug)) {
  const files = readdirSync(OUTDIR).filter(f => f.startsWith(slug + '-') && f.endsWith('.json')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP_DAYS))) unlinkSync(join(OUTDIR, f));
}
