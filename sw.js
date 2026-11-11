// FlowFin service worker: makes the app installable and opens offline with the last loaded version.
// Only the app's own files are cached. Data calls to Apps Script and exchange rates always go to the network.
var CACHE = 'flowfin-v5';
var FILES = ['./', './index.html', './manifest.webmanifest', './icon.svg', './css/app.css', './js/anomalies.js', './js/api.js', './js/bin.js', './js/budgets.js', './js/charts.js', './js/config.js', './js/core.js', './js/dashboard.js', './js/goals.js', './js/import.js', './js/jobs.js', './js/main.js', './js/monthly.js', './js/nav.js', './js/recurring.js', './js/settings.js', './js/transactions.js', './js/wealth.js'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); })); self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }));
  self.clients.claim();
});
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;   // never touch data or CDN requests
  // network first, so a new version shows up straight away; cache as the offline fallback
  // the page, its scripts and styles are fetched with a unique address, so GitHub's servers can't hand back
  // an older saved copy (all files must come from the same version, or the modules won't fit together)
  var isApp = e.request.mode === 'navigate' || /\/(index\.html)?$/.test(url.pathname) || /\.(js|css)$/.test(url.pathname);
  var req = isApp ? new Request(url.origin + url.pathname + '?fresh=' + Date.now(), { cache:'no-store' }) : e.request;
  e.respondWith(fetch(req, { cache:'no-store' }).then(function (res) {
    var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); return res;
  }).catch(function () { return caches.match(e.request).then(function (r) { return r || caches.match('./index.html'); }); }));
});
