// test-moved.js
//
// Issue #482: each person is sent only the positions of people near enough to
// hear, or in their party, and only when they changed.
//
// The cull (voice/tests/test-cull.js) took the tick from every person's row to each
// person's view. That view was still sent whole five times a second whether
// anybody in it had moved or not, and most of an evening is people standing.
// Now the first tick after a join is the whole view, { t: 'pos' }, and after
// that { t: 'moved' } carries only rows that changed and the ids that left the
// view (gone), or nothing at all.
//
// This runs voice/voice-server.js in a temp folder on a spare port, feeds it
// two hundred people across ten cells, joins a real websocket for each, keeps
// each one's table the way the clients do, and counts every byte on the wire:
//
//   standing   nobody moves for three seconds
//   walking    forty of them walk, a step every 200 ms, for four seconds
//
// Before is what the tick sent until now: each person's whole view, every
// tick. It is worked out from the tables the sockets hold, which the checks
// below show are exactly the views. VOICE_SERVER points it at another copy of
// the service, which is how the numbers for the code before this were taken.
//
// Read only. Nothing outside the temp folder is touched.
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const SERVER = process.env.VOICE_SERVER || path.join(__dirname, '..', 'voice-server.js');
// Set by ready(), from the system. It was a fixed 7913 (#1703).
let PORT = 0;
const TICK_MS = 200;

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
  Waits on what the sockets have been sent. until(test, what) resolves ''
  once test() holds, checked again as each message comes in on any socket,
  or after BOUND_MS with what did not come. Every check here used to read
  after a fixed number of ticks' worth of time (two to fifteen), and on a
  busy machine the service can tick fewer times than that, or the messages
  can still be on their way (#1926).
*/
const waits = [];
function heard() { for (const w of waits.slice()) { w(); } }
function until(test, what) {
  return new Promise((ok) => {
    let bound = null;
    const check = () => { if (test()) { end(''); } };
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
}

// ------------------------------------------------------------- the people
const CELLS = ['3c:Skyrim.esm', '1605e:Skyrim.esm', '16a0b:Skyrim.esm', '16bd9:Skyrim.esm',
               '13a8e:Skyrim.esm', '1a6ec:Skyrim.esm', '133c6:Skyrim.esm', '16779:Skyrim.esm',
               '15fc5:Skyrim.esm', '1c3b7:Skyrim.esm'];
const SPREAD = [120000, 4000, 4000, 4000, 4000, 4000, 4000, 4000, 4000, 4000];
let seed = 482;
function rand() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }

// The game's own floats, which carry a dozen digits.
const people = [];
for (let c = 0; c < CELLS.length; c++) {
  for (let k = 0; k < 20; k++) {
    const pid = 5000 + c * 20 + k;
    people.push({
      profileId: pid, cell: CELLS[c], name: 'Person ' + pid, party: '',
      pos: [(rand() - 0.5) * SPREAD[c], (rand() - 0.5) * SPREAD[c], (rand() - 0.5) * 600],
      angleZ: rand() * 360
    });
  }
}
const byPid = {};
for (const p of people) { byPid[p.profileId] = p; }
// A party across three cells, which is who the party strip points at.
for (const pid of [5000, 5080, 5160]) { byPid[pid].party = 'p1'; }
// Two in the open world, 50 m apart, for the walking-away check.
byPid[5010].pos = [200000.123456, 200000.654321, 0.5];
byPid[5011].pos = [200000.123456 + 50 * 70, 200000.654321, 0.5];
// Somebody who logs off part way through.
const LEAVER = 5030;
/*
  The clock: one more person, alone in a cell nobody else is in and in no
  party, who takes a step on every feed. Nobody else's view holds them, so
  they change nothing that is measured, and their own socket is sent a
  moved on every tick that carries a new feed. That is how this counts the
  service's ticks, rather than reading after so many ms of its own (#1926).
*/
const CLOCK = { profileId: 9990, cell: 'f00d:Thornswood-Test.esp', name: 'The clock', party: '',
                pos: [1000, 1000, 0], angleZ: 0 };
let present = people.concat([CLOCK]);

// Forty walkers, two from every cell, a step of about a metre a second.
const walkers = people.filter((p, i) => i % 5 === 0 && p.profileId !== 5010 && p.profileId !== 5011);
let walking = false;

function body() {
  return JSON.stringify({ who: present.map((p) => ({
    profileId: p.profileId, pos: p.pos, angleZ: p.angleZ, cell: p.cell, name: p.name, party: p.party
  })) });
}

// ---------------------------------------------------------------- service
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-moved-'));
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
let srv = null;
let log = '';

const sockets = [];
let feeder = null;
/* Ended rather than exited; see test-keepalive.js for the crash that avoids. */
function done(code) {
  process.exitCode = code;
  if (feeder) { clearInterval(feeder); }
  for (const s of sockets) { try { s.close(); } catch (e) { } }
  const rm = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { } };
  if (srv) { srv.once('exit', rm); try { srv.kill(); } catch (e) { } }
  setTimeout(rm, 300).unref();
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
  PORT = await freePort('127.0.0.1');
  srv = spawn(process.execPath, ['voice-server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_VOICE_PORT: String(PORT),
      THORNSWOOD_VOICE_BIND: '127.0.0.1',
      THORNSWOOD_SITE: SITE,
      THORNSWOOD_CHAT_DIR: path.join(dir, 'chat')
    })
  });
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });
  await listening(srv, PORT);
  const r = await fetch('http://127.0.0.1:' + PORT + '/health');
  if (!r.ok) { throw new Error('the service answered /health with ' + r.status + '. log:\n' + log); }
  return await r.json();
}

