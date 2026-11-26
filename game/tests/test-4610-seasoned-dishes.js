// test-4610-seasoned-dishes.js
//
// #4610. Patrick, 18 October 2026 (#2682): stamina recovery or the disease
// guard comes only when the cook adds one extra ingredient at the cooking
// pot, garlic for the guard and a salt pile for stamina, not at the oven.
// The eat event names only the record eaten, so each seasoned dish has to be
// a record of its own, made by its own recipe at the pot.
//
// Cause: food-groups.json's season.dishes was empty and the content plugin
// made no seasoned record or recipe, so nothing a cook could make at the pot
// came out seasoned, and only a soup's warmth was ever given.
//
// It checks, without the game, on the content build laid in this checkout
// (game/data/recipes.json, which the box builds from the load order the
// content plugin is part of):
//   1. every cooked or soup dish the Cook makes at the pot has one garlic
//      and one salt seasoned record in season.dishes, the content plugin's
//      own, in its plain dish's group and named;
//   2. each seasoned record has its own recipe at the pot: the plain dish's
//      recipe and one more of its extra;
//   3. each seasoned record has a fine record, which is seasoned the same;
//   4. nothing at the oven is seasoned;
//   5. the real needs block gives each one its extra's help when eaten.
// Prints each pot dish that has no seasoned record yet. Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
const gm = fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, ok) {
  if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function table(name) {
  const m = new RegExp('^const ' + name + ' = (\\{.*\\});$', 'm').exec(gm);
  return m ? JSON.parse(m[1]) : null;
}

const GROUPS = table('FOOD_GROUPS');
const FOODS = table('FOODS');
const file = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'food-groups.json'), 'utf8'));
const recipes = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'recipes.json'), 'utf8')).recipes;
const craftGate = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'gamemode-tables', 'RECIPES_BY_ID.json'), 'utf8'));
const cutFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'cut-items.json'), 'utf8'));
const GARLIC = '34d22:Skyrim.esm', SALT = '34cdf:Skyrim.esm';
const POT = 'CraftingCookpot', OVEN = 'BYOHCraftingOven';

yes('the gamemode\'s FOOD_GROUPS is game/data/food-groups.json exactly', JSON.stringify(GROUPS) === JSON.stringify(file));
const season = GROUPS.season || {};
const extras = season.extras || {};
const seasoned = season.dishes || {};
const fine = (GROUPS.quality && GROUPS.quality.fine) || {};
const fineIds = new Set(Object.values(fine));
yes('the extras are garlic for the guard and salt for stamina, and only those',
  extras[GARLIC] === 'guard' && extras[SALT] === 'stamina' && Object.keys(extras).length === 2);

// ------------------------------------------------- 1. a seasoned pair each --
// A plain pot dish: craftable by a Cook, at the pot, cooked or soup, and
// neither a seasoned record nor a fine one. The catalogue records cut
// variants too, but the runtime gate refuses them.
const byOut = {};
const plain = {};
const duplicate = [];
const catalogue = {};
const knownCutPot = '9bb:Gourmet.esp';
let cutPot = null;
for (const k in recipes) {
  const r = recipes[k];
  if (r.owner !== 'Cook') { continue; }
  (byOut[r.out] = byOut[r.out] || []).push({ key: k, row: r });
  if (r.benchName !== POT) { continue; }
  const g = GROUPS.items[r.out];
  if ((g === 'cooked' || g === 'soup') && !seasoned[r.out] && !fineIds.has(r.out)) {
    (catalogue[r.out] = catalogue[r.out] || []).push({ key: k, row: r });
    if (k === knownCutPot) { cutPot = r; }
  }
}
for (const dish in catalogue) {
  const rows = catalogue[dish];
  const kept = rows.filter(function (r) { return craftGate[r.key] && craftGate[r.key].owner === 'Cook'; });
  // Only this exact cut-only output is excluded. Other missing/blank gate
  // entries remain in coverage and fail, rather than silently vanishing.
  if (dish === '64b3e:Skyrim.esm' && rows.length === 1 && rows[0].key === knownCutPot && kept.length === 0) continue;
  if (kept.length !== 1) duplicate.push(dish);
  plain[dish] = kept[0] || rows[0];
}
const plainIds = Object.keys(plain).sort();
const rowsOf = {};
for (const s in seasoned) { const row = seasoned[s] || {}; (rowsOf[row.of] = rowsOf[row.of] || []).push(s); }
function seasonedOf(d, extra) {
  return (rowsOf[d] || []).filter(function (s) { return seasoned[s].extra === extra && !fineIds.has(s); });
}
const missing = plainIds.filter(function (d) { return seasonedOf(d, GARLIC).length !== 1 || seasonedOf(d, SALT).length !== 1; });
missing.forEach(function (d) {
  const r = plain[d].row;
  console.log('NOT SEASONED  ' + d + '  ' + GROUPS.items[d] + '  ' + r.name + '  <= ' +
    (r.inputItems || []).map(function (i) { return i.count + ' ' + i.item; }).join(', '));
});
yes('1 there are cooked and soup dishes the Cook makes at the pot (' + plainIds.length + ')', plainIds.length > 0);
yes('1 the catalogue is the complete playable set plus the one explicitly cut pot duplicate',
  Object.keys(catalogue).length === plainIds.length + 1 && cutPot && cutPot.out === '64b3e:Skyrim.esm' && cutPot.makes === 2 &&
  cutFile.items.some(function (r) { return r.id === knownCutPot && r.disposition === 'cut' && /^Duplicate of the same dish\./.test(r.why); }) &&
  craftGate[knownCutPot] && craftGate[knownCutPot].owner === '' && /Cut from the open book/.test(craftGate[knownCutPot].nobody));
