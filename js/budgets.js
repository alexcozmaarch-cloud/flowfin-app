// FlowFin · Budgets, budget check and the allowance planner.
// Shared settings and state (DATA, UI, _cache, CATEGORIES …) are globals from js/config.js.
import { saveRow } from './api.js';
import { $, esc, inPeriod, isSalary, lsGet, pd, periodAt, periodLabel, roles, toast, today, txs, ymd } from './core.js';
import { fold, kpi, periodDay, sumBy, sw, sw0 } from './dashboard.js';
import { seq } from './jobs.js';
import { draw, topbar } from './nav.js';
import { recurringBody } from './recurring.js';
import { catIco, ico } from './transactions.js';

// ─── Budgets (shared by the Budgets page and the dashboard gauges) ────────
// Spend = expense + investment rows in the category minus refunds in it, whole period (scheduled included).
// Rollover: effective limit = base + last period's unspent amount (never a deficit).
// "Holidays" is its own budget for Vacations spending; while it has a limit, Vacations no longer counts in Family Infrastructure
function holidaysBudgeted(p) { var b = budgetMapFor(p)['Holidays']; return !!(b && +b.monthly_limit > 0); }
function catSpend(cat, p, skipOneOffs) {
  var spent = 0, sched = 0, t = today(), hol = cat === 'Family Infrastructure' && holidaysBudgeted(p);
  txs().forEach(function (tx) {
    if (!inPeriod(tx, p)) return;
    if (cat === 'Holidays' ? tx.subcategory !== 'Vacations' : (tx.category !== cat || (hol && tx.subcategory === 'Vacations'))) return;
    if (skipOneOffs && tx.anomaly_status === 'excluded') return;
    var a = +tx.amount || 0;
    if (tx.type === 'expense' || tx.type === 'investment') { spent += a; if (pd(tx.date) > t) sched += a; }
    else if (tx.type === 'refund') spent -= a;
  });
  return { spent:spent, sched:sched };
}
// Budgets can change over time: a row's "period" is the first billing period it applies to (empty = from the start).
// For any period, each category uses its latest row that has started by then.
function budgetMapFor(p) {
  var start = ymd(p.start), map = {};
  (DATA.Budget || []).slice().sort(function (a, b) { return String(a.period || '') < String(b.period || '') ? -1 : 1; })
    .forEach(function (b) { if (!b.period || String(b.period).slice(0, 10) <= start) map[b.category] = b; });
  return map;
}
function nextBudget(cat, p) {          // the next change scheduled after period p, if any
  var start = ymd(p.start), n = null;
  (DATA.Budget || []).forEach(function (b) { var bp = String(b.period || '').slice(0, 10); if (b.category === cat && bp > start && (!n || bp < String(n.period))) n = b; });
  return n;
}
function budgetRows(offset) {
  var p = periodAt(offset), prev = periodAt(offset - 1), map = budgetMapFor(p);
  var cats = Object.keys(CATEGORIES);
  Object.keys(map).forEach(function (c) { if (cats.indexOf(c) < 0) cats.push(c); });
  return cats.map(function (c) {
    var b = map[c] || null, base = b ? +b.monthly_limit || 0 : 0, roll = b && truthy(b.rollover_enabled);
    var carry = 0, pb = budgetMapFor(prev)[c], pbase = pb ? +pb.monthly_limit || 0 : 0;
    if (roll && base > 0 && pbase > 0) carry = Math.max(0, pbase - catSpend(c, prev).spent);
    var s = catSpend(c, p), limit = base + carry;
    return { cat:c, b:b, base:base, roll:roll, carry:carry, limit:limit, spent:s.spent, sched:s.sched,
      pct: limit > 0 ? s.spent / limit : 0, left: limit - s.spent };
  });
}
function truthy(v) { return v === true || String(v).toLowerCase() === 'true'; }
function ledger(row, offset) {
  var out = [], run = 0;
  for (var i = 6; i >= 0; i--) {
    var p = periodAt(offset - i), sp = catSpend(row.cat, p).spent, sur = Math.max(0, row.base - sp);
    run += sur;
    out.push({ label:periodLabel(p), spent:sp, surplus:sur, run:run, current:i === 0 });
  }
  return out;
}

