// test-3144-season-yields.js
//
// #3144. Patrick, 22 Oct, A: seasons are mild, yields up or down a quarter,
// winter cold a quarter faster. This runs the real season block out of
// game/gamemode.js for the share and its rounding, then the real harvest()
// and fish() over a stand-in for mp with that season behind them, and lifts
// the cooling share out of the needs block. The crop bring-in is measured in
// test-farming.js, which already runs the farming block.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const src = require('./gamemode-tables.js').joined(fs.readFileSync(process.env.GM || path.join(ROOT, 'game', 'gamemode.js'), 'utf8'))
  .split(String.fromCharCode(13)).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function between(from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + from.length);
  return (a < 0 || b < 0) ? null : src.slice(a, b);
}
function liftFn(name) {
  const a = src.indexOf('function ' + name + '(');
  if (a < 0) { return null; }
  const open = src.indexOf('{', a);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') { depth++; }
    else if (src[i] === '}') { depth--; if (!depth) { return src.slice(a, i + 1); } }
  }
  return null;
}
function topFn(name) {
  const m = src.match(new RegExp('^function ' + name + '\\([^\\n]*\\)[\\s\\S]*?^\\}', 'm'));
  if (!m) { throw new Error('no function ' + name + ' in gamemode.js'); }
  return m[0];
}
function table(name) {
  const m = src.match(new RegExp('^(?:var|const) ' + name + ' = (?:\\{[^\\n]*\\};$|\\{[\\s\\S]*?^\\};)', 'm'));
  if (!m) { throw new Error('no table ' + name + ' in gamemode.js'); }
  return m[0];
}

// ---- the season block --------------------------------------------------------
const seasonSrc = between('// ==== thornswood season ====', '// ==== end thornswood season ====');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-3144-'));
const startedIn = process.cwd();
process.chdir(tmp);
process.on('exit', function () {
  try { process.chdir(startedIn); } catch (e) { }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
});
global.mp = { makeProperty: function () { }, get: function () { return ''; }, set: function () { } };
eval(seasonSrc);
const S = global.__thornswoodSeason;
const WEEK = S.WEEK;
function season(name) {
  const at = { spring: 0, summer: 1, autumn: 2, winter: 3 }[name];
  S.setEpoch(Date.now() - at * WEEK - 1000);
}
function units(list) {
  const q = list.slice();
  global.__thornswoodSeasonUnit = function () { return q.length ? q.shift() : 0; };
}

yes('a quarter up in summer, a quarter down in winter, spring and autumn as written',
  S.YIELD.spring === 1 && S.YIELD.summer === 1.25 && S.YIELD.autumn === 1 && S.YIELD.winter === 0.75);
yes('winter cools a quarter faster, and no other season changes the cooling',
  S.COOLING.winter === 1.25 && S.COOLING.spring === 1 && S.COOLING.summer === 1 && S.COOLING.autumn === 1);

season('spring');
units([0]);
yes('spring gives what the rank gives, and says nothing', S.seasonYield(3) === 3 && S.yieldWord() === '');
season('autumn');
units([0]);
yes('autumn gives what the rank gives, and says nothing', S.seasonYield(2) === 2 && S.yieldWord() === '');

season('summer');
units([]);
yes('summer: 4 is 5, whole, with no roll', S.seasonYield(4) === 5);
units([0.49]);
const up2 = S.seasonYield(2);
units([0.5]);
const stay2 = S.seasonYield(2);
yes('summer: 2 is 3 half the time and 2 the other half', up2 === 3 && stay2 === 2);
units([0.24]);
const up1 = S.seasonYield(1);
units([0.25]);
yes('summer: 1 is 2 a quarter of the time', up1 === 2 && S.seasonYield(1) === 1);
yes('summer says so', S.yieldWord() === 'Summer gives more.');

season('winter');
units([]);
yes('winter: 4 is 3, whole, with no roll', S.seasonYield(4) === 3);
units([0.74]);
const kept1 = S.seasonYield(1);
units([0.75]);
yes('winter: 1 is 1 three times in four and nothing once', kept1 === 1 && S.seasonYield(1) === 0);
units([0.49]);
const w2 = S.seasonYield(2);
units([0.5]);
yes('winter: 2 is 2 half the time and 1 the other half, never nothing', w2 === 2 && S.seasonYield(2) === 1);
yes('winter says so', S.yieldWord() === 'Winter gives less.');
yes('nothing in is nothing out, in any season', S.seasonYield(0) === 0 && S.seasonYield(-2) === 0);

