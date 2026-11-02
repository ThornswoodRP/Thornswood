// test-1382-meal-time-cold.js
//
//     node tests/test-1382-meal-time-cold.js
//
// #1382, the slice that needs no item table: eating takes 8 seconds, a meal
// at 90 hunger or above does not raise the meter and starts food sickness
// through the disease block, and the cold band speeds hunger and thirst at
// 1.25 / 1.5 / 2. Numbers from docs/systems/food.md, hunger.md and thirst.md.
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
  const HOUR = 3600000, SEC = 1000;
  const ME = 0xff000001;
  {
    const r = rig();
    yes('meal rules: 8 seconds and full at 90', !!r.NEEDS.meal && r.NEEDS.meal.eatSeconds === 8 && r.NEEDS.meal.fullAt === 90);
    const c = r.NEEDS.coldDrain || {};
    yes('cold drain is 1 / 1.25 / 1.5 / 2', c.fine === 1 && c.weary === 1.25 && c.bad === 1.5 && c.spent === 2);
  }
  if (smoke.NEEDS.meal && smoke.NEEDS.coldDrain) {
    // 8 seconds
    {
      const r = rig(); r.seed(ME);
      const n = r.read(ME); n.food = 40; n.at = r.clock.now;
      r.__set(ME, n);
      r.ate(ME, 'food');
      const one = r.read(ME).food;
      r.clock.now += 3 * SEC; r.ate(ME, 'food');
      const two = r.read(ME).food;
      r.clock.now += 6 * SEC; r.ate(ME, 'food');
      const three = r.read(ME).food;
      yes('a meal adds 15', Math.round(one) === 55);
      yes('another inside 8 seconds adds nothing', Math.round(two) === Math.round(one));
      yes('after 8 seconds the next one counts', Math.round(three) === Math.round(two) + 15);
    }
    // full stomach
    {
      const r = rig(); r.seed(ME);
      const n = r.read(ME); n.food = 92; n.at = r.clock.now; r.__set(ME, n);
      const line = r.ate(ME, 'food');
      yes('at 90 or above a meal does not raise hunger', Math.round(r.read(ME).food) === 92);
      yes('and it starts food sickness through exposed(food, full)', r.hurt.length === 1 && r.hurt[0][1] === 'food' && r.hurt[0][2] === 'full');
      yes('and says so', /full/i.test(line));
    }
    // cold
    function drained(band) {
      const r = rig(); r.seed(ME);
      const temps = { fine: 50, weary: 25, bad: 15, spent: 5 };
      const n = r.read(ME); n.temp = temps[band]; n.at = r.clock.now; r.__set(ME, n);
      r.settle(ME); // mark arrived
      const s = r.read(ME); s.food = 100; s.drink = 100; s.temp = temps[band]; s.at = r.clock.now; r.__set(ME, s);
      r.clock.now += HOUR / 10;
      const after = r.settle(ME);
      return { food: 100 - after.food, drink: 100 - after.drink };
    }
    const base = drained('fine'), w = drained('weary'), b = drained('bad'), sp = drained('spent');
    const near = (x, y) => Math.abs(x - y) < 0.01;
    yes('weary cold runs hunger at 1.25', near(w.food, base.food * 1.25));
    yes('bad cold runs hunger at 1.5', near(b.food, base.food * 1.5));
    yes('spent cold runs hunger and thirst at 2', near(sp.food, base.food * 2) && near(sp.drink, base.drink * 2));
    {
      const r = rig(); r.seed(ME);
      const n = r.read(ME); n.temp = 95; n.at = r.clock.now; r.__set(ME, n); r.settle(ME);
      const s = r.read(ME); s.food = 100; s.temp = 95; s.at = r.clock.now; r.__set(ME, s);
      r.clock.now += HOUR / 10;
      yes('heat does not speed hunger', near(100 - r.settle(ME).food, base.food));
    }
  }
}
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
