// FlowFin · Undo and Recently deleted. Before anything is deleted, a copy goes into the Settings tab
// (key bin_…); Undo or Restore puts the rows back with their original ids. Copies older than 30 days are removed.
import { deleteMany, deleteRow, persistCache, post } from './api.js';
import { esc, toast } from './core.js';
import { draw } from './nav.js';
import { saveSetting } from './settings.js';

var BIN_DAYS = 30;
function binEntries() {
  return (DATA.Settings || []).filter(function (s) { return /^bin_/.test(s.key || ''); }).map(function (s) {
    try { var v = JSON.parse(s.value); v.key = s.key; v.sid = s.id; return v; } catch (e) { return null; }
  }).filter(Boolean).sort(function (a, b) { return String(b.at) < String(a.at) ? -1 : 1; });
}
// items: [[table, id], …] — the first one is what the person deleted, the rest belong to it (contributions, snapshots)
function removeWithUndo(label, items) {
  var rows = [];
  items.forEach(function (x) {
    var r = (DATA[x[0]] || []).filter(function (y) { return y.id === x[1]; })[0];
    if (r && !/^tmp-/.test(r.id)) rows.push({ t:x[0], row:JSON.parse(JSON.stringify(r)) });
  });
  var key = 'bin_' + Date.now().toString(36);
  var kept = rows.length ? saveSetting(key, JSON.stringify({ label:label, at:new Date().toISOString(), rows:rows })).then(function () { return true; }, function () { return false; })
    : Promise.resolve(false);
  return kept.then(function (ok) {
    // the row itself first, then what belongs to it, one request per table
    var rest = {}; items.slice(1).forEach(function (x) { (rest[x[0]] = rest[x[0]] || []).push(x[1]); });
    var chain = deleteRow(items[0][0], items[0][1]);
    Object.keys(rest).forEach(function (t) { chain = chain.then(function () { return deleteMany(t, rest[t]); }); });
    return chain.then(function () {
      if (ok) toastUndo(label + ' deleted', function () { restore(key); }); else toast(label + ' deleted');
    });
  });
}
function toastUndo(msg, undo) {
  var t = document.createElement('div'); t.className = 'toast undo'; t.setAttribute('role', 'status');
  t.innerHTML = '<span>' + esc(msg) + '</span><button type="button">Undo</button>';
  t.querySelector('button').addEventListener('click', function () { t.remove(); undo(); });
  document.body.appendChild(t); setTimeout(function () { t.remove(); }, 7000);
}
function restore(key) {
  var e = binEntries().filter(function (x) { return x.key === key; })[0];
  if (!e) return Promise.resolve();
  var tables = {}; e.rows.forEach(function (r) { (tables[r.t] = tables[r.t] || []).push(r.row); });
  var chain = Promise.resolve();
  Object.keys(tables).forEach(function (t) {
    chain = chain.then(function () {
      return post({ action:'upsertMany', table:t, rows:tables[t] }).then(function (j) {
        var arr = DATA[t] = DATA[t] || [];
        (j.rows || tables[t]).forEach(function (row) { var i = arr.findIndex(function (r) { return r.id === row.id; }); if (i > -1) arr[i] = row; else arr.push(row); });
      });
    });
  });
  return chain.then(function () { return deleteRow('Settings', e.sid, true); })
    .then(function () { persistCache(); draw(); toast(e.label + ' restored'); })
    .catch(function (err) { toast('Not restored: ' + err.message); });
}
function forget(key) {
  var e = binEntries().filter(function (x) { return x.key === key; })[0];
  return e ? deleteRow('Settings', e.sid, true).then(function () { draw(); }) : Promise.resolve();
}
// on every load: drop copies older than 30 days
function purgeBin() {
  var cut = Date.now() - BIN_DAYS * 864e5, old = binEntries().filter(function (e) { return Date.parse(e.at) < cut; });
  return deleteMany('Settings', old.map(function (e) { return e.sid; }));
}
function binHTML() {
  var list = binEntries();
  return '<div class="card"><h3>Recently deleted<span class="r">kept ' + BIN_DAYS + ' days</span></h3>' +
    (list.length ? list.map(function (e) {
      var d = new Date(e.at), extra = e.rows.length - 1;
      return '<div class="rowline binrow"><span><b>' + esc(e.label) + '</b><small>' + d.toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit' }) + ' ' + d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }) +
        (extra > 0 ? ' · with ' + extra + ' linked row' + (extra > 1 ? 's' : '') : '') + '</small></span>' +
        '<span class="binact"><button class="btn" data-act="binrestore" data-key="' + esc(e.key) + '">Restore</button><button class="btn danger" data-act="binforget" data-key="' + esc(e.key) + '">Delete now</button></span></div>';
    }).join('') : '<p class="soon" style="margin:0">Nothing deleted in the last ' + BIN_DAYS + ' days. Anything you delete stays here for ' + BIN_DAYS + ' days.</p>') + '</div>';
}

export { BIN_DAYS, binEntries, removeWithUndo, toastUndo, restore, forget, purgeBin, binHTML };
