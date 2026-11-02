/*
  test-site-auth.js

      node .\tests\test-site-auth.js
      node .\tests\test-site-auth.js <an older server.js> <an older gamemode.js>

  Entry 248: the door key rode in the address, the site's Discord cookie was
  good forever, and the OAuth state was the same string for every attempt at
  the same page and could be used again. This drives all three for real.

  It runs the real site\server.js out of a scratch folder on a spare port,
  with a config written here for this run: a random secret, a random bot key,
  and one id on the hand written admin list so nobody has to be in a real
  Discord. Never site\config.json and never the live one, whose key
  is entry 2's to rotate. The key made here is never printed either.

  Nothing leaves the machine. A stub loaded ahead of the site answers the two
  Discord addresses a sign in needs (the code exchange and who the person is)
  from here, and makes any other https request fail and write down that it was
  tried. The last check is that nothing was.

  Then the sending half: the real refresh() out of gamemode.js's door block,
  pointed at the same scratch site, has to get its list with the key in a
  header and nothing in the address.

  Give it an older server.js and gamemode.js to watch it fail on the code from
  before the change.
*/
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const siteFiles = require('./site-files');

const SITE_SRC = process.argv[2] || path.join(REPO_DIR, 'site', 'server.js');
const GAME_SRC = process.argv[3] || path.join(REPO_DIR, 'game', 'gamemode.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ---- the scratch site ------------------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-site-auth-'));
const SECRET = crypto.randomBytes(32).toString('hex');
const KEY = crypto.randomBytes(24).toString('hex');
const ADMIN_ID = '111';
const PROFILE = 5;
const OUTBOUND = path.join(dir, 'outbound.txt');

siteFiles.copy(dir, SITE_SRC);
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  password: crypto.randomBytes(12).toString('hex'),
  // A client id and secret so Discord sign in is switched on and the password
  // door is off, the way the live site runs. No bot token, so standing() never
  // asks the guild anything and the admin list below decides.
  discord: { clientId: 'harness-client', clientSecret: 'harness-secret', botToken: '', guildId: '', invite: '' },
  botKey: KEY,
  admins: [ADMIN_ID],
  secret: SECRET,
  gameCheckPort: 1,
  onlineFile: path.join(dir, 'online.json')
}, null, 2));
fs.writeFileSync(path.join(dir, 'data', 'linked.json'), JSON.stringify({
  [ADMIN_ID]: { id: ADMIN_ID, name: 'Tester', profiles: [PROFILE] }
}));

/* Loaded into the site with -r, ahead of server.js. Written out from this
   function's own text so it is plain code here rather than a string. */
