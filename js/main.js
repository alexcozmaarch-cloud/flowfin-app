// FlowFin · Entry point: delegated events and boot. Loaded by index.html after js/config.js.
// Shared settings and state (DATA, UI, _cache, CATEGORIES …) are globals from js/config.js.
import { markPaid, writeOff } from './owed.js';
import { normDesc, recurringItems } from './recurring.js';
import { forget, removeWithUndo, restore } from './bin.js';
import { setAnomaly } from './anomalies.js';
import { applyData, deleteRow, loadAll, post, saveRow } from './api.js';
import { LOCK_KEY, PLAN_CATS, planChange, planFit, planPaint, planSave, saveBudget } from './budgets.js';
import { netSavingsChart } from './charts.js';
import { $, apiUrl, calcTotals, esc, fmtCHF, lsGet, lsSet, periodAt, periodModel, toast, today, ymd } from './core.js';
import { COLL_KEY, DCHART_KEY, FOLD_KEY, PROJ_KEY, foldState, periodDay, savingsChart } from './dashboard.js';
import { GFORM, addFixed, closeGForm, deleteGoal, drawGoal, goalPeriods, openGoal, readGoal, recordContribs, saveGoal } from './goals.js';
import { importFiles } from './import.js';
import { draw, go } from './nav.js';
import { saveSetting } from './settings.js';
import { FORM, addCustomSub, autofill, fxInfo, searchWithout, closeModal, drawModal, filteredTx, hideSugg, openTx, paintSugg, pickSugg, readForm, recalcFx, ruleFromForm, saveForm, saveMany, splitRest, subsOf, suggestedRules, tagsOf } from './transactions.js';
import { WFORM, accounts, closeWForm, deleteAcct, drawAcct, isArchived, openAcct, openUpdate, readAcct, saveAcct, saveUpdate } from './wealth.js';

