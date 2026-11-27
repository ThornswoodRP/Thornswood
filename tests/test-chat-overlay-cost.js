// test-chat-overlay-cost.js
//
// The chat overlay stops rescanning the page on every change, the voice
// plugin stops reading the disk on the game's thread, and every line of chat
// still reaches the screen.
//
// ENTRY 270 ON THE TO DO LIST, "The overlay rescans the whole document on
// every change and writes files on every key press". Its words: "This is the
// code between the person and every frame of the game".
//
// What was there. thornswood-bridge.js watched document.documentElement with
// childList and subtree, and on every batch of changes anywhere in the page
// ran six querySelectorAll over the whole document and removed what they
// found from under React. The party strip alone is rewritten every 200 ms
// while you are in a party, so that was thirty whole-page queries a second
// for nothing. And the voice plugin read voice-status.txt every 400 ms and
// voice-port.txt every 3 s with readFileSync, inside sp.on('update'), which
// runs on the game's thread between frames.
//
// The entry's other claim, files written on every key press, was measured
// wrong by the triage: writePtt only writes when the line changes. That is
// checked here as it stands, so nobody "fixes" it.
//
// This runs the REAL bridge, the REAL thornswood-chat.js and the REAL voice
// plugin, in a sandbox with a small DOM, a fake front that renders the chat
// the way the front's Chat component does (read out of the fork,
// skymp5-front/src/constructorComponents/chat/index.js), a fake socket, a
// fake file system and a fake clock. It checks:
//   - the page watches only the children of <head>, and a redraw anywhere
//     else runs no query over the page and does not wake the observer;
//   - the tick boxes, the dice pouch, its dice and the resize corner are off
//     the screen, hidden by the bridge's sheet, and still in the document
//     where React put them;
//   - a sheet taken out of <head> goes straight back;
//   - every line of chat is on screen, the last fifty in order, from the
//     game side and through thornswood-chat.js's socket, and a line typed
//     before that script landed still goes out;
//   - the voice plugin does no synchronous read inside a frame, still gets
//     the launcher's status and port to the page, still prefers
//     Data/Platform to ../Profile, still says the port every three seconds,
//     falls back to the old reads when no background read ever comes back,
//     and recovers from a read that hangs;
//   - off our server, or without a fresh session note, the plugin registers
//     nothing and reads none of the launcher's files.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const pluginPass = require('./fixtures/plugin-pass'); // front's whose-game check and the first tick, as the game does (#485)

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const CR = String.fromCharCode(13);
function read(rel) {
  return fs.readFileSync(path.join(REPO_DIR, rel), 'utf8').split(CR).join('');
}
function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

