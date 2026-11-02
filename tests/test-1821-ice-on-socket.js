/*
  test-1821-ice-on-socket.js

      node tests\test-1821-ice-on-socket.js

  #1821. /ice handed the relay only to a page that POSTed a join token that
  checked out (#1307), and since #1322 a token is good for two minutes and
  opens one connection. The game's voice overlay sent the token its
  connection was opened with, so after its first two minutes it was handed
  STUN only for the rest of the session.

  Now the list rides every roster ({ t: 'peers', peers, iceServers }), which
  is when a page builds its connections, over the socket its token proved at
  the handshake. /ice reads no token. This starts the real service in a temp
  folder with a relay and its coturn secret set and a token life of one
  second, signs its own join tokens with a key it puts beside the service,
  and proves:

    1. a page's first roster carries the relay, with a credential coturn
       takes;
    2. a page connected for longer than a token lives still gets the relay,
       fresher, on the next roster;
    3. /ice hands a page the STUN list whatever token it sends, and the
       relay only to this machine;
    4. with no relay set, the roster carries the STUN list and nothing else;
    5. the clients: the game's chat socket keeps no token for anybody once
       its handshake has spent it, the game's voice overlay takes the list
       from the roster and asks /ice for nothing, and the launcher's voice
       (C# since #4823, run here by tests\voice-launcher.js) asks the
       roster's relay for its connections, keeps the list when a roster
       carries none, says so once, and asks /ice for nothing.

  Every join token a page joins with is minted by the service itself, on
  its own clock, the way the launcher gets one: POST /token, with a stand-in
  for the site that says every ticket owns its profile. It used to be signed
  here, with this process's Date.now(), and the service refuses a token
  minted before it started by its own clock. On Windows each node process
  reads the wall clock from its own anchor (V8 takes GetSystemTimeAsFileTime,
  as coarse as the system timer, up to 15.6 ms, once, then counts from it),
  so two processes can disagree: 3.5 ms measured on the runner. A token
  signed here as the service said it was listening, 8 to 27 ms after its
  start by the runner's measure, could then read as older than the service.
  That is the one refusal a new service can give such a token, and part 4's
  page on the VPS runners was answered as fast as a pass and got no roster
  (#1867, #1889, #1897). Each wait is for the thing itself: a page's roster,
  or the socket refused or closed before it, which the check then names; and
  the service's log is read once the service has gone and every line of it
  is in.

  Writes only to a temp folder, on loopback ports the system hands out.
*/
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const vm = require('vm');
const crypto = require('crypto');
const dgram = require('dgram');
const { spawn } = require('child_process');
const VL = require('./voice-launcher');

