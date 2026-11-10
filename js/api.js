// FlowFin · Talking to the Apps Script backend (never set a Content-Type header — Holotrack rule).
// Shared settings and state (DATA, UI, _cache, CATEGORIES …) are globals from js/config.js.
import { $, apiKey, apiUrl, esc, lsSet, toast } from './core.js';
import { repairContribs } from './goals.js';
import { runJobs } from './jobs.js';
import { draw } from './nav.js';

// ─── network (never set a Content-Type header — Holotrack rule) ───────────
function setSync(state, msg) { UI.sync = state; UI.syncMsg = msg || ''; var el = $('syncState'); if (el) el.outerHTML = syncHTML(); }
function syncHTML() {
  var cls = UI.sync === 'ok' ? 'ok' : UI.sync === 'busy' ? 'busy' : UI.sync === 'err' ? 'err' : '';
  var txt = UI.sync === 'busy' ? 'Syncing…' : UI.sync === 'err' ? (UI.syncMsg || 'Offline') :
    UI.lastSync ? 'Synced ' + UI.lastSync.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }) : 'Not synced';
  return '<span class="sync" id="syncState" title="' + esc(UI.syncMsg) + '"><i class="dot ' + cls + '"></i>' + esc(txt) + '</span>';
}
function loadAll() {
  setSync('busy');
  return fetch(apiUrl() + '?key=' + encodeURIComponent(apiKey())).then(function (r) { return r.json(); }).then(function (j) {
    if (!j.ok) throw new Error(j.error || 'Backend error');
    applyData(j.data);
    _cache = { data:j.data, at:Date.now() };
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
function post(body) {
  body.key = apiKey();
  return fetch(apiUrl(), { method:'POST', body:JSON.stringify(body) })
    .then(function (r) { return r.json(); })
    .then(function (j) { if (!j.ok) throw new Error(j.error || 'Save failed'); return j; });
}
function applyData(d) {
  TABLES.forEach(function (t) { DATA[t] = (d && d[t]) || []; });
  var sd = (DATA.Settings || []).filter(function (s) { return s.key === 'period_start_day'; })[0];
  if (sd && +sd.value >= 1 && +sd.value <= 28) START_DAY = +sd.value;
}
function persistCache() { _cache = { data:DATA, at:Date.now() }; lsSet(CACHE_KEY, JSON.stringify(_cache)); }

var PENDING = {};   // temporary id → promise of the saved row, so a quick second edit updates instead of duplicating
function saveRow(table, row) {
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
  var arr = DATA[table] || [];
  var i = arr.findIndex(function (r) { return r.id === id; });
  var removed = i > -1 ? arr.splice(i, 1)[0] : null;
  draw(); setSync('busy');
  return post({ action:'delete', table:table, id:id }).then(function () {
    persistCache(); UI.lastSync = new Date(); setSync('ok');
  }).catch(function (e) {
    if (removed) arr.splice(i, 0, removed);
    setSync('err', e.message); toast('Not deleted: ' + e.message); draw();
  });
}

export { setSync, syncHTML, loadAll, post, applyData, persistCache, PENDING, saveRow, NATURAL_KEY, REPAIRING, repairDuplicates, deleteRow };
