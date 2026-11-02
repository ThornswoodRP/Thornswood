// test-1382-wet-fade.js
//
//     node tests/test-1382-wet-fade.js
//
// #1382: rain and swimming leave you wet for 3 minutes after a roof or the
// bank, and the wet place's exposure fades across them instead of snapping
// off at the door. docs/systems/temperature.md. Drives the real needs block.
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
  const clock = { now: startAt || 1000000000000 };
  const said = [];
  const g = {};
  const Fake = {
    makeProperty: function () { },
    getDescFromId: function () { return ''; },
    get: function (id, key) { if (id === 0 && key === 'onlinePlayers') { return Object.keys(store).map(Number); }
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
  g.__thornswoodHurt = { exposed: function (id, kind, source) { api.hurt.push([id, kind, source]); return false; } };
  return api;
}

let smoke = null;
if (block !== null) {
  try { smoke = rig(); } catch (e) { console.log('  (' + e.message + ')'); block = null; }
}
yes('the needs block is in the gamemode and runs', block !== null && !!smoke);

if (block !== null && smoke) {
  const MIN = 60000, SEC = 1000;
  const ME = 0xff000001;
  const r0 = smoke;
  yes('wet lasts 3 minutes, from rain, water and wading', r0.NEEDS.wetMinutes === 3 &&
      !!(r0.NEEDS.wetPlaces && r0.NEEDS.wetPlaces.rain && r0.NEEDS.wetPlaces.water && r0.NEEDS.wetPlaces.shallow));
  function target(r) { return r.view(ME).tempTarget; }
  {
    const r = rig(); r.seed(ME);
    r.place(ME, 'indoors', '-', '0', '1', '0', '-');
    const dry = target(r);
    r.clock.now += SEC;
    r.place(ME, 'rain', '-', '0', '0', '0', '-');
    const inRain = target(r);
    r.clock.now += SEC;
    r.place(ME, 'indoors', '-', '0', '1', '0', '-');
    const atDoor = target(r);
    r.clock.now += 1.5 * MIN;
    const half = target(r);
    r.clock.now += 1.5 * MIN + SEC;
    const after = target(r);
    console.log('      targets: dry ' + dry + ', rain ' + inRain + ', door ' + atDoor + ', 90s ' + half + ', 3m ' + after);
    yes('at the door the rain is still on you', atDoor < dry - 1 && Math.abs(atDoor - inRain) <= 1);
    yes('halfway through it has faded about half', half > atDoor && half < dry);
    yes('after 3 minutes you are dry', after === dry);
  }
  {
    const r = rig(); r.seed(ME);
    r.place(ME, 'water', '-', '0', '0', '0', '-');
    const swim = target(r);
    r.clock.now += SEC;
    r.place(ME, 'outdoors', '-', '0', '0', '0', '-');
    const bank = target(r);
    r.clock.now += 3 * MIN + SEC;
    const dryOut = target(r);
    yes('out of the water you are still wet', bank < dryOut - 1 && Math.abs(bank - swim) <= 1);
    r.place(ME, 'shallow', '-', '0', '0', '0', '-');
    r.clock.now += SEC;
    r.place(ME, 'outdoors', '-', '0', '0', '0', '-');
    r.place(ME, 'water', '-', '0', '0', '0', '-');
    yes('going back in ends the fade', r.read(ME).wetFrom === 0);
  }
  {
    const r = rig(); r.seed(ME);
    r.place(ME, 'rain', '-', '0', '0', '0', '-');
    r.clock.now += SEC;
    r.place(ME, 'snow', '-', '0', '0', '0', '-');
    const snowWet = target(r);
    r.clock.now += 3 * MIN + SEC;
    yes('leaving rain for snow is the snow, never warmer', snowWet === target(r));
  }
}
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
