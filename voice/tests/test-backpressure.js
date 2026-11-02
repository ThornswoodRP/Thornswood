// test-backpressure.js
//
// One connection that stops reading used to grow the voice service's memory
// without limit.
//
// To Do List entry 284: "Check the write return and skip the tick for a
// backed-up socket, or keep a small bounded queue per connection and drop the
// oldest. For state that is superseded every tick, dropping is the correct
// answer and is what unreliable transport means."
//
// Every message went through Sock.send, which called socket.write and threw
// away the boolean it returns. When somebody's link cannot keep up, or their
// machine stops reading, node does not refuse the write: it keeps the bytes in
// memory and says false, and nothing here was listening. Measured on 24
// September with a copy of the service on loopback and one websocket that
// joined and never read, at 1,500 rows: once the loopback buffers were full,
// writableLength climbed by about 0.75 MB a second for as long as it ran
// (15 MB after 20 s) and RSS went from 58 to 87 MB. This harness, run against
// that code, saw the queue go from 0.85 MB to 4.4 or 4.55 MB in five
// seconds, the memory the service held grow by 3 to 4 MB, and a second stuck
// socket reach about 25.8 MB without ever being closed: 11 of 17 checks
// fail. With the fix the queue sits at 0.14 MB, one position message, and
// does not move.
//
// The roster checks came in when this met the culling work (entry 282). Its
// test-cull.js joins two hundred sockets at once, every join sends the whole
// roster to everybody, and the 1 MB ceiling closed up to 42 of them in one
// run. Against main's code on 24 September (cull-1-command-ack-1) this
// harness failed 15 of its 24 checks. With only the roster put back on the
// reliable send, 4 fail: sixty joins and leaves put 0.35 MB more behind the
// stuck socket, and 120 rosters reached it when it read again.
//
// This spawns the real service in a temp folder on a spare port, loopback
// only, with a small probe preloaded into it. The probe wraps socket.write
// from the inside and prints the largest queue and the memory in use four
// times a second, so the measurement does not depend on anything the service
// chooses to report about itself.
//
// Read only. Nothing outside the temp folder is touched.
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

// VOICE_SERVER points it at another copy, which is how it is shown to fail on
// the code before a change.
const SERVER = process.env.VOICE_SERVER || path.join(__dirname, '..', 'voice-server.js');
// Its own port. test-chat-limit.js reached main on 7907 while this branch
// was open, and two harnesses on one port can each end up talking to the
// other's service. A fixed 7908 still let a build beside this one on the VPS
// do the same (#1703), so ready() takes one from the system.
let PORT = 0;
let BASE = '';
const ROWS = 1500;
// The ceiling the service promises. A connection whose queue passes it is
// closed so it can reconnect, rather than held onto at any size.
const CEILING = 1024 * 1024;
// The chat limit, set here rather than left to the service's defaults so the
// check on it below counts against numbers this file chose.
const CHAT_BURST = 5;
const CHAT_REFILL_MS = 1500;

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = (n) => (n / 1048576).toFixed(2) + ' MB';

/*
  How long any one answer is waited for before the wait gives up and says
  what did not come. Each check waits for the thing it reads (#1926), so this
  only ends a wait on a service that is stuck, as listening() does.
*/
const BOUND_MS = 15000;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-backpressure-'));
fs.copyFileSync(SERVER, path.join(dir, 'voice-server.js'));
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
  The probe, preloaded into the service with -r.

  Written out from a function rather than from a string so nothing in it has
  to be escaped. It runs in the service's process, with --expose-gc so the
  memory it reports is what is actually held rather than what the collector
  has not got round to yet.
