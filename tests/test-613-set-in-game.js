// test-613-set-in-game.js
//
// #613 and #2454. Patrick, 22 October 2026, on the report page
// (q-613-ia-recipes, C): the re-cost changes 17 forge recipes of Immersive
// Armors, and nothing of that mod is copied (#2454), so their counts are set
// in each person's game and the server accepts a craft at them. And his note
// with it: the 6 floor items it places and their 5 cell and world headers
// were never his to carry, so the server holds those floor items off instead.
//
// What it holds, running the real functions out of game/gamemode.js over a
// fake mp and a fake game:
//
//   - RECIPES_SET_IN_GAME is recost.json's notCopied, and Build-Recost.py
//     --check says the block is what the rule gives;
//   - handRecipeCounts hands every recipe's inputs once a load;
//   - the owner script sets each count on a record with the measured inputs,
//     coins to 0, leaves a different record alone, and acts once a stamp;
//   - recipeSetInGame names a recipe from its output, bench and exactly the
//     new counts, and nothing else;
//   - onCraft goes on with that recipe, refuses the mod's own counts, and the
//     counts are handed at spawn;
//   - the policy carries nothing of a never-copied plugin, HELD_BY_SERVER
//     is the manifest's heldByServer, and holdNeverCopiedOff holds each off.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const REPO = path.join(__dirname, '..');
const SRC = path.join(REPO, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = require('./gamemode-tables.js').joined(fs.readFileSync(SRC, 'utf8')).split(CR).join('');

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

const recost = JSON.parse(fs.readFileSync(path.join(REPO, 'game', 'data', 'recost.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'game', 'data', 'last-plugin.json'), 'utf8'));
const policy = JSON.parse(fs.readFileSync(path.join(REPO, 'game', 'data', 'last-plugin-policy.json'), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(path.join(REPO, 'game', 'data', 'recipes.json'), 'utf8')).recipes;

const BLOCK = take('var RECIPES_SET_IN_GAME = ', ';\n');
const FLOOR = take('var HELD_BY_SERVER = ', ';\n');
const PARTS = [
  take('function recipeCountsScript() {'),
  take('function handRecipeCounts(actorId) {'),
  take('function recipeSetInGame(craftedItemBaseId, workbenchId, inputs) {'),
  take('function holdNeverCopiedOff() {')
];
const PROPERTY = (/^var RECIPE_COUNTS_PROPERTY = '([^']+)';$/m.exec(src) || [])[1];
const ok = BLOCK && FLOOR && PARTS.every(function (p) { return p !== null; }) && !!PROPERTY;
yes('the generated blocks and the functions that use them are in the gamemode', !!ok);
if (!ok) { done(); }

// ------------------------------------------------------------ the table --
// The runner's Python is `python` or `py`, not `python3`; ask each in turn.
function python(args) {
  for (const exe of ['python', 'py', 'python3']) {
    const p = spawnSync(exe, args, { encoding: 'utf8', maxBuffer: 1 << 26,
                                     env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' }) });
    if (!p.error) { return p; }
  }
  return null;
}
const check = python([path.join(REPO, 'scripts', 'dev', 'Build-Recost.py'), '--check']);
yes('T1 Build-Recost.py --check: recost.json and the RECIPES_SET_IN_GAME block are what the rule gives (' +
    (check ? String(check.stdout || check.stderr).trim().split('\n').pop() : 'no python') + ')', !!check && check.status === 0);

const box = {};
vm.createContext(box);
vm.runInContext(BLOCK + '\n' + FLOOR + '\nthis.T = RECIPES_SET_IN_GAME; this.F = HELD_BY_SERVER;', box);
const T = box.T;
const keys = Object.keys(T).sort();
yes('T2 it is recost.json\'s notCopied, each with the output, bench and inputs [item, had, asks] (' + keys.length + ')',
    keys.length === recost.notCopied.length && keys.length > 0 &&
    recost.notCopied.every(function (r) {
      const row = T[r.recipe];
      return row && row.out === recipes[r.recipe].out && row.bench === recipes[r.recipe].bench &&
        JSON.stringify(row.inputs) === JSON.stringify(r.inputs.map(function (i) { return [i.item, i.count, i.to]; }));
    }));
const coinRow = keys.filter(function (k) { return T[k].inputs.some(function (i) { return i[0] === 'f:Skyrim.esm'; }); })[0];
const peerRow = keys.filter(function (k) { return T[k].inputs.every(function (i) { return i[0] !== 'f:Skyrim.esm'; }); })[0];
yes('T3 coins are taken to 0 in each recipe that charged them, and only coins are', !!coinRow && !!peerRow &&
    keys.every(function (k) { return T[k].inputs.every(function (i) { return (i[2] === 0) === (i[0] === 'f:Skyrim.esm'); }); }));

// ------------------------------------------------------------- the server --
function idOf(desc) {
  const at = desc.indexOf(':');
  const files = { 'Skyrim.esm': 0x00, 'Update.esm': 0x01, 'Hothtrooper44_ArmorCompilation.esp': 0x5a };
  return (files[desc.slice(at + 1)] << 24) + parseInt(desc.slice(0, at), 16);
}
function descOf(id) {
  const files = { 0x00: 'Skyrim.esm', 0x01: 'Update.esm', 0x5a: 'Hothtrooper44_ArmorCompilation.esp' };
  return (id & 0xffffff).toString(16) + ':' + files[id >>> 24];
}
const FORGE = 0x77;
const SKYFORGE = 0x78;
function server() {
  const store = {};
  const sets = [];
  const mp = {
    makeProperty: function () { },
    getDescFromId: function (id) { return descOf(id); },
    get: function (id, key) {
      if (key === 'baseDesc') { return id === FORGE ? 'forgebase:Skyrim.esm' : id === SKYFORGE ? 'skybase:Skyrim.esm' : null; }
      const p = store[id] || {};
      return Object.prototype.hasOwnProperty.call(p, key) ? JSON.parse(p[key]) : undefined;
    },
    set: function (id, key, value) { sets.push([id, key]); (store[id] = store[id] || {})[key] = JSON.stringify(value); }
  };
  const ctx = {
    mp: mp, JSON: JSON, Object: Object, Array: Array, String: String, Number: Number, Date: Date, parseInt: parseInt,
    log: function () { },
    idOf: idOf,
    BENCH_BY_BASE: { 'forgebase:Skyrim.esm': '88105:Skyrim.esm', 'skybase:Skyrim.esm': 'f46ce:Skyrim.esm' }
  };
  vm.createContext(ctx);
  vm.runInContext(BLOCK + '\n' + FLOOR + '\nvar RECIPE_COUNTS_PROPERTY = ' + JSON.stringify(PROPERTY) +
                  ';\nvar RECIPE_COUNTS_AT = 1234;\n' + PARTS.join('\n') +
                  '\nthis.api = { recipeCountsScript: recipeCountsScript, handRecipeCounts: handRecipeCounts, ' +
                  'recipeSetInGame: recipeSetInGame, holdNeverCopiedOff: holdNeverCopiedOff };', ctx);
  return { mp: mp, store: store, sets: sets, api: ctx.api };
}
const srv = server();
function sent(desc, counts) {
  return T[desc].inputs.map(function (i, n) { return { baseId: idOf(i[0]), count: counts[n] }; })
    .filter(function (e) { return e.count > 0; });
}
const asks = function (k) { return T[k].inputs.map(function (i) { return i[2]; }); };
const had = function (k) { return T[k].inputs.map(function (i) { return i[1]; }); };

yes('S1 a craft of the output at its bench with exactly the new counts is that recipe, for all ' + keys.length,
    keys.every(function (k) { return srv.api.recipeSetInGame(idOf(T[k].out), FORGE, sent(k, asks(k))) === k ||
      T[k].bench !== '88105:Skyrim.esm'; }));
yes('S2 the coin recipe is named with no coins sent, and not with its coins (' + T[coinRow].name.trim() + ')',
    srv.api.recipeSetInGame(idOf(T[coinRow].out), FORGE, sent(coinRow, asks(coinRow))) === coinRow &&
    srv.api.recipeSetInGame(idOf(T[coinRow].out), FORGE,
      sent(coinRow, asks(coinRow)).concat([{ baseId: idOf('f:Skyrim.esm'), count: 50 }])) === null);
yes('S3 the mod\'s own counts are no recipe set in game (the engine matches its record for those)',
    keys.every(function (k) { return JSON.stringify(had(k)) === JSON.stringify(asks(k)) ||
      srv.api.recipeSetInGame(idOf(T[k].out), FORGE, sent(k, had(k))) === null; }));
const one = keys.filter(function (k) { return T[k].bench === '88105:Skyrim.esm'; })[0];
yes('S4 one short, one extra input, another bench, another output: none of them is',
    srv.api.recipeSetInGame(idOf(T[one].out), FORGE, sent(one, asks(one).map(function (c, n) { return n === 0 && c > 1 ? c - 1 : c; }).map(function (c, n) { return n === 0 && c === asks(one)[0] ? 0 : c; }))) === null &&
    srv.api.recipeSetInGame(idOf(T[one].out), FORGE, sent(one, asks(one)).concat([{ baseId: idOf('5ace4:Skyrim.esm'), count: 9 }])) === null &&
    srv.api.recipeSetInGame(idOf(T[one].out), SKYFORGE, sent(one, asks(one))) === null &&
    srv.api.recipeSetInGame(idOf('12eb7:Skyrim.esm'), FORGE, sent(one, asks(one))) === null &&
    srv.api.recipeSetInGame(idOf(T[one].out), FORGE, null) === null);

srv.api.handRecipeCounts(0x14);
const handed = srv.mp.get(0x14, PROPERTY);
srv.api.handRecipeCounts(0x14);
yes('S5 handRecipeCounts hands every recipe\'s inputs once a load, and not again in the same load',
    handed && handed.at === 1234 && Object.keys(handed.rows).length === keys.length &&
    keys.every(function (k) { return JSON.stringify(handed.rows[k]) === JSON.stringify(T[k].inputs); }) &&
    srv.sets.filter(function (s) { return s[1] === PROPERTY; }).length === 1);

// ---------------------------------------------------------- the person's game --
{
  const records = {};
  keys.forEach(function (k) {
    records[k] = T[k].inputs.map(function (i) { return { item: idOf(i[0]), count: i[1] }; });
  });
  // A record this game has with other inputs than the ones measured.
  const odd = keys[keys.length - 1];
  records[odd] = [{ item: idOf('5ace4:Skyrim.esm'), count: 3 }];
  let calls = 0;
  const sp = {
    Game: {
      getFormFromFile: function (id, file) {
        calls++;
        const k = id.toString(16) + ':' + file;
        return { k: k, getFormID: function () { return idOf(k); } };
      }
    },
    ConstructibleObject: {
      from: function (form) {
        if (!form || !records[form.k]) { return null; }
        const r = records[form.k];
        return {
          getNumIngredients: function () { return r.length; },
          getNthIngredient: function (n) { return r[n] ? { getFormID: function () { return r[n].item; } } : null; },
          getNthIngredientQuantity: function (n) { return r[n].count; },
          setNthIngredientQuantity: function (v, n) { r[n].count = v; }
        };
      }
    }
  };
  const run = new Function('ctx', srv.api.recipeCountsScript());
  const state = {};
  run({ value: handed, state: state, sp: sp });
  yes('G1 the owner\'s game sets every count the table gives, coins at 0',
      keys.every(function (k) { return k === odd || JSON.stringify(records[k].map(function (r) { return r.count; })) === JSON.stringify(asks(k)); }));
  yes('G2 a record with other inputs than the ones measured is left as it is',
      records[odd].length === 1 && records[odd][0].count === 3);
  calls = 0;
  run({ value: handed, state: state, sp: sp });
  run({ value: handed, state: state, sp: sp });
  yes('G3 the same stamp on later frames touches no record (updateOwner runs every frame)', calls === 0);
  run({ value: { at: 99, rows: handed.rows }, state: state, sp: sp });
  yes('G4 a new stamp finds the counts already set and leaves them', calls > 0 &&
      keys.every(function (k) { return k === odd || JSON.stringify(records[k].map(function (r) { return r.count; })) === JSON.stringify(asks(k)); }));
}

// ------------------------------------------------------------- the wiring --
const onCraft = take('mp.onCraft = guard(\'onCraft\', function (actorId, craftedItemBaseId, count, recipeId, workbenchId, effects) {', '\n});\n') || '';
yes('W1 onCraft names a craft with no recipe id from the table first, and goes on with it as that recipe',
    /if \(!recipeId && typeof recipeSetInGame === 'function'\) \{\s*desc = recipeSetInGame\(craftedItemBaseId, workbenchId, arguments\[6\]\);/.test(onCraft) &&
    /if \(!recipeId && !desc\) \{/.test(onCraft) && /const row = craftRow\(desc\);/.test(onCraft));
yes('W2 and refuses a recipe of the table at the mod\'s own counts, before anything is taken',
    /typeof RECIPES_SET_IN_GAME === 'object' && Object\.prototype\.hasOwnProperty\.call\(RECIPES_SET_IN_GAME, desc\)\) \{[\s\S]*?return false;/.test(onCraft) &&
    onCraft.indexOf('RECIPES_SET_IN_GAME, desc') < onCraft.indexOf('const row = craftRow(desc);'));
yes('W3 the counts are handed at spawn, beside the recipes the menu leaves out',
    /handRecipesHidden\(actorId\); \}\n\s*\/\/ And the counts set in each game[\s\S]{0,200}handRecipeCounts\(actorId\);/.test(src));
yes('W4 the owner script sets counts with SetNthIngredientQuantity and copies no record',
    /setNthIngredientQuantity/.test(srv.api.recipeCountsScript()));

// ----------------------------------------------------------- the floor items --
const never = (policy.notCopiedFrom || []);
yes('F1 the policy carries no record of a plugin it never copies from (Patrick, 22 Oct: the floor records were never allowed)',
    never.length > 0 && never.every(function (r) { return !r.carried || r.carried.length === 0; }));
const heldByServer = ((manifest.floorItems || {}).heldByServer || []).concat((manifest.refs || {}).heldByServer || [])
  .concat((manifest.holdOnly || {}).heldByServer || []).sort();
yes('F2 HELD_BY_SERVER is the manifest\'s floor items, cut actors and hold-only plants and ores (#3150) held by ' +
    'the server (' + heldByServer.length + ')',
    Array.isArray(box.F) && JSON.stringify(box.F) === JSON.stringify(heldByServer));
// A never-copied plugin is a master only when its row copies its perk
// recipes (perkRecipesCopied, Patrick's A on q-4826-ia-perk-recipes) and the
// manifest counts those copies.
yes('F3 Thornswood-Last.esp has a never-copied plugin as a master only for the perk recipes its row lets it copy',
    (manifest.masters || []).every(function (m) {
      const row = never.filter(function (r) { return r.plugin.toLowerCase() === m.toLowerCase(); })[0];
      return !row || (row.perkRecipesCopied === true &&
        (((manifest.perks || {}).copiedFromNeverCopied || {})[row.plugin] || 0) > 0);
    }));
{
  const fs2 = server();
  const ctx = { F: ['7ad7:Hothtrooper44_ArmorCompilation.esp', '7ad8:Hothtrooper44_ArmorCompilation.esp'] };
  const fn = new Function('mp', 'idOf', 'log', 'HELD_BY_SERVER', PARTS[3] + '\nreturn holdNeverCopiedOff();');
  const took = fn(fs2.mp, idOf, function () { }, ctx.F);
  const again = fn(fs2.mp, idOf, function () { }, ctx.F);
  yes('F4 holdNeverCopiedOff holds each disabled on the server, and once held, leaves it',
      took === 2 && again === 0 && ctx.F.every(function (d) { return fs2.mp.get(idOf(d), 'isDisabled') === true; }));
}
yes('F5 it runs when the gamemode loads, beside the chopping blocks', /\nholdNeverCopiedOff\(\);\n/.test(src) &&
    src.indexOf('\nholdNeverCopiedOff();\n') > src.indexOf('\ndisableBlocksOff();\n'));

done();
