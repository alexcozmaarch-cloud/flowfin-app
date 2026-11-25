// FlowFin · Ideas: investing ideas you hear about, tracked from the day you mention them (approved 24.11.2026).
// Each idea is one Settings row (key idea_<id>, JSON) so nothing needs a new tab in the Sheet:
//   { id, name, ticker, date, source, views:[{ date, verdict, text }] }
// Prices come from your Apps Script (API 5), which asks Yahoo Finance; they're kept on this phone for 12 hours.
// Claude's views arrive as a paste code "FFIDEA:<base64 JSON>" written in the chat.
import { post } from './api.js';
import { $, addDays, chf0, daysBetween, esc, fmtCHF, lsGet, lsSet, pd, toast, today, ymd } from './core.js';
import { draw, topbar } from './nav.js';
import { saveSetting } from './settings.js';
import { behaviourModel } from './behaviour.js';
import { capHTML, VIX, SPX, GAUGE_FROM } from './capitulation.js';
import { brokersHTML, sliceAdvice } from './brokers.js';
import { holdingsHTML, taxHTML, holdingSymbols, buysOf } from './holdings.js';

var BENCH_DEFAULT = 'VWRL.SW';   // Vanguard FTSE All-World, traded in CHF on SIX
// the yardsticks every idea is drawn and compared against (Yahoo symbols)
var BENCHES = [{ sym:null, label:'World', short:'world', dash:'' }, { sym:'^GSPC', label:'S&P 500', short:'S&P', dash:'6 4' }, { sym:'^SSMI', label:'SMI', short:'SMI', dash:'2 3' }];
var CORR_DAYS = 250;   // about one year of trading days for "moves with" 
var PX_KEY = 'ff_prices_v1', PX_TTL = 12 * 3600e3;
var VERDICTS = { pass:['pass', 'neg'], watch:['watch', ''], small:['worth a small position', 'pos'], core:['worth a core position', 'pos'] };
var LOADING = {};

function ideas() {
  return (DATA.Settings || []).filter(function (r) { return /^idea_/.test(r.key || ''); }).map(function (r) {
    try { var o = JSON.parse(r.value); o._sid = r.id; o._key = r.key; return o; } catch (e) { return null; }
  }).filter(Boolean).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
}
function bench() { var b = ((DATA.Settings || []).filter(function (r) { return r.key === 'idea_benchmark_sym'; })[0] || {}).value; return String(b || BENCH_DEFAULT).toUpperCase(); }
function saveIdea(o) { var c = Object.assign({}, o); delete c._sid; delete c._key; return saveSetting('idea_' + o.id, JSON.stringify(c)); }

// ─── paste codes from the chat ─────────────────────────────────────────────
function decodeCode(text) {
  var m = /FFIDEA:([A-Za-z0-9+/=_-]+)/.exec(String(text || '').replace(/\s+/g, ''));
  if (!m) return null;
  try {
    var b64 = m[1].replace(/-/g, '+').replace(/_/g, '/'), bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var o = JSON.parse(new TextDecoder().decode(bytes));
    return { name:o.n || o.name || '', ticker:String(o.t || o.ticker || '').toUpperCase(), date:o.d || o.date || ymd(today()), source:o.s || o.source || '',
      view:(o.v || o.view) ? { date:(o.v || o.view).d || o.d || ymd(today()), verdict:(o.v || o.view).r || (o.v || o.view).verdict || 'watch', text:(o.v || o.view).x || (o.v || o.view).text || '', pct:(o.v || o.view).p === undefined ? null : +(o.v || o.view).p } : null };
  } catch (e) { return null; }
}
// a code for an idea you already have adds the new view on top; otherwise it's a new idea
function addFromCode(text) {
  var c = decodeCode(text); if (!c || !c.name) return Promise.reject(new Error('That doesn’t look like a code from Claude'));
  var have = ideas().filter(function (x) { return (c.ticker && x.ticker === c.ticker) || (!c.ticker && x.name.toLowerCase() === c.name.toLowerCase()); })[0];
  if (have) {
    have.views = have.views || [];
    if (c.view && !have.views.some(function (v) { return v.date === c.view.date && v.text === c.view.text; })) have.views.unshift(c.view);
    return saveIdea(have).then(function () { return { idea:have, added:false }; });
  }
  var o = { id:Date.now().toString(36), name:c.name, ticker:c.ticker, date:c.date, source:c.source, views:c.view ? [c.view] : [] };
  return saveIdea(o).then(function () { return { idea:o, added:true }; });
}
function addManual(f) {
  var o = { id:Date.now().toString(36), name:f.name, ticker:String(f.ticker || '').trim().toUpperCase(), date:f.date || ymd(today()), source:f.source || '', views:[] };
  return saveIdea(o).then(function () { return o; });
}

