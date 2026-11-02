/*
  test-3216-site-security.js

      node .\site\tests\test-3216-site-security.js [path\to\server.js]

  #3216, Patrick's answers on 22 Oct 2026 to the Cloudflare security insights:

    1. The site publishes a security.txt with a contact and an expiry date
       (RFC 9116), at /.well-known/security.txt.
    2. Cloudflare Turnstile on the report form, the one form anybody can send
       without signing in. With both keys set, a report needs a pass that
       Cloudflare says is good, for the action the page draws the widget
       with; a missing, refused or wrong-action pass keeps nothing. Cloudflare
       not answering is said as that and keeps nothing either. With either key
       missing there is no widget and no check.
    3. Bot Fight Mode writes Cloudflare's JavaScript Detections into every
       page, which a CSP of script-src 'self' refuses. Each answer carries a
       fresh nonce in script-src for Cloudflare to put on what it writes in.

  The real site\server.js is copied into a scratch folder and run on a spare
  port, twice: once with both Turnstile keys and once with only the site key.
  Cloudflare's siteverify is a small server in this process that the site is
  pointed at by a preload which turns https.request to challenges.cloudflare.com
  into http.request to it; nothing else the site might ask for is touched.
  The home page's script is read for the widget's half.

  Nothing here touches the repository's data folder or the network. Scratch
  files go under THORNSWOOD_TEMP when it is set.
*/
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const siteFiles = require('../../tests/site-files');

const SITE = process.argv[2] || path.join(__dirname, '..', '..', 'site', 'server.js');
const CR = String.fromCharCode(13);
const SERVER = siteFiles.source(SITE).split(CR).join('');
const HOME = fs.readFileSync(path.join(__dirname, '..', '..', 'site', 'public', 'home.js'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const EMDASH = String.fromCharCode(0x2014);
const fair = (s) => typeof s === 'string' && s.length > 0 && s.indexOf(EMDASH) < 0 && !/\bplayers?\b/i.test(s);

// ------------------------------------------------------- fake siteverify --
const SECRET = 'harness-turnstile-secret-' + crypto.randomBytes(6).toString('hex');
const SITE_KEY = '0xHarnessSiteKey';
const asked = [];
const verify = http.createServer((req, res) => {
  let buf = '';
  req.on('data', (d) => { buf += d; });
  req.on('end', () => {
    const f = new URLSearchParams(buf);
    asked.push({ path: req.url, secret: f.get('secret'), response: f.get('response'), remoteip: f.get('remoteip') });
    const t = f.get('response');
    const out = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (f.get('secret') !== SECRET) return out({ success: false, 'error-codes': ['invalid-input-secret'] });
    if (t === 'good') return out({ success: true, action: 'report', hostname: 'thornswood.net', 'error-codes': [] });
    if (t === 'elsewhere') return out({ success: true, action: 'login', hostname: 'thornswood.net', 'error-codes': [] });
    return out({ success: false, 'error-codes': ['invalid-input-response'] });
  });
});

// ------------------------------------------------------------ the sites --
const TEMP = process.env.THORNSWOOD_TEMP || os.tmpdir();
fs.mkdirSync(TEMP, { recursive: true });
const made = [];
function scratch(cfgExtra) {
  const dir = fs.mkdtempSync(path.join(TEMP, 'ts-3216-'));
  made.push(dir);
  siteFiles.copy(dir, SITE);
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(Object.assign({
    password: crypto.randomBytes(12).toString('hex'),
    botKey: crypto.randomBytes(24).toString('hex'), admins: [], secret: crypto.randomBytes(32).toString('hex'),
    gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
  }, cfgExtra), null, 2));
  fs.writeFileSync(path.join(dir, 'fake-turnstile.js'), [
    "const http = require('http'), https = require('https');",
    "const port = Number(process.env.FAKE_TURNSTILE_PORT);",
    "const real = https.request;",
    "https.request = function (o, cb) {",
    "  if (o && typeof o === 'object' && o.hostname === 'challenges.cloudflare.com') {",
    "    return http.request({ host: '127.0.0.1', port: port, path: o.path, method: o.method, headers: o.headers }, cb);",
    "  }",
    "  return real.apply(this, arguments);",
    "};"
  ].join('\n'));
  return dir;
}
function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
// Waits for this run's site to say it is listening on its port (#1727).
function listening(srv, port) {
  return new Promise((ok, bad) => {
    let out = '';
    const said = (d) => {
      out += d;
      const m = /\[thornswood-docs\] listening on \S+:(\d+)/.exec(out);
      if (m && Number(m[1]) === port) end(null);
    };
    const more = (d) => { out += d; };
    const gone = (code) => end(new Error('the site stopped (exit ' + code + ') before it was listening. It printed:\n' + out));
    const late = setTimeout(() => end(new Error('the site did not say it was listening within fifteen seconds. It printed:\n' + out)), 15000);
    function end(err) {
      clearTimeout(late);
      srv.stdout.removeListener('data', said);
      srv.stderr.removeListener('data', more);
      srv.removeListener('close', gone);
      if (err) bad(err); else ok();
    }
    srv.stdout.on('data', said);
    srv.stderr.on('data', more);
    srv.on('close', gone);
  });
}
async function start(dir, verifyPort) {
  const port = await freePort();
  const srv = spawn(process.execPath, ['-r', path.join(dir, 'fake-turnstile.js'), path.join(dir, 'server.js')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(port), THORNSWOOD_DOCS_LOCAL: '1',
                                          FAKE_TURNSTILE_PORT: String(verifyPort) })
  });
  await listening(srv, port);
  return { srv, port };
}
let lane = 0;
function ask(port, method, where, body) {
  return new Promise((ok) => {
    const data = body === undefined ? '' : JSON.stringify(body);
    const headers = { 'x-forwarded-for': '10.32.16.' + (++lane) };
    if (data) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(data); }
    const r = http.request({ host: '127.0.0.1', port, method, path: where, headers, agent: false }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => {
        let j = null; try { j = JSON.parse(buf); } catch (e) { }
        ok({ status: res.statusCode, headers: res.headers, body: buf, j: j || {}, from: headers['x-forwarded-for'] });
      });
    });
    r.setTimeout(20000, () => r.destroy());
    r.on('error', () => ok({ status: 0, headers: {}, body: '', j: {}, from: headers['x-forwarded-for'] }));
    r.end(data);
  });
}
const inbox = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'data', 'for-bot', 'inbox.json'), 'utf8')); } catch (e) { return []; } };
const kept = (dir, title) => inbox(dir).filter((r) => r.title === title).length;

