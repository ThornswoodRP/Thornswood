// test-cull.js
//
// Entry 282: who the voice service tells about whom.
//
// Every peer used to be sent the whole position snapshot five times a second:
// every person's coordinates, facing, cell and name, wherever they were. That
// told anybody holding a socket where everybody in the world was standing,
// and it grew with the square of the room. The entry measured it at 1.5 MB a
// second at fifty people and 24.5 MB a second at two hundred, 369 GB over an
// evening, against an 8 TB monthly cap and a box that measured 93 Mbit/s.
//
// This drives both halves for real, with no game:
//
//   the gamemode  the voice feed block out of game/gamemode.js runs against a
//                 stand-in mp, with the real social block keeping the parties,
//                 and what it would POST is captured. Each row has to carry
//                 the person's party, because the service cannot know it.
//   the service   voice/voice-server.js runs in a temp folder on a spare
//                 port, is fed that body, and two hundred real websockets
//                 join as the two hundred people. What each one is sent on
//                 the next tick is what is checked, and its bytes are counted.
//
// The rules checked are the clients' own, read out of their source rather
// than typed here: another cell is silence on every client, and the longest
// reach is whichever range table reaches furthest. Culling tighter than that
// cuts people off mid sentence, which is the trap the entry names.
//
// VOICE_SERVER and GM point it at other copies of the two files, which is how
// it was shown to fail on the code before the change.
//
// Read only. Nothing outside the temp folder is touched.
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const SERVER = process.env.VOICE_SERVER || path.join(__dirname, '..', 'voice-server.js');
const GM = process.env.GM || path.join(__dirname, '..', '..', 'game', 'gamemode.js');
// Set by ready(), from the system. It was a fixed 7911 (#1703).
let PORT = 0;
const UNITS_PER_METRE = 70;
const CR = String.fromCharCode(13);

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function read(p) { return fs.readFileSync(p, 'utf8').split(CR).join(''); }

// ------------------------------------------- how far the clients can hear
/*
  Every table a client applies, read from the file the client runs. If a
  range is ever raised past what the service keeps, the probe pair below
  stops hearing each other and this fails, which is the point.
*/
const reaches = [];
{
  const overlay = read(path.join(__dirname, '..', '..', 'game', 'ui', 'thornswood-voice.js'));
  const modes = /var MODES = \{([\s\S]*?)\};/.exec(overlay);
  const got = modes ? (modes[1].match(/max:\s*[\d.]+/g) || []).map(s => Number(s.split(':')[1])) : [];
  yes('the overlay range table is where it was (' + got.join(', ') + ' m)', got.length === 3);
  reaches.push(...got);

  // The launcher's voice, a page until #4823 and C# since (VoiceSession.cs).
  const host = read(path.join(__dirname, '..', '..', 'launcher', 'app', 'VoiceSession.cs'));
  const range = /static readonly Dictionary<string, Range> RANGE = new Dictionary<string, Range>\s*\{([\s\S]*?)\};/.exec(host);
  const quiet = range ? (range[1].match(/Quiet = [\d.]+/g) || []).map(s => Number(s.split('=')[1])) : [];
  yes('the launcher\'s voice range table is where it was (' + quiet.join(', ') + ' m)', quiet.length === 3);
  reaches.push(...quiet);
  // The service's own browser page was a third client until it went (#1822).
}
const REACH = Math.max(...reaches);          // metres, the furthest any client hears
const REACH_UNITS = REACH * UNITS_PER_METRE;
console.log('      the furthest any client hears is ' + REACH + ' m, ' + REACH_UNITS + ' units');

// ---------------------------------------------------------- two hundred
/*
  Ten cells. The first is the open world, where a descriptor covers the whole
  map and distance is what separates people. The other nine are interiors,
  small enough that everybody in one is in reach of everybody else.
*/
const CELLS = ['3c:Skyrim.esm', '1605e:Skyrim.esm', '16a0b:Skyrim.esm', '16bd9:Skyrim.esm',
               '13a8e:Skyrim.esm', '1a6ec:Skyrim.esm', '133c6:Skyrim.esm', '16779:Skyrim.esm',
               '15fc5:Skyrim.esm', '1c3b7:Skyrim.esm'];
const SPREAD = [120000, 4000, 4000, 4000, 4000, 4000, 4000, 4000, 4000, 4000];

let seed = 282;
function rand() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }

const people = [];          // { actor, pid, name, cell, pos, angle }
for (let c = 0; c < CELLS.length; c++) {
  for (let k = 0; k < 20; k++) {
    const pid = 1000 + c * 20 + k;
    people.push({
      actor: 0xff000000 + pid, pid: pid, name: 'Person ' + pid, cell: CELLS[c],
      pos: [(rand() - 0.5) * SPREAD[c], (rand() - 0.5) * SPREAD[c], (rand() - 0.5) * 600],
      angle: [0, 0, Math.round(rand() * 360)]
    });
  }
}
const byPid = {};
for (const p of people) { byPid[p.pid] = p; }

