// test-voice-reconnect.js
//
// Issues #409 and #519: how the two clients that hold a socket to the voice
// service lose it and find it again.
//
// On 21 September the launcher's voice page opened its socket 592 times, every
// two seconds, and launcher.log has both halves of why. From 19:09 the Wi-Fi
// was down and the machine slept at 19:39: 425 tries that never opened. It
// woke at 20:06 holding a join token that had expired at 20:02; the service
// refused it and closed, the page never read the refusal, and it came back
// with the same token every two seconds, 134 times, until the launcher's own
// renewal got through at 20:11.
//
// And a socket that went half open during a sleep or a change of network
// looked, to both clients, exactly like a quiet room: the service's pings are
// answered by the socket without the client ever hearing of them.
//
// Since #1322 and #1337 a token opens one connection and goes with the
// handshake, so each try asks for a fresh token first (the launcher's voice
// asks the launcher, the game's overlay asks the front) and a refused token
// is a handshake that never opens. The launcher here answers an ask 300 ms
// later, as its fetch would.
//
// Since #4823 the launcher's voice is C#, launcher\app\VoiceSession.cs, not
// voice-host.html. This runs that class itself (tests\voice-launcher.js
// builds it with the .NET 10 SDK) on a clock this file moves by hand and
// sockets this file answers for the service, and the REAL script of
// game/ui/thornswood-chat.js in a sandbox with a fake socket and a clock of
// the same kind, and replays both halves of that evening. Read only, but for
// the driver's build in the temp folder.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const VL = require('./voice-launcher');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const CR = String.fromCharCode(13);
function read(rel) { return fs.readFileSync(path.join(__dirname, rel), 'utf8').split(CR).join(''); }

/* A clock and timers that only move when advance() says so. */
function clock() {
  let now = 1000000;
  let next = 1;
  const timers = [];
  function add(fn, ms, every) {
    const t = { id: next++, fn: fn, at: now + Math.max(0, ms || 0), every: every ? Math.max(1, ms) : 0 };
    timers.push(t);
    return t.id;
  }
  function clear(id) {
    const i = timers.findIndex((t) => t.id === id);
    if (i !== -1) { timers.splice(i, 1); }
  }
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      let due = null;
      for (const t of timers) { if (t.at <= end && (!due || t.at < due.at)) { due = t; } }
      if (!due) { break; }
      now = due.at;
      if (due.every) { due.at += due.every; } else { clear(due.id); }
      due.fn();
    }
    now = end;
  }
  return {
    now: function () { return now; },
    setTimeout: function (fn, ms) { return add(fn, ms, false); },
    setInterval: function (fn, ms) { return add(fn, ms, true); },
    clear: clear,
    advance: advance
  };
}

/*
  The socket the chat overlay holds. open() and refuse() and vanish() are the
  three things the voice service can do to it; sent is what the page wrote,
  token the token it offered with the handshake.
*/
function sockets() {
  const made = [];
  function FakeSocket(url, protocols) {
    this.url = url; this.readyState = 0; this.sent = []; this.closed = false;
    this.protocols = protocols || [];
    this.token = (protocols && protocols[0] === 'thornswood') ? protocols[1] : '';
    made.push(this);
  }
  FakeSocket.prototype.send = function (s) { this.sent.push(JSON.parse(s)); };
  FakeSocket.prototype.close = function () {
    if (this.closed) { return; }
    this.closed = true; this.readyState = 3;
    if (this.onclose) { this.onclose({}); }
  };
  FakeSocket.prototype.open = function () { this.readyState = 1; if (this.onopen) { this.onopen({}); } };
  FakeSocket.prototype.say = function (obj) { if (this.onmessage) { this.onmessage({ data: JSON.stringify(obj) }); } };
  /* The service refuses the token at the handshake (#1337): 403, and the
     socket never opens. */
  FakeSocket.prototype.refuse = function () { this.close(); };
  /* Let in. */
  FakeSocket.prototype.admit = function (peer) { this.open(); this.say({ t: 'welcome', peer: peer, profileId: 7 }); };
  return { FakeSocket: FakeSocket, made: made };
}

