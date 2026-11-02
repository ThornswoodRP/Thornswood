/*
  test-line-close.js

  The line at the menu (#481), the relay's half. Patrick, 29 Sep: "they
  shouldn't need to check in while waiting in the queue ... just have it
  automatically lose a player's spot when they disconnect."

  The menu waits in line over its chat socket to this service. When the
  socket that said "/line" closes, and no other socket of the same profile is
  waiting, the game server has to hear of it at once: "/line gone" under that
  profile, marked relay, which nobody can send by typing it. And GET
  /commands carries this process's boot stamp, so the gamemode can tell a
  restart (whose sockets die without a word) and give every menu a minute to
  ask again.

  This spawns the real voice-server.js in a scratch folder on a spare port
  and drives it over real WebSockets, then restarts it. Nothing here is a
  stand-in.

  Read only apart from its own temp folder.
*/
const { spawn } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const net = require('net');
const http = require('http');
const path = require('path');
const os = require('os');

// Set by start(), from the system, each time the service starts. It was a
// fixed 7911, the same as test-cull.js and voice/tests/test-command-ack.js (#1703).
let PORT = 0;

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

/*
  How long any one answer is waited for before the wait gives up and says
  what did not come. Each check waits for the thing it reads (#1926), so this
  only ends a wait on a service that is stuck, as listening() does.
*/
const BOUND_MS = 15000;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-lineclose-'));
fs.copyFileSync(path.join(__dirname, '..', 'voice-server.js'), path.join(dir, 'voice-server.js'));
fs.copyFileSync(path.join(__dirname, '..', 'headlines.js'), path.join(dir, 'headlines.js'));
/*
  Every join proves itself with a token (#1303); one token opens one
  connection and goes with the handshake, after 'thornswood' (#1337, #1322).
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
  A join token as the launcher gets one: asked of the service, which mints
  it on its own clock once the site says the ticket owns the profile. It was
  signed here with this process's Date.now(), and the service refuses a
  token minted before it started by its own clock; on Windows two node
  processes can read the wall clock a few ms apart, so the first token could
  read as older than the service (#1867, #1963).
*/
function joinToken(port, pid) {
  return new Promise((ok, bad) => {
    const body = JSON.stringify({ profileId: pid, ticket: 'a ticket the stand-in site takes' });
    const req = http.request({ host: '127.0.0.1', port: port, path: '/token', method: 'POST', agent: false,
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
let log = '';
async function start() {
  SITE = SITE || await siteThatSaysYes();
  PORT = await freePort('0.0.0.0');
  srv = spawn(process.execPath, ['voice-server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_VOICE_PORT: String(PORT),
      THORNSWOOD_SITE: SITE,
      THORNSWOOD_CHAT_DIR: path.join(dir, 'chat'),
    }),
  });
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });
  await listening(srv, PORT);
}

/* Ended rather than exited; see test-keepalive.js. */
function done(code) {
  process.exitCode = code;
  try { srv.kill(); } catch (e) { }
  setTimeout(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  }, 300).unref();
}

async function ready() {
  const r = await fetch('http://127.0.0.1:' + PORT + '/health');
  if (!r.ok) { throw new Error('the service answered /health with ' + r.status + '. log:\n' + log); }
  return await r.json();
}

async function person(profileId, name) {
  const token = await joinToken(PORT, profileId);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT + '/', ['thornswood', token]);
    const me = { ws: ws, name: name, peer: 0, pongs: [], closed: null };
    me.closed = new Promise((ok) => { ws.addEventListener('close', ok); });
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', profileId: profileId, name: name }));
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'welcome') { me.peer = m.peer; resolve(me); }
      if (m.t === 'pong') { const p = me.pongs.shift(); if (p) { p(); } }
    };
    ws.onerror = () => reject(new Error('socket error joining as ' + name));
    setTimeout(() => reject(new Error('no welcome for ' + name + ' in four seconds')), 4000);
  });
}
const say = (p, text) => p.ws.send(JSON.stringify({ t: 'chat', text: text }));
async function commands() {
  return (await (await fetch('http://127.0.0.1:' + PORT + '/commands')).json());
}

/*
  A page's own ping, answered once the service has handled everything this
  socket sent before it (#519), so every command said before it is queued
  by the time the pong is in. This used to ask /commands 200 ms after
  sending instead, so on a busy machine a command could still be on its way
  (#1926).
*/
function settle(p) {
  return new Promise((ok, bad) => {
    const late = setTimeout(() => bad(new Error('no pong to a ping from ' + p.name + ' within ' + BOUND_MS / 1000 + ' s')), BOUND_MS);
    p.pongs.push(() => { clearTimeout(late); ok(); });
    p.ws.send(JSON.stringify({ t: 'ping' }));
  });
}

