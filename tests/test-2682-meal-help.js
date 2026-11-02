// test-2682-meal-help.js
//
// #2682, Patrick 18 October 2026 (design issuecomment-6253340775): a cooked
// meal gives only its temperature help by default (a soup, stew or chowder
// warms); stamina recovery or the disease guard comes only from one extra
// ingredient at the pot; vanilla food's own magic effects go, except
// temperature ones; hunger and thirst stay.
//
// Root cause: nothing gave a cooked meal a help, and every food record's
// own magic still landed whole because mp.onEatItem only scaled potions.
//
// Runs the REAL needs block over a stand-in mp and checks the data in
// game/data/food-groups.json (#1382's list). Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
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
const a = gm.indexOf('// ==== thornswood needs: hunger, thirst and exhaustion ====');
const b = gm.indexOf('// ==== end thornswood needs ====');
const needsBlock = (a >= 0 && b > a) ? gm.slice(a, b) : null;
const FOODS = table('FOODS');
const GROUPS = table('FOOD_GROUPS');
let file = null;
try { file = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'food-groups.json'), 'utf8')); } catch (e) { file = null; }
let recipes = null;
try { recipes = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'recipes.json'), 'utf8')); } catch (e) { recipes = null; }

// ---- The data, in #1382's list and nowhere else.
yes('the gamemode table is game/data/food-groups.json exactly', !!GROUPS && !!file && JSON.stringify(GROUPS) === JSON.stringify(file));
const strip = GROUPS && GROUPS.strip;
const season = GROUPS && GROUPS.season;
yes('the strip is a key of the food list, not a second list', !!strip && !!GROUPS.items);
yes('the stripped groups are the six food groups, not drugs, ale or potion',
  !!strip && JSON.stringify((strip.groups || []).slice().sort()) ===
  JSON.stringify(['cooked', 'drink', 'ingredient', 'prepared', 'raw', 'soup']));
const KEEP = ['12010f:WindhelmSSE.esp', '12f9c4:WindhelmSSE.esp', '17167b:WindhelmSSE.esp'];
yes('the kept records are the three whose Resist Frost rides with another effect',
  !!strip && !!strip.keep && JSON.stringify(Object.keys(strip.keep).sort()) === JSON.stringify(KEEP) &&
  KEEP.every(function (d) { return /Resist Frost/.test(strip.keep[d]) && !!GROUPS.items[d]; }));
// A fine dish (#2906) is in its plain dish's group, so it loses its own
// magic with it; it is counted on its own.
const FINE = new Set(Object.values((GROUPS && GROUPS.quality && GROUPS.quality.fine) || {}));
let stripCount = 0, fineStripped = 0;
if (strip && GROUPS) {
  for (const d in GROUPS.items) {
    if ((strip.groups || []).indexOf(GROUPS.items[d]) !== -1 && !strip.keep[d]) {
      if (FINE.has(d)) { fineStripped++; } else { stripCount++; }
    }
  }
}
yes('118 records lose their own magic, the list in the design comment', stripCount === 118);
// The four fine feasts (#3152) are in the feast group, which keeps its own
// magic: a feast carries only the effect that says what the server does.
yes('and so do the 63 fine dishes, which are in their plain dishes\' groups (#2906)', FINE.size === 67 && fineStripped === 63);
yes('a soup warms by default, and nothing else does', !!season && JSON.stringify(season.plain) === JSON.stringify({ soup: 'warm' }));
yes('garlic gives the guard and salt gives stamina',
  !!season && !!season.extras && season.extras['34d22:Skyrim.esm'] === 'guard' &&
  season.extras['34cdf:Skyrim.esm'] === 'stamina' && Object.keys(season.extras).length === 2);
function ingredientName(desc) {
  if (!recipes || !recipes.recipes) { return ''; }
  for (const k in recipes.recipes) {
    const items = recipes.recipes[k].inputItems || [];
    for (let i = 0; i < items.length; i++) { if (items[i].item === desc) { return items[i].type + ' ' + items[i].name; } }
  }
  return '';
}
yes('the extras are real ingredients the recipes ask for (INGR Garlic, INGR Salt Pile)',
  ingredientName('34d22:Skyrim.esm') === 'INGR Garlic' && ingredientName('34cdf:Skyrim.esm') === 'INGR Salt Pile');
