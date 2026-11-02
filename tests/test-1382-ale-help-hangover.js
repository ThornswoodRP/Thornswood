// test-1382-ale-help-hangover.js
//
//     node tests/test-1382-ale-help-hangover.js
//
// #1382: the first two ales give +0.05 melee damage for 5 real minutes and
// the third does not; three or more and a logout without a bed leaves you
// hung over next time in the world (#3153: stamina recovery down 25% for 10
// minutes), and a bed sleeps it off. docs/systems/drink.md.
// Drives the real needs block out of game/gamemode.js.
const REPO_DIR = require('path').join(__dirname, '..');
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

const A = '// ==== thornswood needs: hunger, thirst and exhaustion ====';
const B = '// ==== end thornswood needs ====';
const a = src.indexOf(A);
const b = a < 0 ? -1 : src.indexOf(B, a);
let block = (a >= 0 && b >= 0) ? src.slice(a, b) : null;

function rig(startAt) {
  const store = {};
  const online = [];
  const clock = { now: startAt || 1000000000000 };
  const said = [];
  const g = {};
  const Fake = {
    makeProperty: function () { },
    getDescFromId: function () { return ''; },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return online.slice(); }
      if (key === 'worldOrCellDesc') { return (store[id] && store[id].cell) || 'cell:X.esm'; }
      return store[id] ? store[id].v : undefined;
    },
    set: function (id, key, v) {
      if (!store[id]) { store[id] = {}; }
      store[id].v = v;
    }
  };
  const FakeDate = { now: function () { return clock.now; } };
  const fn = new Function(
    'globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
    'guard', 'notify', 'say', 'Math', 'Number', 'String', 'Object', 'isFinite',
    'var FOODS = { items: { "34c5e:Skyrim.esm": { k: "ale" } } }; function idOf(d) { return parseInt(d, 16); }\n' +
    block + '\nreturn globalThis.__thornswoodNeeds;');
  const api = fn(
    g, Fake, FakeDate, { log: function () { } },
    function () { return 0; }, function () { },
    function (n, f) { return f; },
    function (id, line) { said.push(line); },
    function (id, line) { said.push(line); },
    Math, Number, String, Object, isFinite);
  api.clock = clock;
  api.said = said;
  api.seed = function (id) { Fake.set(id, 'x', api.fresh()); };
  api.__set = function (id, n) { Fake.set(id, 'x', n); };
  api.hurt = [];
  api.online = online;
  api.cared = [];
  g.__thornswoodHurt = { exposed: function (id, kind, source) { api.hurt.push([id, kind, source]); return false; },
    careChanged: function (id) { api.cared.push(id); } };
  return api;
}

let smoke = null;
if (block !== null) {
  try { smoke = rig(); } catch (e) { console.log('  (' + e.message + ')'); block = null; }
}
yes('the needs block is in the gamemode and runs', block !== null && !!smoke);

if (block !== null && smoke) {
  const MIN = 60000;
  const ME = 0xff000001;
  const ALE = 0x34c5e;
  const A = smoke.NEEDS.ale;
  yes('ale help is +0.05 for 5 minutes through the second, a hangover is 10 minutes at -25 stamina recovery',
      A.help === 0.05 && A.helpMinutes === 5 && A.helpThrough === 2 &&
      A.hangoverMinutes === 10 && A.hangover.staminaRateMult === -25);
  function rigAle() { const r = rig(); r.online.push(ME); r.seed(ME); r.settle(ME); return r; }
  const dmg = (r) => r.effects(ME, r.read(ME)).attackDamageMult || 0;
  {
    const r = rigAle();
    const base = dmg(r);
    r.consumed(ME, ALE);
    yes('the first ale gives +0.05 melee damage', Math.abs(dmg(r) - base - 0.05) < 1e-9);
    r.clock.now += 4 * MIN;
    yes('still there at 4 minutes', Math.abs(dmg(r) - base - 0.05) < 1e-9);
    r.clock.now += 1 * MIN + 1000;
    yes('gone after 5 minutes', Math.abs(dmg(r) - base) < 1e-9);
  }
  {
    const r = rigAle();
    const base = dmg(r);
    r.consumed(ME, ALE); r.clock.now += 1000;
    r.consumed(ME, ALE); r.clock.now += 1000;
    const until2 = r.read(ME).aleHelpUntil;
    r.consumed(ME, ALE);
    yes('the second ale renews it, the third does not', r.read(ME).aleHelpUntil === until2 && until2 > 0);
    yes('the help does not stack', Math.abs(dmg(r) - base - 0.05) < 1e-9);
  }
  // The hangover (#3153): what drunk leaves when it wears off, stamina
  // recovery down 25% for 10 minutes. test-3153-after-effects.js has the rest.
  const regen = (r) => r.effects(ME, r.read(ME)).staminaRateMult || 0;
  {
    const r = rigAle();
    r.consumed(ME, ALE); r.consumed(ME, ALE); r.consumed(ME, ALE);
    const sober = regen(r);
    // Log out on the road, not in a bed, and come back an hour later.
    r.online.length = 0; r.tick();
    r.clock.now += 60 * MIN;
    r.online.push(ME);
    r.settle(ME);
    yes('three ales and no bed: hung over next time in the world, for 10 minutes from then',
        r.read(ME).hangoverUntil === r.clock.now + 10 * MIN);
    yes('stamina recovers 25% slower', regen(r) - sober === -25);
    // A physicker's remedy ends it (drink.md), through soberUp, which the
    // wounds panel calls; the rest of the remedy is test-1383-treatments.js.
    yes('hungOver says so', r.hungOver(ME) === true);
    yes('the injury block is told a hangover started, so the remedy can be offered', r.cared.length === 1 && r.cared[0] === ME);
    yes('soberUp clears the hangover and says it did', r.soberUp(ME) === true && r.hungOver(ME) === false);
    yes('and stamina recovers as it did', regen(r) === sober);
    yes('and the injury block is told it ended', r.cared.length === 2);
    yes('soberUp with no hangover does nothing', r.soberUp(ME) === false);
  }
  {
    const r = rigAle();
    r.consumed(ME, ALE); r.consumed(ME, ALE);
    r.online.length = 0; r.tick(); r.clock.now += 60 * MIN; r.online.push(ME); r.settle(ME);
    yes('two ales do not hang you over', r.hungOver(ME) === false && r.read(ME).hangoverUntil === 0);
  }
  {
    const r = rigAle();
    r.consumed(ME, ALE); r.consumed(ME, ALE); r.consumed(ME, ALE);
    const n = r.read(ME); n.resting = 'bed'; r.__set(ME, n);
    r.online.length = 0; r.tick(); r.clock.now += 60 * MIN; r.online.push(ME); r.settle(ME);
    yes('three ales then a bed: no hangover', r.hungOver(ME) === false && r.read(ME).hangoverUntil === 0);
  }
}
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
