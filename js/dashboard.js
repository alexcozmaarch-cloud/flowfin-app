// FlowFin · Dashboard: day-to-day model, forecast, weeks, card invoice, free cash, projections.
// Shared settings and state (DATA, UI, _cache, CATEGORIES …) are globals from js/config.js.
import { owedLineHTML } from './owed.js';
import { budgetMapFor, budgetRows, catSpend, holidaysBudgeted } from './budgets.js';
import { chartColors, netSavingsData } from './charts.js';
import { $, addDays, calcTotals, daysBetween, esc, fmt0, fmtCHF, inPeriod, isInfra, isSalary, lsGet, pd, periodAt, periodLabel, periodModel, roles, today, txs, ymd } from './core.js';
import { calendarLine } from './calendar.js';
import { goalView } from './goals.js';
import { topbar } from './nav.js';
import { monthEnds } from './wealth.js';
import { priceAlertHTML, priceAlerts, upcomingHTML } from './recurring.js';
import { catIco, ico } from './transactions.js';

// ─── Dashboard ────────────────────────────────────────────────────────────
function sw(n) { return fmtCHF.format(n || 0); }           // 1’234.50
function sw0(n) { return fmt0.format(Math.round(n || 0)); }  // 1’235
function sumBy(list, fn) { return list.reduce(function (s, x) { return s + (fn(x) || 0); }, 0); }
function periodDay(d) { return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.'; }
function signed(n) { return (n < 0 ? '−' : '+') + sw(Math.abs(n)); }
function kpi(label, val, note) { return '<div class="kpi"><label>' + label + '</label><b>' + val + '</b><small>' + (note || '&nbsp;') + '</small></div>'; }

// Collapsible sections: open/closed remembered in this browser only
var FOLD_KEY = 'ff_fold_v1';
function foldState() { try { return JSON.parse(lsGet(FOLD_KEY)) || {}; } catch (e) { return {}; } }
function fold(id, title, right, body, defOpen) {
  var st = foldState(), open = id in st ? st[id] : defOpen;
  return '<details class="fold card" data-fold="' + id + '"' + (open ? ' open' : '') + '><summary><h3>' + title +
    (right ? '<span class="r">' + right + '</span>' : '') + '</h3></summary><div class="foldbody">' + body + '</div></details>';
}

// Drill-through: any element with data-drill opens Transactions with these filters
function drill(f) {
  return ' data-drill="' + esc(JSON.stringify(f)) + '" tabindex="0" role="link"';
}

// ─── Day-to-day model: the budgets you spend from every day (Personal Cash, Collectibles) ───
// One measure for the whole Dashboard: day-to-day budgets for the period, spread evenly over its days.
function d2dCats(p) {
  var map = budgetMapFor(p);
  return Object.keys(CATEGORIES).concat(Object.keys(map)).filter(function (c, i, a) { return a.indexOf(c) === i && isDayToDay(c) && map[c] && +map[c].monthly_limit > 0; });
}
function d2dModel(off) {
  var p = periodAt(off), t = today(), map = budgetMapFor(p), cats = d2dCats(p);
  var days = daysBetween(p.start, p.end) + 1, budget = sumBy(cats, function (c) { return +map[c].monthly_limit || 0; });
  var daily = []; for (var i = 0; i < days; i++) daily.push(0);
  txs().forEach(function (tx) {
    if (!inPeriod(tx, p) || cats.indexOf(tx.category) < 0) return;
    var s = tx.type === 'refund' ? -1 : (tx.type === 'expense' || tx.type === 'investment') ? 1 : 0; if (!s) return;
    daily[daysBetween(p.start, pd(tx.date))] += s * (+tx.amount || 0);
  });
  var isCur = p.start <= t && t <= p.end, elapsed = isCur ? daysBetween(p.start, t) + 1 : (p.end < t ? days : 0);
  var cum = [], run = 0; daily.forEach(function (v) { run += v; cum.push(run); });
  var spent = elapsed ? cum[elapsed - 1] : 0;
  var byCat = cats.map(function (c) { var s = catSpend(c, p); return { cat:c, limit:+map[c].monthly_limit || 0, spent:s.spent }; });
  return { p:p, cats:cats, days:days, budget:budget, perDay:days ? budget / days : 0, daily:daily, cum:cum, elapsed:elapsed, isCur:isCur,
    spent:spent, spentAll:run, sched:run - spent, left:budget - run, daysLeft:isCur ? days - elapsed + 1 : 0, pace:days ? budget * elapsed / days : 0, byCat:byCat };
}
function d2dForecastEnd(D, m) {          // forecast total for the period from the usual-spending forecast of each day-to-day budget
  if (!D.isCur) return D.spentAll;
  var rows = budgetForecastRows(m).filter(function (r) { return D.cats.indexOf(r.cat) > -1 && r.fc !== null; });
  return rows.length ? sumBy(rows, function (r) { return r.fc; }) : D.spentAll;
}

function dashboardHTML() {
  if (!txs().length && UI.sync !== 'ok') return topbar('Dashboard', true) + '<div class="empty">Loading your data from the Sheet…</div>';
  var m = periodModel(UI.periodOffset), D = d2dModel(UI.periodOffset), P = d2dModel(UI.periodOffset - 1);
  var h = topbar('Dashboard', true, '<button class="btn primary" data-act="addtx">+ Add</button>');
  if (!D.budget) {
    h += '<section class="notice"><span>Set your day-to-day budgets (Personal Cash, Collectibles) to see what’s left to spend.</span><button class="btn primary" data-nav="budgets">Plan budgets</button></section>';
  }
  // 1 + 2 · headline and pace check
  var catLine = D.byCat.map(function (c) { var l = c.limit - c.spent; return esc(c.cat) + (l >= 0 ? ' has ' + sw0(l) + ' left' : ' is ' + sw0(-l) + ' over'); }).join('; ');
  h += '<section class="hero">';
  if (D.isCur) {
    var perDay = D.daysLeft ? D.left / D.daysLeft : 0, diff = D.pace - D.spent, same = P.days ? P.cum[Math.min(D.elapsed, P.days) - 1] : null;
    var spentToday = D.elapsed ? D.daily[D.elapsed - 1] || 0 : 0, scale = Math.max(D.budget, D.spent, 1);
    h += '<div class="main"><div class="eyebrow hrow"><span>Left to spend this period</span>' +
      (D.budget ? '<span class="pill ' + (diff >= 0 ? 'ok' : 'over') + '">' + sw0(Math.abs(diff)) + (diff >= 0 ? ' under pace' : ' over pace') + '</span>' : '') + '</div>' +
      '<div class="bignum"><span class="cur">CHF</span><span class="val ' + (D.left < 0 ? 'neg' : '') + '">' + sw0(D.left) + '</span></div>' +
      '<p class="why">' + (D.left >= 0 ? 'About <b class="num">' + sw0(perDay) + '</b> a day for ' + D.daysLeft + ' day' + (D.daysLeft === 1 ? '' : 's') + ' (today included)' : 'Over your day-to-day budgets by ' + sw0(-D.left)) +
      ' · spent <b class="num">' + sw0(spentToday) + '</b> today' + (D.sched > 0.5 ? ' · includes ' + sw0(D.sched) + ' already scheduled' : '') + '.</p></div>';
    h += '<div class="side pacebox"><div class="eyebrow hrow"><span>Pace · day ' + D.elapsed + ' of ' + D.days + '</span>' +
      (same !== null && same !== undefined ? '<span class="lastp">same day last period <b class="num">' + sw0(same) + '</b></span>' : '') + '</div>' +
      '<div class="pmeter" role="img" aria-label="Spent ' + sw0(D.spent) + ' of ' + sw0(D.budget) + '; even pace today ' + sw0(D.pace) + '">' +
      '<b class="' + (D.spent > D.budget ? 'over' : '') + '" style="width:' + Math.min(100, D.spent / scale * 100) + '%"></b><i style="left:' + Math.min(100, D.pace / scale * 100) + '%"></i></div>' +
      '<div class="plab"><span>Spent <b class="num">' + sw0(D.spent) + '</b></span><span>Even pace <b class="num">' + sw0(D.pace) + '</b></span><span>Budget <b class="num">' + sw0(D.budget) + '</b></span></div></div>';
  } else {
    var res = D.budget - D.spentAll;
    h += '<div class="main"><div class="eyebrow">Day-to-day · ' + periodLabel(D.p) + '</div>' +
      '<div class="bignum"><span class="cur">CHF</span><span class="val ' + (res < 0 ? 'neg' : '') + '">' + sw0(D.spentAll) + '</span></div>' +
      '<p class="why">Spent of ' + sw0(D.budget) + ' budgeted: ' + (res >= 0 ? sw0(res) + ' under' : sw0(-res) + ' over') + '. ' + catLine + '.</p></div>' +
      '<div class="side"><div class="line"><span>Budget</span><span class="num">' + sw0(D.budget) + '</span></div><div class="line"><span>Spent</span><span class="num">' + sw0(D.spentAll) + '</span></div>' +
      '<div class="line"><span>Result</span><span class="num ' + (res < 0 ? 'neg' : 'pos') + '">' + sw0(Math.abs(res)) + (res >= 0 ? ' under' : ' over') + '</span></div></div>';
  }
  h += '</section>';
  // 3 · charts: allowance balance (default) or pace
  var mode = dchartMode();
  h += '<section class="card"><h3>' + (mode === 'pace' ? 'Spending this period' : 'Allowance balance') + '<span class="r"><span class="seg3 dseg" role="tablist">' +
    '<button role="tab" aria-selected="' + (mode !== 'pace') + '" class="' + (mode !== 'pace' ? 'on' : '') + '" data-act="dchart" data-v="balance">Balance</button>' +
    '<button role="tab" aria-selected="' + (mode === 'pace') + '" class="' + (mode === 'pace' ? 'on' : '') + '" data-act="dchart" data-v="pace">Pace</button></span></span></h3>' +
    '<div class="legend" style="margin:0 0 6px">' + (mode === 'pace'
      ? '<span><i style="border-top:2px solid var(--ink)"></i>This period</span><span><i style="border-top:2px dotted var(--faint)"></i>Even pace to ' + sw0(D.budget) + '</span><span><i style="border-top:2px dashed var(--faint)"></i>Last period</span>'
      : '<span><i style="border-top:2px solid var(--ink)"></i>This period</span><span><i style="border-top:2px dashed var(--faint)"></i>Last period</span>' + (D.isCur ? '<span><i style="border-top:2px dotted var(--ink)"></i>Projected</span>' : '') + '<span><i style="border-top:2px solid var(--signal)"></i>Below zero</span>') + '</div>' +
    '<p class="chartnote">' + (mode === 'pace' ? 'Day-to-day spending added up. Below the dotted line: under budget.' : 'Each day adds ' + sw0(D.perDay) + ' (day-to-day budgets ÷ ' + D.days + ' days) and takes off what you spent. Above 0: under budget.') + '</p>' +
    '<div class="chartbox"><canvas id="chDaily" role="img" aria-label="' + (mode === 'pace' ? 'Day-to-day spending against an even pace' : 'Allowance balance for the period') + '"></canvas></div></section>';
  // 4 · budgets you act on (all of them, with forecast)
  h += budgetsMiniHTML(m, D);
  // 5 · where the income went (one bar)
  h += waterfallHTML(m);
  // 6 · upcoming: the next three and the total still to pay
  h += upcomingHTML(m, 3);
  if (m.isCurrent) h += priceAlerts().map(priceAlertHTML).join('') + owedLineHTML();
  // 7 · the goal with the nearest deadline
  h += nearestGoalHTML();
  // more detail, one tap down
  h += '<div class="moreh eyebrow">More detail</div>';
  // 7 · weeks
  var w = weeksModel(D), doneW = w.filter(function (x) { return x.state === 'done'; }), good = doneW.filter(function (x) { return x.spent <= x.budget; }).length;
  h += fold('weeks', 'Week by week', doneW.length ? good + ' of ' + doneW.length + ' finished weeks under budget' : sw0(D.perDay * 7) + ' a week', weeksBody(w, D), false);
  // 8 · credit card
  var cc = creditCardModel(m);
  h += fold('cards', 'Credit card', sw0(cc.net) + ' · ' + ccStatus(cc), creditCardBody(m, cc), false);
  // 9 · saved per period
  var nd = netSavingsData(), pos = nd.filter(function (x) { return x.net >= 0; }).length;
  h += fold('net', 'Saved per period', pos + ' of ' + nd.length + ' periods positive',
    '<p class="chartnote">Income minus spending, cards at cost. Money moved into 3a or investing counts as saved.</p><div class="chartbox" style="height:220px"><canvas id="chNet" role="img" aria-label="Net saved per period for the last ' + nd.length + ' periods"></canvas></div>', false);
  h += '<button class="linkrow" data-nav="calendar"><h3>Calendar</h3><span class="r">' + calendarLine(UI.periodOffset) + ' ›</span></button>';
  h += netWorthLink();
  return h;
}
// The goal with the nearest deadline that isn't reached yet
function nearestGoalHTML() {
  var goals = (DATA.FinancialGoal || []).slice().sort(function (a, b) { return String(a.deadline || '9') < String(b.deadline || '9') ? -1 : 1; });
  for (var i = 0; i < goals.length; i++) {
    var v = goalView(goals[i]); if (v.left <= 0) continue;
    var pct = v.target ? Math.min(100, Math.max(0, v.cur / v.target * 100)) : 0;
    return '<button class="goalrow" data-nav="goals">' + ico('target') + '<span class="gt"><b>' + esc(goals[i].name) + '</b><small>' + esc(v.etaText || v.label || '') + (goals[i].deadline ? ' · by ' + periodDay(pd(goals[i].deadline)) + String(goals[i].deadline).slice(0, 4) : '') + '</small>' +
      '<span class="gm"><i style="width:' + pct + '%"></i></span></span><span class="num">' + sw0(v.cur) + ' / ' + sw0(v.target) + '</span></button>';
  }
  return '';
}
// Net worth, one tap down: this month so far and the change since last month's end
function netWorthLink() {
  if (!(DATA.NetWorthEntry || []).length) return '';
  var ms = monthEnds(), cur = ms[ms.length - 1]; if (!cur) return '';
  var chg = ms.length > 1 ? cur.net - ms[ms.length - 2].net : 0;
  return '<button class="linkrow" data-nav="wealth"><h3>Net worth</h3><span class="r">' + sw0(cur.net) + (ms.length > 1 ? ' · ' + (chg >= 0 ? '+' : '−') + sw0(Math.abs(chg)) + ' this month' : '') + ' ›</span></button>';
}
var DCHART_KEY = 'ff_dchart_v1';
function dchartMode() { return lsGet(DCHART_KEY) === 'pace' ? 'pace' : 'balance'; }

// 4 · Income minus each block, in the order money leaves, down to what's left over
function waterfallHTML(m) {
  var p = m.p, T = m.totals, hol = holidaysBudgeted(p);
  var cats = ['Family Infrastructure'].concat(hol ? ['Holidays'] : []).concat(['Personal Cash', 'Collectibles', 'Retirement 3a', 'Financial Investing']);
  var rows = cats.map(function (c) { var s = catSpend(c, p); return { c:c, v:s.spent - s.sched }; })
    .filter(function (r) { return Math.abs(r.v) >= 0.5 || ['Family Infrastructure', 'Personal Cash', 'Collectibles', 'Retirement 3a'].indexOf(r.c) > -1; });
  var inc = T.income, out = sumBy(rows, function (r) { return r.v; }), left = inc - out;
  if (!(inc > 0) && !(out > 0)) return '';
  var shades = ['var(--ink)', 'var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'], base = Math.max(inc, out);
  var bar = rows.map(function (r, i) { return r.v > 0 ? '<i style="width:' + (r.v / base * 100) + '%;background:' + shades[i % shades.length] + '"></i>' : ''; }).join('') +
    (left > 0 ? '<i style="width:' + (left / base * 100) + '%;background:var(--good)"></i>' : '');
  // compact: one bar, a legend you can tap through to the transactions, and what is left
  return '<section class="card"><h3>Where the income went<span class="r">' + (inc > 0 ? sw0(inc) + ' in ' : '') + (m.isCurrent ? 'so far' : periodLabel(p)) + '</span></h3>' +
    '<div class="wfbar">' + bar + '</div><div class="wfleg">' +
    rows.map(function (r, i) { return '<span class="drill"' + drill({ category:r.c === 'Holidays' ? 'Family Infrastructure' : r.c, sub:r.c === 'Holidays' ? 'Vacations' : '' }) + '><i style="background:' + shades[i % shades.length] + '"></i>' + esc(r.c) + ' <b class="num">' + sw0(r.v) + '</b></span>'; }).join('') +
    '<span class="' + (left < 0 ? 'neg' : '') + '"><i style="background:' + (left >= 0 ? 'var(--good)' : 'var(--signal)') + '"></i>' + (left >= 0 ? 'Left over' : 'Short') + ' <b class="num">' + sw0(left) + '</b>' + (inc > 0 ? ' · ' + (left / inc * 100).toFixed(1) + '%' : '') + '</span></div></section>';
}

// 5 · day-to-day budgets and 3a, with the usual-spending forecast
function budgetsMiniHTML(m, D) {
  var rows = budgetForecastRows(m).filter(function (r) { return r.limit > 0 && D.cats.concat(['Family Infrastructure', 'Retirement 3a', 'Holidays', 'Financial Investing']).indexOf(r.cat) > -1; });
  if (!rows.length) return '';
  return '<section class="card"><h3>Budgets<span class="r"><button class="navlink" data-nav="budgets">Edit in Budgets</button></span></h3><div class="minib">' +
    rows.map(function (r) {
      var pct = r.limit ? r.spent / r.limit : 0, fpct = r.fc !== null && r.limit ? r.fc / r.limit : 0;
      return '<div class="mb drill"' + drill({ category:r.cat === 'Holidays' ? 'Family Infrastructure' : r.cat }) + '><span>' + catIco(r.cat) + ' ' + esc(r.cat) + (r.over ? ' <span class="tag ex">over</span>' : r.willOver ? ' <span class="tag ex">heading over</span>' : '') + '</span>' +
        '<span class="num ' + (r.over ? 'neg' : '') + '">' + sw0(r.spent) + (r.fc !== null && Math.round(r.fc) !== Math.round(r.spent) ? ' → ' + sw0(r.fc) : '') + ' / ' + sw0(r.limit) + '</span>' +
        '<span class="mbar">' + (fpct > pct ? '<b style="width:' + Math.min(100, fpct * 100) + '%"></b>' : '') + '<i class="' + (r.over ? 'over' : '') + '" style="width:' + Math.min(100, Math.max(0, pct * 100)) + '%"></i></span></div>';
    }).join('') + '</div><p class="chartnote" style="margin-top:8px">Solid: spent. Shaded: forecast for the whole period from your usual spending.</p></section>';
}

// 7 · seven-day blocks from the start of the period, the last one shorter
function weeksModel(D) {
  var out = [], t = today();
  for (var i = 0; i < D.days; i += 7) {
    var n = Math.min(7, D.days - i), s = addDays(D.p.start, i), e = addDays(D.p.start, i + n - 1), spent = 0;
    for (var k = i; k < i + n; k++) spent += D.daily[k];
    out.push({ start:s, end:e, n:n, budget:D.perDay * n, spent:spent, state:e < t ? 'done' : s > t ? 'future' : 'now', day:s > t ? 0 : Math.min(n, daysBetween(s, t) + 1) });
  }
  return out;
}
function weeksBody(w, D) {
  return '<div class="weeks2">' + w.map(function (x) {
    var pct = x.budget ? x.spent / x.budget : 0, over = x.spent > x.budget + 0.5;
    return '<div class="wk2' + (x.state === 'future' ? ' fut' : ' drill') + '"' + (x.state === 'future' ? '' : drill({ from:ymd(x.start), to:ymd(x.end), dayToDay:true })) + '>' +
      '<span>' + periodDay(x.start) + '–' + periodDay(x.end) + (x.state === 'now' ? ' <span class="tag sch">day ' + x.day + '/' + x.n + '</span>' : '') + '</span>' +
      '<span class="mbar"><i class="' + (over ? 'over' : '') + '" style="width:' + Math.min(100, Math.max(0, pct * 100)) + '%"></i></span>' +
      '<span class="num ' + (over && x.state !== 'future' ? 'neg' : '') + '">' + (x.state === 'future' ? '—' : sw0(x.spent)) + ' / ' + sw0(x.budget) + '</span></div>';
  }).join('') + '</div>';
}

// 3 · Allowance balance (default) or pace, both from the day-to-day budgets
function dashboardCharts() {
  var el = $('chDaily'); if (!el || !window.Chart || CHARTS.daily) return;
  var m = periodModel(UI.periodOffset), D = d2dModel(UI.periodOffset), P = d2dModel(UI.periodOffset - 1), C = chartColors(), mode = dchartMode();
  var labels = []; for (var i = 0; i < D.days; i++) labels.push(periodDay(addDays(D.p.start, i)));
  var cur = [], prev = [], proj = [], extra = [], last = null;
  if (mode === 'pace') {
    for (i = 0; i < D.elapsed; i++) cur.push({ x:i, y:+D.cum[i].toFixed(2) });
    for (i = 0; i < P.days && i < D.days; i++) prev.push({ x:i, y:+P.cum[i].toFixed(2) });
    extra = [{ x:0, y:0 }, { x:D.days - 1, y:D.budget }];
  } else {
    var run = 0;
    for (i = 0; i < D.elapsed; i++) {
      run += D.perDay - D.daily[i]; var y = +run.toFixed(2);
      if (last && ((last.y < 0) !== (y < 0)) && last.y !== 0 && y !== 0) cur.push({ x:last.x + last.y / (last.y - y), y:0 });
      last = { x:i, y:y }; cur.push(last);
    }
    var pr = 0; for (i = 0; i < P.days && i < D.days; i++) { pr += P.perDay - P.daily[i]; prev.push({ x:i, y:+pr.toFixed(2) }); }
    if (D.isCur && last && D.daysLeft > 1) {
      var endY = +(D.budget - d2dForecastEnd(D, m)).toFixed(2), endPt = { x:D.days - 1, y:endY };
      proj.push({ x:last.x, y:last.y });
      if ((last.y < 0) !== (endY < 0) && last.y !== 0 && endY !== 0) proj.push({ x:last.x + (endPt.x - last.x) * last.y / (last.y - endY), y:0 });
      proj.push(endPt);
    }
  }
  var red = function (c) { return mode === 'balance' && (c.p0.parsed.y < 0 || c.p1.parsed.y < 0) ? C.signal : C.ink; };
  var sets = [
    { label:'This period', data:cur, borderColor:C.ink, borderWidth:2.5, tension:0, pointRadius:function (c) { return c.dataIndex === cur.length - 1 ? 4.5 : 0; }, pointBackgroundColor:C.ink, pointBorderWidth:0, segment:{ borderColor:red } },
    { label:'Last period', data:prev, borderColor:C.faint, borderDash:[4,4], borderWidth:1.5, pointRadius:0, tension:0 }
  ];
  if (mode === 'pace') sets.push({ label:'Even pace', data:extra, borderColor:C.faint, borderDash:[2,4], borderWidth:1.5, pointRadius:0, tension:0 });
  else if (proj.length) sets.unshift({ label:'Projected', data:proj, borderColor:C.ink, borderDash:[2,4], borderWidth:2, tension:0,
    pointRadius:function (c) { return c.dataIndex === proj.length - 1 ? 4 : 0; }, pointBackgroundColor:'transparent', pointBorderColor:function (c) { return c.raw && c.raw.y < 0 ? C.signal : C.ink; }, pointBorderWidth:2, segment:{ borderColor:red } });
  CHARTS.daily = new Chart(el, {
    type:'line', data:{ datasets:sets },
    options:{ responsive:true, maintainAspectRatio:false, layout:{ padding:{ left:4, right:6 } }, interaction:{ mode:'nearest', axis:'x', intersect:false },
      plugins:{ legend:{ display:false }, tooltip:{ backgroundColor:C.ink, cornerRadius:0, titleFont:{ family:'IBM Plex Mono' }, bodyFont:{ family:'IBM Plex Mono' },
        filter:function (c) { return Number.isInteger(c.parsed.x) && (c.dataset.label !== 'Projected' || c.dataIndex === c.dataset.data.length - 1); },
        callbacks:{ title:function (items) { return items.length ? labels[Math.round(items[0].parsed.x)] : ''; }, label:function (c) { return c.dataset.label + ': ' + sw0(c.parsed.y); } } } },
      scales:{
        x:{ type:'linear', min:0, max:D.days - 1, afterBuildTicks:function (ax) { var st = ax.options.ticks.stepSize; ax.ticks = ax.ticks.filter(function (t) { return t.value === ax.max || ax.max - t.value >= st * 0.75; }); },
          ticks:{ color:C.muted, stepSize:el.clientWidth < 560 ? 7 : 4, maxRotation:0, font:{ family:'IBM Plex Mono', size:11 }, callback:function (v) { return Number.isInteger(v) ? labels[v] : ''; } }, grid:{ display:false }, border:{ color:C.ink } },
        y:{ beginAtZero:mode === 'pace', ticks:{ color:C.muted, font:{ family:'IBM Plex Mono', size:11 }, callback:function (v) { return sw0(v); } },
            grid:{ color:function (c) { return c.tick.value === 0 && mode === 'balance' ? C.ink : C.rule; } }, border:{ display:false } }
      } }
  });
}

// per category: expense + investment rows minus refunds, up to cutoff (used by "Where it went")
function categorySpend(m) {
  var out = {};
  m.list.forEach(function (tx) {
    if (pd(tx.date) > m.cutoff || tx.type === 'income') return;
    var c = tx.category || 'Other', s = tx.subcategory || '—', a = +tx.amount || 0;
    if (tx.type === 'refund') a = -a;
    out[c] = out[c] || { total:0, subs:{} };
    out[c].total += a; out[c].subs[s] = (out[c].subs[s] || 0) + a;
  });
  return out;
}
function categoryHTML(m) {
  var spend = categorySpend(m), r = roles(), rows = [], fixed = 0;
  // fixed household transfers are shown once at the bottom, not ranked with daily spending
  m.list.forEach(function (tx) { if (isInfra(tx, r) && tx.subcategory === 'General Household' && pd(tx.date) <= m.cutoff) fixed += +tx.amount || 0; });
  Object.keys(spend).forEach(function (c) {
    Object.keys(spend[c].subs).forEach(function (s) {
      var v = spend[c].subs[s];
      if (c === 'Family Infrastructure' && s === 'General Household') v -= fixed;
      if (Math.abs(v) > 0.004) rows.push({ c:c, s:s, v:v });
    });
  });
  rows.sort(function (a, b) { return b.v - a.v; });
  var h = '<section class="card"><h3>Where it went<span class="r">select a row to see its transactions</span></h3>';
  if (!rows.length && !fixed) h += '<div class="empty">No spending in this period</div>';
  rows.slice(0, 9).forEach(function (x) {
    h += '<div class="rowline drill"' + drill({ category:x.c, sub:x.s === '—' ? '' : x.s }) + '><span>' + esc(x.s) + ' <span class="sub">· ' + esc(x.c) + '</span></span><span class="num ' + (x.v < 0 ? 'soon' : '') + '">' + sw(x.v) + '</span></div>';
  });
  if (rows.length > 9) {
    var rest = rows.slice(9).reduce(function (s, x) { return s + x.v; }, 0);
    h += '<div class="rowline"><span class="sub">' + (rows.length - 9) + ' more</span><span class="num">' + sw(rest) + '</span></div>';
  }
  if (fixed) h += '<div class="rowline drill"' + drill({ category:'Family Infrastructure', sub:'General Household' }) + '><span class="sub">Household transfer · fixed</span><span class="num soon">' + sw(fixed) + '</span></div>';
  return h + '</section>';
}

// ─── Budgets & forecast (one block; same spending rule as the Budgets page) ─
var FC_WEIGHTS = [0.5, 1, 1.5, 2, 2.5, 3];
function weightedAvg(vals) { var w = FC_WEIGHTS.slice(-vals.length), t = 0, s = 0; vals.forEach(function (v, i) { s += v * w[i]; t += w[i]; }); return t ? s / t : 0; }
function blend(daysElapsed, daysInPeriod, actual, avg) {
  var w = daysInPeriod > 0 ? Math.min(1, Math.max(0, daysElapsed / daysInPeriod)) : 1;
  var ad = daysElapsed > 0 ? actual / daysElapsed : 0, vd = daysInPeriod > 0 ? avg / daysInPeriod : 0;
  return (w * ad + (1 - w) * vd) * daysInPeriod;
}
// Day-to-day categories get a forecast; fixed household and investing are lump sums, so they don't
function isDayToDay(cat) { if (cat === 'Holidays') return false; var r = roles(); var inf = r.infra.length ? r.infra : ['Family Infrastructure']; return inf.indexOf(cat) < 0 && cat !== 'Financial Investing' && cat !== 'Retirement 3a'; }
var PROJ_KEY = 'ff_proj_v1';
function projBasis() { return lsGet(PROJ_KEY) === 'pace' ? 'pace' : 'usual'; }
function budgetForecastRows(m) {
  return budgetRows(UI.periodOffset).filter(function (r) { return r.limit > 0 || r.spent > 5; }).map(function (r) {
    r.dayToDay = isDayToDay(r.cat);
    r.fc = null;
    if (m.isCurrent && r.dayToDay) {
      var vals = []; for (var i = 6; i >= 1; i--) vals.push(Math.max(0, catSpend(r.cat, periodAt(UI.periodOffset - i), true).spent));
      r.avg = weightedAvg(vals);
      var cur = catSpend(r.cat, periodAt(UI.periodOffset), true), daysLeft = m.daysInPeriod - m.daysElapsed;
      r.toDate = cur.spent - cur.sched;                                   // spent so far, scheduled and one-offs left out
      r.remainUsual = r.avg * daysLeft / m.daysInPeriod;                  // the last days' share of a usual period
      r.remainPace = m.daysElapsed > 0 ? Math.max(0, r.toDate) / m.daysElapsed * daysLeft : 0;   // this period's daily pace
      r.remain = projBasis() === 'pace' ? r.remainPace : r.remainUsual;
      r.fc = r.spent + r.remain;                                          // spent (incl. scheduled) + still to come
    }
    r.over = r.limit > 0 && r.spent > r.limit + 0.004;
    r.willOver = !r.over && r.fc !== null && r.limit > 0 && r.fc > r.limit;
    return r;
  }).sort(function (a, b) { return (b.dayToDay - a.dayToDay) || (b.limit - a.limit); });
}
function budgetForecastHTML(m) {
  var rows = budgetForecastRows(m), d2d = rows.filter(function (r) { return r.dayToDay; });
  var h = '<section class="card"><h3>Budgets' + (m.isCurrent ? ' &amp; forecast' : '') + '<span class="r"><button class="navlink" data-nav="budgets">Edit budgets</button></span></h3>';
  if (m.isCurrent && d2d.length) {
    var spent = sumBy(d2d, function (r) { return r.spent; }), fc = sumBy(d2d, function (r) { return r.fc || 0; }), avg = sumBy(d2d, function (r) { return r.avg || 0; });
    var sched = sumBy(d2d, function (r) { return r.sched; }), vs = avg > 0 ? (fc - avg) / avg * 100 : 0;
    var pace = projBasis() === 'pace';
    h += '<div class="collmode"><span class="soon">Forecast the last ' + (m.daysInPeriod - m.daysElapsed) + ' days from</span><div class="seg2">' +
      '<button class="' + (pace ? '' : 'on') + '" data-act="projbasis" data-v="usual">Your usual (6 periods)</button>' +
      '<button class="' + (pace ? 'on' : '') + '" data-act="projbasis" data-v="pace">This period’s pace</button></div></div>' +
      '<div class="trio">' +
      '<div><label>Day-to-day spent</label><span class="num">' + sw(spent) + '</span><small>' + (sched ? 'incl. ' + sw(sched) + ' scheduled' : '&nbsp;') + '</small></div>' +
      '<div><label>Forecast</label><span class="num">' + sw(fc) + '</span><small class="' + (vs > 10 ? 'neg' : '') + '">' + (vs >= 0 ? '+' : '') + vs.toFixed(0) + '% vs 6-period avg</small></div>' +
      '<div><label>Still to come</label><span class="num">' + sw(Math.max(0, fc - spent)) + '</span><small>' + (m.daysInPeriod - m.daysElapsed) + ' days left</small></div></div>';
  }
  if (!rows.length) h += '<div class="empty">No budgets set</div>';
  rows.forEach(function (r) {
    var scale = Math.max(r.fc || 0, r.limit, r.spent, 1);
    var tag = r.over ? ' <span class="tag ex">over</span>' : r.willOver ? ' <span class="tag ex">heading over</span>' : '';
    var nums = sw0(r.spent) + (r.fc !== null ? ' → ' + sw0(r.fc) : '') + (r.limit ? ' <span class="soon">/ ' + sw0(r.limit) + '</span>' : '');
    var note = [];
    if (r.carry) note.push('+' + sw0(r.carry) + ' rolled over');
    if (r.sched) note.push('incl. ' + sw0(r.sched) + ' scheduled');
    if (!r.dayToDay) note.push('fixed, no forecast');
    h += '<div class="fcrow drill"' + drill({ category:r.cat }) + '><div class="fct"><span>' + catIco(r.cat) + ' ' + esc(r.cat) + tag + '</span><span class="num">' + nums + '</span></div>' +
      '<div class="bar fcbar">' + (r.fc !== null ? '<b style="width:' + Math.min(100, r.fc / scale * 100) + '%"></b>' : '') +
      '<i class="' + (r.over || r.willOver ? 'over' : '') + '" style="width:' + Math.min(100, Math.max(0, r.spent / scale * 100)) + '%"></i>' +
      (r.limit ? '<em class="budget" style="left:' + Math.min(100, r.limit / scale * 100) + '%"></em>' : '') + '</div>' +
      (note.length ? '<div class="fcnote">' + note.join(' · ') + '</div>' : '') + '</div>';
  });
  h += '<p class="soon" style="font-size:12px;margin:10px 0 0">' + (m.isCurrent ? 'Dark bar: spent. Light bar: forecast for the full period. ' : 'Bar: spent. ') + 'Tick: limit including rollover.</p>';
  var renewals = (DATA.Subscription || []).filter(function (s) {
    if (s.status !== 'active' || !s.next_renewal || !(+s.amount > 0)) return false;
    var dd = pd(s.next_renewal); return dd >= today() && dd <= m.p.end;
  }).sort(function (a, b) { return a.next_renewal < b.next_renewal ? -1 : 1; });
  if (m.isCurrent && renewals.length) {
    h += '<div style="margin-top:14px">' + renewals.map(function (s) {
      return '<div class="rowline"><span>' + esc(s.name) + ' <span class="sub">· renews ' + periodDay(pd(s.next_renewal)) + '</span></span><span class="num">' + sw(+s.amount) + '</span></div>';
    }).join('') + '</div>';
  }
  return h + '</section>';
}

// ─── Week by week ─────────────────────────────────────────────────────────
function weeklyModel(m) {
  var weeks = [], cur = new Date(m.p.start), idx = 0, r = roles();
  while (cur <= m.p.end) {
    var dow = (cur.getDay() + 6) % 7;                 // 0 = Monday
    var we = addDays(cur, 6 - dow); if (we > m.p.end) we = new Date(m.p.end);
    var days = daysBetween(cur, we) + 1, spent = 0, cats = {};
    for (var d = new Date(cur); d <= we; d = addDays(d, 1)) { if (d <= m.cutoff) spent += m.dailyMap[ymd(d)] || 0; }
    m.list.forEach(function (tx) {
      var dd = pd(tx.date);
      if (tx.type !== 'expense' || dd < cur || dd > we || dd > m.cutoff || isInfra(tx, r)) return;
      var k = tx.subcategory || tx.category; cats[k] = (cats[k] || 0) + (+tx.amount || 0);
    });
    var topK = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; })[0];
    var future = cur > m.cutoff, partial = !future && we > m.cutoff;
    var elapsed = future ? 0 : Math.min(days, daysBetween(cur, m.cutoff) + 1);
    weeks.push({ n:++idx, start:new Date(cur), end:we, days:days, budget:m.dailyBudget * days, spent:spent,
      surplus:m.dailyBudget * days - spent, future:future, partial:partial, elapsed:elapsed, top:topK });
    cur = addDays(we, 1);
  }
  return weeks;
}
function weeklyBody(w) {
  return '<div class="weeks">' + w.map(function (x) {
    var pct = x.budget > 0 ? x.spent / x.budget : 0;
    var state = x.future ? 'Not started' : (x.surplus >= 0 ? (x.partial ? sw(x.surplus) + ' left' : '+' + sw(x.surplus) + ' saved') : sw(-x.surplus) + ' over');
    return '<div class="week' + (x.future ? ' future' : ' drill') + '"' + (x.future ? '' : drill({ from:ymd(x.start), to:ymd(x.end), dayToDay:true })) + '>' +
      '<div class="wk"><b>W' + x.n + (x.partial ? ' <span class="tag sch">day ' + x.elapsed + '/' + x.days + '</span>' : '') + '</b><span>' + periodDay(x.start) + '–' + periodDay(x.end) + '</span></div>' +
      '<div class="bar"><i class="' + (pct > 1 ? 'over' : '') + '" style="width:' + Math.min(100, Math.max(0, pct * 100)) + '%"></i>' +
      (x.partial ? '<em style="left:' + (x.elapsed / x.days * 100) + '%"></em>' : '') + '</div>' +
      '<div class="wn"><span class="num">' + (x.future ? '—' : sw(x.spent)) + ' / ' + sw0(x.budget) + '</span><small class="' + (x.surplus < 0 && !x.future ? 'neg' : '') + '">' + state + (x.top && !x.future ? ' · top: ' + esc(x.top) : '') + '</small></div>' +
      '</div>';
  }).join('') + '</div>';
}