// ------------------------------------------------------------- a small DOM
/*
  Enough of a document for the bridge and the chat: elements, text nodes,
  childList mutations delivered to MutationObservers when flush() is called
  (the browser's microtask checkpoint), selectors of the shapes the bridge
  uses, and a way to ask whether an element is on screen given every <style>
  in the page. stats.qsa counts querySelectorAll and querySelector calls made
  by the page; the harness's own looking uses find(), which is not counted.
*/
function makeDom() {
  const stats = { qsa: 0, delivered: 0 };
  const observers = [];
  const doc = {};

  function Node(tag, text) {
    this.nodeType = tag ? 1 : 3;
    this.tagName = tag ? String(tag).toUpperCase() : '#text';
    this.childNodes = [];
    this.parentNode = null;
    this.attrs = {};
    this.style = {};
    this.data = text || '';
  }
  Node.prototype = {
    get id() { return this.attrs.id || ''; },
    set id(v) { this.attrs.id = String(v); },
    get className() { return this.attrs['class'] || ''; },
    set className(v) { this.attrs['class'] = String(v); },
    setAttribute: function (k, v) { this.attrs[k] = String(v); },
    getAttribute: function (k) { return has(this.attrs, k) ? this.attrs[k] : null; },
    get firstChild() { return this.childNodes[0] || null; },
    get isConnected() {
      let n = this;
      while (n.parentNode) { n = n.parentNode; }
      return n === doc.documentElement;
    },
    appendChild: function (n) { return this.insertBefore(n, null); },
    insertBefore: function (n, ref) {
      if (n.parentNode) { n.parentNode.removeChild(n); }
      if (ref) {
        const i = this.childNodes.indexOf(ref);
        if (i < 0) { throw new Error('NotFoundError: the reference node is not a child'); }
        this.childNodes.splice(i, 0, n);
      } else {
        this.childNodes.push(n);
      }
      n.parentNode = this;
      mutated(this, [n], []);
      return n;
    },
    removeChild: function (n) {
      const i = this.childNodes.indexOf(n);
      if (i < 0) { throw new Error('NotFoundError: not a child of this node'); }
      this.childNodes.splice(i, 1);
      n.parentNode = null;
      mutated(this, [], [n]);
      return n;
    },
    get textContent() {
      if (this.nodeType === 3) { return this.data; }
      return this.childNodes.map(function (c) { return c.textContent; }).join('');
    },
    set textContent(v) {
      while (this.childNodes.length) { this.removeChild(this.childNodes[0]); }
      if (String(v)) { this.appendChild(new Node(null, String(v))); }
    },
    querySelectorAll: function (sel) { stats.qsa++; return all(this, sel); },
    querySelector: function (sel) { stats.qsa++; return all(this, sel)[0] || null; },
    focus: function () { doc.activeElement = this; },
    blur: function () { if (doc.activeElement === this) { doc.activeElement = doc.body; } },
    addEventListener: function () { },
    removeEventListener: function () { }
  };

  function mutated(parent, added, removed) {
    observers.forEach(function (o) {
      for (const t of o.targets) {
        if (!t.opts.childList) { continue; }
        let hit = parent === t.node;
        if (!hit && t.opts.subtree) {
          for (let p = parent; p; p = p.parentNode) { if (p === t.node) { hit = true; break; } }
        }
        if (hit) {
          o.queue.push({ type: 'childList', target: parent, addedNodes: added, removedNodes: removed });
          break;
        }
      }
    });
  }

  function MutationObserver(cb) {
    this.cb = cb; this.targets = []; this.queue = [];
    observers.push(this);
  }
  MutationObserver.prototype.observe = function (node, opts) {
    this.targets.push({ node: node, opts: Object.assign({}, opts || {}) });
  };
  MutationObserver.prototype.disconnect = function () { this.targets = []; this.queue = []; };
  MutationObserver.prototype.takeRecords = function () { const q = this.queue; this.queue = []; return q; };

  /* Deliver whatever is queued, as the browser does at a microtask checkpoint. */
  function flush() {
    for (let round = 0; round < 50; round++) {
      let any = false;
      observers.forEach(function (o) {
        if (!o.queue.length) { return; }
        any = true;
        const q = o.queue; o.queue = [];
        stats.delivered++;
        o.cb(q, o);
      });
      if (!any) { return; }
    }
    throw new Error('the observers never settled');
  }

  // Selectors: tag, #id, .class and [attr="value"], joined by spaces.
  const COMPOUND = /^([a-zA-Z][\w-]*|\*)?((?:#[\w-]+|\.[\w-]+|\[[\w-]+(?:="[^"]*")?\])*)$/;
  function compound(text) {
    const m = COMPOUND.exec(text);
    if (!text || !m) { return null; }
    const c = { tag: m[1] && m[1] !== '*' ? m[1].toUpperCase() : null, id: null, classes: [], attrs: [] };
    const rx = /#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g;
    let t;
    while ((t = rx.exec(m[2] || ''))) {
      if (t[1]) { c.id = t[1]; } else if (t[2]) { c.classes.push(t[2]); } else { c.attrs.push([t[3], t[4]]); }
    }
    return c;
  }
  function fits(el, c) {
    if (el.nodeType !== 1) { return false; }
    if (c.tag && el.tagName !== c.tag) { return false; }
    if (c.id && el.id !== c.id) { return false; }
    const cls = el.className.split(/\s+/);
    for (const k of c.classes) { if (cls.indexOf(k) < 0) { return false; } }
    for (const a of c.attrs) {
      const v = el.getAttribute(a[0]);
      if (v === null || (a[1] !== undefined && v !== a[1])) { return false; }
    }
    return true;
  }
  function matches(el, sel) {
    const parts = sel.trim().split(/\s+/).map(compound);
    if (!parts.length || parts.some(function (p) { return !p; })) { return false; }
    if (!fits(el, parts[parts.length - 1])) { return false; }
    let i = parts.length - 2;
    for (let n = el.parentNode; n && i >= 0; n = n.parentNode) { if (fits(n, parts[i])) { i--; } }
    return i < 0;
  }
  function walk(root, out) {
    for (const c of root.childNodes) {
      if (c.nodeType === 1) { out.push(c); walk(c, out); }
    }
    return out;
  }
  function all(root, sel) {
    const list = String(sel).split(',');
    return walk(root, []).filter(function (el) {
      return list.some(function (s) { return matches(el, s); });
    });
  }

  doc.documentElement = new Node('html');
  doc.head = new Node('head');
  doc.body = new Node('body');
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  doc.readyState = 'complete';
  doc.activeElement = doc.body;
  doc.createElement = function (tag) { return new Node(tag); };
  doc.createTextNode = function (text) { return new Node(null, String(text)); };
  doc.getElementById = function (id) {
    return walk(doc.documentElement, []).filter(function (e) { return e.id === id; })[0] || null;
  };
  doc.querySelectorAll = function (sel) { stats.qsa++; return all(doc.documentElement, sel); };
  doc.querySelector = function (sel) { stats.qsa++; return all(doc.documentElement, sel)[0] || null; };
  doc.addEventListener = function () { };
  doc.removeEventListener = function () { };

  /* Every display:none rule in every <style> that is in the page. */
  function hidingRules() {
    const out = [];
    walk(doc.documentElement, []).forEach(function (e) {
      if (e.tagName !== 'STYLE') { return; }
      const text = e.textContent.replace(/\/\*[\s\S]*?\*\//g, '');
      const rx = /([^{}]+)\{([^{}]*)\}/g;
      let m;
      while ((m = rx.exec(text))) {
        if (/display\s*:\s*none/.test(m[2])) { out.push(m[1].split(',')); }
      }
    });
    return out;
  }
  /* In the page, and neither it nor anything above it is display:none. */
  function onScreen(el) {
    if (!el || !el.isConnected) { return false; }
    const rules = hidingRules();
    for (let n = el; n && n.nodeType === 1; n = n.parentNode) {
      if (n.style && n.style.display === 'none') { return false; }
      for (const sels of rules) {
        if (sels.some(function (s) { return matches(n, s); })) { return false; }
      }
    }
    return true;
  }

  return {
    document: doc, MutationObserver: MutationObserver, observers: observers,
    flush: flush, stats: stats, onScreen: onScreen,
    find: function (sel) { return all(doc.documentElement, sel); }
  };
}

// ----------------------------------------------------------- a fake front
/*
  Draws the chat widget the way the front's Chat component does, as far as
  this test needs: the same element tree, the list drawn off
  window.chatMessages keyed by index, every run's type used with .join and
  .includes as the real renderer does, and the nodes kept by reference and
  updated in place, as React does. A node somebody else took out of the page
  stays out: React has no reason to put it back.
*/
function makeFront(dom, win) {
  const d = dom.document;
  const sets = [];
  let tree = null;

  function el(tag, cls, id) {
    const e = d.createElement(tag);
    if (cls) { e.className = cls; }
    if (id) { e.id = id; }
    return e;
  }
  function add(parent, child) { parent.appendChild(child); return child; }

  function mount() {
    const t = {};
    t.page = el('div', 'fullPage');
    const chat = add(t.page, el('div', '', 'chat'));
    const main = add(chat, el('div', 'chat-main'));
    const list = add(main, el('div', 'list', 'handle'));
    t.list = add(list, el('div', 'chat-list'));
    t.corner = add(list, el('div', 'chat-corner'));
    add(t.corner, el('img'));
    add(main, el('div'));
    const input = add(main, el('div', 'input'));
    const box = add(input, el('div', 'chat-input'));
    t.input = add(box, el('span', 'show', 'chatInput'));
    t.boxes = add(input, el('div', 'chat-checkboxes'));
    t.checks = {};
    ['nonrp', 'settings', 'moveChat'].forEach(function (id) {
      const wrap = add(t.boxes, el('div', 'promoted-checkbox'));
      const tick = add(wrap, el('input', '', id));
      const label = add(wrap, el('label'));
      label.setAttribute('for', id);
      label.textContent = id;
      t.checks[id] = { tick: tick, label: label };
    });
    t.limit = add(t.boxes, el('span', 'chat-message-limit text'));
    t.limit.textContent = '0/2000';
    t.dices = add(chat, el('div', 'chat-dices'));
    t.dice = [add(t.dices, el('span', 'dice')), add(t.dices, el('span', 'dice'))];
    t.msgs = [];
    d.getElementById('root').appendChild(t.page);
    return t;
  }

  function spans(msg) {
    return msg.text.map(function (r, i) {
      if (i >= 1) { r.type.includes('nonrp'); }
      const s = el('span', r.type.join(' '));
      s.style.color = r.color;
      s.textContent = r.text;
      return s;
    });
  }
  function lineOf(msg) { return msg.text.map(function (r) { return r.text; }).join(''); }

  function render(list) {
    const chat = (list || []).filter(function (w) { return w && w.type === 'chat'; })[0];
    if (!chat) {
      if (tree) { tree.page.parentNode.removeChild(tree.page); tree = null; }
      return;
    }
    if (!tree) { tree = mount(); }
    const msgs = win.chatMessages;
    for (let i = 0; i < msgs.length; i++) {
      const want = lineOf(msgs[i]);
      let div = tree.msgs[i];
      if (!div) {
        div = el('div', 'msg');
        tree.msgs.push(div);
        spans(msgs[i]).forEach(function (s) { div.appendChild(s); });
        tree.list.appendChild(div);
      } else if (div.textContent !== want) {
        while (div.childNodes.length) { div.removeChild(div.childNodes[0]); }
        spans(msgs[i]).forEach(function (s) { div.appendChild(s); });
      }
    }
    while (tree.msgs.length > msgs.length) { tree.list.removeChild(tree.msgs.pop()); }
    // The counter under the box is a text node React sets in place, which
    // is not a childList change.
    tree.limit.firstChild.data = '0/2000';
  }

  return {
    widgets: { set: function (list) { sets.push(list); render(list); } },
    sets: sets,
    tree: function () { return tree; },
    lineOf: lineOf
  };
}

// ------------------------------------------------------------- the page
function page() {
  const dom = makeDom();
  const d = dom.document;
  const root = d.createElement('div');
  root.id = 'root';
  d.body.appendChild(root);

  const timers = [];
  const intervals = [];
  const told = [];
  const sockets = [];

  function FakeSocket(url) {
    this.url = url; this.readyState = 0; this.sent = [];
    sockets.push(this);
  }
  FakeSocket.prototype.send = function (s) { this.sent.push(JSON.parse(s)); };
  FakeSocket.prototype.close = function () { this.readyState = 3; };

  const win = {
    addEventListener: function () { }, removeEventListener: function () { },
    document: d, MutationObserver: dom.MutationObserver, WebSocket: FakeSocket,
    setTimeout: function (fn) { timers.push(fn); return timers.length; },
    clearTimeout: function () { },
    setInterval: function (fn) { intervals.push(fn); return intervals.length; },
    clearInterval: function (id) { intervals[id - 1] = null; },
    console: { log: function () { } },
    Date: Date, JSON: JSON, Math: Math, Array: Array, Object: Object, String: String,
    Number: Number, isFinite: isFinite, parseInt: parseInt, RegExp: RegExp, Error: Error
  };
  win.window = win;
  // What ProcessHandler.cpp puts in the page. The front's bundle adds the
  // widget list later, because it is deferred and this file is not.
  win.skyrimPlatform = { sendMessage: function () { told.push([].slice.call(arguments)); } };
  vm.createContext(win);
  vm.runInContext(read('game/ui/thornswood-bridge.js'), win, { filename: 'thornswood-bridge.js' });

  const front = makeFront(dom, win);
  win.skyrimPlatform.widgets = front.widgets;

  /* Run what the page queued, and deliver what it changed, until nothing is left. */
  function settle() {
    for (let i = 0; i < 20; i++) {
      dom.flush();
      const due = timers.splice(0);
      if (!due.length) { return; }
      due.forEach(function (fn) { fn(); });
    }
  }
  function runIntervals() {
    intervals.slice().forEach(function (fn) { if (fn) { fn(); } });
    settle();
  }
  function loadChat(cfg) {
    win.THORNSWOOD = cfg;
    vm.runInContext(read('game/ui/thornswood-chat.js'), win, { filename: 'thornswood-chat.js' });
    settle();
  }
  return {
    win: win, dom: dom, front: front, told: told, sockets: sockets,
    settle: settle, runIntervals: runIntervals, loadChat: loadChat
  };
}

function shownLines(p) {
  const t = p.front.tree();
  if (!t) { return []; }
  return t.list.childNodes.filter(function (n) { return p.dom.onScreen(n); })
    .map(function (n) { return n.textContent; });
}
function wantedLines(p) { return p.win.chatMessages.map(p.front.lineOf); }
function same(a, b) { return a.length === b.length && a.every(function (x, i) { return x === b[i]; }); }

// ---------------------------------------------------- what the page watches
const P = page();
const D = P.dom.document;
const sheet = D.getElementById('thornswood-chat-trim');

yes('the bridge loads and says so', P.told.some(function (a) { return a[1] === 'bridge is up'; }));
yes('and puts its sheet in <head>', !!sheet && sheet.parentNode === D.head);

const targets = [];
P.dom.observers.forEach(function (o) { o.targets.forEach(function (t) { targets.push(t); }); });
yes('nothing watches the whole document with subtree set',
    !targets.some(function (t) { return t.node === D.documentElement || t.opts.subtree; }));
yes('what is watched is the children of <head> and nothing below them',
    targets.length === 1 && targets[0].node === D.head && targets[0].opts.childList === true &&
    !targets[0].opts.subtree && !targets[0].opts.attributes && !targets[0].opts.characterData);

// The bundle's own sheets, as style-loader adds them: appended to <head>.
['.chat-checkboxes{display:flex}', '.chat-dices{display:flex}', '#chat{bottom:30px}']
  .forEach(function (text) {
    const s = D.createElement('style');
    s.textContent = text;
    D.head.appendChild(s);
  });
P.settle();
yes('the bundle\'s sheets going in leave the bridge\'s where it is', sheet.parentNode === D.head);

// ----------------------------------------------------------- the chat drawn
P.win.thornswoodChat.show();
P.settle();
const T = P.front.tree();
yes('the chat is drawn and the game side is told', !!T && P.told.some(function (a) { return a[1] === 'chat is up'; }));

P.win.thornswoodChat.add('The gate is open.');
P.win.thornswoodChat.add([{ text: 'Thora: ', color: '#c6aa6d' }, 'well met']);
P.settle();
yes('lines from the game side are on screen, in order',
    same(shownLines(P), ['The gate is open.', 'Thora: well met']));

const HIDDEN = [
  ['the tick boxes', T.boxes], ['the dice pouch', T.dices], ['its first die', T.dice[0]],
  ['the resize corner', T.corner], ['the non-rp tick', T.checks.nonrp.tick],
  ['its label', T.checks.nonrp.label]
];
yes('the tick boxes, the dice pouch, its dice and the resize corner are off the screen',
    HIDDEN.every(function (h) { return !P.dom.onScreen(h[1]); }));
yes('and still in the document where React put them, hidden by the sheet rather than pulled out',
    HIDDEN.every(function (h) { return h[1].isConnected; }));
HIDDEN.forEach(function (h) { if (!h[1].isConnected) { console.log('      taken out of the page: ' + h[0]); } });
yes('the chat box itself is on screen', P.dom.onScreen(T.input));

// ------------------------------------------------------- what a redraw costs
{
  // The party strip, which thornswood-party.js rewrites every 200 ms while you
  // are in a party. Five seconds of it, one task at a time.
  const strip = D.createElement('div');
  strip.id = 'ts-party-strip';
  D.body.appendChild(strip);
  P.settle();
  P.dom.stats.qsa = 0; P.dom.stats.delivered = 0;
  for (let i = 0; i < 25; i++) {
    strip.textContent = 'Thora, ' + (i * 10) + ' paces';
    P.dom.flush();
  }
  yes('five seconds of the party strip redrawing runs no query over the page (ran ' + P.dom.stats.qsa + ')',
      P.dom.stats.qsa === 0);
  yes('and does not wake the page\'s observer at all (woke it ' + P.dom.stats.delivered + ' times)',
      P.dom.stats.delivered === 0);

  P.dom.stats.qsa = 0;
  P.win.thornswoodChat.add('One more line.');
  P.settle();
  yes('a line of chat runs no query over the page either (ran ' + P.dom.stats.qsa + ')',
      P.dom.stats.qsa === 0);
}

// --------------------------------------------------------- the sheet kept
{
  P.dom.stats.qsa = 0;
  D.head.removeChild(sheet);
  P.settle();
  yes('a sheet taken out of <head> is put straight back', sheet.parentNode === D.head);
  yes('so the pouch, the dice and the tick boxes stay off the screen',
      HIDDEN.every(function (h) { return !P.dom.onScreen(h[1]); }));
  yes('and putting it back ran no query over the page', P.dom.stats.qsa === 0);
}

// ------------------------------------------------------- every line shown
{
  for (let i = 1; i <= 60; i++) { P.win.thornswoodChat.add('line ' + i); }
  P.settle();
  const shown = shownLines(P);
  yes('sixty more lines leave the last fifty on screen, ' + shown.length + ' shown',
      shown.length === 50 && P.win.chatMessages.length === 50);
  yes('every one of them, in order, the newest last',
      same(shown, wantedLines(P)) && shown[49] === 'line 60' && shown[0] === 'line 11');
  const sets = P.front.sets;
  yes('every draw handed the front a new list, which is how it knows to redraw',
      sets.length > 60 && sets.every(function (s, i) { return sets.indexOf(s) === i; }));
}

// ------------------------------------------------- through thornswood-chat.js
{
  // Typed before thornswood-chat.js has landed: held, not thrown away.
  const widget = P.front.sets[P.front.sets.length - 1][0];
  widget.send('typed before the socket');

  // The https address the launcher writes; there is no ws:// fallback (#1304).
  P.loadChat({ host: 'voice.test', port: 7778, profileId: 1, name: 'Sera', token: 'test-token', base: 'https://voice.test/voice' });
  const ws = P.sockets[0];
  yes('thornswood-chat.js opens its socket, over wss', !!ws && ws.url === 'wss://voice.test/voice/');

  P.runIntervals();
  ws.readyState = 1;
  ws.onopen();
  ws.onmessage({ data: JSON.stringify({ t: 'welcome', peer: 4 }) });
  ws.onmessage({ data: JSON.stringify({ t: 'chat', name: 'Thora', profileId: 2, text: 'well met again' }) });
  ws.onmessage({ data: JSON.stringify({ t: 'chat', name: 'Sera', profileId: 1, text: 'and you' }) });
  P.settle();

  const shown = shownLines(P);
  yes('the socket\'s lines are on screen, the newest last',
      same(shown.slice(-3), ['Chat is on. Press enter to talk.', 'Thora: well met again', 'Sera: and you']));
  yes('and the list on screen is still exactly what the chat holds', same(shown, wantedLines(P)));

  const said = ws.sent.filter(function (m) { return m.t === 'chat'; }).map(function (m) { return m.text; });
  yes('the line typed before the socket landed went out once it was up',
      said.indexOf('typed before the socket') >= 0);
  widget.send('hello');
  widget.send('the gate is shut');
  const now = ws.sent.filter(function (m) { return m.t === 'chat'; }).map(function (m) { return m.text; });
  yes('and what is typed now goes out through the socket', same(now.slice(-2), ['hello', 'the gate is shut']));
}

// ------------------------------------------------------------ the plugin
const SETTINGS = 'Data/Platform/Plugins/skymp5-client-settings.txt';
const NOTE = 'Data/Platform/thornswood-session.txt';
const LOG = 'Data/Platform/thornswood-voice.log';
const STATUS = 'Data/Platform/voice-status.txt';
const STATUS_PROFILE = '../Profile/voice-status.txt';
const PORT_PROFILE = '../Profile/voice-port.txt';
const PTT = 'Data/Platform/voice-ptt.txt';
const PTT_PROFILE = '../Profile/voice-ptt.txt';

const PLUGIN = read('game/plugins/thornswood-voice.js');
// The address is in front's whose-game check, the one copy (#485).
const oursMatch = /const ours = \['([^']+)'\];/.exec(read('game/plugins/thornswood-front.js'));
const OURS = oursMatch ? oursMatch[1] : '';
yes('front\'s whose-game check names the address it calls ours', !!OURS);

/*
  The real plugin, a fake Skyrim Platform, a fake file system and a clock
  this controls. frame() is one update: SkyrimPlatform runs the libuv loop
  first and then the update handlers (JsTick in the fork's SkyrimPlatform.cpp),
  so a background read asked for in one frame is answered at the start of the
  next. A read of a file that is not there fails the way fs does, and
  readChannelAsync then asks the next folder, one frame later.

  opts.async: 'yes' (default), 'drop' (asked, never answered), 'none' (no
  fs.readFile at all). opts.gate: the client's address and the session note.
*/
function plugin(opts) {
  opts = opts || {};
  let clock = Date.UTC(2026, 8, 24, 20, 0, 0);
  const files = Object.assign({}, opts.files || {});
  const ip = has(opts, 'ip') ? opts.ip : OURS;
  files[SETTINGS] = JSON.stringify({ 'server-ip': ip, gameData: { profileId: 7 } });
  if (!has(opts, 'note')) { files[NOTE] = String(clock); }
  else if (opts.note !== null) { files[NOTE] = String(opts.note); }

  const counts = { sync: 0, syncInFrame: 0, asked: 0, writes: {} };
  const state = { drop: opts.async === 'drop' };
  let pending = [];
  let inFrame = false;
  function missing(p) {
    const e = new Error('ENOENT: no such file or directory, open \'' + p + '\'');
    e.code = 'ENOENT';
    return e;
  }
  const fakeFs = {
    readFileSync: function (p) {
      counts.sync++;
      if (inFrame) { counts.syncInFrame++; }
      if (!has(files, p)) { throw missing(p); }
      return files[p];
    },
    writeFileSync: function (p, t) {
      files[p] = String(t);
      counts.writes[p] = (counts.writes[p] || 0) + 1;
    },
    appendFileSync: function (p, t) { files[p] = (files[p] || '') + String(t); }
  };
  if (opts.async !== 'none') {
    fakeFs.readFile = function (p, enc, cb) {
      counts.asked++;
      pending.push(function () {
        if (!has(files, p)) { cb(missing(p)); } else { cb(null, files[p]); }
      });
    };
  }

  const handlers = {};
  const scripts = [];
  const sp = {
    on: function (name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
    printConsole: function () { },
    browser: { executeJavaScript: function (s) { scripts.push(String(s)); } }
  };
  const sandbox = {
    skyrimPlatform: sp,
    require: function (name) { if (name === 'fs') { return fakeFs; } throw new Error(name); },
    console: console,
    Date: { now: function () { return clock; }, parse: Date.parse, UTC: Date.UTC },
    JSON: JSON, Number: Number, String: String, Math: Math, Array: Array, Object: Object,
    RegExp: RegExp, Error: Error, isFinite: isFinite
  };
  if (opts.ready) { sandbox.Thornswood = { ready: true }; }
  vm.createContext(sandbox);
  pluginPass.load(sandbox, PLUGIN, { filename: 'thornswood-voice.js' });

  function frame(ms) {
    clock += ms;
    const due = pending; pending = [];
    if (!state.drop) { due.forEach(function (f) { f(); }); }
    inFrame = true;
    try { (handlers.update || []).forEach(function (fn) { fn(); }); }
    finally { inFrame = false; }
  }
  /* A span of time at sixty frames a second. */
  function run(ms) { for (let t = 0; t < ms; t += 16) { frame(16); } }
  function key(code, down) {
    (handlers.buttonEvent || []).forEach(function (fn) { fn({ code: code, isDown: down, isUp: !down }); });
  }
  function sent(what) { return scripts.filter(function (s) { return s.indexOf(what) >= 0; }).length; }
  return { files: files, counts: counts, state: state, handlers: handlers, scripts: scripts,
           run: run, key: key, sent: sent };
}

// ------------------------------------------------- idle off our server
{
  const other = plugin({ ip: '10.1.2.3', files: { [STATUS]: '1 2 0 yell', [PORT_PROFILE]: '54321' } });
  const stale = plugin({ note: Date.UTC(2026, 8, 22, 20, 0, 0), files: { [STATUS]: '1 2 0 yell' } });
  const none = plugin({ note: null, files: { [STATUS]: '1 2 0 yell' } });
  [['pointed at another server', other], ['with a two day old session note', stale],
   ['with no session note', none]].forEach(function (c) {
    const pl = c[1];
    pl.run(1000);
    yes('the plugin ' + c[0] + ' registers nothing and reads none of the launcher\'s files',
        Object.keys(pl.handlers).length === 0 && pl.counts.asked === 0 && pl.counts.sync <= 3 &&
        pl.scripts.length === 0);
  });
}

// ------------------------------------------------- our session, reads answered
{
  const pl = plugin({ files: { [STATUS]: '1 2 0 yell', [PORT_PROFILE]: '54321' } });
  pl.run(1000);
  yes('a second of frames reads nothing from disk on the game\'s thread (read ' +
      pl.counts.syncInFrame + ' times)', pl.counts.syncInFrame === 0);
  yes('the reads went to fs.readFile instead', pl.counts.asked > 0);
  yes('the launcher\'s status still reaches the page', pl.sent('setLauncherStatus(true,2,false,"yell",false)') === 1);
  yes('and its port, from ../Profile when Data/Platform has none', pl.sent('setLauncherPort(54321)') >= 1);

  pl.files[STATUS] = '0 3 1 whisper';
  pl.run(640);
  yes('a new status reaches the page within a poll', pl.sent('setLauncherStatus(false,3,true,"whisper",false)') === 1);
  yes('and each status is sent once, not once a frame',
      pl.sent('setLauncherStatus(') === 2);

  pl.files[STATUS] = '';
  pl.files[STATUS_PROFILE] = '1 5 0 local';
  pl.run(640);
  yes('an empty file in Data/Platform falls through to ../Profile, as before',
      pl.sent('setLauncherStatus(true,5,false,"local",false)') === 1);
  pl.files[STATUS] = '1 6 0 local';
  pl.run(640);
  yes('and Data/Platform is still read first when it has something',
      pl.sent('setLauncherStatus(true,6,false,"local",false)') === 1);

  const before = pl.sent('setLauncherPort(54321)');
  pl.run(10000);
  const again = pl.sent('setLauncherPort(54321)') - before;
  yes('the port is said again every three seconds, not every frame (' + again + ' times in ten seconds)',
      again >= 3 && again <= 4);

  pl.files[PORT_PROFILE] = '54400';
  pl.run(3500);
  yes('a new port reaches the page within one three second poll', pl.sent('setLauncherPort(54400)') >= 1);
  yes('and the log says where push to talk goes now',
      pl.files[LOG].indexOf('push to talk goes to 127.0.0.1:54400') >= 0);

  yes('none of that read the disk on the game\'s thread (read ' + pl.counts.syncInFrame + ' times)',
      pl.counts.syncInFrame === 0);
  yes('and the log never says it gave up on background reads',
      pl.files[LOG].indexOf('never came back') < 0);

  // A read that hangs once reads have been answering is let go and asked again.
  pl.state.drop = true;
  pl.files[STATUS] = '1 9 0 yell';
  pl.run(2000);
  pl.state.drop = false;
  pl.run(5000);
  yes('a read that hangs is let go and asked again, and the status still arrives',
      pl.sent('setLauncherStatus(true,9,false,"yell",false)') === 1);
  yes('without going back to reading on the game\'s thread', pl.counts.syncInFrame === 0);
}

// --------------------------------------- reads asked for and never answered
{
  const pl = plugin({ async: 'drop', files: { [STATUS]: '1 2 0 yell', [PORT_PROFILE]: '54321' } });
  pl.run(4000);
  yes('while a background read might still come back, nothing is read on the game\'s thread',
      pl.counts.syncInFrame === 0 && pl.sent('setLauncherStatus(') === 0);
  pl.run(2500);
  yes('when none ever does, the status reaches the page the old way',
      pl.sent('setLauncherStatus(true,2,false,"yell",false)') === 1);
  yes('and the port', pl.sent('setLauncherPort(54321)') >= 1);
  const said = pl.files[LOG].split('\n').filter(function (l) { return l.indexOf('never came back') >= 0; });
  yes('and the log says so, once', said.length === 1);
}

// ------------------------------------------------------ no fs.readFile at all
{
  const pl = plugin({ async: 'none', files: { [STATUS]: '1 2 0 yell', [PORT_PROFILE]: '54321' } });
  pl.run(1000);
  yes('with no fs.readFile, the status and port reach the page as they always did',
      pl.sent('setLauncherStatus(true,2,false,"yell",false)') === 1 && pl.sent('setLauncherPort(54321)') >= 1);
}

// ---------------------------------------------------- push to talk, as it was
{
  const pl = plugin({ ready: true });
  pl.run(100);
  pl.key(47, true);
  pl.key(47, true);
  pl.key(47, true);
  const downs = pl.counts.writes[PTT] || 0;
  yes('holding push to talk writes the line once to each folder, however often the key repeats',
      downs === 1 && pl.counts.writes[PTT_PROFILE] === 1 && pl.files[PTT] === '1 local' &&
      pl.files[PTT_PROFILE] === '1 local');
  pl.key(47, false);
  yes('and letting go writes once more', pl.counts.writes[PTT] === 2 && pl.files[PTT] === '0 local');
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
