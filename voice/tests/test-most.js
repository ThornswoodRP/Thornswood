// test-most.js
//
// Issues #481 and #3570: the voice service gives so many people a voice
// place at once and no more, and only people in the world hold one.
//
// THORNSWOOD_VOICE_MOST is the most profiles holding a voice place at once:
// on the roster, sent the roster, and let trade signalling. Only a profile the
// game server's position feed has in the world holds one; every socket a join
// token proves is let in for text chat and commands whatever the numbers
// (#3570). This runs voice/voice-server.js in a temp folder on a port the
// system hands out, with the number set to three, joins real websockets with
// real join tokens (asked of the service, which asks a stand-in site that
// says yes), and stands in for the position feed over loopback:
//
//   four people at the menu are all let in, and none holds a place;
//   three of them in the world take the three places, and a second socket
//   for one of them (the launcher's voice page beside the game's chat)
//   shares that person's place;
//   the fourth in the world as well is told once in one chat line that voice
//   is full and text chat still works, is on nobody's roster, and /health
//   counts it;
//   once somebody leaves the world, the fourth takes the place;
//   a person with two sockets keeps their place until both have closed;
//   a copy with no number set gives everybody in the world a place.
//
// Read only. Nothing outside the temp folders is touched.
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const SERVER = process.env.VOICE_SERVER || path.join(__dirname, '..', 'voice-server.js');

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

/* A copy of the service in a folder of its own, up and listening. */
async function service(site, most) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-most-'));
  fs.copyFileSync(SERVER, path.join(dir, 'voice-server.js'));
  fs.copyFileSync(path.join(__dirname, '..', 'headlines.js'), path.join(dir, 'headlines.js'));
  const port = await freePort();
  const env = Object.assign({}, process.env, {
    THORNSWOOD_VOICE_PORT: String(port),
    THORNSWOOD_VOICE_BIND: '127.0.0.1',
    THORNSWOOD_SITE: site,
    THORNSWOOD_CHAT_DIR: path.join(dir, 'chat')
  });
  delete env.THORNSWOOD_VOICE_MOST;
  if (most !== null) env.THORNSWOOD_VOICE_MOST = String(most);
  const srv = spawn(process.execPath, ['voice-server.js'], { cwd: dir, env: env });
  const s = { dir: dir, port: port, proc: srv, log: '' };
  srv.stdout.on('data', (d) => { s.log += d; });
  srv.stderr.on('data', (d) => { s.log += d; });
  await listening(srv, port);
  return s;
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

async function health(s) {
  const r = await fetch('http://127.0.0.1:' + s.port + '/health');
  return await r.json();
}