*/
function probe() {
  const net = require('net');
  const socks = new Set();
  let falses = 0;
  const write = net.Socket.prototype.write;
  net.Socket.prototype.write = function () {
    socks.add(this);
    const ok = write.apply(this, arguments);
    if (ok === false) falses++;
    return ok;
  };
  setInterval(() => {
    let queue = 0;
    for (const s of socks) {
      if (s.destroyed) { socks.delete(s); continue; }
      if (s.writableLength > queue) queue = s.writableLength;
    }
    if (global.gc) global.gc();
    const m = process.memoryUsage();
    process.stdout.write('PROBE ' + JSON.stringify({
      at: Date.now(), queue: queue, falses: falses,
      held: m.heapUsed + m.external, rss: m.rss
    }) + String.fromCharCode(10));
  }, 250).unref();
}
fs.writeFileSync(path.join(dir, 'probe.js'), '(' + probe.toString() + ')();');

let srv = null;
let log = '';
const probes = [];
let partial = '';
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
async function start() {
  SITE = SITE || await siteThatSaysYes();
  PORT = await freePort('127.0.0.1');
  BASE = 'http://127.0.0.1:' + PORT;
  srv = spawn(process.execPath, ['--expose-gc', '-r', path.join(dir, 'probe.js'), 'voice-server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_VOICE_PORT: String(PORT),
      THORNSWOOD_VOICE_BIND: '127.0.0.1',
      THORNSWOOD_SITE: SITE,
      THORNSWOOD_CHAT_DIR: path.join(dir, 'chat'),
      THORNSWOOD_CHAT_BURST: String(CHAT_BURST),
      THORNSWOOD_CHAT_REFILL_MS: String(CHAT_REFILL_MS),
      THORNSWOOD_CHAT_RANGE: '',
    }),
  });
  srv.stdout.on('data', (d) => {
    partial += d;
    const lines = partial.split(/\r?\n/);
    partial = lines.pop();
    for (const line of lines) {
      if (line.indexOf('PROBE ') === 0) {
        try { probes.push(JSON.parse(line.slice(6))); } catch (e) { }
      } else {
        log += line + '\n';
      }
    }
  });
  srv.stderr.on('data', (d) => { log += d; });
  await listening(srv, PORT);
}

let feeding = null;
// Ended rather than exited; see test-keepalive.js for the crash that taught it.
function done(code) {
  process.exitCode = code;
  if (feeding) clearInterval(feeding);
  for (const s of opened) { try { s.destroy(); } catch (e) { } }
  // The folder goes once the service has let go of it. The timer on its own
  // let node leave first, and every run left a folder behind in %TEMP%.
  const rm = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { } };
  if (!srv || srv.exitCode !== null || srv.signalCode !== null) rm();
  else srv.once('exit', rm);
  try { srv.kill(); } catch (e) { }
  setTimeout(rm, 300).unref();
}

async function health() {
  return (await fetch(BASE + '/health')).json();
}

async function ready() {
  await start();
  const r = await fetch(BASE + '/health');
  if (!r.ok) { throw new Error('the service answered /health with ' + r.status + '. log:\n' + log); }
  return await r.json();
}

/* A heavy feed, because the loopback buffers swallow a light one: at 200 rows
   they absorbed the first 2.4 MB and the queue never moved in 20 s.

   And everybody in it walking, a unit further north on every feed. The
   service sends only rows that changed since the last tick (issue #482), so
   a crowd standing still is one whole view per socket and then nothing, and
   nothing would ever back up.

   And the crowd that fills the room below (BURST) in the world too, standing
   in a cell of their own so nobody's view grows with them: only somebody in
   the world holds a voice place and is on the roster (#3570). */
let step = 0;
const CROWD = 60;
function bodyOf(n) {
  return JSON.stringify({ who: Array.from({ length: ROWS }, (_, i) => ({
    profileId: 100000 + i,
    pos: [12345.67 + i, -2345.67 + n, 1234.5],
    angleZ: 123.4,
    cell: '0x0001a26f',
    name: 'Tester ' + i
  })).concat(Array.from({ length: CROWD }, (_, i) => ({
    profileId: 200000 + i,
    pos: [0, 0, 0],
    angleZ: 0,
    cell: 'elsewhere',
    // The roster shows the feed's name for a proven join (#410), so it is the one each joins with.
    name: ('Somebody passing through ' + i + ' ').padEnd(40, 'x')
  }))) });
}
const BODY = bodyOf(0);
// The newest feed sent, so its answer can be waited for once the feeding stops.
let lastFeed = Promise.resolve();
function feed() {
  lastFeed = fetch(BASE + '/positions', { method: 'POST', body: bodyOf(++step) }).catch(() => { });
  return lastFeed;
}

