// Generates /products/<slug>.html for every product in the registry, plus the
// /products/ directory page. Stage 1 of the deals+ratings pivot.
// Usage: node scripts/build-product-pages.mjs   (after build-product-registry.mjs)
//
// THE PAGE CONTRACT, from the adopted plan:
//   "With zero user ratings, the page still contains: canonical product and
//    revision identity, current verified offers, manufacturer specifications,
//    variant information, and honest no-score states."
// Nothing here is hand-edited — every page is regenerated wholesale each run,
// like launch-monitors.html, so there is no marker drift and no frozen shell.
//
// HONESTY RULES BAKED IN:
// - No specs are invented. The only product facts shown are what the merchant
//   feed published: variant titles, GTIN count, prices.
// - The rating panels ship in their honest zero state. No Review schema, no
//   AggregateRating, no placeholder stars.
// - One disclosure line, ABOVE the first commercial link (audit finding: the
//   old pages buried it hundreds of lines below the CTAs).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const registry = JSON.parse(readFileSync(join(ROOT, 'data', 'products.json'), 'utf8'));
const grid = JSON.parse(readFileSync(join(ROOT, 'data', 'deals-grid.json'), 'utf8'));
const OUT = join(ROOT, 'products');
mkdirSync(OUT, { recursive: true });

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = n => '$' + (Number.isInteger(n) ? n.toLocaleString('en-US') : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 }));
const checkedLabel = (() => {
  const d = new Date(grid.checked_at);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
})();

/* Live offers keyed the same way the registry binds identity. */
const offerByKey = new Map(
  (grid.items || []).filter(i => i.item_group_id).map(i => [`${i.retailer}::${i.item_group_id}`, i])
);

function chrome(title, description, canonicalPath) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="max-image-preview:large">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="canonical" href="https://mulliganmemo.com${canonicalPath}" />
  <meta name="p:domain_verify" content="07e415f0e59eb6cc59d578a5b8f4648a" />
  <meta name='impact-site-verification' value='80248b4c-2d8c-4778-866a-9634568a7419'>
  <title>${esc(title)} — Mulligan Memo</title>
  <meta name="description" content="${esc(description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Mulligan Memo" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="https://mulliganmemo.com${canonicalPath}" />
  <meta property="og:image" content="https://mulliganmemo.com/og-cover.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,900&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400;1,6..72,500&family=Courier+Prime:wght@400;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles/article.css" />
  <link rel="stylesheet" href="/styles/deals.css" />
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
    <a class="mm-brand" href="/">Mulligan Memo</a>
  </div>
  <nav class="mm-nav" aria-label="Primary">
    <input class="mm-nav-toggle" id="mm-nav-toggle" type="checkbox" aria-controls="primary-menu">
    <div class="mm-mobile-row">
      <a class="mm-mobile-brand" href="/">Mulligan Memo</a>
      <label class="mm-menu-label" for="mm-nav-toggle">
        <span class="sr-only">Toggle primary menu</span>
        <span class="mm-menu-word" aria-hidden="true"></span>
      </label>
    </div>
    <div class="mm-nav-in" id="primary-menu">
      <a href="/beginners.html">BEGINNERS</a>
      <a href="/clubs.html">CLUBS</a>
      <a href="/tech.html">TECH</a>
      <a href="/accessories.html">ACCESSORIES</a>
      <a href="/golf-balls.html">BALLS</a>
      <a href="/launch-monitors.html">LAUNCH MONITORS</a>
      <a href="/deals.html" class="active">DEALS</a>
      <a href="/glossary.html">GLOSSARY</a>
      <a href="/distance-chart.html">DISTANCES</a>
      <a href="/my-bag.html">MY BAG</a>
      <a href="/about.html">ABOUT</a>
      <form class="mm-search" role="search" onsubmit="return false;">
        <label for="archive-search"><span aria-hidden="true">&#8981;</span><span class="sr-only">Search the archive</span></label>
        <input id="archive-search" type="search" placeholder="SEARCH THE ARCHIVE&#8230;" autocomplete="off">
        <div class="mm-search-results" id="archive-results"></div>
      </form>
    </div>
  </nav>`;
}

const FOOTER = `  <footer>
  <div class="fwrap">
    <div class="mm-foot-top"><div class="fmark">Mulligan Memo</div></div>
    <div class="mm-foot-rule"></div>
    <div class="foot-sub">
      <p class="foot-sub-kick">THE DROP &#10038; SUNDAY MORNINGS</p>
      <p class="foot-sub-p">The week&rsquo;s real price drops on clubs, launch monitors and simulator gear. Biggest saving first.</p>
      <form class="foot-sub-form js-subscribe" method="post" action="https://buttondown.com/api/emails/embed-subscribe/mulliganmemo" target="nl-sink">
        <input type="email" name="email" required placeholder="YOUR@EMAIL.COM" aria-label="Email address">
        <button type="submit">GET THE DROP</button>
      </form>
      <p class="foot-sub-msg" aria-live="polite"></p>
    </div>
    <p class="fdisc">When you buy through links on the Memo we may earn a small commission &mdash; it never changes the pick. As an Amazon Associate, we earn from qualifying purchases.</p>
    <div class="mm-foot-bottom"><span>&copy; 2026 Mulligan Memo</span></div>
  </div>
  <script>
    (function () {
      var forms = document.querySelectorAll('form.js-subscribe');
      if (!forms.length) return;
      if (!document.querySelector('iframe[name="nl-sink"]')) {
        var sink = document.createElement('iframe');
        sink.name = 'nl-sink'; sink.style.display = 'none';
        sink.setAttribute('aria-hidden', 'true'); document.body.appendChild(sink);
      }
      Array.prototype.forEach.call(forms, function (f) {
        f.addEventListener('submit', function () {
          var msg = f.parentNode.querySelector('.foot-sub-msg');
          setTimeout(function () {
            if (msg) msg.textContent = 'FILED \\u2726 CHECK YOUR INBOX TO CONFIRM.';
            f.reset();
          }, 300);
          if (typeof gtag === 'function') {
            gtag('event', 'newsletter_signup', { placement: 'footer', page_path: location.pathname });
          }
        });
      });
    })();
  </script>
  <script src="/search.js" defer></script>
