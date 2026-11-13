/*
  test-1959-relay-keeps-reading.js

      node tests\test-1959-relay-keeps-reading.js

  #1959. Once a launcher holds the audio, the game's voice overlay
  (game\ui\thornswood-voice.js) is in relay mode: it builds no peer
  connection and answers no offer. It still draws the speaking marks and
  hands the party strip (game\ui\thornswood-party.js) its table through
  thornswoodVoice.who(), and both come from the positions, the modes on
  them and the staff silences the service sends down the chat's socket
  (game\ui\thornswood-chat.js). enterRelay used to take the overlay off
  that socket. A page configured before the launcher took the audio then
  heard no position again, and its marks and who() froze where they were.
  A page the launcher reached first went on the socket with relay mode
  already set and kept reading.

  Both orders, against the real service, the chat and the overlay, with a
  stand-in browser as in tests\test-1924-voice-whole-view.js (itself from
  tests\test-1869-voice-negotiation.js). In each order four people share a
  cell: the game's own person, Aela talking 6 metres away, Brynjolf quiet 5
  metres away, and Camilla walking 20 metres off. The launcher takes the
  audio (the plugin pushes its state in, which is how it arrives in the
  game). Then Aela stops, Brynjolf talks, Brynjolf whispers, staff silence
  Brynjolf, and Brynjolf sends the page an offer. After each, the marks and
  who() must follow, no peer connection is built, and both orders must end
  in the same state.

  VOICE_SERVER, VOICE_OVERLAY and VOICE_CHAT point it at other copies,
  which is how it is shown to fail on the code before #1959. Writes only to
  a temp folder, on a loopback port the system hands out.
*/
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const SERVER = process.env.VOICE_SERVER || path.join(REPO, 'voice', 'voice-server.js');
const OVERLAY = process.env.VOICE_OVERLAY || path.join(REPO, 'game', 'ui', 'thornswood-voice.js');
const CHAT = process.env.VOICE_CHAT || path.join(REPO, 'game', 'ui', 'thornswood-chat.js');
const read = (f) => fs.readFileSync(f, 'utf8').split(CR).join('');
const CHAT_SRC = read(CHAT);
const OVERLAY_SRC = read(OVERLAY);

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function until(cond, ms) {
  const from = Date.now();
  while (Date.now() - from < (ms || 5000)) {
    if (cond()) return true;
    await sleep(20);
  }
  return !!cond();
}

// ------------------------------------------------------------ the service --
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-1959-'));
fs.copyFileSync(SERVER, path.join(dir, 'voice-server.js'));
fs.copyFileSync(path.join(path.dirname(SERVER), 'headlines.js'), path.join(dir, 'headlines.js'));
const KEY = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dir, 'token-key.txt'), KEY);
function tokenFor(pid) {
  const b64 = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const body = 'v2.' + pid + '.' + Date.now() + '.' + b64(crypto.randomBytes(16));
  return body + '.' + b64(crypto.createHmac('sha256', KEY).update(body).digest());
}

/* A port of this run's own (#1703), and nothing asked of it until the
   service has said it is listening there. */
function freePort(host) {
  return new Promise((ok, bad) => {
    const s = net.createServer();
    s.on('error', bad);
    s.listen(0, host, () => { const p = s.address().port; s.close(() => ok(p)); });
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
let PORT = 0, BASE = '', srv = null;
async function start() {
  PORT = await freePort('127.0.0.1');
  BASE = 'http://127.0.0.1:' + PORT;
  srv = spawn(process.execPath, ['voice-server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_VOICE_PORT: String(PORT), THORNSWOOD_VOICE_BIND: '127.0.0.1',
      THORNSWOOD_SITE: '', THORNSWOOD_CHAT_DIR: path.join(dir, 'chat'), THORNSWOOD_CHAT_RANGE: '',
    }),
  });
  srv.stdout.on('data', () => { });
  srv.stderr.on('data', () => { });
  await listening(srv, PORT);
}
function post(route, doc) {
  return fetch(BASE + route, { method: 'POST', body: JSON.stringify(doc) }).catch(() => { });
}

// ------------------------------------------------------- the room, by hand --
/* Somebody with a socket of their own, as a launcher holds one. */
const sockets = [];
function person(pid, name) {
  return new Promise((ok, bad) => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT + '/', ['thornswood', tokenFor(pid)]);
    sockets.push(ws);
    const p = { ws: ws, peer: 0, send: (m) => ws.send(JSON.stringify(m)) };
    ws.onopen = () => p.send({ t: 'join', profileId: pid, name: name });
    ws.onmessage = (ev) => {
      let m = null;
      try { m = JSON.parse(ev.data); } catch (e) { }
      if (m && m.t === 'welcome') { p.peer = m.peer; ok(p); }
    };
    ws.onerror = () => bad(new Error('no socket for ' + name));
  });
}