/*
  Two pairs in the open world, well away from everybody else. One stands just
  inside the furthest any client hears and has to hear the other. One stands
  150 m apart and has to be told nothing about the other.
*/
byPid[1016].pos = [300000, 300000, 0];
byPid[1017].pos = [300000 + REACH_UNITS - 1, 300000, 0];
byPid[1018].pos = [-300000, -300000, 0];
byPid[1019].pos = [-300000 + 150 * UNITS_PER_METRE, -300000, 0];

// And two in the same party in the open world, 400 m apart.
byPid[1014].pos = [0, -200000, 0];
byPid[1015].pos = [400 * UNITS_PER_METRE, -200000, 0];

// ----------------------------------------------- the gamemode's own blocks
const src = read(GM);
function block(start, end) {
  const a = src.indexOf(start), b = src.indexOf(end);
  return (a === -1 || b === -1) ? '' : src.slice(a, b);
}
const social = block('// ==== thornswood social:', '// ==== end thornswood social ====');
const feed = block('// ==== thornswood voice feed', '// ==== end thornswood voice feed ====');
yes('the social block is in the gamemode', !!social);
yes('the voice feed block is in the gamemode', !!feed);

const g = {};
const store = {};
for (const p of people) { store[p.actor] = p; }
const mp = {
  makeProperty: function () { },
  get: function (id, key) {
    if (id === 0 && key === 'onlinePlayers') { return people.map(p => p.actor); }
    const r = store[id];
    if (!r) { return undefined; }
    if (key === 'profileId') { return r.pid; }
    if (key === 'appearance') { return { name: r.name }; }
    if (key === 'worldOrCellDesc') { return r.cell; }
    if (key === 'pos') { return r.pos; }
    if (key === 'angle') { return r.angle; }
    if (key === 'inventory') { return { entries: [] }; }
    return r[key];
  },
  set: function (id, key, v) { if (store[id]) { store[id][key] = v; } }
};

new Function(
  'globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
  'guard', 'say', 'notify', 'Math', 'Number', 'String', 'Object', 'Array',
  'JSON', 'isFinite', 'parseInt', social)(
  g, mp, Date, { log: () => { } },
  () => 0, () => { }, (n, f) => f, () => { }, () => { },
  Math, Number, String, Object, Array, JSON, isFinite, parseInt);
const soc = g.__thornswoodSocial;
yes('the social block made its parties', !!(soc && soc.joinParty));

/*
  Parties as the game makes them. One spread over three cells, the case the
  party strip exists for, and one of two people 400 m apart in the open world.
*/
const PARTIES = [[1020, 1100, 1180], [1014, 1015]];
for (const members of PARTIES) {
  for (let i = 1; i < members.length; i++) { soc.joinParty(members[0], members[i]); }
}
const partyOf = {};
for (const members of PARTIES) { for (const m of members) { partyOf[m] = members; } }

/* The feed block, with its timers and its HTTP call caught rather than run. */
const timers = [];
let posted = null;
const fakeHttp = {
  request: function () {
    return {
      on: function () { }, setTimeout: function () { },
      end: function (body) { posted = body; }
    };
  }
};
function fakeRequire(name) {
  if (name === 'http') { return fakeHttp; }
  if (name === 'fs') {
    return { readFileSync: function () { throw new Error('no file here'); }, writeFileSync: function () { } };
  }
  return require(name);
}
// The gamemode wraps the feed's timer in guard() (a throw is logged and the
// timer lives on); here guard hands the function straight back, so a throw
// fails this harness instead of being swallowed.
new Function('globalThis', 'mp', 'require', 'setInterval', 'clearInterval', 'console',
             'voicePort', 'Buffer', 'guard', feed)(
  g, mp, fakeRequire, (fn, ms) => { timers.push({ fn: fn, ms: ms }); return timers.length; },
  () => { }, { log: () => { } }, () => PORT, Buffer, (n, f) => f);
const tick = timers.filter(t => t.ms === 200)[0];
yes('the feed runs five times a second', !!tick);
if (tick) { tick.fn(); }
let rows = [];
try { rows = JSON.parse(posted).who || []; } catch (e) { rows = []; }
yes('the feed pushed all two hundred people', rows.length === 200);

const rowOf = {};
for (const r of rows) { rowOf[r.profileId] = r; }
yes('each row carries the party its person is in',
    PARTIES.every(ms => ms.every(m => rowOf[m] && rowOf[m].party && rowOf[m].party === rowOf[ms[0]].party)));
