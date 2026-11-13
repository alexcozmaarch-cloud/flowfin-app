// FlowFin · Transactions: tags, rules, currency, list and the add/edit form.
// Shared settings and state (DATA, UI, _cache, CATEGORIES …) are globals from js/config.js.
import { afterSave, oweBoxHTML, oweToSave, owedItems, readOwe } from './owed.js';
import { priceAlertHTML, priceAlerts } from './recurring.js';
import { anomalyBody } from './anomalies.js';
import { persistCache, post, saveRow, setSync } from './api.js';
import { $, addDays, chf, esc, fmtCHF, inPeriod, isInfra, pd, periodAt, roles, toast, today, txs, ymd } from './core.js';
import { periodDay, sw, sw0 } from './dashboard.js';
import { goalFund } from './goals.js';
import { draw, reviewCount, topbar } from './nav.js';
import { saveSetting } from './settings.js';

// ─── Transactions ─────────────────────────────────────────────────────────
// ─── Tags, rules and foreign currency helpers ─────────────────────────────
// Icons are drawn in ink only (Alex's choice A, 06.11.2026): Base44 shapes, no colour, no background
function ico(name) { return '<svg class="ic" aria-hidden="true"><use href="#i-' + (name || 'tag') + '"/></svg>'; }
function catIco(cat, sub) { return ico(SUB_ICON[sub] || CAT_ICON[cat] || 'tag', CAT_TINT[cat]); }
function txIco(tx) { return tx.type === 'refund' ? ico('undo-2', 'var(--good)') : tx.type === 'income' && tx.subcategory !== 'Cash' ? ico('arrow-down-to-line', 'var(--good)') : catIco(tx.category, tx.subcategory); }
function goalIco(g) { var f = goalFund(g); return f.mode === 'category' && /3a/.test(f.category) ? ico('landmark', CAT_TINT['Retirement 3a']) : /porsch|porch|car|auto/i.test(g.name) ? ico('car', '#D97706') : ico('target', '#D97706'); }
function tagsOf(tx) { return String(tx.tags || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean); }
// ─── Suggested tags in the add form ─────────────────────────────────────────
// Ranked: tags you used on transactions with similar words > tags you used in the same subcategory >
// starter tags from common words (below) > your most used tags. Tap to add; with time your own tags take over.
var TAG_WORDS = [
  [/short|shoe|sneaker|running|run\b|marathon|trail|garmin|strava|asics|on running|hoka|salomon/i, ['running', 'sports']],
  [/gym|fitness|yoga|pilates|swim|ski|bike|cycling|tennis|padel|climb|decathlon|ochsner|sport/i, ['sports']],
  [/physio|physiotherap|massage|osteo|chiro|recovery|foam roll/i, ['recovery', 'health']],
  [/doctor|arzt|dentist|zahnarzt|pharma|apothe|drogerie|hospital|clinic|optic/i, ['health']],
  [/hotel|airbnb|booking|flight|swiss\.com|easyjet|airline|hostel|trip|vacation|holiday/i, ['travel']],
  [/\bsbb\b|\btrains?\b|\btram\b|\bbus\b|taxi|uber|parking|fuel|petrol|benzin|car wash|toll/i, ['transport']],
  [/restaurant|lunch|dinner|pizza|sushi|burger|cafe|coffee|bar\b|beer|hiltl/i, ['eating-out']],
  [/gift|present|birthday|geschenk/i, ['gifts']],
  [/kita|daycare|school|toy|kids|baby|nanny/i, ['family']],
  [/tcg|pokemon|pokémon|cardmarket|lorcana|one piece|psa|graded|booster/i, ['tcg']],
  [/amazon|digitec|galaxus|zalando|temu|aliexpress|online/i, ['online']],
  [/book|kindle|course|udemy|workshop|class\b/i, ['learning']],
  [/cinema|kino|concert|theatre|museum|ticket|festival/i, ['culture']]
];
function tagKey(t) { return String(t || '').trim().toLowerCase(); }
function tagSuggestions(F) {
  var have = tagsOf({ tags:F.tags }).map(tagKey), score = {}, label = {};
  function add(t, s) { var k = tagKey(t); if (!k || have.indexOf(k) > -1) return; score[k] = (score[k] || 0) + s; if (!label[k]) label[k] = String(t).trim(); }
  var desc = String(F.description || '').toLowerCase(), words = desc.split(/[^a-z0-9äöüéèàç]+/).filter(function (w) { return w.length > 2; });
  txs().forEach(function (tx) {
    var tg = tagsOf(tx); if (!tg.length || tx.id === F.id) return;
    var d = String(tx.description || '').toLowerCase(), hit = words.filter(function (w) { return d.indexOf(w) > -1; }).length;
    tg.forEach(function (t) {
      if (hit) add(t, 10 * hit);
      if (F.subcategory && tx.subcategory === F.subcategory && tx.category === F.category) add(t, 3);
      add(t, 0.1);   // overall use
    });
  });
  var text = desc;   // words you typed only (the subcategory may still be the form's default)
  TAG_WORDS.forEach(function (r) { if (r[0].test(text)) r[1].forEach(function (t, i) { add(t, 6 - i); }); });
  return Object.keys(score).filter(function (k) { return score[k] >= 1 || Object.keys(score).length < 4; })
    .sort(function (a, b) { return score[b] - score[a]; }).slice(0, 6).map(function (k) { return label[k]; });
}
function tagChipsHTML(F) {
  var sel = tagsOf({ tags:F.tags }), sug = tagSuggestions(F);
  return '<div class="field full tagpick"><label>Tags</label><div class="tchips" id="mtagchips">' + tagChipsInner(sel, sug) + '</div></div>';
}
function tagChipsInner(sel, sug) {
  return sel.map(function (t) { return '<button type="button" class="tchip on" data-act="tagoff" data-t="' + esc(t) + '" aria-label="Remove tag ' + esc(t) + '">#' + esc(t) + ' ×</button>'; }).join('') +
    sug.map(function (t) { return '<button type="button" class="tchip" data-act="tagon" data-t="' + esc(t) + '">#' + esc(t) + '</button>'; }).join('') +
    (FORM && FORM._newtag ? '<span class="tnew"><input id="mnewtag" autocomplete="off" placeholder="new tag" aria-label="New tag"><button type="button" class="tchip" data-act="tagadd">Add</button></span>'
      : '<button type="button" class="tchip add" data-act="tagnew">+ tag</button>');
}
function paintTagChips() { var el = $('mtagchips'); if (el && FORM) { var mt = $('mtags'); if (mt) FORM.tags = mt.value; el.innerHTML = tagChipsInner(tagsOf({ tags:FORM.tags }), tagSuggestions(FORM)); } }
function toggleTag(t, on) {
  var cur = tagsOf({ tags:FORM.tags }).filter(function (x) { return tagKey(x) !== tagKey(t); });
  if (on) cur.push(String(t).trim().replace(/^#/, ''));
  FORM.tags = cur.join(', ');
}
function allTags() {
  var m = {};
  txs().forEach(function (tx) {
    var net = tx.type === 'refund' ? -(+tx.amount || 0) : tx.type === 'income' ? 0 : (+tx.amount || 0);
    tagsOf(tx).forEach(function (t) {
      m[t] = m[t] || { tag:t, total:0, n:0, from:tx.date, to:tx.date };
      m[t].total += net; m[t].n++;
      if (tx.date < m[t].from) m[t].from = tx.date; if (tx.date > m[t].to) m[t].to = tx.date;
    });
  });
  return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return a.to < b.to ? 1 : -1; });
}
function setting(key, def) {
  var s = (DATA.Settings || []).filter(function (r) { return r.key === key; })[0];
  return s && s.value !== '' && s.value != null ? s.value : def;
}
function cardFeePct() { var v = parseFloat(setting('card_fee_pct', 1.75)); return isNaN(v) ? 1.75 : v; }