// ─── Credit card invoice (10th–9th, paid on the 25th after it closes) ─────
function creditCardModel(m) {
  var t = today();
  var cc = m.list.filter(function (tx) { return tx.account === 'credit_card'; });
  var out = sumBy(cc, function (tx) { return (tx.type === 'expense' || tx.type === 'investment') ? +tx.amount : 0; });
  var back = sumBy(cc, function (tx) { return tx.type === 'refund' ? +tx.amount : 0; });
  var net = out - back;
  var pay = new Date(m.p.end.getFullYear(), m.p.end.getMonth(), 25);
  var perDay = m.daysElapsed > 0 ? net / m.daysElapsed : 0;
  var tot = 0, n = 0;
  for (var i = 1; i <= 3; i++) {
    var p = periodAt(UI.periodOffset - i);
    var s = sumBy(txs(), function (tx) { return (tx.account === 'credit_card' && (tx.type === 'expense' || tx.type === 'investment') && inPeriod(tx, p)) ? +tx.amount : 0; });
    if (s > 0) { tot += s; n++; }
  }
  var cats = {};
  cc.forEach(function (tx) {
    if (tx.type !== 'expense' && tx.type !== 'investment') return;
    var k = tx.subcategory || tx.category || 'Other';
    cats[k] = (cats[k] || 0) + (+tx.amount || 0);
  });
  var top = Object.keys(cats).map(function (k) { return { k:k, v:cats[k] }; }).sort(function (a, b) { return b.v - a.v; });
  var sched = sumBy(cc, function (tx) { return (pd(tx.date) > t && tx.type !== 'refund' && tx.type !== 'income') ? +tx.amount : 0; });
  return { sched:sched, net:net, back:back, projected:m.isCurrent ? perDay * m.daysInPeriod : net, avg3:n ? tot / n : 0, pay:pay, daysToPay:daysBetween(t, pay), top:top };
}
function ccStatus(c) { return c.daysToPay < 0 ? 'card paid ' + periodDay(c.pay) : c.daysToPay === 0 ? 'card due today' : 'card due ' + periodDay(c.pay); }
function creditCardBody(m, c) {
  var over = c.avg3 > 0 && c.projected > c.avg3 * 1.1;
  var h = '<div><div class="subhead drill"' + drill({ account:'credit_card' }) + '><b>Credit card invoice</b><span>' +
    (c.daysToPay < 0 ? 'Paid ' + periodDay(c.pay) : c.daysToPay === 0 ? 'Due today' : 'Due ' + periodDay(c.pay) + ' · in ' + c.daysToPay + ' day' + (c.daysToPay === 1 ? '' : 's')) + '</span></div>' +
    '<div class="trio">' +
    '<div><label>On this invoice</label><span class="num">' + sw(c.net) + '</span><small>' + (c.sched ? 'incl. ' + sw(c.sched) + ' scheduled' : c.back ? sw(c.back) + ' refunded' : '&nbsp;') + '</small></div>' +
    '<div><label>Projected</label><span class="num ' + (over ? 'neg' : '') + '">' + sw(c.projected) + '</span><small>' + (m.isCurrent ? 'at today’s pace' : 'final') + '</small></div>' +
    '<div><label>3-period avg</label><span class="num">' + (c.avg3 ? sw(c.avg3) : '—') + '</span><small>&nbsp;</small></div></div>';
  var max = c.top.length ? c.top[0].v : 1;
  c.top.slice(0, 5).forEach(function (x) {
    h += '<div class="minibar"><span>' + esc(x.k) + '</span><div class="bar"><i style="width:' + (x.v / max * 100) + '%"></i></div><span class="num">' + sw(x.v) + '</span></div>';
  });
  return h + '</div>';
}
function accountBody(m) {
  var a = { credit_card:{ out:0, back:0, n:0 }, debit_card:{ out:0, back:0, n:0 } }, inc = 0;
  m.list.forEach(function (tx) {
    if (pd(tx.date) > m.cutoff) return;
    var k = a[tx.account]; if (!k) return;
    if (tx.type === 'income') { inc += +tx.amount || 0; return; }
    if (tx.type === 'refund') k.back += +tx.amount || 0; else { k.out += +tx.amount || 0; k.n++; }
  });
  return '<div><div class="subhead"><b>Cards</b><span>net spend this period</span></div>' +
    '<div class="rowline drill"' + drill({ account:'credit_card' }) + '><span>Credit card <span class="sub">· ' + a.credit_card.n + ' payments</span></span><span class="num">' + sw(a.credit_card.out - a.credit_card.back) + '</span></div>' +
    '<div class="rowline drill"' + drill({ account:'debit_card' }) + '><span>Debit card <span class="sub">· ' + a.debit_card.n + ' payments</span></span><span class="num">' + sw(a.debit_card.out - a.debit_card.back) + '</span></div>' +
    '<div class="rowline"><span>Income in</span><span class="num">' + sw(inc) + '</span></div></div>';
}

