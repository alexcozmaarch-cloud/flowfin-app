// Unit checks for js/core.js on its own (no browser): periods and THE totals function.
import fs from 'fs'; import vm from 'vm'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8').replace(/^var /gm, 'globalThis.'), { filename: 'config.js' });
globalThis.DATA = { Transaction: [], CategorySettings: [] };
const core = await import(path.join(ROOT, 'js/core.js'));

export default async function (h) {
  console.log('\nCore maths (js/core.js on its own)');
  await h.test('a period runs from the 10th to the 9th', async () => {
    const p = core.periodFor(new Date(2026, 10, 9));
    h.eq(core.ymd(p.start), '2026-10-10'); h.eq(core.ymd(p.end), '2026-11-09');
    const q = core.periodFor(new Date(2026, 0, 10));
    h.eq(core.ymd(q.start), '2027-01-10'.replace('2027', '2026')); h.eq(core.ymd(q.end), '2026-02-09');
    const y = core.periodFor(new Date(2027, 0, 3));   // early January belongs to the December period
    h.eq(core.ymd(y.start), '2026-12-10');
  });
  await h.test('totals: refunds, savings categories and future payments', async () => {
    const cut = new Date(2026, 10, 15);
    const T = core.calcTotals([
      { date: '2026-11-11', type: 'income', category: 'Salary', amount: 9000 },
      { date: '2026-11-12', type: 'expense', category: 'Family Infrastructure', amount: 6700 },
      { date: '2026-11-12', type: 'expense', category: 'Personal Cash', amount: 100 },
      { date: '2026-11-13', type: 'refund', category: 'Personal Cash', amount: 30 },
      { date: '2026-11-13', type: 'expense', category: 'Collectibles', amount: 200 },
      { date: '2026-11-13', type: 'expense', category: 'Retirement 3a', amount: 615 },
      { date: '2026-11-14', type: 'expense', category: 'Financial Investing', amount: 300 },
      { date: '2026-11-20', type: 'expense', category: 'Collectibles', amount: 50 }   // after the cut-off: scheduled
    ], cut, 0, 0);
    h.near(T.expenses, 6770, 'expenses'); h.near(T.netCashFlow, 2230, 'net cash flow');
    h.near(T.collectibles, 200); h.near(T.threeA, 615); h.near(T.financialInvesting, 300); h.near(T.scheduled, 50, 'scheduled');
    h.near(T.netSaved, 2030, 'net saved');
  });
  await h.test('totals: refunds larger than spending never go negative', async () => {
    const T = core.calcTotals([{ date: '2026-11-11', type: 'refund', category: 'Personal Cash', amount: 80 }, { date: '2026-11-11', type: 'expense', category: 'Personal Cash', amount: 20 }], new Date(2026, 10, 30), 0, 0);
    h.near(T.expenses, 0);
  });
  await h.test('text is escaped before it goes into the page', async () => {
    h.eq(core.esc('<b>"Tom & Jerry\'s"</b>'), '&lt;b&gt;&quot;Tom &amp; Jerry&#39;s&quot;&lt;/b&gt;');
  });
  const { parseSpoken } = await import(path.join(ROOT, 'js/voice.js'));
  const vctx = { categories: globalThis.CATEGORIES, today: new Date(2026, 10, 14),
    rules: [{ match: 'apify', category: 'Personal Cash', subcategory: 'Subscriptions' }],
    txs: [{ description: 'Migros', category: 'Family Infrastructure', subcategory: 'Groceries', account: 'debit_card', date: '2026-11-01', type: 'expense' }] };
  await h.test('say it: amount, currency, description, category, account', async () => {
    let r = parseSpoken('45 francs training shorts, hobbies, credit card', vctx);
    h.eq(r.amount, '45'); h.eq(r.currency, 'CHF'); h.eq(r.description, 'Training shorts'); h.eq(r.subcategory, 'Hobbies'); h.eq(r.account, 'credit_card');
    r = parseSpoken('Apify 29 dollars', vctx); h.eq(r.currency, 'USD'); h.eq(r.subcategory, 'Subscriptions', 'rule'); h.eq(r.from, 'rule');
    r = parseSpoken('Migros 82.40 yesterday debit card', vctx); h.eq(r.amount, '82.4'); h.eq(r.subcategory, 'Groceries', 'history'); h.eq(r.date, '2026-11-13'); h.eq(r.account, 'debit_card');
    r = parseSpoken('spent 18,50 on drinks', vctx); h.eq(r.amount, '18.5'); h.eq(r.subcategory, 'Drinks');
    r = parseSpoken('I paid 12 euros for coffee on Tuesday', vctx); h.eq(r.currency, 'EUR'); h.eq(r.description, 'Coffee'); h.eq(r.subcategory, 'Coffees'); h.eq(r.date, '2026-11-10');
    r = parseSpoken('CHF 1,250 new running watch hashtag running', vctx); h.eq(r.amount, '1250'); h.eq(r.description, 'New running watch'); h.eq(r.tags.join(), 'running');
  });
  await h.test('say it: someone owes me', async () => {
    let r = parseSpoken('Lunch at Hiltl 50 francs, Marco owes me half', vctx);
    h.eq(r.description, 'Lunch at Hiltl'); h.eq(r.subcategory, 'Lunches'); h.eq(r.owe.who, 'Marco'); h.eq(r.owe.mode, 'half');
    r = parseSpoken('Taxi 60 Ana owes me 30', vctx); h.eq(r.amount, '60'); h.eq(r.owe.mode, 'other'); h.eq(r.owe.amount, '30'); h.eq(r.description, 'Taxi');
    r = parseSpoken('Dinner 90 split with ana', vctx); h.eq(r.owe.who, 'Ana');
  });
}
