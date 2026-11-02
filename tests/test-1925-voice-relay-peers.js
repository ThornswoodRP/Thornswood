/*
  test-1925-voice-relay-peers.js

      node tests\test-1925-voice-relay-peers.js

  #1925. Every connection to the voice service is a peer on its roster, the
  game's chat socket (game\ui\thornswood-chat.js) included, and the
  launcher's voice (then the page launcher\voice-host.html, C# since #4823,
  launcher\app\VoiceSession.cs) built a WebRTC connection to everybody on
  the roster but itself. While a launcher holds the audio,
  which is the usual case, the game's overlay (game\ui\thornswood-voice.js)
  is in relay mode and takes no signalling, so each of those connections
  sent its offer and candidates through the service and then waited in
  have-local-offer for good, one per person in the room, and the peer count
  the launcher reports counted them. Now the overlay going into relay mode
  tells the service, through the chat, that its connection carries no
  voice, the roster marks it, and neither client builds a connection to a
  marked peer or keeps one it had.

  1. Three people, each with a launcher holding the audio and a game whose
     chat socket joined and whose overlay went into relay mode. Every
     launcher holds two connections, one to each other launcher, and none
     to a chat socket, reports 2, and everybody hears everybody once the
     microphones open. The connections built to the chat sockets before the
     overlays said so are closed. A game that joins again after that (a new
     name is a new connection) joins marked, and no launcher builds anything
     to it.

  2. A room where two games have no launcher, so their overlays carry the
     voice, and a third person's launcher has it. The two games connect to
     each other and hear each other, the launcher builds a connection to
     each of them, and nobody connects to the third person's chat socket.

  3. The service on its own: a join that says it carries no voice is marked
     on the first roster; the mark only ever goes on, once, so a socket that
     sends it again and again, or tries to turn it back, costs the room one
     roster and no more.

  4. The chat on its own: noVoice before the socket opens goes in the join;
     on an open socket it is sent once.

  The game's pages run in node's vm with their own sources, against a real
  WebSocket to the real voice-server.js, with the stand-in browser of
  tests\test-1869-voice-negotiation.js. The launchers are the launcher's
  own voice (tests\voice-launcher.js), real connections between them, each
  microphone a tone of its own and each mixer read back for what it plays.
  VOICE_SERVER, VOICE_OVERLAY and VOICE_CHAT point it at other copies,
  which is how it is shown to fail on the code before #1925. Writes only to
  temp folders, on loopback ports the system hands out.
*/
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { spawn } = require('child_process');
const VL = require('./voice-launcher');

const REPO = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const SERVER = process.env.VOICE_SERVER || path.join(REPO, 'voice', 'voice-server.js');
const OVERLAY = process.env.VOICE_OVERLAY || path.join(REPO, 'game', 'ui', 'thornswood-voice.js');
const CHAT = process.env.VOICE_CHAT || path.join(REPO, 'game', 'ui', 'thornswood-chat.js');
const read = (f) => fs.readFileSync(f, 'utf8').split(CR).join('');

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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-1925-'));
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
let PORT = 0, BASE = '', srv = null, srvLog = '';
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
  srv.stdout.on('data', (d) => { srvLog += d; });
  srv.stderr.on('data', (d) => { srvLog += d; });
  await listening(srv, PORT);
  // Everybody below is in the world, since only somebody in the world holds
  // a voice place and is on the roster (#3570): the gamemode's position
  // feed, stood in for, everybody in one room.
  const who = [601, 602, 603, 701, 702, 703, 801, 802, 803, 804].map((pid) => ({ profileId: pid, pos: [0, 0, 0], angleZ: 0, cell: 'a room' }));
  const fed = await fetch(BASE + '/positions', { method: 'POST', body: JSON.stringify({ who: who }) });
  if (fed.status !== 204) throw new Error('/positions answered ' + fed.status);
}
async function health() { return (await fetch(BASE + '/health')).json(); }

// ------------------------------------------------ the browser, stood in for --
function failure(name, message) { const e = new Error(message || name); e.name = name; return e; }
const descOf = (d) => { try { return d ? JSON.parse(d.sdp) : null; } catch (e) { return null; } };
let UID = 0;

