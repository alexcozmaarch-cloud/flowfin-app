// FlowFin · Settings → "Say it (test)": try voice input on this phone before it goes into the add form.
// Shows whether the in-app microphone works here (home-screen app vs Safari) and what a sentence would fill in.
import { $, esc, txs } from './core.js';
import { sortedRules } from './transactions.js';
import { parseSpoken } from './voice.js';

function micKind() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }
function where() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone ? 'home-screen app' : 'browser'; }
function voiceCtx() { return { txs:txs(), rules:sortedRules(), categories:CATEGORIES, today:new Date() }; }

function voiceTestHTML() {
  return '<div class="card" id="voicetest"><h3>Say it · test</h3>' +
    '<p class="soon" style="margin:0 0 10px;font-size:13px">Say or type one sentence, e.g. “45 francs training shorts, sports, credit card”. Nothing is saved here: it only shows what the add form would fill in.</p>' +
    '<div class="vtrow"><input id="vttext" autocomplete="off" placeholder="Type, or tap the keyboard’s mic" aria-label="Sentence">' +
    '<button type="button" class="owebtn" data-act="vtmic" aria-label="Listen with the app’s microphone"><svg class="ic" aria-hidden="true"><use href="#i-mic"></use></svg></button></div>' +
    '<div id="vtStatus" class="soon" style="margin-top:8px;font-size:12px">In-app microphone here (' + where() + '): ' + (micKind() ? 'available, tap the mic to try' : '<span class="neg">not offered by this browser</span>; the keyboard’s mic still works') + '</div>' +
    '<div id="vtOut"></div></div>';
}
var LABEL = { amount:'Amount', description:'Description', category:'Category', account:'Account', date:'Date', tags:'Tags', owe:'Owes me', type:'Type' };
function voicePreview(text) {
  var out = $('vtOut'); if (!out) return;
  if (!String(text || '').trim()) { out.innerHTML = ''; return; }
  var r = parseSpoken(text, voiceCtx()), rows = [];
  rows.push(['Amount', r.amount ? r.amount + ' ' + (r.currency || 'CHF') : '<span class="neg">not heard</span>']);
  rows.push(['Description', esc(r.description) || '<span class="neg">not heard</span>']);
  rows.push(['Category', r.category ? esc(r.category) + (r.subcategory ? ' › ' + esc(r.subcategory) : '') + ' <span class="soon">· ' + ({ rule:'your rule', said:'you said it', history:'like “' + esc(r.like || '') + '”', word:'from the words' })[r.from] + '</span>' : '<span class="soon">usual default</span>']);
  rows.push(['Account', r.account ? (r.account === 'debit_card' ? 'Debit card' : 'Credit card') : '<span class="soon">usual</span>']);
  rows.push(['Date', r.date || '<span class="soon">today</span>']);
  if (r.tags.length) rows.push(['Tags', r.tags.map(function (t) { return '#' + esc(t); }).join(' ')]);
  if (r.owe) rows.push(['Owes me', esc(r.owe.who) + ' · ' + (r.owe.mode === 'other' ? r.owe.amount : r.owe.mode)]);
  out.innerHTML = '<dl class="vtgrid">' + rows.map(function (x) { return '<dt>' + x[0] + '</dt><dd>' + x[1] + '</dd>'; }).join('') + '</dl>';
}
var REC = null;
function startMic() {
  var st = $('vtStatus'), K = micKind();
  if (!K) { if (st) st.innerHTML = '<span class="neg">The in-app microphone isn’t offered here (' + where() + ').</span> Tap the text field and use the keyboard’s mic instead.'; return; }
  if (REC) { try { REC.stop(); } catch (e) {} REC = null; return; }
  var r = REC = new K(); r.lang = navigator.language || 'en-GB'; r.interimResults = true; r.continuous = false;
  var btn = document.querySelector('[data-act=vtmic]'); if (btn) btn.classList.add('on');
  // every step is written down, so a silent failure on the phone shows where it stops
  var steps = [], got = false, t0 = Date.now();
  function log(x) { steps.push(x + ' ' + ((Date.now() - t0) / 1000).toFixed(1) + 's'); if (st) st.innerHTML = 'Mic test (' + where() + ', ' + esc(r.lang) + '): ' + esc(steps.join(' → ')); }
  log('asked');
  ['start', 'audiostart', 'soundstart', 'speechstart', 'speechend', 'audioend'].forEach(function (ev) { r['on' + ev] = function () { log(ev); }; });
  r.onresult = function (e) { got = true; var t = ''; for (var i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; var f = $('vttext'); if (f) f.value = t; voicePreview(t); };
  r.onnomatch = function () { log('no match'); };
  r.onerror = function (e) { log('error: ' + (e.error || '?') + (e.message ? ' (' + e.message + ')' : '')); };
  r.onend = function () { REC = null; if (btn) btn.classList.remove('on'); log(got ? 'done ✓' : 'ended without words'); };
  setTimeout(function () { if (REC === r && !got) { log('nothing after 8s, stopped'); try { r.abort(); } catch (e) {} } }, 8000);
  try { r.start(); } catch (e) { REC = null; if (st) st.innerHTML = '<span class="neg">Could not start: ' + esc(e.message) + '</span>'; }
}
export { voiceTestHTML, voicePreview, startMic };
