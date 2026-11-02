/*
  Entry 6, step 6: drive the real voice service and assert what a join does.

  Runs the shipped voice-server.js in a scratch folder on a spare port, mints
  tokens through its own /token route, and joins over a real WebSocket. Nothing
  here is a stand-in but the site: the file under test is voice/voice-server.js,
  and a small site in this process answers /api/play/owns the way site/server.js
  does, so every answer it can give is driven.

  Since #1315 only a yes from the site mints a token: no answer, a 500, a body
  that is not JSON, a site that never answers and a service with no
  THORNSWOOD_SITE all get 503 and no token. Since #1303 a join that cannot
  prove itself is refused whatever THORNSWOOD_VOICE_AUTH says; the service
  here is started with it set to off to show it is not read.

  Since #1337 and #1322 the token goes with the handshake, as the second of
  the protocols offered after 'thornswood', and opens that one connection:
  without one the handshake is answered 403 and never becomes a socket, and
  a token that has opened a connection opens no other.
*/
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const http = require('http');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// The repo this file sits in, so it runs from anywhere.
const REPO = path.resolve(__dirname, '..', '..');
// Set by ready(), from the system. It was a fixed 7901 (#1703).
let PORT = 0;
// The second service, with no THORNSWOOD_SITE at all.
let BARE = 0;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceauth-'));
fs.copyFileSync(path.join(__dirname, '..', 'voice-server.js'), path.join(dir, 'voice-server.js'));
fs.copyFileSync(path.join(__dirname, '..', 'headlines.js'), path.join(dir, 'headlines.js'));
fs.writeFileSync(path.join(dir, 'secret.txt'), 'a test secret, not the real one');
const KEY = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dir, 'token-key.txt'), KEY);

let pass = 0, fail = 0;
function check(what, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + what + (ok ? '' : '\n         got ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}

/*
  How long any one answer is waited for before the wait gives up and says
  what did not come. Each check waits for the thing it reads (#1926), so this
  only ends a wait on a service that is stuck, as listening() does.
*/
const BOUND_MS = 15000;

const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const mac = (key, body) => b64url(crypto.createHmac('sha256', key).update(body).digest());
// A token as the service makes them, minted at a time of this file's choosing.
const sign = (profileId, minted, key) => {
  const body = 'v2.' + profileId + '.' + minted + '.' + b64url(crypto.randomBytes(16));
  return body + '.' + mac(key || KEY, body);
};
// The hour long kind from before #1322, signed with the right key.
const signV1 = (profileId, until) => {
  const body = String(profileId) + '.' + String(until);
  return 'v1.' + body + '.' + mac(KEY, body);
};

/*
  Every HTTP request here goes through ask(), which tells the service to
  close the connection once it has answered (#1962). fetch() keeps a
  connection open for the next request, and the service closes an idle one
  on its own keep-alive timer (node's five seconds). On 5 Oct, under load,
  post('/token') went down the connection /health had left open just as the
  service closed it, and stopped on "fetch failed: read ECONNRESET" before
  any check ran. fetch sends a request over any connection it holds, even
  with Connection: close (measured: it does), but a connection whose answer
  carried that is never kept; with every request here sending it, fetch
  holds none, and each request opens its own.
*/
const ask = (url, init) => fetch(url, Object.assign({}, init,
  { headers: Object.assign({}, (init && init.headers) || {}, { connection: 'close' }) }));
const post = (route, body, port) => ask('http://127.0.0.1:' + (port || PORT) + route, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

/*
  A handshake by hand, so what the service answers a refused one can be read:
  { status, protocol, body }. 101 is a connection; anything else is not.
*/
function handshake(protocols, port) {
  return new Promise((ok) => {
    const headers = { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
                      'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64') };
    if (protocols != null) headers['Sec-WebSocket-Protocol'] = protocols;
    const req = http.request({ host: '127.0.0.1', port: port || PORT, path: '/', headers: headers, agent: false });
    req.on('upgrade', (res, socket) => {
      ok({ status: res.statusCode, protocol: res.headers['sec-websocket-protocol'] || '', body: '' });
      socket.destroy();
    });
    req.on('response', (res) => {
      let b = ''; res.on('data', (d) => { b += d; });
      res.on('end', () => ok({ status: res.statusCode, protocol: res.headers['sec-websocket-protocol'] || '', body: b }));
    });
    req.on('error', (e) => ok({ status: 0, protocol: '', body: String(e && e.message) }));
    req.end();
  });
}

/*
  The site's half: POST /api/play/owns, answered by the ticket. good owns
  every profile, other owns none (200, ok false, as site/server.js answers a
  ticket that is not theirs), boom is the 503 the site gives when it could not
  ask Discord, garbage is a 200 that is not JSON, and slow never answers, so
  the service's three second timeout is what ends it.
*/
const asked = [];
const site = http.createServer((req, res) => {
  let b = '';
  req.on('data', (d) => { b += d; });
  req.on('end', () => {
    let o = {};
    try { o = JSON.parse(b); } catch (e) { o = {}; }
    asked.push(req.url + ' ' + o.ticket + ' ' + o.profileId);
    if (req.url !== '/api/play/owns') { res.writeHead(404).end(); return; }
    if (o.ticket === 'good') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, why: 'theirs' })); return; }
    if (o.ticket === 'other') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, why: 'not theirs' })); return; }
    if (o.ticket === 'boom') { res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, why: 'could not ask Discord' })); return; }
    if (o.ticket === 'garbage') { res.writeHead(200, { 'content-type': 'text/html' }).end('<html>a login page</html>'); return; }
    if (o.ticket === 'slow') { return; }
    res.writeHead(500).end('no');
  });
});

