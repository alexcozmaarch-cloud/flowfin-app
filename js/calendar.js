// FlowFin · Spending calendar: the period as a month grid, shaded by day-to-day spending (Personal Cash, Collectibles),
// a red corner on days that alone cost more than the even daily pace, tap a day for its transactions, weekday averages.
import { addDays, daysBetween, esc, fmtCHF, pd, today, txs, ymd } from './core.js';
import { d2dModel, kpi, sw0 } from './dashboard.js';
import { topbar } from './nav.js';
import { txIco } from './transactions.js';

var LEVELS = [15, 35, 80];
function level(a) { return a <= 0.004 ? 0 : a < LEVELS[0] ? 1 : a < LEVELS[1] ? 2 : a < LEVELS[2] ? 3 : 4; }
function calModel(off) {
  var D = d2dModel(off), shown = D.isCur ? D.elapsed : D.days, t = today();
  var days = D.daily.map(function (v, i) { var d = addDays(D.p.start, i); return { d:d, key:ymd(d), amt:Math.max(0, v), future:d > t }; });
  var past = days.slice(0, shown), busiest = past.reduce(function (b, x) { return !b || x.amt > b.amt ? x : b; }, null);
  var wk = { wd:[0, 0], sat:[0, 0], sun:[0, 0] };
  past.forEach(function (x) { var k = x.d.getDay() === 6 ? 'sat' : x.d.getDay() === 0 ? 'sun' : 'wd'; wk[k][0] += x.amt; wk[k][1]++; });
  return { D:D, days:days, past:past, busiest:busiest && busiest.amt > 0 ? busiest : null, none:past.filter(function (x) { return x.amt <= 0.004; }).length,
    spent:past.reduce(function (s, x) { return s + x.amt; }, 0), perDay:D.perDay, wk:wk };
}
function calendarLine(off) {   // for the Home row
  var M = calModel(off);
  return M.busiest ? 'busiest day ' + M.busiest.d.toLocaleDateString('en-GB', { weekday:'short' }) + ' ' + M.busiest.d.getDate() + ', ' + sw0(M.busiest.amt) : 'no spending yet';
}
function calendarHTML() {
  var M = calModel(UI.periodOffset), sel = UI.calDay && M.days.some(function (x) { return x.key === UI.calDay; }) ? UI.calDay : (M.busiest ? M.busiest.key : '');
  var h = topbar('Calendar', true);
  var bd = M.busiest ? M.busiest.d.toLocaleDateString('en-GB', { weekday:'short' }) + ' ' + M.busiest.d.getDate() : '—';
  h += '<section class="kpis cal3">' + kpi('Spent', sw0(M.spent), 'day-to-day budgets') + kpi('Busiest', bd, M.busiest ? sw0(M.busiest.amt) : '') +
    kpi('No-spend', M.none + ' day' + (M.none === 1 ? '' : 's'), 'of ' + M.past.length + ' so far') + '</section>';
  var lead = (M.D.p.start.getDay() + 6) % 7;
  h += '<section class="card"><div class="cal" role="grid" aria-label="Spending per day">' +
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (d) { return '<span class="dow">' + d + '</span>'; }).join('') +
    new Array(lead + 1).join('<span></span>') +
    M.days.map(function (x) {
      var over = !x.future && M.perDay && x.amt > M.perDay;
      return '<button class="cd l' + (x.future ? 'f' : level(x.amt)) + (over ? ' over' : '') + (x.key === sel ? ' sel' : '') + '" data-act="calday" data-d="' + x.key + '" ' + (x.future ? 'disabled ' : '') +
        'aria-label="' + x.d.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' }) + ': ' + (x.future ? 'to come' : sw0(x.amt)) + '"><b>' + x.d.getDate() + '</b><i>' + (x.future ? '' : x.amt > 0.004 ? sw0(x.amt) : '·') + '</i></button>';
    }).join('') + '</div>' +
    '<div class="calleg"><span><i class="l0"></i>0</span><span><i class="l1"></i>&lt;' + LEVELS[0] + '</span><span><i class="l2"></i>&lt;' + LEVELS[1] + '</span><span><i class="l3"></i>&lt;' + LEVELS[2] + '</span><span><i class="l4"></i>' + LEVELS[2] + '+</span>' +
    '<span><i class="ov"></i>above the even daily pace (' + sw0(M.perDay) + ')</span></div></section>';
  if (sel) {
    var list = txs().filter(function (t) { return String(t.date).slice(0, 10) === sel; }).sort(function (a, b) { return (+b.amount || 0) - (+a.amount || 0); });
    var dsel = M.days.filter(function (x) { return x.key === sel; })[0];
    h += '<section class="card"><h3>' + pd(sel).toLocaleDateString('en-GB', { weekday:'short', day:'2-digit', month:'2-digit' }) + '<span class="r">' + sw0(dsel ? dsel.amt : 0) + ' day-to-day</span></h3><div class="txlist">' +
      (list.length ? list.map(function (tx) {
        var inflow = tx.type === 'income' || tx.type === 'refund', counted = M.D.cats.indexOf(tx.category) > -1;
        return '<div class="tx' + (counted ? '' : ' dim') + '" data-tx="' + esc(tx.id) + '" tabindex="0" role="button"><span class="ti' + (inflow ? ' in' : '') + '">' + txIco(tx) + '</span>' +
          '<span class="d"><b>' + esc(tx.description) + '</b><small>' + esc(tx.category) + (tx.subcategory ? ' › ' + esc(tx.subcategory) : '') + (counted ? '' : ' · not day-to-day') + '</small></span>' +
          '<span class="a' + (inflow ? ' in' : '') + '">' + (inflow ? '+ ' : '− ') + fmtCHF.format(+tx.amount || 0) + '</span></div>';
      }).join('') : '<p class="soon" style="margin:0">Nothing that day.</p>') + '</div></section>';
  }
  var wk = M.wk, avg = function (k) { return wk[k][1] ? wk[k][0] / wk[k][1] : 0; }, mx = Math.max(avg('wd'), avg('sat'), avg('sun'), 1);
  h += '<section class="card"><h3>By weekday<span class="r">average per day</span></h3><div class="wkbars">' +
    [['Mon–Fri', 'wd'], ['Saturday', 'sat'], ['Sunday', 'sun']].map(function (r) {
      return '<div><span>' + r[0] + '</span><span class="b"><i style="width:' + (avg(r[1]) / mx * 100) + '%"></i></span><span class="num">' + sw0(avg(r[1])) + '</span></div>';
    }).join('') + '</div></section>';
  return h;
}

export { calModel, calendarLine, calendarHTML };
