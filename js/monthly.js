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
var MONTH_SHADES = ['#121413', '#5B605C', '#8A8F8B', '#C3C7C3'];
function monthlyChart() {
  var el = $('chMonths'); if (!el || !window.Chart || CHARTS.months) return;
  var ms = []; for (var i = 6; i >= 0; i--) { var x = monthModel(UI.periodOffset - i); if (x.n) ms.push(x); }
  var C = chartColors();
  CHARTS.months = new Chart(el, {
    data:{ labels:ms.map(function (x) { return periodDay(x.p.start).slice(3) + String(x.p.start.getFullYear()).slice(2) + (x.partial ? '*' : ''); }),
      datasets:MONTH_BUCKETS.map(function (b, i) { return { type:'bar', label:b[1], data:ms.map(function (x) { return Math.round(x[b[0]]); }), backgroundColor:MONTH_SHADES[i], stack:'s', maxBarThickness:48 }; })
        .concat([{ type:'line', label:'Left over', data:ms.map(function (x) { return Math.round(x.left); }), borderColor:C.signal, backgroundColor:C.signal, borderWidth:2, pointRadius:3, tension:0, stack:'line' }]) },
    options:{ responsive:true, maintainAspectRatio:false, interaction:{ mode:'index', intersect:false },
      plugins:{ legend:{ display:false }, tooltip:{ backgroundColor:C.ink, cornerRadius:0, titleFont:{ family:'IBM Plex Mono' }, bodyFont:{ family:'IBM Plex Mono' }, callbacks:{ label:function (c) { return c.dataset.label + ': ' + sw0(c.raw); } } } },
      scales:{ x:{ stacked:true, ticks:{ color:C.muted, font:{ family:'IBM Plex Mono', size:11 } }, grid:{ display:false }, border:{ color:C.ink } },
        y:{ stacked:true, ticks:{ color:C.muted, font:{ family:'IBM Plex Mono', size:11 }, callback:function (v) { return sw0(v); } }, grid:{ color:function (c) { return c.tick.value === 0 ? C.ink : C.rule; } }, border:{ display:false } } } }
  });
}

export { MONTH_BUCKETS, monthModel, monthlyHTML, MONTH_SHADES, monthlyChart };