yes('1 the retained leeks recipe is at the oven and neither route gains a seasoning variant',
  recipes['84b:Gourmet.esp'] && recipes['84b:Gourmet.esp'].benchName === OVEN && recipes['84b:Gourmet.esp'].makes === 1 &&
  craftGate['84b:Gourmet.esp'] && craftGate['84b:Gourmet.esp'].owner === 'Cook' &&
  !season.recipes['64b3e:Skyrim.esm'] && !rowsOf['64b3e:Skyrim.esm']);
let cutWitness = false;
try {
  const src = fs.readFileSync(path.join(ROOT, 'game', 'gamemode', 'the-benches.ts'), 'utf8');
  function actual(name) { const start = src.indexOf('function ' + name + '('); const end = src.indexOf('\n}', start); if (start < 0 || end < start) throw Error('actual cut handler missing'); return src.slice(start, end + 2); }
  const answer = new Function(actual('craftAnswer') + ';return craftAnswer;')();
  const refused = new Function('RECIPES_BY_ID', 'KEPT_SMELT', 'craftAnswer', actual('recipesRefused') + ';return recipesRefused;')({[knownCutPot]:craftGate[knownCutPot]}, {}, answer);
  const script = new Function('RECIPES_PER_FRAME', actual('recipesHiddenScript') + ';return recipesHiddenScript;')(150)();
  let writes = 0;
  const sp = { Game:{getFormFromFile:function (id, file) { if (id !== 0x9bb || file !== 'Gourmet.esp') throw Error('wrong cut'); return {}; }},
    ConstructibleObject:{from:function () { return {getWorkbenchKeyword:function () { return {getFormID:function () { return 0xa5cb3; }}; }, setWorkbenchKeyword:function (v) { if (v !== null) throw Error('cut gained a bench'); writes++; }}; }} };
  new Function('ctx', script)({value:{at:1,files:refused(0xff000a01),moved:{}},state:{},sp:sp});
  cutWitness = writes === 1 && /Nobody makes that here.*Cut from the open book/.test(answer(0xff000a01, craftGate[knownCutPot]).refusal);
} catch (e) { console.log('CUT WITNESS ' + e.message); }
yes('1 the actual server refusal and owner script keep the known pot duplicate unavailable', cutWitness);
yes('1 the source base for every dish is the playable pot recipe (and each dish has one)', !duplicate.length &&
  Object.keys(season.recipes || {}).length === plainIds.length &&
  plainIds.every(function (d) { return season.recipes[d] === plain[d].key && craftGate[plain[d].key] && craftGate[plain[d].key].owner === 'Cook'; }));
yes('1 every one has exactly one garlic and one salt seasoned record (' + missing.length + ' have not)', missing.length === 0);
const made = Object.keys(seasoned).filter(function (s) { return !fineIds.has(s); });
yes('1 every seasoned record is the content plugin\'s own, in its plain dish\'s group, and named',
  made.length === plainIds.length * 2 && made.every(function (s) {
    return /^[0-9a-f]+:Thornswood-Content\.esp$/.test(s) && GROUPS.items[s] === GROUPS.items[seasoned[s].of] &&
      !!(GROUPS.spoil && GROUPS.spoil.names && GROUPS.spoil.names[s]);
  }));