// ------------------------------------------------- the launcher's voice
/*
  The session's backoff waits a random half to whole of its cap. With a real
  random number a count could land either side of a bound from one run to
  the next (13 tries against 12 on the build runner, 20 Oct), so the driver
  always answers `jitter`: 0 is the shortest waits and so the most tries,
  0.999 the longest, and 0.5 is every other test here.

  Each socket the session opens is a dial the harness answers: admit (the
  handshake is answered and the welcome said), refuse (403, or a network
  that is down: the handshake never opens), say, close. The launcher's side
  of a token ask is the driver's 'tokens': every ask answered 300 ms later
  on the session's clock, as Voice.cs answers after its fetch.
*/
const BASE = 'https://example.invalid/voice';
const launchers = [];
async function launcher(jitter, gives) {
  const l = await VL.start({ clock: 'manual', wire: 'fake', jitter: jitter === undefined ? 0.5 : jitter });
  launchers.push(l);
  await l.send({ do: 'tokens', give: gives !== false, delay: 300, why: 'no answer from the site' });
  l.last = function () { const d = l.dials(); return d[d.length - 1]; };
  l.open = function (n) { return !l.closed(n) && l.sent(n).length > 0; };
  // The newest socket: still waiting on its handshake, open, or gone.
  l.waiting = function () { const d = l.last(); return !!d && !l.closed(d.n) && !l.admitted[d.n] && !l.refused[d.n]; };
  l.admitted = {};
  l.refused = {};
  l.refuse = function (n) { l.refused[n] = true; return l.send({ do: 'refuse', n: n }); };
  l.admit = async function (n, peer) {
    l.admitted[n] = true;
    await l.send({ do: 'admit', n: n });
    await l.send({ do: 'say', n: n, msg: { t: 'welcome', peer: peer, profileId: 7 } });
  };
  l.advance = function (ms) { return l.send({ do: 'advance', ms: ms }); };
  l.configure = function (token) { return l.send({ do: 'configure', profileId: 7, name: '', token: token, base: BASE }); };
  l.asks = function () { return l.host('token').filter((t) => t === 'need').length; };
  return l;
}

