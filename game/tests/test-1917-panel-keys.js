// test-1917-panel-keys.js
//
// Every panel hears its own keys with the bridge in the page (#1917).
//
// thornswood-bridge.js stops every key on the document's capture phase while
// nobody is typing, so a game key that leaked into the page does not reach
// the chat. A panel that is up is the exception. Which panels that meant was
// a list in the bridge naming three of them, and the help, maneuver, board,
// ride, repair, treat and merchant panels and the away prompt came later and
// were never on it. Their listeners sit on the bubble, after the bridge's
// stop, so Escape never reached them, and the board's boxes took no letter.
// Each page's own harness ran the page alone, without the bridge, so all of
// them passed.
//
// What this runs: the real bridge and the real page, together, in one
// stand-in document that dispatches a key the way a browser does (window and
// document on the capture, the target, then the bubble back up, and a stop
// anywhere ends it). Then it presses the keys.
//
//   A. Every page the front loads that listens for a key on the bubble, or
//      has a box to type in, hangs a thornswood global with an isOpen on
//      window, which is what the bridge asks, and is pressed below. A page
//      added later that is not falls out here.
//   B. With each panel up: a key reaches every key listener the page added,
//      and a letter typed into one of its boxes is not refused.
//   C. What each panel does with them: Escape closes the help, maneuver,
//      board, ride, repair, treat, merchant, journal and party panels, F7
//      closes the help, the maneuver key closes the maneuvers and a digit
//      starts one, Escape on a trade walks away, Enter answers the away
//      prompt, J closes the journal.
//   D. With no panel up, a key aimed at the chat box stops at the bridge and
//      its letter is refused, and while somebody is typing it goes through.
//
// BRIDGE=<file> runs another bridge, for instance the one before this fix.
// Read only.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
function read(...bits) { return fs.readFileSync(path.join(ROOT, ...bits), 'utf8').split(CR).join(''); }
const bridgeSrc = process.env.BRIDGE ? fs.readFileSync(process.env.BRIDGE, 'utf8').split(CR).join('') :
                  read('game', 'ui', 'thornswood-bridge.js');
const front = read('game', 'plugins', 'thornswood-front.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function attempt(what, fn) {
  try { fn(); } catch (e) { yes(what + ' ran without throwing (' + (e && e.stack || e) + ')', false); }
}

