// test-5516-voice-reach.js
//
// Issue #5516: voice range is only applied by the listener's page.
//
// voice/voice-server.js limits only the position feed by distance (viewsOf,
// HEAR_UNITS): the roster lists every voice connection, and the sdp/ice relay
// passed signalling between any two voice connections wherever they stood, so
// every page built a connection to everybody on the roster and a changed page
// that ignores the gain could hear anyone on the server, whispers included.
//
// This runs voice/voice-server.js in a temp folder on a port the system hands
// out, joins real websockets with real join tokens (asked of the service,
// which asks a stand-in site that says yes), and stands in for the gamemode's
// position feed over loopback:
//
//   two people in one cell within HEAR_UNITS have their signalling relayed;
//   a page in another cell cannot open a connection to the speaker;
//   a page in the same cell but past HEAR_UNITS cannot either;
//   a party member is relayed wherever they stand;
//   when reach ends, the relay drops the pair and the listener's page is told
//     the speaker left its view (the moved tick's gone), which is what closes
//     the connection on an honest page.
//
// It fails on the code before #5516, where the far and other-cell offers were
// relayed. Read only. Nothing outside the temp folder is touched.
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
    const gone = (code) => end(new Error('the voice service stopped (exit ' + code + ') before it was listening. It printed:\n' + out));
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

/* The gamemode's position feed, with a say over cell, distance and party. */
async function inWorld(s, rows) {
  const who = rows.map((r) => ({ profileId: r.pid, actor: 0x14000 + r.pid, pos: r.pos, angleZ: 0,
                                 cell: r.cell, name: 'Person ' + r.pid, party: r.party || '' }));
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

/* One page's socket, resolved once welcomed. Collects sdp/ice and the moved
   ticks, which is what the relay and the view drop come through as. */
async function page(s, pid) {
  const token = await joinToken(s, pid);
  return new Promise((ok) => {
    const ws = new WebSocket('ws://127.0.0.1:' + s.port + '/', ['thornswood', token]);
    opened.push(ws);
    const me = { pid: pid, ws: ws, open: false, welcomed: false, closed: false, code: 0, peer: 0,
                 sdp: [], ice: [], gone: [] };
    const late = setTimeout(() => ok(me), BOUND_MS);
    ws.onopen = () => { me.open = true; ws.send(JSON.stringify({ t: 'join', profileId: pid, name: 'Person ' + pid })); };
    ws.onmessage = (ev) => {
      let m = null;
      try { m = JSON.parse(String(ev.data)); } catch (e) { return; }
      if (m.t === 'welcome') { me.welcomed = true; me.peer = m.peer; clearTimeout(late); ok(me); }
      if (m.t === 'sdp') me.sdp.push(m);
      if (m.t === 'ice') me.ice.push(m);
      if (m.t === 'moved' && Array.isArray(m.gone)) me.gone.push(...m.gone);
    };
    ws.onclose = (ev) => { me.closed = true; me.code = ev.code; clearTimeout(late); ok(me); };
    ws.onerror = () => { if (!me.open) { me.closed = true; clearTimeout(late); ok(me); } };
  });
}

function send(me, msg) { me.ws.send(JSON.stringify(msg)); }

async function until(test) {
  const end = Date.now() + BOUND_MS;
  while (!test() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  return test();
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

/* How many sdp/ice messages from one peer reached another. */
function heard(me, fromPeer) {
  return me.sdp.concat(me.ice).filter((m) => m.from === fromPeer).length;
}

(async () => {
  const site = await siteThatSaysYes();
  const s = await service(site, 10);
  services.push(s);

  // The speaker, a listener in reach, a listener in another cell, and a
  // listener in the same cell but far past HEAR_UNITS (100 m in units).
  const a = await page(s, 101);
  const b = await page(s, 102);
  const c = await page(s, 103);
  const d = await page(s, 104);
  yes('four voice pages are let in', a.welcomed && b.welcomed && c.welcomed && d.welcomed);

  async function world(bCell, bPos, dCell, dPos, party) {
    await inWorld(s, [
      { pid: 101, pos: [0, 0, 0], cell: 'the inn', party: party },
      { pid: 102, pos: bPos, cell: bCell },
      { pid: 103, pos: [0, 0, 0], cell: 'the mine', party: party },
      { pid: 104, pos: dPos, cell: dCell }
    ]);
  }
  await world('the inn', [50, 0, 0], 'the inn', [50000, 0, 0], '');
  // let the first position tick land
  await until(() => a.sdp.length + a.ice.length >= 0 && true);

  // ------------------------------------------- in reach: the relay works
  send(b, { t: 'sdp', to: a.peer, sdp: { type: 'offer', sdp: 'an offer from b' } });
  yes('signalling between two people in one cell within reach is relayed',
      await until(() => heard(a, b.peer) === 1), 'heard ' + heard(a, b.peer));

  // ----------------------------------- out of reach: the relay refuses
  send(c, { t: 'sdp', to: a.peer, sdp: { type: 'offer', sdp: 'an offer from c' } });
  await new Promise((r) => setTimeout(r, 400));
  yes('a page in another cell cannot open a connection to the speaker',
      heard(a, c.peer) === 0, 'heard ' + heard(a, c.peer));

  send(d, { t: 'sdp', to: a.peer, sdp: { type: 'offer', sdp: 'an offer from d' } });
  await new Promise((r) => setTimeout(r, 400));
  yes('a page in the same cell but past HEAR_UNITS cannot either',
      heard(a, d.peer) === 0, 'heard ' + heard(a, d.peer));

  // ---------------------------------------------- ice follows the same gate
  send(c, { t: 'ice', to: a.peer, candidate: { candidate: 'a candidate from c' } });
  await new Promise((r) => setTimeout(r, 400));
  yes('ice candidates from out of reach are not relayed either',
      heard(a, c.peer) === 0, 'heard ' + heard(a, c.peer));

  // -------------------------------------------------- a party is in reach
  await world('the mine', [0, 0, 0], 'the inn', [50000, 0, 0], 'the same party');
  send(c, { t: 'sdp', to: a.peer, sdp: { type: 'offer', sdp: 'an offer from c, now a party member' } });
  yes('a party member is relayed wherever they stand',
      await until(() => heard(a, c.peer) === 1), 'heard ' + heard(a, c.peer));
  await world('the inn', [50, 0, 0], 'the inn', [50000, 0, 0], '');

  // ---------------------------- reach ends: the relay drops the connection
  a.sdp.length = 0; a.ice.length = 0; a.gone.length = 0;
  await world('the mine', [0, 0, 0], 'the inn', [50000, 0, 0], '');
  yes('the listener\'s page is told the speaker left its view, which is what closes the connection',
      await until(() => a.gone.includes(b.pid)), 'gone so far: ' + a.gone.join(','));
  send(b, { t: 'sdp', to: a.peer, sdp: { type: 'offer', sdp: 'an offer from b after walking away' } });
  await new Promise((r) => setTimeout(r, 400));
  yes('when reach ends, no more signalling between the pair is relayed',
      heard(a, b.peer) === 0, 'heard ' + heard(a, b.peer));
})().then(finish, (e) => { console.log('' + e); finish(); });
