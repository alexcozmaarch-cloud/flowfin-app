// FlowFin · Talking to the Apps Script backend (never set a Content-Type header — Holotrack rule).
// Shared settings and state (DATA, UI, _cache, CATEGORIES …) are globals from js/config.js.
import { $, apiKey, apiUrl, esc, lsGet, lsSet, toast } from './core.js';
import { repairContribs } from './goals.js';
import { runJobs } from './jobs.js';
import { draw } from './nav.js';

// ─── network (never set a Content-Type header — Holotrack rule) ───────────
function setSync(state, msg) { UI.sync = state; UI.syncMsg = msg || ''; var el = $('syncState'); if (el) el.outerHTML = syncHTML(); }
function syncHTML() {
  var cls = UI.sync === 'ok' ? 'ok' : UI.sync === 'busy' ? 'busy' : UI.sync === 'err' ? 'err' : '';
  var n = outbox().length;
  var txt = UI.sync === 'busy' ? 'Syncing…' : n ? n + ' waiting to sync' : UI.sync === 'err' ? (UI.syncMsg || 'Offline') :
    UI.lastSync ? 'Synced ' + UI.lastSync.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }) : 'Not synced';
  if (n && cls !== 'busy') cls = 'err';
  return '<span class="sync" id="syncState" title="' + esc(UI.syncMsg) + '"><i class="dot ' + cls + '"></i>' + esc(txt) + '</span>';
}
function loadAll() {
  setSync('busy');
  return flushOutbox().catch(function () {}).then(readAll).then(function (j) {
    if (!j.ok) throw new Error(j.error || 'Backend error');
    applyData(j.data);
    keepWaiting();
    _cache = { data:DATA, at:Date.now() };
    lsSet(CACHE_KEY, JSON.stringify(_cache));
    UI.lastSync = new Date();
    setSync('ok');
    draw();
    repairDuplicates();
    repairContribs();
    runJobs();
  }).catch(function (e) {
    setSync('err', /access key/i.test(e.message) ? 'Add your access key in Settings' : 'Could not reach the Sheet: ' + e.message);
    if (/access key/i.test(e.message) && UI.page !== 'settings') { UI.page = 'settings'; draw(); }
  });
}
// When the Sheet already has rows this phone is still waiting to send, keep showing the local versions
function keepWaiting() {
  outbox().forEach(function (op) {
    var arr = DATA[op.table] = DATA[op.table] || [];
    var id = op.action === 'delete' ? op.id : op.row.id, i = arr.findIndex(function (r) { return r.id === id; });
    if (op.action === 'delete') { if (i > -1) arr.splice(i, 1); }
    else if (i > -1) arr[i] = op.row; else arr.push(op.row);
  });
}
function post(body) {
  body.key = apiKey();
  return fetch(apiUrl(), { method:'POST', body:JSON.stringify(body) })
    .catch(function (e) { var err = new Error('no connection'); err.offline = true; throw err; })
    .then(function (r) { return r.json(); })
    .then(function (j) { if (!j.ok) throw new Error(j.error || 'Save failed'); return j; });
}
// Read everything. The key goes in the request body, not the address; a backend from before 10.11.2026
// doesn't know "readAll" yet, so then the old way (key in the address) is used.
function readAll() {
  return post({ action:'readAll' }).catch(function (e) {
    if (e.offline || !/Unknown (table|action)/i.test(e.message)) throw e;
    return fetch(apiUrl() + '?key=' + encodeURIComponent(apiKey())).then(function (r) { return r.json(); });
  });
}
function applyData(d) {
  TABLES.forEach(function (t) { DATA[t] = (d && d[t]) || []; });
  UI.catTable = !!(d && Array.isArray(d.Category));
  applyCategories();
  var sd = (DATA.Settings || []).filter(function (s) { return s.key === 'period_start_day'; })[0];
  if (sd && +sd.value >= 1 && +sd.value <= 28) START_DAY = +sd.value;
}
function persistCache() { _cache = { data:DATA, at:Date.now() }; lsSet(CACHE_KEY, JSON.stringify(_cache)); }

