// Builds/refreshes the /deals/ category hub pages from data/deals-latest.json,
// and renders the departments grid on deals.html.
// - First run writes each hub shell if the file doesn't exist yet.
// - Every run refreshes ONLY the content between the auto markers (hand edits
//   to shell copy survive). Runs nightly in the price-bot Action.
// Usage: node scripts/build-deal-hubs.mjs
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const latest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'deals-latest.json'), 'utf8'));
const killlist = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'deals-killlist.json'), 'utf8')).killed;
const killedUrls = new Set(killlist.map(k => k.url));
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = n => '$' + (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2 }));

const HUBS = [
  {
    slug: 'launch-monitor-deals',
    nav: 'Launch Monitors',
    title: 'Launch Monitor Deals: Verified Price Cuts, Updated Daily',
    h1: 'Launch Monitor Deals',
    dek: 'Every launch monitor genuinely on sale right now — verified against the retailer’s own listed prices by our nightly bot, biggest cuts first.',
    match: c => /launch monitor/i.test(c.type + ' ' + c.title),
    intro: `<p class="lead-p">Launch monitors almost never go on sale the honest way. What actually happens: certified pre-owned units appear when a retailer restocks trade-ins, last year's model drops when a successor ships, and software bundles get discounted to move hardware. Those are the three shapes of a real launch monitor deal — and they're exactly what our bot watches for every night across the retailers that publish their prices openly.</p>
<p>If you're still deciding whether you need one at all, start with our honest take: <a class="inline" href="/posts/do-you-need-a-golf-launch-monitor.html">do you actually need a launch monitor?</a> And if your budget has a comma in it, read <a class="inline" href="/posts/best-golf-launch-monitor-under-500.html">the best launch monitors under $500</a> before you pay full freight for features you won't use.</p>`,
    related: [
      ['/posts/do-you-need-a-golf-launch-monitor.html', 'Do You Need a Golf Launch Monitor?'],
      ['/posts/best-golf-launch-monitor-under-500.html', 'Best Golf Launch Monitors Under $500'],
    ],
  },
  {
    slug: 'golf-simulator-deals',
    nav: 'Simulators',
    title: 'Golf Simulator Deals: Screens, Projectors & Packages on Sale',
    h1: 'Golf Simulator Deals',
    dek: 'Simulator packages, impact screens, projectors and enclosures genuinely on sale — verified nightly against retailer-listed prices.',
    match: c => /simulat|projector|impact screen|enclosure|studio/i.test(c.type + ' ' + c.title),
    intro: `<p class="lead-p">A home simulator is really four purchases wearing a trench coat: the launch monitor, the screen and enclosure, the projector, and the software. The good news is they rarely go on sale at the same time — which means a patient builder can assemble a bay one verified deal at a time. Screens are the sneaky one: they're consumables that wear out with use, so a genuine half-price clearance screen is worth buying <em>before</em> yours dies.</p>
<p>One caution that repeats across this department: clearance screens and enclosures come in odd sizes. Measure your space twice before the BUY click — a screen that doesn't fit your frame is not a deal at any percentage.</p>`,
    related: [
      ['/posts/do-you-need-a-golf-launch-monitor.html', 'Do You Need a Golf Launch Monitor?'],
      ['/deals/launch-monitor-deals.html', 'Launch Monitor Deals'],
    ],
  },
  {
    slug: 'golf-practice-deals',
    nav: 'Practice Gear',
    title: 'Golf Practice Gear Deals: Mats, Nets & Putting Greens on Sale',
    h1: 'Practice Gear Deals',
    dek: 'Hitting mats, nets, and putting greens genuinely on sale — the backyard-and-garage aisle, verified nightly.',
    match: c => /putting green|golf mat|hitting mat|practice mat|\bmat\b|chipping net|practice net/i.test(c.type + ' ' + c.title),
    intro: `<p class="lead-p">Practice gear is where "was" prices get the most creative, because nobody knows what a hitting mat is supposed to cost. Here's our rule: a mat, net, or putting green is on sale only when the retailer's own listed compare-at price says so — and even then, the question is whether the regular price was honest to begin with. The bot checks the first part nightly; our guides below handle the second.</p>
<p>Before you buy anything in this aisle, it's worth ten minutes with <a class="inline" href="/posts/best-putting-mat-for-home.html">our home putting mat guide</a> or <a class="inline" href="/posts/best-golf-chipping-nets.html">the chipping net rankings</a> — the difference between the good gear and the regrettable gear in this category is rarely visible in the product photo.</p>`,
    related: [
      ['/posts/best-putting-mat-for-home.html', 'Best Putting Mats for Home'],
      ['/posts/best-golf-chipping-nets.html', 'Best Golf Chipping Nets'],
      ['/posts/best-golf-training-aids.html', 'Golf Training Aids That Actually Help'],
    ],
  },
  {
    slug: 'golf-rangefinder-gps-deals',
    nav: 'Rangefinders & GPS',
    title: 'Golf Rangefinder & GPS Deals: Verified Price Cuts',
    h1: 'Rangefinder & GPS Deals',
    dek: 'Laser rangefinders, GPS watches and handhelds genuinely on sale — verified nightly against retailer-listed prices.',
    match: c => /rangefinder|gps/i.test(c.type + ' ' + c.title),
    intro: `<p class="lead-p">Rangefinders and GPS units are the most giftable gear in golf, which means their prices swing hard around holidays — and the anchors get stretchy. The units below are on sale by the retailer's own listed numbers, checked overnight, biggest honest cuts first.</p>
<p>If you're not sure which side of the laser-versus-GPS fence you sit on, <a class="inline" href="/posts/best-golf-rangefinder-vs-gps.html">our rangefinder vs. GPS breakdown</a> settles it in five minutes. Budget shoppers should also see <a class="inline" href="/posts/best-golf-rangefinder-under-100.html">the best rangefinders under $100</a> — that guide exists precisely because this category overcharges by default.</p>`,
    related: [
      ['/posts/best-golf-rangefinder-vs-gps.html', 'Rangefinder vs. GPS: Which Do You Need?'],
      ['/posts/best-golf-rangefinder-under-100.html', 'Best Golf Rangefinders Under $100'],
      ['/posts/best-golf-gps-watch-under-200.html', 'Best Golf GPS Watches Under $200'],
    ],
  },
];