function feed() {
  if (walking) {
    for (const w of walkers) { w.pos = [w.pos[0] + 14.3, w.pos[1] + 7.7, w.pos[2]]; w.angleZ = (w.angleZ + 3.3) % 360; }
  }
  CLOCK.pos = [CLOCK.pos[0] + 10, CLOCK.pos[1], CLOCK.pos[2]];
  return fetch('http://127.0.0.1:' + PORT + '/positions', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: body()
  }).then((r) => r.status).catch(() => 0);
}

/* A text frame's bytes on the wire: the header the service writes, then the body. */
function frameBytes(text) {
  const n = Buffer.byteLength(text);
  return n + (n < 126 ? 2 : (n < 65536 ? 4 : 10));
}

/* One person's socket, holding its table the way every client does. */
async function join(pid) {
  const token = await joinToken(PORT, pid);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT + '/', ['thornswood', token]);
    // wire is every position message as { at, bytes }, at being the tick
    // that sent it by the service's clock, so a stretch of ticks can be
    // counted however late its messages arrive.
    const me = { pid: pid, ws: ws, table: null, bytes: 0, msgs: 0, moved: 0, firstAt: 0, at: 0, wire: [], pongs: [] };
    sockets.push(ws);
    const late = setTimeout(() => reject(new Error('no welcome for ' + pid)), 20000);
    ws.onopen = () => { ws.send(JSON.stringify({ t: 'join', profileId: pid, name: 'Person ' + pid })); };
    ws.onmessage = (ev) => {
      const text = String(ev.data);
      if (text.startsWith('{"t":"peers"')) { return; }
      let m = null;
      try { m = JSON.parse(text); } catch (e) { return; }
      if (m.t === 'welcome') { clearTimeout(late); resolve(me); return; }
      if (m.t === 'pong') { const p = me.pongs.shift(); if (p) { p(); } return; }
      if (m.t === 'pos') {
        me.table = m.who || {}; me.at = m.at; if (!me.firstAt) { me.firstAt = m.at; }
        me.bytes += frameBytes(text); me.msgs++; me.wire.push({ at: m.at, bytes: frameBytes(text) });
      }
      if (m.t === 'moved' && me.table) {
        for (const k of Object.keys(m.who || {})) { me.table[k] = m.who[k]; }
        for (const id of (m.gone || [])) { delete me.table[id]; }
        me.at = m.at; me.bytes += frameBytes(text); me.msgs++; me.moved++; me.wire.push({ at: m.at, bytes: frameBytes(text) });
      }
      heard();
    };
    ws.onerror = () => { clearTimeout(late); reject(new Error('socket for ' + pid + ' failed')); };
  });
}

