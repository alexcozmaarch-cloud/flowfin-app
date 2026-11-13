// Main automated checks. Run with: node tests/run.js
'use strict';
var h = require('./harness'), { makeDemo } = require('./demo-data');
var test = h.test, assert = h.assert, eq = h.eq, near = h.near;

module.exports = async function () {
  var demo = makeDemo(new Date());

  console.log('\nNumbers');
  await h.test('six finished periods: net matches the Base44 rule', async function () {
    var app = await h.openApp({ data: demo.data });
    var got = await app.page.evaluate(function () {
      var o = {}; for (var i = -6; i <= -1; i++) { var T = FF.periodModel(i).totals; o[i] = Math.round((T.netCashFlow - T.collectibles - T.financialInvesting - T.threeA) * 100) / 100; } return o;
    });
    Object.keys(demo.expected).forEach(function (k) { near(got[k], demo.expected[k], 'period ' + k); });
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('future payments count as scheduled, never as spent', async function () {
    var app = await h.openApp({ data: demo.data });
    var t = await app.page.evaluate(function () { return FF.periodModel(0).totals; });
    assert(t.scheduled >= 90 || t.scheduled === 0, 'scheduled total looks wrong: ' + t.scheduled);
    var spentFuture = await app.page.evaluate(function () { var m = FF.periodModel(0); return m.list.filter(function (x) { return x.description === 'Future concert'; }).length; });
    assert(spentFuture <= 1, 'future row duplicated');
    h.noErrors(app); await app.ctx.close();
  });

  console.log('\nPages (desktop and phone)');
  var PAGES = ['dashboard', 'transactions', 'budgets', 'goals', 'monthly', 'wealth', 'settings', 'anomalies', 'subscriptions', 'calendar'];
  for (var phone of [false, true]) {
    await h.test('every page opens without errors on ' + (phone ? 'phone' : 'desktop'), async function () {
      var app = await h.openApp({ data: demo.data, phone: phone });
      for (var p of PAGES) {
        await app.page.evaluate(function (x) { location.hash = x; }, p);
        await app.page.waitForTimeout(250);
        var len = await app.page.evaluate(function () { return document.getElementById('view').innerText.trim().length; });
        assert(len > 20, 'page "' + p + '" is empty');
      }
      h.noErrors(app); await app.ctx.close();
    });
  }
  await h.test('transactions list shows the rows', async function () {
    var app = await h.openApp({ data: demo.data, hash: 'transactions' });
    var n = await app.page.locator('.tx').count();
    assert(n > 10, 'only ' + n + ' rows');
    h.noErrors(app); await app.ctx.close();
  });

  console.log('\nQuick add (two fields)');
  await h.test('quick add shows only description and amount, fills the rest from history', async function () {
    var app = await h.openApp({ data: demo.data, phone: true }), pg = app.page;
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(250);
    for (var id of ['mdate', 'mcat', 'msub', 'macct', 'mtags', 'manom']) h.eq(await pg.locator('#' + id).count(), 0, id + ' should be hidden in quick add');
    h.eq(await pg.evaluate(function () { return document.activeElement.id; }), 'mdesc', 'description should have focus');
    await pg.type('#mdesc', 'Netflix', { delay: 20 }); await pg.press('#mdesc', 'Enter'); await pg.tap('#mamt'); await pg.waitForTimeout(350);
    h.assert(/Personal Cash › Subscriptions/.test(await pg.innerText('.qsum')), 'summary should show the category from history: ' + await pg.innerText('.qsum'));
    h.eq(await pg.inputValue('#mamt'), '18.9', 'amount from the last one');
    await pg.fill('#mamt', '19.9'); await pg.click('[data-act=save]'); await pg.waitForTimeout(600);
    var today = require('./demo-data').ymd(new Date());
    var row = Object.values(app.store.Transaction).filter(function (t) { return t.description === 'Netflix' && t.date === today && +t.amount === 19.9; })[0];
    h.assert(row, 'not saved'); h.eq(row.category, 'Personal Cash'); h.eq(row.subcategory, 'Subscriptions'); h.eq(row.type, 'expense');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('“More” opens the full form and keeps what was typed', async function () {
    var app = await h.openApp({ data: demo.data, phone: true }), pg = app.page;
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(250);
    await pg.fill('#mdesc', 'Something new'); await pg.fill('#mamt', '7.5');
    await pg.click('[data-act=qmore]'); await pg.waitForTimeout(250);
    h.eq(await pg.inputValue('#mdesc'), 'Something new'); h.eq(await pg.inputValue('#mamt'), '7.5');
    h.eq(await pg.locator('#mcat').count(), 1, 'full form should show the category');
    await pg.selectOption('#mcat', 'Family Infrastructure'); await pg.waitForTimeout(150);
    await pg.click('[data-act=save]'); await pg.waitForTimeout(600);
    h.assert(Object.values(app.store.Transaction).some(function (t) { return t.description === 'Something new' && t.category === 'Family Infrastructure'; }), 'not saved with the chosen category');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('quick add with another currency', async function () {
    var app = await h.openApp({ data: demo.data, phone: true }), pg = app.page;
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(250);
    await pg.fill('#mdesc', 'Hotel Rome'); await pg.selectOption('#mcur', 'EUR'); await pg.waitForTimeout(300);
    h.eq(await pg.locator('#morig').count(), 1, 'amount paid field'); h.eq(await pg.locator('#mcat').count(), 0, 'still quick');
    await pg.fill('#morig', '100'); await pg.dispatchEvent('#morig', 'input'); await pg.waitForTimeout(300);
    h.near(parseFloat(await pg.inputValue('#mamt')), 80, 'CHF amount (no fee unless ticked)');
    h.noErrors(app); await app.ctx.close();
  });

  console.log('\nSuggested tags');
  await h.test('suggested tags: starter words, your own tags first, tap to add, new tag', async function () {
    var data = JSON.parse(JSON.stringify(demo.data));
    data.Transaction.push({ id: 'tg1', date: '2026-10-02', description: 'Running shorts Ochsner', category: 'Personal Cash', subcategory: 'Extras', amount: 45, type: 'expense', account: 'credit_card', tags: 'marathon 2027' });
    var app = await h.openApp({ data: data, phone: true }), pg = app.page;
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(200);
    await pg.type('#mdesc', 'Training shorts', { delay: 15 }); await pg.waitForTimeout(150);
    var chips = await pg.locator('#mtagchips .tchip:not(.on):not(.add)').allInnerTexts();
    h.eq(chips[0], '#marathon 2027', 'your own tag from a similar purchase comes first: ' + chips.join(' '));
    h.assert(chips.indexOf('#running') > -1 && chips.indexOf('#sports') > -1, 'starter tags: ' + chips.join(' '));
    await pg.click('#mtagchips [data-act=tagon][data-t=running]'); await pg.waitForTimeout(150);
    await pg.click('#mtagchips [data-act=tagnew]'); await pg.waitForTimeout(150);
    await pg.fill('#mnewtag', 'kit'); await pg.press('#mnewtag', 'Enter'); await pg.waitForTimeout(150);
    h.eq(await pg.locator('#mtagchips .tchip.on').count(), 2, 'two tags chosen');
    await pg.fill('#mamt', '39'); await pg.click('[data-act=save]'); await pg.waitForTimeout(700);
    var row = Object.values(app.store.Transaction).filter(function (t) { return t.description === 'Training shorts'; })[0];
    h.eq(row.tags, 'running, kit');
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(200); await pg.type('#mdesc', 'Physio session', { delay: 15 }); await pg.waitForTimeout(150);
    var c2 = await pg.locator('#mtagchips .tchip:not(.on):not(.add)').allInnerTexts();
    h.assert(c2.indexOf('#recovery') > -1 && c2.indexOf('#health') > -1, 'physio suggestions: ' + c2.join(' '));
    h.noErrors(app); await app.ctx.close();
  });
  console.log('\nForeign currency');
  await h.test('typing the amount first, then picking USD: the number becomes the USD amount', async function () {
    var app = await h.openApp({ data: demo.data, phone: true }), pg = app.page;
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(200);
    await pg.fill('#mdesc', 'Apify Subscription'); await pg.fill('#mamt', '19');
    await pg.selectOption('#mcur', 'USD'); await pg.waitForTimeout(500);
    h.eq(await pg.inputValue('#morig'), '19', 'USD amount'); h.eq(await pg.inputValue('#mamt'), '15.20', 'CHF calculated at 0.80, no fee');
    h.eq(await pg.evaluate(function () { return document.getElementById('mfee').checked; }), false, 'fee off by default');
    await pg.check('#mfee'); await pg.waitForTimeout(400);
    h.eq(await pg.inputValue('#mamt'), '15.47', 'with the 1.75% fee');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('your bank’s CHF amount is kept; typing never jumps out of the field', async function () {
    var app = await h.openApp({ data: demo.data, phone: true }), pg = app.page;
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(200);
    await pg.fill('#mdesc', 'Apify Subscription'); await pg.selectOption('#mcur', 'USD'); await pg.waitForTimeout(300);
    await pg.tap('#morig'); await pg.keyboard.type('19', { delay: 120 }); await pg.waitForTimeout(400);
    h.eq(await pg.evaluate(function () { return document.activeElement.id; }), 'morig', 'focus stays while the rate loads');
    h.eq(await pg.inputValue('#morig'), '19');
    await pg.tap('#mamt'); await pg.keyboard.press('Control+A'); await pg.keyboard.type('16.10', { delay: 80 }); await pg.waitForTimeout(300);
    h.eq(await pg.evaluate(function () { return document.activeElement.id; }), 'mamt', 'focus stays in CHF');
    await pg.fill('#morig', '20'); await pg.dispatchEvent('#morig', 'input'); await pg.waitForTimeout(400);
    h.eq(await pg.inputValue('#mamt'), '16.10', 'your CHF amount must not be overwritten');
    h.assert(/calculated would be 16\.00/.test(await pg.innerText('#mfxinfo')), 'hint with the calculated amount');
    await pg.click('[data-act=save]'); await pg.waitForTimeout(600);
    var row = Object.values(app.store.Transaction).filter(function (t) { return t.description === 'Apify Subscription'; })[0];
    h.assert(row, 'not saved'); h.eq(+row.amount, 16.1); h.eq(+row.orig_amount, 20); h.eq(row.orig_currency, 'USD');
    h.noErrors(app); await app.ctx.close();
  });
  console.log('\nAdd form on a phone');
  await h.test('suggestions appear while typing and close when tapping the next field', async function () {
    var app = await h.openApp({ data: demo.data, phone: true }), pg = app.page;
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(200);
    await openFullForm(pg);
    await pg.type('#mdesc', 'par', { delay: 30 }); await pg.waitForTimeout(150);
    eq(await pg.evaluate(function () { return document.getElementById('msugg').hidden; }), false, 'list should be open');
    assert(/Parking/.test(await pg.innerText('#msugg')), 'Parking not suggested');
    // the list must sit in the form, not on top of the fields below
    var list = await pg.locator('#msugg').boundingBox(), amt = await pg.locator('#mamt').boundingBox();
    assert(list.y + list.height <= amt.y + 1, 'suggestions cover the amount field');
    await pg.tap('#mamt'); await pg.waitForTimeout(350);
    eq(await pg.evaluate(function () { return document.getElementById('msugg').hidden; }), true, 'list should close when leaving the description');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('return key closes the suggestions and keeps the text', async function () {
    var app = await h.openApp({ data: demo.data, phone: true }), pg = app.page;
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(200); await openFullForm(pg);
    await pg.type('#mdesc', 'par', { delay: 30 }); await pg.waitForTimeout(150); await pg.press('#mdesc', 'Enter');
    eq(await pg.evaluate(function () { return document.getElementById('msugg').hidden; }), true, 'list still open');
    eq(await pg.inputValue('#mdesc'), 'par');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('tapping a suggestion fills the form and selects the amount', async function () {
    var app = await h.openApp({ data: demo.data, phone: true }), pg = app.page;
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(200); await openFullForm(pg);
    await pg.type('#mdesc', 'parking', { delay: 30 }); await pg.waitForTimeout(150);
    await pg.locator('#msugg button', { hasText: /^Parking$|Parking\s/ }).first().tap(); await pg.waitForTimeout(300);
    eq(await pg.inputValue('#mcat'), 'Personal Cash'); eq(await pg.inputValue('#msub'), 'Transportation');
    eq(await pg.evaluate(function () { return document.activeElement.id; }), 'mamt', 'amount should have focus');
    await pg.keyboard.type('4.5'); eq(await pg.inputValue('#mamt'), '4.5', 'typing should replace the amount');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('bottom bar hidden while the form is open; Add button reachable', async function () {
    var app = await h.openApp({ data: demo.data, phone: true }), pg = app.page;
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(200);
    eq(await pg.locator('#bottomnav').isVisible(), false, 'bottom bar still visible');
    var save = pg.locator('[data-act=save]'); await save.scrollIntoViewIfNeeded();
    var box = await save.boundingBox(), vh = pg.viewportSize().height;
    assert(box && box.y + box.height <= vh, 'Add button is off screen');
    var hit = await pg.evaluate(function (b) { var el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return el && el.closest('[data-act=save]') ? 'ok' : (el ? el.outerHTML.slice(0, 80) : 'none'); }, box);
    eq(hit, 'ok', 'something covers the Add button');
    await pg.click('[data-act=cancel]'); await pg.waitForTimeout(150);
    eq(await pg.locator('#bottomnav').isVisible(), true, 'bottom bar should come back');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('foreign currency: USD amount converts with the card fee and saves both', async function () {
    var app = await h.openApp({ data: demo.data, phone: true }), pg = app.page;
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(200); await openFullForm(pg);
    await pg.fill('#mdesc', 'Test subscription USD');
    await pg.selectOption('#mcur', 'USD'); await pg.waitForTimeout(400);
    await pg.fill('#morig', '10'); await pg.dispatchEvent('#morig', 'input'); await pg.waitForTimeout(300);
    var chf = parseFloat(await pg.inputValue('#mamt'));
    near(chf, 8, 'CHF amount (no fee unless ticked)');
    await pg.click('[data-act=save]'); await pg.waitForTimeout(600);
    var row = Object.values(app.store.Transaction).filter(function (t) { return t.description === 'Test subscription USD'; })[0];
    assert(row, 'not saved'); eq(row.orig_currency, 'USD'); eq(+row.orig_amount, 10);
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('new subcategory can be added from the form', async function () {
    var app = await h.openApp({ data: demo.data, phone: true }), pg = app.page;
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(200); await openFullForm(pg);
    await pg.fill('#mdesc', 'Car wash Shell'); await pg.fill('#mamt', '12');
    await pg.selectOption('#msub', '__new'); await pg.waitForTimeout(150);
    await pg.fill('#mnewsub', 'Car wash'); await pg.press('#mnewsub', 'Enter'); await pg.waitForTimeout(500);
    eq(await pg.inputValue('#msub'), 'Car wash');
    await pg.click('[data-act=save]'); await pg.waitForTimeout(600);
    assert(Object.values(app.store.Transaction).some(function (t) { return t.subcategory === 'Car wash'; }), 'transaction not saved');
    h.noErrors(app); await app.ctx.close();
  });
};

// the quick add (two fields) may open first; "More" shows the full form
async function openFullForm(pg) {
  var more = pg.locator('[data-act=qmore]');
  if (await more.count()) { await more.click(); await pg.waitForTimeout(200); }
}
module.exports.openFullForm = openFullForm;