// ─── Budget check ─────────────────────────────────────────────────────────
// Budgets against what you actually earn and spend (last 6 finished periods, one-offs left out), plus a few
// market prices for things you pay for regularly. Recomputed from your data every time.
var MARKET = [
  { re:/swisscom|sunrise|\bsalt\b|yallo|wingo|mobile/i, label:'Mobile plan', market:15, note:'unlimited Swiss mobile plans start around CHF 11–15 a month (moneyland, January 2026)' },
  { re:/base44/i, label:'Base44', market:0, note:'replaced by FlowFin; cancel once the two weeks side by side are over' }
];
var BFS_SAVE_PCT = 15.6;   // average Swiss household saves 15.6% of gross income (BFS household budget survey 2022)
function finishedPeriods(n) {
  var first = txs().reduce(function (m, tx) { return !m || tx.date < m ? tx.date : m; }, '');
  var out = []; for (var i = 1; i <= n; i++) { var p = periodAt(UI.periodOffset - i); if (first && ymd(p.end) >= first) out.push(p); }
  return out;
}
function median(a) { var b = a.slice().sort(function (x, y) { return x - y; }), m = Math.floor(b.length / 2); return b.length ? (b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2) : 0; }
function budgetCheckHTML() {
  var ps = finishedPeriods(6); if (ps.length < 2) return '';
  var r = roles();
  var salary = ps.map(function (p) { return sumBy(txs().filter(function (tx) { return inPeriod(tx, p) && tx.anomaly_status !== 'excluded' && isSalary(tx, r); }), function (tx) { return +tx.amount || 0; }); });
  var inc = sumBy(salary, function (x) { return x; }) / ps.length;
  var cur = periodAt(UI.periodOffset), map = budgetMapFor(cur);
  var cats = Object.keys(CATEGORIES).filter(function (c) { return map[c] && +map[c].monthly_limit > 0 || ps.some(function (p) { return catSpend(c, p, true).spent > 5; }); });
  var rows = cats.map(function (c) {
    var spend = ps.map(function (p) { return Math.max(0, catSpend(c, p, true).spent); });
    var nb = nextBudget(c, cur);
    return { cat:c, budget:map[c] ? +map[c].monthly_limit || 0 : 0, avg:sumBy(spend, function (x) { return x; }) / ps.length, med:median(spend), next:nb };
  });
  var totB = sumBy(rows, function (x) { return x.budget; }), totA = sumBy(rows, function (x) { return x.avg; });
  var nextDate = rows.filter(function (x) { return x.next; }).map(function (x) { return String(x.next.period).slice(0, 10); }).sort()[0];
  var totN = nextDate ? sumBy(rows, function (x) { var b = budgetMapFor({ start:pd(nextDate) })[x.cat]; return b ? +b.monthly_limit || 0 : 0; }) : null;
  var gapNow = inc - totB, gapNext = totN === null ? null : inc - totN;
  var h = '<p class="soon" style="margin:0 0 14px;max-width:62rem">Your budgets against your salary and what you actually spent over the last ' + ps.length + ' finished periods (' + periodDay(ps[ps.length - 1].start) + ' – ' + periodDay(ps[0].end) + String(ps[0].end.getFullYear()) + '), one-offs left out.</p>';
  h += '<section class="kpis" style="grid-template-columns:repeat(' + (totN === null ? 3 : 4) + ',minmax(0,1fr));margin-bottom:18px">' +
    kpi('Salary', sw0(inc), 'a period, average') +
    kpi('Budgeted now', sw0(totB), '<span class="' + (gapNow < 0 ? 'neg' : '') + '">' + (gapNow < 0 ? sw0(-gapNow) + ' more than salary' : sw0(gapNow) + ' not budgeted') + '</span>') +
    (totN === null ? '' : kpi('From ' + periodDay(pd(nextDate)) + nextDate.slice(0, 4), sw0(totN), '<span class="' + (gapNext < -1 ? 'neg' : '') + '">' + (gapNext < -1 ? sw0(-gapNext) + ' more than salary' : sw0(gapNext) + ' not budgeted') + '</span>')) +
    kpi('Spent, usual period', sw0(totA), '<span class="' + (inc - totA < 0 ? 'neg' : '') + '">' + (inc - totA >= 0 ? sw0(inc - totA) + ' left' : sw0(totA - inc) + ' short') + '</span> on average') + '</section>';
  h += '<div class="atable chk"><div class="ah"><span>Category</span><span>Budget</span><span>Usual spend</span><span>' + (nextDate ? 'From ' + periodDay(pd(nextDate)) : '') + '</span><span>Fits?</span></div>' +
    rows.map(function (x) {
      var lim = x.next ? +x.next.monthly_limit || 0 : x.budget, diff = lim - x.avg;
      var verdict = !lim ? '<span class="soon">no budget</span>' : Math.abs(diff) < lim * 0.05 ? 'about right' : diff > 0 ? '<span class="soon">' + sw0(diff) + ' spare</span>' : '<span class="neg">' + sw0(-diff) + ' over</span>';
      return '<div><span><b>' + catIco(x.cat) + ' ' + esc(x.cat) + '</b><small>typical period ' + sw0(x.med) + '</small></span><span class="num">' + (x.budget ? sw0(x.budget) : '—') + '</span>' +
        '<span class="num">' + sw0(x.avg) + '</span><span class="num">' + (x.next ? sw0(+x.next.monthly_limit || 0) : '') + '</span><span>' + verdict + '</span></div>';
    }).join('') + '</div>';
  // regular costs above market price
  var last3 = ps.slice(0, 3), finds = [];
  MARKET.forEach(function (m) {
    var amt = sumBy(txs().filter(function (tx) { return m.re.test(tx.description || '') && (tx.type === 'expense') && last3.some(function (p) { return inPeriod(tx, p); }); }), function (tx) { return +tx.amount || 0; }) / last3.length;
    if (amt > m.market + 5) finds.push({ label:m.label, amt:amt, save:amt - m.market, note:m.note });
  });
  // lumpy costs worth a monthly set-aside
  var vac = ps.map(function (p) { return sumBy(txs().filter(function (tx) { return inPeriod(tx, p) && tx.subcategory === 'Vacations' && tx.type === 'expense'; }), function (tx) { return +tx.amount || 0; }); });
  var vacAvg = sumBy(vac, function (x) { return x; }) / ps.length;
  h += '<div class="subhead" style="margin-top:22px"><b>Where money could come from</b><span>regular costs compared with market prices</span></div>';
  h += finds.length ? '<div class="atable chk2">' + finds.map(function (f) {
    return '<div><span><b>' + esc(f.label) + '</b><small>' + esc(f.note) + '</small></span><span class="num">' + sw0(f.amt) + '</span><span class="num pos">−' + sw0(f.save) + '</span></div>';
  }).join('') + '<div><span><b>Together</b></span><span></span><span class="num pos">−' + sw0(sumBy(finds, function (f) { return f.save; })) + ' a period</span></div></div>' : '<p class="soon" style="margin:6px 0 0">Nothing above market price right now.</p>';
  // what you put aside
  var aside = ['Retirement 3a', 'Financial Investing', 'Collectibles'].map(function (c) { var x = rows.filter(function (y) { return y.cat === c; })[0]; return [c, x ? x.avg : 0]; });
  var spentLife = sumBy(rows.filter(function (x) { return !/Retirement 3a|Financial Investing|Collectibles/.test(x.cat); }), function (x) { return x.avg; });
  var asidePct = inc ? sumBy(aside, function (a) { return a[1]; }) / inc * 100 : 0, cashLeft = inc - totA;
  h += '<div class="subhead" style="margin-top:22px"><b>Put aside</b><span>money that stays yours</span></div>' +
    '<p class="soon" style="margin:6px 0 0;max-width:62rem;font-size:13px">' +
    aside.filter(function (a) { return a[1] > 1; }).map(function (a) { return esc(a[0]) + ' ' + sw0(a[1]); }).join(' · ') + (aside.some(function (a) { return a[1] > 1; }) ? ' a period' : 'Nothing moved into 3a, investing or collectibles') +
    ', plus ' + (cashLeft >= 0 ? sw0(cashLeft) + ' cash left over' : sw0(-cashLeft) + ' taken from savings') + '. That is ' + asidePct.toFixed(0) + '% of your salary in assets' +
    ' (the average Swiss household saves ' + BFS_SAVE_PCT + '% of gross income, BFS 2022). ' +
    (vacAvg > 20 ? 'Holidays averaged ' + sw0(vacAvg) + ' a period but came in lumps' + (vac.some(function (v) { return v > vacAvg * 2; }) ? ' (up to ' + sw0(Math.max.apply(null, vac)) + ')' : '') + ': budgeting a fixed amount each period smooths that out.' : '') + '</p>';
  return fold('check', 'Budget check', gapNext !== null ? (gapNext < -1 ? sw0(-gapNext) + ' over salary from ' + periodDay(pd(nextDate)) : 'balanced from ' + periodDay(pd(nextDate))) : (gapNow < 0 ? sw0(-gapNow) + ' over salary' : sw0(gapNow) + ' not budgeted'), h, true);
}
// ─── Plan your allowance ──────────────────────────────────────────────────
// Budgets add up to what's left of the salary after Family Infrastructure (the joint-account transfer).
// Changing one budget moves the other unlocked ones, in proportion to their size, so the total keeps fitting.
var PLAN_CATS = ['Retirement 3a', 'Personal Cash', 'Collectibles', 'Financial Investing', 'Holidays'];
var LOCK_KEY = 'ff_lock_v1';
function planLocks() { try { return JSON.parse(lsGet(LOCK_KEY) || '') || { 'Retirement 3a':true }; } catch (e) { return { 'Retirement 3a':true }; } }
function lastSalary() {
  var r = roles(), t = today(), best = null;
  txs().forEach(function (tx) { if (isSalary(tx, r) && tx.anomaly_status !== 'excluded' && tx.date && pd(tx.date) <= t && (+tx.amount || 0) > 1000 && (!best || tx.date > best.date)) best = tx; });
  return best ? { amount:+best.amount, date:best.date } : { amount:0, date:'' };
}
function planInit() {
  var p = periodAt(UI.periodOffset), start = ymd(p.start);
  if (UI.plan && UI.plan.start === start && UI.plan.dirty) return UI.plan;   // keep your unsaved changes; otherwise follow the saved budgets
  var map = budgetMapFor(p), vals = {};
  PLAN_CATS.forEach(function (c) { vals[c] = map[c] ? +map[c].monthly_limit || 0 : 0; });
  var fam = map['Family Infrastructure'] ? +map['Family Infrastructure'].monthly_limit || 0 : EXPECTED_HOUSEHOLD_EXPENSE;
  UI.plan = { start:start, fam:fam, vals:vals, locks:UI.plan ? UI.plan.locks : planLocks(), dirty:false };
  return UI.plan;
}
function planAllowance() { return Math.max(0, lastSalary().amount - UI.plan.fam); }
function planTotal() { var v = UI.plan.vals; return PLAN_CATS.reduce(function (a, c) { return a + (v[c] || 0); }, 0); }
function planSpread(diff, except) {
  var P = UI.plan, keys = PLAN_CATS.filter(function (c) { return c !== except && !P.locks[c]; });
  if (!keys.length) return;
  var base = keys.reduce(function (a, c) { return a + P.vals[c]; }, 0);
  keys.forEach(function (c) { P.vals[c] = Math.max(0, P.vals[c] + diff * (base > 0 ? P.vals[c] / base : 1 / keys.length)); });
}
function planRound() {
  var P = UI.plan; PLAN_CATS.forEach(function (c) { P.vals[c] = Math.round(P.vals[c] * 20) / 20; });
  var d = Math.round((planAllowance() - planTotal()) * 100) / 100;
  var k = PLAN_CATS.filter(function (c) { return !P.locks[c] && P.vals[c] + d >= 0 && P.vals[c] > 0; })[0];
  if (k && Math.abs(d) < 1) P.vals[k] = Math.round((P.vals[k] + d) * 100) / 100;
}
function planFit() { for (var i = 0; i < 3; i++) { var left = planAllowance() - planTotal(); if (Math.abs(left) < 0.005) break; planSpread(left, null); } planRound(); UI.plan.dirty = true; }
function planChange(c, v) {
  var P = UI.plan; v = Math.max(0, Math.min(planAllowance(), isNaN(v) ? 0 : v));
  var diff = P.vals[c] - v; P.vals[c] = v; planSpread(diff, c); planRound(); P.dirty = true;
}
function planHTML() {
  var P = planInit(), sal = lastSalary(), A = planAllowance(), p = periodAt(UI.periodOffset);
  if (!sal.amount) return '';
  var usual = {}; finishedPeriods(6).forEach(function (q, i, all) { PLAN_CATS.forEach(function (c) { usual[c] = (usual[c] || 0) + Math.max(0, catSpend(c, q, true).spent) / all.length; }); });
  var h = '<div class="plsum">' +
    '<div><label>Salary</label><b class="num">' + sw(sal.amount) + '</b><small>last paid ' + periodDay(pd(sal.date)) + '</small></div>' +
    '<div><label for="pl_fam">Family Infrastructure</label><input id="pl_fam" class="num" type="number" inputmode="decimal" step="50" min="0" value="' + P.fam + '"><small>joint account</small></div>' +
    '<div><label>Allowance</label><b class="num" id="pl_allow">' + sw(A) + '</b><small>split between the budgets below</small></div></div>' +
    '<div class="plbar" id="pl_bar">' + PLAN_CATS.map(function () { return '<i></i>'; }).join('') + '</div><div class="plrows">' +
    PLAN_CATS.map(function (c, i) {
      var lk = !!P.locks[c];
      return '<div class="plrow' + (lk ? ' locked' : '') + '" data-k="' + esc(c) + '"><span class="nm"><b>' + catIco(c) + ' ' + esc(c) + '</b><small>usual spend ' + sw0(usual[c] || 0) + ' · <span id="pl_p' + i + '"></span>' +
        (c === 'Holidays' ? ' · Vacations spending counts here instead of Family Infrastructure' : '') + '</small></span>' +
        '<input id="pl_v' + i + '" class="num" type="number" inputmode="decimal" step="5" min="0" aria-label="' + esc(c) + ' budget"' + (lk ? ' disabled' : '') + '>' +
        '<button class="pllock' + (lk ? ' on' : '') + '" data-act="pllock" data-k="' + esc(c) + '" aria-pressed="' + lk + '" aria-label="' + (lk ? 'Unlock ' : 'Lock ') + esc(c) + '">' + ico(lk ? 'lock' : 'lock-open') + '</button>' +
        '<input id="pl_r' + i + '" type="range" min="0" step="5" aria-label="' + esc(c) + ' slider"' + (lk ? ' disabled' : '') + '></div>';
    }).join('') + '</div>' +
    '<div class="plfoot"><span id="pl_status"></span><span class="plbtns"><button class="btn" data-act="plreset">Reset</button> <button class="btn primary" data-act="plsave">Save budgets</button></span></div>' +
    '<p class="soon" style="margin:0;font-size:12px">Change one amount and the other unlocked budgets move so the total still fits. The lock keeps a budget where it is. Saving applies from this period (' + periodDay(p.start) + String(p.start.getFullYear()) + ') onwards' + (nextBudget('Personal Cash', p) || nextBudget('Family Infrastructure', p) ? '; budgets already planned for later periods stay as they are' : '') + '.</p>';
  var d = A - planTotal();
  return fold('plan', 'Plan your allowance', Math.abs(d) < 0.01 ? 'adds up' : d < 0 ? sw0(-d) + ' over the allowance' : sw0(d) + ' not budgeted', h, true);
}
function planPaint() {
  if (!UI.plan || !$('pl_allow')) return;
  var P = UI.plan, A = planAllowance(), bar = $('pl_bar').children;
  $('pl_allow').textContent = sw(A);
  PLAN_CATS.forEach(function (c, i) {
    var n = $('pl_v' + i), r = $('pl_r' + i), v = P.vals[c];
    if (document.activeElement !== n) n.value = v.toFixed(2);
    r.max = Math.ceil(A); if (document.activeElement !== r) r.value = v;
    $('pl_p' + i).textContent = (A ? Math.round(v / A * 100) : 0) + '% of allowance';
    bar[i].style.width = (A ? Math.min(100, v / A * 100) : 0) + '%';
  });
  var d = Math.round((A - planTotal()) * 100) / 100;
  $('pl_status').innerHTML = Math.abs(d) < 0.01 ? '<span class="pos">Budgets add up to the allowance: ' + sw(planTotal()) + '</span>'
    : (d < 0 ? '<span class="neg">' + sw(-d) + ' more than the allowance</span>' : '<span>' + sw(d) + ' not budgeted</span>') + ' <button class="btn" data-act="plfit">' + (d < 0 ? 'Fit to allowance' : 'Spread it') + '</button>';
}
function planSave() {
  var P = UI.plan, p = periodAt(UI.periodOffset), start = ymd(p.start), map = budgetMapFor(p), jobs = [];
  var want = [['Family Infrastructure', P.fam]].concat(PLAN_CATS.map(function (c) { return [c, P.vals[c]]; }));
  want.forEach(function (w) {
    var c = w[0], v = Math.round(w[1] * 100) / 100, eff = map[c];
    if (eff && String(eff.period || '').slice(0, 10) === start) { if (+eff.monthly_limit !== v) jobs.push(Object.assign({}, eff, { monthly_limit:v })); }
    else if ((eff ? +eff.monthly_limit || 0 : 0) !== v) jobs.push({ category:c, monthly_limit:v, period:start, is_default:false, rollover_enabled:eff ? truthy(eff.rollover_enabled) : false });
  });
  if (!jobs.length) { toast('Nothing changed'); return; }
  seq(jobs, function (row) { return saveRow('Budget', row); }).then(function () { UI.plan = null; toast('Budgets saved from ' + periodDay(p.start)); draw(); })
    .catch(function () {});
}
function budgetsHTML() {
  var rows = budgetRows(UI.periodOffset), isCur = UI.periodOffset === 0;
  var withLimit = rows.filter(function (r) { return r.limit > 0; });
  var totLimit = sumBy(withLimit, function (r) { return r.limit; }), totSpent = sumBy(withLimit, function (r) { return r.spent; });
  var totCarry = sumBy(rows, function (r) { return r.carry; });
  var over = withLimit.filter(function (r) { return r.pct > 1.0001; }).length;
  var h = topbar('Budgets', true);
  h += '<section class="kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">' +
    kpi('Budgeted', sw(totLimit), totCarry ? 'incl. ' + sw(totCarry) + ' rolled over' : '') +
    kpi('Spent', sw(totSpent), '') +
    kpi(isCur ? 'Left' : 'Result', '<span class="' + (totLimit - totSpent < 0 ? 'neg' : '') + '">' + sw(totLimit - totSpent) + '</span>', '') +
    kpi('Over budget', '<span class="' + (over ? 'neg' : '') + '">' + over + ' of ' + withLimit.length + '</span>', 'categories') +
    '</section>';
  h += '<p class="soon" style="margin:-16px 0 0;font-size:13px">Spending counts expenses and investments minus refunds in the same category, scheduled entries included. ' +
    'With rollover on, last period’s unspent amount is added to this period’s limit; overspending never carries forward.</p>';
  h += planHTML();
  h += budgetCheckHTML();

  rows.forEach(function (r, i) {
    var status = !r.limit ? 'No limit set' : r.pct > 1.0001 ? sw(-r.left) + ' over' : r.pct >= 0.8 ? 'Near the limit · ' + sw(r.left) + ' left' : sw(r.left) + ' left';
    h += '<section class="card bcard">' +
      '<div class="bhead"><h3 style="margin:0">' + catIco(r.cat) + ' ' + esc(r.cat) + '</h3><span class="num ' + (r.pct > 1.0001 ? 'neg' : '') + '" style="font-size:22px">' + sw(r.spent) +
      (r.limit ? ' <span class="soon">/ ' + sw0(r.limit) + '</span>' : '') + '</span></div>';
    if (r.limit) {
      h += '<div class="bar bbar"><i class="' + (r.pct > 1.0001 ? 'over' : '') + '" style="width:' + Math.min(100, Math.max(0, r.pct * 100)) + '%"></i>' +
        (r.carry ? '<em style="left:' + (r.base / r.limit * 100) + '%" title="Base limit"></em>' : '') + '</div>';
    }
    h += '<div class="bmeta"><span class="' + (r.pct > 1.0001 ? 'neg' : '') + '">' + status + '</span>' +
      (r.sched ? '<span>incl. ' + sw(r.sched) + ' scheduled</span>' : '') +
      (r.carry ? '<span>' + sw0(r.base) + ' base + ' + sw(r.carry) + ' rolled over</span>' : '') +
      (function () { var nb = nextBudget(r.cat, periodAt(UI.periodOffset)); return nb && +nb.monthly_limit !== r.base ? '<span>→ ' + sw0(+nb.monthly_limit || 0) + ' from ' + periodDay(pd(String(nb.period).slice(0, 10))) + String(nb.period).slice(0, 4) + '</span>' : ''; })() + '</div>';
    h += '<div class="bedit">' +

      '<label class="switch"><input type="checkbox" data-act="broll" data-cat="' + esc(r.cat) + '"' + (r.roll ? ' checked' : '') + (r.b && r.base > 0 ? '' : ' disabled') + '><span>Roll over unspent budget</span></label>' +
      '</div>';
    if (r.roll && r.base > 0) {
      var L = ledger(r, UI.periodOffset);
      h += '<details class="ledger"><summary>Rollover history · ' + sw(L[L.length - 1].run) + ' unspent over 7 periods</summary><div class="ltable">' +
        '<div class="lh"><span>Period</span><span>Spent</span><span>Unspent</span><span>Running</span></div>' +
        L.map(function (e) {
          return '<div class="' + (e.current ? 'cur' : '') + '"><span>' + e.label + (e.current ? ' · so far' : '') + '</span><span class="num">' + sw(e.spent) +
            '</span><span class="num">' + sw(e.surplus) + '</span><span class="num">' + sw(e.run) + '</span></div>';
        }).join('') + '</div></details>';
    }
    h += '</section>';
  });
  return h + recurringBody();
}

function saveBudget(cat, patch) {
  var b = budgetMapFor(periodAt(UI.periodOffset))[cat];
  var row = b ? Object.assign({}, b, patch) : Object.assign({ category:cat, monthly_limit:0, period:'', is_default:true, rollover_enabled:false }, patch);
  return saveRow('Budget', row);
}

export { holidaysBudgeted, catSpend, budgetMapFor, nextBudget, budgetRows, truthy, ledger, MARKET, BFS_SAVE_PCT, finishedPeriods, median, budgetCheckHTML, PLAN_CATS, LOCK_KEY, planLocks, lastSalary, planInit, planAllowance, planTotal, planSpread, planRound, planFit, planChange, planHTML, planPaint, planSave, budgetsHTML, saveBudget };
