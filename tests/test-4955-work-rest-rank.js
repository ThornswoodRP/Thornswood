// test-4955-work-rest-rank.js
//
//     node tests/test-4955-work-rest-rank.js
//
// #4955: a swing of work costs rest by the rank of the work being done
// (docs/systems/professions.md, "by the rank you are climbing", and
// exhaustion.md's table: 1.5 novice, 1.2 advanced, 0.9 expert, 0.6 master).
// On main the needs block's worked(actorId) never heard what the work was,
// so it walked every rank the character held and charged for the highest:
// a Master Miner working their novice half paid 0.6, not 1.5.
//
// This runs the REAL progression block, the REAL needs block and the REAL
// creditWork of the class and profession gates out of game/gamemode.js, over
// one character: a master miner who is a novice Platewright, with a novice
// sister half, an advanced school and nothing in the hunter's class. Every
// swing goes in through creditWork with the key the trades pass it, and the
// rest it took is read back off the meter. Read only.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname, '..', 'game', 'gamemode.js'), 'utf8')).split(String.fromCharCode(13)).join('');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function between(a, b) {
  const i = src.indexOf(a); if (i < 0) { return null; }
  const k = src.indexOf(b, i); if (k < 0) { return null; }
  return src.slice(i, k + b.length);
}
const PROG = between('// ==== thornswood progression ====', '// ==== end thornswood progression ====');
const NEEDS = between('// ==== thornswood needs: hunger, thirst and exhaustion ====', '// ==== end thornswood needs ====');
const GATE = between('function creditWork(actorId, key, n) {', 'const PARTY_BANK = {};');
yes('the progression, needs and work-credit blocks are in gamemode.js', !!PROG && !!NEEDS && !!GATE);

function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
if (!PROG || !NEEDS || !GATE) { done(); }

const ME = 0xff000001;

function rig() {
  const clock = { now: 1000000000000 };
  const store = {};
  const g = { console: { log: function () { } } };
  vm.createContext(g);
  g.globalThis = g;
  vm.runInContext(PROG, g, { filename: 'gamemode.js (progression)' });
  const P = g.__thornswoodProgression;
  const state = P.fresh();
  state.cls = 'miner';
  state.prof = 'smith';
  state.half = 'platewright';
  state.ranks.miner = 'master';
  state.ranks.platewright = 'novice';
  state.ranks.edgewright = 'novice';
  state.ranks.destruction = 'advanced';
  g.__thornswoodCharacter = {
    stateOf: function () { return JSON.parse(JSON.stringify(state)); },
    credit: function () { return null; }
  };
  const mp = {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return [ME]; }
      if (key === 'worldOrCellDesc') { return 'cell:X.esm'; }
      return store[id];
    },
    set: function (id, key, v) { store[id] = v; }
  };
  const fn = new Function(
    'globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
    'guard', 'notify', 'say', 'Math', 'Number', 'String', 'Object', 'isFinite',
    NEEDS + '\nreturn globalThis.__thornswoodNeeds;');
  const N = fn(g, mp, { now: function () { return clock.now; } }, { log: function () { } },
    function () { return 0; }, function () { }, function (n, f) { return f; },
    function () { }, function () { }, Math, Number, String, Object, isFinite);
  N.seed = function () { store[ME] = N.fresh(); };
  // The gates' creditWork, as the trades call it.
  g.log = function () { };
  g.notify = function () { };
  g.say = function () { };
  vm.runInContext(GATE + '\nglobalThis.__creditWork = creditWork;', g, { filename: 'gamemode.js (gates)' });
  return { g: g, N: N, P: P, work: g.__creditWork };
}

// The rest one swing under key takes, read off the meter.
function costOf(key) {
  const r = rig();
  r.N.seed();
  const before = r.N.settle(ME).rest;
  r.work(ME, key);
  const after = r.N.settle(ME).rest;
  return { cost: Math.round((before - after) * 1000) / 1000, table: r.N.NEEDS.work };
}

const T = costOf('mine').table;
yes('the table is the page\'s: novice 1.5, advanced 1.2, expert 0.9, master 0.6',
    T.novice === 1.5 && T.advanced === 1.2 && T.expert === 0.9 && T.master === 0.6);

const CASES = [
  ['mine', 'master', 'a swing at the seam, their master class, by its verb'],
  ['miner', 'master', 'the same work named by its class'],
  ['platewright', 'novice', 'novice work in their own half'],
  ['edgewright', 'novice', 'novice work in their sister half'],
  ['destruction', 'advanced', 'study in their advanced school'],
  ['loot', 'novice', 'work they hold no rank in at all']
];
for (const [key, rank, what] of CASES) {
  const got = costOf(key).cost;
  yes(what + ' costs the ' + rank + ' ' + T[rank] + ' (took ' + got + ')', got === T[rank]);
}

// Twenty novice swings cost what twenty novice swings cost, though they hold master.
{
  const r = rig();
  r.N.seed();
  const before = r.N.settle(ME).rest;
  for (let i = 0; i < 20; i++) { r.work(ME, 'platewright'); }
  const after = r.N.settle(ME).rest;
  yes('twenty novice Platewright swings by a Master Miner cost 30 (took ' + Math.round((before - after) * 1000) / 1000 + ')',
      Math.abs((before - after) - 20 * T.novice) < 1e-9);
}
done();