/*
  RTCPeerConnection, as far as these pages lean on it. A description's sdp
  is JSON naming the connection that made it, its version, whether that
  side sends audio, its ICE session and, for an answer, which offer it
  answers. Every method goes on one chain, as the browser's operations
  chain does, and negotiationneeded fires only while stable with nothing on
  the chain, once for each change that needs it.
*/
function rtcFor(page) {
  function PC(cfg) {
    this.uid = ++UID;
    this.page = page;
    page.pcs.push(this);
    this.iceServers = cfg && cfg.iceServers;
    this.signalingState = 'stable';
    this.iceConnectionState = 'new';
    this.localDescription = null;
    this.remoteDescription = null;
    this.currentLocalDescription = null;
    this.currentRemoteDescription = null;
    this.onicecandidate = this.onnegotiationneeded = this.ontrack = this.oniceconnectionstatechange = null;
    this.senders = 0;
    this.media = 0;
    this.ver = 0;
    this.ufrag = 'u' + this.uid;
    this.gathered = false;
    this.negotiated = false;
    this.sending = false;
    this.fired = false;
    this.busy = 0;
    this.chain = Promise.resolve();
    this.closed = false;
    this.rollbacks = 0;
    this.offersTaken = [];
    this.applied = {};
    this.iceRefused = 0;
    this.hearing = {};
  }
  PC.prototype.op = function (fn) {
    const self = this;
    self.busy++;
    const p = self.chain.then(fn);
    self.chain = p.catch(() => { }).then(() => {
      self.busy--;
      if (!self.busy) setTimeout(() => self.check(), 0);
    });
    return p;
  };
  PC.prototype.needed = function () {
    return this.media > 0 && (!this.negotiated || (this.senders > 0) !== this.sending);
  };
  PC.prototype.check = function () {
    if (this.closed || this.busy || this.signalingState !== 'stable' || this.fired || !this.needed()) return;
    this.fired = true;
    if (this.onnegotiationneeded) this.onnegotiationneeded({});
  };
  PC.prototype.changed = function () { this.fired = false; setTimeout(() => this.check(), 0); };
  PC.prototype.addTrack = function () { this.senders++; this.media++; this.changed(); return {}; };
  PC.prototype.addTransceiver = function () { this.media++; this.changed(); return {}; };
  PC.prototype.gather = function () {
    const self = this, u = self.ufrag;
    [1, 2].forEach((n) => setTimeout(() => {
      if (self.closed || !self.onicecandidate) return;
      self.onicecandidate({ candidate: { candidate: 'candidate:' + n + ' 1 udp 2122260223 192.0.2.' + (self.uid % 250) +
                                                    ' ' + (50000 + n) + ' typ host', sdpMid: '0', sdpMLineIndex: 0,
                                         usernameFragment: u } });
    }, n));
    setTimeout(() => { if (!self.closed && self.onicecandidate) self.onicecandidate({ candidate: null }); }, 4);
  };
  PC.prototype.hear = function (body) {
    if (!body.send || this.hearing[body.pc]) return;
    this.hearing[body.pc] = true;
    const track = { kind: 'audio', enabled: true, from: body.pc };
    const stream = { id: 'from-' + body.pc, from: body.pc, getAudioTracks: () => [track], getTracks: () => [track] };
    if (this.ontrack) this.ontrack({ track: track, streams: [stream] });
  };
  PC.prototype.stableNow = function () {
    this.signalingState = 'stable';
    this.currentLocalDescription = this.localDescription;
    this.currentRemoteDescription = this.remoteDescription;
    this.negotiated = true;
    this.sending = !!descOf(this.localDescription).send;
    this.fired = false;
  };
  PC.prototype.setLocalDescription = function (d) {
    const self = this;
    return self.op(() => {
      if (self.closed) throw failure('InvalidStateError', 'closed');
      const st = self.signalingState;
      const type = (d && d.type) || (st === 'have-remote-offer' ? 'answer' : 'offer');
      if (type === 'offer' && st !== 'stable' && st !== 'have-local-offer') throw failure('InvalidStateError', 'an offer in ' + st);
      if (type === 'answer' && st !== 'have-remote-offer') throw failure('InvalidStateError', 'an answer in ' + st);
      const body = { pc: self.uid, v: ++self.ver, send: self.senders > 0, ufrag: self.ufrag };
      if (type === 'answer') body.answers = descOf(self.remoteDescription).v;
      self.localDescription = { type: type, sdp: JSON.stringify(body) };
      if (type === 'offer') { self.signalingState = 'have-local-offer'; self.fired = false; }
      else { self.stableNow(); }
      if (!self.gathered) { self.gathered = true; self.gather(); }
    });
  };
  PC.prototype.setRemoteDescription = function (d) {
    const self = this;
    return self.op(() => {
      if (self.closed) throw failure('InvalidStateError', 'closed');
      const body = descOf(d);
      if (!body || typeof body.pc !== 'number') throw failure('OperationError', 'not a description');
      const st = self.signalingState;
      if (d.type === 'offer') {
        if (st === 'have-local-offer') {
          // The implicit rollback: the polite side's own offer is withdrawn.
          self.rollbacks++;
          self.localDescription = self.currentLocalDescription;
        } else if (st !== 'stable' && st !== 'have-remote-offer') {
          throw failure('InvalidStateError', 'an offer in ' + st);
        }
        self.remoteDescription = { type: 'offer', sdp: d.sdp };
        self.signalingState = 'have-remote-offer';
        self.offersTaken.push(body.pc + '/' + body.v);
        self.hear(body);
        return;
      }
      if (d.type === 'answer') {
        if (st !== 'have-local-offer') throw failure('InvalidStateError', 'an answer in ' + st);
        if (body.answers !== descOf(self.localDescription).v) throw failure('InvalidAccessError', 'an answer to an offer this connection no longer has');
        self.remoteDescription = { type: 'answer', sdp: d.sdp };
        self.stableNow();
        self.hear(body);
        return;
      }
      throw failure('TypeError', 'no type');
    });
  };
  PC.prototype.addIceCandidate = function (c) {
    const self = this;
    return self.op(() => {
      if (self.closed) throw failure('InvalidStateError', 'closed');
      if (!self.remoteDescription) { self.iceRefused++; throw failure('InvalidStateError', 'no remote description yet'); }
      const r = descOf(self.remoteDescription);
      if (!c || c.usernameFragment !== r.ufrag) { self.iceRefused++; throw failure('OperationError', 'a candidate for another session'); }
      self.applied[r.pc] = (self.applied[r.pc] || 0) + 1;
    });
  };
  PC.prototype.restartIce = function () { this.ufrag = 'u' + this.uid + 'r' + (++this.ver); this.gathered = false; this.changed(); };
  PC.prototype.getReceivers = function () {
    return Object.keys(this.hearing).map(() => ({ track: { kind: 'audio', enabled: true } }));
  };
  PC.prototype.close = function () { this.closed = true; this.signalingState = 'closed'; };
  return PC;
}

