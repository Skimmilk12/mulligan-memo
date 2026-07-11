// Renders data/deals-curated.json into deals.html between the auto markers.
// Daily rhythm: edit deals-curated.json, run `node scripts/build-deals.mjs`, deploy.
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const cur = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'deals-curated.json'), 'utf8'));
const PAGE = path.join(ROOT, 'deals.html');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = n => '$' + (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2 }));

function linkTag(d) {
  // Affiliate links are marked "(paid link)"; non-affiliate ones say so too — honesty both ways.
  const rel = d.affiliate ? 'nofollow sponsored noopener' : 'nofollow noopener';
  const tag = d.affiliate ? 'paid link' : 'no commission on this one';
  return `<a class="dd-buy" href="${esc(d.url)}" rel="${rel}" target="_blank">GET THE DEAL →</a><span class="dd-linktag">${tag}</span>`;
}

function dealRow(d) {
  return `      <div class="dd-row">
        <div class="dd-row-top">
          <span class="dd-chip">${esc(d.category)}</span>
          <span class="dd-retailer">${esc(d.retailer)}</span>
        </div>
        <h3 class="dd-item">${esc(d.title)}</h3>
        <p class="dd-verdict">“${esc(d.verdict)}”</p>
        <div class="dd-row-price">
          <span class="dd-was">${money(d.compare_at)}</span>
          <span class="dd-now">${money(d.price)}</span>
          <span class="dd-pct">${d.pct_off}% OFF</span>
          ${linkTag(d)}
        </div>
      </div>`;
}

const all = [cur.deal_of_the_day, ...cur.deals];
const topCuts = [...all].sort((a, b) => b.pct_off - a.pct_off).slice(0, 3);
const dod = cur.deal_of_the_day;

const html = `
    <p class="dd-stamp">Prices checked <strong>${esc(cur.checked_label)}</strong> · verified against the retailer's own listed prices · subject to change after posting</p>

    <section class="dd-hero" aria-label="Deal of the day">
      <div class="dd-seal">DEAL<br>OF THE<br>DAY</div>
      <div class="dd-hero-body">
        <div class="dd-row-top"><span class="dd-chip">${esc(dod.category)}</span><span class="dd-retailer">${esc(dod.retailer)}</span></div>
        <h3 class="dd-item">${esc(dod.title)}</h3>
        <p class="dd-verdict">“${esc(dod.verdict)}”</p>
        <div class="dd-row-price">
          <span class="dd-was">${money(dod.compare_at)}</span>
          <span class="dd-now">${money(dod.price)}</span>
          <span class="dd-pct">${dod.pct_off}% OFF</span>
          ${linkTag(dod)}
        </div>
      </div>
    </section>

    <h2><span class="kick">The Ledger</span>Today's verified deals</h2>
    <div class="dd-ledger">
${cur.deals.map(dealRow).join('\n')}
    </div>

    <section class="dd-cuts" aria-label="Biggest cuts">
      <p class="dd-cuts-label">THE BIGGEST CUTS ON THE DESK</p>
      <div class="dd-cuts-grid">
${topCuts.map(d => `        <div class="dd-cut"><span class="dd-cut-pct">${d.pct_off}%</span><span class="dd-cut-name">${esc(d.title)}</span></div>`).join('\n')}
      </div>
    </section>

    <h2><span class="kick">Kill List</span>Left on the cutting-room floor</h2>
    <p>Every morning the bot surfaces the loudest “discounts” on the internet. The loudest ones are usually lying. Today's rejects:</p>
    <ul class="dd-floor">
${cur.cutting_room_floor.map(f => `      <li><strong>${esc(f.claim)}</strong> — ${esc(f.reason)}</li>`).join('\n')}
    </ul>
`;

let page = fs.readFileSync(PAGE, 'utf8');
const re = /(<!-- deals:auto:start -->)[\s\S]*?(<!-- deals:auto:end -->)/;
if (!re.test(page)) { console.error('markers not found in deals.html'); process.exit(1); }
// Replacer FUNCTION, not a string: dollar amounts in deal copy ("$1,099")
// would otherwise be eaten as $1/$2 capture-group references.
page = page.replace(re, (_m, start, end) => `${start}${html}    ${end}`);
fs.writeFileSync(PAGE, page);
console.log(`deals.html rebuilt: 1 deal of the day + ${cur.deals.length} ledger rows + ${cur.cutting_room_floor.length} kill-list items (checked ${cur.checked_label})`);
