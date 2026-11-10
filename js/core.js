// FlowFin · Helpers, periods (10th → 9th) and THE totals function. No page code here: safe to test on its own.
// Shared settings and state (DATA, UI, _cache, CATEGORIES …) are globals from js/config.js.


// ─── helpers ──────────────────────────────────────────────────────────────
var fmtCHF = new Intl.NumberFormat('de-CH', { minimumFractionDigits:2, maximumFractionDigits:2 });
var fmt0 = new Intl.NumberFormat('de-CH', { maximumFractionDigits:0 });
function chf(n) { return 'CHF ' + fmtCHF.format(n || 0); }
function chf0(n) { return fmt0.format(Math.round(n || 0)); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function $(id) { return document.getElementById(id); }
function pd(s) { var p = String(s).slice(0,10).split('-'); return new Date(+p[0], +p[1]-1, +p[2]); }
function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function today() { var t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function daysBetween(a, b) { return Math.round((b - a) / 86400000); }
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function apiUrl() { return lsGet(URL_KEY) || API_DEFAULT; }
function apiKey() { return lsGet(KEY_KEY) || ''; }
function txs() { return DATA.Transaction || []; }
function toast(msg) {
  var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600);
}

// ─── periods (10th → 9th) ─────────────────────────────────────────────────
function periodFor(date) {
  var y = date.getFullYear(), m = date.getMonth();
  if (date.getDate() < START_DAY) m -= 1;
  return { start:new Date(y, m, START_DAY), end:new Date(y, m + 1, START_DAY - 1) };
}
function periodAt(offset) {
  var p = periodFor(today());
  return periodFor(new Date(p.start.getFullYear(), p.start.getMonth() + offset, START_DAY));
}
function periodLabel(p) {
  function dm(d) { return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.'; }
  return dm(p.start) + ' – ' + dm(p.end) + p.end.getFullYear();
}
function inPeriod(tx, p) { if (!tx.date) return false; var d = pd(tx.date); return d >= p.start && d <= p.end; }

// ─── category roles (CategorySettings) ────────────────────────────────────
function roles() {
  var cs = DATA.CategorySettings || [];
  return {
    salary: cs.filter(function (s) { return s.role === 'salary'; }).map(function (s) { return s.category; }),
    infra:  cs.filter(function (s) { return s.role === 'infrastructure'; }).map(function (s) { return s.category; })
  };
}
function isSalary(tx, r) { if (tx.type !== 'income') return false; return r.salary.length ? r.salary.indexOf(tx.category) > -1 : true; }
function isInfra(tx, r)  { if (tx.type !== 'expense') return false; return r.infra.length ? r.infra.indexOf(tx.category) > -1 : tx.category === 'Family Infrastructure'; }
function isEntertainment(tx) { return tx.type === 'expense' && (tx.subcategory === 'Entertainment' || tx.category === 'Entertainment'); }

// ─── THE totals function (mirrors Base44 calculations.js) ─────────────────
// Future-dated transactions are "scheduled", never "spent".
function calcTotals(list, cutoff, expectedIncome, expectedExpense) {
  var income = 0, raw = 0, fin = 0, coll = 0, threeA = 0, refunds = 0, scheduled = 0;
  list.forEach(function (tx) {
    var a = +tx.amount || 0;
    if (tx.date && pd(tx.date) > cutoff) {
      if (WEALTH_CATS[tx.category] || isEntertainment(tx)) scheduled += a;
      return;
    }
    if (tx.type === 'income') income += a;
    else if (tx.type === 'refund') refunds += a;
    else if (tx.category === 'Collectibles') coll += a;
    else if (tx.category === 'Financial Investing') fin += a;
    else if (tx.category === 'Retirement 3a') threeA += a;
    else if (tx.type === 'expense') raw += a;
  });
  var actualIncome = income;
  income += expectedIncome > 0 ? expectedIncome : 0;
  var expenses = Math.max(0, raw - refunds) + (expectedExpense > 0 ? expectedExpense : 0);
  var netCashFlow = income - expenses, netSaved = netCashFlow - coll;
  return { income:income, actualIncome:actualIncome, expectedIncome:expectedIncome || 0, expectedExpense:expectedExpense || 0,
    expenses:expenses, refunds:refunds, financialInvesting:fin, collectibles:coll, threeA:threeA, scheduled:scheduled,
    netCashFlow:netCashFlow, netSaved:netSaved, savingsRate: income > 0 ? netSaved / income : 0 };
}

// Average salary and household over the last 6 periods that had income
function monthlyAverages() {
  var r = roles(), all = txs(), ti = 0, tf = 0, n = 0;
  for (var i = 1; i <= HIST_MONTHS; i++) {
    var p = periodAt(-i), pi = 0, pf = 0;
    all.forEach(function (tx) {
      if (!inPeriod(tx, p) || tx.anomaly_status === 'excluded') return;   // one-offs don't shape the allowance
      if (isSalary(tx, r)) pi += +tx.amount || 0;
      if (isInfra(tx, r))  pf += +tx.amount || 0;
    });
    if (pi > 0) { ti += pi; tf += pf; n++; }
  }
  var avgIncome = n ? ti / n : 0, avgInfra = n ? tf / n : 0;
  var free = Math.max(0, avgIncome - avgInfra);
  if (!free) free = Math.max(0, BENCHMARK_SALARY - BENCHMARK_INFRA);
  return { avgIncome:avgIncome, avgInfra:avgInfra, freeCash:free, periods:n };
}

// Everything the dashboard needs for one period
function periodModel(offset) {
  var p = periodAt(offset), t = today(), r = roles();
  var isCurrent = offset === 0;
  var cutoff = isCurrent ? t : p.end;
  var list = txs().filter(function (tx) { return inPeriod(tx, p); });
  var avg = monthlyAverages();
  var hasSalary = list.some(function (tx) { return isSalary(tx, r) && pd(tx.date) <= cutoff; });
  var hasInfra = list.some(function (tx) { return isInfra(tx, r) && pd(tx.date) <= cutoff; });
  var expInc = (isCurrent && !hasSalary) ? avg.avgIncome : 0;
  var expExp = (isCurrent && !hasInfra) ? EXPECTED_HOUSEHOLD_EXPENSE : 0;
  var totals = calcTotals(list, cutoff, expInc, expExp);

  var daysInPeriod = daysBetween(p.start, p.end) + 1;
  var daysElapsed = isCurrent ? Math.min(daysInPeriod, daysBetween(p.start, t) + 1) : daysInPeriod;
  var dailyBudget = avg.freeCash / daysInPeriod;

  // daily spend: non-infra expenses minus refunds (investment-type rows excluded)
  var dailyMap = {};
  list.forEach(function (tx) {
    if (tx.type === 'expense') { if (isInfra(tx, r)) return; dailyMap[tx.date] = (dailyMap[tx.date] || 0) + (+tx.amount || 0); }
    else if (tx.type === 'refund') { dailyMap[tx.date] = (dailyMap[tx.date] || 0) - (+tx.amount || 0); }
  });
  var spentToday = isCurrent ? (dailyMap[ymd(t)] || 0) : 0;

  // free cash: accrued − paid (Financial Investing + Collectibles + entertainment, up to today)
  var paid = 0, sched = 0;
  list.forEach(function (tx) {
    if (!(tx.category === 'Financial Investing' || tx.category === 'Collectibles' || isEntertainment(tx))) return;
    if (pd(tx.date) <= cutoff) paid += +tx.amount || 0; else sched += +tx.amount || 0;
  });
  var accrued = dailyBudget * daysElapsed;
  var availableNow = accrued - paid;

  return { p:p, list:list, totals:totals, avg:avg, isCurrent:isCurrent, cutoff:cutoff,
    daysInPeriod:daysInPeriod, daysElapsed:daysElapsed, dailyBudget:dailyBudget, dailyMap:dailyMap,
    spentToday:spentToday, safeToday:Math.max(0, dailyBudget - spentToday),
    accrued:accrued, paid:paid, scheduledFree:sched, availableNow:availableNow, afterScheduled:availableNow - sched };
}

export { fmtCHF, fmt0, chf, chf0, esc, $, pd, ymd, today, addDays, daysBetween, lsGet, lsSet, apiUrl, apiKey, txs, toast, periodFor, periodAt, periodLabel, inPeriod, roles, isSalary, isInfra, isEntertainment, calcTotals, monthlyAverages, periodModel };