</body>
</html>`;

/* THE DISCLOSURE SITS ABOVE THE OFFER. Audit finding 7: on the old pages every
   commercial link came first and the disclosure hundreds of lines later. */
const DISCLOSURE = `<p class="pp-disc">Some links on this page earn Mulligan Memo a commission.</p>`;

function offerBlock(p, offer) {
  if (offer) {
    const save = offer.list - offer.sale;
    /* DERIVED, NEVER READ. The grid stores pct as an integer percent while the
       raw CJ rows carry a fraction — reading it produced "save $120 (4000%)"
       on the very first rendered page. Same bug class the curated board had;
       same rule: a number computable from the two prices is always computed
       from the two prices. */
    const pct = Math.round(100 * (1 - offer.sale / offer.list));
    return `
      <section class="pp-offer">
        <h2><span class="kick">Verified today</span>Current deal</h2>
        ${DISCLOSURE}
        <div class="pp-offer-card">
          ${offer.image ? `<div class="pp-img"><img src="${esc(offer.image)}" alt="${esc(p.canonical_name)}" loading="lazy"></div>` : ''}
          <div class="pp-offer-facts">
            <p class="pp-price"><span class="pp-was">${money(offer.list)}</span> <span class="pp-now">${money(offer.sale)}</span> <span class="pp-save">save ${money(save)} (${pct}%)</span></p>
            <p class="pp-meta">at ${esc(offer.retailer)} &middot; price checked against the retailer&rsquo;s own product page on ${esc(checkedLabel)}</p>
            <a class="pp-buy" href="${esc(offer.track || offer.url)}" rel="sponsored nofollow noopener" target="_blank"
               onclick="if(typeof gtag==='function')gtag('event','outbound_click',{merchant:'${esc(offer.retailer)}',product:'${esc(p.slug)}',placement:'product_page'})">SEE IT AT ${esc(offer.retailer).toUpperCase()} &rarr;</a>
          </div>
        </div>
      </section>`;
  }
  const b = p.bindings[0];
  return `
      <section class="pp-offer">
        <h2><span class="kick">Price watch</span>No verified deal right now</h2>
        <p>${esc(p.canonical_name)} is catalogued from ${esc(b.retailer)}, but it is not on a verified discount today. The nightly bot rechecks every morning; when the price genuinely drops it will appear here and on <a class="inline" href="/deals.html">the deals board</a>.</p>
      </section>`;
}

function variantsBlock(p) {
  const vs = p.bindings.flatMap(b => b.variants || []);
  if (!vs.length) return '';
  const gtins = new Set(vs.map(v => v.gtin).filter(Boolean));
  const shown = vs.slice(0, 12);
  return `
      <section class="pp-variants">
        <h2><span class="kick">As published</span>Configurations the retailer lists</h2>
        <p class="pp-varnote">${vs.length} configuration${vs.length === 1 ? '' : 's'} in the merchant feed${gtins.size ? `, ${gtins.size} with a distinct GTIN` : ''}. These are the retailer&rsquo;s own listings, not our descriptions.</p>
        <ul class="pp-varlist">
          ${shown.map(v => `<li>${esc(v.feed_title)}${v.gtin ? ` <span class="pp-gtin">GTIN ${esc(v.gtin)}</span>` : ''}</li>`).join('\n          ')}
        </ul>
        ${vs.length > shown.length ? `<p class="pp-varnote">&hellip;and ${vs.length - shown.length} more.</p>` : ''}
      </section>`;
}

/* The two score panels, in their honest day-one state. The plan's exact spec:
   citation rows immediately once catalogued; golfer score displays at n=5.
   Neither exists yet, and the page says so plainly rather than faking either. */
function scoresBlock() {
  return `
      <section class="pp-scores">
        <h2><span class="kick">The record</span>Scores</h2>
        <div class="pp-score-grid">
          <div class="pp-score-panel">
            <h3>Published critic results</h3>
            <p class="pp-score-empty">None catalogued yet. When independent publications review this exact model, their results will be cited here &mdash; original score, original scale, dated and linked to the source.</p>
          </div>
          <div class="pp-score-panel">
            <h3>Mulligan golfer score</h3>
            <p class="pp-score-empty">No ratings yet. Ratings open soon: signed-in golfers who have personally used this exact model will be able to rate it here. A score shows once five ratings are in.</p>
          </div>
        </div>
        <p class="pp-score-note">Mulligan Memo has not tested this product and does not publish its own review score.</p>
      </section>`;
}

function productPage(p) {
  const b = p.bindings[0];
  const offer = offerByKey.get(`${b.retailer}::${b.item_group_id}`);
  const title = `${p.canonical_name}: Price, Deals & Ratings`;
  const desc = offer
    ? `${p.canonical_name} — ${money(offer.sale)} at ${offer.retailer} (was ${money(offer.list)}), verified ${checkedLabel}. Configurations, price watch and ratings.`
    : `${p.canonical_name} — price watch, retailer configurations and ratings. Checked nightly against ${b.retailer}.`;
  const path = `/products/${p.slug}.html`;
  return `${chrome(title, desc, path)}
  <article class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span class="sep">&rsaquo;</span><a href="/products/">Products</a><span class="sep">&rsaquo;</span>${esc(p.canonical_name)}</nav>
    <header class="post-head">
      <p class="eyebrow">${esc(p.brand || 'Product')}</p>
      <h1 class="title">${esc(p.canonical_name)}</h1>
      <p class="dek">Tracked since ${new Date(p.first_seen).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}. Prices re-verified against the retailer&rsquo;s own page every morning.</p>
    </header>
    <section class="post-body">
