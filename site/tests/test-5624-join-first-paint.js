'use strict';
/*
  test-5624-join-first-paint.js

      node site/tests/test-5624-join-first-paint.js

  #5624: the How to join page arrived with its words in it, then the page's
  script swapped the whole body for the age gate when the browser had no age
  statement, so the page jumped the way Downloads did before #4330. The site
  now sends /join whole, the gate or the page, by the browser's cookie, and
  the page's script draws nothing over either.

  A. A real copy of the site, in a scratch folder, asked for /join:
     - with no age cookie, the first response holds the gate in the page
       body, the front hidden, and none of the page's words;
     - with tw-age-18 holding the gate's policy, among other cookies, the
       first response holds the page and no gate;
     - both carry the page's own title, neither is marked for Cloudflare's
       edge, and both are private and vary on the cookie;
     - /api/page/join hands out the same body the page carries.
  B. home.js's router at /join, run against a stand-in page, for each body
     the site can send: it never draws over the page, never draws over the
     gate when no statement is kept, gives the gate's button its click, asks
     /api/page/join only when the statement is kept in localStorage alone,
     and says under the page's name when that ask fails.

  Writes only to its scratch folder, which it removes.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const vm = require('vm');
const { spawn } = require('child_process');
const siteFiles = require('../../tests/site-files');
// The page's own timers are unref'd, as a page's timers never hold a
// process open (#6036).
const pageTimeout = (fn, ms, ...args) => setTimeout(fn, ms, ...args).unref();

const APP = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const HOME_JS = fs.readFileSync(path.join(APP, 'public', 'home.js'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-5624-'));
let srv = null;

function ask(port, route, cookie) {
  return new Promise((ok, bad) => {
    const headers = { accept: 'text/html' };
    if (cookie !== undefined) headers.cookie = cookie;
    const req = http.request({ host: '127.0.0.1', port, path: route, headers, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', bad);
    req.setTimeout(10000, () => req.destroy(new Error('no answer to ' + route)));
    req.end();
  });
}
// What is inside the page's body, as the site sent it (home.html).
function pagebody(html) {
  const head = '<div class="page" id="page"><div class="wrap" id="pagebody">';
  const a = html.indexOf(head);
  const m = a < 0 ? null : /<\/div><\/div>\r?\n<\/main>/.exec(html.slice(a));
  return m ? html.slice(a + head.length, a + m.index) : null;
}

// ------------------------------------------------------- A. the site --
async function siteChecks() {
  siteFiles.copy(work);
  fs.cpSync(path.join(APP, 'public'), path.join(work, 'public'), { recursive: true });
  fs.cpSync(path.join(APP, 'data'), path.join(work, 'data'), { recursive: true });
  const cfg = Object.assign(JSON.parse(fs.readFileSync(path.join(APP, 'config.example.json'), 'utf8')), {
    secret: 'a test secret, not the real one',
    // Port 1, which nothing listens on, so the game never reads as up (#1816).
    gameCheckPort: 1,
    onlineFile: path.join(work, 'online.json')
  });
  fs.writeFileSync(path.join(work, 'config.json'), JSON.stringify(cfg));

  srv = spawn(process.execPath, [path.join(work, 'server.js')], {
    cwd: work, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_LOCAL: '1', THORNSWOOD_DOCS_PORT: '0',
      THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1', THORNSWOOD_CHAT_DIR: path.join(work, 'chat') })
  });
  const port = (await siteFiles.listening(srv)).port;

  const bare = await ask(port, '/join');
  const gateBody = pagebody(bare.body);
  yes('A1 /join with no age cookie answers 200', bare.status === 200);
  yes('A2 its first response has the age gate in the page body', !!gateBody &&
      /^<div class="age-gate" id="ageGate">/.test(gateBody) && /id="ageYes"/.test(gateBody));
  yes('A3   with the front hidden, so nothing is drawn under it first', bare.body.indexOf('<div id="landing" hidden>') >= 0 &&
      bare.body.indexOf('id="page" hidden') < 0);
  yes('A4   and none of the page\'s words', !!gateBody && gateBody.indexOf('What you need') < 0 &&
      gateBody.indexOf('Skyrim Special Edition') < 0);
  yes('A5   and one heading, the gate\'s', (bare.body.match(/<h1\b/g) || []).length === 1);
  yes('A6   and a way on without JavaScript that is not a gated page', /<noscript>[\s\S]*href="\/help"[\s\S]*<\/noscript>/.test(gateBody || '') &&
      !/<noscript>[\s\S]*href="\/(?:join|downloads)"[\s\S]*<\/noscript>/.test(gateBody || ''));

  const stated = await ask(port, '/join', 'twa=x; tw-age-18=1; other=2');
  const joinBody = pagebody(stated.body);
  yes('A7 with tw-age-18 holding the policy, among other cookies, its first response is the page',
      stated.status === 200 && !!joinBody && /^<h1[^>]*>How to join<\/h1>/.test(joinBody) && joinBody.indexOf('What you need') > 0);
  yes('A8   and no gate', stated.body.indexOf('id="ageGate"') < 0);

  const other = await ask(port, '/join', 'tw-age-18=0');
  yes('A9 another policy\'s value is the gate', other.body.indexOf('id="ageGate"') > 0 && (pagebody(other.body) || '').indexOf('What you need') < 0);

  for (const [what, r] of [['the gate', bare], ['the page', stated]]) {
    yes('A10 ' + what + ' carries the page\'s own title', /<title>How to join · Thornswood<\/title>/.test(r.body));
    yes('A11 ' + what + ' is never marked for Cloudflare\'s edge', r.headers['cloudflare-cdn-cache-control'] === undefined);
    yes('A12 ' + what + ' is private, asked again each time, and varies on the cookie',
        /\bprivate\b/.test(r.headers['cache-control'] || '') && /\bno-cache\b/.test(r.headers['cache-control'] || '') &&
        /\bcookie\b/i.test(r.headers.vary || ''));
  }
  const rules = await ask(port, '/rules');
  yes('A13 the other written pages are still kept at the edge, with no gate', rules.headers['cloudflare-cdn-cache-control'] === 'max-age=300' &&
      rules.body.indexOf('id="ageGate"') < 0);

  const api = await ask(port, '/api/page/join');
  let apiHtml = null;
  try { apiHtml = JSON.parse(api.body).html; } catch (e) { apiHtml = null; }
  yes('A14 /api/page/join hands out the same body the page carries', api.status === 200 && apiHtml === joinBody);
  return { joinBody };
}

// --------------------------------------------- B. the page's script --
/* home.js at /join against a stand-in page that already holds what the site
   sent. sent: 'gate' or 'page'. statement: 'cookie', 'store' (localStorage
   only) or 'none'. answer: what /api/page/join gives, or null for a refusal. */
