// test-roster-once.js
//
// Issue #2332: a room that fills at once is sent one roster, not one per
// arrival.
//
// announce() used to send the whole roster to every socket the moment
// anybody joined or left, so when the service restarted and every page came
// back together, N people cost each of N sockets N rosters, each the size of
// the room. Measured on One on 11 Oct with voice/load-voice.js: 200 people
// took 20 s to get back in and 400 never did. Now the joins and leaves one
// turn of the event loop handles share one roster (sendRoster).
//
// This runs voice/voice-server.js from a temp folder on a port the system
// hands out, with real join tokens from a stand-in site that says yes, and
// measures on the wire:
//
//   PEOPLE people in the world (a stand-in position feed, since only they
//   hold a voice place, #3570), their sockets already open, send their joins
//   together; every one is welcomed, then sent one roster naming all of
//   them, not one per arrival (the first in used to get PEOPLE);
//   the welcome still comes before the first roster on every socket;
//   half of them close together, and the rest are sent one roster without
//   them, again not one per departure;
//   one person joining alone afterwards is still one roster to each socket,
//   straight away, as before.
//
// The service runs in this harness's own process, not a child of it as in the
// other voice harnesses, because "together" has to be true for the counts to
// mean anything. In a child it was not: the 25 Oct nightly failed with 30
// rosters for 30 leaves, and timing each close and each roster on the runner
// (harnesses.yml run 40210097962) showed why. The loop closing the 30 sockets
// took 35 ms that round instead of the usual 0.5 ms, because the busy runner
// took the CPU from this process between closes, and the service, running
// freely in its own process meanwhile, read each close in a turn of its own
// and answered it with a roster, as it should. Sharing one event loop, the
// service cannot read anything until the loop that sends the joins, or closes
// the sockets, has finished, so every one of them is waiting when it next
// reads, however slowly that loop ran, and it handles them in one turn.
//
// VOICE_SERVER=<path> runs it against another copy (the one before #2332
// fails the counts). Read only. Nothing outside the temp folder is touched.
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');

const SERVER = process.env.VOICE_SERVER || path.join(__dirname, '..', 'voice-server.js');
const PEOPLE = 60;
// The most rosters any one socket may be sent while PEOPLE joins (or half
// that many leaves) arrive together: one, since the service reads them all
// in one turn (above). It was a quarter of PEOPLE while the service ran in a
// child, as room for a busy runner splitting them across turns, and the 25
// Oct nightly needed twice that.
const MOST_ROSTERS = 1;
const BOUND_MS = 20000;

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + why : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms) {
  const end = Date.now() + (ms || BOUND_MS);
  while (Date.now() < end) { if (cond()) return true; await sleep(20); }
  return cond();
}

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
    site.listen(0, '127.0.0.1', () => { site.unref(); ok('http://127.0.0.1:' + site.address().port); });
  });
}

