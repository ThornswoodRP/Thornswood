'use strict';
/*
  test-4330-downloads-first-paint.js

      node site/tests/test-4330-downloads-first-paint.js

  #4330: the Downloads page drew once, then its script swapped the whole body
  a moment later, for the age gate or for the steps it built once
  /api/public answered, so everything on the page jumped. The site now sends
  the right body the first time, and the page's script draws nothing over it.

  A. A real copy of the site, in a scratch folder, asked for /downloads:
     - with no age cookie, the first response holds the gate in the page
       body, the front hidden, and none of the steps;
     - with tw-age-18 holding the gate's policy, among other cookies, the
       first response holds the steps and the download button, and no gate;
     - another policy's value, or a cookie whose name only ends in
       tw-age-18, is the gate;
     - neither answer is marked for Cloudflare's edge, both are private and
       vary on the cookie, while the other public pages still are marked;
     - /api/downloads hands out the same body the page carries, and
       /api/public the same facts it is drawn from.
  B. home.js's router, run against a stand-in page, for each body the site
     can send: it never draws over the steps, never draws over the gate when
     no statement is kept, gives the gate's button its click, and asks for
     the body only when the statement is kept in localStorage alone.

  Writes only to its scratch folder, which it removes.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const vm = require('vm');
const { spawn } = require('child_process');
const siteFiles = require('../../tests/site-files');

const APP = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const HOME_JS = fs.readFileSync(path.join(APP, 'public', 'home.js'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4330-'));
let srv = null;

function freePort() {
  return new Promise((ok, bad) => {
    const s = net.createServer();
    s.once('error', bad);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
// Waits for this run's own "listening on ...:port" line (#1727).
function listening(child, port) {
  return new Promise((ok, bad) => {
    let out = '';
    const said = (d) => {
      out += d;
      const m = /\[thornswood-docs\] listening on \S+:(\d+)/.exec(out);
      if (m && Number(m[1]) === port) end(null);
    };
    const gone = (code) => end(new Error('the site stopped (exit ' + code + ') before it was listening. It printed:\n' + out));
    const late = setTimeout(() => end(new Error('the site did not say it was listening within fifteen seconds. It printed:\n' + out)), 15000);
    function end(err) {
      clearTimeout(late);
      child.stdout.removeListener('data', said);
      child.removeListener('close', gone);
      if (err) bad(err); else ok();
    }
    child.stdout.on('data', said);
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', gone);
  });
}
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
// What is inside the page's body, as the site sent it: from the body's own
// tag to the two closing tags just before </main> (home.html).
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
  cfg.discord = Object.assign({}, cfg.discord, { invite: 'https://discord.gg/harness' });
  fs.writeFileSync(path.join(work, 'config.json'), JSON.stringify(cfg));
  // A file the downloads folder publishes, so the page has a button to draw.
  const H = 'a'.repeat(64);
  fs.mkdirSync(path.join(work, 'files'), { recursive: true });
  fs.writeFileSync(path.join(work, 'files', 'Thornswood-Tools.exe'), 'MZ the harness file');
  fs.writeFileSync(path.join(work, 'files', 'files.json'), JSON.stringify({
    'Thornswood-Tools.exe': { label: 'Tools', version: '2026-11-09 16:31', sha256: H }
  }));

  const port = await freePort();
  srv = spawn(process.execPath, [path.join(work, 'server.js')], {
    cwd: work, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_LOCAL: '1', THORNSWOOD_DOCS_PORT: String(port),
      THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1', THORNSWOOD_CHAT_DIR: path.join(work, 'chat') })
  });
  await listening(srv, port);

  const bare = await ask(port, '/downloads');
  const gateBody = pagebody(bare.body);
  yes('A1 /downloads with no age cookie answers 200', bare.status === 200);
  yes('A2 its first response has the age gate in the page body', !!gateBody && /^<div class="age-gate" id="ageGate">/.test(gateBody) &&
      /id="ageYes"/.test(gateBody));
  yes('A3   with the front hidden, so nothing is drawn under it first', bare.body.indexOf('<div id="landing" hidden>') >= 0 &&
      bare.body.indexOf('id="page" hidden') < 0);
  yes('A4   and none of the steps or the download button', !!gateBody && gateBody.indexOf('four steps') < 0 &&
      gateBody.indexOf('Download the installer') < 0);
  yes('A5   and one heading, the gate\'s', (bare.body.match(/<h1\b/g) || []).length === 1);

  const stated = await ask(port, '/downloads', 'twa=x; tw-age-18=1; other=2');
  const dlBody = pagebody(stated.body);
  yes('A6 with tw-age-18 holding the policy, among other cookies, its first response is the page', stated.status === 200 &&
      !!dlBody && /^<h1>Download<\/h1>/.test(dlBody));
  yes('A7   with the steps and the download button', !!dlBody && dlBody.indexOf('then four steps</h2>') > 0 &&
      dlBody.indexOf('<a class="btn first" href="/file/Thornswood-Tools.exe">Download the installer</a>') > 0 &&
      dlBody.indexOf(H) > 0 && dlBody.indexOf('11-9-2026 4:31 PM') > 0);
  yes('A8   and no gate', stated.body.indexOf('id="ageGate"') < 0);
  yes('A9   and the invite from the site\'s config', !!dlBody && dlBody.indexOf('href="https://discord.gg/harness"') > 0);

  const other = await ask(port, '/downloads', 'tw-age-18=0');
  const lookalike = await ask(port, '/downloads', 'xtw-age-18=1');
  const longer = await ask(port, '/downloads', 'tw-age-18=12');
  yes('A10 another policy\'s value is the gate', other.body.indexOf('id="ageGate"') > 0 && other.body.indexOf('four steps') < 0);
  yes('A11 a cookie whose name only ends in tw-age-18 is the gate', lookalike.body.indexOf('id="ageGate"') > 0);
  yes('A12 a value that only starts with the policy is the gate', longer.body.indexOf('id="ageGate"') > 0);

  for (const [what, r] of [['the gate', bare], ['the page', stated]]) {
    yes('A13 ' + what + ' is never marked for Cloudflare\'s edge', r.headers['cloudflare-cdn-cache-control'] === undefined);
    yes('A14 ' + what + ' is private, asked again each time, and varies on the cookie',
        /\bprivate\b/.test(r.headers['cache-control'] || '') && /\bno-cache\b/.test(r.headers['cache-control'] || '') &&
        /\bcookie\b/i.test(r.headers.vary || ''));
  }
  const rules = await ask(port, '/rules');
  yes('A15 the other public pages are still kept at the edge', rules.headers['cloudflare-cdn-cache-control'] === 'max-age=300');

  const api = await ask(port, '/api/downloads');
  let apiHtml = null;
  try { apiHtml = JSON.parse(api.body).html; } catch (e) { apiHtml = null; }
  yes('A16 /api/downloads hands out the same body the page carries', api.status === 200 && apiHtml === dlBody);
  const pub = await ask(port, '/api/public');
  let p = {};
  try { p = JSON.parse(pub.body); } catch (e) { p = {}; }
  yes('A17 /api/public carries the facts the page is drawn from',
      p.open === false && p.invite === 'https://discord.gg/harness' &&
      Array.isArray(p.files) && p.files.some((f) => f.name === 'Thornswood-Tools.exe' && f.sha256 === H) &&
      typeof p.collectionRevision === 'number');
  return { gateBody, dlBody };
}

// --------------------------------------------- B. the page's script --
/* home.js run against a stand-in page that already holds what the site sent.
   statement: 'cookie', 'store' (localStorage only) or 'none'. */
