// test-held-commands.js
//
// A command typed while the character is on its way back is held and run when
// it arrives, rather than answered "the server cannot find your character".
//
// Patrick, 23 September: "Tried to do /give key so I could atleast test that
// way and it said it couldn't find my chacther". He was coming back from a
// deploy. The dev server log for that evening has the gamemode loading at
// 20:39:00.541 and his character arriving at 20:39:47.177, and again 20:44:04.992
// to 20:44:52.111: about 47 seconds each time, and every slash line typed in
// that window was handed over by the first poll and refused.
//
// What this checks is the behaviour, run for real: the lines between the
// actorOf sweep and the arrival point are lifted out of gamemode.js and driven
// over a pretend world with a pretend clock. handle() is a stand-in with the
// same contract as the real one: it does the sweep itself and refuses when the
// sweep comes back empty. So "answered rather than refused" means the stand-in
// saw a real actor when the line ran.
//
// And the trap from the entry, checked hardest: a held line must never run
// against a character that no longer exists.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

/* Comments in this repo quote old code on purpose, so a check that reads them
   as code is a check that punishes writing them. */
function codeOf(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const REFUSED = 'The server cannot find your character right now.';

const wordsMatch = /^const WORDS = (\[[\s\S]*?\]);$/m.exec(src);
const WORDS = wordsMatch ? new Function('return ' + wordsMatch[1])() : null;
yes('the list of words the server answers is in the gamemode', Array.isArray(WORDS));

/*
  The real lines, over a pretend world.

  world.online is what onlinePlayers says, world.pid is each actor's profile,
  and an actor in world.gone throws when it is asked who it belongs to, which
  is what an actor that has been replaced does. G is globalThis, passed in so
  a second rig can share it the way a hot reload shares the real one.
*/
function rig(world, clock, G, throwOn) {
  const a = src.indexOf('  if (!globalThis.__thornswoodLastActor)');
  const b = a < 0 ? -1 : src.indexOf('  /** key -> where /tp sends staff', a);
  if (a < 0 || b < 0) { return null; }
  const block = src.slice(a, b);
  if (block.indexOf('function dispatch(') < 0 || block.indexOf('function drainHeld(') < 0) {
    return null;
  }

  const r = { said: [], ran: [], logged: [] };
  const mp = {
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return world.online.slice(); }
      if (key === 'profileId') {
        if (world.gone[id]) { throw new Error('no form ' + id); }
        return world.pid[id];
      }
      return undefined;
    }
  };
  function handle(cmd) {
    const pid = Number(cmd.profileId) || 0;
    const actor = r.api.actorOf(pid);
    r.ran.push({ text: cmd.text, pid: pid, actor: actor, t: clock.t });
    if (throwOn && cmd.text === throwOn) { throw new Error('this one throws'); }
    if (!actor) { r.said.push({ pid: pid, line: REFUSED }); }
  }
  const fn = new Function(
    'globalThis', 'g', 'mp', 'WORDS', 'handle', 'toProfile', 'log', 'Date',
    block + '\nreturn { actorOf: actorOf, dispatch: dispatch, drainHeld: drainHeld,' +
            ' held: held, HOLD_FOR: HOLD_FOR, HOLD_MAX: HOLD_MAX, HOLD_ALL: HOLD_ALL };');
  r.api = fn(G, G, mp, WORDS, handle,
             function (pid, line) { r.said.push({ pid: pid, line: line }); },
             function () { r.logged.push(Array.prototype.join.call(arguments, ' ')); },
             { now: function () { return clock.t; } });
  return r;
}

function line(pid, text) { return { profileId: pid, name: 'Somebody', text: text, at: 0 }; }
function heldTotal(held) {
  let n = 0;
  for (const k in held) { n += held[k].lines.length; }
  return n;
}
function refusals(r, pid) {
  return r.said.filter(function (s) { return s.pid === pid && s.line === REFUSED; }).length;
}
function notices(r, pid) {
  return r.said.filter(function (s) { return s.pid === pid && /not back in the world yet/.test(s.line); }).length;
}

