// test-2623-temporary-spawns.js
//
// A creature staff spawn without keeping it is taken out of the world for
// good, in the right order, and only after the engine's death event is over.
//
// WHY. Djinn, 17 October: wolves and a vampire he spawned in The Winking
// Skeever for a test were still there days later and attacked a new character.
// Every commanded spawn was given a saved home and a spawn point there, so it
// stood up again after every death and every restart. "A creature spawned by
// a staff member should never be made permanent unless we want to make it
// permanent."
//
// What this runs: the real serverRunId and removeSpawned, lifted out of
// game/gamemode.js by text, against a stand-in mp that records the calls; and
// the real mp.onDeath and mp.onRespawn blocks, read as text, for what a
// harness here cannot run: the body lies its normal time, and removal is asked
// for when it would stand up, after the event, not inside it.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = process.env.GM || path.join(__dirname, '..', '..', 'game', 'gamemode.js');
const src = fs.readFileSync(SRC, 'utf8').split(String.fromCharCode(13)).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function lift(name) {
  const a = src.indexOf('\nfunction ' + name + '(');
  if (a < 0) { return null; }
  const b = src.indexOf('\n}\n', a);
  return b < 0 ? null : src.slice(a, b + 3);
}

const runFn = lift('serverRunId');
const removeFn = lift('removeSpawned');
yes('serverRunId is in the gamemode', !!runFn);
yes('removeSpawned is in the gamemode', !!removeFn);

