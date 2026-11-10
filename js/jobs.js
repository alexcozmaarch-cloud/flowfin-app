// FlowFin · One-time data jobs (run once per Sheet, flag set only after every save worked).
// Shared settings and state (DATA, UI, _cache, CATEGORIES …) are globals from js/config.js.
import { applyCategories, persistCache, post, saveRow } from './api.js';
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
  [jobRestorePorsche, jobGoal3a2027, jobBudgets2027, jobFamily2027, jobCategories].forEach(function (job) {
    chain = chain.then(function () { return job(); }).catch(function (e) { toast('Setup step not saved yet (' + e.message + '); it will try again next time.'); });
  });
  return chain;
}
// Once the Sheet has a Category tab: fill it with the built-in list plus the subcategories you added (custom_subs)
function jobCategories() {
  var key = 'job_categories_sheet';
  if (!UI.catTable || done(key)) return;
  if ((DATA.Category || []).length) return saveSetting(key, '1');
  var custom = customSubs(), rows = [], n = 0;
  Object.keys(BUILTIN_CATEGORIES).forEach(function (c) {
    rows.push({ category:c, subcategory:'', sort:++n });
    var subs = BUILTIN_CATEGORIES[c].slice(); (custom[c] || []).forEach(function (x) { if (subs.indexOf(x) < 0) subs.push(x); });
    subs.forEach(function (x) { rows.push({ category:c, subcategory:x, sort:++n }); });
  });
  return post({ action:'upsertMany', table:'Category', rows:rows }).then(function (j) {
    DATA.Category = j.rows || rows; applyCategories(); persistCache();
    return saveSetting(key, '1');
  }).then(function () { toast('Categories moved to the Sheet (Category tab)'); draw(); });
}
function seq(items, fn) { var c = Promise.resolve(); items.forEach(function (x) { c = c.then(function () { return fn(x); }); }); return c; }
function done(key) { return setting(key, '') === '1'; }
// Black Porsche and its 4 contributions disappeared on 06.11.2026; put them back exactly as imported from Base44
function jobRestorePorsche() {
  var key = 'job_restore_porsche';
  if (done(key)) return;
  var gid = '6abcdd8dc07aa2a0e69e164a', goals = DATA.FinancialGoal || [];
  var have = goals.some(function (g) { return g.id === gid || /porsche|porche/i.test(g.name || ''); });
  var contribs = [['6ae46bc6057ff301d4e8247b','2026-04-10',48.67,486.73], ['6ae46bc6057ff301d4e8247c','2026-05-10',86.18,861.78],
    ['6ae46bc6057ff301d4e8247d','2026-07-10',81.32,813.19], ['6ae46bc6057ff301d4e8247e','2026-09-10',50.79,507.9]];
  if (have) return saveSetting(key, '1');
  return saveSetting(key, '1').then(function () { return saveRow('FinancialGoal', { id:gid, name:'Black Porche', target_amount:80000, current_amount:5335.25, saving_pct:10, deadline:'2036-08-28', icon:'🚗', color:'amber', fund_bucket:'savings',
      notes:'1980 911 SC 3.0 Weissach €74,900 106,700 km 1 of 400 Black Metallic Matching numbers Munich, Germany', created_date:'2026-09-30 09:59:41' }); })
    .then(function () {
      return seq(contribs.filter(function (c) { return !(DATA.GoalContribution || []).some(function (x) { return x.goal_id === gid && String(x.period).slice(0, 10) === c[1]; }); }),
        function (c) { return saveRow('GoalContribution', { id:c[0], goal_id:gid, period:c[1], amount:c[2], pct:10, net:c[3], created_date:'2026-10-30 10:04:54' }); });
    })
    .then(function () { toast('Black Porche goal restored'); });
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

export { JOBS_RAN, runJobs, jobCategories, seq, done, jobRestorePorsche, jobFamily2027, jobGoal3a2027, jobBudgets2027 };
