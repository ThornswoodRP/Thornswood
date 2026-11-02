'use strict';
/*
  test-site-oauth-gaps.js

      node .\site\tests\test-site-oauth-gaps.js
      node .\site\tests\test-site-oauth-gaps.js <an older server.js>

  The parts of the Discord sign in callback (site\server.js,
  /auth/discord/callback) that test-site-auth.js and
  test-discord-callback-hang.js do not reach: where the browser is sent back
  to, what Discord answering badly does, somebody who is not allowed in, the
  name written into the cookie, linked.json, and the browser (no launcher
  port) ending.

  WHY THE BACK ADDRESS. back rides inside the signed state, but anybody can
  start a sign in with any back by linking /auth/discord?back=..., and the
  callback only checked back against /^\/[A-Za-z0-9/_-]*$/. '//2130706433'
  passes that, and a browser reads Location: //2130706433 as another host
  (127.0.0.1 written as a number), so a real sign in on thornswood.net could
  end on somebody else's page. The callback now refuses a back that starts
  with two slashes.

  Live, against a copy of the site on a spare 127.0.0.1 port. A stub loaded
  ahead of server.js answers Discord's two addresses by the code it was given
  and lets nothing else leave the machine. The scratch folder is removed at
  the end, pass or fail.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('../../tests/site-files');

const SITE_SRC = process.argv[2] || path.join(__dirname, '..', '..', 'site', 'server.js');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-oauth-gaps-'));
const SECRET = crypto.randomBytes(32).toString('hex');
const ADMIN_ID = '111';
const OUTBOUND = path.join(dir, 'outbound.txt');

siteFiles.copy(dir, SITE_SRC);
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  password: crypto.randomBytes(12).toString('hex'),
  // No bot token, so standing() asks no guild and the admin list decides.
  discord: { clientId: 'harness-client', clientSecret: 'harness-secret', botToken: '', guildId: '', invite: '' },
  botKey: crypto.randomBytes(24).toString('hex'), admins: [ADMIN_ID], secret: SECRET,
  gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
}, null, 2));
fs.writeFileSync(path.join(dir, 'data', 'linked.json'), JSON.stringify({
  [ADMIN_ID]: { id: ADMIN_ID, name: 'Old', first: 1000, profiles: [5] }
}));

// The stranger is banned, which is how this site, with no bot token, refuses somebody.
fs.writeFileSync(path.join(dir, 'data', 'bans.json'), JSON.stringify({ '999': { why: 'harness' } }));

/* Discord, by the code the token exchange carries:
     notoken   the exchange answers with no access_token
     noid      @me answers with no id
     stranger  @me is somebody on the ban list (with no bot token set,
               everybody else not banned is let in)
     pipes     the admin, with | and ; in the display name
     anything else: the admin. */
function stub() {
  const https = require('https');
  const { EventEmitter } = require('events');
  const say = (line) => { try { require('fs').appendFileSync(process.env.TS_STUB_LOG, line + '\n'); } catch (e) { } };
  let lastCode = '';
  function fake(a, b, c) {
    const cb = typeof b === 'function' ? b : c;
    let host = '', where = '';
    if (typeof a === 'string' || a instanceof URL) { const u = new URL(String(a)); host = u.hostname; where = u.pathname; }
    else { host = String(a.hostname || a.host || ''); where = String(a.path || ''); }
    const req = new EventEmitter();
    let sent = '', ended = false;
    req.setTimeout = () => req; req.destroy = () => { };
    req.write = (d) => { sent += String(d); return true; };
    req.end = (d) => {
      if (ended) return; ended = true;
      if (d) sent += String(d);
      let body = null;
      if (host === 'discord.com' && where === '/api/oauth2/token') {
        const m = /code=([A-Za-z0-9-]+)/.exec(sent) || /"code":"([A-Za-z0-9-]+)"/.exec(sent);
        lastCode = m ? m[1] : '';
        body = lastCode === 'notoken' ? { error: 'invalid_grant' } : { access_token: 'harness-token' };
      }
      if (host === 'discord.com' && where === '/api/users/@me') {
        body = lastCode === 'noid' ? { username: 'nobody' }
          : lastCode === 'stranger' ? { id: '999', username: 'stranger', global_name: 'Stranger' }
          : lastCode === 'pipes' ? { id: '111', username: 'tester', global_name: 'Te|st;er' }
          : { id: '111', username: 'tester', global_name: 'Tester', avatar: 'abc' };
      }
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
    const r = http.get({ host: '127.0.0.1', port: PORT, path: where, headers: headers || {} }, (res) => {
      let b = ''; res.setEncoding('utf8');
      res.on('data', (d) => { b += d; });
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', (e) => done({ status: 0, headers: {}, body: String(e) }));
    r.setTimeout(5000, () => r.destroy(new Error('timed out')));
  });
}
const sign = (v) => crypto.createHmac('sha256', SECRET).update(String(v)).digest('hex').slice(0, 32);
const pairOf = (c) => String(c || '').split(';')[0];
const setCookies = (r) => [].concat(r.headers['set-cookie'] || []);
const whereTo = (r) => String(r.headers.location || '');
const outbound = () => { try { return fs.readFileSync(OUTBOUND, 'utf8'); } catch (e) { return ''; } };
const linked = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'data', 'linked.json'), 'utf8')); } catch (e) { return {}; } };