const dishes = (season && season.dishes) || {};
yes('every seasoned dish is grouped like its plain dish and made with a listed extra',
  !!season && typeof dishes === 'object' && Object.keys(dishes).every(function (d) {
    const row = dishes[d];
    const g = GROUPS.items[row && row.of];
    return (g === 'cooked' || g === 'soup') && GROUPS.items[d] === g && !!season.extras[row.extra];
  }));
yes('the meal help numbers are food.md\'s: 4 degrees, +10% stamina, 20 minutes',
  /mealHelp: \{\s*minutes: 20, warm: 4, stamina: 10,/.test(gm));
yes('the engine is told the strip scale when something is eaten (mp.onEatItem asks effectScale)',
  /mp\.onEatItem = guard\('onEatItem'[\s\S]{0,1600}needsApi\.effectScale\(actorId/.test(gm));
yes('the needs block adds no disease guard of its own (no MEAL_GUARD table, no .guard written)',
  !!needsBlock && !/MEAL_GUARD\s*=/.test(needsBlock) && !/\.guard\s*=/.test(needsBlock) && !/guard:\s*\{\s*until/.test(needsBlock));

// ---- The real needs block.
const SEASONED_GUARD = 'f00:Test-Seasoned.esp';
const SEASONED_STAMINA = 'f01:Test-Seasoned.esp';
function withDishes() {
  const t = JSON.parse(JSON.stringify(GROUPS));
  t.items[SEASONED_GUARD] = 'soup';
  t.items[SEASONED_STAMINA] = 'cooked';
  t.season.dishes[SEASONED_GUARD] = { of: 'f431d:Skyrim.esm', extra: '34d22:Skyrim.esm' };
  t.season.dishes[SEASONED_STAMINA] = { of: '722bd:Skyrim.esm', extra: '34cdf:Skyrim.esm' };
  return t;
}
const ids = {}; let next = 0x100;
[FOODS, withDishes()].forEach(function (t) { if (t) { for (const d in t.items) { if (!ids[d]) { ids[d] = next++; } } } });
function idOf(d) { return ids[d] || 0; }

function rig(groups, hurtHas) {
  const store = {}, calls = [];
  let online = [];
  const mp = {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return online; } if (key === 'worldOrCellDesc' || key === 'pos') { return null; } return store[id]; },
    set: function (id, key, v) { store[id] = JSON.parse(JSON.stringify(v)); }
  };
  const hurt = { exposed: function () { return false; } };
  if (hurtHas.guarded) { hurt.guarded = function (id, feast) { calls.push(['guarded', id, feast]); return true; }; }
  if (hurtHas.unguarded) { hurt.unguarded = function (id) { calls.push(['unguarded', id]); return true; }; }
  const g = { __thornswoodHurt: hurt };
  const N = new Function('globalThis', 'mp', 'console', 'setInterval', 'clearInterval',
    'guard', 'notify', 'say', 'idOf', 'FOODS', 'FOOD_GROUPS', needsBlock + '\nreturn globalThis.__thornswoodNeeds;')(
    g, mp, { log: function () { } }, function () { return 0; }, function () { },
    function (n, f) { return f; }, function () { }, function () { }, idOf, FOODS, groups);
  return { N: N, store: store, calls: calls, setOnline: function (o) { online = o; } };
}
let r = null, rs = null, rn = null;
try { r = needsBlock ? rig(GROUPS, { guarded: true, unguarded: true }) : null; } catch (e) { console.log('rig threw: ' + e.message); }
try { rs = needsBlock ? rig(withDishes(), { guarded: true, unguarded: true }) : null; } catch (e) { console.log('rig threw: ' + e.message); }
try { rn = needsBlock ? rig(withDishes(), {}) : null; } catch (e) { console.log('rig threw: ' + e.message); }
const ok = !!r && !!r.N && typeof r.N.effectScale === 'function' && typeof r.N.mealHelpOf === 'function' && !!rs && !!rn;
yes('the needs block answers effectScale and mealHelpOf', ok);

if (ok) {
  const N = r.N;
  // What the engine applies of each record's own magic.
  yes('venison stew lands none of its own magic', N.effectScale(1, idOf('f431d:Skyrim.esm')) === 0);
  yes('raw venison, bread, a cabbage and a sweet roll land none',
    ['669a2:Skyrim.esm', '65c98:Skyrim.esm', '64b3f:Skyrim.esm', '64b3d:Skyrim.esm'].every(function (d) { return N.effectScale(1, idOf(d)) === 0; }));
  yes('a jug of milk lands none', N.effectScale(1, idOf('3534:HearthFires.esm')) === 0);
  yes('Frostwheat Bread, Frostwheat Flour and Snowberry Juice keep their Resist Frost (whole)',
    KEEP.every(function (d) { return N.effectScale(1, idOf(d)) === 1; }));
  yes('skooma (drugs) and an ale keep their own systems',
    N.effectScale(1, idOf('57a7a:Skyrim.esm')) === 1 && N.effectScale(1, idOf('65c39:Skyrim.esm')) === 1);
  yes('Goodberry is still a potion in the potion window, first one whole',
    N.effectScale(77, idOf('2844d3:Triumvirate - Mage Archetypes.esp')) === 1);
  yes('a brewed potion and an unknown record are not stripped',
    N.effectScale(78, 0xff000123) === 1 && N.effectScale(1, 0x7777777) === 1);

  let who = 1;
  function person(rr, food) {
    const id = who++;
    const n = rr.N.fresh(); n.at = Date.now(); n.food = (typeof food === 'number') ? food : 30; n.drink = 30; rr.store[id] = n;
    return id;
  }
  // The default: a soup warms, nothing else does.
  {
    const id = person(r); const plain = person(r);
    const line = N.consumed(id, idOf('f431d:Skyrim.esm'));
    const s = r.store[id];
    yes('venison stew warms: the help is kept on the needs record', s.mealHelp === 'warm');
    yes('for 20 real minutes', Math.abs(s.mealHelpUntil - (Date.now() + 20 * 60000)) < 5000);
    yes('and says so', String(line).indexOf('The heat of it settles in your chest.') === 0);
    yes('hunger and thirst are a cooked soup\'s: 25 and 10',
      Math.round(s.food - 30) === 25 && Math.round(s.drink - 30) === 10);
    yes('a read keeps the help', N.read(id).mealHelp === 'warm' && N.read(id).mealHelpUntil === s.mealHelpUntil);
    let warmT = null, coldT = null;
    try { warmT = N.view(id).tempTarget; coldT = N.view(plain).tempTarget; } catch (e) { console.log('view threw: ' + e.message); }
    yes('the temperature target is 4 degrees warmer (' + coldT + ' to ' + warmT + ')',
      typeof warmT === 'number' && typeof coldT === 'number' && warmT - coldT === 4);
    yes('warmth is not stamina', !(N.effects(id, N.read(id)).staminaRateMult > 0));
    yes('warmth asks for no guard', r.calls.every(function (c) { return c[0] !== 'guarded'; }));
    yes('and takes any guard off (the latest meal counts)', r.calls.some(function (c) { return c[0] === 'unguarded' && c[1] === id; }));
    // A plain roast after it has no help, and leaves the warmth alone.
    const s2 = r.store[id]; s2.eatUntil = 0; r.store[id] = s2;
    const line2 = N.consumed(id, idOf('722bd:Skyrim.esm'));
    yes('a plain venison chop gives no help and leaves the warmth', r.store[id].mealHelp === 'warm' &&
      String(line2).indexOf('heat') === -1);
    yes('a chop is still 25 hunger', Math.round(r.store[id].food - 55) === 25);
  }
  {
    const id = person(r);
    N.consumed(id, idOf('722bd:Skyrim.esm'));
    yes('a plain cooked dish gives no help by default', !r.store[id].mealHelp);
    const p = person(r); N.consumed(p, idOf('65c98:Skyrim.esm'));
    yes('nor does bread', !r.store[p].mealHelp);
  }
  // Only a meal that went down.
  {
    const id = person(r);
    N.consumed(id, idOf('722bd:Skyrim.esm'));
    N.consumed(id, idOf('f431d:Skyrim.esm'));   // inside the 8 seconds
    yes('a stew inside the 8 seconds gives no help', !r.store[id].mealHelp);
    const full = person(r, 95);
    N.consumed(full, idOf('f431d:Skyrim.esm'));
    yes('a stew on a full stomach gives no help', !r.store[full].mealHelp);
  }
  // The help runs out.
  {
    const id = person(r);
    N.consumed(id, idOf('f431d:Skyrim.esm'));
    const s = r.store[id]; s.mealHelpUntil = Date.now() - 1; r.store[id] = s;
    r.setOnline([id]);
    try { N.tick(); } catch (e) { console.log('tick threw: ' + e.message); }
    r.setOnline([]);
    yes('the tick clears a help that has run out', !r.store[id].mealHelp && !r.store[id].mealHelpUntil);
  }

  // Seasoned at the pot: the extra ingredient picks the help.
  {
    const S = rs.N;
    yes('a seasoned stew made with garlic gives the guard', S.mealHelpOf(idOf(SEASONED_GUARD), 'soup') === 'guard');
    yes('a seasoned chop made with salt gives stamina', S.mealHelpOf(idOf(SEASONED_STAMINA), 'cooked') === 'stamina');
    yes('the plain stew still only warms', S.mealHelpOf(idOf('f431d:Skyrim.esm'), 'soup') === 'warm');
    yes('a seasoned dish loses its own magic too', S.effectScale(1, idOf(SEASONED_GUARD)) === 0);
    const id = person(rs);
    S.consumed(id, idOf(SEASONED_STAMINA));
    yes('the salted chop: stamina recovery +10% while it lasts',
      rs.store[id].mealHelp === 'stamina' && S.effects(id, S.read(id)).staminaRateMult === 10 + (S.effects(id, Object.assign({}, S.read(id), { mealHelp: '' })).staminaRateMult || 0));
    yes('and 25 hunger, as a cooked dish', Math.round(rs.store[id].food - 30) === 25);
    const st = rs.store[id]; st.eatUntil = 0; rs.store[id] = st;
    rs.calls.length = 0;
    const line = S.consumed(id, idOf(SEASONED_GUARD));
    yes('the garlic stew calls the injury block\'s guarded(actorId, false), once',
      rs.calls.length === 1 && rs.calls[0][0] === 'guarded' && rs.calls[0][1] === id && rs.calls[0][2] === false);
    yes('and replaces the stamina help (one help at a time)', !rs.store[id].mealHelp && !(S.effects(id, S.read(id)).staminaRateMult > 10));
    yes('and does not warm, though it is a soup', !rs.store[id].mealHelp && !rs.store[id].mealHelpUntil);
    yes('and says so', String(line).indexOf('You feel hale for it.') !== -1);
    yes('hunger and thirst as a soup, which counts as cooked: 25 and 10 more',
      Math.round(rs.store[id].food - 55) === 25 && Math.round(rs.store[id].drink - 30) === 10);
  }
  // No guard without the injury block's guarded().
  {
    const id = person(rn);
    const line = rn.N.consumed(id, idOf(SEASONED_GUARD));
    yes('without guarded() the garlic stew gives no help and says nothing of it',
      !rn.store[id].mealHelp && String(line).indexOf('hale') === -1);
    const id2 = person(rn);
    rn.N.consumed(id2, idOf('f431d:Skyrim.esm'));
    yes('and warmth still lands without unguarded()', rn.store[id2].mealHelp === 'warm');
  }
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
