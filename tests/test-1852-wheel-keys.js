// test-1852-wheel-keys.js
//
// #1852. With the emote wheel open, G and Escape shut it, and the tap that
// opens the wheel does not also shut it.
//
// WHAT WAS WRONG. docs/systems/emotes.md says G opens the wheel and G closes
// it, and Escape closes it without playing anything. The page swallowed both
// keys and sent nothing, and the plugin's branches that would have closed it
// wait for a buttonEvent, which never comes while the wheel holds the
// keyboard: the fork hands the game no key down while the browser has focus
// (HeldKeyRelease, #898), and the page is the only thing that hears a key.
// So the open wheel shut on a click outside it, STOP or a pick, and not on G
// or Escape. Now the page sends __close on both, and on CloseKey's letter
// when CloseKey is moved to one, and the plugin closes it.
//
// THE TRAP. The note over LETTERS in the plugin: once, with the page closing
// on the open letter, one tap opened the wheel and shut it again. The fork's
// order is what keeps that from happening, and this plays it.
//
// THE PRETEND GAME. Every frame the keyboard is read the way the fork's
// FakeIDirectInputDevice8A::GetDeviceData reads it at the commit
// records/client-build.json names: the game's buffer first, then the whole
// keyboard as a snapshot, compared with the last snapshot whoever has focus
// (ProcessKeyboardData), each change handed to the page only while the
// browser has focus (OnKeyStateChange in main.cpp), and the buffer filtered
// by HeldKeyRelease for the game. The game's events are the plugins'
// buttonEvent. What the page sends reaches the plugin on a later frame, after
// that frame's read, the way AddTickTask hands it over. The page hears its
// keys at the end of the frame, after the plugin has acted on the same press,
// which is the worst order for the trap.
//
// The real plugin and the real page run in vm, wired to each other: the
// plugin's executeJavaScript runs in the page, and the page's sendMessage
// reaches the plugin's browserMessage.
//
// PAGE=<file> or PLUGIN=<file> runs it against another copy. Against the page
// as it was before this change, the checks that G and Escape close fail.
//
// Read only.
'use strict';
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const pluginPass = require('./fixtures/plugin-pass'); // front's whose-game check and the first tick, as the game does (#485)
const CR = String.fromCharCode(13);
function read(p) {
  return fs.readFileSync(path.isAbsolute(p) ? p : path.join(REPO_DIR, p), 'utf8').split(CR).join('');
}
const page = read(process.env.PAGE || path.join('game', 'ui', 'thornswood-emotes.js'));
const plugin = read(process.env.PLUGIN || path.join('game', 'plugins', 'thornswood-emotes.js'));
const doc = read(path.join('docs', 'systems', 'emotes.md'));
const serverAddress = JSON.parse(read(path.join('scripts', 'vps', 'vps.json'))).address;

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// DirectInput scan codes, and what the browser calls each key.
const ESC = 1, TAB = 15, Q = 16, G = 34, X = 45, F5 = 63;
const BROWSER = {
  1: { key: 'Escape', keyCode: 27 }, 15: { key: 'Tab', keyCode: 9 }, 16: { key: 'q', keyCode: 81 },
  34: { key: 'g', keyCode: 71 }, 45: { key: 'x', keyCode: 88 }, 63: { key: 'F5', keyCode: 116 }
};

// ------------------------------------------------------------ the page ----
// A stand-in document, just enough for the page to build its wheel.
function pageRig(sent) {
  const byId = {};
  const listeners = {};
  const d = {};
  function el(tag, id) {
    return {
      tagName: String(tag).toUpperCase(), id: id || '', className: '', style: {}, children: [],
      attrs: {}, own: {}, textContent: '', value: '', innerHTML: '', parentNode: null,
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); } return c; },
      get firstChild() { return this.children[0] || null; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      addEventListener(t, fn) { (this.own[t] = this.own[t] || []).push(fn); },
      querySelectorAll(selector) {
        // This fixture models search only; it is a native focusable input.
        return this.id === 'thornswood-wheel' && selector === 'input,button,[tabindex="0"]'
          ? [byId['thornswood-emote-find']] : [];
      },
      focus() { d.activeElement = this; },
      blur() { if (d.activeElement === this) { d.activeElement = d.body; } }
    };
  }
  d.head = el('head'); d.documentElement = el('html'); d.body = el('body');
  d.activeElement = d.body;
  d.createElement = function (t) { return el(t); };
  d.createElementNS = function (ns, t) { return el(t); };
  d.getElementById = function (id) { return byId[id] || (byId[id] = el('div', id)); };
  d.addEventListener = function (t, fn) { (listeners[t] = listeners[t] || []).push(fn); };
  const win = { skyrimPlatform: { sendMessage(a, b) { sent.push([a, b]); } } };
  const box = { window: win, document: d, console: { log() { } } };
  vm.createContext(box);
  vm.runInContext(page, box);
  const host = d.body.children.filter(function (c) { return c.id === 'thornswood-wheel'; })[0] || null;
  return {
    box: box, doc: d, find: byId['thornswood-emote-find'],
    shown() { return !!host && String(host.className).indexOf('gone') === -1; },
    keydown(code) {
      const b = BROWSER[code];
      const ev = { key: b.key, keyCode: b.keyCode, repeat: false, target: d.activeElement,
                   defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      (listeners.keydown || []).forEach(function (fn) { fn(ev); });
      return ev;
    }
  };
}

