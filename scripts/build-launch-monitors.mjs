// Builds /launch-monitors.html — the full launch-monitor and simulator ladder,
// regenerated from the nightly feed so prices and the date stamp can never drift.
// Usage: node scripts/build-launch-monitors.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const feed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'deals-latest.json'), 'utf8'));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

const PB_REF = 'ghref=2301%3A1337756';
function outbound(url) {
  const u = String(url);
  if (!/^https?:\/\/(www\.)?playbetter\.com\//i.test(u)) return { href: u, paid: false };
  const clean = u.split('#')[0];
  return { href: clean.includes(PB_REF) ? clean : clean + (clean.includes('?') ? '&' : '?') + PB_REF, paid: true };
}

// Only launch monitors and simulator hardware. Exclude the accessories, watches,
// memberships, bow sights and push carts that share the catalogue.
const IS_LM = /launch monitor|simulator|GCQuad|QuadMAX|GC3|Falcon|EYE X|APOGEE|SkyTrak|Mevo|MLM2PRO|Launch Pro|LPi|Approach R\d|Full Swing KIT|ProTee|Trackman/i;
const NOT_LM = /bow sight|chronograph|push cart|caddy|smartwatch|GPS watch|membership|subscription|software only|rangefinder|Stack Radar|screen|enclosure|mat\b|projector|net\b/i;
const IS_BUNDLE = /SimStudio|SportScreen|Carl.s Place|Net Return|Studio Package|BYO/i;

const price = (x) => Number(x.price || 0);
const all = (feed.candidates || []).filter((c) => /playbetter/i.test(c.retailer || ''));
const units = all.filter((c) => IS_LM.test(c.title) && !NOT_LM.test(c.title) && !IS_BUNDLE.test(c.title) && price(c) >= 250);
const bundles = all.filter((c) => IS_BUNDLE.test(c.title) && IS_LM.test(c.title) && price(c) >= 3000);

const TIERS = [
  { key: 'portable', name: 'Portable practice', lo: 250, hi: 1200,
    lede: 'Radar units you can carry to a range bay. They give you ball speed and carry, and most add simulated play through a phone or tablet. Room depth matters less here because the unit sits behind you — but almost all of them charge separately for the software that makes them fun.' },
  { key: 'entry', name: 'The home-sim entry point', lo: 1200, hi: 3200,
    lede: 'Where a permanent room build starts to make sense. Photometric units in this band read the ball off the face rather than tracking flight, so they need far less depth behind you than radar — the reason they dominate garage builds. Budget for the annual software on top.' },
  { key: 'serious', name: 'Serious home hardware', lo: 3200, hi: 9000,
    lede: 'The tier where accuracy stops being the constraint and the room becomes it. These units are what most dedicated home studios are built around, and several sell as certified pre-owned for materially less than new.' },
  { key: 'commercial', name: 'Commercial-grade', lo: 9000, hi: 1e9,
    lede: 'Club-fitting and teaching-facility hardware. Bought new these run five figures; the certified pre-owned and open-box listings below are frequently thousands less for the same unit, which is the single biggest saving available anywhere on this page.' },
];

function card(c) {
  const link = outbound(c.url);
  const cond = /certified pre-owned|pre-owned|refurbished/i.test(c.title) ? 'Certified pre-owned'
    : /open box/i.test(c.title) ? 'Open box' : 'New';
  const name = String(c.title)
    .replace(/\s*\((?:Certified\s+)?Pre-?Owned[^)]*\)/i, '')
    .replace(/\s*\(Open Box\)/i, '')
    .replace(/\s*Golf Launch Monitor(?: (?:&|and) Simulator)?/i, '')
    .replace(/\s*&\s*Simulator/i, '').trim();
  return `        <div class="lm-card">
          <div class="lm-top"><span class="lm-brand">${esc(c.vendor || '')}</span><span class="lm-cond lm-cond-${cond.split(' ')[0].toLowerCase()}">${cond}</span></div>
          <h3 class="lm-name">${esc(name)}</h3>
          <div class="lm-price">${money(price(c))}</div>
          <a class="lm-buy" href="${esc(link.href)}" rel="nofollow noopener${link.paid ? ' sponsored' : ''}" target="_blank">See it at PlayBetter &rarr;</a>${link.paid ? '<span class="lm-tag">paid link</span>' : ''}
        </div>`;
}

