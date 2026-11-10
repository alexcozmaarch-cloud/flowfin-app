// FlowFin · Recurring items: detector and page.
// Shared settings and state (DATA, UI, _cache, CATEGORIES …) are globals from js/config.js.
import { addDays, daysBetween, esc, pd, periodModel, today, txs, ymd } from './core.js';
import { creditCardModel, kpi, periodDay, sumBy, sw, sw0 } from './dashboard.js';
import { catIco, ico, opt, setting } from './transactions.js';

// ─── Recurring items (detector ported from Base44, plus income and an "active" check) ─
var INTERVALS = [
  { label:'weekly', days:7, tol:3, months:0, perYear:52 },
  { label:'monthly', days:30, tol:7, months:1, perYear:12 },
  { label:'quarterly', days:91, tol:14, months:3, perYear:4 },
  { label:'yearly', days:365, tol:30, months:12, perYear:1 }
];
function normDesc(d) { return String(d || '').toLowerCase().replace(/\d{4,}/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function addMonthsKeepDay(d, n) { var x = new Date(d.getFullYear(), d.getMonth() + n, 1), last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate(); x.setDate(Math.min(d.getDate(), last)); return x; }
function nextAfter(lastDate, iv) { return iv.months ? addMonthsKeepDay(lastDate, iv.months) : addDays(lastDate, iv.days); }
function detectRecurring() {
  var t = today(), groups = {};
  txs().forEach(function (tx) {
    if (!tx.date || !tx.description || pd(tx.date) > t) return;           // scheduled entries are shown separately
    if (tx.category === 'Collectibles') return;                           // purchases, not commitments
    var nd = normDesc(tx.description); if (!nd) return;
    var k = nd + '|' + tx.type; (groups[k] = groups[k] || []).push(tx);
  });
  function patternOf(grp) {
    grp.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var gaps = []; for (var i = 1; i < grp.length; i++) gaps.push(daysBetween(pd(grp[i - 1].date), pd(grp[i].date)));
    var med = median(gaps), iv = INTERVALS.filter(function (v) { return Math.abs(med - v.days) <= v.tol; })[0];
    if (!iv) return null;
    var ok = gaps.filter(function (gp) { return Math.abs(gp - iv.days) <= iv.tol * 1.5; }).length / gaps.length;
    var need = iv.label === 'yearly' ? 2 : 3;
    if (grp.length < need || ok < 0.6) return null;
    return { iv:iv, conf:ok >= 0.8 && grp.length >= 4 ? 'high' : 'medium' };
  }
  var out = [];
  Object.keys(groups).forEach(function (k) {
    var g = groups[k]; if (g.length < 2) return;
    // amounts within 25% (or CHF 2) of the group's median belong to the same item; one-off outliers are left out
    var medAmt = median(g.map(function (x) { return +x.amount || 0; }));
    var core = g.filter(function (x) { return Math.abs((+x.amount || 0) - medAmt) <= Math.max(medAmt * 0.25, 2); });
    var sets = [core];
    // a second price point (e.g. two Apple subscriptions) gets its own chance
    var rest = g.filter(function (x) { return core.indexOf(x) < 0; });
    if (rest.length >= 3) { var m2 = median(rest.map(function (x) { return +x.amount || 0; })); sets.push(rest.filter(function (x) { return Math.abs((+x.amount || 0) - m2) <= Math.max(m2 * 0.25, 2); })); }
    sets.forEach(function (grp) {
      if (grp.length < 2) return;
      var pat = patternOf(grp.slice()); if (!pat) return;
      grp.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      var iv = pat.iv, last = grp[grp.length - 1], lastD = pd(last.date);
      if (daysBetween(lastD, t) > iv.days + iv.tol * 2) return;            // stopped: not seen for over one cycle
      var next = nextAfter(lastD, iv);
      while (next < addDays(t, -iv.tol)) next = nextAfter(next, iv);
      var recent = grp.slice(-3), avg = sumBy(recent, function (x) { return +x.amount; }) / recent.length;
      out.push({ key:k + '|' + Math.round(avg), name:last.description.trim(), type:last.type, amount:Math.round(avg * 100) / 100, last:+last.amount, frequency:iv.label, perYear:iv.perYear,
        account:last.account, category:last.category, subcategory:last.subcategory || '', next:next, overdue:next < t, n:grp.length, conf:pat.conf, lastSeen:last.date });
    });
  });
  return out.sort(function (a, b) { return a.next - b.next; });
}
function trackedFor(c) {
  return (DATA.Subscription || []).filter(function (s) { return normDesc(s.name) === normDesc(c.name); })[0] || null;
}
function recurringItems() {
  // tracked subscriptions win over detected ones with the same name
  var det = detectRecurring(), items = det.map(function (c) { var s = trackedFor(c); return Object.assign({}, c, { tracked:s, status:s ? s.status || 'active' : '' }); });
  (DATA.Subscription || []).forEach(function (s) {
    if (det.some(function (c) { return normDesc(c.name) === normDesc(s.name); })) return;
    var iv = INTERVALS.filter(function (v) { return v.label === s.frequency || (s.frequency === 'annual' && v.label === 'yearly'); })[0] || INTERVALS[1];
    items.push({ name:s.name, type:'expense', amount:+s.amount || 0, frequency:iv.label, perYear:iv.perYear, account:s.account, category:s.category, subcategory:s.subcategory,
      next:s.next_renewal ? pd(s.next_renewal) : null, n:0, conf:'tracked', tracked:s, status:s.status || 'active' });
  });
  return items;
}

// Upcoming until the period ends: scheduled entries, expected recurring items, and the card payment
function upcomingItems(m) {
  var t = today(), end = m.p.end, out = [];
  m.list.forEach(function (tx) { if (pd(tx.date) > t) out.push({ d:pd(tx.date), name:tx.description, amount:+tx.amount, inflow:tx.type === 'income' || tx.type === 'refund', kind:'scheduled' }); });
  recurringItems().forEach(function (r) {
    if (r.status && r.status !== 'active') return;
    if (!r.next || r.next > end || r.next < addDays(t, -7)) return;
    if (out.some(function (o) { return normDesc(o.name) === normDesc(r.name) && Math.abs(daysBetween(o.d, r.next)) < 7; })) return;
    var skip = 'skip_' + normDesc(r.name) + '_' + ymd(r.next);
    if (setting(skip, '')) return;                      // you said it won't come this time
    var late = r.next < t;
    out.push({ d:r.next, name:r.name, amount:r.amount, inflow:r.type === 'income' || r.type === 'refund', kind:late ? 'late · ' + daysBetween(r.next, t) + 'd' : 'expected', approx:true, late:late, r:r, skip:skip });
  });
  var cc = creditCardModel(periodModel(UI.periodOffset - 1));
  var payPrev = new Date(m.p.start.getFullYear(), m.p.start.getMonth(), 25);
  if (payPrev >= t && payPrev <= end && cc.net > 0) out.push({ d:payPrev, name:'Credit card invoice', amount:cc.net, kind:'card' });
  return out.sort(function (a, b) { return a.d - b.d; });
}
function upcomingHTML(m) {
  UI.upLate = [];
  if (!m.isCurrent) return '';
  var u = upcomingItems(m), t = today();
  var sal = recurringItems().filter(function (r) { return r.type === 'income' && (!r.status || r.status === 'active') && r.next && r.next > m.p.end && (r.subcategory === 'Cash' || /salary/i.test(r.name)); })[0];
  if (!u.length && !sal) return '';
  var outSum = sumBy(u, function (x) { return x.inflow ? 0 : x.amount; });
  return '<section class="card"><h3>Upcoming<span class="r">' + (outSum ? 'CHF ' + sw0(outSum) + ' still to pay before ' + periodDay(m.p.end) : 'nothing more to pay before ' + periodDay(m.p.end)) + ' · <button class="navlink" data-nav="subscriptions">All recurring</button></span></h3><div class="uplist">' +
    u.map(function (x) {
      var i = x.late ? UI.upLate.push(x) - 1 : -1;
      var when = x.late ? 'expected ' + periodDay(x.d) + ', ' + daysBetween(x.d, t) + ' day' + (daysBetween(x.d, t) === 1 ? '' : 's') + ' late' : (x.kind === 'scheduled' ? 'scheduled ' : 'expected ') + periodDay(x.d);
      return '<div class="ur' + (x.late ? ' late' : '') + '">' + (x.r ? catIco(x.r.category, x.r.subcategory) : x.kind === 'card' ? ico('credit-card') : ico('calendar')) +
        '<span><b>' + esc(x.name) + '</b> <small>· ' + when + '</small>' +
        (x.late ? '<span class="uq"><button class="navlink" data-act="uppaid" data-i="' + i + '">' + (x.inflow ? 'Received' : 'Paid') + '</button><button class="navlink" data-act="upskip" data-i="' + i + '">Not this time</button></span>' : '') + '</span>' +
        '<span class="num ' + (x.inflow ? 'pos' : '') + '">' + (x.inflow ? '+' : '') + (x.approx ? '~' : '') + sw0(x.amount) + '</span></div>';
    }).join('') +
    (sal ? '<div class="ur">' + ico('banknote') + '<span><b>' + esc(sal.name) + '</b> <small>· next period, about ' + periodDay(sal.next) + '</small></span><span class="num pos">+' + sw0(sal.amount) + '</span></div>' : '') +
    '</div></section>';
}

// ─── Recurring page ───────────────────────────────────────────────────────
function recurringBody() {
  var items = recurringItems(), active = items.filter(function (r) { return !r.status || r.status === 'active'; });
  var outY = sumBy(active, function (r) { return (r.type === 'income' || r.type === 'refund') ? 0 : r.amount * r.perYear; });
  var inY = sumBy(active, function (r) { return (r.type === 'income' || r.type === 'refund') ? r.amount * r.perYear : 0; });
  var subsY = sumBy(active, function (r) { return r.subcategory === 'Subscriptions' ? r.amount * r.perYear : 0; });
  var h = '<h2 class="sechead" id="recurring">Recurring</h2>';
  h += '<section class="kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">' +
    kpi('Recurring out', sw0(outY / 12), 'a month · ' + sw0(outY) + ' a year') +
    kpi('Recurring in', sw0(inY / 12), 'a month') +
    kpi('Subscriptions', sw0(subsY / 12), 'a month · ' + sw0(subsY) + ' a year') +
    kpi('Items', String(active.length), items.length - active.length ? (items.length - active.length) + ' paused or cancelled' : 'found in your history') + '</section>';
  h += '<p class="soon" style="margin:-16px 0 0;font-size:13px">Found automatically: the same description and a similar amount repeating weekly, monthly, quarterly or yearly, seen at least 3 times (twice for yearly) and still active. Collectible purchases are left out. Track an item to keep it here and set its status.</p>';
  h += '<section class="card"><h3>Next due<span class="r">sorted by date</span></h3><div class="rtable">' +
    '<div class="rh"><span>Item</span><span>Next</span><span>Amount</span><span>Per year</span><span></span></div>' +
    items.map(function (r, i) {
      var inflow = r.type === 'income' || r.type === 'refund';
      var status = r.tracked
        ? '<select data-act="rstatus" data-id="' + esc(r.tracked.id) + '" aria-label="Status for ' + esc(r.name) + '">' + opt('active','Active',r.status) + opt('paused','Paused',r.status) + opt('cancelled','Cancelled',r.status) + '</select>'
        : '<button class="navlink" data-act="rtrack" data-i="' + i + '">Track</button>';
      return '<div class="' + (r.status && r.status !== 'active' ? 'off' : '') + '"><span><b>' + catIco(r.category, r.subcategory) + ' ' + esc(r.name) + '</b><small>' + esc(r.subcategory || r.category || '') + ' · ' + r.frequency +
        (r.n ? ' · seen ' + r.n + '×' : '') + (r.conf === 'medium' ? ' · likely' : '') + '</small></span>' +
        '<span class="num">' + (r.next ? periodDay(r.next) + (r.overdue ? ' <span class="tag sch">any day</span>' : '') : '—') + '</span>' +
        '<span class="num ' + (inflow ? 'inflow' : '') + '">' + (inflow ? '+' : '') + sw(r.amount) + '</span>' +
        '<span class="num soon">' + sw0(r.amount * r.perYear) + '</span><span>' + status + '</span></div>';
    }).join('') + '</div></section>';
  return h;
}

export { INTERVALS, normDesc, median, addMonthsKeepDay, nextAfter, detectRecurring, trackedFor, recurringItems, upcomingItems, upcomingHTML, recurringBody };