// ---------------------------------------------------------- the plugin ----
function pluginRig(ini, w) {
  const handlers = {};
  const io = {
    readFileSync(file) {
      if (/Thornswood\.ini$/.test(file)) { return ini; }
      if (/skymp5-client-settings\.txt$/.test(file)) { return JSON.stringify({ 'server-ip': serverAddress }); }
      if (/thornswood-session\.txt$/.test(file)) { return String(Date.now()); }
      throw new Error('absent');
    },
    appendFileSync() { }, writeFileSync() { }
  };
  const T = {
    ready: true, isTyping: function () { return false; }, setTyping() { },
    // The front's claim: the keyboard goes to the browser while anything holds it.
    claimFocus(who, on) {
      w.claims[who] = !!on;
      w.focus = Object.keys(w.claims).some(function (k) { return w.claims[k]; });
    },
    js(src) { vm.runInContext(src, w.page.box); return true; }
  };
  const actor = { getFormID: () => 0x14, isWeaponDrawn: () => false, sheatheWeapon() { },
                  getParentCell: () => null, getItemCount: () => 1 };
  const sp = {
    on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
    printConsole() { },
    Game: { getPlayer: () => actor, getFormFromFile: () => null },
    Utility: { isInMenuMode: () => false },
    browser: { isFocused: () => w.focus },
    TESModPlatform: { setWeaponDrawnMode() { } },
    hooks: { sendAnimationEvent: { add() { } } },
    Debug: { notification() { }, sendAnimationEvent(pc, ev) { w.played.push(ev); } }
  };
  const box = { skyrimPlatform: sp, Thornswood: T, require: () => io, Date: Date, JSON: JSON, Math: Math, Number: Number };
  vm.createContext(box);
  pluginPass.load(box, plugin, { filename: 'thornswood-emotes.js' });
  return { T: T, emit(name, ev) { (handlers[name] || []).forEach(function (fn) { fn(ev); }); } };
}

