// FlowFin · Payday checklist: the top card on the Dashboard for a week after your salary lands.
// Steps: household transfer, card bill, invest what's available, keep for big payments, pillar 3a, collectibles cap.
// Ticks are Settings rows payday_<salary date> = JSON { step:true }; hidden steps for good: payday_hide = JSON [step].
// Approved 25.11.2026 (mockup "FlowFin Payday Checklist").
import { addDays, chf0, daysBetween, esc, pd, roles, today, txs, ymd, periodModel } from './core.js';
import { setting } from './transactions.js';
import { behaviourModel, dailyModel, flowLabel, threeA } from './behaviour.js';
import { creditCardModel } from './dashboard.js';
import { normDesc, recurringItems } from './recurring.js';

var SHOW_DAYS = 7;
function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }), m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; }
function json(key, dflt) { try { var v = setting(key, ''); return v ? JSON.parse(v) : dflt; } catch (e) { return dflt; } }

// the latest salary in the last week (the biggest income if several)
function lastSalary() {
  var r = roles(), t = today(), from = ymd(addDays(t, -SHOW_DAYS)), to = ymd(t), best = null;
  txs().forEach(function (tx) {
    var d = String(tx.date).slice(0, 10); if (d < from || d > to || tx.type !== 'income') return;
    var sal = r.salary.length ? r.salary.indexOf(tx.category) > -1 : /salar|lohn|gehalt/i.test((tx.category || '') + ' ' + (tx.description || ''));
    if (sal && (!best || d > best.d || (d === best.d && +tx.amount > best.a))) best = { d:d, a:+tx.amount || 0 };
  });
  return best;
}

function paydayModel() {
  var S = lastSalary(); if (!S) return null;
  var m = behaviourModel(), ov = m.ov, r = roles(), t = today(), next = addDays(pd(S.d), 31), steps = [];
  // 1 · household: the median of your last three big household transfers
  var hh = txs().filter(function (tx) { return tx.type !== 'income' && tx.type !== 'refund' && +tx.amount >= 500 && pd(tx.date) <= t && flowLabel(tx, ov, r) === 'household'; })
    .sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 3);
  if (hh.length) steps.push({ k:'household', t:'Household to the joint account', s:'your usual transfer · last ' + hh.length + ': ' + hh.map(function (x) { return chf0(+x.amount); }).join(', '), a:median(hh.map(function (x) { return +x.amount; })) });
  // 2 · the card bill for the period that just closed
  try { var cc = creditCardModel(periodModel(-1)); if (cc && cc.net > 0) steps.push({ k:'card', t:'Credit card bill', s:'last period’s card spending, due around the 25th', a:cc.net }); } catch (e) {}
  // 3 · invest what's available now
  var P = m.pot; if (P) steps.push({ k:'invest', t:'Invest what you’ve saved', s:P.share + '% ' + (P.own ? 'your share' : 'advised') + ' of ' + chf0(Math.max(0, P.pot)) + ' saved this period · see Behaviour for why', a:Math.round(P.avail || 0), note:'to investing', zero:!(P.avail >= 1) });
  // 4 · keep for payments of CHF 500+ before the next payday (household doesn't count, it's step 1)
  var big = [];
  txs().forEach(function (tx) { var d = pd(tx.date); if (d > t && d <= next && tx.type !== 'income' && tx.type !== 'refund' && +tx.amount >= 500 && flowLabel(tx, ov, r) !== 'household') big.push({ n:tx.description || tx.category, a:+tx.amount, d:d }); });
  try { recurringItems().forEach(function (it) {
    if ((it.status && it.status !== 'active') || it.type === 'income' || it.type === 'refund' || !it.next || it.next <= t || it.next > next || +it.amount < 500) return;
    if (flowLabel({ category:it.category, subcategory:it.subcategory, tags:'' }, ov, r) === 'household') return;
    if (big.some(function (b) { return normDesc(b.n) === normDesc(it.name); })) return;
    big.push({ n:it.name, a:+it.amount, d:it.next });
  }); } catch (e) {}
  if (big.length) { big.sort(function (a, b) { return a.d - b.d; }); steps.push({ k:'keep', t:'Keep for what’s coming', s:big.slice(0, 3).map(function (b) { return esc(b.n) + ' ' + chf0(b.a) + ' on ' + b.d.getDate() + '.' + (b.d.getMonth() + 1) + '.'; }).join(' · ') + (big.length > 3 ? ' · +' + (big.length - 3) + ' more' : '') + ' · leave it on the account', a:big.reduce(function (s, b) { return s + b.a; }, 0), note:'keep' }); }
  // 5 · pillar 3a
  var y = t.getFullYear(), A = threeA(y), left = Math.max(0, A.max - A.paid), monthsLeft = 12 - t.getMonth();
  steps.push(left <= 0 ? { k:'3a', t:'Pillar 3a', s:y + ' is maxed ✓' + (t.getMonth() === 11 ? ' · from January: ' + chf0(A.max / 12) + ' a month, or all in one go' : ''), a:0, skip:true }
    : { k:'3a', t:'Pillar 3a', s:chf0(A.paid) + ' of ' + chf0(A.max) + ' paid in ' + y + ' · ' + chf0(left) + ' left over ' + monthsLeft + ' month' + (monthsLeft === 1 ? '' : 's'), a:left / monthsLeft, note:'to 3a' });
  // 6 · collectibles: the number to keep in mind
  try { var D = dailyModel(ov, r, P ? P.perDay : 0); steps.push({ k:'spec', t:'Collectibles this period', s:'cap ' + chf0(m.now.cap) + ' · ' + chf0(D.sum.spec) + ' spent in the last 30 days · nothing to move', a:m.now.cap, note:'cap', info:true }); } catch (e) {}
  var hidden = json('payday_hide', []), ticks = json('payday_' + S.d, {});
  steps = steps.filter(function (s) { return hidden.indexOf(s.k) < 0; });
  steps.forEach(function (s) { s.done = !!ticks[s.k] || !!s.skip; });
  var counted = steps.filter(function (s) { return !s.info && !s.skip; }), moved = counted.reduce(function (a, s) { return a + (s.a || 0); }, 0);
  return { S:S, steps:steps, ticks:ticks, done:steps.filter(function (s) { return s.done; }).length, moved:moved, left:S.a - moved, perDay:(S.a - moved) / Math.max(1, daysBetween(t, next)), allDone:steps.every(function (s) { return s.done || s.info; }) && ticks._closed };
}

