// A stand-in for Google Apps Script + Google Sheets that runs the REAL backend/Code.gs.
// It behaves like Google where that has bitten us before:
//  · values are converted when written: "1" becomes the number 1, "TRUE" a boolean, "2026-11-13" a date
//  · every Sheets call costs time; one request may use at most 6 minutes (Google's limit), else it is cut off
//  · each request starts with fresh script globals, like a new Apps Script execution
// Simulated time is reported per request so tests can catch slow patterns (e.g. one write per row).
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
var CODE = fs.readFileSync(path.join(__dirname, '..', 'backend', 'Code.gs'), 'utf8');
var LIMIT_MS = 6 * 60 * 1000;
var COST = { open:400, sheet:15, read:80, write:150, perCell:0.02, append:220, del:220, cell:60 };

function coerce(v) {
  if (typeof v !== 'string') return v === undefined || v === null ? '' : v;
  var s = v.trim();
  if (s === '') return v;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
  var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return v;
}
function Clock() { this.ms = 0; }
Clock.prototype.add = function (n) { this.ms += n; if (this.ms > LIMIT_MS) { var e = new Error('Exceeded maximum execution time'); e.timeout = true; throw e; } };

function Sheet(name, clock) { this.name = name; this.rows = []; this.clock = clock; }
Sheet.prototype.getName = function () { return this.name; };
Sheet.prototype.getLastRow = function () { for (var i = this.rows.length; i > 0; i--) if (this.rows[i - 1].some(function (c) { return c !== '' && c !== null && c !== undefined; })) return i; return 0; };
Sheet.prototype.getLastColumn = function () { var n = 0; this.rows.forEach(function (r) { for (var j = r.length; j > n; j--) if (r[j - 1] !== '' && r[j - 1] !== undefined) { n = j; break; } }); return n; };
Sheet.prototype.getRange = function (r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); };
Sheet.prototype.appendRow = function (vals) { this.clock.add(COST.append); this.rows[this.getLastRow()] = vals.map(coerce); return this; };
Sheet.prototype.deleteRow = function (r) { this.clock.add(COST.del); this.rows.splice(r - 1, 1); return this; };
Sheet.prototype.deleteRows = function (r, n) { this.clock.add(COST.del); this.rows.splice(r - 1, n); return this; };
Sheet.prototype.setFrozenRows = function () { return this; };
Sheet.prototype.cell = function (r, c) { var row = this.rows[r - 1]; var v = row ? row[c - 1] : undefined; return v === undefined ? '' : v; };
Sheet.prototype.put = function (r, c, v) { while (this.rows.length < r) this.rows.push([]); var row = this.rows[r - 1]; while (row.length < c - 1) row.push(''); row[c - 1] = coerce(v); };