const stamp = new Date(feed.generated_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

let body = '';
for (const t of TIERS) {
  const items = units.filter((u) => price(u) >= t.lo && price(u) < t.hi).sort((a, b) => price(a) - price(b));
  if (!items.length) continue;
  const lo = money(Math.min(...items.map(price)));
  const hi = money(Math.max(...items.map(price)));
  body += `
      <h2 id="${t.key}"><span class="kick">${lo} &ndash; ${hi}</span>${t.name}</h2>
      <p>${t.lede}</p>
      <div class="lm-grid">
${items.map(card).join('\n')}
      </div>
`;
}

const bundleRows = bundles.sort((a, b) => price(a) - price(b)).slice(0, 12).map((b) => {
  const link = outbound(b.url);
  return `          <tr><td>${esc(String(b.title).replace(/\s*\|.*$/, ''))}</td><td class="lm-num">${money(price(b))}</td><td class="g-go"><a class="cta cta-mini" href="${esc(link.href)}" rel="nofollow noopener sponsored" target="_blank">VIEW &rarr;</a></td></tr>`;
}).join('\n');

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
<meta name='impact-site-verification' value='80248b4c-2d8c-4778-866a-9634568a7419'>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="max-image-preview:large">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="canonical" href="https://mulliganmemo.com/launch-monitors.html" />
  <meta name="p:domain_verify" content="07e415f0e59eb6cc59d578a5b8f4648a" />
  <title>Golf Launch Monitor Prices: Every Tier, New vs Pre-Owned — Mulligan Memo</title>
  <meta name="description" content="What golf launch monitors actually cost, from portable radar to commercial photometric units — with certified pre-owned prices beside new, and what each price does not include." />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Mulligan Memo" />
  <meta property="og:title" content="Golf Launch Monitor Prices: Every Tier, New vs Pre-Owned" />
  <meta property="og:description" content="The full ladder from $400 radar to $15,000 photometric — with certified pre-owned prices beside new." />
  <meta property="og:url" content="https://mulliganmemo.com/launch-monitors.html" />
  <meta property="og:image" content="https://mulliganmemo.com/og-cover.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="https://mulliganmemo.com/og-cover.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,900&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400;1,6..72,500&family=Courier+Prime:wght@400;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles/article.css" />
  <link rel="stylesheet" href="/styles/deals.css" />
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-8VD95MJ4D9"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-8VD95MJ4D9');
  </script>
</head>
<body>
  <div class="mm-topbar"><a class="mm-brand" href="/">Mulligan Memo</a></div>
  <nav class="mm-nav" aria-label="Primary">
    <input class="mm-nav-toggle" id="mm-nav-toggle" type="checkbox" aria-controls="primary-menu">
    <div class="mm-mobile-row">
      <a class="mm-mobile-brand" href="/">Mulligan Memo</a>
      <label class="mm-menu-label" for="mm-nav-toggle"><span class="sr-only">Toggle primary menu</span><span class="mm-menu-word" aria-hidden="true"></span></label>
    </div>
    <div class="mm-nav-in" id="primary-menu">
      <a href="/beginners.html">BEGINNERS</a>
      <a href="/clubs.html">CLUBS</a>
      <a href="/tech.html">TECH</a>
      <a href="/launch-monitors.html" class="active">LAUNCH MONITORS</a>
      <a href="/accessories.html">ACCESSORIES</a>
      <a href="/golf-balls.html">BALLS</a>
      <a href="/deals.html">DEALS</a>
      <a href="/distance-chart.html">DISTANCES</a>
      <a href="/about.html">ABOUT</a>
      <form class="mm-search" role="search" onsubmit="return false;">
        <label for="archive-search"><span aria-hidden="true">&#8981;</span><span class="sr-only">Search the archive</span></label>
        <input id="archive-search" type="search" placeholder="SEARCH THE ARCHIVE&hellip;" autocomplete="off">
        <div class="mm-search-results" id="archive-results"></div>
      </form>
    </div>
  </nav>
  <article class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span class="sep">&rsaquo;</span><a href="/tech.html">Golf Tech</a><span class="sep">&rsaquo;</span>Launch Monitors</nav>
    <header class="ahead">
      <div class="crumb">The Price Ladder</div>
      <h1 class="title">What a golf launch monitor actually costs</h1>
      <p class="dek">Every tier from portable radar to commercial photometric &mdash; with certified pre-owned prices sitting beside new, which is where the real money is saved.</p>
      <div class="byline"><span>Prices checked <b>${stamp}</b></span><span class="sep">/</span><span>${units.length} units</span></div>
    </header>
    <div class="copy">

      <div class="callout">
        <div class="ttl">Read this before the prices</div>
        <div class="bd"><p>The number on the box is not the number you pay. Almost every unit here needs software to become a simulator, and that is usually an annual subscription bought separately. Photometric units (SkyTrak, Bushnell, Foresight, Uneekor) sit beside the ball and need little depth behind you; radar units (Mevo, Garmin, Rapsodo) track flight and want several metres of room. That single difference decides more purchases than accuracy does &mdash; check what your <a class="inline" href="/posts/golf-simulator-room-dimensions.html">room actually allows</a> first.</p></div>
      </div>
${body}
      <h2 id="packages">Complete studio packages</h2>
      <p>A launch monitor on its own is not a simulator. These bundle the enclosure, impact screen, hitting mat and projector, which is most of the cost people forget. Cheapest twelve currently listed:</p>
      <figure class="glance"><table class="spec">
        <thead><tr><th>Package</th><th>Price</th><th class="g-go"></th></tr></thead>
        <tbody>
${bundleRows}
        </tbody>
      </table></figure>

      <h2 id="pre-owned">New, open box, or certified pre-owned</h2>
      <p>The same unit often appears here at three prices. Certified pre-owned means the manufacturer or PlayBetter has refurbished and re-tested it, and it carries a warranty &mdash; unlike a private sale, where a photometric unit with an expired or account-locked software licence is a real risk. On the four-figure hardware the gap between new and certified pre-owned is routinely thousands, which is the largest single saving on this page. Our <a class="inline" href="/posts/used-golf-launch-monitor.html">used launch monitor guide</a> covers what to confirm before buying secondhand.</p>

      <h2 id="next">Work out what fits first</h2>
      <p>Buying the unit before measuring the room is the expensive mistake. Start with <a class="inline" href="/posts/golf-simulator-room-dimensions.html">what each unit publishes for ceiling height and room depth</a>, then decide whether you <a class="inline" href="/posts/do-you-need-a-golf-launch-monitor.html">need a launch monitor at all</a>. If your budget is under $500, the <a class="inline" href="/posts/best-golf-launch-monitor-under-500.html">entry-level guide</a> is the better starting point.</p>

    </div>
  </article>
  <footer>
  <div class="fwrap">
    <div class="mm-foot-top"><div class="fmark">Mulligan Memo</div></div>
    <div class="mm-foot-rule"></div>
    <p class="fdisc">Some links on Mulligan Memo earn us a commission. Those are marked "paid link". As an Amazon Associate, we earn from qualifying purchases.</p>
    <div class="mm-foot-bottom"><span>&copy; 2026 Mulligan Memo</span></div>
  </div>
</footer>
  <script src="/search.js" defer></script>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, 'launch-monitors.html'), page, 'utf8');
console.log(`launch-monitors.html: ${units.length} units across ${TIERS.filter((t) => units.some((u) => price(u) >= t.lo && price(u) < t.hi)).length} tiers + ${Math.min(bundles.length, 12)} packages (prices ${stamp})`);