// ------------------------------------------------------------- the page --
function pageChecks() {
  const a = HOME.indexOf("} else if (here === '/report') {");
  const page = a >= 0 ? HOME.slice(a, HOME.indexOf('\n}', a)) : '';
  yes('the report page asks the site whether the check is on', /request\('\/api\/report\/form'\)/.test(page));
  yes('it loads Turnstile only when the site names a key, drawn explicitly',
      /if \(!key\) return;/.test(page) &&
      page.indexOf("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit") >= 0);
  yes('the widget is drawn for the action the site checks', /action: 'report'/.test(page));
  yes('the pass goes with the report', /turnstile: tsToken,/.test(page));
  yes('a press before the pass is there says to wait, and sends nothing',
      /if \(tsWanted && !tsToken\) \{\s*finish\('Wait for the tick under the form, then send it again\.'\);\s*return;/.test(page));
  yes('a pass is good once, so the widget is drawn again after every answer',
      (page.match(/tsReset\(\);/g) || []).length >= 2);
}

// ------------------------------------------------------------ the source --
function sourceChecks() {
  const csp = JSON.parse((SERVER.match(/const CSP_HEADER = ("[^"\r\n]*");/) || [, '""'])[1]);
  yes('the CSP lets Turnstile\'s script and frame in, and nothing else of it',
      /script-src [^;]*https:\/\/challenges\.cloudflare\.com/.test(csp) && /frame-src https:\/\/challenges\.cloudflare\.com;/.test(csp));
  yes('and still refuses inline script', csp.indexOf('unsafe-inline') < 0);
  yes('the check waits on Cloudflare before the limit is read again, never between that and reportTaken',
      (() => {
        const at = SERVER.indexOf("if (route === '/api/report' && req.method === 'POST')");
        const body = SERVER.slice(at, SERVER.indexOf('reportTaken(sender', at));
        const ts = body.indexOf('await turnstilePasses(');
        const late = body.indexOf('const late = reportRefusal(');
        return at >= 0 && ts > 0 && late > ts && body.slice(late).indexOf('await') < 0;
      })());
}

(async () => {
  pageChecks();
  sourceChecks();
  await new Promise((r) => verify.listen(0, '127.0.0.1', r));
  const vport = verify.address().port;
  const on = scratch({ turnstileSiteKey: SITE_KEY, turnstileSecret: SECRET });
  const half = scratch({ turnstileSiteKey: SITE_KEY, turnstileSecret: '' });
  const down = scratch({ turnstileSiteKey: SITE_KEY, turnstileSecret: SECRET });
  const sites = [];
  try {
    const A = await start(on, vport); sites.push(A.srv);
    let r;

    // ------------------------------------------------------ security.txt --
    r = await ask(A.port, 'GET', '/.well-known/security.txt');
    const lines = r.body.split('\n');
    const field = (k) => (lines.find((l) => l.indexOf(k + ': ') === 0) || '').slice(k.length + 2);
    const exp = Date.parse(field('Expires'));
    const days = (exp - Date.now()) / 86400000;
    yes('security.txt is there, as plain text', r.status === 200 && /^text\/plain/.test(r.headers['content-type'] || ''));
    yes('its contact is the report page on the public address', field('Contact') === 'https://thornswood.net/report');
    // #3683: the same routes SECURITY.md gives, the Discord after the report page.
    yes('  then the Discord, for a message to the owner, as SECURITY.md says',
        lines.filter((l) => /^Contact: /.test(l)).join('|') === 'Contact: https://thornswood.net/report|Contact: https://thornswood.net/discord');
    yes('it expires inside the year RFC 9116 asks for, and not soon (' + Math.round(days) + ' days)',
        /^\d{4}-\d\d-\d\dT00:00:00\.000Z$/.test(field('Expires')) && days > 150 && days < 366);
    yes('it names its canonical address and its language',
        field('Canonical') === 'https://thornswood.net/.well-known/security.txt' && field('Preferred-Languages') === 'en');
    yes('Expires is there once and Contact at least once',
        lines.filter((l) => /^Expires: /.test(l)).length === 1 && lines.filter((l) => /^Contact: /.test(l)).length >= 1);

    // -------------------------------------------------------------- nonce --
    const one = await ask(A.port, 'GET', '/');
    const two = await ask(A.port, 'GET', '/');
    const nonce = (h) => ((/'nonce-([A-Za-z0-9+/=]+)'/.exec(String(h['content-security-policy'] || '')) || [])[1] || '');
    yes('a page carries a nonce in script-src, right after self',
        /script-src 'self' 'nonce-[A-Za-z0-9+/=]{20,}' /.test(String(one.headers['content-security-policy'] || '')));
    yes('each answer has its own', nonce(one.headers) && nonce(two.headers) && nonce(one.headers) !== nonce(two.headers));
    yes('so does a refusal from the API', nonce((await ask(A.port, 'GET', '/api/report/nothing-here')).headers).length > 0);

    // ---------------------------------------------------- Turnstile, on --
    r = await ask(A.port, 'GET', '/api/report/form');
    yes('the form is told the site key', r.status === 200 && r.j.turnstile === SITE_KEY);
    yes('and the secret is in nothing the site sends', r.body.indexOf(SECRET) < 0);

    r = await ask(A.port, 'POST', '/api/report', { title: 'ts none', kind: 'bug' });
    yes('a report with no pass is refused, 403 in words, and nothing is kept',
        r.status === 403 && fair(r.j.error) && kept(on, 'ts none') === 0);
    yes('and Cloudflare was not asked about an empty pass', asked.length === 0);

    r = await ask(A.port, 'POST', '/api/report', { title: 'ts bad', kind: 'bug', turnstile: 'forged' });
    yes('a pass Cloudflare refuses is refused, and nothing is kept', r.status === 403 && kept(on, 'ts bad') === 0);

    r = await ask(A.port, 'POST', '/api/report', { title: 'ts elsewhere', kind: 'bug', turnstile: 'elsewhere' });
    yes('a good pass made for another action is refused', r.status === 403 && kept(on, 'ts elsewhere') === 0);

    r = await ask(A.port, 'POST', '/api/report', { title: 'ts good', kind: 'bug', turnstile: 'good' });
    const last = asked[asked.length - 1] || {};
    yes('a good pass goes through and the report is kept', r.status === 200 && kept(on, 'ts good') === 1);
    yes('Cloudflare was asked at siteverify with the secret, the pass and the sender\'s address',
        last.path === '/turnstile/v0/siteverify' && last.secret === SECRET && last.response === 'good' && last.remoteip === r.from);
    yes('the pass is not kept with the report', JSON.stringify(inbox(on)).indexOf('"turnstile"') < 0);

    const trapAsked = asked.length;
    r = await ask(A.port, 'POST', '/api/report', { title: 'ts trap', kind: 'bug', homepage: 'http://spam' });
    yes('the hidden field still answers ok and keeps nothing, before Cloudflare is asked',
        r.status === 200 && kept(on, 'ts trap') === 0 && asked.length === trapAsked);

    // ---------------------------------------- Turnstile, Cloudflare gone --
    const dead = await freePort();
    const C = await start(down, dead); sites.push(C.srv);
    r = await ask(C.port, 'POST', '/api/report', { title: 'ts unasked', kind: 'bug', turnstile: 'good' });
    yes('Cloudflare not answering is said as that, 503, and nothing is kept',
        r.status === 503 && /Cloudflare did not answer/.test(r.j.error || '') && fair(r.j.error) && kept(down, 'ts unasked') === 0);

    // ------------------------------------------- Turnstile, one key only --
    const B = await start(half, vport); sites.push(B.srv);
    r = await ask(B.port, 'GET', '/api/report/form');
    yes('with only the site key, the form is told there is no check', r.status === 200 && r.j.turnstile === '');
    const before = asked.length;
    r = await ask(B.port, 'POST', '/api/report', { title: 'ts off', kind: 'bug' });
    yes('and a report goes through without a pass, as before', r.status === 200 && kept(half, 'ts off') === 1 && asked.length === before);
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack ? e.stack : e), false);
  } finally {
    sites.forEach((s) => { try { s.kill(); } catch (e) { } });
    verify.close();
    made.forEach((d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { } });
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