/* A real attempt: /auth/discord with this back and port, then the callback
   with the cookie it set and the code given. */
async function signIn(back, code, port) {
  const q = '/auth/discord?back=' + encodeURIComponent(back) + (port ? '&port=' + port : '');
  const a = await ask(q);
  let state = '';
  try { state = new URL(whereTo(a)).searchParams.get('state') || ''; } catch (e) { }
  const cookie = setCookies(a).map(pairOf).filter((c) => c.indexOf('twst_') === 0)[0] || '';
  return ask('/auth/discord/callback?code=' + code + '&state=' + encodeURIComponent(state), { Cookie: cookie });
}

// Waits for the site's own "[thornswood-docs] listening on ...:port" line
// rather than polling the port (#1727).
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

(async () => {
  PORT = await freePort();
  const srv = spawn(process.execPath, ['-r', path.join(dir, 'stub.js'), 'server.js'], {
    cwd: dir, env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(PORT), THORNSWOOD_DOCS_LOCAL: '1', TS_STUB_LOG: OUTBOUND })
  });
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });
  try {
    await listening(srv, PORT);

    console.log('WHERE THE BROWSER IS SENT BACK');
    let r = await signIn('/link', 'ok');
    yes('a plain back is where a browser sign in ends', r.status === 302 && whereTo(r) === '/link');
    for (const bad of ['//2130706433', '//evil', '/\\evil', 'https://evil.example/', '/a/../..//x.y', '']) {
      r = await signIn(bad, 'ok');
      yes('back ' + JSON.stringify(bad) + ' ends on the site\'s own /, never another host', whereTo(r) === '/');
    }

    console.log('\nWHAT A BROWSER SIGN IN SETS');
    r = await signIn('/', 'ok');
    const cs = setCookies(r);
    const twa = cs.filter((c) => c.indexOf('twa=') === 0)[0] || '';
    const tw = cs.filter((c) => c.indexOf('tw=') === 0)[0] || '';
    yes('the admin cookie is set, HttpOnly', !!twa && /HttpOnly/i.test(twa));
    // #2166: a Discord sign-in sets only twa; tw is the password door's
    // fallback, so this answer clears any old one instead of setting it.
    yes('the member cookie is not set, and an old one is cleared', !!tw && /Max-Age=0\b/.test(tw) && pairOf(tw) === 'tw=');
    yes('the attempt cookie is cleared in the same answer', cs.some((c) => c.indexOf('twst_') === 0 && /Max-Age=0\b/.test(c)));
    const parts = decodeURIComponent(pairOf(twa).slice(4)).split('|');
    yes('the cookie is id|name|at|signature, signed with the site secret',
        parts.length === 4 && parts[0] === '111' && parts[3] === sign(parts[0] + '|' + parts[1] + '|' + parts[2]));
    r = await ask('/api/hello', { Cookie: pairOf(twa) });
    yes('and reads as signed in', r.status === 200);
    const l = linked()['111'] || {};
    yes('linked.json keeps the first sign in and takes the new name and handle',
        l.first === 1000 && l.name === 'Tester' && l.handle === 'tester' && l.seen > 1000);
    yes('and keeps what was already on the row', Array.isArray(l.profiles) && l.profiles[0] === 5);
    r = await signIn('/', 'pipes');
    const p2 = decodeURIComponent(pairOf(setCookies(r).filter((c) => c.indexOf('twa=') === 0)[0] || '').slice(4)).split('|');
    yes('| and ; in a Discord name are taken out, so the cookie still has four parts', p2.length === 4 && p2[1] === 'Tester');
    r = await signIn('/', 'ok', '53120');
    yes('with a launcher port it lands on the loopback with a ticket and the avatar',
        /^http:\/\/127\.0\.0\.1:53120\/thornswood\?ticket=tk1\./.test(whereTo(r)) && /[?&]avatar=abc/.test(whereTo(r)));

    console.log('\nWHEN DISCORD OR THE PERSON IS NOT RIGHT');
    r = await signIn('/', 'notoken');
    yes('no access token from the exchange ends on /?discord=failed', whereTo(r) === '/?discord=failed');
    yes('and sets no sign in cookie', !setCookies(r).some((c) => /^twa?=/.test(c)));
    r = await signIn('/', 'noid');
    yes('@me with no id ends on /?discord=failed', whereTo(r) === '/?discord=failed');
    yes('and sets no sign in cookie', !setCookies(r).some((c) => /^twa?=/.test(c)));
    const beforeStranger = JSON.stringify(linked());
    r = await signIn('/', 'stranger');
    yes('somebody banned gets the page that says so, not a redirect', r.status === 200 && !whereTo(r) && /Not allowed in/.test(r.body) && /banned/.test(r.body));
    yes('and no sign in cookie', !setCookies(r).some((c) => /^twa?=/.test(c)));
    yes('and is not written into linked.json', JSON.stringify(linked()) === beforeStranger);
    yes('nothing tried to leave the machine', outbound().indexOf('OUTBOUND') < 0);
  } catch (e) {
    fail++; console.log('FAIL  ' + (e && e.stack || e));
  } finally {
    srv.removeAllListeners('close'); srv.kill();
    await new Promise((ok) => setTimeout(ok, 300));
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