delete global.__thornswoodSeasonUnit;
let total = 0;
for (let i = 0; i < 40000; i++) { total += S.seasonYield(2); }
const winterMean = total / 40000;
season('summer');
total = 0;
for (let i = 0; i < 40000; i++) { total += S.seasonYield(2); }
const summerMean = total / 40000;
yes('over many harvests the quarter holds: winter ' + winterMean.toFixed(3) + ' of 1.5, summer ' + summerMean.toFixed(3) + ' of 2.5',
  Math.abs(winterMean - 1.5) < 0.02 && Math.abs(summerMean - 2.5) < 0.02);

// ---- the cooling share in the needs block -----------------------------------
const needsSrc = between('// ==== thornswood needs: hunger, thirst and exhaustion ====', '// ==== end thornswood needs ====');
const underSrc = liftFn('underSeason'), coolSrc = liftFn('outdoorCooling');
const outdoorCooling = (underSrc && coolSrc)
  ? new Function('g', underSrc + '\n' + coolSrc + '\nreturn outdoorCooling;')(global) : null;
yes('the needs block cuts the cooling half life by the season share, and leaves warming alone',
  !!needsSrc && /\? \(NEEDS\.settleWarmMinutes \|\| NEEDS\.settleMinutes\)\s*: NEEDS\.settleMinutes \/ outdoorCooling\(n\);/.test(needsSrc));
season('winter');
yes('winter out under the sky cools a quarter faster: 90 seconds is 72',
  !!outdoorCooling && outdoorCooling({ place: 'outdoors' }) === 1.25 &&
  outdoorCooling({ place: 'snow' }) === 1.25 && outdoorCooling({ place: 'water' }) === 1.25 &&
  Math.round(90 / outdoorCooling({ place: 'rain' })) === 72);
yes('a roof, indoors and an unknown place ignore the winter',
  !!outdoorCooling && outdoorCooling({ place: 'indoors' }) === 1 &&
  outdoorCooling({ place: 'outdoors', roof: true }) === 1 && outdoorCooling({ place: 'fire' }) === 1);
season('summer');
yes('summer outdoors cools at the written speed', !!outdoorCooling && outdoorCooling({ place: 'outdoors' }) === 1);

// ---- a plant picked, run -------------------------------------------------------
const given = [], work = [], stamped = [], counted = [];
const plantCtx = {
  Date: { now: () => 5000000000 }, globalThis: null, RANK_LADDER: ['novice', 'advanced', 'expert', 'master'],
  HARVEST_COOLDOWN_MS: 600000, lastUse: new Map(),
  isCrop: () => false,
  plantAt: () => ({ name: 'Blue Mountain Flower', produce: '77e1:Skyrim.esm', rank: 'novice' }),
  classGate: () => null, rankStep: () => 0, rankWord: (r) => r,
  addItem: (id, desc, n) => { given.push(n); return true; },
  stampCooldown: (who, ref) => { stamped.push(ref); plantCtx.lastUse.set(who + ':' + ref, 5000000000); },
  creditWork: (id, verb) => { work.push(verb); return null; },
  // The hold economy's count (#3164) is what the season let the pick give.
  economyGathered: (id, desc, n) => { counted.push(n); },
  harvestCrimson: () => 'crimson',
  // No seasonal herb here (#3152): every plant is in season, so only the
  // quarter decides what a pick gives.
  FOOD_GROUPS: { inSeason: {} }
};
plantCtx.globalThis = { __thornswoodSeason: S };
vm.createContext(plantCtx);
vm.runInContext(topFn('harvest') + '\n' + topFn('outOfSeason'), plantCtx);
function pick(ref) { given.length = 0; work.length = 0; stamped.length = 0; counted.length = 0; return plantCtx.harvest(1, ref, 'x'); }

season('winter');
units([0.8]);
let line = pick(11);
yes('a bare winter plant gives nothing and says why: "' + line + '"',
  line === 'The Blue Mountain Flower has nothing to pick this time. Winter gives less.' &&
  given.length === 0 && work.length === 0 && counted.length === 0);
yes('and it still waits its ten minutes, so a second press cannot take the quarter back',
  stamped[0] === 11 && pick(11) === 'This one has already been picked.' && given.length === 0);
