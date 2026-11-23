// FlowFin · Behaviour: where the money goes against your ranges, a collectibles cap that moves with how you behave,
// wealth by risk, the safety net and 3a. Approved 20.11.2026 (mockup "FlowFin Behaviour Tab", version 3).
// Shared settings and state (DATA, UI, _cache, CATEGORIES …) are globals from js/config.js.
import { saveSetting } from './settings.js';
import { $, addDays, chf0, daysBetween, esc, inPeriod, isInfra, isSalary, monthlyAverages, pd, periodAt, periodFor, periodLabel, roles, today, txs, ymd } from './core.js';
import { topbar } from './nav.js';
import { saveMany, setting, tagsOf } from './transactions.js';
import { normDesc, recurringItems } from './recurring.js';
import { accounts, acctType, isLiab, mkey, monthDate, monthSnaps, snapsByEntry, wealthOn } from './wealth.js';

// ─── the rules (from the 20.11.2026 conversation) ─────────────────────────
var CAP = { start:'2026-11-10', pct:9, min:5, max:12, step:0.5, maxBuys:8 };   // % of take-home; at most 8 purchases a period
var FEE_RE = /credit|top.?up|guthaben|import|customs|zoll|shipping|versand|porto|grading|psa fee|cgc fee/i;   // costs around the cards
var WAIT_H = 48;   // want list: hours before "still want it?"
var WEALTH_CAP = 10;                 // collectibles: long-term line, % of counted wealth
var SAFETY = [3, 6];                 // months of outflows in cash
var THREEA_MAX = 7258;               // per year (2025–2027)
var RANGES = { personal:10, saved:10 };
var ETF_AIM = [20, 40];               // ETFs as a share of counted wealth, over the next years
var ETF_SPLIT = [50, 75, 90, 100];    // share of what you save that goes to ETFs (the rest stays as cash)   // personal ≤ 10% of take-home, saved ≥ 10%

// Spending labels: household, personal, spec (collectibles & other speculative), growth, stable (3a)
var FLOW = [['household', 'Household'], ['personal', 'Personal'], ['spec', 'Collectibles & speculative'], ['growth', 'Investing (growth)'], ['stable', '3a & stable']];
// Wealth labels: safe, stable, idle, growth, spec, out (not counted)
var RISK = [['safe', 'Safe · cash'], ['stable', 'Stable · 3a'], ['idle', 'Idle · pensions'], ['growth', 'Growth · ETFs, funds'], ['spec', 'Speculative · cards, forex'], ['out', 'Not counted']];

function overrides() { try { var v = setting('behaviour_labels', ''); return v ? JSON.parse(v) : {}; } catch (e) { return {}; } }
// A tag wins over a subcategory, a subcategory over a category, a category over the built-in default
function flowLabel(tx, ov, r) {
  ov = ov || overrides(); r = r || roles();
  var tags = tagsOf(tx);
  for (var i = 0; i < tags.length; i++) if (ov['t:' + tags[i].toLowerCase()]) return ov['t:' + tags[i].toLowerCase()];
  if (tx.subcategory && ov['s:' + tx.category + '›' + tx.subcategory]) return ov['s:' + tx.category + '›' + tx.subcategory];
  if (ov['c:' + tx.category]) return ov['c:' + tx.category];
  return defaultFlow(tx, r);
}
function defaultFlow(tx, r) {
  if (tx.category === 'Collectibles') return 'spec';
  if (tx.category === 'Financial Investing') return /forex|crypto|carry/i.test(tx.subcategory || '') ? 'spec' : 'growth';
  if (tx.category === 'Retirement 3a') return 'stable';
  if (isInfra(Object.assign({}, tx, { type:'expense' }), r)) return 'household';
  return 'personal';
}
function riskLabel(e, ov) {
  ov = ov || overrides();
  if (ov['a:' + e.id]) return ov['a:' + e.id];
  var t = e.account_type, kind = acctType(t)[1];
  if (/eleanor/i.test(e.name || '')) return 'out';          // your daughter's portfolio is hers
  if (kind === 'liab' || kind === 'physical') return 'out';  // home, mortgage, car: not counted
  if (kind === 'cash') return 'safe';
  if (t === 'third_pillar') return 'stable';
  if (t === 'private_pension') return 'idle';
  if (t === 'tcg_investments' || /forex|crypto|tcg|card/i.test(e.name || '')) return 'spec';
  return 'growth';
}

// ─── one period ───────────────────────────────────────────────────────────
function shop(d) { var s = String(d || ''), m = s.split(/\s+[-–]\s+/); return (m.length > 1 ? m[m.length - 1] : s.split(/\s+/)[0]).trim().slice(0, 18) || '—'; }
function flowsFor(p, cutoff, ov, r, avgIncome, avgHousehold) {
  var f = { p:p, income:0, salary:0, household:0, personal:0, spec:0, growth:0, stable:0, back:0, refunds:0, buys:[], byLabel:{}, expected:false };
  txs().forEach(function (tx) {
    if (!inPeriod(tx, p) || pd(tx.date) > cutoff) return;
    var a = +tx.amount || 0, lab = flowLabel(tx, ov, r);
    if (tx.type === 'income' || tx.type === 'refund') {
      if (lab === 'spec') { f.back += a; return; }               // a card sold or returned
      if (tx.type === 'income') { f.income += a; if (isSalary(tx, r)) f.salary += a; }
      else { f.refunds += a; if (f[lab] !== undefined) f[lab] -= a; }
      return;
    }
    if (f[lab] === undefined) lab = 'personal';
    f[lab] += a;
    var k = lab + '|' + tx.category + (tx.subcategory ? '›' + tx.subcategory : '');
    f.byLabel[k] = (f.byLabel[k] || 0) + a;
    if (lab === 'spec') f.buys.push(tx);
  });
  // take-home: before this period's salary arrives, use your average so the cap doesn't jump on payday
  f.takeHome = f.salary > 0 ? f.income : Math.max(f.income, avgIncome || 0);
  f.expected = !(f.salary > 0);
  // likewise the household transfer: until it goes out, count your usual one
  if (avgHousehold && f.household <= 0 && cutoff < p.end) { f.household = avgHousehold; f.householdExpected = true; }
  f.specNet = Math.max(0, f.spec - f.back);
  f.left = f.takeHome - f.household - f.personal - f.specNet - f.growth - f.stable;
  var days = {}; f.buys.forEach(function (tx) { days[tx.date] = (days[tx.date] || 0) + 1; });
  f.busyDays = Object.keys(days).filter(function (d) { return days[d] >= 2; }).length;
  // purchases for "fewer, better buys": everything tagged #show on one day counts once (a card show)
  var shows = {}; f.buyCount = 0;
  f.buys.forEach(function (tx) { if (tagsOf(tx).some(function (t) { return t.toLowerCase() === 'show'; })) { if (!shows[tx.date]) { shows[tx.date] = 1; f.buyCount++; } } else f.buyCount++; });
  f.fees = f.buys.filter(function (tx) { return FEE_RE.test(tx.description || ''); }).reduce(function (a, tx) { return a + (+tx.amount || 0); }, 0);
  f.feeCount = f.buys.filter(function (tx) { return FEE_RE.test(tx.description || ''); }).length;
  return f;
}

// wealth by risk on a date (from the Wealth page's month-end values)
function riskOn(date, ov) {
  var w = wealthOn(date, snapsByEntry()), r = { safe:0, stable:0, idle:0, growth:0, spec:0, out:0, total:0 };
  accounts().forEach(function (e) {
    var lab = riskLabel(e, ov), v = w.per[e.id] || 0;
    if (isLiab(e)) { r.out += -v; return; }
    r[lab] = (r[lab] || 0) + v; if (lab !== 'out') r.total += v;
  });
  r.specShare = r.total ? r.spec / r.total * 100 : 0;
  var reach = r.safe + r.growth + r.spec; r.reachShare = reach ? r.spec / reach * 100 : 0;
  return r;
}
function riskNow(ov) {
  var r = { safe:0, stable:0, idle:0, growth:0, spec:0, out:0, total:0, cost:0, list:[] };
  accounts().forEach(function (e) {
    var lab = riskLabel(e, ov), rate = (e.currency && e.currency !== 'CHF') ? (+e.exchange_rate || 1) : 1, v = (+e.current_value || 0) * rate;
    r.list.push({ e:e, lab:lab, v:v });
    if (isLiab(e)) return;
    r[lab] = (r[lab] || 0) + v; if (lab !== 'out') r.total += v;
    if (lab === 'spec') r.cost += (+e.total_invested || 0) * rate;
  });
  r.specShare = r.total ? r.spec / r.total * 100 : 0;
  var reach = r.safe + r.growth + r.spec; r.reachShare = reach ? r.spec / reach * 100 : 0;
  r.overCap = Math.max(0, r.spec - r.total * WEALTH_CAP / 100);
  return r;
}