const COMING_SOON = ['Golf Balls', 'Apparel', 'Golf Shoes', 'Push Carts'];
const MAX_ROWS = 10;

function shell(hub) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="max-image-preview:large">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="canonical" href="https://mulliganmemo.com/deals/${hub.slug}.html" />
  <meta name="p:domain_verify" content="07e415f0e59eb6cc59d578a5b8f4648a" />
  <title>${esc(hub.title)} — Mulligan Memo</title>
  <meta name="description" content="${esc(hub.dek)}" />

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,900&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400;1,6..72,500&family=Courier+Prime:wght@400;700&display=swap" rel="stylesheet">

  <link rel="stylesheet" href="/styles/article.css" />
  <link rel="stylesheet" href="/styles/deals.css" />

  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Mulligan Memo" />
  <meta property="og:title" content="${esc(hub.title)}" />
  <meta property="og:description" content="${esc(hub.dek)}" />
  <meta property="og:url" content="https://mulliganmemo.com/deals/${hub.slug}.html" />
  <meta property="og:image" content="https://mulliganmemo.com/og-cover.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="https://mulliganmemo.com/og-cover.png" />

  <script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "name": ${JSON.stringify(hub.title)},
  "description": ${JSON.stringify(hub.dek)},
  "url": "https://mulliganmemo.com/deals/${hub.slug}.html",
  "isPartOf": { "@type": "WebSite", "name": "Mulligan Memo", "url": "https://mulliganmemo.com/" },
  "breadcrumb": { "@type": "BreadcrumbList", "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://mulliganmemo.com/" },
    { "@type": "ListItem", "position": 2, "name": "The Deals Desk", "item": "https://mulliganmemo.com/deals.html" },
    { "@type": "ListItem", "position": 3, "name": ${JSON.stringify(hub.h1)} }
  ] }
}
  </script>

  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-8VD95MJ4D9"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-8VD95MJ4D9');
  </script>
</head>