${offerBlock(p, offer)}
${variantsBlock(p)}
${scoresBlock()}
    </section>
  </article>
${FOOTER}`;
}

function directoryPage(products) {
  const rows = products.map(p => {
    const b = p.bindings[0];
    const offer = offerByKey.get(`${b.retailer}::${b.item_group_id}`);
    return `        <a class="pp-row" href="/products/${esc(p.slug)}.html">
          <span class="pp-row-name">${esc(p.canonical_name)}</span>
          <span class="pp-row-brand">${esc(p.brand || '')}</span>
          ${offer ? `<span class="pp-row-deal">-${Math.round(100 * (1 - offer.sale / offer.list))}% &middot; ${money(offer.sale)}</span>` : `<span class="pp-row-nodeal">no deal today</span>`}
        </a>`;
  }).join('\n');
  return `${chrome('Golf Products: Prices, Deals & Ratings', 'Every product Mulligan Memo tracks nightly — verified prices, retailer configurations, and (soon) golfer ratings.', '/products/')}
  <article class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span class="sep">&rsaquo;</span>Products</nav>
    <header class="post-head">
      <p class="eyebrow">The Catalogue</p>
      <h1 class="title">Products we track</h1>
      <p class="dek">${products.length} products, prices re-verified against each retailer&rsquo;s own page every morning. Golfer ratings are coming; every page already shows exactly what is and is not known.</p>
    </header>
    <section class="post-body">
      <div class="pp-dir">
${rows}
      </div>
      <p class="pp-varnote" style="margin-top:24px">Products appear here once they carry a stable identity in a merchant feed. High-ticket PlayBetter gear is tracked on <a class="inline" href="/launch-monitors.html">the launch monitor ladder</a> and joins this catalogue when identifiers land.</p>
    </section>
  </article>
