// Opens FlowFin in a headless browser with a fake backend, so tests never touch the real Sheet.
// The app files are served straight from this repository; Apps Script, exchange rates and fonts are mocked.
'use strict';
var fs = require('fs'), path = require('path');
var { chromium, devices } = require('playwright');
var ROOT = path.resolve(__dirname, '..');
var TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
function chartPath() {
  try { return require.resolve('chart.js/dist/chart.umd.js'); } catch (e) { return null; }
}
var CORS = { 'Access-Control-Allow-Origin': '*' };

var browser = null;
async function getBrowser() { if (!browser) browser = await chromium.launch(); return browser; }
async function closeBrowser() { if (browser) await browser.close(); browser = null; }

// data: { Table: [rows] }. Returns { page, store, posts, errors, offline(bool) }
async function openApp(opts) {
  opts = opts || {};
  var b = await getBrowser();
  var ctxOpts = opts.phone ? Object.assign({}, devices['iPhone 13'], { serviceWorkers: 'block' }) : { viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' };
  var ctx = await b.newContext(ctxOpts);
  var page = await ctx.newPage();
  var store = {}, posts = [], errors = [], state = { offline: false, fail: 0, getCount: 0 };
  Object.keys(opts.data || {}).forEach(function (t) { store[t] = {}; opts.data[t].forEach(function (r) { store[t][String(r.id)] = JSON.parse(JSON.stringify(r)); }); });
  page.on('pageerror', function (e) { errors.push(String(e && e.stack || e)); });
  page.on('console', function (m) { if (m.type() === 'error' && !/ServiceWorker|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  var uid = 0;
  await page.route('**/*', async function (route) {
    var req = route.request(), u = req.url();
    if (u.indexOf('https://app.local/') === 0) {
      var rel = decodeURIComponent(new URL(u).pathname.slice(1)) || 'index.html';
      var f = path.join(ROOT, rel);
      if (f.indexOf(ROOT) !== 0 || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
      return route.fulfill({ path: f, contentType: TYPES[path.extname(f)] || 'application/octet-stream' });
    }
    if (u.indexOf('script.google.com') > -1) {
      if (state.offline || state.fail > 0) { if (state.fail > 0) state.fail--; return route.abort('internetdisconnected'); }
      if (req.method() === 'POST') {
        var body = JSON.parse(req.postData() || '{}'); posts.push(body);
        if (body.action === 'readAll') {
          if (opts.oldBackend) return route.fulfill({ body: JSON.stringify({ ok: false, error: 'Error: Unknown table: undefined' }), contentType: 'application/json', headers: CORS });
          if (body.key !== 'test-key') return route.fulfill({ body: JSON.stringify({ ok: false, error: 'Error: Wrong or missing access key' }), contentType: 'application/json', headers: CORS });
          state.getCount++;
          var all = {}; Object.keys(store).forEach(function (k) { all[k] = Object.values(store[k]); });
          return route.fulfill({ body: JSON.stringify({ ok: true, data: all }), contentType: 'application/json', headers: CORS });
        }
        if (req.headers()['content-type'] && !/text\/plain/.test(req.headers()['content-type'])) errors.push('POST sent a Content-Type header (breaks Apps Script): ' + req.headers()['content-type']);
        var t = store[body.table] = store[body.table] || {};
        var up = function (row) { row = Object.assign({}, row); if (!row.id) row.id = 'new' + (++uid); t[String(row.id)] = row; return row; };
        var out;
        if (body.action === 'delete') { delete t[String(body.id)]; out = { ok: true, deleted: true }; }
        else if (body.action === 'upsertMany') out = { ok: true, rows: body.rows.map(up) };
        else out = { ok: true, row: up(body.row) };
        return route.fulfill({ body: JSON.stringify(out), contentType: 'application/json', headers: CORS });
      }
      state.getCount++; state.urlKeyReads = (state.urlKeyReads || 0) + (/[?&]key=/.test(u) ? 1 : 0);
      var d = {}; Object.keys(store).forEach(function (k) { d[k] = Object.values(store[k]); });
      return route.fulfill({ body: JSON.stringify({ ok: true, data: d }), contentType: 'application/json', headers: CORS });
    }
    if (/frankfurter|currency-api/.test(u)) return route.fulfill({ body: JSON.stringify({ rates: { CHF: 0.8 }, usd: { chf: 0.8 } }), contentType: 'application/json', headers: CORS });
    if (/chart\.umd/.test(u)) { var cp = chartPath(); return cp ? route.fulfill({ path: cp, contentType: 'text/javascript' }) : route.continue(); }
    if (/fonts\.(googleapis|gstatic)\.com/.test(u)) return route.fulfill({ body: '', contentType: 'text/css' });
    return route.abort();
  });
  await page.addInitScript(function () { try { if (!localStorage.getItem('ff_key_v1')) localStorage.setItem('ff_key_v1', 'test-key'); } catch (e) {} });
  await page.goto('https://app.local/index.html' + (opts.hash ? '#' + opts.hash : ''));
  await page.waitForFunction(function () { return window.FF && document.querySelector('#view') && document.querySelector('#view').children.length > 0; }, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  return { page: page, ctx: ctx, store: store, posts: posts, errors: errors, state: state };
}

// tiny test runner: named checks, a clear report, non-zero exit on failure
var results = [];
async function test(name, fn) {
  var t0 = Date.now();
  try { await fn(); results.push([true, name]); console.log('  ok    ' + name + '  (' + (Date.now() - t0) + ' ms)'); }
  catch (e) { results.push([false, name]); console.log('  FAIL  ' + name + '\n        ' + String(e && e.message || e).split('\n').join('\n        ')); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'values differ') + ': got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b)); }
function near(a, b, msg) { if (Math.abs(a - b) >= 0.005) throw new Error((msg || 'numbers differ') + ': got ' + a + ', expected ' + b); }
function noErrors(app) { assert(app.errors.length === 0, 'page errors:\n' + app.errors.join('\n')); }

module.exports = { openApp: openApp, closeBrowser: closeBrowser, test: test, assert: assert, eq: eq, near: near, noErrors: noErrors, results: results, ROOT: ROOT };
