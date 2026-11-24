// Opens FlowFin in a headless browser with a fake backend, so tests never touch the real Sheet.
// The app files are served straight from this repository; Apps Script, exchange rates and fonts are mocked.
'use strict';
var fs = require('fs'), path = require('path');
var { chromium, devices } = require('playwright');
var ROOT = path.resolve(__dirname, '..');
var TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
function chartPath() {   // the package's exports hide dist/, so look for the file directly
  var f = path.join(__dirname, 'node_modules', 'chart.js', 'dist', 'chart.umd.js');
  if (fs.existsSync(f)) return f;
  f = path.join(__dirname, 'node_modules', 'chart.js', 'dist', 'chart.umd.min.js');
  return fs.existsSync(f) ? f : null;
}
var CORS = { 'Access-Control-Allow-Origin': '*' };
var { FakeGas } = require('./fake-gas');
var SLOW_MS = 60 * 1000;
// pretend Yahoo Finance: a smooth made-up daily series per symbol (weekdays only), enough to draw the Ideas charts
function fakeYahoo(url) {
  var m = /chart\/([^?]+)\?.*period1=(\d+)/.exec(url); var sym = decodeURIComponent(m[1]), from = +m[2], now = Math.floor(Date.now() / 1000);
  if (/^BAD/.test(sym)) return { getResponseCode: function () { return 404; }, getContentText: function () { return '{}'; } };
  var seed = 0; for (var i = 0; i < sym.length; i++) seed += sym.charCodeAt(i);
  var ts = [], close = [], v = 50 + seed % 100;
  for (var t = from; t <= now; t += 86400) { var d = new Date(t * 1000).getUTCDay(); if (d === 0 || d === 6) continue; v *= 1 + Math.sin(t / 864000 + seed) * 0.004 + (seed % 3 - 1) * 0.001; ts.push(t); close.push(Math.round(v * 100) / 100); }
  var body = JSON.stringify({ chart: { result: [{ meta: { currency: /\.SW$/.test(sym) ? 'CHF' : 'USD', shortName: sym }, timestamp: ts, indicators: { quote: [{ close: close }] } }] } });
  return { getResponseCode: function () { return 200; }, getContentText: function () { return body; } };
}   // a single request that would take Google over a minute is a bug waiting to happen

var browser = null;
async function getBrowser() { if (!browser) browser = await chromium.launch(); return browser; }
async function closeBrowser() { if (browser) await browser.close(); browser = null; }

// data: { Table: [rows] }. Returns { page, store, posts, errors, offline(bool) }
async function openApp(opts) {
  opts = opts || {};
  var b = await getBrowser();
  var ctxOpts = opts.phone ? Object.assign({}, devices['iPhone 13'], { serviceWorkers: 'block' }) : { viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' };
  if (opts.colorScheme) ctxOpts.colorScheme = opts.colorScheme;
  var ctx = await b.newContext(ctxOpts);
  var page = await ctx.newPage();
  var posts = [], errors = [], state = { offline: false, fail: 0, getCount: 0 };
  // the real backend/Code.gs runs against a fake Sheet; app.store is a read-only view of what the Sheet holds
  var gas = new FakeGas({ fetch: fakeYahoo }), store = {};
  gas.setup();
  if (opts.oldBackend || (opts.data && !opts.data.Category && opts.noCategoryTab)) gas.dropSheet('Category');
  gas.seed(opts.data || {});
  function refresh() { var s = gas.snapshot(); Object.keys(store).forEach(function (k) { delete store[k]; }); Object.assign(store, s); }
  refresh();
  function answer(route, res) {
    if (res.timeout) errors.push('Apps Script request ran past Google\'s 6-minute limit: ' + gas.log[gas.log.length - 1].action);
    else if (res.ms > SLOW_MS) errors.push('Apps Script request would take ' + Math.round(res.ms / 1000) + ' s at Google: ' + gas.log[gas.log.length - 1].action);
    refresh();
    var text = res.timeout ? JSON.stringify({ ok: false, error: 'Exceeded maximum execution time' }) : res.body;
    return new Promise(function (ok) { setTimeout(ok, Math.min(400, res.ms / 40)); }).then(function () {
      return route.fulfill({ body: text, contentType: 'application/json', headers: CORS });
    });
  }
  page.on('pageerror', function (e) { errors.push(String(e && e.stack || e)); });
  page.on('console', function (m) { if (m.type() === 'error' && !/ServiceWorker|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
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
        var raw = req.postData() || '{}', body = JSON.parse(raw); posts.push(body);
        if (req.headers()['content-type'] && !/text\/plain/.test(req.headers()['content-type'])) errors.push('POST sent a Content-Type header (breaks Apps Script): ' + req.headers()['content-type']);
        if (body.action === 'readAll') {
          if (opts.oldBackend) return route.fulfill({ body: JSON.stringify({ ok: false, error: 'Error: Unknown table: undefined' }), contentType: 'application/json', headers: CORS });
          state.getCount++;
          var r = gas.post(raw);
          if (opts.api1 && r.body) { var o = JSON.parse(r.body); delete o.api; r.body = JSON.stringify(o); }
          return answer(route, r);
        }
        return answer(route, gas.post(raw));
      }
      state.getCount++; state.urlKeyReads = (state.urlKeyReads || 0) + (/[?&]key=/.test(u) ? 1 : 0);
      var params = {}; new URL(u).searchParams.forEach(function (v, k) { params[k] = v; });
      return answer(route, gas.get(params));
    }
    if (/frankfurter|currency-api/.test(u)) return route.fulfill({ body: JSON.stringify({ rates: { CHF: 0.8 }, usd: { chf: 0.8 } }), contentType: 'application/json', headers: CORS });
    if (/chart\.umd/.test(u)) { var cp = chartPath(); return cp ? route.fulfill({ path: cp, contentType: 'text/javascript' }) : route.continue(); }
    if (/fonts\.(googleapis|gstatic)\.com/.test(u)) return route.fulfill({ body: '', contentType: 'text/css' });
    return route.abort();
  });
  await page.addInitScript(function () { try { if (!localStorage.getItem('ff_key_v1')) localStorage.setItem('ff_key_v1', 'test-key'); } catch (e) {} });
  if (opts.classic) await page.addInitScript(function () { try { localStorage.setItem('ff_sync_mode', 'classic'); } catch (e) {} });
  await page.goto('https://app.local/index.html' + (opts.hash ? '#' + opts.hash : ''));
  await page.waitForFunction(function () { return window.FF && document.querySelector('#view') && document.querySelector('#view').children.length > 0; }, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  return { page: page, ctx: ctx, store: store, posts: posts, errors: errors, state: state, gas: gas };
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
// wait until the phone has nothing left to send (fast sync sends a moment after each change)
async function settled(app, ms) {
  await app.page.waitForFunction(function () { try { return !JSON.parse(localStorage.getItem('ff_outbox_v1') || '[]').length; } catch (e) { return true; } }, null, { timeout: ms || 5000 });
  await app.page.waitForTimeout(150);
}
function noErrors(app) { assert(app.errors.length === 0, 'page errors:\n' + app.errors.join('\n')); }

module.exports = { openApp: openApp, closeBrowser: closeBrowser, test: test, assert: assert, eq: eq, near: near, noErrors: noErrors, settled: settled, results: results, ROOT: ROOT };