async function launcherHalf() {
  const p = await launcher();
  await p.configure('old');
  yes('the session opens a socket once it is configured', p.dials().length === 1);
  yes('offering the config\'s token with the handshake, after thornswood',
      p.dials()[0].protocols[0] === 'thornswood' && p.dials()[0].protocols[1] === 'old' && p.dials()[0].url.indexOf('old') < 0);

  /*
    19:09 to 19:39: the network is down, so no try ever opens. Thirty minutes
    of it, which at two seconds was 425 tries in the log. Each second, the
    newest try that is still waiting fails, as the old harness failed the
    page's.
  */
  for (let i = 0; i < 30 * 60; i++) {
    if (p.waiting()) { await p.refuse(p.last().n); }
    await p.advance(1000);
  }
  const offline = p.dials().length - 1;
  console.log('      thirty minutes with no network: ' + offline + ' tries (the old page made about 900)');
  yes('thirty minutes offline is a few dozen tries, not hundreds', offline > 10 && offline <= 60);
  yes('and it keeps trying at least once a minute', 30 * 60 * 1000 / Math.max(1, offline) <= 60000);
  const tokens = p.dials().map((d) => d.protocols[1]);
  yes('every try offered a token of its own, none twice (#1322)',
      tokens.every((t) => !!t) && new Set(tokens).size === tokens.length);
  // One ask a try, and the last ask can still be waiting on its answer when
  // the half hour ends: the backoff is random, so either is right.
  const asked = p.asks();
  yes('each one asked the launcher for first (' + asked + ' asks, ' + offline + ' tries)', asked === offline || asked === offline + 1);

  /*
    20:06: back, and the service refuses the token at the handshake. The
    session must not come straight back, and its next try has a fresh token.
  */
  for (let i = 0; i < 120 && !p.waiting(); i++) { await p.advance(1000); }
  const refusedAt = p.dials().length;
  const w = p.last();
  await p.refuse(w.n);
  await p.advance(500);
  yes('a refused handshake is not tried again at once', p.dials().length === refusedAt);
  for (let i = 0; i < 120 && p.dials().length === refusedAt; i++) { await p.advance(1000); }
  const retried = p.last();
  yes('the next try, after the backoff, offers a fresh token and not the refused one',
      p.dials().length === refusedAt + 1 && !!retried.protocols[1] && retried.protocols[1] !== w.protocols[1]);
  await p.admit(retried.n, 3);
  const join = p.sent(retried.n).filter((m) => m.t === 'join')[0];
  yes('and the join message carries no token', !!join && !('token' in join));

  /*
    Five minutes of refused handshakes, the old page's 134 tries: a fresh
    token every time, so only the backoff holds it down.
  */
  for (const jitter of [0, 0.999]) {
    const q = await launcher(jitter);
    await q.configure('dead');
    for (let i = 0; i < 300; i++) {
      if (q.waiting()) { await q.refuse(q.last().n); }
      await q.advance(1000);
    }
    console.log('      five minutes of refusals, jitter ' + jitter + ': ' + q.dials().length + ' tries (the old page made 134 in the same five minutes)');
    // At the shortest waits (half of each cap: 1, 2, 4, 8 and 16 seconds, then
    // 30) five minutes holds 14 tries, against the old page's 134.
    yes('five minutes of refusals is a handful of tries, jitter ' + jitter, q.dials().length <= 14);
  }
  // And the half hour offline at both ends.
  for (const jitter of [0, 0.999]) {
    const o = await launcher(jitter);
    await o.configure('old');
    for (let i = 0; i < 30 * 60; i++) {
      if (o.waiting()) { await o.refuse(o.last().n); }
      await o.advance(1000);
    }
    const n = o.dials().length - 1;
    console.log('      thirty minutes with no network, jitter ' + jitter + ': ' + n + ' tries');
    // At the shortest waits: 5 tries in the first 31 seconds, then one every
    // 30 at most, so no more than 64 in the half hour.
    yes('thirty minutes offline is a few dozen tries, jitter ' + jitter, n > 10 && n <= 64);
  }

  // The launcher has no token to give: the session waits and asks again, and
  // never opens a socket without one.
  const e = await launcher(0.5, false);
  await e.configure('');
  await e.advance(5 * 60000);
  const asks = e.asks();
  yes('with no token to be had, nothing is opened', e.dials().length === 0);
  yes('and the launcher is asked again on the backoff, not every moment (' + asks + ' asks in five minutes)', asks >= 3 && asks <= 15);
  await e.send({ do: 'tokens', give: true, delay: 300 });
  await e.advance(61000);
  yes('and once it has one, the session connects with it', e.dials().length === 1 && /^fresh-/.test(e.dials()[0].protocols[1]));

  // Once in, the next loss starts again from about two seconds.
  const r = await launcher();
  await r.configure('t');
  for (let i = 0; i < 6; i++) { await r.refuse(r.last().n); await r.advance(70000); }
  await r.admit(r.last().n, 4);
  const n = r.dials().length;
  await r.send({ do: 'close', n: r.last().n });
  await r.advance(2400);
  yes('once let in, a later loss is retried within two seconds again, and the token\'s fetch', r.dials().length === n + 1);

  /*
    #519. Joined, and then nothing: the socket has gone half open. The
    session pings every twenty five seconds, and seventy seconds of silence
    is a lost server even though the socket never said it closed.
  */
  const h = await launcher();
  await h.configure('t');
  const live = h.last().n;
  await h.admit(live, 5);
  await h.advance(26000);
  yes('a joined session pings the service', h.sent(live).some((m) => m.t === 'ping'));
  // Answered: kept, however long.
  for (let i = 0; i < 20; i++) { await h.advance(25000); await h.send({ do: 'say', n: live, msg: { t: 'pong' } }); }
  yes('a session whose pings are answered keeps its socket', h.dials().length === 1 && !h.closed(live));
  // Then nothing comes back at all.
  await h.advance(75000);
  const lost = h.closed(live);
  await h.advance(3000);
  yes('seventy seconds with nothing from the service and the session looks for it again',
      lost && h.dials().length === 2);
  yes('and says so in the log', h.says(/^nothing from the voice server for \d+ s, so looking for it again$/));

  for (const l of launchers) {
    const sw = l.swallowed();
    yes('the session swallowed nothing' + (sw ? ':\n' + sw : ''), !sw);
    await l.quit();
  }
}