// ----------------------------------------------------------- the world ----
// feedPageAlways: a client that hands the page every key whether or not the
// browser has focus, which is what the page's note of 25 September said the
// client did. Only to show this rig would catch the trap.
function world(iniLines, opts) {
  opts = opts || {};
  const w = {
    focus: false, claims: {}, fingers: new Set(), buffer: [], snapWas: new Set(), held: new Set(),
    toBrowser: [], sent: [], told: [], pageHeard: [], gameHeard: [], played: []
  };
  w.page = pageRig(w.sent);
  const ini = '[Emotes]\n' + (iniLines || []).join('\n') + '\n';
  const P = pluginRig(ini, w);
  w.T = P.T;
  w.finger = function (code, down) {
    if (down) { w.fingers.add(code); } else { w.fingers.delete(code); }
    w.buffer.push({ code: code, down: down });
  };
  w.frame = function (between) {
    // GetDeviceData on the keyboard. The game's buffer is read first.
    const buf = w.buffer.splice(0);
    if (between) { between(); }
    // Then the whole keyboard, against the last read, whoever has focus.
    const codes = new Set(Array.from(w.fingers).concat(Array.from(w.snapWas)));
    codes.forEach(function (c) {
      const now = w.fingers.has(c);
      if (now === w.snapWas.has(c)) { return; }
      if (now) { w.snapWas.add(c); } else { w.snapWas.delete(c); }
      // OnKeyStateChange: to the page, and only while the browser has focus.
      if (w.focus || opts.feedPageAlways) { w.toBrowser.push({ code: c, down: now }); }
    });
    // HeldKeyRelease: all of it while the game listens; otherwise only the
    // key up of a key the game holds.
    const listening = !w.focus;
    const game = [];
    buf.forEach(function (ev) {
      let through;
      if (listening) {
        through = true;
        if (ev.down) { w.held.add(ev.code); } else { w.held.delete(ev.code); }
      } else {
        through = !ev.down && w.held.has(ev.code);
        if (through) { w.held.delete(ev.code); }
      }
      if (through) { game.push(ev); }
    });
    // The game's events are the plugins' buttonEvent.
    game.forEach(function (ev) {
      w.gameHeard.push((ev.down ? 'down ' : 'up ') + ev.code);
      P.emit('buttonEvent', { device: 0, code: ev.code, isDown: ev.down, isUp: !ev.down,
                              isRepeating: false, isHeld: false, heldDuration: 0 });
    });
    // What the page said on an earlier frame reaches the plugin now.
    w.sent.splice(0).forEach(function (m) {
      w.told.push(m[1]);
      P.emit('browserMessage', { arguments: [m[0], m[1]] });
    });
    P.emit('update');
    // And the page hears its keys last.
    w.toBrowser.splice(0).forEach(function (k) {
      w.pageHeard.push((k.down ? 'down ' : 'up ') + k.code);
      if (k.down) { w.page.keydown(k.code); }
    });
  };
  w.frames = function (n) { for (let i = 0; i < n; i++) { w.frame(); } };
  // A tap: down before one frame's read, held for some frames, then up.
  w.tap = function (code, held) {
    w.finger(code, true);
    w.frames(held || 4);
    w.finger(code, false);
    w.frames(3);
  };
  w.closes = function () { return w.told.filter(function (t) { return t === '__close'; }).length; };
  w.open = function () { return w.page.shown() && !!w.claims.wheel && w.focus; };
  w.shut = function () { return !w.page.shown() && !w.claims.wheel && !w.focus; };
  return w;
}
function heard(list, what) { return list.indexOf(what) >= 0; }

// ===================================================== A. the opening tap
{
  const w = world();
  w.frames(2);
  yes('A0 the page is in, says so, and draws nothing yet', heard(w.told, '__ready') && !w.page.shown());
  w.tap(G, 5);
  yes('A1 a tap of G opens the wheel and the wheel holds the keyboard', w.open());
  yes('A1 and the page heard G only coming up, never going down',
      heard(w.pageHeard, 'up ' + G) && !heard(w.pageHeard, 'down ' + G));
  yes('A1 so nothing asked to close it', w.closes() === 0);
  yes('A1 the game had G come up as well, and that did not shut it',
      heard(w.gameHeard, 'up ' + G) && w.page.shown());
}
{
  const w = world();
  w.frames(2);
  w.finger(G, true); w.finger(G, false);
  w.frames(4);
  yes('A2 a tap quicker than one frame opens it, and the page heard nothing of G',
      w.open() && w.closes() === 0 && !heard(w.pageHeard, 'down ' + G) && !heard(w.pageHeard, 'up ' + G));
}
{
  const w = world();
  w.frames(2);
  w.frame(function () { w.finger(G, true); });   // after the buffer, before the snapshot
  w.frames(4);
  w.finger(G, false);
  w.frames(3);
  yes('A3 G going down between the buffer and the snapshot opens it a frame later, and stays open',
      w.open() && w.closes() === 0 && !heard(w.pageHeard, 'down ' + G));
}
{
  const w = world();
  w.frames(2);
  w.finger(G, true);
  w.frames(90);                                   // held half a second and more
  w.finger(G, false);
  w.frames(3);
  yes('A4 G held a long time opens it once and leaves it open', w.open() && w.closes() === 0);
}
{
  // The same tap, on a client that feeds the page every key focused or not.
  const w = world([], { feedPageAlways: true });
  w.frames(2);
  w.tap(G, 5);
  yes('A5 the rig catches the trap: on a client that hands the page every key, that tap shuts the wheel again',
      !w.page.shown() && w.closes() === 1);
}