// ─── the cap, period by period ────────────────────────────────────────────
// Each finished period is judged on five checks; each 👍 adds 0.5% to the next period's share, each 👎 takes 0.5% off.
// Cards sold add 1:1 to that period's cap; going over is borrowed from the next period.
function judge(f, cap, ov, live) {
  var startD = ymd(addDays(f.p.start, -1)), endD = ymd(live ? today() : f.p.end);
  var a = riskOn(startD, ov), b = riskOn(endD, ov), known = b.total > 0 && a.total > 0 && (a.safe !== b.safe || a.spec !== b.spec);
  var checks = [
    { k:'cap', t:'Within the cap', s:f.specNet <= cap ? 'ok' : 'bad', d:chf0(f.specNet) + ' of ' + chf0(cap) },
    { k:'cash', t:'Safety net: cash went up', s:!known ? 'wait' : b.safe > a.safe ? 'ok' : 'bad', d:known ? sg(b.safe - a.safe) : 'needs a Wealth update' },
    { k:'few', t:'Fewer, better buys: at most ' + CAP.maxBuys + ' purchases', s:f.buyCount <= CAP.maxBuys ? 'ok' : 'bad', d:f.buyCount + (live ? ' so far' : '') },
    { k:'share', t:'Collection share didn’t grow', s:f.back >= f.spec && f.spec > 0 ? 'ok' : !known ? 'wait' : b.specShare <= a.specShare ? 'ok' : 'bad',
      d:known ? a.specShare.toFixed(1) + '% → ' + b.specShare.toFixed(1) + '%' : (f.back ? 'sold ' + chf0(f.back) : 'needs a Wealth update') },
    { k:'saved', t:'Saved something', s:live ? 'wait' : f.left > 0 ? 'ok' : 'bad', d:live ? 'decided on the ' + f.p.end.getDate() + 'th' : sg(f.left) }
  ];
  // while the period runs, "within the cap" and "fewer buys" can still change: show them as on track / not
  if (live && checks[0].s === 'ok') checks[0].d += ' · on track';
  var good = checks.filter(function (c) { return c.s === 'ok'; }).length, bad = checks.filter(function (c) { return c.s === 'bad'; }).length;
  return { checks:checks, good:good, bad:bad, delta:(good - bad) * CAP.step };
}
function sg(v) { return (v >= 0 ? '+ ' : '− ') + chf0(Math.abs(v)); }
function clampPct(x) { return Math.max(CAP.min, Math.min(CAP.max, Math.round(x * 2) / 2)); }

function capHistory() {
  var ov = overrides(), r = roles(), av = monthlyAverages(), avg = av.avgIncome, t = today();
  var first = periodFor(pd(CAP.start)), cur = periodFor(t), out = [], pct = CAP.pct, owed = 0;
  for (var s = first.start; s <= cur.start; s = new Date(s.getFullYear(), s.getMonth() + 1, s.getDate())) {
    var p = periodFor(s), live = p.start.getTime() === cur.start.getTime();
    var f = flowsFor(p, live ? t : p.end, ov, r, avg, av.avgInfra);
    var base = f.takeHome * pct / 100, cap = Math.max(0, base + f.back - owed);
    var j = judge(f, cap, ov, live);
    out.push({ p:p, f:f, pct:pct, base:base, borrowed:owed, cap:cap, judge:j, live:live });
    owed = Math.max(0, f.specNet - (base - owed));   // over the cap (sales already netted in specNet)
    pct = clampPct(pct + j.delta);
  }
  return out;
}

// ─── 3a per calendar year: "Retirement 3a" transactions + what you marked as paid elsewhere ──
function threeA(year) {
  var inTx = txs().filter(function (tx) { return tx.category === 'Retirement 3a' && String(tx.date).slice(0, 4) === String(year) && tx.type !== 'refund' && tx.type !== 'income'; })
    .reduce(function (s, tx) { return s + (+tx.amount || 0); }, 0);
  var marked = parseFloat(setting('threea_paid_' + year, 0)) || 0;
  return { year:year, paid:Math.min(THREEA_MAX, inTx + marked), inTx:inTx, marked:marked, max:THREEA_MAX };
}

// ─── whole page model ─────────────────────────────────────────────────────
function behaviourModel() {
  var ov = overrides(), r = roles(), avg = monthlyAverages(), hist = capHistory(), now = hist[hist.length - 1];
  var past = [];
  for (var i = 1; i <= HIST_MONTHS; i++) { var p = periodAt(-i); past.push(flowsFor(p, p.end, ov, r, avg.avgIncome)); }
  var withIncome = past.filter(function (f) { return f.salary > 0; });
  var n = withIncome.length || 1;
  var mean = {}; ['takeHome', 'household', 'personal', 'specNet', 'growth', 'stable', 'left', 'spec', 'back'].forEach(function (k) {
    mean[k] = withIncome.reduce(function (s, f) { return s + f[k]; }, 0) / n;
  });
  var risk = riskNow(ov);
  var outflow = mean.household + mean.personal;
  var months = outflow > 0 ? risk.safe / outflow : 0;
  var year = today().getFullYear();
  var nextPct = clampPct(now.pct + now.judge.delta);
  var usual = past.slice(0, 6).reduce(function (s, f) { return s + f.specNet; }, 0) / Math.max(1, Math.min(6, past.length));
  var ta = threeA(year);
  var redirectTo = ta.paid < ta.max ? '3a' : months < SAFETY[0] ? 'safety' : 'growth';   // 3a first, then the safety net, then ETFs
  var sold = { n:0, sum:0 }, yr = String(today().getFullYear());
  txs().forEach(function (tx) { if ((tx.type === 'refund' || tx.type === 'income') && flowLabel(tx, ov, r) === 'spec' && String(tx.date).slice(0, 4) === yr) { sold.n++; sold.sum += +tx.amount || 0; } });
  var room = Math.max(0, (mean.takeHome - mean.household) / 30);
  var pot = potModel(now, room, past, ov, r);
  return { pot:pot, daily:dailyModel(ov, r, room), sold:sold, pattern:patternModel(ov, r), want:wantList(), money:moneyModel(ov, r, risk), lastUpdate:lastUpdateDays(),
    ov:ov, hist:hist, now:now, past:past, mean:mean, n:withIncome.length, risk:risk, outflow:outflow, months:months,
    threeA:ta, threeANext:threeA(year + 1), nextPct:nextPct, usual:usual, redirect:Math.max(0, Math.round(usual - now.cap)), redirectTo:redirectTo };
}

// ─── page ─────────────────────────────────────────────────────────────────
function pct0(x) { return Math.round(x) + '%'; }
function bar(parts) { var tot = parts.reduce(function (s, x) { return s + Math.max(0, x[1]); }, 0) || 1;
  return parts.filter(function (x) { return x[1] > 0; }).map(function (x) { return '<i class="' + x[0] + '" style="flex:' + (x[1] / tot * 1000).toFixed(0) + '"></i>'; }).join(''); }

