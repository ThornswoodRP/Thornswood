// test-keepalive.js
//
// A quiet chat window used to lose the server.
//
// Patrick, 23 September, with it on his screen while the service was up the
// whole time and the game noticed nothing: "Chat lost the server. Trying
// again." The service answered pings and never sent one, so a socket that
// said nothing for long enough was closed by what sits between the two ends,
// which is Caddy. Voice traffic kept a talking socket busy and the position
// feed kept a peer busy; the sockets that died were the quiet ones.
//
// This spawns the real service with a short ping interval, opens a real
// websocket, and waits for the ping frame to arrive. It is a raw socket
// rather than the WebSocket class on purpose: the class answers pings itself
// and never tells anybody, which is exactly what made this invisible.
//
// Read only. Nothing outside the temp folder is touched.
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Set by ready(), from the system. It was a fixed 7903, the same as
// test-ice.js (#1703).
let PORT = 0;
const PING_MS = 300;
// Three pings, the service's default ratio, so a socket that says nothing
// back is let go in under a second and a half here.
const SILENT_MS = 900;

let pass = 0, fail = 0;
function check(what, got, want) {
  if (String(got) === String(want)) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + '\n      wanted [' + want + '] got [' + got + ']'); }
}

/*
  How long any one answer is waited for before the wait gives up and says
  what did not come. Each check waits for the thing it reads (#1926), so this
  only ends a wait on a service that is stuck, as listening() does.
*/
const BOUND_MS = 15000;
// A masked empty pong, as a browser answers a ping, and a masked empty ping.
const PONG = Buffer.from([0x8a, 0x80, 0, 0, 0, 0]);
const PING = Buffer.from([0x89, 0x80, 0, 0, 0, 0]);

/* A wait for one thing: resolves true when its hit() is called by whoever
   hears the thing, or false after BOUND_MS. */
function waitFor() {
  let hit = null;
  const p = new Promise((ok) => {
    const late = setTimeout(() => ok(false), BOUND_MS);
    hit = () => { clearTimeout(late); ok(true); };
  });
  p.hit = hit;
  return p;
}

/* Whether the service's log says it, waited for until the line has come
   through its pipe. The line is written as the thing happens, but on
   another pipe, and on a busy machine what goes with it can come first
   (#1867). */
function logSays(re) {
  if (re.test(log)) { return Promise.resolve(true); }
  const w = waitFor();
  const said = () => { if (re.test(log)) { w.hit(); } };
  srv.stdout.on('data', said);
  return w.then((v) => { srv.stdout.removeListener('data', said); return v; });
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-keepalive-'));
for (const f of ['voice-server.js', 'headlines.js']) {
  fs.copyFileSync(path.join(__dirname, '..', f), path.join(dir, f));
}
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

let srv = null;
let log = '';

/*
  Ended rather than exited.

  process.exit here crashed node outright with "Assertion failed:
  !(handle->flags & UV_HANDLE_CLOSING)" and an exit code of 127, because the
  killed child and the torn down socket were still closing underneath it. The
  counts had already printed, so it looked like a pass and was a crash. Set
  the code, let go of everything, and let node leave when it is ready.
*/
function done(code) {
  process.exitCode = code;
  try { srv.kill(); } catch (e) { }
  setTimeout(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  }, 300).unref();
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
async function ready() {
  SITE = SITE || await siteThatSaysYes();
  PORT = await freePort('0.0.0.0');
  srv = spawn(process.execPath, ['voice-server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_VOICE_PORT: String(PORT),
      THORNSWOOD_SITE: SITE,
      THORNSWOOD_VOICE_PING_MS: String(PING_MS),
      THORNSWOOD_VOICE_SILENT_MS: String(SILENT_MS),
    }),
  });
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });
  await listening(srv, PORT);
  const r = await fetch('http://127.0.0.1:' + PORT + '/health');
  if (!r.ok) { throw new Error('the service answered /health with ' + r.status + '. log:\n' + log); }
  return await r.json();
}

/* The handshake by hand, so the frames underneath can be read. pid is who
   it is, since the token goes with the handshake. */
