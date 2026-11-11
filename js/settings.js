// FlowFin · Settings page.
// Shared settings and state (DATA, UI, _cache, CATEGORIES …) are globals from js/config.js.
import { saveRow } from './api.js';
import { apiKey, apiUrl, esc } from './core.js';
import { importHTML } from './import.js';
import { done } from './jobs.js';
import { topbar } from './nav.js';
import { cardFeePct, opt, ruleText, sortedRules, subsOf, suggestedRules } from './transactions.js';

// ─── Settings ─────────────────────────────────────────────────────────────
function settingsHTML() {
  var h = topbar('Settings', false);
  var jobs = ['job_goal_3a_2027', 'job_budgets_2027', 'job_family_6700_2027'].filter(done).length;
  h += '<p class="soon" style="margin:-16px 0 16px;font-size:12px">App version ' + APP_VERSION + ' · setup steps done: ' + jobs + ' of 3 · Apps Script: ' +
    (UI.backend === 'new' ? ((UI.api || 1) < 2 ? '<span class="neg">needs the latest Code.gs (paste it, then Deploy → Manage deployments → New version)</span>' : UI.catTable ? 'up to date' : 'up to date, but no Category tab yet: run setup in Apps Script') : UI.backend === 'old' ? '<span class="neg">older version still deployed: Deploy → Manage deployments → pencil → New version → Deploy</span>' : 'checking…') + '</p>';
  // on a phone this is the "More" tab, so it lists every page the bottom bar doesn't have
  var inBar = MOBILE_NAV.map(function (x) { return x[0]; }), more = [];
  NAV.forEach(function (g) { g.items.forEach(function (it) { if (inBar.indexOf(it[0]) < 0 && it[0] !== 'settings') more.push(it); }); });
  if (more.length) h += '<div class="card phoneonly morepages"><h3>Pages</h3>' + more.map(function (it) { return '<button class="drill rowline" data-nav="' + it[0] + '"><span>' + it[1] + '</span><span class="soon">›</span></button>'; }).join('') + '</div>';
  h += '<div class="card"><h3>Google Sheet connection</h3><div class="field"><label for="surl">Apps Script web app URL</label>' +
    '<input id="surl" value="' + esc(apiUrl()) + '" style="font-family:var(--f-mono);font-size:12px"></div>' +
    '<div class="field" style="margin-top:10px"><label for="skey">Access key (kept only in this browser)</label>' +
    '<input id="skey" type="password" autocomplete="off" value="' + esc(apiKey()) + '" style="font-family:var(--f-mono);font-size:12px"></div>' +
    '<div class="actions" style="justify-content:flex-start;margin-top:10px"><button class="btn primary" data-act="saveurl">Save &amp; reload</button><button class="btn" data-act="ping">Test connection</button><button class="btn" data-act="reload">Reload data</button></div>' +
    '<div id="pingOut" class="soon" style="margin-top:8px"></div></div>';
  h += '<div class="card"><h3>Base44</h3><p class="soon" style="margin:0">Switched over on 05.11.2026: FlowFin is where transactions are added and edited. ' +
    'The hourly pull from Base44 is stopped (stopHourlySync in Apps Script), so nothing from Base44 overwrites your changes.</p></div>';
  h += importHTML();
  h += rulesHTML();
  h += '<div class="card"><h3>Foreign card payments</h3><div class="bedit" style="padding-top:0">' +
    '<div class="field"><label for="sfee">Card fee on foreign currency (%)</label><input id="sfee" type="number" step="0.05" min="0" value="' + cardFeePct() + '"></div>' +
    '<button class="btn" data-act="savefee">Save</button></div><p class="soon" style="margin:10px 0 0;font-size:13px">Added to the CHF amount when you enter a foreign-currency payment and tick “Add card fee”. Rates are the ECB reference rates for the transaction date.</p></div>';
  h += '<div class="card"><h3>Data in the Sheet</h3><div>' + TABLES.map(function (t) {
    return '<div class="rowline"><span>' + t + '</span><span class="num">' + (t === 'Category' && !UI.catTable ? 'tab not found' : (DATA[t] || []).length) + '</span></div>';
  }).join('') + '</div><p class="soon" style="margin:12px 0 0">Period runs from day ' + START_DAY + ' to day ' + (START_DAY - 1) + ' of the next month. ' +
    'Free cash uses your average salary and household cost over the last ' + HIST_MONTHS + ' periods.</p></div>';
  return h;
}
function rulesHTML() {
  var rules = sortedRules(), sugg = suggestedRules();
  var combos = [];
  Object.keys(CATEGORIES).forEach(function (c) { (subsOf(c).length ? subsOf(c) : ['']).forEach(function (sub) { combos.push([c + '|' + sub, c + (sub ? ' › ' + sub : '')]); }); });
  var h = '<div class="card"><h3>Rules<span class="r">fill in new transactions automatically</span></h3>' +
    '<p class="soon" style="margin:0 0 12px;font-size:13px">When a new description contains the match text, the category, subcategory, type and account are filled in. You can still change them before saving.</p>' +
    '<div class="ruleadd">' +
    '<div class="field"><label for="rmatch">Description contains</label><input id="rmatch" placeholder="e.g. Ricardo" autocomplete="off"></div>' +
    '<div class="field"><label for="rcs">Category</label><select id="rcs">' + combos.map(function (x) { return opt(x[0], x[1], ''); }).join('') + '</select></div>' +
    '<div class="field"><label for="rtype">Type</label><select id="rtype">' + opt('','Keep','') + TYPES.map(function (x) { return opt(x[0], x[1], ''); }).join('') + '</select></div>' +
    '<div class="field"><label for="racct">Account</label><select id="racct">' + opt('','Keep','') + ACCOUNTS.map(function (x) { return opt(x[0], x[1], ''); }).join('') + '</select></div>' +
    '<div class="field"><label for="rtags">Tag (optional)</label><input id="rtags" autocomplete="off"></div>' +
    '<button class="btn primary" data-act="radd">Add rule</button></div>';
  if (rules.length) {
    h += '<div style="margin-top:14px">' + rules.map(function (r) {
      return '<div class="rowline"><span>“' + esc(r.match) + '” <span class="sub">→ ' + ruleText(r) + '</span></span><button class="navlink" data-act="rdel" data-id="' + esc(r.id) + '">Remove</button></div>';
    }).join('') + '</div>';
  } else h += '<div class="empty" style="padding:14px 0">No rules yet. Start with the suggestions below.</div>';
  if (sugg.length) {
    h += '<div class="subhead" style="margin-top:18px"><b>Suggested from your history</b><button class="navlink" data-act="rsuggall">Add all ' + Math.min(sugg.length, 15) + '</button></div>' +
      sugg.slice(0, 15).map(function (r, i) {
        return '<div class="rowline"><span>“' + esc(r.match) + '” <span class="sub">' + r.n + '× → ' + ruleText(r) + '</span></span><button class="navlink" data-act="rsugg" data-i="' + i + '">Add</button></div>';
      }).join('');
  }
  return h + '</div>';
}
function saveSetting(key, value) {
  var r = (DATA.Settings || []).filter(function (x) { return x.key === key; })[0];
  return saveRow('Settings', Object.assign({}, r || {}, { key:key, value:value }));
}
function soonHTML() {
  var label = '';
  NAV.forEach(function (g) { g.items.forEach(function (it) { if (it[0] === UI.page) label = it[1]; }); });
  var counts = { budgets:'Budget', goals:'FinancialGoal', subscriptions:'Subscription', anomalies:'Transaction', monthly:'Transaction', wealth:'NetWorthEntry' };
  var n = (DATA[counts[UI.page]] || []).length;
  return topbar(label, false) + '<div class="card soon"><h3>Being rebuilt</h3>This page comes in a later checkpoint. Your data for it is already in the Sheet (' + n + ' ' + counts[UI.page] + ' rows).</div>';
}

export { settingsHTML, rulesHTML, saveSetting, soonHTML };