// ─── prices ────────────────────────────────────────────────────────────────
function pxCache() { try { return JSON.parse(lsGet(PX_KEY) || '{}'); } catch (e) { return {}; } }
function px(sym) { var c = pxCache()[sym]; return c && c.dates ? c : null; }
function loadPrices(force) {
  if ((UI.api || 1) < 5) return Promise.resolve(false);
  var list = ideas(), syms = {}, from = '';
  list.forEach(function (i) { if (i.ticker) { syms[i.ticker] = 1; if (!from || i.date < from) from = i.date; } });
  var gaugeOn = (UI.api || 1) >= 7;   // the capitulation gauge needs the VIX and the S&P 500 with volume, back to 2019 for the backtest
  if (!Object.keys(syms).length && !gaugeOn && !holdingSymbols().syms.length) return Promise.resolve(false);
  benches().forEach(function (b) { syms[b.sym] = 1; });
  var HS = holdingSymbols(); HS.syms.forEach(function (x) { syms[x] = 1; }); if (HS.from && (!from || HS.from < from)) from = HS.from;
  if (!from) from = ymd(today());
  // a year before the oldest idea too, so "moves with" (correlation) has enough days
  var yearAgo = ymd(addDays(today(), -370)); if (from > yearAgo) from = yearAgo;
  var groups = [];
  if (gaugeOn) { delete syms[VIX]; delete syms[SPX]; groups.push({ syms:[VIX, SPX], from:GAUGE_FROM }); }
  groups.push({ syms:Object.keys(syms), from:from });
  var c = pxCache();
  return Promise.all(groups.map(function (g) {
    var want = g.syms.filter(function (s) { var x = c[s]; return !LOADING[s] && (force || !x || Date.now() - x.at > PX_TTL || (x.from || '9') > g.from || (gaugeOn && !x.vols && !x.error)); });
    if (!want.length) return false;
    want.forEach(function (s) { LOADING[s] = 1; });
    return post({ action:'prices', symbols:want, from:g.from }).then(function (j) {
      var c2 = pxCache();
      Object.keys(j.prices || {}).forEach(function (s) { c2[s] = Object.assign({ at:Date.now(), from:g.from }, j.prices[s]); });
      lsSet(PX_KEY, JSON.stringify(c2));
      return true;
    }).catch(function (e) { UI.ideasErr = e.message; return false; })
      .then(function (v) { want.forEach(function (s) { delete LOADING[s]; }); return v; });
  })).then(function (r) { return r.some(Boolean); });
}
// closes from the idea's date on (the first trading day on or after it)
function sinceEntry(p, date) {
  if (!p || !p.dates || !p.dates.length) return null;
  var i = 0; while (i < p.dates.length && p.dates[i] < date) i++;
  if (i >= p.dates.length) return null;
  return { dates:p.dates.slice(i), closes:p.closes.slice(i) };
}
function benches() { return BENCHES.map(function (b) { return Object.assign({}, b, { sym:b.sym || bench() }); }); }
// daily returns on the days both traded, over the last ~year: correlation (−1…1) and beta (how much it moves per 1% of the index)
function corr(a, b) {
  if (!a || !b) return null;
  var bm = {}; b.dates.forEach(function (d, i) { bm[d] = b.closes[i]; });
  var xs = [], ys = [], prevA = null, prevB = null;
  a.dates.forEach(function (d, i) { if (bm[d] === undefined) return; if (prevA !== null) { xs.push(a.closes[i] / prevA - 1); ys.push(bm[d] / prevB - 1); } prevA = a.closes[i]; prevB = bm[d]; });
  xs = xs.slice(-CORR_DAYS); ys = ys.slice(-CORR_DAYS);
  var n = xs.length; if (n < 20) return null;
  var mx = xs.reduce(function (s, v) { return s + v; }, 0) / n, my = ys.reduce(function (s, v) { return s + v; }, 0) / n, sxy = 0, sxx = 0, syy = 0;
  for (var i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); syy += (ys[i] - my) * (ys[i] - my); }
  return sxx && syy ? { r:sxy / Math.sqrt(sxx * syy), beta:sxy / syy, n:n } : null;
}
function stats(idea) {
  var full = px(idea.ticker), s = sinceEntry(full, idea.date);
  if (!s) return null;
  var entry = s.closes[0], last = s.closes[s.closes.length - 1], chg = (last / entry - 1) * 100;
  var bs = benches().map(function (b) {
    var bp = px(b.sym), bb = sinceEntry(bp, idea.date);
    return Object.assign({}, b, { s:bb, chg:bb ? (bb.closes[bb.closes.length - 1] / bb.closes[0] - 1) * 100 : null, c:corr(full, bp) });
  });
  var w = bs[0];
  return { s:s, b:w.s, bs:bs, entry:entry, last:last, chg:chg, bchg:w.chg, lastDate:s.dates[s.dates.length - 1], cur:(full || {}).currency || '' };
}

