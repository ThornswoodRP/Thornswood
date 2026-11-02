// test-voice-relay-no-peers.js
//
// Once the launcher holds the audio, the game's own browser never makes a
// WebRTC connection. Issue #911.
//
// Why it matters: a WebRTC connection opens UDP sockets on every network the
// machine has, and in the game's browser that happens inside
// SkyrimPlatformCEF.exe.hidden, whose network service also starts an mDNS
// responder on UDP 5353. That is what made Windows Firewall stop the game to
// ask about "skyrimplatformcef.exe.hidden", and what the launcher used to ask
// for administrator to write a firewall rule for.
//
// Measured in cef_debug.log on 26 September: the launcher had the microphone
// from 14:28:01, and at 14:29:03, when a second person joined, the page built
// a peer connection anyway, the mDNS responder started, and the chat logged
// "listener threw: TypeError: Cannot read properties of null (reading
// 'createGain')". The relay guard sat BELOW the peer list in the socket
// listener, so a peer list still reached reconcile, and open() made the
// RTCPeerConnection before it threw on the audio context relay mode never
// makes, leaving the connection open.
//
// This runs the REAL page in a sandbox with a fake socket and a fake
// RTCPeerConnection that counts how many were made, rather than reading its
// text. Read only.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const CR = String.fromCharCode(13);
const PAGE = path.join(__dirname, '..', 'game', 'ui', 'thornswood-voice.js');
const src = fs.readFileSync(PAGE, 'utf8').split(CR).join('');

function node() {
  return {
    gain: { value: 1, setTargetAtTime: function (v) { this.value = v; } },
    positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 },
    connect: function (x) { return x; }
  };
}

function FakeAudio() {
  this.state = 'running';
  this.currentTime = 0;
  this.destination = {};
  this.listener = { setOrientation: function () { } };
}
FakeAudio.prototype.createGain = function () { return node(); };
FakeAudio.prototype.createPanner = function () { return node(); };
FakeAudio.prototype.resume = function () { return Promise.resolve(); };

/* The page loaded fresh, with its own count of connections made. */
function page(withAudio) {
  const made = [];
  function FakePc() {
    made.push(this);
    this.signalingState = 'stable';
  }
  FakePc.prototype.addTrack = function () { };
  FakePc.prototype.addTransceiver = function () { };
  FakePc.prototype.close = function () { this.closed = true; };
  FakePc.prototype.setLocalDescription = function () { return Promise.resolve(); };
  FakePc.prototype.setRemoteDescription = function () { return Promise.resolve(); };
  FakePc.prototype.addIceCandidate = function () { return Promise.resolve(); };
  FakePc.prototype.restartIce = function () { };

  const listeners = [];
  const told = [];
  const net = {
    post: function () { return true; },
    on: function (fn) { listeners.push(fn); },
    // How the overlay gets on since #1869. Nothing was kept for it here.
    board: function (fn) { listeners.push(fn); },
    peer: function () { return 1; },
    // How the overlay tells the room its socket carries no voice (#1925).
    noVoice: function () { told.push('no voice'); }
  };
  const el = function () {
    return { style: {}, appendChild: function () { }, setAttribute: function () { } };
  };
  const win = {
    thornswoodNet: net,
    skyrimPlatform: { sendMessage: function () { } }
  };
  if (withAudio) { win.AudioContext = FakeAudio; }
  const sandbox = {
    window: win,
    document: { getElementById: function () { return null; }, createElement: el,
                body: { appendChild: function () { } }, head: { appendChild: function () { } },
                querySelector: function () { return null; } },
    navigator: {}, location: { href: 'file:///x' },
    RTCPeerConnection: FakePc,
    Audio: function () { return { play: function () { return Promise.resolve(); } }; },
    setInterval: function () { return 0; }, clearInterval: function () { },
    setTimeout: function () { return 0; }, clearTimeout: function () { },
    console: { log: function () { } },
    fetch: function () { return Promise.reject(new Error('no network here')); },
    Promise: Promise, Map: Map, Math: Math, Number: Number, String: String, JSON: JSON,
    Date: Date, Object: Object, Array: Array, isFinite: isFinite
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);

  // The same as thornswood-chat.js's fanout: a listener that throws is
  // caught and logged there, so it is caught and counted here.
  const threw = [];
  function serve(m) {
    listeners.slice().forEach(function (fn) {
      try { fn(m); } catch (e) { threw.push(String(e)); }
    });
  }
  return { V: win.thornswoodVoice, made: made, serve: serve, listeners: listeners, threw: threw, told: told };
}

const CONFIG = { host: 'voice.test', port: 7789, profileId: 100, name: 'Me',
                 pushToTalk: true, microphone: false };
const SOMEBODY = { t: 'peers', peers: [
  { peer: 1, profileId: 100, name: 'Me', mode: 'local' },
  { peer: 2, profileId: 200, name: 'Sera', mode: 'local' }
] };
const OFFER = { t: 'sdp', from: 2, sdp: { type: 'offer', sdp: 'v=0' } };