function Range(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
Range.prototype.getValues = function () {
  this.sh.clock.add(COST.read + COST.perCell * this.nr * this.nc);
  var out = [];
  for (var i = 0; i < this.nr; i++) { var row = []; for (var j = 0; j < this.nc; j++) { var v = this.sh.cell(this.r + i, this.c + j); row.push(v instanceof Date ? new Date(v.getTime()) : v); } out.push(row); }
  return out;
};
Range.prototype.getValue = function () { this.sh.clock.add(COST.cell); var v = this.sh.cell(this.r, this.c); return v instanceof Date ? new Date(v.getTime()) : v; };
Range.prototype.setValues = function (vals) {
  if (vals.length !== this.nr || vals.some(function (row) { return row.length !== this.nc; }, this)) throw new Error('The number of rows or columns in the data does not match the range');
  this.sh.clock.add(COST.write + COST.perCell * this.nr * this.nc);
  for (var i = 0; i < this.nr; i++) for (var j = 0; j < this.nc; j++) this.sh.put(this.r + i, this.c + j, vals[i][j]);
  return this;
};
Range.prototype.setValue = function (v) { this.sh.clock.add(COST.cell); this.sh.put(this.r, this.c, v); return this; };
Range.prototype.setFontWeight = function () { return this; };

function Spreadsheet(clockRef) { this.sheets = {}; this.clockRef = clockRef; }
Spreadsheet.prototype.getSheetByName = function (n) { this.clockRef.c.add(COST.sheet); var s = this.sheets[n]; if (s) s.clock = this.clockRef.c; return s || null; };
Spreadsheet.prototype.insertSheet = function (n) { var s = this.sheets[n] = new Sheet(n, this.clockRef.c); return s; };

// one fake Google project: a spreadsheet, script properties and a cache that survive between requests
function FakeGas(opts) {
  opts = opts || {};
  this.clockRef = { c:new Clock() };
  this.ss = new Spreadsheet(this.clockRef);
  this.props = { SHEET_ID:'test-sheet', FF_KEY:opts.key || 'test-key' };
  this.cache = {};
  this.log = [];   // { action, ms } per request
}
FakeGas.prototype.context = function () {
  var self = this, clock = this.clockRef.c = new Clock();
  Object.keys(self.ss.sheets).forEach(function (k) { self.ss.sheets[k].clock = clock; });
  var ctx = {
    console:console, JSON:JSON, Date:Date, Math:Math, String:String, Number:Number, Object:Object, Array:Array, Error:Error, isNaN:isNaN,
    SpreadsheetApp:{ openById:function () { clock.add(COST.open); return self.ss; } },
    PropertiesService:{ getScriptProperties:function () { return { getProperty:function (k) { return self.props[k] === undefined ? null : self.props[k]; }, setProperty:function (k, v) { self.props[k] = String(v); } }; } },
    LockService:{ getScriptLock:function () { return { waitLock:function () {}, tryLock:function () { return true; }, releaseLock:function () {} }; } },
    CacheService:{ getScriptCache:function () { return { get:function (k) { return self.cache[k] === undefined ? null : self.cache[k]; }, put:function (k, v) { self.cache[k] = String(v); } }; } },
    ContentService:{ MimeType:{ JSON:'json' }, createTextOutput:function (s) { return { text:s, setMimeType:function () { return this; } }; } },
    Utilities:{ getUuid:function () { return crypto.randomUUID(); }, formatDate:function (d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); } },
    ScriptApp:{ getProjectTriggers:function () { return []; }, newTrigger:function () { var t = { timeBased:function () { return t; }, everyHours:function () { return t; }, everyDays:function () { return t; }, atHour:function () { return t; }, create:function () { return t; } }; return t; }, deleteTrigger:function () {} },
    UrlFetchApp:{ fetch:function () { throw new Error('no network in tests'); } },
    Logger:{ log:function () {} }
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx, { filename:'Code.gs' });
  return { ctx:ctx, clock:clock };
};
// returns { body, ms } or { timeout:true, ms }
FakeGas.prototype.run = function (fn, arg, label) {
  var x = this.context(), out;
  try { out = x.ctx[fn](arg); }
  catch (e) { this.log.push({ action:label, ms:x.clock.ms, timeout:!!e.timeout }); if (e.timeout) return { timeout:true, ms:x.clock.ms }; throw e; }
  this.log.push({ action:label, ms:x.clock.ms });
  return { body:out && out.text, ms:x.clock.ms };
};
FakeGas.prototype.get = function (params) { return this.run('doGet', { parameter:params || {} }, 'GET ' + (params && params.action || 'read')); };
FakeGas.prototype.post = function (text) { var a = ''; try { a = JSON.parse(text).action; } catch (e) {} return this.run('doPost', { postData:{ contents:text } }, 'POST ' + a); };
FakeGas.prototype.setup = function () { return this.run('setup', undefined, 'setup'); };
// seed tables the way an import would (values go through the same conversion as any write)
FakeGas.prototype.seed = function (data) {
  var x = this.context(), self = this;
  Object.keys(data || {}).forEach(function (t) {
    var headers = x.ctx.TABLES[t]; if (!headers) return;
    var sh = self.ss.sheets[t] || self.ss.insertSheet(t);
    if (!sh.getLastRow()) headers.forEach(function (h, j) { sh.put(1, j + 1, h); });
    data[t].forEach(function (row, i) { headers.forEach(function (h, j) { sh.put(i + 2, j + 1, row[h] === undefined ? '' : row[h]); }); });
  });
};
// what the Sheet holds now, read the way the backend reads it: { Table: { id: row } }
FakeGas.prototype.snapshot = function () {
  var x = this.context(), out = {}, self = this;
  Object.keys(self.ss.sheets).forEach(function (t) { out[t] = {}; x.ctx.readTable_(t).forEach(function (r) { out[t][String(r.id)] = r; }); });
  return out;
};
FakeGas.prototype.dropSheet = function (name) { delete this.ss.sheets[name]; };
FakeGas.prototype.slowest = function () { return this.log.reduce(function (m, x) { return !m || x.ms > m.ms ? x : m; }, null); };

module.exports = { FakeGas:FakeGas, coerce:coerce, LIMIT_MS:LIMIT_MS };