function param(v) { return { value: v, setTargetAtTime: function (x) { this.value = x; } }; }
function audioNode() {
  return { connect: (to) => to, disconnect: () => { }, gain: param(1), positionX: param(0), positionY: param(0),
           positionZ: param(0), setPosition: () => { }, panningModel: '', distanceModel: '', refDistance: 1,
           rolloffFactor: 1, maxDistance: 10000 };
}
/* An AudioContext that remembers which streams it was handed to play. */
function audioFor(page) {
  return function AudioContext() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = audioNode();
    this.listener = { forwardX: param(0), forwardY: param(0), forwardZ: param(-1), upX: param(0), upY: param(1),
                      upZ: param(0), setOrientation: () => { }, setPosition: () => { } };
    this.createGain = audioNode;
    this.createPanner = audioNode;
    this.createMediaStreamSource = (stream) => { page.played.push(stream); return audioNode(); };
    this.resume = () => Promise.resolve();
  };
}
function FakeAudio() { this.muted = false; this.srcObject = null; }
FakeAudio.prototype.play = function () { return Promise.resolve(); };
FakeAudio.prototype.pause = function () { };

/* A microphone that opens when the test says so: page.mic(). */
function mediaFor(page) {
  let open = null;
  const gate = new Promise((ok) => { open = ok; });
  page.mic = () => open();
  const track = { kind: 'audio', enabled: true, label: 'Microphone (test)', stop: () => { } };
  const stream = { id: 'mic-' + page.name, getAudioTracks: () => [track], getTracks: () => [track] };
  return {
    getUserMedia: () => gate.then(() => stream),
    enumerateDevices: () => Promise.resolve([{ kind: 'audioinput', deviceId: 'default', label: track.label }]),
  };
}
function element() {
  return { style: {}, className: '', innerHTML: '', textContent: '', id: '', setAttribute: () => { }, appendChild: () => { } };
}
/* Timers the page sets, cleared when its test is done. */
function timersFor(page) {
  return {
    setTimeout: (f, ms) => { const h = setTimeout(f, ms); page.timers.push(h); return h; },
    clearTimeout: (h) => clearTimeout(h),
    setInterval: (f, ms) => { const h = setInterval(f, ms); page.timers.push(h); return h; },
    clearInterval: (h) => clearInterval(h),
  };
}
/*
  The network. The pages ask for wss://thornswood.test/voice/, which Caddy
  carries to the service; here a real WebSocket goes straight to it on
  loopback. Everything the service sends is kept on page.wire as well.
  page.hold() keeps what arrives until page.release(), so a test can have
  two pages make their offers before either reads the other's: the glare
  a slow link makes, every time rather than when the timing falls that way.
*/
function socketFor(page) {
  return function WebSocketToService(url, protocols) {
    page.urls.push(url);
    const real = new WebSocket('ws://127.0.0.1:' + PORT + '/', protocols);
    page.sockets.push(real);
    const self = this;
    self.onopen = self.onmessage = self.onclose = self.onerror = null;
    Object.defineProperty(self, 'readyState', { get: () => real.readyState });
    real.onopen = () => { if (self.onopen) self.onopen({}); };
    const deliver = (data) => {
      let m = null;
      try { m = JSON.parse(data); } catch (e) { }
      if (m) page.wire.push(m);
      if (self.onmessage) self.onmessage({ data: data });
    };
    real.onmessage = (ev) => {
      if (page.held) { page.held.push(() => deliver(ev.data)); return; }
      deliver(ev.data);
    };
    real.onclose = () => { if (self.onclose) self.onclose({}); };
    real.onerror = () => { if (self.onerror) self.onerror({}); };
    self.send = (d) => real.send(d);
    self.close = () => { try { real.close(); } catch (e) { } };
  };
}
function newPage(name, pid, kind) {
  const page = { name: name, pid: pid, kind: kind, pcs: [], played: [], said: [], wire: [], urls: [], timers: [],
                 sockets: [], held: null };
  page.hold = () => { page.held = page.held || []; };
  page.release = () => { const q = page.held || []; page.held = null; q.forEach((f) => f()); };
  return page;
}
const pages = [];
function closePage(page) {
  for (const h of page.timers) { clearTimeout(h); clearInterval(h); }
  for (const s of page.sockets) { try { s.onclose = null; s.close(); } catch (e) { } }
  for (const pc of page.pcs) pc.close();
}