function behaviourHTML() {
  var m = behaviourModel(), now = m.now, f = now.f, avgView = UI.bhView === 'avg', src = avgView ? m.mean : f;
  var take = src.takeHome || 0, cap = now.cap;
  var h = topbar('Behaviour', false);
  h += '<p class="soon" style="margin:-4px 0 18px">' + esc(periodLabel(now.p)) + ' · day ' + (daysBetween(now.p.start, today()) + 1) + ' of ' + (daysBetween(now.p.start, now.p.end) + 1) + '</p>';
  h += '<div class="bh">';

  // 1 · where it went
  var rows = [
    ['household', 'Household', src.household, 'fixed', ''],
    ['personal', 'Personal', src.personal, '≤ ' + RANGES.personal + '%', take && src.personal / take * 100 > RANGES.personal ? 'neg' : ''],
    ['spec', 'Collectibles & speculative', avgView ? src.specNet : f.specNet, avgView ? '≤ ' + now.pct + '%' : '≤ ' + chf0(cap), (avgView ? src.specNet > take * now.pct / 100 : f.specNet > cap) ? 'neg' : ''],
    ['invest', 'Invested · 3a', (src.growth || 0) + (src.stable || 0), '', ''],
    ['saved', avgView ? 'Left over' : 'Not spent yet', src.left, '≥ ' + RANGES.saved + '%', avgView && take && src.left / take * 100 < RANGES.saved ? 'neg' : avgView ? 'pos' : '']
  ];
  var mixView = UI.bhChart === 'mix';
  h += '<section class="card bh-card"><h3>Where it went <span class="r">' +
    '<span class="seg2" role="radiogroup" aria-label="Chart"><button role="radio" aria-checked="' + !mixView + '" class="' + (mixView ? '' : 'on') + '" data-act="bhchart" data-v="days">Day by day</button>' +
    '<button role="radio" aria-checked="' + mixView + '" class="' + (mixView ? 'on' : '') + '" data-act="bhchart" data-v="mix">Mix by week</button></span></span></h3>' +
    (mixView ? mixHTML(m.daily) : daysHTML(m.daily, m)) +
    '<div class="bh-sub2"><span class="lbl">' + (avgView ? 'Average period' : 'This period so far') + '</span>' +
    '<span class="seg2" role="radiogroup" aria-label="Totals"><button role="radio" aria-checked="' + !avgView + '" class="' + (avgView ? '' : 'on') + '" data-act="bhview" data-v="now">This period</button>' +
    '<button role="radio" aria-checked="' + avgView + '" class="' + (avgView ? 'on' : '') + '" data-act="bhview" data-v="avg">6-month average</button></span></div>' +
    '<div class="bh-legend">' + rows.map(function (x) {
      var detail = avgView || x[0] === 'saved' ? '' : flowDetail(f, x[0]);
      var line = '<span class="sw ' + x[0] + '"></span><span>' + x[1] + '</span><span class="rng">' + x[3] + '</span><span class="v num ' + x[4] + '">' + (x[2] < 0 ? '−' : '') + chf0(Math.abs(x[2])) + '</span>';
      return detail ? '<details class="bh-row"><summary>' + line + '</summary>' + detail + '</details>' : '<div class="bh-row"><div class="bh-line">' + line + '</div></div>';
    }).join('') + '</div>' +
    '<p class="soon">Take-home ' + chf0(take) + (f.expected && !avgView ? ' (your average until this period’s salary arrives)' : '') + (f.householdExpected && !avgView ? '; household is your usual transfer until it goes out' : '') + '. After the household, ' + chf0(take - src.household) + ' is yours to steer' +
    (take - src.household > 0 ? '; collectibles take ' + pct0((avgView ? src.specNet : f.specNet) / (take - src.household) * 100) + ' of it.' : '.') +
    (avgView ? ' Average of the last ' + m.n + ' periods with a salary.' : '') + '</p></section>';

  // 2 · collectibles cap
  var used = f.specNet, dayN = daysBetween(now.p.start, today()) + 1, len = daysBetween(now.p.start, now.p.end) + 1, pace = cap * dayN / len;
  var shops = {}, tags = {}; f.buys.forEach(function (tx) { var s = shop(tx.description); shops[s] = (shops[s] || 0) + 1; tagsOf(tx).forEach(function (t) { tags[t] = (tags[t] || 0) + 1; }); });
  var allBuys = txs().filter(function (tx) { return flowLabel(tx, m.ov) === 'spec' && tx.type !== 'income' && tx.type !== 'refund' && pd(tx.date) <= today(); }).map(function (tx) { return tx.date; }).sort();
  var last = allBuys.length ? daysBetween(pd(allBuys[allBuys.length - 1]), today()) : null, gap = 0, yr = String(today().getFullYear());
  allBuys.filter(function (d) { return d.slice(0, 4) === yr; }).forEach(function (d, i, a) { if (i) gap = Math.max(gap, daysBetween(pd(a[i - 1]), pd(d)) - 1); });
  var trend = m.past.slice(0, 6).reverse(), tmax = Math.max.apply(null, trend.map(function (x) { return x.specNet; }).concat([cap, 1]));
  h += '<section class="card bh-card"><h3>Collectibles this period <span class="r">cap ' + now.pct + '% · ' + chf0(cap) + '</span></h3>' +
    '<div class="bh-big"><b class="num' + (used > cap ? ' neg' : '') + '">' + chf0(used) + '</b><span>of ' + chf0(cap) + ' · by day ' + dayN + ' the pace line is at ' + chf0(pace) + '</span></div>' +
    '<div class="bh-meter" role="img" aria-label="' + chf0(used) + ' of ' + chf0(cap) + ' used"><span class="fill' + (used > cap ? ' over' : '') + '" style="width:' + Math.min(100, cap ? used / cap * 100 : 0).toFixed(1) + '%"></span><span class="pace" style="left:' + Math.min(100, dayN / len * 100).toFixed(1) + '%"></span></div>' +
    '<div class="bh-scale"><span>0</span><span>pace</span><span>' + chf0(cap) + '</span></div>' +
    '<div class="bh-stats"><div><b class="num">' + f.buys.length + '</b><span>purchases</span></div><div><b class="num">' + (f.buys.length ? chf0(f.spec / f.buys.length) : '—') + '</b><span>average buy</span></div>' +
    '<div><b class="num' + (f.buyCount > CAP.maxBuys ? ' neg' : '') + '">' + f.buyCount + '</b><span>of ' + CAP.maxBuys + ' buys (#show = 1)</span></div></div>' +
    '<div class="bh-stats"><div><b class="num">' + m.sold.n + '</b><span>sold in ' + today().getFullYear() + (m.sold.sum ? ' · ' + chf0(m.sold.sum) : '') + '</span></div>' +
    '<div><b class="num' + (f.feeCount ? ' neg' : '') + '">' + f.feeCount + '</b><span>top-ups / fees' + (f.fees ? ' · ' + chf0(f.fees) : '') + '</span></div>' +
    '<div><b class="num">' + f.busyDays + '</b><span>days with 2+ buys</span></div></div>' +
    '<div class="bh-btns"><button class="btn primary" data-act="bhsale">+ Log a sale</button><button class="btn" data-act="bhwant">+ Want list</button></div>' +
    (UI.bhForm === 'sale' ? formHTML('sale') : UI.bhForm === 'want' ? formHTML('want') : '') +
    (Object.keys(shops).length || Object.keys(tags).length ? '<div class="bh-chips">' + Object.keys(shops).sort(function (a, b) { return shops[b] - shops[a]; }).slice(0, 5).map(function (s) { return '<span class="chip">' + esc(s) + ' ' + shops[s] + '</span>'; }).join('') +
      Object.keys(tags).sort(function (a, b) { return tags[b] - tags[a]; }).slice(0, 4).map(function (t) { return '<span class="chip">#' + esc(t) + ' ' + tags[t] + '</span>'; }).join('') + '</div>' : '') +
    '<div class="lbl">Last 6 periods</div><div class="bh-trend" role="img" aria-label="Collectibles per period">' +
      trend.map(function (x) { return '<div><i class="' + (x.specNet > x.takeHome * now.pct / 100 ? 'hot' : '') + '" style="height:' + Math.round(70 * x.specNet / tmax) + 'px" title="' + chf0(x.specNet) + '"></i><span>' + x.p.start.toLocaleDateString('en-GB', { month:'short' }) + '</span></div>'; }).join('') +
      '<span class="capline" style="bottom:' + (19 + Math.round(70 * cap / tmax)) + 'px"><span>cap ' + chf0(cap) + '</span></span></div>' +
    '<p class="soon">' + (last === null ? 'No purchases yet.' : 'Last buy: ' + (last === 0 ? 'today' : last === 1 ? 'yesterday' : last + ' days ago') + '. Longest gap without a buy this year: ' + gap + ' days.') + '</p>' +
    patternHTML(m.pattern) +
    '<details class="bh-how"' + (UI.bhHow ? ' open' : '') + ' data-act="bhhow"><summary>How this cap was set</summary>' +
      '<dl class="bh-calc"><dt>Your share</dt><dd>' + now.pct + '% of take-home ' + chf0(f.takeHome) + '</dd><dd class="num">' + chf0(now.base) + '</dd>' +
      '<dt>Cards sold</dt><dd>adds 1:1</dd><dd class="num">+ ' + chf0(f.back) + '</dd>' +
      '<dt>Over last time</dt><dd>borrowed back</dd><dd class="num">− ' + chf0(now.borrowed) + '</dd>' +
      '<dt>This period</dt><dd><b>cap</b></dd><dd class="num"><b>' + chf0(cap) + '</b></dd></dl>' +
      '<div class="lbl">Next period’s share · ' + CAP.min + '–' + CAP.max + '%</div><ul class="bh-checks">' +
      now.judge.checks.map(function (c) { return '<li class="' + c.s + '">' + esc(c.t) + ' <span>' + esc(c.d) + '</span></li>'; }).join('') + '</ul>' +
      '<p class="soon">Each + adds ' + CAP.step + '%, each − takes ' + CAP.step + '% off. Right now: <b>' + now.pct + '% → ' + m.nextPct + '%</b> next period (≈ ' + chf0(f.takeHome * m.nextPct / 100) + ').</p>' +
      (m.hist.length > 1 ? '<div class="lbl">Earlier periods</div><ul class="bh-hist">' + m.hist.slice(0, -1).reverse().map(function (x) { return '<li><span>' + esc(periodLabel(x.p)) + '</span><span class="num">' + x.pct + '% · ' + chf0(x.f.specNet) + ' of ' + chf0(x.cap) + '</span><span class="num">' + (x.judge.delta >= 0 ? '+' : '') + x.judge.delta + '%</span></li>'; }).join('') + '</ul>' : '') +
    '</details></section>';

  // 3 · wealth by risk
  var rk = m.risk, cnt = RISK.filter(function (x) { return x[0] !== 'out'; });
  h += '<section class="card bh-card"><h3>Your wealth by risk <span class="r">home not counted</span></h3>' +
    (rk.total ? '<div class="bh-ladder" role="img" aria-label="Wealth by risk">' + bar(cnt.map(function (x) { return ['r-' + x[0], rk[x[0]]]; })) +
      '<span class="cap" style="left:' + (100 - WEALTH_CAP) + '%"><span>' + WEALTH_CAP + '% line</span></span></div>' +
    '<div class="bh-legend">' + cnt.map(function (x) { return '<div class="bh-row"><div class="bh-line"><span class="sw r-' + x[0] + '"></span><span>' + x[1] + '</span><span class="rng' + (x[0] === 'spec' && rk.specShare > WEALTH_CAP ? ' neg' : '') + '">' + pct0(rk[x[0]] / rk.total * 100) + '</span><span class="v num">' + chf0(rk[x[0]]) + '</span></div></div>'; }).join('') + '</div>' +
    '<div class="bh-two"><div class="bh-kpi"><span>ETFs, of all wealth</span><b class="num">' + pct0(rk.total ? rk.growth / rk.total * 100 : 0) + '</b><span>aim ' + ETF_AIM[0] + '–' + ETF_AIM[1] + '% over the next years</span></div>' +
    '<div class="bh-kpi"><span>Collectibles, of all wealth</span><b class="num' + (rk.specShare > WEALTH_CAP ? ' neg' : ' pos') + '">' + pct0(rk.specShare) + '</b><span>line ' + WEALTH_CAP + '%' + (rk.overCap ? ' · ≈ ' + chf0(rk.overCap) + ' over' : ' · within') + '</span></div>' +
      '<div class="bh-kpi"><span>Of what you can reach now</span><b class="num' + (rk.reachShare > 50 ? ' neg' : '') + '">' + pct0(rk.reachShare) + '</b><span>cash, investments, cards; pensions idle</span></div></div>' +
    (rk.cost ? '<p class="soon">Card values are your latest Wealth figures (cost ' + chf0(rk.cost) + '), not sale prices.</p>' : '')
    : '<p class="soon">Add your accounts on Wealth & Assets to see this.</p>') + '</section>';

  h += wantHTML(m.want);
  h += moneyHTML(m);
  h += quickHTML(m);

  // 4 · safety net and 3a
  var ta = m.threeA, full = ta.paid >= ta.max, dleft = daysBetween(today(), new Date(ta.year, 11, 31));
  var monthsCells = ''; for (var i = 1; i <= 6; i++) monthsCells += '<i class="' + (m.months >= i ? 'on' : m.months > i - 1 ? 'part' : '') + (i >= SAFETY[0] ? ' zone' : '') + '"' + (m.months > i - 1 && m.months < i ? ' style="--p:' + Math.round((m.months - i + 1) * 100) + '%"' : '') + '></i>';
  h += '<section class="card bh-card"><h3>Safety net and 3a</h3>' +
    '<div class="lbl">Emergency cash · months covered</div><div class="bh-gauge" role="img" aria-label="' + m.months.toFixed(1) + ' months of ' + SAFETY[1] + '">' + monthsCells + '</div>' +
    '<p class="soon"><b class="num">' + m.months.toFixed(1) + '</b> months of outflows (' + chf0(m.outflow) + ' a month) · target ' + SAFETY[0] + '–' + SAFETY[1] +
      (m.months < SAFETY[0] ? ' · ≈ ' + chf0(SAFETY[0] * m.outflow - m.risk.safe) + ' to reach ' + SAFETY[0] : ' ✓') + '</p>' +
    '<div class="lbl">3a in ' + ta.year + '</div><div class="bh-meter"><span class="fill' + (full ? ' good' : '') + '" style="width:' + Math.min(100, ta.paid / ta.max * 100).toFixed(1) + '%"></span></div>' +
    '<div class="bh-scale"><span' + (full ? ' class="pos"' : '') + '>' + chf0(ta.paid) + (full ? ' · maxed ✓' : '') + '</span><span>' + chf0(ta.max) + '</span></div>' +
    '<p class="soon">' + (full ? 'Next year opens on 1 January: ' + chf0(ta.max / 12) + ' a month gets there.' :
      (today().getMonth() >= 10 ? '<b class="neg">' + dleft + ' days left</b>: ' : '') + chf0(ta.max - ta.paid) + ' still fits in ' + ta.year + '; payments must reach the 3a account by 31 December.') +
      (UI.bh3aEdit ? '' : ' <button type="button" class="linkbtn" data-act="bh3a">' + (ta.marked ? 'Change what was paid outside FlowFin' : 'Paid outside FlowFin?') + '</button>') + '</p>' +
    (UI.bh3aEdit ? '<div class="bh-3a"><label for="bh3aIn">Paid into 3a outside FlowFin in ' + ta.year + '</label><div class="bh-btns"><input id="bh3aIn" inputmode="decimal" value="' + (ta.marked || '') + '" placeholder="' + ta.max + '">' +
      '<button class="btn primary" data-act="bh3asave" data-y="' + ta.year + '">Save</button><button class="btn" data-act="bh3afull" data-y="' + ta.year + '">Maxed</button><button class="btn" data-act="bh3a">Cancel</button></div></div>' : '') + '</section>';

  // 5 · investing: the pot fills with every day under your room, and is split between ETFs and cash
  h += investHTML(m);

  // labels
  h += labelsHTML(m.ov);
  h += '</div>';
  return h;
}

