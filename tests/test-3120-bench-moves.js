// test-3120-bench-moves.js
//
// #3120. Patrick, 21 October 2026: "make sure if a bench has a recipoe that
// should be on adifferent bench it should get moved". A mod's recipe at a
// bench its trade does not work at (48 of Immersive Armors' clothes at the
// forge, so the forge opened for every Tailor) is moved to its trade's own
// bench.
//
// What it holds:
//
//   - recipes.json: every row somebody can make sits at a bench its trade
//     works at (TRADE_BENCHES in scripts/dev/Build-RecipeTable.ps1), and each
//     moved row names the bench its mod put it at and stands at its trade's
//     home bench;
//   - Thornswood-Last.esp's manifest carries every move, and the moves of a
//     plugin it never copies from are handed to each game instead, as the
//     gamemode's RECIPES_MOVED_IN_GAME block;
//   - recipeMovedInGame, run out of game/gamemode.js over a fake mp, names a
//     moved recipe from its output, its new bench and exactly its counts, and
//     nothing else;
//   - onCraft goes on with that recipe, and refuses one crafted at the bench
//     its mod put it at.
//
// The table half holds once game/data/recipes.json and Thornswood-Last.esp
// are rebuilt (scripts/mods/Rebuild-ContentTables.ps1). Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const REPO = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8').split(CR).join('').replace(/^﻿/, '');
const src = require('./gamemode-tables.js').joined(read('game/gamemode.js'));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function take(start, end) {
  const i = src.indexOf(start);
  const j = i < 0 ? -1 : src.indexOf(end || '\n}\n', i);
  return (i >= 0 && j >= 0) ? src.slice(i, j + (end || '\n}\n').length) : null;
}

// ------------------------------------------------------- the trades' benches --
const ps = read('scripts/dev/Build-RecipeTable.ps1');
const knobAt = ps.indexOf('$TRADE_BENCHES = [ordered]@{');
const knob = knobAt < 0 ? '' : ps.slice(knobAt, ps.indexOf('\n}\n', knobAt));
const TRADES = {};
const tradeRe = /^\s+'(\w+)'\s+=\s+@\{\s*Home = '([^']+)'[\s;]*Benches = @\(([^)]*)\)(?:\s*Only = @\{([^}]*)\})?/gm;
let m;
while ((m = tradeRe.exec(knob)) !== null) {
  const only = {};
  (m[4] || '').replace(/'([^']+)'\s*=\s*@\(([^)]*)\)/g, function (_, bench, list) {
    only[bench] = (list.match(/'([^']+)'/g) || []).map(function (s) { return s.slice(1, -1); });
    return '';
  });
  TRADES[m[1]] = { home: m[2], benches: (m[3].match(/'([^']+)'/g) || []).map(function (s) { return s.slice(1, -1); }), only: only };
}
yes('K1 Build-RecipeTable.ps1 names each trade\'s home bench and the benches it works at (' + Object.keys(TRADES).join(', ') + ')',
    ['Smith', 'Tailor', 'Woodworker', 'Enchanter', 'Cook', 'Alchemist'].every(function (t) {
      return TRADES[t] && TRADES[t].benches.indexOf(TRADES[t].home) >= 0;
    }) && TRADES.Tailor.home === 'MCE_CraftingLoom' && TRADES.Woodworker.home === 'ThornswoodCraftingWoodworking' &&
    TRADES.Tailor.benches.indexOf('CraftingSmithingForge') < 0 && TRADES.Woodworker.benches.indexOf('CraftingSmithingForge') < 0);
function works(trade, row, at) {
  const t = TRADES[trade];
  if (!t || t.benches.indexOf(at) < 0) { return false; }
  return !t.only[at] || t.only[at].indexOf(row.family) >= 0;
}

// --------------------------------------------------------------- the table --
const recipes = JSON.parse(read('game/data/recipes.json')).recipes;
const keys = Object.keys(recipes);
const live = keys.filter(function (k) {
  const r = recipes[k];
  return r.owner && r.fires !== false && r.book !== 'cut';
});
const wrong = live.filter(function (k) { return !works(recipes[k].owner, recipes[k], recipes[k].benchName); });
yes('R1 every row somebody can make sits at a bench its trade works at (' + live.length + ' rows' +
    (wrong.length ? '; not: ' + wrong.slice(0, 4).map(function (k) { return recipes[k].name + ' at ' + recipes[k].benchName; }).join(', ') +
      ', run scripts/mods/Rebuild-ContentTables.ps1' : '') + ')', live.length > 500 && wrong.length === 0);