// ------------------------------------------------ the game's chat overlay
function chatPage() {
  const src = read('../game/ui/thornswood-chat.js');
  const c = clock();
  const s = sockets();
  const lines = [];
  const asks = [];
  let minted = 0;
  // The front and the launcher: an ask is answered 300 ms later with a fresh
  // token, handed in through setToken as the front does.
  const win = {
    THORNSWOOD: { host: 'h', port: 1, profileId: 7, name: 'Tester', token: 't',
                  base: 'https://example.invalid/voice' },
    thornswoodChat: { add: function (parts) { lines.push(parts.map((p) => p.text).join('')); } },
    skyrimPlatform: { sendMessage: function (to, what) {
      if (to !== 'thornswood-front' || !/^token\? /.test(String(what))) { return; }
      asks.push(what);
      c.setTimeout(function () { win.thornswoodNet.setToken('c-' + (++minted)); }, 300);
    } }
  };
  const sandbox = {
    window: win, WebSocket: s.FakeSocket,
    setTimeout: c.setTimeout, clearTimeout: c.clear,
    setInterval: c.setInterval, clearInterval: c.clear,
    console: console, Math: Math, Number: Number, String: String, JSON: JSON,
    Date: { now: c.now }, Object: Object, Array: Array, isFinite: isFinite, parseInt: parseInt
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { clock: c, made: s.made, lines: lines, net: win.thornswoodNet, asks: asks };
}

function chatHalf() {
  const p = chatPage();
  yes('the chat overlay opens its socket', p.made.length === 1);
  const ws = p.made[0];
  ws.admit(9);
  p.clock.advance(26000);
  yes('a joined chat overlay pings the service', ws.sent.some((m) => m.t === 'ping'));
  for (let i = 0; i < 10; i++) { p.clock.advance(25000); ws.say({ t: 'pong' }); }
  yes('and keeps its socket while the pings are answered', !ws.closed && p.made.length === 1);
  yes('a pong is not a chat line', !p.lines.some((l) => /pong/.test(l)));
  p.clock.advance(75000);
  yes('seventy seconds of silence is said as a lost server',
      ws.closed && p.lines.some((l) => /lost the server/.test(l)));
  p.clock.advance(3000);
  yes('and it tries again', p.made.length === 2);
  yes('having asked the front for a token of its own, for its character', p.asks[0] === 'token? 7');
  yes('and offers that one, not the one it spent', p.made[1].token === 'c-1' && p.made[0].token === 't');

  // A refused handshake never opens; a fresh token each time, and the
  // backoff holds it down.
  const q = chatPage();
  for (let i = 0; i < 300; i++) {
    const last = q.made[q.made.length - 1];
    if (!last.closed) { last.refuse(); }
    q.clock.advance(1000);
  }
  const qt = q.made.map((w) => w.token);
  console.log('      chat overlay, five minutes of refusals: ' + q.made.length +
              ' tries (it reset its backoff on every open, so a refused join came back every second)');
  yes('the chat overlay does not retry a refused join every second', q.made.length <= 25);
  yes('and never offers one token twice', new Set(qt).size === qt.length);
}

launcherHalf().then(() => {
  chatHalf();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}).catch(async (e) => {
  console.log('FAIL  the harness itself: ' + (e && e.stack || e));
  for (const l of launchers) { await l.quit(); }
  process.exitCode = 1;
});
