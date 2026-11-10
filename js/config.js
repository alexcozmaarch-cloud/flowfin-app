// FlowFin · settings and shared state. A classic script (not a module) loaded before js/main.js,
// so these stay plain globals every module can read and update (Holotrack rule: state declared first).
// ─── Module-level state: declared before the IIFE (Holotrack rule) ───────────
var API_DEFAULT = 'https://script.google.com/macros/s/AKfycbwLF5qwgGlH6lfdGfleNTkDhvJfIRhzHV7uQ7NjhZ3MqsINq25QGp9wVhWeWO7veicH6A/exec';
var URL_KEY = 'ff_url_v1';
var CACHE_KEY = 'ff_cache_v1';
var KEY_KEY = 'ff_key_v1';
var _cache = null;                         // last good data payload (also in localStorage)
var TABLES = ['Transaction','Rule','Budget','CategorySettings','FundAllocation','FinancialGoal','GoalContribution','Subscription','NetWorthEntry','AssetSnapshot','Settings','Category'];
var DATA = {};                              // table name → rows
var UI = { page:'dashboard', periodOffset:0, sync:'idle', syncMsg:'', lastSync:null,
           tx:{ scope:'period', q:'', type:'', category:'', account:'', sub:'', from:'', to:'', tag:'', dayToDay:false } };
var CHARTS = {};
var START_DAY = 10;
var EXPECTED_HOUSEHOLD_EXPENSE = 6700;
var BENCHMARK_SALARY = 8500, BENCHMARK_INFRA = 6700;
var HIST_MONTHS = 6;
var WEALTH_CATS = { 'Financial Investing':1, 'Collectibles':1, 'Retirement 3a':1 };
var CATEGORIES = {
  'Family Infrastructure':['Mortgage','Utilities','Groceries','Insurance','Transportation','Childcare','Activities','Vacations','General Household'],
  'Personal Cash':['Lunches','Dinners','Drinks','Coffees','Snacks','Transportation','Hobbies','Subscriptions','Entertainment','Presents','Cash','Extras'],
  'Retirement 3a':[],
  'Financial Investing':['ETF Investing','Forex Investing','Funds'],
  'Collectibles':['TCG Investing']
};
// The list above is the starting point. Once the Sheet has a Category tab, the categories come from there
// (CATEGORIES is refilled in place on every load), and new subcategories are saved there too.
var BUILTIN_CATEGORIES = JSON.parse(JSON.stringify(CATEGORIES));
var CAT_COLOR = { 'Family Infrastructure':'var(--c-infra)', 'Personal Cash':'var(--c-personal)', 'Retirement 3a':'var(--c-3a)', 'Financial Investing':'var(--c-fin)', 'Collectibles':'var(--c-coll)' };
// Line icons as in Base44 (Lucide set, same subcategory mapping), coloured by category, no background
var SUB_ICON = { 'Mortgage':'house', 'Utilities':'zap', 'Groceries':'shopping-cart', 'Insurance':'shield', 'Transportation':'car', 'Childcare':'baby',
  'Activities':'trophy', 'Vacations':'plane', 'General Household':'wrench', 'Lunches':'salad', 'Dinners':'utensils', 'Drinks':'beer', 'Coffees':'coffee',
  'Snacks':'popcorn', 'Hobbies':'palette', 'Subscriptions':'smartphone', 'Entertainment':'clapperboard', 'Presents':'gift', 'Cash':'banknote',
  'Extras':'shopping-bag', 'ETF Investing':'trending-up', 'Forex Investing':'arrow-left-right', 'TCG Investing':'layers', 'Funds':'wallet' };
var CAT_ICON = { 'Holidays':'plane', 'Family Infrastructure':'house', 'Personal Cash':'wallet', 'Retirement 3a':'landmark', 'Financial Investing':'trending-up', 'Collectibles':'layers' };
var CAT_TINT = { 'Family Infrastructure':'#2563EB', 'Personal Cash':'#D97706', 'Retirement 3a':'#7C3AED', 'Financial Investing':'#059669', 'Collectibles':'#E11D48' };
var ACCT_ICON = { current_account:'landmark', savings_account:'piggy-bank', investment_account:'trending-up', third_pillar:'landmark', private_pension:'user', tcg_investments:'layers',
  real_estate:'house', vehicle:'car', loan:'credit-card', mortgage:'house', credit_card_debt:'credit-card', other_liability:'credit-card' };
var TYPES = [['expense','Expense'],['income','Income'],['refund','Refund'],['investment','Investment']];
var ACCOUNTS = [['credit_card','Credit card'],['debit_card','Debit card']];
var NAV = [
  { label:'Overview', items:[['dashboard','Dashboard'],['transactions','Transactions']] },
  { label:'Planning', items:[['budgets','Budgets'],['goals','Goals']] },
  { label:'Analysis', items:[['monthly','Monthly']] },
  { label:'Wealth',   items:[['wealth','Wealth & Assets']] },
  { label:'App',      items:[['settings','Settings']] }
];
var APP_VERSION = '10.11.2026 · 5';   // shown in Settings so you can check the phone has the latest
var MOBILE_NAV = [['dashboard','Home'],['transactions','Spend'],['budgets','Budgets'],['add','+'],['goals','Goals'],['monthly','Monthly'],['wealth','Wealth']];
var BUILT = { dashboard:1, transactions:1, budgets:1, goals:1, subscriptions:1, anomalies:1, monthly:1, wealth:1, settings:1 };
