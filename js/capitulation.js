// FlowFin · Capitulation gauge on the Ideas tab: how many of the usual signs of panic selling are showing.
// Market signs are measured by the app from daily prices (VIX, S&P 500, each idea); retail flows and sentiment
// (Vanda, JPMorgan, Bank of America, AAII) come from Claude's Friday check, as a "market" block in the ideas inbox.
// Approved 24.11.2026 (mockup "FlowFin Capitulation Gauge"). It says where a bottom is likely, not the day.
import { addDays, esc, lsGet, pd, today, ymd } from './core.js';

var PX_KEY = 'ff_prices_v1';
var VIX = '^VIX', SPX = '^GSPC', GAUGE_FROM = '2019-06-01';   // history for the backtest: covers 2020, 2022, 2023, 2025 and 2026
// points per market sign (the same tables for today and for the backtest)
var PTS = { vix:[[40, 15], [30, 12], [25, 8], [20, 4]], jump:[[50, 10], [30, 7], [15, 3]], dd:[[25, 15], [20, 12], [15, 9], [10, 6], [5, 2]], rsi:[[-25, 10], [-30, 7], [-35, 4], [-40, 2]], flush:[[2, 10], [1.7, 6], [1.4, 3]] };
var MARKET_MAX = 60;
var ZONES = [[0, 'Calm', 'Few signs of panic. Buy only as planned.'], [30, 'Stress', 'Some signs are showing. Keep to the plan; no extra buying yet.'],
  [50, 'Fear', 'Several signs are showing. A good time for the first step of ideas marked “small”.'], [70, 'Capitulation', 'Most signs are showing: the zone where bottoms tend to form. The Friday check looks at the next steps.']];
// flow signs Claude fills in every Friday: key, label, what counts, most points
var FLOWS = [['vanda', 'Retail flows (Vanda Research)', 'private investors selling single stocks hard', 15], ['jpm', 'Retail flows (JPMorgan)', 'retail dip-buying stops or turns to selling', 10],
  ['bofa', 'BofA private clients', 'weeks in a row of net selling stocks', 5], ['aaii', 'AAII bears', 'above 50% bearish = the crowd giving up', 10]];

