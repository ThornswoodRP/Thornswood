// test-claim-held-keys.js
//
// A key that is down when a panel takes the keyboard comes up in the game
// when it is let go, and the panel takes the keyboard at once.
//
// WHAT WAS WRONG. Issues 528 and 898. Djinn on dev, 24 September: after
// picking a character F and the mouse wheel stopped at a very close third
// person view and Tab did not open the Tween Menu. His platform log: the party
// window claimed focus at 14:59:41.108 while Shift and P were down for the P
// in his name, and from then on the game repeated two held keys every frame,
// 1800 button events every five seconds at 180 frames a second, with no menu
// open and the controls on. While focus was up DInputHook.cpp in the fork read
// the keyboard buffer and handed the game none of it (*outDataLen = 0), key
// ups included, so a key up in that time was gone and the game kept the key
// down.
//
// Issue 528 made the front plugin hold a claim back until every key was up,
// for up to a second, and a key held past that was still left down. Issue 898
// fixes it in the fork: DInputHook filters the buffer through HeldKeyRelease
// (skyrim-platform\src\platform_lib, with its own unit test in
// unit\platform_lib_tests\HeldKeyReleaseTest.cpp). While the game listens
// every event goes through; while it does not, only the key up of a key the
// game holds goes through, once. The plugin no longer waits.
//
// THE PRETEND GAME. Every frame the keyboard changes are read first, through
// the fork's rule for the client under test, then the plugin's applyFocus
// runs. 'fixed' is HeldKeyRelease; 'old' is the empty buffer.
//
// Before the change (FRONT=<old thornswood-front.js>), the checks that the
// panel takes the keyboard on the frame it asks fail: the old plugin waits.
// The 'old' client runs show what the fork change is for: with it, the game is
// left holding the key.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const SRC = process.env.FRONT ||
            path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function skip(what) { console.log('SKIP  ' + what); }
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

function between(start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b);
}

// The claims, the menu questions and applyFocus, as test-f6-focus.js takes them.
const arbiter = between('  const claims = {};', '  /*\n    WHEN EACH CLAIM WENT UP');
yes('the focus arbiter is in the plugin', arbiter !== null);
if (!arbiter) { done(); }

const SHIFT = 42;
const P = 25;
const K = 37;
const TAB = 15;
const FRAME_MS = 6;       // 180 frames a second, as in Djinn's log

function rig(client) {
  const clock = { t: 1000000 };
  const game = {
    focused: false,
    menus: new Set(),
    fingers: new Set(),    // what is under the fingers: SKSE's count
    held: new Set(),       // what the game believes is down
    heard: []              // every event the game was handed
  };
  const said = [];
  const T = { ready: true };
  const sp = {
    browser: {
      isFocused: function () { return game.focused; },
      setFocused: function (v) { game.focused = !!v; }
    },
    Ui: { isMenuOpen: function (n) { return game.menus.has(n); } },
    Utility: { isInMenuMode: function () { return game.menus.size > 0 || game.focused; } },
    Input: {
      getNumKeysPressed: function () { return game.fingers.size; },
      isKeyPressed: function (k) { return game.fingers.has(k); }
    }
  };
  const say = function (t) { said.push(String(t)); };
  const DateFake = { now: function () { return clock.t; } };
  const fn = new Function('sp', 'say', 'Date', 'ESC', 'wantTyping', 'T',
    arbiter + '\nreturn { claims: claims, applyFocus: applyFocus };');
  const api = fn(sp, say, DateFake, 1, function () { }, T);

  // The fork's GetDeviceData for the keyboard, for the client under test.
  // forkHeld is HeldKeyRelease's own table: the keys the game was told are down.
  const forkHeld = new Set();
  function deliver(c) {
    const listening = !game.focused;
    let pass;
    if (client === 'fixed') {
      if (listening) {
        pass = true;
        if (c.down) { forkHeld.add(c.code); } else { forkHeld.delete(c.code); }
      } else {
        pass = !c.down && forkHeld.has(c.code);
        if (pass) { forkHeld.delete(c.code); }
      }
    } else {
      pass = listening;
    }
    if (!pass) { return; }
    game.heard.push(c);
    if (c.down) { game.held.add(c.code); } else { game.held.delete(c.code); }
  }

  const queued = [];
  const r = { clock: clock, game: game, said: said, api: api };
  r.frame = function () {
    while (queued.length) {
      const c = queued.shift();
      if (c.down) { game.fingers.add(c.code); } else { game.fingers.delete(c.code); }
      deliver(c);
    }
    api.applyFocus();
    clock.t += FRAME_MS;
  };
  r.frames = function (n) { for (let i = 0; i < n; i++) { r.frame(); } };
  r.down = function (code) { queued.push({ code: code, down: true }); };
  r.up = function (code) { queued.push({ code: code, down: false }); };
  return r;
}