// -------------------------------- the harness can see a connection being made
{
  // No launcher: this page is the voice, so a second person gets a connection.
  // Without this the counts below would pass for a harness that sees nothing.
  const p = page(true);
  p.V.configure(CONFIG);
  yes('with no launcher the page listens on the socket', p.listeners.length === 1);
  p.serve(SOMEBODY);
  yes('with no launcher a second person gets one connection', p.made.length === 1);
}

// ------------------- the launcher says so first, then the page is configured
{
  // The order in every log since 25 September: "the launcher has the
  // microphone now" arrives before the plugin's first configure.
  const p = page(true);
  p.V.setLauncherPort(47780);
  p.V.configure(CONFIG);
  p.serve({ t: 'welcome', peer: 1 });
  p.serve(SOMEBODY);
  yes('in relay mode a peer list makes no connection', p.made.length === 0);
  p.serve(OFFER);
  p.serve({ t: 'ice', from: 2, candidate: { candidate: 'x' } });
  yes('nor does an offer or a candidate', p.made.length === 0);
}

// ----------------------------- relay announced through the status file route
{
  const p = page(true);
  p.V.setLauncherStatus(true, 1, false, 'local');
  p.V.configure(CONFIG);
  p.serve(SOMEBODY);
  yes('relay by the plugin\'s status route makes no connection either', p.made.length === 0);
}

// ------------------ exactly the 26 September case: relay, and no audio at all
{
  // Relay mode never makes an audio context. The old code made the
  // RTCPeerConnection and THEN threw on ctx.createGain, so the count here was
  // 1 and the exception went to the chat's listener loop.
  const p = page(false);
  p.V.setLauncherPort(47780);
  p.V.configure(CONFIG);
  p.serve(SOMEBODY);
  yes('relay with no audio context makes no connection', p.made.length === 0);
  yes('and nothing throws into the chat\'s listener loop', p.threw.length === 0);
}

// ----------------------- the launcher takes over from a page already in play
{
  const p = page(true);
  p.V.configure(CONFIG);
  p.serve(SOMEBODY);
  yes('before the launcher speaks up the page carries voice', p.made.length === 1);
  const first = p.made[0];
  p.V.setLauncherPort(47780);
  yes('the handover closes what it had', first.closed === true);
  // Still listening, for the positions (#1959), so what follows reaches
  // the page and the guard is what keeps it from building anything.
  yes('and stays on the socket', p.listeners.length === 1);
  p.serve(SOMEBODY);
  p.serve(OFFER);
  yes('and builds nothing afterwards', p.made.length === 1);
  yes('it tells the room, through the chat, that its socket carries no voice (#1925)', p.told.length >= 1);
  yes('while the page that carried voice never said so', (function () {
    const q = page(true);
    q.V.configure(CONFIG);
    q.serve(SOMEBODY);
    return q.told.length === 0;
  })());
}

// ------------------- and nothing asks for administrator to write a rule instead
{
  // Patrick, 28 September: "we need to get it so it doesn't do that
  // administrator prompt for the firewall rule". Firewall.cs asked for it
  // through runas and netsh when the own game folder was made. With the cause
  // gone there is nothing for a rule to answer, so neither the launcher nor
  // the installer writes one.
  const root = path.join(__dirname, '..');
  function sources(dir, out) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (d) {
      const full = path.join(dir, d.name);
      // Not the product's harnesses (launcher/tests, plan line 42), which
      // name the words they look for.
      if (d.isDirectory()) { if (d.name !== 'tests') { sources(full, out); } }
      else if (/\.(cs|ps1|axaml)$/i.test(d.name)) { out.push(full); }
    });
    return out;
  }
  const files = sources(path.join(root, 'launcher'), []).concat(sources(path.join(root, 'installer'), []));
  const asks = files.filter(function (f) {
    return /advfirewall|NetFirewallRule|"runas"/i.test(fs.readFileSync(f, 'utf8'));
  });
  yes('the launcher has no Firewall.cs', !fs.existsSync(path.join(root, 'launcher', 'app', 'Firewall.cs')));
  yes('nothing in the launcher or installer writes a firewall rule or asks for administrator' +
      (asks.length ? ' (' + asks.map(function (f) { return path.relative(root, f); }).join(', ') + ')' : ''),
      asks.length === 0);
  // The window's words are its compiled markup since #4823, and the installer
  // is the launcher's own Install*.cs since #4824.
  const app = path.join(root, 'launcher', 'app');
  const said = fs.readdirSync(app).filter(function (n) { return /\.axaml$|^Install.*\.cs$/i.test(n); });
  yes('the launcher\'s window markup and installer code are where this reads them', said.length > 0 &&
      said.some(function (n) { return /\.axaml$/i.test(n); }) && said.some(function (n) { return /^Install/i.test(n); }));
  const words = said.map(function (n) { return fs.readFileSync(path.join(app, n), 'utf8'); }).join('\n');
  yes('Settings and the installer no longer say Windows asks for administrator',
      !/asks for administrator/i.test(words));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