function runPage(sent, statement, answer) {
  const noop = function () { };
  const els = {};
  const shown = [];
  let reloads = 0;
  function el(id) {
    if ((id === 'ageGate' || id === 'ageYes') && sent !== 'gate') return null;
    if (!els[id]) {
      els[id] = { id, hidden: false, innerHTML: '', textContent: '', className: '', style: {},
        children: { length: 0 }, listeners: {}, focused: false,
        setAttribute: noop, getAttribute: function () { return null; },
        addEventListener: function (ev, fn) { this.listeners[ev] = fn; },
        focus: function () { this.focused = true; },
        querySelectorAll: function () { return []; }, querySelector: function () { return null; },
        appendChild: noop, insertAdjacentHTML: noop };
    }
    return els[id];
  }
  el('pagebody').children.length = 3;
  Object.defineProperty(el('pagebody'), 'innerHTML', {
    get() { return this._html; }, set(v) { this._html = v; shown.push(v); }, configurable: true });
  el('pagebody')._html = 'AS SENT';
  const fetched = [];
  const store = {};
  if (statement === 'store') store['tw-age-18'] = JSON.stringify({ v: 1, until: Date.now() + 100 * 86400000 });
  const box = {
    document: { getElementById: el, querySelector: function () { return null; },
      querySelectorAll: function () { return []; }, addEventListener: noop, title: 'How to join · Thornswood',
      createElement: function () { return el('made' + Math.random()); },
      cookie: statement === 'cookie' ? 'tw-age-18=1' : '' },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; },
      removeItem: (k) => { delete store[k]; } },
    location: { pathname: '/join', hash: '', protocol: 'https:', reload: function () { reloads++; } },
    fetch: function (u) {
      fetched.push(u);
      if (u === '/api/page/join') {
        return answer === null ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
          : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ html: answer }) });
      }
      return new Promise(noop);
    },
    setTimeout: pageTimeout, clearTimeout,
    requestAnimationFrame: function (f) { f(); },
    matchMedia: function () { return { matches: false }; },
    addEventListener: noop
  };
  box.window = box;
  vm.runInNewContext(HOME_JS, box);
  return { shown, fetched, els, store, reloads: () => reloads };
}
const tick = () => new Promise((r) => setTimeout(r, 30));

async function pageChecks(joinBody) {
  const page = runPage('page', 'cookie', joinBody);
  await tick();
  yes('B1 the page the site sent is never drawn over', page.shown.length === 0 && page.fetched.indexOf('/api/page/join') < 0);

  const gate = runPage('gate', 'none', joinBody);
  await tick();
  yes('B2 the gate the site sent is never drawn over when no statement is kept', gate.shown.length === 0 &&
      gate.fetched.indexOf('/api/page/join') < 0);
  yes('B3   and its button gets its click, and the focus', typeof gate.els.ageYes.listeners.click === 'function' &&
      gate.els.ageYes.focused === true);
  gate.els.ageYes.listeners.click();
  yes('B4   and a press keeps the statement and loads the page again', /tw-age-18/.test(Object.keys(gate.store).join()) &&
      gate.reloads() === 1);

  const stored = runPage('gate', 'store', joinBody);
  await tick();
  yes('B5 a statement kept in localStorage alone asks /api/page/join for the body and shows it',
      stored.fetched.indexOf('/api/page/join') >= 0 && stored.shown.length === 1 && stored.shown[0] === joinBody);

  const refused = runPage('gate', 'store', null);
  await tick();
  const said = refused.shown[refused.shown.length - 1] || '';
  yes('B6 when that ask fails, it says so under the page\'s name, with Try again',
      /^<h1>How to join<\/h1><p>Could not load it\./.test(said) && /id="pageAgain"/.test(said));

  yes('B7 home.js draws no age gate of its own', HOME_JS.indexOf('function showAgeGate') < 0 &&
      HOME_JS.indexOf('AGE_PATHS') < 0 && HOME_JS.indexOf('class="age-gate"') < 0);
}

(async function main() {
  try {
    const got = await siteChecks();
    await pageChecks(got.joinBody || '<h1>How to join</h1>');
  } catch (e) {
    fail++; console.log('FAIL  the harness itself threw: ' + String(e && e.stack || e).replace(/\n/g, '\n      '));
  } finally {
    if (srv && srv.exitCode === null) {
      const gone = new Promise((r) => srv.once('exit', r));
      try { srv.kill(); } catch (e) { /* gone already */ }
      await gone;
    }
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
