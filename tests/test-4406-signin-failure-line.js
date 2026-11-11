'use strict';
/*
  test-4406-signin-failure-line.js

      node tests\test-4406-signin-failure-line.js

  #4406. A Discord sign in that was cancelled, took too long, or failed sent
  the browser to the front page with ?discord=<word>, which nothing on the
  front page read, and the page the person started from was lost. The
  callback had that page all along: it rides inside the signed state as
  back, and the browser is sent there when the sign in works. This holds:

    A  WHERE A FAILURE ENDS. A copy of the site, with Discord stood in for:
       a sign in begun on /gallery and cancelled at Discord ends on
       /gallery?discord=cancelled; one begun on /report more than ten
       minutes ago ends on /report?discord=expired; one begun on /hub whose
       token exchange fails ends on /hub?discord=failed. A launcher sign in
       (a port in the state) still ends on the front page, because the
       launcher's back is not a page of the site, and a back that is not a
       plain path of this site ends on /, never another host.
    B  THE LINE SHOWN. site\public\home.js, run in a stand-in public page,
       and site\public\hub.js, run in a stand-in hub page that is signed
       out, each show one plain line for each of the three words, in a
       place the person sees (home.html's line under the notice, the sign
       in's error line on the hub's gate), the same three lines on both,
       and take the word out of the address.

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
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').split('\r\n').join('\n');
const HOME_JS = read('site', 'public', 'home.js');
const HOME_HTML = read('site', 'public', 'home.html');
const HUB_JS = read('site', 'public', 'hub.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const tick = () => new Promise((ok) => setImmediate(ok));
const WORDS = ['cancelled', 'expired', 'failed'];

/* ------------------------------------------------ A. a copy of the site -- */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4406-'));
const SECRET = crypto.randomBytes(32).toString('hex');
const OUTBOUND = path.join(dir, 'outbound.txt');
siteFiles.copy(dir, path.join(ROOT, 'site', 'server.js'));
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  password: crypto.randomBytes(12).toString('hex'),
  discord: { clientId: 'harness-client', clientSecret: 'harness-secret', botToken: '', guildId: '', invite: '' },
  botKey: crypto.randomBytes(24).toString('hex'), admins: ['111'], secret: SECRET,
  gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
}, null, 2));

/* Discord's token exchange answers with no token, which is a failed sign in;
   nothing else is answered, and nothing leaves the machine. */
function stub() {
  const https = require('https');
  const { EventEmitter } = require('events');
  const say = (line) => { try { require('fs').appendFileSync(process.env.TS_STUB_LOG, line + '\n'); } catch (e) { } };
  function fake(a, b, c) {
    const cb = typeof b === 'function' ? b : c;
    let host = '', where = '';
    if (typeof a === 'string' || a instanceof URL) { const u = new URL(String(a)); host = u.hostname; where = u.pathname; }
    else { host = String(a.hostname || a.host || ''); where = String(a.path || ''); }
    const req = new EventEmitter();
    let ended = false;
    req.setTimeout = () => req; req.destroy = () => { };
    req.write = () => true;
    req.end = () => {
      if (ended) return; ended = true;
      const body = (host === 'discord.com' && where === '/api/oauth2/token') ? { error: 'invalid_grant' } : null;
      say((body ? 'STUBBED ' : 'OUTBOUND ') + host + where);
      setImmediate(() => {
        if (!body) { req.emit('error', new Error('the harness lets no request leave this machine')); return; }
        const res = new EventEmitter();
        res.statusCode = 200; res.headers = {}; res.setEncoding = () => { }; res.resume = () => { };
        if (cb) cb(res);
        res.emit('data', Buffer.from(JSON.stringify(body)));
        res.emit('end');
      });
    };
    return req;
  }
  https.request = fake;
  https.get = function (a, b, c) { const r = fake(a, b, c); r.end(); return r; };
}
fs.writeFileSync(path.join(dir, 'stub.js'), '(' + stub.toString() + ')();\n');

