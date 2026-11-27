// Clicks through the main flows on each page with the fake backend.
'use strict';
var h = require('./harness'), { makeDemo } = require('./demo-data'), { openFullForm } = require('./app.test.js');

module.exports = async function () {
  var demo = makeDemo(new Date());
  console.log('\nPage flows');
  await h.test('edit a transaction and save the change', async function () {
    var app = await h.openApp({ data: demo.data, hash: 'transactions' }), pg = app.page;
    await pg.locator('.tx').first().click(); await pg.waitForTimeout(250);
    await pg.fill('#mamt', '123.45'); await pg.click('[data-act=save]'); await h.settled(app);
    h.assert(Object.values(app.store.Transaction).some(function (t) { return +t.amount === 123.45; }), 'edit not saved');
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
  await h.test('a deleted goal stays deleted; one-time jobs never run twice', async function () {
    var data = JSON.parse(JSON.stringify(demo.data));
    data.FinancialGoal.push({ id: '6abcdd8dc07aa2a0e69e164a', name: 'Black Porche', target_amount: 80000, current_amount: 5335.25, saving_pct: 10, deadline: '2036-08-28' });
    data.GoalContribution.push({ id: 'gc1', goal_id: '6abcdd8dc07aa2a0e69e164a', period: '2026-04-10', amount: 48.67, pct: 10, net: 486.73 });
    var app = await h.openApp({ data: data }), pg = app.page; await pg.waitForTimeout(800); await h.settled(app);
    h.assert(!app.store.FinancialGoal['6abcdd8dc07aa2a0e69e164a'], 'Black Porche should be deleted');
    h.eq(Object.keys(app.store.GoalContribution).length, 0, 'its contributions should be deleted');
    var before = app.posts.length;
    // reload twice: the Sheet now returns the flags as numbers; nothing may be written again
    for (var i = 0; i < 2; i++) { await pg.reload(); await pg.waitForTimeout(1200); }
    var again = app.posts.slice(before).filter(function (p) { return p.action !== 'readAll'; });
    h.eq(again.length, 0, 'writes on reload: ' + JSON.stringify(again).slice(0, 200));
    h.assert(!app.store.FinancialGoal['6abcdd8dc07aa2a0e69e164a'], 'Black Porche came back');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('an archived account stays archived when the Sheet returns 1 as a number', async function () {
    var data = JSON.parse(JSON.stringify(demo.data));
    data.Settings.push({ id: 'arch', key: 'acct_archived_nw2', value: '1' });
    var app = await h.openApp({ data: data, hash: 'wealth' });
    h.assert(await app.page.evaluate(function () { return /Archived/i.test(document.getElementById('view').innerText); }), 'archived section missing');
    h.noErrors(app); await app.ctx.close();
  });
  console.log('\nRecurring costs and calendar');
  function withGoogleOne(rise) {
    var data = JSON.parse(JSON.stringify(demo.data)), ymd = require('./demo-data').ymd, t = new Date();
    for (var k = 5; k >= 0; k--) {
      var d = new Date(t.getFullYear(), t.getMonth() - k, Math.min(t.getDate(), 27) - (k === 0 ? 1 : 0));
      data.Transaction.push({ id: 'go' + k, date: ymd(d), description: 'Google One', category: 'Personal Cash', subcategory: 'Subscriptions', amount: k === 0 && rise ? 11.9 : 10.37, type: 'expense', account: 'credit_card' });
    }
    return data;
  }
  await h.test('a recurring price rise is flagged on Home, Budgets and To review; OK clears it', async function () {
    var app = await h.openApp({ data: withGoogleOne(true), phone: true }), pg = app.page;
    h.assert(/Google One/.test(await pg.innerText('#view .palert')), 'no alert on Home');
    h.assert(/\+15%/.test(await pg.innerText('#view .palert')), 'percentage missing');
    await pg.evaluate(function () { location.hash = 'transactions'; }); await pg.waitForTimeout(250);
    h.assert(/To review\s*\d/.test(await pg.innerText('.txtabs')), 'not counted in To review');
    await pg.evaluate(function () { location.hash = 'budgets'; }); await pg.waitForTimeout(300);
    h.assert(await pg.locator('#subwatch .palert').count() === 1, 'no alert on Budgets');
    h.assert(/a year/.test(await pg.innerText('#subwatch')), 'yearly cost missing');
    await pg.click('#subwatch [data-act=priceok]'); await pg.waitForTimeout(600);
    h.eq(await pg.locator('.palert').count(), 0, 'alert should be gone');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('no alert when the price stays the same', async function () {
    var app = await h.openApp({ data: withGoogleOne(false), phone: true });
    h.eq(await app.page.locator('.palert').count(), 0, 'false alarm');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('calendar: busiest day selected, tap a day to see its transactions', async function () {
    var app = await h.openApp({ data: demo.data, phone: true }), pg = app.page;
    await pg.evaluate(function () { location.hash = 'dashboard'; }); await pg.waitForTimeout(200);
    await pg.click('.linkrow[data-nav=calendar]'); await pg.waitForTimeout(300);
    var cells = await pg.locator('.cd').count(); h.assert(cells >= 28 && cells <= 31, 'days in grid: ' + cells);
    h.eq(await pg.locator('.cd.sel').count(), 1, 'busiest day should be selected');
    await pg.click('[data-act=prev]'); await pg.waitForTimeout(300);
    var days = pg.locator('.cd:not([disabled])'); await days.nth(3).click(); await pg.waitForTimeout(250);
    h.eq(await pg.locator('.cd.sel').count(), 1, 'tapped day not selected');
    h.assert(await pg.locator('.wkbars div').count() === 3, 'weekday bars');
    h.noErrors(app); await app.ctx.close();
  });
  console.log('\nSplit and What changed');
  await h.test('split a receipt: this transaction keeps the rest, the other part is saved separately', async function () {
    var app = await h.openApp({ data: demo.data, phone: true }), pg = app.page;
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(200); await openFullForm(pg);
    await pg.fill('#mdesc', 'Migros big shop'); await pg.fill('#mamt', '120');
    await pg.selectOption('#mcat', 'Family Infrastructure'); await pg.waitForTimeout(150);
    await pg.click('[data-act=splitstart]'); await pg.waitForTimeout(200);
    await pg.selectOption('#sp_c0', 'Personal Cash'); await pg.waitForTimeout(150);
    await pg.fill('#sp_a0', '30'); await pg.dispatchEvent('#sp_a0', 'input'); await pg.waitForTimeout(100);
    h.eq((await pg.innerText('#sprest')).trim(), '90.00', 'rest shown');
    await pg.click('[data-act=save]'); await pg.waitForTimeout(900);
    var rows = Object.values(app.store.Transaction).filter(function (t) { return t.description === 'Migros big shop'; });
    h.eq(rows.length, 2, 'parts saved');
    var fam = rows.filter(function (r) { return r.category === 'Family Infrastructure'; })[0], pc = rows.filter(function (r) { return r.category === 'Personal Cash'; })[0];
    h.eq(+fam.amount, 90); h.eq(+pc.amount, 30); h.assert(/split/.test(fam.tags) && /split/.test(pc.tags), 'split tag missing');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('split refuses parts larger than the total', async function () {
    var app = await h.openApp({ data: demo.data, phone: true }), pg = app.page;
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(200); await openFullForm(pg);
    await pg.fill('#mdesc', 'Too much'); await pg.fill('#mamt', '20');
    await pg.click('[data-act=splitstart]'); await pg.waitForTimeout(200); await pg.fill('#sp_a0', '25');
    await pg.click('[data-act=save]'); await pg.waitForTimeout(300);
    h.assert(/add up to more than the total/.test(await pg.innerText('.modal')), 'no error shown');
    h.assert(!Object.values(app.store.Transaction).some(function (t) { return t.description === 'Too much'; }), 'should not save');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('Monthly shows What changed for a finished period', async function () {
    var app = await h.openApp({ data: demo.data, hash: 'monthly' }), pg = app.page;
    await pg.click('[data-act=prev]'); await pg.waitForTimeout(300);
    var t = await pg.innerText('.changed');
    h.assert(/Kept -?\d+% of income/.test(t), 'savings sentence missing: ' + t);
    h.assert(/Biggest single purchase/.test(t), 'biggest purchase missing');
    h.noErrors(app); await app.ctx.close();
  });
  console.log('\nEvening mode');
  await h.test('evening follows the phone, Settings can fix Day or Evening, charts redraw', async function () {
    var app = await h.openApp({ data: demo.data, phone: true, colorScheme: 'dark' }), pg = app.page;
    var bg = function () { return pg.evaluate(function () { return getComputedStyle(document.body).backgroundColor; }); };
    h.eq(await bg(), 'rgb(31, 34, 33)', 'charcoal ground when the phone is dark');
    h.eq(await pg.evaluate(function () { return document.querySelector('meta[name=theme-color]').content; }), '#1F2221', 'status bar colour');
    await pg.evaluate(function () { location.hash = 'settings'; }); await pg.waitForTimeout(250);
    await pg.click('[data-act=theme][data-v=light]'); await pg.waitForTimeout(200);
    h.eq(await bg(), 'rgb(243, 244, 242)', 'Day fixed in Settings');
    await pg.reload(); await pg.waitForTimeout(1000);
    h.eq(await bg(), 'rgb(243, 244, 242)', 'Day remembered after reload');
    await pg.evaluate(function () { location.hash = 'settings'; }); await pg.waitForTimeout(250);
    await pg.click('[data-act=theme][data-v=auto]'); await pg.waitForTimeout(200);
    h.eq(await bg(), 'rgb(31, 34, 33)', 'Automatic back to evening');
    await pg.evaluate(function () { location.hash = 'monthly'; }); await pg.waitForTimeout(600);
    h.assert(await pg.locator('#chMonths').count() === 1, 'monthly chart missing');
    h.noErrors(app); await app.ctx.close();
  });
  console.log('\nSearch and Trends');
  await h.test('search understands words, amounts, years, months and tags, and totals the result', async function () {
    var app = await h.openApp({ data: demo.data, hash: 'transactions' }), pg = app.page;
    var y = String(new Date().getFullYear());
    var expect = await pg.evaluate(function (y) { var l = FF.DATA.Transaction.filter(function (t) { return /parking/i.test(t.description) && t.date.slice(0, 4) === y; }); return { n:l.length, s:Math.round(l.reduce(function (a, t) { return a + +t.amount; }, 0) * 100) / 100 }; }, y);
    await pg.fill('#fq', 'parking ' + y); await pg.dispatchEvent('#fq', 'input'); await pg.waitForTimeout(300);
    var txt = await pg.innerText('.srch');
    h.assert(new RegExp(expect.n + ' results', 'i').test(txt), 'count: ' + txt.slice(0, 80) + ' expected ' + expect.n);
    h.eq(await pg.locator('.tx').count(), expect.n, 'rows shown');
    await pg.fill('#fq', '>500'); await pg.dispatchEvent('#fq', 'input'); await pg.waitForTimeout(300);
    var amts = await pg.evaluate(function () { return FF.DATA.Transaction.filter(function (t) { return +t.amount > 500; }).length; });
    h.eq(await pg.locator('.tx').count(), amts, 'amount filter');
    await pg.fill('#fq', 'parking 2-4'); await pg.dispatchEvent('#fq', 'input'); await pg.waitForTimeout(300);
    h.assert(/2–4/.test(await pg.innerText('.srch')), 'range chip');
    await pg.click('.srch [data-act=qdel][data-i="1"]'); await pg.waitForTimeout(250);
    h.eq(await pg.inputValue('#fq'), 'parking', 'removing a chip edits the search');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('trends: one chart per subcategory, rising first, tap opens its transactions', async function () {
    var app = await h.openApp({ data: demo.data, hash: 'monthly' }), pg = app.page;
    var n = await pg.locator('.tc').count(); h.assert(n >= 3, 'charts: ' + n);
    var kinds = await pg.locator('.tc .tg').allInnerTexts(), order = { rising:0, new:1, steady:2, falling:3 };
    for (var i = 1; i < kinds.length; i++) h.assert(order[kinds[i - 1]] <= order[kinds[i]], 'not sorted rising first: ' + kinds.join(','));
    await pg.click('[data-act=trendsort][data-v=big]'); await pg.waitForTimeout(200);
    var first = await pg.locator('.tc b').first().innerText();
    await pg.locator('.tc').first().click(); await pg.waitForTimeout(300);
    h.assert(/Transactions/.test(await pg.innerText('#view h1')), 'did not open Transactions');
    h.assert((await pg.locator('.tx').count()) > 0, 'no transactions for ' + first);
    h.noErrors(app); await app.ctx.close();
  });
  console.log('\nSearch and Trends');
  await h.test('search understands words, amounts, years, months and tags, and totals the result', async function () {
    var app = await h.openApp({ data: demo.data, hash: 'transactions' }), pg = app.page;
    var y = String(new Date().getFullYear());
    var expect = await pg.evaluate(function (y) { return FF.DATA.Transaction.filter(function (t) { return /parking/i.test(t.description) && String(t.date).slice(0, 4) === y; }).length; }, y);
    await pg.fill('#fq', 'parking ' + y); await pg.dispatchEvent('#fq', 'input'); await pg.waitForTimeout(300);
    var txt = await pg.innerText('.srch');
    h.assert(new RegExp(expect + ' results', 'i').test(txt), 'count: ' + txt.slice(0, 80) + ' expected ' + expect);
    h.eq(await pg.locator('.tx').count(), expect, 'rows shown');
    await pg.fill('#fq', '>500'); await pg.dispatchEvent('#fq', 'input'); await pg.waitForTimeout(300);
    var amts = await pg.evaluate(function () { return FF.DATA.Transaction.filter(function (t) { return +t.amount > 500; }).length; });
    h.eq(await pg.locator('.tx').count(), amts, 'amount filter');
    await pg.fill('#fq', 'parking 2-4'); await pg.dispatchEvent('#fq', 'input'); await pg.waitForTimeout(300);
    h.assert(/2–4/.test(await pg.innerText('.srch')), 'range chip');
    await pg.click('.srch [data-act=qdel][data-i="1"]'); await pg.waitForTimeout(250);
    h.eq(await pg.inputValue('#fq'), 'parking', 'removing a chip edits the search');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('trends: one chart per subcategory, rising first, tap opens its transactions', async function () {
    var app = await h.openApp({ data: demo.data, hash: 'monthly' }), pg = app.page;
    var n = await pg.locator('.tc').count(); h.assert(n >= 3, 'charts: ' + n);
    var kinds = await pg.locator('.tc .tg').allInnerTexts(), order = { rising:0, new:1, steady:2, falling:3 };
    for (var i = 1; i < kinds.length; i++) h.assert(order[kinds[i - 1]] <= order[kinds[i]], 'not sorted rising first: ' + kinds.join(','));
    await pg.click('[data-act=trendsort][data-v=big]'); await pg.waitForTimeout(200);
    await pg.locator('.tc').first().click(); await pg.waitForTimeout(300);
    h.assert((await pg.locator('.tx').count()) > 0, 'tapping a chart should list its transactions');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('quick add on a phone: Add, category, tags and the owe button sit above the keyboard', async function () {
    var app = await h.openApp({ data: demo.data, phone: true }), pg = app.page;
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(200);
    await pg.fill('#mdesc', 'Training shorts'); await pg.fill('#mamt', '45'); await pg.waitForTimeout(300);
    var kbTop = (await pg.evaluate(function () { return innerHeight; })) - 300;   // an iPhone keyboard is about 300 px tall
    for (var sel of ['[data-act=save]', '.qsum', '#mtagchips', '.owebtn']) {
      var b = await pg.locator(sel).first().boundingBox();
      h.assert(b && b.y + b.height <= kbTop, sel + ' ends at ' + (b && Math.round(b.y + b.height)) + ' px, keyboard starts at ' + kbTop);
    }
    h.eq(await pg.locator('[data-act=save]').count(), 1, 'one Add button');
    await pg.check('#mowe'); await pg.waitForTimeout(200);
    h.assert(await pg.locator('.owebtn.on').count() === 1 && await pg.locator('#mowho').isVisible(), 'owe details open after tapping the button');
    await pg.uncheck('#mowe'); await pg.waitForTimeout(200);
    h.eq(await pg.locator('#mowho').count(), 0, 'owe details close again');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('Settings · Say it test: a typed sentence shows what would be filled in', async function () {
    var app = await h.openApp({ data: demo.data, hash: 'settings' }), pg = app.page;
    await pg.fill('#vttext', '45 francs training shorts, hobbies, credit card'); await pg.waitForTimeout(200);
    var t = await pg.innerText('#vtOut');
    h.assert(/45 CHF/.test(t) && /Training shorts/.test(t) && /Hobbies/.test(t) && /Credit card/.test(t), t);
    await pg.click('[data-act=vtmic]'); await pg.waitForFunction(function () { return /mic/i.test(document.getElementById('vtStatus').innerText); }, null, { timeout: 3000 }).catch(function () {});
    h.assert(/mic/i.test(await pg.innerText('#vtStatus')), 'mic status shown');
    h.noErrors(app); await app.ctx.close();
  });
  console.log('\nTo be paid back');
  await h.test('pay for a colleague: full amount counts, Owed line on Home, paid back as a refund', async function () {
    var app = await h.openApp({ data: demo.data, phone: true }), pg = app.page;
    var before = await pg.evaluate(function () { return FF.periodModel(0).totals.expenses; });
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(200);
    await pg.fill('#mdesc', 'Lunch Hiltl'); await pg.fill('#mamt', '50');
    await pg.check('#mowe'); await pg.waitForTimeout(200);
    await pg.fill('#mowho', 'Marco'); await pg.fill('#monote', 'TWINT next week');
    await pg.click('[data-act=save]'); await pg.waitForTimeout(900);
    var tx = Object.values(app.store.Transaction).filter(function (t) { return t.description === 'Lunch Hiltl'; })[0];
    h.assert(tx && /owed/.test(tx.tags), 'saved with #owed');
    var rec = JSON.parse(Object.values(app.store.Settings).filter(function (s) { return s.key === 'owed_' + tx.id; })[0].value);
    h.eq(rec.amount, 25, 'half owed by default'); h.eq(rec.who, 'Marco');
    var after = await pg.evaluate(function () { return FF.periodModel(0).totals.expenses; });
    h.near(after - before, 50, 'the full 50 counts as spent');
    h.assert(/Owed to you/.test(await pg.innerText('.owedline')) && /25/.test(await pg.innerText('.owedline')), 'Owed line on Home');
    await pg.click('.owedline'); await pg.waitForTimeout(300);
    await pg.locator('.tx', { hasText: 'Marco' }).first().click(); await pg.waitForTimeout(300);
    await pg.click('[data-act=owepaid]'); await pg.waitForTimeout(1200);
    var refund = Object.values(app.store.Transaction).filter(function (t) { return t.type === 'refund' && /Paid back by Marco/.test(t.description); })[0];
    h.assert(refund, 'refund saved'); h.eq(+refund.amount, 25); h.eq(refund.subcategory, tx.subcategory, 'same subcategory');
    var tx2 = app.store.Transaction[tx.id]; h.assert(/paid-back/.test(tx2.tags) && !/(^|, )owed(,|$)/.test(tx2.tags), 'tag moved to #paid-back: ' + tx2.tags);
    var net = await pg.evaluate(function () { return FF.periodModel(0).totals.expenses; });
    h.near(net - before, 25, 'only your share counts in the end');
    await pg.evaluate(function () { location.hash = 'dashboard'; }); await pg.waitForTimeout(300);
    h.eq(await pg.locator('.owedline').count(), 0, 'nothing owed any more');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('part payment keeps the rest owed; write off settles it', async function () {
    var app = await h.openApp({ data: demo.data, phone: true }), pg = app.page;
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(200);
    await pg.fill('#mdesc', 'Concert tickets'); await pg.fill('#mamt', '80');
    await pg.check('#mowe'); await pg.waitForTimeout(150); await pg.click('[data-act=owemode][data-v=all]'); await pg.waitForTimeout(150);
    await pg.fill('#mowho', 'Sara'); await pg.click('[data-act=save]'); await pg.waitForTimeout(800);
    await pg.click('.owedline'); await pg.waitForTimeout(300); await pg.locator('.tx', { hasText: 'Sara' }).first().click(); await pg.waitForTimeout(300);
    await pg.click('[data-act=pbmode][data-v=part]'); await pg.waitForTimeout(150); await pg.fill('#mpbamt', '30');
    await pg.click('[data-act=owepaid]'); await pg.waitForTimeout(1000);
    await pg.evaluate(function () { location.hash = 'dashboard'; }); await pg.waitForTimeout(300);
    h.assert(/50\.00/.test(await pg.innerText('.owedline')), 'still owes 50: ' + await pg.innerText('.owedline'));
    await pg.click('.owedline'); await pg.waitForTimeout(300); await pg.locator('.tx', { hasText: 'Sara' }).first().click(); await pg.waitForTimeout(300);
    await pg.click('[data-act=owewriteoff]'); await pg.waitForTimeout(900);
    await pg.evaluate(function () { location.hash = 'dashboard'; }); await pg.waitForTimeout(300);
    h.eq(await pg.locator('.owedline').count(), 0, 'written off: nothing owed');
    var t = Object.values(app.store.Transaction).filter(function (x) { return x.description === 'Concert tickets'; })[0];
    h.assert(/written-off/.test(t.tags), 'tag #written-off');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('owed amount larger than the payment is refused', async function () {
    var app = await h.openApp({ data: demo.data, phone: true }), pg = app.page;
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(200);
    await pg.fill('#mdesc', 'Taxi'); await pg.fill('#mamt', '20'); await pg.check('#mowe'); await pg.waitForTimeout(150);
    await pg.click('[data-act=owemode][data-v=other]'); await pg.waitForTimeout(150); await pg.fill('#moweamt', '30'); await pg.fill('#mowho', 'Ana');
    await pg.click('[data-act=save]'); await pg.waitForTimeout(300);
    h.assert(/more than what you paid/.test(await pg.innerText('.modal')), 'no error');
    h.noErrors(app); await app.ctx.close();
  });
  console.log('\nUndo and Recently deleted');
  await h.test('deleting a transaction can be undone, with the same id', async function () {
    var app = await h.openApp({ data: demo.data, phone: true, hash: 'transactions' }), pg = app.page;
    var row = pg.locator('.tx').first(); await row.click(); await pg.waitForTimeout(250);
    var desc = await pg.inputValue('#mdesc');
    var before = Object.keys(app.store.Transaction).length;
    await pg.click('[data-act=del]'); await pg.click('[data-act=delyes]'); await pg.waitForTimeout(700);
    h.eq(Object.keys(app.store.Transaction).length, before - 1, 'not deleted');
    h.assert(await pg.locator('.toast.undo button').count() === 1, 'no Undo button');
    await pg.locator('.toast.undo button').click(); await pg.waitForTimeout(700);
    h.eq(Object.keys(app.store.Transaction).length, before, 'not restored');
    h.assert(Object.values(app.store.Transaction).some(function (t) { return t.description === desc; }), 'restored row differs');
    h.assert(!Object.values(app.store.Settings).some(function (s) { return /^bin_/.test(s.key); }), 'bin entry should be gone after undo');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('a deleted goal with its contributions comes back from Recently deleted', async function () {
    var data = JSON.parse(JSON.stringify(demo.data));
    data.GoalContribution.push({ id: 'gcx', goal_id: 'g1', period: '2026-04-10', amount: 50, pct: 10, net: 500 });
    var app = await h.openApp({ data: data, hash: 'goals' }), pg = app.page;
    await pg.evaluate(function () { var g = document.querySelector('[data-goal="g1"],[data-id="g1"]'); if (g) g.click(); });
    await pg.waitForTimeout(250);
    if (!(await pg.locator('[data-act=gdel]').count())) { await pg.locator('text=Demo car').first().click(); await pg.waitForTimeout(250); }
    await pg.click('[data-act=gdel]'); await pg.waitForTimeout(100);
    if (await pg.locator('[data-act=gdelyes]').count()) await pg.click('[data-act=gdelyes]');
    await pg.waitForTimeout(800);
    h.assert(!app.store.FinancialGoal.g1 && !app.store.GoalContribution.gcx, 'goal or contribution not deleted');
    await pg.evaluate(function () { location.hash = 'settings'; }); await pg.waitForTimeout(300);
    h.assert(/Goal “Demo car”/.test(await pg.innerText('#view')), 'not listed in Recently deleted');
    h.assert(/with 1 linked row/.test(await pg.innerText('#view')), 'linked row count missing');
    await pg.click('[data-act=binrestore]'); await pg.waitForTimeout(800);
    h.assert(app.store.FinancialGoal.g1 && app.store.GoalContribution.gcx, 'not restored');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('copies older than 30 days are removed', async function () {
    var data = JSON.parse(JSON.stringify(demo.data));
    data.Settings.push({ id: 'old', key: 'bin_old', value: JSON.stringify({ label: 'Old', at: new Date(Date.now() - 31 * 864e5).toISOString(), rows: [{ t: 'Rule', row: { id: 'r9', match: 'x' } }] }) });
    data.Settings.push({ id: 'new', key: 'bin_new', value: JSON.stringify({ label: 'New', at: new Date().toISOString(), rows: [{ t: 'Rule', row: { id: 'r8', match: 'y' } }] }) });
    var app = await h.openApp({ data: data }); await app.page.waitForTimeout(600);
    h.assert(!app.store.Settings.old, 'old copy kept'); h.assert(app.store.Settings.new, 'recent copy removed');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('wealth: month-end update saves a value', async function () {
    var app = await h.openApp({ data: demo.data, hash: 'wealth' }), pg = app.page;
    await pg.locator('[data-act=wupdate]').first().click(); await pg.waitForTimeout(400);
    await pg.fill('#wv_nw1', '21000'); await pg.click('[data-act=wsaveupdate]'); await pg.waitForTimeout(800);
    h.assert(Object.values(app.store.AssetSnapshot || {}).some(function (s) { return s.entry_id === 'nw1' && +s.value === 21000; }), 'snapshot not saved');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('deleting an account with 6 years of month-end values takes 2 requests, not 73, and Undo brings them all back', async function () {
    var data = JSON.parse(JSON.stringify(demo.data));
    data.AssetSnapshot = (data.AssetSnapshot || []).filter(function (s) { return s.entry_id !== 'nw1'; });
    for (var m = 0; m < 72; m++) { var d = new Date(2020, m + 1, 0); data.AssetSnapshot.push({ id: 'snap' + m, entry_id: 'nw1', date: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'), value: 10000 + m * 100, total_invested: 0, exchange_rate: 1 }); }
    var app = await h.openApp({ data: data, hash: 'wealth' }), pg = app.page;
    var n0 = app.gas.log.length;
    await pg.locator('[data-act=weditacct][data-id=nw1]').first().click(); await pg.waitForTimeout(250);
    await pg.click('[data-act=wdel]'); await pg.waitForTimeout(150); await pg.click('[data-act=wdelyes]'); await pg.waitForTimeout(1500);
    h.eq(Object.values(app.store.AssetSnapshot).filter(function (s) { return s.entry_id === 'nw1'; }).length, 0, 'month-end values left');
    h.assert(!app.store.NetWorthEntry.nw1, 'account not deleted');
    var reqs = app.gas.log.slice(n0).filter(function (x) { return /delete/.test(x.action); });
    h.assert(reqs.length <= 2, reqs.length + ' delete requests to the Sheet');
    await pg.locator('.toast.undo button').click(); await pg.waitForTimeout(1200);
    h.eq(Object.values(app.store.AssetSnapshot).filter(function (s) { return s.entry_id === 'nw1'; }).length, 72, 'month-end values restored');
    h.eq(app.store.AssetSnapshot.snap5.date, '2020-06-30', 'dates survive the round trip');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('the fake Sheet converts like Google: "1" → 1, dates, TRUE; Settings text and JSON come back as written', async function () {
    var { FakeGas } = require('./fake-gas'), g = new FakeGas(); g.setup();
    g.seed({ Settings: [{ id: 's1', key: 'job_x', value: '1' }, { id: 's2', key: 'owed_t', value: '{"amount":25}' }, { id: 's3', key: 'price_ok_x', value: '2026-11-13' }],
      NetWorthEntry: [{ id: 'n1', name: 'X', is_liability: 'TRUE', current_value: '12.5' }] });
    var s = g.snapshot();
    h.eq(s.Settings.s1.value, 1, 'a 1 typed as text comes back as a number'); h.eq(s.Settings.s2.value, '{"amount":25}', 'JSON value'); h.eq(s.Settings.s3.value, '2026-11-13', 'date value');
    h.eq(s.NetWorthEntry.n1.is_liability, true); h.eq(s.NetWorthEntry.n1.current_value, 12.5);
    var r = g.post(JSON.stringify({ action: 'upsertMany', key: 'test-key', table: 'Rule', rows: Array.from({ length: 2000 }, function (_, i) { return { match: 'm' + i }; }) }));
    h.assert(!r.timeout && r.ms < 10000, 'a 2000-row save should be one quick write, took ' + r.ms + ' ms');
    var bad = g.post(JSON.stringify({ action: 'readAll', key: 'nope' }));
    h.assert(/Wrong or missing access key/.test(bad.body), 'wrong key accepted');
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
    h.assert(/net worth/i.test(await pg.innerText('#view')), 'net worth link did not open Wealth');
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
    await h.settled(app); app.state.offline = true;
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
  await h.test('a refused save (Sheet answers with an error for that row) says “Not saved” and keeps nothing', async function () {
    var app = await h.openApp({ data: demo.data, phone: true }), pg = app.page; await h.settled(app);
    await pg.route('**/script.google.com/**', function (r) {
      var b = JSON.parse(r.request().postData() || '{}');
      return b.action === 'batch' ? r.fulfill({ body: JSON.stringify({ ok: true, results: b.ops.map(function () { return { ok: false, error: 'Unknown table: X' }; }) }), contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } }) : r.fallback();
    });
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(200); await openFullForm(pg);
    await pg.fill('#mdesc', 'Will fail'); await pg.fill('#mamt', '1'); await pg.click('[data-act=save]'); await pg.waitForTimeout(700);
    h.eq(await pg.evaluate(function () { return JSON.parse(localStorage.getItem('ff_outbox_v1') || '[]').length; }), 0, 'should not wait');
    h.assert(/Not saved/.test(await pg.innerText('body')), 'no “Not saved” message');
    await pg.evaluate(function () { location.hash = 'transactions'; }); await pg.waitForTimeout(300);
    h.eq(await pg.locator('.tx', { hasText: 'Will fail' }).count(), 0, 'refused row still on screen');
    await app.ctx.close();
  });
  await h.test('fast sync: when the whole Sheet is busy, the change waits on the phone and goes later', async function () {
    var app = await h.openApp({ data: demo.data, phone: true }), pg = app.page, busy = true; await h.settled(app);
    await pg.route('**/script.google.com/**', function (r) { return busy && r.request().method() === 'POST' ? r.fulfill({ body: JSON.stringify({ ok: false, error: 'The Sheet is busy with another save' }), contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } }) : r.fallback(); });
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(200); await openFullForm(pg);
    await pg.fill('#mdesc', 'Busy day'); await pg.fill('#mamt', '7'); await pg.click('[data-act=save]'); await pg.waitForTimeout(700);
    h.eq(await pg.evaluate(function () { return JSON.parse(localStorage.getItem('ff_outbox_v1') || '[]').length; }), 1, 'kept on the phone');
    busy = false; await pg.evaluate(function () { window.dispatchEvent(new Event('online')); }); await h.settled(app);
    h.eq(Object.values(app.store.Transaction).filter(function (t) { return t.description === 'Busy day'; }).length, 1, 'sent once');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('classic sync: a backend error (not lost signal) still says “Not saved” and keeps nothing', async function () {
    var app = await h.openApp({ data: demo.data, phone: true, classic: true }), pg = app.page;
    await pg.route('**/script.google.com/**', function (r) { return r.request().method() === 'POST' ? r.fulfill({ body: JSON.stringify({ ok: false, error: 'Sheet is locked' }), contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } }) : r.fallback(); });
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(200); await openFullForm(pg);
    await pg.fill('#mdesc', 'Will fail'); await pg.fill('#mamt', '1'); await pg.click('[data-act=save]'); await pg.waitForTimeout(500);
    h.eq(await pg.evaluate(function () { return JSON.parse(localStorage.getItem('ff_outbox_v1') || '[]').length; }), 0, 'should not wait');
    h.assert(/Not saved/.test(await pg.innerText('body')), 'no “Not saved” message');
    await app.ctx.close();
  });
  console.log('\nFast sync');
  await h.test('opening again with nothing changed: the Sheet is not opened, the phone copy is used', async function () {
    var app = await h.openApp({ data: demo.data }), pg = app.page; await h.settled(app);
    var n = app.gas.log.length;
    await pg.reload(); await pg.waitForTimeout(800);
    var reads = app.gas.log.slice(n).filter(function (x) { return /readAll/.test(x.action); });
    h.eq(reads.length, 1, 'one check');
    h.assert(reads[0].ms < 100, 'the check took ' + reads[0].ms + ' ms of Google time; it should not open the Sheet');
    h.assert(await pg.locator('.tx').count() > 0 || /CHF/.test(await pg.innerText('#view')), 'page empty');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('a hand edit in the Sheet is picked up on the next opening', async function () {
    var app = await h.openApp({ data: demo.data, hash: 'transactions' }), pg = app.page; await h.settled(app);
    var id = await pg.locator('.tx').first().getAttribute('data-tx');
    var sh = app.gas.ss.sheets.Transaction, col = sh.rows[0].indexOf('description');
    sh.rows.filter(function (r) { return String(r[0]) === id; })[0][col] = 'Edited by hand'; app.gas.run('onEdit', {}, 'onEdit');
    await pg.reload(); await pg.waitForTimeout(1000);
    h.assert(await pg.locator('.tx', { hasText: 'Edited by hand' }).count() === 1, 'hand edit not shown');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('several quick changes travel in one request, and new rows keep the id made on the phone', async function () {
    var app = await h.openApp({ data: demo.data, hash: 'goals' }), pg = app.page; await h.settled(app);
    var n = app.posts.length;
    await pg.click('[data-act=gnew]'); await pg.waitForTimeout(150);
    await pg.fill('#gname', 'Phone id goal'); await pg.fill('#gtarget', '1000'); await pg.click('[data-act=gsave]');
    var localId = await pg.evaluate(function () { return new Promise(function (ok) { setTimeout(function () { var c = JSON.parse(localStorage.ff_cache_v1); ok((c.data.FinancialGoal.filter(function (g) { return g.name === 'Phone id goal'; })[0] || {}).id); }, 50); }); });
    await h.settled(app);
    var g = Object.values(app.store.FinancialGoal).filter(function (x) { return x.name === 'Phone id goal'; });
    h.eq(g.length, 1, 'goal rows'); h.eq(g[0].id, localId, 'id made on the phone');
    h.assert(g[0].created_date, 'created date missing');
    h.assert(app.posts.slice(n).every(function (p) { return p.action === 'batch'; }), 'all writes go as batches');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('classic sync still works: a new transaction goes straight to the Sheet', async function () {
    var app = await h.openApp({ data: demo.data, phone: true, classic: true }), pg = app.page; await pg.waitForTimeout(600);
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(200); await openFullForm(pg);
    await pg.fill('#mdesc', 'Classic coffee'); await pg.fill('#mamt', '3.9'); await pg.click('[data-act=save]'); await pg.waitForTimeout(700);
    h.assert(app.posts.some(function (p) { return p.action === 'upsert' && p.row && p.row.description === 'Classic coffee'; }), 'not sent the classic way');
    h.eq(Object.values(app.store.Transaction).filter(function (t) { return t.description === 'Classic coffee'; }).length, 1, 'rows in the Sheet');
    h.noErrors(app); await app.ctx.close();
  });
  console.log('\nBehaviour');
  await h.test('Behaviour: flows, the cap with its six checks, wealth by risk, 3a and the suggestion', async function () {
    var data = JSON.parse(JSON.stringify(demo.data));
    var d = new Date(); d.setDate(d.getDate() - 1); var ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    data.Transaction.push({ id: 'cx1', date: ds, description: 'Booster box - Cardmarket', category: 'Collectibles', subcategory: 'TCG Investing', amount: 120, type: 'investment', account: 'credit_card', tags: 'sealed' });
    var app = await h.openApp({ data: data, hash: 'behaviour' }), pg = app.page; await pg.waitForTimeout(800); await h.settled(app, 10000);
    var t = await pg.innerText('#view');
    ['Where it went', 'Collectibles this period', 'Your wealth by risk', 'Safety net and 3a'].forEach(function (x) { h.assert(t.indexOf(x) > -1, x + ' missing'); });
    h.assert(/cap 9% · /.test(t), 'starting share 9%');
    h.eq(app.store.Transaction.cx1.type, 'expense', 'card purchase logged as investment is now spending');
    h.assert(/3A IN \d{4}[\s\S]*7.258 · maxed/i.test(t) || new Date().getFullYear() > 2026, '3a 2026 marked as maxed');
    await pg.click('summary:has-text("How this cap was set")'); await pg.waitForTimeout(150);
    h.eq(await pg.locator('.bh-checks li').count(), 6, 'six checks');
    await pg.click('[data-act=bhview][data-v=avg]'); await pg.waitForTimeout(200);
    h.assert(/Average of the last/.test(await pg.innerText('#view')), 'average view');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('Behaviour labels: moving Collectibles to Personal takes it out of the cap', async function () {
    var data = JSON.parse(JSON.stringify(demo.data));
    var d = new Date(); var ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    data.Transaction.push({ id: 'cx2', date: ds, description: 'Graded card - Ricardo', category: 'Collectibles', subcategory: 'TCG Investing', amount: 300, type: 'expense', account: 'credit_card' });
    var app = await h.openApp({ data: data, hash: 'behaviour' }), pg = app.page; await h.settled(app, 10000);
    var before = await pg.innerText('.bh-big b');
    h.assert(+before.replace(/[^0-9]/g, '') >= 300, 'card counted: ' + before);
    await pg.click('summary:has-text("Labels")'); await pg.waitForTimeout(150);
    await pg.selectOption('select[data-bhlabel="c:Collectibles"]', 'personal'); await h.settled(app);
    h.eq(await pg.innerText('.bh-big b'), '0', 'not in the cap any more');
    h.assert(/"c:Collectibles":"personal"/.test(Object.values(app.store.Settings).filter(function (r) { return r.key === 'behaviour_labels'; })[0].value), 'label saved in the Sheet');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('Behaviour upgrade: log a sale, want list after 48 hours, quick update, buying pattern', async function () {
    var data = JSON.parse(JSON.stringify(demo.data)), t0 = new Date();
    function dstr(n) { var d = new Date(t0); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    for (var i = 0; i < 9; i++) data.Transaction.push({ id: 'pb' + i, date: dstr(i % 3), description: 'TCG Cards - Ricardo', category: 'Collectibles', subcategory: 'TCG Investing', amount: 10 + i * 30, type: 'expense', account: 'credit_card' });
    data.Transaction.push({ id: 'pbf', date: dstr(1), description: 'Cardmarket credit', category: 'Collectibles', subcategory: 'TCG Investing', amount: 50, type: 'expense', account: 'credit_card' });
    data.Settings.push({ id: 'wl', key: 'want_list', value: JSON.stringify([{ id: 'w1', name: 'Test card PSA 10', price: 240, shop: 'Cardmarket', at: new Date(Date.now() - 3 * 864e5).toISOString() }, { id: 'w2', name: 'Fresh ETB', price: 85, shop: 'Ricardo', at: new Date().toISOString() }]) });
    data.NetWorthEntry.push({ id: 'tcg1', name: 'TCG Singles', account_type: 'tcg_investments', currency: 'CHF', current_value: 3000, total_invested: 1000, exchange_rate: 1 });
    var app = await h.openApp({ data: data, hash: 'behaviour' }), pg = app.page; await h.settled(app, 10000);
    var t = await pg.innerText('#view');
    h.assert(/Fewer, better buys/.test(t) || /of 8 buys/.test(t), 'fewer, better buys');
    h.assert(/top-ups \/ fees · 50/.test(t), 'top-up flagged');
    h.assert(/Money in vs value/.test(t), 'money in vs value');
    h.assert(/Want list/.test(t) && /ready /.test(t), 'want list with a waiting item');
    // still want it → add form filled in
    await pg.click('[data-act=bhwbuy][data-id=w1]'); await pg.waitForTimeout(300);
    h.eq(await pg.inputValue('#mdesc'), 'Test card PSA 10 - Cardmarket'); h.eq(await pg.inputValue('#mamt'), '240');
    await pg.click('[data-act=cancel]'); await pg.waitForTimeout(150);
    // changed my mind on the other one → kept
    await pg.click('[data-act=bhwskip][data-id=w2]'); await h.settled(app);
    h.assert(/Skipped in \d{4}: 85 kept/.test(await pg.innerText('#view')), 'kept total');
    // a sale adds to the cap
    var capSel = 'section.bh-card:has-text("Collectibles this period") h3 .r';
    var capBefore = +(await pg.innerText(capSel)).replace(/.*· /, '').replace(/[^0-9]/g, '');
    await pg.click('[data-act=bhsale]'); await pg.fill('#bhfName', 'Old binder'); await pg.fill('#bhfAmt', '120'); await pg.click('[data-act=bhsalesave]'); await h.settled(app);
    h.assert(Object.values(app.store.Transaction).some(function (x) { return x.type === 'refund' && x.category === 'Collectibles' && +x.amount === 120; }), 'sale saved');
    var capAfter = +(await pg.innerText(capSel)).replace(/.*· /, '').replace(/[^0-9]/g, '');
    h.eq(capAfter - capBefore, 120, 'cap grew by the sale');
    // quick update writes Wealth
    await pg.fill('#bhqSpec', '3600'); await pg.click('[data-act=bhqsave]'); await h.settled(app);
    h.eq(+app.store.NetWorthEntry.tcg1.current_value, 3600, 'collection value on Wealth');
    h.assert(Object.values(app.store.AssetSnapshot).some(function (x) { return x.entry_id === 'tcg1' && +x.value === 3600; }), 'snapshot saved');
    await pg.click('summary:has-text("Your buying pattern")'); await pg.waitForTimeout(150);
    h.assert(/are your big days/.test(await pg.innerText('#view')), 'weekday pattern');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('Behaviour day by day: 30 days + 7 scheduled, tap a day, mix by week', async function () {
    var data = JSON.parse(JSON.stringify(demo.data)), t0 = new Date();
    function dstr(n) { var d = new Date(t0); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    data.Transaction.push({ id: 'dd1', date: dstr(-2), description: 'TCG Cards - Cardshow', category: 'Collectibles', subcategory: 'TCG Investing', amount: 265, type: 'expense', account: 'credit_card' });
    data.Transaction.push({ id: 'dd2', date: dstr(3), description: 'Concert tickets', category: 'Personal Cash', subcategory: 'Entertainment', amount: 80, type: 'expense', account: 'credit_card' });
    var app = await h.openApp({ data: data, hash: 'behaviour' }), pg = app.page; await h.settled(app, 10000);
    h.eq(await pg.locator('.bh-dayhit').count(), 37, '30 days and 7 ahead');
    h.assert(await pg.locator('.bh-chart svg rect[fill="url(#bhHatch)"]').count() >= 1, 'scheduled day hatched');
    await pg.locator('.bh-dayhit[data-d="' + dstr(-2) + '"]').click(); await pg.waitForTimeout(200);
    h.assert(/TCG Cards - Cardshow/.test(await pg.innerText('.bh-daybox')), 'day details');
    await pg.locator('.bh-dayhit[data-d="' + dstr(3) + '"]').click(); await pg.waitForTimeout(200);
    h.assert(/scheduled/.test(await pg.innerText('.bh-daybox')) && /Concert tickets/.test(await pg.innerText('.bh-daybox')), 'scheduled day details');
    await pg.click('[data-act=bhchart][data-v=mix]'); await pg.waitForTimeout(200);
    h.assert(/% cards/.test(await pg.innerText('.bh-chart')) || /week of/.test(await pg.innerText('.bh-chart')), 'weekly mix');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('Investing: the pot follows daily spending, the split is yours, a transfer is logged as ETF investing', async function () {
    var app = await h.openApp({ data: demo.data, hash: 'behaviour' }), pg = app.page; await h.settled(app, 10000);
    var t = await pg.innerText('#view');
    h.assert(/Investing this period/.test(t) && /saved so far/.test(t), 'investing card');
    h.eq(await pg.locator('.bh-pot i').count() >= 28, true, 'one bar per day of the period');
    t = await pg.innerText('.bh-inv');
    h.assert(/Available to invest now/i.test(t) && /advised/.test(t) && /Advised this period/.test(t) && /Starting point/.test(t), 'available now with the advised share and its reasons');
    var pick = await pg.locator('.bh-share button:not(.adv)').last().getAttribute('data-v');
    await pg.click('.bh-share button:not(.adv) >> nth=-1'); await h.settled(app);
    h.assert(Object.values(app.store.Settings).some(function (r) { return /^invest_share_/.test(r.key) && String(r.value) === pick; }), 'your own share saved');
    t = await pg.innerText('.bh-inv');
    h.assert(new RegExp('You picked ' + pick + '%').test(t) && (pick !== '100' || /Stays as cash\s*0/.test(t)), 'your share overrides the advice: picked ' + pick + ' · ' + (t.match(/You picked[^.]*/) || ['no-pick'])[0] + ' · ' + (t.match(/Stays as cash[\s\S]{0,12}/) || ['no-cash'])[0]);
    await pg.click('.bh-share button.adv'); await h.settled(app);
    h.assert(!/You picked/.test(await pg.innerText('.bh-inv')), 'back to the advice');
    if (await pg.locator('[data-act=bhinvest]').count()) {
      await pg.click('[data-act=bhinvest]'); await h.settled(app);
      h.assert(Object.values(app.store.Transaction).some(function (x) { return x.description === 'Investing transfer' && x.subcategory === 'ETF Investing'; }), 'transfer logged');
      h.assert(/Moved .* to investing ✓/.test(await pg.innerText('#view')), 'marked as done');
    }
    await pg.evaluate(function () { location.hash = 'ideas'; }); await pg.waitForTimeout(800);
    h.assert(/available to invest now/i.test(await pg.innerText('.id-avail')), 'same figure at the top of Ideas');
    h.noErrors(app); await app.ctx.close();
  });
  console.log('\nIdeas');
  await h.test('Ideas: a code from Claude adds the idea with its view, prices chart from the day mentioned, vs the world ETF', async function () {
    function code(o) { return 'FFIDEA:' + Buffer.from(JSON.stringify(o), 'utf8').toString('base64'); }
    var d0 = new Date(); d0.setDate(d0.getDate() - 40); var ds = d0.toISOString().slice(0, 10);
    var app = await h.openApp({ data: demo.data, hash: 'ideas' }), pg = app.page; await h.settled(app, 10000);
    await pg.click('[data-act=idadd]'); await pg.fill('#idCode', code({ n: 'Novartis', t: 'NOVN.SW', d: ds, s: 'colleague', v: { d: ds, r: 'small', x: '**What it is.** Swiss pharma.\n\n**Against.** Patent cliffs — and “CHF” strength.' } }));
    await pg.click('[data-act=idpaste]'); await h.settled(app); await pg.waitForTimeout(1200);
    var t = await pg.innerText('#view');
    h.assert(/Novartis · NOVN\.SW/.test(t) && /price when mentioned/.test(t) && /since mentioned/.test(t) && /vs world ETF/.test(t), 'detail with facts: ' + t.slice(0, 400));
    h.assert(await pg.locator('.id-chart svg circle').count() === 1, 'entry marked');
    h.eq(await pg.locator('.id-tab tbody tr').count(), 3, 'world, S&P 500 and SMI');
    h.assert(/S&P 500[\s\S]*SMI/.test(await pg.innerText('.id-tab')) && /-?\d\.\d\d/.test(await pg.innerText('.id-tab')), 'correlation numbers');
    h.eq(await pg.locator('.id-chart svg path').count(), 4, 'idea + three yardstick lines');
    h.assert(/worth a small position/.test(t) && /Patent cliffs — and “CHF” strength/.test(t), 'view kept, accents intact');
    // a second code for the same ticker adds a newer view on top
    await pg.fill('#idCode', code({ n: 'Novartis', t: 'NOVN.SW', d: ds, v: { d: new Date().toISOString().slice(0, 10), r: 'watch', x: 'Valuation caught up.' } }));
    await pg.click('[data-act=idpaste]'); await h.settled(app);
    h.eq(await pg.locator('.id-view').count(), 2, 'two views');
    var rows = Object.values(app.store.Settings).filter(function (r) { return /^idea_/.test(r.key); });
    h.eq(rows.length, 1, 'one idea row in the Sheet');
    // list, then one without a ticker and one with a ticker Yahoo doesn't know
    await pg.click('[data-act=idopen][data-id=""]'); await pg.waitForTimeout(200);
    await pg.click('[data-act=idadd]'); await pg.fill('#idName', 'CHF dividend carry'); await pg.click('[data-act=idsave]'); await h.settled(app);
    h.assert(/No ticker/.test(await pg.innerText('#view')), 'no ticker note');
    await pg.click('[data-act=idopen][data-id=""]'); await pg.click('[data-act=idadd]'); await pg.fill('#idName', 'Mystery'); await pg.fill('#idTicker', 'BADX'); await pg.click('[data-act=idsave]'); await h.settled(app); await pg.waitForTimeout(800);
    h.assert(/No prices for BADX/.test(await pg.innerText('#view')), 'unknown ticker explained');
    await pg.click('[data-act=iddel]'); await h.settled(app);
    h.eq(Object.values(app.store.Settings).filter(function (r) { return /^idea_/.test(r.key); }).length, 2, 'deleted');
    await pg.click('[data-act=idopen][data-id=""]').catch(function () {}); await pg.waitForTimeout(200);
    var nBefore = await pg.locator('.id-li').count();
    await pg.locator('.id-li:has-text("CHF dividend carry") .id-x').click(); await h.settled(app);
    h.eq(await pg.locator('.id-li').count(), nBefore - 1, 'deleted from the list');
    var list = await pg.innerText('#view');
    h.assert(/Novartis/.test(list) && /world/.test(list), 'list shows change vs world');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('Ideas inbox: Claude’s file in Drive adds ideas and Friday checks; the app exports its ideas back', async function () {
    var app = await h.openApp({ data: demo.data }), pg = app.page; await h.settled(app, 10000);
    app.gas.drive.push({ id: 'f1', name: 'FlowFin ideas inbox 2026-11-24.json', created: new Date('2026-11-24T16:00:00Z'), text: JSON.stringify({ ideas: [
      { n: 'Invesco QQQ', t: 'QQQ', d: '2026-11-24', s: 'chat', v: { d: '2026-11-24', r: 'small', p: 10, x: '**What it is.** Nasdaq-100.' } },
      { n: 'Meta Platforms', t: 'META', d: '2026-11-24', v: { d: '2026-11-24', r: 'watch', p: 0, x: 'Watch.' } }] }) });
    app.gas.drive.push({ id: 'f2', name: 'FlowFin ideas inbox 2026-11-27 check.json', created: new Date('2026-11-27T21:30:00Z'), text: JSON.stringify({ checks: [
      { t: 'META', d: '2026-11-27', r: 'small', p: 5, price: 590.1, note: 'Capex guidance trimmed.' }, { t: 'QQQ', d: '2026-11-27', r: 'small', p: 10, price: 610 }] }) });
    await pg.evaluate(function () { location.hash = 'ideas'; }); await pg.waitForTimeout(1500); await h.settled(app, 10000);
    var t = await pg.innerText('#view');
    h.assert(/Invesco QQQ/.test(t) && /Meta Platforms/.test(t), 'ideas from the inbox: ' + t.slice(0, 300));
    h.assert(/Your split: core and ideas/.test(t) && /Core · VWRA/.test(t) && /85%/.test(t), 'split: 10% QQQ + 5% META, rest 85%');
    await pg.click('.id-li:has-text("Meta Platforms") .id-row'); await pg.waitForTimeout(400);
    var d = await pg.innerText('#view');
    h.assert(/worth a small position/.test(d) && /changed/.test(d) && /Capex guidance trimmed/.test(d) && /590\.10/.test(d), 'verdict track with the change: ' + d.slice(0, 600));
    var ex = app.gas.drive.filter(function (f) { return f.name === 'FlowFin ideas (from app).json'; })[0];
    h.assert(ex && /QQQ/.test(ex.text), 'ideas exported to Drive for Claude');
    // nothing is imported twice
    await pg.click('[data-act=idopen][data-id=""]'); await pg.click('[data-act=idsync]'); await h.settled(app); await pg.waitForTimeout(300);
    h.eq(Object.values(app.store.Settings).filter(function (r) { return /^idea_/.test(r.key) && !/benchmark/.test(r.key); }).length, 2, 'still two ideas');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('Capitulation gauge: market signs from prices with volume, flow readings from Claude’s Friday file, a weekly score', async function () {
    var app = await h.openApp({ data: demo.data }), pg = app.page; await h.settled(app, 10000);
    var today = new Date().toISOString().slice(0, 10);
    app.gas.drive.push({ id: 'g1', name: 'FlowFin ideas inbox ' + today + ' check.json', created: new Date(), text: JSON.stringify({
      ideas: [{ n: 'Nvidia', t: 'NVDA', d: today, v: { d: today, r: 'small', p: 3, x: 'Small.' } }],
      market: { d: today, items: [{ k: 'vanda', v: 'net selling', p: 15, note: 'fastest selling since March 2020', src: 'Seeking Alpha', url: 'https://example.com/v' }, { k: 'aaii', v: '44%', p: 0 }, { k: 'jpm', v: 'mixed', p: 99 }] } }) });
    await pg.evaluate(function () { location.hash = 'ideas'; }); await pg.waitForTimeout(1500); await h.settled(app, 10000); await pg.waitForTimeout(800);
    var t = await pg.innerText('.cp-card');
    h.assert(/Capitulation gauge/.test(t) && /\/100/.test(t), 'score shown: ' + t.slice(0, 300));
    h.assert(/Volatility \(VIX\)/.test(t) && /Selling-volume flush/.test(t) && /\d\.\d×/.test(t), 'market signs measured, volume used');
    h.assert(/fastest selling since March 2020/.test(t) && /15 \/ 15/.test(t), 'Vanda reading from the file');
    h.assert(/10 \/ 10/.test(t) && !/99/.test(t), 'points capped at the sign’s maximum');
    h.assert(/no data/.test(t), 'BofA missing is shown as no data');
    h.eq(await pg.locator('.cp-weeks i').count(), 12, 'twelve Fridays');
    h.assert(/NVDA/.test(await pg.innerText('.cp-ideas')), 'ideas listed with their own signs');
    h.assert(/\(NVDA\)/.test(await pg.innerText('.cp-act')), 'what it means names the small ideas');
    h.assert(/Backtest · earlier lows since 2019/i.test(await pg.innerText('.cp-card')) && await pg.locator('.cp-bt svg path').count() === 2, 'backtest chart from the S&P 500 and VIX since 2019');
    h.assert(/Now/.test(await pg.innerText('.cp-bttab')), 'today compared with earlier lows');
    var row = Object.values(app.store.Settings).filter(function (r) { return r.key === 'cap_flows'; })[0];
    h.assert(row && /vanda/.test(row.value), 'flow readings saved in the Sheet');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('Capitulation gauge waits for API 7 on an older backend', async function () {
    var app = await h.openApp({ data: demo.data, hash: 'ideas' }), pg = app.page; await h.settled(app, 10000);
    await pg.evaluate(function () { UI.api = 6; location.hash = 'dashboard'; }); await pg.waitForTimeout(200);
    await pg.evaluate(function () { location.hash = 'ideas'; }); await pg.waitForTimeout(500);
    h.assert(/API 7/.test(await pg.innerText('.cp-card')), 'asks for the new Code.gs');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('Where to buy: brokers costed on the same monthly buy, amount switch, monthly check replaces the fee table', async function () {
    var app = await h.openApp({ data: demo.data, hash: 'ideas' }), pg = app.page; await h.settled(app, 10000); await pg.waitForTimeout(500);
    var t = await pg.innerText('.br-card');
    h.assert(/Where to buy/i.test(t) && /Interactive Brokers/.test(t) && /UBS e-banking/.test(t), 'shortlist shown');
    h.eq(await pg.locator('.br-tab tbody tr:not(.br-warn)').count(), 9, 'nine brokers');
    h.assert(/EUR 22,000/.test(t), 'Revolut caveats shown');
    h.assert(/share buy/i.test(t) && /any amount/.test(t) && /no single shares/.test(t), 'single-share cost column');
    await pg.click('[data-act="brmain"][data-v="Yuh"]'); await pg.waitForTimeout(600);
    h.assert(/✓ I use this/.test(await pg.locator('.br-tab tbody tr', { hasText:'Yuh' }).first().innerText()), 'broker choice saved');
    var pick = Object.values(app.store.Settings).filter(function (r) { return r.key === 'broker_main'; })[0];
    h.eq(pick && pick.value, 'Yuh', 'broker_main in the Sheet');
    t = await pg.innerText('.br-card');
    await pg.click('[data-act="bramt"][data-v="3000"]'); await pg.waitForTimeout(200);
    var ib = await pg.locator('.br-tab tbody tr').first().locator('td').nth(2).innerText();
    h.assert(/^18\b/.test(ib.trim()), 'IBKR at CHF 3,000 a month: 12 × CHF 1.50 = 18, got ' + ib);
    var today = new Date().toISOString().slice(0, 10);
    app.gas.drive.push({ id: 'b1', name: 'FlowFin ideas inbox ' + today + ' brokers.json', created: new Date(), text: JSON.stringify({ brokers: { d: today, note: 'Saxo cut its FX fee.',
      list: [{ n: 'Interactive Brokers', fit: 'main', bPct: 0.0005, bMin: 1.5, stamp: false, sub: 'x' }, { n: 'Yuh', have: 1, fit: 'auto', stamp: true, sub: 'y' }, { n: 'NewBank', fit: 'alt', bFlat: 1, stamp: true, sub: 'z' }] } }) });
    await pg.click('[data-act="idsync"]'); await pg.waitForTimeout(1500); await h.settled(app, 10000); await pg.waitForTimeout(500);
    t = await pg.innerText('.br-card');
    h.assert(/NewBank/.test(t) && /Saxo cut its FX fee/.test(t), 'monthly check replaced the table: ' + t.slice(0, 200));
    var row = Object.values(app.store.Settings).filter(function (r) { return r.key === 'brokers_v'; })[0];
    h.assert(row && /NewBank/.test(row.value), 'fee table saved in the Sheet');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('Holdings: paste a buy from the broker, value in CHF, tax sheet with ISIN, linked to its idea, delete with undo', async function () {
    var app = await h.openApp({ data: demo.data, hash: 'ideas' }), pg = app.page; await h.settled(app, 10000);
    await pg.click('[data-act="idview"][data-v="holdings"]'); await pg.waitForTimeout(200);
    h.assert(/Nothing recorded yet/.test(await pg.innerText('#view')), 'empty state');
    await pg.click('[data-act="hdform"]'); await pg.waitForTimeout(200);
    var d = new Date(Date.now() - 10 * 864e5), ds = ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + d.getFullYear();
    await pg.fill('#hd-paste', 'Bought 0.4120 NVDA @ 152.30 USD, commission 0.35 USD, ' + ds); await pg.click('[data-act="hdparse"]'); await pg.waitForTimeout(200);
    h.eq(await pg.inputValue('#hd-t'), 'NVDA', 'ticker read'); h.eq(await pg.inputValue('#hd-sh'), '0.412', 'shares read'); h.eq(await pg.inputValue('#hd-fee'), '0.35', 'fee read');
    await pg.click('[data-act="hdsave"]'); await h.settled(app, 10000); await pg.waitForTimeout(800);
    var row = Object.values(app.store.Settings).filter(function (r) { return /^trade_/.test(r.key); })[0];
    h.assert(row && /"t":"NVDA"/.test(row.value) && /US67066G1040/.test(row.value), 'trade saved with its ISIN');
    var t = await pg.innerText('#view');
    h.assert(/worth today/.test(t) && /NVDA/.test(t) && /NVIDIA Corp\./.test(t), 'holding listed: ' + t.slice(0, 300));
    await pg.click('[data-act="idview"][data-v="tax"]'); await pg.waitForTimeout(300);
    t = await pg.innerText('#hd-tax');
    h.assert(/Tax year/.test(t) && /US67066G1040/.test(t) && /Total/.test(t), 'tax sheet');
    await pg.click('[data-act="idview"][data-v="holdings"]'); await pg.waitForTimeout(200);
    await pg.click('[data-act="hddel"]'); await h.settled(app, 10000);
    h.assert(!Object.values(app.store.Settings).some(function (r) { return /^trade_/.test(r.key); }), 'deleted');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('Payday checklist: appears after the salary, ticks are saved, invest tick logs the transfer, hide and close', async function () {
    var data = JSON.parse(JSON.stringify(demo.data)), sal = data.Transaction.filter(function (x) { return x.type === 'income'; })[0];
    var ts = require('./demo-data').ymd(new Date());
    data.Transaction.push(Object.assign({}, sal, { id:'payday-test', date:ts, amount:8420 }));
    var app = await h.openApp({ data: data, hash: 'dashboard' }), pg = app.page; await h.settled(app, 10000);
    var t = await pg.innerText('.pd-card');
    h.assert(/Payday/.test(t) && /salary [0-9'’]+ in/.test(t) && /Pillar 3a/.test(t), 'card shown: ' + t.slice(0, 200));
    var first = await pg.locator('.pd-step:not(.skip) [data-act="pdtick"]').first().getAttribute('data-k');
    await pg.click('.pd-step:not(.skip) [data-act="pdtick"]'); await h.settled(app);
    var row = Object.values(app.store.Settings).filter(function (r) { return r.key === 'payday_' + ts; })[0];
    h.assert(row && new RegExp('"' + first + '":true').test(row.value), 'tick saved');
    if (await pg.locator('[data-act="pdtick"][data-k="invest"]').count()) { await pg.click('[data-act="pdtick"][data-k="invest"]'); await h.settled(app); }
    await pg.click('[data-act="pdhide"][data-k="spec"]'); await h.settled(app);
    h.assert(!/Collectibles this period/.test(await pg.innerText('.pd-card')), 'hidden step gone');
    await pg.click('[data-act="pdclose"]'); await h.settled(app);
    h.eq(await pg.locator('.pd-card').count(), 0, 'closed for this payday');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('Core and ideas: the core takes at least 70%, ideas are scaled down past it, and a short core gets new money first', async function () {
    var data = JSON.parse(JSON.stringify(demo.data)), td = new Date().toISOString().slice(0, 10);
    var v = function (p) { return JSON.stringify({ id:'x' + p, name:'Idea ' + p, ticker:'T' + p, date:td, views:[{ date:td, verdict:'small', pct:p, text:'x' }], checks:[] }); };
    data.Settings = (data.Settings || []).concat([{ id:'i1', key:'idea_a', value:v(20) }, { id:'i2', key:'idea_b', value:v(20) }]);
    var app = await h.openApp({ data: data, hash: 'ideas' }), pg = app.page; await h.settled(app, 10000); await pg.waitForTimeout(400);
    var t = await pg.innerText('.id-alloc');
    h.assert(/Core · VWRA/.test(t) && /70%/.test(t) && /of 20%/.test(t) && /scaled down/.test(t), 'core 70%, ideas 40% scaled to 30%: ' + t.slice(0, 300));
    await pg.click('[data-act="coremin"][data-v="80"]'); await h.settled(app);
    h.assert(/80%/.test(await pg.innerText('.id-alloc .core')), 'core minimum changed to 80%');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('Ideas: a second mention of the same ticker joins the first: one chart with both marked, each mention reads on its own', async function () {
    var app = await h.openApp({ data: demo.data }), pg = app.page; await h.settled(app, 10000);
    var d1 = new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10), d2 = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
    app.gas.drive.push({ id:'m1', name:'FlowFin ideas inbox a.json', created:new Date(), text:JSON.stringify({ ideas:[{ n:'Alphabet (Google)', t:'GOOGL', d:d1, s:'your idea', v:{ d:d1, r:'small', p:3, x:'First view.' } }] }) });
    await pg.evaluate(function () { location.hash = 'ideas'; }); await pg.waitForTimeout(1500); await h.settled(app, 10000);
    app.gas.drive.push({ id:'m2', name:'FlowFin ideas inbox b.json', created:new Date(), text:JSON.stringify({ ideas:[{ n:'Alphabet (Google)', t:'GOOGL', d:d2, s:'colleague', v:{ d:d2, r:'watch', p:0, x:'Second view.' } }] }) });
    await pg.click('[data-act="idsync"]'); await pg.waitForTimeout(1500); await h.settled(app, 10000); await pg.waitForTimeout(500);
    h.eq(await pg.locator('.id-row', { hasText:'GOOGL' }).count(), 1, 'one idea, not two');
    h.assert(/2 mentions/.test(await pg.locator('.id-row', { hasText:'GOOGL' }).innerText()), 'list says 2 mentions');
    await pg.click('.id-row:has-text("GOOGL")'); await pg.waitForTimeout(800);
    var t = await pg.innerText('#view');
    h.eq(await pg.locator('.id-mention').count(), 2, 'two mentions');
    h.assert(/First view\./.test(await pg.locator('.id-mention').nth(1).innerText()) && /Second view\./.test(await pg.locator('.id-mention').nth(0).innerText()), 'each mention has its own view');
    h.assert(/colleague/.test(t), 'second source shown');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('Wealth over time: months stacked by kind, put in and profit, projection that changes with the horizon, readout on tap', async function () {
    var app = await h.openApp({ data: demo.data, hash: 'wealth' }), pg = app.page; await h.settled(app, 10000); await pg.waitForTimeout(300);
    var t = await pg.innerText('.wo-card');
    h.assert(/Wealth over time/.test(t) && /total profit/.test(t) && /in 5 years/.test(t) && /the projection assumes/i.test(t), 'card: ' + t.slice(0, 300));
    await pg.click('[data-act="woyears"][data-v="10"]'); await pg.waitForTimeout(200);
    h.assert(/in 10 years/.test(await pg.innerText('.wo-card')), 'horizon switch');
    var box = await pg.locator('#woSvg').boundingBox(); await pg.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2); await pg.waitForTimeout(100);
    h.assert(/projected/.test(await pg.innerText('#woRo')), 'readout follows the pointer into the projection');
    h.noErrors(app); await app.ctx.close();
  });
  console.log('\nFor the household');
  await h.test('house button: a card purchase for the family goes to Household with #joint and waits for the joint account', async function () {
    var app = await h.openApp({ data: demo.data, phone: true }), pg = app.page; await h.settled(app, 10000);
    await pg.click('#bottomnav .plus'); await pg.waitForTimeout(200);
    await pg.fill('#mdesc', 'Galaxus desk lamp'); await pg.fill('#mamt', '79.90'); await pg.waitForTimeout(200);
    await pg.check('#mjoint'); await pg.waitForTimeout(200);
    h.assert(/For the household/.test(await pg.innerText('.modal')), 'household note shown');
    await pg.click('[data-act=save]'); await h.settled(app);
    var t = Object.values(app.store.Transaction).filter(function (x) { return x.description === 'Galaxus desk lamp'; })[0];
    h.assert(t, 'saved'); h.eq(t.category, 'Family Infrastructure'); h.assert(/joint/.test(t.tags), 'tagged #joint: ' + t.tags);
    await pg.evaluate(function () { location.hash = 'owed'; }); await pg.waitForTimeout(400);
    var o = await pg.innerText('#view');
    h.assert(/Joint owes you/.test(o) && /Galaxus desk lamp/.test(o) && /79\.90/.test(o), 'listed as owed by the joint account');
    await pg.click('[data-act=jtpaid]'); await h.settled(app);
    h.assert(Object.values(app.store.Transaction).some(function (x) { return x.type === 'refund' && x.description === 'Joint account transfer' && Math.abs(+x.amount - 79.9) < 0.01; }), 'joint transfer logged');
    h.assert(!/Galaxus desk lamp/.test(await pg.innerText('#view')), 'no longer open');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('history check: double refund, short refund and a refund with no purchase are found', async function () {
    var data = JSON.parse(JSON.stringify(demo.data)), t0 = new Date();
    function dstr(n) { var d = new Date(t0); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    data.Transaction.push(
      { id: 'n1', date: dstr(40), description: 'Nespresso direct debit', category: 'Family Infrastructure', subcategory: 'Groceries', amount: 55, type: 'expense', account: 'credit_card' },
      { id: 'n2', date: dstr(40), description: 'Nespresso refund', category: 'Family Infrastructure', subcategory: 'Groceries', amount: 55, type: 'refund', account: 'debit_card' },
      { id: 'n3', date: dstr(37), description: 'Nespresso refund', category: 'Family Infrastructure', subcategory: 'Groceries', amount: 55, type: 'refund', account: 'debit_card' },
      { id: 'g1', date: dstr(20), description: 'Galaxus household', category: 'Family Infrastructure', subcategory: 'General Household', amount: 27.4, type: 'expense', account: 'credit_card' },
      { id: 'g2', date: dstr(20), description: 'Galaxus refund', category: 'Family Infrastructure', subcategory: 'General Household', amount: 16.9, type: 'refund', account: 'debit_card' },
      { id: 'tr', date: dstr(30), description: 'Train tickets CC', category: 'Family Infrastructure', subcategory: 'Transportation', amount: 60, type: 'refund', account: 'debit_card' });
    var app = await h.openApp({ data: data, hash: 'owed' }), pg = app.page; await pg.waitForTimeout(800); await h.settled(app, 10000); await pg.waitForTimeout(300);
    var o = await pg.innerText('#view');
    h.assert(/Galaxus household[\s\S]*short[\s\S]*10\.50/.test(o), 'Galaxus short 10.50: ' + o.slice(0, 600));
    h.assert(/Paid back twice or not matched/.test(o) && /Nespresso refund/.test(o) && /Train tickets CC/.test(o), 'extras listed');
    await pg.click('[data-act=jtdel][data-id=n3]'); await h.settled(app);
    h.assert(!app.store.Transaction.n3, 'duplicate refund deleted');
    await pg.click('[data-act=jtok][data-id=tr]'); await h.settled(app);
    h.assert(!/Train tickets CC/.test(await pg.innerText('#view')), 'marked fine');
    h.noErrors(app); await app.ctx.close();
  });
  console.log('\nCategories in the Sheet');
  await h.test('first load with the new backend fills the Category tab (incl. your own subcategories)', async function () {
    var data = JSON.parse(JSON.stringify(demo.data));
    data.Settings.push({ id: 'cs', key: 'custom_subs', value: JSON.stringify({ 'Personal Cash': ['Car wash'] }) });
    var app = await h.openApp({ data: data }); await app.page.waitForTimeout(800);
    var rows = Object.values(app.store.Category || {});
    h.assert(rows.length >= 30, 'only ' + rows.length + ' category rows');
    h.assert(rows.some(function (r) { return r.category === 'Personal Cash' && r.subcategory === 'Car wash'; }), 'your own subcategory was not moved');
    h.assert(rows.some(function (r) { return r.category === 'Family Infrastructure' && r.subcategory === 'Mortgage'; }), 'built-in subcategory missing');
    h.assert(Object.values(app.store.Settings).some(function (r) { return r.key === 'job_categories_sheet' && String(r.value) === '1'; }), 'done-flag not set');
    h.eq(app.state.urlKeyReads || 0, 0, 'the key should not travel in the address');
    await app.page.evaluate(function () { location.hash = 'settings'; }); await app.page.waitForTimeout(250);
    h.assert(/Apps Script: up to date/.test(await app.page.innerText('#view')), 'settings should say the Apps Script is up to date');
    h.noErrors(app); await app.ctx.close();
  });
  await h.test('a half-filled Category tab is completed, nothing goes missing meanwhile', async function () {
    var data = JSON.parse(JSON.stringify(demo.data));
    data.Category = [{ id: 'p1', category: 'Family Infrastructure', subcategory: '', sort: 1 }, { id: 'p2', category: 'Family Infrastructure', subcategory: 'Mortgage', sort: 2 }];
    var app = await h.openApp({ data: data, api1: true }), pg = app.page;
    h.eq(Object.keys(app.store.Category).length, 2, 'with the first new script nothing should be written');
    await pg.evaluate(function () { location.hash = 'settings'; }); await pg.waitForTimeout(250);
    h.assert(/needs the latest Code\.gs/.test(await pg.innerText('#view')), 'settings should ask for the latest Code.gs');
    await app.ctx.close();
    var app2 = await h.openApp({ data: data }); await app2.page.waitForTimeout(800);
    var rows = Object.values(app2.store.Category);
    h.eq(rows.length, 30, 'rows in the tab (5 categories + 25 subcategories)');
    h.eq(rows.filter(function (r) { return r.category === 'Family Infrastructure' && r.subcategory === 'Mortgage'; }).length, 1, 'duplicate rows');
    h.noErrors(app2); await app2.ctx.close();
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
