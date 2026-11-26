'use strict';
// #6481: the approved 20% cut is to base hunger/thirst drain, not rest,
// consumption or cold. Run the actual needs source, including its cold-band
// selection and shared settlement calculation. The supplied environment holds
// temperature steady so these are clocks for a whole stretch in that band;
// weather, clothing and movement still decide the band in the live server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../gamemode/needs.ts'), 'utf8');
const START = 1800000000000, MINUTE = 60000, ACTOR = 10;
let passed = 0, failed = 0;
function test(name, run) {
  try { run(); passed++; console.log('PASS  ' + name); }
  catch (error) { failed++; console.log('FAIL  ' + name + ': ' + error.message); }
}
function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-8, actual + ' should be ' + expected);
}
function rig() {
  let now = START, god = false, saved;
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const ctx = {
    console: { log() {} }, Date: { now: () => now },
    setInterval: () => 0, clearInterval() {}, guard: (_, fn) => fn, notify() {}, say() {},
    mp: { makeProperty() {}, get(id, key) {
      if (id === 0 && key === 'onlinePlayers') return [ACTOR];
      if (key === 'isGodMode') return god;
      if (key === 'worldOrCellDesc') return '3c:Skyrim.esm';
      if (key === 'thornswoodNeeds') return clone(saved);
      return undefined;
    }, set(id, key, value) { if (key === 'thornswoodNeeds') saved = clone(value); } }
  };
  vm.createContext(ctx); vm.runInContext(source, ctx);
  const api = ctx.__thornswoodNeeds;
  return { api, seed(extra) { saved = Object.assign(api.fresh(), extra); },
    advance(ms) { now += ms; }, god(value) { god = value; } };
}
function clock(r, temp) {
  let needs = Object.assign(r.api.fresh(), { temp });
  const environment = { workMultiplier: () => 1, restingGain: () => 0,
    warmthTarget: n => n.temp, outdoorCooling: () => 1 };
  return minutes => {
    for (let minute = 0; minute < minutes; minute++) {
      needs = r.api.project(needs, needs.at + MINUTE, false, environment).needs;
    }
    return needs;
  };
}
const bands = [
  { name: 'fine', temp: 50, multiplier: 1, food: 180, drink: 90 },
  { name: 'weary cold', temp: 25, multiplier: 1.25, food: 144, drink: 72 },
  { name: 'bad cold', temp: 15, multiplier: 1.5, food: 120, drink: 60 },
  { name: 'spent cold', temp: 5, multiplier: 2, food: 90, drink: 45 }
];
for (const band of bands) {
  for (const meter of ['food', 'drink']) {
    test(band.name + ' ' + meter + ' empties at exactly ' + band[meter] + ' minutes', () => {
      const r = rig(), tick = clock(r, band.temp), duration = band[meter];
      const before = tick(duration - 1);
      near(before[meter], 100 / duration);
      assert.ok(before[meter] > 0);
      near(before.temp, band.temp);
      const empty = tick(1);
      near(empty[meter], 0);
      near(empty.rest, 100 - 12.5 * duration / 60);
      assert.equal(tick(1)[meter], 0);
    });
  }
  test(band.name + ' retains its cold multiplier and exact hourly drain', () => {
    const r = rig(), after = clock(r, band.temp)(30);
    assert.equal(r.api.NEEDS.coldDrain[band.name.split(' ')[0]], band.multiplier);
    near(after.food, 100 - (100 / 3) * 0.5 * band.multiplier);
    near(after.drink, 100 - (100 / 1.5) * 0.5 * band.multiplier);
    near(after.rest, 93.75);
  });
}
for (const temp of [75, 85, 95]) {
  test('heat at ' + temp + ' leaves both base clocks unchanged', () => {
    const r = rig(), after = clock(r, temp)(30);
    near(after.food, 100 - 100 / 6);
    near(after.drink, 100 - 100 / 3);
  });
}
test('rest keeps its eight-hour clock', () => {
  const r = rig(), tick = clock(r, 50);
  near(tick(479).rest, 12.5 / 60);
  near(tick(1).rest, 0);
  assert.equal(tick(1).rest, 0);
});
test('an ordinary meal still adds 15 food and respects its eight-second window', () => {
  const r = rig(); r.seed({ food: 20, drink: 20, rest: 50 });
  r.api.ate(ACTOR, 'food');
  assert.equal(r.api.read(ACTOR).food, 35);
  r.api.ate(ACTOR, 'food');
  assert.equal(r.api.read(ACTOR).food, 35);
  assert.equal(r.api.read(ACTOR).drink, 20);
  assert.equal(r.api.read(ACTOR).rest, 50);
});
test('an ordinary drink still adds 20 thirst without changing food or rest', () => {
  const r = rig(); r.seed({ food: 20, drink: 20, rest: 50 });
  r.api.ate(ACTOR, 'drink');
  assert.equal(r.api.read(ACTOR).drink, 40);
  assert.equal(r.api.read(ACTOR).food, 20);
  assert.equal(r.api.read(ACTOR).rest, 50);
});
test('God mode pauses saved meters and effects; leaving charges only the next minute', () => {
  const r = rig(); r.seed({ food: 40, drink: 45, rest: 30, temp: 50 });
  r.api.settle(ACTOR); r.god(true); r.advance(120 * MINUTE);
  const paused = r.api.settle(ACTOR);
  for (const [key, value] of Object.entries({ food: 40, drink: 45, rest: 30, temp: 50 })) {
    assert.equal(paused[key], value);
  }
  assert.equal(paused.at, START + 120 * MINUTE);
  assert.equal(Object.keys(r.api.effects(ACTOR, paused)).length, 0);
  r.god(false);
  assert.ok(Object.values(r.api.effects(ACTOR, paused)).some(value => value < 0));
  r.api.settle(ACTOR); r.advance(MINUTE);
  const after = r.api.settle(ACTOR);
  near(after.food, 40 - 100 / 180);
  near(after.drink, 45 - 100 / 90);
  near(after.rest, 30 - 12.5 / 60);
});
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
