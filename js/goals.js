// FlowFin · Goals: funding, contributions and the goal form.
// Shared settings and state (DATA, UI, _cache, CATEGORIES …) are globals from js/config.js.
import { deleteRow, saveRow } from './api.js';
import { $, calcTotals, esc, inPeriod, pd, periodAt, periodLabel, toast, today, txs, ymd } from './core.js';
import { fold, kpi, monthYear, periodDay, savingsProjection, savingsProjectionBody, sumBy, sw, sw0 } from './dashboard.js';
import { done } from './jobs.js';
import { topbar } from './nav.js';
import { saveSetting } from './settings.js';
import { goalIco, opt, saveMany, setting } from './transactions.js';
import { accounts, isArchived, mLong, mNext, mkey, monthEnds } from './wealth.js';

// ─── Goals ────────────────────────────────────────────────────────────────
// Contribution rule (as in Base44): saving % of a finished period's net saved (cash flow after collectibles), only when positive.
// One record per goal and period: recording again updates it, and the goal's saved amount moves by the difference only.
function goalContribs(goalId) {
  var by = {};
  (DATA.GoalContribution || []).filter(function (c) { return c.goal_id === goalId; }).forEach(function (c) {
    var k = String(c.period).slice(0, 10), cur = by[k];
    if (!cur || String(c.updated_date || c.created_date) > String(cur.updated_date || cur.created_date)) by[k] = c;
  });
  return by;
}
function goalPeriods(g) {
  var pct = +g.saving_pct || 0, have = goalContribs(g.id), out = [];
  for (var i = 6; i >= 1; i--) {
    var p = periodAt(UI.periodOffset - i), key = ymd(p.start), list = txs().filter(function (tx) { return inPeriod(tx, p); });
    if (!list.length) continue;
    var T = calcTotals(list, p.end, 0, 0), net = T.netSaved;
    var suggested = net > 0 && pct > 0 ? Math.round(net * pct) / 100 : 0;
    out.push({ p:p, key:key, net:net, suggested:suggested, rec:have[key] || null });
  }
  return out;
}
function avgNetCashFlow() {
  var tot = 0, n = 0;
  for (var i = 1; i <= 6; i++) {
    var p = periodAt(UI.periodOffset - i), list = txs().filter(function (tx) { return inPeriod(tx, p) && tx.anomaly_status !== 'excluded'; });
    if (!list.some(function (tx) { return tx.type === 'income'; })) continue;
    tot += calcTotals(list, p.end, 0, 0).netSaved; n++;
  }
  return n ? tot / n : 0;
}
function monthsUntil(d) { var t = today(); return (d.getFullYear() - t.getFullYear()) * 12 + (d.getMonth() - t.getMonth()) + (d.getDate() >= t.getDate() ? 0 : -1); }
function goalFund(g) {
  var v = {}; try { v = JSON.parse(setting('goal_fund_' + g.id, '') || '{}') || {}; } catch (e) { v = {}; }
  return { mode:v.mode || 'pct', amount:+v.amount || 0, account:v.account || '', category:v.category || '', from:v.from || '' };
}
function acctCHF(e) { if (!e) return 0; return (+e.current_value || 0) * ((e.currency && e.currency !== 'CHF') ? (+e.exchange_rate || 1) : 1); }
function acctTrend(id) {           // average change a month over the last up-to-6 months
  var ms = monthEnds().slice(-7); if (ms.length < 2) return { per:0, n:0 };
  return { per:((ms[ms.length - 1].per[id] || 0) - (ms[0].per[id] || 0)) / (ms.length - 1), n:ms.length - 1 };
}
function addMonthsD(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
function goalView(g) {
  var f = goalFund(g), acct = f.mode === 'account' ? accounts().filter(function (e) { return e.id === f.account; })[0] : null;
  var cur = f.mode === 'account' ? acctCHF(acct) : (+g.current_amount || 0), target = +g.target_amount || 0, left = Math.max(0, target - cur);
  var rate, label, note;
  if (f.mode === 'fixed') { rate = f.amount; label = 'At ' + sw0(f.amount) + ' a month'; note = 'your fixed amount'; }
  else if (f.mode === 'category') {
    var cg = catGoal(g, f); cur = cg.cur; left = Math.max(0, target - cur); rate = cg.plan; label = 'Plan: ' + sw0(Math.ceil(cg.plan)) + ' a month';
    var etaText = left <= 0 ? 'reached' : !cg.started ? 'starts ' + periodDay(pd(cg.from)) + cg.from.slice(0, 4) : cg.behind >= 1 ? sw0(cg.behind) + ' behind plan' : 'on track';
    return { f:f, cg:cg, cur:cur, target:target, left:left, rate:rate, label:label, etaText:etaText, behind:cg.behind >= 1,
      note:cg.started ? sw0(cg.cur) + ' paid in so far, ' + sw0(cg.due) + ' due by now' : 'from ' + esc(f.category) + ' transactions, ' + periodDay(pd(cg.from)) + ' – ' + periodDay(pd(cg.to)), eta:null };
  }
  else if (f.mode === 'account') { var tr = acctTrend(f.account); rate = tr.per; label = 'At the account’s trend'; note = tr.n ? (rate >= 0 ? '+' : '−') + sw0(Math.abs(rate)) + ' a month over ' + tr.n + ' month' + (tr.n === 1 ? '' : 's') : 'needs two months of values'; }
  else { var avgNet = avgNetCashFlow(); rate = (+g.saving_pct || 0) / 100 * Math.max(0, avgNet); label = 'At ' + (+g.saving_pct || 0) + '% of net saved'; note = rate > 0 ? sw(rate) + ' a period on average' : 'average net saved is not positive'; }
  var months = rate >= 1 && left / rate <= 600 ? Math.ceil(left / rate) : null;
  return { f:f, acct:acct, cur:cur, target:target, left:left, rate:rate, label:label, note:note, eta:left <= 0 ? today() : months !== null ? addMonthsD(today(), months) : null };
}
// category mode: the goal is what you actually move into a category (e.g. Retirement 3a) between a start date and the deadline,
// checked against an even monthly plan
function catGoal(g, f) {
  var from = f.from || ymd(today()), to = g.deadline || from.slice(0, 4) + '-12-31', t = today();
  var paid = {}, cur = 0;
  txs().forEach(function (tx) {
    if (tx.category !== f.category || !tx.date || tx.date < from || tx.date > to || pd(tx.date) > t) return;
    var a = +tx.amount || 0, sg = tx.type === 'refund' ? -1 : (tx.type === 'expense' || tx.type === 'investment') ? 1 : 0;
    if (!sg) return; cur += sg * a; paid[mkey(tx.date)] = (paid[mkey(tx.date)] || 0) + sg * a;
  });
  var months = []; for (var k = mkey(from); k <= mkey(to); k = mNext(k)) months.push(k);
  var target = +g.target_amount || 0, plan = months.length ? target / months.length : target;
  var started = ymd(t) >= from, nowK = mkey(ymd(t));
  var due = started ? Math.min(target, plan * months.filter(function (k) { return k < nowK; }).length) : 0;   // months already finished
  return { months:months, paid:paid, cur:cur, plan:plan, due:due, started:started, from:from, to:to, behind:Math.max(0, due - cur) };
}
function goalsHTML() {
  var goals = (DATA.FinancialGoal || []).slice().sort(function (a, b) { return String(a.deadline || '9') < String(b.deadline || '9') ? -1 : 1; });
  var h = topbar('Goals', false, '<button class="btn primary" data-act="gnew">+ Goal</button>');
  if (!goals.length) return h + '<section class="card"><h3>No goals yet</h3><p class="soon" style="margin:0">Import FinancialGoal.csv and GoalContribution.csv in <button class="navlink" data-nav="settings">Settings → Import data</button>, or add your first goal.</p></section>';
  var views = goals.map(goalView);
  var tTarget = sumBy(views, function (v) { return v.target; }), tSaved = sumBy(views, function (v) { return Math.min(v.cur, v.target); });
  var going = sumBy(views, function (v) { return Math.max(0, v.rate); });
  h += '<section class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">' +
    kpi('Saved towards goals', sw0(tSaved), 'of ' + sw0(tTarget) + ' · ' + (tTarget ? (tSaved / tTarget * 100).toFixed(1) : 0) + '%') +
    kpi('Still to save', sw0(Math.max(0, tTarget - tSaved)), goals.length + ' goal' + (goals.length === 1 ? '' : 's')) +
    kpi('Going in', sw0(going), 'a month at the current pace, all goals') + '</section>';
  var sp = savingsProjection();
  h += fold('savings', 'Savings projection', (sp.pace >= 0 ? '+' : '−') + sw0(Math.abs(sp.pace)) + ' a period at your pace', savingsProjectionBody(sp), false);
  goals.forEach(function (g, gi) {
    var v = views[gi], target = v.target, cur = v.cur, left = v.left, pct = target ? cur / target : 0;
    var dl = g.deadline ? pd(g.deadline) : null, mLeft = dl ? monthsUntil(dl) : null;
    var need = dl && mLeft > 0 ? left / mLeft : null;
    if (v.cg) { var remM = v.cg.months.filter(function (k) { return k >= mkey(ymd(today())); }).length; need = remM ? left / remM : null; }
    var etaDate = v.eta, late = dl && etaDate && etaDate > dl;
    var per = goalPeriods(g), missing = per.filter(function (x) { return x.suggested > 0 && (!x.rec || Math.abs((+x.rec.amount || 0) - x.suggested) > 0.004); });
    h += '<section class="card"><h3>' + goalIco(g) + ' ' + esc(g.name) + '<span class="r"><button class="navlink" data-act="gedit" data-id="' + esc(g.id) + '">Edit</button></span></h3>' +
      '<div class="bhead"><span class="num" style="font-size:28px">' + sw0(cur) + ' <span class="soon" style="font-size:18px">/ ' + sw0(target) + '</span></span><span class="num">' + (pct * 100).toFixed(1) + '%</span></div>' +
      '<div class="bar bbar"><i style="width:' + Math.min(100, pct * 100) + '%"></i></div>' +
      (g.notes ? '<p class="soon" style="margin:0;font-size:13px">' + esc(g.notes) + '</p>' : '') +
      '<div class="trio" style="margin-top:6px">' +
      '<div><label>Deadline</label><span class="num">' + (dl ? monthYear(dl) : '—') + '</span><small>' + (mLeft !== null ? (mLeft > 0 ? mLeft + ' months away' : 'passed') : 'none set') + '</small></div>' +
      '<div><label>Needed a month</label><span class="num">' + (need !== null ? sw(need) : '—') + '</span><small>' + (need !== null ? 'to reach it by the deadline' : '&nbsp;') + '</small></div>' +
      '<div><label>' + v.label + '</label><span class="num ' + (v.etaText ? (v.behind ? 'neg' : '') : (late || !etaDate ? 'neg' : '')) + '">' + (v.etaText || (left <= 0 ? 'reached' : etaDate ? monthYear(etaDate) : 'not reached at this pace')) + '</span><small>' + v.note + '</small></div></div>';
    if (v.f.mode !== 'pct') { h += goalFundBody(g, v) + '</section>'; return; }
    h += '<div class="subhead" style="margin-top:6px"><b>Contributions</b><span>' + (+g.saving_pct || 0) + '% of each finished period’s net saved, when positive</span></div><div class="gtable">' +
      per.map(function (x) {
        var state = x.suggested <= 0 ? '<span class="soon">no contribution · negative period</span>'
          : x.rec && Math.abs((+x.rec.amount || 0) - x.suggested) <= 0.004 ? '<span class="soon">recorded</span>'
          : '<button class="navlink" data-act="grec" data-id="' + esc(g.id) + '" data-k="' + x.key + '">' + (x.rec ? 'Update to ' + sw(x.suggested) : 'Record') + '</button>';
        return '<div><span>' + periodLabel(x.p) + '</span><span class="num ' + (x.net < 0 ? 'neg' : 'soon') + '">' + sw(x.net) + '</span><span class="num">' + (x.rec ? sw(+x.rec.amount) : x.suggested > 0 ? '<span class="soon">' + sw(x.suggested) + '</span>' : '—') + '</span><span>' + state + '</span></div>';
      }).join('') + '</div>' +
      (missing.length > 1 ? '<div class="actions" style="justify-content:flex-start;margin-top:10px"><button class="btn" data-act="grecall" data-id="' + esc(g.id) + '">Record all ' + missing.length + '</button></div>' : '') +
      '</section>';
  });
  return h;
}
function goalFundBody(g, v) {
  if (v.f.mode === 'category') {
    var cg = v.cg, nowK = mkey(ymd(today()));
    return '<div class="subhead" style="margin-top:6px"><b>Month by month</b><span>' + esc(v.f.category) + ' transactions count; log each transfer under that category</span></div><div class="gtable">' +
      cg.months.map(function (k) {
        var pdx = cg.paid[k] || 0, past = k < nowK, short = past && pdx < cg.plan - 1;
        return '<div><span>' + esc(mLong(k)) + '</span><span class="num soon">' + sw(cg.plan) + '</span><span class="num ' + (short ? 'neg' : '') + '">' + (pdx ? sw(pdx) : (past ? '0.00' : '—')) + '</span><span class="soon">' + (pdx >= cg.plan - 1 ? 'paid' : past ? 'missed' : k === nowK ? 'this month' : '') + '</span></div>';
      }).join('') + '</div>';
  }
  if (v.f.mode === 'account') {
    return '<div class="subhead" style="margin-top:6px"><b>Funded by an account</b><span>' + (v.acct ? 'follows ' + esc(v.acct.name) + ' on Wealth' : 'the linked account is gone: pick another in Edit') + '</span></div>' +
      '<p class="soon" style="margin:6px 0 0;font-size:13px">The saved amount is the account’s current value' + (v.acct && v.acct.last_updated ? ', last updated ' + periodDay(pd(v.acct.last_updated)) : '') + '. Update it in <button class="navlink" data-nav="wealth">Wealth → Update values</button>.</p>';
  }
  var k = mkey(ymd(today())), recs = (DATA.GoalContribution || []).filter(function (c) { return c.goal_id === g.id && String(c.period).length === 7; })
    .sort(function (a, b) { return String(a.period) < String(b.period) ? 1 : -1; });
  var done = recs.some(function (c) { return c.period === k; });
  return '<div class="subhead" style="margin-top:6px"><b>Monthly amounts</b><span>' + sw0(v.f.amount) + ' a month, added when you confirm it</span></div><div class="gtable">' +
    (done ? '' : '<div><span>' + esc(mLong(k)) + '</span><span></span><span class="num soon">' + sw(v.f.amount) + '</span><span><button class="navlink" data-act="gfix" data-id="' + esc(g.id) + '">Add to goal</button></span></div>') +
    recs.slice(0, 12).map(function (c) { return '<div><span>' + esc(mLong(c.period)) + '</span><span></span><span class="num">' + sw(+c.amount) + '</span><span class="soon">added</span></div>'; }).join('') +
    (!recs.length && done ? '' : '') + '</div>';
}
function addFixed(id) {
  var g = (DATA.FinancialGoal || []).filter(function (x) { return x.id === id; })[0]; if (!g) return;
  var f = goalFund(g), k = mkey(ymd(today()));
  if ((DATA.GoalContribution || []).some(function (c) { return c.goal_id === id && c.period === k; })) return;
  saveRow('GoalContribution', { goal_id:id, period:k, amount:f.amount, pct:'', net:'' })
    .then(function () { return saveRow('FinancialGoal', Object.assign({}, g, { current_amount:Math.round(((+g.current_amount || 0) + f.amount) * 100) / 100 })); })
    .then(function () { toast(sw0(f.amount) + ' added to ' + g.name); });
}
// Record (or correct) one period's contribution; the goal moves by the difference only
function recordContribs(goalId, keys) {
  var g = (DATA.FinancialGoal || []).filter(function (x) { return x.id === goalId; })[0]; if (!g) return Promise.resolve();
  var per = goalPeriods(g).filter(function (x) { return keys.indexOf(x.key) > -1 && x.suggested > 0; });
  var delta = 0, rows = per.map(function (x) {
    delta += x.suggested - (x.rec ? +x.rec.amount || 0 : 0);
    var r = { goal_id:goalId, period:x.key, amount:x.suggested, pct:+g.saving_pct || 0, net:Math.round(x.net * 100) / 100 };
    if (x.rec) { r.id = x.rec.id; r.created_date = x.rec.created_date; }
    return r;
  });
  if (!rows.length) return Promise.resolve();
  return saveMany('GoalContribution', rows).then(function () {
    return saveRow('FinancialGoal', Object.assign({}, g, { current_amount:Math.round(((+g.current_amount || 0) + delta) * 100) / 100 }));
  }).then(function () { toast(rows.length + ' contribution' + (rows.length === 1 ? '' : 's') + ' recorded · ' + (delta >= 0 ? '+' : '−') + sw(Math.abs(delta)) + ' to ' + g.name); });
}
// One-time clean-up of Base44's repeated contribution rows: keep the newest per goal and period
function repairContribs() {
  var seen = {}, drop = [];
  (DATA.GoalContribution || []).slice().sort(function (a, b) { return String(b.updated_date || b.created_date) < String(a.updated_date || a.created_date) ? -1 : 1; })
    .forEach(function (c) { var k = c.goal_id + '|' + String(c.period).slice(0, 10); if (seen[k]) drop.push(c.id); else seen[k] = 1; });
  var chain = Promise.resolve();
  drop.forEach(function (id) { chain = chain.then(function () { return deleteRow('GoalContribution', id, true); }); });
  return chain;
}
var GFORM = null;
function openGoal(id) {
  var g = id ? (DATA.FinancialGoal || []).filter(function (x) { return x.id === id; })[0] : null;
  GFORM = { g:g ? Object.assign({}, g) : { name:'', target_amount:'', current_amount:0, saving_pct:10, deadline:'', notes:'', fund_bucket:'savings' }, err:'', confirm:false };
  GFORM.fund = g ? goalFund(g) : { mode:'pct', amount:0, account:'' };
  drawGoal();
}
function closeGForm() { GFORM = null; $('modalRoot').innerHTML = ''; }
function drawGoal() {
  var g = GFORM.g;
  $('modalRoot').innerHTML = '<div class="scrim" data-act="gscrim"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="gtitle"><h2 id="gtitle">' + (g.id ? 'Edit goal' : 'New goal') + '</h2><div class="formgrid">' +
    '<div class="field full"><label for="gname">Name</label><input id="gname" value="' + esc(g.name) + '"></div>' +
    '<div class="field"><label for="gtarget">Target (CHF)</label><input id="gtarget" type="number" step="1" min="0" value="' + esc(g.target_amount) + '"></div>' +
    '<div class="field"><label for="gfund">Funded by</label><select id="gfund">' + opt('pct', 'A share of net saved', GFORM.fund.mode) + opt('fixed', 'A fixed amount a month', GFORM.fund.mode) + opt('account', 'An account on Wealth', GFORM.fund.mode) + opt('category', 'Transactions in a category', GFORM.fund.mode) + '</select></div>' +
    (GFORM.fund.mode === 'pct' ? '<div class="field"><label for="gpct">Share of net saved each period (%)</label><input id="gpct" type="number" step="1" min="0" max="100" value="' + esc(g.saving_pct) + '"></div>'
      : GFORM.fund.mode === 'fixed' ? '<div class="field"><label for="gfix">Amount a month (CHF)</label><input id="gfix" type="number" step="1" min="0" value="' + esc(GFORM.fund.amount || '') + '"></div>'
      : GFORM.fund.mode === 'category' ? '<div class="field"><label for="gfcat">Category</label><select id="gfcat">' + Object.keys(CATEGORIES).map(function (c) { return opt(c, c, GFORM.fund.category || 'Retirement 3a'); }).join('') + '</select></div>' +
        '<div class="field"><label for="gffrom">Counting from</label><input id="gffrom" type="date" value="' + esc(GFORM.fund.from || ymd(today())) + '"></div>'
      : '<div class="field"><label for="gacct">Account</label><select id="gacct">' + accounts().filter(function (e) { return !isArchived(e); }).map(function (e) { return opt(e.id, e.name, GFORM.fund.account); }).join('') + '</select></div>') +
    (GFORM.fund.mode !== 'account' && GFORM.fund.mode !== 'category' ? '<div class="field"><label for="gcur">Saved so far (CHF)</label><input id="gcur" type="number" step="0.01" min="0" value="' + esc(g.current_amount) + '"></div>' : '') +
    '<div class="field"><label for="gdl">Deadline</label><input id="gdl" type="date" value="' + esc(String(g.deadline || '').slice(0, 10)) + '"></div>' +
    '<div class="field full"><label for="gnotes">Notes</label><input id="gnotes" value="' + esc(g.notes) + '"></div>' +
    '</div>' + (GFORM.err ? '<div class="err">' + esc(GFORM.err) + '</div>' : '') +
    '<div class="actions">' + (g.id ? (GFORM.confirm ? '<span class="left"><button class="btn danger" data-act="gdelyes">Yes, delete with its contributions</button> <button class="btn" data-act="gdelno">Keep</button></span>' : '<button class="btn danger left" data-act="gdel">Delete</button>') : '') +
    '<button class="btn" data-act="gcancel">Cancel</button><button class="btn primary" data-act="gsave">' + (g.id ? 'Save changes' : 'Add goal') + '</button></div></div></div>';
  var sel = $('gfund'); if (sel) sel.onchange = function () { readGoal(); GFORM.fund.mode = sel.value; GFORM.err = ''; drawGoal(); };
}
function readGoal() {
  var g = GFORM.g;
  g.name = $('gname').value.trim(); g.target_amount = $('gtarget').value; g.deadline = $('gdl').value; g.notes = $('gnotes').value;
  if ($('gcur')) g.current_amount = $('gcur').value;
  if ($('gpct')) g.saving_pct = $('gpct').value;
  if ($('gfix')) GFORM.fund.amount = $('gfix').value;
  if ($('gacct')) GFORM.fund.account = $('gacct').value;
  if ($('gfcat')) GFORM.fund.category = $('gfcat').value;
  if ($('gffrom')) GFORM.fund.from = $('gffrom').value;
}
function saveGoal() {
  readGoal();
  var g = GFORM.g, t = parseFloat(g.target_amount);
  if (!g.name) { GFORM.err = 'Give the goal a name.'; return drawGoal(); }
  if (!(t > 0)) { GFORM.err = 'Enter a target above 0.'; return drawGoal(); }
  var F = GFORM.fund, fund = { mode:F.mode };
  if (F.mode === 'fixed') { fund.amount = parseFloat(F.amount); if (!(fund.amount > 0)) { GFORM.err = 'Enter the amount a month.'; return drawGoal(); } }
  if (F.mode === 'account') { fund.account = F.account; if (!fund.account) { GFORM.err = 'Pick the account.'; return drawGoal(); } }
  if (F.mode === 'category') { fund.category = F.category || 'Retirement 3a'; fund.from = F.from || ymd(today()); }
  var row = Object.assign({}, g, { target_amount:t, current_amount:parseFloat(g.current_amount) || 0, saving_pct:F.mode === 'pct' ? parseFloat(g.saving_pct) || 0 : (+g.saving_pct || 0) });
  var isNew = !g.id, was = g.id ? goalFund(g) : null; closeGForm();
  saveRow('FinancialGoal', row).then(function (saved) {
    var same = was && JSON.stringify(was) === JSON.stringify({ mode:fund.mode, amount:fund.amount || 0, account:fund.account || '', category:fund.category || '', from:fund.from || '' });
    return same || (!was && fund.mode === 'pct') ? null : saveSetting('goal_fund_' + saved.id, JSON.stringify(fund));
  }).then(function () { toast(isNew ? 'Goal added' : 'Goal saved'); });
}
function deleteGoal() {
  var id = GFORM.g.id, name = GFORM.g.name, cs = (DATA.GoalContribution || []).filter(function (c) { return c.goal_id === id; });
  closeGForm();
  var chain = (id === '6abcdd8dc07aa2a0e69e164a' && !done('job_restore_porsche') ? saveSetting('job_restore_porsche', '1') : Promise.resolve())
    .then(function () { return name === 'Pillar 3a 2027' && !done('job_goal_3a_2027') ? saveSetting('job_goal_3a_2027', '1') : null; })
    .then(function () { return deleteRow('FinancialGoal', id); });
  cs.forEach(function (c) { chain = chain.then(function () { return deleteRow('GoalContribution', c.id, true); }); });
  chain.then(function () { toast('Goal deleted'); });
}

export { goalContribs, goalPeriods, avgNetCashFlow, monthsUntil, goalFund, acctCHF, acctTrend, addMonthsD, goalView, catGoal, goalsHTML, goalFundBody, addFixed, recordContribs, repairContribs, GFORM, openGoal, closeGForm, drawGoal, readGoal, saveGoal, deleteGoal };
