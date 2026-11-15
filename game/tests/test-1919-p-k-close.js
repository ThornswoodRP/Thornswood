// test-1919-p-k-close.js
//
// P closes the P panel and K closes the K panel, heard by the page (#1919).
//
// Both panels said their own key closes them: the P panel's footer reads
// "Escape or P closes this", and the K panel's Close button carries a K. The
// front's P and K branches toggle the panels on a buttonEvent, and while a
// panel holds the keyboard the fork hands the game no key down (#898), so no
// buttonEvent comes and the key did nothing. J on the journal (#530) and G on
// the emote wheel (#1852) were the same fault. Now each page hears its key and
// closes itself, which tells the front, which lets the keyboard go.
//
// What runs: the real bridge and the real page, together, in a stand-in
// document that dispatches a key the way a browser does, and the front read
// for the line that tells each page which key is its own.
//
//   A. The P panel: P closes it, either case, and Escape still does. A
//      repeat, P with Ctrl or Alt, another letter, and P coming up leave it
//      up. Rebound, the bound key closes it and the footer names it; a key
//      the front has no name for leaves Escape alone.
//   B. The K panel: the same, and K typed into the Office page's rent box is
//      the box's. The Close button's key cap names the bound key.
//   C. The front tells each page its key when the page says it is ready,
//      as the Controls page binds it.
//
// PARTY=<file>, SKILLS=<file> or FRONT=<file> runs another copy, for instance
// the one before this fix.
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
function read(p) {
  return fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), 'utf8').split(CR).join('');
}
const bridgeSrc = read(path.join('game', 'ui', 'thornswood-bridge.js'));
const partySrc = read(process.env.PARTY || path.join('game', 'ui', 'thornswood-party.js'));
const skillsSrc = read(process.env.SKILLS || path.join('game', 'ui', 'thornswood-skills.js'));
const front = read(process.env.FRONT || path.join('game', 'plugins', 'thornswood-front.js'));

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
  The stand-in game/tests/test-1917-panel-keys.js uses: nodes with a parent,
  listeners kept by phase, and a dispatch in the browser's order. Markup
  written with innerHTML becomes child nodes, found again by id, tag, class
  or attribute.
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

function load(file, src) {
  const p = makePage();
  p.run('thornswood-bridge.js', bridgeSrc);
  p.run(file, src);
  p.loading = file;
  return p;
}
function told(p, what) { return p.told.indexOf('thornswood-front ' + what) >= 0; }
function down(p, k, more, target) { return p.fire(target || p.doc.body, 'keydown', k, more); }

// ========================================================== A. the P panel
attempt('A', function () {
  const p = load('thornswood-party.js', partySrc);
  const P = p.win.thornswoodParty;
  P.setData({ friends: [], party: null });
  function foot() { const f = p.doc.getElementById('ts-party-foot'); return f ? f.textContent : ''; }
  P.open();
  yes('A0 the P panel opens', P.isOpen() && told(p, 'party:opened'));
  yes('A0 and its footer says Escape or P closes it', foot() === 'Escape or P closes this.');
  up(p, 'p');
  yes('A1 P coming up, all the page hears of the tap that opened it, leaves it up', P.isOpen());
  down(p, 'p', { repeat: true });
  yes('A2 a repeat of P leaves it up', P.isOpen());
  down(p, 'p', { ctrlKey: true });
  down(p, 'p', { altKey: true });
  yes('A2 P with Ctrl or Alt leaves it up', P.isOpen());
  down(p, 'k');
  yes('A2 another letter leaves it up', P.isOpen());
  const ev = down(p, 'p');
  yes('A3 P closes it, with the bridge in the page', !P.isOpen() && ev.defaultPrevented);
  yes('A3 and tells the front, which lets the keyboard go', told(p, 'party:closed'));
  P.open();
  down(p, 'P');
  yes('A3 P with Shift closes it too', !P.isOpen());
  P.open();
  down(p, 'Escape');
  yes('A4 Escape still closes it', !P.isOpen());
  down(p, 'p');
  yes('A4 with it shut, P is not the page\'s to open it', !P.isOpen());

  P.setKey('O');
  P.open();
  yes('A5 rebound to O, the footer names O', foot() === 'Escape or O closes this.');
  down(p, 'p');
  yes('A5 P no longer closes it', P.isOpen());
  down(p, 'o');
  yes('A5 and O does', !P.isOpen());
  P.setKey('#57');
  P.open();
  yes('A6 a key the front has no name for: the footer names Escape only', foot() === 'Escape closes this.');
  down(p, '#');
  down(p, 'o');
  yes('A6 and no letter closes it', P.isOpen());
  down(p, 'Escape');
  yes('A6 Escape does', !P.isOpen());
});
function up(p, k) { return p.fire(p.doc.body, 'keyup', k); }

