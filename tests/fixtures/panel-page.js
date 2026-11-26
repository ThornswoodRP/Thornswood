'use strict';
// Browser-order stand-in shared by the real page regressions.
const vm = require('vm');

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
        const list = this.children.indexOf(c) >= 0 ? this.children : this.kids;
        const i = list.indexOf(c);
        if (i >= 0) { list.splice(i, 1); c.parentNode = null; }
        return c;
      },
      insertBefore(c, ref) {
        if (!ref) { return this.appendChild(c); }
        if (c === ref) { return c; }
        if (c.parentNode) { c.parentNode.removeChild(c); }
        const list = this.kids.indexOf(ref) >= 0 ? this.kids : this.children;
        const at = list.indexOf(ref);
        if (at < 0) { return this.appendChild(c); }
        list.splice(at, 0, c); c.parentNode = this; return c;
      },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      getAttributeNames() { return Object.keys(this.attrs); },
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
    // disabled is the attribute, as in a browser, so markup that leaves it
    // off enables a control a page had disabled and an update kept.
    Object.defineProperty(n, 'disabled', {
      get() { return this.hasAttribute('disabled'); },
      set(v) { if (v) { this.attrs.disabled = ''; } else { delete this.attrs.disabled; } }
    });
    Object.defineProperty(n, 'childNodes', { get() { return this.kids.concat(this.children); } });
    Object.defineProperty(n, 'textContent', {
      get() { return String(this._text || '') + this.childNodes.map(c => c.textContent).join(''); },
      set(text) {
        this._text = String(text);
        this.childNodes.forEach(c => { c.parentNode = null; });
        this.children = []; this.kids = [];
      }
    });
    Object.defineProperty(n, 'firstChild', { get() { return this.childNodes[0] || null; } });
    Object.defineProperty(n, 'nextSibling', {
      get() { const up = this.parentNode; if (!up || !up.childNodes) { return null; } const all = up.childNodes; return all[all.indexOf(this) + 1] || null; }
    });
    Object.defineProperty(n, 'nodeValue', {
      get() { return this.nodeType === 1 ? null : String(this._text || ''); },
      set(v) { if (this.nodeType !== 1) { this._text = String(v); } }
    });
    Object.defineProperty(n, 'innerHTML', {
      // What is in the node now, as a browser reads it back, so a node
      // changed in place (thornswoodDialog.patch) reads as it now is.
      get() { return (this._text ? escText(this._text) : '') + this.childNodes.map(outer).join(''); },
      set(h) {
        this._html = String(h);
        this._text = '';
        this.childNodes.forEach(function (c) { c.parentNode = null; });
        this.children = [];
        const self = this;
        this.kids = parse(this._html);
        this.kids.forEach(function (k) { k.parentNode = self; });
      }
    });
    return n;
  }
  function escText(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function outer(k) {
    if (k.nodeType !== 1) { return escText(k._text || ''); }
    const tag = k.tagName.toLowerCase();
    const all = Object.assign({}, k.attrs);
    if (k._class) { all['class'] = k._class; } else { delete all['class']; }
    const attrs = Object.keys(all).map(function (a) { return ' ' + a + '="' + escText(all[a]).replace(/"/g, '&quot;') + '"'; }).join('');
    return '<' + tag + attrs + '>' + (VOID.indexOf(tag) >= 0 ? '' : k.innerHTML + '</' + tag + '>');
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
    let m, end = 0;
    function words(text) {
      if (!text) return;
      const n = Node('#text'); n.nodeType = 3; n.textContent = unesc(text);
      const up = open[open.length - 1];
      if (up) { n.parentNode = up; up.kids.push(n); } else out.push(n);
    }
    while ((m = tag.exec(html))) {
      words(html.slice(end, m.index)); end = tag.lastIndex;
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
    words(html.slice(end));
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
  // The node with that id that is in the document, as a browser has it: a
  // detached copy made with the same id (a parsed model, a removed row) is not.
  function mounted(n) { let o = n; while (o && o !== doc) { o = o.parentNode; } return o === doc; }
  doc.getElementById = function (id) {
    const n = ids[id];
    if (n && mounted(n)) { return n; }
    let found = null;
    (function walk(list) {
      for (const k of list) { if (found) { return; } if (k.nodeType === 1 && k._id === String(id)) { found = k; return; } walk(k.childNodes); }
    })(html.childNodes);
    if (found) { ids[id] = found; }
    return found;
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

module.exports = makePage;
