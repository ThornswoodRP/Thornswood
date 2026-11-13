// test-voice-lock.js
//
// O locks the microphone open until it is pressed again.
//
// Patrick, 27 September: "I want a key you can press that will lock voice so
// like when a bard sings they don't have to hold the key down or put
// something heavy on their keyboard".
//
// WHAT THIS RUNS. The real key handler out of thornswood-voice.js, with
// talkingNow, sendTalking and letterOf, over a pretend game. What reaches the
// launcher is the push to talk file, so that is what is read: the last line
// written, "1 local" for talking.
//
// Read only.
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'game', 'plugins', 'thornswood-voice.js'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function span(start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a);
  return b < 0 ? null : src.slice(a, b + end.length);
}

const lockDefault = /^let LOCK_KEY = (\d+);/m.exec(src);
yes('the lock key is O by default', !!lockDefault && Number(lockDefault[1]) === 24);
yes('and VoiceLockKey in Thornswood.ini moves it', /LOCK_KEY = grab\('VoiceLockKey', LOCK_KEY\);/.test(src));

const handler = span("sp.on('buttonEvent', guard('keys', (e) => {", '\n}));\n');
const letter = span('function letterOf(code) {', '\n}\n');
const send = span('function sendTalking() {', '\n}\n');
const now = span('function talkingNow() {', '}');
yes('the handler and its helpers are in the plugin', !!(handler && letter && send && now));

function rig(opt) {
  opt = opt || {};
  const w = { files: [], pageTalking: [], notes: [], handlers: {} };
  const sp = {
    on: function (n, f) { (w.handlers[n] = w.handlers[n] || []).push(f); },
    Debug: { notification: function (t) { w.notes.push(t); } }
  };
  globalThis.Thornswood = { isTyping: function () { return !!opt.typing; } };
  const body =
    'let PTT_KEY = 47, MODE_KEY = 48, LOCK_KEY = ' + (opt.lock || 24) + ';\n' +
    'let phase = 1, myMode = "local", pttHeld = false, voiceLocked = false, lastPttWritten = "";\n' +
    "const MODE_ORDER = ['whisper', 'local', 'yell'];\n" +
    'function once() {}\nfunction log() {}\n' +
    'function writePtt(on) { const l = (on ? "1" : "0") + " " + myMode; if (l === lastPttWritten) { return; } lastPttWritten = l; files.push(l); }\n' +
    'function js(s) { const m = /setTalking\\((true|false)\\)/.exec(s); if (m) { page.push(m[1] === "true"); } return true; }\n' +
    now + '\n' + letter + '\n' + send + '\n' + handler;
  new Function('sp', 'guard', 'files', 'page', body)(sp, function (n, f) { return f; }, w.files, w.pageTalking);
  w.key = function (code, down) {
    (w.handlers.buttonEvent || []).forEach(function (f) { f({ code: code, isDown: down, isUp: !down }); });
  };
  w.tap = function (code) { w.key(code, true); w.key(code, false); };
  w.talking = function () { return /^1 /.test(w.files[w.files.length - 1] || ''); };
  return w;
}

if (handler && letter && send && now) {
  {
    const w = rig();
    w.tap(24);
    yes('O opens the microphone and it stays open after O is let go', w.talking());
    yes('the page\'s microphone icon is told', w.pageTalking[w.pageTalking.length - 1] === true);
    yes('the corner of the screen says so and names the key: "' + w.notes[0] + '"',
        /Microphone locked open\. Press O again/.test(w.notes[0] || ''));
    w.tap(47);
    yes('pressing and letting go of V while locked leaves it open', w.talking());
    w.tap(48);
    yes('changing whisper, talk or yell while locked keeps it open, in the new range',
        w.talking() && /^1 yell$/.test(w.files[w.files.length - 1]));
    w.tap(24);
    yes('O again closes it', !w.talking() && w.pageTalking[w.pageTalking.length - 1] === false);
    yes('and says so', w.notes[w.notes.length - 1] === 'Microphone closed.');
  }
  {
    const w = rig();
    w.key(47, true);
    yes('push to talk still works: V held is talking', w.talking());
    w.key(47, false);
    yes('and V let go is not', !w.talking());
  }
  {
    const w = rig({ typing: true });
    w.tap(24);
    yes('an o typed into the chat is a letter, not the lock', w.files.length === 0 && w.notes.length === 0);
  }
  {
    // Issue 898: V held when the chat box takes the keyboard. The fork's
    // DInputHook now hands the game V's key up (the game held V), so it
    // reaches this handler while the box has the keyboard, and it has to
    // close the microphone rather than be taken for typing.
    const opt = {};
    const w = rig(opt);
    w.key(47, true);
    yes('V held before the chat box opens is talking', w.talking());
    opt.typing = true;
    w.key(47, false);
    yes('V let go while the chat box has the keyboard stops talking', !w.talking());
    w.key(47, true);
    yes('and a v typed into the box does not start it again', !w.talking());
    w.key(47, false);
    opt.typing = false;
  }
  {
    const w = rig({ lock: 59 });
    w.tap(59);
    yes('rebound to a key with no letter, the notice still reads', /Press the lock key again/.test(w.notes[0] || ''));
  }
}
delete globalThis.Thornswood;

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
