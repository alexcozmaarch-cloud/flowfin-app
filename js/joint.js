// FlowFin · For the household: card purchases the joint account pays back (approved 23.11.2026).
// A purchase is "for the household" when it carries #joint, or it's a household-category purchase whose name you
// marked as "always for the household" (Nespresso…). Household refunds coming back are matched to those purchases:
// same amount within 21 days first, then oldest first. Unmatched refunds are listed to check (paid back twice?).
import { saveSetting } from './settings.js';
import { addDays, daysBetween, esc, fmtCHF, pd, roles, today, txs, ymd } from './core.js';
import { normDesc, recurringItems } from './recurring.js';
import { setting, tagsOf } from './transactions.js';

var MATCH_DAYS = 21;
function chf0(n) { return fmtCHF.format(Math.round((+n || 0) * 100) / 100); }   // cents matter here
function dm(d, y) { return d.getDate() + '.' + (d.getMonth() + 1) + '.' + (y ? d.getFullYear() : ''); }

function jsonSetting(k, d) { try { var v = setting(k, ''); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function alwaysList() { return jsonSetting('joint_always', []); }
function resolved() { return jsonSetting('joint_resolved', {}); }
function infraCat() { var r = roles(); return r.infra[0] || 'Family Infrastructure'; }
function isInfraCat(c) { var r = roles(); return r.infra.length ? r.infra.indexOf(c) > -1 : c === 'Family Infrastructure'; }
function firstWord(s) { return normDesc(String(s || '').replace(/\b(refund|rückerstattung|direct debit|lastschrift)\b/ig, '')).split(' ')[0] || ''; }
function hasJointTag(tx) { return tagsOf(tx).some(function (t) { return t.toLowerCase() === 'joint'; }); }

function isJointPurchase(tx, always) {
  if (tx.type !== 'expense') return false;
  if (hasJointTag(tx)) return true;
  if (!isInfraCat(tx.category)) return false;
  always = always || alwaysList();
  var w = firstWord(tx.description);
  return !!w && always.indexOf(w) > -1;
}
function isJointRefund(tx) { return tx.type === 'refund' && (hasJointTag(tx) || isInfraCat(tx.category)); }

// the whole picture: each purchase with how much came back, and refunds that matched nothing
function jointModel() {
  var always = alwaysList(), res = resolved(), t = today();
  var buys = txs().filter(function (tx) { return isJointPurchase(tx, always) && pd(tx.date) <= t; })
    .map(function (tx) { return { tx:tx, amount:+tx.amount || 0, back:0, refunds:[] }; })
    .sort(function (a, b) { return a.tx.date < b.tx.date ? -1 : 1; });
  var refs = txs().filter(function (tx) { return isJointRefund(tx) && pd(tx.date) <= t; })
    .map(function (tx) { return { tx:tx, amount:+tx.amount || 0, left:+tx.amount || 0 }; })
    .sort(function (a, b) { return a.tx.date < b.tx.date ? -1 : 1; });
  function open(b) { return b.amount - b.back > 0.004 && res[b.tx.id] !== 'settled'; }
  // 1 · the same amount, same shop word, within 21 days after (or 3 before) the purchase
  refs.forEach(function (r) {
    var w = firstWord(r.tx.description), d = pd(r.tx.date);
    var hit = buys.filter(function (b) { var g = daysBetween(pd(b.tx.date), d); return open(b) && Math.abs(b.amount - b.back - r.left) < 0.01 && g >= -3 && g <= MATCH_DAYS && (!w || firstWord(b.tx.description) === w || w === 'joint'); })[0]
      || buys.filter(function (b) { var g = daysBetween(pd(b.tx.date), d); return open(b) && Math.abs(b.amount - b.back - r.left) < 0.01 && g >= -3 && g <= MATCH_DAYS; })[0];
    if (hit) { hit.back += r.left; hit.refunds.push(r.tx); r.left = 0; }
  });
  // 2 · whatever is left pays off the oldest open purchases (a transfer covering several)
  refs.forEach(function (r) {
    if (r.left <= 0.004) return;
    buys.forEach(function (b) {
      if (r.left <= 0.004 || !open(b) || pd(b.tx.date) > addDays(pd(r.tx.date), 3)) return;
      var take = Math.min(r.left, b.amount - b.back); b.back += take; r.left -= take; b.refunds.push(r.tx);
    });
  });
  var openBuys = buys.filter(open).map(function (b) { b.due = b.amount - b.back; b.short = b.back > 0.004; b.days = daysBetween(pd(b.tx.date), t); return b; }).reverse();
  var extra = refs.filter(function (r) { return r.left > 0.004 && res[r.tx.id] !== 'ok'; }).reverse();
  // expected: household recurring payments marked "always", in the next 14 days
  var expected = [];
  try {
    recurringItems().forEach(function (it) {
      if ((it.status && it.status !== 'active') || it.type !== 'expense' || !it.next) return;
      if (always.indexOf(firstWord(it.name)) < 0) return;
      if (it.next <= t || it.next > addDays(t, 14)) return;
      expected.push({ name:it.name, amount:+it.amount || 0, d:it.next });
    });
  } catch (e) {}
  return { open:openBuys, extra:extra, expected:expected, total:openBuys.reduce(function (a, b) { return a + b.due; }, 0), always:always };
}

// ─── screens ─────────────────────────────────────────────────────────────────
function jointLineHTML() {
  var m = jointModel(); if (!m.open.length && !m.extra.length) return '';
  return '<button class="owedline" data-nav="owed"><svg class="ic" aria-hidden="true"><use href="#i-house"></use></svg><span><b>Joint owes you</b><small>' + m.open.length + ' open' +
    (m.extra.length ? ' · <span class="neg">' + m.extra.length + ' to check</span>' : '') + '</small></span><span class="num">' + chf0(m.total) + ' ›</span></button>';
}
function jointHTML() {
  var m = jointModel();
  if (!m.open.length && !m.extra.length && !m.expected.length) return '<section class="card"><h3>Joint owes you<span class="r">' + chf0(0) + '</span></h3>' +
    '<p class="soon" style="margin:0">Nothing open. When you pay for the family with your card, tap the house in the add form.</p></section>';
  var h = '<section class="card jt"><h3>Joint owes you<span class="r">' + m.open.length + ' open</span></h3>';
  h += m.open.map(function (b) {
    var w = firstWord(b.tx.description), always = m.always.indexOf(w) > -1;
    return '<div class="jt-row"><span class="d"><b>' + esc(b.tx.description) + '</b><small>' + dm(pd(b.tx.date)) + ' · ' +
      (b.short ? chf0(b.amount) + ' out, ' + chf0(b.back) + ' back' : (b.tx.account === 'credit_card' ? 'credit card' : 'debit card')) + (b.days > 30 ? ' · ' + b.days + ' days' : '') + '</small></span>' +
      '<span class="otag' + (b.short ? ' old' : '') + '">' + (b.short ? 'short' : 'open') + '</span><span class="num' + (b.short ? ' neg' : '') + '">' + chf0(b.due) + '</span>' +
      '<span class="jt-acts"><button class="linkbtn" data-act="jtsettle" data-id="' + esc(b.tx.id) + '">Settled</button>' +
      (w && !always && isInfraCat(b.tx.category) ? '<button class="linkbtn" data-act="jtalways" data-w="' + esc(w) + '">Always for the household</button>' : '') + '</span></div>';
  }).join('');
  h += m.expected.map(function (x) {
    return '<div class="jt-row"><span class="d"><b>' + esc(x.name) + '</b><small>' + dm(x.d) + ' · scheduled</small></span><span class="otag">expected</span><span class="num">' + chf0(x.amount) + '</span></div>';
  }).join('');
  h += '<div class="jt-row jt-tot"><b>Owed by the joint account</b><span></span><b class="num">' + chf0(m.total) + '</b></div>';
  if (m.total > 0.004) h += '<div class="bh-btns" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-act="jtpaid" data-v="' + m.total.toFixed(2) + '">Joint paid ' + chf0(m.total) + '</button>' +
    '<button class="btn" data-act="jtother">Paid a different amount</button></div>' +
    (UI.jtOther ? '<div class="jt-other"><input id="jtAmt" inputmode="decimal" placeholder="' + m.total.toFixed(2) + '" aria-label="Amount the joint account paid"><button class="btn primary" data-act="jtpaidother">Save</button></div>' : '');
  h += '<p class="chartnote" style="margin:10px 0 0">When a household refund arrives, FlowFin matches it to these by amount and date. “Joint paid” logs one refund for everything open.</p></section>';
  if (m.extra.length) {
    h += '<section class="card jt"><h3>Paid back twice or not matched<span class="r">' + m.extra.length + '</span></h3>' + m.extra.map(function (r) {
      return '<div class="jt-row"><span class="d"><b>' + esc(r.tx.description) + '</b><small>' + dm(pd(r.tx.date), true) + ' · ' +
        (r.left < r.amount - 0.004 ? chf0(r.left) + ' of ' + chf0(r.amount) + ' left over' : 'no purchase found') + '</small></span><span class="otag ok">+' + chf0(r.left) + '</span><span></span>' +
        '<span class="jt-acts"><button class="linkbtn" data-act="jtok" data-id="' + esc(r.tx.id) + '">It’s fine</button><button class="linkbtn" data-act="jtdel" data-id="' + esc(r.tx.id) + '">Delete (logged twice)</button></span></div>';
    }).join('') + '<p class="chartnote" style="margin:10px 0 0">Money that came back with no open purchase to match: logged twice, or the purchase is missing.</p></section>';
  }
  return h;
}
function jointRefundRow(amount) {
  return { date:ymd(today()), description:'Joint account transfer', category:infraCat(), subcategory:'General Household', amount:Math.round(amount * 100) / 100, type:'refund', account:'debit_card', tags:'joint' };
}
function setResolved(id, v) { var r = resolved(); r[id] = v; return saveSetting('joint_resolved', JSON.stringify(r)); }
function addAlways(w) { var l = alwaysList(); if (l.indexOf(w) < 0) l.push(w); return saveSetting('joint_always', JSON.stringify(l)); }

// quick add: the house button
function jointButtonHTML(F) {
  if (F.type !== 'expense') return '';
  var on = isJointPurchase(F);
  return '<label class="owebtn' + (on ? ' on' : '') + '" title="For the household: the joint account pays it back"><input type="checkbox" id="mjoint" aria-label="For the household"' + (on ? ' checked' : '') + '>' +
    '<svg class="ic" aria-hidden="true"><use href="#i-house"></use></svg></label>';
}
function jointNoteHTML(F) {
  return isJointPurchase(F) ? '<div class="field full owebox"><b class="owehead">For the household</b><span class="soon" style="font-size:12.5px">Counts as Household, not Personal. Stays on your card invoice. Waits for the joint account to pay it back.</span></div>' : '';
}
// switch on: household category (keeps a household subcategory if you had one) and #joint; off: back to what it was
function toggleJoint(F, on) {
  var tags = tagsOf(F).filter(function (t) { return t.toLowerCase() !== 'joint'; });
  if (on) {
    if (!isInfraCat(F.category)) { F._preJoint = { category:F.category, subcategory:F.subcategory }; F.category = infraCat(); F.subcategory = 'General Household'; }
    tags.push('joint');
  } else if (F._preJoint) { F.category = F._preJoint.category; F.subcategory = F._preJoint.subcategory; F._preJoint = null; }
  F.tags = tags.join(', ');
}

export { isJointPurchase, isJointRefund, jointModel, jointLineHTML, jointHTML, jointRefundRow, setResolved, addAlways, jointButtonHTML, jointNoteHTML, toggleJoint, firstWord };