const CR = String.fromCharCode(13);
const VOICE = process.env.VOICE || path.join(REPO_DIR, 'voice', 'voice-server.js');
const SECRET = 'a shared secret for the relay';
const RELAY = 'turn:relay.example.net:3478';
const STUN = JSON.stringify([{ urls: 'stun:stun.l.google.com:19302' }]);

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + why : '')); }
}
const read = (rel) => fs.readFileSync(path.join(REPO_DIR, rel), 'utf8').split(CR).join('');
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/* A port of this run's own (#1703), handed out by the system. */
function freePort(host) {
  return new Promise((ok, bad) => {
    const s = net.createServer();
    s.on('error', bad);
    s.listen(0, host, () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
/* Waits for srv's own "listening on ...:port" line, or says why it stopped. */
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

const KEY = crypto.randomBytes(32).toString('hex');
// A join token as the service makes them since #1322, minted now or when told.
function tokenFor(pid, minted) {
  const body = 'v2.' + pid + '.' + (minted || Date.now()) + '.' + crypto.randomBytes(16).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return body + '.' + crypto.createHmac('sha256', KEY).update(body).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/*
  The site, as far as the service asks it anything: every ticket owns its
  profile. So the service mints each join token itself (joinToken).
*/
function siteThatSaysYes() {
  return new Promise((ok) => {
    const site = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        if (req.method === 'POST' && req.url === '/api/play/owns') {
          res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
        } else {
          res.writeHead(404).end();
        }
      });
    });
    // Once it is up it holds nothing open, so a harness that ends by letting
    // its loop drain still ends; before that the listen itself keeps it alive.
    site.listen(0, '127.0.0.1', () => { site.unref(); ok('http://127.0.0.1:' + site.address().port); });
  });
}
let SITE = '';

/*
  The service in a temp folder, with only the environment env gives it
  (#1889). Nothing named THORNSWOOD_ is passed on from this process's own,
  so a runner with a relay, a token life or anything else of the service's
  set in its environment tests what each part says it tests.
*/
async function start(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-1821-'));
  fs.copyFileSync(VOICE, path.join(dir, 'voice-server.js'));
  fs.copyFileSync(path.join(path.dirname(VOICE), 'headlines.js'), path.join(dir, 'headlines.js'));
  fs.writeFileSync(path.join(dir, 'token-key.txt'), KEY);
  const port = await freePort('127.0.0.1');
  const own = {};
  for (const k of Object.keys(process.env)) { if (!/^THORNSWOOD_/i.test(k)) { own[k] = process.env[k]; } }
  const srv = spawn(process.execPath, ['voice-server.js'], { cwd: dir,
    env: Object.assign(own, { THORNSWOOD_VOICE_PORT: String(port), THORNSWOOD_VOICE_BIND: '127.0.0.1',
                              THORNSWOOD_SITE: SITE, THORNSWOOD_CHAT_DIR: path.join(dir, 'chat') }, env) });
  const s = { port: port, srv: srv, log: '' };
  srv.stdout.on('data', (d) => { s.log += d; });
  srv.stderr.on('data', (d) => { s.log += d; });
  await listening(srv, port);
  // The pages below are in the world, since only they hold a voice place
  // and are sent a roster (#3570): the gamemode's position feed, stood in for.
  const body = JSON.stringify({ who: [41, 42, 43].map((pid) => ({ profileId: pid, pos: [0, 0, 0], angleZ: 0, cell: 'a room' })) });
  const fed = await fetch('http://127.0.0.1:' + port + '/positions', { method: 'POST', body: body });
  if (fed.status !== 204) throw new Error('/positions answered ' + fed.status);
  return s;
}
/* Stopped, and resolved once its output has all been read ('close', not
   'exit'), so s.log is then every line it wrote. */
const stop = (s) => new Promise((ok) => { s.srv.once('close', ok); s.srv.kill(); });

/*
  A join token as the launcher gets one: asked of the service, which mints
  it on its own clock once the site says the ticket owns the profile.
*/
function joinToken(s, pid) {
  return new Promise((ok, bad) => {
    const body = JSON.stringify({ profileId: pid, ticket: 'a ticket the stand-in site takes' });
    const req = http.request({ host: '127.0.0.1', port: s.port, path: '/token', method: 'POST', agent: false,
                               headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => {
        let doc = null;
        try { doc = JSON.parse(b); } catch (e) { }
        if (res.statusCode === 200 && doc && typeof doc.token === 'string') { ok(doc.token); return; }
        bad(new Error('the service minted no token for profile ' + pid + ': ' + res.statusCode + ' ' + b.slice(0, 200)));
      });
    });
    req.on('error', bad);
    req.end(body);
  });
}
// When a token says it was minted.
const mintedOf = (token) => Number(String(token).split('.')[2]) || 0;

/* A handshake offering the token, as a page makes one: { status, body }.
   A refusal's body is the service's reason ("no: an expired token"). */
function knock(port, token) {
  return new Promise((ok) => {
    const req = http.request({ host: '127.0.0.1', port: port, path: '/', agent: false, headers: {
      connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13',
      'sec-websocket-key': crypto.randomBytes(16).toString('base64'),
      'sec-websocket-protocol': 'thornswood, ' + token } });
    req.on('upgrade', (res, socket) => { socket.destroy(); ok({ status: 101, body: '' }); });
    req.on('response', (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => ok({ status: res.statusCode, body: b }));
    });
    req.on('error', (e) => ok({ status: 0, body: String(e && e.message) }));
    req.end();
  });
}