${FOOTER}`;
}

/* Wholesale regeneration: remove pages whose product no longer exists (renamed
   slug pre-launch, merged product) so the directory never links a 404 and no
   orphan page lingers at an old slug. */
const wanted = new Set(registry.products.map(p => `${p.slug}.html`));
for (const f of readdirSync(OUT).filter(f => f.endsWith('.html') && f !== 'index.html')) {
  if (!wanted.has(f)) { unlinkSync(join(OUT, f)); console.log(`  removed stale page: products/${f}`); }
}

for (const p of registry.products) {
  writeFileSync(join(OUT, `${p.slug}.html`), productPage(p), 'utf8');
}
writeFileSync(join(OUT, 'index.html'), directoryPage(registry.products), 'utf8');

const live = registry.products.filter(p => offerByKey.has(`${p.bindings[0].retailer}::${p.bindings[0].item_group_id}`)).length;
console.log(`products/: ${registry.products.length} pages + directory (${live} with a live verified deal)`);

/* Append the .pp- styles once (idempotent, marker-guarded). */
const cssPath = join(ROOT, 'styles', 'deals.css');
const css = readFileSync(cssPath, 'utf8');
if (!css.includes('/* pp:product-pages */')) {
  writeFileSync(cssPath, css + `
/* pp:product-pages */
.pp-disc { font-family: var(--mono); font-size: 0.72rem; letter-spacing: 0.06em; color: var(--cream-dark); margin: 0 0 12px; }
.pp-offer-card { display: flex; gap: 22px; align-items: flex-start; border: 1.5px solid var(--brass-edge); background: rgba(253,251,245,0.03); padding: 18px; flex-wrap: wrap; }
.pp-img { flex: 0 0 180px; background: #fdfbf5; border: 1px solid rgba(0,0,0,0.08); padding: 10px; }
.pp-img img { width: 100%; height: auto; display: block; mix-blend-mode: normal; }
.pp-offer-facts { flex: 1 1 260px; min-width: 0; }
.pp-price { font-family: var(--mono); font-size: 1.05rem; margin: 0 0 6px; }
.pp-was { text-decoration: line-through; opacity: 0.6; margin-right: 8px; }
.pp-now { font-weight: 700; font-size: 1.3rem; margin-right: 10px; }
.pp-save { color: var(--brass-light); font-size: 0.85rem; }
.pp-meta { font-family: var(--mono); font-size: 0.74rem; color: var(--cream-dark); margin: 0 0 14px; }
.pp-buy { display: inline-block; font-family: var(--mono); font-weight: 700; font-size: 0.8rem; letter-spacing: 0.08em; padding: 12px 20px; background: var(--brass); color: var(--cta-ink); border: 1.5px solid var(--brass-edge); text-decoration: none; }
.pp-buy:hover { background: var(--brass-light); }
.pp-varnote { font-family: var(--mono); font-size: 0.76rem; color: var(--cream-dark); }
.pp-varlist { list-style: none; padding: 0; margin: 10px 0 0; }
.pp-varlist li { font-family: var(--mono); font-size: 0.8rem; padding: 7px 0; border-bottom: 1px solid rgba(234,217,189,0.14); }
.pp-gtin { opacity: 0.55; font-size: 0.7rem; margin-left: 8px; }
.pp-score-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin: 14px 0; }
.pp-score-panel { border: 1.5px solid rgba(234,217,189,0.25); padding: 16px; }
.pp-score-panel h3 { font-family: var(--mono); font-size: 0.78rem; letter-spacing: 0.1em; text-transform: uppercase; margin: 0 0 10px; color: var(--brass-light); }
.pp-score-empty { font-size: 0.92rem; color: var(--cream-dark); margin: 0; }
.pp-score-note { font-family: var(--mono); font-size: 0.72rem; color: var(--cream-dark); }
.pp-dir { display: flex; flex-direction: column; }
.pp-row { display: flex; gap: 14px; align-items: baseline; padding: 13px 4px; border-bottom: 1px solid rgba(234,217,189,0.16); text-decoration: none; color: inherit; flex-wrap: wrap; }
.pp-row:hover { background: rgba(253,251,245,0.04); }
.pp-row-name { font-weight: 600; flex: 1 1 240px; }
.pp-row-brand { font-family: var(--mono); font-size: 0.72rem; color: var(--cream-dark); }
.pp-row-deal { font-family: var(--mono); font-size: 0.78rem; color: var(--brass-light); font-weight: 700; }
.pp-row-nodeal { font-family: var(--mono); font-size: 0.72rem; opacity: 0.5; }
`, 'utf8');
  console.log('styles/deals.css: pp styles appended');
}
