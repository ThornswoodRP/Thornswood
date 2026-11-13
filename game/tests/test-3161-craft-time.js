// test-3161-craft-time.js
//
// #3161. Patrick, 22 Oct 2026, his B on the report page: crafting takes
// small 1 s, medium 5 s, large 15 s, with an animation, and moving away
// stops it. The engine (engine/skymp CraftService, fork #115) asks
// mp.onCraftWork before anything else about a craft and holds the craft for
// the time it names with mp.set(actorId, 'craftWork', { ms }).
//
// This runs the REAL sizing block and mp.onCraftWork as they stand in the
// gamemode, over a fake mp and every row of game/data/recipes.json, and
// checks:
//   1. every family a recipe row carries has a size, so no row falls to the
//      unsized default without anybody deciding it;
//   2. a warhammer, a greatsword, a cuirass and a shield take 15 seconds, a
//      dagger, a sword, a helmet and boots 5, and an ingot, arrows and a meal
//      1, each by its real row;
//   3. a brew at an alchemy lab with no recipe takes 1 second and an
//      enchantment 5;
//   4. a recipe set in each game (#613), which arrives with no recipe id, is
//      sized by its own row;
//   5. too sick, hurt or tired is refused at once, with the gate's line and
//      no time named;
//   6. a medium or large craft says how long it takes and that getting up
//      stops it, with no em dash in the line; a small one says nothing;
//   7. guard() refuses onCraftWork for a session still waiting for its pass,
//      the way it refuses onCraft (#410).
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
const SRC = process.env.GM || path.join(ROOT, 'game', 'gamemode.js');
const gm = fs.readFileSync(SRC, 'utf8').split(CR).join('');
const RECIPES = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'recipes.json'), 'utf8')).recipes;

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function slice(start, end) {
  const a = gm.indexOf(start);
  if (a < 0) { return null; }
  const b = gm.indexOf(end, a + start.length);
  return b < 0 ? null : gm.slice(a, b);
}

const WORK_SRC = slice('/*\n  HOW LONG A CRAFT TAKES AT THE BENCH (#3161).', "mp.onCraft = guard('onCraft',");
const ACTS = /const ACTS_AS = \{([^}]*)\}/.exec(gm);
yes('the sizing block and mp.onCraftWork are in the gamemode, before mp.onCraft', !!WORK_SRC);
if (!WORK_SRC) { done(); }

// The rows by recipe id, and the benches by base, as the fake engine knows them.
const ids = {};
let nextId = 1;
Object.keys(RECIPES).forEach(function (desc) { ids[nextId++] = desc; });
const idOf = {};
Object.keys(ids).forEach(function (id) { idOf[ids[id]] = Number(id); });
const BENCHES = { 0xb0001: 'alchemy-lab:Skyrim.esm', 0xb0002: 'enchanter:Skyrim.esm', 0xb0003: 'forge:Skyrim.esm' };
const BENCH_BY_BASE = { 'alchemy-lab:Skyrim.esm': 'alchemy', 'enchanter:Skyrim.esm': 'enchanting', 'forge:Skyrim.esm': '88105:Skyrim.esm' };
const SET_IN_GAME = Object.keys(RECIPES).filter(function (d) { return RECIPES[d].family === 'Body armour'; })[0];

const box = {
  Object: Object, String: String, Number: Number, Array: Array,
  BENCH_BY_BASE: BENCH_BY_BASE,
  unfit: '', notes: [], says: [], logs: [], set: [],
  craftRow: function (desc) { return Object.prototype.hasOwnProperty.call(RECIPES, desc) ? RECIPES[desc] : null; },
  recipeSetInGame: function (out, bench, inputs) { return (inputs && inputs.setInGame) ? SET_IN_GAME : null; },
  unfitToMake: function () { return box.unfit; },
  notify: function (id, text) { box.notes.push(text); },
  say: function (id, text) { box.says.push(text); },
  log: function () { box.logs.push(Array.prototype.join.call(arguments, ' ')); },
  guard: function (name, fn) { return fn; },
  mp: {
    getDescFromId: function (id) { return ids[id] || null; },
    get: function (id, what) { if (what !== 'baseDesc') { throw new Error('not faked: ' + what); } return BENCHES[id]; },
    set: function (id, what, value) { box.set.push([id, what, value]); },
  },
};
box.globalThis = box;
vm.createContext(box);
vm.runInContext(WORK_SRC + '\nthis.CRAFT_SIZE_BY_FAMILY = CRAFT_SIZE_BY_FAMILY;', box);

