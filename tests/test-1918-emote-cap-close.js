// test-1918-emote-cap-close.js
//
// #1918. The two-minute cap closes the emote wheel the same way it closes
// every other panel: by the name in CAP_CLOSES, calling .close().
//
// WHAT WAS WRONG. CAP_CLOSES.wheel is 'thornswoodEmotes'. The page defined
// thornswoodSetWheel, thornswoodSetRing and thornswoodHideWheel, and never
// that name. The cap's T.js call was a no-op, then it dropped the wheel
// claim. The overlay could stay drawn or the plugin's open stayed true, so
// the next G shut a wheel nobody could see instead of opening it.
//
// THE FIX. The page exposes window.thornswoodEmotes.close, and close sends
// __close. The plugin already answers that with setOpen(false). Hide-only
// is not close: HideWheel is what the plugin uses after open is already
// false.
//
// WHAT IS HELD HERE:
//   A. CAP_CLOSES is read from the real front, not a hand-made list. Every
//      name it gives is assigned on a page with a close function.
//   B. The cap calls that name's close, the same T.js line it uses for
//      every other panel.
//   C. The emote page's close sends __close, and the plugin sets open
//      false. After that, a tap of G opens the wheel again.
//
// The pretend game in C is the same order as tests/test-1852-wheel-keys.js:
// the real page and the real plugin, wired so executeJavaScript runs in the
// page and sendMessage reaches browserMessage on the next frame.
//
// Read only.
'use strict';
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const pluginPass = require('./fixtures/plugin-pass'); // front's whose-game check and the first tick, as the game does (#485)
const CR = String.fromCharCode(13);
function read(p) {
  return fs.readFileSync(path.isAbsolute(p) ? p : path.join(REPO_DIR, p), 'utf8').split(CR).join('');
}
const front = read(path.join('game', 'plugins', 'thornswood-front.js'));
const page = read(process.env.PAGE || path.join('game', 'ui', 'thornswood-emotes.js'));
const plugin = read(process.env.PLUGIN || path.join('game', 'plugins', 'thornswood-emotes.js'));
const serverAddress = JSON.parse(read(path.join('scripts', 'vps', 'vps.json'))).address;

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function between(src, a, b) {
  const i = src.indexOf(a);
  const j = i < 0 ? -1 : src.indexOf(b, i + a.length);
  return (i >= 0 && j >= 0) ? src.slice(i, j) : '';
}

function capCloses(src) {
  const block = between(src, 'const CAP_CLOSES = {', '\n  };');
  if (!block) { return null; }
  try { return new Function('return {' + block.slice(block.indexOf('{') + 1) + '}')(); }
  catch (e) { return null; }
}

function skipString(src, i) {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === '\\') { j += 2; continue; }
    if (src[j] === q) { return j; }
    j++;
  }
  return src.length - 1;
}

function braceSlice(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { i = skipString(src, i); continue; }
    if (c === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i);
      if (i < 0) { break; }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2);
      if (i < 0) { break; }
      i += 1;
      continue;
    }
    if (c === '{') { depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0) { return src.slice(open, i + 1); }
    }
  }
  return '';
}

function lastWindowAssign(src, name) {
  const a = 'window.' + name + ' =';
  const b = 'window.' + name + '=';
  return Math.max(src.lastIndexOf(a), src.lastIndexOf(b));
}

function objectText(src, from) {
  const eq = src.indexOf('=', from);
  if (eq < 0) { return ''; }
  let j = eq + 1;
  while (j < src.length && /\s/.test(src[j])) { j++; }
  if (src[j] === '{') { return braceSlice(src, j); }
  const ident = /^([A-Za-z_]\w*)/.exec(src.slice(j));
  if (!ident) { return ''; }
  const decl = new RegExp('(?:var|let|const)\\s+' + ident[1] + '\\s*=\\s*\\{');
  const m = decl.exec(src);
  if (!m) { return ''; }
  return braceSlice(src, src.indexOf('{', m.index));
}