/* Resolves once the probe has printed n more samples, each taken after the
   one before, so what it reports covers the moment this was called. */
function probed(n) {
  const from = probes.length;
  return until('probe samples', () => probes.length >= from + n, BOUND_MS);
}

const opened = [];
/* The handshake by hand, so the frames underneath can be read, and so a
   socket can be left paused, which is a machine that has stopped reading.
   pid is who it joins as, since the token goes with the handshake. */
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
    opened.push(s);
    let head = Buffer.alloc(0);
    const onData = (d) => {
      head = Buffer.concat([head, d]);
      const at = head.indexOf('\r\n\r\n');
      if (at < 0) { return; }
      s.removeListener('data', onData);
      s.pause();
      // Anything that came in the same read as the handshake is kept for
      // whoever reads this socket next.
      s.rest = head.slice(at + 4);
      resolve(s);
    };
    s.on('data', onData);
    s.on('error', () => { });
    setTimeout(() => reject(new Error('no handshake in four seconds')), 4000);
  });
}

/* A masked text frame, the way a browser sends one. */
function send(s, obj) {
  s.write(frameOf(obj));
}

/* The frame on its own, so many can go out in a single write, which is how
   they arrive together in one read at the other end. */
function frameOf(obj) {
  const data = Buffer.from(JSON.stringify(obj), 'utf8');
  const len = data.length;
  let head;
  if (len < 126) {
    head = Buffer.from([0x81, 0x80 | len]);
  } else {
    head = Buffer.alloc(4);
    head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(len, 2);
  }
  const key = crypto.randomBytes(4);
  const body = Buffer.alloc(len);
  for (let i = 0; i < len; i++) body[i] = data[i] ^ key[i & 3];
  return Buffer.concat([head, key, body]);
}

/* Read every frame the service sends and hand the JSON ones on. */
function read(s, onMsg) {
  let buf = s.rest || Buffer.alloc(0);
  const drain = () => {
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 0x0f;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (buf.length < off + len) return;
      const body = buf.slice(off, off + len);
      buf = buf.slice(off + len);
      if (op === 0xa) s.pongs = (s.pongs || 0) + 1;
      if (op !== 1) continue;
      let m = null;
      try { m = JSON.parse(body.toString('utf8')); } catch (e) { }
      if (m) onMsg(m);
    }
  };
  s.on('data', (d) => { buf = Buffer.concat([buf, d]); drain(); });
  drain();
  s.resume();
}

async function until(what, cond, ms) {
  const from = Date.now();
  while (Date.now() - from < ms) {
    if (await cond()) return true;
    await sleep(100);
  }
  return false;
}

