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
  await h.test('a deleted goal stays deleted; one-time jobs never run twice', async function () {
    var data = JSON.parse(JSON.stringify(demo.data));
    data.FinancialGoal.push({ id: '6abcdd8dc07aa2a0e69e164a', name: 'Black Porche', target_amount: 80000, current_amount: 5335.25, saving_pct: 10, deadline: '2036-08-28' });
    data.GoalContribution.push({ id: 'gc1', goal_id: '6abcdd8dc07aa2a0e69e164a', period: '2026-04-10', amount: 48.67, pct: 10, net: 486.73 });
    var app = await h.openApp({ data: data }), pg = app.page; await pg.waitForTimeout(800);
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