/* A table as text with its keys in order, to compare two of them. */
function canon(t) {
  const out = {};
  for (const k of Object.keys(t || {}).sort()) { out[k] = t[k]; }
  return JSON.stringify(out);
}

/* What the tick used to send everybody: their whole view, every tick. */
function wholeTick(joined) {
  let b = 0;
  for (const j of joined) { b += frameBytes(JSON.stringify({ t: 'pos', at: j.at, who: j.table || {} })); }
  return b;
}

/* What the sockets were sent by ticks after the one at from, up to and with
   the one at to, by the service's clock. */
function sentIn(joined, from, to) {
  let bytes = 0, msgs = 0;
  for (const j of joined) {
    for (const w of j.wire) { if (w.at > from && w.at <= to) { bytes += w.bytes; msgs++; } }
  }
  return { bytes: bytes, msgs: msgs };
}

/*
  A page's own ping, answered after everything the service sent that socket
  before it (#519). The tick writes to every socket in one go, so once each
  socket's pong is in, everything every tick sent so far has come.
*/
function settle(j) {
  return new Promise((ok, bad) => {
    const late = setTimeout(() => bad(new Error('no pong to a ping from ' + j.pid + ' within ' + BOUND_MS / 1000 + ' s')), BOUND_MS);
    j.pongs.push(() => { clearTimeout(late); ok(); });
    j.ws.send(JSON.stringify({ t: 'ping' }));
  });
}
const settleAll = (list) => Promise.all(list.map(settle));

/* The clock's socket, set once it has joined. ticks(n) waits for n more
   ticks of the service that carried a feed, and says when the last was. */
let clock = null;
async function ticks(n) {
  const from = clock.wire.length;
  const why = await until(() => clock.wire.length >= from + n, n + ' ticks of the service');
  if (why) { throw new Error(why); }
  return clock.wire[from + n - 1].at;
}

