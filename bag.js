/* Mulligan Memo — My Bag
 *
 * A golfer's own set, stored in their own browser. Nothing here is sent
 * anywhere: there is no account, no server call and no analytics payload
 * containing club data. localStorage only, one key, versioned.
 *
 * Loaded by /my-bag.html and readable by any tool page that wants to
 * pre-fill from the reader's real clubs.
 *
 * Every loft and length in SETS below was read from the manufacturer's own
 * published spec table in August 2026 and is cited on the page that first
 * used it. Where a maker publishes no figure we store null and say so —
 * we do not estimate to fill a column.
 */
(function (root) {
  'use strict';

  var KEY = 'mm-bag-v1';
  var VERSION = 1;

  // ---------------------------------------------------------------- data ---
  // Titleist iron lengths are constant across every model in their line
  // (verified: their own spec tables hold length and lie still while loft moves).
  var TI_LEN = { '3': 39.00, '4': 38.50, '5': 38.00, '6': 37.50, '7': 37.00, '8': 36.50, '9': 36.00, 'PW': 35.75, 'W': 35.50, 'W2': 35.50 };

  function ti(name, lofts) {
    var clubs = [];
    Object.keys(lofts).forEach(function (k) {
      clubs.push({ label: ironLabel(k), loft: lofts[k], length: TI_LEN[k] || null });
    });
    return { name: name, brand: 'Titleist', source: 'https://www.titleist.com/product/t350/563C.html', clubs: clubs };
  }

  function ironLabel(k) {
    if (k === 'PW') return 'Pitching wedge';
    if (k === 'W') return 'Gap wedge';
    if (k === 'W2') return 'Sand wedge';
    if (k === 'U') return 'Utility wedge';
    if (/^\d+$/.test(k)) return k + '-iron';
    return k;
  }

  var SETS = [
    ti('T100', { '3': 20, '4': 23, '5': 26, '6': 29, '7': 33, '8': 37, '9': 41, 'PW': 45, 'W': 49 }),
    ti('T150', { '3': 19, '4': 22, '5': 25, '6': 28, '7': 32, '8': 36, '9': 40, 'PW': 44, 'W': 48 }),
    ti('T250', { '3': 20, '4': 22, '5': 24, '6': 27, '7': 30.5, '8': 34.5, '9': 38.5, 'PW': 43, 'W': 48 }),
    ti('T250 Launch Spec', { '5': 27, '6': 31, '7': 35, '8': 39, '9': 43, 'PW': 47, 'W': 52 }),
    ti('T350', { '4': 20, '5': 23, '6': 26, '7': 29, '8': 33, '9': 38, 'PW': 43, 'W': 48, 'W2': 53 }),
    ti('620 CB', { '3': 21, '4': 24, '5': 27, '6': 31, '7': 35, '8': 39, '9': 43, 'PW': 47 }),
    ti('620 MB', { '3': 21, '4': 24, '5': 27, '6': 31, '7': 35, '8': 39, '9': 43, 'PW': 47 }),
    {
      name: 'G730', brand: 'PING', source: 'https://ping.com/en-us/golf-clubs/irons/g730-iron',
      clubs: [
        { label: '5-iron', loft: 21.5, length: 38.5 }, { label: '6-iron', loft: 24.5, length: 37.75 },
        { label: '7-iron', loft: 28, length: 37 }, { label: '8-iron', loft: 32, length: 36.5 },
        { label: '9-iron', loft: 36, length: 36 }, { label: 'W (40°)', loft: 40, length: 35.5 },
        { label: 'U (45°)', loft: 45, length: 35.5 }, { label: '50° wedge', loft: 50, length: 35.5 },
        { label: '56° wedge', loft: 56, length: 35.25 }
      ]
    },
    {
      name: 'Blueprint T', brand: 'PING', source: 'https://ping.com/en-us/golf-clubs/irons/blueprint-t-iron',
      clubs: [
        { label: '3-iron', loft: 19, length: 38.75 }, { label: '4-iron', loft: 22.5, length: 38.25 },
        { label: '5-iron', loft: 26, length: 37.75 }, { label: '6-iron', loft: 29.5, length: 37.25 },
        { label: '7-iron', loft: 33, length: 36.75 }, { label: '8-iron', loft: 37, length: 36.25 },
        { label: '9-iron', loft: 41, length: 35.75 }, { label: 'Pitching wedge', loft: 45, length: 35.5 }
      ]
    }
  ];

  // The GolfWorks published men's steel standard, for the "vs standard" column.
  var STD_LEN = {
    '2-iron': 39.5, '3-iron': 39.0, '4-iron': 38.5, '5-iron': 38.0, '6-iron': 37.5,
    '7-iron': 37.0, '8-iron': 36.5, '9-iron': 36.0, 'Pitching wedge': 35.5,
    'Gap wedge': 35.375, 'Sand wedge': 35.25, 'Lob wedge': 35.25
  };

  // Observed across the nine published iron sets on the loft page: consecutive
  // lofts step by 2° at the tightest and 6° at the widest. Outside that band is
  // wider or tighter than any maker spaces their own set.
  var GAP_TIGHT = 2, GAP_WIDE = 6;

  // ------------------------------------------------------- club picker ---
  // Typing a loft is the highest-friction thing on the page, and most golfers do
  // not know their lofts to begin with. So every club can be added by tapping it,
  // landing on a starting number the reader then nudges.
  //
  // Those starting numbers are NOT invented "standards" — this site's own finding
  // is that no standard exists. Irons take the MEDIAN of what the published sets
  // above actually list for that club, computed at runtime so it stays true as
  // sets are added. Everything else takes a figure a manufacturer publishes, noted
  // per club. Wedges use their stamped loft, which is the one number a golfer
  // reliably knows because it is printed on the sole.

  function median(nums) {
    if (!nums.length) return null;
    var s = nums.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    var v = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    return Math.round(v * 2) / 2; // published lofts move in half degrees
  }

  // Pull every published value for a given iron label out of SETS.
  function publishedLofts(label) {
    var out = [];
    SETS.forEach(function (set) {
      set.clubs.forEach(function (c) { if (c.label === label && typeof c.loft === 'number') out.push(c.loft); });
    });
    return out;
  }

  function ironDefault(label) {
    var vals = publishedLofts(label);
    if (!vals.length) return null;
    return {
      loft: median(vals),
      low: Math.min.apply(null, vals),
      high: Math.max.apply(null, vals),
      count: vals.length,
      basis: 'median of ' + vals.length + ' published sets'
    };
  }

  // Non-iron starting points, each a figure the maker publishes. Sources are the
  // same pages cited on the loft, length and putter pages.
  var OTHER = {
    'Driver':       { loft: 10.5, low: 8,  high: 12, basis: 'Titleist publish 8-12 degrees across the GT line', length: 45 },
    '3-wood':       { loft: 15,   low: 13.5, high: 16.5, basis: 'Titleist GT1 and GTS2 both publish 15 degrees', length: 43 },
    '5-wood':       { loft: 18,   low: 16.5, high: 21, basis: 'Titleist publish 18 degrees', length: 42 },
    '7-wood':       { loft: 21,   low: 21, high: 24, basis: 'Titleist publish 21 degrees', length: 41.5 },
    'Hybrid':       { loft: 21,   low: 18, high: 29, basis: 'Titleist hybrids publish 18-29 degrees', length: 40 },
    'Gap wedge':    { loft: 50,   low: 46, high: 54, basis: 'commonly stamped 50 or 52', length: 35.5 },
    'Sand wedge':   { loft: 56,   low: 54, high: 58, basis: 'commonly stamped 54 to 58', length: 35.25 },
    'Lob wedge':    { loft: 60,   low: 58, high: 64, basis: 'commonly stamped 58 to 60', length: 35.25 },
    'Putter':       { loft: 3,    low: 2,  high: 4,  basis: 'Titleist, Odyssey and PING all publish about 3 degrees', length: 34 }
  };

  // The order a bag is actually carried in.
  var PICKER = [
    'Driver', '3-wood', '5-wood', '7-wood', 'Hybrid',
    '3-iron', '4-iron', '5-iron', '6-iron', '7-iron', '8-iron', '9-iron',
    'Pitching wedge', 'Gap wedge', 'Sand wedge', 'Lob wedge', 'Putter'
  ];

  function defaultFor(label) {
    if (Object.prototype.hasOwnProperty.call(OTHER, label)) {
      var o = OTHER[label];
      return { loft: o.loft, low: o.low, high: o.high, basis: o.basis, length: o.length };
    }
    var d = ironDefault(label);
    if (!d) return { loft: null, low: null, high: null, basis: 'no published figure', length: standardLength(label) };
    d.length = standardLength(label);
    return d;
  }

  // ------------------------------------------------------------- storage ---
  function blank() {
    return { v: VERSION, updated: null, setName: null, clubs: [], fit: {} };
  }

  function load() {
    try {
      var raw = root.localStorage.getItem(KEY);
      if (!raw) return blank();
      var b = JSON.parse(raw);
      if (!b || b.v !== VERSION || !Array.isArray(b.clubs)) return blank();
      return b;
    } catch (e) {
      // Private mode, blocked storage, or corrupt JSON — behave as if empty
      // rather than throwing and taking the page down with us.
      return blank();
    }
  }

  function save(bag, today) {
    bag.v = VERSION;
    bag.updated = today || bag.updated;
    try {
      root.localStorage.setItem(KEY, JSON.stringify(bag));
      return true;
    } catch (e) {
      return false;
    }
  }

  function clear() {
    try { root.localStorage.removeItem(KEY); return true; } catch (e) { return false; }
  }

  function available() {
    try {
      root.localStorage.setItem(KEY + '-probe', '1');
      root.localStorage.removeItem(KEY + '-probe');
      return true;
    } catch (e) { return false; }
  }

  // ----------------------------------------------------------- analysis ---
  // Plausible loft range for anything you could carry: a strong driver sits near
  // 7 degrees, the weakest lob wedges reach the mid 60s. The HTML input carries
  // max="72" but browsers do not enforce max while typing, so a mistyped 900 would
  // otherwise sail through and render an "867 degrees wide" gap.
  var LOFT_MIN = 5, LOFT_MAX = 75;

  function loftOf(c) {
    // Coerce rather than type-check: a bag restored from storage, or imported
    // later, can carry "33" as a string and those clubs must not vanish silently.
    var n = typeof c.loft === 'number' ? c.loft : parseFloat(c.loft);
    return isNaN(n) ? null : n;
  }

  function validLoft(c) {
    var n = loftOf(c);
    return n !== null && n >= LOFT_MIN && n <= LOFT_MAX;
  }

  // Sorted by loft, because the name is the part that is not standardised.
  function analyse(clubs) {
    var outOfRange = clubs.filter(function (c) {
      var n = loftOf(c);
      return n !== null && (n < LOFT_MIN || n > LOFT_MAX);
    });

    var withLoft = clubs.filter(validLoft)
      .map(function (c) { return { label: c.label, loft: loftOf(c), length: c.length }; })
      .sort(function (a, b) { return a.loft - b.loft; });

    var gaps = [], wide = 0, tight = 0, biggest = null;
    for (var i = 0; i < withLoft.length - 1; i++) {
      var g = Math.round((withLoft[i + 1].loft - withLoft[i].loft) * 10) / 10;
      var state = 'ok';
      if (g > GAP_WIDE) { state = 'wide'; wide++; if (!biggest || g > biggest.gap) biggest = { gap: g, from: withLoft[i], to: withLoft[i + 1] }; }
      else if (g < GAP_TIGHT) { state = 'tight'; tight++; }
      gaps.push({ from: withLoft[i], to: withLoft[i + 1], gap: g, state: state });
    }

    return {
      sorted: withLoft, gaps: gaps, wide: wide, tight: tight, biggest: biggest,
      counted: clubs.length, withLoft: withLoft.length,
      outOfRange: outOfRange
    };
  }

  function standardLength(label) {
    return Object.prototype.hasOwnProperty.call(STD_LEN, label) ? STD_LEN[label] : null;
  }

  root.MMBag = {
    KEY: KEY, VERSION: VERSION, SETS: SETS,
    GAP_TIGHT: GAP_TIGHT, GAP_WIDE: GAP_WIDE, LOFT_MIN: LOFT_MIN, LOFT_MAX: LOFT_MAX,
    blank: blank, load: load, save: save, clear: clear, available: available,
    analyse: analyse, standardLength: standardLength, ironLabel: ironLabel,
    PICKER: PICKER, defaultFor: defaultFor, publishedLofts: publishedLofts
  };
})(window);
