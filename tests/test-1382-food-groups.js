// test-1382-food-groups.js
//
// #1382, the approved food list (issuecomment-6127545395) and docs/systems/
// food.md: raw meat or fish 8 hunger and can start food sickness, cooked 25,
// ordinary 15 (ingredient, prepared, and drugs until their effect lands), a
// soup, stew or chowder 25 hunger and 10 thirst, because a soup counts as
// cooked (Patrick, 12 Oct 2026, decision 2). Six drinks are ale, milk and
// juice are drink, and Goodberry is a potion.
//
// Root cause (issuecomment-6129878434): no table said which group a record
// was in, so every food was the same 15.
//
// Runs the REAL needs block over a stand-in mp and checks the group table
// against game/data/food-groups.json. Read only.
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
// From its file when the gamemode reads it from one (#5191), else its line.
function table(name) { return require('./gamemode-tables.js').inGamemode(gm, name); }
const a = gm.indexOf('// ==== thornswood needs: hunger, thirst and exhaustion ====');
const b = gm.indexOf('// ==== end thornswood needs ====');
const needsBlock = (a >= 0 && b > a) ? gm.slice(a, b) : null;
const FOODS = table('FOODS');
const GROUPS = table('FOOD_GROUPS');
let file = null;
try { file = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'food-groups.json'), 'utf8')); } catch (e) { file = null; }

yes('the group table is in the gamemode', !!GROUPS && !!GROUPS.items);
yes('and it is game/data/food-groups.json exactly', !!GROUPS && !!file && JSON.stringify(GROUPS) === JSON.stringify(file));
// The approved list is the records the game came with; a fine dish (#2906) is
// counted on its own, in its plain dish's group.
const FINE = (GROUPS && GROUPS.quality && GROUPS.quality.fine) || {};
const FINE_IDS = new Set(Object.values(FINE));
const count = {};
if (GROUPS) { for (const d in GROUPS.items) { if (!FINE_IDS.has(d)) { count[GROUPS.items[d]] = (count[GROUPS.items[d]] || 0) + 1; } } }
yes('every fine dish is in its plain dish\'s group (#2906), the four festival feasts\' too (#3152)', FINE_IDS.size === 67 &&
  Object.keys(FINE).every(function (plain) { return !!GROUPS.items[plain] && GROUPS.items[FINE[plain]] === GROUPS.items[plain]; }));
yes('and the burnt meal is in no group: burnt is a quality, not a group', !!GROUPS.quality && !!GROUPS.quality.burnt &&
  !GROUPS.items[GROUPS.quality.burnt]);
yes('the approved counts: raw 19, cooked 43, soup 30, ingredient 14, prepared 13, drugs 6',
  count.raw === 19 && count.cooked === 43 && count.soup === 30 && count.ingredient === 14 && count.prepared === 13 && count.drugs === 6);
// The content plugin's four festival brews are ale and its four festival
// dishes are feasts (#3152).
yes('ten drinks are ale, two are drink, one is a potion', count.ale === 10 && count.drink === 2 && count.potion === 1);
yes('four feasts, and no burnt group', count.feast === 4 && !count.burnt);
// Patrick, 12 Oct 2026, decision 4: the content plugin's three teas.
yes('three teas, the content plugin\'s own', count.tea === 3);
yes('Glacier Water is left to the water mechanic', !!GROUPS && !GROUPS.items['13f598:WindhelmSSE.esp']);
yes('every grouped record is one the food table knows', !!GROUPS && !!FOODS &&
  Object.keys(GROUPS.items).every(function (d) { return !!FOODS.items[d]; }));

// Stand-in ids: one number per descriptor the two tables name.
const ids = {}; let next = 0x100;
[FOODS, GROUPS].forEach(function (t) { if (t) { for (const d in t.items) { if (!ids[d]) { ids[d] = next++; } } } });
function idOf(d) { return ids[d] || 0; }

function rig() {
  const store = {}, fouled = [];
  const mp = {
    makeProperty: function () { },
    get: function (id, key) { if (id === 0 && key === 'onlinePlayers') { return []; } if (key === 'worldOrCellDesc' || key === 'pos') { return null; } return store[id]; },
    set: function (id, key, v) { store[id] = JSON.parse(JSON.stringify(v)); }
  };
  const g = { __thornswoodHurt: { exposed: function (id, kind, source) { fouled.push([kind, source]); return false; } } };
  const N = new Function('globalThis', 'mp', 'console', 'setInterval', 'clearInterval',
    'guard', 'notify', 'say', 'idOf', 'FOODS', 'FOOD_GROUPS', needsBlock + '\nreturn globalThis.__thornswoodNeeds;')(
    g, mp, { log: function () { } }, function () { return 0; }, function () { },
    function (n, f) { return f; }, function () { }, function () { }, idOf, FOODS, GROUPS);
  return { N: N, store: store, fouled: fouled };
}
let r = null;
try { r = needsBlock ? rig() : null; } catch (e) { console.log('rig threw: ' + e.message); }
const ok = !!r && !!r.N && typeof r.N.groupOf === 'function';
yes('the needs block knows food groups', ok);