const CHAT_SRC = read(CHAT);
const OVERLAY_SRC = read(OVERLAY);

/*
  A launcher: its own voice, configured as Voice.cs configures it, with a
  join token for its profile, and every later ask answered with a fresh
  one. Its microphone is a tone of its own.
*/
const launchers = [];
async function launcher(name, pid, tone) {
  const l = await VL.start({ clock: 'real', wire: 'ws', tone: tone, name: name });
  launchers.push(l);
  l.tone = tone;
  l.listeners.push((e) => { if (e.ev === 'host' && e.kind === 'token' && e.text === 'need') l.send({ do: 'token', token: tokenFor(pid) }); });
  await l.send({ do: 'configure', profileId: pid, name: name, token: tokenFor(pid), base: 'https://127.0.0.1:' + PORT });
  return l;
}

/*
  The game's page: the chat file, which holds the socket and joins as soon
  as it has a token, and the voice overlay, which gets on it when the voice
  plugin configures it (page.configure).
*/
function gamePage(name, pid, withToken) {
  const page = newPage(name, pid, 'game');
  const doc = { createElement: () => element(), body: element(), head: element() };
  const box = Object.assign({
    THORNSWOOD: { host: 'thornswood.test', port: 443, profileId: pid, name: name, token: withToken ? tokenFor(pid) : '',
                  base: 'https://thornswood.test/voice' },
    skyrimPlatform: { sendMessage: (to, line) => page.said.push(to + ': ' + line) },
    document: doc,
    navigator: { mediaDevices: mediaFor(page) },
    location: { href: 'file:///Data/Platform/UI/index.html' },
    isSecureContext: true,
    AudioContext: audioFor(page),
    RTCPeerConnection: rtcFor(page),
    Audio: FakeAudio,
    WebSocket: socketFor(page),
    fetch: () => Promise.reject(new Error('no launcher here')),
    console: { log: (l) => page.said.push('console: ' + l) },
  }, timersFor(page));
  box.window = box;
  vm.createContext(box);
  vm.runInContext(CHAT_SRC, box, { filename: 'thornswood-chat.js' });
  vm.runInContext(OVERLAY_SRC, box, { filename: 'thornswood-voice.js' });
  page.box = box;
  page.peer = () => Number(box.thornswoodNet.peer()) || 0;
  page.configure = (mic) => box.thornswoodVoice.configure({ host: 'thornswood.test', port: 443, profileId: pid, name: name,
                                                             pushToTalk: true, microphone: !!mic, micName: '' });
  pages.push(page);
  return page;
}

