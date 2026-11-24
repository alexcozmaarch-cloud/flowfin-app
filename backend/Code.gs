/**
 * FlowFin backend — Google Apps Script (standalone project)
 * One tab per table. Row 1 = headers. Column A = id.
 *
 * Setup:
 *   1. Project Settings → Script properties: SHEET_ID = your Sheet ID, FF_KEY = a long random access key.
 *      (Or paste the Sheet ID below; the script property wins, so later code updates need no editing.)
 *   2. Run setup() once from the editor (creates any missing tabs + headers).
 *   3. Deploy → New deployment → Web app → Execute as: Me, Access: Anyone.
 *      To update: Deploy → Manage deployments → pencil → Version: New version → Deploy (same URL).
 *
 * The front end calls this WITHOUT a Content-Type header (same rule as Holotrack),
 * so the body arrives as plain text in e.postData.contents.
 */

var SHEET_ID = PropertiesService.getScriptProperties().getProperty('SHEET_ID') || 'PASTE_SHEET_ID_HERE';

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
  Settings:         ['id','key','value','updated_date'],
  Category:         ['id','category','subcategory','sort','created_date','updated_date']   // one row per subcategory; an empty subcategory = the category itself
};

var NUMERIC = ['sort','orig_amount','fx_rate','fx_fee','priority','amount','monthly_limit','pct','target_amount','current_amount','saving_pct','net','current_value','total_invested','exchange_rate','value'];
var BOOLEAN = ['is_default','rollover_enabled','is_liability','auto_detected'];

var SS_ = null;
function ss_() { return SS_ || (SS_ = SpreadsheetApp.openById(SHEET_ID)); }   // opened once per request
var API_VERSION = 6;   // 2: readAll without the lock, upsertMany in one write · 3: Settings values come back as written · 4: fast sync (change counter, batch) · 5: daily prices for Ideas · 6: ideas inbox in Drive

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
      // Settings.value holds text and JSON (owed, recently deleted…); only AssetSnapshot's value is a number
      if (NUMERIC.indexOf(h) > -1 && v !== '' && !(name === 'Settings' && h === 'value')) v = Number(v);
      if (BOOLEAN.indexOf(h) > -1) v = (v === true || String(v).toLowerCase() === 'true');
      o[h] = v;
    });
    return o;
  });
}

