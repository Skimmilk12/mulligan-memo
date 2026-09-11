/* Mulligan Memo — outbound affiliate click tracker.
   One GA4 event, `outbound_click`, for every tap on a merchant link anywhere
   on the site, with the merchant, the product name, and where on the page the
   link lived. This is the human click count; Amazon's own report counts
   agents too. Vanilla JS, no dependencies, no-op when gtag is absent. */
(function () {
  var CJ = /(^|\.)(anrdoezrs\.net|jdoqocy\.com|tkqlhce\.com|dpbolvw\.net|kqzyfj\.com|tqlkg\.com|awltovhc\.com|ftjcfx\.com|lduhtrp\.net)$/i;

  function merchant(host) {
    host = String(host || '').toLowerCase().replace(/^www\./, '');
    if (/(^|\.)amazon\./.test(host)) return 'amazon';
    if (/(^|\.)playbetter\.com$/.test(host)) return 'playbetter';
    if (CJ.test(host)) return 'cj';
    return host;
  }

  function placement(a) {
    if (a.closest('.buy')) return 'buybox';
    if (a.closest('.glance')) return 'glance';
    if (a.closest('.pick')) return 'pick';
    if (a.closest('.dg-strip')) return 'homepage_strip';
    if (a.closest('.dg, .deals-grid, .deal-card, .dl-card')) return 'deals_grid';
    if (a.closest('.lm-ladder, .ladder')) return 'ladder';
    return 'body';
  }

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || typeof gtag !== 'function') return;
    var u;
    try { u = new URL(a.href, location.href); } catch (err) { return; }
    if (!/^https?:$/.test(u.protocol) || u.hostname === location.hostname) return;

    var m = merchant(u.hostname);
    var rel = a.getAttribute('rel') || '';
    var affiliate = /sponsored/i.test(rel) || /[?&](tag|ghref)=/.test(u.search) || m === 'cj';
    if (!affiliate) return;

    var dest = u.hostname + u.pathname;
    if (m === 'cj') {
      var inner = u.searchParams.get('url');
      if (inner) {
        try { var iu = new URL(inner); dest = iu.hostname + iu.pathname; m = 'cj:' + iu.hostname.replace(/^www\./, ''); } catch (err) {}
      }
    }

    var product = (a.getAttribute('aria-label') || a.textContent || '')
      .replace(/^Search Amazon for the /i, '')
      .replace(/\s+/g, ' ').trim().slice(0, 100);

    var asin = (u.pathname.match(/\/dp\/(B0[A-Z0-9]{8})/) || [])[1] || '';

    gtag('event', 'outbound_click', {
      merchant: m.slice(0, 100),
      product: product,
      asin: asin,
      placement: a.getAttribute('data-mm-placement') || placement(a),
      link_domain: dest.slice(0, 100),
      page_path: location.pathname,
      transport_type: 'beacon'
    });
  }, true);

  /* Once per page view: the "where to buy" card actually scrolled into view.
     Gives the card's clicks a denominator, so a click rate can be read
     instead of a raw count. */
  function watchBuyBox() {
    var box = document.querySelector('.buy');
    if (!box || typeof gtag !== 'function' || !('IntersectionObserver' in window)) return;
    var sent = false;
    var io = new IntersectionObserver(function (entries) {
      if (sent) return;
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          sent = true;
          io.disconnect();
          gtag('event', 'buybox_view', { page_path: location.pathname, items: box.querySelectorAll('a.cta').length });
          return;
        }
      }
    }, { threshold: 0.4 });
    io.observe(box);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchBuyBox);
  else watchBuyBox();
})();