function hasClose(obj) {
  return /(?:^|[{\n,])\s*close\s*(?:[:},]|\/\/|\/\*)/.test(obj);
}

function uiFiles() {
  const dir = path.join(REPO_DIR, 'game', 'ui');
  return fs.readdirSync(dir).filter(function (f) { return f.slice(-3) === '.js'; })
    .map(function (f) { return { file: f, src: read(path.join(dir, f)) }; });
}

// ======================================================== A. every name
const closes = capCloses(front);
const names = closes ? Object.keys(closes) : [];
yes('A1 CAP_CLOSES is the object the cap walks, read from the front',
    !!closes && names.length >= 10 && closes.wheel === 'thornswoodEmotes');
yes('A1 and the cap looks up that name and calls close on it',
    /const win = CAP_CLOSES\[who\];/.test(front) &&
    /T\.js\('try\{window\.' \+ win \+ '&&window\.' \+ win \+ '\.close\(\);\}catch\(e\)\{\}'\)/.test(front));

const pages = uiFiles();
names.forEach(function (who) {
  const win = closes[who];
  const hits = pages.filter(function (p) { return lastWindowAssign(p.src, win) >= 0; });
  const src = hits.length ? hits[hits.length - 1].src : '';
  const file = hits.length ? hits[hits.length - 1].file : '';
  const obj = src ? objectText(src, lastWindowAssign(src, win)) : '';
  yes('A2 ' + who + ' -> ' + win + ' is defined with close' + (file ? ' (' + file + ')' : ''),
      !!win && !!obj && hasClose(obj));
});

// ======================================================== B. the page
const G = 34, ONE = 2;
const BROWSER = {
  1: { key: 'Escape', keyCode: 27 },
  34: { key: 'g', keyCode: 71 },
  2: { key: '1', keyCode: 49 }
};

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
      querySelectorAll() { return []; },
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

{
  const sent = [];
  const p = pageRig(sent);
  const api = p.box.window.thornswoodEmotes;
  yes('B1 the page exposes window.thornswoodEmotes.close',
      !!api && typeof api.close === 'function');
  sent.length = 0;
  api.close();
  yes('B1 and close sends __close, so the plugin\'s open follows',
      sent.length === 1 && sent[0][0] === 'thornswood-emote' && sent[0][1] === '__close');
  const emoteObj = objectText(page, lastWindowAssign(page, 'thornswoodEmotes'));
  yes('B1 it does not hide the wheel by itself (that would leave open true)',
      /close:\s*function\s*\(\)\s*\{\s*say\('__close'\);\s*\}/.test(emoteObj) &&
      emoteObj.indexOf('thornswoodHideWheel') < 0 && emoteObj.indexOf('className') < 0);
}

// ======================================================== C. the cap
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

