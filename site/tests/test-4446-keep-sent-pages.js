'use strict';
/*
  test-4446-keep-sent-pages.js

      node site\tests\test-4446-keep-sent-pages.js
      node site\tests\test-4446-keep-sent-pages.js <an older home.js>

  Issue #4446. The site sends /news, /roadmap and /gallery with their content
  already in #pagebody (publicPageBody in site/lib/public.js), and home.js
  asks the API again on those pages. When that ask failed, or took longer than
  its 15 seconds, home.js put "Could not load it." over the whole page, so a
  page that had loaded fine turned into an error with no way to try again.
  And an empty roadmap read one way from the server and another from home.js.

  site\public\home.js is run in a stand-in page at each of the three pages:
    A  the server sent the page, and the ask fails: the page is left as sent;
    B  the server sent the page, and the ask takes longer than its time: left
       as sent too;
    C  the page came with nothing, and the ask fails: it says it could not
       load, with a Try again button that loads the page again;
    D  the server sent the page, and the ask answers: the page is drawn from
       the answer, as before;
    E  an empty roadmap says the server's words, with the known issues link.

  Nothing leaves the machine.
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const HOME_JS = fs.readFileSync(path.resolve(process.argv[2] || path.join(ROOT, 'site', 'public', 'home.js')), 'utf8');

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).trim().slice(0, 400).split('\n').join('\n      ') : '')); }
}
const tick = () => new Promise((ok) => setImmediate(ok));

/* ---- a stand-in page for home.js (as test-4393-public-data-once.js) --- */
function anything(name) {
  const data = {};
  return new Proxy(function () { }, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return (hint) => (hint === 'number' ? 0 : '');
      if (k === 'then') return undefined;
      if (Object.prototype.hasOwnProperty.call(data, k)) return data[k];
      return anything(name + '.' + String(k));
    },
    set(t, k, v) { data[k] = v; return true; },
    apply() { return anything(name + '()'); },
    construct() { return anything('new ' + name); }
  });
}
function element(id) {
  const e = { id: id, listeners: {}, attrs: {}, kids: {} };
  const base = {
    addEventListener(type, fn) { (e.listeners[type] = e.listeners[type] || []).push(fn); },
    setAttribute(k, v) { e.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(e.attrs, k) ? e.attrs[k] : null; },
    insertAdjacentHTML() { },
    querySelector(sel) { return (e.kids[sel] = e.kids[sel] || element(id + ' ' + sel)).el; },
    querySelectorAll() { return []; },
    appendChild() { }, removeChild() { }, focus() { }, click() { }, blur() { },
    classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } },
    style: {}, children: [], dataset: {}
  };
  e.el = new Proxy({}, {
    get(t, k) {
      if (Object.prototype.hasOwnProperty.call(e, 'p_' + String(k))) return e['p_' + String(k)];
      if (Object.prototype.hasOwnProperty.call(base, k)) return base[k];
      return undefined;
    },
    set(t, k, v) { e['p_' + String(k)] = v; return true; }
  });
  return e;
}

const SENT = '<h1>Sent by the server</h1><p>The content the server wrote.</p>';
const ASKS = { '/roadmap': '/api/roadmap', '/news': '/api/releases', '/gallery': '/api/public' };
const TITLES = { '/roadmap': 'Roadmap', '/news': 'Every release', '/gallery': 'From the world' };
const ANSWERS = {
  '/roadmap': { sections: [{ name: 'Next', columns: [{ id: 'what', name: 'What' }], rows: [{ cells: { what: 'Drawn from the answer' } }] }] },
  '/news': { news: [{ date: '27 Nov 2026', title: 'Drawn from the answer', details: ['a line'] }] },
  '/gallery': { open: false, status: { up: false, online: 0, max: 30 }, gallery: [], galleryTotal: 0, galleryNext: null, news: [], files: [], lines: [] }
};

/* Runs home.js at a page. sent: whether the server wrote the page's body.
   how: 'fail' (the ask is refused), 'slow' (it never answers, and the
   request's own give-up timer fires), or an answer to give. */