const moved = keys.filter(function (k) { return !!recipes[k].movedFrom; });
const homeKw = {};
yes('R2 each moved row stands at its trade\'s home bench and names the bench its mod put it at, one its trade does not work at (' +
    moved.length + ')', moved.length > 0 && moved.every(function (k) {
      const r = recipes[k];
      const t = TRADES[r.owner];
      if (!t || r.benchName !== t.home || works(r.owner, r, r.movedFromName) || r.movedFrom === r.bench) { return false; }
      if (homeKw[r.benchName] && homeKw[r.benchName] !== r.bench) { return false; }
      homeKw[r.benchName] = r.bench;
      return /^[0-9a-f]+:.+\.(esm|esp|esl)$/.test(r.movedFrom) && /^[0-9a-f]+:.+\.(esm|esp|esl)$/.test(r.bench);
    }));
const iaTailor = keys.filter(function (k) {
  return recipes[k].plugin === 'Hothtrooper44_ArmorCompilation.esp' && recipes[k].owner === 'Tailor' && recipes[k].fires !== false &&
    recipes[k].book !== 'cut';
});
yes('R3 none of Immersive Armors\' Tailor clothes is made at the forge any more (' + iaTailor.length + ')',
    iaTailor.length > 0 && iaTailor.every(function (k) { return recipes[k].benchName !== 'CraftingSmithingForge'; }));

// ------------------------------------------------------ the last plugin --
const manifest = JSON.parse(read('game/data/last-plugin.json'));
const never = ((manifest.notCopiedFrom || {}).plugins || []).map(function (p) { return p.toLowerCase(); });
const inLast = manifest.benchMoves || [];
const inGame = manifest.benchMovesInGame || [];
const named = {};
inLast.concat(inGame).forEach(function (x) { named[x.recipe] = (named[x.recipe] || 0) + 1; });
yes('L1 Thornswood-Last.esp\'s manifest carries every move once (' + inLast.length + ' in the plugin, ' + inGame.length + ' in each game)',
    moved.length > 0 && Object.keys(named).length === moved.length &&
    moved.every(function (k) { return named[k] === 1; }) &&
    inLast.concat(inGame).every(function (x) {
      const r = recipes[x.recipe];
      return r && x.from === r.movedFrom && x.to === r.bench && x.editorId === r.editorId;
    }) && (manifest.counts || {}).recipesMoved === inLast.length && (manifest.counts || {}).recipesMovedInGame === inGame.length);
yes('L2 a move goes to each game exactly when its recipe\'s plugin is one the last plugin never copies from',
    inGame.every(function (x) { return never.indexOf(recipes[x.recipe].plugin.toLowerCase()) >= 0; }) &&
    inLast.every(function (x) { return never.indexOf(recipes[x.recipe].plugin.toLowerCase()) < 0; }));

const BLOCK = take('var RECIPES_MOVED_IN_GAME = ', ';\n');
const box = {};
vm.createContext(box);
try { vm.runInContext((BLOCK || '') + '\nthis.T = typeof RECIPES_MOVED_IN_GAME === "object" ? RECIPES_MOVED_IN_GAME : null;', box); } catch (e) { box.T = null; }
const T = box.T || {};
yes('L3 the gamemode\'s RECIPES_MOVED_IN_GAME is the manifest\'s moves in each game, with the record\'s inputs (' +
    Object.keys(T).length + ')', !!box.T && Object.keys(T).length === inGame.length && inGame.length > 0 &&
    inGame.every(function (x) {
      const row = T[x.recipe];
      return row && row.from === x.from && row.to === x.to && row.out === recipes[x.recipe].out && row.name === x.name &&
        Array.isArray(row.inputs) && row.inputs.length > 0 && row.inputs.every(function (i) { return /:/.test(i[0]) && i[1] > 0; });
    }));