// ---------------------------------------------------------------- reading --
/* The two connections that make a pair between P and Q, when they agree. */
function link(P, Q) {
  for (const a of P.pcs) {
    for (const b of Q.pcs) {
      if (a.closed || b.closed || a.signalingState !== 'stable' || b.signalingState !== 'stable') continue;
      const al = descOf(a.currentLocalDescription), ar = descOf(a.currentRemoteDescription);
      const bl = descOf(b.currentLocalDescription), br = descOf(b.currentRemoteDescription);
      if (!al || !ar || !bl || !br) continue;
      if (ar.pc !== b.uid || br.pc !== a.uid || ar.v !== bl.v || br.v !== al.v) continue;
      // One side holding the other's candidates is enough for ICE: its
      // checks reach the other, which learns where they came from.
      if (!a.applied[b.uid] && !b.applied[a.uid]) continue;
      return { a: a, b: b, al: al, bl: bl };
    }
  }
  return null;
}
/* P hears Q. */
function hears(P, Q) {
  const l = link(P, Q);
  return !!l && !!l.bl.send && P.played.some((s) => s.from === l.b.uid);
}
/* The page's own lines that say a negotiation went wrong. */
function troubles(page) {
  return page.said.filter((l) => /offer failed|sdp failed|could not offer|listener threw|threw/i.test(l));
}

// ---------------------------------------------------------------- reading --
const openPcs = (P) => P.pcs.filter((pc) => !pc.closed);
/* The last peer count a launcher reported to the launcher, and the most it
   reported from its event `from` on. */
function reported(l) {
  const said = l.host('peers');
  return said.length ? Number(said[said.length - 1]) : -1;
}
function maxSince(l, from) {
  return l.events.slice(from).filter((e) => e.ev === 'host' && e.kind === 'peers').reduce((m, e) => Math.max(m, Number(e.text)), 0);
}
function lastRoster(P) {
  const all = P.wire.filter((m) => m.t === 'peers');
  return all.length ? all[all.length - 1] : null;
}
/* Every launcher hears every other's tone in what it plays. */
async function allHear(list) {
  const from = Date.now();
  while (Date.now() - from < 20000) {
    let all = true;
    for (const l of list) {
      const lv = await l.hear(list.filter((o) => o !== l).map((o) => o.tone));
      if (!list.every((o) => o === l || lv[String(o.tone)] > 0.05)) { all = false; break; }
    }
    if (all) return true;
    await sleep(250);
  }
  return false;
}
/* What a launcher said that means a negotiation went wrong. */
const troubleRe = /offer failed|sdp failed|could not offer|listener threw|threw|could not reach/i;
function launcherTroubles(l) { return l.host('log').filter((t) => troubleRe.test(t)); }
const relay = (G) => G.box.thornswoodVoice.setLauncherStatus(true, 0, false, 'local');