async function open(pid) {
  const token = await joinToken(PORT, pid);
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const s = net.connect(PORT, '127.0.0.1', () => {
      s.write('GET / HTTP/1.1\r\n' +
              'Host: 127.0.0.1:' + PORT + '\r\n' +
              'Upgrade: websocket\r\n' +
              'Connection: Upgrade\r\n' +
              'Sec-WebSocket-Key: ' + key + '\r\n' +
              'Sec-WebSocket-Protocol: thornswood, ' + token + '\r\n' +
              'Sec-WebSocket-Version: 13\r\n\r\n');
    });
    let head = '';
    const onData = (d) => {
      head += d.toString('binary');
      const at = head.indexOf('\r\n\r\n');
      if (at < 0) { return; }
      s.removeListener('data', onData);
      resolve({ sock: s, head: head.slice(0, at) });
    };
    s.on('data', onData);
    s.on('error', reject);
    setTimeout(() => reject(new Error('no handshake in four seconds')), 4000);
  });
}

/* The opcode of the next frame the service sends, and its length. */
function nextFrame(sock, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { sock.removeListener('data', on); resolve(null); }, ms);
    const on = (d) => {
      if (d.length < 2) { return; }
      clearTimeout(timer);
      sock.removeListener('data', on);
      resolve({ op: d[0] & 0x0f, fin: !!(d[0] & 0x80), len: d[1] & 0x7f });
    };
    sock.on('data', on);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Every frame the service sends on a socket, whole, as opcode and body. */
function frames(sock, on) {
  let buf = Buffer.alloc(0);
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) { return; }
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) { return; } len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) { return; } len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (buf.length < off + len) { return; }
      const op = buf[0] & 0x0f;
      const body = buf.slice(off, off + len);
      buf = buf.slice(off + len);
      on(op, body);
    }
  });
}

/* A masked text frame, as a browser sends one. */
function textFrame(obj) {
  const data = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = data.length < 126 ? Buffer.from([0x81, 0x80 | data.length])
                                 : Buffer.from([0x81, 0x80 | 126, data.length >> 8, data.length & 255]);
  const key = crypto.randomBytes(4);
  const body = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) { body[i] = data[i] ^ key[i & 3]; }
  return Buffer.concat([head, key, body]);
}

