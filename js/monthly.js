// FlowFin · Monthly summary and compare.
// Shared settings and state (DATA, UI, _cache, CATEGORIES …) are globals from js/config.js.
import { chartColors } from './charts.js';
import { $, daysBetween, esc, inPeriod, pd, periodAt, periodLabel, periodModel, today, txs } from './core.js';
import { categoryHTML, drill, periodDay, sumBy, sw, sw0 } from './dashboard.js';
import { topbar } from './nav.js';

// ─── Monthly (summary + compare) ──────────────────────────────────────────
// Buckets per category, net of refunds in that category; "left over" = income − all buckets (Base44's period net balance)
var MONTH_BUCKETS = [['household','Household','Family Infrastructure'],['personal','Personal Cash','Personal Cash'],['coll','Collectibles','Collectibles'],['invest','Invested','Financial Investing|Retirement 3a']];
function monthModel(offset) {
  var p = periodAt(offset), t = today(), cutoff = p.end < t ? p.end : t, list = txs().filter(function (tx) { return inPeriod(tx, p) && pd(tx.date) <= cutoff; });
  var r = { p:p, partial:p.end >= t, income:0, subs:{}, n:list.length, list:list };
  MONTH_BUCKETS.forEach(function (b) { r[b[0]] = 0; });
  list.forEach(function (tx) {
    var a = +tx.amount || 0;
    if (tx.type === 'income') { r.income += a; return; }
    var b = MONTH_BUCKETS.filter(function (x) { return x[2].split('|').indexOf(tx.category) > -1; })[0];
    var key = b ? b[0] : 'personal', v = tx.type === 'refund' ? -a : a;
    r[key] += v;
    var sk = (tx.subcategory || tx.category || 'Other') + '|' + (tx.category || '');
    r.subs[sk] = (r.subs[sk] || 0) + v;
  });
  r.out = MONTH_BUCKETS.reduce(function (s, b) { return s + r[b[0]]; }, 0);
  r.left = r.income - r.out;
  r.free = r.income - r.household;
  return r;
}
function monthlyHTML() {
  var m = monthModel(UI.periodOffset), prev = monthModel(UI.periodOffset - 1), hist = [];
  for (var i = 1; i <= 6; i++) { var x = monthModel(UI.periodOffset - i); if (x.income > 0) hist.push(x); }
  var avg = function (k) { return hist.length ? sumBy(hist, function (x) { return x[k]; }) / hist.length : 0; };
  var h = topbar('Monthly', true);
  if (!m.n) return h + '<div class="empty">No transactions in this period.</div>';
  h += whatChangedHTML(m, hist);
  h += trendsHTML();
  // waterfall
  var rows = [['Income', m.income, 'in'], ['Household', -m.household], ['= Free cash flow', m.free, 'sub'], ['Personal Cash', -m.personal], ['Collectibles', -m.coll], ['Invested', -m.invest], ['= Left over', m.left, 'total']];
  var max = Math.max(m.income, 1);
  h += '<section class="card"><h3>Where the income went<span class="r">' + (m.partial ? 'so far, ' + periodLabel(m.p) : periodLabel(m.p)) + '</span></h3><div class="wf">' +
    rows.map(function (r) {
      var v = r[1], cls = r[2] || '';
      return '<div class="' + cls + '"><span>' + r[0] + '</span><div class="bar"><i class="' + (v < 0 && cls ? 'over' : '') + '" style="width:' + Math.min(100, Math.abs(v) / max * 100) + '%"></i></div>' +
        '<span class="num ' + (cls && v < 0 ? 'neg' : '') + '">' + (cls ? (v < 0 ? '−' : '') : (v < 0 ? '− ' : '+ ')) + sw(Math.abs(v)) + '</span>' +
        '<span class="num soon">' + (m.income ? (Math.abs(v) / m.income * 100).toFixed(0) + '%' : '') + '</span></div>';
    }).join('') + '</div></section>';
  h += categoryHTML(periodModel(UI.periodOffset));
  // compare table
  var lines = [['income','Income'],['household','Household'],['personal','Personal Cash'],['coll','Collectibles'],['invest','Invested'],['left','Left over']];
  h += '<section class="card"><h3>Compared with<span class="r">' + periodLabel(prev.p) + ' and your ' + hist.length + '-period average</span></h3><div class="ctable">' +
    '<div class="ch"><span></span><span>' + (m.partial ? 'This period, so far' : 'This period') + '</span><span>Previous</span><span>Change</span><span>' + hist.length + '-period avg</span></div>' +
    lines.map(function (l) {
      var a = m[l[0]], b = prev[l[0]], d = a - b, good = l[0] === 'invest' || ((l[0] === 'income' || l[0] === 'left') ? d >= 0 : d <= 0);
      return '<div><span>' + l[1] + '</span><span class="num ' + (l[0] === 'left' && a < 0 ? 'neg' : '') + '">' + sw0(a) + '</span><span class="num soon">' + sw0(b) + '</span>' +
        '<span class="num ' + (Math.abs(d) < 0.5 ? 'soon' : good ? '' : 'neg') + '">' + (d >= 0 ? '+' : '−') + sw0(Math.abs(d)) + '</span><span class="num soon">' + sw0(avg(l[0])) + '</span></div>';
    }).join('') + '</div>' + (m.partial ? '<p class="soon" style="margin:10px 0 0;font-size:12px">This period isn’t over yet, so it is compared part-way against full periods.</p>' : '') + '</section>';
  // biggest changes by subcategory
  var keys = {}; Object.keys(m.subs).forEach(function (k) { keys[k] = 1; }); Object.keys(prev.subs).forEach(function (k) { keys[k] = 1; });
  var mv = Object.keys(keys).map(function (k) { return { k:k, a:m.subs[k] || 0, b:prev.subs[k] || 0, d:(m.subs[k] || 0) - (prev.subs[k] || 0) }; })
    .filter(function (x) { return Math.abs(x.d) >= 5 && x.k.split('|')[0] !== 'General Household'; }).sort(function (x, y) { return Math.abs(y.d) - Math.abs(x.d); }).slice(0, 8);
  if (mv.length) {
    h += '<section class="card"><h3>Biggest changes<span class="r">by subcategory, vs previous period</span></h3>' + mv.map(function (x) {
      var sub = x.k.split('|');
      return '<div class="rowline drill"' + drill({ category:sub[1], sub:sub[0] }) + '><span>' + esc(sub[0]) + ' <span class="sub">· ' + sw0(x.b) + ' → ' + sw0(x.a) + '</span></span><span class="num ' + (x.d > 0 ? 'neg' : '') + '">' + (x.d >= 0 ? '+' : '−') + sw0(Math.abs(x.d)) + '</span></div>';
    }).join('') + '</section>';
  }
  h += '<section class="card"><h3>Last 7 periods<span class="r legend">' + MONTH_BUCKETS.map(function (b, i) { return '<span><i style="border-top:8px solid ' + MONTH_SHADES[i] + '"></i>' + b[1] + '</span>'; }).join('') +
    '<span><i style="border-top:2px solid var(--signal)"></i>Left over</span></span></h3><div class="chartbox"><canvas id="chMonths" role="img" aria-label="Income split into household, personal, collectibles, invested and left over for the last 7 periods"></canvas></div></section>';
  return h;
}
// ─── What changed: plain sentences from the numbers ─────────────────────────
// Compares with the average of the last periods (scaled to today while a period is still running) and names what drove it.
function monthName(p) { return p.start.toLocaleDateString('en-GB', { month:'long' }); }
function whatChanged(m, hist) {
  var out = [], t = today();
  var frac = m.partial ? Math.min(1, Math.max(0.05, (daysBetween(m.p.start, t) + 1) / (daysBetween(m.p.start, m.p.end) + 1))) : 1;
  var avg = function (k) { return hist.length ? sumBy(hist, function (x) { return x[k]; }) / hist.length : 0; };
  var rateOf = function (x) { return x.income > 0 ? x.left / x.income * 100 : null; };
  // 1 · share of income kept (finished periods only: mid-period the salary may not be in yet)
  if (!m.partial && m.income > 0 && hist.length >= 2) {
    var rate = rateOf(m), rates = hist.map(rateOf), better = -1;
    for (var i = 0; i < hist.length; i++) if (rates[i] !== null && rates[i] >= rate) { better = i; break; }
    var ar = sumBy(rates.filter(function (x) { return x !== null; }), function (x) { return x; }) / hist.length;
    out.push({ w:3, t: better < 0 ? 'Kept <b>' + Math.round(rate) + '%</b> of income, the best of the last ' + (hist.length + 1) + ' periods.'
      : better >= 1 ? 'Kept <b>' + Math.round(rate) + '%</b> of income, the best since the ' + monthName(hist[better].p) + ' period.'
      : 'Kept <b>' + Math.round(rate) + '%</b> of income, ' + Math.abs(Math.round(rate - ar)) + ' points ' + (rate >= ar ? 'above' : 'below') + ' your ' + hist.length + '-period average.' });
  }
  // 2 · spending areas well away from usual, with what drove them
  // while a period is running: only after its first week, and not for household or investing, which arrive in lumps
  var early = m.partial && daysBetween(m.p.start, t) < 7;
  [['personal', 'Personal Cash', 50], ['coll', 'Collectibles', 50], ['invest', 'Invested', 100], ['household', 'Household', 300]].forEach(function (b) {
    if (m.partial && (early || b[0] === 'household' || b[0] === 'invest')) return;
    var a = m[b[0]], base = avg(b[0]) * frac; if (base < 20 && a < 50) return;
    var d = a - base, pct = base ? d / base * 100 : 100;
    if (Math.abs(d) < b[2] || Math.abs(pct) < 20) return;
    var cats = MONTH_BUCKETS.filter(function (x) { return x[0] === b[0]; })[0][2].split('|'), by = {};
    m.list.forEach(function (tx) { if (tx.type !== 'expense' || cats.indexOf(tx.category) < 0) return; var k = String(tx.description || '').trim(); by[k] = by[k] || { n:0, s:0 }; by[k].n++; by[k].s += +tx.amount || 0; });
    var top = Object.keys(by).map(function (k) { return { k:k, n:by[k].n, s:by[k].s }; }).sort(function (x, y) { return y.s - x.s; })[0];
    var why = d > 0 && top && top.s >= Math.abs(d) * 0.3 ? ', mostly ' + (top.n > 1 ? top.n + '× ' : '') + esc(top.k) + ' (' + sw0(top.s) + ')' : '';
    out.push({ w:Math.abs(d), t:'<b>' + b[1] + '</b> ' + Math.abs(Math.round(pct)) + '% ' + (d > 0 ? 'above' : 'below') + (m.partial ? ' where your average is by now' : ' your ' + hist.length + '-period average') +
      ' (' + sw0(a) + ' vs ' + sw0(base) + ')' + why + '.' });
  });
  // 3 · the biggest single purchase outside the household
  var big = m.list.filter(function (tx) { return tx.type === 'expense' && tx.category !== 'Family Infrastructure'; }).sort(function (x, y) { return (+y.amount || 0) - (+x.amount || 0); })[0];
  if (big && +big.amount >= 100) out.push({ w:1, t:'Biggest single purchase: ' + esc(big.description) + ', <b>' + sw(+big.amount) + '</b> on ' + periodDay(pd(big.date)) });
  // 4 · new places: descriptions never seen before this period, 50 or more in total
  var seen = {}; txs().forEach(function (tx) { if (pd(tx.date) < m.p.start) seen[String(tx.description || '').trim().toLowerCase()] = 1; });
  var fresh = {}; m.list.forEach(function (tx) { var k = String(tx.description || '').trim(); if (tx.type === 'expense' && !seen[k.toLowerCase()] && tx.category !== 'Family Infrastructure') fresh[k] = (fresh[k] || 0) + (+tx.amount || 0); });
  var fr = Object.keys(fresh).filter(function (k) { return fresh[k] >= 50; }).sort(function (x, y) { return fresh[y] - fresh[x]; }).slice(0, 2);
  if (fr.length) out.push({ w:0.5, t:'New this period: ' + fr.map(function (k) { return esc(k) + ' (' + sw0(fresh[k]) + ')'; }).join(', ') + '.' });
  return out.slice(0, 1).concat(out.slice(1).sort(function (x, y) { return y.w - x.w; })).slice(0, 5);
}
function whatChangedHTML(m, hist) {
  if (!hist.length) return '';
  var list = whatChanged(m, hist);
  return '<section class="card changed"><h3>What changed<span class="r">' + (m.partial ? 'so far, ' : '') + 'vs your ' + hist.length + '-period average</span></h3>' +
    (list.length ? '<ul>' + list.map(function (x) { return '<li>' + x.t + '</li>'; }).join('') + '</ul>' : '<p class="soon" style="margin:0">Nothing out of the ordinary: every area is within 20% of usual.</p>') + '</section>';
}
// ─── Trends: one small chart per day-to-day subcategory over the last finished periods ───
// rising / falling compares the last 3 periods with the ones before, using the middle value (median),
// so a single big month (a one-off) doesn't count as a trend.
var TREND_CATS = ['Personal Cash', 'Collectibles'];
function med(a) { var b = a.slice().sort(function (x, y) { return x - y; }), k = Math.floor(b.length / 2); return b.length ? (b.length % 2 ? b[k] : (b[k - 1] + b[k]) / 2) : 0; }
function trendsModel() {
  var last = Math.min(UI.periodOffset, -1), offs = [], first = txs().reduce(function (m, t) { return !m || t.date < m ? t.date : m; }, '');
  for (var o = last - 11; o <= last; o++) { var p = periodAt(o); if (first && p.end >= pd(first)) offs.push(o); }
  var ps = offs.map(periodAt), by = {};
  txs().forEach(function (tx) {
    if (TREND_CATS.indexOf(tx.category) < 0 || tx.anomaly_status === 'excluded' || (tx.type !== 'expense' && tx.type !== 'refund')) return;
    for (var i = 0; i < ps.length; i++) if (inPeriod(tx, ps[i])) {
      var k = tx.category + '|' + (tx.subcategory || '—'); by[k] = by[k] || ps.map(function () { return 0; });
      by[k][i] += (tx.type === 'refund' ? -1 : 1) * (+tx.amount || 0); break;
    }
  });
  var items = Object.keys(by).map(function (k) {
    var v = by[k].map(function (x) { return Math.max(0, x); }), n = v.length;
    var before = med(v.slice(0, Math.max(1, n - 3))), lately = med(v.slice(-3)), d = lately - before;
    var kind = n < 5 ? 'new' : d > Math.max(15, before * 0.15) ? 'up' : d < -Math.max(15, before * 0.15) ? 'down' : 'flat';
    return { cat:k.split('|')[0], sub:k.split('|')[1], v:v, before:before, lately:lately, d:d, kind:kind, total:sumBy(v, function (x) { return x; }) };
  }).filter(function (x) { return x.total >= 150; });
  return { ps:ps, items:items };
}
function spark(v, usual) {
  var w = 150, h = 44, mx = Math.max.apply(null, v.concat([usual, 1])), n = v.length;
  var x = function (i) { return n > 1 ? 6 + i * (w - 12) / (n - 1) : w / 2; }, y = function (a) { return h - 6 - a / mx * (h - 14); };
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="sp" aria-hidden="true"><line x1="6" x2="' + (w - 6) + '" y1="' + y(usual).toFixed(1) + '" y2="' + y(usual).toFixed(1) + '" class="avg"/>' +
    '<path class="ln" d="M' + v.map(function (a, i) { return x(i).toFixed(1) + ' ' + y(a).toFixed(1); }).join(' L') + '"/><circle class="end" r="3" cx="' + x(n - 1).toFixed(1) + '" cy="' + y(v[n - 1]).toFixed(1) + '"/></svg>';
}
function trendsHTML() {
  var T = trendsModel(); if (!T.items.length || T.ps.length < 3) return '';
  var sort = UI.trendSort === 'big' ? 'big' : 'rise', rank = { up:0, new:1, flat:2, down:3 };
  var items = T.items.slice().sort(sort === 'big' ? function (a, b) { return b.total - a.total; } : function (a, b) { return rank[a.kind] - rank[b.kind] || b.d - a.d; });
  var lastP = T.ps[T.ps.length - 1], span = T.ps[0].start.toLocaleDateString('en-GB', { month:'short' }) + '–' + lastP.start.toLocaleDateString('en-GB', { month:'short' });
  var word = { up:'rising', down:'falling', flat:'steady', new:'new' };
  return '<section class="card trends"><h3>Trends<span class="r"><span class="seg3 tsort" role="radiogroup" aria-label="Sort">' +
    '<button role="radio" aria-checked="' + (sort === 'rise') + '" class="' + (sort === 'rise' ? 'on' : '') + '" data-act="trendsort" data-v="rise">Rising first</button>' +
    '<button role="radio" aria-checked="' + (sort === 'big') + '" class="' + (sort === 'big' ? 'on' : '') + '" data-act="trendsort" data-v="big">Biggest</button></span></span></h3>' +
    '<p class="chartnote" style="margin:0 0 10px">Each subcategory over the last ' + T.ps.length + ' finished periods (' + span + '). Dashed: your usual (middle value). Red dot: the latest period. Tap one to see its transactions.</p>' +
    '<div class="tgrid">' + items.map(function (x) {
      return '<div class="tc"' + drill({ category:x.cat, sub:x.sub === '—' ? '' : x.sub, scope:'all' }) + '><div class="tt"><b>' + esc(x.sub) + '</b><span class="tg tg-' + x.kind + '">' + word[x.kind] + '</span></div>' +
        '<small>' + esc(x.cat) + ' · usual ' + sw0(x.before) + ' → ' + sw0(x.lately) + '</small>' + spark(x.v, med(x.v.slice(0, -1).length ? x.v.slice(0, -1) : x.v)) +
        '<div class="tn"><span>' + lastP.start.toLocaleDateString('en-GB', { month:'short' }) + ' <b>' + sw0(x.v[x.v.length - 1]) + '</b></span><span>' + span + '</span></div></div>';
    }).join('') + '</div></section>';
}
var MONTH_SHADES = ['var(--ink)', 'var(--s2)', 'var(--s3)', 'var(--s5)'];
// the chart draws on a canvas, which can't read CSS variables: resolve them for the current theme
function monthShades() { var css = getComputedStyle(document.documentElement); return MONTH_SHADES.map(function (v) { return css.getPropertyValue(v.slice(4, -1)).trim(); }); }
function monthlyChart() {
  var el = $('chMonths'); if (!el || !window.Chart || CHARTS.months) return;
  var ms = []; for (var i = 6; i >= 0; i--) { var x = monthModel(UI.periodOffset - i); if (x.n) ms.push(x); }
  var C = chartColors();
  CHARTS.months = new Chart(el, {
    data:{ labels:ms.map(function (x) { return periodDay(x.p.start).slice(3) + String(x.p.start.getFullYear()).slice(2) + (x.partial ? '*' : ''); }),
      datasets:MONTH_BUCKETS.map(function (b, i) { return { type:'bar', label:b[1], data:ms.map(function (x) { return Math.round(x[b[0]]); }), backgroundColor:monthShades()[i], stack:'s', maxBarThickness:48 }; })
        .concat([{ type:'line', label:'Left over', data:ms.map(function (x) { return Math.round(x.left); }), borderColor:C.signal, backgroundColor:C.signal, borderWidth:2, pointRadius:3, tension:0, stack:'line' }]) },
    options:{ responsive:true, maintainAspectRatio:false, interaction:{ mode:'index', intersect:false },
      plugins:{ legend:{ display:false }, tooltip:{ backgroundColor:C.ink, cornerRadius:0, titleFont:{ family:'IBM Plex Mono' }, bodyFont:{ family:'IBM Plex Mono' }, callbacks:{ label:function (c) { return c.dataset.label + ': ' + sw0(c.raw); } } } },
      scales:{ x:{ stacked:true, ticks:{ color:C.muted, font:{ family:'IBM Plex Mono', size:11 } }, grid:{ display:false }, border:{ color:C.ink } },
        y:{ stacked:true, ticks:{ color:C.muted, font:{ family:'IBM Plex Mono', size:11 }, callback:function (v) { return sw0(v); } }, grid:{ color:function (c) { return c.tick.value === 0 ? C.ink : C.rule; } }, border:{ display:false } } } }
  });
}

export { trendsModel, trendsHTML, MONTH_BUCKETS, monthModel, monthlyHTML, MONTH_SHADES, monthlyChart };
