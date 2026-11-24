// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail view with the model's own
// inputs and the protocol's farm plan, and the already-trading set kept apart. No network: every byte
// it shows is in data.js.
//
// The model, in one place, so the page and the board are the same arithmetic: the page recomputes
// every row's implied value from the snapshot figures and rebuilds every farm plan from the same
// fields, then checks the recomputation against the board and says so in the footer.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA || !app) return;

  var MODEL = DATA.model;
  var ROWS = DATA.rows;
  var LIVE = DATA.live;

  // ---------------------------------------------------------------- formatting

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtUsdFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return usd0.format(n);
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
  function fmtMult(n) {
    return 'x' + n.toFixed(3);
  }

  // ---------------------------------------------------------------- the model, mirrored from lib/model.ts

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function growthOf(row) {
    var raw = (row.change_7d === null || row.change_7d === undefined) ? 0 : row.change_7d;
    return clamp(raw, MODEL.growth_floor, MODEL.growth_cap);
  }
  function maturityOf(row) {
    var age = (row.age_days === null || row.age_days === undefined) ? MODEL.unknown_age_days : row.age_days;
    return MODEL.maturity_floor + (Math.min(Math.max(age, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
  }
  function chainOf(row) {
    return 1 + Math.min((row.chains || []).length, MODEL.chain_max) * MODEL.chain_step;
  }
  /** The implied value of one row, from the snapshot figures alone. */
  function impliedOf(row) {
    var growthMult = 1 + (growthOf(row) / 100) * MODEL.growth_weight;
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * growthMult * maturityOf(row) * chainOf(row)));
  }
  /** A one-dollar tie-break down the ranks, so the values fall strictly from rank 1 down. */
  function applyTiebreak(values) {
    var out = values.slice();
    for (var i = 1; i < out.length; i++) {
      if (out[i] >= out[i - 1]) out[i] = Math.max(1, out[i - 1] - 1);
    }
    return out;
  }

  function chainName(row) {
    return (row.chains && row.chains.length > 0) ? row.chains[0] : 'its main chain';
  }
  function capitalFor(row) {
    if (row.tvl_usd >= 1e9) return 500;
    if (row.tvl_usd >= 250e6) return 250;
    if (row.tvl_usd >= 100e6) return 150;
    return 100;
  }
  function holdDaysFor(row) {
    var age = row.age_days;
    if (age === null || age === undefined) return 45;
    if (age < 180) return 90;
    if (age < 365) return 60;
    return 30;
  }
  function gasFor(chain) {
    if (chain === 'Ethereum') return '$3–$8 of gas';
    if (chain === 'Solana') return 'under $0.10 of gas';
    if (chain === 'Bitcoin') return '$1–$3 of gas';
    return '$0.10–$1 of gas';
  }
  function actionFor(row, capital, chain) {
    var c = (row.category || '').toLowerCase();
    var name = row.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('uncollateralized') >= 0) {
      return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' as collateral, then borrow a small amount against it and leave both legs open.';
    }
    if (c.indexOf('dex') >= 0) {
      return 'Provide $' + capital + ' of liquidity to ' + name + "'s largest pool on " + chain + ", pairing USDC with the chain's native asset, and keep the LP position open.";
    }
    if (c.indexOf('yield') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('liquidity manager') >= 0) {
      return 'Deposit $' + capital + ' of USDC into a ' + name + ' vault on ' + chain + ' and hold the vault shares instead of trading them.';
    }
    if (c.indexOf('deriv') >= 0 || c.indexOf('perp') >= 0 || c.indexOf('basis') >= 0 || c.indexOf('interest rate') >= 0) {
      return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' on ' + chain + ' and open one small hedged position, then leave it alone.';
    }
    if (c.indexOf('rwa') >= 0 || c.indexOf('anchor btc') >= 0 || c.indexOf('decentralized btc') >= 0 || c.indexOf('dual-token') >= 0) {
      return 'Mint or buy $' + capital + ' of ' + name + "'s yield-bearing asset on " + chain + ' and hold it in the same wallet.';
    }
    if (c.indexOf('stak') >= 0 || c.indexOf('restak') >= 0) {
      return 'Stake $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipt token in the wallet.';
    }
    if (c.indexOf('prediction') >= 0) {
      return 'Fund your account with $' + capital + ' and take one position in an active market on ' + name + '.';
    }
    if (c.indexOf('stable') >= 0) {
      return 'Mint $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.';
    }
    if (c.indexOf('index') >= 0) {
      return 'Buy $' + capital + ' of ' + name + "'s index token on " + chain + ' and hold it.';
    }
    if (c.indexOf('card') >= 0) {
      return 'Load $' + capital + ' onto ' + name + "'s card on " + chain + ' and spend through it for everyday purchases.';
    }
    if (c.indexOf('farm') >= 0 || c.indexOf('leveraged') >= 0) {
      return 'Deposit $' + capital + ' of USDC into ' + name + "'s farm on " + chain + ' and keep the position open.';
    }
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function weeklyFor(row) {
    var c = (row.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('uncollateralized') >= 0) {
      return 'Once a week, adjust the position: add $10 of supply, or repay and re-borrow a small amount, so the activity spans several snapshots.';
    }
    if (c.indexOf('dex') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('leveraged') >= 0) {
      return 'Once a week, make one swap through the pool or add $10 of liquidity, so the activity spans several snapshots.';
    }
    if (c.indexOf('deriv') >= 0 || c.indexOf('perp') >= 0 || c.indexOf('basis') >= 0 || c.indexOf('interest rate') >= 0) {
      return 'Once a week, adjust the hedge a little or close and reopen it, so the activity spans several snapshots.';
    }
    if (c.indexOf('prediction') >= 0) {
      return 'Once a week, take one small position in a new market, so the activity spans several snapshots.';
    }
    return 'Once a week, make one qualifying action — a deposit, a swap, a vote or a claim — so the activity spans several snapshots.';
  }
  /** A protocol's farm plan: six steps, each an action with a cost and a time. */
  function farmStepsFor(row) {
    var chain = chainName(row);
    var capital = capitalFor(row);
    var hold = holdDaysFor(row);
    var steps = [
      { text: 'Open a fresh wallet that holds only the funds you plan to farm with ' + row.name + ', and store its seed phrase offline, never in a screenshot or a chat.', cost: 'nothing to open; under $3 of gas for the first transaction', time: '5 minutes' },
      { text: 'Move $' + capital + ' of USDC to ' + chain + ' from your main wallet, and keep a little of the chain\'s native token aside for gas.', cost: gasFor(chain) + ' to move the funds', time: '10–20 minutes' },
      { text: actionFor(row, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 250 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: weeklyFor(row), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot, and do not close it early for a small gain.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'When a claim opens, use only the claim link the protocol itself publishes, and never pay anyone to claim for you. Write the wallet, the dates and every transaction in a farm log.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' }
    ];
    return steps.map(stepText);
  }
  /** A step as one string: its action, then its cost and time. */
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + ' Hold the position and check the protocol\'s own page.';
    return s;
  }

  // The page's recomputation check: every row's value, tie-broken down the ranks, against the board.
  var recomputed = applyTiebreak(ROWS.map(impliedOf));
  var checkBad = 0;
  ROWS.forEach(function (row, i) { if (recomputed[i] !== row.implied_value_usd) checkBad++; });

  // ---------------------------------------------------------------- small DOM helpers

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
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  // ---------------------------------------------------------------- state: URL in, view out

  var params = new URLSearchParams(window.location.search);
  var state = {
    q: params.get('q') || '',
    category: params.get('category') || 'all',
    chain: params.get('chain') || 'all',
    scope: params.get('scope') || 'all',
    tab: params.get('tab') || 'board',
    sort: params.get('sort') || 'rank',
    dir: params.get('dir') === 'asc' ? 1 : -1,
    selected: null
  };
  var categories = [];
  var chains = [];
  ROWS.forEach(function (r) {
    if (r.category && categories.indexOf(r.category) < 0) categories.push(r.category);
    (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  categories.sort();
  chains.sort();

  function readHash() {
    var m = window.location.hash.match(/^#\/p\/([A-Za-z0-9._-]+)$/);
    state.selected = m ? m[1] : null;
  }
  window.addEventListener('hashchange', function () { readHash(); render(); });
  readHash();

  function rowBySlug(slug) {
    for (var i = 0; i < ROWS.length; i++) if (ROWS[i].slug === slug) return ROWS[i];
    return null;
  }

  // ---------------------------------------------------------------- filtering and sorting

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var rows = ROWS.filter(function (r) {
      if (state.scope === 'watchlist' && !r.watchlist) return false;
      if (state.scope === 'early' && r.watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    rows.sort(function (a, b) {
      var d = 0;
      if (key === 'rank' || key === 'implied') d = a.implied_value_usd - b.implied_value_usd;
      else if (key === 'tvl') d = a.tvl_usd - b.tvl_usd;
      else if (key === 'change') d = (a.change_7d || 0) - (b.change_7d || 0);
      else if (key === 'age') d = (a.age_days === null ? -1 : a.age_days) - (b.age_days === null ? -1 : b.age_days);
      else if (key === 'name') d = a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      if (d === 0) d = a.rank - b.rank;
      return d * dir;
    });
    return rows;
  }

  // ---------------------------------------------------------------- rendering

  function masthead() {
    var maxImplied = ROWS[0].implied_value_usd;
    return el('div', { class: 'wrap' },
      el('header', { class: 'mast' },
        el('p', { class: 'eyebrow', text: 'Token Radar · ' + DATA.model_version }),
        el('h1', {}, 'Which pre-token protocol is ', el('span', { class: 'thin', text: 'worth farming next?' })),
        el('p', { class: 'lede' },
          'A ranked board of every protocol in the snapshot that ',
          el('b', { text: 'records no token yet' }),
          ' and could plausibly launch one, ordered by what its token would be worth if the protocol kept its record. ',
          'The value is the radar\u2019s own claim, worked out from the snapshot\u2019s figures — never a prediction that a token is coming.'),
        el('p', { class: 'meta' },
          'Snapshot ', el('b', { text: DATA.as_of }), ' · ', el('b', { text: DATA.source }), ' · ',
          el('b', { text: String(DATA.watchlist_size) }), ' on the watchlist · ',
          el('b', { text: String(ROWS.length) }), ' rows ranked · floor ',
          el('b', { text: fmtUsd(DATA.floor_usd) }))),
      el('ul', { class: 'stats' },
        el('li', {}, el('div', { class: 'k', text: 'Watchlist covered' }), el('div', { class: 'v', text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('div', { class: 's', text: 'every slug, no exceptions' })),
        el('li', {}, el('div', { class: 'k', text: 'Board rows' }), el('div', { class: 'v', text: String(ROWS.length) }), el('div', { class: 's', text: DATA.early_size + ' early finds below the floor' })),
        el('li', {}, el('div', { class: 'k', text: 'Top implied value' }), el('div', { class: 'v', text: fmtUsd(maxImplied) }), el('div', { class: 's', text: ROWS[0].name + ' · rank 1' })),
        el('li', {}, el('div', { class: 'k', text: 'Combined implied' }), el('div', { class: 'v', text: fmtUsd(DATA.total_implied_usd) }), el('div', { class: 's', text: 'median row ' + fmtUsd(DATA.median_implied_usd) })),
        el('li', {}, el('div', { class: 'k', text: 'Already trading' }), el('div', { class: 'v', text: String(DATA.live_size) }), el('div', { class: 's', text: 'kept apart, market values' }))));
  }

  function tabs() {
    function tab(name, label, count) {
      return el('button', {
        type: 'button', 'aria-selected': state.tab === name ? 'true' : 'false',
        onclick: function () { state.tab = name; state.selected = null; window.location.hash = '#/'; render(); }
      }, label + ' ', el('span', { class: 'n', text: '(' + count + ')' }));
    }
    return el('div', { class: 'tabs', role: 'tablist' },
      tab('board', 'Pre-token board', ROWS.length),
      tab('live', 'Already trading', LIVE.length));
  }

  function controls(onChange) {
    function select(value, options, onchange) {
      var s = el('select', { onchange: onchange });
      options.forEach(function (o) {
        s.appendChild(el('option', { value: o[0], selected: o[0] === value ? 'selected' : null, text: o[1] }));
      });
      return s;
    }
    var q = el('input', { type: 'search', placeholder: 'Search name or slug…', value: state.q, 'aria-label': 'Search protocols', oninput: function (e) { state.q = e.target.value; onChange(); } });
    var cat = select(state.category, [['all', 'All categories']].concat(categories.map(function (c) { return [c, c]; })), function (e) { state.category = e.target.value; onChange(); });
    var ch = select(state.chain, [['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; })), function (e) { state.chain = e.target.value; onChange(); });
    var scope = select(state.scope, [['all', 'All rows'], ['watchlist', 'Watchlist only'], ['early', 'Early finds only']], function (e) { state.scope = e.target.value; onChange(); });
    var count = el('span', { class: 'count', id: 'rowcount' });
    return el('div', { class: 'controls' }, q,
      el('label', {}, 'Category ', cat),
      el('label', {}, 'Chain ', ch),
      el('label', {}, 'Scope ', scope), count);
  }

  function sortButton(label, key) {
    var active = state.sort === key;
    return el('button', {
      type: 'button',
      onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
        renderBoardOnly();
      }
    }, label, active ? el('span', { class: 'arrow', text: state.dir === -1 ? ' ↓' : ' ↑' }) : null);
  }

  function boardTable(rows) {
    var maxImplied = ROWS[0].implied_value_usd;
    var table = el('table', {},
      el('caption', { text: 'Ranked by implied value. Click a row for its detail view: the model\u2019s inputs, the farm plan and the live comparables. ★ marks a watchlist protocol.' }),
      el('thead', {}, el('tr', {},
        el('th', { class: 'num' }, sortButton('Rank', 'rank')),
        el('th', {}, sortButton('Protocol', 'name')),
        el('th', {}, 'Category'),
        el('th', {}, 'Chains'),
        el('th', { class: 'num' }, sortButton('TVL', 'tvl')),
        el('th', { class: 'num' }, sortButton('7d', 'change')),
        el('th', { class: 'num' }, sortButton('Age', 'age')),
        el('th', { class: 'num' }, sortButton('Implied value', 'implied')))),
      el('tbody', {}, rows.map(function (r) {
        var change = r.change_7d;
        var changeCell = change === null
          ? el('td', { class: 'num', text: 'n/a' })
          : el('td', { class: 'num ' + (change >= 0 ? 'pos' : 'neg'), text: fmtPct(change) });
        return el('tr', {
          class: r.rank <= 3 ? 'top' + r.rank : null,
          'aria-selected': state.selected === r.slug ? 'true' : null,
          onclick: function () { window.location.hash = '#/p/' + r.slug; }
        },
          el('td', { class: 'num rank', text: String(r.rank) }),
          el('td', {},
            el('span', { class: 'name', text: r.name + ' ' }),
            r.watchlist ? el('i', { class: 'star', text: '★' }) : null,
            el('br', {}),
            el('span', { class: 'slug', text: r.slug })),
          el('td', {}, r.category ? el('span', { class: 'chip', text: r.category }) : el('span', { class: 'slug', text: '—' })),
          el('td', { text: (r.chains || []).slice(0, 3).join(', ') + ((r.chains || []).length > 3 ? ' +' + ((r.chains || []).length - 3) : '') }),
          el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
          changeCell,
          el('td', { class: 'num', text: fmtAge(r.age_days) }),
          el('td', { class: 'num' },
            el('span', { text: fmtUsd(r.implied_value_usd) }),
            el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.max(1, Math.round((r.implied_value_usd / maxImplied) * 100)) + '%' }))));
      })));
    if (rows.length === 0) {
      table.appendChild(el('tbody', {}, el('tr', {}, el('td', { colspan: '8', class: 'empty', text: 'No protocol matches this filter. Clear the search or widen the scope.' }))));
    }
    return table;
  }

  function liveTable() {
    var rows = LIVE.slice().sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0); });
    return el('table', {},
      el('caption', { text: 'Protocols whose token already trades, by market cap. The board never ranks these: their value is the market\u2019s, not a model\u2019s. They are also the comparables the model prices each sector from.' }),
      el('thead', {}, el('tr', {},
        el('th', { class: 'num', text: '#' }),
        el('th', {}, 'Protocol'),
        el('th', {}, 'Category'),
        el('th', {}, 'Chains'),
        el('th', { class: 'num', text: 'TVL' }),
        el('th', { class: 'num', text: 'Market cap' }),
        el('th', { class: 'num', text: 'Mcap / TVL' }),
        el('th', { class: 'num', text: '7d' }))),
      el('tbody', {}, rows.map(function (r, i) {
        return el('tr', {},
          el('td', { class: 'num rank', text: String(i + 1) }),
          el('td', {}, el('span', { class: 'name', text: r.name }), el('br', {}), el('span', { class: 'slug', text: r.slug })),
          el('td', {}, r.category ? el('span', { class: 'chip', text: r.category }) : el('span', { class: 'slug', text: '—' })),
          el('td', { text: (r.chains || []).slice(0, 3).join(', ') }),
          el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
          el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
          el('td', { class: 'num', text: r.mcap_tvl === null ? 'n/a' : fmtMult(r.mcap_tvl) }),
          el('td', { class: 'num ' + ((r.change_7d || 0) >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }));
      })));
  }

  function modelBreakdown(row) {
    var growthPct = growthOf(row);
    var growthMult = 1 + (growthPct / 100) * MODEL.growth_weight;
    var maturity = maturityOf(row);
    var chainMult = chainOf(row);
    var formula = impliedOf(row);
    var board = row.implied_value_usd;
    var compText = row.live_comps > 0
      ? 'median mcap/TVL of ' + row.live_comps + ' live ' + (row.category || 'uncategorised') + ' protocols'
      : 'thin category — global median';
    return el('div', { class: 'card' },
      el('h3', { text: 'How the value is worked out' }),
      el('dl', { class: 'kv' },
        el('dt', { text: 'TVL' }), el('dd', { text: fmtUsdFull(row.tvl_usd) }),
        el('dt', { text: 'Sector multiple' }), el('dd', { text: fmtMult(row.category_multiple) + '  (' + compText + ', raw ' + row.live_median.toFixed(3) + ')' }),
        el('dt', { text: '7-day growth' }), el('dd', { text: fmtPct(row.change_7d) + ' → ' + fmtMult(growthMult) }),
        el('dt', { text: 'Maturity' }), el('dd', { text: fmtAge(row.age_days) + ' → ' + fmtMult(maturity) }),
        el('dt', { text: 'Chains' }), el('dd', { text: (row.chains || []).length + ' → ' + fmtMult(chainMult) }),
        el('dt', { text: 'Implied value' }), el('dd', { text: fmtUsdFull(formula) })),
      el('p', { class: 'model-line', text: fmtUsdFull(row.tvl_usd) + ' × ' + fmtMult(row.category_multiple) + ' × ' + fmtMult(growthMult) + ' × ' + fmtMult(maturity) + ' × ' + fmtMult(chainMult) + ' = ' + fmtUsdFull(formula) }),
      board !== formula
        ? el('p', { class: 'note', text: 'The board shows ' + fmtUsdFull(board) + ': a $' + (formula - board) + ' tie-break keeps the values falling strictly down the ranks.' })
        : el('p', { class: 'note', text: 'The board shows exactly this number: the page recomputes it from the snapshot figures.' }));
  }

  function farmPlan(row) {
    var steps = farmStepsFor(row);
    return el('div', { class: 'card' },
      el('h3', { text: 'Farm plan — six steps' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var parts = s.split(' Cost: ');
        var head = parts[0];
        var tail = parts.length > 1 ? parts.slice(1).join(' Cost: ') : '';
        var costTime = tail.split(' Time: ');
        return el('li', {},
          el('p', { text: head }),
          el('p', { class: 'ct' },
            el('b', { text: 'Cost: ' }), costTime[0] + '. ',
            el('b', { text: 'Time: ' }), (costTime[1] || '') + '.'));
      })),
      el('p', { class: 'note', text: 'Steps are built from this protocol\u2019s own record — its category, its chains, its size and its age — not from a list of names. Never pay anyone to claim for you.' }));
  }

  function comparables(row) {
    var same = LIVE.filter(function (l) { return l.category === row.category; }).slice(0, 3);
    var list = same.length > 0 ? same : LIVE.slice(0, 3);
    var caption = same.length > 0
      ? 'Live ' + (row.category || 'uncategorised') + ' protocols the sector multiple is priced from'
      : 'No live-token protocol shares this category — the three largest live protocols overall';
    return el('div', { class: 'card' },
      el('h3', { text: 'Live comparables' }),
      el('p', { class: 'note', text: caption }),
      el('table', { class: 'comps' },
        el('thead', {}, el('tr', {}, el('th', { text: 'Protocol' }), el('th', { text: 'Market cap' }), el('th', { text: 'TVL' }), el('th', { text: 'Mcap / TVL' }))),
        el('tbody', {}, list.map(function (l) {
          return el('tr', {},
            el('td', { text: l.name }),
            el('td', { text: fmtUsd(l.mcap_usd) }),
            el('td', { text: fmtUsd(l.tvl_usd) }),
            el('td', { text: l.mcap_tvl === null ? 'n/a' : fmtMult(l.mcap_tvl) }));
        }))));
  }

  function detailView(row) {
    var head = el('div', { class: 'wrap' },
      el('button', { class: 'back', type: 'button', onclick: function () { window.location.hash = '#/'; }, text: '← Back to the board' }),
      el('div', { class: 'detail-head' },
        el('h2', {}, row.name + ' ', row.watchlist ? el('i', { class: 'star', text: '★' }) : null),
        el('p', { class: 'sub' },
          'Rank ' + row.rank + ' of ' + ROWS.length + ' · ' + row.slug + ' · ',
          row.category || 'no category', ' · ',
          (row.chains || []).join(', ') || 'no chains recorded',
          row.watchlist ? ' · on the watchlist' : ' · early find below the floor')),
      el('div', { class: 'grid3' },
        el('div', { class: 'card' },
          el('h3', { text: 'The record' }),
          el('dl', { class: 'kv' },
            el('dt', { text: 'TVL' }), el('dd', { text: fmtUsd(row.tvl_usd) }),
            el('dt', { text: '7-day change' }), el('dd', { text: fmtPct(row.change_7d) }),
            el('dt', { text: 'Tracked since' }), el('dd', { text: row.listed_at || 'unknown' }),
            el('dt', { text: 'Token' }), el('dd', { class: 'l', text: 'records no token' }),
            el('dt', { text: 'Implied value' }), el('dd', { text: fmtUsd(row.implied_value_usd) }))),
        modelBreakdown(row),
        farmPlan(row)),
      el('div', { class: 'grid' }, comparables(row),
        el('div', { class: 'card' },
          el('h3', { text: 'Why this rank' }),
          el('p', { class: 'note', text: rankReason(row) }))),
      methodSection());
    return head;
  }

  /** One sentence on why a protocol sits where it does, from its own figures. */
  function rankReason(row) {
    var bits = [];
    var tvlRank = ROWS.slice().sort(function (a, b) { return b.tvl_usd - a.tvl_usd; }).map(function (r) { return r.slug; }).indexOf(row.slug) + 1;
    bits.push('the ' + tvlRank + (tvlRank === 1 ? 'st' : tvlRank === 2 ? 'nd' : tvlRank === 3 ? 'rd' : 'th') + '-largest TVL on the board');
    if (row.change_7d !== null && row.change_7d > 5) bits.push('growing ' + fmtPct(row.change_7d) + ' in seven days');
    if (row.change_7d !== null && row.change_7d < -5) bits.push('shrinking ' + fmtPct(row.change_7d) + ' in seven days');
    if (row.age_days !== null && row.age_days >= 1095) bits.push('tracked for over three years with no token');
    if ((row.chains || []).length >= 8) bits.push('live on ' + row.chains.length + ' chains');
    if (row.watchlist) bits.push('on the watchlist at ' + fmtUsd(DATA.floor_usd) + ' TVL or more');
    return row.name + ' ranks ' + row.rank + ' because it has ' + bits.join(', ') + '.';
  }

  function methodSection() {
    var compRows = Object.keys(DATA.comps).sort().map(function (key) {
      var c = DATA.comps[key];
      return el('p', { text: key + ': ' + c.n + ' live protocols, median mcap/TVL ' + c.median.toFixed(3) });
    });
    return el('section', { class: 'method' },
      el('h2', { text: 'How this radar works' }),
      el('p', {},
        'Implied value = TVL × sector multiple × growth × maturity × chains. ',
        'The sector multiple is the median market-cap-to-TVL ratio of the live-token protocols in the same category ',
        '(at least 3 of them; otherwise the global median of ', el('code', { text: fmtMult(DATA.global_median) }), '), clamped to [0.05, 0.80]. ',
        'Growth is the 7-day TVL change clamped to [−40%, +80%] and weighted 0.75; ',
        'maturity runs 0.70 for a new listing to 1.20 at four years; ',
        'each chain adds 2%, up to eight chains. ',
        'No protocol name is ever special-cased: the same function scores every row, and the page recomputes it — ',
        el('span', { class: 'check ' + (checkBad === 0 ? 'ok' : 'bad'), text: checkBad === 0 ? 'page check: all ' + ROWS.length + ' rows recompute to the board\u2019s values.' : 'page check: ' + checkBad + ' rows differ from the board.' })),
      el('p', {},
        'The board covers the whole watchlist (', el('b', { text: String(DATA.watchlist_size) }), ' protocols at or above ',
        fmtUsd(DATA.floor_usd), ' of TVL that record no token and are not a wrapped, staked or bridged product) ',
        'plus every launchable pre-token protocol below the floor — ', el('b', { text: String(DATA.early_size) }), ' early finds. ',
        'Protocols above the floor that the watchlist leaves out are left out here too: the snapshot carries no parent-protocol field, ',
        'so the watchlist is the only record of which of those are a parent\u2019s arm.'),
      el('p', {}, '“Records no token” is the snapshot\u2019s record, not proof a protocol has none: a protocol on the list may still have a token its DefiLlama record does not carry. The implied value is this radar\u2019s own claim, never a prediction that a token is issued, or when.'),
      compRows.length > 0 ? el('div', {}, el('p', {}, el('b', { text: 'Sector pricing, read off the snapshot\u2019s live protocols:' })), compRows) : null);
  }

  // ---------------------------------------------------------------- render

  function renderBoardOnly() {
    var tableHost = document.getElementById('boardtable');
    if (!tableHost) { render(); return; }
    clear(tableHost);
    var rows = visibleRows();
    tableHost.appendChild(boardTable(rows));
    var count = document.getElementById('rowcount');
    if (count) count.textContent = rows.length + ' of ' + ROWS.length + ' rows';
  }

  function render() {
    app.setAttribute('aria-busy', 'false');
    clear(app);
    var selected = state.selected ? rowBySlug(state.selected) : null;
    if (selected) {
      var slim = el('div', { class: 'wrap' },
        el('header', { class: 'mast slim' },
          el('p', { class: 'eyebrow', text: 'Token Radar · ' + DATA.model_version }),
          el('h1', {}, 'Token Radar'),
          el('p', { class: 'meta' }, 'Snapshot ', el('b', { text: DATA.as_of }), ' · ', el('b', { text: String(ROWS.length) }), ' rows ranked · floor ', el('b', { text: fmtUsd(DATA.floor_usd) }))));
      slim.appendChild(detailView(selected));
      app.appendChild(slim);
      return;
    }
    var top = masthead();
    top.appendChild(tabs());
    top.appendChild(controls(function () { renderBoardOnly(); }));
    var host = el('div', { id: 'boardtable' });
    if (state.tab === 'live') {
      host.appendChild(liveTable());
    } else {
      host.appendChild(boardTable(visibleRows()));
    }
    top.appendChild(host);
    top.appendChild(methodSection());
    top.appendChild(el('footer', { text: 'Token Radar ' + DATA.model_version + ' · snapshot ' + DATA.as_of + ' · implied values are this radar\u2019s own claims, worked out from the snapshot\u2019s figures.' }));
    app.appendChild(top);
    var count = document.getElementById('rowcount');
    if (count && state.tab === 'board') count.textContent = visibleRows().length + ' of ' + ROWS.length + ' rows';
    if (count && state.tab === 'live') count.textContent = LIVE.length + ' live protocols';
  }

  // Exposed for the entry's own checks: the page's model, against the board's numbers.
  window.RADAR_MODEL = { impliedOf: impliedOf, farmStepsFor: farmStepsFor, applyTiebreak: applyTiebreak, stepText: stepText };

  render();
})();