// ------------------------------------------------------- the stand-in page
/*
  Nodes with a parent, listeners kept by phase, and a dispatch in the
  browser's order: capture from the window down to the target's parent, the
  target itself (capture listeners first, as Chromium does), then the bubble
  back up to the window. stopPropagation ends it after the node it was called
  on. Markup written with innerHTML becomes child nodes, found again by id,
  tag, class or attribute.
*/
function makePage() {
  const ids = {};
  const pg = { told: [], sent: [], loading: '', listeners: [] };

  function unesc(s) {
    return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  }
  function Node(tag) {
    const n = {
      nodeType: 1, tagName: String(tag || 'div').toUpperCase(), attrs: {}, children: [], kids: [],
      parentNode: null, style: {}, textContent: '', value: '', disabled: false, onclick: null,
      isContentEditable: false, _id: '', _class: '', _html: '', _ls: [],
      appendChild(c) {
        if (c.parentNode) { c.parentNode.removeChild(c); }
        c.parentNode = this; this.children.push(c); return c;
      },
      removeChild(c) {
        const i = this.children.indexOf(c);
        if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; }
        return c;
      },
      insertBefore(c) { return this.appendChild(c); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') { this.id = v; } if (k === 'class') { this.className = v; } },
      removeAttribute(k) { delete this.attrs[k]; },
      hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); },
      addEventListener(type, fn, opt) {
        const rec = { type: type, fn: fn, capture: opt === true || !!(opt && opt.capture), page: pg.loading, heard: 0, node: this };
        this._ls.push(rec); pg.listeners.push(rec);
      },
      removeEventListener(type, fn) { this._ls = this._ls.filter(function (l) { return !(l.type === type && l.fn === fn); }); },
      focus() { doc.activeElement = this; },
      blur() { if (doc.activeElement === this) { doc.activeElement = doc.body; } },
      select() { }, click() { if (this.onclick) { this.onclick({ currentTarget: this, target: this }); } },
      scrollIntoView() { }, scrollTo() { },
      getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
      contains(o) { while (o) { if (o === this) { return true; } o = o.parentNode; } return false; },
      closest(sel) { const t = matcher(sel); let o = this; while (o && o.nodeType === 1) { if (t(o)) { return o; } o = o.parentNode; } return null; },
      querySelectorAll(sel) {
        const tests = String(sel).split(',').map(function (s) { return matcher(s.trim()); });
        const out = [];
        (function walk(list) {
          list.forEach(function (k) {
            if (tests.some(function (t) { return t(k); })) { out.push(k); }
            walk(k.kids.concat(k.children));
          });
        })(this.kids.concat(this.children));
        return out;
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    };
    Object.defineProperty(n, 'id', {
      get() { return this._id; },
      set(v) { this._id = String(v); this.attrs.id = this._id; if (this._id) { ids[this._id] = this; } }
    });
    Object.defineProperty(n, 'className', {
      get() { return this._class; },
      set(v) { this._class = String(v); }
    });
    Object.defineProperty(n, 'classList', {
      get() {
        const self = this;
        function list() { return self._class.split(/\s+/).filter(Boolean); }
        return {
          add() { const l = list(); Array.prototype.forEach.call(arguments, function (c) { if (l.indexOf(c) < 0) { l.push(c); } }); self._class = l.join(' '); },
          remove() { const out = Array.prototype.slice.call(arguments); self._class = list().filter(function (c) { return out.indexOf(c) < 0; }).join(' '); },
          contains(c) { return list().indexOf(c) >= 0; },
          toggle(c, on) { const has = list().indexOf(c) >= 0; const want = on === undefined ? !has : !!on; if (want) { this.add(c); } else { this.remove(c); } return want; }
        };
      }
    });
    Object.defineProperty(n, 'childNodes', { get() { return this.kids.concat(this.children); } });
    Object.defineProperty(n, 'firstChild', { get() { return this.childNodes[0] || null; } });
    Object.defineProperty(n, 'innerHTML', {
      get() { return this._html; },
      set(h) {
        this._html = String(h);
        this.children.forEach(function (c) { c.parentNode = null; });
        this.children = [];
        const self = this;
        this.kids = parse(this._html);
        this.kids.forEach(function (k) { k.parentNode = self; });
      }
    });
    return n;
  }
  function matcher(sel) {
    const last = String(sel).trim().split(/\s+/).pop();
    const m = /^([a-z0-9]*)(?:#([\w-]+))?((?:\.[\w-]+)*)(?:\[([\w-]+)(?:="([^"]*)")?\])?$/i.exec(last);
    if (!m) { return function () { return false; }; }
    const classes = m[3] ? m[3].split('.').filter(Boolean) : [];
    return function (el) {
      if (el.nodeType !== 1) { return false; }
      if (m[1] && el.tagName !== m[1].toUpperCase()) { return false; }
      if (m[2] && el.id !== m[2]) { return false; }
      const have = String(el.className).split(/\s+/);
      if (classes.some(function (c) { return have.indexOf(c) < 0; })) { return false; }
      if (m[4] && !el.hasAttribute(m[4])) { return false; }
      if (m[4] && m[5] !== undefined && el.getAttribute(m[4]) !== m[5]) { return false; }
      return true;
    };
  }
  const VOID = ['input', 'br', 'img', 'hr', 'meta', 'link', 'source', 'wbr', 'col'];
  function parse(html) {
    const out = [];
    const open = [];
    const tag = /<(\/?)([a-z0-9]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*(\/?)>/gi;
    let m;
    while ((m = tag.exec(html))) {
      const name = m[2].toLowerCase();
      if (m[1]) {
        for (let i = open.length - 1; i >= 0; i--) {
          if (open[i].tagName === name.toUpperCase()) { open.length = i; break; }
        }
        continue;
      }
      const el = Node(name);
      const attr = /([a-z-]+)(?:="([^"]*)")?/gi;
      let a;
      while ((a = attr.exec(m[3]))) { el.attrs[a[1]] = a[2] == null ? '' : unesc(a[2]); }
      if (el.attrs.id) { el.id = el.attrs.id; }
      el.className = el.attrs['class'] || '';
      const up = open[open.length - 1];
      if (up) { el.parentNode = up; up.kids.push(el); } else { out.push(el); }
      if (!m[4] && VOID.indexOf(name) < 0) { open.push(el); }
    }
    return out;
  }

  const win = {
    skyrimPlatform: { sendMessage(to, what) { pg.told.push(to + ' ' + what); } },
    thornswoodNet: { say(line) { pg.sent.push(line); return true; } },
    innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
    setTimeout() { return 1; }, clearTimeout() { }, setInterval() { return 1; }, clearInterval() { },
    requestAnimationFrame() { return 1; },
    MutationObserver: function () { this.observe = function () { }; this.disconnect = function () { }; },
    getComputedStyle() { return {}; },
    localStorage: { getItem() { return null; }, setItem() { }, removeItem() { } },
    console: { log() { }, warn() { }, error() { } },
    _ls: [], nodeType: 9,
    addEventListener(type, fn, opt) {
      const rec = { type: type, fn: fn, capture: opt === true || !!(opt && opt.capture), page: pg.loading, heard: 0, node: win };
      win._ls.push(rec); pg.listeners.push(rec);
    },
    removeEventListener(type, fn) { win._ls = win._ls.filter(function (l) { return !(l.type === type && l.fn === fn); }); }
  };
  win.window = win;
  const html = Node('html');
  const doc = Node('#document');
  doc.nodeType = 9;
  doc.documentElement = html;
  doc.head = Node('head');
  doc.body = Node('body');
  html.appendChild(doc.head);
  html.appendChild(doc.body);
  html.parentNode = doc;
  doc.readyState = 'complete';
  doc.activeElement = doc.body;
  doc.createElement = function (t) { return Node(t); };
  doc.createTextNode = function (t) { const n = Node('#text'); n.nodeType = 3; n.textContent = String(t); return n; };
  doc.getElementById = function (id) {
    const n = ids[id];
    if (!n) { return null; }
    let o = n;
    while (o && o !== doc) { o = o.parentNode; }
    return o === doc ? n : null;
  };
  doc.querySelector = function (sel) { return html.querySelector(sel); };
  doc.querySelectorAll = function (sel) { return html.querySelectorAll(sel); };
  doc.execCommand = function () { return true; };
  win.document = doc;

  // skymp's chat: a box inside React's root, with its own key listener.
  const reactRoot = Node('div');
  reactRoot.id = 'root';
  doc.body.appendChild(reactRoot);
  const chatBox = Node('span');
  chatBox.id = 'chatInput';
  chatBox.isContentEditable = true;
  reactRoot.appendChild(chatBox);
  pg.loading = 'chat';
  chatBox.addEventListener('keydown', function () { pg.chatHeard = (pg.chatHeard || 0) + 1; });

  vm.createContext(win);
  pg.win = win; pg.doc = doc; pg.chatBox = chatBox;
  pg.run = function (name, src) {
    pg.loading = name;
    vm.runInContext(src, win, { filename: name });
    pg.loading = '';
  };
  pg.fire = function (target, type, key, more) {
    const ev = Object.assign({
      type: type, key: key, target: target, repeat: false, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
      keyCode: key === 'Escape' ? 27 : key === 'Enter' ? 13 : (key && key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0),
      defaultPrevented: false, stopped: false, now: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
      stopImmediatePropagation() { this.stopped = true; this.now = true; }
    }, more || {});
    const pathUp = [];
    for (let o = target; o; o = o.parentNode) { pathUp.push(o); }
    pathUp.push(win);
    function run(node, capture, atTarget) {
      const list = node._ls.filter(function (l) { return l.type === type && (atTarget || l.capture === capture); });
      const ordered = atTarget ? list.filter(function (l) { return l.capture; }).concat(list.filter(function (l) { return !l.capture; })) : list;
      for (const l of ordered) {
        if (ev.now) { return; }
        ev.currentTarget = node;
        l.heard++;
        l.fn.call(node, ev);
      }
    }
    for (let i = pathUp.length - 1; i >= 1 && !ev.stopped; i--) { run(pathUp[i], true, false); }
    if (!ev.stopped) { run(pathUp[0], false, true); }
    for (let i = 1; i < pathUp.length && !ev.stopped; i++) { run(pathUp[i], false, false); }
    return ev;
  };
  pg.key = function (k, target) {
    const t = target || pg.doc.activeElement || pg.doc.body;
    const down = pg.fire(t, 'keydown', k);
    const press = k.length === 1 || k === 'Enter' ? pg.fire(t, 'keypress', k) : null;
    return { down: down, press: press };
  };
  return pg;
}

