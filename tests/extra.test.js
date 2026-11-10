// Clicks through the main flows on each page with the fake backend.
'use strict';
var h = require('./harness'), { makeDemo } = require('./demo-data'), { openFullForm } = require('./app.test.js');

module.exports = async function () {
  var demo = makeDemo(new Date());
  console.log('\nPage flows');
  await h.test('edit a transaction and save the change', async function () {
    var app = await h.openApp({ data: demo.data, hash: 'transactions' }), pg = app.page;
    await pg.locator('.tx').first().click(); await pg.waitForTimeout(250);
    await pg.fill('#mamt', '123.45'); await pg.click('[data-act=save]'); await pg.waitForTimeout(500);
    h.assert(app.posts.some(function (p) { return p.table === 'Transaction' && p.row && +p.row.amount === 123.45; }), 'edit not saved');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('add a goal', async function () {
    var app = await h.openApp({ data: demo.data, hash: 'goals' }), pg = app.page;
    await pg.click('[data-act=gnew]'); await pg.waitForTimeout(250);
    await pg.fill('#gname', 'Test goal'); await pg.fill('#gtarget', '1000');
    await pg.click('[data-act=gsave]'); await pg.waitForTimeout(600);
    h.assert(Object.values(app.store.FinancialGoal).some(function (g) { return g.name === 'Test goal'; }), 'goal not saved');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('wealth: month-end update saves a value', async function () {
    var app = await h.openApp({ data: demo.data, hash: 'wealth' }), pg = app.page;
    await pg.locator('[data-act=wupdate]').first().click(); await pg.waitForTimeout(400);
    await pg.fill('#wv_nw1', '21000'); await pg.click('[data-act=wsaveupdate]'); await pg.waitForTimeout(800);
    h.assert(Object.values(app.store.AssetSnapshot || {}).some(function (s) { return s.entry_id === 'nw1' && +s.value === 21000; }), 'snapshot not saved');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('budgets: the planner opens and redistributes', async function () {
    var app = await h.openApp({ data: demo.data, hash: 'budgets' }), pg = app.page;
    var n = await pg.locator('[id^=pl_v]').count();
    h.assert(n > 0, 'planner fields missing');
    var f = pg.locator('[id^=pl_v]:not([disabled])'), before = await f.evaluateAll(function (els) { return els.map(function (e) { return e.value; }); });
    h.assert(before.length >= 2, 'need two open planner fields');
    var first = await f.first().getAttribute('id');
    await pg.fill('#' + first, String(Math.max(0, (+before[0] || 0) + 100))); await pg.dispatchEvent('#' + first, 'input'); await pg.waitForTimeout(200);
    var after = await pg.locator('[id^=pl_v]:not([disabled])').evaluateAll(function (els) { return els.map(function (e) { return e.value; }); });
    h.assert(after.slice(1).join() !== before.slice(1).join(), 'other budgets did not adjust');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('dashboard: both charts switch', async function () {
    var app = await h.openApp({ data: demo.data }), pg = app.page;
    var btns = pg.locator('[data-act=dchart]'); h.assert(await btns.count() === 2, 'chart switch missing');
    await btns.nth(1).click(); await pg.waitForTimeout(300); await pg.locator('[data-act=dchart]').nth(0).click(); await pg.waitForTimeout(300);
    h.assert(await pg.locator('canvas').count() > 0, 'no chart drawn');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('settings show the app version', async function () {
    var app = await h.openApp({ data: demo.data, hash: 'settings' });
    h.assert(/App version \d\d\.\d\d\.\d{4}/.test(await app.page.innerText('#view')), 'version missing');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('house rules: no Content-Type on backend requests; every script is cached for offline', async function () {
    var fs = require('fs'), path = require('path'), dir = path.join(h.ROOT, 'js');
    var files = fs.readdirSync(dir).filter(function (f) { return /\.js$/.test(f); });
    files.forEach(function (f) { h.assert(!/Content-Type/i.test(fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\/.*$/gm, '')), f + ' sets a Content-Type header'); });
    var sw = fs.readFileSync(path.join(h.ROOT, 'sw.js'), 'utf8');
    files.forEach(function (f) { h.assert(sw.indexOf("'./js/" + f + "'") > -1, 'sw.js does not cache js/' + f); });
    h.assert(sw.indexOf("'./css/app.css'") > -1, 'sw.js does not cache css/app.css');
  });
  await (await import('./core.test.mjs')).default(h);
};
