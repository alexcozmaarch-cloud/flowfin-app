// FlowFin · Holdings and the year-end tax sheet (Ideas tab: Ideas · Holdings · Tax year).
// Each buy, sale or dividend is one Settings row `trade_<id>` holding JSON:
//   { d:'YYYY-MM-DD', k:'buy'|'sell'|'div', t:'NVDA' (Yahoo symbol), n:name, isin, sh:shares, px:price, ccy, fee, fx:CHF per unit of ccy, wht:tax withheld (div), broker }
// Values in CHF use the app's daily prices (Yahoo, via the backend) and FX pairs like USDCHF=X.
// The tax sheet uses the 31.12 close and rate and says so: the official ESTV year-end prices come out in January.
// Approved 25.11.2026 (mockup "FlowFin Holdings").
import { chf0, esc, fmtCHF, lsGet, today, ymd } from './core.js';

var PX_KEY = 'ff_prices_v1';
var FX = { USD:'USDCHF=X', EUR:'EURCHF=X', GBP:'GBPCHF=X' };
// ISIN and name for symbols you're likely to buy; anything else you can type in
var KNOWN = {
  NVDA:['US67066G1040', 'NVIDIA Corp.', 'USD'], META:['US30303M1027', 'Meta Platforms Inc.', 'USD'], QQQ:['US46090E1038', 'Invesco QQQ Trust', 'USD'],
  MRVL:['US5738741041', 'Marvell Technology Inc.', 'USD'], GOOGL:['US02079K3059', 'Alphabet Inc. (A)', 'USD'], GOOG:['US02079K1079', 'Alphabet Inc. (C)', 'USD'], BSP:['IT0005717696', 'Bending Spoons S.p.A.', 'USD'], VOO:['US9229083632', 'Vanguard S&P 500 ETF', 'USD'], VT:['US9220427424', 'Vanguard Total World Stock ETF', 'USD'],
  'CSPX.L':['IE00B5BMR087', 'iShares Core S&P 500 UCITS ETF (Acc)', 'USD'], 'VWRA.L':['IE00BK5BQT80', 'Vanguard FTSE All-World UCITS ETF (Acc)', 'USD'],
  'VWRL.SW':['IE00B3RBWM25', 'Vanguard FTSE All-World UCITS ETF (Dist)', 'CHF'], 'CHSPI.SW':['CH0237935652', 'iShares Core SPI ETF (CH)', 'CHF'],
  'EQQQ.L':['IE0032077012', 'Invesco EQQQ Nasdaq-100 UCITS ETF', 'USD'], 'CNDX.L':['IE00B53SZB19', 'iShares Nasdaq 100 UCITS ETF (Acc)', 'USD']
};

function pxAll() { try { return JSON.parse(lsGet(PX_KEY) || '{}'); } catch (e) { return {}; } }
function trades() {
  return (DATA.Settings || []).filter(function (r) { return /^trade_/.test(r.key || ''); }).map(function (r) {
    try { var t = JSON.parse(r.value); t.id = r.key.slice(6); t._sid = r.id; return t; } catch (e) { return null; }
  }).filter(Boolean).sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
}
function base(sym) { return String(sym || '').toUpperCase().replace(/\.[A-Z]+$/, ''); }
// last close on or before the date (null if none); pence-quoted London lines are turned into pounds
function closeOn(sym, date) {
  var p = pxAll()[sym]; if (!p || !p.dates || !p.dates.length) return null;
  var i = p.dates.length - 1; if (date) while (i >= 0 && p.dates[i] > date) i--;
  if (i < 0) return null;
  var v = p.closes[i]; if (p.currency === 'GBp') v = v / 100;
  return { v:v, d:p.dates[i], ccy:p.currency === 'GBp' ? 'GBP' : p.currency };
}
function fxOn(ccy, date) { if (!ccy || ccy === 'CHF') return 1; var c = closeOn(FX[ccy], date); return c ? c.v : null; }
function symbols() {   // what the price loader should fetch, and from when
  var T = trades(), syms = {}, from = '';
  T.forEach(function (t) { if (t.t) syms[t.t] = 1; if (t.ccy && FX[t.ccy]) syms[FX[t.ccy]] = 1; if (!from || t.d < from) from = t.d; });
  if (T.length) { syms[FX.USD] = 1; syms[FX.EUR] = 1; }
  return { syms:Object.keys(syms), from:from };
}