// ─── Free cash allocation: how accrued free cash was used, and the split it should follow ─
var FUNDS = [['emergency','Emergency'],['invest','Investments'],['savings','Savings'],['fun','Entertainment']];
var FUND_SHADE = ['var(--ink)', 'var(--s1)', 'var(--s3)', 'var(--s4)'];
function fundBody(m) {
  var pct = { emergency:20, invest:50, savings:20, fun:10 };
  (DATA.FundAllocation || []).forEach(function (f) { if (f.key in pct) pct[f.key] = +f.pct || 0; });
  var acc = Math.max(m.accrued, 0.01), paid = Math.max(0, m.paid), sched = Math.max(0, m.scheduledFree), free = m.afterScheduled;
  var over = free < 0;
  var h = '<div><div class="subhead"><b>Free cash</b><span>' + sw(m.dailyBudget) + ' × ' + m.daysElapsed + ' days = ' + sw(m.accrued) + '</span></div>' +
    '<div class="splitlabel">How it was used</div>' +
    '<div class="split"><i style="width:' + Math.min(100, paid / acc * 100) + '%;background:var(--ink)"></i>' +
    '<i style="width:' + Math.min(100, sched / acc * 100) + '%;background:repeating-linear-gradient(135deg,var(--ink) 0 2px,transparent 2px 6px)"></i>' +
    (free > 0 ? '<i style="width:' + (free / acc * 100) + '%;background:var(--rule)"></i>' : '') + '</div>' +
    '<div class="splitkey"><span><i style="background:var(--ink)"></i>Paid ' + sw(paid) + '</span><span><i style="background:repeating-linear-gradient(135deg,var(--ink) 0 2px,transparent 2px 6px)"></i>Scheduled ' + sw(sched) + '</span>' +
    '<span class="' + (over ? 'neg' : '') + '"><i style="background:var(--rule)"></i>' + (over ? 'Over by ' + sw(-free) : 'Free to move ' + sw(free)) + '</span></div>' +
    '<div class="splitlabel" style="margin-top:14px">Your split for what’s free</div>' +
    '<div class="split">' + FUNDS.map(function (f, i) { return '<i style="width:' + pct[f[0]] + '%;background:' + FUND_SHADE[i] + '"></i>'; }).join('') + '</div>' +
    '<div class="splitkey">' + FUNDS.map(function (f, i) {
      return '<span><i style="background:' + FUND_SHADE[i] + '"></i>' + f[1] + ' ' + pct[f[0]] + '% · ' + sw0(Math.max(0, free) * pct[f[0]] / 100) + '</span>';
    }).join('') + '</div>';
  (DATA.FinancialGoal || []).forEach(function (g) {
    var p = +g.target_amount ? (+g.current_amount || 0) / +g.target_amount : 0;
    h += '<div class="budget" style="padding-top:16px"><span>Goal · ' + esc(g.name) + (g.deadline ? ' <span class="soon">by ' + pd(g.deadline).getFullYear() + '</span>' : '') + '</span><span class="num">' + sw0(+g.current_amount) + ' / ' + sw0(+g.target_amount) + '</span>' +
      '<div class="bar"><i style="width:' + Math.min(100, p * 100) + '%"></i></div></div>';
  });
  return h + '</div>';
}

