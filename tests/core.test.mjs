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
}