function runPage(sent, statement, apiHtml) {
  const noop = function () { };
  const els = {};
  const shown = [];
  function el(id) {
    if (id === 'ageGate' && sent !== 'gate') return null;
    if (id === 'ageYes' && sent !== 'gate') return null;
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
  el('pagebody').innerHTML = 'AS SENT';
  Object.defineProperty(el('pagebody'), 'innerHTML', {
    get() { return this._html; }, set(v) { this._html = v; shown.push(v); }, configurable: true });
  el('pagebody')._html = 'AS SENT';
  const fetched = [];
  const store = {};
  const T = Date.now();
  if (statement === 'store') store['tw-age-18'] = JSON.stringify({ v: 1, until: T + 100 * 86400000 });
  const box = {
    document: { getElementById: el, querySelector: function () { return null; },
      querySelectorAll: function () { return []; }, addEventListener: noop, title: 'Download \u00b7 Thornswood',
      createElement: function () { return el('made' + Math.random()); },
      cookie: statement === 'cookie' ? 'tw-age-18=1' : '' },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; },
      removeItem: (k) => { delete store[k]; } },
    location: { pathname: '/downloads', hash: '', protocol: 'https:', reload: noop },
    fetch: function (u) {
      fetched.push(u);
      if (u === '/api/downloads') return Promise.resolve({ ok: true, json: () => Promise.resolve({ html: apiHtml }) });
      return new Promise(noop);
    },
    setTimeout, clearTimeout,
    requestAnimationFrame: function (f) { f(); },
    matchMedia: function () { return { matches: false }; },
    addEventListener: noop
  };
  box.window = box;
  vm.runInNewContext(HOME_JS, box);
  return { shown, fetched, els, store };
}
const tick = () => new Promise((r) => setTimeout(r, 30));

async function pageChecks(apiHtml) {
  const steps = runPage('page', 'cookie', apiHtml);
  await tick();
  yes('B1 the steps the site sent are never drawn over', steps.shown.length === 0 && steps.fetched.indexOf('/api/downloads') < 0 &&
      steps.fetched.indexOf('/api/public?galleryLimit=24') < 0);

  const gate = runPage('gate', 'none', apiHtml);
  await tick();
  yes('B2 the gate the site sent is never drawn over when no statement is kept', gate.shown.length === 0 &&
      gate.fetched.indexOf('/api/downloads') < 0);
  yes('B3   and its button gets its click, and the focus', typeof gate.els.ageYes.listeners.click === 'function' &&
      gate.els.ageYes.focused === true);
  gate.els.ageYes.listeners.click();
  yes('B4   and a press keeps the statement, as on /join', /tw-age-18/.test(Object.keys(gate.store).join()));

  const stored = runPage('gate', 'store', apiHtml);
  await tick();
  yes('B5 a statement kept in localStorage alone asks /api/downloads for the body and shows it',
      stored.fetched.indexOf('/api/downloads') >= 0 && stored.shown.length === 1 && stored.shown[0] === apiHtml);
  yes('B6 home.js no longer builds the Downloads page itself',
      HOME_JS.indexOf('Download the installer') < 0 && HOME_JS.indexOf('then four steps') < 0);
  yes('B7 and its own gate is for /join alone', /var AGE_PATHS = \{ '\/join': 1 \};/.test(HOME_JS));
}

(async function main() {
  try {
    const got = await siteChecks();
    await pageChecks(got.dlBody || '<h1>Download</h1>');
  } catch (e) {
    fail++; console.log('FAIL  the harness itself threw: ' + (e && e.stack || e));
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
  process.exit(fail ? 1 : 0);
})();
