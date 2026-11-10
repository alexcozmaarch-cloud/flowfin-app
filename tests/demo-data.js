// Made-up data for the automated tests. Nothing here is real: the repository is public,
// so real transactions never go into it. Dates are built around "today" so the periods
// (10th → 9th) always line up with the day the tests run.
'use strict';

function rng(seed) {   // small seeded random generator: same data on every run
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function periodStart(today, offset) {
  var y = today.getFullYear(), m = today.getMonth();
  if (today.getDate() < 10) m -= 1;
  return new Date(y, m + offset, 10);
}
var r2 = function (n) { return Math.round(n * 100) / 100; };

var PERSONAL = [
  ['Parking', 'Transportation', 3, 3], ['Lunch Migros', 'Lunches', 11, 18], ['Coop Coffee', 'Coffees', 4.2, 5.8],
  ['Morning pastry', 'Snacks', 6.2, 6.2], ['Netflix', 'Subscriptions', 18.9, 18.9], ['Dinner Bierhalle', 'Dinners', 38, 72],
  ['Parking Zurich HB', 'Transportation', 6, 12], ['Kino Arena', 'Entertainment', 21, 24], ['Bookshop', 'Hobbies', 15, 45]
];
var INFRA = [['Mortgage UBS', 'Mortgage', 3200, 3200], ['EWZ', 'Utilities', 140, 190], ['Migros groceries', 'Groceries', 60, 210],
  ['Helsana', 'Insurance', 980, 980], ['Kita', 'Childcare', 1450, 1450]];

function makeDemo(today) {
  today = today || new Date();
  today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  var rand = rng(42), id = 0, tx = [], expected = {};
  function add(d, desc, cat, sub, amount, type) {
    tx.push({ id: 'demo' + (++id), date: ymd(d), description: desc, category: cat, subcategory: sub || '', amount: r2(amount),
      type: type || 'expense', account: rand() < 0.8 ? 'credit_card' : 'debit_card', anomaly_status: '' });
    return r2(amount);
  }
  function pick(range) { return range[2] === range[3] ? range[2] : range[2] + rand() * (range[3] - range[2]); }
  for (var off = -6; off <= 0; off++) {
    var s = periodStart(today, off), last = off === 0 ? today : new Date(s.getFullYear(), s.getMonth() + 1, 9);
    var days = Math.round((last - s) / 864e5) + 1, inc = 0, raw = 0, ref = 0, saved = 0;
    function day(n) { return new Date(s.getFullYear(), s.getMonth(), 10 + Math.min(n, days - 1)); }
    if (off < 0 || days > 15) inc += add(day(15), 'Salary', 'Salary', '', 8600 + 100 * (off + 6), 'income');
    INFRA.forEach(function (x, i) { if (off < 0 || i * 3 < days) raw += add(day(i * 3), x[0], 'Family Infrastructure', x[1], pick(x)); });
    for (var k = 0; k < 18; k++) { var x = PERSONAL[Math.floor(rand() * PERSONAL.length)]; raw += add(day(Math.floor(rand() * days)), x[0], 'Personal Cash', x[1], pick(x)); }
    saved += add(day(4), 'Cardmarket', 'Collectibles', 'TCG Investing', 120 + Math.round(rand() * 200));
    saved += add(day(16), 'IBKR ETF', 'Financial Investing', 'ETF Investing', 300);
    if (off < 0) saved += add(day(14), 'finpension 3a', 'Retirement 3a', '', 600);
    ref += add(day(7), 'Refund Digitec', 'Personal Cash', 'Extras', 25, 'refund');
    // the rule the app must follow (Base44's monthly net): income − (everyday expenses − refunds)
    // − money put into Collectibles, Financial Investing and Retirement 3a
    if (off < 0) expected[off] = r2(inc - Math.max(0, raw - ref) - saved);
  }
  // one scheduled payment in the future: must never count as spent
  add(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 3), 'Future concert', 'Personal Cash', 'Entertainment', 90);

  var data = {
    Transaction: tx,
    Rule: [{ id: 'rule1', match: 'netflix', category: 'Personal Cash', subcategory: 'Subscriptions', type: 'expense', account: 'credit_card', tags: '' }],
    Budget: [
      { id: 'b1', category: 'Personal Cash', monthly_limit: 480, period: '', is_default: true, rollover_enabled: false },
      { id: 'b2', category: 'Collectibles', monthly_limit: 400, period: '', is_default: true, rollover_enabled: false },
      { id: 'b3', category: 'Family Infrastructure', monthly_limit: 6700, period: '', is_default: true, rollover_enabled: false }
    ],
    CategorySettings: [{ id: 'cs1', category: 'Family Infrastructure', role: 'infrastructure' }, { id: 'cs2', category: 'Salary', role: 'salary' }],
    FundAllocation: [{ id: 'fa1', key: 'fun', pct: 5 }],
    FinancialGoal: [{ id: 'g1', name: 'Demo car', target_amount: 50000, current_amount: 1200, saving_pct: 10, deadline: '2032-06-30', icon: '', color: '', fund_bucket: 'savings', notes: '' }],
    GoalContribution: [],
    Subscription: [],
    NetWorthEntry: [{ id: 'nw1', name: 'Demo savings', account_type: 'savings_account', is_liability: false, currency: 'CHF', current_value: 20000, total_invested: 0, institution: 'Demo bank', exchange_rate: 1, last_updated: ymd(today) },
      { id: 'nw2', name: 'Demo ETF (USD)', account_type: 'investment_account', is_liability: false, currency: 'USD', current_value: 5000, total_invested: 4000, institution: 'Demo broker', exchange_rate: 0.8, last_updated: ymd(today) }],
    AssetSnapshot: [],
    Category: [],
    Settings: [
      // one-time setup jobs are for the real Sheet only; mark them done so tests start from a quiet state
      { id: 's1', key: 'job_restore_porsche', value: '1' }, { id: 's2', key: 'job_goal_3a_2027', value: '1' },
      { id: 's3', key: 'job_budgets_2027', value: '1' }, { id: 's4', key: 'job_family_6700_2027', value: '1' }
    ]
  };
  return { data: data, expected: expected };
}
module.exports = { makeDemo: makeDemo, ymd: ymd };