units([0.1]);
line = pick(12);
yes('a winter plant that gives, gives its one: "' + line + '"',
  line === 'You pick the Blue Mountain Flower.' && given[0] === 1 && work[0] === 'harvest');
season('summer');
units([0.1]);
line = pick(13);
yes('a summer plant gives a second a quarter of the time: "' + line + '"',
  line === 'You pick 2 Blue Mountain Flower. Summer gives more.' && given[0] === 2 && work.length === 1);
yes('  and the hold economy counts the two it gave', counted.length === 1 && counted[0] === 2);
season('spring');
line = pick(14);
yes('a spring plant gives its one', line === 'You pick the Blue Mountain Flower.' && given[0] === 1);

// ---- a fish caught, run --------------------------------------------------------
const begin = src.indexOf('// SHARED RESOURCE STOCK BEGIN'), end = src.indexOf('// SHARED RESOURCE STOCK END');
const fishCode = [src.slice(begin, end),
  ...['FISH_BY_BASE', 'FISH_TUNING'].map(table),
  "const RANK_LADDER=['novice','advanced','expert','master'];",
  ...['isFish', 'idOf', 'mintedEntry', 'addItem', 'addItemsAtomic', 'waitWord', 'classGate', 'rankStep', 'rankWord',
    'creditWork', 'withinResourceReach', 'fish'].map(topFn)].join('\n');
const copy = v => v == null ? null : JSON.parse(JSON.stringify(v));
let time = 1000000000;
const values = new Map();
const fishMp = {
  makeProperty() {},
  get(id, name) { return copy(values.get(id + ':' + name)); },
  set(id, name, value) { values.set(id + ':' + name, copy(value)); },
  getIdFromDesc(desc) { return parseInt(desc.split(':')[0], 16); }
};
values.set('1:inventory', { entries: [] });
values.set('1:locationalData', { pos: [0, 20, 0], rot: [0, 0, 0], cellOrWorldDesc: '3c:Skyrim.esm' });
for (const ref of [81, 82, 83, 84]) {
  values.set(ref + ':locationalData', { pos: [0, 0, 0], rot: [0, 0, 0], cellOrWorldDesc: '3c:Skyrim.esm' });
  values.set(ref + ':type', 'MpObjectReference');
}
let credited = 0;
const fishCtx = { mp: fishMp, Math, Date: { now: () => time }, Number, Map, Set, JSON, log() {},
  toolGate() { return null; }, wearTool() { return null; }, randInt: (a) => a, economyGathered() {} };
vm.createContext(fishCtx);
vm.runInContext(fishCode, fishCtx);
fishCtx.__thornswoodCharacter = {
  gate() { return null; }, rankOf() { return 'novice'; }, credit() { credited++; return null; }
};
fishCtx.__thornswoodResourceStock = fishCtx.createSharedResourceStock(fishMp, () => time);
fishCtx.__thornswoodSeason = S;
const salmon = Object.keys(fishCtx.FISH_BY_BASE).find(k => fishCtx.FISH_BY_BASE[k].rank === 'novice');
function held() {
  const inv = values.get('1:inventory');
  return inv.entries.reduce((n, e) => n + e.count, 0);
}
yes('the table has a novice water', !!salmon);

season('winter');
units([0.9]);
let before = held();
line = fishCtx.fish(1, 81, salmon);
yes('a winter catch that comes to nothing says so: "' + line + '"',
  line === 'Nothing comes out of the water this time. Winter gives less.' && held() === before && credited === 0);
yes('and the water is fished out for its wait all the same',
  fishCtx.fish(1, 81, salmon) === 'This water is fished out for now. 10 minutes to go.');
units([0.2]);
before = held();
line = fishCtx.fish(1, 82, salmon);
yes('a winter catch that gives: "' + line + '"',
  /^You take 1 .* Winter gives less\.$/.test(line) && held() === before + 1 && credited === 1);
season('summer');
units([0.1]);
before = held();
line = fishCtx.fish(1, 83, salmon);
yes('a summer catch takes a second a quarter of the time: "' + line + '"',
  /^You take 2 .* Summer gives more\.$/.test(line) && held() === before + 2);
season('spring');
before = held();
line = fishCtx.fish(1, 84, salmon);
yes('a spring catch is the rank\'s and says nothing more: "' + line + '"',
  /^You take 1 [^.]*\.$/.test(line) && held() === before + 1);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
