/* Mulligan Memo — archive search + dateline.
   Vanilla JS, no dependencies. Loads /search-index.json on first focus,
   filters titles/descriptions, renders a dropdown under the nav search field. */
(function () {
  // dateline in the topbar
  var d = new Date();
  var days = ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"];
  var months = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
  var dateEl = document.getElementById("mm-date");
  if (dateEl) dateEl.textContent = days[d.getDay()] + ", " + months[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();

  // archive search
  var input = document.getElementById("archive-search");
  var panel = document.getElementById("archive-results");
  if (!input || !panel) return;

  var index = null;
  var loading = false;

  function loadIndex(cb) {
    if (index) return cb();
    if (loading) return;
    loading = true;
    fetch("/search-index.json")
      .then(function (r) { return r.json(); })
      .then(function (j) { index = j; loading = false; cb(); })
      .catch(function () { loading = false; });
  }

  function close() { panel.classList.remove("open"); panel.innerHTML = ""; }

  function render(q) {
    var query = q.trim().toLowerCase();
    if (query.length < 2) { close(); return; }
    var terms = query.split(/\s+/);
    var hits = [];
    for (var i = 0; i < index.length; i++) {
      var e = index[i];
      var hay = (e.t + " " + e.d + " " + e.c).toLowerCase();
      var ok = true;
      for (var t = 0; t < terms.length; t++) { if (hay.indexOf(terms[t]) === -1) { ok = false; break; } }
      if (ok) hits.push(e);
      if (hits.length >= 8) break;
    }
    panel.innerHTML = "";
    if (!hits.length) {
      var no = document.createElement("div");
      no.className = "mm-noresult";
      no.textContent = "NOTHING FILED UNDER THAT — TRY ANOTHER TERM.";
      panel.appendChild(no);
    } else {
      hits.forEach(function (e) {
        var a = document.createElement("a");
        a.href = e.u;
        a.textContent = e.t;
        var s = document.createElement("small");
        s.textContent = e.c;
        a.appendChild(s);
        panel.appendChild(a);
      });
    }
    panel.classList.add("open");
  }

  input.addEventListener("focus", function () { loadIndex(function () { if (input.value) render(input.value); }); });
  input.addEventListener("input", function () { loadIndex(function () { render(input.value); }); });
  input.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { close(); input.blur(); }
    if (ev.key === "Enter") {
      ev.preventDefault();
      var first = panel.querySelector("a");
      if (first) window.location.href = first.getAttribute("href");
    }
  });
  document.addEventListener("click", function (ev) {
    if (!panel.contains(ev.target) && ev.target !== input) close();
  });
})();