// ─── events (delegated) ───────────────────────────────────────────────────
document.addEventListener('click', function (e) {
  var n = e.target.closest('[data-nav]'); if (n) return go(n.getAttribute('data-nav'));
  var tx = e.target.closest('[data-tx]'); if (tx) return openTx(tx.getAttribute('data-tx'));
  var dr = e.target.closest('[data-drill]'); if (dr) return openDrill(dr);
  var ty = e.target.closest('[data-type]'); if (ty && FORM) { readForm(); FORM.type = ty.getAttribute('data-type'); return drawModal(); }
  var a = e.target.closest('[data-act]'); if (!a) return;
  var act = a.getAttribute('data-act');
  if (act === 'scrim' && e.target === a) return closeModal();
  if (act === 'prev') { UI.periodOffset--; return draw(); }
  if (act === 'next') { UI.periodOffset++; return draw(); }
  if (act === 'addtx') return openTx(null);
  if (act === 'cancel') return closeModal();
  if (act === 'save') return saveForm();
  if (act === 'del') { readForm(); FORM._confirmDelete = true; return drawModal(); }
  if (act === 'delno') { readForm(); FORM._confirmDelete = false; return drawModal(); }
  if (act === 'delyes') { var id = FORM.id, d = FORM.description; closeModal(); return removeWithUndo('“' + (d || 'Transaction') + '”', [['Transaction', id]]); }
  if (act === 'binrestore') return restore(a.getAttribute('data-key'));
  if (act === 'binforget') return forget(a.getAttribute('data-key'));
  if (act === 'saveurl') { lsSet(URL_KEY, $('surl').value.trim()); lsSet(KEY_KEY, $('skey').value.trim()); toast('Connection saved'); return loadAll(); }
  if (act === 'b44') {
    var bo = $('b44Out'); bo.textContent = 'Pulling from Base44…'; a.disabled = true;
    post({ action:'syncBase44' }).then(function (j) {
      var r = j.result; bo.innerHTML = '<span class="pos">Done.</span> ' + r.added + ' new, ' + r.updated + ' changed, ' + r.removed + ' removed.';
      return loadAll();
    }).catch(function (err) { bo.innerHTML = '<span class="neg">' + esc(err.message) + '</span>'; })
      .then(function () { var b = document.querySelector('[data-act=b44]'); if (b) b.disabled = false; });
    return;
  }
  if (act === 'reload') return loadAll();
  if (act === 'mkrule') return ruleFromForm();
  if (act === 'wupdate') return openUpdate(a.dataset.month);
  if (act === 'gnew') return openGoal(null);
  if (act === 'anf') { UI.anFilter = a.getAttribute('data-v'); return draw(); }
  if (act === 'uppaid') {        // log the late item as paid: the add form opens filled in
    var lu = (UI.upLate || [])[+a.getAttribute('data-i')]; if (!lu) return;
    var rr = lu.r; openTx(null);
    Object.assign(FORM, { description:rr.name, amount:Math.round(rr.amount * 100) / 100, type:rr.type || 'expense', category:rr.category || FORM.category, subcategory:rr.subcategory || FORM.subcategory, account:rr.account || FORM.account, date:ymd(today()) });
    return drawModal();
  }
  if (act === 'upskip') { var ls = (UI.upLate || [])[+a.getAttribute('data-i')]; if (!ls) return; return saveSetting(ls.skip, '1').then(function () { toast(ls.name + ': skipped for ' + periodDay(ls.d)); }); }
  if (act === 'gfix') return addFixed(a.getAttribute('data-id'));
  if (act === 'warch' || act === 'wunarch') {
    var aid = a.getAttribute('data-id'), ae = accounts().filter(function (x) { return x.id === aid; })[0]; if (!ae) return;
    var arc = isArchived(ae); if (act === 'warch') closeWForm();
    return saveSetting('acct_archived_' + aid, arc ? '' : '1').then(function () { toast(ae.name + (arc ? ' restored' : ' archived')); });
  }
  if (act === 'pllock') { var lk = a.getAttribute('data-k'); UI.plan.locks[lk] = !UI.plan.locks[lk]; try { lsSet(LOCK_KEY, JSON.stringify(UI.plan.locks)); } catch (e) {} return draw(); }
  if (act === 'plfit') { planFit(); return planPaint(); }
  if (act === 'plreset') { UI.plan = null; return draw(); }
  if (act === 'plsave') return planSave();
  if (act === 'dchart') { try { lsSet(DCHART_KEY, a.getAttribute('data-v')); } catch (e) {} if (CHARTS.daily) { CHARTS.daily.destroy(); delete CHARTS.daily; } return draw(); }
  if (act === 'sugg') return pickSugg(+a.getAttribute('data-i'));
  if (act === 'newsubadd') return addCustomSub();
  if (act === 'qmore' && FORM) { readForm(); FORM._quick = false; drawModal(); var c = $('mcat'); if (c) c.focus(); return; }
  if (act === 'newsubx') { readForm(); FORM._newsub = false; return drawModal(); }
  if (act === 'ftoggle') { UI.fOpen = !UI.fOpen; return draw(); }
  if (act === 'txtab') { UI.txTab = a.getAttribute('data-v'); window.scrollTo(0, 0); return draw(); }
  if (act === 'anset') return setAnomaly(a.getAttribute('data-id'), a.getAttribute('data-v'));
  if (act === 'gedit') return openGoal(a.getAttribute('data-id'));
  if (act === 'gscrim' && e.target === a) return closeGForm();
  if (act === 'gcancel') return closeGForm();
  if (act === 'gsave') return saveGoal();
  if (act === 'gdel') { readGoal(); GFORM.confirm = true; return drawGoal(); }
  if (act === 'gdelno') { readGoal(); GFORM.confirm = false; return drawGoal(); }
  if (act === 'gdelyes') return deleteGoal();
  if (act === 'grec') { a.disabled = true; return recordContribs(a.getAttribute('data-id'), [a.getAttribute('data-k')]); }
  if (act === 'grecall') {
    var gg = (DATA.FinancialGoal || []).filter(function (x) { return x.id === a.getAttribute('data-id'); })[0];
    a.disabled = true;
    return recordContribs(gg.id, goalPeriods(gg).map(function (x) { return x.key; }));
  }
  if (act === 'waddacct') return openAcct(null);
  if (act === 'weditacct') return openAcct(a.getAttribute('data-id'));
  if (act === 'wscrim' && e.target === a) return closeWForm();
  if (act === 'wcancel') return closeWForm();
  if (act === 'wsaveupdate') return saveUpdate();
  if (act === 'wsaveacct') return saveAcct();
  if (act === 'wdel') { readAcct(); WFORM.confirm = true; return drawAcct(); }
  if (act === 'wdelno') { readAcct(); WFORM.confirm = false; return drawAcct(); }
  if (act === 'wdelyes') return deleteAcct();
  if (act === 'projbasis') { lsSet(PROJ_KEY, a.getAttribute('data-v')); return draw(); }
  if (act === 'splitstart' && FORM) { readForm(); FORM._split = [{ category:FORM.category === 'Family Infrastructure' ? 'Personal Cash' : 'Family Infrastructure', subcategory:'', amount:'' }]; FORM._split[0].subcategory = subsOf(FORM._split[0].category)[0] || ''; drawModal(); var s0 = $('sp_a0'); if (s0) s0.focus(); return; }
  if (act === 'splitadd' && FORM) { readForm(); FORM._split.push({ category:'Personal Cash', subcategory:subsOf('Personal Cash')[0] || '', amount:'' }); return drawModal(); }
  if (act === 'splitdel' && FORM) { readForm(); FORM._split.splice(+a.getAttribute('data-i'), 1); if (!FORM._split.length) FORM._split = null; return drawModal(); }
  if (act === 'splitoff' && FORM) { readForm(); FORM._split = null; return drawModal(); }
  if (act === 'theme') { try { localStorage.setItem(THEME_KEY, a.getAttribute('data-v')); } catch (e) {} applyTheme(); return draw(); }
  if (act === 'fxcalc' && FORM) { FORM._chfManual = false; recalcFx(); var mi = $('mamt'); if (mi && FORM._calc != null) mi.value = FORM._calc.toFixed(2); return; }
  if (act === 'qdel') { UI.tx.q = searchWithout(UI.tx.q, +a.getAttribute('data-i')); draw(); var qi = $('fq'); if (qi) qi.focus(); return; }
  if (act === 'trendsort') { UI.trendSort = a.getAttribute('data-v'); return draw(); }
  if (act === 'owemode' && FORM) { readForm(); FORM._owe = FORM._owe || { on:true, mode:'half', amount:'', who:'', note:'' }; FORM._owe.mode = a.getAttribute('data-v'); drawModal(); var oa = $(FORM._owe.mode === 'other' ? 'moweamt' : 'mowho'); if (oa) oa.focus(); return; }
  if (act === 'pbmode' && FORM) { readForm(); FORM._pb = FORM._pb || { mode:'all', amount:'', date:ymd(today()), account:'debit_card' }; FORM._pb.mode = a.getAttribute('data-v'); drawModal(); var pa = $('mpbamt'); if (pa) pa.focus(); return; }
  if (act === 'owepaid' && FORM) { readForm(); var F1 = FORM; return markPaid(F1).then(function (r) { if (r && r.err) { F1._err = r.err; drawModal(); } else closeModal(); }); }
  if (act === 'owewriteoff' && FORM) { readForm(); var F2 = FORM; closeModal(); return writeOff(F2); }
  if (act === 'calday') { UI.calDay = a.getAttribute('data-d'); return draw(); }
  if (act === 'priceok' || act === 'priceonce') {
    var pk = a.getAttribute('data-key'), pname = a.getAttribute('data-name');
    var tr = act === 'priceok' ? (DATA.Subscription || []).filter(function (s) { return normDesc(s.name) === normDesc(pname); })[0] : null;
    return saveSetting(pk, '1').then(function () { return tr ? saveRow('Subscription', Object.assign({}, tr, { amount:+a.getAttribute('data-amt') })) : null; })
      .then(function () { toast(act === 'priceok' ? 'New price noted' : 'Treated as a one-off'); });
  }
  if (act === 'subkeep') return saveSetting('sub_ok_' + normDesc(a.getAttribute('data-name')), ymd(today())).then(function () { toast('Kept'); });
  if (act === 'subcancel') {
    var sname = a.getAttribute('data-name'), ts = (DATA.Subscription || []).filter(function (s) { return normDesc(s.name) === normDesc(sname); })[0];
    var sri = recurringItems().filter(function (r) { return r.name === sname; })[0] || {};
    return saveRow('Subscription', ts ? Object.assign({}, ts, { status:'cancelled' }) : { name:sname, amount:sri.amount || 0, frequency:sri.frequency || 'monthly', account:sri.account || '', category:sri.category || '', subcategory:sri.subcategory || '',
      next_renewal:'', status:'cancelled', notes:'', auto_detected:true }).then(function () { toast(sname + ' marked as cancelled'); });
  }
  if (act === 'rtrack') {
    var ri = recurringItems()[+a.getAttribute('data-i')]; if (!ri) return;
    return saveRow('Subscription', { name:ri.name, amount:ri.amount, frequency:ri.frequency, account:ri.account, category:ri.category, subcategory:ri.subcategory,
      next_renewal:ri.next ? ymd(ri.next) : '', status:'active', notes:'', auto_detected:true }).then(function () { toast('Tracking ' + ri.name); });
  }
  if (act === 'tagfilter') { UI.tx.tag = a.getAttribute('data-tag'); UI.tx.scope = 'all'; return draw(); }
  if (act === 'bulktag') {
    var tg = String($('bulktag').value || '').replace(/,/g, ' ').trim();
    if (!tg) { toast('Type a tag first'); return; }
    var rows = filteredTx().filter(function (t) { return tagsOf(t).indexOf(tg) < 0; }).map(function (t) { return Object.assign({}, t, { tags:tagsOf(t).concat([tg]).join(', ') }); });
    if (!rows.length) { toast('All shown already have #' + tg); return; }
    return saveMany('Transaction', rows).then(function () { toast('#' + tg + ' added to ' + rows.length + ' transactions'); });
  }
  if (act === 'radd') {
    var mt = String($('rmatch').value || '').trim(); if (!mt) { toast('Type the text to match'); return; }
    var cs = $('rcs').value.split('|');
    return saveRow('Rule', { match:mt, category:cs[0], subcategory:cs[1] || '', type:$('rtype').value, account:$('racct').value, tags:String($('rtags').value || '').trim(), priority:100 })
      .then(function () { toast('Rule added for “' + mt + '”'); });
  }
  if (act === 'rdel') { var rr = (DATA.Rule || []).filter(function (x) { return x.id === a.getAttribute('data-id'); })[0]; return removeWithUndo('Rule “' + (rr ? rr.match : '') + '”', [['Rule', a.getAttribute('data-id')]]); }
  if (act === 'rsugg' || act === 'rsuggall') {
    var sg = suggestedRules().slice(0, 15), pick = act === 'rsugg' ? [sg[+a.getAttribute('data-i')]] : sg;
    var newRules = pick.filter(Boolean).map(function (r) { return { match:r.match, category:r.category, subcategory:r.subcategory, type:r.type, account:r.account, tags:'', priority:100 }; });
    return saveMany('Rule', newRules).then(function () { toast(newRules.length + ' rule' + (newRules.length === 1 ? '' : 's') + ' added'); });
  }
  if (act === 'savefee') {
    var fv = parseFloat($('sfee').value); if (!(fv >= 0)) { toast('Enter the fee as a number, e.g. 1.75'); return; }
    return saveSetting('card_fee_pct', fv).then(function () { toast('Card fee set to ' + fv + '%'); });
  }
  if (act === 'collmode') { lsSet(COLL_KEY, a.getAttribute('data-v')); return draw(); }
  if (act === 'clearf') { UI.tx = { scope:'period', q:'', type:'', category:'', account:'', sub:'', from:'', to:'', tag:'', dayToDay:false }; return draw(); }
  if (act === 'bsave') {
    var v = parseFloat(String($('blim' + a.getAttribute('data-i')).value).replace(',', '.'));
    if (!(v >= 0)) { toast('Enter the limit as a positive number'); return; }
    var cat = a.getAttribute('data-cat');
    return saveBudget(cat, { monthly_limit: Math.round(v * 100) / 100 }).then(function () { toast(cat + ' limit saved'); });
  }
  if (act === 'ping') {
    var out = $('pingOut'); out.textContent = 'Testing…';
    fetch(apiUrl() + '?action=ping').then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { out.innerHTML = '<span class="neg">' + esc(j.error) + '</span>'; return; }
        var b = j.base44 ? ' Last Base44 pull: ' + new Date(j.base44.at).toLocaleString('en-GB') + ' (' + j.base44.added + ' new, ' + j.base44.updated + ' changed, ' + j.base44.removed + ' removed).' : ' No Base44 pull yet.';
        out.innerHTML = '<span class="pos">Connected.</span>' + esc(b);
      })
      .catch(function (err) { out.innerHTML = '<span class="neg">Could not connect: ' + esc(err.message) + '</span>'; });
  }
});
function openDrill(el) {
  var f = {}; try { f = JSON.parse(el.getAttribute('data-drill')); } catch (err) {}
  UI.tx = { scope:f.scope || 'period', q:'', type:'', category:f.category || '', account:f.account || '', sub:f.sub || '', from:f.from || '', to:f.to || '', tag:'', dayToDay:!!f.dayToDay };
  go('transactions');
}
document.addEventListener('toggle', function (e) {
  var d = e.target; if (!d.matches || !d.matches('details[data-fold]')) return;
  var st = foldState(); st[d.getAttribute('data-fold')] = d.open; lsSet(FOLD_KEY, JSON.stringify(st));
  if (d.open) { savingsChart(); netSavingsChart(); }
}, true);
document.addEventListener('pointerdown', function (e) { if (e.target.closest && e.target.closest('#msugg')) e.preventDefault(); });   // keep focus in the description while picking
// leaving the description (tapping the next field, the keyboard arrows, anywhere else) closes the suggestions
document.addEventListener('focusout', function (e) {
  if (e.target.id !== 'mdesc') return;
  setTimeout(function () { var a = document.activeElement; if (!(a && a.closest && a.closest('#msugg'))) hideSugg(); }, 180);
});
document.addEventListener('keydown', function (e) {
  if (e.target.id === 'mdesc' && $('msugg') && !$('msugg').hidden && UI.sugg && UI.sugg.length) {
    var nb = UI.sugg.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); UI.suggHl = ((UI.suggHl == null ? -1 : UI.suggHl) + (e.key === 'ArrowDown' ? 1 : -1) + nb) % nb;
      Array.prototype.forEach.call($('msugg').children, function (b, i) { b.classList.toggle('hl', i === UI.suggHl); }); $('mdesc').setAttribute('aria-activedescendant', 'msg' + UI.suggHl); return; }
    if (e.key === 'Enter' && UI.suggHl > -1) { e.preventDefault(); return pickSugg(UI.suggHl); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideSugg(); return; }
    if (e.key === 'Enter') { e.preventDefault(); hideSugg(); return; }   // phone “return”: close the list, keep what was typed
  }
  if (e.target.id === 'mnewsub' && e.key === 'Enter') { e.preventDefault(); return addCustomSub(); }
  if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-drill]')) openDrill(e.target);
  if (e.key === 'Escape' && FORM) closeModal();
  if (e.key === 'Escape' && WFORM) closeWForm();
  if (e.key === 'Escape' && GFORM) closeGForm();
  if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-act=weditacct]')) openAcct(e.target.getAttribute('data-id'));
  if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-tx]')) openTx(e.target.getAttribute('data-tx'));
});
document.addEventListener('input', function (e) {
  var pid = e.target.id || '';
  if (pid === 'mdesc' && FORM && !FORM.id) { FORM._picked = false; return paintSugg(); }
  if (/^pl_[vr]\d$/.test(pid) && UI.plan) { planChange(PLAN_CATS[+pid.slice(4)], parseFloat(String(e.target.value).replace(',', '.'))); return planPaint(); }
  if (pid === 'pl_fam' && UI.plan) { UI.plan.fam = Math.max(0, parseFloat(e.target.value) || 0); planFit(); return planPaint(); }
  var id = e.target.id;
  if (id === 'morig' && FORM) { recalcFx(); return; }
  if (id === 'mamt' && FORM && FORM.orig_currency && FORM.orig_currency !== 'CHF') { FORM._chfManual = String(e.target.value).trim() !== ''; FORM.amount = e.target.value; var fi = $('mfxinfo'); if (fi) fi.innerHTML = fxInfo(); }
  if (FORM && FORM._split && (/^sp_a\d+$/.test(id) || id === 'mamt')) { readForm(); var sr = $('sprest'); if (sr) { var rv = splitRest(); sr.textContent = fmtCHF.format(rv); sr.className = 'num' + (rv < 0 ? ' neg' : ''); } }
  if (id.indexOf('wr_') === 0) e.target.dataset.touched = '1';
  if (id === 'fq') { UI.tx.q = e.target.value; var pos = e.target.selectionStart; draw(); var q = $('fq'); q.focus(); q.setSelectionRange(pos, pos); }
});
document.addEventListener('change', function (e) {
  var id = e.target.id;
  if (FORM && /^sp_c\d+$/.test(id)) { readForm(); return drawModal(); }
  if (id === 'fscope') { UI.tx.scope = e.target.value; draw(); }
  if (id === 'ftype') { UI.tx.type = e.target.value; draw(); }
  if (id === 'fcat') { UI.tx.category = e.target.value; draw(); }
  if (id === 'facct') { UI.tx.account = e.target.value; draw(); }
  if (id === 'ftag') { UI.tx.tag = e.target.value; draw(); }
  if (id === 'importFiles' && e.target.files && e.target.files.length) importFiles(e.target.files);
  if (e.target.matches && e.target.matches('[data-act=rstatus]')) {
    var sid = e.target.getAttribute('data-id'), st = e.target.value, srow = (DATA.Subscription || []).filter(function (x) { return x.id === sid; })[0];
    if (srow) saveRow('Subscription', Object.assign({}, srow, { status:st })).then(function () { toast(srow.name + ': ' + st); });
  }
  if (id === 'mowe' && FORM) { readForm(); drawModal(); var wh = $('mowho'); if (wh && FORM._owe && FORM._owe.on) wh.focus(); return; }
  if (id === 'mcur' && FORM) {
    var wasCHF = FORM.orig_currency !== e.target.value && (!FORM.orig_currency || FORM.orig_currency === 'CHF');
    readForm(); FORM._rate = null; FORM._rateErr = ''; FORM._calc = null;
    if (wasCHF && FORM.orig_currency !== 'CHF') {          // the number you typed was in the new currency: move it to "Amount paid"
      if (!(parseFloat(FORM.orig_amount) > 0) && parseFloat(FORM.amount) > 0) FORM.orig_amount = FORM.amount;
      FORM.amount = ''; FORM._chfManual = false; FORM._fee = false;
    }
    if (FORM.orig_currency === 'CHF') { FORM._chfManual = false; FORM.orig_amount = ''; }
    drawModal(); recalcFx();
    var oe = $(FORM.orig_currency !== 'CHF' ? 'morig' : 'mamt'); if (oe) oe.focus();
  }
  if ((id === 'mfee' || id === 'mdate' || id === 'macct') && FORM && FORM.orig_currency !== 'CHF') recalcFx();
  if (e.target.matches && e.target.matches('[data-act=broll]')) {
    var bc = e.target.getAttribute('data-cat'), on = e.target.checked;
    saveBudget(bc, { rollover_enabled: on }).then(function () { toast('Rollover ' + (on ? 'on' : 'off') + ' for ' + bc); });
  }
  if (id === 'mcat' && FORM) { readForm(); FORM.subcategory = subsOf(FORM.category)[0] || ''; FORM._newsub = false; drawModal(); }
  if (id === 'msub' && FORM && e.target.value === '__new') { readForm(); FORM._newsub = true; drawModal(); var ns = $('mnewsub'); if (ns) ns.focus(); return; }
  if (id === 'mdesc' && FORM) autofill();
});
// the phone switches between day and dark: redraw so the charts pick up the new colours
if (window.matchMedia) { var mq = matchMedia('(prefers-color-scheme: dark)'), onScheme = function () { applyTheme(); if (themePref() === 'auto') draw(); };
  if (mq.addEventListener) mq.addEventListener('change', onScheme); else if (mq.addListener) mq.addListener(onScheme); }
