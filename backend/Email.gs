/**
 * FlowFin — monthly summary email.
 * Add as a third file (Email.gs) in the same Apps Script project as Code.gs; it uses readTable_ from there.
 *
 *   startMonthlyEmail()  — run once: sends on the 10th of every month at about 08:00 Zürich time
 *   sendSummaryNow()     — run any time to send the last finished period's summary straight away
 *   stopMonthlyEmail()   — turns the monthly email off
 *
 * The email goes to the Google account that owns this script.
 */

var MAIL_TZ = 'Europe/Zurich';
var MAIL_START_DAY = 10;
var MAIL_APP_URL = 'https://alexcozmaarch-cloud.github.io/flowfin-app/';

function startMonthlyEmail() {
  stopMonthlyEmail();
  ScriptApp.newTrigger('sendMonthlySummary').timeBased().onMonthDay(MAIL_START_DAY).atHour(8).inTimezone(MAIL_TZ).create();
  return 'Monthly email on: the 10th at about 08:00';
}
function stopMonthlyEmail() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'sendMonthlySummary') ScriptApp.deleteTrigger(t); });
}
function sendSummaryNow() { return sendMonthlySummary(); }

// ---------- period maths (same rules as the app) ----------
function mailPeriodEndingBefore_(now) {
  // the period that finished most recently: 10th → 9th
  var y = now.getFullYear(), m = now.getMonth();
  if (now.getDate() < MAIL_START_DAY) m -= 1;                  // still inside the period that started last month
  var start = new Date(y, m - 1, MAIL_START_DAY), end = new Date(y, m, MAIL_START_DAY - 1);
  return { start: start, end: end };
}
function mailYmd_(d) { return Utilities.formatDate(d, MAIL_TZ, 'yyyy-MM-dd'); }
function mailDay_(d) { return Utilities.formatDate(d, MAIL_TZ, 'dd.MM.'); }
function mailFmt_(n, dec) {
  var neg = n < 0, v = Math.abs(n || 0), s = v.toFixed(dec === 0 ? 0 : 2), parts = s.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '’');
  return (neg ? '−' : '') + parts.join('.');
}
function mailEsc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

var MAIL_BUCKETS = [['household', 'Household', ['Family Infrastructure']], ['personal', 'Personal Cash', ['Personal Cash']], ['coll', 'Collectibles', ['Collectibles']], ['invest', 'Invested', ['Financial Investing', 'Retirement 3a']]];
function mailPeriodModel_(txs, p) {
  var from = mailYmd_(p.start), to = mailYmd_(p.end), r = { income: 0, subs: {}, list: [] };
  MAIL_BUCKETS.forEach(function (b) { r[b[0]] = 0; });
  txs.forEach(function (tx) {
    var d = String(tx.date).slice(0, 10); if (d < from || d > to) return;
    r.list.push(tx);
    var a = Number(tx.amount) || 0;
    if (tx.type === 'income') { r.income += a; return; }
    var b = MAIL_BUCKETS.filter(function (x) { return x[2].indexOf(tx.category) > -1; })[0], key = b ? b[0] : 'personal', v = tx.type === 'refund' ? -a : a;
    r[key] += v;
    var sk = tx.subcategory || tx.category || 'Other';
    if (key !== 'household' || sk !== 'General Household') r.subs[sk] = (r.subs[sk] || 0) + v;
  });
  r.out = MAIL_BUCKETS.reduce(function (s, b) { return s + r[b[0]]; }, 0);
  r.left = r.income - r.out;
  r.free = r.income - r.household;
  return r;
}

