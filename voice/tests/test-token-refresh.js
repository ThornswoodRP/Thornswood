/*
  How the game's chat overlay gets and spends its join tokens (#1322, #1337).

  A token opens one connection and goes with the handshake, so the overlay
  spends each one on a single try: it offers it as the protocol after
  'thornswood' and never in the join message, does not offer it again, asks
  the front for a new one ('token? <profile>') when it has none, and goes at
  once when setToken hands one over. It used to keep one token for the
  session and present it on every reconnect, which is what made a copied
  token as good as the real one.

  Runs the shipped game/ui/thornswood-chat.js in a sandboxed `window`, with a
  fake WebSocket that records what it was offered and sent, and timers this
  file fires by hand. Nothing here is a stand-in for the file under test.
*/
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'game', 'ui', 'thornswood-chat.js'), 'utf8');

let pass = 0, fail = 0;
function check(what, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + what + (ok ? '' : '  got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}

const made = [];
function FakeSocket(url, protocols) {
  made.push(this);
  this.url = url;
  this.protocols = protocols;
  this.readyState = 0;
  this.sent = [];
}
FakeSocket.prototype.send = function (m) { this.sent.push(JSON.parse(m)); };
FakeSocket.prototype.close = function () { if (this.readyState === 3) return; this.readyState = 3; if (this.onclose) this.onclose(); };
FakeSocket.prototype.open = function () { this.readyState = 1; if (this.onopen) this.onopen(); };
FakeSocket.prototype.welcome = function () { if (this.onmessage) this.onmessage({ data: JSON.stringify({ t: 'welcome', peer: 1 }) }); };

const asked = [];
let timers = [];
const win = {
  // The https address the launcher writes; there is no ws:// fallback (#1304).
  THORNSWOOD: { host: '127.0.0.1', port: 7778, profileId: 4242, name: 'tester', token: 'v2.4242.1.first',
                base: 'https://thornswood.net/voice' },
  skyrimPlatform: { sendMessage: (to, what) => { if (to === 'thornswood-front' && /^token\? /.test(what)) asked.push(what); } },
};
const sandbox = {
  window: win,
  WebSocket: FakeSocket,
  console,
  setTimeout: (fn) => { timers.push(fn); return timers.length; },
  clearTimeout: () => { timers = []; },
  // The page's own keepalive (issue #519) ticks on this; nothing here waits
  // long enough for it to matter.
  setInterval: () => 0,
  clearInterval: () => {},
};
vm.createContext(sandbox);
vm.runInContext(SRC, sandbox);
const fire = () => { const t = timers; timers = []; t.forEach((fn) => fn()); };
const net = win.thornswoodNet;

const first = made[0];
check('the first try offers the token it was injected with, after thornswood', first.protocols, ['thornswood', 'v2.4242.1.first']);
first.open();
check('and the join message carries no token', 'token' in first.sent[0], false);
first.welcome();

// A token handed over while the connection is up waits for the next try.
net.setToken('v2.4242.2.second');
check('a token handed over while connected opens nothing', made.length, 1);

// The connection drops: the next try spends the waiting token.
first.close();
fire();
check('the next try offers the token handed over meanwhile', made[1] && made[1].protocols, ['thornswood', 'v2.4242.2.second']);
check('and asked for nothing, since it had one', asked.length, 0);

// That one fails too, before it opened. No token left: ask, and do not try.
made[1].close();
fire();
check('with no token left, a try asks the front for one, for this character', asked, ['token? 4242']);
check('and opens nothing without one', made.length, 2);

// The front hands back the one already spent: still nothing.
net.setToken('v2.4242.2.second');
check('the token it already spent is not taken again', made.length, 2);

// The launcher's fresh one arrives: the waiting try goes at once.
net.setToken('v2.4242.3.third');
check('a fresh token goes at once, without waiting for the backoff', made.length, 3);
check('with that token', made[2].protocols, ['thornswood', 'v2.4242.3.third']);

// rejoinAs as another character: the old character's token is no use.
made[2].open();
made[2].welcome();
net.setToken('v2.4242.4.fourth');
check('rejoinAs another character returns true', net.rejoinAs(5151, 'v2.5151.5.theirs'), true);
fire();
const last = made[made.length - 1];
check('and the next try is that character\'s own token, not the one kept for the last character',
      last.protocols, ['thornswood', 'v2.5151.5.theirs']);
last.open();
check('joining as that character', last.sent[0].profileId, 5151);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