// --------------------------------------------------------- 2. its recipe --
function bag(items) {
  const m = {};
  (items || []).forEach(function (i) { m[i.item] = (m[i.item] || 0) + (i.count || 0); });
  return m;
}
function sameBag(a, b) {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  return JSON.stringify(ka) === JSON.stringify(kb) && ka.every(function (k) { return a[k] === b[k]; });
}
const badRecipe = made.filter(function (s) {
  const row = seasoned[s];
  const own = (byOut[s] || []);
  const base = plain[row.of];
  if (own.length !== 1 || !base || own[0].key !== row.recipe || own[0].row.benchName !== POT ||
      !craftGate[own[0].key] || craftGate[own[0].key].owner !== 'Cook') { return true; }
  const recipe = own[0].row;
  const want = bag(base.row.inputItems);
  want[row.extra] = (want[row.extra] || 0) + 1;
  return !sameBag(bag(recipe.inputItems), want) || recipe.makes !== base.row.makes ||
    recipe.rank !== base.row.rank || recipe.half !== base.row.half || recipe.family !== base.row.family ||
    JSON.stringify(recipe.needs) !== JSON.stringify(base.row.needs);
});
badRecipe.slice(0, 10).forEach(function (s) { console.log('RECIPE  ' + s + ' has no recipe at the pot of its plain dish and one ' + (seasoned[s] || {}).extra); });
yes('2 each has one recipe of its own at the pot: the plain dish\'s and one more of its extra',
  made.length > 0 && badRecipe.length === 0);

// ------------------------------------------------------ 3. its fine record --
yes('3 each has a fine record, seasoned from the same dish with the same extra',
  made.length > 0 && made.every(function (s) {
    const f = fine[s];
    return !!f && !!seasoned[f] && seasoned[f].of === seasoned[s].of && seasoned[f].extra === seasoned[s].extra &&
      GROUPS.items[f] === GROUPS.items[s];
  }));

// ------------------------------------------------------------ 4. the oven --
yes('4 nothing seasoned is made at the oven', Object.keys(seasoned).every(function (s) {
  return (byOut[s] || []).every(function (r) { return r.row.benchName !== OVEN; }) &&
    !!plain[seasoned[s].of];
}));

// ------------------------------------------------ 5. what eating one does --
const a = gm.indexOf('// ==== thornswood needs: hunger, thirst and exhaustion ====');
const b = gm.indexOf('// ==== end thornswood needs ====');
const needsBlock = (a >= 0 && b > a) ? gm.slice(a, b) : null;
const ids = {}; let next = 0x100;
[FOODS, GROUPS].forEach(function (t) { if (t) { for (const d in t.items) { if (!ids[d]) { ids[d] = next++; } } } });
function idOf(d) { return ids[d] || 0; }
let N = null;
try {
  const store = {};
  const mp = {
    makeProperty: function () { },
    get: function (id, key) { if (id === 0 && key === 'onlinePlayers') { return []; } if (key === 'worldOrCellDesc' || key === 'pos') { return null; } return store[id]; },
    set: function (id, key, v) { store[id] = JSON.parse(JSON.stringify(v)); }
  };
  const g = { __thornswoodHurt: { exposed: function () { return false; }, guarded: function () { return true; }, unguarded: function () { return true; } } };
  N = new Function('globalThis', 'mp', 'console', 'setInterval', 'clearInterval',
    'guard', 'notify', 'say', 'idOf', 'FOODS', 'FOOD_GROUPS', needsBlock + '\nreturn globalThis.__thornswoodNeeds;')(
    g, mp, { log: function () { } }, function () { return 0; }, function () { },
    function (n, f) { return f; }, function () { }, function () { }, idOf, FOODS, GROUPS);
} catch (e) { console.log('the needs block threw: ' + e.message); }
yes('5 the needs block answers mealHelpOf and isFine', !!N && typeof N.mealHelpOf === 'function' && typeof N.isFine === 'function');
if (N) {
  const all = Object.keys(seasoned);
  yes('5 every seasoned dish, plain or fine, gives its extra\'s help when eaten (' + all.length + ')',
    all.length > 0 && all.every(function (s) { return N.mealHelpOf(idOf(s), GROUPS.items[s]) === extras[seasoned[s].extra]; }));
  yes('5 a fine seasoned dish is fine (its help lasts the fine dish\'s time)',
    made.length > 0 && made.every(function (s) { return !!fine[s] && N.isFine(idOf(fine[s])); }));
  yes('5 the plain dishes still give only their own help (a soup warms, a cooked dish none)',
    plainIds.every(function (d) { return N.mealHelpOf(idOf(d), GROUPS.items[d]) === (GROUPS.items[d] === 'soup' ? 'warm' : ''); }));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