// positions on a date (average cost; a sale takes cost out at the average)
function positions(asOf) {
  var P = {}, T = trades().filter(function (t) { return !asOf || t.d <= asOf; });
  T.forEach(function (t) {
    var p = P[t.t] = P[t.t] || { t:t.t, n:t.n || (KNOWN[t.t] || [])[1] || t.t, isin:t.isin || (KNOWN[t.t] || [])[0] || '', ccy:t.ccy, sh:0, cost:0, fees:0, divs:0, buys:[] };
    if (t.isin) p.isin = t.isin; if (t.n) p.n = t.n;
    var fx = +t.fx || fxOn(t.ccy, t.d) || 1, fee = (+t.fee || 0) * fx;
    if (t.k === 'buy') { p.sh += +t.sh; p.cost += (+t.sh) * (+t.px) * fx + fee; p.fees += fee; p.buys.push({ d:t.d, chf:(+t.sh) * (+t.px) * fx + fee }); }
    else if (t.k === 'sell') { var out = p.sh ? Math.min(1, (+t.sh) / p.sh) : 0; p.cost -= p.cost * out; p.sh -= +t.sh; p.fees += fee; }
    else if (t.k === 'div') p.divs += (+t.px || 0) * fx;
  });
  return Object.keys(P).map(function (k) { return P[k]; });
}
// value of what you hold now, in CHF (used by the Behaviour tab as "growth")
function holdingsValue() {
  return positions().reduce(function (a, p) { if (p.sh <= 1e-9) return a; var c = closeOn(p.t), fx = c ? fxOn(c.ccy || p.ccy) : null; return a + (c && fx ? p.sh * c.v * fx : p.cost); }, 0);
}
function benchSym() { var b = ((DATA.Settings || []).filter(function (r) { return r.key === 'idea_benchmark_sym'; })[0] || {}).value; return String(b || 'VWRL.SW').toUpperCase(); }
// what the same CHF, put into the world ETF on the same days, would be worth now
function worldValue(p) {
  var bs = benchSym(), now = closeOn(bs); if (!now) return null;
  var fxNow = fxOn(now.ccy) || 1, v = 0;
  for (var i = 0; i < p.buys.length; i++) { var c = closeOn(bs, p.buys[i].d); if (!c) return null; var fx = fxOn(c.ccy, p.buys[i].d) || 1; v += p.buys[i].chf / (c.v * fx) * now.v * fxNow; }
  return v;
}

