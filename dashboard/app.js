// Launch Radar's page. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, its filters, a per-protocol detail panel with the model's own arithmetic and
// the protocol's farm plan, and the live-token set aside. No network: every byte it shows is in
// data.js, and the farm plans it renders are the very strings board.json carries.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', verdict: 'all', wl: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtMoney(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var sign = n < 0 ? '-' : '';
    var a = Math.abs(n);
    return sign + '$' + (a >= 100 ? String(Math.round(a)) : a.toFixed(2));
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // The model in one function: the page refits nothing, but it re-reads a row's implied value off
  // the published curve from the row's raw figures — TVL, seven-day change, age — with the same
  // constants data.js carries, so the number on screen and the number in board.json are visibly
  // the same arithmetic, to the dollar.
  function impliedOf(row) {
    var curve = DATA.curve;
    var m = DATA.model;
    var base = Math.pow(10, curve.intercept + curve.slope * Math.log10(Math.max(1, row.tvl_usd)));
    var growthPct = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growthPct / 100) * m.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturityMult = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    return Math.max(1, Math.round(base * row.category_factor * growthMult * maturityMult));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('verdict')) state.verdict = params.get('verdict');
    if (params.get('wl') === '1') state.wl = true;
    if (params.get('tab') === 'live') state.tab = 'live';
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.verdict !== 'all') params.set('verdict', state.verdict);
    if (state.wl) params.set('wl', '1');
    if (state.tab === 'live') params.set('tab', 'live');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.wl && !r.on_watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'net') { av = a.net_usd; bv = b.net_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark' }),
        el('span', { class: 'brand-name' }, 'Launch ', el('em', { text: 'Radar' }))
      ),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index, sealed' }),
        el('span', { text: DATA.model_version })
      )
    );
  }

  function lede() {
    var c = DATA.verdict_counts;
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', null,
          DATA.board_size + ' protocols that record no token, ranked by ',
          el('span', { class: 'hl', text: 'what their launch would be worth' })
        ),
        el('p', { text: 'Every protocol here records no token on DefiLlama — that is a record, not a proof, and the board says so. The watchlist of ' + DATA.watchlist_size + ' protocols at or above ' + fmtUsd(DATA.floor_usd) + ' of TVL is the floor, not the ceiling: the radar also ranks ' + DATA.early_size + ' early protocols below it, and nets every farm plan to a verdict before it asks for your time.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', null, DATA.watchlist_size + ' / ' + DATA.watchlist_size)),
        el('div', { class: 'fact' }, el('span', { text: 'Rows ranked' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Verdicts: farm' }), el('b', null, el('i', { text: String(c.farm) }), ' farm · ' + c.thin + ' thin')),
        el('div', { class: 'fact' }, el('span', { text: 'Blind test, median miss' }), el('b', { text: 'x' + DATA.blind.median_multiple.toFixed(2) }))
      )
    );
  }

  function methodPanel() {
    var m = DATA.model;
    var curve = DATA.curve;
    return el('section', { class: 'method' },
      el('div', null,
        el('h2', { text: 'How the number is made' }),
        el('p', { text: 'The snapshot\'s own ' + curve.comps + ' tokenised protocols are the only guide: they are what the market actually paid for TVL like this (median ' + curve.median_ratio.toFixed(2) + 'x TVL). A size curve is fitted to them — log10(market cap) on log10(TVL), slope ' + curve.slope.toFixed(2) + ' — with a per-category correction, and each pre-token protocol is read off it, moved by its seven-day growth and by how long it has run with no token. Pass-through staking books are left out of the fit: their TVL is other people\'s assets, and their tokens price a fee sliver, not the pile.' }),
        el('div', { class: 'formula', text: 'implied = 10^(' + curve.intercept.toFixed(2) + ' + ' + curve.slope.toFixed(2) + ' x log10 TVL) x category x (1 + clamp(7d, ' + m.growth_floor + ', ' + m.growth_cap + ') x ' + m.growth_weight + ') x maturity(age)' }),
        el('p', { text: 'Tested blind before it is trusted: the comps are split in two by slug, each half priced by a curve fitted on the other half alone. Median miss x' + DATA.blind.median_multiple.toFixed(2) + '; ' + DATA.blind.within_2x_pct + '% of blind readings land within x2 of the real market cap. Wide — which is why every row shows its working, and why the board ranks rather than promises.' })
      ),
      el('div', { class: 'legend' },
        el('div', null, el('span', { class: 'chip farm', text: 'FARM' }), el('span', { text: 'the modelled slice clears the plan\'s all-in cost by $20 or more' })),
        el('div', null, el('span', { class: 'chip thin', text: 'THIN' }), el('span', { text: 'above water, barely: farm it only if you would use the product anyway' })),
        el('div', null, el('span', { class: 'chip skip', text: 'SKIP' }), el('span', { text: 'the costs beat the slice — usually a small wallet in a giant protocol' })),
        el('p', { class: 'sub', text: 'The netting supposes a launch hands ' + m.user_share_pct + '% of its implied value to users — half split evenly among qualifying wallets, half pro-rata to the farmed quarter of TVL — and charges the plan its gas at the cheapest chain the protocol runs on, plus ' + m.yield_apr_pct + '% a year on the capital while held.' })
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var verdict = el('select', { id: 'verdict', 'aria-label': 'Filter by farm verdict' },
      el('option', { value: 'all', text: 'All verdicts' }),
      ['farm', 'thin', 'skip'].map(function (v) {
        return el('option', { value: v, text: v[0].toUpperCase() + v.slice(1) + ' (' + DATA.verdict_counts[v] + ')', selected: v === state.verdict ? 'selected' : null });
      })
    );
    verdict.addEventListener('change', function () { state.verdict = verdict.value; writeHash(); render(); });
    var wlBox = el('input', { type: 'checkbox', id: 'wl', 'aria-label': 'Watchlist only' });
    if (state.wl) wlBox.setAttribute('checked', 'checked');
    wlBox.addEventListener('change', function () { state.wl = wlBox.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    var shown = state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Farm verdict' }), verdict),
      el('div', { class: 'field check' }, wlBox, el('label', { for: 'wl', text: 'Watchlist only' })),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: shown })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search, widen the verdict, or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.verdict = 'all'; state.wl = false; writeHash(); render(); } })
      ));
    }
    var max = 0;
    DATA.rows.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }, r.on_watchlist ? el('span', { class: 'wl', text: 'WATCHLIST' }) : null),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num ' + (r.net_usd >= 0 ? 'net-pos' : 'net-neg'), text: fmtMoney(r.net_usd) }),
        el('td', null, el('span', { class: 'chip ' + r.verdict, text: r.verdict.toUpperCase() }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols, strongest implied launch value first. Net is the farm plan\'s modelled slice minus its all-in cost. Select a row for its reading and its plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'No token for'),
            sortHeader('implied', 'Implied value'),
            sortHeader('net', 'Farm net'),
            el('th', { scope: 'col', text: 'Verdict' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'chip live', text: 'LIVE' })),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.symbol || '' })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Already trading: these protocols have a token, so their market cap is a fact, not a model. They are the comps the curve was fitted on, set aside from the pre-token ranking — the largest ' + DATA.live.length + ' shown.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'Symbol' })
          )),
          tbody
        )
      )
    );
  }

  var panel = el('aside', { class: 'detail', id: 'detail', 'aria-label': 'Protocol detail' });

  function closeDetail() {
    state.selected = null;
    panel.className = 'detail';
    panel.textContent = '';
    writeHash();
    render();
  }

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    panel.textContent = '';
    var recomputed = impliedOf(row);
    panel.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { text: row.name }),
        el('span', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + (row.on_watchlist ? ' · on the watchlist' : ' · early, below the watchlist floor') })
      ),
      el('button', { class: 'button close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: closeDetail })
    ));
    panel.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'The reading' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Curve value at this TVL' }), el('b', { text: fmtUsd(row.curve_value_usd) })),
        el('div', null, el('span', { text: 'Category factor' }), el('b', { text: 'x' + row.category_factor.toFixed(2) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { text: fmtPct(row.change_7d) + ' (x' + row.growth_multiplier.toFixed(2) + ')' })),
        el('div', null, el('span', { text: 'No token for' }), el('b', { text: fmtAge(row.age_days) + ' (x' + row.maturity_multiplier.toFixed(2) + ')' })),
        el('div', null, el('span', { text: 'Listed since' }), el('b', { text: row.listed_at || 'unrecorded' })),
        el('div', { class: 'wide' }, el('span', { text: 'Implied launch value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'The page re-reads this row off the published curve as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ' — the same number board.json carries.' : ' — which differs from the board: the data would be stale.') + ' An implied value is this board\'s own claim about a launch that may never happen, not a price and not a promise.' })
    ));
    panel.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'The farm, netted' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Position' }), el('b', { text: fmtUsd(row.capital_usd) })),
        el('div', null, el('span', { text: 'Modelled slice if it launches' }), el('b', { text: fmtMoney(row.slice_usd) })),
        el('div', null, el('span', { text: 'All-in cost' }), el('b', { text: fmtMoney(row.cost_usd) })),
        el('div', null, el('span', { text: 'Net' }), el('b', { text: fmtMoney(row.net_usd) }))
      ),
      el('div', { class: 'verdict-line' },
        el('span', { class: 'chip ' + row.verdict, text: row.verdict.toUpperCase() }),
        el('p', { text: row.verdict === 'farm' ? 'The slice clears the cost with room. Work the plan below from one wallet, on schedule.' : row.verdict === 'thin' ? 'Above water by a little. Worth it if the product itself is useful to you; not on the maths alone.' : 'The cost beats the slice at this size. A bigger position, or a smaller protocol, changes the answer — this one does not.' })
      )
    ));
    panel.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, row.steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), tail ? el('span', { class: 'cost', text: tail }) : null);
      }))
    ));
    panel.className = 'detail open';
    if (!panel.isConnected) app.appendChild(panel);
  }

  function render() {
    var keepPanel = state.selected;
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(methodPanel());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    shell.appendChild(el('p', { class: 'foot', text: 'Data: the sealed DefiLlama snapshot of ' + DATA.as_of + ', read once and never updated. "Records no token" is DefiLlama\'s record, not proof a token does not exist. Implied values are this entry\'s own model, stated in full above; a launch may never happen, and a farm plan is a costed suggestion, not advice.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (keepPanel) openDetail(keepPanel);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) closeDetail();
  });
})();
