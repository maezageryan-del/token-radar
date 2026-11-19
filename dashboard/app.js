'use strict';
/* Launch Radar — renders entirely from window.__RADAR__ (data.js). No network. */
var D = window.__RADAR__;
var M = D.model;
var state = { verdict: 'ALL', watch: false, cat: '', chain: '', q: '', plan: 2500, sort: 'rank', dir: 1, detail: null };

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmt$(x) {
  if (x == null || !isFinite(x)) return '—';
  var a = Math.abs(x);
  if (a >= 1e9) return '$' + (x / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (x / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return '$' + (x / 1e3).toFixed(1) + 'K';
  if (a < 10) return '$' + x.toFixed(2);
  return '$' + x.toFixed(0);
}
function fmtFull(x) { return '$' + Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function fmtPct(x) { if (x == null) return '—'; return (x > 0 ? '+' : '') + x.toFixed(1) + '%'; }
function fmtAge(d) { if (d == null) return '—'; if (d >= 730) return (d / 365).toFixed(1) + ' yr'; if (d >= 60) return Math.round(d / 30.4) + ' mo'; return d + ' d'; }
function fmtH(h) { return h.toFixed(1) + ' h'; }

/* Same netting as the board: pool = share x implied; farmed = 25% of TVL;
   wallets = farmed / 250; drop = pool x (0.5/wallets + 0.5 x capital/farmed);
   fees = steps x cheapest-chain gas + 4.60; opportunity = 5%/yr over the hold. */
function netAt(r, cap, share) {
  var pool = share * r.implied_value_usd;
  var farmed = 0.25 * r.tvl_usd;
  var wallets = farmed / 250;
  var drop = pool * (0.5 / wallets + 0.5 * cap / farmed);
  var fees = r.n_steps * r.gas_usd + 4.60;
  var opp = cap * 0.05 * r.hold_days / 365;
  var net = drop - fees - opp;
  return { pool: pool, drop: drop, fees: fees, opp: opp, net: net, nph: net / r.hours, verdict: net >= 25 ? 'FARM' : net > 0 ? 'THIN' : 'SKIP' };
}

var app = document.getElementById('app');

function headerHTML() {
  var s = D.stats, t = D.tests;
  return '<header class="top"><div class="brandrow"><h1><span class="brand">Launch Radar</span> — a field guide to pre-token protocols</h1></div>' +
    '<div class="tagline">Snapshot <b>' + esc(D.as_of) + '</b> · <b>' + s.protocols_read + ' protocols read</b> · no network · no hand-picked names · model <b>' + esc(M.version) + '</b> fitted from the snapshot at run time</div></header>' +
    '<div class="stats">' +
    stat('Ranked', s.ranked) + stat('Watchlist covered', s.watchlist_covered + '/40') +
    stat('Total implied', fmt$(s.total_implied_usd)) +
    stat('Held-out miss (5-fold, full reading)', '×' + t.cross_validation.median_miss.toFixed(2)) +
    stat('Range holds', t.band_holds_pct.toFixed(0) + '%') +
    stat('Best net', fmt$(s.best_net_per_hour_usd) + '/hour') + '</div>' +
    '<div class="formula"><span class="f">implied = 10^(' + M.intercept.toFixed(3) + ' + ' + M.slope.toFixed(3) + ' · log10 TVL) × (1 + clamp(7d%, −50, 100) × 0.0035) × (0.82 + 0.28 · min(age, 1095d)/1095)</span><br>' +
    '<span class="note">Size curve fitted by least squares on ' + M.comps + ' traded stand-alone protocols. Category factors are measured (see rail) and left out — blind tests say they earn nothing. Bands are ± the pooled 75th-percentile held-out log miss (×' + Math.pow(10, M.band_half_log10).toFixed(1) + '); rank ranges are the p10–p90 across 200 bootstrap refits.</span></div>';
}
function stat(k, v) { return '<div class="stat"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'; }

var SEG_COLORS = { ranked: '#0e6b5c', 'live-token': '#c9bfa8', bridge: '#7d7462', 'liquid staking or restaking': '#a2967d', 'exchange custody': '#574f3f', 'versioned release': '#b3a888', 'wrapped-or-staked name': '#948a70', 'no positive TVL': '#e0d8c4' };
function coverHTML() {
  var total = 0, k; for (k in D.accounting) total += D.accounting[k];
  var bar = '', lbl = '';
  for (k in D.accounting) {
    var n = D.accounting[k]; if (!n) continue;
    bar += '<div class="seg" style="background:' + SEG_COLORS[k] + ';width:' + (100 * n / total).toFixed(2) + '%"></div>';
    lbl += '<span><span class="sw" style="background:' + SEG_COLORS[k] + '"></span>' + esc(k) + ' ' + n + '</span>';
  }
  return '<div class="cover"><div class="bar">' + bar + '</div><div class="lbls">' + lbl + '</div></div>';
}

function enriched() {
  return D.rows.map(function (r) { var n = netAt(r, state.plan, 0.10); return { r: r, n: n }; });
}
function verdictCounts(list) {
  var c = { ALL: list.length, FARM: 0, THIN: 0, SKIP: 0 };
  list.forEach(function (e) { c[e.n.verdict]++; });
  return c;
}
function filtersHTML(counts) {
  var cats = {}, chains = {};
  D.rows.forEach(function (r) { if (r.category) cats[r.category] = 1; r.chains.forEach(function (c) { chains[c] = 1; }); });
  var h = '<div class="filters">';
  ['ALL', 'FARM', 'THIN', 'SKIP'].forEach(function (v) {
    h += '<button class="chip' + (state.verdict === v ? ' on' : '') + '" data-v="' + v + '">' + v.charAt(0) + v.slice(1).toLowerCase() + ' <span class="n">' + counts[v] + '</span></button>';
  });
  h += '<button class="chip' + (state.watch ? ' on' : '') + '" id="watchBtn">Watchlist only</button>';
  h += '<label>Category <select id="catSel"><option value="">All</option>' + Object.keys(cats).sort().map(function (c) { return '<option' + (state.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>';
  h += '<label>Chain <select id="chainSel"><option value="">All</option>' + Object.keys(chains).sort().map(function (c) { return '<option' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>';
  h += '<label>Plan <select id="planSel">' + [1000, 2500, 10000].map(function (p) { return '<option value="' + p + '"' + (state.plan === p ? ' selected' : '') + '>$' + p.toLocaleString('en-US') + '</option>'; }).join('') + '</select></label>';
  h += '<input type="search" id="q" placeholder="Search name or slug" value="' + esc(state.q) + '">';
  return h + '</div>';
}

var SORTKEYS = { rank: function (e) { return e.r.rank; }, tvl: function (e) { return e.r.tvl_usd; }, chg: function (e) { return e.r.change_7d == null ? -1e9 : e.r.change_7d; }, age: function (e) { return e.r.age_days; }, val: function (e) { return e.r.implied_value_usd; }, net: function (e) { return e.n.net; }, nph: function (e) { return e.n.nph; } };
function visible() {
  var list = enriched();
  var q = state.q.trim().toLowerCase();
  list = list.filter(function (e) {
    var r = e.r;
    if (state.verdict !== 'ALL' && e.n.verdict !== state.verdict) return false;
    if (state.watch && !r.watchlist) return false;
    if (state.cat && r.category !== state.cat) return false;
    if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
    if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
    return true;
  });
  var f = SORTKEYS[state.sort];
  list.sort(function (a, b) { var d = f(a) - f(b); return (d === 0 ? a.r.rank - b.r.rank : d) * state.dir; });
  return list;
}
function th(key, label, cls) {
  var arrow = state.sort === key ? (state.dir === 1 ? ' ↑' : ' ↓') : '';
  return '<th class="' + (cls || '') + '" data-sort="' + key + '">' + label + arrow + '</th>';
}
function tableHTML(list) {
  var h = '<div class="count">Showing ' + list.length + ' of ' + D.rows.length + ' ranked protocols · nets at a ' + fmtFull(state.plan) + ' plan · click a row for the full build-up</div>';
  h += '<table class="board"><thead><tr>' + th('rank', 'Rank') + th('rank', 'Protocol', 'l') + th('tvl', 'TVL') + th('chg', '7d') + th('age', 'Tracked') + th('val', 'Implied value') + th('net', 'Net') + th('nph', '$/hour') + '<th>Verdict</th></tr></thead><tbody>';
  list.forEach(function (e) {
    var r = e.r, n = e.n;
    h += '<tr data-slug="' + esc(r.slug) + '"><td>' + r.rank + '<span class="sub">' + r.rank_low + '–' + r.rank_high + '</span></td>' +
      '<td class="l"><span class="nm">' + esc(r.name) + '</span>' + (r.watchlist ? '<span class="wtag">WATCHLIST</span>' : '') + '<span class="meta">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains[0] || '') + '</span></td>' +
      '<td>' + fmt$(r.tvl_usd) + '</td>' +
      '<td class="' + (r.change_7d == null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') + '">' + fmtPct(r.change_7d) + '</td>' +
      '<td>' + fmtAge(r.age_days) + '</td>' +
      '<td>' + fmt$(r.implied_value_usd) + '<span class="sub">' + fmt$(r.band_low_usd) + ' – ' + fmt$(r.band_high_usd) + '</span></td>' +
      '<td>' + fmt$(n.net) + '</td><td>' + fmt$(n.nph) + '</td>' +
      '<td><span class="vchip v' + n.verdict + '">' + n.verdict + '</span></td></tr>';
  });
  return h + '</tbody></table>';
}
function railHTML() {
  var t = D.tests, a = D.ablation, b = D.basket;
  function trow(name, x) { return '<tr><td class="l">' + name + '</td><td>×' + x.median_miss.toFixed(2) + '</td><td>' + x.within2_pct.toFixed(0) + '%</td><td>' + x.n + '</td></tr>'; }
  var h = '<div class="rail"><section><h2>Out-of-sample tests</h2><table><tr><th class="l">Test</th><th>Median miss</th><th>Within ×2</th><th>n</th></tr>' +
    trow('Blind split (2-fold)', t.blind) + trow('Cross-validation (5-fold)', t.cross_validation) +
    trow('Time split (old → new)', t.time_split) + trow('Walk-forward (5 windows)', t.walk_forward) +
    trow('Flat multiple baseline', t.baseline) + '</table>' +
    '<p class="small">Every test prices held-out traded protocols with the full reading — curve refit on the training part only, growth and maturity at their fixed constants. The flat baseline (median market-cap/TVL × TVL) is beaten on every split. Bands hold ' + t.band_holds_pct.toFixed(0) + '% of held-out comps, as a 75th-percentile band should.</p></section>';
  h += '<section><h2>Ablation — 5-fold miss</h2><table>' +
    '<tr><td class="l">Full reading</td><td>×' + a.full.median_miss.toFixed(2) + '</td></tr>' +
    '<tr><td class="l">Growth off</td><td>×' + a.growth_off.median_miss.toFixed(2) + '</td></tr>' +
    '<tr><td class="l">Maturity off</td><td>×' + a.maturity_off.median_miss.toFixed(2) + '</td></tr>' +
    '<tr><td class="l">Category factors on</td><td>×' + a.category_on.median_miss.toFixed(2) + '</td></tr></table>' +
    '<p class="small">Category factors measured but not applied: ' + Object.keys(M.category_factors).sort().map(function (c) { return esc(c) + ' ×' + M.category_factors[c].toFixed(2); }).join(' · ') + '.</p></section>';
  h += '<section class="basket"><h2>Farm basket — $10,000</h2><p class="small">Greedy by net per dollar over FARM rows at the standard plan.</p>';
  b.rows.forEach(function (x) { h += '<div class="brow"><span>' + esc(x.name) + '</span><span>' + fmtFull(x.capital_usd) + ' → ' + fmt$(x.net_usd) + '</span></div>'; });
  h += '<div class="brow tot"><span>Total</span><span>' + fmtFull(b.total_capital_usd) + ' → ' + fmt$(b.total_net_usd) + ' · ' + b.total_hours.toFixed(1) + ' h</span></div></section></div>';
  return h;
}

function detailHTML(r) {
  var n = netAt(r, state.plan, 0.10);
  var cautious = netAt(r, state.plan, 0.05);
  var h = '<div class="overlay" id="ovl"></div><div class="detail"><button class="x" id="closeBtn">×</button>' +
    '<h1>' + esc(r.name) + '</h1><div class="tagline">Rank <b>#' + r.rank + '</b> (bootstrap p10–p90: ' + r.rank_low + '–' + r.rank_high + ', verdict stable in ' + r.verdict_stability_pct.toFixed(0) + '% of refits) · ' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ')) + (r.watchlist ? ' · <b>watchlist</b>' : '') + '</div>' +
    '<h2>How the value is built</h2><table>' +
    '<tr><td class="l">TVL (snapshot)</td><td>' + fmtFull(r.tvl_usd) + '</td></tr>' +
    '<tr><td class="l">Size curve 10^(' + M.intercept.toFixed(3) + ' + ' + M.slope.toFixed(3) + ' · log10 TVL)</td><td>' + fmtFull(r.curve_value_usd) + '</td></tr>' +
    '<tr><td class="l">× growth (7d ' + fmtPct(r.change_7d) + ')</td><td>×' + r.growth_mult.toFixed(3) + '</td></tr>' +
    '<tr><td class="l">× maturity (tracked ' + fmtAge(r.age_days) + ')</td><td>×' + r.maturity_mult.toFixed(3) + '</td></tr>' +
    '<tr class="tot"><td class="l">Implied value if it launches</td><td>' + fmtFull(r.implied_value_usd) + '</td></tr></table>' +
    '<p class="note">Value band ' + fmtFull(r.band_low_usd) + ' – ' + fmtFull(r.band_high_usd) + ' (pooled 75th-percentile held-out log miss, ×' + Math.pow(10, M.band_half_log10).toFixed(1) + ').</p>' +
    '<h2>Nearest traded comparables</h2><table><tr><th class="l">Protocol</th><th>TVL</th><th>Market cap</th></tr>' +
    r.nearest_comps.map(function (c) { return '<tr><td class="l">' + esc(c.name) + '</td><td>' + fmtFull(c.tvl_usd) + '</td><td>' + fmtFull(c.mcap_usd) + '</td></tr>'; }).join('') + '</table>' +
    '<h2>Farm economics — ' + fmtFull(state.plan) + ' plan</h2><table>' +
    '<tr><td class="l">User pool (10% of implied)</td><td>' + fmtFull(n.pool) + '</td></tr>' +
    '<tr><td class="l">Expected drop to this plan</td><td>' + fmtFull(n.drop) + '</td></tr>' +
    '<tr><td class="l">Fees (' + r.n_steps + ' steps on ' + esc(r.gas_chain) + ' at ' + fmt$(r.gas_usd) + ' + $4.60 ramp)</td><td>−' + fmtFull(n.fees) + '</td></tr>' +
    '<tr><td class="l">Opportunity cost (5%/yr × ' + r.hold_days + ' days)</td><td>−' + fmtFull(n.opp) + '</td></tr>' +
    '<tr class="tot"><td class="l">Net</td><td>' + fmtFull(n.net) + ' · ' + fmt$(n.nph) + '/hour over ' + r.hours.toFixed(1) + ' h</td></tr></table>' +
    '<p class="note">Verdict <b>' + n.verdict + '</b> at this plan (FARM ≥ $25 net, THIN &gt; $0). Cautious scenario (5% user pool): net ' + fmtFull(cautious.net) + '. Break-even: the drop must cover ' + fmtFull(n.fees + n.opp) + ' of fees and forgone yield.</p>' +
    '<h2>Sensitivity — net by user share × plan</h2><table class="sens"><tr><th class="l">Share</th><th>$1,000</th><th>$2,500</th><th>$10,000</th></tr>';
  [0.035, 0.07, 0.14].forEach(function (sh) {
    h += '<tr><td class="l">' + (sh * 100).toFixed(1) + '%</td>';
    [1000, 2500, 10000].forEach(function (cap) {
      var cell = r.sensitivity[String(sh)][String(cap)];
      h += '<td class="' + (cell.verdict === 'FARM' ? 'hot' : '') + '">' + fmt$(cell.net_usd) + ' ' + cell.verdict + '</td>';
    });
    h += '</tr>';
  });
  h += '</table><h2>Farm plan — ' + r.farm_steps.length + ' steps</h2><ol class="steps">' +
    r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol></div>';
  return h;
}

function render() {
  var counts = verdictCounts(enriched());
  var list = visible();
  app.innerHTML = headerHTML() + coverHTML() + '<div id="filters">' + filtersHTML(counts) + '</div>' +
    '<div class="layout"><div id="board">' + tableHTML(list) + '</div>' + railHTML() + '</div>' +
    '<footer>Launch Radar ' + esc(M.version) + ' · snapshot ' + esc(D.as_of) + ' · every number on this page is recomputed from data.js, which main.ts generates from the same readings as board.json · verdicts: FARM net ≥ $25, THIN net &gt; $0, else SKIP, at the selected plan.</footer>' +
    (state.detail ? detailHTML(state.detail) : '');
  bind();
}
function bind() {
  var f = document.getElementById('filters');
  f.querySelectorAll('[data-v]').forEach(function (b) { b.addEventListener('click', function () { state.verdict = b.getAttribute('data-v'); render(); }); });
  document.getElementById('watchBtn').addEventListener('click', function () { state.watch = !state.watch; render(); });
  document.getElementById('catSel').addEventListener('change', function (e) { state.cat = e.target.value; render(); });
  document.getElementById('chainSel').addEventListener('change', function (e) { state.chain = e.target.value; render(); });
  document.getElementById('planSel').addEventListener('change', function (e) { state.plan = Number(e.target.value); render(); });
  var q = document.getElementById('q');
  q.addEventListener('input', function () { state.q = q.value; document.getElementById('board').innerHTML = tableHTML(visible()); bindBoard(); });
  bindBoard();
  var cb = document.getElementById('closeBtn');
  if (cb) { cb.addEventListener('click', closeDetail); document.getElementById('ovl').addEventListener('click', closeDetail); }
}
function bindBoard() {
  document.querySelectorAll('th[data-sort]').forEach(function (t) {
    t.addEventListener('click', function () {
      var k = t.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === 'rank' ? 1 : -1; }
      render();
    });
  });
  document.querySelectorAll('tr[data-slug]').forEach(function (tr) {
    tr.addEventListener('click', function () {
      var slug = tr.getAttribute('data-slug');
      state.detail = D.rows.filter(function (r) { return r.slug === slug; })[0] || null;
      try { history.replaceState(null, '', '#detail=' + slug); } catch (e) { /* file URLs may refuse */ }
      render();
    });
  });
}
function closeDetail() { state.detail = null; try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* keep the hash */ } render(); }
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.detail) closeDetail(); });

if (location.hash === '#farm') { state.verdict = 'FARM'; state.sort = 'nph'; state.dir = -1; }
if (location.hash.indexOf('#detail=') === 0) {
  var slug = decodeURIComponent(location.hash.slice(8));
  state.detail = D.rows.filter(function (r) { return r.slug === slug; })[0] || null;
}
render();
