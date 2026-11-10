// FlowFin · Anomaly review.
// Shared settings and state (DATA, UI, _cache, CATEGORIES …) are globals from js/config.js.
import { saveRow } from './api.js';
import { esc, pd, toast, today, txs } from './core.js';
import { periodDay, sw, sw0 } from './dashboard.js';
import { detectRecurring, normDesc } from './recurring.js';
import { txIco } from './transactions.js';

// ─── Anomaly Review ───────────────────────────────────────────────────────
// Flags (whole history): expenses far above their subcategory's usual amount (Base44 rule: z ≥ 1.8, ≥ CHF 20,
// at least 3 earlier samples), and income that isn't your regular salary (≥ CHF 100).
var AN_Z = 1.8, AN_MIN = 20, AN_INCOME_MIN = 100;
function anomalyList() {
  var all = txs(), stats = {}, t = today();
  all.forEach(function (tx) {
    if (tx.type !== 'expense' || tx.anomaly_status === 'excluded') return;
    var k = tx.subcategory || tx.category || 'Other';
    (stats[k] = stats[k] || []).push(+tx.amount || 0);
  });
  Object.keys(stats).forEach(function (k) {
    var a = stats[k]; if (a.length < 3) { delete stats[k]; return; }
    var mean = a.reduce(function (s, v) { return s + v; }, 0) / a.length;
    var sd = Math.sqrt(a.reduce(function (s, v) { return s + (v - mean) * (v - mean); }, 0) / a.length);
    stats[k] = { mean:mean, sd:sd, n:a.length };
  });
  // the salary is the income description that shows up most often
  var inc = {}; all.forEach(function (tx) { if (tx.type === 'income') inc[normDesc(tx.description)] = (inc[normDesc(tx.description)] || 0) + 1; });
  var salaryKey = Object.keys(inc).sort(function (a, b) { return inc[b] - inc[a]; })[0];
  var out = [], recurring = {};
  detectRecurring().forEach(function (r) { recurring[normDesc(r.name)] = 1; });   // a regular bill isn't an anomaly
  all.forEach(function (tx) {
    if (!tx.date || pd(tx.date) > t) return;
    var a = +tx.amount || 0;
    if (tx.type === 'expense' && a >= AN_MIN && !recurring[normDesc(tx.description)]) {
      var k = tx.subcategory || tx.category || 'Other', s = stats[k];
      if (!s || !(s.sd > 0)) return;
      var z = (a - s.mean) / s.sd;
      if (z >= AN_Z) out.push({ tx:tx, why:'≈ ' + (a / s.mean).toFixed(1) + '× a usual ' + k + ' (' + sw0(s.mean) + ')', score:z, extra:a - s.mean });
    } else if (tx.type === 'income' && a >= AN_INCOME_MIN && normDesc(tx.description) !== salaryKey) {
      out.push({ tx:tx, why:'Income that isn’t your salary · counts towards your allowance', score:9, extra:a });
    }
  });
  return out.sort(function (x, y) { return x.tx.date < y.tx.date ? 1 : -1; });
}
function anomalyBody() {
  var list = anomalyList(), f = UI.anFilter || 'pending';
  var st = function (x) { return x.tx.anomaly_status || 'pending'; };
  var count = { pending:0, excluded:0, confirmed:0 }; list.forEach(function (x) { count[st(x)] = (count[st(x)] || 0) + 1; });
  var shown = f === 'all' ? list : list.filter(function (x) { return st(x) === f; });
  var h = '';
  h += '<p class="soon" style="margin:0;font-size:14px;max-width:62rem"><b style="color:var(--ink)">One-off</b> takes a transaction out of your usual spending, your average salary and the forecasts. It still counts in that period’s totals. ' +
    '<b style="color:var(--ink)">Keep</b> marks it as normal. Covers your whole history; decisions made here stay through the Base44 sync.</p>';
  h += '<div class="seg3" role="tablist">' + [['pending','To review'],['excluded','One-off'],['confirmed','Kept'],['all','All']].map(function (o) {
    return '<button role="tab" aria-selected="' + (f === o[0]) + '" class="' + (f === o[0] ? 'on' : '') + '" data-act="anf" data-v="' + o[0] + '">' + o[1] + ' <span class="num">' + (o[0] === 'all' ? list.length : count[o[0]] || 0) + '</span></button>';
  }).join('') + '</div>';
  h += '<section class="card" style="padding-top:4px">';
  if (!shown.length) h += '<div class="empty">' + (f === 'pending' ? 'Nothing left to review.' : 'None here.') + '</div>';
  shown.forEach(function (x) {
    var tx = x.tx, s = st(x), inflow = tx.type === 'income';
    h += '<div class="anrow"><div class="and"><span class="num soon">' + periodDay(pd(tx.date)) + String(pd(tx.date).getFullYear()).slice(2) + '</span>' +
      '<span><b>' + txIco(tx) + ' ' + esc(tx.description) + '</b><small>' + esc(tx.category) + (tx.subcategory ? ' › ' + esc(tx.subcategory) : '') + ' · ' + x.why + '</small></span>' +
      '<span class="num ' + (inflow ? 'inflow' : '') + '">' + (inflow ? '+' : '') + sw(+tx.amount) + '</span></div>' +
      '<div class="anb"><div class="seg2">' +
      '<button class="' + (s === 'confirmed' ? 'on' : '') + '" data-act="anset" data-id="' + esc(tx.id) + '" data-v="confirmed">Keep</button>' +
      '<button class="' + (s === 'excluded' ? 'on' : '') + '" data-act="anset" data-id="' + esc(tx.id) + '" data-v="excluded">One-off</button></div>' +
      (s !== 'pending' ? '<button class="navlink" data-act="anset" data-id="' + esc(tx.id) + '" data-v="">Undo</button>' : '') + '</div></div>';
  });
  return h + '</section>';
}
function setAnomaly(id, v) {
  var tx = txs().filter(function (x) { return x.id === id; })[0]; if (!tx) return;
  saveRow('Transaction', Object.assign({}, tx, { anomaly_status:v }))
    .then(function () { toast(tx.description + ': ' + (v === 'excluded' ? 'one-off' : v === 'confirmed' ? 'kept' : 'back to review')); });
}

export { AN_Z, AN_MIN, AN_INCOME_MIN, anomalyList, anomalyBody, setAnomaly };