/*
  Join the way the pages do: the token offered with the handshake, then the
  join message. Reports the welcome, or that the connection never opened.
  With keep, the socket is left open and handed back, so a second use of the
  same token can be tried while the first is still in the room.
*/
function join(token, msg, keep) {
  return new Promise((done) => {
    const ws = token == null ? new WebSocket('ws://127.0.0.1:' + PORT + '/')
                             : new WebSocket('ws://127.0.0.1:' + PORT + '/', ['thornswood', token]);
    let answered = false;
    const finish = (v) => {
      if (answered) return;
      answered = true;
      if (!(keep && v.t === 'welcome')) { try { ws.close(); } catch (e) {} }
      if (keep) { v.ws = ws; }
      done(v);
    };
    ws.onopen = () => ws.send(JSON.stringify(msg || { t: 'join', profileId: 0, name: 'tester' }));
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'welcome') return finish({ t: 'welcome', profileId: m.profileId });
      if (m.t === 'denied') return finish({ t: 'denied', why: m.why });
    };
    ws.onerror = () => finish({ t: 'refused' });
    ws.onclose = () => finish({ t: 'refused' });
    setTimeout(() => finish({ t: 'nothing came back' }), 4000);
  });
}

/*
  A port of this run's own (#1703). Builds run side by side on the VPS, and
  with a fixed number one run's requests can be answered by another run's
  service. The system names a port nothing holds, the service is started on
  it, and nothing is asked of the port until this service has said it is
  listening there.
*/
function freePort(host) {
  return new Promise((ok, bad) => {
    const s = net.createServer();
    s.on('error', bad);
    s.listen(0, host, () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
/* Waits for srv's own "listening on ...:port" line. If it stops first,
   something took the port in between or it could not start, and the error
   says which, with what it printed. */
function listening(srv, port) {
  return new Promise((ok, bad) => {
    let out = '';
    const said = (d) => {
      out += d;
      const m = /\[voice\] listening on \S+:(\d+)/.exec(out);
      if (m && Number(m[1]) === port) { end(null); }
    };
    const more = (d) => { out += d; };
    const gone = (code) => end(new Error((/EADDRINUSE/.test(out) ? 'something else already holds port ' + port + ', so ' : '') +
                                         'the voice service stopped (exit ' + code + ') before it was listening. It printed:\n' + out));
    const late = setTimeout(() => end(new Error('the voice service did not say it was listening on ' + port +
                                                ' within fifteen seconds. It printed:\n' + out)), 15000);
    function end(err) {
      clearTimeout(late);
      srv.stdout.removeListener('data', said);
      srv.stderr.removeListener('data', more);
      srv.removeListener('exit', gone);
      if (err) { bad(err); } else { ok(); }
    }
    srv.stdout.on('data', said);
    srv.stderr.on('data', more);
    srv.on('exit', gone);
  });
}
let srv = null;
let bare = null;
// A moment before the service was started, for a token it cannot know about.
let startedBefore = 0;
let log = '';
let bareLog = '';
// The second service's folder, made in ready() and removed at the end (#1992).
let bareDir = null;
async function ready() {
  await new Promise((ok) => site.listen(0, '127.0.0.1', ok));
  PORT = await freePort('0.0.0.0');
  startedBefore = Date.now() - 50;
  srv = spawn(process.execPath, ['voice-server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_VOICE_PORT: String(PORT),
      // Not read since #1303. Off was the old behaviour, every join let in.
      THORNSWOOD_VOICE_AUTH: 'off',
      THORNSWOOD_SITE: 'http://127.0.0.1:' + site.address().port,
    }),
  });
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });
  await listening(srv, PORT);
  // A second copy in its own folder, with no site to ask (#1315).
  bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceauth-bare-'));
  for (const n of ['voice-server.js', 'headlines.js']) fs.copyFileSync(path.join(__dirname, '..', n), path.join(bareDir, n));
  BARE = await freePort('0.0.0.0');
  bare = spawn(process.execPath, ['voice-server.js'], {
    cwd: bareDir,
    env: Object.assign({}, process.env, { THORNSWOOD_VOICE_PORT: String(BARE), THORNSWOOD_VOICE_AUTH: 'log', THORNSWOOD_SITE: '' }),
  });
  bare.stdout.on('data', (d) => { bareLog += d; });
  bare.stderr.on('data', (d) => { bareLog += d; });
  await listening(bare, BARE);
  const r = await ask('http://127.0.0.1:' + PORT + '/health');
  if (!r.ok) throw new Error('the service answered /health with ' + r.status + '. log:\n' + log);
  return await r.json();
}