(async () => {
  const h = await ready();
  console.log('      the service under test answers build ' + h.build);
  yes('the service takes the feed', await feed() === 204);
  feeder = setInterval(() => { feed(); }, TICK_MS);

  clock = await join(CLOCK.profileId);
  const joined = [];
  for (let i = 0; i < people.length; i += 50) {
    joined.push(...await Promise.all(people.slice(i, i + 50).map((p) => join(p.profileId))));
    console.log('      ' + joined.length + ' joined');
  }
  const of = {};
  for (const j of joined) { of[j.pid] = j; }
  let why = await until(() => joined.every((j) => j.table), 'whole view for every one of them');
  yes('every one of them was sent their whole view', joined.every((j) => j.table), why);

  yes('rows are sent in whole units and whole degrees',
      joined.every((j) => Object.keys(j.table || {}).every((k) => {
        const r = j.table[k];
        return Array.isArray(r.pos) && r.pos.every(Number.isInteger) && Number.isInteger(r.angleZ);
      })));

  /*
    Each stretch below is so many ticks of the service, counted on the
    clock's socket, and what the others were sent in it is counted by the
    tick that sent it once every socket's pong is in. It used to be so many
    seconds here, read as they ended, which on a busy machine can be fewer
    ticks and messages still on the way (#1926).
  */
  // ------------------------------------------------------------ standing
  const STAND_TICKS = 15;
  const sFrom = await ticks(1);
  const sTo = await ticks(STAND_TICKS);
  await settleAll(joined);
  const s = sentIn(joined, sFrom, sTo);
  const standAfter = s.bytes / STAND_TICKS;
  const standBefore = wholeTick(joined);
  console.log('      standing: ' + s.msgs + ' messages in ' + STAND_TICKS + ' ticks');
  yes('two hundred people standing still are sent nothing after their first view', s.msgs === 0);

  // ------------------------------------------------------------- walking
  const WALK_TICKS = 20;
  walking = true;
  const wFrom = await ticks(2);
  const wTo = await ticks(WALK_TICKS);
  walking = false;
  await settleAll(joined);
  const w = sentIn(joined, wFrom, wTo);
  const walkAfter = w.bytes / WALK_TICKS;
  const walkBefore = wholeTick(joined);
  yes('people who can hear a walker are told they moved',
      joined.filter((j) => j.moved > 0).length > walkers.length);
  // Two ticks more, so the last feed with anybody walking has been sent on.
  await ticks(2);
  await settleAll(joined);

  // ------------------------------------------- walking away, logging off
  const a = of[5010], b = of[5011];
  yes('two in the open world 50 m apart see each other', !!(a.table[5011] && b.table[5010]));
  byPid[5011].pos = [200000 + 400 * 70, 200000, 0];
  why = await until(() => !a.table[5011] && !b.table[5010], 'tick taking 5010 and 5011 out of each other\'s view');
  yes('walking 400 m away takes them out of each other\'s view', !a.table[5011] && !b.table[5010], why);
  yes('and each still has their own row', !!(a.table[5010] && b.table[5011]));

  const hadLeaver = joined.filter((j) => j.pid !== LEAVER && j.table[LEAVER]);
  present = present.filter((p) => p.profileId !== LEAVER);
  why = await until(() => hadLeaver.every((j) => !j.table[LEAVER]), 'tick taking ' + LEAVER + ' out of every view');
  yes('somebody who logs off leaves the view of everybody who had them (' + hadLeaver.length + ')',
      hadLeaver.length > 0 && hadLeaver.every((j) => !j.table[LEAVER]), why);

  // ------------------------------------ the tables are exactly the views
  /*
    A second socket for the same person is sent the whole view on its first
    tick. With nobody moving, it has to match the table the first socket
    built up out of a whole view and every change since: read once each
    first socket's pong is in, after its second's whole view has come.
  */
  const sample = joined.filter((j, i) => i % 10 === 0 && j.pid !== LEAVER);
  const fresh = await Promise.all(sample.map((j) => join(j.pid)));
  why = await until(() => fresh.every((f) => f.table), 'whole view for every second socket');
  await settleAll(sample);
  const mismatched = sample.filter((j, i) => canon(j.table) !== canon(fresh[i].table));
  yes('what each socket holds after the changes is exactly its whole view (' +
      mismatched.length + ' of ' + sample.length + ' differ)', !why && mismatched.length === 0, why);
  yes('the party strip still gets the party across cells',
      !!(of[5000].table[5080] && of[5000].table[5160] && of[5160].table[5000]));

  // ------------------------------------------------------------ the bill
  const mbs = (x) => (x * (1000 / TICK_MS) / 1e6).toFixed(3);
  const gbEvening = (x) => (x * (1000 / TICK_MS) * 4 * 3600 / 1e9).toFixed(1);
  console.log('');
  console.log('      two hundred people across ten cells, bytes a tick on the wire:');
  console.log('        standing, whole view every tick: ' + standBefore + ' (' + mbs(standBefore) + ' MB/s, ' +
              gbEvening(standBefore) + ' GB over four hours)');
  console.log('        standing, only what changed:     ' + Math.round(standAfter) + ' (' + mbs(standAfter) + ' MB/s)');
  console.log('        forty walking, whole view every tick: ' + walkBefore + ' (' + mbs(walkBefore) + ' MB/s, ' +
              gbEvening(walkBefore) + ' GB over four hours)');
  console.log('        forty walking, only what changed:     ' + Math.round(walkAfter) + ' (' + mbs(walkAfter) + ' MB/s, ' +
              gbEvening(walkAfter) + ' GB over four hours)');
  console.log('');
  yes('with a fifth of them walking a tick costs under a third of the whole view', walkAfter * 3 < walkBefore);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  done(fail ? 1 : 0);
})().catch((e) => {
  console.log('FAIL  ' + (e && e.message));
  fail++;
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  done(1);
});