yes('the two parties are told apart', !!rowOf[1020] && !!rowOf[1014] && rowOf[1020].party !== rowOf[1014].party);
yes('and somebody in no party carries none',
    people.every(p => partyOf[p.pid] || (rowOf[p.pid] && rowOf[p.pid].party === '')));

// --------------------------------------------------------------- service
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-cull-'));
fs.copyFileSync(SERVER, path.join(dir, 'voice-server.js'));
fs.copyFileSync(path.join(__dirname, '..', 'headlines.js'), path.join(dir, 'headlines.js'));
// Every connection proves itself since #1303, so this harness signs its own
// join tokens with a key it puts beside its copy of the service. One token
// opens one connection and goes with the handshake since #1337 and #1322.
const KEY = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dir, 'token-key.txt'), KEY);
function tokenFor(pid) {
  const body = 'v2.' + pid + '.' + Date.now() + '.' + crypto.randomBytes(16).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return body + '.' + crypto.createHmac('sha256', KEY).update(body).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
  try { srv.kill(); } catch (e) { }
  setTimeout(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  }, 300).unref();
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
  PORT = await freePort('0.0.0.0');
  srv = spawn(process.execPath, ['voice-server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_VOICE_PORT: String(PORT),
      THORNSWOOD_SITE: '',
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

async function feedPositions() {
  const r = await fetch('http://127.0.0.1:' + PORT + '/positions', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: posted
  });
  return r.status;
}

/*
  One person's socket. 'peers' is skipped unread: two hundred joins announce
  the roster to everybody already in, which is its own entry and not this
  one, and parsing it would only make the harness slow.
*/
function join(pid, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT + '/', ['thornswood', tokenFor(pid)]);
    const me = { pid: pid, ws: ws, welcome: false, last: null, lastText: '' };
    sockets.push(ws);
    const late = setTimeout(() => reject(new Error('no welcome for ' + pid + ' in twenty seconds')), 20000);
    ws.onopen = () => { ws.send(JSON.stringify({ t: 'join', profileId: pid, name: name })); };
    ws.onmessage = (ev) => {
      const text = String(ev.data);
      if (text.startsWith('{"t":"peers"')) { return; }
      let m = null;
      try { m = JSON.parse(text); } catch (e) { return; }
      if (m.t === 'welcome') { me.welcome = true; clearTimeout(late); resolve(me); return; }
      /* The whole view first, then only what moved (issue #482), kept the
         way every client keeps it, so what is checked below is what a
         client would hold. */
      if (m.t === 'pos') { me.last = { at: m.at, who: m.who || {} }; me.lastText = text; }
      if (m.t === 'moved' && me.last) {
        for (const k of Object.keys(m.who || {})) { me.last.who[k] = m.who[k]; }
        for (const id of (m.gone || [])) { delete me.last.who[id]; }
        me.last.at = m.at;
      }
    };
    ws.onerror = () => { clearTimeout(late); reject(new Error('socket for ' + pid + ' failed')); };
  });
}

/* A text frame's bytes on the wire: the header the service writes, then the body. */
function frameBytes(text) {
  const n = Buffer.byteLength(text);
  return n + (n < 126 ? 2 : (n < 65536 ? 4 : 10));
}