// ─── Projections ──────────────────────────────────────────────────────────
// Period end: today's daily net balance + daily budget for the days left − forecast day-to-day spending still to come
// (the forecast already includes scheduled entries, so they are counted once, as spending still to come).
function periodEndProjection(m) {
  if (!m.isCurrent) return null;
  var d2d = budgetForecastRows(m).filter(function (r) { return r.dayToDay && r.fc !== null; });
  var sched = sumBy(d2d, function (r) { return r.sched; });
  var parts = d2d.map(function (r) { return { cat:r.cat, v:r.remain }; }).filter(function (x) { return x.v > 0.5; });
  var still = sched + sumBy(parts, function (x) { return x.v; });
  var daysLeft = m.daysInPeriod - m.daysElapsed, now = 0;
  for (var i = 0; i < m.daysElapsed; i++) now += m.dailyBudget - (m.dailyMap[ymd(addDays(m.p.start, i))] || 0);
  var prev = periodModel(UI.periodOffset - 1), prevEnd = 0;
  for (var j = 0; j < prev.daysInPeriod; j++) prevEnd += prev.dailyBudget - (prev.dailyMap[ymd(addDays(prev.p.start, j))] || 0);
  return { sched:sched, parts:parts, basis:projBasis(), now:now, end:now + m.dailyBudget * daysLeft - still, still:still, budgetLeft:m.dailyBudget * daysLeft, daysLeft:daysLeft, prevEnd:prevEnd };
}

