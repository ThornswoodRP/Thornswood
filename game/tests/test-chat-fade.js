// test-chat-fade.js
//
// The chat hides a while after its last line and comes back for a new line or
// Enter, and the needs bars can be left off the screen.
//
// Patrick, 24 September: "can you make the default for the chat to hide after
// 10 seconds if the server sends a message or someone else or if you do and it
// come back when you hit enter and add an option in the launcher settings to
// make it 5, 10, 15, 20 or permeant like it is now." And: "also add an option
// in settings to hide the needs menu on the screen so it doesnt show and they
// can do /needs to find it all".
//
// Both are set on Settings in the game since #3126, and take effect at once:
// the front writes window.THORNSWOOD and calls thornswoodChat.settings().
//
// This runs the REAL thornswood-bridge.js in a sandbox with a small page and a
// clock it controls, and reads the REAL settings lines out of
// thornswood-front.js. Every line reaches the chat through thornswoodChat.add,
// the server's, somebody else's and your own alike, so add is what is driven.
//
//   node game/tests/test-chat-fade.js
//   BRIDGE=<file> FRONT=<file> node game/tests/test-chat-fade.js   (an older copy)
//
// Read only.
'use strict';
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BRIDGE = process.env.BRIDGE || path.join(REPO_DIR, 'game', 'ui', 'thornswood-bridge.js');
const FRONT = process.env.FRONT || path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ---- a page and a clock ------------------------------------------------------
function page(cfg) {
  const clock = { now: 1000000, timers: [], seq: 0 };
  function later(fn, ms, every) {
    const t = { id: ++clock.seq, fn: fn, at: clock.now + Math.max(0, ms || 0), every: every ? Math.max(1, ms || 1) : 0 };
    clock.timers.push(t);
    return t.id;
  }
  function cancel(id) { clock.timers = clock.timers.filter(t => t.id !== id); }
  function advance(ms) {
    const end = clock.now + ms;
    for (;;) {
      const due = clock.timers.filter(t => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) { break; }
      clock.now = due.at;
      if (due.every) { due.at += due.every; } else { cancel(due.id); }
      due.fn();
    }
    clock.now = end;
  }

  function classes() {
    const set = new Set();
    return {
      add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c),
      toString: () => Array.from(set).join(' ')
    };
  }
  function el(tag) {
    return {
      tagName: String(tag).toUpperCase(), id: '', style: {}, classList: classes(),
      textContent: '', parentNode: null, childNodes: [],
      focus: function () { doc.activeElement = this; },
      blur: function () { if (doc.activeElement === this) { doc.activeElement = doc.body; } },
      appendChild: function (n) { n.parentNode = this; this.childNodes.push(n); return n; }
    };
  }
  const listeners = [];
  const doc = {
    readyState: 'complete',
    documentElement: el('html'),
    head: el('head'),
    body: el('body'),
    activeElement: null,
    createElement: el,
    getElementById: function (id) { return id === 'chatInput' ? chatInput : null; },
    addEventListener: function (type, fn) { listeners.push({ type: type, fn: fn }); }
  };
  const chatInput = el('span');
  chatInput.id = 'chatInput';
  doc.activeElement = doc.body;

  const drawn = [];
  const win = {
    document: doc,
    console: { log: function () { } },
    setTimeout: function (fn, ms) { return later(fn, ms, false); },
    clearTimeout: cancel,
    setInterval: function (fn, ms) { return later(fn, ms, true); },
    clearInterval: cancel,
    Date: { now: function () { return clock.now; } },
    MutationObserver: function () { this.observe = function () { }; },
    addEventListener: function () { },
    skyrimPlatform: { sendMessage: function () { }, widgets: { set: function (l) { drawn.push(l); } } },
    JSON: JSON, Math: Math, Array: Array, String: String, Number: Number, Object: Object
  };
  win.window = win;
  if (cfg !== undefined) { win.THORNSWOOD = cfg; }
  vm.createContext(win);
  vm.runInContext(fs.readFileSync(BRIDGE, 'utf8'), win, { filename: 'thornswood-bridge.js' });

  const html = doc.documentElement;
  return {
    win: win, doc: doc, advance: advance,
    faded: () => html.classList.contains('thornswood-chat-faded'),
    needsHidden: () => html.classList.contains('thornswood-needs-hidden'),
    sheet: () => (doc.head.childNodes.find(n => n.id === 'thornswood-chat-trim') || {}).textContent || '',
    chat: win.thornswoodChat,
    key: function (key, code) {
      const e = { key: key, keyCode: code, shiftKey: false, stopPropagation: function () { }, preventDefault: function () { } };
      listeners.filter(l => l.type === 'keydown').forEach(l => l.fn(e));
    }
  };
}