// --------------------------------------------------- the pages, and openers
const OVERLAYS = (function () {
  const m = /const OVERLAYS = (\[[\s\S]*?\]);/.exec(front);
  return m ? new Function('return ' + m[1])() : [];
})();
yes('the front\'s list of pages is read (' + OVERLAYS.length + ' pages)', OVERLAYS.length >= 10);

/*
  How each page is opened here, by its global, the way the front opens it.
  A page that listens for a key and has no line here fails A3.
*/
const ROWS = [
  { key: 'cover', name: 'Cover', stamina: 20, ready: true },
  { key: 'bash', name: 'Shield bash', stamina: 30, ready: true },
  { key: 'rally', name: 'Rally', stamina: 40, ready: false }
];
const OPEN = {
  'thornswood-help.js': { name: 'thornswoodHelp', open(p) { p.win.thornswoodHelp.open(); } },
  // Settings in the game (#3126): it listens for the key it is changing.
  'thornswood-settings.js': { name: 'thornswoodSettings', open(p) { p.win.thornswoodSettings.open(); } },
  'thornswood-maneuvers.js': { name: 'thornswoodManeuvers', open(p) { p.win.thornswoodManeuvers.setRows(ROWS, '9'); p.win.thornswoodManeuvers.open(); } },
  'thornswood-board.js': { name: 'thornswoodBoard', open(p) {
    p.win.thornswoodBoard.setData({ board: { hold: 'whiterun', x: 1, y: 2, z: 3, where: 'Whiterun', here: true, wall: [], jobs: [] } });
    p.win.thornswoodBoard.open();
  } },
  'thornswood-ride.js': { name: 'thornswoodRide', open(p) { p.win.thornswoodRide.setData({ open: true, name: 'Horse', stable: 'Whiterun' }); p.win.thornswoodRide.open(); } },
  // The hold's drop box (#2298): the server's view, with open, opens it.
  'thornswood-box.js': { name: 'thornswoodBox', open(p) { p.win.thornswoodBox.setData({ open: true, hold: 'whiterun', where: 'Whiterun', rows: [], pack: [], packGold: 5 }); } },
  'thornswood-repair.js': { name: 'thornswoodRepair', open(p) { p.win.thornswoodRepair.setData({ open: true, items: [] }); } },
  'thornswood-treat.js': { name: 'thornswoodTreat', open(p) { p.win.thornswoodTreat.setData({ open: true, needs: [] }); } },
  // Salting and smoking (#3163): the server's view, with open, opens it.
  'thornswood-preserve.js': { name: 'thornswoodPreserve', open(p) { p.win.thornswoodPreserve.setData({ open: true, may: true, salt: 2, wood: 1, fire: true, perWood: 5, rows: [] }); } },
  'thornswood-furniture.js': { name: 'thornswoodFurniture', open(p) { p.win.thornswoodFurniture.setData({ open: true, rows: [] }); } },
  'thornswood-merchant.js': { name: 'thornswoodMerchant', open(p) { p.win.thornswoodMerchant.setData({ open: true, trader: 'Belethor', offers: [] }); } },
  // The trade ships' dock (#2700): the server's view, with open, opens it.
  'thornswood-ship.js': { name: 'thornswoodShip', open(p) { p.win.thornswoodShip.setData({ open: true, mode: 'dock', port: { key: 'solitude', name: 'Solitude docks' }, holds: [], incoming: [], charter: { may: true, why: '' }, pack: [], people: [] }); } },
  // A market stall (#3160), the keeper's view, which has the boxes: the server's view, with open, opens it.
  'thornswood-stall.js': { name: 'thornswoodStall', open(p) {
    p.win.thornswoodStall.setData({ open: true, id: 'whiterun-6b0b6', place: 'Whiterun', free: false, mine: true, keeperHere: true,
      officer: false, lines: [], max: 24, said: '', pack: [{ base: '13982', nth: 0, count: 2, what: 'Iron Sword' }], found: [], lapseDays: 14 });
  } },
  'thornswood-afk.js': { name: 'thornswoodAfk', open(p) { p.win.thornswoodAfk.ask(60); } },
  'thornswood-journal.js': { name: 'thornswoodJournal', open(p) { p.win.thornswoodJournal.open(); } },
  'thornswood-trade.js': { name: 'thornswoodTrade', open(p) { p.win.thornswoodTrade.open(); } },
  'thornswood-party.js': { name: 'thornswoodParty', open(p) { p.win.thornswoodParty.open(); } },
  'thornswood-skills.js': { name: 'thornswoodSkills', open(p) { p.win.thornswoodSkills.open(); } }
};
// Found by the id the bridge looks for, since it has no isOpen.
const BY_ID = { 'thornswood-emotes.js': 'thornswood-wheel' };

