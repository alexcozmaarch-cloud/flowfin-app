// FlowFin · Import of Base44 exports.
// Shared settings and state (DATA, UI, _cache, CATEGORIES …) are globals from js/config.js.
import { $, esc, toast } from './core.js';
import { saveMany } from './transactions.js';

// ─── Import (Base44 exports converted to the Sheet layout) ────────────────
var IMPORT_NUM = ['orig_amount','fx_rate','fx_fee','priority','amount','monthly_limit','pct','target_amount','current_amount','saving_pct','net','current_value','total_invested','exchange_rate','value'];
var IMPORT_BOOL = ['is_default','rollover_enabled','is_liability','auto_detected'];
function parseCSV(text) {
  var rows = [], row = [], cur = '', q = false;
  text = String(text).replace(/^﻿/, '');
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  var head = rows.shift() || [];
  return { head:head, rows:rows.filter(function (r) { return r.join('') !== ''; }).map(function (r) { var o = {}; head.forEach(function (h, k) { o[h] = r[k] === undefined ? '' : r[k]; }); return o; }) };
}
function tableForFile(name, head) {
  var base = String(name).replace(/\.csv$/i, '').replace(/_export(_\d+)?$/i, '').replace(/^.*[\\/]/, '').replace(/^[0-9a-f]{6,}-/i, '');
  var hit = TABLES.filter(function (t) { return t.toLowerCase() === base.toLowerCase(); })[0];
  if (hit) return hit;
  // fall back to the columns: the table whose known columns best match the file's header
  var sigs = { Transaction:'description', NetWorthEntry:'account_type', AssetSnapshot:'entry_id', FinancialGoal:'target_amount', GoalContribution:'goal_id', FundAllocation:'key', CategorySettings:'role', Budget:'monthly_limit', Subscription:'next_renewal', Rule:'match' };
  return Object.keys(sigs).filter(function (t) { return head.indexOf(sigs[t]) > -1; })[0] || null;
}
var IMPORT_MSG = '';
function importMsg(h) { IMPORT_MSG = h; var o = $('importOut'); if (o) o.innerHTML = h; }
function importFiles(files) {
  importMsg('Reading ' + files.length + ' file' + (files.length === 1 ? '' : 's') + '…');
  var jobs = [];
  var reads = Array.prototype.map.call(files, function (f) {
    return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res({ name:f.name, text:r.result }); }; r.onerror = function () { res({ name:f.name, text:'' }); }; r.readAsText(f); });
  });
  Promise.all(reads).then(function (list) {
    var lines = [];
    list.forEach(function (f) {
      var p = parseCSV(f.text), t = tableForFile(f.name, p.head);
      if (!t) { lines.push(esc(f.name) + ': not recognised, skipped'); return; }
      var have = {}; (DATA[t] || []).forEach(function (r) { have[String(r.id)] = 1; });
      var rows = p.rows.filter(function (r) { return !r.id || !have[String(r.id)]; }).map(function (r) {
        var o = {};
        Object.keys(r).forEach(function (k) {
          if (['created_by_id','created_by','is_sample'].indexOf(k) > -1) return;
          var v = r[k];
          if (IMPORT_NUM.indexOf(k) > -1 && v !== '') v = Number(v);
          if (IMPORT_BOOL.indexOf(k) > -1) v = String(v).toLowerCase() === 'true';
          o[k] = v;
        });
        return o;
      });
      if (t === 'GoalContribution') {
        // Base44 exports repeat each goal/period many times: keep only the newest row per goal and period
        var best = {};
        (DATA.GoalContribution || []).forEach(function (r) { best[r.goal_id + '|' + String(r.period).slice(0, 10)] = 'have'; });
        rows.forEach(function (r) { var k = r.goal_id + '|' + String(r.period).slice(0, 10); if (best[k] === 'have') return; if (!best[k] || String(r.created_date) > String(best[k].created_date)) best[k] = r; });
        rows = rows.filter(function (r) { return best[r.goal_id + '|' + String(r.period).slice(0, 10)] === r; });
      }
      var skipped = p.rows.length - rows.length;
      lines.push(t + ': ' + rows.length + ' new' + (skipped ? ', ' + skipped + ' already in the Sheet' : ''));
      for (var i = 0; i < rows.length; i += 100) jobs.push({ t:t, rows:rows.slice(i, i + 100) });
    });
    importMsg(lines.join('<br>') + (jobs.length ? '<br>Saving…' : ''));
    var chain = Promise.resolve();
    jobs.forEach(function (j) { chain = chain.then(function () { return saveMany(j.t, j.rows); }); });
    return chain.then(function () { importMsg(lines.join('<br>') + (jobs.length ? '<br><span class="pos">Done.</span>' : '')); if (jobs.length) toast('Import finished'); });
  }).catch(function (e) { importMsg('<span class="neg">Import stopped: ' + esc(e.message) + '</span>'); });
}
function importHTML() {
  var empty = ['NetWorthEntry','AssetSnapshot','FinancialGoal','GoalContribution','FundAllocation','CategorySettings'].filter(function (t) { return !(DATA[t] || []).length; });
  return '<div class="card"><h3>Import data<span class="r">CSV files from flowfin-import.zip</span></h3>' +
    '<p class="soon" style="margin:0 0 10px;font-size:13px">' + (empty.length ? 'Empty tabs: ' + empty.join(', ') + '. ' : '') +
    'Select one or more of the CSV files. Each goes to the tab with its name; rows already in the Sheet are skipped, so importing twice is safe.</p>' +
    '<label class="btn" style="display:inline-flex;align-items:center;cursor:pointer">Choose files<input id="importFiles" type="file" accept=".csv,text/csv" multiple style="position:absolute;width:1px;height:1px;opacity:0"></label>' +
    '<div id="importOut" class="soon" style="margin-top:10px;font-size:13px">' + IMPORT_MSG + '</div></div>';
}

export { IMPORT_NUM, IMPORT_BOOL, parseCSV, tableForFile, IMPORT_MSG, importMsg, importFiles, importHTML };