// ---- the default, ten seconds --------------------------------------------------
{
  const p = page({ chatFade: 10 });
  yes('the bridge loads and gives the chat its hooks', !!p.chat && typeof p.chat.add === 'function');
  p.chat.show();
  yes('the chat is on screen when it goes up', !p.faded());
  p.advance(9900);
  yes('still there at 9.9 seconds with nothing said', !p.faded());
  p.advance(200);
  yes('and gone at ten', p.faded());

  p.chat.add('[Server] The gates close at dusk.');
  yes('a line from the server brings it straight back', !p.faded());
  p.advance(6000);
  p.chat.add([{ text: 'Aela: ', color: '#c6aa6d' }, { text: 'Over here.' }]);
  yes('a line from somebody else brings it back too', !p.faded());
  p.advance(9900);
  yes('and the clock starts again from that line (9.9 seconds after it)', !p.faded());
  p.advance(200);
  yes('gone ten seconds after the last line', p.faded());

  // Enter: the game side calls focusInput.
  p.chat.focusInput();
  yes('Enter brings it back', !p.faded());
  p.advance(15000);
  yes('and it stays while the box is open, even past ten seconds', !p.faded());
  p.chat.add('[Server] a line while typing');
  p.advance(4000);
  yes('a line arriving while typing does not hide it', !p.faded());
  // Sending: the Enter keydown in the capture listener shuts the box.
  p.key('Enter', 13);
  p.advance(0);
  yes('sending shuts the box', !p.win.thornswoodTyping);
  p.chat.add('Me: on my way');
  p.advance(9900);
  yes('your own line keeps it up for ten seconds', !p.faded());
  p.advance(200);
  yes('and then it goes', p.faded());

  p.chat.focusInput();
  p.advance(3000);
  p.key('Escape', 27);
  p.advance(0);
  yes('Escape shuts the box', !p.win.thornswoodTyping);
  p.advance(9900);
  yes('and the chat stays ten seconds after it', !p.faded());
  p.advance(200);
  yes('then goes', p.faded());

  const sheet = p.sheet();
  yes('the sheet hides the faded chat', /html\.thornswood-chat-faded #chat\{opacity:0 !important;visibility:hidden !important/.test(sheet));
}

// ---- the other choices ---------------------------------------------------------
for (const s of [5, 15, 20]) {
  const p = page({ chatFade: s });
  p.chat.show();
  p.chat.add('x');
  p.advance(s * 1000 - 100);
  const before = p.faded();
  p.advance(200);
  yes(s + ' seconds: up at ' + (s - 0.1) + ', gone at ' + (s + 0.1), !before && p.faded());
}
{
  const p = page({ chatFade: 0 });
  p.chat.show();
  p.chat.add('x');
  p.advance(10 * 60 * 1000);
  yes('Never: still on screen ten minutes after the last line', !p.faded());
  p.chat.focusInput(); p.key('Enter', 13); p.advance(2000);
  p.advance(10 * 60 * 1000);
  yes('Never: and after a line is sent', !p.faded());
}
{
  const p = page(undefined);
  p.chat.show(); p.chat.add('x');
  p.advance(10100);
  yes('with no settings from the game, ten seconds', p.faded());
}
{
  const p = page({ chatFade: 7 });
  p.chat.show(); p.chat.add('x');
  p.advance(7100);
  const at7 = p.faded();
  p.advance(3000);
  yes('a number that is not a choice is ten', !at7 && p.faded());
}
{
  // The settings arrive after the page has loaded, which is how the game does
  // it: window.THORNSWOOD is written after the bridge is in.
  const p = page(undefined);
  p.win.THORNSWOOD = { chatFade: 0 };
  p.chat.show(); p.chat.add('x');
  p.advance(60000);
  yes('settings written after the page loaded are the ones used', !p.faded());
}

// ---- the needs bars ------------------------------------------------------------
{
  const p = page({ chatFade: 10, needsBars: false });
  p.chat.show();
  yes('needs bars off: hidden once the chat is up', p.needsHidden());
  yes('by a rule on #ts-hud, which the server rewrites', /html\.thornswood-needs-hidden #ts-hud\{display:none !important\}/.test(p.sheet()));
}
{
  const p = page({ chatFade: 10, needsBars: true });
  p.chat.show();
  yes('needs bars on: shown', !p.needsHidden());
}
{
  const p = page({ chatFade: 10 });
  p.chat.show();
  yes('no word from the launcher: shown, as before', !p.needsHidden());
}

// ---- changed on Settings in the game, at once (#3126) ---------------------------
{
  const p = page({ chatFade: 10, needsBars: true });
  yes('the chat page has settings() for a change made in the game', typeof p.chat.settings === 'function');
  p.chat.show();
  p.win.THORNSWOOD.needsBars = false;
  p.chat.settings();
  yes('needs bars hidden on Settings: gone at once', p.needsHidden());
  p.win.THORNSWOOD.needsBars = true;
  p.chat.settings();
  yes('and shown again: back at once', !p.needsHidden());
  p.win.THORNSWOOD.chatFade = 5;
  p.chat.settings();
  p.advance(5100);
  yes('chat fade set to 5 on Settings: the chat hides 5 seconds on, not 10', p.faded());
  p.chat.show();
  p.win.THORNSWOOD.chatFade = 0;
  p.chat.settings();
  p.advance(60000);
  yes('and set to Never: it stays', !p.faded());
}

// ---- the plugin reads Thornswood.ini ------------------------------------------
{
  const front = fs.readFileSync(FRONT, 'utf8').split(String.fromCharCode(13)).join('');
  const a = front.indexOf('  function chatFadeOf(text) {');
  const b = front.indexOf('let NEEDS_BARS = ');
  const end = b < 0 ? -1 : front.indexOf('\n', b);
  yes('thornswood-front.js reads ChatFade and NeedsBars', a >= 0 && b > a && end > b);
  if (a >= 0 && b > a && end > b) {
    const code = front.slice(a, end + 1);
    const read = function (ini) {
      return new Function('ini', code + '\nreturn [CHAT_FADE, NEEDS_BARS];')(ini);
    };
    const blank = read('ChatKey=28\n');
    yes('nothing set: ten seconds and the bars on', blank[0] === 10 && blank[1] === true);
    yes('ChatFade=0 is Never, not the default', read('ChatFade=0\n')[0] === 0);
    yes('ChatFade=5, 15 and 20 come through', read('ChatFade=5\n')[0] === 5 && read('ChatFade=15\n')[0] === 15 && read('ChatFade=20')[0] === 20);
    yes('ChatFade=7 is ten', read('ChatFade=7\n')[0] === 10);
    yes('NeedsBars=0 hides the bars', read('Fov=90\nNeedsBars=0\n')[1] === false);
    yes('NeedsBars=1 does not', read('NeedsBars=1\n')[1] === true);
    yes('the keys read in any case, as the launcher reads them', read('chatfade = 20\nneedsbars=0\n')[0] === 20 && read('needsbars=0\n')[1] === false);
  }
  yes('and hands both to the page in window.THORNSWOOD',
      /window\.THORNSWOOD='[\s\S]{0,400}chatFade: CHAT_FADE, needsBars: NEEDS_BARS/.test(front));
  yes('and after a change on Settings, again, with thornswoodChat.settings()',
      /c\.chatFade=' \+ CHAT_FADE \+[\s\S]{0,200}c\.needsBars=' \+ NEEDS_BARS[\s\S]{0,200}window\.thornswoodChat\.settings\(\)/.test(front));
  yes('and Settings is where they are changed: setSetting takes ChatFade and NeedsBars',
      /name === 'ChatFade'/.test(front) && /name === 'NeedsBars'/.test(front));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
