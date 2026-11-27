'use strict';
/*
  test-4773-mic-indicator.js

      node game/tests/test-4773-mic-indicator.js

  Issue #4773. The microphone indicator worked out "live" on its own rules.
  While staff had you silenced, holding push to talk still pulsed it as if
  your voice was going out; with push to talk off it sat at resting while
  the microphone was open. A silenced person was never shown that their
  voice was not going out.

  This runs the real game page (game/ui/thornswood-voice.js) in a sandbox
  with a fake browser, and reads the indicator it draws and the microphone
  track it enables, both in the page's own voice and in relay mode, where
  the launcher has the microphone. One line is added before the page's last
  close so the harness can hand it a microphone and a silence; the file on
  disk is not touched.

  Read only. Never connects to anything.
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }

const ROOT = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
const ME = 7;

function page() {
  let src = fs.readFileSync(path.join(ROOT, 'game', 'ui', 'thornswood-voice.js'), 'utf8').split(CR).join('');
  const end = src.lastIndexOf('})();');
  const hook = '  window.__t = { cfg: cfg, hush: function (on) { noteHush(cfg.profileId, on); applyMic(); }, ' +
               'setMic: function (m) { mic = m; micError = ""; applyMic(); }, applyMic: applyMic };\n';
  src = src.slice(0, end) + hook + src.slice(end);
  const made = [];
  const el = function () {
    const e = { style: {}, className: '', innerHTML: '', appendChild: function () { }, setAttribute: function () { } };
    made.push(e);
    return e;
  };
  const doc = {
    getElementById: function () { return null; },
    createElement: el,
    body: { appendChild: function () { } }, head: { appendChild: function () { } },
    querySelector: function () { return null; }
  };
  const win = { skyrimPlatform: { sendMessage: function () { } } };
  const sandbox = {
    window: win, document: doc, navigator: {}, location: { href: 'file:///x' },
    setInterval: function () { return 0; }, clearInterval: function () { },
    setTimeout: function () { return 0; }, clearTimeout: function () { },
    console: { log: function () { } },
    fetch: function () { return Promise.reject(new Error('no')); },
    Promise: Promise, Map: Map, Math: Math, Number: Number, String: String, JSON: JSON,
    Date: Date, Object: Object, Array: Array, isFinite: isFinite
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const t = win.__t;
  t.cfg.profileId = ME;
  // The indicator is the element the page gave its id.
  return {
    V: win.thornswoodVoice, t: t,
    mic: function () {
      const b = made.filter(function (e) { return e.id === 'thornswood-mic'; })[0];
      return b ? { live: b.className === 'tw-live', word: (/<span[^>]*>([^<]*)<\/span>/.exec(b.innerHTML) || [])[1] || '' } : null;
    }
  };
}

function track() { return { enabled: null, stop: function () { } }; }
function stream(tr) { return { getAudioTracks: function () { return [tr]; }, getTracks: function () { return [tr]; } }; }

// ------------------------------------------------ the page's own microphone
{
  const g = page();
  yes('the game\'s page loads', !!(g.V && g.t));
  const tr = track();
  g.t.setMic(stream(tr));
  let m = g.mic();
  yes('push to talk, key up: resting, and the microphone sends nothing',
      !!m && !m.live && m.word !== 'SILENCED' && tr.enabled === false);

  g.V.setTalking(true);
  m = g.mic();
  yes('push to talk, key down: live, and the microphone sends', m.live && tr.enabled === true);

  g.t.hush(true);
  m = g.mic();
  yes('silenced with the key down: not live, and the microphone sends nothing', !m.live && tr.enabled === false);
  yes('and the indicator says SILENCED', m.word === 'SILENCED');

  g.t.hush(false);
  m = g.mic();
  yes('the silence lifted with the key still down: live again', m.live && tr.enabled === true && m.word !== 'SILENCED');
  g.V.setTalking(false);

  // Push to talk off: the microphone is open with no key held.
  g.t.cfg.pushToTalk = false;
  g.t.applyMic();
  m = g.mic();
  yes('push to talk off: the microphone is open and the indicator is live, not resting',
      tr.enabled === true && m.live);

  g.t.hush(true);
  m = g.mic();
  yes('push to talk off and silenced: not live, SILENCED, and nothing sent',
      !m.live && m.word === 'SILENCED' && tr.enabled === false);
}

// ------------------------------------------------ the launcher's microphone
{
  const g = page();
  // The launcher's state as the plugin pushes it: mic ready, 2 peers, not sending.
  g.V.setLauncherStatus(true, 2, false, 'local', false);
  let m = g.mic();
  yes('relay, key up: resting', !!m && !m.live && m.word !== 'SILENCED');

  g.V.setTalking(true);
  m = g.mic();
  yes('relay, key down: live before the launcher answers', m.live);

  g.t.hush(true);
  g.V.setLauncherStatus(true, 2, false, 'local', false);   // the launcher leaves a silence out
  m = g.mic();
  yes('relay, silenced with the key down: not live, and SILENCED', !m.live && m.word === 'SILENCED');

  g.t.hush(false);
  g.V.setLauncherStatus(true, 2, true, 'local', false);
  m = g.mic();
  yes('relay, the silence lifted: live, and the word is the mode again', m.live && m.word !== 'SILENCED');

  // The voice lock with the key let go: the launcher says it is sending.
  g.V.setTalking(false);
  g.V.setLauncherStatus(true, 2, true, 'local', false);
  m = g.mic();
  yes('relay, sending with no key held (the lock): live', m.live);
}

// ------------------------------------------------ one test for both
{
  const src = fs.readFileSync(path.join(ROOT, 'game', 'ui', 'thornswood-voice.js'), 'utf8');
  const a = src.indexOf('  function drawMic() {');
  const b = src.indexOf('\n  }', a);
  const draw = src.slice(a, b);
  const c = src.indexOf('  function applyMic() {');
  const apply = src.slice(c, src.indexOf('\n  }', c));
  yes('the indicator and the microphone both read voiceOut()',
      /voiceOut\(\)/.test(draw) && /voiceOut\(\)/.test(apply) && !/talking/.test(draw.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