async function load(pathname, sent, how) {
  const els = {};
  const byId = (id) => (els[id] = els[id] || element(id)).el;
  const body = (els.pagebody = element('pagebody'));
  body.p_innerHTML = sent ? SENT : '';
  body.p_children = sent ? [{}, {}] : [];
  let reloads = 0;
  const fetchStub = (url) => {
    const u = String(url);
    if (u.startsWith(ASKS[pathname])) {
      if (how === 'fail') return Promise.reject(new TypeError('Failed to fetch'));
      if (how === 'slow') return new Promise(() => { });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(how))) });
    }
    // Any other ask, the status line's and the gallery's who, never answers.
    return new Promise(() => { });
  };
  // The page's request gives up after 15 seconds; here that is at once.
  const timers = [];
  const pageTimeout = (fn, ms) => { if (ms >= 15000 && how === 'slow') timers.push(fn); return 0; };
  const document = anything('document');
  const doc = new Proxy({}, {
    get(t, k) {
      if (k === 'getElementById') return byId;
      if (k === 'title') return 'Thornswood';
      if (k === 'cookie') return '';
      if (k === 'querySelectorAll') return () => [];
      if (k === 'querySelector') return () => null;
      return document[k];
    },
    set() { return true; }
  });
  const win = anything('window');
  win.AbortController = AbortController;
  win.matchMedia = () => ({ matches: false });
  win.addEventListener = () => { };
  const ctx = {
    window: win, document: doc, fetch: fetchStub, console: { log() { }, error() { } },
    location: { pathname: pathname, hash: '', protocol: 'https:', reload() { reloads++; } },
    localStorage: { getItem() { return null; }, setItem() { }, removeItem() { } },
    navigator: anything('navigator'), setTimeout: pageTimeout, clearTimeout() { }, setInterval() { return 0; }, clearInterval() { },
    requestAnimationFrame() { }, AbortController, URL
  };
  vm.createContext(ctx);
  let threw = null;
  try { vm.runInContext(HOME_JS, ctx, { filename: 'home.js' }); } catch (e) { threw = e; }
  for (let i = 0; i < 10; i++) await tick();
  timers.splice(0).forEach((fn) => fn());
  for (let i = 0; i < 20; i++) await tick();
  const again = els.pageAgain;
  return {
    threw, html: String(body.p_innerHTML || ''),
    landingHidden: !!(els.landing && els.landing.p_hidden),
    again, clickAgain() { ((again && again.listeners.click) || []).forEach((fn) => fn({ preventDefault() { } })); return reloads; }
  };
}

(async () => {
  for (const page of ['/roadmap', '/news', '/gallery']) {
    console.log(page + ':');
    let r = await load(page, true, 'fail');
    yes('A the server sent it and the ask fails: the page is left as sent' + (r.threw ? ' [home.js threw: ' + r.threw.message + ']' : ''),
      !r.threw && r.html === SENT, r.html);

    r = await load(page, true, 'slow');
    yes('B the server sent it and the ask runs past its time: left as sent', !r.threw && r.html === SENT, r.html);

    r = await load(page, false, 'fail');
    const title = TITLES[page];
    yes('C it came with nothing and the ask fails: it says so under its heading',
      !r.threw && r.html.indexOf('<h1>' + title + '</h1>') === 0 && /Could not load it\./.test(r.html), r.html);
    yes('C with a Try again button', /<button[^>]*id="pageAgain"[^>]*>Try again<\/button>/.test(r.html) && !!r.again, r.html);
    yes('C and pressing it loads the page again', !!r.again && r.clickAgain() === 1);

    r = await load(page, true, ANSWERS[page]);
    const drawn = page === '/gallery' ? r.html.indexOf('<h1>From the world</h1>') === 0 && r.html !== SENT
      : r.html.indexOf('Drawn from the answer') >= 0;
    yes('D the server sent it and the ask answers: the page is drawn from the answer', !r.threw && drawn, r.html);
  }

  console.log('\nthe empty roadmap:');
  const server = fs.readFileSync(path.join(ROOT, 'site', 'lib', 'public.js'), 'utf8');
  const m = /body \+= '(<p>No upcoming work[^']*<\/p>)'/.exec(server);
  yes('E site/lib/public.js has its words for an empty roadmap', !!m);
  const r = await load('/roadmap', true, { sections: [{ name: 'Next', columns: [], rows: [] }] });
  yes('E home.js says the same words, with the known issues link', !!m && r.html.indexOf(m[1].replace(/\\"/g, '"')) >= 0, r.html);
  yes('E and not its own different line', !/Nothing on it yet/.test(r.html));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.log('FAIL  the harness itself threw: ' + String(e && e.stack || e).replace(/\n/g, '\n      ')); process.exitCode = 1; });