// =========================================================== B. closing
{
  const w = world();
  w.frames(2);
  w.tap(G, 5);
  const before = w.played.length;
  w.finger(G, true);
  w.frame();
  yes('B1 with the wheel open, G reaches the page going down and the page asks to close',
      heard(w.pageHeard, 'down ' + G) && w.sent.length === 1 && w.sent[0][0] === 'thornswood-emote' &&
      w.sent[0][1] === '__close');
  w.frames(4);
  w.finger(G, false);
  w.frames(4);
  yes('B1 and the plugin closes it and gives the keyboard back', w.shut());
  yes('B1 asked once, and nothing is played', w.closes() === 1 && w.played.length === before);
  yes('B1 the game never had G going down while the wheel was up, so G did not open it again',
      w.gameHeard.filter(function (g) { return g === 'down ' + G; }).length === 1);
  w.tap(G, 5);
  yes('B1 and the next tap of G opens it again', w.open() && w.closes() === 1);
}
{
  const w = world();
  w.frames(2);
  w.tap(G, 5);
  w.tap(ESC, 4);
  yes('B2 with the wheel open, Escape shuts it without playing anything',
      w.shut() && w.closes() === 1 && w.played.length === 0);
  yes('B2 and Escape never went down in the game, so the game\'s own menu did not open',
      !heard(w.gameHeard, 'down ' + ESC));
}
{
  const w = world();
  w.frames(2);
  w.tap(G, 5);
  w.tap(TAB, 3);
  yes('B3 Tab puts the caret in the search', w.open() && w.page.doc.activeElement === w.page.find);
  w.tap(G, 3);
  yes('B3 G in the search is a letter of the name and the wheel stays open', w.open() && w.closes() === 0);
  w.tap(ESC, 3);
  yes('B3 Escape in the search still shuts it', w.shut() && w.closes() === 1);
}
{
  const w = world();
  w.frames(2);
  const ev = w.page.keydown(G);
  const esc = w.page.keydown(ESC);
  yes('B4 with the wheel shut the page leaves G and Escape alone',
      w.sent.filter(function (m) { return m[1] === '__close'; }).length === 0 && !ev.defaultPrevented && !esc.defaultPrevented);
}

// =========================================================== C. rebound
{
  const w = world(['WheelKey = 16']);
  w.frames(2);
  w.tap(Q, 4);
  yes('C1 the wheel on Q: Q opens it', w.open());
  w.tap(G, 3);
  yes('C1 G does not close a wheel that G does not open', w.open() && w.closes() === 0);
  w.tap(Q, 4);
  yes('C1 Q closes it', w.shut() && w.closes() === 1);
}
{
  const w = world(['WheelKey = 63']);
  w.frames(2);
  w.tap(F5, 4);
  yes('C2 the wheel on F5, which is not a letter: F5 opens it', w.open());
  w.tap(G, 3);
  yes('C2 and the page has no letter left over from G to close on', w.open() && w.closes() === 0);
  w.tap(ESC, 3);
  yes('C2 Escape still closes it', w.shut() && w.closes() === 1);
}
{
  const w = world(['CloseKey = 45']);
  w.frames(2);
  w.tap(G, 4);
  w.tap(X, 3);
  yes('C3 CloseKey moved to X on the Controls page: X closes it', w.shut() && w.closes() === 1);
  w.tap(G, 4);
  w.tap(ESC, 3);
  yes('C3 and Escape still does', w.shut() && w.closes() === 2);
}

// ====================================== D. drawn without the keyboard
{
  // The front's two minute cap takes the claim back and the wheel is still
  // drawn: the plugin hears keys again, and G is its to close.
  const w = world();
  w.frames(2);
  w.tap(G, 4);
  w.T.claimFocus('wheel', false);
  w.frames(2);
  yes('D1 the cap took the keyboard back with the wheel still drawn', w.page.shown() && !w.focus);
  w.tap(G, 4);
  yes('D1 G then reaches the plugin, which closes it, and the page heard none of it',
      !w.page.shown() && w.closes() === 0 &&
      w.pageHeard.filter(function (k) { return k === 'down ' + G; }).length === 0);
}

// ======================================================== E. the sources
{
  yes('E1 no timer in the page', !/setTimeout|setInterval/.test(page));
  const push = /function pushWheel\(\) \{[\s\S]*?\n\}/.exec(plugin);
  yes('E2 the plugin hands the page the wheel key\'s letter and CloseKey\'s',
      !!push && /LETTERS\[OPEN_KEY\]/.test(push[0]) && /LETTERS\[CLOSE_KEY\]/.test(push[0]));
  yes('E3 the plugin answers __close by closing the wheel',
      /if \(what === '__close'\) \{[^}]*setOpen\(false\); return; \}/.test(plugin));
  yes('E4 docs/systems/emotes.md still says G opens it and G closes it',
      /G opens it and G closes it\./.test(doc));
  yes('E4 and that Escape closes it without playing anything',
      /Escape closes it without playing anything\./.test(doc));
  yes('E5 and its Where this is says the page hears G and Escape',
      /Where this is[\s\S]*G and Escape close the open wheel/.test(doc));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