(async () => {
  try {
  const h = await ready();
  console.log('service up: build ' + h.build + ', auth ' + h.auth);
  check('/health says auth on, with THORNSWOOD_VOICE_AUTH set to off', h.auth, 'on');
  console.log('');

  console.log('WHAT /token MINTS (#1315):');
  // A token for profile 4242, minted by the service itself on the site's yes.
  const r = await post('/token', { profileId: 4242, ticket: 'good' });
  const minted = await r.json();
  check('the site says the ticket owns it: a token', [r.status, minted.profileId, typeof minted.token], [200, 4242, 'string']);
  check('  and the site was asked about that profile with that ticket', asked.indexOf('/api/play/owns good 4242') >= 0, true);
  check('the site says it does not: 403 and no token', (await post('/token', { profileId: 4242, ticket: 'other' })).status, 403);
  const boom = await post('/token', { profileId: 4242, ticket: 'boom' });
  check('the site could not answer (its 503): 503 and no token', [boom.status, /"token"/.test(await boom.text())], [503, false]);
  check('the site answered with something that is not JSON: 503', (await post('/token', { profileId: 4242, ticket: 'garbage' })).status, 503);
  check('the site answered 500 to a ticket it did not know: 503', (await post('/token', { profileId: 4242, ticket: 'nobody' })).status, 503);
  const t0 = Date.now();
  const slow = await post('/token', { profileId: 4242, ticket: 'slow' });
  check('the site never answered: 503 once the service gave up on it', [slow.status, Date.now() - t0 >= 2500], [503, true]);
  check('no ticket at all: 400, and the site is not asked', [(await post('/token', { profileId: 4243 })).status,
        asked.some((a) => / 4243$/.test(a))], [400, false]);
  check('no profile: 400', (await post('/token', { ticket: 'good' })).status, 400);
  const none = await post('/token', { profileId: 4242, ticket: 'good' }, BARE);
  check('a service with no THORNSWOOD_SITE mints nothing: 503', none.status, 503);

  console.log('');
  console.log('WHO GETS IN (#1303, #1337, #1322), with THORNSWOOD_VOICE_AUTH off on one service and log on the other:');
  check('the token /token hands out is v2, with the profile second',
        [minted.token.split('.').length, minted.token.split('.')[0], minted.token.split('.')[1]], [5, 'v2', '4242']);
  check('and is good for two minutes', minted.until - Date.now() > 100000 && minted.until - Date.now() <= 120000, true);
  const opened = await handshake('thornswood, ' + minted.token);
  check('a real token opens the connection, and the answer names thornswood and never the token',
        [opened.status, opened.protocol], [101, 'thornswood']);
  const t2 = (await (await post('/token', { profileId: 4242, ticket: 'good' })).json()).token;
  const first = await join(t2, { t: 'join', profileId: 99, name: 'liar' }, true);
  check('it joins as the token\'s profile, whatever the join message claims', first.t + ' ' + first.profileId, 'welcome 4242');
  const again = await handshake('thornswood, ' + t2);
  check('the same token again, while its connection is still open, is refused: it was copied',
        [again.status, /already used/.test(again.body)], [403, true]);
  check('  and tells whoever presented it nothing about when', /\d{4}-\d\d-\d\dT/.test(again.body), false);
  /*
    Each of these waits for the service to have done the thing it reads: the
    pong to a page's own ping, which it sends once it has handled the second
    join before it (#519), and the socket's close, which comes once it has
    answered the close frame and let the connection go. They used to read
    300 ms after sending (#1926). BOUND_MS with neither is a stuck service,
    and the check then shows what did not come.
  */
  first.ws.send(JSON.stringify({ t: 'join', profileId: 4242, name: 'a second join on the same socket' }));
  first.ws.send(JSON.stringify({ t: 'ping' }));
  const ponged = await new Promise((ok) => {
    const late = setTimeout(() => ok('no pong within ' + BOUND_MS / 1000 + ' s'), BOUND_MS);
    first.ws.addEventListener('message', (ev) => {
      let m = null; try { m = JSON.parse(ev.data); } catch (e) { }
      if (m && m.t === 'pong') { clearTimeout(late); ok(''); }
    });
  });
  const h1 = await (await ask('http://127.0.0.1:' + PORT + '/health')).json();
  check('a second join on that connection is not a second person in the room', ponged || h1.peers, 1);
  const shut = await new Promise((ok) => {
    const late = setTimeout(() => ok('the socket not closed within ' + BOUND_MS / 1000 + ' s'), BOUND_MS);
    first.ws.addEventListener('close', () => { clearTimeout(late); ok(''); });
    first.ws.close();
  });
  check('and once that connection has closed, its token still opens nothing',
        shut || (await handshake('thornswood, ' + t2)).status, 403);

  const noTok = await handshake(null);
  check('no token at all: 403 before any socket, and the reason', [noTok.status, noTok.body.trim()], [403, 'no: no token']);
  check('thornswood offered with no token: 403', (await handshake('thornswood')).status, 403);
  const t3 = (await (await post('/token', { profileId: 4242, ticket: 'good' })).json()).token;
  check('a token offered without thornswood beside it: 403', (await handshake(t3)).status, 403);
  check('a page that sends its token in the join message, as every page did before, never gets a socket',
        (await join(null, { t: 'join', profileId: 4242, name: 'an old page', token: t3 })).t, 'refused');
  check('a made up token is refused',
        (await handshake('thornswood, v2.4242.' + Date.now() + '.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).body.trim(),
        'no: a token that does not check out');
  check('a token signed with another key is refused',
        (await handshake('thornswood, ' + sign(4242, Date.now(), 'a different key'))).body.trim(),
        'no: a token that does not check out');
  check('an hour long v1 token, signed with the right key, is not read at all',
        (await handshake('thornswood, ' + signV1(4242, Date.now() + 3600000))).body.trim(),
        'no: a token that does not check out');
  check('a token two minutes old is refused, and named as expired',
        (await handshake('thornswood, ' + sign(7, Date.now() - 121000))).body.trim(), 'no: an expired token');
  check('a token minted before this copy of the service started is refused, since its spending is not known',
        (await handshake('thornswood, ' + sign(7, startedBefore))).body.trim(), 'no: a token from before this service started');
  check('a token signed here a moment ago opens a connection', (await join(sign(7, Date.now()))).t, 'welcome');

  const was = PORT;
  PORT = BARE;
  check('the service with THORNSWOOD_VOICE_AUTH log refuses a handshake with no token too',
        (await handshake(null)).status, 403);
  PORT = was;

  /*
    The log is read once both services have gone and every line they wrote
    has come through their pipes ('close'). A line is written before the
    answer it goes with, but it travels on another pipe, and on a busy
    machine the answer can arrive first: checked straight after the 403,
    the copied token's line was not in yet in 2 of 32 runs under load (#1867).
  */
  await new Promise((ok) => { srv.once('close', ok); srv.kill(); });
  await new Promise((ok) => { bare.once('close', ok); bare.kill(); });
  check('the service with no THORNSWOOD_SITE says why it minted nothing, in its log',
        /NO TOKEN for profile 4242: THORNSWOOD_SITE is not set/.test(bareLog), true);
  check('the service writes the copied token down as copied, with when the first use was',
        /REFUSED a connection for profile 4242: a token that was already used, by another connection at \d{4}-\d\d-\d\dT[\d:.]+Z, so it was copied\. A token opens one connection/.test(log), true);
  check('nothing was let in unproven', /UNPROVEN|UNCHECKED/.test(log + bareLog), false);
  check('no token was ever written to the log', /v[12]\.\d+\.\d{12,14}\./.test(log + bareLog), false);

  console.log('');
  console.log('what the service wrote down:');
  for (const line of (log + bareLog).split('\n')) {
    if (/REFUSED|NO TOKEN|claimed profile|token is for/.test(line)) console.log('  ' + line.trim());
  }

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  // Kill, then let the loop drain before exiting. Calling process.exit while
  // the child's pipes are still closing trips a libuv assertion on Windows,
  // which looks like a failure and is not one.
  process.exitCode = fail ? 1 : 0;
  } finally {
    await cleanUp();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });

/*
  Stops both services and waits for them to exit, then removes both scratch
  folders, so a run leaves %TEMP% as it found it (#1992). A service still
  running holds its folder open on Windows, hence the wait and the retries.
*/
async function cleanUp() {
  const stopped = (c) => new Promise((r) => {
    if (!c || c.exitCode !== null || c.signalCode !== null) return r();
    c.once('exit', () => r());
    c.kill();
    setTimeout(r, 5000).unref();
  });
  await Promise.all([stopped(srv), stopped(bare)]);
  site.close();
  for (const d of [dir, bareDir]) {
    if (!d) continue;
    try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
    catch (e) { console.error('could not remove ' + d + ': ' + e.message); process.exitCode = 1; }
  }
  // Let the loop drain before exiting: process.exit while the children's
  // pipes are still closing trips a libuv assertion on Windows.
  setTimeout(() => {}, 150);
}
