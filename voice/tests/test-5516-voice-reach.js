// test-5516-voice-reach.js
//
// Issue #5516: voice range was only applied by the listener's page.
//
// voice/voice-server.js limited only the position feed by distance (viewsOf,
// HEAR_UNITS): the roster named every voice connection on the server and the
// sdp/ice relay passed signalling between any two, so every page built a
// connection to everybody and a changed page that ignored the gain could hear
// anyone on the server, whispers included. Now each connection's roster names
// only the voice connections in its view, it is sent again when that changes,
// and signalling passes only between two that each have the other in view
// (ONLY WHO IS IN REACH in voice-server.js). Both clients reconcile against
// every roster, so walking into reach connects and walking out closes.
//
// Rahul Ranjan wrote the first version of this harness and the relay gate in
// #5523. It runs voice/voice-server.js in a temp folder on a port the system
// hands out, joins real websockets with real join tokens (asked of the
// service, which asks a stand-in site that says yes), and stands in for the
// gamemode's position feed over loopback, five times a second as it sends it:
//
//   two people in one cell within HEAR_UNITS are on each other's roster and
//     their signalling is relayed;
//   a page in another cell, or in the same cell past HEAR_UNITS, is on
//     nobody's roster there and its offers and candidates are not relayed;
//   a party member is on the roster and relayed wherever they stand;
//   walking out of reach takes each off the other's roster, which is what
//     closes the connection on both pages, and stops the signalling;
//   walking back puts them on again, so the pages connect again (a relay
//     gate alone left them unable to, since a page offers once per roster);
//   both clients close a connection to whoever leaves their roster and open
//     one to whoever comes on.
//
// It fails on the code before #5516. Read only. Nothing outside the temp
// folder is touched.
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
        } else { res.writeHead(404).end(); }
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-5516-'));
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

/* The gamemode's position feed, with a say over cell, distance and party,
   sent five times a second like the gamemode's, since a view goes stale
   after three seconds without it. */
let rows = [];
let feeding = null;
async function inWorld(s, now) {
  rows = now.map((r) => ({ profileId: r.pid, actor: 0x14000 + r.pid, pos: r.pos, angleZ: 0,
                           cell: r.cell, name: 'Person ' + r.pid, party: r.party || '' }));
  const r = await request(s, 'POST', '/positions', { who: rows });
  if (r.status !== 204) throw new Error('/positions answered ' + r.status + ' ' + r.body);
  if (!feeding) feeding = setInterval(() => { request(s, 'POST', '/positions', { who: rows }).catch(() => { }); }, 200);
}

async function joinToken(s, pid) {
  const r = await request(s, 'POST', '/token', { profileId: pid, ticket: 'a ticket the stand-in site takes' });
  let doc = null;
  try { doc = JSON.parse(r.body); } catch (e) { }
  if (r.status === 200 && doc && typeof doc.token === 'string') return doc.token;
  throw new Error('no token for profile ' + pid + ': ' + r.status + ' ' + r.body.slice(0, 200));
}

const opened = [];

/* One page's socket, resolved once welcomed. Keeps its last roster and the
   sdp and ice it was sent. */
async function page(s, pid) {
  const token = await joinToken(s, pid);
  return new Promise((ok) => {
    const ws = new WebSocket('ws://127.0.0.1:' + s.port + '/', ['thornswood', token]);
    opened.push(ws);
    const me = { pid: pid, ws: ws, open: false, welcomed: false, closed: false, peer: 0,
                 roster: null, rosters: 0, sdp: [], ice: [] };
    const late = setTimeout(() => ok(me), BOUND_MS);
    ws.onopen = () => { me.open = true; ws.send(JSON.stringify({ t: 'join', profileId: pid, name: 'Person ' + pid })); };
    ws.onmessage = (ev) => {
      let m = null;
      try { m = JSON.parse(String(ev.data)); } catch (e) { return; }
      if (m.t === 'welcome') { me.welcomed = true; me.peer = m.peer; clearTimeout(late); ok(me); }
      if (m.t === 'peers') { me.roster = m.peers; me.rosters++; }
      if (m.t === 'sdp') me.sdp.push(m);
      if (m.t === 'ice') me.ice.push(m);
    };
    ws.onclose = () => { me.closed = true; clearTimeout(late); ok(me); };
    ws.onerror = () => { if (!me.open) { me.closed = true; clearTimeout(late); ok(me); } };
  });
}

function send(me, msg) { me.ws.send(JSON.stringify(msg)); }

