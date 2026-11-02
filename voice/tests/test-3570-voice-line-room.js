// test-3570-voice-line-room.js
//
// Issue #3570: nobody waiting in line takes a voice place.
//
// THORNSWOOD_VOICE_MOST was set to the seats (records\most-online.json, voice
// 30 for 25 people and 5 staff seats), and every socket a join token proved
// took one of those places at the handshake. Somebody waiting in line at the
// menu holds the game's chat socket to say "/line", so with the world full
// and anybody waiting, a staff member taking their free staff seat was closed
// with 1013, and nobody new could open a socket to join the line at all.
// Patrick, 27 Oct (answer C): no voice place while waiting, because voice is
// proximity only and nobody at the menu can be heard.
//
// This runs voice/voice-server.js in a temp folder on a port the system hands
// out, with MOST 3: two ordinary seats and one staff seat. It joins real
// websockets with real join tokens (asked of the service, which asks a
// stand-in site that says yes), and stands in for the gamemode's position
// feed over loopback, which is how the service knows who is in the world:
//
//   two seated people and one waiting at the menu: the room is full;
//   a staff member opening their sockets is let in, takes the staff seat,
//     and is on the roster with the two seated;
//   a fifth person is let in too, and their "/line" reaches the game server;
//   nobody at the menu is on a roster or sent one, and signalling to them
//     goes nowhere;
//   somebody seated from the line takes a voice place, and one who goes
//     back to the menu loses it and is sent an empty roster;
//   past MOST in the world (the record and the seats disagree): text chat,
//     one line saying voice is full, and voice when a place frees.
//
// It fails on the code before #3570, where the staff member and the fifth
// person were closed with 1013. Read only. Nothing outside the temp folder is
// touched.
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'voice', 'voice-server.js');

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + why : '')); }
}

const BOUND_MS = 15000;

/* The site, as far as the service asks it anything: every ticket owns its profile. */
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

/* Waits for the service's own "listening on ...:port" line. If it stops
   first, something took the port in between or it could not start, and the
   error says which, with what it printed. */
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

async function service(site, most) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-3570-'));
  fs.copyFileSync(SERVER, path.join(dir, 'voice-server.js'));
  fs.copyFileSync(path.join(ROOT, 'voice', 'headlines.js'), path.join(dir, 'headlines.js'));
  const port = await freePort();
  const env = Object.assign({}, process.env, {
    THORNSWOOD_VOICE_PORT: String(port),
    THORNSWOOD_VOICE_BIND: '127.0.0.1',
    THORNSWOOD_SITE: site,
    THORNSWOOD_CHAT_DIR: path.join(dir, 'chat'),
    THORNSWOOD_VOICE_MOST: String(most)
  });
  const srv = spawn(process.execPath, ['voice-server.js'], { cwd: dir, env: env });
  const s = { dir: dir, port: port, proc: srv, log: '' };
  srv.stdout.on('data', (d) => { s.log += d; });
  srv.stderr.on('data', (d) => { s.log += d; });
  await listening(srv, port);
  return s;
}

function request(s, method, route, body) {
  return new Promise((ok, bad) => {
    const data = body == null ? '' : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: s.port, path: route, method: method, agent: false,
                               headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => { ok({ status: res.statusCode, body: b }); });
    });
    req.on('error', bad);
    req.end(data);
  });
}

async function health(s) { return JSON.parse((await request(s, 'GET', '/health')).body); }

/* The gamemode's position feed: these profiles are in the world, in one room. */
async function inWorld(s, pids) {
  const who = pids.map((pid, i) => ({ profileId: pid, actor: 0x14000 + pid, pos: [i * 70, 0, 0], angleZ: 0,
                                      cell: 'a room', name: 'Person ' + pid }));
  const r = await request(s, 'POST', '/positions', { who: who });
  if (r.status !== 204) throw new Error('/positions answered ' + r.status + ' ' + r.body);
}

async function joinToken(s, pid) {
  const r = await request(s, 'POST', '/token', { profileId: pid, ticket: 'a ticket the stand-in site takes' });
  let doc = null;
  try { doc = JSON.parse(r.body); } catch (e) { }
  if (r.status === 200 && doc && typeof doc.token === 'string') return doc.token;
  throw new Error('no token for profile ' + pid + ': ' + r.status + ' ' + r.body.slice(0, 200));
}

