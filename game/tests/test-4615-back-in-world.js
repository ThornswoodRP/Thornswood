// test-4615-back-in-world.js
//
//     node game/tests/test-4615-back-in-world.js
//
// Coming back into the world after leaving it (#4615). Every way out of the
// world clears __thornswoodInWorld and quits to the main menu, and only the
// first arrival set the flag again, so after a return the idle check, the end
// of the choice and everything else that asks whether the world is there
// stayed off for the rest of the game.
//
// The real cameBack, lifted out of thornswood-front.js, runs against a
// stand-in game: the old world for a few frames while the quit lands, the main
// menu, the loading screen, then the world. It must set the flag only once the
// world is back, never in the frames before the main menu (that would tell
// skymp5-client it is already in a game, and the pick would load no world),
// and take a choice still up down the way the first arrival does.
//
// Read only.
const fs = require('fs');
const path = require('path');
const REPO_DIR = path.join(__dirname, '..', '..');
const SRC = process.env.FRONT || path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js');
const src = fs.readFileSync(SRC, 'utf8').split(String.fromCharCode(13)).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

/** One whole two-space-indented function, by its first line. */
function lift(first) {
  const a = src.indexOf(first);
  if (a < 0) { return null; }
  const b = src.indexOf('\n  }\n', a);
  return b < 0 ? null : src.slice(a, b + 4);
}

const came = lift('  function cameBack(now) {');
yes('cameBack is in the plugin', came !== null);

// The tick asks it on every frame after the first arrival, before anything
// else the world frame does.
const tickAt = src.indexOf("sp.on('update', guard('tick', () => {");
const firstArrival = src.indexOf('    if (phase === 0) {', tickAt);
const asks = src.indexOf('    if (cameBack(now)) { return; }', tickAt);
const arbiter = src.indexOf('    if (phase >= 2) {', tickAt);
yes('the tick asks after the first arrival and before the focus arbiter',
    tickAt > 0 && firstArrival > tickAt && asks > firstArrival && arbiter > asks);

// Every way out clears the flag, which is what cameBack waits on.
const ways = [
  ['the idle check', '  function afkOut(why) {'],
  ['the server ending the session', '  function sessionEnded(sentence) {'],
  ['a refused connection', '  function connectionDenied(reason) {'],
  ['Change character', '  function switchLeave() {']
];
for (const [what, first] of ways) {
  const body = lift(first);
  yes('leaving through ' + what + ' clears the world flag and goes to the main menu',
      body !== null && body.indexOf('globalThis.__thornswoodInWorld = false') !== -1 &&
      body.indexOf('quitToMainMenu') !== -1);
}

function game() {
  const g = {
    menus: { 'Main Menu': false, 'Loading Menu': false },
    player: { id: 0x14 },
    choice: false,
    gone: 0,
    logs: [],
    world: { __thornswoodInWorld: false }
  };
  const sp = {
    Ui: { isMenuOpen: function (name) { return !!g.menus[name]; } },
    Game: { getPlayer: function () { return g.player; } }
  };
  const gameMenuOpen = function () {
    for (const k in g.menus) { if (g.menus[k]) { return true; } }
    return false;
  };
  const choiceUp = function () { return g.choice; };
  const menuGone = function () { g.gone++; g.choice = false; };
  const log = function () { g.logs.push(Array.prototype.join.call(arguments, ' ')); };
  const fn = new Function('sp', 'globalThis', 'gameMenuOpen', 'choiceUp', 'menuGone', 'log', 'PROFILE',
    'let menuPhase = 0;\n' + 'let awaySawMenu = false;\n' + came +
    '\nreturn { frame: cameBack, menuPhase: function () { return menuPhase; } };');
  g.api = fn(sp, g.world, gameMenuOpen, choiceUp, menuGone, log, 7);
  g.frames = function (n) { let any = false; for (let i = 0; i < n; i++) { any = g.api.frame(i) || any; } return any; };
  return g;
}

if (came) {
  // R1: in the world, nothing to do.
  {
    const g = game();
    g.world.__thornswoodInWorld = true;
    yes('R1 in the world, it does nothing', !g.frames(20) && g.logs.length === 0);
  }

  // R2: THE BUG. Out to the choice and back in.
  {
    const g = game();
    g.world.__thornswoodInWorld = true;
    g.frames(5);
    // The way out clears the flag; the old world is there for a few frames.
    g.world.__thornswoodInWorld = false;
    g.frames(10);
    yes('R2 the frames before the main menu do not count as arriving',
        g.world.__thornswoodInWorld === false);
    g.menus['Main Menu'] = true;
    g.choice = true;
    g.frames(30);
    yes('R2 nor does the main menu', g.world.__thornswoodInWorld === false);
    // The pick closes the choice, then the loading screen.
    g.choice = false;
    g.menus['Main Menu'] = false;
    g.menus['Loading Menu'] = true;
    g.frames(30);
    yes('R2 nor the loading screen', g.world.__thornswoodInWorld === false);
    g.menus['Loading Menu'] = false;
    const arrived = g.frames(1);
    yes('R2 THE BUG: back in the world, it is marked as back',
        arrived && g.world.__thornswoodInWorld === true);
    yes('R2 the menu stands down', g.api.menuPhase() === 9);
    yes('R2 and says so in the log', g.logs.join('\n').indexOf('back in the world as profile 7') !== -1);
    yes('R2 a choice already closed by the pick is left alone', g.gone === 0);
    yes('R2 once, not every frame after', !g.frames(50) && g.logs.length === 1);
  }

  // R3: the world loads with the choice still up (the client's own fallback).
  {
    const g = game();
    g.menus['Main Menu'] = true;
    g.choice = true;
    g.frames(5);
    g.menus['Main Menu'] = false;
    g.frames(1);
    yes('R3 a choice still up is taken down, as at the first arrival',
        g.world.__thornswoodInWorld === true && g.gone === 1);
  }

  // R4: out and back twice.
  {
    const g = game();
    for (let round = 1; round <= 2; round++) {
      g.world.__thornswoodInWorld = false;
      g.frames(3);
      g.menus['Main Menu'] = true;
      g.frames(3);
      g.menus['Main Menu'] = false;
      g.frames(3);
    }
    yes('R4 each return is marked', g.world.__thornswoodInWorld === true &&
        g.logs.filter(function (l) { return l.indexOf('back in the world') !== -1; }).length === 2);
  }

  // R5: no character yet after the menu, so nothing is claimed.
  {
    const g = game();
    g.menus['Main Menu'] = true;
    g.frames(2);
    g.menus['Main Menu'] = false;
    g.player = null;
    g.frames(10);
    yes('R5 no character, no arrival', g.world.__thornswoodInWorld === false);
    g.player = { id: 0x14 };
    g.frames(1);
    yes('R5 then the character is there, and it is', g.world.__thornswoodInWorld === true);
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