// ----------------------------------------------------------------- part 1 --
async function partOne() {
  console.log('1. three people, each with a launcher holding the audio and a game in relay mode:');
  const L = [await launcher('Aela', 601, 440), await launcher('Brynjolf', 602, 550), await launcher('Camilla', 603, 660)];
  yes('the three launchers join', await until(() => L.every((l) => l.host('status').indexOf('connected') >= 0), 15000));
  const G = [gamePage('Aela', 601, true), gamePage('Brynjolf', 602, true), gamePage('Camilla', 603, true)];
  yes('the three games\' chat sockets join', await until(() => G.every((g) => g.peer() > 0 && g.box.thornswoodNet.isUp())));
  yes('before the overlays hand over, every launcher has built a connection to all five other sockets, chat sockets included',
      await until(() => L.every((l) => reported(l) === 5), 15000));

  // The plugin pushes each launcher's state in, which is relay mode, from
  // the first word the launcher gets to the page (thornswood-voice.js).
  G.forEach(relay);
  yes('once the overlays are in relay mode, the roster marks the three chat sockets as carrying no voice',
      await until(() => G.every((g) => {
        const r = lastRoster(g);
        return !!r && r.peers.length === 6 &&
               G.every((h) => r.peers.some((p) => p.peer === h.peer() && p.voice === false)) &&
               r.peers.filter((p) => p.voice !== false).length === 3;
      })));
  const kept = await until(() => L.every((l) => reported(l) === 2), 15000);
  yes('every launcher closes the connections it had to the chat sockets and keeps the two to the other launchers (' + L.map(reported).join(', ') + ')', kept);
  yes('the overlays in relay mode hold no connection at all', G.every((g) => openPcs(g).length === 0));

  for (const l of L) { await l.send({ do: 'ptt', on: true }); }
  yes('with the microphones open, everybody hears everybody', await allHear(L));
  yes('and no launcher has built anything more', L.every((l) => maxSince(l, 0) <= 5 && reported(l) === 2));

  // A new name closes the chat's connection and opens another, a new peer.
  const marks = L.map((l) => l.events.length);
  const firstId = G[0].peer();
  const asked = () => G[0].said.filter((l) => /^thornswood-front: token\? 601$/.test(l)).length;
  const n = asked();
  G[0].box.thornswoodNet.setName('Aela the Huntress');
  await until(() => asked() > n, 8000);
  G[0].box.thornswoodNet.setToken(tokenFor(601));
  yes('a game in relay mode that joins again does so as a new peer', await until(() => G[0].peer() > 0 && G[0].peer() !== firstId));
  const newId = G[0].peer();
  yes('the room is sent a roster naming it', await until(() => G.slice(1).every((g) => {
    const r = lastRoster(g);
    return !!r && r.peers.some((p) => p.peer === newId);
  })));
  const firstNaming = G[1].wire.find((m) => m.t === 'peers' && m.peers.some((p) => p.peer === newId));
  yes('and the first roster that names it already marks it, because its join said so',
      !!firstNaming && firstNaming.peers.find((p) => p.peer === newId).voice === false);
  await sleep(500);
  yes('so no launcher built a connection to it, even for a moment',
      L.every((l, i) => maxSince(l, marks[i]) <= 2 && reported(l) === 2));
  const said = [].concat(...L.map(launcherTroubles), ...G.map(troubles));
  yes('and no launcher or page said anything failed', !said.length);
  if (said.length) console.log('      ' + said.join('\n      '));
  G.forEach(closePage);
  for (const l of L) { await l.quit(); }
  await sleep(200);
}