// ─── drawing ───────────────────────────────────────────────────────────────
function fmtP(v) { return v >= 1000 ? fmtCHF.format(Math.round(v)) : v.toFixed(2); }
function pct(v) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%'; }
function dm(d) { var x = pd(d); return x.getDate() + '.' + (x.getMonth() + 1) + '.'; }
function linePath(vals, W, H, lo, hi) { return vals.map(function (v, i) { return (i ? 'L' : 'M') + (vals.length > 1 ? i * W / (vals.length - 1) : 0).toFixed(1) + ' ' + (H - (v - lo) / (hi - lo || 1) * H).toFixed(1); }).join(' '); }
function spark(st) {
  if (!st || st.s.closes.length < 2) return '<span class="id-spark"></span>';
  var v = st.s.closes, lo = Math.min.apply(null, v), hi = Math.max.apply(null, v);
  return '<svg class="id-spark" viewBox="0 0 120 32" aria-hidden="true"><path d="' + linePath(v, 120, 30, lo, hi) + '" fill="none" stroke="var(--ink)" stroke-width="1.5"/><circle cx="1.5" cy="' + (30 - (v[0] - lo) / (hi - lo || 1) * 30).toFixed(1) + '" r="2.5" fill="var(--signal)"/></svg>';
}
function rebased(st, b) {   // a yardstick rebased to the idea's entry price, on the idea's trading days
  if (!b.s || b.s.closes.length < 2) return null;
  var bm = {}; b.s.dates.forEach(function (d, i) { bm[d] = b.s.closes[i]; });
  var last = b.s.closes[0]; return st.s.dates.map(function (d) { if (bm[d] !== undefined) last = bm[d]; return last / b.s.closes[0] * st.entry; });
}
function bigChart(st, idea) {
  var W = 640, H = 180, v = st.s.closes, lines = st.bs.map(function (b) { return { b:b, v:rebased(st, b) }; }).filter(function (x) { return x.v; });
  var bv = lines.length ? lines[0].v : null;
  var all = v.concat.apply(v, lines.map(function (x) { return x.v; })), lo = Math.min.apply(null, all) * 0.98, hi = Math.max.apply(null, all) * 1.02, y = function (x) { return H - (x - lo) / (hi - lo) * H; };
  var n = st.s.dates.length, mid = st.s.dates[Math.floor(n / 2)];
  return '<div class="id-chart"><svg viewBox="0 -14 ' + W + ' ' + (H + 34) + '" role="img" aria-label="' + esc(idea.name) + ' since you mentioned it' + (bv ? ', with the world ETF' : '') + '">' +
    '<line x1="0" x2="' + W + '" y1="' + y(st.entry).toFixed(1) + '" y2="' + y(st.entry).toFixed(1) + '" stroke="var(--rule)" stroke-dasharray="3 3"/>' +
    lines.map(function (x) { return '<path d="' + linePath(x.v, W, H, lo, hi) + '" fill="none" stroke="var(--s3)" stroke-width="1.5"' + (x.b.dash ? ' stroke-dasharray="' + x.b.dash + '"' : '') + '/>'; }).join('') +
    '<path d="' + linePath(v, W, H, lo, hi) + '" fill="none" stroke="var(--ink)" stroke-width="2"/>' +
    '<circle cx="4" cy="' + y(st.entry).toFixed(1) + '" r="5" fill="var(--signal)"/>' +
    buysOf(idea.ticker).map(function (b) { var k = st.s.dates.indexOf(b.d); if (k < 0) { for (k = 0; k < n && st.s.dates[k] < b.d; k++); if (k >= n) return ''; } var bx = k / Math.max(1, n - 1) * W;
      return '<circle cx="' + bx.toFixed(1) + '" cy="' + y(v[k]).toFixed(1) + '" r="4.5" fill="var(--paper)" stroke="var(--ink)" stroke-width="2"><title>bought ' + dm(b.d) + '</title></circle>'; }).join('') +
    '<text x="12" y="' + (y(st.entry) - 8).toFixed(1) + '" class="t">entry ' + dm(st.s.dates[0]) + ' · ' + fmtP(st.entry) + '</text>' +
    '<text x="' + W + '" y="' + (y(st.last) - 8).toFixed(1) + '" text-anchor="end" class="t">' + fmtP(st.last) + ' · ' + pct(st.chg) + '</text>' +
    endLabels(lines, y, W, st) +
    '<line x1="0" x2="' + W + '" y1="' + H + '" y2="' + H + '" stroke="var(--ink)"/>' +
    '<text x="0" y="' + (H + 16) + '" class="t">' + dm(st.s.dates[0]) + '</text>' + (n > 6 ? '<text x="' + W / 2 + '" y="' + (H + 16) + '" text-anchor="middle" class="t">' + dm(mid) + '</text>' : '') +
    '<text x="' + W + '" y="' + (H + 16) + '" text-anchor="end" class="t">' + dm(st.lastDate) + '</text></svg></div>';
}
// labels at the right end of each yardstick line, nudged apart so they don't overlap
function endLabels(lines, y, W, st) {
  var ys = lines.map(function (x) { return { t:x.b.short + ' ' + pct(x.b.chg), y:y(x.v[x.v.length - 1]) + 4 }; }).sort(function (a, b) { return a.y - b.y; });
  var own = y(st.last) - 8;
  ys.forEach(function (l, i) { if (Math.abs(l.y - own) < 22) l.y = own + 24; if (i && l.y - ys[i - 1].y < 22) l.y = ys[i - 1].y + 22; });
  return ys.map(function (l) { return '<text x="' + (W - 2) + '" y="' + l.y.toFixed(1) + '" text-anchor="end" class="t">' + esc(l.t) + '</text>'; }).join('');
}
// how the idea moved against each yardstick: since you mentioned it, and day by day over the last year
function compareHTML(st) {
  function cword(r) { return r === null ? '—' : r >= 0.8 ? 'very closely' : r >= 0.6 ? 'closely' : r >= 0.35 ? 'somewhat' : r >= 0.1 ? 'loosely' : 'on its own'; }
  return '<div class="id-cmp"><div class="id-keys"><span><i class="ln"></i>this idea</span>' + st.bs.map(function (b) { return '<span><i class="ln g' + (b.dash ? ' d' + b.dash.split(' ')[0] : '') + '"></i>' + esc(b.label) + '</span>'; }).join('') + '</div>' +
    '<table class="id-tab"><thead><tr><th></th><th>Since mentioned</th><th>Gap</th><th>Moves with it · 1 yr</th><th>Beta</th></tr></thead><tbody>' +
    st.bs.map(function (b) {
      var gap = b.chg === null ? null : st.chg - b.chg, c = b.c;
      return '<tr><td>' + esc(b.label) + '</td><td class="num">' + (b.chg === null ? '—' : pct(b.chg)) + '</td><td class="num ' + (gap === null ? '' : gap >= 0 ? 'pos' : 'neg') + '">' + (gap === null ? '—' : (gap >= 0 ? '+' : '−') + Math.abs(gap).toFixed(1) + ' pts') + '</td>' +
        '<td class="num">' + (c ? c.r.toFixed(2) + ' <small>' + cword(c.r) + '</small>' : '—') + '</td><td class="num">' + (c ? c.beta.toFixed(2) : '—') + '</td></tr>';
    }).join('') + '</tbody></table>' +
    '<p class="chartnote" style="margin:8px 0 0">“Moves with it” is the correlation of daily moves over the last year: 1 = in lockstep, 0 = unrelated. Beta: how much it moved for every 1% of the index (1.5 = half as much again). A high correlation with a fund you already own means it adds little diversification.</p></div>';
}
function verdictPill(v) { var x = VERDICTS[v] || VERDICTS.watch; return '<span class="otag id-v ' + x[1] + '">' + x[0] + '</span>'; }
// a little formatting for views written in the chat: blank line = new paragraph, **bold**
function viewText(t) {
  return String(t || '').split(/\n\s*\n/).map(function (p) { return '<p>' + esc(p.trim()).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>') + '</p>'; }).join('');
}

// ─── the inbox in Drive: Claude's new ideas and Friday checks (API 6) ─────────
// file: { ideas:[{ n, t, d, s, v:{ d, r, p, x } }], checks:[{ t, n, d, r, p, note, price }] }
function doneList() { try { return JSON.parse(((DATA.Settings || []).filter(function (r) { return r.key === 'ideas_inbox_done'; })[0] || {}).value || '[]'); } catch (e) { return []; } }
function findIdea(list, t, n) { return list.filter(function (x) { return (t && x.ticker === String(t).toUpperCase()) || (!t && n && x.name.toLowerCase() === String(n).toLowerCase()); })[0]; }
function applyInbox(obj, list, changed) {
  (obj.ideas || []).forEach(function (o) {
    var t = String(o.t || '').toUpperCase(), have = findIdea(list, t, o.n), v = o.v ? { date:o.v.d || o.d, verdict:o.v.r || 'watch', text:o.v.x || '', pct:o.v.p === undefined ? null : +o.v.p } : null;
    if (!have) { have = { id:Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name:o.n, ticker:t, date:o.d, source:o.s || '', views:[], checks:[] }; list.push(have); }
    var same = v && (have.views || []).filter(function (x) { return x.date === v.date && x.text === v.text; })[0];
    if (same) { if ((same.pct === null || same.pct === undefined) && v.pct !== null) same.pct = v.pct; }   // pasted earlier as a code: just add the share
    else if (v) have.views = [v].concat(have.views || []);
    changed[have.id] = have;
  });
  if (obj.brokers && obj.brokers.d && obj.brokers.list && changed && (!changed._brokers || changed._brokers.d < obj.brokers.d)) changed._brokers = obj.brokers;
  if (obj.market && obj.market.d && changed) { changed._market = (changed._market || []).concat([{ d:obj.market.d, items:obj.market.items || [] }]); }
  (obj.checks || []).forEach(function (c) {
    var have = findIdea(list, c.t, c.n); if (!have) return;
    have.checks = have.checks || [];
    if (have.checks.some(function (x) { return x.date === c.d; })) return;
    have.checks.unshift({ date:c.d, verdict:c.r, pct:c.p === undefined ? null : +c.p, note:c.note || '', price:c.price === undefined ? null : +c.price });
    changed[have.id] = have;
  });
}
var SYNCED = false;
function syncInbox(force) {
  if ((UI.api || 1) < 6 || (SYNCED && !force)) return Promise.resolve(0);
  SYNCED = true;
  var list = ideas(), done = doneList();
  var exp = JSON.stringify({ exported:new Date().toISOString(), ideas:list.map(function (i) { var c = Object.assign({}, i); delete c._sid; delete c._key; return c; }) });
  return post({ action:'ideasSync', done:done, export:exp }).then(function (j) {
    var files = j.files || [], changed = {};
    files.forEach(function (f) { try { applyInbox(JSON.parse(f.text), list, changed); } catch (e) {} done.push(f.id); });
    if (!files.length) return 0;
    var market = changed._market; delete changed._market;
    var brokers = changed._brokers; delete changed._brokers;
    var ids = Object.keys(changed), chain = Promise.resolve();
    if (brokers) chain = chain.then(function () {   // the monthly broker check: newer table replaces the old one
      var cur = null; try { cur = JSON.parse(((DATA.Settings || []).filter(function (r) { return r.key === 'brokers_v'; })[0] || {}).value || 'null'); } catch (e) {}
      if (cur && cur.d >= brokers.d) return;
      return saveSetting('brokers_v', JSON.stringify({ d:brokers.d, note:brokers.note || '', list:brokers.list }));
    });
    if (market) chain = chain.then(function () {   // Friday flow readings for the capitulation gauge, newest first, half a year kept
      var hist = []; try { hist = JSON.parse(((DATA.Settings || []).filter(function (r) { return r.key === 'cap_flows'; })[0] || {}).value || '[]'); } catch (e) {}
      market.forEach(function (m) { hist = hist.filter(function (x) { return x.d !== m.d; }); hist.push(m); });
      hist.sort(function (a, b) { return a.d < b.d ? 1 : -1; });
      return saveSetting('cap_flows', JSON.stringify(hist.slice(0, 26)));
    });
    ids.forEach(function (id) { chain = chain.then(function () { return saveIdea(changed[id]); }); });
    return chain.then(function () { return saveSetting('ideas_inbox_done', JSON.stringify(done.slice(-300))); })
      .then(function () {   // send the updated list back, so Claude's next check sees what's in the app now
        var now = ideas().map(function (i) { var c = Object.assign({}, i); delete c._sid; delete c._key; return c; });
        return post({ action:'ideasSync', done:done, export:JSON.stringify({ exported:new Date().toISOString(), ideas:now }) }).catch(function () {});
      }).then(function () { return ids.length + (market ? 1 : 0) + (brokers ? 1 : 0); });
  }).catch(function (e) { UI.ideasErr = e.message; return 0; });
}
// the latest call on an idea: a Friday check or a full view, whichever is newer
function latest(i) {
  var c = (i.checks || [])[0], v = (i.views || [])[0];
  if (c && (!v || c.date >= v.date)) return { verdict:c.verdict, pct:c.pct, date:c.date };
  return v ? { verdict:v.verdict, pct:v.pct === undefined ? null : v.pct, date:v.date } : null;
}
function investable() { try { var p = behaviourModel().pot; return Math.max(0, p.avail || 0); } catch (e) { return 0; } }   // available to invest now (advised or your share of what you've saved this period)
function availHTML() {
  var p; try { p = behaviourModel().pot; } catch (e) { return ''; }
  if (!p) return '';
  return '<section class="id-avail"><b class="num">' + chf0((p.avail || 0)) + '</b><div><b>CHF available to invest now</b><p>' + p.share + '% ' + (p.own ? 'your share' : 'advised') + ' of the ' + chf0((Math.max(0, p.pot))) +
    ' you’ve saved this period · about ' + chf0((Math.max(0, p.etf))) + ' by the period’s end · split below</p></div><a href="#behaviour">Why ' + p.share + '%?</a></section>';
}
// ETFs go in a savings plan; single shares are bought when the fee is small enough at your broker
function isEtf(i) { return /\b(ETF|UCITS|QQQ|Nasdaq-100|S&P 500|MSCI|FTSE|index)\b/i.test((i.name || '') + ' ' + (i.ticker || '')) || /^(QQQ|VWRL|VWRA|VT|VOO|SPY|CSPX|EQQQ|CHSPI|SPICHA)$/i.test(i.ticker || ''); }
function stockSlice(list) {   // the smallest monthly single-share slice, for the broker card
  var inv = investable(), s = 0;
  list.forEach(function (i) { var l = latest(i); if (l && l.pct > 0 && !isEtf(i)) { var v = inv * l.pct / 100; if (v > 0 && (!s || v < s)) s = v; } });
  return s;
}
function howHTML(i, amt) {
  var recent = i.ticker ? buysOf(i.ticker).filter(function (b) { return b.d >= ymd(addDays(today(), -30)); }) : [];
  if (recent.length) return '<small class="id-how"><i class="go">✓ bought</i> ' + recent.length + '× in the last 30 days</small>';
  var A = sliceAdvice(amt, isEtf(i)), bn = esc(A.b.n.replace('Interactive Brokers', 'IBKR'));
  if (A.how === 'plan') return '<small class="id-how"><i class="go">monthly</i> savings plan</small>';
  if (A.how === 'none') return '<small class="id-how"><i class="wait">not at ' + bn + '</i> no single shares there</small>';
  if (!amt) return '';
  if (A.how === 'whole') return '<small class="id-how"><i class="wait">builds up</i> whole shares only at ' + bn + '</small>';
  if (A.how === 'monthly') return '<small class="id-how"><i class="go">monthly</i> fee ' + A.pct.toFixed(1) + '% at ' + bn + '</small>';
  var months = A.from === Infinity ? 0 : Math.ceil(A.from / amt);
  return '<small class="id-how"><i class="wait">builds up</i> ' + (A.from === Infinity ? 'fee over 1% at ' + bn + ' at any size: single shares are cheaper at IBKR or Revolut' : 'buy every ' + months + ' months (from CHF ' + fmtCHF.format(A.from) + ', fee under 1%) at ' + bn) + '</small>';
}
function allocHTML(list) {
  var inv = investable(), rows = list.map(function (i) { return { i:i, l:latest(i) }; }).filter(function (x) { return x.l && x.l.pct > 0; });
  var tot = rows.reduce(function (a, x) { return a + x.l.pct; }, 0);
  if (!rows.length) return '<p class="soon">No idea has a recommended share right now: everything you invest goes to the world ETF.</p>';
  return '<div class="id-alloc"><div class="lbl">Of what you save this period' + (inv ? ' (' + fmtCHF.format(Math.round(inv)) + ' to invest)' : '') + '</div>' +
    rows.map(function (x) { var v = inv * x.l.pct / 100; return '<div><span>' + esc(x.i.name) + howHTML(x.i, v) + '</span><span class="num">' + x.l.pct + '%</span><span class="num">' + (inv ? fmtCHF.format(Math.round(v)) : '—') + '</span></div>'; }).join('') +
    '<div class="rest"><span>World ETF (the rest)<small class="id-how"><i class="go">monthly</i> savings plan</small></span><span class="num">' + Math.max(0, 100 - tot) + '%</span><span class="num">' + (inv ? fmtCHF.format(Math.round(inv * Math.max(0, 100 - tot) / 100)) : '—') + '</span></div>' +
    '<p class="soon">The amount follows what you actually save, so it moves month to month. ETFs go in a savings plan, which buys fractions for free. Single shares can be bought in any size where the broker offers fractions; they only wait when the minimum fee would cost more than 1%.</p></div>';
}

function ideasHTML() {
  var list = ideas(), h = topbar('Ideas', false);
  if ((UI.api || 1) < 5 && list.some(function (i) { return i.ticker; })) h += '<p class="soon" style="margin:-4px 0 16px">Prices need the latest Code.gs (API 5); until then ideas are listed without charts.</p>';
  else loadPrices().then(function (changed) { if (changed && UI.page === 'ideas') draw(); });
  syncInbox().then(function (n) { if (n && UI.page === 'ideas') { toast('Claude’s updates arrived'); loadPrices(true).then(function () { draw(); }); draw(); } });
  var view = UI.idView || 'ideas';
  h += '<span class="seg2 id-views" role="radiogroup" aria-label="View">' + [['ideas', 'Ideas'], ['holdings', 'Holdings'], ['tax', 'Tax year']].map(function (o) {
    return '<button role="radio" aria-checked="' + (view === o[0]) + '" class="' + (view === o[0] ? 'on' : '') + '" data-act="idview" data-v="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</span>';
  if (view === 'holdings') return h + holdingsHTML(list);
  if (view === 'tax') return h + taxHTML();
  if (UI.idea) { var one = list.filter(function (i) { return i.id === UI.idea; })[0]; if (one) return h + ideaHTML(one); UI.idea = ''; }
  h += availHTML();
  h += '<section class="card id-list"><h3>Your ideas<span class="r">since mentioned · vs world (' + esc(bench()) + ')</span></h3>';
  h += list.length ? list.map(function (i) {
    var st = i.ticker ? stats(i) : null, v = latest(i);
    return '<div class="id-li"><button class="id-row" data-act="idopen" data-id="' + esc(i.id) + '"><span class="id-n"><b>' + esc(i.name) + (i.ticker ? ' · ' + esc(i.ticker) : '') + '</b>' +
      '<small>' + dm(i.date) + (i.source ? ' · ' + esc(i.source) : '') + '</small>' + (v ? verdictPill(v.verdict) + (v.pct > 0 ? ' <small class="num">' + v.pct + '% of investing</small>' : '') : '<span class="otag id-v">no view yet</span>') + '</span>' + spark(st) +
      '<span class="id-c num">' + (st ? '<span class="' + (st.chg >= 0 ? 'pos' : 'neg') + '">' + pct(st.chg) + '</span>' + (st.bchg !== null ? '<small>world ' + pct(st.bchg) + '</small>' : '') : '<small>' + (i.ticker ? 'price…' : 'no ticker') + '</small>') + '</span></button>' +
      '<button class="iconbtn id-x" data-act="iddel" data-id="' + esc(i.id) + '" aria-label="Delete ' + esc(i.name) + '" title="Delete">×</button></div>';
  }).join('') : '<p class="soon">No ideas yet. Tell me about one in the chat, or add it here.</p>';
  h += '<div class="bh-btns" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn primary" data-act="idadd">+ Add an idea</button>' +
    ((UI.api || 1) >= 6 ? '<button class="btn" data-act="idsync">Check for Claude’s updates</button>' : '') + '</div>' + (UI.idAdd ? addHTML() : '') + '</section>';
  if (list.length) h += '<section class="card"><h3>Claude’s split<span class="r">checked every Friday</span></h3>' + allocHTML(list) + '</section>';
  h += capHTML(list, latest);
  h += brokersHTML(investable(), stockSlice(list));
  if (UI.ideasErr) h += '<p class="neg">Prices: ' + esc(UI.ideasErr) + '</p>';
  return h;
}
function addHTML() {
  return '<div class="id-add"><b>Paste the code from Claude</b><textarea id="idCode" rows="3" placeholder="FFIDEA:…" aria-label="Code from Claude"></textarea>' +
    '<div class="bh-btns" style="display:flex;gap:8px"><button class="btn primary" data-act="idpaste">Add from code</button></div>' +
    '<b style="margin-top:10px">Or add it yourself</b>' +
    '<label class="bh-inp"><span>Name</span><input id="idName" autocomplete="off" placeholder="e.g. Novartis"></label>' +
    '<label class="bh-inp"><span>Ticker (Yahoo)</span><input id="idTicker" autocomplete="off" autocapitalize="characters" placeholder="NOVN.SW"></label>' +
    '<label class="bh-inp"><span>Mentioned on</span><input id="idDate" type="date" value="' + ymd(today()) + '"></label>' +
    '<label class="bh-inp"><span>Where you heard it</span><input id="idSource" autocomplete="off" placeholder="podcast, colleague…"></label>' +
    '<div class="bh-btns" style="display:flex;gap:8px"><button class="btn" data-act="idsave">Save idea</button><button class="btn" data-act="idadd">Cancel</button></div>' +
    (UI.idErr ? '<p class="neg">' + esc(UI.idErr) + '</p>' : '') + '</div>';
}
function ideaHTML(i) {
  var st = i.ticker ? stats(i) : null;
  var h = '<p style="margin:-6px 0 14px"><button class="linkbtn" data-act="idopen" data-id="">‹ All ideas</button></p>';
  h += '<section class="card"><h3>' + esc(i.name) + (i.ticker ? ' · ' + esc(i.ticker) : '') + '<span class="r">mentioned ' + pd(i.date).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) + (i.source ? ' · ' + esc(i.source) : '') + '</span></h3>';
  if (st) {
    h += '<div class="id-facts"><div><b class="num">' + fmtP(st.entry) + '</b><span>price when mentioned' + (st.cur ? ' · ' + esc(st.cur) : '') + '</span></div><div><b class="num">' + fmtP(st.last) + '</b><span>' + dm(st.lastDate) + '</span></div>' +
      '<div><b class="num ' + (st.chg >= 0 ? 'pos' : 'neg') + '">' + pct(st.chg) + '</b><span>since mentioned</span></div>' +
      '<div><b class="num">' + (st.bchg !== null ? (st.chg - st.bchg >= 0 ? '+' : '−') + Math.abs(st.chg - st.bchg).toFixed(1) + ' pts' : '—') + '</b><span>vs world ETF</span></div></div>' + bigChart(st, i) + compareHTML(st);
  } else h += '<p class="soon">' + (i.ticker ? ((UI.api || 1) < 5 ? 'Prices need the latest Code.gs (API 5).' : (pxCache()[i.ticker] && pxCache()[i.ticker].error ? 'No prices for ' + esc(i.ticker) + ': ' + esc(pxCache()[i.ticker].error) + '. Check the ticker as Yahoo Finance writes it (e.g. NOVN.SW, VWRL.SW, AAPL).' : 'Loading prices…')) : 'No ticker: nothing to chart. Add one to follow the price.') + '</p>';
  h += '</section>';
  var L = latest(i), inv = investable(), checks = i.checks || [];
  h += '<section class="card"><h3>Recommendation<span class="r">' + (L ? 'as of ' + dm(L.date) : '') + '</span></h3>' +
    (L ? '<div class="id-rec">' + verdictPill(L.verdict) + '<span><b class="num">' + (L.pct > 0 ? L.pct + '%' : '0%') + '</b> of what you invest' + (L.pct > 0 && inv ? ' → <b class="num">' + fmtCHF.format(Math.round(inv * L.pct / 100)) + '</b> this period' : '') + '</span></div>' : '<p class="soon">No recommendation yet.</p>') +
    (checks.length ? '<div class="lbl" style="margin-top:12px">Verdict track · every Friday</div><table class="id-tab id-track"><thead><tr><th>Date</th><th>Verdict</th><th>Share</th><th>Price</th></tr></thead><tbody>' +
      checks.map(function (c, k) {
        var prev = checks[k + 1] || (i.views || []).slice(-1)[0], moved = prev && prev.verdict !== c.verdict;
        return '<tr><td>' + dm(c.date) + '</td><td>' + (moved ? '<b>' + esc((VERDICTS[c.verdict] || VERDICTS.watch)[0]) + '</b> <small>changed</small>' : esc((VERDICTS[c.verdict] || VERDICTS.watch)[0])) + '</td><td class="num">' + (c.pct === null ? '—' : c.pct + '%') + '</td><td class="num">' + (c.price ? fmtP(c.price) : '—') + '</td></tr>' +
          (c.note ? '<tr class="note"><td colspan="4">' + esc(c.note) + '</td></tr>' : '');
      }).join('') + '</tbody></table>' : '') + '</section>';
  var views = i.views || [];
  h += '<section class="card id-views"><h3>Claude’s view' + (views.length > 1 ? 's' : '') + '<span class="r">' + (views.length ? 'latest first' : '') + '</span></h3>';
  h += views.length ? views.map(function (v, k) {
    return '<article class="id-view' + (k ? ' old' : '') + '"><div class="id-vh"><span class="lbl">' + pd(v.date).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) + '</span>' + verdictPill(v.verdict) + '</div>' + viewText(v.text) + '</article>';
  }).join('') : '<p class="soon">No view yet. Ask me about ' + esc(i.name) + ' in the chat and paste the code here.</p>';
  h += '<div class="id-add" style="margin-top:12px"><b>Paste a new view from Claude</b><textarea id="idCode" rows="2" placeholder="FFIDEA:…" aria-label="Code from Claude"></textarea>' +
    '<div class="bh-btns" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-act="idpaste">Add view</button><button class="btn" data-act="iddel" data-id="' + esc(i.id) + '">Delete idea</button></div>' +
    (UI.idErr ? '<p class="neg">' + esc(UI.idErr) + '</p>' : '') + '</div></section>';
  return h;
}
function ideasLine() { var n = ideas().length; return n ? n + ' idea' + (n === 1 ? '' : 's') + ' tracked' : 'investing ideas you hear about'; }

export { syncInbox, latest, ideas, ideasHTML, ideasLine, addFromCode, addManual, decodeCode, loadPrices, BENCH_DEFAULT };
