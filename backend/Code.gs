/**
 * FlowFin backend — Google Apps Script (standalone project)
 * One tab per table. Row 1 = headers. Column A = id.
 *
 * Setup:
 *   1. Paste your Sheet ID below.
 *   2. Run setup() once from the editor (creates any missing tabs + headers).
 *   3. Deploy → New deployment → Web app → Execute as: Me, Access: Anyone.
 *
 * The front end calls this WITHOUT a Content-Type header (same rule as Holotrack),
 * so the body arrives as plain text in e.postData.contents.
 */

var SHEET_ID = 'PASTE_SHEET_ID_HERE';

var TABLES = {
  Transaction:      ['id','date','description','category','subcategory','amount','type','account','anomaly_status','created_date','updated_date','tags','orig_amount','orig_currency','fx_rate','fx_fee'],
  Rule:             ['id','match','category','subcategory','type','account','tags','priority','created_date','updated_date'],
  Budget:           ['id','category','monthly_limit','period','is_default','rollover_enabled','created_date','updated_date'],
  CategorySettings: ['id','category','role','created_date','updated_date'],
  FundAllocation:   ['id','key','pct','created_date','updated_date'],
  FinancialGoal:    ['id','name','target_amount','current_amount','saving_pct','deadline','icon','color','fund_bucket','notes','created_date','updated_date'],
  GoalContribution: ['id','goal_id','period','amount','pct','net','created_date','updated_date'],
  Subscription:     ['id','name','amount','frequency','account','category','subcategory','next_renewal','status','notes','auto_detected','created_date','updated_date'],
  NetWorthEntry:    ['id','name','account_type','is_liability','currency','current_value','total_invested','institution','account_number','icon','color','exchange_rate','notes','last_updated','created_date','updated_date'],
  AssetSnapshot:    ['id','entry_id','date','value','total_invested','exchange_rate','created_date','updated_date'],
  Settings:         ['id','key','value','updated_date']
};

var NUMERIC = ['orig_amount','fx_rate','fx_fee','priority','amount','monthly_limit','pct','target_amount','current_amount','saving_pct','net','current_value','total_invested','exchange_rate','value'];
var BOOLEAN = ['is_default','rollover_enabled','is_liability','auto_detected'];

function ss_() { return SpreadsheetApp.openById(SHEET_ID); }

function setup() {
  var ss = ss_();
  Object.keys(TABLES).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var headers = TABLES[name];
    var existing = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
    if (existing.join('') === '') {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      sh.setFrozenRows(1);
    } else {
      // add any new columns at the end, keeping existing data where it is
      var missing = headers.filter(function (h) { return existing.indexOf(h) < 0; });
      if (missing.length) sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    }
  });
  return 'ok';
}

// ---------- read ----------
function readTable_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var headers = data.shift();
  return data.filter(function (r) { return r[0] !== ''; }).map(function (r) {
    var o = {};
    headers.forEach(function (h, i) {
      var v = r[i];
      if (v instanceof Date) v = Utilities.formatDate(v, 'Europe/Zurich', 'yyyy-MM-dd');
      if (NUMERIC.indexOf(h) > -1 && v !== '') v = Number(v);
      if (BOOLEAN.indexOf(h) > -1) v = (v === true || String(v).toLowerCase() === 'true');
      o[h] = v;
    });
    return o;
  });
}

// ---------- access key ----------
// Set a Script Property FF_KEY (Project Settings → Script properties).
// Once set, every read and write must carry the same key. Ping stays open.
function checkKey_(key) {
  var expected = PropertiesService.getScriptProperties().getProperty('FF_KEY');
  if (expected && key !== expected) throw new Error('Wrong or missing access key');
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  var out;
  try {
    if (p.action !== 'ping') checkKey_(p.key);
    if (p.action === 'ping') {
      var last = PropertiesService.getScriptProperties().getProperty('B44_LAST_SYNC');
      out = { ok: true, time: new Date().toISOString(), base44: last ? JSON.parse(last) : null };
    } else if (p.table) {
      out = { ok: true, rows: readTable_(p.table) };
    } else {
      var all = {};
      Object.keys(TABLES).forEach(function (t) { all[t] = readTable_(t); });
      out = { ok: true, data: all };
    }
  } catch (err) {
    out = { ok: false, error: String(err) };
  }
  return json_(out);
}

// ---------- write ----------
// Body (plain text JSON):
//   { "action": "upsert", "table": "Transaction", "row": {...} }       → returns row with id
//   { "action": "upsertMany", "table": "Transaction", "rows": [...] }
//   { "action": "delete", "table": "Transaction", "id": "..." }
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var out;
  try {
    var body = JSON.parse(e.postData.contents);
    checkKey_(body.key);
    if (body.action === 'syncBase44') { lock.releaseLock(); lock = null; return json_({ ok: true, result: syncFromBase44() }); }
    if (!TABLES[body.table]) throw new Error('Unknown table: ' + body.table);
    if (body.action === 'upsert') out = { ok: true, row: upsert_(body.table, body.row) };
    else if (body.action === 'upsertMany') out = { ok: true, rows: (body.rows || []).map(function (r) { return upsert_(body.table, r); }) };
    else if (body.action === 'delete') out = { ok: true, deleted: delete_(body.table, body.id) };
    else throw new Error('Unknown action: ' + body.action);
  } catch (err) {
    out = { ok: false, error: String(err) };
  } finally {
    if (lock) lock.releaseLock();
  }
  return json_(out);
}

