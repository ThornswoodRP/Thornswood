'use strict';
/*
  test-4393-public-data-once.js

      node tests\test-4393-public-data-once.js

  Issue #4393. Every public page asks the site for its public data
  (/api/public). The gallery page asked twice on every load: once for its
  pictures and once more in the part of the page script every page runs, for
  the status line, the news and the front page's pictures. And the answer
  carried no ETag, so a browser fetched the whole of it every time. This holds:

    A  ONE ASK A LOAD. site\public\home.js, run in a stand-in page at each
       public page, asks for /api/public once, and only once, per load.
    B  304 WHEN NOTHING CHANGED. A copy of the site answers /api/public with
       an ETag; asked again with it, it answers 304 with no body; with a
       weak copy of the tag (W/, as a proxy that compresses sends it) or the
       tag in a list, 304 too; with another tag, the whole answer; and once
       the answer changes, a new tag and the whole answer.

  Nothing leaves the machine. The scratch folder is removed at the end.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const vm = require('vm');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('./site-files');

const ROOT = path.join(__dirname, '..');
const HOME_JS = fs.readFileSync(path.join(ROOT, 'site', 'public', 'home.js'), 'utf8');

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).trim().split('\n').join('\n      ') : '')); }
}
const tick = () => new Promise((ok) => setImmediate(ok));

/* ---- a stand-in page for home.js (as test-4389-report-gallery-a11y.js) --- */
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
const PUBLIC_ANSWER = { open: false, invite: '', patreon: '', status: { up: false, online: 0, max: 30 },
  gallery: [], galleryTotal: 0, galleryNext: null, news: [], files: [], lines: [] };
async function asksOn(pathname) {
  const els = {};
  const byId = (id) => (els[id] = els[id] || element(id)).el;
  const asked = [];
  const fetchStub = (url) => {
    asked.push(String(url));
    // /api/public answers, so whatever runs after it runs; anything else
    // never does, which asks nothing more of the page than a slow site would.
    if (!String(url).startsWith('/api/public')) return new Promise(() => { });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(PUBLIC_ANSWER))) });
  };
  const document = anything('document');
  const doc = new Proxy({}, {
    get(t, k) {
      if (k === 'getElementById') return byId;
      if (k === 'title') return 'Thornswood';
      if (k === 'cookie') return '';
      if (k === 'querySelectorAll') return () => [];
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
    location: { pathname: pathname, hash: '', protocol: 'https:', reload() { } },
    localStorage: { getItem() { return null; }, setItem() { }, removeItem() { } },
    navigator: anything('navigator'), setTimeout, clearTimeout, setInterval() { return 0; }, clearInterval() { },
    requestAnimationFrame() { }, AbortController, URL
  };
  vm.createContext(ctx);
  let threw = null;
  try { vm.runInContext(HOME_JS, ctx, { filename: 'home.js' }); } catch (e) { threw = e; }
  for (let i = 0; i < 30; i++) await tick();
  return { asked, threw };
}

function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
function get(port, where, headers) {
  return new Promise((done) => {
    http.get({ host: '127.0.0.1', port: port, path: where, headers: headers || {}, agent: false }, (res) => {
      const parts = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
    }).on('error', (e) => done({ status: 0, headers: {}, body: Buffer.from(String(e)) }));
  });
}

(async () => {
  // ---- A. one ask a load ---------------------------------------------------
  for (const page of ['/', '/gallery', '/downloads', '/rules', '/world', '/join', '/help', '/news', '/roadmap', '/report']) {
    const r = await asksOn(page);
    const pub = r.asked.filter((u) => u.startsWith('/api/public'));
    yes('A ' + page + ' asks for the public data once a load (' + pub.length + ': ' + pub.join(', ') + ')' +
      (r.threw ? ' [home.js threw: ' + r.threw.message + ']' : ''), !r.threw && pub.length === 1);
  }

  // ---- B. 304 when nothing changed ----------------------------------------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4393-'));
  let srv = null;
  try {
    siteFiles.copy(dir);
    fs.mkdirSync(path.join(dir, 'data', 'site'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'site', 'data', 'site', 'lines.md'), path.join(dir, 'data', 'site', 'lines.md'));
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      password: crypto.randomBytes(12).toString('hex'),
      discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
      botKey: crypto.randomBytes(16).toString('hex'), admins: [], secret: crypto.randomBytes(32).toString('hex'),
      gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
    }));
    const port = await freePort();
    let out = '';
    srv = spawn(process.execPath, ['server.js'], {
      cwd: dir, env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(port), THORNSWOOD_DOCS_LOCAL: '1',
        THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1', THORNSWOOD_CHAT_DIR: path.join(dir, 'chat') })
    });
    srv.stdout.on('data', (d) => { out += d; });
    srv.stderr.on('data', (d) => { out += d; });
    for (let i = 0; i < 200 && out.indexOf('listening on ') < 0 && srv.exitCode === null; i++) await new Promise((ok) => setTimeout(ok, 50));
    yes('a copy of the site starts', out.indexOf('listening on ') >= 0, out);

    const WHERE = '/api/public?galleryLimit=24';
    const first = await get(port, WHERE);
    const tag = first.headers.etag;
    yes('B1 /api/public answers 200 with an ETag (' + first.status + ', ' + tag + ')', first.status === 200 && !!tag && /^"[^"]+"$/.test(tag));
    // With no tag at all the rest still runs, asked with one that cannot match,
    // so each says what it saw rather than the harness stopping at B1.
    const held = tag || '"no-tag-given"';
    const again = await get(port, WHERE, { 'if-none-match': held });
    yes('B2 asked again with that tag, unchanged: 304 with no body (' + again.status + ', ' + again.body.length + ' bytes)',
      again.status === 304 && again.body.length === 0);
    yes('B3 and the 304 carries the same tag and stays no-cache', !!tag && again.headers.etag === tag && again.headers['cache-control'] === 'no-cache');
    const weak = await get(port, WHERE, { 'if-none-match': 'W/' + held });
    yes('B4 a weak copy of the tag, as a proxy that compresses sends it, is 304 too (' + weak.status + ')', weak.status === 304 && weak.body.length === 0);
    const listed = await get(port, WHERE, { 'if-none-match': '"other", ' + held });
    yes('B5 so is the tag in a list (' + listed.status + ')', listed.status === 304);
    const other = await get(port, WHERE, { 'if-none-match': '"not-this-one"' });
    yes('B6 another tag gets the whole answer (' + other.status + ')', other.status === 200 && other.body.equals(first.body));
    fs.unlinkSync(path.join(dir, 'data', 'site', 'lines.md'));
    const changed = await get(port, WHERE, { 'if-none-match': held });
    yes('B7 once the answer changes, the old tag gets the whole new answer and a new tag (' + changed.status + ')',
      changed.status === 200 && !changed.body.equals(first.body) && !!changed.headers.etag && changed.headers.etag !== tag);
  } finally {
    if (srv) await new Promise((ok) => { srv.on('exit', ok); try { srv.kill(); } catch (e) { ok(); } setTimeout(ok, 3000); });
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the harness itself threw: ' + (e && e.stack || e)); process.exit(1); });