window.addEventListener('hashchange', function () { var h = location.hash.slice(1); if (h === 'add') { try { history.replaceState(null, '', '#' + UI.page); } catch (e) {} return openTx(null); } if (h && h !== UI.page) { UI.page = h; draw(); } });

// ─── boot ─────────────────────────────────────────────────────────────────
var h0 = location.hash.slice(1), wantAdd = h0 === 'add';
if (wantAdd) { h0 = 'dashboard'; try { history.replaceState(null, '', '#dashboard'); } catch (e) {} }
if (h0) UI.page = h0;
try { _cache = JSON.parse(lsGet(CACHE_KEY)); } catch (e) { _cache = null; }
if (_cache && _cache.data) { applyData(_cache.data); UI.lastSync = new Date(_cache.at); }
draw();
if (wantAdd) openTx(null);
loadAll();

if ('serviceWorker' in navigator && location.protocol === 'https:') { try { navigator.serviceWorker.register('sw.js', { updateViaCache:'none' }).then(function (r) { if (r) r.update(); }).catch(function () {}); } catch (e) {} }

// exposed for the diagnostic check only
window.FF = { periodModel:periodModel, calcTotals:calcTotals, periodAt:periodAt, applyData:applyData, DATA:DATA };

export { openDrill, wantAdd };
