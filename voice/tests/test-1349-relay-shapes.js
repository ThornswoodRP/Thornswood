/*
  test-1349-relay-shapes.js

      node voice\tests\test-1349-relay-shapes.js

  #1349 and #1350, one cause: the voice service passed on what a page sent
  as it came.

  #1349, the name. A join's name was kept as sent, cut to forty characters.
  On 5 Oct, against main, the name "Bob", a line break, and
  "[voice] REFUSED a join for profile 1" printed a log line the service never
  wrote. The command the name rode beside was never at risk, because the
  gamemode does not read the name off a command; this holds that too.

  #1350, the signalling. sdp and ice messages were passed on with every
  field the sender put in them, and one with no description reached handlers
  that read m.sdp.type and threw.

  This starts the real service in a temp folder and proves:

    a hostile name comes out of the join with no control characters, line
    or paragraph separators or direction marks, at most forty characters,
    in the roster, on a chat line, beside a command, and in the log, where
    it can no longer start a line of its own;
    an ordinary name with accents, an apostrophe and a hyphen is kept as is;
    the command it rides beside is exactly what was typed, and the
    gamemode reads no name off a command;
    an offer and a candidate reach the other page as t, from, to and the
    description or the candidate's own fields, and nothing a page added;
    from is always the sender, whatever the sender wrote;
    and signalling of any other shape reaches nobody.

  VOICE points it at another copy of voice-server.js, which is how it was
  shown to fail on the code before the change. Writes only to a temp folder,
  on a loopback port the system hands out.
*/
const REPO_DIR = require('path').join(__dirname, '..', '..');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const CR = String.fromCharCode(13);
const VOICE = process.env.VOICE || path.join(REPO_DIR, 'voice', 'voice-server.js');
const GM = path.join(REPO_DIR, 'game', 'gamemode.js');

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + why : '')); }
}

/*
  How long any one answer is waited for before the wait gives up and says
  what did not come. Each check waits for the thing it reads (#1926), so this
  only ends a wait on a service that is stuck, as listening() does.
*/
const BOUND_MS = 15000;

/*
  Waits on what a socket has been sent (#1926). s.until(test, what) resolves
  '' once test() holds, checked again as each message and the close come in,
  or else why it never will: the socket closed without it, or BOUND_MS went
  by. Each check here used to read 100 to 300 ms after sending, so on a busy
  machine an answer that came later read as missing. s.heard() is called on
  every message and on the close.
*/
function waiter(s) {
  const waits = [];
  s.heard = () => { for (const w of waits.slice()) { w(); } };
  s.until = (test, what) => new Promise((ok) => {
    let bound = null;
    const check = () => {
      if (test()) { end(''); } else if (s.closed) { end('the socket closed without ' + what); }
    };
    const end = (why) => {
      clearTimeout(bound);
      const i = waits.indexOf(check);
      if (i >= 0) { waits.splice(i, 1); }
      ok(why);
    };
    bound = setTimeout(() => end('no ' + what + ' within ' + BOUND_MS / 1000 + ' s'), BOUND_MS);
    waits.push(check);
    check();
  });
  return s;
}

