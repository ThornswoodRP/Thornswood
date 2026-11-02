'use strict';
/*
  test-5033-hub-current-page.js

      node tests\test-5033-hub-current-page.js

  #5033. Three things on the staff hub left a screen reader, or anybody who
  reads small print, short:

    - the open tab was told apart only by its colour and its weight: nothing
      in the page said which one was the current page;
    - a tab change drew the new page and said nothing, and only Home had a
      top heading (every other page was an h2 under no h1), so there was no
      heading to move to or to land on;
    - some of the coloured small print was under the 4.5 to 1 contrast WCAG
      2.2 1.4.3 asks for: the tab's level word, the red and grey pills, the
      red inbox kind, the sign in's error, the refused log set's line, and
      every line of an inbox note that was set aside.

  This runs the real site/public/hub.js against a small stand-in page and
  reads site/public/hub.css as it ships:

    A. after a tab change the open tab, and only it, carries
       aria-current="page";
    B. every page the hub can open has exactly one h1, its own name, which
       can take focus;
    C. a tab change and the back button move focus to that heading, and the
       first draw after sign in does not take focus anywhere;
    D. every coloured small print rule is 4.5 to 1 or more on every ground
       the hub draws it on, every rule that colours text red, green, grey or
       dull gold is one measured here, and nothing with text is faded with
       opacity;
    E. the same measure goes red on the colours hub.css had before, so it
       cannot pass by reading nothing.

  Read only. Nothing leaves the machine.
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HUB_JS = fs.readFileSync(path.join(ROOT, 'site', 'public', 'hub.js'), 'utf8').split('\r\n').join('\n');
const HUB_CSS = fs.readFileSync(path.join(ROOT, 'site', 'public', 'hub.css'), 'utf8').split('\r\n').join('\n');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

/* ------------------------------------------------------- a stand-in page -- */
/*
  Only what hub.js reaches for. An element keeps its attributes; setting
  innerHTML on the tab list or the page makes the tabs and the page's h1 from
  the markup, so what draw() and go() do to them is read back from the same
  objects the page would hold.
*/
function attrsOf(tag) {
  const out = {};
  const re = /([\w-]+)(?:="([^"]*)")?/g;
  let m;
  const body = tag.replace(/^<\w+/, '').replace(/>$/, '');
  while ((m = re.exec(body))) out[m[1]] = m[2] === undefined ? '' : m[2];
  return out;
}
function makePage() {
  const doc = { activeElement: null, title: '', body: null };
  function node(id, tag, attrs) {
    const n = {
      id: id, tagName: tag || 'DIV', attrs: Object.assign({}, attrs || {}), dataset: {}, style: {},
      className: (attrs && attrs.class) || '', hidden: false, value: '', scrollTop: 0,
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      _html: '', _kids: [], _h1: null,
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      removeAttribute(k) { delete this.attrs[k]; },
      hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); },
      focus() { doc.activeElement = this; },
      insertAdjacentHTML(where, h) { this.innerHTML = h + this._html; },
      appendChild() {}, insertBefore() {}, removeChild() {},
      addEventListener() {},
      querySelectorAll(sel) { return sel === 'a.tab' ? this._kids.slice() : []; },
      querySelector(sel) { return sel === 'h1' ? this._h1 : null; }
    };
    Object.defineProperty(n, 'innerHTML', {
      get() { return this._html; },
      set(v) {
        this._html = String(v);
        this._kids = [];
        const re = /<a class="tab"[^>]*>/g;
        let m;
        while ((m = re.exec(this._html))) {
          const a = attrsOf(m[0]);
          const k = node('', 'A', a);
          k.dataset.k = a['data-k'];
          this._kids.push(k);
        }
        const h = /<h1\b[^>]*>/.exec(this._html);
        this._h1 = h ? node('', 'H1', attrsOf(h[0])) : null;
        if (this._h1 && /\bid="/.test(h[0])) byId[this._h1.attrs.id] = this._h1;
      }
    });
    return n;
  }
  const byId = {};
  ['gate', 'shell', 'tabs', 'whoami', 'page', 'go', 'pw', 'err', 'gatediscord', 'pwbox', 'out']
    .forEach(function (id) { byId[id] = node(id); });
  const main = node('', 'MAIN');
  doc.body = node('', 'BODY');
  doc.getElementById = function (id) { return byId[id] || null; };
  doc.querySelector = function (sel) { return sel === 'main' ? main : null; };
  doc.querySelectorAll = function () { return []; };
  doc.addEventListener = function () {};
  doc.createElement = function (t) { return node('', String(t).toUpperCase()); };
  const pushed = [];
  const box = {
    document: doc,
    location: { pathname: '/hub', search: '', href: '' },
    history: { pushState(s, t, u) { pushed.push(u); }, replaceState() {} },
    localStorage: { getItem() { return null; }, setItem() {} },
    // Never answers: the test sets the state itself, so nothing waits on it.
    fetch: function () { return new Promise(function () {}); },
    marked: { parse: function (s) { return '<p>' + String(s) + '</p>'; }, parseInline: String,
              setOptions() {}, use() {} },
    URLSearchParams, setTimeout: function () { return 0; }, clearTimeout() {},
    alert() {}, confirm() { return true; }, navigator: {}, console
  };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(HUB_JS, box, { filename: 'hub.js' });
  return { box, doc, byId, pushed };
}

