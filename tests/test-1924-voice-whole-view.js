/*
  test-1924-voice-whole-view.js

      node tests\test-1924-voice-whole-view.js

  #1924. The voice service sends each connection its whole view of who is
  near once, { t: 'pos' } on the first position tick after it joins, and
  from then on only the rows that changed ({ t: 'moved' }). The game's voice
  overlay (game\ui\thornswood-voice.js) rides the chat's socket
  (game\ui\thornswood-chat.js) and gets on it only when the voice plugin
  configures it, so the socket can join, and be sent that whole view, before
  the overlay is listening. #1869 made the chat keep the roster and the
  offers for it. This is the same for the view, the voice modes and the
  staff silences.

  1. The late order, against the real service. Four people in one cell: the
     game's own person (Gerdur), Aela talking and standing still, Brynjolf
     standing still, and Camilla walking. Gerdur has been silenced by staff.
     The chat joins and is sent its whole view, then a few ticks of Camilla
     walking, and Brynjolf says he whispers. Only then does the voice plugin
     configure the overlay. The overlay's table must hold everybody in view,
     standing still or not, the same table as everything the socket was
     sent; Aela's speaking mark must be drawn without anybody moving;
     Brynjolf must be placed at his whisper; and Gerdur's own microphone
     must stay shut, because the silence was said before the overlay was on.

  2. What the chat keeps, on its own: the last whole view with every change
     applied and the people who left it gone, a mode written onto the
     roster, a silence until it is lifted, the order board hands them over
     in, nothing once voice is on, and nothing across a new connection.

  VOICE_SERVER, VOICE_OVERLAY and VOICE_CHAT point it at other copies,
  which is how it is shown to fail on the code before #1924. Writes only to
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-1924-'));
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
  Where everybody stands, posted as the gamemode posts it. A unit is a
  seventieth of a metre. Aela is 6 metres in front, Brynjolf 5 metres to the
  side, and Camilla walks a unit further each post, 20 metres off.
*/
const CELL = '0x0001a26f';
const G_PID = 302, A_PID = 501, B_PID = 502, C_PID = 503;
const ACTOR = (pid) => 0x14000 + pid;
let step = 0;
function where() {
  step++;
  const row = (pid, name, pos) => ({ profileId: pid, name: name, pos: pos, angleZ: 0, cell: CELL, actor: ACTOR(pid) });
  return post('/positions', { who: [
    row(G_PID, 'Gerdur', [0, 0, 0]),
    row(A_PID, 'Aela', [0, 420, 0]),
    row(B_PID, 'Brynjolf', [350, 0, 0]),
    row(C_PID, 'Camilla', [-1400 - step, 0, 0]),
  ] });
}

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
  plugin configures it (page.configure). The microphone opens at once when
  asked. Peer connections are bare: nobody here answers, and what this reads
  is the level each one is set to.
*/
function gamePage() {
  const page = { said: [], wire: [], gains: [], track: null };
  function PC() { this.signalingState = 'stable'; }
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
    this.createGain = () => { const g = node(); page.gains.push(g); return g; };
    this.createPanner = node;
    this.createMediaStreamSource = node;
    this.resume = () => Promise.resolve();
  }
  const track = { kind: 'audio', enabled: true, label: 'Microphone (test)', stop: () => { } };
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
    THORNSWOOD: { host: 'thornswood.test', port: 443, profileId: G_PID, name: 'Gerdur', token: tokenFor(G_PID),
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
  // Push to talk off, so the microphone is open unless something shuts it.
  page.configure = () => box.thornswoodVoice.configure({ host: 'thornswood.test', port: 443, profileId: G_PID, name: 'Gerdur',
                                                         pushToTalk: false, microphone: true, micName: '' });
  return page;
}

/* Everything the socket was sent, as a table: the last whole view with every
   change since applied. What an overlay listening from the start holds. */
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

/* The level a voice is set to at a distance, as levelFor in the overlay. */
const MODES = { whisper: { ref: 1.5, max: 7, gain: 0.8 }, local: { ref: 4, max: 30, gain: 1.0 } };
function levelFor(name, d) {
  const m = MODES[name];
  if (d >= m.max) return 0;
  if (d <= m.ref) return m.gain;
  return m.gain * (m.ref / d) * (1 - ((d - m.ref) / (m.max - m.ref)));
}
const near = (x, y) => Math.abs(x - y) < 1e-6;