// ---------- access key ----------
// Set a Script Property FF_KEY (Project Settings → Script properties).
// Once set, every read and write must carry the same key. Ping stays open.
// After 30 wrong keys within 15 minutes everything is refused for 15 minutes, so the key can't be guessed by trying.
function checkKey_(key) {
  var expected = PropertiesService.getScriptProperties().getProperty('FF_KEY');
  if (!expected) return;
  var cache = CacheService.getScriptCache(), bad = Number(cache.get('ff_bad_keys') || 0);
  if (bad >= 30) throw new Error('Too many wrong access keys: locked for 15 minutes');
  if (key !== expected) { cache.put('ff_bad_keys', String(bad + 1), 900); throw new Error('Wrong or missing access key'); }
}
function readAll_() { var all = {}; Object.keys(TABLES).forEach(function (t) { all[t] = readTable_(t); }); return all; }

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
      out = { ok: true, data: readAll_() };
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
//   { "action": "deleteMany", "table": "AssetSnapshot", "ids": [...] }   (API 3)
//   { "action": "batch", "ops": [ {action, table, row|id|ids}, ... ] }      (API 4)
//   { "action": "readAll", "rev": "..." }  → { unchanged: true } when nothing changed (API 4)
//   { "action": "readAll" }   → same as a plain GET, but the key travels in the body instead of the address
function doPost(e) {
  var lock = null, out;
  try {
    var body = JSON.parse(e.postData.contents);
    checkKey_(body.key);
    // reading never waits for the lock, so a slow save can't block the app from loading
    // fast sync: if nothing changed since the app's last read, answer without opening the Sheet at all
    if (body.action === 'readAll') {
      var rev = rev_();
      if (body.rev && String(body.rev) === rev) return json_({ ok: true, api: API_VERSION, rev: rev, unchanged: true });
      return json_({ ok: true, api: API_VERSION, rev: rev, data: readAll_() });
    }
    if (body.action === 'syncBase44') return json_({ ok: true, result: syncFromBase44() });
    if (body.action === 'ideasSync') return json_({ ok: true, api: API_VERSION, files: ideasSync_(body.done || [], body.export) });
    if (body.action === 'prices') return json_({ ok: true, api: API_VERSION, prices: prices_(body.symbols || [], body.from) });
    lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) { lock = null; throw new Error('The Sheet is busy with another save; try again in a minute'); }
    if (body.action === 'batch') { var prev = rev_(); out = { ok: true, prevRev: prev, results: batch_(body.ops || []) }; out.rev = bumpRev_(); return json_(out); }
    if (!TABLES[body.table]) throw new Error('Unknown table: ' + body.table);
    if (body.action === 'upsert') out = { ok: true, row: upsert_(body.table, body.row) };
    else if (body.action === 'upsertMany') out = { ok: true, rows: upsertMany_(body.table, body.rows || []) };
    else if (body.action === 'delete') out = { ok: true, deleted: delete_(body.table, body.id) };
    else if (body.action === 'deleteMany') out = { ok: true, deleted: deleteMany_(body.table, body.ids || []) };
    else throw new Error('Unknown action: ' + body.action);
    out.prevRev = rev_(); out.rev = bumpRev_();
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
      // FlowFin owns the one-off decision: once a row has an anomaly status in the Sheet, Base44 no longer overwrites it
      var next = headers.map(function (h, i) {
        if (h === 'anomaly_status' && String(row[i]) !== '') return row[i];
        return r[h] === undefined || r[h] === null ? row[i] : r[h];
      });
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

// ---------- ideas inbox (API 6) ----------
// Claude writes ideas and weekly verdict checks as JSON files named "FlowFin ideas inbox …" into your Drive.
// The app picks up the ones it hasn't seen and, in return, keeps "FlowFin ideas (from app).json" up to date
// so Claude can see the ideas you added yourself. Nothing else in your Drive is read or changed.
var IDEAS_INBOX = 'FlowFin ideas inbox', IDEAS_EXPORT = 'FlowFin ideas (from app).json';
function ideasSync_(done, exportJson) {
  var seen = {}; (done || []).forEach(function (id) { seen[id] = true; });
  var out = [], it = DriveApp.searchFiles('title contains "' + IDEAS_INBOX + '" and trashed = false');
  while (it.hasNext() && out.length < 30) {
    var f = it.next(); if (seen[f.getId()]) continue;
    out.push({ id: f.getId(), name: f.getName(), created: f.getDateCreated().toISOString(), text: f.getBlob().getDataAsString() });
  }
  if (exportJson) {
    var ex = DriveApp.getFilesByName(IDEAS_EXPORT);
    if (ex.hasNext()) ex.next().setContent(String(exportJson)); else DriveApp.createFile(IDEAS_EXPORT, String(exportJson), MimeType.PLAIN_TEXT);
  }
  return out.sort(function (a, b) { return a.created < b.created ? -1 : 1; });
}

// ---------- daily prices for the Ideas tab (API 5) ----------
// Yahoo Finance's public chart data (no account). One request per symbol, kept for 6 hours.
// Returns { SYMBOL: { currency, name, dates:[yyyy-mm-dd], closes:[number] } } or { SYMBOL: { error } }.
function prices_(symbols, from) {
  var cache = CacheService.getScriptCache(), out = {};
  var start = from ? Math.floor(new Date(from + 'T00:00:00Z').getTime() / 1000) - 7 * 86400 : Math.floor(Date.now() / 1000) - 400 * 86400;
  symbols.slice(0, 20).forEach(function (sym) {
    sym = String(sym || '').trim().toUpperCase(); if (!sym || out[sym]) return;
    var key = 'px_' + sym + '_' + start, hit = cache.get(key);
    if (hit) { out[sym] = JSON.parse(hit); return; }
    try {
      var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?interval=1d&period1=' + start + '&period2=' + Math.floor(Date.now() / 1000);
      var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.getResponseCode() !== 200) throw new Error('price service answered ' + res.getResponseCode());
      var r = JSON.parse(res.getContentText()).chart.result[0], q = r.indicators.quote[0], ts = r.timestamp || [], d = [], c = [];
      ts.forEach(function (t, i) { var v = q.close[i]; if (v === null || v === undefined) return; d.push(Utilities.formatDate(new Date(t * 1000), 'UTC', 'yyyy-MM-dd')); c.push(Math.round(v * 10000) / 10000); });
      out[sym] = { currency: r.meta.currency || '', name: r.meta.longName || r.meta.shortName || '', dates: d, closes: c };
      try { cache.put(key, JSON.stringify(out[sym]), 6 * 3600); } catch (e) {}
    } catch (err) { out[sym] = { error: String(err.message || err) }; }
  });
  return out;
}