function load(file) {
  const p = makePage();
  p.run('thornswood-bridge.js', bridgeSrc);
  p.run(file, read('game', 'ui', file));
  // Anything added from here on is the page's: it is the only one in.
  p.loading = file;
  return p;
}
function pageListeners(p, file) {
  return p.listeners.filter(function (l) {
    return l.page === file && /^key/.test(l.type) && (l.node === p.win || l.node === p.doc);
  });
}

// =========================================================== A. every page
attempt('A', function () {
  OVERLAYS.forEach(function (file) {
    const src = read('game', 'ui', file);
    const bubble = /(document|window)\.addEventListener\(\s*'key(down|press|up)'\s*,\s*function\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}\s*\)/.test(src) ||
                   /(document|window)\.addEventListener\(\s*'key(down|press|up)'\s*,\s*\w+\s*\)/.test(src);
    const box = /<input|<textarea|createElement\('(input|textarea)'\)/.test(src);
    if (!bubble && !box) { return; }
    if (BY_ID[file]) {
      yes('A1 ' + file + ' is found by the bridge by its id, ' + BY_ID[file],
          bridgeSrc.indexOf("getElementById('" + BY_ID[file] + "')") >= 0);
      return;
    }
    const global = /window\.(thornswood\w+) = \{[\s\S]*?isOpen\s*:/.exec(src);
    yes('A1 ' + file + (bubble ? ' listens for a key on the bubble' : ' has a box to type in') +
        ', and hangs ' + (global ? global[1] : 'nothing') + ' with an isOpen on window', !!global);
    yes('A3 and this harness opens it and presses its keys', !!OPEN[file] && (!global || OPEN[file].name === global[1]));
  });
  yes('A2 the bridge asks every thornswood global with an isOpen, not a list of names',
      /Object\.keys\(window\)/.test(bridgeSrc) && /indexOf\('thornswood'\) !== 0/.test(bridgeSrc) &&
      !/window\.thornswoodJournal\.isOpen\(\)/.test(bridgeSrc));
});