/* Signed in as an admin with the levels the server sends, the way start()
   leaves it, then drawn once as start() draws it. */
function signedIn() {
  const p = makePage();
  vm.runInContext(
    "S.me = { member: true, admin: true, dev: true, name: 'Ada' };" +
    "S.level = { uploads: 'staff', linked: 'staff', sessions: 'admin', inbox: 'admin', economy: 'admin' };" +
    "S.titles = {};" +
    'chrome();', p.box);
  return p;
}
function boot(p, pathname) {
  p.box.location.pathname = pathname;
  // start()'s own last line, read out of hub.js so the test draws the way
  // the page does after sign in.
  const m = /el\('shell'\)\.style\.display = 'grid';\s*\n\s*chrome\(\);\s*\n\s*(go\([^;]*\);)/.exec(HUB_JS);
  vm.runInContext(m ? m[1] : 'go(keyFor(location.pathname), false);', p.box);
  return !!m;
}

const PAGES = ['home', 'uploads', 'sessions', 'linked', 'inbox', 'economy'];
const NAMES = { home: 'Hub', uploads: 'Gallery', sessions: 'Play sessions', linked: 'Linked accounts',
                inbox: 'Inbox', economy: 'Hold economy' };

function tabs(p) { return p.byId.tabs.querySelectorAll('a.tab'); }
function marked(p) {
  return tabs(p).filter(function (a) { return a.getAttribute('aria-current') === 'page'; })
    .map(function (a) { return a.dataset.k; });
}
function text(h) { return h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function h1s(html) {
  const out = [];
  const re = /<h1\b[^>]*>([\s\S]*?)<\/h1>/g;
  let m;
  while ((m = re.exec(html))) out.push(m);
  return out;
}

/* ----------------------------------------------------------- A, B and C -- */
{
  const p = signedIn();
  yes('the hub draws a tab for each of its six pages (' + tabs(p).map(function (a) { return a.dataset.k; }).join(', ') + ')',
      PAGES.every(function (k) { return tabs(p).some(function (a) { return a.dataset.k === k; }); }));

  yes('A0 start() draws the first page the way this test does', boot(p, '/hub'));
  yes('C1 the first draw after sign in takes focus nowhere', p.doc.activeElement === null);
  yes('A1 after sign in, Home is the current page and the only one (' + marked(p).join(', ') + ')',
      marked(p).join() === 'home');

  PAGES.slice(1).concat(['home']).forEach(function (k) {
    p.doc.activeElement = null;
    vm.runInContext("go('" + k + "');", p.box);
    const cur = marked(p);
    yes('A2 ' + k + ': its tab is marked the current page, and no other is (' + cur.join(', ') + ')',
        cur.length === 1 && cur[0] === k);
    const on = tabs(p).filter(function (a) { return a.dataset.k === k; })[0];
    yes('A3 ' + k + ': the mark rides with the colour, on the tab that is drawn open',
        !!on && /\bon\b/.test(on.className) &&
        tabs(p).every(function (a) { return a === on || !/\bon\b/.test(a.className); }));

    const html = p.byId.page.innerHTML;
    const hs = h1s(html);
    yes('B1 ' + k + ': the page has one top heading (' + hs.length + ' h1)', hs.length === 1);
    yes('B2 ' + k + ': it is the page\'s own name, ' + NAMES[k] + ' (' + (hs[0] ? text(hs[0][1]) : 'none') + ')',
        !!hs[0] && text(hs[0][1]).indexOf(NAMES[k]) === 0);
    yes('B3 ' + k + ': it can take focus without joining the Tab order (tabindex="-1")',
        !!hs[0] && /\btabindex="-1"/.test(hs[0][0]));
    yes('B4 ' + k + ': no h2 comes before it', !!hs[0] && html.slice(0, hs[0].index).indexOf('<h2') < 0);
    const a = p.doc.activeElement;
    yes('C2 ' + k + ': the tab change moves focus to that heading',
        !!a && a.tagName === 'H1' && a === p.byId.page.querySelector('h1'));
  });

  // The back button: the address changes and go() is called with push false.
  p.doc.activeElement = null;
  p.box.location.pathname = '/sessions';
  vm.runInContext('window.onpopstate();', p.box);
  const a = p.doc.activeElement;
  yes('C3 the back button is a page change too: focus is on the Play sessions heading',
      !!a && a.tagName === 'H1' && marked(p).join() === 'sessions');

  // A redraw that is not a page change (typing in the sessions search) leaves
  // focus where it is, so the heading does not take the caret out of the box.
  const box = { tagName: 'INPUT' };
  p.doc.activeElement = box;
  vm.runInContext('drawSessions();', p.box);
  yes('C4 a redraw of the same page leaves focus alone', p.doc.activeElement === box);
}

/* ------------------------------------------------------------ contrast -- */
const MIN = 4.5;
function rgbOf(s) {
  s = String(s).trim();
  let m = /^#([0-9A-Fa-f]{6})$/.exec(s);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 };
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  return null;
}
function over(top, under) {
  const a = top.a;
  return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 };
}
function lin(v) { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }
function lum(c) { return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b); }
function ratio(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

function sheet(css) {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const root = /:root\{([^}]*)\}/.exec(flat);
  const vars = {};
  if (root) {
    const re = /--([\w-]+):\s*([^;]+);?/g;
    let m;
    while ((m = re.exec(root[1]))) vars[m[1]] = m[2].trim();
  }
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let r;
  while ((r = re.exec(flat))) {
    const decl = {};
    r[2].split(';').forEach(function (d) {
      const i = d.indexOf(':');
      if (i > 0) decl[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    });
    rules.push({ sel: r[1].trim().replace(/\s+/g, ' '), decl: decl });
  }
  const colour = function (v) {
    if (!v) return null;
    const m = /^var\(--([\w-]+)\)$/.exec(v.trim());
    return rgbOf(m ? vars[m[1]] || '' : v);
  };
  const rule = function (sel) { return rules.filter(function (x) { return x.sel === sel; })[0] || null; };
  return { vars, rules, colour, rule };
}

/* The grounds small print sits on, from the sheet: the three panels, the
   tint a session row takes when it went wrong or would not play (and when a
   pointer is over it), over the page and over a panel. */
function grounds(s) {
  const ink = s.colour('var(--ink)'), panel = s.colour('var(--panel)'), raised = s.colour('var(--raised)');
  const g = { ink, panel, raised };
  [['bad', 'table.board tr.bad td'], ['bad hover', 'table.board tr.bad:hover td'],
   ['warn', 'table.board tr.warn td'], ['warn hover', 'table.board tr.warn:hover td']].forEach(function (t) {
    const r = s.rule(t[1]);
    const c = r && s.colour(r.decl.background);
    if (c && ink) g[t[0] + ' row on ink'] = over(c, ink);
    if (c && panel) g[t[0] + ' row on panel'] = over(c, panel);
  });
  return g;
}

/*
  Every rule that colours small print red, green, grey or dull gold, or is a
  pill or an inbox kind, and the grounds it is drawn on. 'own' is a rule that
  brings its own background. A rule of that kind not named here fails, so
  its ground is looked at before it ships.
*/
const PILL = ['ink', 'panel', 'bad row on ink', 'bad hover row on ink', 'warn row on ink',
              'warn hover row on ink', 'warn row on panel', 'warn hover row on panel'];
const KNOWN = {
  '.pill.pass': PILL, '.pill.fail': PILL, '.pill.skip': PILL, '.pill.left': PILL, '.pill.warn': PILL,
  '.note .kind.bug': ['panel'], '.note .kind.idea': ['panel'],
  'nav a.tab .key': ['panel', 'raised'],
  '#gate .err': ['ink'],
  '.prov .warn': ['panel'],
  '.cmd .copy.done': ['raised'],
  'table.board th .x:hover': ['raised'],
  'td.rowacts button.del:hover': ['raised'],
  '.res .mark.on[data-v=pass]': ['own'], '.res .mark.on[data-v=fail]': ['own'], '.res .mark.on[data-v=skip]': ['own']
};
const WATCHED = /^var\(--(pass|fail|skip|gold-dim)\)$/;

function measure(css) {
  const s = sheet(css);
  const g = grounds(s);
  const lines = [], low = [], unknown = [], gone = [];
  s.rules.forEach(function (r) {
    const watched = (r.decl.color && WATCHED.test(r.decl.color)) ||
      /^\.pill\.|^\.note \.kind\./.test(r.sel) ||
      (r.decl.background && WATCHED.test(r.decl.background) && r.decl.color);
    if (watched && !(r.sel in KNOWN)) unknown.push(r.sel);
  });
  Object.keys(KNOWN).forEach(function (sel) {
    const r = s.rule(sel);
    if (!r) { gone.push(sel); return; }
    const fg = s.colour(r.decl.color);
    const bg = s.colour(r.decl.background);
    if (!fg) { gone.push(sel + ' (no colour)'); return; }
    KNOWN[sel].forEach(function (name) {
      let ground;
      if (name === 'own') ground = bg;
      else ground = g[name] && (bg && bg.a < 1 ? over(bg, g[name]) : (bg && bg.a === 1 ? bg : g[name]));
      if (!ground) { gone.push(sel + ' on ' + name + ' (no ground)'); return; }
      const c = ratio(fg, ground);
      lines.push({ sel, name, c });
      if (c < MIN) low.push(sel + ' on ' + name + ' ' + c.toFixed(2));
    });
  });
  const faded = s.rules.filter(function (r) {
    return r.decl.opacity !== undefined && Number(r.decl.opacity) < 1 && !/:disabled/.test(r.sel);
  }).map(function (r) { return r.sel + ' opacity ' + r.decl.opacity; });
  // The edit tint under the pointer stacks on a row's own tint and a pill's,
  // so it may only be where a cell can be edited.
  const tinted = s.rules.filter(function (r) {
    return /\.cell:hover/.test(r.sel) && r.decl.background && r.decl.background !== 'none' &&
      !r.sel.split(',').every(function (one) { return /^\.edit /.test(one.trim()); });
  }).map(function (r) { return r.sel; });
  return { lines, low, unknown, gone, faded, tinted };
}

{
  const now = measure(HUB_CSS);
  // The lowest ratio of each rule, for the pull request.
  const worst = {};
  now.lines.forEach(function (l) { if (!worst[l.sel] || l.c < worst[l.sel].c) worst[l.sel] = l; });
  Object.keys(worst).forEach(function (sel) {
    console.log('      ' + sel + ': ' + worst[sel].c.toFixed(2) + ' to 1 at its lowest, on ' + worst[sel].name);
  });
  yes('D1 every rule measured is in hub.css with its colour' + (now.gone.length ? ' (not: ' + now.gone.join(' | ') + ')' : ''),
      now.gone.length === 0);
  yes('D2 every coloured small print rule is 4.5 to 1 or more on every ground it sits on' +
      (now.low.length ? ' (not: ' + now.low.join(' | ') + ')' : ''), now.low.length === 0);
  yes('D3 every rule that colours text red, green, grey or dull gold is one measured here' +
      (now.unknown.length ? ' (not measured: ' + now.unknown.join(' | ') + ')' : ''), now.unknown.length === 0);
  yes('D4 nothing with text in it is faded with opacity, which no colour check can see' +
      (now.faded.length ? ' (' + now.faded.join(' | ') + ')' : ''), now.faded.length === 0);
  yes('D5 the measure covers ' + now.lines.length + ' pairs', now.lines.length >= 50);
  yes('D6 the edit tint under the pointer is only on a board an admin can edit' +
      (now.tinted.length ? ' (also on: ' + now.tinted.join(' | ') + ')' : ''), now.tinted.length === 0);
  const board = /out \+= '<div class="tablewrap' \+ \(admin \? ' edit' : ''\) \+ '"><table class="board">/.test(HUB_JS);
  yes('D7 and that board marks its table .edit for an admin, and no other table is marked', board &&
      (HUB_JS.match(/' edit'/g) || []).length === 1);
}

/* ------------------------------------------------- E, the old colours -- */
{
  const old = HUB_CSS
    .replace(/--pass:#[0-9A-Fa-f]{6}/, '--pass:#6FA05A')
    .replace(/--fail:#[0-9A-Fa-f]{6}/, '--fail:#C05A4E')
    .replace(/--skip:#[0-9A-Fa-f]{6}/, '--skip:#7C8493')
    .replace(/(nav a\.tab \.key\{[^}]*color:)var\(--[\w-]+\)/, '$1var(--gold-dim)')
    .replace(/\.note\.done\{[^}]*\}/, '.note.done{opacity:.55}');
  const was = measure(old);
  const has = function (sel) { return was.low.some(function (l) { return l.indexOf(sel + ' on ') === 0; }); };
  yes('E1 the measure finds the old red pill under 4.5 to 1', has('.pill.fail'));
  yes('E2 and the old grey pill', has('.pill.skip'));
  yes('E3 and the old green pill on a panel (4.49 to 1)', has('.pill.pass'));
  yes('E4 and the old dull gold level word on the open tab', has('nav a.tab .key'));
  yes('E5 and the old red inbox kind and the sign in\'s error', has('.note .kind.bug') && has('#gate .err'));
  yes('E6 and the old faded inbox note', was.faded.some(function (f) { return f.indexOf('.note.done') === 0; }));
  const tint = measure(HUB_CSS.replace(/\.edit \.cell:hover\{/, '.cell:hover{'));
  yes('E7 and the old edit tint on every cell', tint.tinted.indexOf('.cell:hover') >= 0);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