function box(throwOn) {
  const calls = [];
  const ctx = {
    globalThis: null,
    log: function () { calls.push(['log', Array.prototype.slice.call(arguments).join(' ')]); },
    mp: {
      getDescFromId: function (id) { return id.toString(16); },
      callPapyrusFunction: function (kind, cls, fn, self, args) {
        calls.push(['papyrus', cls + '.' + fn, self.type, self.desc, args.length]);
        if (throwOn === 'papyrus') { throw new Error('no such method'); }
      },
      destroyActor: function (id) { calls.push(['destroy', id]); }
    },
    __thornswoodNpcPopulation: { release: function (id) { calls.push(['release', id]); } },
    __thornswoodNpcRuntime: { forget: function (id) { calls.push(['forget', id]); } }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext((runFn || '') + '\n' + (removeFn || ''), ctx);
  return { ctx: ctx, calls: calls };
}

if (runFn && removeFn) {
  const b = box();
  const first = b.ctx.serverRunId();
  yes('a run id is made once', typeof first === 'string' && first.length > 4);
  yes('and the same one comes back for the rest of the run, as through a gamemode reload',
      b.ctx.serverRunId() === first && b.ctx.__thornswoodServerRun === first);

  const done = b.ctx.removeSpawned(0xff000123);
  const kinds = b.calls.filter(function (c) { return c[0] !== 'log'; }).map(function (c) { return c[0]; }).join(',');
  yes('it lets go of the slot and the runtime, marks the record deleted, then destroys it: ' + kinds,
      kinds === 'release,forget,papyrus,destroy');
  const papyrus = b.calls.filter(function (c) { return c[0] === 'papyrus'; })[0] || [];
  yes('the record is marked deleted through ObjectReference.Delete on that actor',
      papyrus[1] === 'ObjectReference.Delete' && papyrus[2] === 'form' && papyrus[3] === 'ff000123');
  yes('it says it worked', done === true);

  const c = box('papyrus');
  c.ctx.removeSpawned(0xff000124);
  yes('a Delete that throws still leaves the actor destroyed, and is logged',
      c.calls.some(function (x) { return x[0] === 'destroy' && x[1] === 0xff000124; }) &&
      c.calls.some(function (x) { return x[0] === 'log' && /could not mark its record deleted/.test(x[1]); }));
}

// isTemporarySpawn reads the actor's own marker (#2623 review): kept, this
// run, an earlier run, and not the plain true from before #2623 (#3265).
{
  const fn = lift('isTemporarySpawn');
  yes('isTemporarySpawn is in the gamemode', !!fn);
  if (fn) {
    const marks = {};
    const ctx = { mp: { get: function (id, p) { if (p !== 'thornswoodNpcCommanded') throw new Error(p); return marks[id]; } } };
    vm.createContext(ctx); vm.runInContext(fn, ctx);
    marks[1] = { run: 'now' }; marks[2] = { run: 'before' }; marks[3] = true; marks[4] = { keep: true }; marks[5] = undefined;
    yes('a spawn from this run is temporary', ctx.isTemporarySpawn(1) === true);
    yes('one from an earlier run is temporary', ctx.isTemporarySpawn(2) === true);
    yes('the plain true from before #2623 is not read as a marker (#3265)', ctx.isTemporarySpawn(3) === false);
    yes('a kept one is not', ctx.isTemporarySpawn(4) === false);
    yes('an ordinary creature is not', ctx.isTemporarySpawn(5) === false);
  }
}

// Djinn, 17 October: "leave the normal body time". The body lies its usual
// time, and the stand-up at the end of it is refused and the spawn removed.
{
  const blockOf = function (head) {
    const a = src.indexOf(head);
    const b = a < 0 ? -1 : src.indexOf('\n});\n', a);
    return a >= 0 && b > a ? src.slice(a, b) : '';
  };
  const death = blockOf('mp.onDeath = guard(\'onDeath\'');
  const stand = blockOf('mp.onRespawn = guard(\'onRespawn\'');
  yes('mp.onDeath no longer removes a temporary spawn as it dies',
      death.length > 0 && !/removeSpawned/.test(death));
  yes('mp.onDeath gives a temporary spawn the normal body time, not a kept one\'s 45 minutes',
      /const minutes = !isTemporarySpawn\(actorId\) && population && population\.returnMinutes\(actorId\);/.test(death));
  yes('mp.onRespawn checks the actor\'s own marker for a temporary spawn',
      /isTemporarySpawn\(actorId\)/.test(stand));
  const at = stand.indexOf('if (temporary) {');
  const tail = at < 0 ? '' : stand.slice(at, stand.indexOf('\n  }\n', at));
  yes('and refuses the stand-up (false blocks RespawnEvent)', /return false;/.test(tail));
  yes('and asks for removal on the next turn of the event loop',
      /setTimeout\(function \(\) \{ removeSpawned\(actorId\); \}, 0\)/.test(tail));
  yes('before anything else in the handler runs', at >= 0 && at < stand.indexOf("mp.get(actorId, 'spawnPoint')"));
}

// Who may add keep is one switch (Djinn, 17 October: testers and staff for
// now, easy to change later).
{
  const m = /\n  var SPAWN_KEEP_WHO = '([a-z]+)';\n  function mayKeepSpawn\(profileId\) \{\n([\s\S]*?)\n  \}\n/.exec(src);
  yes('SPAWN_KEEP_WHO is the one switch, set to playtester', !!m && m[1] === 'playtester');
  if (m) {
    const may = function (who, staff, tester) {
      return vm.runInNewContext('var SPAWN_KEEP_WHO = ' + JSON.stringify(who) + ';' +
        'function isStaff(){return ' + staff + ';} function isPlaytester(){return ' + tester + ';}' +
        'function mayKeepSpawn(profileId) {\n' + m[2] + '\n}; mayKeepSpawn(1)');
    };
    yes('playtester: a tester may keep', may('playtester', false, true) === true);
    yes('playtester: somebody on no list may not', may('playtester', false, false) === false);
    yes('staff: a tester may not', may('staff', false, true) === false);
    yes('staff: staff may', may('staff', true, true) === true);
  }
  yes('/spawn ... keep asks the switch', /if \(!mayKeepSpawn\(profileId\)\) \{/.test(src));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