// =================================================== B. a key reaches them
attempt('B', function () {
  Object.keys(OPEN).forEach(function (file) {
    attempt('B ' + file, function () {
      const p = load(file);
      const o = OPEN[file];
      yes('B0 ' + file + ' loads beside the bridge, shut', !!p.win[o.name] && !p.win[o.name].isOpen());
      o.open(p);
      yes('B1 ' + file + ' opens', p.win[o.name].isOpen());
      const mine = pageListeners(p, file);
      const before = mine.map(function (l) { return l.heard; });
      // A key no panel answers, so the panel stays up for the next check.
      p.key('Shift', p.doc.body);
      const missed = mine.filter(function (l, i) { return l.type === 'keydown' && l.heard === before[i]; });
      yes('B2 ' + file + ' up, a key reaches every key listener it put on the document or window (' +
          mine.filter(function (l) { return l.type === 'keydown'; }).length + ')' +
          (missed.length ? ', not ' + missed.length : ''), missed.length === 0);
      /*
        A letter typed into a box. A box some page draws only for data this
        does not give it (the rent on K's Office page, a journal's title) is
        stood in for by a box put in the page: what is held here is the
        bridge's part, and the bridge does not look at which box it is.
      */
      let boxes = p.doc.body.querySelectorAll('input').concat(p.doc.body.querySelectorAll('textarea'));
      const which = boxes.length ? (boxes[0].id || boxes[0].tagName.toLowerCase()) : 'a box put in the page';
      if (!boxes.length && /<input|<textarea|createElement\('(input|textarea)'\)/.test(read('game', 'ui', file))) {
        boxes = [p.doc.body.appendChild(p.doc.createElement('input'))];
      }
      if (boxes.length) {
        p.fire(boxes[0], 'keydown', 'a');
        const t = p.fire(boxes[0], 'keypress', 'a');
        yes('B3 ' + file + ' up, a letter typed into ' + which + ' is not refused',
            !t.defaultPrevented && !t.stopped);
      }
    });
  });
});