// ----------------------------------------------------------------- part 1 --
async function partOne() {
  console.log('1. the overlay gets on a socket that was sent its whole view before it was listening:');
  const feeding = setInterval(where, 200);
  timers.push(feeding);
  await where();
  // Staff silenced Gerdur before the game's chat joined, as at the
  // character choice.
  await post('/silenced', { profiles: { [G_PID]: Date.now() + 600000 } });

  const A = await person(A_PID, 'Aela');
  const B = await person(B_PID, 'Brynjolf');
  // Aela talks, and has been talking since before Gerdur joined.
  A.send({ t: 'talk', on: true });
  await sleep(300);

  const G = gamePage();
  yes('the game\'s chat socket joins on its own and is sent its whole view, before voice is configured',
      await until(() => G.box.thornswoodNet.isUp() && G.wire.some((m) => m.t === 'pos')));
  const first = G.wire.find((m) => m.t === 'pos');
  const firstIds = Object.keys((first && first.who) || {}).sort();
  yes('that whole view names everybody in the cell: Gerdur, Aela, Brynjolf and Camilla (' + firstIds.join(',') + ')',
      JSON.stringify(firstIds) === JSON.stringify([G_PID, A_PID, B_PID, C_PID].map(String).sort()));
  yes('and it was told Gerdur is silenced', G.wire.some((m) => m.t === 'hush' && m.profileId === G_PID && m.on));

  // Camilla walks for a few ticks, then Brynjolf whispers.
  await until(() => G.wire.filter((m) => m.t === 'moved').length >= 3);
  B.send({ t: 'vmode', mode: 'whisper' });
  yes('Brynjolf\'s whisper reaches the socket before the overlay is on',
      await until(() => G.wire.some((m) => m.t === 'vmode' && m.profileId === B_PID && m.mode === 'whisper')));
  await until(() => G.wire.some((m) => m.t === 'moved' && m.who && m.who[B_PID]));
  const moves = G.wire.filter((m) => m.t === 'moved');
  const rowsMoved = (pid) => moves.some((m) => m.who && m.who[pid]);
  yes('Gerdur and Aela stand still, so no change after the whole view carries them',
      !rowsMoved(G_PID) && !rowsMoved(A_PID));
  yes('and Camilla walking is sent as changes', rowsMoved(C_PID));
  yes('nothing has been placed or marked yet, because the overlay is not on',
      G.gains.length === 0 && !G.said.some((l) => /^thornswood-front: marks:/.test(l)));

  // In the world: the voice plugin configures the overlay.
  G.configure();
  yes('once the overlay is on, its microphone opens', await until(() => G.box.thornswoodVoice.state().mic));
  await sleep(100);

  const who = G.box.thornswoodVoice.who() || {};
  const ids = Object.keys(who).sort();
  yes('the overlay\'s table holds everybody in view, standing still or not (' + (ids.join(',') || 'nobody') + ')',
      JSON.stringify(ids) === JSON.stringify(firstIds));
  yes('and it is the same table as everything the socket was sent, row for row', sameTable(who, tableFrom(G.wire)));
  yes('its own row is there, which everything it places is measured from', !!who[G_PID] && !!who[G_PID].pos);
  const marks = G.said.filter((l) => /^thornswood-front: marks:/.test(l));
  yes('Aela\'s speaking mark is drawn without anybody moving',
      marks.length > 0 && marks[marks.length - 1] === 'thornswood-front: marks:' + JSON.stringify([{ a: ACTOR(A_PID), m: 'local' }]));
  yes('Gerdur\'s own microphone stays shut, because the silence was said before the overlay was on',
      G.track.enabled === false);
  const levels = G.gains.map((g) => g.gain.value);
  yes('Aela is placed at her local level 6 metres away', levels.some((v) => near(v, levelFor('local', 6))));
  yes('and Brynjolf at his whisper 5 metres away (' + levelFor('whisper', 5).toFixed(3) + '), not at local (' +
      levelFor('local', 5).toFixed(3) + '): levels ' + levels.map((v) => v.toFixed(3)).join(', '),
      levels.some((v) => near(v, levelFor('whisper', 5))) && !levels.some((v) => near(v, levelFor('local', 5))));

  // And it stays current, live, from there.
  const at = G.wire.length;
  await until(() => G.wire.slice(at).filter((m) => m.t === 'moved').length >= 2);
  await sleep(50);
  const now = G.box.thornswoodVoice.who() || {};
  yes('after more ticks it still matches what the socket was sent, Camilla where she is now',
      sameTable(now, tableFrom(G.wire)) && JSON.stringify(now[C_PID]) === JSON.stringify(tableFrom(G.wire)[C_PID]));
  const said = G.said.filter((l) => /listener threw|threw/i.test(l));
  yes('and the page said nothing failed', !said.length);
  if (said.length) console.log('      ' + said.join('\n      '));
  clearInterval(feeding);
}

