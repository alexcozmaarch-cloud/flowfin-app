// FlowFin · Navigation and the single draw() dispatcher (pages never call each other).
// Shared settings and state (DATA, UI, _cache, CATEGORIES …) are globals from js/config.js.
import { priceAlerts } from './recurring.js';
import { anomalyList } from './anomalies.js';
import { syncHTML } from './api.js';
import { budgetsHTML, planPaint } from './budgets.js';
import { netSavingsChart } from './charts.js';
import { $, periodAt, periodLabel, txs } from './core.js';
import { dashboardCharts, dashboardHTML, savingsChart } from './dashboard.js';
import { calendarHTML } from './calendar.js';
import { goalsHTML } from './goals.js';
import { monthlyChart, monthlyHTML } from './monthly.js';
import { settingsHTML, soonHTML } from './settings.js';
import { transactionsHTML } from './transactions.js';
import { wealthChart, wealthHTML } from './wealth.js';

// ─── navigation ───────────────────────────────────────────────────────────
function drawNav() {
  var links = '';
  NAV.forEach(function (g) { g.items.forEach(function (it) {
    if (it[0] === 'settings') return;
    links += '<button class="navlink' + (UI.page === it[0] ? ' on' : '') + '" data-nav="' + it[0] + '">' + it[1] + navBadge(it[0]) + (BUILT[it[0]] ? '' : '<small>soon</small>') + '</button>';
  }); });
  $('side').innerHTML = '<div class="brand">FlowFin<b>.</b></div><nav class="navlinks" aria-label="Pages">' + links + '</nav>' +
    '<button class="navlink' + (UI.page === 'settings' ? ' on' : '') + '" data-nav="settings">Settings</button>';
  $('bottomnav').innerHTML = MOBILE_NAV.map(function (it) {
    if (it[0] === 'add') return '<button class="plus" data-act="addtx" aria-label="Add transaction">+</button>';
    return '<button class="' + (UI.page === it[0] ? 'on' : '') + '" data-nav="' + it[0] + '">' + it[1] + navBadge(it[0]) + '</button>';
  }).join('');
}
// Transactions carries the count of transactions waiting for review
function navBadge(page) {
  if (page !== 'transactions' || !txs().length) return '';
  var n = reviewCount(); return n ? ' <span class="nbadge" aria-label="' + n + ' to review">' + n + '</span>' : '';
}
function reviewCount() { return anomalyList().filter(function (x) { return !x.tx.anomaly_status; }).length + priceAlerts().length; }
function go(page) { if (page === 'transactions') UI.txTab = 'all'; UI.page = page; location.hash = page; window.scrollTo(0, 0); draw(); }

// ─── draw dispatcher (pages never call each other) ────────────────────────
function draw() {
  if (UI.page === 'anomalies') { UI.page = 'transactions'; UI.txTab = 'review'; try { history.replaceState(null, '', '#transactions'); } catch (e) {} }
  if (UI.page === 'subscriptions') { UI.page = 'budgets'; UI.jump = 'recurring'; try { history.replaceState(null, '', '#budgets'); } catch (e) {} }
  drawNav();
  Object.keys(CHARTS).forEach(function (k) { CHARTS[k].destroy(); delete CHARTS[k]; });
  var v = $('view');
  if (UI.page === 'dashboard') v.innerHTML = dashboardHTML();
  else if (UI.page === 'transactions') v.innerHTML = transactionsHTML();
  else if (UI.page === 'settings') v.innerHTML = settingsHTML();
  else if (UI.page === 'budgets') v.innerHTML = budgetsHTML();
  else if (UI.page === 'wealth') v.innerHTML = wealthHTML();
  else if (UI.page === 'goals') v.innerHTML = goalsHTML();
  else if (UI.page === 'monthly') v.innerHTML = monthlyHTML();
  else if (UI.page === 'calendar') v.innerHTML = calendarHTML();
  else v.innerHTML = soonHTML();
  if (UI.page === 'monthly') {
    var mc = function () { if (UI.page === 'monthly') monthlyChart(); };
    if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(mc); else mc();
  }
  if (UI.page === 'wealth') {
    var wc = function () { if (UI.page === 'wealth') wealthChart(); };
    if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(wc); else wc();
  }
  if (UI.page === 'budgets') planPaint();
  if (UI.jump) { var jt = $(UI.jump); UI.jump = ''; if (jt) setTimeout(function () { jt.scrollIntoView({ block:'start' }); }, 0); }
  if (UI.page === 'goals') {
    var gc = function () { if (UI.page === 'goals') savingsChart(); };
    if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(gc); else gc();
  }
  if (UI.page === 'dashboard') {
    var charts = function () { if (UI.page === 'dashboard') { dashboardCharts(); netSavingsChart(); } };
    if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(charts); else charts();
  }
}

function topbar(title, withPeriod, extra) {
  var p = periodAt(UI.periodOffset);
  return '<div class="topbar"><h1>' + title + '</h1>' + syncHTML() +
    (withPeriod ? '<div class="period"><button class="iconbtn" data-act="prev" aria-label="Previous period">‹</button><span>' +
      periodLabel(p) + '</span><button class="iconbtn" data-act="next" aria-label="Next period">›</button></div>' : '') + (extra || '') + '</div>';
}

export { drawNav, navBadge, reviewCount, go, draw, topbar };
