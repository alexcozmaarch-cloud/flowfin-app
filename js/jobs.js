// FlowFin · One-time data jobs (run once per Sheet, flag set only after every save worked).
// Shared settings and state (DATA, UI, _cache, CATEGORIES …) are globals from js/config.js.
import { purgeBin } from './bin.js';
import { applyCategories, deleteRow, persistCache, post, saveRow } from './api.js';
import { budgetMapFor, truthy } from './budgets.js';
import { periodAt, toast, txs } from './core.js';
import { goalFund } from './goals.js';
import { saveSetting } from './settings.js';
import { customSubs, setting } from './transactions.js';
import { draw } from './nav.js';

// How a goal is funded: pct = share of each period's net saved (Base44 rule), fixed = an amount you put in each month,
// account = the goal follows the balance of an account on Wealth.
// One-time goals Alex asked for. Each runs once (a Settings flag), and never if a goal with that name exists.
// ─── One-time data jobs ──────────────────────────────────────────────────
// Each job checks what already exists, saves one row at a time, and only marks itself done once every save worked,
// so a dropped connection just means it tries again on the next open. Jobs run one after another, once per visit.
var JOBS_RAN = false;
function runJobs() {
  if (JOBS_RAN || !txs().length) return;
  JOBS_RAN = true;
  var chain = Promise.resolve();
  purgeBin();
  [jobGoal3a2027, jobBudgets2027, jobFamily2027, jobCategories, jobDeletePorsche, jobSubNotes].forEach(function (job) {
    chain = chain.then(function () { return job(); }).catch(function (e) { toast('Setup step not saved yet (' + e.message + '); it will try again next time.'); });
  });
  return chain;
}
// Once the Sheet has a Category tab: fill it with the built-in list plus the subcategories you added (custom_subs)
function jobCategories() {
  var key = 'job_categories_sheet';
  // needs the Apps Script from 10.11.2026 (api 2), which writes many rows in one go;
  // the first version wrote them one by one and could run into Google's 6-minute limit
  if (!UI.catTable || (UI.api || 1) < 2 || done(key)) return;
  var custom = customSubs(), rows = [], n = 0, have = {};
  (DATA.Category || []).forEach(function (r) { have[r.category + '|' + (r.subcategory || '')] = 1; n = Math.max(n, +r.sort || 0); });
  Object.keys(BUILTIN_CATEGORIES).forEach(function (c) {   // only what's missing, so a half-finished earlier attempt is completed
    var want = [''].concat(BUILTIN_CATEGORIES[c]); (custom[c] || []).forEach(function (x) { if (want.indexOf(x) < 0) want.push(x); });
    want.forEach(function (x) { if (!have[c + '|' + x]) rows.push({ category:c, subcategory:x, sort:++n }); });
  });
  if (!rows.length) return saveSetting(key, '1');
  return post({ action:'upsertMany', table:'Category', rows:rows }).then(function (j) {
    DATA.Category = (DATA.Category || []).concat(j.rows || rows); applyCategories(); persistCache();
    return saveSetting(key, '1');
  }).then(function () { toast('Categories moved to the Sheet (Category tab)'); draw(); });
}
// Your 19.11.2026 reminders, shown next to those subscriptions (only where the note is empty)
function jobSubNotes() {
  var key = 'job_sub_notes_1911';
  if (done(key)) return;
  var want = [[/swisscom/i, 'check 19.11.'], [/base44/i, 'cancel 19.11.']];
  var rows = (DATA.Subscription || []).filter(function (s) { return !s.notes && want.some(function (w) { return w[0].test(s.name || ''); }); });
  return seq(rows, function (s) { var n = want.filter(function (w) { return w[0].test(s.name); })[0][1]; return saveRow('Subscription', Object.assign({}, s, { notes:n })); })
    .then(function () { return saveSetting(key, '1'); });
}
function seq(items, fn) { var c = Promise.resolve(); items.forEach(function (x) { c = c.then(function () { return fn(x); }); }); return c; }
// The Sheet turns a saved "1" into the number 1, so compare as text (before 11.11.2026 this missed every flag,
// and the one-time jobs ran again on every load, which is what kept bringing Black Porche back)
function done(key) { return String(setting(key, '')) === '1'; }
// You deleted Black Porche; the old restore job kept putting it back (see done() above). The restore job is gone
// for good; this removes the goal and its 4 contributions once, and never touches goals again.
function jobDeletePorsche() {
  var key = 'job_porsche_deleted';
  if (done(key)) return;
  var gid = '6abcdd8dc07aa2a0e69e164a';
  var goals = (DATA.FinancialGoal || []).filter(function (g) { return g.id === gid; });
  var cs = (DATA.GoalContribution || []).filter(function (c) { return c.goal_id === gid; });
  return seq(cs.map(function (c) { return ['GoalContribution', c.id]; }).concat(goals.map(function (g) { return ['FinancialGoal', g.id]; })),
    function (x) { return deleteRow(x[0], x[1], true); })
    .then(function () { return saveSetting(key, '1'); })
    .then(function () { if (goals.length) toast('Black Porche goal deleted'); });
}
// Family Infrastructure stays 6'700 in 2027 (holidays get their own budget if needed)
function jobFamily2027() {
  var key = 'job_family_6700_2027';
  if (done(key)) return;
  var b = (DATA.Budget || []).filter(function (x) { return x.category === 'Family Infrastructure' && String(x.period || '').slice(0, 10) === '2027-01-10'; })[0];
  return (b && +b.monthly_limit !== 6700 ? saveRow('Budget', Object.assign({}, b, { monthly_limit:6700 })) : Promise.resolve()).then(function () { return saveSetting(key, '1'); });
}
function jobGoal3a2027() {
  var key = 'job_goal_3a_2027', name = 'Pillar 3a 2027';
  if (done(key)) return;
  var g = (DATA.FinancialGoal || []).filter(function (x) { return x.name === name; })[0];
  var made = !g;
  return (g ? Promise.resolve(g) : saveRow('FinancialGoal', { name:name, target_amount:7373, current_amount:0, saving_pct:0, deadline:'2027-12-31', icon:'', color:'', fund_bucket:'',
      notes:'Maximum 3a contribution for 2027 with a pension fund (CHF 7’373). Pay in by mid-December; the money must reach finpension within the calendar year.' }))
    .then(function (row) { return goalFund(row).mode === 'category' ? null : saveSetting('goal_fund_' + row.id, JSON.stringify({ mode:'category', category:'Retirement 3a', from:'2027-01-01' })); })
    .then(function () { return saveSetting(key, '1'); })
    .then(function () { if (made) toast('Goal added: Pillar 3a 2027'); });
}
// Budgets agreed on 06.11.2026 for 2027 (after the 3a), from the period starting 10.01.2027
function jobBudgets2027() {
  var key = 'job_budgets_2027';
  if (done(key)) return;
  var from = '2027-01-10', plan = [['Family Infrastructure', 6700], ['Retirement 3a', 615], ['Personal Cash', 480], ['Collectibles', 550]];
  var todo = plan.filter(function (x) { return !(DATA.Budget || []).some(function (b) { return b.category === x[0] && String(b.period || '').slice(0, 10) === from; }); });
  return seq(todo, function (x) {
    var cur = budgetMapFor(periodAt(0))[x[0]];
    return saveRow('Budget', { category:x[0], monthly_limit:x[1], period:from, is_default:false, rollover_enabled:cur ? truthy(cur.rollover_enabled) : false });
  }).then(function () { return saveSetting(key, '1'); })
    .then(function () { if (todo.length) toast('2027 budgets set, from 10.01.2027'); });
}

export { JOBS_RAN, runJobs, jobCategories, seq, done, jobDeletePorsche, jobFamily2027, jobGoal3a2027, jobBudgets2027 };