function joinToken(s, pid) {
  return new Promise((ok, bad) => {
    const body = JSON.stringify({ profileId: pid, ticket: 'a ticket the stand-in site takes' });
    const req = http.request({ host: '127.0.0.1', port: s.port, path: '/token', method: 'POST', agent: false,
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
/*
  One page's socket. Resolves once it is welcomed, closed or refused at the
  handshake, whichever comes first, with what it was sent then and after:
  { welcomed, closed, refused, code, reason, chat, roster (the last one),
  rosters (how many), ws }. A refused
  handshake is told by error before open, since Node 22's WebSocket never
  follows it with close (#2818).
*/
async function page(s, pid) {
  const token = await joinToken(s, pid);
  return new Promise((ok) => {
    const ws = new WebSocket('ws://127.0.0.1:' + s.port + '/', ['thornswood', token]);
    opened.push(ws);
    const me = { pid: pid, ws: ws, token: token, open: false, welcomed: false, closed: false, refused: false,
                 code: 0, reason: '', chat: [], roster: null, rosters: 0 };
    const late = setTimeout(() => ok(me), BOUND_MS);
    ws.onopen = () => { me.open = true; ws.send(JSON.stringify({ t: 'join', profileId: pid, name: 'Person ' + pid })); };
    ws.onmessage = (ev) => {
      let m = null;
      try { m = JSON.parse(String(ev.data)); } catch (e) { return; }
      if (m.t === 'welcome') { me.welcomed = true; clearTimeout(late); ok(me); }
      if (m.t === 'chat') { me.chat.push(m); }
      if (m.t === 'peers') { me.roster = m.peers || []; me.rosters++; }
    };
    ws.onclose = (ev) => { me.closed = true; me.code = ev.code; me.reason = ev.reason; clearTimeout(late); ok(me); };
    ws.onerror = () => { if (!me.open) { me.refused = true; clearTimeout(late); ok(me); } };
  });
}

function closed(me) {
  return new Promise((ok) => {
    if (me.closed || me.refused) { ok(); return; }
    const prev = me.ws.onclose;
    me.ws.onclose = (ev) => { if (prev) prev(ev); ok(); };
    me.ws.close();
  });
}

/* Asks /health until test(h) holds or BOUND_MS passes; the last answer. */
async function healthUntil(s, test) {
  const end = Date.now() + BOUND_MS;
  let h = await health(s);
  while (!test(h) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 50));
    h = await health(s);
  }
  return h;
}

/* The gamemode's position feed, stood in for: these profiles are in the
   world, each in a cell of their own. The whole list each time, as the
   gamemode sends it. */
async function inWorld(s, pids) {
  const body = JSON.stringify({ who: pids.map((pid) => ({ profileId: pid, pos: [0, 0, 0], angleZ: 0,
                                                          cell: 'cell ' + pid, name: 'Person ' + pid })) });
  const r = await fetch('http://127.0.0.1:' + s.port + '/positions', { method: 'POST', body: body });
  if (r.status !== 204) throw new Error('/positions answered ' + r.status);
}

/* The profiles on the last roster a page was sent, each once. */
function on(me) {
  return Array.from(new Set((me.roster || []).map((r) => Number(r.profileId)))).sort((a, b) => a - b).join(',');
}

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

(async () => {
  const site = await siteThatSaysYes();

  // ------------------------------------------------------------ three, set
  const s = await service(site, 3);
  services.push(s);
  let h = await health(s);
  yes('/health says the most it takes and how many hold a place', h.most === 3 && h.people === 0 && h.refusedFull === 0,
      JSON.stringify({ most: h.most, people: h.people, refusedFull: h.refusedFull }));

  const a = await page(s, 101);
  const b = await page(s, 102);
  const c = await page(s, 103);
  const d = await page(s, 104);
  yes('four people at the menu are let in, one more than the number', a.welcomed && b.welcomed && c.welcomed && d.welcomed);
  h = await health(s);
  yes('and none of them holds a voice place or is sent a roster', h.people === 0 && h.peers === 4 &&
      [a, b, c, d].every((p) => p.rosters === 0), JSON.stringify({ people: h.people, peers: h.peers }));

  await inWorld(s, [101, 102, 103]);
  await until(() => on(a) === '101,102,103' && on(c) === '101,102,103');
  yes('three in the world take the three places and are on each other\'s roster', on(a) === '101,102,103' && on(c) === '101,102,103',
      on(a) + ' / ' + on(c));
  yes('the one still at the menu is sent no roster', d.rosters === 0);
  const b2 = await page(s, 102);
  await until(() => on(b2) === '101,102,103');
  yes('a second socket for somebody with a place shares it, and is sent the roster', b2.welcomed && on(b2) === '101,102,103', on(b2));
  h = await health(s);
  yes('so three hold a place, on four sockets, and five sockets in all', h.people === 3 && h.peers === 5,
      'people ' + h.people + ', peers ' + h.peers);

  // ----------------------------------------------------------- the fourth
  await inWorld(s, [101, 102, 103, 104]);
  await until(() => d.chat.length > 0);
  const said = d.chat.map((m) => String(m.text)).join(' | ');
  yes('a fourth in the world is told once, in one chat line from the service, that voice is full',
      d.chat.length === 1 && !Number(d.chat[0].from) && /Voice is full: 3 people are using it/.test(said), said);
  yes('and that text chat still works and voice comes by itself', /Text chat still works/.test(said) && /comes on by itself/.test(said), said);
  yes('the line has no em dash in it', said.indexOf('\u2014') < 0);
  yes('their socket stays open', !d.closed, 'closed with ' + d.code);
  h = await health(s);
  yes('/health counts the one kept off voice, and still three hold a place', h.refusedFull === 1 && h.people === 3,
      'refusedFull ' + h.refusedFull + ', people ' + h.people);
  yes('the log says so', /\[voice\] full: 3 people hold voice/.test(s.log), s.log.slice(-400));
  yes('nobody was sent a roster with the fourth on it, and the fourth was sent none',
      [a, b, c, b2].every((p) => on(p).split(',').indexOf('104') < 0) && d.rosters === 0);

  // ---------------------------------------------------- somebody leaves
  await inWorld(s, [101, 102, 104]);
  await until(() => on(d) === '101,102,104');
  yes('when somebody leaves the world, the fourth takes the place', on(d) === '101,102,104' && on(a) === '101,102,104',
      on(d) + ' / ' + on(a));
  yes('and the one who left is sent an empty roster, so their page lets go', c.roster && c.roster.length === 0,
      JSON.stringify(c.roster));

  // -------------------------------------------- two sockets, let go of once
  await inWorld(s, [101, 102, 103, 104]);
  await closed(b);
  h = await healthUntil(s, (x) => x.peers === 4);
  yes('one of two sockets closing keeps that person\'s place', h.people === 3 && h.peers === 4 && on(b2) === '101,102,104',
      'people ' + h.people + ', peers ' + h.peers + ', roster ' + on(b2));
  yes('so the one back in the world is still kept off voice', on(c) === '' && on(a).split(',').indexOf('103') < 0, on(c));
  await closed(b2);
  await until(() => on(c) === '101,103,104');
  h = await health(s);
  yes('the place goes when their last socket closes, and the one waiting for it takes it', on(c) === '101,103,104' && h.people === 3,
      on(c) + ', people ' + h.people);

  // ----------------------------------------------------- no number at all
  const open = await service(site, null);
  services.push(open);
  h = await health(open);
  yes('a copy with no number set says 0, no cap', h.most === 0, 'most ' + h.most);
  const many = [];
  for (let pid = 201; pid <= 206; pid++) many.push(await page(open, pid));
  await inWorld(open, [201, 202, 203, 204, 205, 206]);
  await until(() => many.every((p) => on(p) === '201,202,203,204,205,206'));
  yes('and gives everybody in the world a place, six people where the other took three',
      many.every((p) => p.welcomed && on(p) === '201,202,203,204,205,206'), many.map(on).join(' / '));

  const junk = await service(site, 'many');
  services.push(junk);
  h = await health(junk);
  yes('a number that is not a whole number above zero is no cap, said on /health as 0', h.most === 0, 'most ' + h.most);

  finish();
})().catch((err) => {
  fail++;
  console.log('FAIL  the harness stopped: ' + (err && err.stack || err));
  finish();
});