(async () => {
  const health = await ready();
  console.log('      the service under test answers build ' + health.build);

  yes('the service takes the feed', await feedPositions() === 204);
  // Kept fed, because a row nobody has refreshed for three seconds goes stale.
  feeder = setInterval(() => { feedPositions().catch(() => { }); }, 500);

  const started = Date.now();
  const joined = await Promise.all(people.map(p => join(p.pid, p.name)));
  // And one socket for somebody who is not in the game at all.
  const outsider = await join(9999, 'Nobody');
  console.log('      two hundred and one joined in ' + (Date.now() - started) + ' ms');

  /* Everybody's whole view, and a tick after it, so any row that moved on
     the way in has reached them. Nobody here moves, so after the whole view
     the service sends nothing more, which is the point of issue #482. */
  for (let i = 0; i < 60; i++) {
    await wait(100);
    if (joined.every(j => j.last) && outsider.last) { break; }
  }
  await wait(400);
  yes('every one of them was sent their view', joined.every(j => j.last) && !!outsider.last);

  let otherCell = 0, missingNear = 0, missingParty = 0, farKept = 0, noSelf = 0, leaked = 0;
  let rowsTotal = 0, rowsMost = 0, bytesAfter = 0;
  for (const j of joined) {
    const who = (j.last && j.last.who) || {};
    const me = byPid[j.pid];
    const mates = partyOf[j.pid] || [];
    const keys = Object.keys(who);
    rowsTotal += keys.length;
    rowsMost = Math.max(rowsMost, keys.length);
    // What a whole view of it costs, the first tick after a join.
    bytesAfter += frameBytes(JSON.stringify({ t: 'pos', at: j.last.at, who: who }));
    if (!who[j.pid]) { noSelf++; }
    for (const k of keys) {
      const them = byPid[k];
      if (!them) { continue; }
      if ('party' in who[k]) { leaked++; }
      const mate = mates.indexOf(Number(k)) !== -1;
      if (them.cell !== me.cell && !mate) { otherCell++; }
      if (them.cell === me.cell && !mate && Number(k) !== j.pid) {
        const dx = them.pos[0] - me.pos[0], dy = them.pos[1] - me.pos[1], dz = them.pos[2] - me.pos[2];
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) > 150 * UNITS_PER_METRE) { farKept++; }
      }
    }
    for (const them of people) {
      if (them.cell !== me.cell || them.pid === j.pid) { continue; }
      const dx = them.pos[0] - me.pos[0], dy = them.pos[1] - me.pos[1], dz = them.pos[2] - me.pos[2];
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= REACH_UNITS && !who[them.pid]) { missingNear++; }
    }
    for (const m of mates) { if (!who[m]) { missingParty++; } }
  }

  yes('everybody is told where they are themselves', noSelf === 0);
  yes('nobody is told about anybody in another cell unless they share a party (' + otherCell + ' rows)',
      otherCell === 0);
  yes('never tighter than a client: everybody within ' + REACH + ' m in the same cell is there (' +
      missingNear + ' missing)', missingNear === 0);
  yes('nobody is told about somebody in the same cell 150 m away who is not in their party (' +
      farKept + ' rows)', farKept === 0);
  yes('a party is told about each other wherever they are (' + missingParty + ' missing)', missingParty === 0);
  yes('the party id is used to choose and never sent on (' + leaked + ' rows)', leaked === 0);

  const probeIn = byPid[1016], probeOut = byPid[1018];
  const seenIn = joined.filter(j => j.pid === 1016)[0];
  const seenOut = joined.filter(j => j.pid === 1018)[0];
  yes('two people ' + REACH + ' m apart in the open world hear each other',
      !!(seenIn && seenIn.last.who[1017]) && !!probeIn);
  yes('two people 150 m apart in the open world are told nothing about each other',
      !!(seenOut && !seenOut.last.who[1019]) && !!probeOut);
  const pair = joined.filter(j => j.pid === 1014)[0];
  yes('two in a party 400 m apart still see each other for the party strip',
      !!(pair && pair.last.who[1015]));

  const outWho = (outsider.last && outsider.last.who) || null;
  yes('a socket with no row in the game is told about nobody',
      !!outWho && Object.keys(outWho).length === 0);

  // ----------------------------------------------------------- the bill
  /*
    Before is what the old tick sent: the whole snapshot, the same four fields
    per row, to every peer. It is worked out from the rows the service holds,
    so on the old code it matches what this measures on the wire.
  */
  const whole = {};
  for (const r of rows) { whole[r.profileId] = { pos: r.pos, angleZ: r.angleZ, cell: r.cell, name: r.name }; }
  const wholeText = JSON.stringify({ t: 'pos', at: Date.now(), who: whole });
  const bytesBefore = frameBytes(wholeText) * joined.length;
  const perRow = Math.round(Buffer.byteLength(JSON.stringify(whole)) / rows.length);
  const mbs = (b) => (b * 5 / 1e6).toFixed(2);
  const gbEvening = (b) => Math.round(b * 5 * 4 * 3600 / 1e9);

  console.log('');
  console.log('      two hundred people across ten cells, one tick, about ' + perRow + ' bytes a row:');
  console.log('        whole snapshot to everybody: ' + rows.length + ' rows each, ' + bytesBefore +
              ' bytes a tick, ' + mbs(bytesBefore) + ' MB/s, ' + gbEvening(bytesBefore) + ' GB over four hours');
  console.log('        culled: ' + (rowsTotal / joined.length).toFixed(1) + ' rows each on average, ' +
              rowsMost + ' at most, ' + bytesAfter + ' bytes a tick, ' + mbs(bytesAfter) + ' MB/s, ' +
              gbEvening(bytesAfter) + ' GB over four hours');
  console.log('');

  yes('each person is sent a handful of rows rather than all two hundred',
      rowsTotal / joined.length <= 25 && rowsMost < 50);
  yes('a tick costs under a fifth of what it did', bytesAfter * 5 < bytesBefore);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  done(fail ? 1 : 0);
})().catch((e) => {
  console.log('FAIL  ' + (e && e.message));
  fail++;
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  done(1);
});
