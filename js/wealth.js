// FlowFin · Wealth & Assets and the month-end model.
// Shared settings and state (DATA, UI, _cache, CATEGORIES …) are globals from js/config.js.
import { deleteRow, saveRow } from './api.js';
import { truthy } from './budgets.js';
import { chartColors } from './charts.js';
import { $, calcTotals, daysBetween, esc, fmt0, pd, toast, today, txs, ymd } from './core.js';
import { fold, periodDay, sumBy, sw0 } from './dashboard.js';
import { acctCHF } from './goals.js';
import { topbar } from './nav.js';
import { CURRENCIES, fxRate, ico, opt, saveMany, setting } from './transactions.js';

// ─── Wealth & Assets ──────────────────────────────────────────────────────
var ACCOUNT_TYPES = {
  current_account:['Current account','cash'], savings_account:['Savings account','cash'],
  investment_account:['Investment account','invest'], third_pillar:['3rd pillar (3a)','invest'], private_pension:['Private pension','invest'], tcg_investments:['TCG investments','invest'],
  real_estate:['Real estate','physical'], vehicle:['Vehicle','physical'], other_asset:['Other asset','physical'],
  loan:['Loan','liab'], mortgage:['Mortgage','liab'], credit_card_debt:['Credit card debt','liab'], other_liability:['Other liability','liab']
};
var WEALTH_GROUPS = [['cash','Cash & savings'],['invest','Investments'],['physical','Physical assets'],['liab','Liabilities']];
function acctType(t) { return ACCOUNT_TYPES[t] || ACCOUNT_TYPES.other_asset; }
function isLiab(e) { return truthy(e.is_liability) || acctType(e.account_type)[1] === 'liab'; }
function isInv(e) { return acctType(e.account_type)[1] === 'invest'; }
function accounts() { return (DATA.NetWorthEntry || []).slice(); }
// Archived accounts still count in net worth and history but leave the lists and the monthly update
function isArchived(e) { return setting('acct_archived_' + e.id, '') === '1'; }
function activeAccounts() { return accounts().filter(function (e) { return !isArchived(e); }); }
// Saved according to your transactions in a calendar month: income minus spending (money moved into
// collectibles, investing or 3a stays yours, so it isn't spending here)
function txSavedInMonth(k) {
  var t = today(), list = txs().filter(function (tx) { return tx.date && mkey(tx.date) === k && pd(tx.date) <= t; });
  if (!list.length) return null;
  return calcTotals(list, t).netCashFlow;
}
function snapsByEntry() {
  var m = {};
  (DATA.AssetSnapshot || []).forEach(function (s) { if (s.entry_id && s.date) (m[s.entry_id] = m[s.entry_id] || []).push(s); });
  Object.keys(m).forEach(function (k) { m[k].sort(function (a, b) { return String(a.date) < String(b.date) ? -1 : 1; }); });
  return m;
}
// Value of every account on a date: its latest snapshot on or before that date (0 if it didn't exist yet)
function wealthOn(date, by) {
  var r = { net:0, assets:0, liab:0, invValue:0, invested:0, per:{} };
  accounts().forEach(function (e) {
    var list = by[e.id] || [], s = null;
    for (var i = 0; i < list.length; i++) if (String(list[i].date) <= date) s = list[i];
    if (!s) { r.per[e.id] = 0; return; }
    var rate = +s.exchange_rate || +e.exchange_rate || 1, chfV = (+s.value || 0) * rate;
    r.per[e.id] = isLiab(e) ? -chfV : chfV;
    if (isLiab(e)) r.liab += chfV; else r.assets += chfV;
    if (isInv(e)) { r.invValue += chfV; r.invested += ((s.total_invested !== '' && s.total_invested != null) ? +s.total_invested : (+e.total_invested || 0)) * rate; }
  });
  r.net = r.assets - r.liab;
  return r;
}
// Today's figures come from each account's current value, so a value edited without a snapshot still counts
function wealthNow() {
  var r = { net:0, assets:0, liab:0, invValue:0, invested:0, per:{}, byCur:{} };
  accounts().forEach(function (e) {
    var rate = (e.currency && e.currency !== 'CHF') ? (+e.exchange_rate || 1) : 1, chfV = (+e.current_value || 0) * rate;
    r.per[e.id] = isLiab(e) ? -chfV : chfV;
    if (isLiab(e)) r.liab += chfV; else { r.assets += chfV; var c = e.currency || 'CHF'; r.byCur[c] = (r.byCur[c] || 0) + chfV; }
    if (isInv(e)) { r.invValue += chfV; r.invested += (+e.total_invested || 0) * rate; }
  });
  r.net = r.assets - r.liab;
  return r;
}
// ─── Month-end model ─────────────────────────────────────────────────────
// One figure per account per calendar month: the last value entered in that month.
// Months that have ended are final; the current month shows "so far" until it ends.
// An account not updated in a month carries its previous month-end value forward.
function mkey(d) { return String(d).slice(0, 7); }
function mDate(k) { return new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, 1); }
function mNext(k) { var d = mDate(k); d.setMonth(d.getMonth() + 1); return ymd(d).slice(0, 7); }
function mEnd(k) { var d = mDate(k); return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function mLong(k) { return mDate(k).toLocaleDateString('en-GB', { month:'long', year:'numeric' }); }
function mShort(k) { return mDate(k).toLocaleDateString('en-GB', { month:'short' }) + ' ' + k.slice(2, 4); }
function mName(k) { return mDate(k).toLocaleDateString('en-GB', { month:'long' }); }
function monthEnds() {
  var by = snapsByEntry(), acc = accounts(), cur = mkey(ymd(today())), first = cur;
  (DATA.AssetSnapshot || []).forEach(function (s) { if (s.date && mkey(s.date) < first) first = mkey(s.date); });
  var out = [], last = {};                       // last: entry id → latest snapshot so far
  for (var k = first; k <= cur; k = mNext(k)) {
    var m = { key:k, final:k < cur, net:0, assets:0, liab:0, invValue:0, invested:0, per:{}, updated:{}, nUpd:0 };
    acc.forEach(function (e) {
      (by[e.id] || []).forEach(function (s) { if (mkey(s.date) === k) { last[e.id] = s; m.updated[e.id] = true; } });
      var s = last[e.id], v, rate, inv;
      if (k === cur) {                           // the running month uses the account's current value
        rate = (e.currency && e.currency !== 'CHF') ? (+e.exchange_rate || 1) : 1; v = (+e.current_value || 0) * rate; inv = (+e.total_invested || 0) * rate;
        if (e.last_updated && mkey(e.last_updated) === k) m.updated[e.id] = true;
      } else if (s) {
        rate = +s.exchange_rate || +e.exchange_rate || 1; v = (+s.value || 0) * rate;
        inv = ((s.total_invested !== '' && s.total_invested != null) ? +s.total_invested : (+e.total_invested || 0)) * rate;
      } else { m.per[e.id] = 0; return; }
      m.per[e.id] = isLiab(e) ? -v : v;
      if (isLiab(e)) m.liab += v; else m.assets += v;
      if (isInv(e)) { m.invValue += v; m.invested += inv; }
    });
    m.nUpd = acc.filter(function (e) { return m.updated[e.id] && !isArchived(e); }).length;
    m.net = m.assets - m.liab;
    out.push(m);
  }
  out.forEach(function (m, i) {
    var p = out[i - 1]; if (!p) return;
    m.chg = m.net - p.net;
    m.market = (m.invValue - m.invested) - (p.invValue - p.invested);   // change in gain on investments
    m.you = m.chg - m.market;                                           // everything else: money saved, spent or moved
  });
  return out;
}
function lastSnapshotDate() { var d = ''; (DATA.AssetSnapshot || []).forEach(function (s) { if (String(s.date) > d) d = String(s.date).slice(0, 10); }); return d; }
function sgn0(v) { return (v >= 0 ? '+' : '−') + sw0(Math.abs(v)); }

function wealthHTML() {
  var acc = activeAccounts(), arch = accounts().filter(isArchived), h = topbar('Wealth &amp; Assets', false, '<button class="btn" data-act="waddacct">+ Account</button><button class="btn primary" data-act="wupdate">Update values</button>');
  if (!acc.length && !arch.length) {
    return h + '<section class="card"><h3>No accounts yet</h3><p class="soon" style="margin:0">Import NetWorthEntry.csv and AssetSnapshot.csv in <button class="navlink" data-nav="settings">Settings → Import data</button>, or add your first account.</p></section>';
  }
  var ms = monthEnds(), cur = ms[ms.length - 1], prev = ms.length > 1 ? ms[ms.length - 2] : null;
  var gain = cur.invValue - cur.invested, end = mEnd(cur.key), left = daysBetween(today(), end);
  h += '<section class="hero"><div class="main"><div class="eyebrow">Net worth · ' + esc(mName(cur.key)) + ' so far</div>' +
    '<div class="bignum"><span class="cur">CHF</span><span class="val ' + (cur.net < 0 ? 'neg' : '') + '">' + sw0(cur.net) + '</span></div>' +
    '<p class="why">' + (prev && cur.nUpd === 0 ? 'Same as end of ' + esc(mName(prev.key)) + ': nothing updated in ' + esc(mName(cur.key)) + ' yet. ' : '') + (prev && cur.nUpd ? sgn0(cur.chg) + ' vs end of ' + esc(mName(prev.key)) + (prev.net ? ' (' + (cur.chg >= 0 ? '+' : '') + (cur.chg / Math.abs(prev.net) * 100).toFixed(1) + '%)' : '') + '. ' : '') +
    (cur.nUpd && cur.nUpd < acc.length ? cur.nUpd + ' of ' + acc.length + ' accounts updated in ' + esc(mName(cur.key)) + '; the rest carry their last value. ' : '') + 'Becomes final on ' + periodDay(end) + ' Update as often as you like; the last value in a month counts.</p></div>' +
    '<div class="side">' +
    '<div class="line"><span>Assets</span><span class="num">' + sw0(cur.assets) + '</span></div>' +
    (cur.liab ? '<div class="line"><span>Liabilities</span><span class="num neg">−' + sw0(cur.liab) + '</span></div>' : '') +
    '<div class="line"><span>Investments</span><span class="num">' + sw0(cur.invValue) + '</span></div>' +
    '<div class="line"><span>Gain on investments</span><span class="num ' + (gain < 0 ? 'neg' : '') + '">' + sgn0(gain) + (cur.invested ? ' <span class="soon" style="font-size:13px">' + (gain / cur.invested * 100).toFixed(0) + '%</span>' : '') + '</span></div>' +
    '</div></section>';
  // reminder: near month end with accounts still on last month's value, or last month never recorded
  var stale = acc.length - cur.nUpd;
  if (prev && prev.nUpd === 0) h += '<section class="notice"><span>Nothing was recorded in ' + esc(mName(prev.key)) + ', so its month-end repeats the month before. You can still enter it: pick ' + esc(mName(prev.key)) + ' in the update form.</span><button class="btn primary" data-act="wupdate" data-month="' + prev.key + '">Record ' + esc(mName(prev.key)) + '</button></section>';
  else if (stale && left <= 7) h += '<section class="notice"><span>' + esc(mName(cur.key)) + ' closes in ' + (left + 1) + ' day' + (left ? 's' : '') + '. ' + stale + ' account' + (stale === 1 ? '' : 's') + ' still show last month’s value.</span><button class="btn primary" data-act="wupdate">Update values</button></section>';

  h += '<section class="card"><h3>Net worth at month end<span class="r legend"><span><i style="border-top:8px solid var(--ink)"></i>Final</span><span><i style="border-top:8px solid var(--faint)"></i>So far</span><span><i style="border-top:2px dotted var(--muted)"></i>Invested (cost)</span></span></h3>' +
    '<div class="chartbox"><canvas id="chWealth" role="img" aria-label="Net worth at the end of each month"></canvas></div></section>';

  // month-end table, newest first
  var rows = ms.slice().reverse().slice(0, 12);
  h += '<section class="card"><h3>Month by month<span class="r">calendar months</span></h3><div class="atable mtab">' +
    '<div class="ah"><span>Month</span><span>Net worth</span><span>Change</span><span>Market</span><span>You</span><span>Saved per transactions</span><span>Gap</span></div>' +
    rows.map(function (m) {
      var c = function (v, quiet) { return v === undefined || v === null ? '<span class="num soon">—</span>' : '<span class="num ' + (v < 0 && !quiet ? 'neg' : quiet ? 'soon' : '') + '">' + sgn0(v) + '</span>'; };
      var tx = txSavedInMonth(m.key), gap = tx === null || m.you === undefined ? null : m.you - tx;
      return '<div><span><b>' + esc(mLong(m.key)) + '</b><small>' + (m.final ? 'final' : 'so far') + ' · ' + m.nUpd + ' of ' + acc.length + ' updated</small></span>' +
        '<span class="num">' + sw0(m.net) + '</span>' + c(m.chg) + c(m.market) + c(m.you) + c(tx, true) +
        (gap === null ? '<span class="num soon">—</span>' : '<span class="num ' + (Math.abs(gap) >= 500 ? 'neg' : 'soon') + '">' + sgn0(gap) + '</span>') + '</div>';
    }).join('') + '</div>' +
    '<p class="soon" style="margin:10px 0 0;font-size:12px;max-width:62rem"><b style="color:var(--ink)">Market</b>: change in the gain on your investments. <b style="color:var(--ink)">You</b>: the rest of the change, money you added, spent or moved. ' +
    '<b style="color:var(--ink)">Saved per transactions</b>: income minus spending logged in that month (buying cards or investing isn’t spending). <b style="color:var(--ink)">Gap</b>: You minus that; a large gap means money moved that FlowFin has no transaction for, or a balance wasn’t updated. Gaps of 500 or more are red.</p></section>';

  // accounts by group
  WEALTH_GROUPS.forEach(function (g) {
    var list = acc.filter(function (e) { return acctType(e.account_type)[1] === g[0] || (g[0] === 'liab' && isLiab(e) && acctType(e.account_type)[1] !== 'liab'); })
      .filter(function (e) { return g[0] === 'liab' ? isLiab(e) : !isLiab(e); })
      .sort(function (a, b) { return Math.abs(cur.per[b.id]) - Math.abs(cur.per[a.id]); });
    if (!list.length) return;
    var tot = sumBy(list, function (e) { return Math.abs(cur.per[e.id]); });
    h += '<section class="card"><h3>' + g[1] + '<span class="r num" style="font-size:16px;color:var(--ink)">' + (g[0] === 'liab' ? '−' : '') + sw0(tot) + '</span></h3><div class="atable">' +
      '<div class="ah"><span>Account</span><span>Value</span>' + (g[0] === 'invest' ? '<span>Invested</span><span>Gain</span>' : '<span></span><span></span>') + '<span>' + (prev ? 'vs end ' + esc(mShort(prev.key)) : '') + '</span></div>' +
      list.map(function (e) {
        var v = Math.abs(cur.per[e.id]), foreign = e.currency && e.currency !== 'CHF';
        var ch = prev ? Math.abs(cur.per[e.id]) - Math.abs(prev.per[e.id] || 0) : null, upd = cur.updated[e.id];
        var inv = isInv(e) ? (+e.total_invested || 0) * (foreign ? (+e.exchange_rate || 1) : 1) : 0, gn = v - inv;
        return '<div class="drill" data-act="weditacct" data-id="' + esc(e.id) + '" tabindex="0" role="button"><span><b>' + ico(ACCT_ICON[e.account_type] || 'tag', e.color || '') + ' ' + esc(e.name) + '</b><small>' + esc(acctType(e.account_type)[0]) + (e.institution ? ' · ' + esc(e.institution) : '') +
          (foreign ? ' · ' + fmt0.format(Math.round(+e.current_value || 0)) + ' ' + esc(e.currency) : '') +
          ' · ' + (upd ? 'updated ' + periodDay(pd(e.last_updated)) : '<span class="stale">' + (e.last_updated ? 'last ' + periodDay(pd(e.last_updated)) : 'not updated') + '</span>') + '</small></span>' +
          '<span class="num">' + sw0(v) + '</span>' +
          (isInv(e) && inv ? '<span class="num soon">' + sw0(inv) + '</span><span class="num ' + (gn < 0 ? 'neg' : '') + '">' + sgn0(gn) + ' <small>' + (gn / inv * 100).toFixed(0) + '%</small></span>' : '<span></span><span></span>') +
          '<span class="num ' + (ch !== null && ch < 0 ? 'neg' : 'soon') + '">' + (ch === null ? '—' : sgn0(ch)) + '</span></div>';
      }).join('') + '</div></section>';
  });
  if (arch.length) {
    h += fold('archived', 'Archived accounts', arch.length + ' · still counted in net worth', '<div class="atable">' + arch.map(function (e) {
      return '<div><span><b>' + esc(e.name) + '</b><small>' + esc(acctType(e.account_type)[0]) + (e.institution ? ' · ' + esc(e.institution) : '') + '</small></span><span class="num">' + sw0(acctCHF(e)) + '</span><span></span><span></span>' +
        '<span><button class="navlink" data-act="wunarch" data-id="' + esc(e.id) + '">Restore</button></span></div>';
    }).join('') + '</div>', false);
  }
  // currency exposure
  var byCur = {}; accounts().forEach(function (e) { if (!isLiab(e)) { var c = e.currency || 'CHF'; byCur[c] = (byCur[c] || 0) + Math.abs(cur.per[e.id]); } });
  var curs = Object.keys(byCur).sort(function (a, b) { return byCur[b] - byCur[a]; });
  if (curs.length > 1) {
    var shades = ['var(--ink)', '#4A4F4C', '#8A8F8B', '#B9BDB9', '#D3D6D2'];
    h += '<section class="card"><h3>Currency exposure<span class="r">assets, in CHF</span></h3><div class="split">' +
      curs.map(function (c, i) { return '<i style="width:' + (byCur[c] / cur.assets * 100) + '%;background:' + shades[i % shades.length] + '"></i>'; }).join('') + '</div><div class="splitkey">' +
      curs.map(function (c, i) { return '<span><i style="background:' + shades[i % shades.length] + '"></i>' + esc(c) + ' ' + (byCur[c] / cur.assets * 100).toFixed(0) + '% · ' + sw0(byCur[c]) + '</span>'; }).join('') + '</div></section>';
  }
  return h;
}
function wealthChart() {
  var el = $('chWealth'); if (!el || !window.Chart || CHARTS.wealth) return;
  var ms = monthEnds().slice(-13), C = chartColors();
  if (!ms.length) return;
  CHARTS.wealth = new Chart(el, {
    data:{ labels:ms.map(function (m) { return mShort(m.key); }), datasets:[
      { type:'bar', label:'Net worth', data:ms.map(function (m) { return Math.round(m.net); }), backgroundColor:ms.map(function (m) { return m.final ? C.ink : C.faint; }), borderWidth:0, barPercentage:0.7, categoryPercentage:0.9, order:2 },
      { type:'line', label:'Invested (cost)', data:ms.map(function (m) { return Math.round(m.invested); }), borderColor:C.muted, borderDash:[2,3], borderWidth:1.5, pointRadius:0, tension:0, order:1 }
    ]},
    options:{ responsive:true, maintainAspectRatio:false, layout:{ padding:{ left:4, right:8 } }, interaction:{ mode:'index', intersect:false },
      plugins:{ legend:{ display:false }, tooltip:{ backgroundColor:C.ink, cornerRadius:0, titleFont:{ family:'IBM Plex Mono' }, bodyFont:{ family:'IBM Plex Mono' },
        callbacks:{ title:function (it) { var m = ms[it[0].dataIndex]; return mLong(m.key) + (m.final ? '' : ' · so far'); },
          label:function (c) { return c.dataset.label + ': ' + sw0(c.parsed.y); },
          afterBody:function (it) { var m = ms[it[0].dataIndex]; return m.chg === undefined ? '' : ['Change: ' + sgn0(m.chg), '  market ' + sgn0(m.market) + ' · you ' + sgn0(m.you)]; } } } },
      scales:{
        x:{ ticks:{ color:C.muted, maxRotation:0, autoSkip:true, font:{ family:'IBM Plex Mono', size:11 } }, grid:{ display:false }, border:{ color:C.ink } },
        y:{ beginAtZero:true, ticks:{ color:C.muted, font:{ family:'IBM Plex Mono', size:11 }, callback:function (v) { return sw0(v); } }, grid:{ color:C.rule }, border:{ display:false } }
      } }
  });
}

// Update values for a month: one value per account. Saving again in the same month replaces that month's figure,
// so the last value entered in a month is its month-end number. A past month is saved with its last day as the date.
var WFORM = null;
function closeWForm() { WFORM = null; $('modalRoot').innerHTML = ''; }
function monthDate(k) { return k === mkey(ymd(today())) ? ymd(today()) : ymd(mEnd(k)); }
function monthSnaps(k) {   // entry id → that month's latest snapshot
  var m = {};
  (DATA.AssetSnapshot || []).forEach(function (s) { if (s.date && mkey(s.date) === k && (!m[s.entry_id] || String(s.date) >= String(m[s.entry_id].date))) m[s.entry_id] = s; });
  return m;
}
function openUpdate(month) {
  WFORM = { kind:'update', month:month || mkey(ymd(today())), rates:{}, err:'' };
  drawUpdate(); loadRates();
}
function loadRates() {
  var d = monthDate(WFORM.month), k = WFORM.month;
  activeAccounts().forEach(function (e) {
    if (!e.currency || e.currency === 'CHF' || monthSnaps(k)[e.id]) return;
    fxRate(e.currency, d).then(function (r) {
      if (!WFORM || WFORM.kind !== 'update' || WFORM.month !== k) return;
      var inp = $('wr_' + e.id); if (inp && !inp.dataset.touched) inp.value = r.toFixed(4);
      var note = $('wrn_' + e.id); if (note) note.textContent = 'ECB rate ' + periodDay(pd(d));
    }).catch(function () {});
  });
}
function drawUpdate() {
  var k = WFORM.month, cur = mkey(ymd(today())), have = monthSnaps(k), by = snapsByEntry();
  var acc = activeAccounts().sort(function (a, b) { return WEALTH_GROUPS.map(function (g) { return g[0]; }).indexOf(acctType(a.account_type)[1]) - WEALTH_GROUPS.map(function (g) { return g[0]; }).indexOf(acctType(b.account_type)[1]); });
  var opts = [], x = cur; for (var i = 0; i < 13; i++) { opts.push(x); var d = mDate(x); d.setMonth(d.getMonth() - 1); x = ymd(d).slice(0, 7); }
  // starting value for each field: this month's entry, else the latest value before it
  var start = function (e) {
    if (have[e.id]) return have[e.id];
    if (k === cur) return { value:e.current_value, total_invested:e.total_invested, exchange_rate:e.exchange_rate };
    var s = null; (by[e.id] || []).forEach(function (y) { if (mkey(y.date) <= k) s = y; });
    return s || { value:'', total_invested:e.total_invested, exchange_rate:e.exchange_rate };
  };
  var n = Object.keys(have).length;
  var h = '<div class="scrim" data-act="wscrim"><div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="wtitle"><h2 id="wtitle">Update values</h2>' +
    '<div class="field" style="max-width:240px"><label for="wmonth">Month</label><select id="wmonth">' + opts.map(function (o) { return opt(o, mLong(o) + (o === cur ? ' (so far)' : ''), k); }).join('') + '</select></div>' +
    '<p class="soon" style="font-size:12px;margin:0 0 8px">' + (n ? n + ' account' + (n === 1 ? ' has' : 's have') + ' a value for ' + esc(mName(k)) + ' already; saving replaces it.' : 'No values for ' + esc(mName(k)) + ' yet. Fields start from the latest values.') +
    ' The last value you save in a month is its month-end figure.</p>' +
    '<div class="utable"><div class="uh"><span>Account</span><span>Value</span><span>Invested</span><span>Rate to CHF</span></div>' +
    acc.map(function (e) {
      var foreign = e.currency && e.currency !== 'CHF', s = start(e);
      return '<div><span><b>' + esc(e.name) + '</b><small>' + esc(acctType(e.account_type)[0]) + ' · ' + esc(e.currency || 'CHF') + (have[e.id] ? ' · entered ' + periodDay(pd(have[e.id].date)) : '') + '</small></span>' +
        '<span><input id="wv_' + esc(e.id) + '" type="number" inputmode="decimal" step="0.01" aria-label="Value of ' + esc(e.name) + '" value="' + esc(s.value) + '"></span>' +
        '<span>' + (isInv(e) ? '<input id="wi_' + esc(e.id) + '" type="number" inputmode="decimal" step="0.01" aria-label="Invested in ' + esc(e.name) + '" value="' + esc(s.total_invested) + '">' : '') + '</span>' +
        '<span>' + (foreign ? '<input id="wr_' + esc(e.id) + '" type="number" step="0.0001" aria-label="Rate for ' + esc(e.name) + '" value="' + esc(s.exchange_rate || 1) + '"><small id="wrn_' + esc(e.id) + '">' + (have[e.id] ? 'as entered' : 'last used') + '</small>' : '') + '</span></div>';
    }).join('') + '</div>' + (WFORM.err ? '<div class="err">' + esc(WFORM.err) + '</div>' : '') +
    '<div class="actions"><button class="btn" data-act="wcancel">Cancel</button><button class="btn primary" data-act="wsaveupdate">Save ' + esc(mName(k)) + '</button></div></div></div>';
  $('modalRoot').innerHTML = h;
  var sel = $('wmonth'); if (sel) sel.onchange = function () { WFORM.month = sel.value; WFORM.err = ''; drawUpdate(); loadRates(); };
}
function saveUpdate() {
  var k = WFORM.month, d = monthDate(k), have = monthSnaps(k), latestMonth = k >= mkey(ymd(today()));
  var snaps = [], ents = [], bad = '';
  activeAccounts().forEach(function (e) {
    var raw = String($('wv_' + e.id).value).trim();
    if (raw === '' && !have[e.id]) return;                  // left empty for a past month: skip this account
    var v = parseFloat(raw.replace(',', '.'));
    if (!(v >= 0)) { bad = e.name; return; }
    var inv = $('wi_' + e.id) ? parseFloat(String($('wi_' + e.id).value).replace(',', '.')) : null;
    var rate = $('wr_' + e.id) ? parseFloat($('wr_' + e.id).value) || 1 : 1;
    var p = have[e.id];
    snaps.push({ id:p ? p.id : '', entry_id:e.id, date:d, value:v, total_invested:inv === null || isNaN(inv) ? '' : inv, exchange_rate:rate, created_date:p ? p.created_date : '' });
    if (latestMonth || !e.last_updated || d >= String(e.last_updated)) {
      var en = Object.assign({}, e, { current_value:v, exchange_rate:rate, last_updated:d });
      if (inv !== null && !isNaN(inv)) en.total_invested = inv;
      ents.push(en);
    }
  });
  if (bad) { WFORM.err = 'Enter a value of 0 or more for ' + bad + '.'; return drawUpdate(); }
  snaps.forEach(function (s) { if (!s.id) delete s.id; if (!s.created_date) delete s.created_date; });
  closeWForm();
  saveMany('AssetSnapshot', snaps).then(function () { return ents.length ? saveMany('NetWorthEntry', ents) : null; }).then(function () { toast(mName(k) + ' saved' + (k < mkey(ymd(today())) ? ' as final' : ' (so far)')); });
}

// Add or edit one account
function openAcct(id) {
  var e = id ? accounts().filter(function (x) { return x.id === id; })[0] : null;
  WFORM = { kind:'acct', e:e ? Object.assign({}, e) : { name:'', account_type:'savings_account', currency:'CHF', current_value:'', total_invested:'', institution:'', exchange_rate:1, is_liability:false }, err:'', confirm:false };
  drawAcct();
}
function drawAcct() {
  var e = WFORM.e;
  var h = '<div class="scrim" data-act="wscrim"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="wtitle"><h2 id="wtitle">' + (e.id ? 'Edit account' : 'New account') + '</h2><div class="formgrid">' +
    '<div class="field full"><label for="wname">Name</label><input id="wname" value="' + esc(e.name) + '"></div>' +
    '<div class="field"><label for="wtype">Type</label><select id="wtype">' + Object.keys(ACCOUNT_TYPES).map(function (k) { return opt(k, ACCOUNT_TYPES[k][0], e.account_type); }).join('') + '</select></div>' +
    '<div class="field"><label for="wcur">Currency</label><select id="wcur">' + CURRENCIES.map(function (c) { return opt(c, c, e.currency || 'CHF'); }).join('') + '</select></div>' +
    '<div class="field"><label for="wval">Current value</label><input id="wval" type="number" step="0.01" value="' + esc(e.current_value) + '"></div>' +
    '<div class="field"><label for="winv">Invested (cost), for investments</label><input id="winv" type="number" step="0.01" value="' + esc(e.total_invested) + '"></div>' +
    '<div class="field"><label for="winst">Bank or provider</label><input id="winst" value="' + esc(e.institution) + '"></div>' +
    '<div class="field"><label for="wrate">Rate to CHF (foreign currency)</label><input id="wrate" type="number" step="0.0001" value="' + esc(e.exchange_rate || 1) + '"></div>' +
    '</div>' + (WFORM.err ? '<div class="err">' + esc(WFORM.err) + '</div>' : '') +
    '<p class="soon" style="font-size:12px;margin:0">Changing the value here doesn’t add a point to the history chart. Use “Update values” for that.</p>' +
    '<div class="actions">' + (e.id ? (WFORM.confirm ? '<span class="left"><button class="btn danger" data-act="wdelyes">Yes, delete with its history</button> <button class="btn" data-act="wdelno">Keep</button></span>' : '<span class="left"><button class="btn danger" data-act="wdel">Delete</button> <button class="btn" data-act="warch" data-id="' + esc(e.id) + '">' + (isArchived(e) ? 'Restore' : 'Archive') + '</button></span>') : '') +
    '<button class="btn" data-act="wcancel">Cancel</button><button class="btn primary" data-act="wsaveacct">' + (e.id ? 'Save changes' : 'Add account') + '</button></div></div></div>';
  $('modalRoot').innerHTML = h;
}
function readAcct() {
  var e = WFORM.e;
  e.name = $('wname').value.trim(); e.account_type = $('wtype').value; e.currency = $('wcur').value; e.institution = $('winst').value.trim();
  e.current_value = $('wval').value; e.total_invested = $('winv').value; e.exchange_rate = $('wrate').value;
}
function saveAcct() {
  readAcct();
  var e = WFORM.e, v = parseFloat(e.current_value);
  if (!e.name) { WFORM.err = 'Give the account a name.'; return drawAcct(); }
  if (!(v >= 0)) { WFORM.err = 'Enter the current value as 0 or more.'; return drawAcct(); }
  var row = Object.assign({}, e, { current_value:v, total_invested:e.total_invested === '' ? '' : parseFloat(e.total_invested) || 0,
    exchange_rate:e.currency === 'CHF' ? 1 : (parseFloat(e.exchange_rate) || 1), is_liability:acctType(e.account_type)[1] === 'liab', last_updated:e.last_updated || ymd(today()) });
  var isNew = !e.id; closeWForm();
  saveRow('NetWorthEntry', row).then(function () { toast(isNew ? 'Account added' : 'Account saved'); });
}
function deleteAcct() {
  var id = WFORM.e.id, snaps = (DATA.AssetSnapshot || []).filter(function (s) { return s.entry_id === id; });
  closeWForm();
  var chain = deleteRow('NetWorthEntry', id);
  snaps.forEach(function (s) { chain = chain.then(function () { return deleteRow('AssetSnapshot', s.id, true); }); });
  chain.then(function () { toast('Account deleted'); });
}

export { ACCOUNT_TYPES, WEALTH_GROUPS, acctType, isLiab, isInv, accounts, isArchived, activeAccounts, txSavedInMonth, snapsByEntry, wealthOn, wealthNow, mkey, mDate, mNext, mEnd, mLong, mShort, mName, monthEnds, lastSnapshotDate, sgn0, wealthHTML, wealthChart, WFORM, closeWForm, monthDate, monthSnaps, openUpdate, loadRates, drawUpdate, saveUpdate, openAcct, drawAcct, readAcct, saveAcct, deleteAcct };