function freePort() {
  return new Promise((ok, bad) => {
    const s = net.createServer();
    s.on('error', bad);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}

let svc = null;
/* Starts the service in this process, from a temp folder holding a copy of
   it, and waits for its own "listening on ...:port" line, as
   voice/tests/test-most.js does. Its log lines, which all start "[voice]", are kept
   in svc.log instead of printed, as they were from the child before. */
async function service(site) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-roster-'));
  fs.copyFileSync(SERVER, path.join(dir, 'voice-server.js'));
  fs.copyFileSync(path.join(__dirname, '..', 'headlines.js'), path.join(dir, 'headlines.js'));
  const port = await freePort();
  Object.assign(process.env, {
    THORNSWOOD_VOICE_PORT: String(port), THORNSWOOD_VOICE_BIND: '127.0.0.1', THORNSWOOD_SITE: site,
    THORNSWOOD_CHAT_DIR: path.join(dir, 'chat')
  });
  delete process.env.THORNSWOOD_VOICE_MOST;
  svc = { dir: dir, port: port, log: '' };
  let up = null;
  const heard = new Promise((ok) => { up = ok; });
  const keep = (to) => function () {
    const line = Array.prototype.join.call(arguments, ' ');
    if (!/^\[voice\]/.test(line)) { to.apply(console, arguments); return; }
    svc.log += line + '\n';
    const m = /^\[voice\] listening on \S+:(\d+)/.exec(line);
    if (m && Number(m[1]) === port) up();
  };
  console.log = keep(console.log);
  console.error = keep(console.error);
  console.warn = keep(console.warn);
  // A port taken between freePort and the service's listen is an 'error' on
  // its server with nothing listening for it, so it comes here.
  let stopped = null;
  const failed = new Promise((ok, bad) => { stopped = bad; });
  const why = (err) => stopped(new Error((err && err.code === 'EADDRINUSE' ? 'something else already holds port ' + port + ', so ' : '') +
                                         'the voice service stopped before it was listening: ' + (err && err.stack || err) +
                                         '\nIt printed:\n' + svc.log));
  process.once('uncaughtException', why);
  let late = null;
  const slow = new Promise((ok, bad) => { late = setTimeout(() => bad(new Error('the voice service did not say it was listening on ' + port +
                                                                              ' within fifteen seconds. It printed:\n' + svc.log)), 15000); });
  try {
    require(path.join(dir, 'voice-server.js'));
    await Promise.race([heard, failed, slow]);
  } finally {
    clearTimeout(late);
    process.removeListener('uncaughtException', why);
  }
  return svc;
}

function token(port, pid) {
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
        bad(new Error('no token for profile ' + pid + ': ' + res.statusCode + ' ' + b.slice(0, 200)));
      });
    });
    req.on('error', bad);
    req.end(body);
  });
}

const opened = [];
/* A socket that is open and has not joined yet. Records what it is sent, in order. */
async function openPage(port, pid) {
  const tok = await token(port, pid);
  return new Promise((ok, bad) => {
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/', ['thornswood', tok]);
    opened.push(ws);
    const me = { pid: pid, ws: ws, peer: 0, got: [], closed: false };
    const late = setTimeout(() => bad(new Error('socket for ' + pid + ' did not open')), BOUND_MS);
    ws.onopen = () => { clearTimeout(late); ok(me); };
    ws.onmessage = (ev) => {
      let m = null;
      try { m = JSON.parse(String(ev.data)); } catch (e) { return; }
      me.got.push(m);
      if (m.t === 'welcome') me.peer = m.peer;
    };
    ws.onclose = () => { me.closed = true; };
    // Before open, error is a refused handshake, which Node 22's WebSocket
    // never follows with close (#2818); after open the promise is settled.
    ws.onerror = () => { clearTimeout(late); bad(new Error('socket for ' + pid + ' was refused')); };
  });
}
/*
  The gamemode's position feed, stood in for: only somebody in the world holds
  a voice place and is on the roster (#3570), so everybody this joins is put
  in the world first, each in a cell of their own.
*/
function inWorld(port, pids) {
  return new Promise((ok, bad) => {
    const body = JSON.stringify({ who: pids.map((pid) => ({ profileId: pid, pos: [0, 0, 0], angleZ: 0,
                                                            cell: 'cell ' + pid, name: 'Person ' + pid })) });
    const req = http.request({ host: '127.0.0.1', port: port, path: '/positions', method: 'POST', agent: false,
                               headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      res.resume();
      res.on('end', () => { if (res.statusCode === 204) ok(); else bad(new Error('/positions answered ' + res.statusCode)); });
    });
    req.on('error', bad);
    req.end(body);
  });
}
const rosters = (me) => me.got.filter((m) => m.t === 'peers');
const lastRoster = (me) => { const r = rosters(me); return r.length ? r[r.length - 1].peers : null; };
const names = (list, peers) => !!list && peers.every((id) => list.some((row) => row.peer === id));