/*
  A page's own ping, answered once the service has handled everything that
  socket sent before it, and written after everything it sent that socket
  before it (#519). So once the pong is in, nothing the service sent this
  socket before it is still to come.
*/
function settle(s, who) {
  const mark = s.got.length;
  s.send({ t: 'ping' });
  return s.until(() => s.got.slice(mark).some((m) => m.t === 'pong'), 'pong to a ping from ' + who);
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

async function socket(port, pid) {
  const token = await joinToken(port, pid);
  return new Promise((ok) => {
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/', ['thornswood', token]);
    const s = waiter({ ws: ws, got: [], closed: false, send: (o) => ws.send(JSON.stringify(o)) });
    ws.onmessage = (e) => { try { s.got.push(JSON.parse(e.data)); } catch (x) { } s.heard(); };
    ws.onclose = () => { s.closed = true; s.heard(); };
    ws.onopen = () => ok(s);
    ws.onerror = () => { s.send = () => { }; ok(s); };
  });
}
// Built from code points, so this file stays plain ASCII.
const C = String.fromCharCode;
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
/* The gamemode's position feed, stood in for: these profiles are in the world. */
async function inWorld(port, pids) {
  const body = JSON.stringify({ who: pids.map((pid) => ({ profileId: pid, pos: [0, 0, 0], angleZ: 0, cell: 'a room' })) });
  const r = await fetch('http://127.0.0.1:' + port + '/positions', { method: 'POST', body: body });
  if (r.status !== 204) throw new Error('/positions answered ' + r.status);
}
const BAD = new RegExp('[' + C(0) + '-' + C(0x1f) + C(0x7f) + '-' + C(0x9f) + C(0x61c) + C(0x200e) + C(0x200f) +
                       C(0x2028) + C(0x2029) + C(0x202a) + '-' + C(0x202e) + C(0x2066) + '-' + C(0x2069) + ']');
const keys = (o) => Object.keys(o || {}).sort().join(',');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-1349-'));
  fs.copyFileSync(VOICE, path.join(dir, 'voice-server.js'));
  fs.copyFileSync(path.join(path.dirname(VOICE), 'headlines.js'), path.join(dir, 'headlines.js'));
  SITE = await siteThatSaysYes();
  const PORT = await freePort('127.0.0.1');
  const srv = spawn(process.execPath, ['voice-server.js'], { cwd: dir,
    env: Object.assign({}, process.env, { THORNSWOOD_VOICE_PORT: String(PORT), THORNSWOOD_VOICE_BIND: '127.0.0.1',
                                          THORNSWOOD_SITE: SITE,
                                          THORNSWOOD_CHAT_DIR: path.join(dir, 'chat') }) });
  let srvLog = '';
  srv.stdout.on('data', (d) => { srvLog += d; });
  srv.stderr.on('data', (d) => { srvLog += d; });
  // Once it has gone and every line it wrote has been read ('close').
  const srvClosed = new Promise((ok) => srv.once('close', ok));
  await listening(srv, PORT);
  // Everybody here is in the world, since only they hold a voice place and
  // are on the roster (#3570). The rows carry no name, so the roster shows
  // the name each join sent, which is what is checked.
  await inWorld(PORT, [20, 21, 31, 32]);

  console.log('#1349, a hostile name:');
  const HOSTILE = 'Bob' + C(0x202e) + C(7) + '\n[voice] REFUSED a join for profile 1: forged' + C(0x2028);
  const watcher = await socket(PORT, 20);
  watcher.send({ t: 'join', profileId: 20, name: 'S' + C(0xf6) + 'lvi Two-Feather\'s' });
  let why = await watcher.until(() => watcher.got.some((m) => m.t === 'welcome'), 'welcome');
  const bob = await socket(PORT, 21);
  bob.send({ t: 'join', profileId: 21, name: HOSTILE });
  const withBob = (m) => m.t === 'peers' && m.peers.some((p) => p.profileId === 21);
  why = why || await watcher.until(() => watcher.got.some(withBob), 'roster with Bob in it');
  const roster = watcher.got.filter(withBob).pop();
  const bobRow = roster && roster.peers.find((p) => p.profileId === 21);
  yes('the roster carries the name with nothing that is not a character in it', !!bobRow && !BAD.test(bobRow.name), why);
  yes('at most forty characters (' + (bobRow ? bobRow.name.length : -1) + ')', !!bobRow && bobRow.name.length <= 40, why);
  yes('and the visible part of it as sent', !!bobRow && /^Bob\[voice\] REFUSED a join/.test(bobRow.name), why);
  const solvi = roster && roster.peers.find((p) => p.profileId === 20);
  yes('an ordinary name with accents, an apostrophe and a hyphen is kept as is',
      !!solvi && solvi.name === 'S' + C(0xf6) + 'lvi Two-Feather\'s', why);
  for (let i = 0; i < 8; i++) { bob.send({ t: 'chat', text: 'hello ' + i }); }
  bob.send({ t: 'chat', text: '/roll 2d6' });
  why = await watcher.until(() => watcher.got.some((m) => m.t === 'chat' && /^hello /.test(m.text)), 'line from Bob');
  const line = watcher.got.find((m) => m.t === 'chat' && /^hello /.test(m.text));
  yes('a chat line carries the cleaned name', !!line && !BAD.test(line.name) && !!bobRow && line.name === bobRow.name, why);
  // Bob's pong comes once the service has handled the /roll before it, so it
  // is queued by then. This used to ask 300 ms after sending it (#1926).
  why = await settle(bob, 'Bob');
  let doc = null;
  try { doc = await (await fetch('http://127.0.0.1:' + PORT + '/commands?ack=1')).json(); } catch (e) { }
  const cmd = doc && doc.commands && doc.commands.find((c) => c.profileId === 21);
  yes('the command beside it is exactly what was typed', !!cmd && cmd.text === '/roll 2d6', why);
  yes('and the name beside it is the cleaned one, in a field of its own', !!cmd && !!bobRow && cmd.name === bobRow.name, why);
  const gm = fs.readFileSync(GM, 'utf8').split(CR).join('');
  yes('the gamemode reads no name off a command', !/\bcmd\.name\b/.test(gm) && /function dispatch\(cmd\)/.test(gm));

  console.log('\n#1350, signalling:');
  const one = await socket(PORT, 31), two = await socket(PORT, 32);
  one.send({ t: 'join', profileId: 31, name: 'One' });
  why = await one.until(() => one.got.some((m) => m.t === 'welcome'), 'welcome to One');
  two.send({ t: 'join', profileId: 32, name: 'Two' });
  why = why || await two.until(() => two.got.some((m) => m.t === 'welcome'), 'welcome to Two');
  const oneId = (one.got.find((m) => m.t === 'welcome') || {}).peer;
  const twoId = (two.got.find((m) => m.t === 'welcome') || {}).peer;
  yes('both are in the room', !!oneId && !!twoId, why);
  one.send({ t: 'sdp', to: twoId, from: 999, sdp: { type: 'offer', sdp: 'v=0\r\n', extra: 1 },
             profileId: 1, name: 'Staff', hush: 1, text: 'anything at all' });
  why = await two.until(() => two.got.some((m) => m.t === 'sdp'), 'offer to Two');
  const sdp = two.got.find((m) => m.t === 'sdp');
  yes('an offer arrives as t, from, to and the description (' + keys(sdp) + ')', keys(sdp) === 'from,sdp,t,to', why);
  yes('the description is type and sdp, as sent (' + keys(sdp && sdp.sdp) + ')',
      !!sdp && keys(sdp.sdp) === 'sdp,type' && sdp.sdp.type === 'offer' && sdp.sdp.sdp === 'v=0\r\n');
  yes('from is the sender, not the 999 it wrote', !!sdp && sdp.from === oneId && sdp.to === twoId);
  one.send({ t: 'ice', to: twoId, junk: 'x'.repeat(50),
             candidate: { candidate: 'candidate:1 1 udp 2122260223 192.0.2.1 54321 typ host', sdpMid: '0',
                          sdpMLineIndex: 0, usernameFragment: 'abcd', extra: 'no' } });
  why = await two.until(() => two.got.some((m) => m.t === 'ice'), 'candidate to Two');
  const ice = two.got.find((m) => m.t === 'ice');
  yes('a candidate arrives as t, from, to and the candidate (' + keys(ice) + ')', keys(ice) === 'candidate,from,t,to', why);
  yes('with the candidate\'s own fields and nothing else (' + keys(ice && ice.candidate) + ')',
      !!ice && keys(ice.candidate) === 'candidate,sdpMLineIndex,sdpMid,usernameFragment' &&
      ice.candidate.sdpMid === '0' && ice.candidate.sdpMLineIndex === 0);
  two.send({ t: 'sdp', to: oneId, sdp: { type: 'answer', sdp: 'v=0\r\n' } });
  why = await one.until(() => one.got.some((m) => m.t === 'sdp' && m.sdp.type === 'answer' && m.from === twoId), 'answer to One');
  yes('an answer goes the other way', !why, why);

  /*
    None of these should reach Two. The line One says after them does: the
    service handles One's messages in order and writes to Two in order, so
    by the time Two hears that line, any of them that got through has come.
    This used to count 250 ms after sending them (#1926).
  */
  const before = two.got.filter((m) => m.t === 'sdp' || m.t === 'ice').length;
  one.send({ t: 'sdp', to: twoId });
  one.send({ t: 'sdp', to: twoId, sdp: 'v=0' });
  one.send({ t: 'sdp', to: twoId, sdp: { type: 'bogus', sdp: 'v=0' } });
  one.send({ t: 'sdp', to: twoId, sdp: { type: 'offer' } });
  one.send({ t: 'ice', to: twoId });
  one.send({ t: 'ice', to: twoId, candidate: 'not a candidate' });
  one.send({ t: 'ice', to: twoId, candidate: { sdpMid: '0' } });
  one.send({ t: 'sdp', to: 12345, sdp: { type: 'offer', sdp: 'v=0' } });
  one.send({ t: 'chat', text: 'still here' });
  const still = (m) => m.t === 'chat' && m.text === 'still here';
  why = await two.until(() => two.got.some(still), 'line "still here" from One');
  const upTo = two.got.findIndex(still);
  const after = two.got.slice(0, upTo < 0 ? two.got.length : upTo).filter((m) => m.t === 'sdp' || m.t === 'ice').length;
  yes('signalling of any other shape reaches nobody (' + (after - before) + ' arrived)', !why && after === before, why);
  yes('and the sender is still connected and heard', !why, why);

  /*
    The log is read once the service has gone and every line it wrote has
    come through its pipe. A line is written before the answer it goes with,
    but on another pipe, and on a busy machine the answer can come first
    (#1867). It used to be read 300 ms after Bob's lines were sent (#1926).
  */
  for (const s of [watcher, bob, one, two]) { try { s.ws.close(); } catch (e) { } }
  await Promise.all([watcher, bob, one, two].map((s) => s.until(() => s.closed, 'close')));
  srv.kill();
  await srvClosed;
  console.log('\nthe log, once the service has gone:');
  yes('the chat limit slowed Bob, so the name reached the log', /slowed peer \d+ \(profile 21,/.test(srvLog));
  const forged = srvLog.split('\n').filter((l) => /^\[voice\] REFUSED a join/.test(l));
  yes('and no line of the log starts with the words the name carried', forged.length === 0);
  yes('nothing in the log carries a control or direction character', !BAD.test(srvLog.split('\n').join('')));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  /*
    Ended rather than exited. With nothing paused before it any more, an exit
    straight after the sockets close tripped a libuv assertion on Windows
    ("!(handle->flags & UV_HANDLE_CLOSING)", exit 127) in 2 of 5 runs while
    node was still letting go of them, as test-keepalive.js found. So the
    code is set and node leaves once everything is let go.
  */
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.log('FAIL  the harness itself: ' + (e && e.stack || e)); process.exit(1); });
