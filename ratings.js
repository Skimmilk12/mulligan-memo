/* Mulligan Memo — golfer ratings widget. Loaded on /products/<slug>.html.
   Everything security-relevant is enforced server-side (see supabase/ratings-schema.sql);
   this file is presentation plus two RPC calls. It reads only the PUBLIC
   aggregate and the caller's OWN ballot. It never sees another user's rating. */
(function () {
  var root = document.getElementById('mm-rating');
  if (!root) return;
  var cfg = window.MM_RATINGS || {};
  var productId = root.getAttribute('data-product-id');
  var productName = root.getAttribute('data-product-name') || 'this product';
  if (!cfg.url || !cfg.key || !productId) return;

  var sb = null;
  function client() {
    if (sb) return sb;
    if (!window.supabase || !window.supabase.createClient) return null;
    sb = window.supabase.createClient(cfg.url, cfg.key);
    return sb;
  }

  var el = function (tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };

  /* -------- public summary (anon-readable view) -------- */
  function renderSummary(s) {
    var box = root.querySelector('.mmr-summary');
    if (!box) return;
    if (!s || s.display_state === 'hidden') {
      var n = s ? s.eligible_count : 0;
      box.innerHTML = n > 0
        ? '<p class="pp-score-empty">' + n + ' firsthand rating' + (n === 1 ? '' : 's') + ' collected. A score shows at five.</p>'
        : '<p class="pp-score-empty">No ratings yet. Be the first golfer to rate it.</p>';
      return;
    }
    var stars = Number(s.mean_score).toFixed(1);
    var hist = [5, 4, 3, 2, 1].map(function (k) {
      var c = s['star_' + k] || 0;
      var pct = s.eligible_count ? Math.round(100 * c / s.eligible_count) : 0;
      return '<div class="mmr-bar"><span class="mmr-bar-k">' + k + '&#9733;</span><span class="mmr-bar-track"><span class="mmr-bar-fill" style="width:' + pct + '%"></span></span><span class="mmr-bar-n">' + c + '</span></div>';
    }).join('');
    box.innerHTML =
      '<p class="mmr-score"><strong>' + stars + '</strong><span>/5</span> <span class="mmr-count">&middot; ' + s.eligible_count + ' rating' + (s.eligible_count === 1 ? '' : 's') + '</span></p>' +
      (s.display_state === 'early' ? '<p class="mmr-early">Early score &mdash; small sample</p>' : '') +
      '<div class="mmr-hist">' + hist + '</div>';
  }

  async function loadSummary() {
    var c = client(); if (!c) return;
    var r = await c.from('rating_summaries').select('*').eq('product_id', productId).maybeSingle();
    renderSummary(r.data);
  }

  /* -------- the form -------- */
  var state = { user: null, mine: null, score: 0, basis: '', draftKey: 'mmr-draft:' + productId };

  function renderForm() {
    var box = root.querySelector('.mmr-form');
    if (!box) return;
    if (!state.user) {
      box.innerHTML =
        '<div class="mmr-stars" role="radiogroup" aria-label="Your rating">' + starButtons() + '</div>' +
        '<p class="mmr-note">Only golfers who have personally used this exact model should rate it. Sign in with Google to file yours &mdash; your draft is kept while you sign in.</p>' +
        '<button type="button" class="pp-buy mmr-signin">SIGN IN WITH GOOGLE TO RATE</button>';
      wireStars(box);
      box.querySelector('.mmr-signin').addEventListener('click', signIn);
      return;
    }
    var mine = state.mine;
    var head = mine
      ? '<p class="mmr-mine">You rated this <strong>' + mine.score + '/5</strong> &middot; ' + statusLabel(mine.status) + '</p>'
      : '';
    box.innerHTML = head +
      '<div class="mmr-stars" role="radiogroup" aria-label="Your rating">' + starButtons() + '</div>' +
      '<div class="mmr-basis">' +
        radio('own', 'I own it') + radio('used', 'I&rsquo;ve used or rented it') + radio('demoed', 'I demoed it') +
      '</div>' +
      '<label class="mmr-variant"><span>Which configuration? (optional)</span><input type="text" maxlength="80" placeholder="e.g. Right / 3-wood / stiff"></label>' +
      '<label class="mmr-attest"><input type="checkbox"> I personally used this exact model. I understand wrong-product or fraudulent ratings may be removed.</label>' +
      '<div class="mmr-actions">' +
        '<button type="button" class="pp-buy mmr-submit" disabled>' + (mine ? 'UPDATE MY RATING' : 'FILE MY RATING') + '</button>' +
        (mine && mine.status !== 'withdrawn' ? '<button type="button" class="mmr-withdraw">Withdraw</button>' : '') +
        '<button type="button" class="mmr-signout">Sign out</button>' +
      '</div>' +
      '<p class="mmr-msg" aria-live="polite"></p>';
    wireStars(box);
    if (mine) { state.score = mine.score; state.basis = mine.basis; paintStars(box, mine.score); var rb = box.querySelector('input[value="' + mine.basis + '"]'); if (rb) rb.checked = true; }
    box.querySelectorAll('input[name="mmr-basis"]').forEach(function (i) { i.addEventListener('change', function () { state.basis = i.value; gate(box); }); });
    box.querySelector('.mmr-attest input').addEventListener('change', function () { gate(box); });
    box.querySelector('.mmr-submit').addEventListener('click', function () { submit(box); });
    var w = box.querySelector('.mmr-withdraw'); if (w) w.addEventListener('click', function () { withdraw(box); });
    box.querySelector('.mmr-signout').addEventListener('click', signOut);
    gate(box);
  }

  function statusLabel(s) {
    return { pending: 'pending review (up to 24h)', published: 'published', held: 'under review', rejected: 'not published', withdrawn: 'withdrawn' }[s] || s;
  }
  function radio(v, label) {
    return '<label><input type="radio" name="mmr-basis" value="' + v + '"> ' + label + '</label>';
  }
  function starButtons() {
    var out = '';
    for (var i = 1; i <= 5; i++) out += '<button type="button" class="mmr-star" data-v="' + i + '" role="radio" aria-checked="false" aria-label="' + i + ' star' + (i > 1 ? 's' : '') + '">&#9733;</button>';
    return out;
  }
  function wireStars(box) {
    box.querySelectorAll('.mmr-star').forEach(function (b) {
      b.addEventListener('click', function () {
        state.score = Number(b.getAttribute('data-v'));
        paintStars(box, state.score);
        if (!state.user) sessionStorage.setItem(state.draftKey, JSON.stringify({ score: state.score }));
        gate(box);
      });
    });
  }
  function paintStars(box, n) {
    box.querySelectorAll('.mmr-star').forEach(function (b) {
      var v = Number(b.getAttribute('data-v'));
      b.classList.toggle('on', v <= n);
      b.setAttribute('aria-checked', v === n ? 'true' : 'false');
    });
  }
  function gate(box) {
    var btn = box.querySelector('.mmr-submit'); if (!btn) return;
    var att = box.querySelector('.mmr-attest input');
    btn.disabled = !(state.score >= 1 && state.basis && att && att.checked);
  }

  async function submit(box) {
    var c = client(); if (!c) return;
    var msg = box.querySelector('.mmr-msg');
    var btn = box.querySelector('.mmr-submit'); btn.disabled = true;
    msg.textContent = 'Filing…';
    var variant = box.querySelector('.mmr-variant input').value;
    var r = await c.rpc('submit_rating', { p_product_id: productId, p_score: state.score, p_basis: state.basis, p_variant: variant });
    if (r.error) {
      msg.textContent = friendly(r.error.message);
      btn.disabled = false;
      return;
    }
    msg.textContent = 'Rating received. New ratings may take up to 24 hours to appear.';
    if (typeof gtag === 'function') gtag('event', 'rating_submitted', { product: root.getAttribute('data-product-slug') || productId, score: state.score });
    await loadMine(); renderForm();
  }
  async function withdraw(box) {
    var c = client(); if (!c) return;
    await c.rpc('withdraw_rating', { p_product_id: productId });
    await loadMine(); renderForm();
  }
  function friendly(m) {
    if (/limit/i.test(m)) return 'You have rated five products in the last day — try again tomorrow.';
    if (/sign in/i.test(m)) return 'Please sign in first.';
    if (/unknown product/i.test(m)) return 'This product is not open for ratings yet.';
    return 'Something went wrong. Please try again.';
  }

  /* -------- auth -------- */
  /* Supabase Auth has CAPTCHA protection on (Turnstile). Every auth call must
     carry a fresh token or Supabase rejects it — Cowork flagged this after the
     first version shipped without it. The token is minted by an invisible
     Turnstile widget rendered on demand; a human sees at most a brief
     "verifying" state, a bot gets nothing. */
  function turnstileToken() {
    return new Promise(function (resolve, reject) {
      if (!cfg.turnstile || !window.turnstile) return resolve(null);
      var host = document.getElementById('mmr-turnstile');
      if (!host) { host = el('div'); host.id = 'mmr-turnstile'; root.appendChild(host); }
      try {
        window.turnstile.render(host, {
          sitekey: cfg.turnstile,
          size: 'invisible',
          callback: function (t) { resolve(t); },
          'error-callback': function () { reject(new Error('captcha failed')); },
          'expired-callback': function () { /* a fresh render is made per sign-in */ },
        });
      } catch (e) { reject(e); }
    });
  }

  async function signIn() {
    var c = client(); if (!c) return;
    var msg = root.querySelector('.mmr-msg') || root.querySelector('.mmr-note');
    var token = null;
    try { token = await turnstileToken(); }
    catch (e) { if (msg) msg.textContent = 'Could not verify you are human. Please reload and try again.'; return; }
    var r = await c.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.href.split('#')[0], captchaToken: token || undefined },
    });
    if (r && r.error && msg) msg.textContent = 'Sign-in failed: ' + r.error.message;
  }
  async function signOut() {
    var c = client(); if (!c) return;
    await c.auth.signOut();
    state.user = null; state.mine = null; state.score = 0; state.basis = '';
    renderForm();
  }
  async function loadMine() {
    var c = client(); if (!c || !state.user) { state.mine = null; return; }
    var r = await c.rpc('my_rating', { p_product_id: productId });
    state.mine = r.data && r.data !== null ? r.data : null;
  }

  /* -------- boot -------- */
  async function boot() {
    root.innerHTML =
      '<div class="mmr-summary"><p class="pp-score-empty">Loading&hellip;</p></div>' +
      '<div class="mmr-form"></div>';
    var c = client();
    if (!c) {
      root.querySelector('.mmr-summary').innerHTML = '<p class="pp-score-empty">Community ratings temporarily unavailable.</p>';
      return;
    }
    await loadSummary();
    var s = await c.auth.getSession();
    state.user = s.data && s.data.session ? s.data.session.user : null;
    if (state.user) {
      var d = sessionStorage.getItem(state.draftKey);
      if (d) { try { state.score = JSON.parse(d).score || 0; } catch (e) {} sessionStorage.removeItem(state.draftKey); }
      await loadMine();
    }
    renderForm();
    if (state.user && state.score && !state.mine) { var box = root.querySelector('.mmr-form'); paintStars(box, state.score); gate(box); }
    c.auth.onAuthStateChange(function (_e, sess) {
      var u = sess ? sess.user : null;
      if ((u && !state.user) || (!u && state.user)) { state.user = u; loadMine().then(renderForm); }
    });
  }
  boot();
})();