/*
  A page in the room: the token offered with the handshake, the join, and
  every message kept. rosters() is the peers messages so far; roster(n) is
  the n-th when it comes, or null once the socket is refused or closed
  without it, and ended then says which. page() resolves on its first.

  It used to resolve on the first roster, on close, or after four seconds,
  and its callers read rosters() whatever had happened, so a refused page
  read as a roster with the wrong list (#1867). A refused handshake fires
  error, then close 1006 in node 24 (the runners) and no close at all in
  node 22, so both are heard.
  Fifteen seconds with the socket open and no roster is a stuck service, as
  in listening(), and says so.
*/
function page(port, token, pid) {
  const got = [];
  const waits = [];
  const ws = new WebSocket('ws://127.0.0.1:' + port + '/', ['thornswood', token]);
  const p = { ws: ws, got: got, ended: '', rosters: () => got.filter((m) => m.t === 'peers') };
  // Resolved once the socket has closed, so a part can let it go before it
  // stops the service under it (#1960).
  let shut = null;
  p.closed = new Promise((ok) => { shut = ok; });
  let opened = false;
  function settle() {
    const have = p.rosters();
    for (const w of waits.slice()) {
      if (have.length >= w.n || p.ended || w.late) {
        waits.splice(waits.indexOf(w), 1);
        clearTimeout(w.timer);
        if (w.late && have.length < w.n && !p.ended) { p.ended = 'no roster ' + w.n + ' within fifteen seconds, the socket still open'; }
        w.ok(have.length >= w.n ? have[w.n - 1] : null);
      }
    }
  }
  p.roster = (n) => new Promise((ok) => {
    const w = { n: n, ok: ok, late: false };
    w.timer = setTimeout(() => { w.late = true; settle(); }, 15000);
    waits.push(w);
    settle();
  });
  const end = (why) => { if (!p.ended) { p.ended = why; } settle(); };
  ws.onopen = () => { opened = true; ws.send(JSON.stringify({ t: 'join', profileId: pid, name: 'tester ' + pid })); };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    got.push(m);
    settle();
  };
  ws.onerror = () => end(opened ? 'the socket failed' : 'the handshake was refused');
  ws.onclose = (ev) => { end((opened ? 'the socket closed' : 'the handshake was refused') + ' (' + ev.code + ')'); shut(); };
  return p.roster(1).then(() => p);
}
/* What a page's roster check found, for a FAIL line: the list it got, or
   why none came and what the service wrote about it. */
function found(p, r, s) {
  if (r) { return 'it got ' + JSON.stringify(r.iceServers); }
  const said = (s.log.match(/\[voice\] REFUSED[^\n]*/g) || []).join('; ');
  return 'no roster: ' + (p.ended || 'none yet') + (said ? '; the service wrote: ' + said : '');
}

/* /ice as a page asks it through Caddy, or as this machine asks it. */
function ice(port, method, body, viaCaddy) {
  return new Promise((ok) => {
    const headers = { origin: 'null' };
    if (body != null) { headers['content-type'] = 'text/plain;charset=UTF-8'; headers['content-length'] = Buffer.byteLength(body); }
    if (viaCaddy) { headers['x-forwarded-for'] = '203.0.113.7'; headers['x-forwarded-proto'] = 'https'; }
    const req = http.request({ host: '127.0.0.1', port: port, path: '/ice', method: method, headers: headers, agent: false }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => {
        let doc = null;
        try { doc = JSON.parse(b); } catch (e) { }
        ok({ status: res.statusCode, list: (doc && doc.iceServers) || null });
      });
    });
    req.on('error', () => ok({ status: 0, list: null }));
    req.end(body == null ? undefined : body);
  });
}
/*
  A relay that only listens: a UDP socket that counts the TURN
  Allocate requests it is sent (STUN method 3, class request, with the magic
  cookie), by the address they came from. Each connection the launcher's
  voice builds from a list with a relay in it asks the relay for an address
  of its own from a socket of its own, so the senders here are the
  connections that used the relay. It answers nothing: what is measured is
  that the list was used, not the relay.

  It listens on the address the launcher's voice binds to, which is the one
  the machine reaches the internet from and never loopback (VoiceIce.cs,
  DefaultLocal, #911), found the same way. Windows sends nothing from a
  socket bound there to 127.0.0.1, so a relay on loopback heard nothing on
  Windows while Linux routed it.
*/
function usableAddress(a) {
  return typeof a === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(a) && !/^(127\.|0\.|169\.254\.)/.test(a);
}
function defaultLocal() {
  const firstUp = () => {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const n of list || []) { if (n.family === 'IPv4' && !n.internal && usableAddress(n.address)) { return n.address; } }
    }
    return '127.0.0.1';
  };
  return new Promise((ok) => {
    const s = dgram.createSocket('udp4');
    s.on('error', () => { try { s.close(); } catch (e) { } ok(firstUp()); });
    s.connect(53, '8.8.8.8', () => {
      let a = '';
      try { a = s.address().address; } catch (e) { a = ''; }
      s.close();
      ok(usableAddress(a) ? a : firstUp());
    });
  });
}
async function listeningRelay() {
  const host = await defaultLocal();
  return new Promise((ok) => {
    const u = dgram.createSocket('udp4');
    const from = new Set();
    u.on('message', (b, rinfo) => {
      if (b.length >= 20 && b.readUInt16BE(0) === 0x0003 && b.readUInt32BE(4) === 0x2112A442) { from.add(rinfo.port); }
    });
    u.bind(0, host, () => ok({ url: 'turn:' + host + ':' + u.address().port, asked: () => from.size, close: () => u.close() }));
  });
}

