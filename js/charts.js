// FlowFin · Charts (Chart.js), drawn after fonts load.
// Shared settings and state (DATA, UI, _cache, CATEGORIES …) are globals from js/config.js.
import { $, calcTotals, inPeriod, isInfra, isSalary, pd, periodAt, periodLabel, roles, today, txs } from './core.js';
import { sumBy, sw0 } from './dashboard.js';

// ─── Charts (drawn after fonts load, so axis labels are measured correctly) ─
function chartColors() {
  var css = getComputedStyle(document.documentElement);
  var g = function (n) { return css.getPropertyValue(n).trim(); };
  return { ink:g('--ink'), muted:g('--muted'), faint:g('--faint'), rule:g('--rule'), signal:g('--signal') };
}
// Net saved per period, last 12 periods, against the free-cash target
function netSavingsData() {
  var r = roles(), totalPct = sumBy(DATA.FundAllocation || [], function (f) { return +f.pct; }), out = [];
  for (var i = 11; i >= 0; i--) {
    var off = UI.periodOffset - i, p = periodAt(off), t = today();
    var cutoff = p.end < t ? p.end : t;
    var list = txs().filter(function (tx) { return inPeriod(tx, p); });
    var T = calcTotals(list, cutoff, 0, 0);
    if (!(T.income > 0 || T.expenses > 0)) continue;
    var sal = sumBy(list, function (tx) { return isSalary(tx, r) && pd(tx.date) <= cutoff ? +tx.amount : 0; });
    var inf = sumBy(list, function (tx) { return isInfra(tx, r) && pd(tx.date) <= cutoff ? +tx.amount : 0; });
    var free = sal > 0 ? Math.max(0, sal - inf) : BENCHMARK_SALARY - BENCHMARK_INFRA;
    out.push({ label:p.start.toLocaleDateString('en-GB', { month:'short' }), range:periodLabel(p), net:T.netSaved, target:Math.round(free * (totalPct > 0 ? totalPct / 100 : 0.2)), current:off === 0 });
  }
  return out;
}
function netSavingsChart() {
  var el = $('chNet'); if (!el || !window.Chart || CHARTS.net) return;
  if (!el.closest('details[open]')) return;          // drawn when its section is opened
  var d = netSavingsData(), C = chartColors();
  CHARTS.net = new Chart(el, {
    data:{ labels:d.map(function (x) { return x.label; }), datasets:[
      { type:'bar', label:'Net saved', data:d.map(function (x) { return +x.net.toFixed(2); }),
        backgroundColor:d.map(function (x) { return x.net < 0 ? C.signal : (x.current ? C.faint : C.ink); }), borderRadius:0, maxBarThickness:42 }
    ]},
    options:{ responsive:true, maintainAspectRatio:false, layout:{ padding:{ left:4 } },
      plugins:{ legend:{ display:false }, tooltip:{ backgroundColor:C.ink, cornerRadius:0, titleFont:{ family:'IBM Plex Mono' }, bodyFont:{ family:'IBM Plex Mono' },
        callbacks:{ title:function (it) { return d[it[0].dataIndex].range; }, label:function (c) { return 'Saved: ' + sw0(c.raw) + (d[c.dataIndex].current ? ' (so far)' : ''); } } } },
      scales:{
        x:{ ticks:{ color:C.muted, font:{ family:'IBM Plex Mono', size:11 } }, grid:{ display:false }, border:{ color:C.ink } },
        y:{ ticks:{ color:C.muted, font:{ family:'IBM Plex Mono', size:11 }, callback:function (v) { return sw0(v); } },
            grid:{ color:function (c) { return c.tick.value === 0 ? C.ink : C.rule; } }, border:{ display:false } }
      } }
  });
}

export { chartColors, netSavingsData, netSavingsChart };
