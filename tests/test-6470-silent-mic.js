// test-6470-silent-mic.js
//
//     node tests/test-6470-silent-mic.js
//
// The game's microphone indicator says MIC SILENT when the launcher's
// microphone gives nothing but digital silence while push to talk is held
// (#6470).
//
// Measured from the 71 launcher log sets testers sent since 18 Nov 2026: in
// the 19 Nov Dev playtest that reproduced one way voice, one PC's Windows
// communications microphone was a headset's "Game" endpoint. It peaked at
// 6.7e-11 over more than 5,000 held frames, the launcher sent every one,
// and the other PC decoded only Opus silence. The capsule lights from push
// to talk, so it was lit on both sides and nobody was told.
//
// This checks:
//
//   F  the plugin hands the status file's fifth word to the page, and a
//      four word line from an older launcher reads as not silent
//   D  the REAL page, in a sandbox, draws MIC SILENT in its own colour when
//      the launcher says so, held or not, and draws the range word again
//      when the microphone carries sound; the relay's own answer carries it
//      the same way
//   N  no microphone at all is still LISTENING ONLY, never MIC SILENT
//
// Read only. Never connects to anything.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const PAGE = fs.readFileSync(path.join(ROOT, 'game', 'ui', 'thornswood-voice.js'), 'utf8').split(CR).join('');
const PLUGIN = fs.readFileSync(path.join(ROOT, 'game', 'plugins', 'thornswood-voice.js'), 'utf8').split(CR).join('');

// ------------------------------------------------------------------ F --
// The plugin is a module with its own requires. Rather than stand up all of
// it, the status handler's own text is taken out and run against a stand-in
// readStatusFile and js, which is what it reads and what it calls.
const start = PLUGIN.indexOf("sp.on('update', guard('status'");
const end = PLUGIN.indexOf('}));', start);
yes('F the plugin still has its status handler', start > 0 && end > start);
const body = PLUGIN.slice(start, end + 4);

function runStatus(line) {
  const sent = [];
  let fn = null;
  const box = {
    sp: { on: function (ev, f) { fn = f; } },
    guard: function (name, f) { return f; },
    refreshChannel: function () { },
    readStatusFile: function () { return line; },
    js: function (s) { sent.push(s); },
    once: function () { },
    Date: Date, Number: Number,
    lastStatusSeen: '', statusCheckedAt: 0, STATUS_FILE: 'voice-status.txt'
  };
  vm.createContext(box);
  vm.runInContext('var lastStatusSeen = ""; var statusCheckedAt = 0;\n' + body, box);
  if (fn) fn();
  return sent.join('\n');
}

{
  const silent = runStatus('1 2 1 local 1');
  yes('F a fifth word of 1 reaches the page as silent', /setLauncherStatus\(true,2,true,"local",true\)/.test(silent));
  const sound = runStatus('1 2 1 local 0');
  yes('F a fifth word of 0 reaches the page as not silent', /setLauncherStatus\(true,2,true,"local",false\)/.test(sound));
  const old = runStatus('1 0 0 yell');
  yes('F a four word line from an older launcher reads as not silent', /setLauncherStatus\(true,0,false,"yell",false\)/.test(old));
}

// ------------------------------------------------------------------ D --
function page(fetchAnswer) {
  const made = [];
  const el = function (tag) {
    const e = { tag: tag, style: {}, className: '', innerHTML: '', appendChild: function () { }, setAttribute: function () { } };
    made.push(e);
    return e;
  };
  const timers = [];
  const win = {
    thornswoodNet: { post: function () { return true; }, on: function () { }, board: function () { },
                     peer: function () { return 1; }, noVoice: function () { } },
    skyrimPlatform: { sendMessage: function () { } }
  };
  const sandbox = {
    window: win,
    document: { getElementById: function () { return null; }, createElement: el,
                body: { appendChild: function () { } }, head: { appendChild: function () { } },
                querySelector: function () { return null; } },
    navigator: {}, location: { href: 'file:///x' },
    Audio: function () { return { play: function () { return Promise.resolve(); } }; },
    setInterval: function (f) { timers.push(f); return timers.length; }, clearInterval: function () { },
    setTimeout: function () { return 0; }, clearTimeout: function () { },
    console: { log: function () { } },
    fetch: function () {
      if (!fetchAnswer) return Promise.reject(new Error('no network here'));
      return Promise.resolve({ json: function () { return Promise.resolve(fetchAnswer()); } });
    },
    Promise: Promise, Map: Map, Math: Math, Number: Number, String: String, JSON: JSON,
    Date: Date, Object: Object, Array: Array, isFinite: isFinite
  };
  vm.createContext(sandbox);
  vm.runInContext(PAGE, sandbox);
  function mic() { return made.filter(function (e) { return e.id === 'thornswood-mic'; })[0]; }
  return { V: win.thornswoodVoice, mic: mic, timers: timers };
}

function word(box) {
  const m = /<span class="tw-word" style="color:([^"]+)">([^<]*)<\/span>/.exec(box ? box.innerHTML : '');
  return m ? { colour: m[1], text: m[2] } : { colour: '', text: '' };
}

{
  const p = page();
  p.V.setLauncherStatus(true, 1, false, 'local', false);
  const ready = word(p.mic());
  yes('D a microphone with sound draws the range word', ready.text !== '' && ready.text !== 'MIC SILENT' && ready.text !== 'LISTENING ONLY');

  p.V.setLauncherStatus(true, 1, true, 'local', true);
  const held = word(p.mic());
  yes('D held and silent draws MIC SILENT', held.text === 'MIC SILENT');
  yes('D in a colour of its own, not the range colour or the ready grey',
      held.colour !== '' && held.colour !== ready.colour && held.colour !== '#cdc6b8');

  p.V.setLauncherStatus(true, 1, false, 'local', true);
  yes('D it stays MIC SILENT once push to talk is let go', word(p.mic()).text === 'MIC SILENT');

  p.V.setLauncherStatus(true, 1, true, 'local', false);
  const back = word(p.mic());
  yes('D sound again draws the range word again', back.text === ready.text);
}

{
  // The loopback relay's answer is the other route the state arrives by.
  let answer = { mic: true, silent: true, peers: 1, talking: true };
  const p = page(function () { return answer; });
  p.V.setLauncherPort(47780);
  const ticks = p.timers.slice();
  ticks.forEach(function (f) { try { f(); } catch (e) { } });
  setImmediate(function () {
    setImmediate(function () {
      yes('D the relay\'s own answer carries silent the same way', word(p.mic()).text === 'MIC SILENT');

      // ------------------------------------------------------------ N --
      const q = page();
      q.V.setLauncherStatus(false, 0, false, 'local', true);
      yes('N no microphone at all is LISTENING ONLY, never MIC SILENT', word(q.mic()).text === 'LISTENING ONLY');

      console.log('');
      console.log(pass + ' passed, ' + fail + ' failed');
      process.exit(fail ? 1 : 0);
    });
  });
}