/*
  Where everybody stands, posted as the gamemode posts it, for every room
  the run has set up. A unit is a seventieth of a metre. Aela is 6 metres in
  front, Brynjolf 5 metres to the side, and Camilla walks a unit further
  each post, 20 metres off.
*/
const rooms = [];
let step = 0;
function where() {
  step++;
  const who = [];
  for (const r of rooms) {
    const row = (pid, name, pos) => ({ profileId: pid, name: name, pos: pos, angleZ: 0, cell: r.cell, actor: ACTOR(pid) });
    who.push(row(r.me, 'Gerdur', [0, 0, 0]), row(r.a, 'Aela', [0, 420, 0]),
             row(r.b, 'Brynjolf', [350, 0, 0]), row(r.c, 'Camilla', [-1400 - step, 0, 0]));
  }
  return post('/positions', { who: who });
}
const ACTOR = (pid) => 0x14000 + pid;

// ------------------------------------------------ the browser, stood in for --
function param(v) { return { value: v, setTargetAtTime: function (x) { this.value = x; } }; }
function element() {
  return { style: {}, className: '', innerHTML: '', textContent: '', id: '', setAttribute: () => { }, appendChild: () => { } };
}
const timers = [];
const pageTimers = {
  setTimeout: (f, ms) => { const h = setTimeout(f, ms); timers.push(h); return h; },
  clearTimeout: (h) => clearTimeout(h),
  setInterval: (f, ms) => { const h = setInterval(f, ms); timers.push(h); return h; },
  clearInterval: (h) => clearInterval(h),
};

/*
  The game's page: the chat file, which holds the socket and joins as soon
  as it has a token, and the voice overlay, which gets on it when the voice
  plugin configures it. The microphone opens at once when asked. Peer
  connections are bare and counted: nobody here answers.
*/
function gamePage(pid) {
  const page = { said: [], wire: [], pcs: [], track: null };
  function PC() { this.signalingState = 'stable'; page.pcs.push(this); }
  PC.prototype.addTrack = function () { return {}; };
  PC.prototype.addTransceiver = function () { return {}; };
  PC.prototype.getReceivers = function () { return []; };
  PC.prototype.close = function () { this.closed = true; };
  function node() {
    return { connect: (to) => to, disconnect: () => { }, gain: param(1), positionX: param(0), positionY: param(0),
             positionZ: param(0), setPosition: () => { }, panningModel: '', distanceModel: '', refDistance: 1,
             rolloffFactor: 1 };
  }
  function AudioContext() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = node();
    this.listener = { forwardX: param(0), forwardY: param(0), forwardZ: param(-1), upX: param(0), upY: param(1),
                      upZ: param(0), setOrientation: () => { } };
    this.createGain = node;
    this.createPanner = node;
    this.createMediaStreamSource = node;
    this.resume = () => Promise.resolve();
  }
  const track = { kind: 'audio', enabled: true, label: 'Microphone (test)', stop: function () { this.stopped = true; } };
  page.track = track;
  const stream = { id: 'mic', getAudioTracks: () => [track], getTracks: () => [track] };
  function WebSocketToService(url, protocols) {
    const real = new WebSocket('ws://127.0.0.1:' + PORT + '/', protocols);
    sockets.push(real);
    const self = this;
    self.onopen = self.onmessage = self.onclose = self.onerror = null;
    Object.defineProperty(self, 'readyState', { get: () => real.readyState });
    real.onopen = () => { if (self.onopen) self.onopen({}); };
    real.onmessage = (ev) => {
      let m = null;
      try { m = JSON.parse(ev.data); } catch (e) { }
      if (m) page.wire.push(m);
      if (self.onmessage) self.onmessage({ data: ev.data });
    };
    real.onclose = () => { if (self.onclose) self.onclose({}); };
    real.onerror = () => { if (self.onerror) self.onerror({}); };
    self.send = (d) => real.send(d);
    self.close = () => { try { real.close(); } catch (e) { } };
  }
  const doc = { createElement: () => element(), body: element(), head: element() };
  const box = Object.assign({
    THORNSWOOD: { host: 'thornswood.test', port: 443, profileId: pid, name: 'Gerdur', token: tokenFor(pid),
                  base: 'https://thornswood.test/voice' },
    skyrimPlatform: { sendMessage: (to, line) => page.said.push(to + ': ' + line) },
    document: doc,
    navigator: { mediaDevices: {
      getUserMedia: () => Promise.resolve(stream),
      enumerateDevices: () => Promise.resolve([{ kind: 'audioinput', deviceId: 'default', label: track.label }]),
    } },
    location: { href: 'file:///Data/Platform/UI/index.html' },
    isSecureContext: true,
    AudioContext: AudioContext,
    RTCPeerConnection: PC,
    Audio: function () { this.play = () => Promise.resolve(); this.pause = () => { }; },
    WebSocket: WebSocketToService,
    fetch: () => Promise.reject(new Error('no launcher here')),
    console: { log: (l) => page.said.push('console: ' + l) },
  }, pageTimers);
  box.window = box;
  vm.createContext(box);
  vm.runInContext(CHAT_SRC, box, { filename: 'thornswood-chat.js' });
  vm.runInContext(OVERLAY_SRC, box, { filename: 'thornswood-voice.js' });
  page.box = box;
  page.V = box.thornswoodVoice;
  page.peer = () => Number(box.thornswoodNet.peer()) || 0;
  page.configure = () => page.V.configure({ host: 'thornswood.test', port: 443, profileId: pid, name: 'Gerdur',
                                            pushToTalk: true, microphone: true, micName: '' });
  // The launcher's state, pushed in by the plugin: the route that works
  // everywhere, and the one that switches the page into relay mode.
  page.relay = () => page.V.setLauncherStatus(true, 3, false, 'local');
  page.marks = () => {
    const all = page.said.filter((l) => /^thornswood-front: marks:/.test(l));
    return all.length ? all[all.length - 1].slice('thornswood-front: marks:'.length) : null;
  };
  return page;
}

