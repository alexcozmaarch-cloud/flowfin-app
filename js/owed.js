// FlowFin · To be paid back. You pay for someone; the full amount counts as spent now (it left your account).
// Who owes what is kept in the Settings tab (key owed_<transaction id>). When they pay back, the repayment is saved
// as a refund in the same category, so in the end only your share counts. The transaction carries the tag
// #owed while open, then #paid-back or #written-off.
import { saveRow } from './api.js';
import { $, daysBetween, esc, fmtCHF, pd, today, toast, txs, ymd } from './core.js';
import { periodDay, sw } from './dashboard.js';
import { topbar } from './nav.js';
import { saveSetting } from './settings.js';
import { ico, setting, tagsOf } from './transactions.js';

var OWED_OLD_DAYS = 30, PENDING_KEY = 'ff_owed_pending_v1';
function r2(n) { return Math.round((+n || 0) * 100) / 100; }
function owedRecord(txId) { try { return JSON.parse(setting('owed_' + txId, '') || 'null'); } catch (e) { return null; } }
function owedItems() {
  var byId = {}; txs().forEach(function (t) { byId[t.id] = t; });
  return (DATA.Settings || []).filter(function (s) { return /^owed_/.test(s.key || ''); }).map(function (s) {
    var rec; try { rec = JSON.parse(s.value); } catch (e) { return null; }
    var tx = byId[s.key.slice(5)]; if (!tx || !rec) return null;
    var paid = (rec.paid || []).reduce(function (a, p) { return a + (+p.amount || 0); }, 0);
    return { tx:tx, rec:rec, paid:r2(paid), left:r2((+rec.amount || 0) - paid), days:daysBetween(pd(tx.date), today()) };
  }).filter(Boolean);
}
function openOwed() { return owedItems().filter(function (x) { return x.rec.status === 'open' && x.left > 0.004; }).sort(function (a, b) { return a.tx.date < b.tx.date ? -1 : 1; }); }
function people() { var s = {}; owedItems().forEach(function (x) { if (x.rec.who) s[x.rec.who] = 1; }); return Object.keys(s).sort(); }

