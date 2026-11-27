// FlowFin · Wealth over time: net worth by month, stacked by kind of money, what you put in underneath
// (the gap is profit), and a projection with a likely range. Approved 27.11.2026 (mockup "FlowFin Wealth Over Time").
import { esc } from './core.js';
import { sw0 } from './dashboard.js';

var KINDS = [
  { k:'cash', n:'Cash & savings', c:'var(--s5)', r:[0.005, 0.005, 0.005] },
  { k:'pens', n:'Pensions & 3a', c:'var(--s2)', r:[0.01, 0.03, 0.05] },
  { k:'inv', n:'Investments', c:'var(--ink)', r:[0.02, 0.06, 0.09] },
  { k:'col', n:'Collectibles', c:'var(--signal)', r:[-0.05, 0, 0.05] },
  { k:'phys', n:'Property & things', c:'var(--s4)', r:[0, 0.01, 0.02] }
];
var TYPE_KIND = { current_account:'cash', savings_account:'cash', third_pillar:'pens', private_pension:'pens', investment_account:'inv', tcg_investments:'col', real_estate:'phys', vehicle:'phys', other_asset:'phys' };
function kindOf(e) { return TYPE_KIND[e.account_type] || 'liab'; }
function fk(v) { var a = Math.abs(v); return (v < 0 ? '−' : '') + (a >= 1e6 ? (a / 1e6).toFixed(2) + 'm' : Math.round(a / 1000) + 'k'); }
function mLabel(k, long) { var d = new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, 1); return d.toLocaleDateString('en-GB', long ? { month:'long', year:'numeric' } : { month:'short', year:'2-digit' }); }
function addMonths(k, n) { var d = new Date(+k.slice(0, 4), +k.slice(5, 7) - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

// history: per month, value by kind, net, put in (= net − gain on investments)
function history(ms, acc) {
  return ms.map(function (m, i) {
    // an account that shows up for the first time isn't money saved that month: leave it out of "added"
    var p = ms[i - 1], fresh = 0;
    if (p) acc.forEach(function (e) { if (!(p.per[e.id]) && m.per[e.id]) fresh += m.per[e.id]; });
    var by = { cash:0, pens:0, inv:0, col:0, phys:0, liab:0 };
    acc.forEach(function (e) { var v = m.per[e.id] || 0, k = kindOf(e); if (v < 0 || k === 'liab') by.liab += Math.abs(v); else by[k] += v; });
    return { key:m.key, final:m.final, by:by, net:m.net, put:m.net - (m.invValue - m.invested), chg:m.chg, market:m.market, you:m.you, added:m.you === undefined ? undefined : m.you - fresh, nUpd:m.nUpd };
  });
}
// projection: keep adding the average monthly "you" of the last (up to) six months, split like it went before
function project(H, months, savedFn) {
  var last = H[H.length - 1], recent = H.slice(-7).filter(function (h) { return h.added !== undefined && (h.final || h.nUpd); }), how = 'acct';
  var add = recent.length ? recent.reduce(function (a, h) { return a + h.added; }, 0) / recent.length : 0;
  // prefer what your transactions say you saved (income minus spending) over the last six full months: account updates are too lumpy early on
  if (savedFn) { var sv = []; for (var q = 1; q <= 6; q++) { var v0 = savedFn(addMonths(last.key, -q)); if (v0 !== null && v0 !== undefined) sv.push(v0); } if (sv.length >= 2) { add = sv.reduce(function (a, b) { return a + b; }, 0) / sv.length; how = 'tx'; } }
  var split = { cash:0, pens:0, inv:0, col:0, phys:0 }, first = H[Math.max(0, H.length - 1 - recent.length)], tot = 0;
  KINDS.forEach(function (g) { var d = Math.max(0, last.by[g.k] - first.by[g.k]); split[g.k] = d; tot += d; });
  KINDS.forEach(function (g) { split[g.k] = tot ? split[g.k] / tot : (g.k === 'cash' ? 1 : 0); });
  var st = [0, 1, 2].map(function () { var o = {}; KINDS.forEach(function (g) { o[g.k] = last.by[g.k]; }); return o; }), put = last.put, out = [], a = Math.max(0, add);
  for (var i = 1; i <= months; i++) {
    [0, 1, 2].forEach(function (s) { KINDS.forEach(function (g) { st[s][g.k] = st[s][g.k] * (1 + g.r[s] / 12) + a * split[g.k]; }); });
    put += a;
    var sum = function (o) { return KINDS.reduce(function (x, g) { return x + o[g.k]; }, 0) - last.by.liab; };
    out.push({ key:addMonths(last.key, i), lo:sum(st[0]), mid:sum(st[1]), hi:sum(st[2]), put:put });
  }
  return { P:out, add:add, split:split, how:how };
}

var VIEW = null;   // what the chart drew, for the readout
function overHTML(ms, acc, savedFn) {
  var H = history(ms, acc); if (!H.length) return '';
  var years = UI.woYears || 5, J = project(H, years * 12, savedFn), P = J.P, last = H[H.length - 1], prev = H.length > 1 ? H[H.length - 2] : null;
  var profit = last.net - last.put, end = P[P.length - 1];
  var kinds = KINDS.filter(function (g) { return H.some(function (h) { return h.by[g.k] > 0; }); });
  var h = '<section class="card wo-card"><h3>Wealth over time<span class="r"><span class="seg2" role="radiogroup" aria-label="Projection">' + [1, 3, 5, 10].map(function (y) {
      return '<button role="radio" aria-checked="' + (y === years) + '" class="' + (y === years ? 'on' : '') + '" data-act="woyears" data-v="' + y + '">' + y + (y === 1 ? ' yr' : ' yrs') + '</button>'; }).join('') + '</span></span></h3>' +
    '<div class="wo-hero"><div><b class="num big">' + sw0(last.net) + '</b><span>net worth · ' + esc(mLabel(last.key, true)) + (last.final ? '' : ' so far') + '</span></div>' +
    (prev ? '<div><b class="num ' + (last.chg >= 0 ? 'pos' : 'neg') + '">' + (last.chg >= 0 ? '+' : '−') + sw0(Math.abs(last.chg)) + '</b><span>this month · market ' + (last.market >= 0 ? '+' : '−') + sw0(Math.abs(last.market)) + ' · you ' + (last.you >= 0 ? '+' : '−') + sw0(Math.abs(last.you)) + '</span></div>' : '<div></div>') +
    '<div><b class="num ' + (profit >= 0 ? 'pos' : 'neg') + '">' + (profit >= 0 ? '+' : '−') + sw0(Math.abs(profit)) + '</b><span>total profit' + (last.put > 0 ? ' · ' + (profit >= 0 ? '+' : '−') + Math.abs(profit / last.put * 100).toFixed(0) + '% on what you put in' : '') + '</span></div>' +
    '<div><b class="num">≈ ' + sw0(Math.round(end.mid / 1000) * 1000) + '</b><span>in ' + years + ' year' + (years > 1 ? 's' : '') + ' · likely ' + fk(end.lo) + '–' + fk(end.hi) + '</span></div></div>' +
    '<div class="wo-keys">' + kinds.map(function (g) { return '<span><i style="background:' + g.c + '"></i>' + g.n + '</span>'; }).join('') +
      '<span><svg width="22" height="10" aria-hidden="true"><line x1="0" x2="22" y1="5" y2="5" stroke="var(--ink)" stroke-width="1.6" stroke-dasharray="2 3"/></svg>What you put in</span>' +
      '<span><svg width="22" height="10" aria-hidden="true"><rect width="22" height="10" fill="var(--ink)" opacity=".12"/><line x1="0" x2="22" y1="5" y2="5" stroke="var(--ink)" stroke-width="1.6" stroke-dasharray="6 3"/></svg>Projection · likely range</span></div>' +
    '<div class="wo-chart">' + svg(H, P, kinds) + '</div><div class="wo-ro" id="woRo">' + readout(H, P, H.length - 1) + '</div>' +
    '<div class="lbl">The projection assumes</div><div class="wo-ass">' +
      '<div><b class="num">' + (J.add >= 0 ? '+' : '−') + sw0(Math.abs(J.add)) + ' a month</b><span>' + (J.add > 0 ? (J.how === 'tx' ? 'what you saved a month on average (income − spending, last 6 months), kept up' : 'what you added a month on average, kept up') : 'you saved nothing on average lately, so only growth counts') + '</span></div>' +
      KINDS.filter(function (g) { return g.k !== 'phys' || last.by.phys > 0; }).map(function (g) { return '<div><b class="num">' + g.n.split(' ')[0] + ' ' + (g.r[1] * 100).toFixed(g.r[1] < 0.01 && g.r[1] > 0 ? 1 : 0) + '%</b><span>a year' + (g.r[0] !== g.r[2] ? ' · range ' + (g.r[0] * 100).toFixed(0) + ' to ' + (g.r[2] * 100).toFixed(0) + '%' : '') + '</span></div>'; }).join('') + '</div>' +
    '<p class="soon">Put in = net worth minus the gain on your investment accounts, so the gap is profit: markets, card prices, pension growth. The middle line keeps up your average monthly addition and a typical long-run return per kind of money; the band is a likely range, not a promise. Collectibles get 0% in the middle: past gains don’t predict future ones. Tap the chart to read a month.' +
    (H.length < 7 ? ' Your history starts ' + esc(mLabel(H[0].key, true)) + ', so the past is short for now; it fills in every month.' : '') + '</p></section>';
  return h;
}
function svg(H, P, kinds) {
  var nh = H.length, N = nh + P.length, W = 760, R = 52, PW = W - R, T = 14, B = 260;
  var hw = nh > 1 ? PW * Math.max(0.3, (nh - 1) / (N - 1)) : 0;
  var x = function (i) { return i <= nh - 1 ? (nh > 1 ? i / (nh - 1) * hw : 0) : hw + (i - (nh - 1)) / (N - nh) * (PW - hw); };
  var tops = P.map(function (p) { return p.hi; }).concat(H.map(function (h) { return KINDS.reduce(function (a, g) { return a + h.by[g.k]; }, 0); }));
  var top = Math.max.apply(null, tops.concat([1000])), st = [1000, 2000, 5000, 10000, 20000, 25000, 50000, 100000, 200000, 250000, 500000, 1e6].filter(function (s) { return s * 5 >= top * 1.05; })[0] || 2e6;
  var mx = st * Math.ceil(top * 1.05 / st), lo = Math.min(0, Math.min.apply(null, H.map(function (h) { return h.net; })));
  var y = function (v) { return B - (v - lo) / (mx - lo) * (B - T); }, g = '', v, i;
  for (v = Math.ceil(lo / st) * st; v <= mx; v += st) g += '<line x1="0" x2="' + PW + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" stroke="var(--rule)"/><text x="' + (PW + 6) + '" y="' + (y(v) + 3.5).toFixed(1) + '" class="t">' + fk(v) + '</text>';
  // the past: stacked by kind
  var base = H.map(function () { return 0; });
  if (nh > 1) kinds.forEach(function (gr) {
    var up = H.map(function (h, k) { return base[k] + h.by[gr.k]; });
    var pts = up.map(function (u, k) { return x(k).toFixed(1) + ',' + y(u).toFixed(1); }).concat(base.slice().reverse().map(function (b0, j) { return x(nh - 1 - j).toFixed(1) + ',' + y(b0).toFixed(1); }));
    g += '<polygon points="' + pts.join(' ') + '" fill="' + gr.c + '" opacity=".9"/>';
    base = up;
  });
  var tx = x(nh - 1), last = H[nh - 1];
  // projection band and middle line
  g += '<polygon points="' + [tx.toFixed(1) + ',' + y(last.net).toFixed(1)].concat(P.map(function (p, k) { return x(nh + k).toFixed(1) + ',' + y(p.hi).toFixed(1); }))
    .concat(P.slice().reverse().map(function (p, k) { return x(N - 1 - k).toFixed(1) + ',' + y(p.lo).toFixed(1); })).join(' ') + '" fill="var(--ink)" opacity=".1"/>';
  g += '<polyline points="' + [tx.toFixed(1) + ',' + y(last.net).toFixed(1)].concat(P.map(function (p, k) { return x(nh + k).toFixed(1) + ',' + y(p.mid).toFixed(1); })).join(' ') + '" fill="none" stroke="var(--ink)" stroke-width="2" stroke-dasharray="6 3"/>';
  // what you put in
  g += '<polyline points="' + H.map(function (h, k) { return x(k).toFixed(1) + ',' + y(h.put).toFixed(1); }).concat(P.map(function (p, k) { return x(nh + k).toFixed(1) + ',' + y(p.put).toFixed(1); })).join(' ') + '" fill="none" stroke="var(--ink)" stroke-width="1.6" stroke-dasharray="2 3"/>';
  // net worth line and month points (hollow: nothing updated that month)
  if (nh > 1) g += '<polyline points="' + H.map(function (h, k) { return x(k).toFixed(1) + ',' + y(h.net).toFixed(1); }).join(' ') + '" fill="none" stroke="var(--ink)" stroke-width="2.4"/>';
  H.forEach(function (h, k) { g += '<circle cx="' + x(k).toFixed(1) + '" cy="' + y(h.net).toFixed(1) + '" r="3.5" ' + (h.nUpd ? 'fill="var(--ink)"' : 'fill="var(--paper)" stroke="var(--ink)" stroke-width="1.5"') + '/>'; });
  g += '<line x1="' + tx.toFixed(1) + '" x2="' + tx.toFixed(1) + '" y1="' + T + '" y2="' + B + '" stroke="var(--ink)"/><text x="' + (tx + 4).toFixed(1) + '" y="' + (T + 8) + '" class="t" style="fill:var(--ink)">today</text>';
  // milestones on the middle line
  var stones = [50000, 100000, 150000, 200000, 250000, 500000, 750000, 1e6].filter(function (s) { return s > last.net; }).slice(0, 3);
  stones.forEach(function (s) { var k = -1; for (var j = 0; j < P.length; j++) if (P[j].mid >= s) { k = j; break; } if (k < 0) return;
    g += '<circle cx="' + x(nh + k).toFixed(1) + '" cy="' + y(s).toFixed(1) + '" r="4" fill="var(--paper)" stroke="var(--ink)" stroke-width="2"/><text x="' + (x(nh + k) - 6).toFixed(1) + '" y="' + (y(s) - 9).toFixed(1) + '" text-anchor="end" class="t" style="fill:var(--ink)">' + fk(s) + ' ≈ ' + esc(mLabel(P[k].key)) + '</text>'; });
  var e = P[P.length - 1];
  g += '<text x="' + (PW - 4) + '" y="' + (y(e.mid) - 8).toFixed(1) + '" text-anchor="end" class="t" style="fill:var(--ink)">' + fk(e.mid) + '</text>';
  // x labels: first month, today, then years
  g += '<text x="0" y="' + (B + 16) + '" class="t">' + esc(mLabel(H[0].key)) + '</text>';
  if (nh > 1) g += '<text x="' + tx.toFixed(1) + '" y="' + (B + 16) + '" text-anchor="middle" class="t">' + esc(mLabel(last.key)) + '</text>';
  P.forEach(function (p, k) { if (p.key.slice(5) === '01' && x(nh + k) - tx > 40) g += '<text x="' + x(nh + k).toFixed(1) + '" y="' + (B + 16) + '" text-anchor="middle" class="t">' + p.key.slice(0, 4) + '</text>'; });
  g += '<line x1="0" x2="' + PW + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '" stroke="var(--ink)"/>';
  VIEW = { H:H, P:P, nh:nh, N:N, hw:hw, PW:PW, W:W };
  return '<svg id="woSvg" viewBox="0 0 ' + W + ' ' + (B + 22) + '" role="img" aria-label="Net worth by month since ' + esc(mLabel(H[0].key, true)) + ', with a projection">' + g + '<line id="woCross" x1="-10" x2="-10" y1="' + T + '" y2="' + B + '" stroke="var(--muted)" stroke-dasharray="2 2"/></svg>';
}
function readout(H, P, i) {
  var nh = H.length;
  if (i < nh) {
    var h = H[i], pr = h.net - h.put;
    return '<b>' + esc(mLabel(h.key, true)) + (h.final ? '' : ' · so far') + '</b><span>net worth</span> ' + sw0(h.net) + ' <span>put in</span> ' + sw0(h.put) + ' <span>profit</span> <span class="' + (pr >= 0 ? 'pos' : 'neg') + '">' + (pr >= 0 ? '+' : '−') + sw0(Math.abs(pr)) + '</span>' +
      (h.chg !== undefined ? ' <span>change</span> ' + (h.chg >= 0 ? '+' : '−') + sw0(Math.abs(h.chg)) + ' <span>market</span> ' + (h.market >= 0 ? '+' : '−') + sw0(Math.abs(h.market)) + ' <span>you</span> ' + (h.you >= 0 ? '+' : '−') + sw0(Math.abs(h.you)) : '');
  }
  var p = P[i - nh];
  return '<b>' + esc(mLabel(p.key, true)) + ' · projected</b><span>likely</span> ' + sw0(p.mid) + ' <span>range</span> ' + sw0(p.lo) + '–' + sw0(p.hi) + ' <span>put in</span> ' + sw0(p.put) + ' <span>profit</span> <span class="pos">+' + sw0(Math.max(0, p.mid - p.put)) + '</span>';
}
// tap / hover: move the crosshair and update the readout without redrawing the page
function wireOver() {
  var s = document.getElementById('woSvg'); if (!s || !VIEW || s._wired) return; s._wired = true;
  function at(ev) {
    var r = s.getBoundingClientRect(), xx = (ev.clientX - r.left) / r.width * VIEW.W, V = VIEW, i;
    i = xx <= V.hw ? Math.round(xx / (V.hw || 1) * (V.nh - 1)) : (V.nh - 1) + Math.round((xx - V.hw) / (V.PW - V.hw) * (V.N - V.nh));
    i = Math.max(0, Math.min(V.N - 1, i));
    var cx = i <= V.nh - 1 ? (V.nh > 1 ? i / (V.nh - 1) * V.hw : 0) : V.hw + (i - (V.nh - 1)) / (V.N - V.nh) * (V.PW - V.hw), c = document.getElementById('woCross');
    if (c) { c.setAttribute('x1', cx); c.setAttribute('x2', cx); }
    var ro = document.getElementById('woRo'); if (ro) ro.innerHTML = readout(V.H, V.P, i);
  }
  s.addEventListener('pointermove', at); s.addEventListener('pointerdown', at);
}
// a small line of an account's month-end values
function acctSpark(ms, id) {
  var v = ms.map(function (m) { return Math.abs(m.per[id] || 0); }); if (v.length < 2) return '';
  var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), w = 64, h = 18;
  return '<svg class="wo-spark" width="' + w + '" height="' + h + '" aria-hidden="true"><polyline points="' + v.map(function (x, i) { return (i / (v.length - 1) * w).toFixed(1) + ',' + (h - 2 - (x - lo) / (hi - lo || 1) * (h - 4)).toFixed(1); }).join(' ') + '" fill="none" stroke="var(--ink)" stroke-width="1.5"/></svg>';
}

export { overHTML, wireOver, acctSpark, history, project };