// ------------------------------------------ Shift P, as in Djinn's session
{
  const r = rig('fixed');
  r.down(SHIFT);
  r.frames(10);
  r.down(P);
  r.frame();
  r.api.claims.party = true;     // P opened the party window and it said so
  r.frame();
  yes('Shift P: the party window takes the keyboard on the frame it asks, keys down or not',
      r.game.focused);
  r.frames(12);
  r.up(P);
  r.frames(5);
  r.up(SHIFT);
  r.frames(2);
  yes('Shift P: the window still has the keyboard', r.game.focused);
  yes('Shift P: and the game is not left holding Shift or P',
      !r.game.held.has(SHIFT) && !r.game.held.has(P));
  r.api.claims.party = false;
  r.frames(2);
  yes('Shift P: closing the window gives the keyboard back', !r.game.focused);
  yes('Shift P: and nothing was logged about waiting', r.said.length === 0);
}

// ----------------------------------------------------- K, as in Blade's
{
  const r = rig('fixed');
  r.down(K);
  r.frame();
  r.api.claims.skills = true;
  r.frame();
  yes('K: the skills panel has the keyboard while K is still down', r.game.focused);
  r.frames(15);
  r.up(K);
  r.frames(2);
  yes('K: and the game did not keep K down', !r.game.held.has(K));
}

// ----------------------------------------------- typing reaches the page only
{
  const r = rig('fixed');
  r.down(K);
  r.frame();
  r.api.claims.skills = true;
  r.frame();
  const before = r.game.heard.length;
  r.up(K);
  r.down(SHIFT); r.down(P); r.up(P); r.up(SHIFT);
  r.down(TAB); r.up(TAB);
  r.frames(3);
  const got = r.game.heard.slice(before);
  yes('typing in the panel: the game hears only K coming up',
      got.length === 1 && got[0].code === K && !got[0].down);
  yes('typing in the panel: the game holds nothing', r.game.held.size === 0);
}

// ------------------------------------------------ a key held on and on
{
  const r = rig('fixed');
  r.down(K);
  r.frame();
  r.api.claims.skills = true;
  r.frames(Math.ceil(3000 / FRAME_MS));
  yes('a key held for seconds does not hold the panel back', r.game.focused);
  yes('and nothing is logged about it', r.said.length === 0);
  r.up(K);
  r.frames(2);
  yes('and it comes up in the game when it is let go, panel still open',
      r.game.focused && !r.game.held.has(K));
}

// ----------------------------------- a key held right through the panel
{
  const r = rig('fixed');
  r.down(SHIFT);
  r.frame();
  r.api.claims.party = true;
  r.frames(5);
  r.api.claims.party = false;
  r.frames(2);
  yes('a key held right through the panel: the keyboard is given back',
      !r.game.focused);
  yes('the game still has it down, as it is', r.game.held.has(SHIFT));
  r.up(SHIFT);
  r.frame();
  yes('and it comes up when it is let go', !r.game.held.has(SHIFT));
}

// ------------------------------------------- letting go is never held back
{
  const r = rig('fixed');
  r.api.claims.skills = true;
  r.frames(2);
  r.down(K);                      // K again, to close it
  r.frame();
  r.api.claims.skills = false;
  r.frames(1);
  yes('a claim that goes away gives the keyboard back even with a key down',
      !r.game.focused);
}

// ------------------------------- what the fork change is for: the old client
{
  const r = rig('old');
  r.down(SHIFT);
  r.down(P);
  r.frame();
  r.api.claims.party = true;
  r.frame();
  r.up(P);
  r.up(SHIFT);
  r.frames(3);
  r.api.claims.party = false;
  r.frames(2);
  yes('the old client (empty buffer) is what left Shift and P held',
      r.game.held.has(SHIFT) && r.game.held.has(P));
}

// ------------------------------------------------------------- the wiring
{
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  yes('applyFocus no longer holds a claim back for held keys',
      !/keysUpForClaim|CLAIM_WAIT_MS|claimWaitSince/.test(code));
  yes('the idle watch still has keysHeldNow', /function keysHeldNow\(\)/.test(code));
}

// ------------------------------------------ the fork, when it is checked out
{
  const fork = path.join(REPO_DIR, 'engine', 'skymp');
  const lib = path.join(fork, 'skyrim-platform', 'src', 'platform_lib', 'HeldKeyRelease.cpp');
  const hook = path.join(fork, 'skyrim-platform', 'src', 'tilted', 'hooks', 'DInputHook.cpp');
  const unit = path.join(fork, 'unit', 'platform_lib_tests', 'HeldKeyReleaseTest.cpp');
  if (!fs.existsSync(hook)) {
    skip('the fork is not checked out at engine\\skymp; its unit test HeldKeyReleaseTest.cpp covers the C++');
  } else {
    const hl = fs.existsSync(lib) ? fs.readFileSync(lib, 'utf8').split(CR).join('') : '';
    const dh = fs.readFileSync(hook, 'utf8').split(CR).join('');
    yes('the fork has HeldKeyRelease with the rule this pretend game keeps',
        /pass = known && !down && held\[code\];/.test(hl));
    yes('DInputHook filters the game\'s keyboard read through it',
        /g_heldKeys\.Filter\(/.test(dh));
    yes('DInputHook no longer empties the buffer whenever focus is up',
        !/if \(DInputHook::ChromeFocus\(\) \|\| !ShouldReadInput\(\)\) \{/.test(dh));
    yes('the fork has the unit test', fs.existsSync(unit));
  }
}

done();
