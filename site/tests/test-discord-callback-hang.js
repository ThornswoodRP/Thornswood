/*
  test-discord-callback-hang.js

      node .\site\tests\test-discord-callback-hang.js

  The Discord sign-in callback (#1163). post() and getWithToken() used to
  listen only for data, end and the request's error. When Discord stalled
  after its headers, never answered, or dropped halfway, the promise never
  settled and the browser sat on a blank page.

  Same shape as test-site-hangs.js: the real site\server.js in a scratch
  folder, and a Discord in this process. A preload turns https to
  discord.com into http to that Discord. Nothing here touches the
  repository's data folder or the network.
*/
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const siteFiles = require('../../tests/site-files');

const SITE = path.join(__dirname, '..', '..', 'site', 'server.js');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const EMDASH = String.fromCharCode(0x2014);
const fair = (s) => typeof s === 'string' && s.length > 0 && s.indexOf(EMDASH) < 0 && !/\bplayers?\b/i.test(s);
const TEN = 11500;

const held = new Set();
function takeBody(req, cb) {
  let b = '';
  req.on('data', (d) => { b += d; });
  req.on('end', () => cb(b));
  req.on('error', () => cb(b));
}
function holdStall(res) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.write('{');
  held.add(res);
}
function holdSilent(res) { held.add(res); }
function holdDrop(res) {
  res.writeHead(200, { 'content-type': 'application/json', 'content-length': '400' });
  res.write('{');
  setTimeout(() => { try { res.socket.destroy(); } catch (e) { } }, 50);
}
function modeOf(name) {
  if (name === 'stall' || name === 'silent' || name === 'drop') return name;
  return '';
}
function byMode(res, mode, okBody) {
  if (mode === 'stall') return holdStall(res);
  if (mode === 'silent') return holdSilent(res);
  if (mode === 'drop') return holdDrop(res);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(okBody));
}
const discord = http.createServer((req, res) => {
  const u = req.url || '';
  if (req.method === 'POST' && u.indexOf('/api/oauth2/token') >= 0) {
    takeBody(req, (b) => {
      const code = new URLSearchParams(b).get('code') || '';
      const mode = modeOf(code.split('-')[0]);
      byMode(res, mode, { access_token: 'tok-' + code, token_type: 'Bearer' });
    });
    return;
  }
  if (u.indexOf('/users/@me') >= 0) {
    const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const code = tok.indexOf('tok-') === 0 ? tok.slice(4) : '';
    const mode = modeOf(code.split('-')[1] || '');
    byMode(res, mode, { id: '900', username: 'callback', global_name: 'Callback' });
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end('{"message":"no"}');
});
const sockets = new Set();
discord.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

const TEMP = process.env.THORNSWOOD_TEMP || os.tmpdir();
fs.mkdirSync(TEMP, { recursive: true });
const dir = fs.mkdtempSync(path.join(TEMP, 'ts-callback-hang-'));
const SECRET = crypto.randomBytes(32).toString('hex');
siteFiles.copy(dir, SITE);
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', '..', 'site', 'public', 'home.html'), path.join(dir, 'public', 'home.html'));
fs.copyFileSync(path.join(__dirname, '..', '..', 'site', 'public', 'door.css'), path.join(dir, 'public', 'door.css'));
fs.mkdirSync(path.join(dir, 'feed', 'version'), { recursive: true });
fs.writeFileSync(path.join(dir, 'feed', 'version', '00000001.json'), JSON.stringify({ launcherVersion: '1.1.102', minLauncher: '1.1.100' }));
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  password: crypto.randomBytes(12).toString('hex'),
  discord: { clientId: 'harness-client', clientSecret: 'harness-secret',
             botToken: 'harness-bot', guildId: 'g1', invite: '' },
  access: { admin: ['Owner'], play: ['Playtester'], banned: ['Banned'], dev: ['Owner'], slots3: [], jarl: [] },
  botKey: crypto.randomBytes(24).toString('hex'), admins: [], secret: SECRET,
  passKey: crypto.randomBytes(32).toString('hex'),
  gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
}, null, 2));
fs.writeFileSync(path.join(dir, 'fake-discord.js'), [
  "const http = require('http'), https = require('https');",
  "const port = Number(process.env.FAKE_DISCORD_PORT);",
  "function local(o) {",
  "  return { host: '127.0.0.1', port: port, path: o.path, method: o.method || 'GET', headers: o.headers };",
  "}",
  "const realGet = https.get;",
  "const realReq = https.request;",
  "https.get = function (o, cb) {",
  "  if (o && typeof o === 'object' && o.hostname === 'discord.com') return http.get(local(o), cb);",
  "  return realGet.apply(this, arguments);",
  "};",
  "https.request = function (o, cb) {",
  "  if (o && typeof o === 'object' && o.hostname === 'discord.com') return http.request(local(o), cb);",
  "  return realReq.apply(this, arguments);",
  "};"
].join('\n'));