/*
  Dropping is right for positions and wrong for everything else. Welcome,
  chat, signalling and voice modes each say something that is not said
  again, and the roster is only sent again when somebody joins or leaves, so
  the dropping send belongs on the 200 ms tick and nowhere else. Read off the source, because the culling work (entry 282) rewrites
  that same line and a merge could carry it somewhere it does not belong.
*/
const SRC = fs.readFileSync(SERVER, 'utf8');
// The tick may do other work before it looks at the room (#1409 sweeps the
// silences that ran out there first), so it is found by its room check and
// its 200, not by the room check being its first line.
const TICK = /setInterval\(\(\) => \{(?:(?!setInterval\()[\s\S])*?if \(peers\.size === 0\) return;[\s\S]*?\}, 200\);/.exec(SRC);
yes('only the 200 ms position tick uses the dropping send',
    SRC.split('.sendLossy(').length - 1 === 1 && !!TICK && TICK[0].indexOf('.sendLossy(') !== -1);
/* And only the roster keeps just its newest while backed: each one is the
   whole room, which is not true of anything else sent. */
/* The roster is framed once for the whole room and handed to sendLatest
   already framed (sendRoster, #2332), so the check reads that function. A
   socket that lost its voice place is handed the empty roster there
   instead (#3570). */
const ANNOUNCE = /function sendRoster\(\) \{[\s\S]*?\n\}/.exec(SRC);
yes('only the roster is sent newest-only',
    SRC.split('.sendLatest(').length - 1 === 1 && !!ANNOUNCE &&
    /frame\(JSON\.stringify\(\{ t: 'peers'/.test(ANNOUNCE[0]) && /\.sendLatest\(voice \? once : none\)/.test(ANNOUNCE[0]));

(async () => {
  const h0 = await ready();
  console.log('service up: build ' + h0.build + ', ' + ROWS + ' rows a tick, ' +
              Math.round(BODY.length / 1024) + ' KB posted');
  console.log('');

  await feed();
  // As often as the tick, so nearly every tick has somebody who moved.
  feeding = setInterval(feed, 200);

  /*
    Everybody here joins as somebody in the feed, standing among the other
    1,499 in the same cell, so a view culled per person (entry 282) still
    sends each of them all 1,500 rows. Joined as a profile with no row, a
    culled tick sends an empty list that never backs anything up, and every
    check below would be measuring nothing.
  */
  // Somebody whose link keeps up.
  const R = await open(100000);
  let roster = [];
  const got = [];
  // The largest position message it was sent, which is how much one tick
  // puts behind a socket that does not read.
  let posBytes = 0;
  const heard = [];
  // Pongs to its own page pings, and the largest gone list it was sent.
  let appPongs = 0, mostGone = 0;
  read(R, (m) => {
    if (m.t === 'peers') roster = m.peers;
    if (m.t === 'pos' || m.t === 'moved') { got.push(Date.now()); posBytes = Math.max(posBytes, JSON.stringify(m).length); }
    if (m.t === 'moved' && Array.isArray(m.gone)) mostGone = Math.max(mostGone, m.gone.length);
    if (m.t === 'chat') heard.push(m);
    if (m.t === 'pong') appPongs++;
  });
  /*
    A page's own ping from R, answered once the service has handled
    everything sent to it before, and written after everything it sent R
    before (#519). Once the pong is in, nothing sent to R before is still to
    come.
  */
  const settleR = () => {
    const n = appPongs;
    send(R, { t: 'ping' });
    return until('pong', () => appPongs > n, BOUND_MS);
  };
  send(R, { t: 'join', profileId: 100000, name: 'keeps up' });

  // Somebody who has stopped reading. Joined, then never read again.
  const S = await open(100001);
  send(S, { t: 'join', profileId: 100001, name: 'never reads' });

  /*
    Wait for it to back up. The loopback buffers take the first couple of MB,
    so the queue inside node only starts once they are full. Two samples in a
    row with something queued is a socket that is really stuck, not a big
    write caught halfway through.
  */
  let backedAt = 0;
  await until('backed up', () => {
    for (let i = 1; i < probes.length; i++) {
      if (probes[i].queue > 0 && probes[i - 1].queue > 0) { backedAt = probes[i - 1].at; return true; }
    }
    return false;
  }, 25000);
  yes('a socket that never reads backs the service up, so the rest of this means something', backedAt > 0);
  if (!backedAt) { throw new Error('nothing backed up in 25 s. log:\n' + log); }

  // Six seconds of it: thirty ticks the old code would have queued. A pause
  // for time itself, which stays: growth over time is what is measured.
  const gotBefore = got.length;
  await sleep(6000);
  const gotDuring = got.length - gotBefore;
  const hStuck = await health();

  const after = probes.filter((p) => p.at >= backedAt);
  const from = after.find((p) => p.at >= backedAt + 1000) || after[0];
  const last = after[after.length - 1];
  const peak = Math.max.apply(null, after.map((p) => p.queue));
  console.log('      queue ' + MB(from.queue) + ' a second in, ' + MB(last.queue) + ' at the end, peak ' + MB(peak));
  console.log('      held ' + MB(from.held) + ' a second in, ' + MB(last.held) + ' at the end');

  yes('the queue behind it stays under the ceiling', peak <= CEILING);
  /* Read over a second and a half at each end rather than once, and allowed
     one position message between them. The queue sits at one message, but a
     socket is backed only from a tick until the kernel takes what it can, so
     a single read can land after the drain: on the Windows runner on 25
     September the read a second in was 0.00 MB, every other one was 0.14 MB,
     and main went red three runs in a row. The code before #275 put one more
     message on for every tick, thirty in these six seconds. */
  const WINDOW = 1500;
  const early = after.filter((p) => p.at >= from.at && p.at < from.at + WINDOW);
  const late = after.filter((p) => p.at > last.at - WINDOW);
  const most = (xs) => Math.max.apply(null, xs.map((p) => p.queue));
  console.log('      largest queue ' + MB(most(early)) + ' over the first ' + WINDOW + ' ms, ' +
              MB(most(late)) + ' over the last, one position message ' + MB(posBytes));
  yes('and stops growing rather than climbing with every tick',
      posBytes > 0 && most(late) - most(early) < posBytes + 64 * 1024);
  /* The memory check waits for the thing it is about (#1991): sends to the
     stuck socket being refused, thirty of them (the six seconds above in
     ticks), while the backlog behind it stays drained down to one message.
     It used to compare two probes six seconds apart, and on a loaded
     machine a collector or a slow tick landing on either end made that red.
     Now a span with a spike in it is let go and the next thirty refused
     sends are measured from scratch, inside a generous bound. The code
     before #275 grew 3 to 4 MB over every such span, so it never passes. */
  const REFUSED = 30;
  let base = null, grewBy = null;
  const flat = await until('the memory flat over ' + REFUSED + ' refused sends', async () => {
    const h = await health();
    const now = probes[probes.length - 1];
    if (!base) { base = { dropped: h.droppedPositions, probe: now }; return false; }
    if (h.droppedPositions - base.dropped < REFUSED) return false;
    const drained = probes.filter((p) => p.at >= base.probe.at).every((p) => p.queue <= posBytes + 64 * 1024);
    grewBy = now.held - base.probe.held;
    if (drained && grewBy < 1024 * 1024) return true;
    base = { dropped: h.droppedPositions, probe: now };
    return false;
  }, 8 * BOUND_MS);
  console.log('      held grew ' + (grewBy === null ? 'n/a' : MB(grewBy)) + ' over the last ' + REFUSED + ' refused sends');
  yes('and the memory the service holds stops growing with it', flat);
  yes('a stuck socket is not closed for positions alone, they are dropped instead',
      hStuck.peers === 2);
  /* Polled rather than read once: when the kernel does not take a 145 KB
     message in one go, even the socket that keeps up is backed for the
     instant between a tick and its drain, and a single read can land in that
     instant. */
  yes('health counts it as backed up',
      await until('one backed', async () => (await health()).backed === 1, 3000));
  yes('and counts the positions it was not sent', hStuck.droppedPositions > 0);
  yes('somebody who keeps up is still sent positions every tick (' + gotDuring + ' in 6 s)',
      gotDuring >= 20);

  /*
    A room filling and emptying at once, which is what a restart looks like
    when every page reconnects. Each join and each leave sends the whole
    roster to everybody, so the stuck socket used to be queued one roster per
    arrival and per departure: here about 0.35 MB for sixty people. It now
    keeps only the newest, so its queue should hardly move. One of them stays,
    so the roster it is holding differs from the last one it read, and only
    arrives if what it held is really sent.
  */
  const BURST = CROWD;
  const markR = probes.length;
  const baseQueue = probes.length ? probes[probes.length - 1].queue : 0;
  const crowd = await Promise.all(Array.from({ length: BURST }, (_, i) => open(200000 + i)));
  crowd.forEach((c, i) => {
    read(c, () => { });
    send(c, { t: 'join', profileId: 200000 + i, name: ('Somebody passing through ' + i + ' ').padEnd(40, 'x') });
  });
  const full = await until('full', () => roster.length === BURST + 2, 5000);
  const stays = crowd[0];
  const staysName = ('Somebody passing through 0 ').padEnd(40, 'x');
  for (const c of crowd) { if (c !== stays) { try { c.destroy(); } catch (e) { } } }
  const empty = await until('emptied', () => roster.length === 3, 5000);
  // Two samples more from the probe, so the peak read below covers the
  // room emptying. It used to wait 600 ms for them (#1926).
  await probed(2);
  const peakR = Math.max.apply(null, probes.slice(markR).map((p) => p.queue));
  const hR = await health();
  console.log('      ' + BURST + ' joined and ' + (BURST - 1) + ' left: queue ' + MB(baseQueue) +
              ' before, peak ' + MB(peakR) +
              ', ' + hR.skippedRosters + ' rosters replaced unsent');
  yes('the room filled and all but one left', full && empty);
  yes('the stuck socket is not queued a roster for every join and leave',
      peakR - baseQueue < 64 * 1024);
  yes('health counts the rosters it replaced', hR.skippedRosters > 0);

  /*
    Then it starts reading again, which is a slow link catching up. The drain
    listener is what clears the flag, so without it this socket would never be
    sent a position again, nor the roster it was holding.
  */
  const resumedAt = Date.now();
  let fresh = 0, rosters = 0, lastRoster = null;
  read(S, (m) => {
    if (m.t === 'pos' && m.at >= resumedAt) fresh++;
    if (m.t === 'peers') { rosters++; lastRoster = m.peers; }
  });
  const caught = await until('fresh', () => fresh > 0, 5000);
  yes('once it reads again it is sent current positions again', caught);
  yes('and health no longer counts it as backed up',
      await until('none backed', async () => (await health()).backed === 0, 3000));
  const current = await until('current roster', () => !!lastRoster && lastRoster.length === 3 &&
      lastRoster.some((p) => p.profileId === 100000) && lastRoster.some((p) => p.profileId === 100001) &&
      lastRoster.some((p) => p.profileId === 200000 && p.name === staysName), 3000);
  console.log('      ' + rosters + ' rosters reached it after it read again, the last with ' +
              (lastRoster ? lastRoster.length : 0) + ' people');
  yes('and it is sent the roster as it is now, not lost', current);
  yes('once, rather than every one it missed', rosters <= 5);

  // The one who stayed leaves, so the room is the two of them again.
  try { stays.destroy(); } catch (e) { }
  yes('the last of them leaves', await until('two', () => roster.length === 2, 3000));

  /*
    The ceiling. Positions are dropped, but everything else is reliable: the
    roster, chat, and the signalling that sets up a call. A socket that never
    reads keeps collecting those, so past a point it is closed and left to
    reconnect. Signalling is the heaviest of them, so that is what fills it.
  */
  console.log('');
  const S2 = await open(100002);
  send(S2, { t: 'join', profileId: 100002, name: 'never reads either' });
  // Found by profile, not by name: every join is proven since #1303, and a
  // proven one is shown under the name the position feed has for it.
  await until('roster', () => roster.some((p) => p.profileId === 100002), 3000);
  const target = (roster.find((p) => p.profileId === 100002) || {}).peer;
  yes('the second stuck socket is in the room', !!target);

  const markB = probes.length;
  // As a description, the shape every page sends: the service passes on
  // signalling of no other shape (#1350).
  const offer = 'x'.repeat(60000);
  let sent = 0, closed = false;
  for (let round = 0; round < 40 && !closed; round++) {
    for (let i = 0; i < 10; i++) { send(R, { t: 'sdp', to: target, sdp: { type: 'offer', sdp: offer } }); sent++; }
    await sleep(80);
    closed = (await health()).peers === 2;
  }
  // The service's line, which comes on its own pipe and can come after the
  // close is seen in /health (#1867), and a probe sample after the close.
  // It used to read 300 ms after the close (#1926).
  if (closed) { await until('the log line', () => /queue passed \d+ bytes/.test(log), BOUND_MS); }
  await probed(1);
  const hB = await health();
  const peakB = Math.max.apply(null, probes.slice(markB).map((p) => p.queue));
  console.log('      ' + sent + ' offers of 60 KB relayed to it, peak queue ' + MB(peakB));

  // The probe samples four times a second and can miss the moment, so the
  // service's own line, written as it closes, says how much was waiting.
  const said = /queue passed \d+ bytes \((\d+) waiting\)/.exec(log);
  const atClose = said ? Number(said[1]) : Infinity;
  console.log('      ' + (said ? MB(atClose) + ' waiting when it was closed' : 'no close in the log'));

  yes('a socket whose queue passes the ceiling is closed', closed && hB.peers === 2);
  yes('and the log says why', !!said);
  yes('at the first write past the ceiling, not far beyond it',
      Math.max(peakB, atClose) <= CEILING + offer.length + 1024);
  yes('health counts the close', hB.closedBacklogged === 1);
  // Three more ticks to the one who keeps up, as they come, not counted
  // after a second (#1926).
  const gotAt = got.length;
  yes('the rest of the room carries on', await until('three ticks', () => got.length - gotAt >= 3, BOUND_MS));

  /*
    A socket closed in the middle of its own read.

    The ceiling closes a socket from inside a write, so something a person
    sends that comes back to them (an offer addressed to themselves, their own
    chat line, a notice) can close their socket while the service is still
    working through the frames that arrived in the same read. Found in review
    on 24 September: those frames went on being handled for a peer the close
    had already taken out of the room. The chat limit found nobody's bucket
    and let every line through, and each one reached the room and the chat
    log as profile 0 with no name, so the moderators could not say who sent
    it. Twelve lines got out that way past the five the limit allows, and the
    slash commands among them were queued as nobody's.

    So this one sends itself offers until its own queue passes the ceiling,
    each followed by a chat line and a slash command, all in one write so
    they land in the same reads at the other end. A lot of it, because the
    loopback buffers take a few MB before anything queues.
  */
  console.log('');
  const S3 = await open(100003);
  send(S3, { t: 'join', profileId: 100003, name: 'talks to itself' });
  await until('roster', () => roster.some((p) => p.profileId === 100003), 3000);
  const self = (roster.find((p) => p.profileId === 100003) || {}).peer;
  yes('a third stuck socket is in the room', !!self);

  const note = 'y'.repeat(4000);
  const burst = [];
  for (let i = 0; i < 3000; i++) {
    burst.push(frameOf({ t: 'sdp', to: self, sdp: { type: 'offer', sdp: note } }));
    burst.push(frameOf({ t: 'chat', text: 'line ' + i }));
    burst.push(frameOf({ t: 'chat', text: '/roll ' + i }));
  }
  const wroteAt = Date.now();
  S3.write(Buffer.concat(burst));
  const gone = await until('closed', async () => (await health()).closedBacklogged === 2 &&
      !roster.some((p) => p.profileId === 100003), 10000);
  const tookMs = Date.now() - wroteAt;
  // R's pong, so every line that went to R before it has come, and the chat
  // log, written before each line is sent, holds them. It used to read
  // 500 ms after the close (#1926).
  const settled = await settleR();

  const fromIt = heard.filter((m) => m.from === self);
  const asNobody = fromIt.filter((m) => !m.profileId);
  // The limit refills one line every CHAT_REFILL_MS, so a slow machine that
  // took a while to read the burst may fairly let a line or two more through.
  const allowed = CHAT_BURST + Math.floor(tookMs / CHAT_REFILL_MS);
  let logged = [];
  try {
    for (const f of fs.readdirSync(path.join(dir, 'chat'))) {
      for (const line of fs.readFileSync(path.join(dir, 'chat', f), 'utf8').split('\n')) {
        if (line) { try { logged.push(JSON.parse(line)); } catch (e) { } }
      }
    }
  } catch (e) { }
  const loggedIt = logged.filter((l) => l.profileId === 100003).length;
  const loggedNobody = logged.filter((l) => !l.profileId).length;
  console.log('      ' + fromIt.length + ' of its lines reached the room (' + asNobody.length +
              ' as nobody), ' + loggedIt + ' logged as it and ' + loggedNobody + ' as nobody, closed after ' +
              tookMs + ' ms');

  yes('a socket that sends itself enough to pass the ceiling is closed', gone);
  yes('nothing it sent after the close reaches the room as nobody', gone && settled && asNobody.length === 0);
  yes('no more of its lines reach the room than the chat limit allows (' + allowed + ')',
      gone && fromIt.length <= allowed);
  yes('the chat log says who sent every line and command in it',
      gone && loggedIt > 0 && loggedNobody === 0);

  /*
    Pings. Every ping is answered with a two byte pong, and those were written
    straight to the socket, past the ceiling. Node holds each queued write as
    its own request, so a socket that never read and sent 9 MB of pings took
    the service from 50 MB to 447 MB on 24 September, 2.8 MB by
    writableLength, before anything closed it. A backed socket is not
    answered now, which RFC 6455 section 5.5.3 allows, and one that reads
    still is.
  */
  console.log('');
  const S4 = await open(100004);
  send(S4, { t: 'join', profileId: 100004, name: 'pings and never reads' });
  await until('roster', () => roster.some((p) => p.profileId === 100004), 3000);
  const PING = Buffer.from([0x89, 0x80, 0, 0, 0, 0]);   // masked, empty, a zero key
  const PINGS = 1500000;
  const flood = Buffer.alloc(PING.length * PINGS);
  for (let i = 0; i < PINGS; i++) PING.copy(flood, i * PING.length);
  // A sample taken since it joined, for what the service held before.
  await probed(2);
  const markP = probes.length;
  const heldBefore = probes[probes.length - 1].held;
  /*
    A line said after the flood, in the same stream, so R hears it once the
    service has read every ping before it; then two samples more, so the
    probe has looked at what that left held. It used to measure four seconds
    from the write, which a busy machine can need more than to read the
    flood (#1926).
  */
  S4.write(Buffer.concat([flood, frameOf({ t: 'chat', text: 'after the pings' })]));
  const readAll = await until('the line after the pings', () => heard.some((m) => m.text === 'after the pings'), 4 * BOUND_MS);
  await probed(2);
  const during = probes.slice(markP);
  const peakHeld = Math.max.apply(null, during.map((p) => p.held));
  const peakP = Math.max.apply(null, during.map((p) => p.queue));
  const hP = await health();
  console.log('      ' + (flood.length / 1048576).toFixed(1) + ' MB of pings from it: held ' + MB(heldBefore) +
              ' before, peak ' + MB(peakHeld) + ', peak queue ' + MB(peakP));
  yes('the service read the whole flood', readAll);
  yes('a flood of pings from a socket that never reads is not answered into memory',
      during.length > 0 && peakHeld - heldBefore < 16 * 1024 * 1024);
  yes('and its queue stays under the ceiling', during.length > 0 && peakP <= CEILING);
  yes('nor is it closed for pinging', hP.peers === 3 && hP.closedBacklogged === 2);
  /*
    The socket that keeps up is backed for the instant between a tick and
    its drain, and a ping landing then is rightly not answered. This used to
    send up to five, 150 ms apart, hoping one missed that instant (#1926).
    Instead the feed stops, so the tick has nothing more to send R once its
    rows have gone stale (STALE_MS) and R has read that: nothing is written
    to R after it, R is not backed, and one ping is answered.
  */
  clearInterval(feeding);
  feeding = null;
  await lastFeed;
  const stale = await until('the rows gone stale', () => mostGone >= ROWS, BOUND_MS);
  R.write(PING);
  yes('a socket that reads is still answered (its rows went stale first: ' + stale + ')',
      stale && await until('pong', () => (R.pongs || 0) > 0, BOUND_MS));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  done(fail ? 1 : 0);
})().catch((e) => {
  console.error('FAILED: ' + e.message);
  console.error(log);
  console.log(pass + ' passed, ' + (fail + 1) + ' failed');
  done(1);
});