function buildMonthlySummary_(now) {
  var txs = readTable_('Transaction'), p = mailPeriodEndingBefore_(now);
  var prevP = { start: new Date(p.start.getFullYear(), p.start.getMonth() - 1, MAIL_START_DAY), end: new Date(p.start.getFullYear(), p.start.getMonth(), MAIL_START_DAY - 1) };
  var m = mailPeriodModel_(txs, p), prev = mailPeriodModel_(txs, prevP);
  var label = mailDay_(p.start) + ' – ' + mailDay_(p.end) + p.end.getFullYear();
  var savedPct = m.income > 0 ? (m.left - 0) / m.income * 100 : 0;

  // wealth from current account values
  var ents = readTable_('NetWorthEntry'), assets = 0, liab = 0, inv = 0, invCost = 0;
  var invTypes = ['investment_account', 'third_pillar', 'private_pension', 'tcg_investments'];
  ents.forEach(function (e) {
    var rate = (e.currency && e.currency !== 'CHF') ? (Number(e.exchange_rate) || 1) : 1, v = (Number(e.current_value) || 0) * rate;
    if (e.is_liability) liab += v; else assets += v;
    if (invTypes.indexOf(e.account_type) > -1) { inv += v; invCost += (Number(e.total_invested) || 0) * rate; }
  });

  var ink = '#121413', muted = '#5B605C', rule = '#D3D6D2', red = '#C8102E', bg = '#F3F4F2';
  var mono = "'IBM Plex Mono',Menlo,Consolas,monospace", sans = "Archivo,'Helvetica Neue',Arial,sans-serif";
  function num(v, extra) { return '<td style="padding:7px 0;font-family:' + mono + ';text-align:right;white-space:nowrap;' + (extra || '') + '">' + v + '</td>'; }
  function row(label, value, opts) {
    opts = opts || {};
    return '<tr style="' + (opts.top ? 'border-top:' + opts.top + ' solid ' + ink + ';' : '') + '"><td style="padding:7px 0;' + (opts.bold ? 'font-weight:700;' : '') + '">' + label + '</td>' +
      num(value, (opts.bold ? 'font-weight:700;' : '') + (opts.neg ? 'color:' + red + ';' : '')) + '</tr>';
  }
  var subs = Object.keys(m.subs).map(function (k) { return [k, m.subs[k], prev.subs[k] || 0]; }).filter(function (x) { return Math.abs(x[1]) >= 1; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 10);
  var cmp = [['Income', 'income'], ['Household', 'household'], ['Personal Cash', 'personal'], ['Collectibles', 'coll'], ['Invested', 'invest'], ['Left over', 'left']];
  var ledger = m.list.slice().sort(function (a, b) { return String(a.date) < String(b.date) ? -1 : 1; });

  var html = '<!doctype html><html><body style="margin:0;padding:24px 12px;background:' + bg + ';color:' + ink + ';font-family:' + sans + ';font-size:14px;line-height:1.45">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;margin:0 auto;border-collapse:collapse">' +
    '<tr><td style="border-bottom:2px solid ' + ink + ';padding-bottom:10px"><span style="font-weight:800;font-size:20px">FlowFin<span style="color:' + red + '">.</span></span>' +
    '<span style="float:right;font-family:' + mono + ';font-size:12px;color:' + muted + ';padding-top:6px">' + label + '</span></td></tr>' +
    '<tr><td style="padding:26px 0 6px"><div style="font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase">Left over this period</div>' +
    '<div style="font-size:52px;font-weight:800;letter-spacing:-.03em;line-height:1.05;' + (m.left < 0 ? 'color:' + red + ';' : '') + '"><span style="font-size:20px;font-weight:500;color:' + muted + '">CHF </span>' + mailFmt_(m.left) + '</div>' +
    '<div style="color:' + muted + '">' + mailFmt_(savedPct, 0).replace('’', '') + '% of income · previous period ' + mailFmt_(prev.left) + ' · ' + m.list.length + ' transactions</div></td></tr>' +
    // waterfall
    '<tr><td style="padding-top:22px"><div style="border-top:2px solid ' + ink + ';padding-top:10px;font-weight:700;font-size:17px">Where the income went</div>' +
    '<table role="presentation" width="100%" style="border-collapse:collapse;margin-top:6px">' +
    row('Income', mailFmt_(m.income)) + row('Household', '− ' + mailFmt_(m.household)) + row('= Free cash flow', mailFmt_(m.free), { bold: true, top: '1px' }) +
    row('Personal Cash', '− ' + mailFmt_(m.personal)) + row('Collectibles', '− ' + mailFmt_(m.coll)) + row('Invested', '− ' + mailFmt_(m.invest)) +
    row('= Left over', mailFmt_(m.left), { bold: true, top: '2px', neg: m.left < 0 }) + '</table></td></tr>' +
    // comparison
    '<tr><td style="padding-top:22px"><div style="border-top:2px solid ' + ink + ';padding-top:10px;font-weight:700;font-size:17px">Compared with the previous period</div>' +
    '<table role="presentation" width="100%" style="border-collapse:collapse;margin-top:6px"><tr style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:' + muted + '"><td style="padding:6px 0"></td><td style="text-align:right">This</td><td style="text-align:right">Previous</td><td style="text-align:right">Change</td></tr>' +
    cmp.map(function (c) {
      var a = m[c[1]], b = prev[c[1]], d = a - b, bad = c[1] === 'income' || c[1] === 'left' ? d < -0.5 : (c[1] !== 'invest' && d > 0.5);
      return '<tr style="border-top:1px solid ' + rule + '"><td style="padding:7px 0' + (c[1] === 'left' ? ';font-weight:700' : '') + '">' + c[0] + '</td>' + num(mailFmt_(a, 0)) + num(mailFmt_(b, 0), 'color:' + muted + ';') +
        num((d >= 0 ? '+' : '') + mailFmt_(d, 0), bad ? 'color:' + red + ';' : '') + '</tr>';
    }).join('') + '</table></td></tr>' +
    // top subcategories
    (subs.length ? '<tr><td style="padding-top:22px"><div style="border-top:2px solid ' + ink + ';padding-top:10px;font-weight:700;font-size:17px">Day-to-day, by subcategory</div>' +
      '<table role="presentation" width="100%" style="border-collapse:collapse;margin-top:6px">' + subs.map(function (x) {
        return '<tr style="border-top:1px solid ' + rule + '"><td style="padding:7px 0">' + mailEsc_(x[0]) + '</td>' + num(mailFmt_(x[1])) + num((x[1] - x[2] >= 0 ? '+' : '') + mailFmt_(x[1] - x[2], 0) + ' vs prev.', 'color:' + muted + ';font-size:12px;padding-left:12px') + '</tr>';
      }).join('') + '</table></td></tr>' : '') +
    // wealth
    (ents.length ? '<tr><td style="padding-top:22px"><div style="border-top:2px solid ' + ink + ';padding-top:10px;font-weight:700;font-size:17px">Wealth</div>' +
      '<table role="presentation" width="100%" style="border-collapse:collapse;margin-top:6px">' + row('Net worth', mailFmt_(assets - liab, 0), { bold: true }) +
      row('Investments', mailFmt_(inv, 0)) + row('Gain on investments', (inv - invCost >= 0 ? '+' : '') + mailFmt_(inv - invCost, 0), { neg: inv - invCost < 0 }) + '</table>' +
      '<div style="color:' + muted + ';font-size:12px;padding-top:4px">From your account values as last updated in FlowFin.</div></td></tr>' : '') +
    // ledger
    '<tr><td style="padding-top:22px"><div style="border-top:2px solid ' + ink + ';padding-top:10px;font-weight:700;font-size:17px">All ' + ledger.length + ' transactions</div>' +
    '<table role="presentation" width="100%" style="border-collapse:collapse;margin-top:6px;font-size:12px">' + ledger.map(function (t) {
      var inflow = t.type === 'income' || t.type === 'refund';
      return '<tr style="border-top:1px solid ' + rule + '"><td style="padding:5px 8px 5px 0;font-family:' + mono + ';color:' + muted + ';white-space:nowrap">' + mailEsc_(String(t.date).slice(8, 10) + '.' + String(t.date).slice(5, 7) + '.') + '</td>' +
        '<td style="padding:5px 8px 5px 0">' + mailEsc_(t.description) + '<span style="color:' + muted + '"> · ' + mailEsc_(t.subcategory || t.category) + '</span></td>' +
        num((inflow ? '+' : '') + mailFmt_(Number(t.amount) || 0), 'padding:5px 0;' + (inflow ? 'color:#1E6B45;' : '')) + '</tr>';
    }).join('') + '</table></td></tr>' +
    '<tr><td style="padding-top:26px;border-bottom:2px solid ' + ink + '"></td></tr>' +
    '<tr><td style="padding-top:10px;font-size:12px;color:' + muted + '"><a href="' + MAIL_APP_URL + '#monthly" style="color:' + ink + '">Open the Monthly page in FlowFin</a> · sent ' + Utilities.formatDate(now, MAIL_TZ, 'dd.MM.yyyy') + '</td></tr>' +
    '</table></body></html>';
  return { subject: 'FlowFin · ' + label + ' · left over CHF ' + mailFmt_(m.left), html: html, left: m.left, label: label };
}

function sendMonthlySummary() {
  var r = buildMonthlySummary_(new Date());
  var to = Session.getEffectiveUser().getEmail();
  MailApp.sendEmail({ to: to, subject: r.subject, htmlBody: r.html, name: 'FlowFin' });
  PropertiesService.getScriptProperties().setProperty('LAST_SUMMARY_EMAIL', JSON.stringify({ at: new Date().toISOString(), period: r.label }));
  return 'Sent: ' + r.subject;
}