/* Everything the socket was sent, as a table: the last whole view with every
   change since applied. What a page that kept listening holds. */
function tableFrom(wire) {
  let t = null;
  for (const m of wire) {
    if (m.t === 'pos') { t = Object.assign({}, m.who); }
    if (m.t === 'moved' && t) {
      // A row already held comes as the fields that changed (#5358).
      for (const k of Object.keys(m.who || {})) t[k] = Object.assign({}, t[k] || {}, m.who[k]);
      for (const id of m.gone || []) delete t[id];
    }
  }
  return t;
}
const sameTable = (a, b) => {
  const keys = (o) => Object.keys(o || {}).sort();
  if (JSON.stringify(keys(a)) !== JSON.stringify(keys(b))) return false;
  return keys(a).every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
};
const mark = (pid, mode) => JSON.stringify([{ a: ACTOR(pid), m: mode }]);
function lastRoster(P) {
  const all = P.wire.filter((m) => m.t === 'peers');
  return all.length ? all[all.length - 1] : null;
}

// ----------------------------------------------------------------- an order --
/*
  One run of the room. relayFirst says whether the launcher took the audio
  before the voice plugin configured the overlay, or after.
*/
async function order(n, relayFirst, base, cell) {
  console.log('\n' + n + '. the launcher takes the audio ' + (relayFirst ? 'before' : 'after') + ' the overlay is configured:');
  const r = { me: base + 2, a: base + 11, b: base + 12, c: base + 13, cell: cell };
  rooms.push(r);
  await where();
  const A = await person(r.a, 'Aela');
  const B = await person(r.b, 'Brynjolf');
  A.send({ t: 'talk', on: true });
  const G = gamePage(r.me);
  yes('the game\'s chat socket joins and is sent its whole view',
      await until(() => G.box.thornswoodNet.isUp() && G.wire.some((m) => m.t === 'pos')));

  if (relayFirst) {
    G.relay();
    G.configure();
  } else {
    G.configure();
    yes('before the launcher speaks up the overlay carries voice: a microphone and a connection to each other person',
        await until(() => G.V.state().mic && G.pcs.filter((pc) => !pc.closed).length === 2));
    yes('and Aela\'s speaking mark is drawn', await until(() => G.marks() === mark(r.a, 'local')));
    G.relay();
  }
  const pcsAtRelay = G.pcs.length;
  yes('in relay mode the page holds no microphone and no open connection',
      !G.V.state().mic && G.pcs.every((pc) => pc.closed));
  yes('its own row on the roster says it carries no voice (#1925)',
      await until(() => { const ro = lastRoster(G); return !!ro && ro.peers.some((p) => p.peer === G.peer() && p.voice === false); }));
  yes('Aela, talking 6 metres away, is marked', await until(() => G.marks() === mark(r.a, 'local')));

  // Everything below happens with the launcher holding the audio.
  A.send({ t: 'talk', on: false });
  B.send({ t: 'talk', on: true });
  yes('Aela stops and Brynjolf starts, and the mark moves to Brynjolf',
      await until(() => G.marks() === mark(r.b, 'local')));
  B.send({ t: 'vmode', mode: 'whisper' });
  yes('Brynjolf whispers, and his mark says whisper', await until(() => G.marks() === mark(r.b, 'whisper')));

  const at = G.wire.length;
  await until(() => G.wire.slice(at).filter((m) => m.t === 'moved' && m.who && m.who[r.c]).length >= 3);
  await sleep(50);
  const who = G.V.who() || {};
  const wire = tableFrom(G.wire);
  yes('who(), which the party strip reads, is the same table as everything the socket was sent, row for row',
      sameTable(who, wire));
  yes('Camilla is where she is now, not where she was when the launcher took the audio',
      !!who[r.c] && JSON.stringify(who[r.c]) === JSON.stringify(wire[r.c]) &&
      Number(who[r.c].pos[0]) < -1400 - 3);

  await post('/silenced', { profiles: { [r.b]: Date.now() + 600000 } });
  yes('staff silence Brynjolf, and his mark goes', await until(() => G.marks() === '[]'));

  B.send({ t: 'sdp', to: G.peer(), sdp: { type: 'offer', sdp: 'v=0' } });
  B.send({ t: 'ice', to: G.peer(), candidate: { candidate: 'candidate:1 1 udp 1 127.0.0.1 9 typ host' } });
  yes('Brynjolf\'s offer and candidate reach the socket',
      await until(() => G.wire.some((m) => m.t === 'sdp' && m.from === B.peer) && G.wire.some((m) => m.t === 'ice' && m.from === B.peer)));
  await sleep(100);
  yes('and build no connection: nothing made since relay mode, nothing open', G.pcs.length === pcsAtRelay && G.pcs.every((pc) => pc.closed));
  const threw = G.said.filter((l) => /listener threw|threw/i.test(l));
  yes('and the page said nothing failed', !threw.length);
  if (threw.length) console.log('      ' + threw.join('\n      '));

  rooms.splice(rooms.indexOf(r), 1);
  return {
    marks: G.marks(),
    ids: Object.keys(G.V.who() || {}).map((k) => Number(k) - base).sort((x, y) => x - y),
    mic: G.V.state().mic,
    open: G.pcs.filter((pc) => !pc.closed).length,
  };
}