var PENDING = {};   // temporary id → promise of the saved row, so a quick second edit updates instead of duplicating
function saveRow(table, row) {
  if (table === 'Transaction' && row.id && queued(row.id)) return queueSave(table, row);   // still waiting: update the waiting copy
  if (row.id && /^tmp-/.test(row.id) && PENDING[row.id]) {
    return PENDING[row.id].then(function (real) { return saveRow(table, Object.assign({}, row, { id:real.id, created_date:real.created_date })); });
  }
  var isNew = !row.id || /^tmp-/.test(row.id);
  var tmpId = isNew ? ('tmp-' + Date.now() + Math.floor(Math.random() * 1000)) : row.id;
  var arr = DATA[table] = DATA[table] || [];
  var oldId = row.id, idx = arr.findIndex(function (r) { return r.id === (oldId || tmpId); });
  var before = idx > -1 ? arr[idx] : null;
  var local = Object.assign({}, row, { id: tmpId });
  if (idx > -1) arr[idx] = local; else arr.push(local);
  draw();
  setSync('busy');
  var send = Object.assign({}, row); if (isNew) delete send.id;
  var p = post({ action:'upsert', table:table, row:send }).then(function (j) {
    if (!j || !j.row) throw new Error('the backend did not return the saved row');
    var i = arr.findIndex(function (r) { return r && r.id === tmpId; });
    if (i > -1) arr[i] = j.row; else arr.push(j.row);
    if (isNew && oldId && /^tmp-/.test(oldId)) deleteRow(table, oldId, true);   // a stale temporary row from an old bug
    delete PENDING[tmpId];
    persistCache(); UI.lastSync = new Date(); setSync('ok'); draw();
    return j.row;
  }).catch(function (e) {
    delete PENDING[tmpId];
    if (e.offline && table === 'Transaction') return queueSave(table, Object.assign({}, row, { id:tmpId }), isNew);
    // put things back the way the Sheet has them, so the screen never shows a change that wasn't saved
    var i = arr.findIndex(function (r) { return r && r.id === tmpId; });
    if (i > -1) { if (before) arr[i] = before; else arr.splice(i, 1); }
    delete PENDING[tmpId];
    setSync('err', e.message); draw();
    toast('Not saved: ' + e.message + '. Check Settings → Test connection.');
    throw e;
  });
  if (isNew) PENDING[tmpId] = p;
  return p;
}

// Clean up duplicate rows left by the old quick-edit bug (temporary ids written to the Sheet).
// For each natural key the newest row wins; it is kept under a proper id and the others are removed.
var NATURAL_KEY = { Budget:function (r) { return r.category ? r.category + '|' + String(r.period || '').slice(0, 10) : ''; }, Rule:'match', Subscription:'name', Settings:'key' };
var REPAIRING = false;
function repairDuplicates() {
  if (REPAIRING) return;
  var jobs = [];
  Object.keys(NATURAL_KEY).forEach(function (t) {
    var k = NATURAL_KEY[t], groups = {};
    (DATA[t] || []).forEach(function (r) { var v = String((typeof k === 'function' ? k(r) : r[k]) || '').trim().toLowerCase(); if (v) (groups[v] = groups[v] || []).push(r); });
    Object.keys(groups).forEach(function (v) {
      var g = groups[v];
      if (g.length < 2 && !/^tmp-/.test(g[0].id)) return;
      var newest = g.slice().sort(function (a, b) { return String(b.updated_date) < String(a.updated_date) ? -1 : 1; })[0];
      var keep = g.filter(function (r) { return !/^tmp-/.test(r.id); })[0];
      var row = Object.assign({}, newest, { id: keep ? keep.id : '' });
      g.forEach(function (r) { if (!keep || r.id !== keep.id) jobs.push({ del:[t, r.id] }); });
      jobs.unshift({ save:[t, row] });
    });
  });
  if (!jobs.length) return;
  REPAIRING = true;
  var chain = Promise.resolve();
  jobs.forEach(function (j) {
    chain = chain.then(function () { return j.save ? saveRow(j.save[0], j.save[1]) : deleteRow(j.del[0], j.del[1], true); });
  });
  chain.then(function () { toast('Cleaned up ' + jobs.filter(function (j) { return j.del; }).length + ' duplicate rows'); })
    .catch(function () {}).then(function () { REPAIRING = false; });
}
function deleteRow(table, id, quiet) {
  if (table === 'Transaction' && queued(id) && /^tmp-/.test(id)) {   // never reached the Sheet: just forget it
    setOutbox(outbox().filter(function (op) { return !(op.row && op.row.id === id); }));
    DATA[table] = (DATA[table] || []).filter(function (r) { return r.id !== id; }); persistCache(); draw(); setSync(UI.sync);
    return Promise.resolve();
  }
  var arr = DATA[table] || [];
  var i = arr.findIndex(function (r) { return r.id === id; });
  var removed = i > -1 ? arr.splice(i, 1)[0] : null;
  draw(); setSync('busy');
  return post({ action:'delete', table:table, id:id }).then(function () {
    if (queued(id)) setOutbox(outbox().filter(function (op) { return !(op.row && op.row.id === id); }));
    persistCache(); UI.lastSync = new Date(); setSync('ok');
  }).catch(function (e) {
    if (e.offline && table === 'Transaction') {
      setOutbox(outbox().filter(function (op) { return !(op.row && op.row.id === id); }).concat([{ table:table, action:'delete', id:id, at:Date.now() }]));
      persistCache(); setSync('err', 'Offline'); toast('Deleted on this phone; the Sheet is updated when you’re back online'); return;
    }
    if (removed) arr.splice(i, 0, removed);
    setSync('err', e.message); toast('Not deleted: ' + e.message); draw();
  });
}