async function launcherVoice() {
  const VS = read('launcher/app/VoiceSession.cs');
  const relay = await listeningRelay();
  const svc = await VL.service({ env: { THORNSWOOD_TURN_URL: relay.url, THORNSWOOD_TURN_SECRET: SECRET } });
  const run = [];
  try {
    const where = (pid) => ({ profileId: pid, pos: [0, 0, 0], angleZ: 0, cell: 'c', name: 'p' + pid });
    await svc.feed([where(61), where(62), where(63)]);
    const a = await VL.join(svc, { profileId: 61, name: 'Aela' });
    run.push(a);
    const b = await VL.join(svc, { profileId: 62, name: 'Brynjolf' });
    run.push(b);
    await a.until(() => relay.asked() >= 2, 15000, 'Allocate requests at the relay').catch(() => false);
    yes('the launcher\'s voice asks the roster\'s relay for its connections (' + relay.asked() + ' of them asked)', relay.asked() >= 2);
    yes('and says it took a list with a relay in it',
        a.says(/^ice: \d+ server\(s\), relay yes$/) && b.says(/^ice: \d+ server\(s\), relay yes$/));
    const c = await VL.join(svc, { profileId: 63, name: 'Camilla' });
    run.push(c);
    await a.until(() => a.host('peers').slice(-1)[0] === '2', 15000, 'the third person on the roster').catch(() => false);
    yes('saying so in the launcher log once, not on every roster',
        a.host('log').filter((l) => /^ice: /.test(l)).length === 1);
  } finally {
    for (const l of run) { await l.quit(); }
    await svc.stop();
  }

  // A roster that carries no list, which the service never sends but a
  // session must still read right: the list it had stays. Only the first
  // launcher is handed the relay, so every request the relay sees is its.
  const relay2 = await listeningRelay();
  relay.close();
  const r = await VL.room([{ profileId: 71, name: 'Aela' }, { profileId: 72, name: 'Brynjolf' }, { profileId: 73, name: 'Camilla' }]);
  try {
    const rows = r.rows();
    const withRelay = [{ urls: relay2.url, username: '1', credential: 'x' }];
    await r.say(0, { t: 'peers', peers: rows.slice(0, 2), iceServers: withRelay });
    await r.say(1, { t: 'peers', peers: rows.slice(0, 2), iceServers: [] });
    await r.at(0).until(() => relay2.asked() >= 1, 15000, 'an Allocate').catch(() => false);
    const first = relay2.asked();
    await r.say(0, { t: 'peers', peers: rows });
    await r.say(1, { t: 'peers', peers: rows, iceServers: [] });
    await r.say(2, { t: 'peers', peers: rows, iceServers: [] });
    await r.at(0).until(() => relay2.asked() > first, 15000, 'a second Allocate').catch(() => false);
    yes('the launcher\'s voice keeps its list when a roster carries none: its next connection asks the same relay (' +
        first + ' then ' + relay2.asked() + ')', first >= 1 && relay2.asked() > first);
  } finally {
    await r.quit();
    relay2.close();
  }

  yes('every connection is built from that list, after the roster\'s list is taken',
      /JsonElement ice, peers;\s*if \(m\.TryGetProperty\("iceServers", out ice\)\) TakeIce\(ice\);\s*OnPeers\(/.test(VS) &&
      /pc\.Gather\(ICE\);/.test(VS));
  yes('and it asks /ice for nothing, so its token goes only with the handshake',
      !/\/ice"/.test(VS) && !/\/ice"/.test(read('launcher/app/Voice.cs')) &&
      /new\[\] \{ "thornswood", token \}/.test(VS) && !/WriteString\("token"/.test(VS));
}

const relayOf = (list) => (list || []).find((s) => [].concat(s.urls)[0] === RELAY);
const coturnTakes = (r) => !!r && r.credential === crypto.createHmac('sha1', SECRET).update(String(r.username)).digest('base64');

/* The brace matched body of a named function in a page's source. */
function lift(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) { return null; }
  let d = 0, s = false;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { d++; s = true; } else if (src[j] === '}') { d--; if (s && d === 0) { return src.slice(i, j + 1); } }
  }
  return null;
}