<body>

  <div class="mm-topbar">
    <span>✶ THE GEAR DESK</span>
    <a class="mm-brand" href="/">Mulligan Memo</a>
    <span id="mm-date">EST. 2026</span>
  </div>
  <nav class="mm-nav" aria-label="Primary">
    <div class="mm-nav-in">
      <a href="/beginners.html">BEGINNERS</a>
      <a href="/clubs.html">CLUBS</a>
      <a href="/tech.html">TECH</a>
      <a href="/accessories.html">ACCESSORIES</a>
      <a href="/golf-balls.html">BALLS</a>
      <a href="/deals.html" class="active">DEALS</a>
      <a href="/glossary.html">GLOSSARY</a>
      <a href="/distance-chart.html">DISTANCES</a>
      <a href="/author.html">THE DESK</a>
      <a href="/about.html">ABOUT</a>
      <form class="mm-search" role="search" onsubmit="return false;">
        <label for="archive-search">⌕</label>
        <input id="archive-search" type="search" placeholder="SEARCH THE ARCHIVE…" autocomplete="off">
        <div class="mm-search-results" id="archive-results"></div>
      </form>
    </div>
  </nav>

  <article class="wrap">

    <header class="ahead">
      <div class="crumb"><a href="/deals.html" style="color:inherit;text-decoration:none;">The Deals Desk</a> · ${esc(hub.nav)} Department</div>
      <h1 class="title">${esc(hub.h1)}</h1>
      <p class="dek">${esc(hub.dek)}</p>
    </header>

    <div class="copy">

    <div class="dd-disclosure">READER-SUPPORTED: some links on Mulligan Memo earn us a commission — every one of those is marked "paid link" right next to the button. Deals below are listed on merit; most currently earn us nothing.</div>

${hub.intro}

    <!-- hub:auto:start -->
    <!-- hub:auto:end -->

    <div class="dd-how">
      <p><strong>How this ledger works.</strong> A bot checks these retailers' listed prices every night; every "was" price is the retailer's own compare-at figure, never one we invented. This department page lists everything that clears our discount bar, biggest cuts first — the hand-picked best of the whole desk each morning live on <a class="inline" href="/deals.html">the Deals Desk front page</a>. Prices move; the timestamp above is when we last checked.</p>
    </div>

    <h2><span class="kick">Go Deeper</span>Before you buy</h2>
    <ul>
${hub.related.map(([href, label]) => `      <li><a class="inline" href="${href}">${esc(label)}</a></li>`).join('\n')}
    </ul>

    </div>
  </article>

  <footer class="mm-footer">
  <div class="mm-foot-in">
    <div class="mm-foot-brand">
      <a class="mm-brand" href="/">Mulligan Memo</a>
      <p class="mm-foot-tag">The Independent Golf Gear Desk · Est. 2026</p>
    </div>
    <div class="mm-foot-rule"></div>
    <div class="mm-foot-grid">
      <div>
        <h4>Guides</h4>
        <ul>
          <li><a href="/beginners.html">Beginners</a></li>
          <li><a href="/clubs.html">Golf Clubs</a></li>
          <li><a href="/tech.html">Golf Tech</a></li>
          <li><a href="/accessories.html">Accessories</a></li>
          <li><a href="/golf-balls.html">Golf Balls</a></li>
        </ul>
      </div>
      <div>
        <h4>Reference</h4>
        <ul>
          <li><a href="/deals.html">The Deals Desk</a></li>
          <li><a href="/distance-chart.html">Club Distance Chart</a></li>
          <li><a href="/glossary.html">Golf Glossary</a></li>
          <li><a href="/about.html">How We Pick</a></li>
          <li><a href="/privacy-policy.html">Privacy &amp; Disclosure</a></li>
        </ul>
      </div>
      <div>
        <h4>The Desk</h4>
        <ul>
          <li><a href="/author.html#beginners-desk">Beginners &amp; Balls Desk</a></li>
          <li><a href="/author.html#clubs-desk">Clubs Desk</a></li>
          <li><a href="/author.html#tech-desk">Tech Desk</a></li>
          <li><a href="/author.html#practice-desk">Practice Desk</a></li>
          <li><a href="/author.html#accessories-desk">Accessories Desk</a></li>
        </ul>
      </div>
      <div>
        <h4>Follow</h4>
        <ul>
          <li><a href="/#sunday-memo">The Sunday Memo</a></li>
          <li><a href="/memo.html">Memo Archive</a></li>
          <li><a href="/feed.xml">RSS Feed</a></li>
          <li><a href="https://www.pinterest.com/mulliganmemo/" rel="noopener">Pinterest</a></li>
          <li><a href="/about.html">About the Memo</a></li>
        </ul>
      </div>
    </div>
    <div class="mm-foot-badges">
      <span class="badge">Independent</span>
      <span class="badge">Reader-Supported</span>
      <span class="badge">Never Sponsored</span>
    </div>
    <p class="fdisc">When you buy through links on the Memo we may earn a small commission — it never changes the pick. As an Amazon Associate, we earn from qualifying purchases.</p>
    <div class="mm-foot-bottom">
      <span>© 2026 Mulligan Memo · The Research Desk</span>
      <span>Set in Fraunces &amp; Newsreader · Printed on Parchment №2</span>
    </div>
  </div>