function paydayHTML() {
  var M; try { M = paydayModel(); } catch (e) { return ''; }
  if (!M || M.ticks._closed) return '';
  var d = pd(M.S.d), todo = M.steps.filter(function (s) { return !s.info; }), n = todo.length, nd = todo.filter(function (s) { return s.done; }).length;
  return '<section class="card pd-card"><h3>Payday · ' + d.getDate() + '.' + (d.getMonth() + 1) + '.<span class="r">salary ' + chf0(M.S.a) + ' in · ' + nd + ' of ' + n + ' done</span></h3>' +
    '<div class="pd-prog">' + todo.map(function (s) { return '<i class="' + (s.done ? 'on' : '') + '"></i>'; }).join('') + '</div>' +
    '<div class="pd-steps">' + M.steps.map(function (s) {
      return '<div class="pd-step' + (s.done ? ' done' : '') + (s.skip ? ' skip' : '') + '"><button class="pd-box" data-act="pdtick" data-k="' + s.k + '" aria-pressed="' + s.done + '" aria-label="' + esc(s.t) + (s.done ? ': done' : '') + '"' + (s.skip ? ' disabled' : '') + '>' + (s.done ? '✓' : '') + '</button>' +
        '<div><b>' + s.t + '</b><small>' + s.s + '</small></div>' +
        '<span class="pd-amt num">' + (s.skip ? '—' : s.zero ? '0' : chf0(s.a)) + (s.note ? '<small>' + s.note + '</small>' : '') + '</span>' +
        '<button class="iconbtn pd-hide" data-act="pdhide" data-k="' + s.k + '" aria-label="Hide this step for good" title="Hide this step for good">×</button></div>';
    }).join('') + '</div>' +
    '<div class="pd-sum"><div><b class="num">' + chf0(M.S.a) + '</b><span>salary in</span></div><div><b class="num">' + chf0(M.moved) + '</b><span>moved or kept by the list</span></div>' +
      '<div><b class="num ' + (M.left >= 0 ? 'pos' : 'neg') + '">' + (M.left < 0 ? '−' : '') + chf0(Math.abs(M.left)) + '</b><span>left until next payday · about ' + chf0(Math.max(0, M.perDay)) + ' a day</span></div></div>' +
    '<div class="bh-btns"><button class="btn" data-act="pdclose">Done for this payday</button></div>' +
    '<p class="soon">Ticking “Invest” logs the transfer like the button on Behaviour. The list doesn’t move money: make the transfers in your banking apps, then tick them here. It stays for a week after payday.</p></section>';
}

export { paydayModel, paydayHTML, lastSalary };