const probe = rig({ online: [], pid: {}, gone: {} }, { t: 0 }, {});
yes('a line with no character is held rather than refused', probe !== null);

if (probe && WORDS) {
  const ME = 1247972239;
  const MINE = 0xff000003;

  // ---------------------------------------------------------- the deploy
  {
    const world = { online: [], pid: {}, gone: {} };
    const clock = { t: 0 };
    const r = rig(world, clock, {});

    // The first poll after the load: two lines typed during the restart.
    r.api.dispatch(line(ME, '/give iron key'));
    clock.t = 400;
    r.api.dispatch(line(ME, '/tp riften'));
    yes('neither runs while there is no character', r.ran.length === 0);
    yes('and neither is refused', refusals(r, ME) === 0);
    yes('the person is told once that it is waiting, not once a line',
        notices(r, ME) === 1);
    yes('the wait is logged, so the dev log shows it happened',
        r.logged.some(function (l) { return /holding \/give for profile 1247972239/.test(l); }));

    const kept = r.api.held[ME] && r.api.held[ME].lines[0];
    yes('a held line keeps the text and when it began to wait, and no actor',
        !!kept && JSON.stringify(Object.keys(kept).sort()) === '["at","cmd"]');

    // Ticks go by with nobody there.
    for (clock.t = 1500; clock.t < 46000; clock.t += 1500) { r.api.drainHeld(); }
    yes('ticks with no character run nothing', r.ran.length === 0);

    // 47 seconds after the load, the character arrives.
    clock.t = 47000;
    world.online = [MINE];
    world.pid[MINE] = ME;
    r.api.drainHeld();
    yes('the moment the character is in the world, both lines run', r.ran.length === 2);
    yes('in the order they were typed',
        r.ran.length === 2 && r.ran[0].text === '/give iron key' && r.ran[1].text === '/tp riften');
    yes('each against the character the sweep found at that moment',
        r.ran.every(function (x) { return x.actor === MINE; }));
    yes('so /give key is answered rather than refused', refusals(r, ME) === 0);
    yes('and nothing is left waiting', !r.api.held[ME]);

    for (let i = 0; i < 5; i++) { clock.t += 1500; r.api.drainHeld(); }
    yes('nothing is run twice', r.ran.length === 2);

    r.api.dispatch(line(ME, '/where'));
    yes('with the character here, a new line runs at once',
        r.ran.length === 3 && r.ran[2].actor === MINE);
    yes('the measured gap of 47 seconds fits inside the wait',
        r.api.HOLD_FOR > 47000 && r.api.HOLD_FOR <= 180000);
  }

  // -------------------------------------------- what never waits for anybody
  {
    const r = rig({ online: [], pid: {}, gone: {} }, { t: 0 }, {});
    const now = ['/help', '/commands', '/help land', '/tp', '/goto', '/restart',
                 '/place town 0 0 0 0', '/burn 1', '/chopped', '/fish', '/nonsense'];
    for (let i = 0; i < now.length; i++) { r.api.dispatch(line(7, now[i])); }
    yes('/help, a bare /tp, a word the server does not answer and the client\'s ' +
        'reports of a moment are all handled at once', r.ran.length === now.length);
    yes('and none of them is held', !r.api.held[7]);
    r.api.dispatch(line(7, '/tp riften'));
    yes('/tp with somewhere to go needs a character, so it waits', r.ran.length === now.length &&
        r.api.held[7] && r.api.held[7].lines.length === 1);
    r.api.dispatch(line(0, '/give iron ore'));
    yes('a line with no profile goes straight to handle(), which drops it',
        r.ran.length === now.length + 1 && !r.api.held[0]);
  }

  // ------------------------------------------ the client's lines are silent
  {
    const r = rig({ online: [], pid: {}, gone: {} }, { t: 0 }, {});
    r.api.dispatch(line(8, '/face'));
    r.api.dispatch(line(8, '/tspicks 1'));
    yes('a closed race menu and a broken lockpick wait too',
        r.api.held[8] && r.api.held[8].lines.length === 2);
    yes('without telling anybody, because nobody typed them', notices(r, 8) === 0);
    r.api.dispatch(line(8, '/stuck'));
    yes('the first line somebody did type gets the notice', notices(r, 8) === 1);
  }

  // ------------------------------------------------- never a stale character
  {
    const world = { online: [0xff000005], pid: { 0xff000005: 44 }, gone: {} };
    const clock = { t: 0 };
    const r = rig(world, clock, {});
    yes('the sweep remembers who it saw', r.api.actorOf(44) === 0xff000005);

    // The server replaces the character. The old actor is not listed and
    // throws when asked who it belongs to.
    world.online = [];
    world.gone[0xff000005] = true;
    r.api.dispatch(line(44, '/give iron key'));
    yes('a line against a replaced character is held, not run', r.ran.length === 0);
    clock.t = 1500; r.api.drainHeld();
    yes('and a tick later it is still not run against the old one', r.ran.length === 0);

    world.online = [0xff000009];
    world.pid[0xff000009] = 44;
    clock.t = 3000; r.api.drainHeld();
    yes('it runs against the new character when that one arrives',
        r.ran.length === 1 && r.ran[0].actor === 0xff000009);
    yes('and never against the old one',
        !r.ran.some(function (x) { return x.actor === 0xff000005; }));
  }
  {
    // The old actor id now belongs to somebody else.
    const world = { online: [0xff000006], pid: { 0xff000006: 45 }, gone: {} };
    const r = rig(world, { t: 0 }, {});
    r.api.actorOf(45);
    world.online = [];
    world.pid[0xff000006] = 99;
    r.api.dispatch(line(45, '/give iron key'));
    yes('an actor that belongs to somebody else now is not used', r.ran.length === 0 &&
        r.api.held[45] && r.api.held[45].lines.length === 1);
  }
  {
    // The gap the fallback was written for is still covered: the sweep is
    // blind and the remembered actor is still there and still theirs.
    const world = { online: [0xff000007], pid: { 0xff000007: 46 }, gone: {} };
    const r = rig(world, { t: 0 }, {});
    r.api.actorOf(46);
    world.online = [];
    r.api.dispatch(line(46, '/give iron key'));
    yes('the remembered actor still answers when it is confirmed',
        r.ran.length === 1 && r.ran[0].actor === 0xff000007 && !r.api.held[46]);
  }

  // ------------------------------------------------------------- in time
  {
    const world = { online: [], pid: {}, gone: {} };
    const clock = { t: 0 };
    const r = rig(world, clock, {});
    r.api.dispatch(line(43, '/give iron key'));
    clock.t = r.api.HOLD_FOR - 1; r.api.drainHeld();
    yes('a line still waits just short of the limit', r.ran.length === 0);
    clock.t = r.api.HOLD_FOR; r.api.drainHeld();
    yes('at the limit it is answered the way it always was',
        r.ran.length === 1 && r.ran[0].actor === 0 && refusals(r, 43) === 1);
    yes('and it stops waiting', !r.api.held[43]);
    clock.t += 1500; r.api.drainHeld();
    yes('and is answered once, not every tick', r.ran.length === 1 && refusals(r, 43) === 1);
  }
  {
    const world = { online: [], pid: {}, gone: {} };
    const clock = { t: 0 };
    const r = rig(world, clock, {});
    r.api.dispatch(line(47, '/give first'));
    clock.t = 60000;
    r.api.dispatch(line(47, '/give second'));
    clock.t = r.api.HOLD_FOR; r.api.drainHeld();
    yes('each line has its own limit: the old one is answered',
        r.ran.length === 1 && r.ran[0].text === '/give first');
    yes('and the newer one keeps waiting', r.api.held[47] && r.api.held[47].lines.length === 1);
    world.online = [0xff000011];
    world.pid[0xff000011] = 47;
    clock.t = 100000; r.api.drainHeld();
    yes('and runs when the character comes',
        r.ran.length === 2 && r.ran[1].text === '/give second' && r.ran[1].actor === 0xff000011);
  }

  // --------------------------------------------------------- in how many
  {
    const r = rig({ online: [], pid: {}, gone: {} }, { t: 0 }, {});
    for (let i = 0; i < r.api.HOLD_MAX + 5; i++) { r.api.dispatch(line(48, '/give thing ' + i)); }
    yes('one person\'s waiting lines stop at the limit',
        r.api.held[48].lines.length === r.api.HOLD_MAX);
    yes('and the ones past it are answered at once, the old way',
        r.ran.length === 5 && refusals(r, 48) === 5);
  }
  {
    const r = rig({ online: [], pid: {}, gone: {} }, { t: 0 }, {});
    for (let p = 1; p <= 40; p++) {
      for (let i = 0; i < 10; i++) { r.api.dispatch(line(5000 + p, '/give thing ' + i)); }
    }
    yes('a page sending lines under forty made up ids cannot grow it past the server limit',
        heldTotal(r.api.held) === r.api.HOLD_ALL);
    yes('and everything past that is answered at once',
        r.ran.length === 400 - r.api.HOLD_ALL);
  }

  // ------------------------------------------------------------ in order
  {
    const world = { online: [], pid: {}, gone: {} };
    const clock = { t: 0 };
    const r = rig(world, clock, {});
    r.api.dispatch(line(50, '/give one'));
    r.api.dispatch(line(50, '/give two'));
    // The character arrives between two ticks and a new line gets in first.
    world.online = [0xff000012];
    world.pid[0xff000012] = 50;
    r.api.dispatch(line(50, '/give three'));
    yes('a new line from somebody with lines waiting goes behind them',
        r.ran.length === 0 && r.api.held[50].lines.length === 3);
    clock.t = 1500; r.api.drainHeld();
    yes('so the three run in the order they were typed',
        r.ran.map(function (x) { return x.text; }).join(',') === '/give one,/give two,/give three');
  }

  // --------------------------------------------------- a line that throws
  {
    const world = { online: [], pid: {}, gone: {} };
    const clock = { t: 0 };
    const r = rig(world, clock, {}, '/give broken');
    r.api.dispatch(line(51, '/give broken'));
    r.api.dispatch(line(51, '/give fine'));
    world.online = [0xff000013];
    world.pid[0xff000013] = 51;
    clock.t = 1500;
    let threw = false;
    try { r.api.drainHeld(); } catch (e) { threw = true; }
    yes('a held line that throws does not stop the tick', !threw);
    yes('the next line still runs', r.ran.length === 2 && r.ran[1].text === '/give fine');
    yes('and the throw is logged',
        r.logged.some(function (l) { return /held command threw/.test(l); }));
    clock.t = 3000; r.api.drainHeld();
    yes('and the line that threw is not run again', r.ran.length === 2);
  }

  // ---------------------------------------------------------- a hot reload
  {
    const world = { online: [], pid: {}, gone: {} };
    const clock = { t: 0 };
    const G = {};
    const before = rig(world, clock, G);
    before.api.dispatch(line(52, '/give iron key'));
    const after = rig(world, clock, G);
    world.online = [0xff000014];
    world.pid[0xff000014] = 52;
    clock.t = 1500; after.api.drainHeld();
    yes('a reload keeps what was waiting and the new code runs it',
        after.ran.length === 1 && after.ran[0].actor === 0xff000014 && before.ran.length === 0);
  }
}

// ------------------------------------------------------------- the wiring
{
  const c = codeOf(src);
  yes('the poll hands each line to dispatch', /try \{ dispatch\(list\[i\]\); \}/.test(c));
  yes('and nothing hands a polled line straight to handle() any more',
      !/handle\(list\[i\]\)/.test(c));
  yes('the timer tries the waiting lines every tick',
      /setInterval\(function \(\) \{\s*try \{ drainHeld\(\); \}/.test(c));
  yes('the old answer is still the one given when a line gives up',
      /The server cannot find your character right now\. Give it a moment and ' \+/.test(src));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