// ─── Offline: transactions added or changed without signal wait on this phone and are sent later ───
// Kept in the browser (survives closing the app). Sent in order before every load, and when the phone is back online.
var OUTBOX_KEY = 'ff_outbox_v1', FLUSHING = null;
function outbox() { try { return JSON.parse(lsGet(OUTBOX_KEY) || '[]') || []; } catch (e) { return []; } }
function setOutbox(list) { lsSet(OUTBOX_KEY, JSON.stringify(list)); }
function queued(id) { return outbox().some(function (op) { return (op.row && op.row.id === id) || op.id === id; }); }
function queueSave(table, row, isNew) {
  var list = outbox(), arr = DATA[table] = DATA[table] || [];
  var j = list.findIndex(function (op) { return op.action === 'upsert' && op.row.id === row.id; });
  if (j > -1) list[j].row = row; else list.push({ table:table, action:'upsert', row:row, at:Date.now() });
  setOutbox(list);
  var i = arr.findIndex(function (r) { return r.id === row.id; }); if (i > -1) arr[i] = row; else arr.push(row);
  persistCache(); setSync('err', 'Offline'); draw();
  toast('No connection: saved on this phone, sent to the Sheet when you’re back online');
  return Promise.resolve(row);
}
function flushOutbox() {
  if (FLUSHING) return FLUSHING;
  var list = outbox(); if (!list.length) return Promise.resolve();
  var chain = Promise.resolve();
  list.forEach(function (op) {
    chain = chain.then(function () {
      var send = op.action === 'delete' ? { action:'delete', table:op.table, id:op.id }
        : { action:'upsert', table:op.table, row:/^tmp-/.test(op.row.id) ? Object.assign({}, op.row, { id:undefined }) : op.row };
      return post(send).then(function (j) {
        var arr = DATA[op.table] = DATA[op.table] || [];
        if (op.action === 'upsert' && j.row) { var i = arr.findIndex(function (r) { return r.id === op.row.id; }); if (i > -1) arr[i] = j.row; else arr.push(j.row); }
        // done: take it off the list straight away, so a failure later never sends it twice
        setOutbox(outbox().filter(function (x) { return !(x.at === op.at && x.action === op.action && (x.id || x.row.id) === (op.id || op.row.id)); }));
      });
    });
  });
  FLUSHING = chain.then(function () { persistCache(); UI.lastSync = new Date(); setSync('ok'); draw(); toast('Sent ' + list.length + ' waiting change' + (list.length > 1 ? 's' : '') + ' to the Sheet'); })
    .catch(function (e) { setSync('err', e.offline ? 'Offline' : e.message); throw e; })
    .then(function (v) { FLUSHING = null; return v; }, function (e) { FLUSHING = null; throw e; });
  return FLUSHING;
}
window.addEventListener('online', function () { flushOutbox().catch(function () {}); });

// Categories from the Sheet's Category tab (when it has rows); otherwise the built-in list
function applyCategories() {
  var rows = (DATA.Category || []).filter(function (r) { return String(r.category || '').trim(); });
  var next = {};
  if (rows.length) {
    rows.slice().sort(function (a, b) { return (+a.sort || 0) - (+b.sort || 0); }).forEach(function (r) {
      var c = String(r.category).trim(), sub = String(r.subcategory || '').trim();
      next[c] = next[c] || []; if (sub && next[c].indexOf(sub) < 0) next[c].push(sub);
    });
  } else next = JSON.parse(JSON.stringify(BUILTIN_CATEGORIES));
  Object.keys(CATEGORIES).forEach(function (k) { delete CATEGORIES[k]; });
  Object.keys(next).forEach(function (k) { CATEGORIES[k] = next[k]; });
}

export { readAll, applyCategories, outbox, flushOutbox, setSync, syncHTML, loadAll, post, applyData, persistCache, PENDING, saveRow, NATURAL_KEY, REPAIRING, repairDuplicates, deleteRow };