// Rules: description contains the match text (case-insensitive). Lower priority number wins, then the longer match.
function sortedRules() {
  return (DATA.Rule || []).filter(function (r) { return String(r.match || '').trim(); }).slice().sort(function (a, b) {
    var pa = +a.priority || 100, pb = +b.priority || 100;
    return pa !== pb ? pa - pb : String(b.match).length - String(a.match).length;
  });
}
function matchRule(desc) {
  var d = String(desc || '').toLowerCase();
  if (!d.trim()) return null;
  return sortedRules().filter(function (r) { return d.indexOf(String(r.match).trim().toLowerCase()) > -1; })[0] || null;
}
// Suggested rules: a description used 3+ times that almost always lands in the same category
function suggestedRules() {
  var by = {};
  txs().forEach(function (tx) {
    var k = String(tx.description || '').trim(); if (!k) return;
    (by[k] = by[k] || []).push(tx);
  });
  return Object.keys(by).filter(function (k) { return by[k].length >= 3 && !matchRule(k); }).map(function (k) {
    var list = by[k];
    function top(field) {
      var c = {}; list.forEach(function (t) { var v = t[field] || ''; c[v] = (c[v] || 0) + 1; });
      var best = Object.keys(c).sort(function (a, b) { return c[b] - c[a]; })[0];
      return { v:best, share:c[best] / list.length };
    }
    var cat = top('category'), sub = top('subcategory'), type = top('type'), acct = top('account');
    if (cat.share < 0.9 || sub.share < 0.8) return null;
    return { match:k, category:cat.v, subcategory:sub.v, type:type.share >= 0.8 ? type.v : '', account:acct.share >= 0.8 ? acct.v : '', n:list.length };
  }).filter(Boolean).sort(function (a, b) { return b.n - a.n; });
}
function ruleText(r) {
  return esc(r.category) + (r.subcategory ? ' › ' + esc(r.subcategory) : '') +
    (r.type && r.type !== 'expense' ? ' · ' + esc(r.type) : '') +
    (r.account ? ' · ' + (r.account === 'credit_card' ? 'credit card' : 'debit card') : '') +
    (r.tags ? ' · #' + esc(r.tags) : '');
}

// Exchange rates: ECB reference rates via frankfurter (same source as Holotrack), cached per currency and day
var CURRENCIES = ['CHF','EUR','USD','GBP','SGD','JPY','RON','SEK','NOK','DKK','PLN','CZK','HUF','THB','AUD','CAD','HKD','CNY'];
var RATE_CACHE = {};
function fxRate(cur, date) {
  if (cur === 'CHF') return Promise.resolve(1);
  var day = date && date <= ymd(today()) ? date : 'latest', k = cur + '@' + day;
  if (RATE_CACHE[k]) return Promise.resolve(RATE_CACHE[k]);
  // ECB rates from Frankfurter (new address first, old one second); if both fail, the open currency-api on jsDelivr
  var lc = cur.toLowerCase(), sources = [
    ['https://api.frankfurter.dev/v1/' + day + '?base=' + cur + '&symbols=CHF', function (j) { return j && j.rates && j.rates.CHF; }],
    ['https://api.frankfurter.app/' + day + '?from=' + cur + '&to=CHF', function (j) { return j && j.rates && j.rates.CHF; }],
    ['https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@' + day + '/v1/currencies/' + lc + '.json', function (j) { return j && j[lc] && j[lc].chf; }],
    ['https://' + day + '.currency-api.pages.dev/v1/currencies/' + lc + '.json', function (j) { return j && j[lc] && j[lc].chf; }]
  ];
  var tryAt = function (i) {
    if (i >= sources.length) return Promise.reject(new Error('Couldn’t reach a rate service for ' + cur));
    return fetch(sources[i][0]).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { var v = +sources[i][1](j); if (!(v > 0)) throw new Error('no rate'); RATE_CACHE[k] = v; return v; })
      .catch(function () { return tryAt(i + 1); });
  };
  return tryAt(0);
}