function stub() {
  const https = require('https');
  const { EventEmitter } = require('events');
  const logTo = process.env.TS_STUB_LOG;
  const say = (line) => { try { require('fs').appendFileSync(logTo, line + '\n'); } catch (e) { } };
  function fake(a, b, c) {
    const cb = typeof b === 'function' ? b : c;
    let host = '', where = '';
    if (typeof a === 'string' || a instanceof URL) {
      const u = new URL(String(a)); host = u.hostname; where = u.pathname;
    } else {
      host = String(a.hostname || a.host || ''); where = String(a.path || '');
    }
    const req = new EventEmitter();
    let ended = false;
    req.setTimeout = () => req;
    req.destroy = () => { };
    req.write = () => true;
    req.end = () => {
      if (ended) return;
      ended = true;
      let body = null;
      if (host === 'discord.com' && where === '/api/oauth2/token') body = { access_token: 'harness-token' };
      if (host === 'discord.com' && where === '/api/users/@me') body = { id: '111', username: 'tester', global_name: 'Tester' };
      say((body ? 'STUBBED ' : 'OUTBOUND ') + host + where);
      setImmediate(() => {
        if (!body) { req.emit('error', new Error('the harness lets no request leave this machine')); return; }
        const res = new EventEmitter();
        res.statusCode = 200; res.headers = {};
        res.setEncoding = () => { }; res.resume = () => { };
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

let PORT = 0;
function ask(where, headers) {
  return new Promise((done) => {
    const r = http.get({ host: '127.0.0.1', port: PORT, path: where, headers: headers || {} }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { b += d; });
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', (e) => done({ status: 0, headers: {}, body: String(e) }));
    r.setTimeout(5000, () => r.destroy(new Error('timed out')));
  });
}

const sign = (v) => crypto.createHmac('sha256', SECRET).update(String(v)).digest('hex').slice(0, 32);
const DAY = 86400000;
const adminCookie = (id, name, at) =>
  'twa=' + encodeURIComponent(id + '|' + name + '|' + at + '|' + sign(id + '|' + name + '|' + at));
const setCookies = (r) => [].concat(r.headers['set-cookie'] || []);
const cookieNamed = (r, prefix) => setCookies(r).filter((c) => c.indexOf(prefix) === 0);
// name=value of each Set-Cookie, the part a browser sends back.
const pairOf = (c) => String(c || '').split(';')[0];
const stateOf = (r) => {
  try { return new URL(r.headers.location).searchParams.get('state') || ''; } catch (e) { return ''; }
};
const whereTo = (r) => String(r.headers.location || '');
const readLog = () => { try { return fs.readFileSync(path.join(dir, 'site.log'), 'utf8'); } catch (e) { return ''; } };
const readOutbound = () => { try { return fs.readFileSync(OUTBOUND, 'utf8'); } catch (e) { return ''; } };
const exchanges = () => readOutbound().split('\n').filter((l) => l === 'STUBBED discord.com/api/oauth2/token').length;

// The real refresh() out of the door block, with the few names it closes over.
function grabRefresh() {
  const src = fs.readFileSync(GAME_SRC, 'utf8');
  const door = src.indexOf('// ==== thornswood door ====');
  if (door < 0) throw new Error('gamemode.js has no door block');
  // done since #2551: an office change in the game waits on one read.
  const at = src.indexOf('function refresh(done)', door);
  if (at < 0) throw new Error('the door block has no refresh()');
  const b = src.indexOf('{', at);
  let d = 0;
  for (let i = b; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return src.slice(at, i + 1); }
  }
  throw new Error('unbalanced braces reading refresh()');
}

function runRefresh(refreshSrc, privDir, FILE, sent, notes) {
  let doorSaid = false, readAt = 0, listAt = 0;
  const note = (line) => { notes.push(String(line)); };
  // The engine's whole-file write (#2740), as far as the door can tell.
  const mp = { writeFileWhole: (p, text) => fs.writeFileSync(p, text) };
  // The scratch site is plain http, so the door's https is http here, with
  // every call written down on the way past.
  const require = (m) => {
    if (m !== 'https') throw new Error('refresh() asked for ' + m);
    return {
      get: function () {
        sent.push(Array.prototype.slice.call(arguments, 0, 2));
        return http.get.apply(http, arguments);
      }
    };
  };
  eval(refreshSrc + '\nrefresh();');
}

(async () => {
  PORT = await freePort();
  const srv = spawn(process.execPath, ['-r', path.join(dir, 'stub.js'), 'server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_DOCS_PORT: String(PORT),
      THORNSWOOD_DOCS_LOCAL: '1',
      TS_STUB_LOG: OUTBOUND
    })
  });
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });

  try {
    await listening(srv, PORT);

    // ==== the key ============================================================
    console.log('');
    console.log('THE DOOR KEY');
    let r = await ask('/api/allowed', { 'X-Thornswood-Key': KEY });
    let doc = {}; try { doc = JSON.parse(r.body); } catch (e) { }
    yes('the key in the X-Thornswood-Key header is answered 200', r.status === 200);
    yes('and the answer carries the linked profile', Array.isArray(doc.profiles) && doc.profiles.indexOf(PROFILE) >= 0);
    r = await ask('/dev/api/allowed', { 'X-Thornswood-Key': KEY });
    yes('the dev door takes the header as well', r.status === 200);
    r = await ask('/api/allowed');
    yes('no key at all is 401', r.status === 401);
    r = await ask('/api/allowed', { 'X-Thornswood-Key': 'x' + KEY.slice(1) });
    yes('a wrong key in the header is 401', r.status === 401);
    r = await ask('/api/allowed?key=' + KEY, { 'X-Thornswood-Key': 'wrong' });
    yes('a wrong header with the right key in the address is 401: the header decides', r.status === 401);
    yes('no refusal wrote the note about the address form', readLog().indexOf('sent its key in the address') < 0);

    // The one release of grace, for a game server whose gamemode predates the
    // header. When that is gone this check turns round to 401.
    r = await ask('/api/allowed?key=' + KEY);
    yes('for one release the key in the address is still answered 200', r.status === 200);
    await ask('/dev/api/allowed?key=' + KEY);
    await ask('/api/allowed?key=' + KEY);
    const said = readLog().split('\n').filter((l) => l.indexOf('sent its key in the address') >= 0);
    yes('site.log says once per door that a door still uses the address', said.length === 2);

    r = await ask('/%?key=' + KEY);
    yes('a malformed address with a key in its query is 400', r.status === 400);
    yes('site.log names the path of the malformed request', readLog().indexOf('malformed request "/%"') >= 0);
    yes('the key is nowhere in site.log', readLog().indexOf(KEY) < 0);

    // ==== the cookie =========================================================
    console.log('');
    console.log('THE DISCORD COOKIE');
    const now = Date.now();
    r = await ask('/api/hello', { Cookie: adminCookie(ADMIN_ID, 'Tester', now) });
    yes('a cookie made now reads as signed in', r.status === 200);
    r = await ask('/api/hello', { Cookie: adminCookie(ADMIN_ID, 'Tester', now - 29 * DAY) });
    yes('a cookie 29 days old still reads as signed in', r.status === 200);
    r = await ask('/api/hello', { Cookie: adminCookie(ADMIN_ID, 'Tester', now - 31 * DAY) });
    yes('a cookie 31 days old reads as signed out, whatever Max-Age the browser kept', r.status === 401);
    const stale = decodeURIComponent(adminCookie(ADMIN_ID, 'Tester', now - 31 * DAY).slice(4)).split('|');
    stale[2] = String(now);
    r = await ask('/api/hello', { Cookie: 'twa=' + encodeURIComponent(stale.join('|')) });
    yes('the same cookie with its date moved forward and the old signature is signed out', r.status === 401);
    r = await ask('/api/hello', { Cookie: adminCookie(ADMIN_ID, 'Tester', now + 2 * DAY) });
    yes('a cookie dated in the future is signed out', r.status === 401);
    r = await ask('/api/hello', { Cookie: 'twa=' + encodeURIComponent(ADMIN_ID + '|Tester|' + sign(ADMIN_ID + '|Tester')) });
    yes('the old three part cookie, signed and undated, is signed out', r.status === 401);

    // ==== the state ==========================================================
    console.log('');
    console.log('THE SIGN IN STATE');
    const start = '/auth/discord?back=%2Flink&port=53120&nonce=abc123';
    const a = await ask(start);
    const b = await ask(start);
    yes('/auth/discord sends the browser to Discord', a.status === 302 && whereTo(a).indexOf('https://discord.com/api/oauth2/authorize') === 0);
    yes('two attempts at the same page get two different states', stateOf(a) && stateOf(b) && stateOf(a) !== stateOf(b));
    const ca = cookieNamed(a, 'twst_')[0] || '';
    const cb = cookieNamed(b, 'twst_')[0] || '';
    yes('each attempt sets its own cookie', !!ca && !!cb && pairOf(ca).split('=')[0] !== pairOf(cb).split('=')[0]);
    yes('scoped to the sign in addresses, HttpOnly, SameSite=Lax, ten minutes',
        /; Path=\/auth\/discord;/.test(ca) && /HttpOnly/.test(ca) && /SameSite=Lax/.test(ca) && /Max-Age=600\b/.test(ca));
    let bits = [];
    try { bits = Buffer.from(stateOf(a).split('.')[0], 'base64url').toString().split('\u0000'); } catch (e) { }
    yes('the launcher\'s nonce still rides inside the state', bits[2] === 'abc123' && bits[1] === '53120');

    const callback = (st, code) => '/auth/discord/callback?' + (code ? 'code=' + code + '&' : '') +
                                   'state=' + encodeURIComponent(st);
    const before = exchanges();

    r = await ask(callback(stateOf(a), 'harness-code'));
    yes('a state finished in a browser that did not start it is refused', r.status === 302 && whereTo(r) === '/?discord=expired');
    r = await ask(callback(stateOf(a), 'harness-code'), { Cookie: pairOf(cb) });
    yes('a state with another attempt\'s cookie is refused', whereTo(r) === '/?discord=expired');
    const forged = stateOf(a).split('.')[0] + '.' + '0'.repeat(32);
    r = await ask(callback(forged, 'harness-code'), { Cookie: pairOf(ca) });
    yes('a state with a broken signature is refused', whereTo(r) === '/?discord=expired');
    yes('none of those three asked Discord anything', exchanges() === before);

    // The whole launcher round trip, with Discord answered by the stub.
    const jar = pairOf(ca) + '; ' + pairOf(cb);
    r = await ask(callback(stateOf(b), 'harness-code'), { Cookie: jar });
    const loop = whereTo(r);
    yes('the second tab finishes first and lands on the launcher\'s port', loop.indexOf('http://127.0.0.1:53120/thornswood?ticket=') === 0);
    yes('with the launcher\'s nonce on it, unchanged', /[?&]nonce=abc123$/.test(loop));
    const minted = cookieNamed(r, 'twa=')[0] || '';
    yes('the cookie it makes carries a date inside the signature', decodeURIComponent(pairOf(minted).slice(4)).split('|').length === 4);
    r = await ask('/api/hello', { Cookie: pairOf(minted) });
    yes('and that cookie reads as signed in', r.status === 200);
    const r2 = await ask(callback(stateOf(a), 'harness-code'), { Cookie: jar });
    yes('the first tab still finishes after it: one attempt does not overwrite another', whereTo(r2).indexOf('http://127.0.0.1:53120/thornswood?ticket=') === 0);
    const cleared = cookieNamed(r2, pairOf(ca).split('=')[0] + '=')[0] || '';
    yes('finishing clears that attempt\'s cookie', /Max-Age=0\b/.test(cleared));
    yes('those two sign ins asked Discord once each', exchanges() === before + 2);

    r = await ask(callback(stateOf(a), 'harness-code'), { Cookie: jar });
    yes('the used state again, cookie and all, is refused', whereTo(r) === '/?discord=expired');
    r = await ask(callback(stateOf(b), 'harness-code'));
    yes('the used state again without its cookie is refused', whereTo(r) === '/?discord=expired');
    yes('and neither replay asked Discord anything', exchanges() === before + 2);

    // Built here with the scratch secret, so the age is the only difference
    // between these two.
    const built = (began) => {
      const attempt = crypto.randomBytes(16).toString('hex');
      const raw = Buffer.from('/\u0000\u0000\u0000' + attempt + '\u0000' + began).toString('base64url');
      return { state: raw + '.' + sign(raw), cookie: 'twst_' + attempt.slice(0, 8) + '=' + attempt };
    };
    const fresh = built(Date.now());
    r = await ask(callback(fresh.state, ''), { Cookie: fresh.cookie });
    yes('a state built the same way and begun now is taken (cancelled at Discord)', whereTo(r) === '/?discord=cancelled');
    const old = built(Date.now() - 11 * 60000);
    r = await ask(callback(old.state, ''), { Cookie: old.cookie });
    yes('one begun eleven minutes ago is refused even with its cookie', whereTo(r) === '/?discord=expired');

    // ==== the sending half ===================================================
    console.log('');
    console.log('THE GAMEMODE THAT SENDS IT');
    const priv = path.join(dir, 'private');
    fs.mkdirSync(priv, { recursive: true });
    fs.writeFileSync(path.join(priv, 'door.json'), JSON.stringify({ site: 'http://127.0.0.1:' + PORT, key: KEY }));
    const FILE = path.join(priv, 'allowed.json');
    const sent = [], notes = [];
    runRefresh(grabRefresh(), priv, FILE, sent, notes);
    for (let i = 0; i < 50 && !fs.existsSync(FILE) && !notes.length; i++) {
      await new Promise((ok) => setTimeout(ok, 100));
    }
    const first = sent[0] || [];
    const asked = String(first[0] || '');
    const opts = (first[1] && typeof first[1] === 'object') ? first[1] : {};
    const hdrs = opts.headers || {};
    yes('refresh() asks the site once', sent.length === 1);
    yes('the address it asks carries no key', asked.indexOf(KEY) < 0 && !/[?&]key=/.test(asked));
    yes('the key goes in the X-Thornswood-Key header', hdrs['X-Thornswood-Key'] === KEY);
    let got = {};
    try { got = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { }
    yes('and the site answers it: allowed.json is written with the profile',
        Array.isArray(got.profiles) && got.profiles.indexOf(PROFILE) >= 0);
    yes('the door says the list was refreshed', notes.some((n) => n.indexOf('list refreshed from the site') === 0));

    // ==== nothing left ===========================================================
    console.log('');
    yes('no request tried to leave this machine', readOutbound().indexOf('OUTBOUND') < 0);
    yes('the key is still nowhere in site.log', readLog().indexOf(KEY) < 0);
  } catch (e) {
    fail++;
    console.log('FAIL  the harness itself threw: ' + (e && e.stack ? e.stack : e));
  }

  // Gone before the folder is removed, because Windows will not delete a log
  // another process still holds open.
  await new Promise((ok) => {
    srv.on('exit', ok);
    try { srv.kill(); } catch (e) { ok(); }
    setTimeout(ok, 3000);
  });
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