if (ok) {
  const N = r.N; let who = 1;
  function eat(desc) {
    const id = who++;
    const n = N.fresh(); n.at = Date.now(); n.food = 30; n.drink = 30; r.store[id] = n;
    r.fouled.length = 0;
    N.consumed(id, idOf(desc));
    return { food: Math.round(r.store[id].food - 30), drink: Math.round(r.store[id].drink - 30), fouled: r.fouled.slice(), ale: r.store[id].ale || 0 };
  }
  let e = eat('669a2:Skyrim.esm');       // Venison
  yes('raw venison is 8 hunger and asks the disease block about raw food', e.food === 8 && e.fouled.length === 1 && e.fouled[0][0] === 'food' && e.fouled[0][1] === 'raw');
  e = eat('722bd:Skyrim.esm');           // Venison Chop
  yes('a venison chop is cooked, 25, and no risk', e.food === 25 && e.fouled.length === 0);
  e = eat('cd614:Skyrim.esm');           // Homecooked Meal
  yes('the Homecooked Meal is cooked, 25', e.food === 25);
  e = eat('f431d:Skyrim.esm');           // Venison Stew
  yes('venison stew counts as cooked: 25 hunger and 10 thirst', e.food === 25 && e.drink === 10);
  e = eat('64b3f:Skyrim.esm');           // Cabbage
  yes('a cabbage is an ingredient, 15', e.food === 15 && e.drink === 0);
  e = eat('65c98:Skyrim.esm');           // Bread
  yes('bread is prepared, 15', e.food === 15);
  e = eat('57a7a:Skyrim.esm');           // Skooma
  yes('skooma is 15 until the drug effect lands', e.food === 15);
  e = eat('65c39:Skyrim.esm');           // Cliff Racer
  yes('the Cliff Racer is ale', e.ale === 1 && e.food !== 15);
  e = eat('3534:HearthFires.esm');       // Jug of Milk
  yes('a jug of milk is a drink, 20 thirst', e.drink === 20 && e.food === 0);
  e = eat('2844d3:Triumvirate - Mage Archetypes.esp'); // Goodberry
  yes('Goodberry is a potion: a mouthful, not a meal', e.food === 0 && e.drink === 5);

  // One meal, all of it (#1382): a meal refused inside the 8 seconds gives
  // nothing, so neither a soup's thirst nor raw meat's risk, and a meal on a
  // full stomach is the full stomach's sickness and nothing else.
  {
    const id = who++;
    const n = N.fresh(); n.at = Date.now(); n.food = 30; n.drink = 30; r.store[id] = n;
    N.consumed(id, idOf('722bd:Skyrim.esm'));   // Venison Chop, 25
    r.fouled.length = 0;
    const before = { food: r.store[id].food, drink: r.store[id].drink };
    N.consumed(id, idOf('f431d:Skyrim.esm'));   // Venison Stew inside the 8 seconds
    yes('a stew inside the 8 seconds adds no hunger and no thirst',
      Math.round(r.store[id].food) === Math.round(before.food) && Math.round(r.store[id].drink) === Math.round(before.drink));
    N.consumed(id, idOf('669a2:Skyrim.esm'));   // raw Venison inside the 8 seconds
    yes('raw meat inside the 8 seconds does not ask the disease block', r.fouled.length === 0);
  }
  {
    const id = who++;
    const n = N.fresh(); n.at = Date.now(); n.food = 95; n.drink = 30; r.store[id] = n;
    r.fouled.length = 0;
    N.consumed(id, idOf('f431d:Skyrim.esm'));   // Venison Stew on a full stomach
    yes('a stew on a full stomach adds no hunger and no thirst',
      Math.round(r.store[id].food) === 95 && Math.round(r.store[id].drink) === 30);
    yes('and starts the full stomach sickness, not a second roll',
      r.fouled.length === 1 && r.fouled[0][0] === 'food' && r.fouled[0][1] === 'full');
  }
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