const ACTOR = 0xff000001;
function work(recipeId, bench, out, inputs) {
  box.notes = []; box.says = []; box.set = [];
  const answer = box.mp.onCraftWork(ACTOR, out || 0x1, 1, recipeId, bench || 0xb0003, null, inputs || []);
  const named = box.set.filter(function (s) { return s[1] === 'craftWork'; });
  return { answer: answer, ms: named.length === 1 ? named[0][2].ms : null, named: named.length, notes: box.notes, says: box.says };
}
function rowNamed(name, family) {
  const d = Object.keys(RECIPES).filter(function (k) { return RECIPES[k].name === name && (!family || RECIPES[k].family === family); })[0];
  return d ? idOf[d] : 0;
}

// 1.
const families = {};
Object.keys(RECIPES).forEach(function (d) { families[RECIPES[d].family] = true; });
const unsized = Object.keys(families).filter(function (f) { return !Object.prototype.hasOwnProperty.call(box.CRAFT_SIZE_BY_FAMILY, f); });
yes('1. every family a recipe row carries has a size' + (unsized.length ? ' (unsized: ' + unsized.join(', ') + ')' : ''), unsized.length === 0);

// 2.
const cases = [
  ['Steel Warhammer', 'Warhammers', 15000], ['Steel Greatsword', 'Greatswords', 15000],
  ['Steel Armor', 'Body armour', 15000], ['Steel Shield', 'Shields', 15000],
  ['Steel Dagger', 'Daggers', 5000], ['Steel Sword', 'Swords', 5000],
  ['Steel Helmet', 'Helmets', 5000], ['Iron Boots', 'Armoured boots', 5000],
  ['Steel Ingot', 'Ingots', 1000], ['Steel Arrow', 'Arrows and bolts', 1000],
];
const wrong = [];
cases.forEach(function (c) {
  const id = rowNamed(c[0], c[1]);
  const r = id ? work(id) : null;
  if (!r || r.ms !== c[2] || r.answer === false) { wrong.push(c[0] + ' ' + (id ? (r && r.ms) : 'has no row')); }
});
const meal = Object.keys(RECIPES).filter(function (d) { return RECIPES[d].type === 'ALCH'; })[0];
const mealWork = meal ? work(idOf[meal]) : null;
if (!mealWork || mealWork.ms !== 1000) { wrong.push('a meal ' + (mealWork && mealWork.ms)); }
yes('2. two-handed weapons, cuirasses and shields 15 s, blades and pieces 5 s, ingots, arrows and meals 1 s' +
    (wrong.length ? ' (wrong: ' + wrong.join('; ') + ')' : ''), wrong.length === 0);

// 3.
const brew = work(0, 0xb0001, 0xff000123);
const enchant = work(0, 0xb0002, 0xff000124);
yes('3. a brew with no recipe takes 1 s and an enchantment 5 s', brew.ms === 1000 && enchant.ms === 5000);

// 4.
const inputs = []; inputs.setInGame = true;
const setInGame = work(0, 0xb0003, 0x2, inputs);
yes('4. a recipe set in each game is sized by its own row (body armour, 15 s)', !!SET_IN_GAME && setInGame.ms === 15000);

// 5.
box.unfit = 'You are too tired to work. Rest first.';
const tired = work(rowNamed('Steel Warhammer', 'Warhammers'));
box.unfit = '';
yes('5. too tired is refused at once, with the gate\'s line and no time named',
    tired.answer === false && tired.named === 0 && tired.notes.indexOf('You are too tired to work. Rest first.') >= 0 &&
    tired.says.indexOf('You are too tired to work. Rest first.') >= 0);

// 6.
const big = work(rowNamed('Steel Warhammer', 'Warhammers'));
const small = work(rowNamed('Steel Ingot', 'Ingots'));
yes('6. a large craft says how long it takes and that getting up stops it; a small one says nothing',
    big.notes.length === 1 && /Steel Warhammer takes 15 seconds/.test(big.notes[0]) && /getting up stops the work/.test(big.notes[0]) &&
    small.notes.length === 0 && big.notes[0].indexOf(String.fromCharCode(0x2014)) < 0);

// 7.
yes('7. guard() treats onCraftWork as the person acting, as it does onCraft', !!ACTS && /\bonCraftWork: 0\b/.test(ACTS[1]));

done();