async function until(test) {
  const end = Date.now() + BOUND_MS;
  while (!test() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  return test();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const services = [];
function finish() {
  if (feeding) clearInterval(feeding);
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

/* How many sdp and ice messages from one peer reached another. */
function heard(me, fromPeer) {
  return me.sdp.concat(me.ice).filter((m) => m.from === fromPeer).length;
}
/* Whether a page's last roster names another page. */
function onRoster(me, other) { return !!me.roster && me.roster.some((r) => r.peer === other.peer); }

(async () => {
  const site = await siteThatSaysYes();
  const s = await service(site, 10);
  services.push(s);

  // The speaker, a listener in reach, a listener in another cell, and a
  // listener in the same cell but far past HEAR_UNITS (100 m in units).
  async function world(bCell, bPos, party) {
    await inWorld(s, [
      { pid: 101, pos: [0, 0, 0], cell: 'the inn', party: party },
      { pid: 102, pos: bPos, cell: bCell },
      { pid: 103, pos: [0, 0, 0], cell: 'the mine', party: party },
      { pid: 104, pos: [50000, 0, 0], cell: 'the inn' }
    ]);
  }
  await world('the inn', [50, 0, 0], '');
  const a = await page(s, 101);
  const b = await page(s, 102);
  const c = await page(s, 103);
  const d = await page(s, 104);
  yes('four voice pages are let in', a.welcomed && b.welcomed && c.welcomed && d.welcomed);

  // ------------------------------------------- in reach: on the roster, relayed
  yes('two people in one cell within reach are on each other\'s roster',
      await until(() => onRoster(a, b) && onRoster(b, a)));
  send(b, { t: 'sdp', to: a.peer, sdp: { type: 'offer', sdp: 'an offer from b' } });
  yes('  and their signalling is relayed', await until(() => heard(a, b.peer) === 1), 'heard ' + heard(a, b.peer));

  // ---------------------------------- out of reach: off the roster, refused
  yes('a page in another cell is on nobody\'s roster there, nor they on its',
      !onRoster(a, c) && !onRoster(b, c) && !onRoster(c, a) && !onRoster(c, b));
  yes('a page in the same cell past HEAR_UNITS is not either', !onRoster(a, d) && !onRoster(d, a));
  send(c, { t: 'sdp', to: a.peer, sdp: { type: 'offer', sdp: 'an offer from c' } });
  send(c, { t: 'ice', to: a.peer, candidate: { candidate: 'a candidate from c' } });
  send(d, { t: 'sdp', to: a.peer, sdp: { type: 'offer', sdp: 'an offer from d' } });
  send(d, { t: 'ice', to: a.peer, candidate: { candidate: 'a candidate from d' } });
  await sleep(400);
  yes('their offers and candidates to the speaker are not relayed',
      heard(a, c.peer) === 0 && heard(a, d.peer) === 0, 'heard ' + heard(a, c.peer) + ' from c, ' + heard(a, d.peer) + ' from d');

  // -------------------------------------------------- a party is in reach
  await world('the inn', [50, 0, 0], 'the same party');
  yes('a party member is on the roster wherever they stand',
      await until(() => onRoster(a, c) && onRoster(c, a)));
  send(c, { t: 'sdp', to: a.peer, sdp: { type: 'offer', sdp: 'an offer from c, now a party member' } });
  yes('  and relayed', await until(() => heard(a, c.peer) === 1), 'heard ' + heard(a, c.peer));

  // ------------------------------- walking out: off the roster, nothing relayed
  await world('the mine', [0, 0, 0], '');
  yes('walking out of reach takes each off the other\'s roster, which closes the connection on both pages',
      await until(() => !onRoster(a, b) && !onRoster(b, a) && !onRoster(a, c)));
  const before = heard(a, b.peer);
  send(b, { t: 'sdp', to: a.peer, sdp: { type: 'offer', sdp: 'an offer from b after walking away' } });
  send(b, { t: 'ice', to: a.peer, candidate: { candidate: 'a candidate from b after walking away' } });
  await sleep(400);
  yes('  and no more signalling between them is relayed', heard(a, b.peer) === before, 'heard ' + (heard(a, b.peer) - before) + ' more');

  // -------------------------------- walking back: on the roster again, relayed
  await world('the inn', [50, 0, 0], '');
  yes('walking back puts each on the other\'s roster again, so the pages connect again',
      await until(() => onRoster(a, b) && onRoster(b, a)));
  send(b, { t: 'sdp', to: a.peer, sdp: { type: 'offer', sdp: 'an offer from b, back in reach' } });
  yes('  and their new offer is relayed', await until(() => heard(a, b.peer) === before + 1), 'heard ' + heard(a, b.peer));

  // --------------------------------------------- both clients follow the roster
  const overlay = fs.readFileSync(path.join(ROOT, 'game', 'ui', 'thornswood-voice.js'), 'utf8');
  const launcher = fs.readFileSync(path.join(ROOT, 'launcher', 'app', 'VoiceSession.cs'), 'utf8');
  yes('the game\'s overlay closes a connection to whoever leaves its roster and opens one to whoever comes on',
      /conns\.forEach\(function \(_, id\) \{ if \(!want\.has\(id\)\) drop\(id\); \}\);/.test(overlay) && /open\(id, p, myPeer < id\);/.test(overlay));
  yes('so does the launcher', /if \(!seen\.Contains\(id\)\) Drop\(id\);/.test(launcher));
})().then(finish, (e) => { fail++; console.log('FAIL  the harness itself: ' + (e && e.stack || e)); finish(); });
