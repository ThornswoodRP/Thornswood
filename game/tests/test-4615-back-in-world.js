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
// The real loadGame handler and cameBack, lifted out of thornswood-front.js,
// run against a stand-in game that sends update the way SkyrimPlatform does:
// from the Papyrus VM's OnUpdate, so never while the main menu is up. The
// flag must go up only once the world is back (a load while it was down, a
// character, no menu, connected), never in the old world's last frames before
// the main menu (that would tell skymp5-client it is already in a game, and
// the pick would load no world), and a choice still up comes down the way the
// first arrival takes it down.
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
/** A two-space-indented sp.on(...) block, by its first line. */
function liftOn(first) {
  const a = src.indexOf(first);
  if (a < 0) { return null; }
  const b = src.indexOf('\n  }));\n', a);
  return b < 0 ? null : src.slice(a, b + 7);
}

const came = lift('  function cameBack(now) {');
const onLoad = liftOn("  sp.on('loadGame', guard('world load', () => {");
const onPlace = liftOn("  sp.on('update', guard('place', () => {");
yes('cameBack is in the plugin', came !== null);
yes('and the world load it waits on', onLoad !== null);
yes('the place report samples the world', onPlace !== null);

// The tick asks it on every frame after the first arrival, before anything
// else the world frame does.
const tickAt = src.indexOf("sp.on('update', guard('tick', () => {");
const firstArrival = src.indexOf('    if (phase === 0) {', tickAt);
const asks = src.indexOf('    if (cameBack(now)) { return; }', tickAt);
const arbiter = src.indexOf('    if (phase >= 2) {', tickAt);
yes('the tick asks after the first arrival and before the focus arbiter',
    tickAt > 0 && firstArrival > tickAt && asks > firstArrival && arbiter > asks);

// Every way out clears the flag and closes the connection before the quit,
// which is what cameBack's two waits stand on.
const ways = [
  ['the idle check', '  function afkOut(why) {'],
  ['the server ending the session', '  function sessionEnded(sentence) {'],
  ['a refused connection', '  function connectionDenied(reason) {'],
  ['Change character', '  function switchLeave() {']
];
for (const [what, first] of ways) {
  const body = lift(first);
  const flag = body ? body.indexOf('globalThis.__thornswoodInWorld = false') : -1;
  const closed = body ? body.indexOf('destroyClient()') : -1;
  const quit = body ? body.indexOf('quitToMainMenu()') : -1;
  yes('leaving through ' + what + ' clears the flag and closes the connection before the main menu',
      flag !== -1 && closed !== -1 && quit !== -1 && flag < quit && closed < quit);
}

function game() {
  const actorAtHearth = {
    getPositionX: () => 0, getPositionY: () => 0, getPositionZ: () => 0,
    isSwimming: () => false, getParentCell: () => null
  };
  const g = {
    menus: { 'Main Menu': false, 'Loading Menu': false },
    player: actorAtHearth,
    connected: true,
    choice: false,
    gone: 0,
    logs: [],
    placeReports: [],
    fireDistance: 125,
    world: { __thornswoodInWorld: true },
    clock: 1000000
  };
  const handlers = {};
  const sp = {
    on: function (name, fn) { handlers[name] = fn; },
    Game: { getPlayer: function () { return g.player; } },
    Weather: { getCurrentWeather: () => null },
    mpClientPlugin: { isConnected: function () { return g.connected; } }
  };
  const gameMenuOpen = function () {
    for (const k in g.menus) { if (g.menus[k]) { return true; } }
    return false;
  };
  const choiceUp = function () { return g.choice; };
  const menuGone = function () { g.gone++; g.choice = false; };
  const log = function () { g.logs.push(Array.prototype.join.call(arguments, ' ')); };
  const guard = function (name, fn) { return fn; };
  const clockDate = { now: function () { return g.clock; } };
  const fn = new Function('sp', 'globalThis', 'gameMenuOpen', 'choiceUp', 'menuGone', 'log', 'guard', 'Date', 'PROFILE', 'tellServer', 'fireDistance',
    'let menuPhase = 0;\nlet loadedOutOfWorld = 0;\n' +
    'let placeAt = 0, placeSaid = "", placeFire = -1, placeBeat = 0, fireFlame = -1;\n' +
    'const FIRE_INSIDE = 90, PLACE_FAST = 250, PLACE_SLOW = 1000, PLACE_BEAT = 30000;\n' +
    'const say = () => {};\n' + onLoad + '\n' + came + '\n' + onPlace +
    '\nreturn { frame: cameBack, menuPhase: function () { return menuPhase; } };');
  g.api = fn(sp, g.world, gameMenuOpen, choiceUp, menuGone, log, guard, clockDate, 7,
    line => g.placeReports.push(line), () => g.fireDistance);
  g.samplePlace = () => {
    g.clock += 1000;
    handlers.update();
  };
  // Update frames: none while the main menu is up, as in the game.
  g.frames = function (n) {
    let any = false;
    for (let i = 0; i < n; i++) {
      g.clock += 16;
      if (g.menus['Main Menu']) { continue; }
      any = g.api.frame(g.clock) || any;
    }
    return any;
  };
  g.load = function () { handlers.loadGame(); };
  // A way out: flag down and connection closed, then a few frames of the old
  // world while the quit lands, then the main menu.
  g.leave = function () {
    g.world.__thornswoodInWorld = false;
    g.connected = false;
    g.frames(10);
    g.menus['Main Menu'] = true;
  };
  // A pick: connect again, the load, the loading screen, the world.
  g.pick = function () {
    g.choice = false;
    g.connected = true;
    g.menus['Main Menu'] = false;
    g.menus['Loading Menu'] = true;
    g.load();
    g.frames(30);
    g.menus['Loading Menu'] = false;
  };
  return g;
}