(async () => {
  const h = await ready();
  console.log('service up: build ' + h.build + ', ping every ' + PING_MS + 'ms for this run');
  console.log('');

  const { sock, head } = await open(517);
  check('the service upgrades a websocket request that offers a token',
        /^HTTP\/1\.1 101/.test(head), true);

  /*
    THE WHOLE POINT. Nothing is sent and nothing is said: the socket just
    sits there, which is a chat window with nobody near it, and the ping has
    to arrive anyway.
  */
  const f = await nextFrame(sock, PING_MS * 8);
  check('a quiet socket is pinged rather than left to die', f && f.op, 9);
  check('and the ping is a whole frame with no body', f && f.fin && f.len === 0, true);

  // A second one, so it is a heartbeat and not a one-off at connect.
  const g = await nextFrame(sock, PING_MS * 8);
  check('and it keeps happening', g && g.op, 9);

  // Answering it the way a browser does must not upset anything: the service
  // reads the pong and carries on.
  sock.write(Buffer.from([0x8a, 0x80, 0, 0, 0, 0]));   // masked empty pong
  const after = await nextFrame(sock, PING_MS * 8);
  check('a pong back is taken quietly and the pings continue', after && after.op, 9);

  /*
    The service has had the socket's going to trip over once a second ping
    round has reached another socket: the first round may have been on its
    way already, but the second is written a ping later, after the service
    has heard the socket go and has written to everything it still holds.
    This used to ask 300 ms after the destroy, which is one ping on a quiet
    machine and can be none on a busy one (#1926).
  */
  const other = await open(520);
  try { sock.destroy(); } catch (e) { }
  const o1 = await nextFrame(other.sock, BOUND_MS);
  other.sock.write(PONG);
  const o2 = await nextFrame(other.sock, BOUND_MS);
  try { other.sock.destroy(); } catch (e) { }
  check('another socket is pinged twice after it (' + (o1 && o1.op) + ', ' + (o2 && o2.op) + ')',
        !!o1 && !!o2 && o1.op === 9 && o2.op === 9, true);
  check('the service is still up after the socket goes',
        (await (await fetch('http://127.0.0.1:' + PORT + '/health')).json()).build === h.build, true);

  /*
    Issue #519, the other half. A laptop that sleeps or loses its Wi-Fi says
    nothing at all, not even the pong a browser sends by itself, and its
    socket used to sit in the room until TCP gave up on it. Three pings with
    no answer and the service lets it go, with a line in its log.
  */
  const silent = await open(518);
  let silentClosedAt = 0;
  const silentFrom = Date.now();
  // Its close, as it comes, rather than looked for every 100 ms (#1926).
  const silentClosed = waitFor();
  silent.sock.on('close', () => { silentClosedAt = Date.now(); silentClosed.hit(); });
  silent.sock.on('data', () => { });                  // reads, never answers
  await silentClosed;
  check('a socket that answers nothing is closed by the service', silentClosedAt > 0, true);
  check('after about three pings, not before (' + (silentClosedAt - silentFrom) + ' ms)',
        silentClosedAt - silentFrom >= SILENT_MS - PING_MS && silentClosedAt - silentFrom <= SILENT_MS + 3 * PING_MS, true);
  const h2 = await (await fetch('http://127.0.0.1:' + PORT + '/health')).json();
  check('/health counts it', h2.closedSilent >= 1, true);
  check('and the service log says so', await logSays(/answered nothing for \d+ s/), true);

  // One that answers every ping the way a browser does stays, however long.
  const talks = await open(519);
  let talksClosed = false;
  const got = [];
  // What is waited for next on this socket: a pong frame, a pong message,
  // the socket's close.
  let onPongFrame = null, onPong = null;
  const talksGone = waitFor();
  talks.sock.on('close', () => { talksClosed = true; talksGone.hit(); });
  frames(talks.sock, (op, body) => {
    if (op === 9) { if (!talks.sock.writableEnded) { talks.sock.write(PONG); } return; }
    if (op === 0xa) { if (onPongFrame) { onPongFrame(); } return; }
    if (op !== 1) { return; }
    try { got.push(JSON.parse(body.toString('utf8'))); } catch (e) { }
    if (got[got.length - 1] && got[got.length - 1].t === 'pong' && onPong) { onPong(); }
  });
  // A pause for time itself, which stays: kept this long is what is checked.
  await sleep(SILENT_MS * 3);
  check('a socket that answers its pings is kept, three times as long', talksClosed, false);

  /*
    And the page's own keepalive. A browser answers the service's pings
    without telling the page, so a page cannot tell a quiet room from a dead
    socket that way. It sends { t: 'ping' } and the service answers with
    { t: 'pong' }, which the page can see.
  */
  /*
    The page ping before the join is followed by a ping frame, which the
    service answers with a pong frame once it has handled what came before
    it on this socket. So by that pong, an answer to the page ping would have
    come. This used to read 300 ms after sending it (#1926).
  */
  let heard = waitFor();
  onPongFrame = heard.hit;
  talks.sock.write(textFrame({ t: 'ping' }));
  talks.sock.write(PING);
  const framed = await heard;
  onPongFrame = null;
  check('a page ping before it has joined is not answered (pong frame after it: ' + framed + ')',
        framed && !got.some((m) => m.t === 'pong'), true);
  heard = waitFor();
  onPong = heard.hit;
  talks.sock.write(textFrame({ t: 'join', profileId: 519, name: 'keepalive' }));
  talks.sock.write(textFrame({ t: 'ping' }));
  check('a page ping once joined is answered with a pong', await heard, true);
  check('it is in the room', (await (await fetch('http://127.0.0.1:' + PORT + '/health')).json()).peers, 1);

  /*
    Its end shut with no close frame, a process killed or a tab gone. The
    service used to notice only when its next write failed, or here once the
    socket had been silent for SILENT_MS, so a socket sent nothing stayed in
    the room. It goes at once now.

    So this waits for the socket to close at this end, which is the service
    letting it go, and then asks /health: out of the room, and not counted
    as closed for silence. It used to look every 20 ms for a tenth of a
    second or so, which a busy machine can let pass (#1926).
  */
  const silentBefore = (await (await fetch('http://127.0.0.1:' + PORT + '/health')).json()).closedSilent;
  talks.sock.end();
  const shut = await talksGone;
  const h3 = await (await fetch('http://127.0.0.1:' + PORT + '/health')).json();
  check('a socket whose other end shuts is closed and leaves the room (closed ' + shut + ', ' + h3.peers + ' in the room)',
        shut && h3.peers === 0, true);
  check('at once, not found silent later (' + (h3.closedSilent - silentBefore) + ' closed for silence)',
        h3.closedSilent - silentBefore, 0);
  try { talks.sock.destroy(); } catch (e) { }

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  done(fail ? 1 : 0);
})().catch((e) => {
  console.error('FAILED: ' + e.message);
  console.error(log);
  done(1);
});