function freePort() {
  return new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
}
let PORT = 0;
function ask(where, headers) {
  return new Promise((done) => {
    const r = http.get({ host: '127.0.0.1', port: PORT, path: where, headers: headers || {}, agent: false }, (res) => {
      let b = ''; res.setEncoding('utf8');
      res.on('data', (d) => { b += d; });
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', (e) => done({ status: 0, headers: {}, body: String(e) }));
  });
}
const sign = (v) => crypto.createHmac('sha256', SECRET).update(String(v)).digest('hex').slice(0, 32);
const whereTo = (r) => String(r.headers.location || '');
const attemptCookie = (r) => [].concat(r.headers['set-cookie'] || []).map((c) => String(c).split(';')[0])
  .filter((c) => c.indexOf('twst_') === 0)[0] || '';

// A real start at /auth/discord, then Discord's answer back to the callback.
async function begin(back, port) {
  const a = await ask('/auth/discord?back=' + encodeURIComponent(back) + (port ? '&port=' + port : ''));
  let state = '';
  try { state = new URL(whereTo(a)).searchParams.get('state') || ''; } catch (e) { }
  return { state: state, cookie: attemptCookie(a) };
}
const cancelAt = (s) => ask('/auth/discord/callback?error=access_denied&state=' + encodeURIComponent(s.state), { Cookie: s.cookie });
const codeAt = (s, code) => ask('/auth/discord/callback?code=' + code + '&state=' + encodeURIComponent(s.state), { Cookie: s.cookie });

// A sign in begun eleven minutes ago, in this browser, on this back: the
// state the site would have signed then, with its attempt cookie.
function begunLongAgo(back) {
  const attempt = crypto.randomBytes(16).toString('hex');
  const raw = Buffer.from(back + '\u0000\u0000\u0000' + attempt + '\u0000' + (Date.now() - 11 * 60 * 1000)).toString('base64url');
  return { state: raw + '.' + sign(raw), cookie: 'twst_' + attempt.slice(0, 8) + '=' + attempt };
}

function listening(srv, port) {
  return new Promise((ok, bad) => {
    let out = '';
    const end = (e) => { clearTimeout(late); srv.stdout.removeListener('data', said); srv.removeListener('close', gone); if (e) { bad(e); } else { ok(); } };
    const said = (d) => { out += d; const m = /\[thornswood-docs\] listening on \S+:(\d+)/.exec(out); if (m && Number(m[1]) === port) { end(); } };
    const gone = (c) => end(new Error('site stopped ' + c + ' before it was listening:\n' + out));
    const late = setTimeout(() => end(new Error('site did not say it was listening on ' + port + ':\n' + out)), 15000);
    srv.stdout.on('data', said);
    srv.on('close', gone);
  });
}

/* ------------------------------------------- B. the pages, stood in for -- */
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
  const e = { id: id, attrs: {} };
  const base = {
    addEventListener() { }, setAttribute(k, v) { e.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(e.attrs, k) ? e.attrs[k] : null; },
    removeAttribute(k) { delete e.attrs[k]; }, hasAttribute(k) { return Object.prototype.hasOwnProperty.call(e.attrs, k); },
    insertAdjacentHTML() { }, querySelector() { return null; }, querySelectorAll() { return []; },
    appendChild() { }, insertBefore() { }, removeChild() { }, focus() { }, click() { }, blur() { },
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
function standIn(pathname, search, fetchStub) {
  const els = {};
  const byId = (id) => (els[id] = els[id] || element(id)).el;
  const replaced = [];
  const document = anything('document');
  const doc = new Proxy({}, {
    get(t, k) {
      if (k === 'getElementById') return byId;
      if (k === 'title') return 'Thornswood';
      if (k === 'cookie') return '';
      if (k === 'querySelector') return () => null;
      if (k === 'querySelectorAll') return () => [];
      if (k === 'createElement') return (t2) => element('new ' + t2).el;
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
    location: { pathname: pathname, search: search, hash: '', href: 'https://thornswood.net' + pathname + search,
      protocol: 'https:', reload() { } },
    history: { pushState() { }, replaceState(s, t, u) { replaced.push(String(u)); } },
    localStorage: { getItem() { return null; }, setItem() { }, removeItem() { } },
    navigator: anything('navigator'), setTimeout() { return 0; }, clearTimeout() { }, setInterval() { return 0; }, clearInterval() { },
    requestAnimationFrame() { }, AbortController, URL, URLSearchParams,
    marked: { parse(s) { return String(s); }, parseInline: String, setOptions() { }, use() { } },
    alert() { }, confirm() { return true; }
  };
  return { ctx, byId, replaced };
}
async function homeAt(pathname, word) {
  const s = standIn(pathname, '?discord=' + word, () => new Promise(() => { }));
  vm.createContext(s.ctx);
  let threw = null;
  try { vm.runInContext(HOME_JS, s.ctx, { filename: 'home.js' }); } catch (e) { threw = e; }
  for (let i = 0; i < 20; i++) await tick();
  return { line: String(s.byId('signinSaid').textContent || ''), replaced: s.replaced, threw };
}
async function hubAt(pathname, word) {
  // Signed out: /api/hello answers 401, so the hub shows its gate.
  const s = standIn(pathname, '?discord=' + word, (url) => String(url).indexOf('/api/hello') === 0
    ? Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ discord: true }) })
    : new Promise(() => { }));
  vm.createContext(s.ctx);
  let threw = null;
  try { vm.runInContext(HUB_JS, s.ctx, { filename: 'hub.js' }); } catch (e) { threw = e; }
  for (let i = 0; i < 20; i++) await tick();
  return { line: String(s.byId('err').textContent || ''), gate: String(s.byId('gate').style.display || ''),
    replaced: s.replaced, threw };
}

(async () => {
  PORT = await freePort();
  const srv = spawn(process.execPath, ['-r', path.join(dir, 'stub.js'), 'server.js'], {
    cwd: dir, env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(PORT), THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1', THORNSWOOD_DOCS_LOCAL: '1', TS_STUB_LOG: OUTBOUND })
  });
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });
  try {
    await listening(srv, PORT);

    console.log('A. WHERE A FAILURE ENDS');
    let r = await cancelAt(await begin('/gallery'));
    yes('A1 cancelled at Discord, begun on /gallery, ends on /gallery?discord=cancelled (' + whereTo(r) + ')',
      r.status === 302 && whereTo(r) === '/gallery?discord=cancelled');
    r = await codeAt(begunLongAgo('/report'), 'any');
    yes('A2 begun on /report eleven minutes ago, ends on /report?discord=expired (' + whereTo(r) + ')',
      r.status === 302 && whereTo(r) === '/report?discord=expired');
    r = await codeAt(await begin('/hub'), 'notoken');
    yes('A3 Discord\'s token exchange failing, begun on /hub, ends on /hub?discord=failed (' + whereTo(r) + ')',
      r.status === 302 && whereTo(r) === '/hub?discord=failed');
    r = await cancelAt(await begin('/link', '53120'));
    yes('A4 a launcher sign in (a port) cancelled still ends on the front page (' + whereTo(r) + ')',
      whereTo(r) === '/?discord=cancelled');
    for (const bad of ['//evil.example', '/\\evil', 'https://evil.example/']) {
      r = await codeAt(await begin(bad), 'notoken');
      yes('A5 back ' + JSON.stringify(bad) + ' failing ends on this site\'s / (' + whereTo(r) + ')', whereTo(r) === '/?discord=failed');
    }
    r = await codeAt({ state: 'not.ours', cookie: '' }, 'any');
    yes('A6 a state that is not ours ends on / (' + whereTo(r) + ')', whereTo(r) === '/?discord=expired');
    yes('A7 nothing tried to leave the machine', fs.existsSync(OUTBOUND) ? fs.readFileSync(OUTBOUND, 'utf8').indexOf('OUTBOUND') < 0 : true);

    console.log('\nB. THE LINE SHOWN');
    const slot = /<p class="[^"]*\bsignin-said\b[^"]*" id="signinSaid" role="status"><\/p>/.exec(HOME_HTML);
    yes('B1 home.html has an empty status line for it, before the page\'s content', !!slot &&
      slot.index < HOME_HTML.indexOf('<main id="main"'));
    const lines = { home: {}, hub: {} };
    for (const w of WORDS) {
      const h = await homeAt('/gallery', w);
      lines.home[w] = h.line;
      yes('B2 home.js on /gallery?discord=' + w + ' shows a line (' + JSON.stringify(h.line) + ')' +
        (h.threw ? ' [threw: ' + h.threw.message + ']' : ''), !h.threw && h.line.length > 20);
      yes('    and takes the word out of the address (' + h.replaced.join(', ') + ')',
        h.replaced.length === 1 && h.replaced[0] === '/gallery');
      const g = await hubAt('/hub', w);
      lines.hub[w] = g.line;
      yes('B3 hub.js, signed out, on /hub?discord=' + w + ' shows a line on the gate (' + JSON.stringify(g.line) + ')' +
        (g.threw ? ' [threw: ' + g.threw.message + ']' : ''), !g.threw && g.line.length > 20 && g.gate === 'grid');
      yes('    and takes the word out of the address (' + g.replaced.join(', ') + ')',
        g.replaced.length >= 1 && g.replaced[0] === '/hub');
    }
    yes('B4 the three lines differ', new Set(WORDS.map((w) => lines.home[w])).size === 3);
    yes('B5 the hub says the same three lines as the public pages', WORDS.every((w) => lines.home[w] === lines.hub[w]));
    const other = await homeAt('/gallery', '<b>made-up</b>');
    yes('B6 a word that is not one of the three shows nothing', !other.threw && other.line === '');
  } catch (e) {
    fail++; console.log('FAIL  the harness itself threw: ' + (e && e.stack || e) + '\n' + out);
  } finally {
    srv.removeAllListeners('close'); srv.kill();
    await new Promise((ok) => setTimeout(ok, 300));
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