// ─── Transactions list ────────────────────────────────────────────────────
// ─── One search box ─────────────────────────────────────────────────────────
// Understands words, amounts (>100, <5, 50-200), years (2026), months (oct), "this period" / "last period" and #tags.
// A search looks through all time unless it names a time itself.
var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
var MONTH_FULL = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function searchTokens(q) {
  var out = [], s = String(q || '').toLowerCase().replace(/\b(this|last) period\b/g, function (m) { return m.replace(' ', '_'); });
  s.split(/\s+/).filter(Boolean).forEach(function (w) {
    var m, n = function (x) { return parseFloat(x.replace(',', '.')); };
    if ((m = /^(>=?|<=?)(\d+(?:[.,]\d+)?)$/.exec(w))) out.push({ k:'amt', op:m[1], v:n(m[2]), label:m[1].replace('>=', '≥').replace('<=', '≤') + ' ' + m[2] });
    else if ((m = /^(\d+(?:[.,]\d+)?)-(\d+(?:[.,]\d+)?)$/.exec(w))) out.push({ k:'range', a:n(m[1]), b:n(m[2]), label:m[1] + '–' + m[2] });
    else if (/^20\d\d$/.test(w)) out.push({ k:'year', v:w, label:w });
    else if (MONTHS.indexOf(w.slice(0, 3)) > -1 && (MONTHS.indexOf(w) > -1 || MONTH_FULL.indexOf(w) > -1)) out.push({ k:'month', v:MONTHS.indexOf(w.slice(0, 3)) + 1, label:MONTH_FULL[MONTHS.indexOf(w.slice(0, 3))].replace(/^./, function (c) { return c.toUpperCase(); }) });
    else if (w === 'this_period' || w === 'last_period') out.push({ k:'period', v:w === 'this_period' ? 0 : -1, label:w.replace('_', ' ') });
    else if (w.charAt(0) === '#' && w.length > 1) out.push({ k:'tag', v:w.slice(1), label:w });
    else out.push({ k:'word', v:w, label:w });
  });
  return out;
}
function searchWithout(q, i) { return searchTokens(q).filter(function (x, j) { return j !== i; }).map(function (x) { return x.k === 'period' ? x.label : x.k === 'amt' ? x.op + x.v : x.k === 'range' ? x.a + '-' + x.b : x.k === 'month' ? MONTHS[x.v - 1] : x.label; }).join(' '); }
function searchMatch(tx, toks) {
  var a = +tx.amount || 0, d = String(tx.date).slice(0, 10), hay = (tx.description + ' ' + tx.subcategory + ' ' + tx.category + ' ' + (tx.tags || '')).toLowerCase();
  return toks.every(function (t) {
    if (t.k === 'word') return hay.indexOf(t.v) > -1;
    if (t.k === 'amt') return t.op === '>' ? a > t.v : t.op === '>=' ? a >= t.v : t.op === '<' ? a < t.v : a <= t.v;
    if (t.k === 'range') return a >= Math.min(t.a, t.b) && a <= Math.max(t.a, t.b);
    if (t.k === 'year') return d.slice(0, 4) === t.v;
    if (t.k === 'month') return +d.slice(5, 7) === t.v;
    if (t.k === 'period') return inPeriod(tx, periodAt(t.v));
    if (t.k === 'tag') return tagsOf(tx).some(function (g) { return g.toLowerCase().indexOf(t.v) === 0; });
    return true;
  });
}
function searchSummaryHTML(list, toks) {
  var out = 0, inc = 0, cats = {}, byMonth = {};
  list.forEach(function (tx) {
    var a = +tx.amount || 0, sgn = tx.type === 'income' ? 0 : tx.type === 'refund' ? -1 : 1;
    if (tx.type === 'income') inc += a; else out += sgn * a;
    var k = tx.category + (tx.subcategory ? ' › ' + tx.subcategory : ''); cats[k] = (cats[k] || 0) + 1;
    var mk = String(tx.date).slice(0, 7); byMonth[mk] = (byMonth[mk] || 0) + (tx.type === 'income' ? a : sgn * a);
  });
  var onlyInc = !out && inc, total = onlyInc ? inc : out, top = Object.keys(cats).sort(function (x, y) { return cats[y] - cats[x]; })[0];
  var t = today(), months = []; for (var i = 11; i >= 0; i--) { var d = new Date(t.getFullYear(), t.getMonth() - i, 1); months.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); }
  var mx = Math.max.apply(null, months.map(function (m) { return Math.max(0, byMonth[m] || 0); }).concat([0.01]));
  return '<section class="srch" aria-live="polite"><div class="chips">' + toks.map(function (x, j) { return '<button class="chip on" data-act="qdel" data-i="' + j + '" aria-label="Remove ' + esc(x.label) + '">' + esc(x.label) + ' ×</button>'; }).join('') + '</div>' +
    '<div class="srtot"><span class="eyebrow">' + list.length + ' result' + (list.length === 1 ? '' : 's') + (onlyInc ? ' · income' : '') + '</span><span class="val num">' + chf(total) + '</span>' +
    (list.length ? '<small>average ' + fmtCHF.format(total / list.length) + (top ? (cats[top] === list.length ? ' · all in ' + esc(top) : cats[top] * 2 > list.length ? ' · mostly ' + esc(top) + ' (' + cats[top] + ' of ' + list.length + ')' : ' · across ' + Object.keys(cats).length + ' categories') : '') + '</small>' : '') + '</div>' +
    (list.length ? '<div class="srbars" aria-hidden="true">' + months.map(function (m) { return '<i title="' + m + '" style="height:' + Math.round(Math.max(0, byMonth[m] || 0) / mx * 100) + '%"></i>'; }).join('') + '</div>' +
      '<div class="srlab">' + months.map(function (m) { return '<span>' + 'JFMAMJJASOND'.charAt(+m.slice(5) - 1) + '</span>'; }).join('') + '</div>' : '') + '</section>';
}
function filteredTx() {
  var f = UI.tx, p = periodAt(UI.periodOffset), toks = searchTokens(f.q);
  return txs().filter(function (tx) {
    if (f.scope === 'period' && !toks.length && !inPeriod(tx, p)) return false;   // a search looks through all time
    if (f.type && tx.type !== f.type) return false;
    if (f.category && tx.category !== f.category) return false;
    if (f.account && tx.account !== f.account) return false;
    if (f.sub && (tx.subcategory || '') !== f.sub) return false;
    if (f.from && tx.date < f.from) return false;
    if (f.to && tx.date > f.to) return false;
    if (f.tag && tagsOf(tx).indexOf(f.tag) < 0) return false;
    if (f.dayToDay && !((tx.type === 'expense' && !isInfra(tx, roles())) || tx.type === 'refund')) return false;
    if (toks.length && !searchMatch(tx, toks)) return false;
    return true;
  }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
}
function owedPill(tx) {
  if (tagsOf(tx).indexOf('owed') < 0) return '';
  var it = owedItems().filter(function (x) { return x.tx.id === tx.id; })[0];
  return it && it.rec.status === 'open' && it.left > 0.004 ? ' <span class="otag">owed ' + fmtCHF.format(it.left) + (it.rec.who ? ' · ' + esc(it.rec.who) : '') + '</span>' : '';
}
function opt(v, label, sel) { return '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(label) + '</option>'; }
function filterChips(f) {
  var c = [];
  if (f.category) c.push(esc(f.category) + (f.sub ? ' › ' + esc(f.sub) : ''));
  else if (f.sub) c.push(esc(f.sub));
  if (f.from || f.to) c.push(periodDay(pd(f.from || f.to)) + '–' + periodDay(pd(f.to || f.from)));
  if (f.tag) c.push('#' + esc(f.tag));
  if (f.dayToDay) c.push('day-to-day only');
  if (f.account) c.push(f.account === 'credit_card' ? 'Credit card' : 'Debit card');
  if (f.type) c.push(f.type);
  if (!c.length) return '';
  return '<div class="chips"><span class="soon">Showing</span>' + c.map(function (x) { return '<span class="chip">' + x + '</span>'; }).join('') +
    '<button class="navlink" data-act="clearf">Clear filters</button></div>';
}
function transactionsHTML() {
  var f = UI.tx, list = filteredTx(), t = today(), tagList = allTags();
  var inc = 0, out = 0, back = 0;
  list.forEach(function (tx) { var a = +tx.amount || 0; if (tx.type === 'income') inc += a; else if (tx.type === 'refund') back += a; else out += a; });
  var nRev = reviewCount(), tab = UI.txTab === 'review' ? 'review' : 'all';
  var tabs = '<div class="seg3 txtabs" role="tablist">' +
    '<button role="tab" aria-selected="' + (tab === 'all') + '" class="' + (tab === 'all' ? 'on' : '') + '" data-act="txtab" data-v="all">All</button>' +
    '<button role="tab" aria-selected="' + (tab === 'review') + '" class="' + (tab === 'review' ? 'on' : '') + '" data-act="txtab" data-v="review">To review' + (nRev ? ' <span class="nbadge">' + nRev + '</span>' : '') + '</button></div>';
  if (tab === 'review') return topbar('Transactions', false, '<button class="btn primary" data-act="addtx">+ Add</button>') + tabs + '<div style="display:grid;gap:14px">' + priceAlerts().map(priceAlertHTML).join('') + anomalyBody() + '</div>';
  var h = topbar('Transactions', f.scope === 'period', '<button class="btn primary" data-act="addtx">+ Add</button>') + tabs;
  var nf = (f.scope !== 'period' ? 1 : 0) + (f.type ? 1 : 0) + (f.category ? 1 : 0) + (f.account ? 1 : 0) + (f.tag ? 1 : 0);
  h += '<div style="display:grid;gap:14px"><div class="filters">' +
    '<input type="search" id="fq" placeholder="Search: parking, >100, 2026, oct, #split" autocomplete="off" value="' + esc(f.q) + '">' +
    '<button class="btn ffbtn' + (UI.fOpen ? ' on' : '') + '" data-act="ftoggle" aria-expanded="' + !!UI.fOpen + '">Filter' + (nf ? ' · ' + nf : '') + '</button>' +
    '<div class="fmore' + (UI.fOpen ? ' open' : '') + '"><select id="fscope">' + opt('period','This period',f.scope) + opt('all','All time',f.scope) + '</select>' +
    '<select id="ftype">' + opt('','All types',f.type) + TYPES.map(function (x) { return opt(x[0], x[1], f.type); }).join('') + '</select>' +
    '<select id="fcat">' + opt('','All categories',f.category) + Object.keys(CATEGORIES).map(function (c) { return opt(c, c, f.category); }).join('') + '</select>' +
    '<select id="facct">' + opt('','Both cards',f.account) + ACCOUNTS.map(function (x) { return opt(x[0], x[1], f.account); }).join('') + '</select>' +
    (tagList.length ? '<select id="ftag">' + opt('','All tags',f.tag || '') + tagList.map(function (x) { return opt(x.tag, '#' + x.tag, f.tag || ''); }).join('') + '</select>' : '') +
    '</div></div>' + filterChips(f) + (searchTokens(f.q).length ? searchSummaryHTML(list, searchTokens(f.q)) : '') + '<div class="sumbar"><span>' + list.length + ' transactions</span><span>Out<b>' + chf(out) + '</b></span><span>Refunds<b>' + chf(back) + '</b></span><span>Income<b>' + chf(inc) + '</b></span></div>';
  if (tagList.length && !f.tag) {
    h += '<div class="tagrow phonefold' + (UI.fOpen ? ' open' : '') + '"><span class="soon">Tags</span>' + tagList.slice(0, 8).map(function (x) {
      return '<button class="tagchip" data-act="tagfilter" data-tag="' + esc(x.tag) + '">#' + esc(x.tag) + ' <b>' + sw0(x.total) + '</b></button>';
    }).join('') + '</div>';
  }
  if (list.length) {
    h += '<div class="bulktag phonefold' + (UI.fOpen ? ' open' : '') + '"><label for="bulktag" class="soon">Tag all ' + list.length + ' shown</label>' +
      '<input id="bulktag" list="tagList" placeholder="e.g. Singapore 2026" autocomplete="off">' +
      '<button class="btn" data-act="bulktag">Add tag</button></div>' +
      '<datalist id="tagList">' + tagList.map(function (x) { return '<option value="' + esc(x.tag) + '">'; }).join('') + '</datalist>';
  }
  h += '</div><div>';
  if (!list.length) h += '<div class="empty">No transactions match these filters</div>';
  var lastDate = null;
  list.forEach(function (tx) {
    if (tx.date !== lastDate) {
      if (lastDate) h += '</div>';
      lastDate = tx.date;
      h += '<div class="daygroup"><h4>' + pd(tx.date).toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', year:'numeric' }) + '</h4>';
    }
    var a = +tx.amount || 0, sign = (tx.type === 'income' || tx.type === 'refund') ? '+' : '−';
    var cls = (tx.type === 'income' || tx.type === 'refund') ? 'in' : '';
    var tags = '';
    if (pd(tx.date) > t) tags += ' <span class="tag sch">scheduled</span>';
    if (tx.type === 'refund') tags += ' <span class="tag">refund</span>';
    if (tx.type === 'investment') tags += ' <span class="tag">investment</span>';
    if (tx.anomaly_status === 'excluded') tags += ' <span class="tag ex">one-off</span>';
    var fx = tx.orig_currency && tx.orig_currency !== 'CHF' ? ' · ' + fmtCHF.format(+tx.orig_amount || 0) + ' ' + esc(tx.orig_currency) + (+tx.fx_fee ? ' + ' + tx.fx_fee + '% fee' : '') : '';
    h += '<div class="tx" data-tx="' + esc(tx.id) + '" tabindex="0" role="button"><span class="ti' + (cls ? ' ' + cls : '') + '">' + txIco(tx) + '</span>' +
      '<span class="d"><b>' + esc(tx.description) + tags + '</b><small>' + esc(tx.subcategory || tx.category) + ' · ' + (tx.account === 'credit_card' ? 'Credit card' : 'Debit card') + fx +
      tagsOf(tx).map(function (g) { return ' <span class="hash">#' + esc(g) + '</span>'; }).join('') + owedPill(tx) + '</small></span>' +
      '<span class="a ' + cls + '">' + sign + ' ' + fmtCHF.format(a) + '</span></div>';
  });
  if (lastDate) h += '</div>';
  return h + '</div>';
}

// Save several rows in one call (used by "tag all shown")
function saveMany(table, rows) {
  setSync('busy');
  return post({ action:'upsertMany', table:table, rows:rows }).then(function (j) {
    var arr = DATA[table] = DATA[table] || [];
    (j.rows || []).forEach(function (r) { var i = arr.findIndex(function (x) { return x.id === r.id; }); if (i > -1) arr[i] = r; else arr.push(r); });
    persistCache(); UI.lastSync = new Date(); setSync('ok'); draw();
  }).catch(function (e) { setSync('err', e.message); toast('Not saved: ' + e.message); });
}

// ─── Transaction form ─────────────────────────────────────────────────────
var FORM = null; // working copy while the modal is open
function openTx(id) {
  var src = id ? txs().filter(function (t) { return t.id === id; })[0] : null;
  FORM = src ? Object.assign({}, src) : { date:ymd(today()), description:'', category:'Personal Cash', subcategory:'Lunches', amount:'', type:'expense', account:'credit_card', anomaly_status:'', tags:'', orig_currency:'CHF', orig_amount:'', fx_fee:'' };
  if (!FORM.orig_currency) FORM.orig_currency = 'CHF';
  FORM._confirmDelete = false; FORM._err = ''; FORM._note = ''; FORM._rate = +FORM.fx_rate || null;
  FORM._quick = !src;   // new transactions open as the two-field quick add; “More” shows everything
  FORM._fee = FORM.orig_currency !== 'CHF' ? (+FORM.fx_fee > 0) : true;
  drawModal();
  setTimeout(function () { var d = $('mdesc'); if (d && !id) d.focus(); }, 30);
}
function closeModal() { FORM = null; $('modalRoot').innerHTML = ''; }
// Redrawing the form removes the focused field, which can fire its change event mid-redraw (e.g. the description
// autofill). Such a nested redraw is postponed until the current one has finished instead of crashing it.
var MODAL_BUSY = false, MODAL_AGAIN = false;
function drawModal() {
  if (!FORM) return;
  if (MODAL_BUSY) { MODAL_AGAIN = true; return; }
  MODAL_BUSY = true;
  var ae = document.activeElement, keep = ae && ae.id && ae.closest && ae.closest('.modal') ? ae.id : null, sel = null;
  try { sel = keep && ae.selectionStart != null ? [ae.selectionStart, ae.selectionEnd] : null; } catch (e) { sel = null; }   // number inputs have no selection
  try { drawModalNow(); } finally { MODAL_BUSY = false; }
  if (keep) { var el = $(keep); if (el && document.activeElement !== el) { el.focus(); try { if (sel) el.setSelectionRange(sel[0], sel[1]); } catch (e) {} } }
  if (MODAL_AGAIN) { MODAL_AGAIN = false; drawModal(); }
}
function drawModalNow() {
  var descs = {}, tagList = allTags();
  txs().forEach(function (t) { if (t.description) descs[t.description] = 1; });
  var subs = subsOf(FORM.category), foreign = FORM.orig_currency && FORM.orig_currency !== 'CHF', quick = FORM._quick && !FORM.id;
  var h = '<div class="scrim" data-act="scrim"><div class="modal' + (quick ? ' quick' : '') + '" role="dialog" aria-modal="true" aria-labelledby="mtitle">' +
    '<h2 id="mtitle">' + (FORM.id ? 'Edit transaction' : 'New transaction') + '</h2>' +
    (quick ? '' : '<div class="seg" id="mtype">' + TYPES.map(function (x) { return '<button type="button" data-type="' + x[0] + '" class="' + (FORM.type === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div>') +
    '<div class="formgrid">' +
    '<div class="field full sugwrap"><label for="mdesc">Description</label><input id="mdesc" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="msugg" value="' + esc(FORM.description) + '">' +
    '<div class="sugg" id="msugg" role="listbox" hidden></div></div>' +
    (FORM._note ? '<div class="field full rulenote">' + FORM._note + '</div>' : '') +
    (foreign
      ? '<div class="field"><label for="morig">Amount paid in ' + esc(FORM.orig_currency) + '</label><div class="amtrow"><input id="morig" type="number" inputmode="decimal" step="0.01" min="0" value="' + esc(FORM.orig_amount) + '">' + '<select id="mcur" aria-label="Currency">' + CURRENCIES.map(function (c) { return opt(c, c, FORM.orig_currency); }).join('') + '</select>' + '</div></div>' +
        '<div class="field full fxbox"><label class="switch" style="min-height:0"><input type="checkbox" id="mfee"' + (FORM._fee ? ' checked' : '') + '><span>Add card fee +' + cardFeePct() + '%</span></label>' +
        '<span id="mfxinfo" class="soon">' + fxInfo() + '</span></div>'
      : '') +
    (foreign
      ? '<div class="field"><label for="mamt">In CHF · ' + (FORM._chfManual ? 'your amount' : 'calculated, or type your bank’s') + '</label><input id="mamt" type="number" inputmode="decimal" step="0.01" min="0" value="' + esc(FORM.amount) + '"></div>'
      : '<div class="field"><label for="mamt">Amount</label><div class="amtrow"><input id="mamt" type="number" inputmode="decimal" step="0.01" min="0" value="' + esc(FORM.amount) + '">' + '<select id="mcur" aria-label="Currency">' + CURRENCIES.map(function (c) { return opt(c, c, FORM.orig_currency); }).join('') + '</select>' + '</div></div>') +
    oweBoxHTML(FORM) +
    (FORM.type === 'income' ? '' : tagChipsHTML(FORM)) +
    (quick ? quickSummary() : fullFields(subs, tagList)) +
    '</div>' + (FORM._err ? '<div class="err">' + esc(FORM._err) + '</div>' : '') +
    '<div class="actions">' +
    (FORM.id ? (FORM._confirmDelete
      ? '<span class="left"><button class="btn danger" data-act="delyes">Yes, delete</button> <button class="btn" data-act="delno">Keep</button></span>'
      : '<button class="btn danger left" data-act="del">Delete</button>') : '') +
    (quick ? '' : '<button class="btn" data-act="mkrule" title="Future transactions with this description get the same category, type and account">Save as rule</button>') +
    '<button class="btn" data-act="cancel">Cancel</button><button class="btn primary" data-act="save">' + (FORM.id ? 'Save changes' : 'Add transaction') + '</button>' +
    '</div></div></div>';
  $('modalRoot').innerHTML = h;
}
// Quick add: what will be saved besides the two fields, filled from your history and rules; tap to change it
function quickSummary() {
  var t = FORM.type !== 'expense' ? (TYPES.filter(function (x) { return x[0] === FORM.type; })[0] || ['', FORM.type])[1] + ' · ' : '';
  var acct = (ACCOUNTS.filter(function (x) { return x[0] === FORM.account; })[0] || ['', FORM.account])[1];
  var day = FORM.date === ymd(today()) ? 'Today' : FORM.date === ymd(addDays(today(), -1)) ? 'Yesterday' : periodDay(pd(FORM.date));
  return '<div class="field full"><button type="button" class="qsum" data-act="qmore" aria-label="Change category, account, date and more">' + txIco(FORM) +
    '<span class="qs"><b>' + esc(FORM.category) + (FORM.subcategory ? ' › ' + esc(FORM.subcategory) : '') + '</b>' +
    '<small>' + esc(t) + esc(acct) + ' · ' + esc(day) + (FORM.tags ? ' · ' + esc(FORM.tags) : '') + '</small></span><span class="qm">More</span></button></div>';
}
function fullFields(subs, tagList) {
  return '<div class="field"><label for="mdate">Date</label><input id="mdate" type="date" value="' + esc(FORM.date) + '"></div>' +
    '<div class="field"><label for="mcat">Category</label><select id="mcat">' + Object.keys(CATEGORIES).map(function (c) { return opt(c, c, FORM.category); }).join('') + '</select></div>' +
    '<div class="field"><label for="msub">Subcategory</label><select id="msub">' + (subs.length ? subs : ['—']).map(function (s) { return opt(s === '—' ? '' : s, s, FORM.subcategory || ''); }).join('') + '<option value="__new">+ New subcategory…</option></select></div>' +
    (FORM._newsub ? '<div class="field full newsub"><label for="mnewsub">New subcategory in ' + esc(FORM.category) + '</label><div class="nsrow"><input id="mnewsub" autocomplete="off" placeholder="e.g. Car wash"><button class="btn primary" data-act="newsubadd">Add</button><button class="btn" data-act="newsubx">Cancel</button></div></div>' : '') +
    '<div class="field"><label for="macct">Account</label><select id="macct">' + ACCOUNTS.map(function (x) { return opt(x[0], x[1], FORM.account); }).join('') + '</select></div>' +
    splitHTML() +
    '<div class="field"><label for="mtags">Tags (comma separated)</label><input id="mtags" list="mtagList" autocomplete="off" placeholder="e.g. Singapore 2026" value="' + esc(FORM.tags || '') + '"></div>' +
    '<datalist id="mtagList">' + tagList.map(function (x) { return '<option value="' + esc(x.tag) + '">'; }).join('') + '</datalist>' +
    '<div class="field full"><label for="manom">Anomaly review</label><select id="manom">' + opt('','Not reviewed',FORM.anomaly_status || '') + opt('confirmed','Confirmed (keep in projections)',FORM.anomaly_status) + opt('excluded','One-off (exclude from projections)',FORM.anomaly_status) + '</select></div>';
}
// Split one receipt across categories: this transaction keeps what's left, each other part is saved as its own transaction
function splitTotal() { return parseFloat(String(FORM.amount).replace(',', '.')) || 0; }
function splitRest() { return Math.round((splitTotal() - (FORM._split || []).reduce(function (s, x) { return s + (parseFloat(String(x.amount).replace(',', '.')) || 0); }, 0)) * 100) / 100; }
function splitHTML() {
  if (FORM.type !== 'expense' && FORM.type !== 'refund') return '';
  if (!FORM._split) return '<div class="field full"><button type="button" class="navlink" data-act="splitstart">Split across categories…</button></div>';
  var rest = splitRest();
  return '<div class="field full splitbox"><label>Split across categories</label>' +
    '<div class="sprow first"><span>' + esc(FORM.category) + (FORM.subcategory ? ' › ' + esc(FORM.subcategory) : '') + '<small>this transaction keeps the rest</small></span><span class="num' + (rest < 0 ? ' neg' : '') + '" id="sprest">' + fmtCHF.format(rest) + '</span><span></span></div>' +
    FORM._split.map(function (x, i) {
      var subs = subsOf(x.category);
      return '<div class="sprow"><select id="sp_c' + i + '" aria-label="Category of part ' + (i + 2) + '">' + Object.keys(CATEGORIES).map(function (c) { return opt(c, c, x.category); }).join('') + '</select>' +
        '<select id="sp_s' + i + '" aria-label="Subcategory of part ' + (i + 2) + '">' + (subs.length ? subs : ['']).map(function (s) { return opt(s, s || '—', x.subcategory || ''); }).join('') + '</select>' +
        '<input id="sp_a' + i + '" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" aria-label="Amount of part ' + (i + 2) + '" value="' + esc(x.amount) + '">' +
        '<button type="button" class="iconbtn" data-act="splitdel" data-i="' + i + '" aria-label="Remove part ' + (i + 2) + '">×</button></div>';
    }).join('') +
    '<div class="sprow tools"><button type="button" class="navlink" data-act="splitadd">+ Add part</button><button type="button" class="navlink" data-act="splitoff">Don’t split</button></div></div>';
}
function fxInfo() {
  if (!FORM || !FORM.orig_currency || FORM.orig_currency === 'CHF') return '';
  if (FORM._rateErr) return '<span class="neg">' + esc(FORM._rateErr) + '. Enter the CHF amount yourself.</span>';
  if (!FORM._rate) return 'Getting the ' + esc(FORM.orig_currency) + ' rate for this date…';
  var line = '1 ' + esc(FORM.orig_currency) + ' = ' + FORM._rate.toFixed(4) + ' CHF (rate for ' + (FORM.date <= ymd(today()) ? periodDay(pd(FORM.date)) : 'today') + ')' + (FORM._fee ? ' + ' + cardFeePct() + '% fee' : '');
  if (FORM._chfManual && FORM._calc != null) line += '<br>Keeping your CHF amount; calculated would be ' + FORM._calc.toFixed(2) + '. <button type="button" class="navlink" data-act="fxcalc">Use calculated</button>';
  return line;
}
function readForm() {
  function v(id) { var el = $(id); return el ? el.value : null; }   // quick add has only some of the fields
  var x;
  if ((x = v('mdesc')) !== null) FORM.description = x; if ((x = v('mamt')) !== null) FORM.amount = x; if ((x = v('mdate')) !== null) FORM.date = x;
  if ((x = v('mcat')) !== null) FORM.category = x; if ((x = v('msub')) !== null && x !== '__new') FORM.subcategory = x;
  if ((x = v('macct')) !== null) FORM.account = x; if ((x = v('manom')) !== null) FORM.anomaly_status = x;
  if ((x = v('mtags')) !== null) FORM.tags = x; if ((x = v('mcur')) !== null) FORM.orig_currency = x;
  readOwe(FORM);
  (FORM._split || []).forEach(function (p, i) { var c = v('sp_c' + i), s = v('sp_s' + i), a = v('sp_a' + i);
    if (c !== null) { if (c !== p.category) { p.category = c; p.subcategory = (subsOf(c)[0] || ''); } else if (s !== null) p.subcategory = s; } if (a !== null) p.amount = a; });
  if ($('morig')) FORM.orig_amount = $('morig').value;
  if ($('mfee')) FORM._fee = $('mfee').checked;
}
// Recalculate the CHF amount from the foreign amount, the day's rate and the card fee (updates in place, keeps focus)
function recalcFx() {
  if (!FORM || FORM.orig_currency === 'CHF') return;
  readForm();
  var cur = FORM.orig_currency, date = FORM.date;
  FORM._rateErr = '';
  fxRate(cur, date).then(function (rate) {
    if (!FORM || FORM.orig_currency !== cur || FORM.date !== date) return;
    FORM._rate = rate;
    var o = parseFloat(String(FORM.orig_amount).replace(',', '.'));
    if (o >= 0) {
      var chfAmt = Math.round(o * rate * (1 + (FORM._fee ? cardFeePct() / 100 : 0)) * 100) / 100;
      FORM._calc = chfAmt;
      // once you've typed the CHF amount yourself (from your bank), it is never overwritten
      if (!FORM._chfManual) { FORM.amount = chfAmt; var me = $('mamt'); if (me && document.activeElement !== me) me.value = chfAmt.toFixed(2); }
    }
    if ($('mfxinfo')) $('mfxinfo').innerHTML = fxInfo();
  }).catch(function (e) { if (!FORM) return; FORM._rateErr = e.message; if ($('mfxinfo')) $('mfxinfo').innerHTML = fxInfo(); });
  if ($('mfxinfo')) $('mfxinfo').innerHTML = fxInfo();
}
function saveForm() {
  readForm();
  var amt = parseFloat(String(FORM.amount).replace(',', '.'));
  if (!FORM.description.trim()) { FORM._err = 'Add a description.'; return drawModal(); }
  if (!(amt >= 0)) { FORM._err = 'Enter the amount as a positive number.'; return drawModal(); }
  if (!FORM.date) { FORM._err = 'Pick a date.'; return drawModal(); }
  var foreign = FORM.orig_currency && FORM.orig_currency !== 'CHF';
  var row = { id:FORM.id, date:FORM.date, description:FORM.description.trim(), category:FORM.category, subcategory:FORM.subcategory,
    amount:Math.round(amt * 100) / 100, type:FORM.type, account:FORM.account, anomaly_status:FORM.anomaly_status, created_date:FORM.created_date,
    tags:tagsOf({ tags:FORM.tags }).join(', '),
    orig_amount:foreign ? Math.round(parseFloat(String(FORM.orig_amount).replace(',', '.')) * 100) / 100 || '' : '',
    orig_currency:foreign ? FORM.orig_currency : '', fx_rate:foreign && FORM._rate ? FORM._rate : '', fx_fee:foreign && FORM._fee ? cardFeePct() : '' };
  var isNew = !FORM.id;
  var owe = oweToSave(FORM, Math.round(amt * 100) / 100);
  if (owe.err) { FORM._err = owe.err; return drawModal(); }
  if (owe.rec) row.tags = tagsOf({ tags:row.tags }).concat(tagsOf({ tags:row.tags }).indexOf('owed') < 0 ? ['owed'] : []).join(', ');
  var parts = (FORM._split || []).map(function (p) { return Object.assign({}, p, { amount:Math.round((parseFloat(String(p.amount).replace(',', '.')) || 0) * 100) / 100 }); }).filter(function (p) { return p.amount > 0; });
  if (parts.length) {
    var rest = Math.round((row.amount - parts.reduce(function (s, p) { return s + p.amount; }, 0)) * 100) / 100;
    if (rest < 0) { FORM._err = 'The parts add up to more than the total (' + fmtCHF.format(row.amount) + ').'; return drawModal(); }
    var total = row.amount, share = function (a) { return total ? a / total : 0; };
    var tags = tagsOf({ tags:row.tags }); if (tags.indexOf('split') < 0) tags.push('split');
    var base = { date:row.date, description:row.description, type:row.type, account:row.account, tags:tags.filter(function (g) { return g !== 'owed'; }).join(', '), anomaly_status:'', orig_currency:row.orig_currency, fx_rate:row.fx_rate, fx_fee:row.fx_fee };
    var origOf = function (a) { return foreign && row.orig_amount ? Math.round(row.orig_amount * share(a) * 100) / 100 : ''; };
    var main = Object.assign({}, row, { amount:rest, tags:tags.join(', '), orig_amount:origOf(rest) });
    closeModal();
    var chain = saveRow('Transaction', main).then(function (s) { return afterSave(s, owe.rec); });
    parts.forEach(function (p) { chain = chain.then(function () { return saveRow('Transaction', Object.assign({}, base, { category:p.category, subcategory:p.subcategory, amount:p.amount, orig_amount:origOf(p.amount) })); }); });
    return chain.then(function () { toast('Saved in ' + (parts.length + 1) + ' parts'); });
  }
  closeModal();
  saveRow('Transaction', row).then(function (s) { return afterSave(s, owe.rec).then(function () { toast(owe.rec ? 'Added · ' + owe.rec.who + ' owes you ' + fmtCHF.format(owe.rec.amount) : isNew ? 'Transaction added' : 'Changes saved'); }); });
}
// A matching rule fills the form; otherwise the last transaction with the same description does
// Subcategories per category: the built-in list plus any used in your transactions or rules, so nothing gets dropped
function customSubs() { try { return JSON.parse(setting('custom_subs', '') || '{}') || {}; } catch (e) { return {}; } }
function subsOf(cat) {
  var out = (CATEGORIES[cat] || []).slice();
  (customSubs()[cat] || []).forEach(function (sub) { if (out.indexOf(sub) < 0) out.push(sub); });
  (txs()).concat(DATA.Rule || []).forEach(function (r) { var sub = String(r.subcategory || '').trim(); if (r.category === cat && sub && out.indexOf(sub) < 0) out.push(sub); });
  return out;
}
// Leaving the description: fill from your last transaction with the same description (any capitals); a matching rule decides the category
function autofill() {
  if (FORM.id || FORM._picked) return;
  readForm();
  var d = FORM.description.trim(), k = d.toLowerCase(), r = matchRule(d), last = null;
  if (!d) return;
  txs().forEach(function (t) { if (String(t.description || '').trim().toLowerCase() === k && (!last || t.date > last.date)) last = t; });
  if (!r && !last) { FORM._note = ''; return; }
  if (last) { FORM.category = last.category; FORM.subcategory = last.subcategory || ''; FORM.type = last.type; FORM.account = last.account || FORM.account; if (!FORM.amount) FORM.amount = last.amount; }
  if (r) { FORM.category = r.category || FORM.category; FORM.subcategory = r.subcategory || ''; if (r.type) FORM.type = r.type; if (r.account) FORM.account = r.account; if (r.tags && !FORM.tags) FORM.tags = r.tags; }
  FORM._note = (last ? 'Filled from your last “' + esc(last.description) + '” on ' + periodDay(pd(last.date)) : '') + (r ? (last ? '; ' : '') + 'rule “' + esc(r.match) + '” applied: ' + ruleText(r) : '') + (last ? '; change the amount if it’s different.' : '.');
  drawModal(); var a = $(FORM.orig_currency !== 'CHF' ? 'morig' : 'mamt'); if (a) { a.focus(); if (a.select) a.select(); }
}
// Suggestions while typing: past descriptions containing the text, those starting with it first, then most used
function descSuggestions(q) {
  q = String(q || '').trim().toLowerCase(); if (q.length < 2) return [];
  var by = {};
  txs().forEach(function (t) {
    var d = String(t.description || '').trim(), k = d.toLowerCase(); if (!d || k.indexOf(q) < 0) return;
    var x = by[k] || (by[k] = { d:d, n:0, last:null }); x.n++; if (!x.last || t.date > x.last.date) x.last = t;
  });
  return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) {
    var as = a.d.toLowerCase().indexOf(q) === 0 ? 1 : 0, bs = b.d.toLowerCase().indexOf(q) === 0 ? 1 : 0; return (bs - as) || (b.n - a.n);
  }).slice(0, window.matchMedia('(max-width:700px)').matches ? 4 : 6);
}
function hideSugg() { var b = $('msugg'), i = $('mdesc'); if (b) b.hidden = true; if (i) i.setAttribute('aria-expanded', 'false'); }
function paintSugg() {
  var box = $('msugg'), inp = $('mdesc'); if (!box || !inp || !FORM || FORM.id) return;
  var q = inp.value, list = descSuggestions(q), ql = q.trim().toLowerCase(); UI.sugg = list; UI.suggHl = -1;
  if (list.length === 1 && list[0].d.toLowerCase() === ql) list = [];   // already typed in full
  if (!list.length) { box.hidden = true; inp.setAttribute('aria-expanded', 'false'); return; }
  box.innerHTML = list.map(function (x, i) {
    var k = x.d.toLowerCase().indexOf(ql), l = x.last, t = esc(x.d.slice(0, k)) + '<mark>' + esc(x.d.slice(k, k + ql.length)) + '</mark>' + esc(x.d.slice(k + ql.length));
    return '<button type="button" role="option" id="msg' + i + '" data-act="sugg" data-i="' + i + '">' + txIco(l) + '<span class="st">' + t + '</span><span class="num">' + sw(+l.amount) + '</span>' +
      '<small>' + esc(l.category) + (l.subcategory ? ' › ' + esc(l.subcategory) : '') + ' · ' + x.n + '×</small></button>';
  }).join('');
  box.hidden = false; inp.setAttribute('aria-expanded', 'true');
}
function pickSugg(i) {
  var x = (UI.sugg || [])[i]; if (!x || !FORM) return;
  readForm();
  var l = x.last, r = matchRule(x.d);
  FORM.description = x.d; FORM.type = l.type || FORM.type; FORM.account = l.account || FORM.account; FORM.amount = l.amount;
  FORM.category = l.category; FORM.subcategory = l.subcategory || '';
  if (r) { FORM.category = r.category || FORM.category; FORM.subcategory = r.subcategory || ''; if (r.type) FORM.type = r.type; if (r.account) FORM.account = r.account; if (r.tags && !FORM.tags) FORM.tags = r.tags; }
  FORM.orig_currency = 'CHF';
  FORM._picked = true;
  FORM._note = 'Filled from your last “' + esc(x.d) + '” on ' + periodDay(pd(l.date)) + (r ? '; category from rule “' + esc(r.match) + '”' : '') + '; change the amount if it’s different.';
  drawModal(); var a = $('mamt'); if (a) { a.focus(); a.select(); }
}
function addCustomSub() {
  var inp = $('mnewsub'), v = inp ? inp.value.trim() : ''; if (!v) { if (inp) inp.focus(); return; }
  readForm();
  var cat = FORM.category, isNew = subsOf(cat).indexOf(v) < 0;
  FORM.subcategory = v; FORM._newsub = false;
  if (UI.catTable && (DATA.Category || []).length) {   // the Sheet has a Category tab: save it there
    if (isNew) {
      CATEGORIES[cat] = (CATEGORIES[cat] || []).concat([v]);
      var top = (DATA.Category || []).reduce(function (m, r) { return Math.max(m, +r.sort || 0); }, 0);
      saveRow('Category', { category:cat, subcategory:v, sort:top + 1 }).then(function () { toast('Subcategory added: ' + cat + ' › ' + v); }).catch(function () {});
    }
  } else {
    var all = customSubs(); all[cat] = all[cat] || [];
    if (isNew) all[cat].push(v);
    saveSetting('custom_subs', JSON.stringify(all)).then(function () { toast('Subcategory added: ' + cat + ' › ' + v); });
  }
  drawModal();
}
function ruleFromForm() {
  readForm();
  var m = FORM.description.trim();
  if (!m) { FORM._err = 'Add a description first; the rule matches on it.'; return drawModal(); }
  var existing = (DATA.Rule || []).filter(function (r) { return String(r.match).trim().toLowerCase() === m.toLowerCase(); })[0];
  var row = Object.assign({}, existing || {}, { match:m, category:FORM.category, subcategory:FORM.subcategory, type:FORM.type, account:FORM.account, tags:'', priority:(existing && existing.priority) || 100 });
  saveRow('Rule', row).then(function () { toast('Rule saved: “' + m + '” → ' + FORM_cat(row)); });
  FORM._note = 'Rule saved. New transactions containing “' + esc(m) + '” will be filled the same way.'; drawModal();
}
function FORM_cat(r) { return r.category + (r.subcategory ? ' › ' + r.subcategory : ''); }

export { tagSuggestions, paintTagChips, toggleTag, searchTokens, searchWithout, searchMatch, searchSummaryHTML, splitRest, splitHTML, ico, catIco, txIco, goalIco, tagsOf, allTags, setting, cardFeePct, sortedRules, matchRule, suggestedRules, ruleText, CURRENCIES, RATE_CACHE, fxRate, filteredTx, opt, filterChips, transactionsHTML, saveMany, FORM, openTx, closeModal, MODAL_BUSY, MODAL_AGAIN, drawModal, drawModalNow, fxInfo, readForm, recalcFx, saveForm, customSubs, subsOf, autofill, descSuggestions, hideSugg, paintSugg, pickSugg, addCustomSub, ruleFromForm, FORM_cat };