// Savings: net saved in the last 6 finished periods, then 12 periods forward at your pace and at target
var COLL_KEY = 'ff_coll_v1';
function collAsSavings() { return lsGet(COLL_KEY) === 'savings'; }
function savingsProjection() {
  var asSav = collAsSavings();
  var hist = [], r = roles(), totalPct = sumBy(DATA.FundAllocation || [], function (f) { return +f.pct; }) || 20;
  for (var i = 6; i >= 1; i--) {
    var off = UI.periodOffset - i, p = periodAt(off), list = txs().filter(function (tx) { return inPeriod(tx, p); });
    var T = calcTotals(list, p.end, 0, 0);
    var sal = sumBy(list, function (tx) { return isSalary(tx, r) ? +tx.amount : 0; });
    var inf = sumBy(list, function (tx) { return isInfra(tx, r) ? +tx.amount : 0; });
    var free = sal > 0 ? Math.max(0, sal - inf) : BENCHMARK_SALARY - BENCHMARK_INFRA;
    hist.push({ p:p, net:asSav ? T.netCashFlow : T.netSaved, coll:T.collectibles, target:free * totalPct / 100, has:T.income > 0 || T.expenses > 0 });
  }
  hist = hist.filter(function (h) { return h.has; });
  var n = hist.length || 1;
  var pace = sumBy(hist, function (h) { return h.net; }) / n, target = sumBy(hist, function (h) { return h.target; }) / n;
  var labels = [], actual = [], atPace = [], atTarget = [], run = 0;
  hist.forEach(function (h, k) {
    run += h.net; labels.push(periodDay(h.p.start).slice(3) + String(h.p.start.getFullYear()).slice(2));
    actual.push(+run.toFixed(0)); var last = k === hist.length - 1;
    atPace.push(last ? +run.toFixed(0) : null); atTarget.push(last ? +run.toFixed(0) : null);
  });
  var rp = run, rt = run;
  for (var f = 0; f < 12; f++) {
    var fp = periodAt(UI.periodOffset + f);
    rp += pace; rt += target;
    labels.push(periodDay(fp.start).slice(3) + String(fp.start.getFullYear()).slice(2));
    actual.push(null); atPace.push(+rp.toFixed(0)); atTarget.push(+rt.toFixed(0));
  }
  var goals = (DATA.FinancialGoal || []).map(function (g) {
    var left = Math.max(0, (+g.target_amount || 0) - (+g.current_amount || 0));
    function eta(per) { if (!(per > 0)) return null; var k = Math.ceil(left / per); return { periods:k, date:periodAt(UI.periodOffset + k).start }; }
    var dl = g.deadline ? pd(g.deadline) : null, need = null;
    if (dl) { var t = today(), months = (dl.getFullYear() - t.getFullYear()) * 12 + (dl.getMonth() - t.getMonth()); need = months > 0 ? left / months : null; }
    return { name:g.name, target:+g.target_amount || 0, current:+g.current_amount || 0, left:left, deadline:dl, need:need, atPace:eta(pace), atTarget:eta(target) };
  });
  return { asSav:asSav, coll:sumBy(hist, function (h) { return h.coll; }), hist:hist, pace:pace, target:target, total:run, in12Pace:rp, in12Target:rt, labels:labels, actual:actual, atPace:atPace, atTarget:atTarget, goals:goals };
}
function monthYear(d) { return d.toLocaleDateString('en-GB', { month:'short', year:'numeric' }); }
function savingsProjectionBody(sp) {
  var h = '<div class="collmode"><span class="soon">Collectibles bought count as</span><div class="seg2">' +
    '<button class="' + (sp.asSav ? '' : 'on') + '" data-act="collmode" data-v="spending">Spending</button>' +
    '<button class="' + (sp.asSav ? 'on' : '') + '" data-act="collmode" data-v="savings">Savings, at cost</button></div>' +
    '<span class="soon">' + sw0(sp.coll) + ' on collectibles in these ' + sp.hist.length + ' periods</span></div>' +
    '<div class="trio">' +
    '<div><label>Saved, last ' + sp.hist.length + ' periods</label><span class="num ' + (sp.total < 0 ? 'neg' : '') + '">' + sw(sp.total) + '</span><small>' + sw(sp.pace) + ' a period on average</small></div>' +
    '<div><label>In 12 periods at your pace</label><span class="num ' + (sp.in12Pace < 0 ? 'neg' : '') + '">' + sw(sp.in12Pace) + '</span><small>if the last ' + sp.hist.length + ' periods repeat</small></div>' +
    '<div><label>In 12 periods at target</label><span class="num">' + sw(sp.in12Target) + '</span><small>' + sw0(sp.target) + ' a period, your full free-cash split</small></div></div>' +
    '<div class="legend" style="justify-content:flex-end;margin-bottom:6px"><span><i style="border-top:2px solid var(--ink)"></i>Saved</span><span><i style="border-top:2px dotted var(--ink)"></i>At your pace</span><span><i style="border-top:2px dashed var(--faint)"></i>At target</span></div>' +
    '<div class="chartbox" style="height:240px"><canvas id="chSave" role="img" aria-label="Cumulative net saved over the last ' + sp.hist.length + ' periods and projected 12 periods ahead"></canvas></div>';
  sp.goals.forEach(function (g) {
    var pace = g.atPace ? monthYear(g.atPace.date) + ' (' + Math.round(g.atPace.periods / 12 * 10) / 10 + ' years)' : 'not reached at this pace';
    var tgt = g.atTarget ? monthYear(g.atTarget.date) + ' (' + Math.round(g.atTarget.periods / 12 * 10) / 10 + ' years)' : '—';
    var late = g.deadline && g.atPace && g.atPace.date > g.deadline;
    h += '<div class="goalproj"><div class="subhead"><b>Goal · ' + esc(g.name) + '</b><span>' + sw0(g.current) + ' of ' + sw0(g.target) + (g.deadline ? ' · deadline ' + monthYear(g.deadline) : '') + '</span></div>' +
      '<div class="rowline"><span>If all net saved went to it, at your pace</span><span class="num ' + (!g.atPace || late ? 'neg' : '') + '">' + pace + '</span></div>' +
      '<div class="rowline"><span>At your savings target</span><span class="num">' + tgt + '</span></div>' +
      (g.need ? '<div class="rowline"><span>Needed to make the deadline</span><span class="num">' + sw(g.need) + ' a month</span></div>' : '') + '</div>';
  });
  return h;
}
function savingsChart() {
  var el = $('chSave'); if (!el || !window.Chart || CHARTS.save) return;
  if (!el.closest('details[open]')) return;
  var sp = savingsProjection(), C = chartColors();
  CHARTS.save = new Chart(el, {
    type:'line',
    data:{ labels:sp.labels, datasets:[
      { label:'Saved', data:sp.actual, borderColor:C.ink, borderWidth:2.5, pointRadius:3, pointBackgroundColor:C.ink, tension:0, spanGaps:false,
        segment:{ borderColor:function (c) { return (c.p0.parsed.y < 0 || c.p1.parsed.y < 0) ? C.signal : C.ink; } } },
      { label:'At your pace', data:sp.atPace, borderColor:C.ink, borderDash:[2,4], borderWidth:2, pointRadius:0, tension:0 },
      { label:'At target', data:sp.atTarget, borderColor:C.faint, borderDash:[6,4], borderWidth:1.5, pointRadius:0, tension:0 }
    ]},
    options:{ responsive:true, maintainAspectRatio:false, layout:{ padding:{ left:4 } }, interaction:{ mode:'index', intersect:false },
      plugins:{ legend:{ display:false }, tooltip:{ backgroundColor:C.ink, cornerRadius:0, titleFont:{ family:'IBM Plex Mono' }, bodyFont:{ family:'IBM Plex Mono' },
        filter:function (c) { return c.raw != null; },
        callbacks:{ label:function (c) { return c.dataset.label + ': ' + sw(c.raw); } } } },
      scales:{
        x:{ ticks:{ color:C.muted, maxRotation:0, autoSkip:true, maxTicksLimit:10, font:{ family:'IBM Plex Mono', size:11 } }, grid:{ display:false }, border:{ color:C.ink } },
        y:{ ticks:{ color:C.muted, font:{ family:'IBM Plex Mono', size:11 }, callback:function (v) { return sw0(v); } },
            grid:{ color:function (c) { return c.tick.value === 0 ? C.ink : C.rule; } }, border:{ display:false } }
      } }
  });
}

export { sw, sw0, sumBy, periodDay, signed, kpi, FOLD_KEY, foldState, fold, drill, d2dCats, d2dModel, d2dForecastEnd, dashboardHTML, DCHART_KEY, dchartMode, waterfallHTML, budgetsMiniHTML, weeksModel, weeksBody, dashboardCharts, categorySpend, categoryHTML, FC_WEIGHTS, weightedAvg, blend, isDayToDay, PROJ_KEY, projBasis, budgetForecastRows, budgetForecastHTML, weeklyModel, weeklyBody, creditCardModel, ccStatus, creditCardBody, accountBody, FUNDS, FUND_SHADE, fundBody, periodEndProjection, COLL_KEY, collAsSavings, savingsProjection, monthYear, savingsProjectionBody, savingsChart };