var _px = null;
function pxAll() { if (_px) return _px; try { _px = JSON.parse(lsGet(PX_KEY) || '{}'); } catch (e) { _px = {}; } return _px; }
function series(sym, upTo) {   // { dates, closes, vols } up to and including the date
  var p = pxAll()[sym]; if (!p || !p.dates || !p.dates.length) return null;
  var n = p.dates.length; if (upTo) while (n > 0 && p.dates[n - 1] > upTo) n--;
  return n ? { dates:p.dates.slice(0, n), closes:p.closes.slice(0, n), vols:(p.vols || []).slice(0, n), hasVol:!!p.vols } : null;
}
function avg(a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : 0; }
function rsi(c, n) {   // Wilder's RSI over n days
  n = n || 14; if (c.length < n + 1) return null;
  var g = 0, l = 0, i;
  for (i = 1; i <= n; i++) { var d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  for (i = n + 1; i < c.length; i++) { var e = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(0, e)) / n; l = (l * (n - 1) + Math.max(0, -e)) / n; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
function fromHigh(s) { var c = s.closes.slice(-252), hi = Math.max.apply(null, c); return (s.closes[s.closes.length - 1] / hi - 1) * 100; }
// biggest volume on a down day in the last `days` trading days, against the 20 days before it
function flush(s, days) {
  if (!s || !s.hasVol || s.closes.length < 30) return null;
  var best = { x:0, d:'' }, n = s.closes.length;
  for (var i = Math.max(21, n - days); i < n; i++) {
    if (!(s.closes[i] < s.closes[i - 1]) || !s.vols[i]) continue;
    var base = avg(s.vols.slice(i - 20, i).filter(function (v) { return v > 0; })); if (!base) continue;
    var x = s.vols[i] / base; if (x > best.x) best = { x:x, d:s.dates[i] };
  }
  return best;
}
function step(v, table) { for (var i = 0; i < table.length; i++) if (v >= table[i][0]) return table[i][1]; return 0; }

// the flow readings Claude saved, newest first: [{ d, items:[{ k, v, p, note, src, url }] }]
function flowHist() { try { var v = ((DATA.Settings || []).filter(function (r) { return r.key === 'cap_flows'; })[0] || {}).value; return v ? JSON.parse(v) : []; } catch (e) { return []; } }
function flowsOn(date) {   // the newest Friday reading on or before the date, if it is at most 10 days old
  var f = flowHist().filter(function (x) { return x.d <= date; }).sort(function (a, b) { return a.d < b.d ? 1 : -1; })[0];
  return f && (pd(date) - pd(f.d)) / 864e5 <= 10 ? f : null;
}

function gauge(date) {
  date = date || ymd(today());
  var vix = series(VIX, date), spx = series(SPX, date), rows = [], score = 0, have = 0;
  function add(g, label, hint, reading, pts, max, ok) { rows.push({ g:g, label:label, hint:hint, reading:reading, pts:ok ? pts : null, max:max }); if (ok) { score += pts; have++; } }
  if (vix && vix.closes.length > 21) {
    var v = vix.closes[vix.closes.length - 1], v20 = avg(vix.closes.slice(-21, -1)), jump = (v / v20 - 1) * 100;
    add('m', 'Volatility (VIX)', 'above 30 = fear, above 40 = panic', v.toFixed(1), step(v, PTS.vix), 15, true);
    add('m', 'VIX jump', 'against its own 20-day average', (jump >= 0 ? '+' : '−') + Math.abs(jump).toFixed(0) + '%', step(jump, PTS.jump), 10, true);
  } else { add('m', 'Volatility (VIX)', 'above 30 = fear, above 40 = panic', '—', 0, 15, false); add('m', 'VIX jump', 'against its own 20-day average', '—', 0, 10, false); }
  if (spx && spx.closes.length > 30) {
    var dd = fromHigh(spx), r = rsi(spx.closes.slice(-120)), fl = flush(spx, 5);
    add('m', 'S&P 500 down from its high', '10% = correction, 20% = bear market', '−' + Math.abs(dd).toFixed(1) + '%', step(-dd, PTS.dd), 15, true);
    add('m', 'S&P 500 RSI, 14 days', 'below 30 = oversold', r === null ? '—' : r.toFixed(0), r === null ? 0 : step(-r, PTS.rsi), 10, r !== null);
    add('m', 'Selling-volume flush', 'a down day with 2× normal volume or more, last 5 days', fl ? fl.x.toFixed(1) + '×' : '—', fl ? step(fl.x, PTS.flush) : 0, 10, !!fl);
  } else ['S&P 500 down from its high', 'S&P 500 RSI, 14 days', 'Selling-volume flush'].forEach(function (l, k) { add('m', l, '', '—', 0, [15, 10, 10][k], false); });
  var fw = flowsOn(date), byK = {}; ((fw && fw.items) || []).forEach(function (it) { byK[it.k] = it; });
  FLOWS.forEach(function (f) {
    var it = byK[f[0]];
    add('f', f[1], it && it.note ? it.note : f[2], it ? String(it.v) : '—', it ? Math.max(0, Math.min(f[3], +it.p || 0)) : 0, f[3], !!it);
    if (it) rows[rows.length - 1].src = it;
  });
  var z = ZONES.filter(function (x) { return score >= x[0]; }).pop();
  return { date:date, score:Math.round(score), zone:z, rows:rows, flowsDate:fw ? fw.d : '', marketOK:!!(vix && spx), have:have };
}
// the same score on each of the last 12 Fridays (market signs from prices; flows where Claude had a reading)
function weekly() {
  var t = today(), f = addDays(t, -((t.getDay() + 2) % 7)), out = [];
  for (var i = 11; i >= 0; i--) { var d = ymd(addDays(f, -7 * i)); var g = gauge(d); out.push({ d:d, score:g.score, flows:!!g.flowsDate, ok:g.marketOK }); }
  return out;
}
function ideaSigns(i) {
  var s = i.ticker ? series(i.ticker) : null;
  if (!s || s.closes.length < 30) return { too:true };
  var r = rsi(s.closes.slice(-120)), fl = flush(s, 10);
  return { high:fromHigh(s), rsi:r, flush:fl, read:r !== null && r < 30 ? ['oversold', 'on'] : fl && fl.x >= 2 ? ['flushed', 'half'] : ['not yet', 'off'] };
}
// ─── backtest: the market half of the score on every trading day since mid-2019, and how it looked at each low ──
// A low = the S&P 500's lowest close within 60 trading days either side, at least 10% below its 1-year high.
// Flows and sentiment have no daily history here, so the comparison uses the market signs only (out of 60).
var _bt = null;
function fwd(c, from, days) { return from + days < c.length ? (c[from + days] / c[from] - 1) * 100 : null; }
function backtest() {
  var s = series(SPX), v = series(VIX);
  if (!s || !v || s.closes.length < 400) return null;
  var key = s.dates[s.dates.length - 1] + s.closes.length + '/' + v.closes.length; if (_bt && _bt.key === key) return _bt;
  var c = s.closes, n = c.length, vi = {}, sc = new Array(n), dd = new Array(n), vx = new Array(n), rs = new Array(n), g = 0, l = 0, i, j;
  v.dates.forEach(function (d, k) { vi[d] = k; });
  rs[0] = null;
  for (i = 1; i < n; i++) {   // Wilder's RSI, running
    var e = c[i] - c[i - 1];
    if (i <= 14) { g += Math.max(0, e); l += Math.max(0, -e); if (i === 14) { g /= 14; l /= 14; } }
    else { g = (g * 13 + Math.max(0, e)) / 14; l = (l * 13 + Math.max(0, -e)) / 14; }
    rs[i] = i < 14 ? null : l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  for (i = 0; i < n; i++) {
    var hi = 0; for (j = Math.max(0, i - 251); j <= i; j++) if (c[j] > hi) hi = c[j];
    dd[i] = (c[i] / hi - 1) * 100;
    var k = vi[s.dates[i]], pts = 0;
    if (k !== undefined) { vx[i] = v.closes[k]; pts += step(vx[i], PTS.vix); if (k >= 20) pts += step((vx[i] / avg(v.closes.slice(k - 20, k)) - 1) * 100, PTS.jump); }
    pts += step(-dd[i], PTS.dd);
    if (rs[i] !== null) pts += step(-rs[i], PTS.rsi);
    if (s.hasVol && i >= 25) {
      var fx = 0;
      for (j = i - 4; j <= i; j++) { if (!(c[j] < c[j - 1]) || !s.vols[j]) continue; var b = avg(s.vols.slice(j - 20, j).filter(function (x) { return x > 0; })); if (b) fx = Math.max(fx, s.vols[j] / b); }
      pts += step(fx, PTS.flush);
    }
    sc[i] = pts;
  }
  var lows = [];
  for (i = 20; i < n - 20; i++) {
    if (dd[i] > -10) continue;
    var isLow = true; for (j = Math.max(0, i - 60); j <= Math.min(n - 1, i + 60); j++) if (c[j] < c[i]) { isLow = false; break; }
    if (!isLow) continue;
    var pk = i; for (j = Math.max(0, i - 30); j <= Math.min(n - 1, i + 5); j++) if (sc[j] > sc[pk]) pk = j;
    var vmax = 0; for (j = Math.max(0, i - 30); j <= i; j++) if (vx[j] > vmax) vmax = vx[j];
    lows.push({ i:i, d:s.dates[i], close:c[i], dd:dd[i], vmax:vmax, score:sc[i], peak:sc[pk], peakD:s.dates[pk], lead:i - pk,
      r6:fwd(c, i, 126), r12:fwd(c, i, 252), p12:fwd(c, pk, 252) });
  }
  _bt = { key:key, s:s, sc:sc, dd:dd, lows:lows, now:{ score:sc[n - 1], dd:dd[n - 1], vix:vx[n - 1], d:s.dates[n - 1] } };
  return _bt;
}
var LOW_NAMES = [['2020-02', '2020-04', 'COVID crash'], ['2022-01', '2022-03', '2022: first leg down'], ['2022-05', '2022-07', '2022: summer low'], ['2022-09', '2022-11', '2022: the bottom'],
  ['2023-10', '2023-11', '2023: autumn correction'], ['2025-03', '2025-05', '2025: tariff shock']];
function lowName(d) { var m = d.slice(0, 7), x = LOW_NAMES.filter(function (r) { return m >= r[0] && m <= r[1]; })[0]; return x ? x[2] : pd(d).toLocaleDateString('en-GB', { month:'long', year:'numeric' }); }
function sgn(v) { return v === null || v === undefined ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(0) + '%'; }
function longDate(d) { return pd(d).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }); }
function backtestHTML() {
  var B = backtest();
  if (!B) return '<div class="lbl" style="margin-top:6px">Backtest · earlier lows</div><p class="soon">Loading the S&amp;P 500 and the VIX since 2019 for the comparison…</p>';
  var s = B.s, n = s.closes.length, W = 760, R = 40, PW = W - R, T = 10, M = 170, T2 = 190, B2 = 254, H = 272, i;
  var lo = Math.log(Math.min.apply(null, s.closes) * 0.93), hi = Math.log(Math.max.apply(null, s.closes) * 1.03);
  var x = function (k) { return k / (n - 1) * PW; }, y = function (v) { return M - (Math.log(v) - lo) / (hi - lo) * (M - T); }, y2 = function (v) { return B2 - v / MARKET_MAX * (B2 - T2); };
  var g = '', path = '', area = '', st = Math.max(1, Math.floor(n / 700));
  [2000, 3000, 4000, 5000, 6000, 7000, 8000].forEach(function (v) { if (Math.log(v) > lo && Math.log(v) < hi) g += '<line x1="0" x2="' + PW + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" stroke="var(--rule)"/><text x="' + (PW + 5) + '" y="' + (y(v) + 3.5).toFixed(1) + '" class="t">' + (v / 1000) + 'k</text>'; });
  var yrs = {}; s.dates.forEach(function (d, k) { var yy = d.slice(0, 4); if (!yrs[yy] && d.slice(5, 7) === '01') { yrs[yy] = 1; g += '<line x1="' + x(k).toFixed(1) + '" x2="' + x(k).toFixed(1) + '" y1="' + T + '" y2="' + B2 + '" stroke="var(--rule)"/><text x="' + (x(k) + 3).toFixed(1) + '" y="' + (B2 + 14) + '" class="t">' + yy + '</text>'; } });
  for (i = 0; i < n; i += st) { path += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(s.closes[i]).toFixed(1); area += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y2(B.sc[i]).toFixed(1); }
  path += 'L' + x(n - 1).toFixed(1) + ' ' + y(s.closes[n - 1]).toFixed(1);
  area += 'L' + x(n - 1).toFixed(1) + ' ' + y2(B.sc[n - 1]).toFixed(1) + 'L' + x(n - 1).toFixed(1) + ' ' + B2 + 'L0 ' + B2 + 'Z';
  g += '<path d="' + path + '" fill="none" stroke="var(--ink)" stroke-width="1.4"/>' +
    '<path d="' + area + '" fill="var(--s3)" opacity=".6"/><line x1="0" x2="' + PW + '" y1="' + B2 + '" y2="' + B2 + '" stroke="var(--ink)"/>' +
    '<line x1="0" x2="' + PW + '" y1="' + y2(35).toFixed(1) + '" y2="' + y2(35).toFixed(1) + '" stroke="var(--signal)" stroke-dasharray="3 3"/><text x="' + (PW + 5) + '" y="' + (y2(35) + 3.5).toFixed(1) + '" class="t" style="fill:var(--signal)">35</text>' +
    '<text x="0" y="' + (T2 - 5) + '" class="t">market signs · out of 60</text>';
  B.lows.forEach(function (L, k) { g += '<circle cx="' + x(L.i).toFixed(1) + '" cy="' + y(L.close).toFixed(1) + '" r="6" fill="none" stroke="var(--signal)" stroke-width="2"/><text x="' + x(L.i).toFixed(1) + '" y="' + (y(L.close) + 19).toFixed(1) + '" text-anchor="middle" class="t" style="fill:var(--signal)">' + (k + 1) + '</text>'; });
  g += '<circle cx="' + x(n - 1).toFixed(1) + '" cy="' + y(s.closes[n - 1]).toFixed(1) + '" r="4" fill="var(--ink)"/><text x="' + (x(n - 1) - 8).toFixed(1) + '" y="' + (y(s.closes[n - 1]) + 4).toFixed(1) + '" text-anchor="end" class="t">now</text>';
  var svg = '<div class="bh-chart cp-bt"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="S&amp;P 500 since 2019 with earlier lows circled, and the market part of the score">' + g + '</svg></div>';
  var peaks = B.lows.map(function (L) { return L.peak; }).sort(function (a, b) { return a - b; }), med = peaks.length ? peaks[Math.floor(peaks.length / 2)] : 0;
  var tab = '<div class="cp-tw"><table class="id-tab cp-tab cp-ideas cp-bttab"><thead><tr><th>#</th><th>Low</th><th class="r">S&amp;P fell</th><th class="r">VIX high</th><th class="r">Peak score</th><th class="r">On the low</th><th class="r">12 m after</th></tr></thead><tbody>' +
    B.lows.map(function (L, k) {
      return '<tr><td class="num">' + (k + 1) + '</td><td><b>' + esc(lowName(L.d)) + '</b><small>' + longDate(L.d) + '</small></td><td class="r num">' + sgn(L.dd) + '</td><td class="r num">' + (L.vmax ? L.vmax.toFixed(0) : '—') + '</td>' +
        '<td class="r num">' + L.peak + '<small>' + (L.lead > 0 ? L.lead + ' days before' : L.lead < 0 ? -L.lead + ' days after' : 'that day') + '</small></td><td class="r num">' + L.score + '</td><td class="r num">' + sgn(L.r12) + '</td></tr>';
    }).join('') +
    '<tr class="cp-now"><td></td><td><b>Now</b><small>' + longDate(B.now.d) + '</small></td><td class="r num">' + sgn(B.now.dd) + '</td><td class="r num">' + (B.now.vix ? B.now.vix.toFixed(0) : '—') + '</td><td class="r num"><b>' + B.now.score + '</b></td><td class="r num">—</td><td class="r num">—</td></tr></tbody></table></div>';
  var p12 = B.lows.filter(function (L) { return L.p12 !== null; }), avg12 = p12.length ? avg(p12.map(function (L) { return L.p12; })) : null;
  var verdict = !B.lows.length ? 'No low of 10% or more since 2019 in this data.' :
    'At the ' + B.lows.length + ' lows since 2019 the market signs peaked between ' + peaks[0] + ' and ' + peaks[peaks.length - 1] + ' out of 60 (middle ' + med + '), mostly in the days before the low. Today: <b>' + B.now.score + '</b>' +
    (B.now.score >= med ? ', as high as at a typical low.' : B.now.score >= peaks[0] ? ', inside the range of earlier lows, below the middle.' : ', below every earlier low.') +
    (avg12 !== null ? ' Buying on the day of each peak reading returned ' + sgn(avg12) + ' on average over the next 12 months.' : '');
  return '<div class="lbl" style="margin-top:6px">Backtest · earlier lows since 2019</div>' + svg + '<p class="cp-btv">' + verdict + '</p>' + tab +
    '<p class="soon">Market signs only (VIX, its jump, the drop, RSI, a selling-volume flush), worked out exactly like today’s score from daily closes. Flows and sentiment have no daily history here. Earlier lows don’t promise the next one.</p>';
}
function dm(d) { var x = pd(d); return x.getDate() + '.' + (x.getMonth() + 1) + '.'; }

function capHTML(list, latest) {
  if ((UI.api || 1) < 7) return '<section class="card cp-card"><h3>Capitulation gauge</h3><p class="soon">Needs the latest Code.gs (API 7), so prices come with their daily volume. Paste it in Apps Script, then Deploy → Manage deployments → New version.</p></section>';
  _px = null;
  var G = gauge(), W = weekly(), sc = G.score;
  var h = '<section class="card cp-card"><h3>Capitulation gauge<span class="r">' + (G.flowsDate ? 'flows ' + dm(G.flowsDate) + ' · ' : '') + 'next check Friday</span></h3>';
  if (!G.marketOK) return h + '<p class="soon">Loading the VIX and the S&amp;P 500…</p></section>';
  h += '<div class="cp-score"><b class="num">' + sc + '<small>/100</small></b><div><b>' + G.zone[1] + '</b><span>' + G.zone[2] + '</span></div></div>' +
    '<div class="cp-gauge" role="img" aria-label="Score ' + sc + ' of 100: ' + G.zone[1] + '"><span class="cp-needle" style="left:' + Math.min(99.5, sc) + '%"></span><div class="cp-bands"><i></i><i></i><i></i><i></i></div>' +
    '<div class="cp-ticks"><span>Calm</span><span>Stress</span><span>Fear</span><span>Capitulation 70+</span></div></div>';
  h += '<div class="cp-tw"><table class="id-tab cp-tab"><thead><tr><th>Sign</th><th>Reading</th><th class="r">Points</th></tr></thead><tbody>';
  [['m', 'Market · measured every day by the app'], ['f', 'Retail flows & sentiment · Claude’s Friday check']].forEach(function (grp) {
    h += '<tr class="cp-grp"><td colspan="3">' + grp[1] + '</td></tr>';
    G.rows.filter(function (r) { return r.g === grp[0]; }).forEach(function (r) {
      var cls = r.pts === null ? 'na' : r.pts >= r.max ? 'on' : r.pts > 0 ? 'half' : 'off';
      h += '<tr><td>' + esc(r.label) + '<small>' + esc(r.hint) + (r.src && r.src.src ? ' · ' + (r.src.url ? '<a href="' + esc(r.src.url) + '" target="_blank" rel="noopener">' + esc(r.src.src) + '</a>' : esc(r.src.src)) : '') + '</small></td>' +
        '<td class="num">' + esc(r.reading) + '</td><td class="r"><span class="cp-pill ' + cls + '">' + (r.pts === null ? 'no data' : r.pts + ' / ' + r.max) + '</span></td></tr>';
    });
  });
  h += '</tbody></table></div>';
  if (!G.flowsDate) h += '<p class="soon">No flow reading from Claude in the last 10 days, so the score counts market signs only.</p>';
  h += '<div class="lbl">Score every Friday · last 12 weeks</div><div class="cp-weeks" role="img" aria-label="Weekly score">' +
    W.map(function (w) { return '<i class="' + (w.score >= 70 ? 'hot' : w.score >= 50 ? 'warm' : '') + '" style="height:' + Math.max(2, w.score) + '%" title="' + dm(w.d) + ': ' + w.score + (w.flows ? '' : ' (market only)') + '"></i>'; }).join('') +
    '<span class="cp-line"><span>70</span></span></div><div class="cp-wl">' + W.map(function (w, k) { return '<span>' + (k % 2 === 1 || k === 11 ? dm(w.d) : '') + '</span>'; }).join('') + '</div>';
  var withT = list.filter(function (i) { return i.ticker; });
  if (withT.length) {
    h += '<div class="lbl" style="margin-top:6px">Your ideas</div><div class="cp-tw"><table class="id-tab cp-tab cp-ideas"><thead><tr><th>Idea</th><th class="r">From high</th><th class="r">RSI 14</th><th class="r">Volume flush</th><th>Reading</th></tr></thead><tbody>' +
      withT.map(function (i) {
        var s = ideaSigns(i);
        if (s.too) return '<tr><td><b>' + esc(i.ticker) + '</b></td><td class="r num">—</td><td class="r num">—</td><td class="r num">—</td><td><span class="cp-pill off">too new</span></td></tr>';
        return '<tr><td><b>' + esc(i.ticker) + '</b></td><td class="r num">' + (s.high >= -0.05 ? 'at high' : '−' + Math.abs(s.high).toFixed(0) + '%') + '</td><td class="r num">' + (s.rsi === null ? '—' : s.rsi.toFixed(0)) + '</td>' +
          '<td class="r num">' + (s.flush && s.flush.x ? s.flush.x.toFixed(1) + '×' + (s.flush.x >= 2 ? ' · ' + dm(s.flush.d) : '') : '—') + '</td><td><span class="cp-pill ' + s.read[1] + '">' + s.read[0] + '</span></td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  var smalls = [], watch = [];
  list.forEach(function (i) { var l = latest(i); if (!l) return; if (l.verdict === 'small') smalls.push(i.ticker || i.name); if (l.verdict === 'watch') watch.push(i.ticker || i.name); });
  h += '<div class="cp-act"><b>What it means for your ideas</b><p>Below 50, buy only as planned. From 50 to 70, start the first step of anything marked “small”' + (smalls.length ? ' (' + esc(smalls.join(', ')) + ')' : '') +
    '. Above 70, the Friday check considers the next steps, and moving “watch” ideas' + (watch.length ? ' (' + esc(watch.join(', ')) + ')' : '') + ' up a level. The gauge never raises a share above its limit.</p></div>' +
    backtestHTML() +
    '<p class="soon">Capitulation marks the zone where bottoms tend to form, not the day: in 2020 and 2022 the strongest readings came days to weeks before the low, and some bottoms came without a flush. Use it to time steps, not to go all in.</p></section>';
  return h;
}

export { capHTML, gauge, weekly, backtest, rsi, flush, VIX, SPX, GAUGE_FROM };