</footer>

  <script src="/search.js" defer></script>
  <script>
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a.dd-buy');
      if (!a || typeof gtag !== 'function') return;
      var row = a.closest('.dd-row, .dd-hero');
      var item = row && row.querySelector('.dd-item');
      gtag('event', 'deal_click', {
        item_name: item ? item.textContent.trim() : a.href,
        page_path: location.pathname
      });
    });
  </script>
</body>
</html>
`;
}

function rowHtml(c) {
  return `      <div class="dd-row">
        <div class="dd-row-top">
          <span class="dd-chip">${esc(c.vendor || c.type || 'Gear')}</span>
          <span class="dd-retailer">${esc(c.retailer)}</span>
        </div>
        <h3 class="dd-item">${esc(c.title)}</h3>
        <div class="dd-row-price">
          <span class="dd-was">${money(c.compare_at)}</span>
          <span class="dd-now">${money(c.price)}</span>
          <span class="dd-pct">${c.pct_off}% OFF</span>
          <a class="dd-buy" href="${esc(c.url)}" rel="nofollow noopener" target="_blank">GET THE DEAL →</a>
        </div>
      </div>`;
}

function guardAndInject(file, marker, html) {
  if (html.includes(`${marker}:start`) || html.includes(`${marker}:end`)) throw new Error('generated html contains marker text');
  for (const m of html.matchAll(/class="dd-(?:was|now)">([^<]*)</g)) {
    if (!/^\$[\d,]+(\.\d{2})?$/.test(m[1])) throw new Error(`malformed price "${m[1]}" for ${file}`);
  }
  let page = fs.readFileSync(file, 'utf8');
  const starts = page.split(`<!-- ${marker}:start -->`).length - 1;
  const ends = page.split(`<!-- ${marker}:end -->`).length - 1;
  if (starts !== 1 || ends !== 1) throw new Error(`${file}: ${starts}/${ends} ${marker} markers, need exactly 1 each`);
  const re = new RegExp(`(<!-- ${marker}:start -->)[\\s\\S]*?(<!-- ${marker}:end -->)`);
  page = page.replace(re, (_m, s, e) => `${s}\n${html}\n    ${e}`);
  fs.writeFileSync(file, page);
}

// ---- assign candidates to hubs (first match wins); kill list excluded HARD ----
// NOT_GOLF_GEAR: audit P0-5 feed-pollution fix — fitness watches, powersports
// navigators, control boxes and software-only upgrades matched the loose
// category regexes (they contain "gps"/"simulat") but are not golf gear deals.
const NOT_GOLF_GEAR = /\b(polar|tread|powersport|smartwatch|fitness watch|instinct|fenix|venu|forerunner|vivoactive|control box|controller box|software upgrade|license upgrade|subscription)\b/i;
// Variant dedupe: near-identical listings (e.g. nine Big Moss size/color
// variants) collapse to the best-discount one per normalized model key.
const modelKey = (c) => c.title.toLowerCase().replace(/\b(\d+['"x×w]?\s*){1,3}$/,'').replace(/[^a-z0-9 ]/g,'').split(/\s+/).slice(0, 4).join(' ');
const buckets = new Map(HUBS.map(h => [h.slug, []]));
const killedByHub = new Map(HUBS.map(h => [h.slug, []]));
let polluted = 0;
for (const c of latest.candidates) {
  if (!c.available) continue;
  if (NOT_GOLF_GEAR.test(c.title + ' ' + c.type)) { polluted++; continue; }
  for (const h of HUBS) {
    if (h.match(c)) {
      if (killedUrls.has(c.url)) killedByHub.get(h.slug).push(c);
      else buckets.get(h.slug).push(c);
      break;
    }
  }
}
if (polluted) console.log(`excluded ${polluted} non-golf-gear candidate(s) (NOT_GOLF_GEAR filter)`);
for (const [slug, arr] of buckets) {
  const seen = new Map();
  for (const c of arr.sort((a, b) => b.pct_off - a.pct_off)) {
    const k = modelKey(c);
    if (!seen.has(k)) seen.set(k, c);
  }
  const deduped = [...seen.values()];
  if (deduped.length !== arr.length) console.log(`${slug}: deduped ${arr.length} -> ${deduped.length} (variant collapse)`);
  buckets.set(slug, deduped);
}

const dir = path.join(ROOT, 'deals');
fs.mkdirSync(dir, { recursive: true });
const stamp = `    <p class="dd-stamp">Inventory refreshed <strong>${esc(latest.date)}</strong> by the nightly price bot · retailer-listed prices only · biggest verified cuts first</p>`;

for (const hub of HUBS) {
  const file = path.join(dir, `${hub.slug}.html`);
  if (!fs.existsSync(file)) { fs.writeFileSync(file, shell(hub)); console.log(`created shell: deals/${hub.slug}.html`); }
  const rows = buckets.get(hub.slug).sort((a, b) => b.pct_off - a.pct_off).slice(0, MAX_ROWS);
  let body = rows.length
    ? `${stamp}\n\n    <h2><span class="kick">The Ledger</span>${rows.length} verified deal${rows.length === 1 ? '' : 's'} live</h2>\n    <div class="dd-ledger">\n${rows.map(rowHtml).join('\n')}\n    </div>`
    : `${stamp}\n\n    <h2><span class="kick">The Ledger</span>Nothing clears the bar today</h2>\n    <p>The bot found no discounts in this department worth your money overnight — a quiet day is better than a padded one. Check back tomorrow.</p>`;
  // Department-level kill list: killed items that would have landed in this ledger.
  const kills = killedByHub.get(hub.slug).map(c => killlist.find(k => k.url === c.url)).filter(Boolean);
  if (kills.length) {
    body += `\n\n    <h2><span class="kick">Kill List</span>Left on the cutting-room floor</h2>\n    <p>The loudest “discounts” the bot found in this department did not survive verification:</p>\n    <ul class="dd-floor">\n${kills.map(f => `      <li><strong>${esc(f.claim)}</strong> — ${esc(f.reason)}</li>`).join('\n')}\n    </ul>`;
  }
  guardAndInject(file, 'hub:auto', body);
  console.log(`deals/${hub.slug}.html: ${rows.length} rows (of ${buckets.get(hub.slug).length} matched, ${kills.length} killed)`);
}

// ---- departments grid on deals.html ----
const cells = HUBS.map(h => {
  const n = buckets.get(h.slug).length;
  return `      <a class="dd-dept" href="/deals/${h.slug}.html">
        <span class="dd-dept-name">${esc(h.nav)}</span>
        <span class="dd-dept-count">top ${Math.min(n, MAX_ROWS)} shown of ${n} scanned sale candidates</span>
        <span class="dd-dept-open">OPEN THE LEDGER →</span>
      </a>`;
}).concat(COMING_SOON.map(name => `      <span class="dd-dept soon">
        <span class="dd-dept-name">${esc(name)}</span>
        <span class="dd-dept-count">source wiring in</span>
        <span class="dd-dept-open">COMING SOON</span>
      </span>`));
guardAndInject(path.join(ROOT, 'deals.html'), 'departments:auto', `    <div class="dd-depts">\n${cells.join('\n')}\n    </div>`);
console.log(`deals.html departments grid: ${HUBS.length} open + ${COMING_SOON.length} coming soon`);
