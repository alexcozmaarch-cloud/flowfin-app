// FlowFin · Say it: one spoken (or typed) sentence → a filled quick add.
// "45 francs training shorts, sports, credit card" → amount 45 CHF · "Training shorts" · Sports · Credit card.
// Pure: everything it knows comes in through ctx, so it runs the same in the app, the tests and the mockup.
// ctx = { txs:[…], rules:[…] sorted, categories:{cat:[subs]}, today:Date }
// Nothing leaves the phone: the speech-to-text is the phone's own, this is plain word matching against your history.

var CUR_WORDS = [
  [/^(chf|francs?|fr\.?|franken|stutz|swiss francs?)$/, 'CHF'], [/^(eur|euros?|€)$/, 'EUR'], [/^(usd|dollars?|bucks|\$|us dollars?)$/, 'USD'],
  [/^(gbp|pounds?|£|quid)$/, 'GBP'], [/^(ron|lei|leu)$/, 'RON'], [/^(sgd)$/, 'SGD'], [/^(jpy|yen)$/, 'JPY'], [/^(thb|baht)$/, 'THB']
];
var CAT_ALIAS = { lunch:'Lunches', dinner:'Dinners', drink:'Drinks', beer:'Drinks', wine:'Drinks', coffee:'Coffees', snack:'Snacks', grocery:'Groceries',
  groceries:'Groceries', present:'Presents', gift:'Presents', hobby:'Hobbies', subscription:'Subscriptions', transport:'Transportation', train:'Transportation',
  taxi:'Transportation', insurance:'Insurance', utility:'Utilities', childcare:'Childcare', holiday:'Vacations', vacation:'Vacations' };
var DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
var FILLER = /^(i|i've|ive|spent|paid|pay|bought|buy|for|on|at|with|the|a|an|and|it|was|of|using|via|by|in|just|today)$/;

function stem(w) { w = String(w).toLowerCase(); return w.replace(/ies$/, 'y').replace(/(ches|shes|sses|xes)$/, function (m) { return m.slice(0, -2); }).replace(/s$/, ''); }
function ymdOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function cap(s) { s = String(s).trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function parseSpoken(text, ctx) {
  ctx = ctx || {};
  var today = ctx.today ? new Date(ctx.today) : new Date(); today.setHours(12, 0, 0, 0);
  var out = { amount:'', currency:'', description:'', category:'', subcategory:'', account:'', date:'', tags:[], owe:null, type:'', heard:[] };
  var s = ' ' + String(text || '').replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim() + ' ';
  function take(re, fn) { var m = re.exec(s); if (!m) return null; s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length); if (fn) fn(m); return m; }
  function heard(field, t) { out.heard.push({ field:field, text:String(t).trim() }); }

  // someone owes me: "Marco owes me half" / "split with Marco" / "Ana owes me 20"
  take(/\b([A-ZÄÖÜ][\wäöüéè-]*)\s+owes\s+me\s+(half|everything|all(?: of it)?|the whole thing|(\d+(?:[.,]\d+)?))\b/i, function (m) {
    var mode = /^half/i.test(m[2]) ? 'half' : m[3] ? 'other' : 'all';
    out.owe = { on:true, mode:mode, amount:m[3] ? m[3].replace(',', '.') : '', who:cap(m[1]), note:'' }; heard('owe', m[0]);
  }) || take(/\bsplit(?:\s+it)?\s+with\s+([A-ZÄÖÜa-zäöü][\wäöüéè-]*)\b/i, function (m) { out.owe = { on:true, mode:'half', amount:'', who:cap(m[1]), note:'' }; heard('owe', m[0]); });

  // account
  take(/\b(?:(?:with|on|by|using|via)\s+(?:the\s+|my\s+)?)?(credit\s*card|credit|visa|mastercard|amex|debit\s*card|debit|maestro|bank\s*card)\b/i, function (m) {
    out.account = /debit|maestro|bank/i.test(m[1]) ? 'debit_card' : 'credit_card'; heard('account', m[0]);
  });

  // date
  take(/\b(?:the\s+)?day\s+before\s+yesterday\b/i, function (m) { var d = new Date(today); d.setDate(d.getDate() - 2); out.date = ymdOf(d); heard('date', m[0]); }) ||
  take(/\byesterday\b/i, function (m) { var d = new Date(today); d.setDate(d.getDate() - 1); out.date = ymdOf(d); heard('date', m[0]); }) ||
  take(/\b(?:on\s+|last\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i, function (m) {
    var want = DAYS.indexOf(m[1].toLowerCase()), d = new Date(today), back = (d.getDay() - want + 7) % 7 || 7; d.setDate(d.getDate() - back); out.date = ymdOf(d); heard('date', m[0]);
  }) ||
  take(/\bon\s+the\s+(\d{1,2})(?:st|nd|rd|th)?\b/i, function (m) {
    var d = new Date(today); d.setDate(+m[1]); if (d > today) d.setMonth(d.getMonth() - 1); out.date = ymdOf(d); heard('date', m[0]);
  });
  take(/\btoday\b/i);

  // tags said out loud: "hashtag running", "tag recovery"
  var tm; while ((tm = /\b(?:hashtag|hash tag|tag)\s+([\wäöüéè-]+)/i.exec(s))) { out.tags.push(tm[1].toLowerCase()); heard('tags', tm[0]); s = s.slice(0, tm.index) + ' ' + s.slice(tm.index + tm[0].length); }
  take(/#([\wäöüéè-]+)/, function (m) { out.tags.push(m[1].toLowerCase()); heard('tags', m[0]); });

  // type
  take(/\b(refund(?:ed)?|money back|got back)\b/i, function (m) { out.type = 'refund'; heard('type', m[0]); });

  // amount + currency: "45 francs", "CHF 45", "€12.50", "12,50 euro", "45 point 50"
  s = s.replace(/(\d+)\s+(?:point|comma)\s+(\d{1,2})\b/gi, '$1.$2');
  var amtRe = /(?:^|\s)(chf|eur|usd|gbp|ron|sgd|jpy|thb|€|\$|£)?\s?(\d+(?:[.,']\d{3})*(?:[.,]\d{1,2})?)\s?(chf|swiss francs?|francs?|franken|fr\.?|stutz|eur|euros?|usd|us dollars?|dollars?|bucks|gbp|pounds?|quid|ron|lei|leu|sgd|jpy|yen|thb|baht|€|\$|£)?(?=\s|[,.;!?]|$)/i;
  take(amtRe, function (m) {
    var n = m[2].replace(/'/g, ''); if (/[.,]\d{3}([.,]|$)/.test(n)) n = n.replace(/[.,](?=\d{3}(\D|$))/g, ''); n = n.replace(',', '.');
    out.amount = String(+n); var cw = (m[1] || m[3] || '').toLowerCase().trim();
    CUR_WORDS.forEach(function (c) { if (!out.currency && cw && c[0].test(cw)) out.currency = c[1]; });
    heard('amount', m[0]);
  });

  // what's left: description, maybe with a category word said on its own ("…, sports")
  var parts = s.split(/[,;]/).map(function (p) { return p.trim(); }).filter(Boolean);
  var cats = ctx.categories || {}, subIndex = {};
  Object.keys(cats).forEach(function (c) { subIndex[stem(c)] = { category:c, subcategory:'' }; (cats[c] || []).forEach(function (sb) { if (!subIndex[stem(sb)] || c === 'Personal Cash') subIndex[stem(sb)] = { category:c, subcategory:sb }; }); });
  function catFor(word) {
    var k = stem(word.replace(/[^\wäöüéè ]/g, '')); if (subIndex[k]) return Object.assign({}, subIndex[k]);
    var a = CAT_ALIAS[k] || CAT_ALIAS[word.toLowerCase()]; if (a && subIndex[stem(a)]) return Object.assign({}, subIndex[stem(a)]);
    return null;
  }
  var said = null;
  // a whole part that is a category ("training shorts, sports") or a trailing "for sports"
  for (var i = parts.length - 1; i >= 0 && !said && parts.length > 1; i--) {
    var p = parts[i].replace(/^(for|in|as|category)\s+/i, ''), hit = catFor(p);
    if (hit) { said = hit; said.word = p; heard('category', parts[i]); parts.splice(i, 1); }
  }
  var words = parts.join(' ').split(/\s+/).filter(Boolean);
  if (!said && words.length > 2) {
    var last = words[words.length - 1], hit2 = catFor(last), prev = (words[words.length - 2] || '').toLowerCase();
    if (hit2 && /^(for|in|as|category)$/.test(prev)) { said = hit2; said.word = last; heard('category', prev + ' ' + last); words.splice(-2, 2); }
  }
  while (words.length && FILLER.test(words[0].toLowerCase())) words.shift();
  while (words.length && FILLER.test(words[words.length - 1].toLowerCase())) words.pop();
  out.description = cap(words.join(' ').replace(/\s+([,.])/g, '$1').replace(/[,.;]+$/, ''));
  if (!out.description && said) out.description = cap(said.word);   // "12 euros for coffee": coffee is both
  if (out.description) heard('description', out.description);

  // category: a rule wins, then something you said, then the closest past transaction
  var rule = null, desc = out.description.toLowerCase();
  (ctx.rules || []).some(function (r) { var m = String(r.match || '').trim().toLowerCase(); if (m && desc.indexOf(m) > -1) { rule = r; return true; } return false; });
  var best = null, bestScore = 0, dw = desc.split(/[^a-zäöüéè0-9]+/).filter(function (w) { return w.length > 2; });
  (ctx.txs || []).forEach(function (t) {
    var d = String(t.description || '').toLowerCase(); if (!d) return;
    var sc = d === desc ? 100 : dw.filter(function (w) { return d.indexOf(w) > -1; }).length * 10;
    if (sc > bestScore || (sc && sc === bestScore && t.date > best.date)) { best = t; bestScore = sc; }
  });
  if (rule) { out.category = rule.category || ''; out.subcategory = rule.subcategory || ''; if (rule.account && !out.account) out.account = rule.account; out.from = 'rule'; }
  else if (said) { out.category = said.category; out.subcategory = said.subcategory; out.from = 'said'; }
  else if (best) { out.category = best.category; out.subcategory = best.subcategory || ''; if (!out.account && best.account) out.account = best.account; if (!out.type && best.type) out.type = best.type; out.from = 'history'; out.like = best.description; }
  if (!out.category) {   // nothing else to go on: a category word inside the description ("Lunch at Hiltl", "Taxi")
    out.description.split(/\s+/).some(function (w) { var h = catFor(w); if (h) { out.category = h.category; out.subcategory = h.subcategory; out.from = 'word'; return true; } return false; });
  }
  if (said && rule) { out.category = said.category; out.subcategory = said.subcategory; out.from = 'said'; }   // what you say beats a rule
  return out;
}

export { parseSpoken };