(async () => {
  SITE = await siteThatSaysYes();
  const svc = await start({ THORNSWOOD_TURN_URL: RELAY, THORNSWOOD_TURN_SECRET: SECRET,
                            THORNSWOOD_TURN_TTL: '600', THORNSWOOD_TOKEN_SECONDS: '1' });

  console.log('1. the first roster:');
  const tokA = await joinToken(svc, 41);
  const mintedA = mintedOf(tokA);
  const a = await page(svc.port, tokA, 41);
  const first = a.rosters()[0];
  yes('a page that joined is sent a roster', !!first, found(a, first, svc));
  const r1 = relayOf(first && first.iceServers);
  yes('it carries the ICE list, STUN first', !!first && Array.isArray(first.iceServers) &&
      JSON.stringify(first.iceServers[0]) === JSON.stringify(JSON.parse(STUN)[0]));
  yes('and the relay', !!r1);
  const now1 = Math.floor(Date.now() / 1000);
  yes('with a username that is an expiry about ten minutes out', !!r1 && Number(r1.username) > now1 + 500 && Number(r1.username) < now1 + 700);
  yes('and a password coturn takes, HMAC-SHA1 of it', coturnTakes(r1));

  console.log('\n2. longer in the room than a token lives:');
  await sleep(2200);
  const old = await knock(svc.port, tokenFor(41, mintedA));
  yes('a token as old as the one this page joined with is refused now (expired)',
      old.status === 403 && old.body === 'no: an expired token\n', old.status + ' ' + JSON.stringify(old.body));
  const b = await page(svc.port, await joinToken(svc, 42), 42);
  yes('somebody else joins', b.rosters().length >= 1, found(b, b.rosters()[0], svc));
  const second = await a.roster(2);
  yes('and the page that has been in the room all along is sent the next roster', !!second, found(a, second, svc));
  const r2 = relayOf(second && second.iceServers);
  yes('that roster names the newcomer', !!second && second.peers.some((p) => p.profileId === 42));
  yes('and still carries the relay', !!r2);
  yes('with a credential coturn takes', coturnTakes(r2));
  yes('minted for this roster, not the first one', !!r1 && !!r2 && Number(r2.username) > Number(r1.username));
  yes('the newcomer\'s first roster carries it too', !!relayOf((b.rosters()[0] || {}).iceServers));

  console.log('\n3. /ice reads no token:');
  let r = await ice(svc.port, 'POST', JSON.stringify({ token: tokenFor(41) }), true);
  yes('a page that POSTs a join token that checks out is handed the STUN list and no relay',
      r.status === 200 && JSON.stringify(r.list) === STUN);
  r = await ice(svc.port, 'POST', JSON.stringify({ token: tokA }), true);
  yes('and so is one that POSTs the token its connection was opened with', r.status === 200 && JSON.stringify(r.list) === STUN);
  r = await ice(svc.port, 'GET', null, true);
  yes('a plain GET through Caddy is handed the STUN list', r.status === 200 && JSON.stringify(r.list) === STUN);
  r = await ice(svc.port, 'GET', null, false);
  yes('this machine is handed the relay, which is what Install-Voice.ps1 reads', !!relayOf(r.list));
  r = await ice(svc.port, 'POST', JSON.stringify({ token: 'not a token' }), false);
  yes('by POST too, whatever the body says', !!relayOf(r.list));
  try { a.ws.close(); } catch (e) { }
  try { b.ws.close(); } catch (e) { }
  await Promise.all([a.closed, b.closed]);
  await stop(svc);
  yes('the service wrote down the expired token it refused, by profile',
      /REFUSED a connection for profile 41: an expired token/.test(svc.log));
  yes('no token reaches the service\'s log', svc.log.indexOf(tokA) < 0 && !/v2\.4[12]\.\d+\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{20,}/.test(svc.log));

  console.log('\n4. no relay set, which is every box today:');
  const bare = await start({});
  const c = await page(bare.port, await joinToken(bare, 43), 43);
  const cr = c.rosters()[0];
  try { c.ws.close(); } catch (e) { }
  await c.closed;
  await stop(bare);
  yes('the roster carries the STUN list and nothing else', !!cr && JSON.stringify(cr.iceServers) === STUN, found(c, cr, bare));

  console.log('\n5. the pages:');
  // The game's chat socket, run as it ships, with a socket that records.
  const made = [];
  function FakeSocket(url, protocols) { made.push(this); this.protocols = protocols; this.readyState = 0; this.sent = []; }
  FakeSocket.prototype.send = function (m) { this.sent.push(m); };
  FakeSocket.prototype.close = function () { this.readyState = 3; };
  const win = {
    THORNSWOOD: { host: '127.0.0.1', port: 7778, profileId: 4242, name: 'tester', token: 'v2.4242.1.injected',
                  base: 'https://thornswood.net/voice' },
    skyrimPlatform: { sendMessage: () => { } },
  };
  const box = { window: win, WebSocket: FakeSocket, console: console,
                setTimeout: () => 0, clearTimeout: () => { }, setInterval: () => 0, clearInterval: () => { } };
  vm.createContext(box);
  vm.runInContext(read('game/ui/thornswood-chat.js'), box);
  yes('the chat spends the token it was handed on its handshake', !!made[0] &&
      JSON.stringify(made[0].protocols) === JSON.stringify(['thornswood', 'v2.4242.1.injected']));
  yes('and leaves no copy in the page\'s settings', win.THORNSWOOD.token === '');
  const chat = read('game/ui/thornswood-chat.js');
  yes('and hands no token to anything else on the page', !!win.thornswoodNet && !('token' in win.thornswoodNet) &&
      !/return (TOKEN|SPENT)\b/.test(chat));

  // The game's voice overlay.
  const overlay = read('game/ui/thornswood-voice.js');
  const reported = [];
  const ov = new Function('report', 'var ICE = ' + STUN + ';\n' + lift(overlay, 'takeIce') +
                          '\nreturn { take: takeIce, ice: function () { return ICE; } };')((st, d) => reported.push(st + ' | ' + d));
  ov.take(undefined);
  ov.take([]);
  yes('the overlay keeps its list when a roster carries none', JSON.stringify(ov.ice()) === STUN);
  ov.take(second.iceServers);
  yes('and takes the roster\'s list, relay and all', !!relayOf(ov.ice()) && reported.some((l) => /relay yes/.test(l)));
  yes('before it builds anything from that roster',
      /if \(m\.t === 'peers'\) \{ takeIce\(m\.iceServers\); reconcile\(m\.peers\); return; \}/.test(overlay));
  yes('and it asks /ice for nothing and holds no token', !/\/ice'/.test(overlay) && !/\.token\(\)/.test(overlay) &&
      !/THORNSWOOD \|\| \{\}\)\.token/.test(overlay));
  yes('every peer connection is built from that list', /new RTCPeerConnection\(\{ iceServers: ICE \}\)/.test(overlay));

  // The launcher's voice, run.
  await launcherVoice();

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  /*
    Ended rather than exited (#1960). The last service's 'close' has come,
    but node is still letting go of its process and pipe handles then:
    measured with process._getActiveHandles() at this line, its
    ChildProcess (killed, SIGTERM) and a destroyed pipe were still listed,
    and gone 1 to 2 ms later. process.exit() in that moment tripped libuv's
    "!(handle->flags & UV_HANDLE_CLOSING)" (src\win\async.c:76, exit 127) on
    node 24 on Windows in 2 of 3 runs after all checks had passed. So the
    code is set and node leaves once everything is let go. The catch below
    still exits, because after a throw a service may be left running.
  */
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.log('FAIL  the harness itself: ' + (e && e.stack || e)); process.exit(1); });