function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
/*
  Waits for the site's own "[thornswood-docs] listening on ...:port" line, so
  nothing is asked of the port before this run's site holds it (#1727). The
  port came from the system and was let go again, and builds run side by side
  on the VPS: if something takes it in between, the site stops on EADDRINUSE,
  and polling the port would have read whatever holds it as this site. The
  error says which, with what the site printed.
*/
function listening(srv, port) {
  return new Promise((ok, bad) => {
    let out = '';
    const said = (d) => {
      out += d;
      const m = /\[thornswood-docs\] listening on \S+:(\d+)/.exec(out);
      if (m && Number(m[1]) === port) { end(null); }
    };
    const more = (d) => { out += d; };
    const gone = (code) => end(new Error((/EADDRINUSE/.test(out) ? 'something else already holds port ' + port + ', so ' : '') +
                                         'the site stopped (exit ' + code + ') before it was listening. It printed:\n' + out));
    const late = setTimeout(() => end(new Error('the site did not say it was listening on ' + port +
                                                ' within fifteen seconds. It printed:\n' + out)), 15000);
    function end(err) {
      clearTimeout(late);
      srv.stdout.removeListener('data', said);
      srv.stderr.removeListener('data', more);
      srv.removeListener('close', gone);
      if (err) { bad(err); } else { ok(); }
    }
    srv.stdout.on('data', said);
    srv.stderr.on('data', more);
    srv.on('close', gone);
  });
}
let port = 0;
let lane = 0;
function ask(method, where, body, opts) {
  const o = opts || {};
  return new Promise((ok) => {
    const data = body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
    const headers = { 'x-forwarded-for': o.from || ('10.9.0.' + (++lane)) };
    if (method !== 'GET') {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(data);
    }
    if (o.cookie) headers.cookie = o.cookie;
    const started = Date.now();
    const r = http.request({ host: '127.0.0.1', port, method, path: where, headers }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => ok({ status: res.statusCode, text: buf, ms: Date.now() - started, headers: res.headers }));
      res.on('error', () => ok({ status: res.statusCode, text: buf, ms: Date.now() - started, headers: res.headers }));
    });
    r.setTimeout(30000, () => r.destroy());
    r.on('error', () => ok({ status: 0, text: '', ms: Date.now() - started, headers: {} }));
    r.end(data);
  });
}
function stateOf(got) {
  try { return new URL(got.headers.location).searchParams.get('state') || ''; }
  catch (e) { return ''; }
}
function cookieOf(got) {
  const raw = got.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return String(list[0] || '').split(';')[0];
}
function said(got) {
  return got.status === 200 && /Discord did not answer/.test(got.text) && /Try again/.test(got.text) && fair(got.text);
}

(async function main() {
  const dport = await new Promise((ok) => discord.listen(0, '127.0.0.1', () => ok(discord.address().port)));
  port = await freePort();
  let log = '';
  const site = spawn(process.execPath, ['-r', path.join(dir, 'fake-discord.js'), path.join(dir, 'server.js')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, {
      THORNSWOOD_DOCS_PORT: String(port), THORNSWOOD_DOCS_LOCAL: '1',
      FAKE_DISCORD_PORT: String(dport)
    })
  });
  site.stdout.on('data', (d) => { log += d; });
  site.stderr.on('data', (d) => { log += d; });
  try {
    yes('the scratch site starts', await listening(site, port).then(() => true));
    const codes = ['stall', 'silent', 'drop', 'me-stall', 'me-silent', 'me-drop'];
    const begun = await Promise.all(codes.map(() => ask('GET', '/auth/discord?back=/')));
    begun.forEach((b, i) => yes('attempt ' + codes[i] + ' reaches Discord\'s authorize address',
      b.status === 302 && stateOf(b).length > 0 && cookieOf(b).indexOf('twst_') === 0));
    const got = await Promise.all(begun.map((b, i) => ask('GET',
      '/auth/discord/callback?code=' + encodeURIComponent(codes[i]) + '&state=' + encodeURIComponent(stateOf(b)),
      null, { cookie: cookieOf(b) })));
    const names = [
      ['token exchange stalls after headers', 0, true],
      ['token exchange never answers', 1, true],
      ['token exchange drops halfway', 2, false],
      ['profile lookup stalls after headers', 3, true],
      ['profile lookup never answers', 4, true],
      ['profile lookup drops halfway', 5, false]
    ];
    names.forEach((row) => {
      const g = got[row[1]];
      const slow = row[2];
      const bound = slow ? (g.ms >= 8000 && g.ms < TEN) : (g.ms < 2000);
      yes('sign-in, ' + row[0] + ': the callback says Discord did not answer and to try again (' + g.ms + ' ms)',
          said(g) && bound);
    });
    yes('nothing the site did ended in an uncaught exception or unhandled rejection',
        !/uncaught exception|unhandled rejection/.test(log));
  } finally {
    try { site.kill(); } catch (e) { }
    held.forEach((res) => { try { res.destroy(); } catch (e) { } });
    sockets.forEach((s) => { try { s.destroy(); } catch (e) { } });
    discord.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
