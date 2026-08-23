// Safe read/write for data/amazon-asins.csv.
//
// WHY THIS FILE EXISTS: on 2026-08-22 a one-off script opened the CSV for
// writing, then crashed on a row whose note contained an unquoted comma, and
// left 27 lines where Cowork had just appended 80. The batch was lost. Two
// rules now, enforced here and nowhere else:
//   1. Tolerate overflow fields on read — anything past the 6th column is
//      folded back into `note`, never treated as an error.
//   2. Write to a temp file and rename. The real file is never open for
//      writing while anything can still fail.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

export const COLS = ['search_term', 'asin', 'amazon_title', 'price_seen', 'checked_on', 'note'];

export function parseCsv(text) {
  const out = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); out.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out.filter(r => r.some(c => c.trim()));
}

export function readAsins(path) {
  const rows = parseCsv(readFileSync(path, 'utf8'));
  const head = rows[0].map(s => s.trim().toLowerCase());
  const idx = Object.fromEntries(COLS.map(c => [c, head.indexOf(c)]));
  return rows.slice(1).map(r => {
    const o = {};
    for (const c of COLS) o[c] = idx[c] >= 0 ? (r[idx[c]] || '').trim() : '';
    // Overflow: an unquoted comma in note splits it across extra columns. Fold back.
    if (r.length > head.length) o.note = [o.note, ...r.slice(head.length)].filter(Boolean).join(', ').trim();
    return o;
  });
}

const cell = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function writeAsins(path, rows) {
  const text = [COLS.join(','), ...rows.map(r => COLS.map(c => cell(r[c])).join(','))].join('\n') + '\n';
  const tmp = path + '.tmp';
  writeFileSync(tmp, text, 'utf8');   // fully written before the real file is touched
  renameSync(tmp, path);
}
