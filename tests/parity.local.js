// Compares FlowFin with the six periods exported from Base44, using the REAL data.
// Runs only when FLOWFIN_DATA points to a folder with the CSV exports and expected.json;
// that folder is never committed (the repository is public).
'use strict';
var fs = require('fs'), path = require('path'), h = require('./harness');
var NUM = ['amount', 'monthly_limit', 'pct', 'target_amount', 'current_amount', 'saving_pct', 'net', 'current_value', 'total_invested', 'exchange_rate', 'value'];
var BOOL = ['is_default', 'rollover_enabled', 'is_liability', 'auto_detected'];
function csv(f) {
  var L = fs.readFileSync(f, 'utf8').replace(/\r/g, '').trim().split('\n'), H = L[0].split(',');
  return L.slice(1).map(function (l) {
    var c = [], cur = '', q = false;
    for (var ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { c.push(cur); cur = ''; } else cur += ch; }
    c.push(cur); var o = {};
    H.forEach(function (k, i) { var v = c[i]; if (NUM.indexOf(k) > -1 && v !== '' && v != null) v = +v; if (BOOL.indexOf(k) > -1) v = String(v).toLowerCase() === 'true'; o[k] = v; });
    return o;
  });
}
module.exports = async function () {
  var D = process.env.FLOWFIN_DATA;
  if (!D || !fs.existsSync(path.join(D, 'expected.json'))) { console.log('\nReal-data check skipped (FLOWFIN_DATA not set)'); return; }
  console.log('\nReal data (local only)');
  var expected = JSON.parse(fs.readFileSync(path.join(D, 'expected.json'), 'utf8'));
  var data = {};
  ['Transaction', 'Budget', 'CategorySettings', 'FundAllocation', 'FinancialGoal', 'GoalContribution', 'NetWorthEntry', 'AssetSnapshot'].forEach(function (t) { data[t] = csv(path.join(D, t + '.csv')); });
  data.Settings = [{ id: 's1', key: 'job_restore_porsche', value: '1' }, { id: 's2', key: 'job_goal_3a_2027', value: '1' }, { id: 's3', key: 'job_budgets_2027', value: '1' }, { id: 's4', key: 'job_family_6700_2027', value: '1' }];
  await h.test('six past periods match Base44 to the cent (' + Object.keys(expected.periods).length + ' periods)', async function () {
    var app = await h.openApp({ data: data });
    var got = await app.page.evaluate(function (starts) {
      var o = {}; for (var i = -12; i <= -1; i++) { var m = FF.periodModel(i), k = m.p.start.getFullYear() + '-' + String(m.p.start.getMonth() + 1).padStart(2, '0') + '-10';
        if (starts.indexOf(k) > -1) { var T = m.totals; o[k] = Math.round((T.netCashFlow - T.collectibles - T.financialInvesting - T.threeA) * 100) / 100; } } return o;
    }, Object.keys(expected.periods));
    Object.keys(expected.periods).forEach(function (k) { h.near(got[k], expected.periods[k], 'period from ' + k); });
    h.noErrors(app); await app.ctx.close();
  });
};