// "Bought 0.4120 NVDA @ 152.30 USD, commission 0.35 USD, 12.03.2027" and similar lines from a broker's email
function parsePaste(text) {
  var s = String(text || '').replace(/ /g, ' '), o = {};
  var m = /\b(bought|buy|kauf|sold|sell|verkauf)\w*\s+([\d'.,]+)\s+(?:shares?\s+(?:of\s+)?)?([A-Z][A-Z0-9.\-]{0,9})\s*@\s*([\d'.,]+)\s*([A-Z]{3})?/i.exec(s);
  if (m) { o.k = /sold|sell|verkauf/i.test(m[1]) ? 'sell' : 'buy'; o.sh = num(m[2]); o.t = m[3].toUpperCase(); o.px = num(m[4]); if (m[5]) o.ccy = m[5].toUpperCase(); }
  var dv = /dividend\w*\s+(?:of\s+)?([A-Z][A-Z0-9.\-]{0,9})?[^\d]*([\d'.,]+)\s*([A-Z]{3})?/i.exec(s);
  if (!m && dv) { o.k = 'div'; if (dv[1]) o.t = dv[1].toUpperCase(); o.px = num(dv[2]); if (dv[3]) o.ccy = dv[3].toUpperCase(); var w = /(?:withholding|withheld|quellensteuer)[^\d]*([\d'.,]+)/i.exec(s); if (w) o.wht = num(w[1]); }
  var f = /(?:commission|fee|courtage|gebühr)[^\d]*([\d'.,]+)/i.exec(s); if (f) o.fee = num(f[1]);
  var d = /(\d{4})-(\d{2})-(\d{2})/.exec(s) || null, e = !d && /(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(s);
  if (d) o.d = d[0]; else if (e) o.d = e[3] + '-' + ('0' + e[2]).slice(-2) + '-' + ('0' + e[1]).slice(-2);
  if (o.t && KNOWN[o.t] && !o.ccy) o.ccy = KNOWN[o.t][2];
  return o;
}
function num(v) { var s = String(v).replace(/'/g, ''); if (/,\d{1,2}$/.test(s) && s.indexOf('.') < 0) s = s.replace(',', '.'); return parseFloat(s.replace(/,/g, '')); }

function fmt(v, d) { return v === null || v === undefined || isNaN(v) ? '—' : v.toLocaleString('de-CH', { minimumFractionDigits:d === undefined ? 2 : d, maximumFractionDigits:d === undefined ? 2 : d }).replace(/’/g, '’'); }
function sgn(v) { return v === null || isNaN(v) ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%'; }

function formHTML() {
  var f = UI.hdForm || { d:ymd(today()), k:'buy', ccy:'USD', broker:'Interactive Brokers' };
  function inp(k, lab, type, ph) { return '<label>' + lab + '<input id="hd-' + k + '" type="' + (type || 'text') + '" value="' + esc(f[k] === undefined || f[k] === null || (typeof f[k] === 'number' && isNaN(f[k])) ? '' : f[k]) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + (type === 'number' ? ' step="any" inputmode="decimal"' : '') + '></label>'; }
  var preview = '';
  if (f.t && f.sh && f.px) {
    var fx = +f.fx || fxOn(f.ccy, f.d), chf = fx ? f.sh * f.px * fx : null;
    preview = '<p class="soon">' + (f.ccy || '') + ' ' + fmt(f.sh * f.px) + (chf !== null && f.ccy !== 'CHF' ? ' = CHF ' + fmt(chf) + ' at ' + fmt(fx, 4) : '') + (f.fee ? ', plus fee ' + fmt(+f.fee) : '') + '.' + (fx ? '' : ' The rate for that day loads with the prices; you can also type it.') + '</p>';
  }
  return '<section class="card hd-form"><h3>Record a buy, sale or dividend</h3>' +
    '<label class="hd-paste">Paste the line from your broker’s email<textarea id="hd-paste" rows="2" placeholder="Bought 0.4120 NVDA @ 152.30 USD, commission 0.35 USD, 12.03.2027"></textarea></label>' +
    '<div class="bh-btns"><button class="btn" data-act="hdparse">Fill in from the line</button></div>' +
    '<div class="hd-grid">' +
      '<label>Kind<select id="hd-k">' + [['buy', 'Buy'], ['sell', 'Sale'], ['div', 'Dividend']].map(function (o) { return '<option value="' + o[0] + '"' + (f.k === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
      inp('d', 'Date', 'date') + inp('t', 'Ticker (as on Yahoo)', 'text', 'NVDA, CSPX.L, CHSPI.SW') + inp('sh', f.k === 'div' ? 'Shares (optional)' : 'Shares', 'number') +
      inp('px', f.k === 'div' ? 'Dividend, total' : 'Price per share', 'number') +
      '<label>Currency<select id="hd-ccy">' + ['USD', 'CHF', 'EUR', 'GBP'].map(function (c) { return '<option' + (f.ccy === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label>' +
      inp('fee', 'Fee', 'number') + (f.k === 'div' ? inp('wht', 'Tax withheld', 'number') : '') + inp('fx', 'CHF rate (optional)', 'number', 'from prices') + inp('isin', 'ISIN (optional)', 'text', (KNOWN[f.t] || [])[0] || '') +
      inp('broker', 'Broker') + '</div>' + preview +
    (UI.hdErr ? '<p class="neg">' + esc(UI.hdErr) + '</p>' : '') +
    '<div class="bh-btns"><button class="btn primary" data-act="hdsave">Save</button><button class="btn" data-act="hdform">Cancel</button></div></section>';
}
function readForm() {
  var o = {}; ['k', 'd', 't', 'sh', 'px', 'ccy', 'fee', 'wht', 'fx', 'isin', 'broker'].forEach(function (k) { var el = document.getElementById('hd-' + k); if (el) o[k] = el.value.trim(); });
  ['sh', 'px', 'fee', 'wht', 'fx'].forEach(function (k) { if (o[k] !== undefined) o[k] = o[k] === '' ? null : num(o[k]); });
  if (o.t) o.t = o.t.toUpperCase();
  return o;
}

function holdingsHTML(ideasList) {
  var list = positions().filter(function (p) { return p.sh > 1e-9; }), T = trades();
  var h = '<div class="bh-btns" style="margin-bottom:14px"><button class="btn primary" data-act="hdform">' + (UI.hdForm ? 'Close the form' : 'Record a buy') + '</button></div>';
  if (UI.hdForm) h += formHTML();
  if (!T.length) return h + '<section class="card"><h3>Holdings</h3><p class="soon">Nothing recorded yet. After your first buy, record it here (or paste the line from the broker’s email). FlowFin values it every day in CHF, links it to its idea and fills in the tax sheet for the year.</p></section>';
  var rows = list.map(function (p) {
    var c = closeOn(p.t), fx = c ? fxOn(c.ccy || p.ccy) : null, val = c && fx ? p.sh * c.v * fx : null, w = worldValue(p);
    return { p:p, c:c, val:val, gain:val !== null && p.cost ? (val / p.cost - 1) * 100 : null, vs:val !== null && w ? (val - w) / p.cost * 100 : null, w:w };
  });
  var tot = rows.reduce(function (a, r) { return a + (r.val !== null ? r.val : r.p.cost); }, 0), cost = rows.reduce(function (a, r) { return a + r.p.cost; }, 0);
  var fees = positions().reduce(function (a, p) { return a + p.fees; }, 0), wTot = rows.every(function (r) { return r.w !== null; }) ? rows.reduce(function (a, r) { return a + r.w; }, 0) : null;
  var usd = rows.filter(function (r) { return /^US/.test(r.p.isin || '') || (!/\./.test(r.p.t) && r.p.ccy === 'USD'); }).reduce(function (a, r) { return a + (r.val || r.p.cost); }, 0), usdFx = fxOn('USD') || 0.9;
  h += '<section class="card hd-card"><h3>Holdings<span class="r">values in CHF · prices from the app</span></h3>' +
    '<div class="hd-kpis"><div><b class="num">' + chf0(tot) + '</b><span>worth today</span></div><div><b class="num">' + chf0(cost) + '</b><span>put in (incl. fees)</span></div>' +
    '<div><b class="num ' + (tot >= cost ? 'pos' : 'neg') + '">' + (tot >= cost ? '+' : '−') + chf0(Math.abs(tot - cost)) + '</b><span>' + sgn(cost ? (tot / cost - 1) * 100 : 0) + (wTot !== null ? ' · world ' + sgn((wTot / cost - 1) * 100) : '') + '</span></div>' +
    '<div><b class="num">' + fmt(fees) + '</b><span>fees paid · ' + (cost ? (fees / cost * 100).toFixed(2) : '0') + '%</span></div></div>' +
    '<div class="cp-tw"><table class="id-tab hd-tab"><thead><tr><th>Holding</th><th class="r">Shares</th><th class="r">Avg cost</th><th class="r">Worth</th><th class="r">Gain</th><th class="r">vs world</th><th class="r">Share</th><th></th></tr></thead><tbody>' +
    rows.sort(function (a, b) { return (b.val || b.p.cost) - (a.val || a.p.cost); }).map(function (r) {
      var idea = (ideasList || []).filter(function (i) { return i.ticker && base(i.ticker) === base(r.p.t); })[0], share = tot ? (r.val || r.p.cost) / tot * 100 : 0;
      return '<tr><td><b>' + esc(r.p.t) + '</b><small>' + esc(r.p.n) + (idea ? ' · idea' : '') + '</small></td><td class="r num">' + fmt(r.p.sh, 4).replace(/0{1,2}$/, '') + '</td>' +
        '<td class="r num">' + fmt(r.p.cost / r.p.sh) + ' <small>CHF</small></td><td class="r num">' + (r.val !== null ? chf0(r.val) : '<small>loading</small>') + '</td>' +
        '<td class="r num ' + (r.gain >= 0 ? 'pos' : 'neg') + '">' + sgn(r.gain) + '</td><td class="r num ' + (r.vs === null ? '' : r.vs >= 0 ? 'pos' : 'neg') + '">' + (r.vs === null ? '—' : (r.vs >= 0 ? '+' : '−') + Math.abs(r.vs).toFixed(1)) + '</td>' +
        '<td class="r num">' + share.toFixed(0) + '%<span class="br-bar" style="width:' + share.toFixed(0) + '%"></span></td><td></td></tr>';
    }).join('') + '</tbody></table></div>' +
    (usd ? '<p class="soon">US-listed: CHF ' + chf0(usd) + ' (about USD ' + chf0(usd / usdFx) + '). US estate tax only matters above USD 60,000; Irish (UCITS) funds avoid it.</p>' : '') +
    '<p class="soon">“vs world”: percentage points against putting the same francs into the world ETF (' + esc(benchSym()) + ') on the same days.</p></section>';
  h += '<section class="card"><h3>Everything recorded<span class="r">' + T.length + '</span></h3><div class="hd-log">' + T.slice().reverse().map(function (t) {
    var fx = +t.fx || fxOn(t.ccy, t.d);
    return '<div><span class="num">' + t.d.split('-').reverse().join('.') + '</span><span>' + (t.k === 'buy' ? 'Bought' : t.k === 'sell' ? 'Sold' : 'Dividend') + ' <b>' + esc(t.t || '') + '</b>' + (t.k !== 'div' ? ' · ' + fmt(+t.sh, 4).replace(/0{1,2}$/, '') + ' @ ' + fmt(+t.px) + ' ' + esc(t.ccy || '') : ' · ' + fmt(+t.px) + ' ' + esc(t.ccy || '')) + (t.fee ? ' · fee ' + fmt(+t.fee) : '') + '</span>' +
      '<span class="num">' + (fx ? 'CHF ' + fmt((t.k === 'div' ? +t.px : (+t.sh) * (+t.px)) * fx) : '') + '</span><button class="iconbtn" data-act="hddel" data-id="' + esc(t.id) + '" aria-label="Delete">×</button></div>';
  }).join('') + '</div></section>';
  return h;
}

// the year-end sheet for the list of securities (Wertschriftenverzeichnis)
function taxYears() { var ys = {}, y0 = today().getFullYear(); trades().forEach(function (t) { ys[t.d.slice(0, 4)] = 1; }); ys[String(today().getMonth() < 3 ? y0 - 1 : y0)] = 1; return Object.keys(ys).sort().reverse(); }
function taxRows(year) {
  var end = year + '-12-31';
  return positions(end).map(function (p) {
    var c = closeOn(p.t, end), fx = c ? fxOn(c.ccy || p.ccy, end) : null, divs = 0, wht = 0;
    trades().forEach(function (t) { if (t.t === p.t && t.k === 'div' && t.d.slice(0, 4) === year) { var f = +t.fx || fxOn(t.ccy, t.d) || 1; divs += (+t.px || 0) * f; wht += (+t.wht || 0) * f; } });
    return { p:p, c:c, fx:fx, val:c && fx ? p.sh * c.v * fx : null, divs:divs, wht:wht };
  }).filter(function (r) { return r.p.sh > 1e-9 || r.divs; });
}
function taxHTML() {
  var ys = taxYears(), year = UI.taxYear && ys.indexOf(UI.taxYear) > -1 ? UI.taxYear : ys[0], R = taxRows(year), y = +year;
  var prov = today() < new Date(y + 1, 1, 15);
  var h = '<section class="card hd-tax" id="hd-tax"><h3>Tax year ' + year + '<span class="r">list of securities · Zürich return</span></h3>' +
    (ys.length > 1 ? '<span class="seg2" role="radiogroup" aria-label="Year">' + ys.map(function (v) { return '<button role="radio" aria-checked="' + (v === year) + '" class="' + (v === year ? 'on' : '') + '" data-act="taxyear" data-v="' + v + '">' + v + '</button>'; }).join('') + '</span>' : '');
  if (!R.length) return h + '<p class="soon">Nothing held at the end of ' + year + ' and no dividends recorded.</p></section>';
  var tv = R.reduce(function (a, r) { return a + (r.val || 0); }, 0), td = R.reduce(function (a, r) { return a + r.divs; }, 0), tw = R.reduce(function (a, r) { return a + r.wht; }, 0);
  h += '<p class="soon">Values on 31.12.' + year + ': the last close and exchange rate in the app.' + (prov ? ' <b>Provisional</b>: the federal tax administration publishes the official year-end prices (ESTV Kursliste) in January; the tax software fills those in from the ISIN.' : ' The tax software uses the official ESTV prices from the ISIN; small differences are normal.') + '</p>' +
    '<div class="cp-tw"><table class="id-tab hd-tab"><thead><tr><th>Security · ISIN</th><th class="r">Shares 31.12</th><th class="r">Price 31.12</th><th class="r">Rate</th><th class="r">Value CHF</th><th class="r">Dividends CHF</th><th class="r">Tax withheld CHF</th></tr></thead><tbody>' +
    R.map(function (r) {
      var us = /^US/.test(r.p.isin || ''), ch = /^CH/.test(r.p.isin || '');
      return '<tr><td><b>' + esc(r.p.n) + '</b><small>' + (r.p.isin ? esc(r.p.isin) : '<span class="neg">add the ISIN</span>') + ' · ' + esc(r.p.t) + '</small></td><td class="r num">' + fmt(r.p.sh, 4).replace(/0{1,2}$/, '') + '</td>' +
        '<td class="r num">' + (r.c ? fmt(r.c.v) + ' <small>' + esc(r.c.ccy || '') + '</small>' : '—') + '</td><td class="r num">' + (r.fx ? fmt(r.fx, 4) : '—') + '</td><td class="r num">' + (r.val !== null ? fmt(r.val) : '—') + '</td>' +
        '<td class="r num">' + (r.divs ? fmt(r.divs) : '—') + '</td><td class="r num">' + (r.wht ? fmt(r.wht) + '<small>' + (us ? 'US 15%, claim back' : ch ? 'CH 35%, claim back' : 'claim back') + '</small>' : '—') + '</td></tr>';
    }).join('') +
    '<tr class="hd-tot"><td>Total</td><td></td><td></td><td></td><td class="r num">' + fmt(tv) + '</td><td class="r num">' + fmt(td) + '</td><td class="r num">' + fmt(tw) + '</td></tr></tbody></table></div>' +
    '<div class="bh-btns"><button class="btn primary" data-act="taxcopy">Copy as table</button><button class="btn" data-act="taxprint">Print or save as PDF</button></div>' +
    '<p class="soon">Capital gains are tax-free for private investors in Switzerland; the return looks at the year-end value (wealth tax) and income (dividends). Tax withheld in the US (15%) and Switzerland (35%) is credited or refunded through the same list. Accumulating funds pay no dividends to record, but their reinvested income can still be taxable: the ESTV price list shows it by ISIN.</p></section>';
  return h;
}
function taxTSV(year) {
  var R = taxRows(year || UI.taxYear || taxYears()[0]);
  return ['Security\tISIN\tShares 31.12\tPrice\tCurrency\tRate\tValue CHF\tDividends CHF\tTax withheld CHF'].concat(R.map(function (r) {
    return [r.p.n, r.p.isin, r.p.sh, r.c ? r.c.v : '', r.c ? r.c.ccy : '', r.fx ? r.fx.toFixed(4) : '', r.val !== null ? r.val.toFixed(2) : '', r.divs.toFixed(2), r.wht.toFixed(2)].join('\t');
  })).join('\n');
}
// buys of an idea's ticker: for its chart and for ticking off its slice
function buysOf(ticker) { var b = base(ticker); return trades().filter(function (t) { return t.k === 'buy' && base(t.t) === b; }); }

export { trades, positions, holdingsValue, holdingsHTML, taxHTML, taxTSV, parsePaste, readForm, symbols as holdingSymbols, buysOf, KNOWN, num };