// ----------------------------------------------------------------- part 2 --
/*
  The stand-in browser speaks its own descriptions, which a real WebRTC
  stack, and so the launcher's C# voice since #4823, cannot read, nor it
  theirs. So what is checked between the launcher and the two games is the
  launcher's side of it: it builds a connection to each game that carries
  voice and none to its own game's chat socket in relay mode. Whether the
  launcher's voice and a game's own browser hear each other needs that
  browser, not this stand-in (the report for #4823 says so).
*/
async function partTwo() {
  console.log('\n2. two games with no launcher, and one person whose launcher has the audio:');
  const K = await launcher('Kodlak', 703, 440);
  await until(() => K.host('status').indexOf('connected') >= 0, 15000);
  const GK = gamePage('Kodlak', 703, true);
  await until(() => GK.peer() > 0);
  relay(GK);
  const H = gamePage('Hulda', 701, true);
  const V = gamePage('Vilkas', 702, true);
  await until(() => H.peer() > 0 && V.peer() > 0);
  H.configure(true);
  V.configure(true);
  H.mic(); V.mic();
  yes('the two games connect to each other', await until(() => !!link(H, V)));
  yes('and hear each other', await until(() => hears(H, V) && hears(V, H)));
  const two = await until(() => reported(K) === 2, 15000);
  yes('the launcher holds two connections, one to each game that carries voice, and none to its own game\'s chat socket (' + reported(K) + ')',
      two && maxSince(K, 0) <= 3);
  yes('the games with no launcher hold one connection each to the other game and the launcher, and none to the chat socket in relay mode',
      openPcs(H).length === 2 && openPcs(V).length === 2);
  yes('the game in relay mode holds no connection', openPcs(GK).length === 0);
  const said = [].concat(troubles(GK), K.host('log').filter((l) => /could not reach/.test(l)));
  yes('and the game in relay mode and the launcher said nothing failed', !said.length);
  if (said.length) console.log('      ' + said.join('\n      '));
  [H, V, GK].forEach(closePage);
  await K.quit();
  await sleep(200);
}

// ----------------------------------------------------------------- part 3 --
const plain = [];
function socketAs(pid, join) {
  return new Promise((ok, bad) => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT + '/', ['thornswood', tokenFor(pid)]);
    plain.push(ws);
    const s = { ws: ws, got: [], peer: 0, send: (m) => ws.send(JSON.stringify(m)) };
    ws.onopen = () => s.send(Object.assign({ t: 'join', profileId: pid }, join));
    ws.onmessage = (ev) => {
      let m = null;
      try { m = JSON.parse(ev.data); } catch (e) { }
      if (!m) return;
      s.got.push(m);
      if (m.t === 'welcome') { s.peer = m.peer; ok(s); }
    };
    ws.onerror = () => bad(new Error('no socket for ' + pid));
  });
}
async function partThree() {
  console.log('\n3. the service on its own:');
  const O = await socketAs(801, { name: 'watching' });
  const X = await socketAs(802, { name: 'relay from the start', voice: false });
  const naming = (id) => O.got.find((m) => m.t === 'peers' && m.peers.some((p) => p.peer === id));
  await until(() => !!naming(X.peer));
  const xRow = naming(X.peer) ? naming(X.peer).peers.find((p) => p.peer === X.peer) : {};
  yes('a join that says it carries no voice is marked on the first roster that names it', xRow.voice === false);
  const Y = await socketAs(803, { name: 'says nothing' });
  await until(() => !!naming(Y.peer));
  const yRow = naming(Y.peer) ? naming(Y.peer).peers.find((p) => p.peer === Y.peer) : {};
  yes('a join that says nothing carries voice, as every page older than this does', !!yRow.peer && !('voice' in yRow));

  const rosters = () => O.got.filter((m) => m.t === 'peers').length;
  const r0 = rosters();
  Y.send({ t: 'voice', on: true });
  Y.send({ t: 'voice' });
  for (let i = 0; i < 20; i++) { Y.send({ t: 'voice', on: false }); Y.send({ t: 'voice', on: true }); }
  // Something the watcher is sent after all of that, from the same socket,
  // so everything the burst made has reached it first.
  Y.send({ t: 'vmode', mode: 'yell' });
  await until(() => O.got.some((m) => m.t === 'vmode' && m.from === Y.peer));
  yes('forty switches from one socket cost the room one roster (' + (rosters() - r0) + ')', rosters() - r0 === 1);
  const last = O.got.filter((m) => m.t === 'peers').pop();
  yes('and the mark holds: turning it back on does nothing',
      !!last && last.peers.find((p) => p.peer === Y.peer).voice === false);
  const r1 = rosters();
  const Z = await socketAs(804, { name: 'later' });
  await until(() => !!naming(Z.peer));
  yes('a socket that joins after still sees both marked on its own roster', (() => {
    const r = Z.got.find((m) => m.t === 'peers');
    return !!r && r.peers.find((p) => p.peer === X.peer).voice === false &&
           r.peers.find((p) => p.peer === Y.peer).voice === false && !('voice' in r.peers.find((p) => p.peer === O.peer));
  })());
  yes('and that join cost one roster too', rosters() - r1 === 1);
}