// ─── In the add / edit form ─────────────────────────────────────────────────
// quick add: the tick box is a small button beside the tags (oweButtonHTML) and only the details show here
function oweButtonHTML(F) {
  if (F.type !== 'expense' || (F.id && owedRecord(F.id))) return '';
  var on = !!(F._owe && F._owe.on);
  return '<label class="owebtn' + (on ? ' on' : '') + '" title="Someone owes me part of this"><input type="checkbox" id="mowe" aria-label="Someone owes me part of this"' + (on ? ' checked' : '') + '>' +
    '<svg class="ic" aria-hidden="true"><use href="#i-hand-coins"></use></svg></label>';
}
function oweBoxHTML(F, quick) {
  if (F.type !== 'expense') return '';
  var rec = F.id ? owedRecord(F.id) : null;
  if (rec) return owedStatusHTML(F, rec);
  var o = F._owe || { on:false, mode:'half', amount:'', who:'', note:'' };
  var amt = parseFloat(String(F.amount).replace(',', '.')) || 0;
  if (!o.on) return quick ? '' : '<div class="field full"><label class="switch owechk" style="min-height:0"><input type="checkbox" id="mowe"><span>Someone owes me part of this</span></label></div>';
  return '<div class="field full owebox">' + (quick ? '<b class="owehead">Someone owes me part of this</b>' : '<label class="switch owechk" style="min-height:0"><input type="checkbox" id="mowe" checked><span>Someone owes me part of this</span></label>') +
    '<div class="seg3 owemode" role="radiogroup" aria-label="How much">' + [['half', 'Half · ' + fmtCHF.format(amt / 2)], ['all', 'All · ' + fmtCHF.format(amt)], ['other', 'Other…']].map(function (x) {
      return '<button type="button" role="radio" aria-checked="' + (o.mode === x[0]) + '" class="' + (o.mode === x[0] ? 'on' : '') + '" data-act="owemode" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
    (o.mode === 'other' ? '<input id="moweamt" type="number" inputmode="decimal" step="0.01" min="0" placeholder="Amount owed" aria-label="Amount owed" value="' + esc(o.amount) + '">' : '') +
    '<label for="mowho">Who</label><input id="mowho" list="owePeople" autocomplete="off" placeholder="Name" value="' + esc(o.who) + '">' +
    '<datalist id="owePeople">' + people().map(function (p) { return '<option value="' + esc(p) + '">'; }).join('') + '</datalist>' +
    '<label for="monote">Note (optional)</label><input id="monote" autocomplete="off" placeholder="e.g. TWINT next week" value="' + esc(o.note) + '">' +
    '<small class="soon">The full amount counts as spent now. When it’s paid back, it’s recorded as a refund here.</small></div>';
}
function owedStatusHTML(F, rec) {
  var it = owedItems().filter(function (x) { return x.tx.id === F.id; })[0]; if (!it) return '';
  if (rec.status !== 'open' || it.left <= 0.004) {
    return '<div class="field full owebox done"><b>' + (rec.status === 'written-off' ? 'Written off' : 'Paid back') + '</b><small class="soon">' + esc(rec.who || 'Someone') + ' owed ' + fmtCHF.format(rec.amount) +
      (it.paid ? '; paid back ' + fmtCHF.format(it.paid) : '') + (rec.note ? ' · “' + esc(rec.note) + '”' : '') + '</small></div>';
  }
  var pb = F._pb || { mode:'all', amount:'', date:ymd(today()), account:'debit_card' };
  return '<div class="field full owebox"><b>' + esc(rec.who || 'Someone') + ' owes you ' + fmtCHF.format(it.left) + '</b>' +
    '<small class="soon">' + (it.paid ? fmtCHF.format(it.paid) + ' already paid back · ' : '') + (it.days === 0 ? 'since today' : it.days + ' day' + (it.days === 1 ? '' : 's')) + (rec.note ? ' · “' + esc(rec.note) + '”' : '') + '</small>' +
    '<div class="seg3 owemode" role="radiogroup" aria-label="How much came back">' + [['all', 'All · ' + fmtCHF.format(it.left)], ['part', 'Part…']].map(function (x) {
      return '<button type="button" role="radio" aria-checked="' + (pb.mode === x[0]) + '" class="' + (pb.mode === x[0] ? 'on' : '') + '" data-act="pbmode" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
    (pb.mode === 'part' ? '<input id="mpbamt" type="number" inputmode="decimal" step="0.01" min="0" placeholder="Amount paid back" aria-label="Amount paid back" value="' + esc(pb.amount) + '">' : '') +
    '<div class="owe2"><span><label for="mpbdate">When</label><input id="mpbdate" type="date" value="' + esc(pb.date) + '"></span>' +
    '<span><label for="mpbacct">Into</label><select id="mpbacct">' + [['debit_card', 'Account / TWINT'], ['credit_card', 'Credit card'], ['cash', 'Cash']].map(function (x) { return '<option value="' + x[0] + '"' + (pb.account === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></span></div>' +
    '<div class="owebtns"><button type="button" class="btn" data-act="owewriteoff">Write off</button><button type="button" class="btn primary" data-act="owepaid">Paid back</button></div></div>';
}
function readOwe(F) {
  var c = $('mowe'); if (c) { F._owe = F._owe || { on:false, mode:'half', amount:'', who:'', note:'' }; F._owe.on = c.checked; }
  if (F._owe) { var a = $('moweamt'), w = $('mowho'), n = $('monote'); if (a) F._owe.amount = a.value; if (w) F._owe.who = w.value; if (n) F._owe.note = n.value; }
  if ($('mpbdate')) { F._pb = F._pb || { mode:'all', amount:'', date:ymd(today()), account:'debit_card' }; F._pb.date = $('mpbdate').value; F._pb.account = $('mpbacct').value; if ($('mpbamt')) F._pb.amount = $('mpbamt').value; }
}
// called by the form's save; returns an error text or '' and leaves the record for afterSave
function oweToSave(F, total) {
  var o = F._owe; if (!o || !o.on || (F.id && owedRecord(F.id))) return { err:'', rec:null };
  var amt = o.mode === 'all' ? total : o.mode === 'half' ? r2(total / 2) : r2(parseFloat(String(o.amount).replace(',', '.')));
  if (!(amt > 0)) return { err:'Enter how much is owed.' };
  if (amt > total + 0.004) return { err:'The amount owed is more than what you paid.' };
  if (!String(o.who || '').trim()) return { err:'Add who owes you.' };
  return { err:'', rec:{ amount:amt, who:String(o.who).trim(), note:String(o.note || '').trim(), status:'open', paid:[], at:ymd(today()) } };
}
function withTag(tags, add, drop) { var t = tagsOf({ tags:tags }).filter(function (g) { return drop.indexOf(g) < 0; }); if (add && t.indexOf(add) < 0) t.push(add); return t.join(', '); }
function afterSave(saved, rec) {
  if (!rec || !saved) return Promise.resolve();
  if (/^tmp-/.test(saved.id)) {   // no signal: remember it here and attach it once the transaction has reached the Sheet
    var list = []; try { list = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch (e) {}
    list.push({ date:saved.date, description:saved.description, amount:+saved.amount, rec:rec });
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(list)); } catch (e) {}
    return Promise.resolve();
  }
  return saveSetting('owed_' + saved.id, JSON.stringify(rec));
}
// on every load: attach owed notes made without signal to their (now saved) transactions
function attachPending() {
  var list = []; try { list = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch (e) {}
  if (!list.length) return Promise.resolve();
  var left = [], chain = Promise.resolve();
  list.forEach(function (p) {
    var tx = txs().filter(function (t) { return !/^tmp-/.test(t.id) && String(t.date).slice(0, 10) === p.date && t.description === p.description && Math.abs((+t.amount || 0) - p.amount) < 0.005; })[0];
    if (tx && !owedRecord(tx.id)) chain = chain.then(function () { return saveSetting('owed_' + tx.id, JSON.stringify(p.rec)); }); else if (!tx) left.push(p);
  });
  return chain.then(function () { try { localStorage.setItem(PENDING_KEY, JSON.stringify(left)); } catch (e) {} });
}
function markPaid(F) {
  var rec = owedRecord(F.id), it = owedItems().filter(function (x) { return x.tx.id === F.id; })[0]; if (!rec || !it) return Promise.resolve({ err:'' });
  var pb = F._pb || { mode:'all', date:ymd(today()), account:'debit_card' };
  var amt = pb.mode === 'part' ? r2(parseFloat(String(pb.amount).replace(',', '.'))) : it.left;
  if (!(amt > 0)) return Promise.resolve({ err:'Enter how much was paid back.' });
  if (amt > it.left + 0.004) return Promise.resolve({ err:'That’s more than ' + (rec.who || 'they') + ' owes (' + fmtCHF.format(it.left) + ').' });
  var tx = it.tx, refund = { date:pb.date || ymd(today()), description:'Paid back by ' + (rec.who || 'someone') + ' · ' + tx.description, category:tx.category, subcategory:tx.subcategory || '',
    amount:amt, type:'refund', account:pb.account || 'debit_card', anomaly_status:'', tags:'owed-back' };
  return saveRow('Transaction', refund).then(function (saved) {
    rec.paid = (rec.paid || []).concat([{ date:refund.date, amount:amt, refund:saved && saved.id }]);
    var done = amt >= it.left - 0.004; if (done) rec.status = 'paid';
    return saveSetting('owed_' + tx.id, JSON.stringify(rec)).then(function () {
      return done ? saveRow('Transaction', Object.assign({}, tx, { tags:withTag(tx.tags, 'paid-back', ['owed']) })) : null;
    }).then(function () { toast(done ? (rec.who || 'Someone') + ' paid back ' + fmtCHF.format(amt) + ' · settled' : fmtCHF.format(amt) + ' paid back · ' + fmtCHF.format(it.left - amt) + ' still owed'); return { err:'' }; });
  });
}
function writeOff(F) {
  var rec = owedRecord(F.id), tx = txs().filter(function (t) { return t.id === F.id; })[0]; if (!rec || !tx) return Promise.resolve();
  rec.status = 'written-off';
  return saveSetting('owed_' + tx.id, JSON.stringify(rec)).then(function () { return saveRow('Transaction', Object.assign({}, tx, { tags:withTag(tx.tags, 'written-off', ['owed']) })); })
    .then(function () { toast('Written off: the full amount stays as your cost'); });
}

// ─── Home line and the Owed page ────────────────────────────────────────────
function owedLineHTML() {
  var o = openOwed(); if (!o.length) return '';
  var total = o.reduce(function (a, x) { return a + x.left; }, 0), who = {}; o.forEach(function (x) { who[x.rec.who] = 1; });
  var n = Object.keys(who).length, oldest = o.reduce(function (m, x) { return Math.max(m, x.days); }, 0);
  return '<button class="owedline" data-nav="owed">' + ico('hand-coins') + '<span><b>Owed to you</b><small>' + n + ' ' + (n === 1 ? 'person' : 'people') + ' · oldest ' + oldest + ' day' + (oldest === 1 ? '' : 's') +
    (oldest > OWED_OLD_DAYS ? ' · <span class="neg">over ' + OWED_OLD_DAYS + ' days</span>' : '') + '</small></span><span class="num">' + sw(total) + ' ›</span></button>';
}
function owedHTML() {
  var all = owedItems().sort(function (a, b) { return a.tx.date < b.tx.date ? 1 : -1; }), open = all.filter(function (x) { return x.rec.status === 'open' && x.left > 0.004; });
  var done = all.filter(function (x) { return open.indexOf(x) < 0; }).slice(0, 10), total = open.reduce(function (a, x) { return a + x.left; }, 0);
  var row = function (x) {
    var st = x.rec.status === 'written-off' ? 'written off' : x.rec.status === 'open' && x.left > 0.004 ? '' : 'paid back';
    return '<div class="tx" data-tx="' + esc(x.tx.id) + '" tabindex="0" role="button"><span class="d"><b>' + esc(x.rec.who || 'Someone') + (st ? ' <span class="otag ok">' + st + '</span>' : x.days > OWED_OLD_DAYS ? ' <span class="otag old">' + x.days + ' days</span>' : '') + '</b>' +
      '<small>' + esc(x.tx.description) + ' · ' + periodDay(pd(x.tx.date)) + (x.rec.note ? ' · “' + esc(x.rec.note) + '”' : '') + (x.paid && x.left > 0.004 ? ' · ' + fmtCHF.format(x.paid) + ' paid back' : '') + '</small></span>' +
      '<span class="a">' + fmtCHF.format(st ? x.rec.amount : x.left) + '</span></div>';
  };
  return topbar('Owed to you', false) +
    '<section class="card"><h3>Still owed<span class="r">' + sw(total) + '</span></h3>' + (open.length ? '<div class="txlist">' + open.map(row).join('') + '</div>' :
      '<p class="soon" style="margin:0">Nobody owes you anything. When you pay for someone, tick “Someone owes me part of this” in the add form.</p>') +
    '<p class="chartnote" style="margin:10px 0 0">Tap one to mark it paid back or write it off. Anything owed for more than ' + OWED_OLD_DAYS + ' days is marked.</p></section>' +
    (done.length ? '<section class="card"><h3>Settled<span class="r">last ' + done.length + '</span></h3><div class="txlist">' + done.map(row).join('') + '</div></section>' : '');
}

export { owedRecord, owedItems, openOwed, oweBoxHTML, oweButtonHTML, readOwe, oweToSave, afterSave, attachPending, markPaid, writeOff, owedLineHTML, owedHTML };