// ----------------------------------------------------------------- part 2 --
function partTwo() {
  console.log('\n2. what the chat keeps for voice, on its own:');
  function chatAlone() {
    const made = [];
    function FakeSocket() { made.push(this); this.readyState = 0; this.sent = []; }
    FakeSocket.prototype.send = function (m) { this.sent.push(m); };
    FakeSocket.prototype.close = function () { this.readyState = 3; };
    const box = { WebSocket: FakeSocket, console: { log: () => { } },
                  THORNSWOOD: { host: 'thornswood.test', port: 443, profileId: 7, name: 'tester', token: 'v2.7.1.x',
                                base: 'https://thornswood.test/voice' },
                  skyrimPlatform: { sendMessage: () => { } },
                  setTimeout: () => 0, clearTimeout: () => { }, setInterval: () => 0, clearInterval: () => { } };
    box.window = box;
    vm.createContext(box);
    vm.runInContext(CHAT_SRC, box, { filename: 'thornswood-chat.js' });
    const ws = made[0];
    ws.readyState = 1;
    ws.onopen();
    return { n: box.thornswoodNet, ws: ws, say: (m) => ws.onmessage({ data: JSON.stringify(m) }) };
  }
  const row = (x) => ({ pos: [x, 0, 0], angleZ: 0, cell: CELL, actor: 1, talk: 0, mode: 'local' });
  const c = chatAlone();
  c.say({ t: 'welcome', peer: 10, profileId: 7 });
  c.say({ t: 'peers', peers: [{ peer: 4, profileId: 4, mode: 'local' }, { peer: 5, profileId: 5, mode: 'local' },
                              { peer: 10, profileId: 7, mode: 'local' }], iceServers: [] });
  c.say({ t: 'pos', at: 1, who: { 7: row(0), 4: row(10), 5: row(20), 6: row(30) } });
  c.say({ t: 'sdp', from: 4, sdp: { type: 'offer', sdp: 'four' } });
  c.say({ t: 'moved', at: 2, who: { 4: row(11) }, gone: [6] });
  c.say({ t: 'vmode', from: 5, profileId: 5, mode: 'yell' });
  c.say({ t: 'hush', profileId: 5, on: true });
  c.say({ t: 'hush', profileId: 4, on: true });
  c.say({ t: 'hush', profileId: 4, on: false });
  c.say({ t: 'moved', at: 3, who: { 5: row(21) }, gone: [] });
  const got = [];
  c.n.board((m) => got.push(m));
  const kinds = got.map((m) => m.t);
  yes('board hands over the roster, then the whole view, then the silences, then the signalling (' + kinds.join(', ') + ')',
      JSON.stringify(kinds) === JSON.stringify(['peers', 'pos', 'hush', 'sdp']));
  const view = (got[1] && got[1].who) || {};
  yes('the view is the last whole one with every change applied',
      JSON.stringify(Object.keys(view).sort()) === JSON.stringify(['4', '5', '7']) &&
      view[4].pos[0] === 11 && view[5].pos[0] === 21 && view[7].pos[0] === 0);
  yes('and whoever left it is gone from it', !view[6]);
  const five = ((got[0] && got[0].peers) || []).find((p) => p.peer === 5) || {};
  yes('a mode said since the roster is written onto it', five.mode === 'yell');
  yes('a silence still on is handed over, and one lifted is not',
      got.filter((m) => m.t === 'hush').length === 1 && got[2].profileId === 5 && got[2].on === true);
  c.say({ t: 'moved', at: 4, who: { 4: row(12) }, gone: [] });
  yes('after that the changes arrive live', got[got.length - 1].t === 'moved');
  const late = [];
  c.n.board((m) => late.push(m));
  yes('and nothing is kept once voice is on', late.length === 0);

  const d = chatAlone();
  d.say({ t: 'welcome', peer: 20, profileId: 7 });
  d.say({ t: 'peers', peers: [{ peer: 20, profileId: 7 }], iceServers: [] });
  d.say({ t: 'pos', at: 1, who: { 7: row(0) } });
  d.say({ t: 'hush', profileId: 7, on: true });
  d.say({ t: 'welcome', peer: 21, profileId: 7 });
  d.say({ t: 'peers', peers: [{ peer: 21, profileId: 7 }], iceServers: [] });
  const got2 = [];
  d.n.board((m) => got2.push(m));
  yes('a new connection starts over: no view or silence from the old one, only its own roster',
      got2.length === 1 && got2[0].t === 'peers');

  const e = chatAlone();
  e.say({ t: 'welcome', peer: 30, profileId: 7 });
  e.say({ t: 'pos', at: 1, who: { 7: row(0) } });
  e.ws.onclose();
  const got3 = [];
  e.n.board((m) => got3.push(m));
  yes('and a connection that closed hands voice nothing', got3.length === 0);
}

(async () => {
  await start();
  await partOne();
  partTwo();
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
