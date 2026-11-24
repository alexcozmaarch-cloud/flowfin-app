// FlowFin · Ideas: investing ideas you hear about, tracked from the day you mention them (approved 24.11.2026).
// Each idea is one Settings row (key idea_<id>, JSON) so nothing needs a new tab in the Sheet:
//   { id, name, ticker, date, source, views:[{ date, verdict, text }] }
// Prices come from your Apps Script (API 5), which asks Yahoo Finance; they're kept on this phone for 12 hours.
// Claude's views arrive as a paste code "FFIDEA:<base64 JSON>" written in the chat.
import { post } from './api.js';
import { $, addDays, daysBetween, esc, fmtCHF, lsGet, lsSet, pd, today, ymd } from './core.js';
import { draw, topbar } from './nav.js';
import { saveSetting } from './settings.js';

var BENCH_DEFAULT = 'VWRL.SW';   // Vanguard FTSE All-World, traded in CHF on SIX
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
      view:(o.v || o.view) ? { date:(o.v || o.view).d || o.d || ymd(today()), verdict:(o.v || o.view).r || (o.v || o.view).verdict || 'watch', text:(o.v || o.view).x || (o.v || o.view).text || '' } : null };
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
  if (!Object.keys(syms).length) return Promise.resolve(false);
  syms[bench()] = 1;
  var c = pxCache(), want = Object.keys(syms).filter(function (s) { var x = c[s]; return force || !x || Date.now() - x.at > PX_TTL || (x.from || '9') > from; });
  want = want.filter(function (s) { return !LOADING[s]; });
  if (!want.length) return Promise.resolve(false);
  want.forEach(function (s) { LOADING[s] = 1; });
  return post({ action:'prices', symbols:want, from:from }).then(function (j) {
    var c2 = pxCache();
    Object.keys(j.prices || {}).forEach(function (s) { c2[s] = Object.assign({ at:Date.now(), from:from }, j.prices[s]); });
    lsSet(PX_KEY, JSON.stringify(c2));
    return true;
  }).catch(function (e) { UI.ideasErr = e.message; return false; })
    .then(function (v) { want.forEach(function (s) { delete LOADING[s]; }); return v; });
}
// closes from the idea's date on (the first trading day on or after it)
function sinceEntry(p, date) {
  if (!p || !p.dates || !p.dates.length) return null;
  var i = 0; while (i < p.dates.length && p.dates[i] < date) i++;
  if (i >= p.dates.length) return null;
  return { dates:p.dates.slice(i), closes:p.closes.slice(i) };
}
function stats(idea) {
  var s = sinceEntry(px(idea.ticker), idea.date), b = sinceEntry(px(bench()), idea.date);
  if (!s) return null;
  var entry = s.closes[0], last = s.closes[s.closes.length - 1], chg = (last / entry - 1) * 100;
  var bchg = b ? (b.closes[b.closes.length - 1] / b.closes[0] - 1) * 100 : null;
  return { s:s, b:b, entry:entry, last:last, chg:chg, bchg:bchg, lastDate:s.dates[s.dates.length - 1], cur:(px(idea.ticker) || {}).currency || '' };
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
function bigChart(st, idea) {
  var W = 640, H = 180, v = st.s.closes, bv = null;
  if (st.b && st.b.closes.length > 1) {   // the world ETF rebased to the idea's entry price, on the idea's trading days
    var bm = {}; st.b.dates.forEach(function (d, i) { bm[d] = st.b.closes[i]; });
    var last = st.b.closes[0]; bv = st.s.dates.map(function (d) { if (bm[d] !== undefined) last = bm[d]; return last / st.b.closes[0] * st.entry; });
  }
  var all = v.concat(bv || []), lo = Math.min.apply(null, all) * 0.98, hi = Math.max.apply(null, all) * 1.02, y = function (x) { return H - (x - lo) / (hi - lo) * H; };
  var n = st.s.dates.length, mid = st.s.dates[Math.floor(n / 2)];
  return '<div class="id-chart"><svg viewBox="0 -14 ' + W + ' ' + (H + 34) + '" role="img" aria-label="' + esc(idea.name) + ' since you mentioned it' + (bv ? ', with the world ETF' : '') + '">' +
    '<line x1="0" x2="' + W + '" y1="' + y(st.entry).toFixed(1) + '" y2="' + y(st.entry).toFixed(1) + '" stroke="var(--rule)" stroke-dasharray="3 3"/>' +
    (bv ? '<path d="' + linePath(bv, W, H, lo, hi) + '" fill="none" stroke="var(--s3)" stroke-width="1.5"/>' : '') +
    '<path d="' + linePath(v, W, H, lo, hi) + '" fill="none" stroke="var(--ink)" stroke-width="2"/>' +
    '<circle cx="4" cy="' + y(st.entry).toFixed(1) + '" r="5" fill="var(--signal)"/>' +
    '<text x="12" y="' + (y(st.entry) - 8).toFixed(1) + '" class="t">entry ' + dm(st.s.dates[0]) + ' · ' + fmtP(st.entry) + '</text>' +
    '<text x="' + W + '" y="' + (y(st.last) - 8).toFixed(1) + '" text-anchor="end" class="t">' + fmtP(st.last) + ' · ' + pct(st.chg) + '</text>' +
    (bv ? '<text x="' + W + '" y="' + (y(bv[bv.length - 1]) + 16).toFixed(1) + '" text-anchor="end" class="t">world ' + pct(st.bchg) + '</text>' : '') +
    '<line x1="0" x2="' + W + '" y1="' + H + '" y2="' + H + '" stroke="var(--ink)"/>' +
    '<text x="0" y="' + (H + 16) + '" class="t">' + dm(st.s.dates[0]) + '</text>' + (n > 6 ? '<text x="' + W / 2 + '" y="' + (H + 16) + '" text-anchor="middle" class="t">' + dm(mid) + '</text>' : '') +
    '<text x="' + W + '" y="' + (H + 16) + '" text-anchor="end" class="t">' + dm(st.lastDate) + '</text></svg></div>';
}
function verdictPill(v) { var x = VERDICTS[v] || VERDICTS.watch; return '<span class="otag id-v ' + x[1] + '">' + x[0] + '</span>'; }
// a little formatting for views written in the chat: blank line = new paragraph, **bold**
function viewText(t) {
  return String(t || '').split(/\n\s*\n/).map(function (p) { return '<p>' + esc(p.trim()).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>') + '</p>'; }).join('');
}

function ideasHTML() {
  var list = ideas(), h = topbar('Ideas', false);
  if ((UI.api || 1) < 5 && list.some(function (i) { return i.ticker; })) h += '<p class="soon" style="margin:-4px 0 16px">Prices need the latest Code.gs (API 5); until then ideas are listed without charts.</p>';
  else loadPrices().then(function (changed) { if (changed && UI.page === 'ideas') draw(); });
  if (UI.idea) { var one = list.filter(function (i) { return i.id === UI.idea; })[0]; if (one) return h + ideaHTML(one); UI.idea = ''; }
  h += '<section class="card id-list"><h3>Your ideas<span class="r">since mentioned · vs world (' + esc(bench()) + ')</span></h3>';
  h += list.length ? list.map(function (i) {
    var st = i.ticker ? stats(i) : null, v = (i.views || [])[0];
    return '<button class="id-row" data-act="idopen" data-id="' + esc(i.id) + '"><span class="id-n"><b>' + esc(i.name) + (i.ticker ? ' · ' + esc(i.ticker) : '') + '</b>' +
      '<small>' + dm(i.date) + (i.source ? ' · ' + esc(i.source) : '') + '</small>' + (v ? verdictPill(v.verdict) : '<span class="otag id-v">no view yet</span>') + '</span>' + spark(st) +
      '<span class="id-c num">' + (st ? '<span class="' + (st.chg >= 0 ? 'pos' : 'neg') + '">' + pct(st.chg) + '</span>' + (st.bchg !== null ? '<small>world ' + pct(st.bchg) + '</small>' : '') : '<small>' + (i.ticker ? 'price…' : 'no ticker') + '</small>') + '</span></button>';
  }).join('') : '<p class="soon">No ideas yet. Tell me about one in the chat, or add it here.</p>';
  h += '<div class="bh-btns" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn primary" data-act="idadd">+ Add an idea</button></div>' + (UI.idAdd ? addHTML() : '') + '</section>';
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
      '<div><b class="num">' + (st.bchg !== null ? (st.chg - st.bchg >= 0 ? '+' : '−') + Math.abs(st.chg - st.bchg).toFixed(1) + ' pts' : '—') + '</b><span>vs world ETF</span></div></div>' + bigChart(st, i);
  } else h += '<p class="soon">' + (i.ticker ? ((UI.api || 1) < 5 ? 'Prices need the latest Code.gs (API 5).' : (pxCache()[i.ticker] && pxCache()[i.ticker].error ? 'No prices for ' + esc(i.ticker) + ': ' + esc(pxCache()[i.ticker].error) + '. Check the ticker as Yahoo Finance writes it (e.g. NOVN.SW, VWRL.SW, AAPL).' : 'Loading prices…')) : 'No ticker: nothing to chart. Add one to follow the price.') + '</p>';
  h += '</section>';
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

export { ideas, ideasHTML, ideasLine, addFromCode, addManual, decodeCode, loadPrices, BENCH_DEFAULT };