(async () => {
  await start();
  const feeding = setInterval(where, 200);
  timers.push(feeding);
  const one = await order(1, false, 1000, '0x0001a26f');
  const two = await order(2, true, 2000, '0x0001a270');
  console.log('\n3. both orders end in the same state:');
  yes('the same marks (' + one.marks + ' and ' + two.marks + ')', one.marks === two.marks);
  yes('the same people in who() (' + one.ids.join(',') + ' and ' + two.ids.join(',') + ')',
      JSON.stringify(one.ids) === JSON.stringify(two.ids) && one.ids.length === 4);
  yes('no microphone and no open connection in either', !one.mic && !two.mic && one.open === 0 && two.open === 0);
})().catch((e) => {
  fail++;
  console.log('FAIL  the harness itself: ' + (e && e.stack || e));
}).then(() => {
  for (const h of timers) { clearTimeout(h); clearInterval(h); }
  for (const s of sockets) { try { s.onclose = null; s.close(); } catch (e) { } }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  const rm = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { } };
  if (srv && srv.exitCode === null) { srv.once('exit', () => { rm(); process.exit(fail ? 1 : 0); }); srv.kill(); }
  else { rm(); process.exit(fail ? 1 : 0); }
  setTimeout(() => { rm(); process.exit(fail ? 1 : 0); }, 2000).unref();
});
