// Runs every automated check. Exit code 1 if anything fails.
'use strict';
var h = require('./harness');
(async function () {
  var suites = [require('./app.test.js')];
  try { suites.push(require('./extra.test.js')); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  for (var s of suites) await s();
  // checks against the real data run only where that data exists (never in the public repo)
  try { await require('./parity.local.js')(); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  await h.closeBrowser();
  var bad = h.results.filter(function (r) { return !r[0]; });
  console.log('\n' + (h.results.length - bad.length) + ' passed, ' + bad.length + ' failed');
  process.exit(bad.length ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
