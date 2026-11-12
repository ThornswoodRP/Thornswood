'use strict';
/*
  test-4454-site-stores-ignored.js

      node .\site\tests\test-4454-site-stores-ignored.js

  Issue #4454. Run from a checkout, as site\README.md says, the site keeps
  every store it writes beside itself (site\data, site\data\for-bot,
  site\uploads), and git ignored none of them: one report added an inbox
  file, and one gallery upload changed a tracked file and added the picture
  and an uploads list, with names, Discord ids and pictures in them.

  This makes a scratch git checkout of the site (the tracked files under
  site\ and the repository's .gitignore, committed), starts site\server.js
  from it on a spare loopback port, and then:
    1. files a report from the game (/api/report/game, with the door's key);
    2. signs in through the real Discord callback, Discord answered by a
       stand-in loaded ahead of server.js that lets nothing else leave;
    3. uploads a picture to the gallery with that sign-in;
  checks each was written where the site keeps it, and wants git status in
  the checkout to be clean: nothing added, nothing changed.

  Nothing leaves the machine. The scratch folders are removed at the end.
*/
const { execFileSync, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TEMP = process.env.THORNSWOOD_TEMP || os.tmpdir();

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).slice(0, 1500).split('\n').join('\n      ') : '')); }
}
const git = (cwd, args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false'].concat(args),
  { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// Discord's two addresses, answered here; anything else is refused.
function stub() {
  const https = require('https');
  const { EventEmitter } = require('events');
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
      let body = null;
      if (host === 'discord.com' && where === '/api/oauth2/token') body = { access_token: 'harness-token' };
      if (host === 'discord.com' && where === '/api/users/@me') body = { id: '111', username: 'tester', global_name: 'Tester' };
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

function freePort() {
  return new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
}
// Waits for the site's own "[thornswood-docs] listening on ...:port" line
// rather than polling the port (#1727).
function listening(srv, port) {
  return new Promise((ok, bad) => {
    let out = '';
    const end = (e) => { clearTimeout(late); srv.stdout.removeListener('data', said); srv.stderr.removeListener('data', err); srv.removeListener('close', gone); if (e) { bad(e); } else { ok(); } };
    const said = (d) => { out += d; const m = /\[thornswood-docs\] listening on \S+:(\d+)/.exec(out); if (m && Number(m[1]) === port) { end(); } };
    const err = (d) => { out += d; };
    const gone = (c) => end(new Error('site stopped (exit ' + c + ') before it was listening:\n' + out));
    const late = setTimeout(() => end(new Error('site not listening in 15 s:\n' + out)), 15000);
    srv.stdout.on('data', said);
    srv.stderr.on('data', err);
    srv.on('close', gone);
  });
}
let PORT = 0;
function ask(method, where, headers, body) {
  return new Promise((done) => {
    const data = body === undefined ? null : (Buffer.isBuffer(body) ? body : Buffer.from(body));
    const h = Object.assign({}, headers || {});
    if (data) h['content-length'] = data.length;
    // A browser names the page that sent a signed in write (#1367).
    if (method !== 'GET' && Object.keys(h).some((k) => k.toLowerCase() === 'cookie')) h.origin = 'http://127.0.0.1:' + PORT;
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path: where, headers: h, agent: false }, (res) => {
      let b = ''; res.setEncoding('utf8');
      res.on('data', (d) => { b += d; });
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', (e) => done({ status: 0, headers: {}, body: String(e) }));
    r.setTimeout(10000, () => r.destroy(new Error('timed out')));
    if (data) r.write(data);
    r.end();
  });
}
const pairOf = (c) => String(c || '').split(';')[0];
const cookies = (r) => [].concat(r.headers['set-cookie'] || []).map(pairOf);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360000002000154a24f0e0000000049454e44ae426082', 'hex');
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };

(async function main() {
  const work = fs.mkdtempSync(path.join(TEMP, 'ts-4454-'));
  const repo = path.join(work, 'checkout');
  const aside = path.join(work, 'aside');
  let srv = null, said = '';
  try {
    // ---------------------------------------------------- the checkout --
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(aside, { recursive: true });
    const tracked = git(ROOT, ['ls-files', '-z', '--', 'site', '.gitignore']).split('\0').filter(Boolean);
    for (const rel of tracked) {
      const to = path.join(repo, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(ROOT, rel), to);
    }
    git(repo, ['init', '-q']);
    git(repo, ['add', '-A']);
    git(repo, ['-c', 'user.name=harness', '-c', 'user.email=harness@localhost', 'commit', '-q', '-m', 'the site as tracked']);
    const status = () => git(repo, ['status', '--porcelain', '--untracked-files=all']).trim();
    yes('the scratch checkout holds the site (' + tracked.length + ' tracked files) and starts clean',
        tracked.length > 50 && status() === '', status());

    const SITE = path.join(repo, 'site');
    const DATA = path.join(SITE, 'data');
    const KEY = crypto.randomBytes(24).toString('hex');
    // config.json is the one file the README has you put there yourself.
    fs.writeFileSync(path.join(SITE, 'config.json'), JSON.stringify({
      password: crypto.randomBytes(12).toString('hex'),
      discord: { clientId: 'harness-client', clientSecret: 'harness-secret', botToken: '', guildId: '', invite: '' },
      botKey: KEY, admins: ['111'], secret: crypto.randomBytes(32).toString('hex'),
      gameCheckPort: 1, onlineFile: path.join(aside, 'online.json')
    }, null, 2));
    // The stand-in lives outside the checkout, so it is no part of what is measured.
    fs.writeFileSync(path.join(aside, 'stub.js'), '(' + stub.toString() + ')();\n');

    PORT = await freePort();
    srv = spawn(process.execPath, ['-r', path.join(aside, 'stub.js'), 'server.js'], {
      cwd: SITE, stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(PORT), THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1',
        THORNSWOOD_DOCS_LOCAL: '1', THORNSWOOD_CHAT_DIR: path.join(aside, 'chat') })
    });
    srv.stdout.on('data', (d) => { said += d; });
    srv.stderr.on('data', (d) => { said += d; });
    await listening(srv, PORT);

    // ------------------------------------------------------ 1. a report --
    let r = await ask('POST', '/api/report/game', { 'x-thornswood-key': KEY, 'content-type': 'application/json' },
      JSON.stringify({ kind: 'report', profileId: 5, name: 'Aela', about: 'Bjorn', said: 'took my horse' }));
    const inbox = readJson(path.join(DATA, 'for-bot', 'inbox.json')) || [];
    yes('a report from the game is taken (' + r.status + ') and kept in the inbox', r.status === 200 && inbox.length === 1, r.body);

    // ------------------------------------------------------ 2. a sign-in --
    const start = await ask('GET', '/auth/discord?back=' + encodeURIComponent('/link'));
    let state = '';
    try { state = new URL(String(start.headers.location || '')).searchParams.get('state') || ''; } catch (e) { }
    const attempt = cookies(start).filter((c) => c.indexOf('twst_') === 0)[0] || '';
    r = await ask('GET', '/auth/discord/callback?code=ok&state=' + encodeURIComponent(state), { cookie: attempt });
    const signedIn = cookies(r).filter((c) => c.indexOf('twa=') === 0)[0] || '';
    yes('a sign-in through Discord ends signed in (' + r.status + ')', r.status === 302 && !!signedIn, JSON.stringify(r.headers));
    yes('  and is kept: linked.json and signins.json hold it',
        !!(readJson(path.join(DATA, 'linked.json')) || {})['111'] && (readJson(path.join(DATA, 'signins.json')) || []).length >= 1);

    // -------------------------------------------------- 3. an upload --
    r = await ask('POST', '/api/gallery/submit?name=shot.png&by=Tester', { cookie: signedIn, 'content-type': 'image/png' }, PNG);
    const pending = readJson(path.join(DATA, 'gallery-pending.json')) || [];
    const pictures = fs.existsSync(path.join(SITE, 'uploads')) ? fs.readdirSync(path.join(SITE, 'uploads')).filter((n) => /\.png$/.test(n)) : [];
    yes('a gallery upload is taken (' + r.status + '), queued, and its picture kept in uploads',
        r.status === 200 && pending.length === 1 && pictures.length === 1, r.body);

    // ------------------------------------------------ what git sees --
    srv.kill();
    srv = null;
    const left = status();
    yes('git status in the checkout is clean after all three: nothing added, nothing changed', left === '', left);
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false, said);
  } finally {
    if (srv) srv.kill();
    try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) { console.log('      the scratch folder was not removed: ' + e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
