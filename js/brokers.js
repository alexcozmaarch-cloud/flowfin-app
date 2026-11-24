// FlowFin · "Where to buy": a broker shortlist for monthly ETF buys from Zürich, on the Ideas tab.
// Every broker is costed on the same buy: one purchase a month of an Irish world ETF traded in CHF, with trading fee,
// custody, currency exchange and Swiss stamp duty. The fee table below is the November 2026 starting point; Claude's
// monthly check replaces it through the ideas inbox ({ brokers:{ d, list, note } }). Approved 24.11.2026 (mockup "FlowFin Broker Shortlist").
import { esc, chf0 } from './core.js';

var STAMP = 0.0015;   // Swiss stamp duty on foreign-domiciled securities, charged by Swiss dealers
// per buy  = max(bMin, amount × bPct) + bFlat, or the first tier the amount fits in [[upTo, fee]] + bFlat
// fx       = fxPct on the part of the month above fxFree (0 = no limit)
// custody  = balance × cPct + (balance ≤ 50k ? cFlat : cFlatHi) a year
var DEFAULT = { d:'2026-11-24', note:'', list:[
  { n:'Interactive Brokers', sub:'SIX, tiered 0.05%, min CHF 1.50 · no custody · FX 0.002% · no Swiss stamp duty', fit:'main', bPct:0.0005, bMin:1.5, stamp:false },
  { n:'Yuh', have:1, sub:'CHF 0 in a monthly plan (31 ETFs) · no custody · 0.95% FX unless CHF-traded', fit:'auto', stamp:true },
  { n:'Saxo AutoInvest', sub:'CHF 0 on 100+ iShares/Amundi ETFs · no custody · whole shares only', fit:'alt', stamp:true },
  { n:'neon invest', sub:'0% on 8 partner ETFs (incl. FTSE All-World) · no custody · all in CHF', fit:'alt', stamp:true },
  { n:'Revolut', have:1, sub:'commission-free plans · FX 1% above CHF 1,250 a month · Lithuanian broker, no Swiss tax statement', fit:'side', fxFree:1250, fxPct:0.01, stamp:false },
  { n:'finpension Invest', have:1, sub:'no trading fee · 0.39% a year (custody 0.30% + management 0.09%)', fit:'hands', cPct:0.0039, stamp:true },
  { n:'Swissquote', have:1, sub:'CHF 3 (≤500) / CHF 9 a buy + 0.85 data · custody CHF 80–200 a year · 0.95% FX', fit:'no', bTiers:[[500, 3], [1e12, 9]], bFlat:0.85, cFlat:80, cFlatHi:200, stamp:true },
  { n:'PostFinance', sub:'about 1% a buy · custody credited back as trading', fit:'no', bPct:0.01, stamp:true },
  { n:'UBS e-banking', have:1, sub:'CHF 45 a trade · custody 0.35% + VAT', fit:'no', bFlat:45, cPct:0.0035 * 1.081, stamp:true }
] };
var FIT = { main:['yes', 'Main account'], auto:['yes', 'Autopilot'], alt:['yes', 'Alternative'], side:['', 'Side account'], hands:['', 'Hands-off'], no:['no', 'Too dear for this'] };

function table() {
  try { var v = ((DATA.Settings || []).filter(function (r) { return r.key === 'brokers_v'; })[0] || {}).value; var t = v ? JSON.parse(v) : null; if (t && t.list && t.list.length) return t; } catch (e) {}
  return DEFAULT;
}
function perBuy(b, a) {
  var f = 0;
  if (b.bTiers) { for (var i = 0; i < b.bTiers.length; i++) if (a <= b.bTiers[i][0]) { f = b.bTiers[i][1]; break; } }
  else f = Math.max(b.bMin || 0, a * (b.bPct || 0));
  return f + (b.bFlat || 0) + (b.fxPct ? Math.max(0, a - (b.fxFree || 0)) * b.fxPct : 0);
}
function custody(b, v) { return v * (b.cPct || 0) + (v <= 50000 ? (b.cFlat || 0) : (b.cFlatHi === undefined ? (b.cFlat || 0) : b.cFlatHi)); }
function yearCost(b, a, v) { return 12 * perBuy(b, a) + custody(b, v) + (b.stamp ? 12 * a * STAMP : 0); }