// ========================================================== B. the K panel
attempt('B', function () {
  const p = load('thornswood-skills.js', skillsSrc);
  const K = p.win.thornswoodSkills;
  const cap = p.doc.body.querySelector('.key');
  K.open();
  yes('B0 the K panel opens', K.isOpen() && told(p, 'skills:opened'));
  yes('B0 and its Close button carries the key it is told, K until then', !!cap && cap.textContent === 'K' &&
      /var keyName = 'K';/.test(skillsSrc));
  up(p, 'k');
  yes('B1 K coming up, all the page hears of the tap that opened it, leaves it up', K.isOpen());
  down(p, 'k', { repeat: true });
  down(p, 'k', { ctrlKey: true });
  down(p, 'p');
  yes('B2 a repeat, K with Ctrl, and another letter leave it up', K.isOpen());
  const rent = p.doc.body.appendChild(p.doc.createElement('input'));
  rent.focus();
  down(p, 'k', null, rent);
  yes('B3 K typed into the rent box is the box\'s', K.isOpen());
  down(p, 'Escape', null, rent);
  yes('B3 and Escape there still closes it', !K.isOpen());
  p.doc.body.focus();
  K.open();
  const ev = down(p, 'k');
  yes('B4 K closes it, with the bridge in the page', !K.isOpen() && ev.defaultPrevented);
  yes('B4 and tells the front, which lets the keyboard go', told(p, 'skills:closed'));
  K.open();
  down(p, 'K');
  yes('B4 K with Shift closes it too', !K.isOpen());

  K.setKey('Q');
  K.open();
  yes('B5 rebound to Q, the Close button carries a Q', !!cap && cap.textContent === 'Q');
  down(p, 'k');
  yes('B5 K no longer closes it', K.isOpen());
  down(p, 'q');
  yes('B5 and Q does', !K.isOpen());
  K.setKey('#57');
  K.open();
  yes('B6 a key the front has no name for: the Close button shows no key', !!cap && cap.style.display === 'none');
  down(p, 'q');
  yes('B6 and no letter closes it', K.isOpen());
});

// =========================================================== C. the front
attempt('C', function () {
  yes('C1 on party:ready the front hands the P panel PartyKey\'s name',
      /if \(what === 'party:ready'\) \{\s*T\.js\('try\{window\.thornswoodParty&&window\.thornswoodParty\.setKey&&window\.thornswoodParty\.setKey\(' \+\s*JSON\.stringify\(PARTY_NAME\)/.test(front));
  yes('C2 on skills:ready the front hands the K panel SkillsKey\'s name',
      /if \(what === 'skills:ready'\) \{[\s\S]{0,400}?window\.thornswoodSkills\.setKey\(' \+\s*JSON\.stringify\(keyName\(SKILLS_KEY\)\)/.test(front));
  yes('C3 PartyKey is P and SkillsKey is K unless rebound',
      /(?:const|let) PARTY_KEY\s+= iniNumber\(ini, 'PartyKey', 25\);/.test(front) &&
      /(?:const|let) SKILLS_KEY = iniNumber\(ini, 'SkillsKey', 37\);/.test(front));
  const kn = /\n  function keyName\(code\) \{[\s\S]*?\n  \}\n/.exec(front);
  const keyName = kn ? new Function(kn[0] + '\nreturn keyName;')() : null;
  yes('C4 and the front calls 25 P and 37 K, the letters the pages compare',
      !!keyName && keyName(25) === 'P' && keyName(37) === 'K');
});

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
