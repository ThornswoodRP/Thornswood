// test-6726-fuel-in-game.js
//
// #6726, Patrick's B: the charcoal and the handle are inputs on the forge's
// recipes. Thornswood-Last.esp writes them into every recipe it copies; one
// of Immersive Armors', which is never copied (#2454), gets them in each
// person's game from RECIPES_FUELED_IN_GAME, through the same counts script
// that sets the re-costed counts (#613), with the fork's
// TESModPlatform.SetCraftingInput for an input the record does not name.
//
// What it holds, running the real functions out of game/gamemode.js over a
// fake mp and a fake game:
//
//   M  recipesSetInGame: a fueled row is its record's inputs, each [item, had,
//      had], with the added ones after them [item, 0, n]; one re-costed too
//      takes them on top of its new counts; an added item the record names
//      already asks that many more;
//   G  the counts script adds each missing input with setCraftingInput and
//      sets the rest, asking again changes nothing, a record whose inputs are
//      not the ones measured is left alone, and a client without the native
//      leaves the recipe as its record has it;
//   S  recipeSetInGame names a craft of the output at its bench with the
//      charcoal and the handle, and not one at the record's own counts;
//   R  recipeMetadataRefusal refuses a craft matched to the record, and
//      recipeMovedInGame leaves a fueled recipe to recipeSetInGame;
//   T  the gamemode reads the table, and the server takes no charcoal and no
//      handle of its own.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const REPO = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
const src = require('../../tests/gamemode-tables.js').joined(fs.readFileSync(path.join(REPO, 'game', 'gamemode.js'), 'utf8')).split(CR).join('');
const benches = fs.readFileSync(path.join(REPO, 'game', 'gamemode', 'the-benches.ts'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function attempt(what, f) {
  try { f(); } catch (e) { yes(what + ' threw: ' + (e && e.stack ? e.stack : e), false); }
}
function take(start, end) {
  const i = src.indexOf(start);
  const j = i < 0 ? -1 : src.indexOf(end || '\n}\n', i);
  return (i >= 0 && j >= 0) ? src.slice(i, j + (end || '\n}\n').length) : null;
}

const PARTS = [
  take('function recipesSetInGame() {'),
  take('function recipeCountsScript() {'),
  take('function recipeSetInGame(craftedItemBaseId, workbenchId, inputs) {'),
  take('function recipeMovedInGame(craftedItemBaseId, workbenchId, inputs) {'),
  take('function recipeMetadataRefusal(desc) {')
];
yes('T1 the functions are in the gamemode', PARTS.every(function (p) { return p !== null; }));
yes('T2 the gamemode reads RECIPES_FUELED_IN_GAME and builds SET_IN_GAME from it',
    /var RECIPES_FUELED_IN_GAME = table\('RECIPES_FUELED_IN_GAME'\);/.test(benches) &&
    /var SET_IN_GAME = recipesSetInGame\(\);/.test(benches));
yes('T3 the server takes no charcoal and no handle of its own: onCraft names neither',
    !/charcoalHeld|wantsAHandle|HANDLE_DESC|fuelFor/.test(benches));
if (!PARTS.every(function (p) { return p !== null; })) {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = 1;
} else {

const IA = 'Hothtrooper44_ArmorCompilation.esp';
const POOR = '15481:Thornswood-Content.esp', CHARCOAL = '33760:Skyrim.esm', HANDLE = '15490:Thornswood-Content.esp';
const STEEL = '5ace5:Skyrim.esm', IRON = '5ace4:Skyrim.esm', COIN = 'f:Skyrim.esm';
const FUELED = {
  ['20:' + IA]: { name: 'Wolf Shield', out: '214a1:' + IA, bench: 'f46ce:Skyrim.esm',
                  inputs: [[STEEL, 3]], add: [[POOR, 1]] },
  ['30:' + IA]: { name: 'Iron Axe', out: '214a2:' + IA, bench: '88105:Skyrim.esm',
                  inputs: [[IRON, 2], [CHARCOAL, 1]], add: [[CHARCOAL, 1], [HANDLE, 1]] },
  ['40:' + IA]: { name: 'Steel Buckler', out: '214a3:' + IA, bench: '88105:Skyrim.esm',
                  inputs: [[STEEL, 1], [COIN, 50]], add: [[POOR, 1]] }
};
const SET = {
  ['40:' + IA]: { name: 'Steel Buckler', out: '214a3:' + IA, bench: '88105:Skyrim.esm',
                  inputs: [[STEEL, 1, 2], [COIN, 50, 0]] },
  ['50:' + IA]: { name: 'Glass Buckler', out: '214a4:' + IA, bench: '88105:Skyrim.esm',
                  inputs: [[STEEL, 1, 4]] }
};
const MOVED = {
  ['20:' + IA]: { name: 'Wolf Shield', out: '214a1:' + IA, from: '88105:Skyrim.esm', to: 'f46ce:Skyrim.esm',
                  inputs: [[STEEL, 3]] }
};

const files = { 'Skyrim.esm': 0x00, 'Thornswood-Content.esp': 0x05, [IA]: 0x5a };
function idOf(desc) {
  const at = desc.indexOf(':');
  return (files[desc.slice(at + 1)] << 24) + parseInt(desc.slice(0, at), 16);
}
function descOf(id) {
  const back = {};
  Object.keys(files).forEach(function (f) { back[files[f]] = f; });
  return (id & 0xffffff).toString(16) + ':' + back[id >>> 24];
}
const FORGE = 0x77, SKYFORGE = 0x78;
const ctx = {
  mp: {
    getDescFromId: descOf,
    get: function (id, key) { return key === 'baseDesc' ? (id === FORGE ? 'forgebase:Skyrim.esm' : id === SKYFORGE ? 'skybase:Skyrim.esm' : null) : undefined; }
  },
  JSON: JSON, Object: Object, Array: Array, String: String, Number: Number,
  BENCH_BY_BASE: { 'forgebase:Skyrim.esm': '88105:Skyrim.esm', 'skybase:Skyrim.esm': 'f46ce:Skyrim.esm' },
  RECIPES_SET_IN_GAME: SET, RECIPES_FUELED_IN_GAME: FUELED, RECIPES_MOVED_IN_GAME: MOVED
};
vm.createContext(ctx);
vm.runInContext(PARTS.join('\n') + '\nvar SET_IN_GAME = recipesSetInGame();\n' +
                'this.api = { merged: SET_IN_GAME, script: recipeCountsScript(), named: recipeSetInGame, ' +
                'moved: recipeMovedInGame, refusal: recipeMetadataRefusal };', ctx);
const api = ctx.api;

// ------------------------------------------------------------------- M --
const M = JSON.parse(JSON.stringify(api.merged));
yes('M1 a fueled row is its record\'s inputs, each [item, had, had], then the added ones [item, 0, n]',
    JSON.stringify(M['20:' + IA].inputs) === JSON.stringify([[STEEL, 3, 3], [POOR, 0, 1]]) &&
    M['20:' + IA].bench === 'f46ce:Skyrim.esm' && M['20:' + IA].out === '214a1:' + IA);
yes('M2 an added item the record already names asks that many more, and the handle comes after',
    JSON.stringify(M['30:' + IA].inputs) === JSON.stringify([[IRON, 2, 2], [CHARCOAL, 1, 2], [HANDLE, 0, 1]]));
yes('M3 one re-costed as well takes the charcoal on top of its new counts',
    JSON.stringify(M['40:' + IA].inputs) === JSON.stringify([[STEEL, 1, 2], [COIN, 50, 0], [POOR, 0, 1]]));
yes('M4 a re-costed row with no fuel is as RECIPES_SET_IN_GAME has it, and the table it came from is unchanged',
    JSON.stringify(M['50:' + IA]) === JSON.stringify(SET['50:' + IA]) &&
    JSON.stringify(SET['40:' + IA].inputs) === JSON.stringify([[STEEL, 1, 2], [COIN, 50, 0]]));

// ------------------------------------------------------------------- G --
function game(records, native) {
  const forms = {};
  function form(desc) {
    if (!forms[desc]) { forms[desc] = { desc: desc, getFormID: function () { return idOf(desc); } }; }
    return forms[desc];
  }
  const added = [];
  const cobjs = {};
  Object.keys(records).forEach(function (key) {
    const list = records[key].map(function (i) { return [i[0], i[1]]; });
    cobjs[key] = {
      list: list,
      getNumIngredients: function () { return list.length; },
      getNthIngredient: function (n) { return list[n] ? form(list[n][0]) : null; },
      getNthIngredientQuantity: function (n) { return list[n] ? list[n][1] : 0; },
      setNthIngredientQuantity: function (c, n) { list[n][1] = c; }
    };
  });
  const sp = {
    Game: { getFormFromFile: function (id, file) { return form(id.toString(16) + ':' + file); } },
    ConstructibleObject: { from: function (f) { return f && cobjs[f.desc] ? cobjs[f.desc] : null; } }
  };
  if (native) {
    sp.TESModPlatform = {
      setCraftingInput: function (recipe, item, count) {
        added.push([recipe.desc, item.desc, count]);
        const list = cobjs[recipe.desc].list;
        for (let i = 0; i < list.length; i++) { if (list[i][0] === item.desc) { list[i][1] = count; return; } }
        list.push([item.desc, count]);
      }
    };
  } else {
    sp.TESModPlatform = {};
  }
  const state = {};
  function run(at) {
    const rows = {};
    Object.keys(M).forEach(function (k) { rows[k] = M[k].inputs; });
    const box = { ctx: { value: { at: at, rows: rows }, state: state, sp: sp } };
    vm.createContext(box);
    vm.runInContext(api.script, box);
  }
  return { cobjs: cobjs, added: added, run: run };
}
attempt('the counts script', function () {
  const records = {
    ['20:' + IA]: [[STEEL, 3]],
    ['30:' + IA]: [[IRON, 2], [CHARCOAL, 1]],
    ['40:' + IA]: [[STEEL, 1], [COIN, 50]],
    ['50:' + IA]: [[STEEL, 1]]
  };
  const g = game(records, true);
  g.run(1);
  yes('G1 the shield gets its Poor Charcoal as a new input',
      JSON.stringify(g.cobjs['20:' + IA].list) === JSON.stringify([[STEEL, 3], [POOR, 1]]));
  yes('G2 the axe asks one more Charcoal and gets its handle',
      JSON.stringify(g.cobjs['30:' + IA].list) === JSON.stringify([[IRON, 2], [CHARCOAL, 2], [HANDLE, 1]]));
  yes('G3 the re-costed buckler gets its new counts and the charcoal',
      JSON.stringify(g.cobjs['40:' + IA].list) === JSON.stringify([[STEEL, 2], [COIN, 0], [POOR, 1]]));
  yes('G4 and the re-costed one with no fuel only its counts, with no input added',
      JSON.stringify(g.cobjs['50:' + IA].list) === JSON.stringify([[STEEL, 4]]) &&
      !g.added.some(function (a) { return a[0] === '50:' + IA; }));
  const before = JSON.stringify(g.cobjs);
  const asked = g.added.length;
  g.run(1);
  yes('G5 the same stamp again does nothing', g.added.length === asked && JSON.stringify(g.cobjs) === before);
  g.run(2);
  yes('G6 a new stamp, on records that already have them all, changes nothing',
      JSON.stringify(g.cobjs) === before);
  const odd = game({ ['20:' + IA]: [[IRON, 3]] }, true);
  odd.run(1);
  yes('G7 a record whose inputs are not the ones measured is left alone',
      JSON.stringify(odd.cobjs['20:' + IA].list) === JSON.stringify([[IRON, 3]]) && odd.added.length === 0);
  const old = game({ ['20:' + IA]: [[STEEL, 3]], ['50:' + IA]: [[STEEL, 1]] }, false);
  old.run(1);
  yes('G8 a client with no SetCraftingInput leaves a fueled recipe as its record has it, and still sets the re-costed one',
      JSON.stringify(old.cobjs['20:' + IA].list) === JSON.stringify([[STEEL, 3]]) &&
      JSON.stringify(old.cobjs['50:' + IA].list) === JSON.stringify([[STEEL, 4]]));
});

// ------------------------------------------------------------------- S --
function sent(list) { return list.map(function (i) { return { baseId: idOf(i[0]), count: i[1] }; }); }
yes('S1 a craft of the shield at the skyforge with its steel and one Poor Charcoal is that recipe',
    api.named(idOf('214a1:' + IA), SKYFORGE, sent([[STEEL, 3], [POOR, 1]])) === '20:' + IA);
yes('S2 the axe with two Charcoal and a handle is that recipe',
    api.named(idOf('214a2:' + IA), FORGE, sent([[IRON, 2], [CHARCOAL, 2], [HANDLE, 1]])) === '30:' + IA);
yes('S3 neither at its record\'s own counts, nor with the handle left out',
    api.named(idOf('214a1:' + IA), SKYFORGE, sent([[STEEL, 3]])) === null &&
    api.named(idOf('214a2:' + IA), FORGE, sent([[IRON, 2], [CHARCOAL, 2]])) === null);

// ------------------------------------------------------------------- R --
yes('R1 a craft matched to a fueled recipe\'s record is refused, and says to look again',
    /takes different materials here/.test(api.refusal('20:' + IA)) && api.refusal('99:Skyrim.esm') === '');
yes('R2 recipeMovedInGame leaves a fueled recipe to recipeSetInGame, at its record\'s counts too',
    api.moved(idOf('214a1:' + IA), SKYFORGE, sent([[STEEL, 3]])) === null);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
}
