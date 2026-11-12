// test-overlay-redraw.js
//
// The party strip and the voice microphone stop rewriting themselves when
// nothing about them changed. Issue #963: less lag with the NPCs on.
//
// Both are in-game browser pages drawn over every frame. The party strip is
// redrawn five times a second for as long as somebody is in a party, and the
// microphone every 300 ms while anybody is connected. Each innerHTML write is
// a new node tree and a repaint of the browser layer, and in a party standing
// still, or with the microphone idle, not a letter of either changes.
//
// This runs the REAL party page in a sandbox with a small DOM and a fake
// voice feed, and the REAL drawMic lifted out of the voice page, and counts
// the writes: a minute of passes with nothing changing writes once, and a
// move or a change of microphone state still shows on the next pass.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const CR = String.fromCharCode(13);
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8').split(CR).join(''); }

// ---------------------------------------------------------------- a small DOM
let writes = 0;
function element(tag) {
  let html = '';
  const el = {
    tagName: tag, id: '', className: '', children: [], textContent: '',
    style: { cssText: '', display: '', opacity: '' },
    appendChild: function (c) { el.children.push(c); return c; },
    addEventListener: function () { }, removeEventListener: function () { },
    setAttribute: function () { }, querySelector: function () { return element('div'); },
    querySelectorAll: function () { return []; }, classList: { add: function () { }, remove: function () { }, toggle: function () { } }
  };
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return html; },
    set: function (v) { writes++; html = String(v); }
  });
  return el;
}

// ---------------------------------------------------------- the party strip
const timers = [];
const feed = { 1: { name: 'Me', pos: [0, 0, 0], angleZ: 0, cell: 'c' },
               2: { name: 'Friend', pos: [700, 700, 0], angleZ: 0, cell: 'c' } };
const window = {
  thornswoodVoice: { who: function () { return feed; } },
  skyrimPlatform: { sendMessage: function () { } }
};
const document = {
  head: element('head'), body: element('body'),
  createElement: element, getElementById: function () { return null; },
  addEventListener: function () { }, querySelector: function () { return null; }
};
const sandbox = {
  window: window, document: document, console: { log: function () { }, error: function () { } },
  setInterval: function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; },
  clearInterval: function () { }, setTimeout: function () { return 0; }, clearTimeout: function () { },
  Date: Date, Math: Math, JSON: JSON
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
let loadErr = null;
try { vm.runInContext(read('game/ui/thornswood-party.js'), sandbox, { filename: 'thornswood-party.js' }); }
catch (e) { loadErr = e; }
yes('the party page loads in the sandbox' + (loadErr ? ' (' + loadErr.message + ')' : ''), !loadErr);

const P = window.thornswoodParty;
yes('and hands over setWhere and setData', !!P && typeof P.setWhere === 'function');
if (P) {
  P.setData({ me: 1 });
  P.setWhere([{ n: 'Friend', id: 0xff000002 }]);
  const strip = timers.filter(function (t) { return t.ms === 200; })[0];
  yes('the strip redraws on a 200 ms timer', !!strip);
  if (strip) {
    writes = 0;
    for (let i = 0; i < 300; i++) { strip.fn(); }          // a minute, standing still
    yes('a minute of passes with nobody moving rewrites the strip no times (' + writes + ', was 300)',
        writes === 0);
    feed[2] = { name: 'Friend', pos: [7000, 700, 0], angleZ: 0, cell: 'c' };
    strip.fn();
    yes('and a friend who moves shows on the next pass', writes === 1);
    strip.fn();
    yes('once', writes === 1);
  }
}

// ------------------------------------------------------------ the microphone
const vsrc = read('game/ui/thornswood-voice.js');
const a = vsrc.indexOf('  function drawMic() {');
const b = a < 0 ? -1 : vsrc.indexOf('\n  }', a);
yes('the voice page still has drawMic', a >= 0 && b > a);
if (a >= 0 && b > a) {
  const body = vsrc.slice(a, b + 4);
  const box = element('div');
  const st = { relay: false, mic: true, talking: false };
  const make = new Function('st', 'box',
    'function micOverlay() { return box; }' +
    'function inRelay() { return st.relay; }' +
    'var relay = {};' +
    'function micSvg(c) { return "<svg data-c=\\"" + c + "\\"></svg>"; }' +
    'function modeOf() { return { label: "push to talk" }; }' +
    'var myMode = "ptt", micError = null;' +
    'Object.defineProperty(this, "x", { value: 1 });' +
    'var self = { get mic() { return st.mic; }, get talking() { return st.talking; } };' +
    body.replace(/\bmic\b(?!Svg|Overlay|Error)/g, 'self.mic').replace(/\btalking\b/g, 'self.talking') +
    '\nreturn drawMic;');
  const drawMic = make(st, box);
  drawMic();
  writes = 0;
  for (let i = 0; i < 200; i++) { drawMic(); }             // a minute at 300 ms
  yes('a minute of passes with the microphone idle rewrites it no times (' + writes + ', was 200)',
      writes === 0);
  st.talking = true;
  drawMic();
  yes('and pressing to talk shows at once', writes === 1 && box.className === 'tw-live' && box.style.opacity === '1');
  st.talking = false;
  drawMic();
  yes('and letting go too', writes === 2 && box.className === '' && box.style.opacity === '0.72');
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
