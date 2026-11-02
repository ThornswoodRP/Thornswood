/*
  test-1351-unmasked-frames.js

      node voice\tests\test-1351-unmasked-frames.js

  #1351. RFC 6455 section 5.1: "The server MUST close the connection upon
  receiving a frame that is not masked." The voice service's frame reader
  (Sock.feed in voice/voice-server.js) unmasked a frame when the mask bit was
  set and read it as it was when not: on 5 Oct, against main, a join sent
  unmasked was answered with a welcome.

  This starts the real service in a temp folder, talks to it over raw
  sockets that write their own frames, and proves:

    a masked join is welcomed, as a browser's is;
    an unmasked join is answered with a close frame carrying 1002, a
    protocol error, the socket is closed, and nobody is welcomed;
    somebody already in the room who sends one unmasked frame is closed the
    same way, leaves the room, and that frame reaches nobody;
    an unmasked ping gets no pong, only the close;
    and the browser's own WebSocket, which masks everything, still joins
    and talks.

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

const VOICE = process.env.VOICE || path.join(REPO_DIR, 'voice', 'voice-server.js');

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
  Waits on what a socket has been sent (#1926). me.until(test, what)
  resolves '' once test() holds, checked again as each frame and the close
  come in, or else why it never will: the socket closed without it, or
  BOUND_MS went by. Each check here used to read 200 or 300 ms after
  sending, so on a busy machine an answer that came later read as missing.
  me.heard() is called on every frame and on the close.
*/
function waiter(me) {
  const waits = [];
  me.heard = () => { for (const w of waits.slice()) { w(); } };
  me.until = (test, what) => new Promise((ok) => {
    let bound = null;
    const check = () => {
      if (test()) { end(''); } else if (me.closed) { end('the socket closed without ' + what); }
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
  return me;
}

/*
  A page's own ping, answered once the service has handled everything that
  socket sent before it, and written after everything it sent that socket
  before it (#519). So once the pong is in, nothing the service sent this
  socket before it is still to come.
*/
function settle(me, who) {
  const mark = me.msgs.length;
  me.send({ t: 'ping' });
  return me.until(() => me.msgs.slice(mark).some((m) => m.t === 'pong'), 'pong to a ping from ' + who);
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

/* A text frame, masked the way a browser sends one, or not. */
function textFrame(obj, masked) {
  const data = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = data.length < 126 ? Buffer.from([0x81, (masked ? 0x80 : 0) | data.length])
                                 : Buffer.from([0x81, (masked ? 0x80 : 0) | 126, data.length >> 8, data.length & 255]);
  if (!masked) { return Buffer.concat([head, data]); }
  const key = crypto.randomBytes(4);
  const body = Buffer.from(data);
  for (let i = 0; i < body.length; i++) { body[i] ^= key[i & 3]; }
  return Buffer.concat([head, key, body]);
}

/* A raw socket that has done the handshake as pid, with every frame it is
   sent. */
async function raw(port, pid) {
  const token = await joinToken(port, pid);
  return new Promise((ok, bad) => {
    const s = net.connect(port, '127.0.0.1');
    const me = waiter({ sock: s, frames: [], msgs: [], closed: false,
                        send: (o) => s.write(textFrame(o, true)) });
    let buf = Buffer.alloc(0), up = false;
    const shake = setTimeout(() => bad(new Error('no answer to the handshake for ' + pid + ' within ' + BOUND_MS / 1000 + ' s')), BOUND_MS);
    s.on('connect', () => {
      s.write('GET / HTTP/1.1\r\nHost: 127.0.0.1:' + port + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
              'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') + '\r\n' +
              'Sec-WebSocket-Protocol: thornswood, ' + token + '\r\n\r\n');
    });
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!up) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) { return; }
        clearTimeout(shake);
        if (!/^HTTP\/1\.1 101/.test(buf.slice(0, i).toString())) { bad(new Error('no 101')); return; }
        buf = buf.slice(i + 4); up = true; ok(me);
      }
      const had = me.frames.length;
      for (;;) {
        if (buf.length < 2) { break; }
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) { break; } len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) { break; } len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) { break; }
        const op = buf[0] & 0x0f;
        const body = buf.slice(off, off + len);
        buf = buf.slice(off + len);
        me.frames.push({ op: op, body: body });
        if (op === 1) { try { me.msgs.push(JSON.parse(body.toString('utf8'))); } catch (e) { } }
      }
      if (me.frames.length > had) { me.heard(); }
    });
    s.on('close', () => {
      clearTimeout(shake);
      if (!up) { bad(new Error('the socket for ' + pid + ' closed before the handshake was answered')); }
      me.closed = true;
      me.heard();
    });
    s.on('error', () => { });
  });
}
const closeCode = (c) => {
  const f = c.frames.find((x) => x.op === 8);
  return f && f.body.length >= 2 ? f.body.readUInt16BE(0) : 0;
};