// ---------- fast sync (API 4) ----------
// REV changes with every write (from the app, or a hand edit in the Sheet via onEdit), so the app can ask
// "anything new since REV x?" and get "no" without the Sheet being opened.
function rev_() {
  var p = PropertiesService.getScriptProperties(), r = p.getProperty('REV');
  if (!r) { r = bumpRev_(); }
  return r;
}
function bumpRev_() {
  var r = String(Date.now()) + '-' + Math.floor(Math.random() * 1e6);
  PropertiesService.getScriptProperties().setProperty('REV', r);
  return r;
}
// Runs by itself whenever you edit the Sheet by hand, so the app knows to fetch again
function onEdit(e) { bumpRev_(); }
// Several saves and deletes in one request, in order. Runs of saves to the same tab are written together.
function batch_(ops) {
  var results = [], i = 0;
  while (i < ops.length) {
    var op = ops[i];
    try {
      if (!TABLES[op.table]) throw new Error('Unknown table: ' + op.table);
      if (op.action === 'upsert') {
        var j = i, rows = [];
        while (j < ops.length && ops[j].action === 'upsert' && ops[j].table === op.table) { rows.push(ops[j].row); j++; }
        upsertMany_(op.table, rows).forEach(function (r) { results.push({ ok: true, row: r }); });
        i = j; continue;
      }
      if (op.action === 'delete') results.push({ ok: true, deleted: delete_(op.table, op.id) });
      else if (op.action === 'deleteMany') results.push({ ok: true, deleted: deleteMany_(op.table, op.ids || []) });
      else throw new Error('Unknown action: ' + op.action);
    } catch (err) { results.push({ ok: false, error: String(err) }); }
    i++;
  }
  return results;
}

function upsert_(table, row) {
  var sh = ss_().getSheetByName(table);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var now = new Date().toISOString();
  if (!row.id) { row.id = Utilities.getUuid(); row.created_date = now; }
  row.updated_date = now;
  var rowIdx = findRow_(sh, row.id);
  if (!rowIdx && !row.created_date) row.created_date = now;
  var values = headers.map(function (h) { return row[h] === undefined ? '' : row[h]; });
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

// Many rows in one go: one read, one write for changed rows, one write for new rows
function upsertMany_(table, rows) {
  var sh = ss_().getSheetByName(table);
  var lastCol = sh.getLastColumn(), lastRow = sh.getLastRow();
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var data = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  var at = {}; data.forEach(function (r, i) { if (r[0] !== '') at[String(r[0])] = i; });
  var now = new Date().toISOString(), added = [], touched = false, cIdx = headers.indexOf('created_date');
  rows.forEach(function (row) {
    if (!row.id) { row.id = Utilities.getUuid(); row.created_date = now; }
    row.updated_date = now;
    var values = headers.map(function (h) { return row[h] === undefined ? '' : row[h]; });
    if (at[String(row.id)] !== undefined) {
      var i = at[String(row.id)];
      if (cIdx > -1 && !row.created_date) values[cIdx] = data[i][cIdx];
      data[i] = values; touched = true;
    } else {
      if (cIdx > -1 && !row.created_date) { row.created_date = now; values[cIdx] = now; }
      at[String(row.id)] = -1; added.push(values);
    }
  });
  if (touched) sh.getRange(2, 1, data.length, lastCol).setValues(data);
  if (added.length) sh.getRange(lastRow + 1, 1, added.length, lastCol).setValues(added);
  return rows;
}

function delete_(table, id) {
  var sh = ss_().getSheetByName(table);
  var rowIdx = findRow_(sh, id);
  if (!rowIdx) return false;
  sh.deleteRow(rowIdx);
  return true;
}

// Many rows in one go (an account with all its month-end values): one read, one write, one delete
function deleteMany_(table, ids) {
  var sh = ss_().getSheetByName(table), lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2 || !ids.length) return 0;
  var gone = {}; ids.forEach(function (id) { gone[String(id)] = true; });
  var data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var keep = data.filter(function (r) { return !gone[String(r[0])]; }), n = data.length - keep.length;
  if (!n) return 0;
  if (keep.length) sh.getRange(2, 1, keep.length, lastCol).setValues(keep);
  sh.deleteRows(2 + keep.length, n);
  return n;
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