(async () => {
  const site = await siteThatSaysYes();
  const s = await service(site);
  await inWorld(s.port, Array.from({ length: PEOPLE }, (_, k) => 5000 + k).concat([9000]));

  // ------------------------------------------------------- all in at once
  const pages = [];
  for (let i = 0; i < PEOPLE; i += 20) {
    pages.push(...await Promise.all(Array.from({ length: Math.min(20, PEOPLE - i) }, (_, k) => openPage(s.port, 5000 + i + k))));
  }
  yes(PEOPLE + ' sockets are open before anybody joins', pages.length === PEOPLE && pages.every((p) => !p.closed));

  for (const p of pages) p.ws.send(JSON.stringify({ t: 'join', profileId: p.pid, name: 'Person ' + p.pid }));
  const allIn = await until(() => pages.every((p) => p.peer) &&
                                  pages.every((p) => names(lastRoster(p), pages.map((q) => q.peer))));
  yes('every one is welcomed and sent a roster naming all ' + PEOPLE, allIn,
      pages.filter((p) => !p.peer).length + ' not welcomed, ' +
      pages.filter((p) => !names(lastRoster(p), pages.map((q) => q.peer))).length + ' without the whole room');
  await sleep(300);

  const counts = pages.map((p) => rosters(p).length);
  const most = Math.max.apply(null, counts);
  const total = counts.reduce((a, b) => a + b, 0);
  console.log('      rosters per socket for ' + PEOPLE + ' joins together: most ' + most + ', all sockets ' + total +
              ' (one per arrival would be ' + PEOPLE + ' to the first in and ' + (PEOPLE * (PEOPLE + 1) / 2) + ' in all)');
  yes('no socket is sent more than one roster for ' + PEOPLE + ' joins that arrive together',
      most <= MOST_ROSTERS, 'most ' + most + ', counts ' + counts.join(','));
  yes('every socket is welcomed before it is sent its first roster',
      pages.every((p) => { const w = p.got.findIndex((m) => m.t === 'welcome'); const r = p.got.findIndex((m) => m.t === 'peers');
                           return w >= 0 && r > w; }));
  yes('every roster still carries the ice list and each row its peer, profile, name and mode',
      pages.every((p) => rosters(p).every((m) => Array.isArray(m.iceServers) &&
        m.peers.every((row) => row.peer && row.profileId && typeof row.name === 'string' && row.mode === 'local'))));

  // ------------------------------------------------- half leave at once
  const going = pages.slice(0, PEOPLE / 2);
  const staying = pages.slice(PEOPLE / 2);
  const before = staying.map((p) => rosters(p).length);
  for (const p of going) p.ws.close();
  const goneIds = going.map((p) => p.peer);
  const left = await until(() => staying.every((p) => { const l = lastRoster(p);
    return l && l.length === staying.length && !l.some((row) => goneIds.indexOf(row.peer) >= 0); }));
  yes('when half close together, the rest are sent a roster without them', left);
  await sleep(300);
  const leaveMost = Math.max.apply(null, staying.map((p, i) => rosters(p).length - before[i]));
  console.log('      rosters per remaining socket for ' + going.length + ' leaving together: most ' + leaveMost);
  yes('and one roster, not one per departure', leaveMost <= MOST_ROSTERS,
      'most ' + leaveMost);

  // --------------------------------------------------- one alone, as ever
  const mark = staying.map((p) => rosters(p).length);
  const late = await openPage(s.port, 9000);
  late.ws.send(JSON.stringify({ t: 'join', profileId: 9000, name: 'Late' }));
  const named = await until(() => late.peer && staying.every((p) => names(lastRoster(p), [late.peer])) &&
                                  names(lastRoster(late), staying.map((p) => p.peer).concat([late.peer])));
  yes('somebody joining alone is sent the room, and the room is sent them', named);
  await sleep(200);
  yes('with exactly one roster to each socket for that one join',
      staying.every((p, i) => rosters(p).length - mark[i] === 1) && rosters(late).length === 1,
      staying.map((p, i) => rosters(p).length - mark[i]).join(',') + ' / ' + rosters(late).length);

  finish();
})().catch((err) => {
  fail++;
  console.log('FAIL  the harness stopped: ' + (err && err.stack || err));
  finish();
});

function finish() {
  for (const ws of opened) { try { ws.close(); } catch (e) { } }
  if (svc) { try { fs.rmSync(svc.dir, { recursive: true, force: true }); } catch (e) { } }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  // The service shares this process and its listener and timers never end,
  // so the harness ends it.
  process.exit(fail ? 1 : 0);
}