// ================================================= C. what each does with it
function told(p, what) { return p.told.indexOf('thornswood-front ' + what) >= 0; }
function escCloses(file, name, more) {
  attempt('C ' + file, function () {
    const p = load(file);
    OPEN[file].open(p);
    p.key('Escape', p.doc.body);
    yes('C1 Escape closes the ' + name + ' panel with the bridge in the page', !p.win[OPEN[file].name].isOpen());
    if (more) { more(p); }
  });
}
escCloses('thornswood-board.js', 'board');
escCloses('thornswood-settings.js', 'settings');
escCloses('thornswood-box.js', 'box');
escCloses('thornswood-ride.js', 'ride');
escCloses('thornswood-repair.js', 'repair');
escCloses('thornswood-treat.js', 'treat');
escCloses('thornswood-preserve.js', 'preserve');
escCloses('thornswood-furniture.js', 'furniture');
escCloses('thornswood-party.js', 'party');
escCloses('thornswood-ship.js', 'ship', function (p) {
  yes('C1 and tells the server the dock is left', p.sent.indexOf('/ship close') >= 0);
});
escCloses('thornswood-merchant.js', 'merchant', function (p) {
  yes('C1 and tells the server the trader is left', p.sent.indexOf('/merchant close') >= 0);
});
escCloses('thornswood-journal.js', 'journal', function (p) {
  OPEN['thornswood-journal.js'].open(p);
  p.key('j', p.doc.body);
  yes('C2 J closes the journal', !p.win.thornswoodJournal.isOpen());
});
escCloses('thornswood-help.js', 'help', function (p) {
  p.win.thornswoodHelp.open();
  p.key('k', p.doc.body);
  yes('C2 another key leaves the help up', p.win.thornswoodHelp.isOpen());
  p.key('F7', p.doc.body);
  yes('C2 F7, the help key, closes it', !p.win.thornswoodHelp.isOpen());
});
escCloses('thornswood-maneuvers.js', 'maneuver', function (p) {
  const m = p.win.thornswoodManeuvers;
  m.open();
  p.key('9', p.doc.body);
  yes('C3 the maneuver key closes the maneuvers, starting nothing', !m.isOpen() && p.sent.length === 0);
  m.open();
  p.key('2', p.doc.body);
  yes('C3 2 starts the second maneuver and closes the panel',
      p.sent.join('|') === '/maneuver bash' && !m.isOpen());
});
attempt('C trade', function () {
  const p = load('thornswood-trade.js');
  OPEN['thornswood-trade.js'].open(p);
  p.key('Escape', p.doc.body);
  yes('C4 Escape on a trade walks away from it', p.sent.indexOf('/trade cancel') >= 0);
});
attempt('C afk', function () {
  const p = load('thornswood-afk.js');
  OPEN['thornswood-afk.js'].open(p);
  p.key('Enter', p.doc.body);
  yes('C5 Enter answers the away prompt and puts it down', !p.win.thornswoodAfk.isOpen() && told(p, 'afk:here'));
});

// ====================================================== D. no panel up
attempt('D', function () {
  const p = load('thornswood-help.js');
  const h = p.win.thornswoodHelp;
  const mine = pageListeners(p, 'thornswood-help.js');
  p.chatBox.focus();
  let r = p.key('w', p.chatBox);
  yes('D1 with no panel up, a game key aimed at the chat box stops at the bridge',
      !p.chatHeard && r.down.stopped);
  yes('D1 and its letter is refused', r.press.defaultPrevented);
  h.open();
  h.close();
  const before = mine.map(function (l) { return l.heard; });
  p.key('Escape', p.doc.body);
  yes('D2 and once the help is shut, its listener hears nothing',
      mine.every(function (l, i) { return l.heard === before[i]; }));
  p.win.thornswoodTyping = true;
  r = p.key('w', p.chatBox);
  yes('D3 while somebody is typing, the key reaches the chat box', p.chatHeard === 1 && !r.press.defaultPrevented);
});

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