const opened = [];
/*
  One page's socket. Resolves once it is welcomed, closed or refused at the
  handshake, with what it was sent from then on: { welcomed, closed, code,
  peer, chat, rosters, sdp, ws }. A refused handshake is told by error before
  open, since Node 22's WebSocket never follows it with close (#2818).
*/
async function page(s, pid) {
  const token = await joinToken(s, pid);
  return new Promise((ok) => {
    const ws = new WebSocket('ws://127.0.0.1:' + s.port + '/', ['thornswood', token]);
    opened.push(ws);
    const me = { pid: pid, ws: ws, open: false, welcomed: false, closed: false, code: 0, peer: 0,
                 chat: [], rosters: [], sdp: [] };
    const late = setTimeout(() => ok(me), BOUND_MS);
    ws.onopen = () => { me.open = true; ws.send(JSON.stringify({ t: 'join', profileId: pid, name: 'Person ' + pid })); };
    ws.onmessage = (ev) => {
      let m = null;
      try { m = JSON.parse(String(ev.data)); } catch (e) { return; }
      if (m.t === 'welcome') { me.welcomed = true; me.peer = m.peer; clearTimeout(late); ok(me); }
      if (m.t === 'chat') me.chat.push(m);
      if (m.t === 'peers') me.rosters.push(m.peers || []);
      if (m.t === 'sdp') me.sdp.push(m);
    };
    ws.onclose = (ev) => { me.closed = true; me.code = ev.code; clearTimeout(late); ok(me); };
    ws.onerror = () => { if (!me.open) { me.closed = true; clearTimeout(late); ok(me); } };
  });
}

function send(me, msg) { me.ws.send(JSON.stringify(msg)); }
function lastRoster(me) { return me.rosters.length ? me.rosters[me.rosters.length - 1] : null; }
/* The profiles on a roster, each once: a row is a socket, and a person can hold two. */
function names(roster) {
  return Array.from(new Set((roster || []).map((r) => Number(r.profileId)))).sort((a, b) => a - b).join(',');
}

async function until(test) {
  const end = Date.now() + BOUND_MS;
  while (!test() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  return test();
}
async function healthUntil(s, test) {
  const end = Date.now() + BOUND_MS;
  let h = await health(s);
  while (!test(h) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 50));
    h = await health(s);
  }
  return h;
}
/* What the game server would take off GET /commands right now. */
async function commandsNow(s) {
  return (JSON.parse((await request(s, 'GET', '/commands')).body).commands || []);
}

const services = [];
function finish() {
  for (const ws of opened) { try { ws.close(); } catch (e) { } }
  for (const s of services) {
    const rm = () => { try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch (e) { } };
    s.proc.once('exit', rm);
    try { s.proc.kill(); } catch (e) { }
    setTimeout(rm, 300).unref();
  }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}