function world() {
  const w = {
    focus: false, claims: {}, fingers: new Set(), buffer: [], snapWas: new Set(), held: new Set(),
    toBrowser: [], sent: [], told: [], pageHeard: [], gameHeard: [], played: []
  };
  w.page = pageRig(w.sent);
  const P = pluginRig('[Emotes]\n', w);
  w.T = P.T;
  w.finger = function (code, down) {
    if (down) { w.fingers.add(code); } else { w.fingers.delete(code); }
    w.buffer.push({ code: code, down: down });
  };
  w.frame = function () {
    const buf = w.buffer.splice(0);
    const codes = new Set(Array.from(w.fingers).concat(Array.from(w.snapWas)));
    codes.forEach(function (c) {
      const now = w.fingers.has(c);
      if (now === w.snapWas.has(c)) { return; }
      if (now) { w.snapWas.add(c); } else { w.snapWas.delete(c); }
      if (w.focus) { w.toBrowser.push({ code: c, down: now }); }
    });
    const listening = !w.focus;
    buf.forEach(function (ev) {
      let through;
      if (listening) {
        through = true;
        if (ev.down) { w.held.add(ev.code); } else { w.held.delete(ev.code); }
      } else {
        through = !ev.down && w.held.has(ev.code);
        if (through) { w.held.delete(ev.code); }
      }
      if (through) {
        w.gameHeard.push((ev.down ? 'down ' : 'up ') + ev.code);
        P.emit('buttonEvent', { device: 0, code: ev.code, isDown: ev.down, isUp: !ev.down,
                                isRepeating: false, isHeld: false, heldDuration: 0 });
      }
    });
    w.sent.splice(0).forEach(function (m) {
      w.told.push(m[1]);
      P.emit('browserMessage', { arguments: [m[0], m[1]] });
    });
    P.emit('update');
    w.toBrowser.splice(0).forEach(function (k) {
      w.pageHeard.push((k.down ? 'down ' : 'up ') + k.code);
      if (k.down) { w.page.keydown(k.code); }
    });
  };
  w.frames = function (n) { for (let i = 0; i < n; i++) { w.frame(); } };
  w.tap = function (code, held) {
    w.finger(code, true);
    w.frames(held || 4);
    w.finger(code, false);
    w.frames(3);
  };
  w.closes = function () { return w.told.filter(function (t) { return t === '__close'; }).length; };
  w.open = function () { return w.page.shown() && !!w.claims.wheel && w.focus; };
  w.shut = function () { return !w.page.shown() && !w.claims.wheel && !w.focus; };
  w.cap = function () {
    const win = closes.wheel;
    w.T.js('try{window.' + win + '&&window.' + win + '.close();}catch(e){}');
    w.T.claimFocus('wheel', false);
  };
  return w;
}

{
  const w = world();
  w.frames(2);
  w.tap(G, 5);
  yes('C1 a tap of G opens the wheel and the wheel holds the keyboard', w.open());
  const before = w.played.slice();
  w.cap();
  yes('C1 the cap\'s close sends __close on the same path G and Escape use',
      w.sent.length === 1 && w.sent[0][0] === 'thornswood-emote' && w.sent[0][1] === '__close');
  w.frames(4);
  yes('C1 and the plugin sets open false, hides the wheel, and gives the keyboard back',
      w.shut() && w.closes() === 1 && w.played.length === before.length);
}

{
  const w = world();
  w.frames(2);
  w.tap(G, 5);
  w.T.claimFocus('wheel', false);
  w.frames(2);
  yes('C2 dropping the claim and leaving open true is the old cap: the wheel is still drawn',
      w.page.shown());
  w.tap(G, 5);
  yes('C2 and the next G shuts it instead of opening it, because the plugin\'s open stayed true',
      !w.open());

  const w2 = world();
  w2.frames(2);
  w2.tap(G, 5);
  w2.cap();
  w2.frames(4);
  yes('C2 after the real cap the wheel is shut', w2.shut());
  w2.tap(G, 5);
  yes('C2 and the next G opens it again, because the plugin\'s open followed',
      w2.open());
}

{
  yes('C3 the plugin still answers __close by setting open false',
      /if \(what === '__close'\) \{[^}]*setOpen\(false\); return; \}/.test(plugin));
  yes('C3 and with the wheel shut 1 to 8 are left to the game: the plugin plays no slot on a key',
      !/digits\s*=\s*\[2, 3, 4, 5, 6, 7, 8, 9\]/.test(plugin) && !/playSlot\(pick/.test(plugin));
}

{
  // Djinn, 6 Oct: with the wheel shut, 1 to 8 are Skyrim's favourites
  // hotkeys. Pressing one equipped the favourite and played a slot as well.
  const w = world();
  w.frames(2);
  const before = w.played.slice();
  for (let code = ONE; code <= ONE + 7; code++) { w.tap(code, 4); }
  w.frames(4);
  yes('C4 with the wheel shut, 1 to 8 play no emote',
      w.played.length === before.length && w.shut());

  w.tap(G, 5);
  yes('C4 a tap of G opens the wheel', w.open());
  w.tap(ONE, 4);
  w.frames(6);
  yes('C4 and with the wheel open, 1 plays Wave, the first slot, and shuts the wheel',
      w.played.indexOf('IdleWave') >= 0 && w.shut());
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
