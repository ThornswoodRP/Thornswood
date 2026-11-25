// The staged needs calculation is reusable without saving or notifying.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'gamemode.js'), 'utf8');
const start = src.indexOf('// ==== thornswood needs: hunger, thirst and exhaustion ====');
const end = src.indexOf('// ==== end thornswood needs ====', start);
let pass = 0;
const now = 1800000000000, hour = 3600000;
let writes = 0, notices = 0;
const g = {};
const mp = {makeProperty() {}, get() {return [];}, set() {writes++;}};
const N = new Function('globalThis', 'mp', 'Date', 'setInterval', 'clearInterval', 'guard', 'notify', 'say',
  src.slice(start, end) + '\nreturn globalThis.__thornswoodNeeds;')(
  g, mp, {now: () => now}, () => 0, () => {}, (_, fn) => fn,
  () => notices++, () => notices++);
function check(name, fn) { fn(); pass++; console.log('PASS ' + name); }
function seed(extra) {
  return Object.assign(N.fresh(), {at: now - hour, fire: -1,
    withdrawalUntil: 0, hangoverUntil: 0, drugUntil: 0, drugCrash: 0,
    teaUntil: 0, teaCrash: 0, ale: 0, aleAt: null}, extra);
}
const env = {workMultiplier: () => 2, restingGain: () => 0,
  warmthTarget: () => N.NEEDS.comfort, outdoorCooling: () => 1};
check('projection is available', () => assert.strictEqual(typeof N.project, 'function'));
check('staging drains the entire shared interval without saving or mutating input', () => {
  const before = seed(), copy = JSON.stringify(before);
  const p = N.project(before, now, false, env);
  assert.strictEqual(JSON.stringify(before), copy);
  assert.strictEqual(p.needs.food, 100 - N.NEEDS.drain.food);
  assert.strictEqual(p.needs.drink, 100 - N.NEEDS.drain.drink);
  assert.strictEqual(p.needs.rest, 100 - N.NEEDS.drain.rest);
  assert.strictEqual(p.needs.at, now);
  assert.strictEqual(p.changed, true);
  assert.strictEqual(writes, 0); assert.strictEqual(notices, 0);
});
check('a second projection at the same clock charges no second interval', () => {
  const first = N.project(seed(), now, false, env);
  const second = N.project(first.needs, now, false, env);
  assert.deepStrictEqual(second.needs, first.needs);
  assert.strictEqual(second.changed, false);
});
check('work and tea windows keep the exact elapsed fraction', () => {
  const p = N.project(seed({worked: now - 1000, teaUntil: now - hour / 2}), now, false, env);
  const drained = 1 - 0.5 * N.NEEDS.tea.share;
  assert.strictEqual(p.needs.rest, 100 - N.NEEDS.drain.rest * 2 * drained);
});
check('arrival keeps temperature and applies the existing bed fill after away drain', () => {
  const n = seed({at: now - N.NEEDS.sleptFor, resting: 'bed', temp: 12, food: 80, drink: 70, rest: 10});
  const p = N.project(n, now, true, env);
  assert.strictEqual(p.needs.temp, 12);
  const row = N.NEEDS.away.bed;
  assert.strictEqual(p.needs.rest, row.rest);
  assert.ok(p.slept);
  assert.strictEqual(p.needs.resting, '');
  assert.strictEqual(writes, 0); assert.strictEqual(notices, 0);
});
check('drug crash is staged once, with its original clock and notification intent', () => {
  const until = now - 1;
  const p = N.project(seed({drugUntil: until, drugCrash: 1, doses: [until-2, until-1, until]}), now, false, env);
  assert.strictEqual(p.needs.drugUntil, 0); assert.strictEqual(p.needs.drugCrash, 0);
  assert.strictEqual(p.needs.withdrawalUntil, until + N.NEEDS.drug.withdrawal.minutes * 60000);
  assert.strictEqual(p.pulled, true);
  const next = N.project(p.needs, now + 1, false, env);
  assert.strictEqual(next.pulled, false);
  assert.strictEqual(writes, 0); assert.strictEqual(notices, 0);
});
console.log(pass + ' passed, 0 failed');