(async () => {
  const site = await siteThatSaysYes();
  const s = await service(site, 3);
  services.push(s);

  // ---------------------------------------- two seated, one waiting: full
  // Seated people have the launcher's voice page and the game's chat open.
  const a = await page(s, 101);
  const a2 = await page(s, 101);
  const b = await page(s, 102);
  await inWorld(s, [101, 102]);
  // Waiting at the menu: the game's chat, which says "/line".
  const w = await page(s, 103);
  yes('two seated people and one waiting at the menu are all let in', a.welcomed && a2.welcomed && b.welcomed && w.welcomed);
  let h = await healthUntil(s, (x) => x.people === 2);
  yes('/health: the two seated hold voice places, on three sockets of theirs, and the one waiting holds none',
      h.people === 2 && h.peers === 4 && h.most === 3, JSON.stringify({ people: h.people, peers: h.peers, most: h.most }));
  send(w, { t: 'chat', text: '/line' });
  await until(() => lastRoster(a) && names(lastRoster(a)) === '101,102');
  yes('the seated are on each other\'s roster', names(lastRoster(a)) === '101,102' && names(lastRoster(b)) === '101,102',
      names(lastRoster(a)) + ' / ' + names(lastRoster(b)));

  // ------------------------------------- staff take their free staff seat
  const staff = await page(s, 201);
  const staff2 = await page(s, 201);
  yes('a staff member opening voice and chat while somebody waits is let in, not closed with 1013',
      staff.welcomed && staff2.welcomed && !staff.closed && !staff2.closed, 'closed with ' + staff.code + ' / ' + staff2.code);
  await inWorld(s, [101, 102, 201]);
  await until(() => names(lastRoster(staff)) === '101,102,201');
  yes('in the world, the staff member takes the third voice place and is on the roster with the seated',
      names(lastRoster(staff)) === '101,102,201' && names(lastRoster(a)) === '101,102,201',
      names(lastRoster(staff)) + ' / ' + names(lastRoster(a)));
  h = await health(s);
  yes('/health: three voice places held, nobody kept off', h.people === 3 && h.refusedFull === 0,
      JSON.stringify({ people: h.people, refusedFull: h.refusedFull }));

  // -------------------------------------- a new arrival can join the line
  const n = await page(s, 104);
  yes('with every voice place held, somebody new still gets a socket', n.welcomed && !n.closed, 'closed with ' + n.code);
  await commandsNow(s);   // what came before, taken
  send(n, { t: 'chat', text: '/line' });
  let got = [];
  const end = Date.now() + BOUND_MS;
  while (!got.some((c) => c.profileId === 104 && c.text === '/line') && Date.now() < end) {
    got = got.concat(await commandsNow(s));
    await new Promise((r) => setTimeout(r, 50));
  }
  yes('and their "/line" reaches the game server under their profile',
      got.some((c) => c.profileId === 104 && c.text === '/line'), JSON.stringify(got).slice(0, 300));

  // --------------------------------------------- nobody waiting has voice
  const every = [a, a2, b, staff, staff2];
  yes('nobody in the room was ever sent a roster naming somebody at the menu',
      every.every((p) => p.rosters.every((r) => !r.some((x) => x.profileId === 103 || x.profileId === 104))));
  yes('nobody at the menu was sent a roster at all', w.rosters.length === 0 && n.rosters.length === 0,
      w.rosters.length + ' and ' + n.rosters.length);
  send(a, { t: 'sdp', to: w.peer, sdp: { type: 'offer', sdp: 'v=0' } });
  send(w, { t: 'sdp', to: a.peer, sdp: { type: 'offer', sdp: 'v=0' } });
  send(a, { t: 'sdp', to: b.peer, sdp: { type: 'offer', sdp: 'v=0' } });
  await until(() => b.sdp.length > 0);
  yes('signalling between two voice places goes through', b.sdp.length === 1);
  yes('signalling to or from a socket at the menu goes nowhere', w.sdp.length === 0 && a.sdp.length === 0,
      w.sdp.length + ' and ' + a.sdp.length);

  // --------------------------------- seated from the line, back to the menu
  // 102 is moved out for being idle and 103, first in line, is seated.
  await inWorld(s, [101, 201, 103]);
  await until(() => names(lastRoster(w)) === '101,103,201');
  yes('seated from the line, they take a voice place and are sent the roster',
      names(lastRoster(w)) === '101,103,201' && names(lastRoster(a)) === '101,103,201',
      names(lastRoster(w)) + ' / ' + names(lastRoster(a)));
  await until(() => lastRoster(b) && lastRoster(b).length === 0);
  yes('back at the menu, they lose theirs and are sent an empty roster, so their page lets go',
      lastRoster(b) && lastRoster(b).length === 0, JSON.stringify(lastRoster(b)));

  // ----------------------------------------- past MOST in the world at once
  // The record and the seats disagree: four in the world, three places.
  await inWorld(s, [101, 201, 103, 104]);
  await until(() => n.chat.some((m) => /Voice is full/.test(m.text)));
  const told = n.chat.filter((m) => !Number(m.from) && /Voice is full/.test(m.text));
  yes('somebody in the world past the number is told once that voice is full and text chat still works',
      told.length === 1 && /3 people are using it/.test(told[0].text) && /Text chat still works/.test(told[0].text),
      JSON.stringify(n.chat).slice(0, 300));
  yes('the line has no em dash in it', told.length > 0 && told[0].text.indexOf('—') < 0);
  yes('and is on nobody\'s roster', [a, staff, w].every((p) => !names(lastRoster(p)).split(',').includes('104')));
  h = await health(s);
  yes('/health counts them kept off voice, and three places still held', h.refusedFull === 1 && h.people === 3,
      JSON.stringify({ people: h.people, refusedFull: h.refusedFull }));
  yes('the log says so', /\[voice\] full: 3 people hold voice/.test(s.log), s.log.slice(-400));
  await inWorld(s, [101, 201, 103, 104]);
  await new Promise((r) => setTimeout(r, 300));
  yes('a second feed does not tell them again', n.chat.filter((m) => /Voice is full/.test(m.text)).length === 1);
  await inWorld(s, [101, 201, 104]);
  await until(() => names(lastRoster(n)) === '101,104,201');
  yes('when somebody leaves the world, the place frees and they take it',
      names(lastRoster(n)) === '101,104,201', names(lastRoster(n)));

  finish();
})().catch((err) => {
  fail++;
  console.log('FAIL  the harness stopped: ' + (err && err.stack || err));
  finish();
});
