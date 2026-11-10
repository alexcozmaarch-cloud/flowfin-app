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
    var painted = await pg.evaluate(function () { var c = document.getElementById('chDaily'); if (!c) return 0; var x = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, n = 0; for (var i = 3; i < x.length; i += 4) if (x[i]) n++; return n; });
    h.assert(painted > 500, 'the chart is empty');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('home: pace bar, all budgets, compact income bar, next 3 upcoming, nearest goal, net worth link', async function () {
    var app = await h.openApp({ data: demo.data, phone: true }), pg = app.page;
    h.assert(await pg.locator('.pill').count() >= 1, 'pace pill missing');
    h.eq(await pg.locator('.pmeter').count(), 1, 'pace bar');
    h.assert(/Family Infrastructure/.test(await pg.innerText('.minib')), 'Family Infrastructure budget missing');
    h.assert(await pg.locator('.wfleg span').count() >= 4, 'income legend');
    h.assert(await pg.locator('.uplist .ur:not(.more)').count() <= 5, 'too many upcoming rows');
    h.assert(/Demo car/.test(await pg.innerText('.goalrow')), 'nearest goal missing');
    await pg.click('.linkrow[data-nav=wealth]'); await pg.waitForTimeout(300);
    h.assert(/Net worth/.test(await pg.innerText('#view')), 'net worth link did not open Wealth');
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
  console.log('\nNo signal');
  await h.test('a transaction added offline waits on the phone, survives a reload and is sent once', async function () {
    var app = await h.openApp({ data: demo.data, phone: true }), pg = app.page;
    app.state.offline = true;
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(200); await openFullForm(pg);
    await pg.fill('#mdesc', 'Offline coffee'); await pg.fill('#mamt', '4.2'); await pg.click('[data-act=save]'); await pg.waitForTimeout(500);
    h.eq(await pg.evaluate(function () { return JSON.parse(localStorage.getItem('ff_outbox_v1') || '[]').length; }), 1, 'waiting items');
    h.assert(/1 waiting to sync/.test(await pg.innerText('#syncState')), 'sync label should say 1 waiting');
    // edit it while still offline: must stay one waiting item
    await pg.evaluate(function () { location.hash = 'transactions'; }); await pg.waitForTimeout(300);
    await pg.locator('.tx', { hasText: 'Offline coffee' }).first().click(); await pg.waitForTimeout(250);
    await pg.fill('#mamt', '4.8'); await pg.click('[data-act=save]'); await pg.waitForTimeout(400);
    h.eq(await pg.evaluate(function () { return JSON.parse(localStorage.getItem('ff_outbox_v1') || '[]').length; }), 1, 'still one waiting item after the edit');
    await pg.reload(); await pg.waitForTimeout(1200);
    await pg.evaluate(function () { location.hash = 'transactions'; }); await pg.waitForTimeout(300);
    h.assert(await pg.locator('.tx', { hasText: 'Offline coffee' }).count() === 1, 'lost after reload');
    h.assert(!Object.values(app.store.Transaction).some(function (t) { return t.description === 'Offline coffee'; }), 'should not be in the Sheet yet');
    app.state.offline = false;
    await pg.evaluate(function () { window.dispatchEvent(new Event('online')); }); await pg.waitForTimeout(1000);
    var rows = Object.values(app.store.Transaction).filter(function (t) { return t.description === 'Offline coffee'; });
    h.eq(rows.length, 1, 'rows in the Sheet'); h.eq(+rows[0].amount, 4.8, 'edited amount sent');
    h.assert(!/^tmp-/.test(rows[0].id), 'temporary id reached the Sheet');
    h.eq(await pg.evaluate(function () { return JSON.parse(localStorage.getItem('ff_outbox_v1') || '[]').length; }), 0, 'waiting list emptied');
    await pg.reload(); await pg.waitForTimeout(1200); await pg.evaluate(function () { location.hash = 'transactions'; }); await pg.waitForTimeout(300);
    h.eq(await pg.locator('.tx', { hasText: 'Offline coffee' }).count(), 1, 'duplicate on screen after sync');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('a backend error (not lost signal) still says “Not saved” and keeps nothing', async function () {
    var app = await h.openApp({ data: demo.data, phone: true }), pg = app.page;
    await pg.route('**/script.google.com/**', function (r) { return r.request().method() === 'POST' ? r.fulfill({ body: JSON.stringify({ ok: false, error: 'Sheet is locked' }), contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } }) : r.fallback(); });
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(200); await openFullForm(pg);
    await pg.fill('#mdesc', 'Will fail'); await pg.fill('#mamt', '1'); await pg.click('[data-act=save]'); await pg.waitForTimeout(500);
    h.eq(await pg.evaluate(function () { return JSON.parse(localStorage.getItem('ff_outbox_v1') || '[]').length; }), 0, 'should not wait');
    h.assert(/Not saved/.test(await pg.innerText('body')), 'no “Not saved” message');
    await app.ctx.close();
  });
  console.log('\nCategories in the Sheet');
  await h.test('first load with the new backend fills the Category tab (incl. your own subcategories)', async function () {
    var data = JSON.parse(JSON.stringify(demo.data));
    data.Settings.push({ id: 'cs', key: 'custom_subs', value: JSON.stringify({ 'Personal Cash': ['Car wash'] }) });
    var app = await h.openApp({ data: data }); await app.page.waitForTimeout(800);
    var rows = Object.values(app.store.Category || {});
    h.assert(rows.length > 30, 'only ' + rows.length + ' category rows');
    h.assert(rows.some(function (r) { return r.category === 'Personal Cash' && r.subcategory === 'Car wash'; }), 'your own subcategory was not moved');
    h.assert(rows.some(function (r) { return r.category === 'Family Infrastructure' && r.subcategory === 'Mortgage'; }), 'built-in subcategory missing');
    h.assert(Object.values(app.store.Settings).some(function (r) { return r.key === 'job_categories_sheet' && r.value === '1'; }), 'done-flag not set');
    h.eq(app.state.urlKeyReads || 0, 0, 'the key should not travel in the address');
    await app.page.evaluate(function () { location.hash = 'settings'; }); await app.page.waitForTimeout(250);
    h.assert(/Apps Script: up to date/.test(await app.page.innerText('#view')), 'settings should say the Apps Script is up to date');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('categories come from the Sheet; a new subcategory is saved there', async function () {
    var data = JSON.parse(JSON.stringify(demo.data));
    data.Category = [{ id: 'c1', category: 'Personal Cash', subcategory: '', sort: 1 }, { id: 'c2', category: 'Personal Cash', subcategory: 'Lunches', sort: 2 },
      { id: 'c3', category: 'Personal Cash', subcategory: 'Transportation', sort: 3 }, { id: 'c4', category: 'Family Infrastructure', subcategory: 'Mortgage', sort: 4 },
      { id: 'c5', category: 'Pets', subcategory: 'Vet', sort: 5 }];
    data.Settings.push({ id: 'jc', key: 'job_categories_sheet', value: '1' });
    var app = await h.openApp({ data: data, phone: true }), pg = app.page;
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(200); await openFullForm(pg);
    var cats = await pg.locator('#mcat option').allInnerTexts();
    h.assert(cats.indexOf('Pets') > -1, 'a category added in the Sheet should be offered: ' + cats.join(', '));
    await pg.fill('#mdesc', 'Dog food'); await pg.fill('#mamt', '30');
    await pg.selectOption('#mcat', 'Pets'); await pg.waitForTimeout(150);
    await pg.selectOption('#msub', '__new'); await pg.waitForTimeout(150); await pg.fill('#mnewsub', 'Food'); await pg.press('#mnewsub', 'Enter'); await pg.waitForTimeout(500);
    h.assert(Object.values(app.store.Category).some(function (r) { return r.category === 'Pets' && r.subcategory === 'Food'; }), 'new subcategory not saved to the Category tab');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('an older backend (before this update) still works the old way', async function () {
    var data = JSON.parse(JSON.stringify(demo.data)); delete data.Category;
    var app = await h.openApp({ data: data, phone: true, oldBackend: true }), pg = app.page;
    h.assert(await pg.evaluate(function () { return FF.periodModel(-1).list.length; }) > 10, 'data not loaded');
    h.eq(Object.keys(app.store).indexOf('Category'), -1, 'must not write a Category tab that does not exist');
    await pg.evaluate(function () { location.hash = 'settings'; }); await pg.waitForTimeout(250);
    h.assert(/older version still deployed/.test(await pg.innerText('#view')), 'settings should flag the old Apps Script');
    await pg.evaluate(function () { location.hash = 'dashboard'; }); await pg.waitForTimeout(250);
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(200); await openFullForm(pg);
    await pg.fill('#mdesc', 'Car wash'); await pg.fill('#mamt', '12');
    await pg.selectOption('#msub', '__new'); await pg.waitForTimeout(150); await pg.fill('#mnewsub', 'Car care'); await pg.press('#mnewsub', 'Enter'); await pg.waitForTimeout(500);
    h.assert(Object.values(app.store.Settings).some(function (r) { return r.key === 'custom_subs' && /Car care/.test(r.value); }), 'should fall back to Settings');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('every module’s imports and names resolve', async function () { require('./lint.js')(h); });
  await (await import('./core.test.mjs')).default(h);
};