if (came && onLoad && onPlace) {
  // R1: in the world, a save something else loads is not an arrival.
  {
    const g = game();
    g.load();
    yes('R1 in the world, nothing to do', !g.frames(20) && g.logs.length === 0);
  }

  // R2: THE BUG. Out to the choice and back in.
  {
    const g = game();
    g.frames(5);
    g.leave();
    yes('R2 the old world\'s last frames do not count as arriving',
        g.world.__thornswoodInWorld === false);
    g.choice = true;
    g.frames(30);
    g.pick();
    yes('R2 nor does the loading screen', g.world.__thornswoodInWorld === false);
    const arrived = g.frames(1);
    yes('R2 THE BUG: back in the world, it is marked as back',
        arrived && g.world.__thornswoodInWorld === true);
    yes('R2 the menu stands down', g.api.menuPhase() === 9);
    yes('R2 and says so in the log', g.logs.join('\n').indexOf('back in the world as profile 7') !== -1);
    yes('R2 a choice already closed by the pick is left alone', g.gone === 0);
    yes('R2 once, not every frame after', !g.frames(50) && g.logs.length === 1);
  }

  // R3: the old world's last frames still connected (a quit before the close
  // lands): no load since the flag went down, so no arrival.
  {
    const g = game();
    g.world.__thornswoodInWorld = false;
    g.frames(10);
    yes('R3 no load since leaving, no arrival even while connected',
        g.world.__thornswoodInWorld === false);
  }

  // R4: the load came, but the connection did not.
  {
    const g = game();
    g.leave();
    g.pick();
    g.connected = false;
    g.frames(20);
    yes('R4 a world with no connection is not the server\'s world',
        g.world.__thornswoodInWorld === false);
    g.connected = true;
    g.frames(1);
    yes('R4 then connected, it is', g.world.__thornswoodInWorld === true);
  }

  // R5: the world loads with the choice still up (the client's own fallback).
  {
    const g = game();
    g.leave();
    g.choice = true;
    g.connected = true;
    g.menus['Main Menu'] = false;
    g.load();
    g.choice = true;
    g.frames(1);
    yes('R5 a choice still up is taken down, as at the first arrival',
        g.world.__thornswoodInWorld === true && g.gone === 1);
  }

  // R6: out and back twice.
  {
    const g = game();
    for (let round = 1; round <= 2; round++) { g.leave(); g.pick(); g.frames(3); }
    yes('R6 each return is marked', g.world.__thornswoodInWorld === true &&
        g.logs.filter(function (l) { return l.indexOf('back in the world') !== -1; }).length === 2);
  }

  // R7: no character yet after the load, so nothing is claimed.
  {
    const g = game();
    g.leave();
    g.player = null;
    g.pick();
    g.frames(10);
    yes('R7 no character, no arrival', g.world.__thornswoodInWorld === false);
    g.player = { id: 0x14 };
    g.frames(1);
    yes('R7 then the character is there, and it is', g.world.__thornswoodInWorld === true);
  }

  // Keep the position, sky and fire identical across two connections.
  // The new session needs the first report even though the text is the same.
  {
    const g = game();
    g.samplePlace();
    const report = g.placeReports[0];
    yes('R8 the first world samples the nearby fire', report === '/place outdoors - 0 0 0 125');
    g.leave();
    g.pick();
    g.fireDistance = 250;
    g.samplePlace();
    yes('R8 a world still waiting for confirmed arrival sends no place report', g.placeReports.length === 1);
    g.frames(1);
    g.fireDistance = 125;
    g.samplePlace();
    g.samplePlace();
    yes('R8 the same place is reported once to the returned session',
        g.placeReports.length === 2 && g.placeReports[1] === report);
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