function flowDetail(f, lab) {
  var rows = Object.keys(f.byLabel).filter(function (k) { return k.split('|')[0] === (lab === 'invest' ? 'growth' : lab) || (lab === 'invest' && k.split('|')[0] === 'stable'); })
    .map(function (k) { return [k.split('|')[1], f.byLabel[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
  if (!rows.length) return '';
  var tags = {}; txs().forEach(function (tx) { if (!inPeriod(tx, f.p) || tx.type === 'income' || tx.type === 'refund' || pd(tx.date) > today()) return; var l = flowLabel(tx); if (l === lab || (lab === 'invest' && (l === 'growth' || l === 'stable'))) tagsOf(tx).forEach(function (t) { tags[t] = (tags[t] || 0) + (+tx.amount || 0); }); });
  var tk = Object.keys(tags).sort(function (a, b) { return tags[b] - tags[a]; }).slice(0, 6);
  return '<ul class="bh-sub">' + rows.slice(0, 8).map(function (r) { return '<li><span>' + esc(r[0].replace('›', ' › ')) + '</span><span class="num">' + chf0(r[1]) + '</span></li>'; }).join('') + '</ul>' +
    (tk.length ? '<div class="bh-chips">' + tk.map(function (t) { return '<span class="chip">#' + esc(t) + ' ' + chf0(tags[t]) + '</span>'; }).join('') + '</div>' : '');
}

// ─── investing: no fixed target — what goes to ETFs follows what you actually saved ───
// Each day of the period: your room (take-home minus household, per day) minus what you spent yourself (personal and
// collectibles). The sum so far is the pot; the pace of the days so far projects it to the end of the period.
// The pot is split: your ETF share (50/75/90/100%) to ETFs, the rest stays as cash. ETF buys don't count as spending.
function etfShare() { var v = parseFloat(setting('etf_share', '')); return ETF_SPLIT.indexOf(v) > -1 ? v : 75; }
function potModel(now, room, past, ov, r) {
  var p = now.p, t = today(), len = daysBetween(p.start, p.end) + 1, el = Math.min(len, daysBetween(p.start, t) + 1);
  var perDay = room * 30 / len, spent = 0, days = [];
  for (var i = 0; i < len; i++) days.push({ d:addDays(p.start, i), spent:0, future:i >= el });
  txs().forEach(function (tx) {
    if (!inPeriod(tx, p) || tx.type === 'income' || pd(tx.date) > t) return;
    var lab = flowLabel(tx, ov, r); if (lab !== 'personal' && lab !== 'spec') return;
    var a = (+tx.amount || 0) * (tx.type === 'refund' ? -1 : 1), i = daysBetween(p.start, pd(tx.date));
    if (days[i]) { days[i].spent += a; spent += a; }
  });
  days.forEach(function (x) { x.net = x.future ? 0 : perDay - x.spent; });
  var pot = el * perDay - spent, pace = el ? spent / el : 0, projected = pot + (len - el) * (perDay - pace);
  var share = etfShare(), base = Math.max(0, projected);
  // ETFs logged (Financial Investing › ETF…) this period and this year
  var etfIn = function (from, to) { return txs().filter(function (tx) { var d = pd(tx.date); return d >= from && d <= to && d <= t && flowLabel(tx, ov, r) === 'growth' && tx.type !== 'income' && tx.type !== 'refund'; }).reduce(function (a, tx) { return a + (+tx.amount || 0); }, 0); };
  var yr = new Date(t.getFullYear(), 0, 1);
  // what earlier periods would have given (left over × your share), for the trend
  var hist = past.slice(0, 6).reverse().map(function (f) { return { p:f.p, left:f.left, etf:Math.max(0, f.left) * share / 100 }; });
  return { perDay:perDay, days:days, el:el, len:len, pot:pot, projected:projected, share:share, etf:base * share / 100, cash:base * (100 - share) / 100,
    etfPeriod:etfIn(p.start, p.end), etfYear:etfIn(yr, t), hist:hist, takeHome:now.f.takeHome };
}
function investHTML(m) {
  var P = m.pot, mx = Math.max.apply(null, P.days.map(function (x) { return Math.abs(x.net); }).concat([P.perDay, 1]));
  var bars = P.days.map(function (x) {
    if (x.future) return '<i class="fut" style="height:' + Math.round(34 * P.perDay / mx) + 'px"></i>';
    return '<i class="' + (x.net < 0 ? 'neg' : '') + '" style="height:' + Math.max(1, Math.round(34 * Math.abs(x.net) / mx)) + 'px" title="' + x.d.getDate() + '.' + (x.d.getMonth() + 1) + '.: ' + (x.net < 0 ? '−' : '+') + chf0(Math.abs(x.net)) + '"></i>';
  }).join('');
  var doneKey = 'bh_invest_' + ymd(m.now.p.start), doneV = setting(doneKey, ''), pctTake = P.takeHome ? P.etf / P.takeHome * 100 : 0;
  var hmax = Math.max.apply(null, P.hist.map(function (x) { return Math.abs(x.left); }).concat([1]));
  return '<section class="card bh-card"><h3>Investing this period <span class="r">follows what you save</span></h3>' +
    '<div class="bh-big"><b class="num' + (P.pot < 0 ? ' neg' : ' pos') + '">' + (P.pot < 0 ? '−' : '') + chf0(Math.abs(P.pot)) + '</b><span>saved so far · on pace for <strong class="num">' + (P.projected < 0 ? '−' : '') + chf0(Math.abs(P.projected)) + '</strong> by the ' + m.now.p.end.getDate() + 'th</span></div>' +
    '<div class="bh-pot" role="img" aria-label="Each day: your room minus what you spent">' + bars + '</div>' +
    '<p class="soon">Each day your room (' + chf0(P.perDay) + ') minus what you spent yourself: green adds, red takes away. Household and ETF buys don’t count.</p>' +
    '<div class="lbl">Your split of what you save</div>' +
    '<span class="seg2" role="radiogroup" aria-label="Share to ETFs">' + ETF_SPLIT.map(function (v) { return '<button role="radio" aria-checked="' + (P.share === v) + '" class="' + (P.share === v ? 'on' : '') + '" data-act="bhsplit" data-v="' + v + '">' + v + '% ETFs</button>'; }).join('') + '</span>' +
    '<dl class="bh-money"><dt>To ETFs (IBKR)</dt><dd class="num"><b>' + chf0(P.etf) + '</b></dd><dt>Stays as cash</dt><dd class="num">' + chf0(P.cash) + '</dd>' +
      '<dt>That’s of your take-home</dt><dd class="num">' + pctTake.toFixed(1) + '%</dd>' +
      '<dt>ETFs logged this period · ' + today().getFullYear() + '</dt><dd class="num">' + chf0(P.etfPeriod) + ' · ' + chf0(P.etfYear) + '</dd></dl>' +
    (P.projected <= 0 ? '<p class="soon">On this pace nothing is left for ETFs this period. Every day under your room changes that.</p>' :
      (doneV ? '<p class="pos">Moved ' + chf0(+doneV) + ' to ETFs ✓</p>' : P.pot * P.share / 100 >= 1 ? '<div class="bh-btns"><button class="btn primary" data-act="bhinvest" data-v="' + Math.round(P.pot * P.share / 100) + '">I moved ' + chf0(Math.round(P.pot * P.share / 100)) + ' to ETFs</button></div>' +
        '<p class="soon">The button uses what you’ve saved so far (' + P.share + '% of ' + chf0(P.pot) + '); the full ' + chf0(P.etf) + ' is the end-of-period estimate.</p>' : '')) +
    (P.hist.length ? '<div class="lbl">Earlier periods · what ' + P.share + '% of what was left would have been</div><div class="bh-hbars">' + P.hist.map(function (x) {
      return '<div><i class="' + (x.left < 0 ? 'neg' : '') + '" style="height:' + Math.max(1, Math.round(40 * Math.abs(x.left) / hmax)) + 'px"></i><b class="num">' + (x.left < 0 ? '0' : chf0(x.etf)) + '</b><span>' + x.p.start.toLocaleDateString('en-GB', { month:'short' }) + '</span></div>';
    }).join('') + '</div>' : '') + '</section>';
}

// ─── day by day: the last 30 days, and the next 7 days of scheduled payments ─────
var DAY_KEYS = ['personal', 'spec', 'invest', 'household'];
function dayBucket(lab) { return lab === 'growth' || lab === 'stable' ? 'invest' : lab; }
function dailyModel(ov, r, room) {
  var t = today(), from = addDays(t, -29), to = addDays(t, 7), days = [], idx = {};
  for (var d = from; d <= to; d = addDays(d, 1)) { var k = ymd(d); idx[k] = days.length; days.push({ d:d, key:k, future:d > t, personal:0, spec:0, invest:0, household:0, items:[] }); }
  txs().forEach(function (tx) {
    var i = idx[String(tx.date).slice(0, 10)]; if (i === undefined || tx.type === 'income') return;
    var day = days[i], b = dayBucket(flowLabel(tx, ov, r)), a = +tx.amount || 0;
    if (tx.type === 'refund') a = -a;
    day[b] += a; day.items.push({ name:tx.description || tx.category, amount:a, b:b, sched:day.future });
  });
  // expected recurring payments in the next 7 days (subscriptions, the household transfer…)
  try {
    recurringItems().forEach(function (it) {
      if ((it.status && it.status !== 'active') || it.type === 'income' || it.type === 'refund' || !it.next) return;
      var k = ymd(it.next), i = idx[k]; if (i === undefined || !days[i].future) return;
      if (days[i].items.some(function (x) { return normDesc(x.name) === normDesc(it.name); })) return;
      var b = dayBucket(flowLabel({ category:it.category, subcategory:it.subcategory, tags:'' }, ov, r));
      days[i][b] += +it.amount || 0; days[i].items.push({ name:it.name, amount:+it.amount || 0, b:b, sched:true, approx:true });
    });
  } catch (e) {}
  days.forEach(function (x) { DAY_KEYS.forEach(function (k) { if (x[k] < 0) x[k] = 0; }); x.total = DAY_KEYS.reduce(function (s, k) { return s + x[k]; }, 0); x.free = x.personal + x.spec + x.invest; });
  var past = days.filter(function (x) { return !x.future; });
  var sum = {}; DAY_KEYS.forEach(function (k) { sum[k] = past.reduce(function (s, x) { return s + x[k]; }, 0); });
  return { days:days, past:past, sum:sum, room:room, spendDays:past.filter(function (x) { return x.free > 0.5; }).length };
}
function daysHTML(M, m) {
  var W = 740, H = 236, top = 24, base = 192, n = M.days.length, bw = W / n;
  var vals = M.days.map(function (x) { return x.free + (x.household > 0 ? x.household : 0); }).sort(function (a, b) { return a - b; });
  // the scale follows your ordinary days: anything above about 3× the 90th percentile is cut and labelled
  var p90 = vals[Math.floor(vals.length * 0.9)] || 0, maxv = Math.max(M.room * 3, Math.min(vals[vals.length - 1] || 1, Math.max(p90 * 1.6, 100)));
  var COL = { personal:'var(--s4)', spec:'var(--signal)', invest:'var(--s2)', household:'var(--s3)' };
  var g = '', y = function (v) { return base - v / maxv * (base - top); }, todayX = 0;
  M.days.forEach(function (x, i) {
    var xx = i * bw + 1.5, w = Math.max(2, bw - 3), cur = base, tot = x.total, over = tot > maxv, sc = over ? (base - top - 10) / tot : (base - top) / maxv;
    var bars = '';
    ['personal', 'spec', 'invest', 'household'].forEach(function (k) {
      if (!(x[k] > 0)) return; var hh = x[k] * sc; cur -= hh;
      bars += '<rect x="' + xx.toFixed(1) + '" y="' + cur.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + hh.toFixed(1) + '" fill="' + (x.future ? 'url(#bhHatch)' : COL[k]) + '"/>';
    });
    if (over) bars += '<rect x="' + xx.toFixed(1) + '" y="' + (top + 26) + '" width="' + w.toFixed(1) + '" height="5" fill="var(--bg)"/><text x="' + (xx + w / 2).toFixed(1) + '" y="' + (cur - 5).toFixed(1) + '" text-anchor="middle" class="t">' + chf0(tot) + '</text>';
    if (UI.bhDay === x.key) bars = '<rect x="' + (xx - 1.5).toFixed(1) + '" y="' + (top - 18) + '" width="' + (w + 3).toFixed(1) + '" height="' + (base - top + 18) + '" fill="var(--shade)"/>' + bars;
    g += '<g class="bh-dayhit" data-act="bhday" data-d="' + x.key + '" role="button" tabindex="0" aria-label="' + x.d.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' }) + ': ' + chf0(tot) + (x.future ? ' scheduled' : '') + '">' +
      '<rect x="' + (i * bw).toFixed(1) + '" y="0" width="' + bw.toFixed(1) + '" height="' + (base + 18) + '" fill="transparent"/>' + bars + '</g>';
    if (x.d.getDay() === 1) g += '<text x="' + (xx + w / 2).toFixed(1) + '" y="' + (base + 14) + '" text-anchor="middle" class="t">' + x.d.getDate() + '.' + (x.d.getMonth() + 1) + '.</text>';
    if (!x.future) todayX = (i + 1) * bw;
  });
  var ry = y(M.room);
  g += '<line x1="0" x2="' + todayX.toFixed(1) + '" y1="' + ry.toFixed(1) + '" y2="' + ry.toFixed(1) + '" stroke="var(--ink)" stroke-dasharray="4 3" stroke-width="1.2"/>' +
    '<text x="' + (todayX - 6).toFixed(1) + '" y="' + (ry - 5).toFixed(1) + '" text-anchor="end" class="t">room ' + chf0(M.room) + ' a day</text>' +
    '<line x1="' + todayX.toFixed(1) + '" x2="' + todayX.toFixed(1) + '" y1="' + (top - 18) + '" y2="' + base + '" stroke="var(--ink)" stroke-width="1.5"/><text x="' + (todayX - 4).toFixed(1) + '" y="' + (top - 8) + '" text-anchor="end" class="t">today</text>' +
    '<line x1="0" x2="' + W + '" y1="' + base + '" y2="' + base + '" stroke="var(--ink)"/>';
  var svg = '<div class="bh-chart"><svg viewBox="0 -4 ' + W + ' ' + H + '" role="img" aria-label="Spending per day: last 30 days and the next 7 scheduled">' +
    '<defs><pattern id="bhHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--paper)"/><line x1="0" y1="0" x2="0" y2="6" stroke="var(--s3)" stroke-width="3"/></pattern></defs>' + g + '</svg></div>';
  var keys = '<div class="bh-keys"><span><i class="sw personal"></i>Personal</span><span><i class="sw spec"></i>Collectibles</span><span><i class="sw invest"></i>Invested · 3a</span><span><i class="sw household"></i>Household</span><span><i class="sw sched"></i>Scheduled</span></div>';
  var capNow = m.now.cap, sum = M.sum;
  var tiles = '<div class="bh-tiles"><div><b class="num">' + chf0(sum.household) + '</b><span>household · 30 days</span></div><div><b class="num">' + chf0(sum.personal) + '</b><span>personal</span></div>' +
    '<div><b class="num' + (sum.spec > capNow ? ' neg' : '') + '">' + chf0(sum.spec) + '</b><span>collectibles · cap ' + chf0(capNow) + '</span></div><div><b class="num">' + chf0(sum.invest) + '</b><span>invested · 3a</span></div>' +
    '<div><b class="num">' + M.spendDays + '</b><span>days with spending · ' + (M.past.length - M.spendDays) + ' without</span></div></div>';
  var sel = M.days.filter(function (x) { return x.key === UI.bhDay; })[0], box = '';
  if (sel) {
    box = '<div class="bh-daybox"><div class="bh-dayhead"><b>' + sel.d.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' }) + (sel.future ? ' · scheduled' : '') + '</b><button class="iconbtn" data-act="bhday" data-d="" aria-label="Close">×</button></div>' +
      (sel.items.length ? sel.items.map(function (it) { return '<div><span>' + esc(it.name) + (it.approx ? ' <small>expected</small>' : '') + '</span><span class="num">' + (it.amount < 0 ? '−' : '') + chf0(Math.abs(it.amount)) + '</span></div>'; }).join('') : '<p class="soon">Nothing ' + (sel.future ? 'scheduled' : 'spent') + '.</p>') +
      (!sel.future && sel.free > M.room ? '<div class="soon"><span>Over your room by</span><span class="num neg">' + chf0(sel.free - M.room) + '</span></div>' : '') + '</div>';
  }
  return keys + svg + tiles + box + '<p class="soon">The dashed line is your room: what’s left after the household, spread over 30 days. Tap a day to see what it was. Very tall days are cut, with their amount on top.</p>';
}
function mixHTML(M) {
  // one bar per week (Monday to Sunday), each at 100%: how the mix of your own spending shifts
  var weeks = [], t = today();
  M.past.forEach(function (x) { var mon = addDays(x.d, -((x.d.getDay() + 6) % 7)), k = ymd(mon); var w = weeks.filter(function (q) { return q.k === k; })[0]; if (!w) { w = { k:k, d:mon, personal:0, spec:0, invest:0 }; weeks.push(w); } w.personal += x.personal; w.spec += x.spec; w.invest += x.invest; });
  var W = 740, base = 196, top = 26, bw = W / Math.max(1, weeks.length), g = '';
  weeks.forEach(function (w, i) {
    var tot = w.personal + w.spec + w.invest, x = i * bw + 10, ww = bw - 20, cur = base;
    if (tot <= 0) { g += '<text x="' + (x + ww / 2).toFixed(1) + '" y="' + (base - 6) + '" text-anchor="middle" class="t">no spending</text>'; }
    [['personal', 'var(--s4)'], ['spec', 'var(--signal)'], ['invest', 'var(--s2)']].forEach(function (c) {
      if (!(tot > 0) || !(w[c[0]] > 0)) return; var hh = w[c[0]] / tot * (base - top); cur -= hh;
      g += '<rect x="' + x.toFixed(1) + '" y="' + cur.toFixed(1) + '" width="' + ww.toFixed(1) + '" height="' + hh.toFixed(1) + '" fill="' + c[1] + '"/>';
    });
    g += '<text x="' + (x + ww / 2).toFixed(1) + '" y="' + (top - 8) + '" text-anchor="middle" class="t">' + (tot > 0 ? Math.round(w.spec / tot * 100) + '% cards · ' + chf0(tot) : '') + '</text>' +
      '<text x="' + (x + ww / 2).toFixed(1) + '" y="' + (base + 14) + '" text-anchor="middle" class="t">week of ' + w.d.getDate() + '.' + (w.d.getMonth() + 1) + '.' + (addDays(w.d, 6) > t ? ' (so far)' : '') + '</text>';
  });
  return '<div class="bh-keys"><span><i class="sw personal"></i>Personal</span><span><i class="sw spec"></i>Collectibles</span><span><i class="sw invest"></i>Invested · 3a</span></div>' +
    '<div class="bh-chart"><svg viewBox="0 0 ' + W + ' 214" role="img" aria-label="Share of each week’s own spending by kind">' + g + '</svg></div>' +
    '<p class="soon">Each week at 100%: how the mix of your own spending shifts (household left out). The total is on top, since a quiet week and a big one look alike here.</p>';
}

// ─── purchase sizes and weekdays (all your card buys) ──────────────────────
var BRACKETS = [[0, 25, '< 25'], [25, 50, '25–50'], [50, 100, '50–100'], [100, 200, '100–200'], [200, 1e12, '200 +']];
function patternModel(ov, r) {
  var b = BRACKETS.map(function (x) { return { label:x[2], lo:x[0], hi:x[1], n:0, sum:0 }; }), wd = [0, 0, 0, 0, 0, 0, 0], wn = [0, 0, 0, 0, 0, 0, 0], total = 0, n = 0;
  txs().forEach(function (tx) {
    if (tx.type === 'income' || tx.type === 'refund' || pd(tx.date) > today() || flowLabel(tx, ov, r) !== 'spec') return;
    var a = +tx.amount || 0; total += a; n++;
    b.forEach(function (x) { if (a >= x.lo && a < x.hi) { x.n++; x.sum += a; } });
    var d = (pd(tx.date).getDay() + 6) % 7; wd[d] += a; wn[d]++;
  });
  return { b:b, wd:wd, wn:wn, total:total, n:n };
}
function patternHTML(P) {
  if (P.n < 5) return '';
  var maxN = Math.max.apply(null, P.b.map(function (x) { return x.n; }).concat([1])), maxW = Math.max.apply(null, P.wd.concat([1]));
  var small = P.b[0], big = P.b[4], top2 = P.wd.map(function (v, i) { return [v, i]; }).sort(function (a, b) { return b[0] - a[0]; }).slice(0, 2);
  var DN = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'], DS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  return '<details class="bh-how bh-pattern"' + (UI.bhPattern ? ' open' : '') + ' data-act="bhpattern"><summary>Your buying pattern · ' + P.n + ' purchases</summary>' +
    '<div class="lbl">Size of each buy</div><div class="bh-brk" role="img" aria-label="Purchases by size">' + P.b.map(function (x, i) {
      return '<div><span>' + x.label + '</span><i class="' + (i === 0 && x.n / P.n > .25 ? 'hot' : '') + '" style="width:' + Math.round(x.n / maxN * 100) + '%"></i><span class="num">' + x.n + ' · ' + chf0(x.sum) + '</span></div>'; }).join('') + '</div>' +
    (small.n ? '<p class="soon">Buys under 25 are ' + Math.round(small.n / P.n * 100) + '% of your purchases but ' + Math.round(small.sum / P.total * 100) + '% of the money' + (big.n ? '; the ' + big.n + ' above 200 are ' + Math.round(big.sum / P.total * 100) + '%.' : '.') + '</p>' : '') +
    '<div class="lbl">Day of the week</div><div class="bh-week" role="img" aria-label="Spend by weekday">' + P.wd.map(function (v, i) {
      var hot = i === top2[0][1] || i === top2[1][1];
      return '<div><i class="' + (hot ? 'hot' : '') + '" style="height:' + Math.round(44 * v / maxW) + 'px" title="' + chf0(v) + ' · ' + P.wn[i] + '"></i><span>' + DS[i] + '</span></div>'; }).join('') + '</div>' +
    '<p class="soon">' + DN[top2[0][1]] + ' and ' + DN[top2[1][1]] + ' are your big days (' + Math.round((top2[0][0] + top2[1][0]) / P.total * 100) + '% of the money).</p></details>';
}

// ─── want list: park a card for 48 hours before buying ──────────────────────
function wantList() { try { var v = setting('want_list', ''); return v ? JSON.parse(v) : []; } catch (e) { return []; } }
function saveWant(list) { return saveSetting('want_list', JSON.stringify(list)); }
function wantHTML(list) {
  var open = list.filter(function (w) { return !w.done; }), yr = String(today().getFullYear());
  var kept = list.filter(function (w) { return w.done === 'skipped' && String(w.doneAt || '').slice(0, 4) === yr; }).reduce(function (a, w) { return a + (+w.price || 0); }, 0);
  if (!open.length && !kept && UI.bhForm !== 'want') return '';
  var now = Date.now();
  return '<section class="card bh-card"><h3>Want list <span class="r">' + WAIT_H + ' hours before you buy</span></h3>' +
    (open.length ? '<div class="bh-want">' + open.map(function (w) {
      var ready = now - new Date(w.at).getTime() >= WAIT_H * 3600e3, when = new Date(new Date(w.at).getTime() + WAIT_H * 3600e3);
      return '<div class="bh-wi' + (ready ? ' ready' : '') + '"><div><b>' + esc(w.name) + '</b><small>' + (w.shop ? esc(w.shop) + ' · ' : '') + (ready ? 'parked ' + Math.floor((now - new Date(w.at).getTime()) / 864e5) + ' days ago' :
        'ready ' + when.toLocaleDateString('en-GB', { weekday:'short' }) + ' ' + String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0')) + '</small></div><span class="num">' + chf0(w.price) + '</span>' +
        '<div class="bh-btns">' + (ready ? '<button class="btn primary" data-act="bhwbuy" data-id="' + esc(w.id) + '">Still want it → add</button><button class="btn" data-act="bhwskip" data-id="' + esc(w.id) + '">Skip · keep ' + chf0(w.price) + '</button>'
          : '<button class="btn" data-act="bhwskip" data-id="' + esc(w.id) + '">Changed my mind</button>') + '</div></div>';
    }).join('') + '</div>' : '<p class="soon">Nothing parked. Before your next buy, put it here first.</p>') +
    '<p class="soon">Skipped in ' + yr + ': <b class="pos num">' + chf0(kept) + '</b> kept. “Still want it” opens the add form already filled in.</p></section>';
}

// ─── money in vs value ──────────────────────────────────────────────────────
function moneyModel(ov, r, risk) {
  var spent = 0, fees = 0, back = 0, first = '';
  txs().forEach(function (tx) {
    if (pd(tx.date) > today() || flowLabel(tx, ov, r) !== 'spec') return;
    var a = +tx.amount || 0;
    if (tx.type === 'income' || tx.type === 'refund') { back += a; return; }
    spent += a; if (FEE_RE.test(tx.description || '')) fees += a; if (!first || tx.date < first) first = tx.date;
  });
  return { spent:spent, fees:fees, back:back, first:first, cost:risk.cost, value:risk.spec };
}
function moneyHTML(m) {
  var x = m.money; if (!x.spent && !x.value) return '';
  function row(a, b) { return '<dt>' + a + '</dt><dd class="num">' + b + '</dd>'; }
  var gain = x.value - x.cost;
  return '<section class="card bh-card"><h3>Money in vs value</h3><dl class="bh-money">' +
    row('Spent on collectibles since FlowFin started' + (x.first ? ' (' + pd(x.first).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) + ')' : ''), chf0(x.spent)) +
    row('… of which fees, import, top-ups', chf0(x.fees)) + (x.back ? row('Sold or refunded', '− ' + chf0(x.back)) : '') +
    (x.value ? row('Cost on Wealth (whole collection)', chf0(x.cost)) + row('Value on Wealth', chf0(x.value)) : '') + '</dl>' +
    (x.value ? '<p class="soon">On paper <b class="' + (gain >= 0 ? 'pos' : 'neg') + '">' + (gain >= 0 ? '+' : '−') + chf0(Math.abs(gain)) + '</b>. Selling means platform fees and real sale prices, so expect less.' +
      (x.spent - x.back > x.cost * 0.8 ? ' What FlowFin saw you spend is ' + Math.round((x.spent - x.back) / Math.max(1, x.cost) * 100) + '% of the whole collection’s cost: check that the cost on Wealth includes fees and top-ups.' : '') + '</p>' : '') + '</section>';
}

// ─── quick update: cash and collection value, straight into Wealth ───────────
function lastUpdateDays() { var d = ''; (DATA.AssetSnapshot || []).forEach(function (s) { if (String(s.date) > d) d = String(s.date).slice(0, 10); }); return d ? daysBetween(pd(d), today()) : null; }
function quickHTML(m) {
  var cash = accounts().filter(function (e) { return riskLabel(e, m.ov) === 'safe' && !isLiab(e); }), spec = accounts().filter(function (e) { return riskLabel(e, m.ov) === 'spec' && !isLiab(e) && !/forex|crypto/i.test(e.name || ''); });
  if (!cash.length && !spec.length) return '';
  var main = cash.slice().sort(function (a, b) { return (+b.current_value || 0) - (+a.current_value || 0); })[0];
  var specTot = spec.reduce(function (a, e) { return a + (+e.current_value || 0) * ((e.currency && e.currency !== 'CHF') ? (+e.exchange_rate || 1) : 1); }, 0);
  var stale = m.lastUpdate === null || m.lastUpdate > 20;
  return '<details class="card bh-card bh-quick"' + (UI.bhQuick || stale ? ' open' : '') + ' data-act="bhquick"><summary><h3 style="display:inline">Update cash and cards</h3> <span class="soon">' +
    (m.lastUpdate === null ? 'never updated' : m.lastUpdate === 0 ? 'updated today' : 'last update ' + m.lastUpdate + ' days ago') + '</span></summary>' +
    (main ? '<label class="bh-inp"><span>' + esc(main.name) + ' today</span><input id="bhqCash" inputmode="decimal" placeholder="' + chf0(+main.current_value || 0) + '" data-id="' + esc(main.id) + '"></label>' : '') +
    (spec.length ? '<label class="bh-inp"><span>Collection value' + (spec.length > 1 ? ' (all ' + spec.length + ' accounts)' : '') + '</span><input id="bhqSpec" inputmode="decimal" placeholder="' + chf0(specTot) + '"></label>' : '') +
    '<div class="bh-btns"><button class="btn primary" data-act="bhqsave">Save · goes to Wealth too</button></div>' +
    '<p class="soon">The safety-net and collection-share checks use these. ' + (spec.length > 1 ? 'A new collection total is shared across your card accounts in their current proportions.' : '') + '</p></details>';
}
function quickSave() {
  var ov = overrides(), k = mkey(ymd(today())), d = monthDate(k), have = monthSnaps(k), snaps = [], ents = [];
  function put(e, v) {
    var p = have[e.id], rate = (e.currency && e.currency !== 'CHF') ? (+e.exchange_rate || 1) : 1;
    snaps.push(Object.assign({ entry_id:e.id, date:d, value:v, total_invested:e.total_invested == null ? '' : e.total_invested, exchange_rate:rate }, p ? { id:p.id, created_date:p.created_date } : {}));
    ents.push(Object.assign({}, e, { current_value:v, last_updated:d }));
  }
  var cEl = $('bhqCash'), sEl = $('bhqSpec');
  var cv = cEl && cEl.value.trim() !== '' ? parseFloat(cEl.value.replace(/[' ]/g, '').replace(',', '.')) : null;
  var sv = sEl && sEl.value.trim() !== '' ? parseFloat(sEl.value.replace(/[' ]/g, '').replace(',', '.')) : null;
  if (cv !== null && cv >= 0) { var ce = accounts().filter(function (e) { return e.id === cEl.getAttribute('data-id'); })[0]; if (ce) put(ce, cv); }
  if (sv !== null && sv >= 0) {
    var spec = accounts().filter(function (e) { return riskLabel(e, ov) === 'spec' && !isLiab(e) && !/forex|crypto/i.test(e.name || ''); });   // cards only
    var tot = spec.reduce(function (a, e) { return a + (+e.current_value || 0); }, 0);
    spec.forEach(function (e, i) { put(e, Math.round((tot ? (+e.current_value || 0) / tot * sv : (i ? 0 : sv)) * 100) / 100); });
  }
  if (!snaps.length) return Promise.resolve(false);
  return saveMany('AssetSnapshot', snaps).then(function () { return saveMany('NetWorthEntry', ents); }).then(function () { return true; });
}

// ─── the two small forms: log a sale, park a card ───────────────────────────
function formHTML(kind) {
  var sale = kind === 'sale';
  return '<div class="bh-form"><b>' + (sale ? 'Log a sale' : 'Park a card on the want list') + '</b>' +
    '<label class="bh-inp"><span>' + (sale ? 'What you sold' : 'Card or product') + '</span><input id="bhfName" autocomplete="off"></label>' +
    '<label class="bh-inp"><span>' + (sale ? 'Money received (CHF)' : 'Price (CHF)') + '</span><input id="bhfAmt" inputmode="decimal"></label>' +
    '<label class="bh-inp"><span>' + (sale ? 'Where' : 'Shop') + '</span><input id="bhfShop" autocomplete="off" placeholder="' + (sale ? 'Ricardo' : 'Cardmarket') + '"></label>' +
    '<div class="bh-btns"><button class="btn primary" data-act="' + (sale ? 'bhsalesave' : 'bhwantsave') + '">' + (sale ? 'Save sale' : 'Park it') + '</button><button class="btn" data-act="bhformx">Cancel</button></div>' +
    (UI.bhErr ? '<p class="neg">' + esc(UI.bhErr) + '</p>' : '') + '</div>';
}
function readForm() {
  var name = String(($('bhfName') || {}).value || '').trim(), amt = parseFloat(String(($('bhfAmt') || {}).value || '').replace(/[' ]/g, '').replace(',', '.')), shop = String(($('bhfShop') || {}).value || '').trim();
  return { name:name, amt:amt, shop:shop, ok:!!name && amt > 0 };
}
function saleRow(x) {
  return { date:ymd(today()), description:'Sold: ' + x.name + (x.shop ? ' - ' + x.shop : ''), category:'Collectibles', subcategory:'TCG Investing', amount:x.amt, type:'refund', account:'debit_card', tags:'sold' };
}
function wantPark(x) { var l = wantList(); l.push({ id:'w' + Date.now().toString(36), name:x.name, price:x.amt, shop:x.shop, at:new Date().toISOString() }); return saveWant(l); }
function wantDone(id, how) {
  var l = wantList(), w = l.filter(function (x) { return x.id === id; })[0]; if (!w) return Promise.resolve(null);
  w.done = how; w.doneAt = new Date().toISOString();
  // keep the list short: finished items older than a year go
  var cut = Date.now() - 365 * 864e5; l = l.filter(function (x) { return !x.done || new Date(x.doneAt).getTime() > cut; });
  return saveWant(l).then(function () { return w; });
}

// Labels: every category, subcategory and tag you used, and every Wealth account, with the label it counts under
function labelsHTML(ov) {
  var seen = {}, tags = {}, r = roles();
  txs().forEach(function (tx) {
    if (tx.type === 'income') return;
    seen['c:' + tx.category] = 1; if (tx.subcategory) seen['s:' + tx.category + '›' + tx.subcategory] = 1;
    tagsOf(tx).forEach(function (t) { tags['t:' + t.toLowerCase()] = 1; });
  });
  function sel(key, list, cur, def) {
    return '<select data-bhlabel="' + esc(key) + '" aria-label="Label">' + (def ? '<option value="">' + esc(def) + '</option>' : '') +
      list.map(function (x) { return '<option value="' + x[0] + '"' + (cur === x[0] ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</select>';
  }
  var flowNames = {}; FLOW.forEach(function (x) { flowNames[x[0]] = x[1]; });
  var keys = Object.keys(seen).sort(function (a, b) { return a.slice(2).localeCompare(b.slice(2)); });
  var h = '<details class="card bh-card bh-labels"' + (UI.bhLabels ? ' open' : '') + ' data-act="bhlabels"><summary><h3 style="display:inline">Labels</h3> <span class="soon">what counts where</span></summary>' +
    '<p class="soon">A tag wins over a subcategory, a subcategory over its category. Changes count straight away.</p><div class="bh-lab">';
  keys.forEach(function (k) {
    var isSub = k.indexOf('s:') === 0, cat = k.slice(2).split('›')[0], sub = isSub ? k.slice(2).split('›')[1] : '';
    var def = isSub ? (ov['c:' + cat] || defaultFlow({ category:cat, subcategory:sub, type:'expense' }, r)) : defaultFlow({ category:cat, subcategory:'', type:'expense' }, r);
    h += '<label class="' + (isSub ? 'sub' : '') + '"><span>' + esc(isSub ? sub : cat) + '</span>' + sel(k, FLOW, ov[k] || '', 'as ' + (isSub ? 'category' : 'usual') + ' (' + flowNames[def] + ')') + '</label>';
  });
  var tk = Object.keys(tags).sort();
  if (tk.length) { h += '<div class="lbl">Tags</div>'; tk.forEach(function (k) { h += '<label><span>#' + esc(k.slice(2)) + '</span>' + sel(k, FLOW, ov[k] || '', 'follow the category') + '</label>'; }); }
  h += '<div class="lbl">Wealth accounts</div>';
  accounts().forEach(function (e) { var d = riskLabel(e, {}); h += '<label><span>' + esc(e.name) + '</span>' + sel('a:' + e.id, RISK, ov['a:' + e.id] || '', 'usual (' + RISK.filter(function (x) { return x[0] === d; })[0][1] + ')') + '</label>'; });
  return h + '</div></details>';
}
function saveLabel(key, value) {
  var ov = overrides(); if (value) ov[key] = value; else delete ov[key];
  return saveSetting('behaviour_labels', JSON.stringify(ov));
}

// one line for the Dashboard link
function behaviourLine() {
  try { var h = capHistory(), n = h[h.length - 1]; return 'collectibles ' + chf0(n.f.specNet) + ' of ' + chf0(n.cap) + ' · ' + n.pct + '%'; } catch (e) { return 'where your money goes'; }
}
export { etfShare, quickSave, readForm as readBhForm, saleRow, wantPark, wantDone, wantList, behaviourLine, CAP, WEALTH_CAP, THREEA_MAX, flowLabel, defaultFlow, riskLabel, flowsFor, riskNow, capHistory, threeA, behaviourModel, behaviourHTML, saveLabel };