// ----------------------------------------------------------------- part 4 --
function partFour() {
  console.log('\n4. the chat on its own:');
  function chatAlone() {
    const made = [];
    function FakeSocket() { made.push(this); this.readyState = 0; this.sent = []; }
    FakeSocket.prototype.send = function (m) { this.sent.push(JSON.parse(m)); };
    FakeSocket.prototype.close = function () { this.readyState = 3; };
    const box = { WebSocket: FakeSocket, console: { log: () => { } },
                  THORNSWOOD: { host: 'thornswood.test', port: 443, profileId: 7, name: 'tester', token: 'v2.7.1.x',
                                base: 'https://thornswood.test/voice' },
                  skyrimPlatform: { sendMessage: () => { } },
                  setTimeout: () => 0, clearTimeout: () => { }, setInterval: () => 0, clearInterval: () => { } };
    box.window = box;
    vm.createContext(box);
    vm.runInContext(CHAT_SRC, box, { filename: 'thornswood-chat.js' });
    return { n: box.thornswoodNet, made: made };
  }
  const a = chatAlone();
  yes('the chat has a way for voice to say it has gone to the launcher', typeof a.n.noVoice === 'function');
  if (typeof a.n.noVoice !== 'function') return;
  a.n.noVoice();
  a.made[0].readyState = 1;
  a.made[0].onopen();
  const join = a.made[0].sent[0] || {};
  yes('said before the socket opens, it goes in the join', join.t === 'join' && join.voice === false);
  yes('and nothing else is sent for it', a.made[0].sent.length === 1);

  const b = chatAlone();
  b.made[0].readyState = 1;
  b.made[0].onopen();
  yes('a join from a page whose voice has not gone anywhere says nothing about it', !('voice' in (b.made[0].sent[0] || {})));
  b.made[0].onmessage({ data: JSON.stringify({ t: 'welcome', peer: 9, profileId: 7 }) });
  b.n.noVoice();
  b.n.noVoice();
  const offs = b.made[0].sent.filter((m) => m.t === 'voice');
  yes('said on an open socket, it is sent once, after the join', offs.length === 1 && offs[0].on === false &&
      b.made[0].sent.indexOf(offs[0]) > 0);
  b.made[0].readyState = 3;
  b.made[0].onclose();
  b.n.setToken('v2.7.2.y');
  const again = b.made[1];
  if (again) { again.readyState = 1; again.onopen(); }
  const join2 = (again && again.sent[0]) || {};
  yes('and the next connection says it in its join', join2.t === 'join' && join2.voice === false &&
      !again.sent.some((m) => m.t === 'voice'));
}

(async () => {
  await start();
  await partOne();
  await partTwo();
  await partThree();
  partFour();
})().catch((e) => {
  fail++;
  console.log('FAIL  the harness itself: ' + (e && e.stack || e));
}).then(async () => {
  pages.forEach(closePage);
  for (const s of plain) { try { s.onclose = null; s.close(); } catch (e) { } }
  for (const l of launchers) { await l.quit(); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  const rm = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { } };
  if (srv && srv.exitCode === null) { srv.once('exit', () => { rm(); process.exit(fail ? 1 : 0); }); srv.kill(); }
  else { rm(); process.exit(fail ? 1 : 0); }
  setTimeout(() => { rm(); process.exit(fail ? 1 : 0); }, 2000).unref();
});