/*
  Every join proves itself with a token (#1303). One token opens one
  connection and goes with the handshake, after 'thornswood' (#1337, #1322).
*/
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
  A join token as the launcher gets one: asked of the service, which mints
  it on its own clock once the site says the ticket owns the profile. It was
  signed here with this process's Date.now(), and the service refuses a
  token minted before it started by its own clock; on Windows two node
  processes can read the wall clock a few ms apart (#1867).
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

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-1351-'));
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
  await listening(srv, PORT);
  // Everybody here is in the world, since only they hold a voice place and
  // are on the roster (#3570). The rows carry no name, so the roster shows
  // the name each join sent.
  await inWorld(PORT, [1, 2, 3, 4]);

  console.log('masked, as a browser sends it:');
  const a = await raw(PORT, 1);
  a.sock.write(textFrame({ t: 'join', profileId: 1, name: 'Alva' }, true));
  let why = await a.until(() => a.msgs.some((m) => m.t === 'welcome'), 'welcome');
  yes('a masked join is welcomed', !why, why);

  /*
    A check that something did not come reads once the socket it would have
    come on has closed, or once a pong on it says everything sent before has
    arrived.
  */
  console.log('\nunmasked:');
  const b = await raw(PORT, 2);
  b.sock.write(textFrame({ t: 'join', profileId: 2, name: 'Brand' }, false));
  why = await b.until(() => b.closed, 'close');
  yes('an unmasked join is not welcomed', !why && !b.msgs.some((m) => m.t === 'welcome'), why);
  yes('it is answered with a close frame carrying 1002, a protocol error (' + closeCode(b) + ')', closeCode(b) === 1002);
  yes('and the socket is closed', b.closed, why);
  why = await settle(a, 'Alva');
  const last = a.msgs.filter((m) => m.t === 'peers').pop();
  yes('nobody in the room ever saw it join', !why && !!last && last.peers.length === 1 &&
      !a.msgs.some((m) => m.t === 'peers' && m.peers.some((p) => p.profileId === 2)), why);

  console.log('\nsomebody already in the room who sends one unmasked frame:');
  const c = await raw(PORT, 3);
  c.sock.write(textFrame({ t: 'join', profileId: 3, name: 'Cyra' }, true));
  why = await c.until(() => c.msgs.some((m) => m.t === 'welcome'), 'welcome') ||
        await a.until(() => a.msgs.some((m) => m.t === 'peers' && m.peers.some((p) => p.profileId === 3)),
                      'roster with Cyra in it, to Alva');
  yes('joins masked and is in the room', !why, why);
  const mark = a.msgs.length;
  c.sock.write(textFrame({ t: 'chat', text: 'unmasked words' }, false));
  why = await c.until(() => c.closed, 'close');
  yes('is closed with 1002 (' + closeCode(c) + ')', closeCode(c) === 1002 && c.closed, why);
  // The roster that says Cyra left, then a pong after it, so a line of hers
  // to Alva would be in by then.
  const leftWhy = await a.until(() => a.msgs.slice(mark).some((m) => m.t === 'peers' && !m.peers.some((p) => p.profileId === 3)),
                                'roster without Cyra, to Alva') || await settle(a, 'Alva');
  yes('and the line reaches nobody', !leftWhy && !a.msgs.slice(mark).some((m) => m.t === 'chat' && m.text === 'unmasked words'), leftWhy);
  const after = a.msgs.slice(mark).filter((m) => m.t === 'peers').pop();
  yes('and leaves the room', !!after && !after.peers.some((p) => p.profileId === 3), leftWhy);

  console.log('\nan unmasked ping:');
  const d = await raw(PORT, 5);
  d.sock.write(Buffer.from([0x89, 0x00]));
  why = await d.until(() => d.closed, 'close');
  yes('gets no pong', !why && !d.frames.some((f) => f.op === 0xa), why);
  yes('only the close, 1002 (' + closeCode(d) + ')', closeCode(d) === 1002 && d.closed, why);

  console.log('\nthe browser\'s own WebSocket, which masks everything:');
  const ws = new WebSocket('ws://127.0.0.1:' + PORT + '/', ['thornswood', await joinToken(PORT, 4)]);
  const page = waiter({ msgs: [], closed: false });
  ws.onmessage = (e) => { try { page.msgs.push(JSON.parse(e.data)); } catch (x) { } page.heard(); };
  ws.onclose = () => { page.closed = true; page.heard(); };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', profileId: 4, name: 'Dagny' }));
  why = await page.until(() => page.msgs.some((m) => m.t === 'welcome'), 'welcome');
  yes('joins', !why, why);
  ws.send(JSON.stringify({ t: 'chat', text: 'masked words' }));
  why = await a.until(() => a.msgs.some((m) => m.t === 'chat' && m.text === 'masked words'), 'line from Dagny, to Alva');
  yes('and its line reaches the room', !why, why);

  try { ws.close(); a.sock.destroy(); } catch (e) { }
  await new Promise((ok) => { srv.once('exit', ok); srv.kill(); });
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the harness itself: ' + (e && e.stack || e)); process.exit(1); });