/*
  Closed, and resolved once the service has answered the close frame and
  the socket is gone. The service writes that answer and runs the leaving
  (lineClosed) in the same turn, so what /commands says after this is all
  the close did. It used to give the close 300 ms (#1926).
*/
function shut(p) {
  return new Promise((ok, bad) => {
    const late = setTimeout(() => bad(new Error('the socket of ' + p.name + ' was not closed within ' + BOUND_MS / 1000 + ' s')), BOUND_MS);
    p.closed.then(() => { clearTimeout(late); ok(); });
    p.ws.close();
  });
}

/* Whether the service's log says it, waited for until the line has come
   through its pipe. The line is written before what it goes with, but on
   another pipe, and on a busy machine that can come first (#1867). */
function logSays(re) {
  return new Promise((ok) => {
    if (re.test(log)) { ok(true); return; }
    const said = () => { if (re.test(log)) { end(true); } };
    const late = setTimeout(() => end(false), BOUND_MS);
    function end(v) { clearTimeout(late); srv.stdout.removeListener('data', said); ok(v); }
    srv.stdout.on('data', said);
  });
}

(async () => {
  await start();
  const h = await ready();
  console.log('service up: build ' + h.build);
  yes('the build says it has the line close', /line-close-1/.test(h.build));

  // ---- a waiting menu closes -------------------------------------------------
  const waiter = await person(501, 'Waiter');
  say(waiter, '/line');
  await settle(waiter);
  let got = await commands();
  const boot1 = got.boot;
  yes('GET /commands carries the boot stamp', typeof boot1 === 'string' && boot1.length >= 8);
  yes('the "/line" went to the game server as an ordinary command, not marked relay',
      got.commands.length === 1 && got.commands[0].text === '/line' && got.commands[0].relay === false);
  await shut(waiter);
  got = await commands();
  const gone = got.commands.filter((c) => c.text === '/line gone');
  yes('the waiting socket closing tells the game server at once: "/line gone" under that profile',
      gone.length === 1 && gone[0].profileId === 501);
  yes('marked relay, so the gamemode knows it is the service and not a person', gone[0] && gone[0].relay === true);
  yes('and the service log says so', await logSays(/profile 501 was waiting in line and its connection closed/));

  // ---- somebody who never waited, or stopped waiting ---------------------------
  const walker = await person(502, 'Walker');
  say(walker, 'hello');
  say(walker, '/roll 20');
  await settle(walker);
  await commands();
  await shut(walker);
  got = await commands();
  yes('a socket that never said "/line" closes without a word to the game server',
      got.commands.filter((c) => c.text === '/line gone').length === 0);
  const leaver = await person(503, 'Leaver');
  say(leaver, '/line');
  say(leaver, '/line leave');
  await settle(leaver);
  await commands();
  await shut(leaver);
  got = await commands();
  yes('one that said "/line leave" closes without one either (the leave already said it)',
      got.commands.filter((c) => c.text === '/line gone').length === 0);

  // ---- two sockets of one profile ------------------------------------------------
  const a = await person(504, 'Twice');
  const b = await person(504, 'Twice');
  say(a, '/line'); say(b, '/line');
  await settle(a);
  await settle(b);
  await commands();
  await shut(a);
  got = await commands();
  yes('while another socket of the same profile still waits, one closing says nothing',
      got.commands.filter((c) => c.text === '/line gone').length === 0);
  await shut(b);
  got = await commands();
  yes('the last one closing does', got.commands.filter((c) => c.text === '/line gone' && c.profileId === 504).length === 1);

  // ---- moved out for being idle ---------------------------------------------------
  const idle = await person(505, 'Idle');
  say(idle, '/afk out');
  await settle(idle);
  await commands();
  await shut(idle);
  got = await commands();
  yes('a game moved out for being idle waits from its "/afk out", so its close is told too',
      got.commands.filter((c) => c.text === '/line gone' && c.profileId === 505).length === 1);

  // ---- a typed "/line gone" -------------------------------------------------------
  const typer = await person(506, 'Typer');
  say(typer, '/line gone');
  await settle(typer);
  got = await commands();
  yes('a person typing "/line gone" is not marked relay, so the gamemode does not take it',
      got.commands.filter((c) => c.text === '/line gone').length === 1 &&
      got.commands.filter((c) => c.text === '/line gone').every((c) => c.relay === false));
  await shut(typer);

  // ---- a restart -------------------------------------------------------------------
  // The first service is waited out, and the second is on a port of its own,
  // so nothing below can be answered by the one that was stopped.
  await new Promise((r) => { srv.once('exit', r); srv.kill(); });
  await start();
  await ready();
  got = await commands();
  yes('after a restart the boot stamp is new, which is how the gamemode knows to give the line a minute',
      typeof got.boot === 'string' && got.boot !== boot1);

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  done(fail ? 1 : 0);
})().catch((e) => {
  console.error('FAILED: ' + e.message);
  console.error(log);
  console.log('');
  console.log(pass + ' passed, ' + (fail + 1) + ' failed');
  done(1);
});