var AMTS = [300, 750, 1500, 3000];
function brokersHTML(inv) {
  var T = table(), mine = Math.round((inv || 0) / 50) * 50, a = UI.brAmt || mine || 750;
  var chips = (mine && AMTS.indexOf(mine) < 0 ? [mine] : []).concat(AMTS).sort(function (x, y) { return x - y; });
  var rows = T.list.map(function (b) { return { b:b, y1:yearCost(b, a, a * 6.5), y50:yearCost(b, a, 50000) }; });
  var max = Math.max.apply(null, rows.map(function (r) { return r.y50; })) || 1, min = Math.min.apply(null, rows.filter(function (r) { return r.b.fit !== 'side'; }).map(function (r) { return r.y50; }));
  function find(fit) { return rows.filter(function (r) { return r.b.fit === fit; })[0]; }
  var main = find('main'), auto = find('auto'), worst = rows.filter(function (r) { return r.b.have && r.b.fit === 'no'; }).sort(function (x, y) { return y.y50 - x.y50; });
  var stop = worst.filter(function (r) { return !/UBS/.test(r.b.n); })[0] || worst[0];
  var h = '<section class="card br-card"><h3>Where to buy<span class="r">checked monthly · ' + esc(T.d.split('-').reverse().join('.')) + '</span></h3>' +
    '<div class="br-amt"><span class="lbl">A month</span><span class="seg2" role="radiogroup" aria-label="Monthly amount">' + chips.map(function (x) {
      return '<button role="radio" aria-checked="' + (x === a) + '" class="' + (x === a ? 'on' : '') + '" data-act="bramt" data-v="' + x + '">' + chf0(x) + (x === mine ? ' · yours' : '') + '</button>'; }).join('') + '</span></div>';
  h += '<div class="br-picks">';
  if (main) h += '<div class="br-pick main"><span class="lbl">Main account</span><b>' + esc(main.b.n) + '</b><span class="num br-cost">' + chf0(main.y50) + ' <small>a year at CHF 50k</small></span><p>' +
    (auto && main.y50 <= auto.y50 ? 'Cheapest at this amount, and' : 'Within a few francs of the free plans at this amount, cheapest from about CHF 1,000 a month, and') + ' the place for single stocks. No Swiss stamp duty.</p></div>';
  if (auto) h += '<div class="br-pick"><span class="lbl">Autopilot' + (auto.b.have ? ' · you have it' : '') + '</span><b>' + esc(auto.b.n) + ' savings plan</b><span class="num br-cost">' + chf0(auto.y50) + ' <small>a year</small></span><p>A monthly plan in a CHF-traded world ETF, no effort. Swiss bank, Swiss tax statement.</p></div>';
  if (stop) h += '<div class="br-pick"><span class="lbl">Stop using for this</span><b>' + esc(stop.b.n) + '</b><span class="num br-cost">' + chf0(stop.y50) + ' <small>a year</small></span><p>Custody and per-buy fees eat small monthly amounts.</p></div>';
  h += '</div><div class="cp-tw"><table class="id-tab br-tab"><thead><tr><th>Broker</th><th class="r">Year 1</th><th class="r">At CHF 50k</th><th>Per buy · custody · FX</th><th>Fit</th></tr></thead><tbody>' +
    rows.map(function (r) {
      var f = FIT[r.b.fit] || ['', r.b.fit || ''], w = Math.max(2, r.y50 / max * 100);
      return '<tr class="' + (f[0] === 'no' ? 'dim' : '') + '"><td><b>' + esc(r.b.n) + '</b>' + (r.b.have ? ' <i class="br-have">you have it</i>' : '') + '<small class="br-subm">' + esc(r.b.sub || '') + '</small></td><td class="r num">' + chf0(r.y1) + '</td>' +
        '<td class="r num">' + chf0(r.y50) + '<span class="br-bar ' + (r.y50 <= min + 1 ? 'best' : f[0] === 'no' ? 'bad' : '') + '" style="width:' + w.toFixed(0) + '%"></span></td>' +
        '<td><small>' + esc(r.b.sub || '') + '</small></td><td><span class="br-fit ' + f[0] + '">' + esc(f[1]) + '</span></td></tr>';
    }).join('') + '</tbody></table></div>';
  if (T.note) h += '<p class="br-note"><b>This month:</b> ' + esc(T.note) + '</p>';
  h += '<p class="soon">Year 1 = 12 buys with custody on the growing balance; "at CHF 50k" = the same buys once the account holds CHF 50,000. Stamp duty (0.15%) is charged by Swiss banks and finpension, not by Interactive Brokers or Revolut. ' +
    'At IBKR there is no Swiss tax statement (copy the year-end figures into your return), and buy Irish UCITS ETFs, not US ones, to stay clear of US estate tax. ETF running costs are left out: the same everywhere. Claude checks the fees on the first Monday of each month.</p></section>';
  return h;
}

export { brokersHTML, yearCost, DEFAULT as BROKERS_DEFAULT };
