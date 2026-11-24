// FlowFin · Capitulation gauge on the Ideas tab: how many of the usual signs of panic selling are showing.
// Market signs are measured by the app from daily prices (VIX, S&P 500, each idea); retail flows and sentiment
// (Vanda, JPMorgan, Bank of America, AAII) come from Claude's Friday check, as a "market" block in the ideas inbox.
// Approved 24.11.2026 (mockup "FlowFin Capitulation Gauge"). It says where a bottom is likely, not the day.
import { addDays, esc, lsGet, pd, today, ymd } from './core.js';

var PX_KEY = 'ff_prices_v1';
var VIX = '^VIX', SPX = '^GSPC';
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
    add('m', 'Volatility (VIX)', 'above 30 = fear, above 40 = panic', v.toFixed(1), step(v, [[40, 15], [30, 12], [25, 8], [20, 4]]), 15, true);
    add('m', 'VIX jump', 'against its own 20-day average', (jump >= 0 ? '+' : '−') + Math.abs(jump).toFixed(0) + '%', step(jump, [[50, 10], [30, 7], [15, 3]]), 10, true);
  } else { add('m', 'Volatility (VIX)', 'above 30 = fear, above 40 = panic', '—', 0, 15, false); add('m', 'VIX jump', 'against its own 20-day average', '—', 0, 10, false); }
  if (spx && spx.closes.length > 30) {
    var dd = fromHigh(spx), r = rsi(spx.closes.slice(-120)), fl = flush(spx, 5);
    add('m', 'S&P 500 down from its high', '10% = correction, 20% = bear market', '−' + Math.abs(dd).toFixed(1) + '%', step(-dd, [[25, 15], [20, 12], [15, 9], [10, 6], [5, 2]]), 15, true);
    add('m', 'S&P 500 RSI, 14 days', 'below 30 = oversold', r === null ? '—' : r.toFixed(0), r === null ? 0 : step(-r, [[-25, 10], [-30, 7], [-35, 4], [-40, 2]]), 10, r !== null);
    add('m', 'Selling-volume flush', 'a down day with 2× normal volume or more, last 5 days', fl ? fl.x.toFixed(1) + '×' : '—', fl ? step(fl.x, [[2, 10], [1.7, 6], [1.4, 3]]) : 0, 10, !!fl);
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
    '<p class="soon">Capitulation marks the zone where bottoms tend to form, not the day: in 2020 and 2022 the strongest readings came days to weeks before the low, and some bottoms came without a flush. Use it to time steps, not to go all in.</p></section>';
  return h;
}

export { capHTML, gauge, weekly, rsi, flush, VIX, SPX };