// ---------------------------------------------------------------- the server --
const NAMER = take('function recipeMovedInGame(craftedItemBaseId, workbenchId, inputs) {');
yes('S0 recipeMovedInGame is in the gamemode', !!NAMER);
if (!NAMER) { done(); }
function idOf(desc) {
  const at = desc.indexOf(':');
  const files = { 'Skyrim.esm': 0x00, 'Update.esm': 0x01, 'Hothtrooper44_ArmorCompilation.esp': 0x5a };
  return (files[desc.slice(at + 1)] << 24) + parseInt(desc.slice(0, at), 16);
}
function descOf(id) {
  const files = { 0x00: 'Skyrim.esm', 0x01: 'Update.esm', 0x5a: 'Hothtrooper44_ArmorCompilation.esp' };
  return (id & 0xffffff).toString(16) + ':' + files[id >>> 24];
}
const FORGE = 0x77, LOOM = 0x78;
// Two moved rows of a fake table, and one of them has its counts set in each
// game too (#613), the way Immersive Armors' eyepatch does.
const MOVED = {
  '1d90:Hothtrooper44_ArmorCompilation.esp': { name: 'Fur Hood - White', out: '48e0:Hothtrooper44_ArmorCompilation.esp',
    from: '88105:Skyrim.esm', to: '1234:Update.esm', inputs: [['800e4:Skyrim.esm', 2], ['da0bf1:Update.esm', 2]] },
  '286a:Hothtrooper44_ArmorCompilation.esp': { name: 'Eyepatch', out: '285f:Hothtrooper44_ArmorCompilation.esp',
    from: '88105:Skyrim.esm', to: '1234:Update.esm', inputs: [['f:Skyrim.esm', 1], ['800e4:Skyrim.esm', 1]] }
};
const ctx = {
  mp: {
    getDescFromId: descOf,
    get: function (id, key) { return key === 'baseDesc' ? (id === FORGE ? 'forgebase:Skyrim.esm' : id === LOOM ? 'loombase:Update.esm' : null) : undefined; }
  },
  JSON: JSON, Object: Object, Array: Array, String: String, Number: Number,
  BENCH_BY_BASE: { 'forgebase:Skyrim.esm': '88105:Skyrim.esm', 'loombase:Update.esm': '1234:Update.esm' },
  RECIPES_MOVED_IN_GAME: MOVED,
  RECIPES_SET_IN_GAME: { '286a:Hothtrooper44_ArmorCompilation.esp': {} }
};
vm.createContext(ctx);
vm.runInContext(NAMER + '\nthis.named = recipeMovedInGame;', ctx);
function sent(list) { return list.map(function (i) { return { baseId: idOf(i[0]), count: i[1] }; }); }
const hood = MOVED['1d90:Hothtrooper44_ArmorCompilation.esp'];
yes('S1 a craft of the output at its new bench with exactly the record\'s counts is that recipe',
    ctx.named(idOf(hood.out), LOOM, sent(hood.inputs)) === '1d90:Hothtrooper44_ArmorCompilation.esp' &&
    ctx.named(idOf(hood.out), LOOM, sent([['800e4:Skyrim.esm', 1], ['800e4:Skyrim.esm', 1], ['da0bf1:Update.esm', 2]])) ===
      '1d90:Hothtrooper44_ArmorCompilation.esp');
yes('S2 at the bench its mod put it at, one short, one extra, another output, or no inputs: none of them is',
    ctx.named(idOf(hood.out), FORGE, sent(hood.inputs)) === null &&
    ctx.named(idOf(hood.out), LOOM, sent([['800e4:Skyrim.esm', 1], ['da0bf1:Update.esm', 2]])) === null &&
    ctx.named(idOf(hood.out), LOOM, sent(hood.inputs.concat([['5ace4:Skyrim.esm', 1]]))) === null &&
    ctx.named(idOf('12eb7:Skyrim.esm'), LOOM, sent(hood.inputs)) === null &&
    ctx.named(idOf(hood.out), LOOM, null) === null);
const patch = MOVED['286a:Hothtrooper44_ArmorCompilation.esp'];
yes('S3 a moved recipe whose counts are set in each game is not named at its record\'s counts (recipeSetInGame names it at the new ones)',
    ctx.named(idOf(patch.out), LOOM, sent(patch.inputs)) === null);

// ----------------------------------------------------------------- onCraft --
const onCraft = take('mp.onCraft = guard(\'onCraft\', function', '\n});\n') || '';
const setAt = onCraft.indexOf('desc = recipeSetInGame(');
const movedAt = onCraft.indexOf('desc = recipeMovedInGame(');
const recipelessAt = onCraft.indexOf('return recipelessCraft(');
yes('O1 onCraft names a craft with no recipe id as a moved recipe after the recipes set in game, before treating it as recipeless',
    setAt > 0 && movedAt > setAt && recipelessAt > movedAt);
const refuseAt = onCraft.indexOf('Object.prototype.hasOwnProperty.call(RECIPES_MOVED_IN_GAME, desc)');
const descAt = onCraft.indexOf('desc = mp.getDescFromId(recipeId);');
const refusal = refuseAt < 0 ? '' : onCraft.slice(refuseAt, onCraft.indexOf('return false;', refuseAt) + 13);
yes('O2 and refuses a moved recipe crafted by its record at the bench its mod put it at, with a line saying so',
    descAt > 0 && refuseAt > descAt && /is not made at this bench here/.test(refusal) && /notify\(actorId, no\)/.test(refusal) &&
    /return false;$/.test(refusal));

done();