// ---------- transition: pull transactions from Base44 ----------
// Script Properties needed: B44_APP_ID, B44_TOKEN (read-only personal access token).
// New and edited Base44 transactions are written to the Sheet; Base44 rows deleted
// in Base44 are removed. Rows created in FlowFin (UUID ids) are never touched.
var B44_ID = /^[0-9a-f]{24}$/;

function fixText_(s) {
  return String(s || '').trim().replace(/TCG Crads/g, 'TCG Cards').replace(/Nesspresso/g, 'Nespresso');
}

function fetchBase44_(entity) {
  var props = PropertiesService.getScriptProperties();
  var appId = props.getProperty('B44_APP_ID'), token = props.getProperty('B44_TOKEN');
  if (!appId || !token) throw new Error('Add B44_APP_ID and B44_TOKEN in Script properties');
  var items = [], cursor = null, guard = 0;
  do {
    var url = 'https://app.base44.com/api/apps/' + appId + '/entities/' + entity + '/v2/list?limit=5000' +
      (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('Base44 ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
    var j = JSON.parse(res.getContentText());
    items = items.concat(j.items || []);
    cursor = j.has_more ? j.next_cursor : null;
  } while (cursor && ++guard < 20);
  return items;
}

function syncFromBase44() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var remote = fetchBase44_('Transaction').filter(function (r) { return String(r.is_sample) !== 'true'; });
    var sh = ss_().getSheetByName('Transaction');
    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).getValues() : [];
    var tz = 'Europe/Zurich';
    var norm = function (v) { return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v); };

    var remoteById = {};
    remote.forEach(function (r) {
      r.description = fixText_(r.description);
      r.date = String(r.date || '').slice(0, 10);
      remoteById[r.id] = r;
    });

    var added = 0, updated = 0, removed = 0, seen = {};
    var kept = [];
    rows.forEach(function (row) {
      var id = String(row[0]);
      if (!B44_ID.test(id)) { kept.push(row); return; }          // FlowFin-created row: leave alone
      var r = remoteById[id];
      if (!r) { removed++; return; }                              // deleted in Base44
      seen[id] = true;
      var next = headers.map(function (h, i) { return r[h] === undefined || r[h] === null ? row[i] : r[h]; });
      var changed = next.some(function (v, i) { return norm(v) !== norm(row[i]); });
      if (changed) updated++;
      kept.push(next);
    });
    remote.forEach(function (r) {
      if (seen[r.id]) return;
      kept.push(headers.map(function (h) { return r[h] === undefined || r[h] === null ? '' : r[h]; }));
      added++;
    });

    kept.sort(function (a, b) { return norm(a[1]) < norm(b[1]) ? -1 : norm(a[1]) > norm(b[1]) ? 1 : 0; });
    if (rows.length) sh.getRange(2, 1, rows.length, headers.length).clearContent();
    if (kept.length) sh.getRange(2, 1, kept.length, headers.length).setValues(kept);

    var result = { added: added, updated: updated, removed: removed, total: kept.length, at: new Date().toISOString() };
    PropertiesService.getScriptProperties().setProperty('B44_LAST_SYNC', JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

// Run once: pulls from Base44 every hour until you remove the trigger.
function startHourlySync() {
  stopHourlySync();
  ScriptApp.newTrigger('syncFromBase44').timeBased().everyHours(1).create();
  return syncFromBase44();
}

// Run when you switch over for good.
function stopHourlySync() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncFromBase44') ScriptApp.deleteTrigger(t);
  });
}

function upsert_(table, row) {
  var sh = ss_().getSheetByName(table);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var now = new Date().toISOString();
  if (!row.id) { row.id = Utilities.getUuid(); row.created_date = now; }
  row.updated_date = now;
  var values = headers.map(function (h) { return row[h] === undefined ? '' : row[h]; });
  var rowIdx = findRow_(sh, row.id);
  if (rowIdx) {
    // keep created_date if the client didn't send it
    var cIdx = headers.indexOf('created_date');
    if (cIdx > -1 && !row.created_date) values[cIdx] = sh.getRange(rowIdx, cIdx + 1).getValue();
    sh.getRange(rowIdx, 1, 1, values.length).setValues([values]);
  } else {
    sh.appendRow(values);
  }
  return row;
}

function delete_(table, id) {
  var sh = ss_().getSheetByName(table);
  var rowIdx = findRow_(sh, id);
  if (!rowIdx) return false;
  sh.deleteRow(rowIdx);
  return true;
}

function findRow_(sh, id) {
  if (sh.getLastRow() < 2) return 0;
  var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
