// test-3163-spoilage.js
//
// #3163. Food spoils gently and a cook can preserve it. Patrick's answers of
// 22 October on his report page: raw food keeps 1 real week, cooked 2,
// preserved never; a pack does not spoil while its owner is offline, and
// chests keep spoiling. docs/systems/spoilage.md is the design.
//
// The days live on the food's name, "Venison (6 days left)", the way a
// piece's condition does ("Iron Sword (85%)"). A pack's clock counts only
// while its owner is online; a chest's counts real days and is applied when
// it is next opened; a chest in a snowy climate is cold storage. Salting
// takes a Salt Pile a piece, smoking a lit fire and a Firewood for every 5
// pieces, and only a Hearthcook or a Confectioner may do either. Preserving
// is a panel opened by a key in the inventory, never a chat command
// (Patrick, 4 October).
//
// The spoilage block is cut out of the gamemode as it is and run against a
// small world this file controls: packs, chests, records, a fire and a
// clock. The table is the real one (game/data/food-groups.json). The client
// plugin, the panel and the hooks into the gamemode's events are read as
// text.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_DIR = process.env.REPO_DIR || path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
function read(rel) { return fs.readFileSync(path.join(REPO_DIR, rel), 'utf8').split(CR).join(''); }
const gm = read('game/gamemode.js');
const front = read('game/plugins/thornswood-front.js');
const ui = read('game/ui/thornswood-preserve.js');
const groupsText = read('game/data/food-groups.json');
const GROUPS = JSON.parse(groupsText);
const FOOD = JSON.parse(read('game/data/food.json')).items;
let page = '';
try { page = read('docs/systems/spoilage.md'); } catch (e) { page = ''; }

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}

// ------------------------------------------------------------ the table --
const S = GROUPS.spoil || {};
function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
yes('A1 food-groups.json has a spoil block with days, keeps, extra, preserve, salt, firewood and names',
    ['days', 'keeps', 'extra', 'preserve', 'salt', 'firewood', 'names'].every(function (k) { return own(S, k); }));
yes('A1 raw and ingredient keep 7 days, cooked, soup and prepared 14 (Patrick, 22 October)',
    S.days && S.days.raw === 7 && S.days.ingredient === 7 && S.days.cooked === 14 &&
    S.days.soup === 14 && S.days.prepared === 14);
yes('A1 drink, ale, tea, potions and drugs never spoil',
    S.days && ['drink', 'ale', 'tea', 'potion', 'drugs'].every(function (g) { return !own(S.days, g); }));
yes('A1 only raw food is preserved', JSON.stringify(S.preserve) === '["raw"]');
yes('A1 salting takes the game\'s Salt Pile and smoking its Firewood',
    S.salt === '34cdf:Skyrim.esm' && S.firewood === '6f993:Skyrim.esm');
yes('A1 spoiled food is the content plugin\'s own record (Patrick, 26 October, C)',
    S.spoiled === '19100:Thornswood-Content.esp');
const fmLine = gm.split('\n').filter(function (l) { return l.indexOf('const FOOD_GROUPS = ') === 0; })[0] || '';
yes('A2 the gamemode\'s FOOD_GROUPS line is food-groups.json as it is (scripts/dev/Build-SpoilNames.js)',
    fmLine === 'const FOOD_GROUPS = ' + groupsText.trim() + ';');
const badNames = Object.keys(S.names || {}).filter(function (d) {
  return !own(FOOD, d) || String(FOOD[d].name || '') !== S.names[d];
});
yes('A3 every name the table holds is food.json\'s name for that record (' + Object.keys(S.names || {}).length +
    ' names)' + (badNames.length ? ': ' + badNames.join(', ') : ''), badNames.length === 0 && Object.keys(S.names || {}).length > 50);
const keepsKnown = Object.keys(S.keeps || {}).filter(function (d) { return !own(GROUPS.items, d); });
yes('A3 every keep is a food the groups know' + (keepsKnown.length ? ': ' + keepsKnown.join(', ') : ''), keepsKnown.length === 0);

// ------------------------------------------------------------- the block --
const block = slice(gm, '// ==== thornswood spoilage ====', '// ==== end thornswood spoilage ====');
yes('B the spoilage block is in the gamemode', block !== null);
const box = { console: { log: function () {} } };
box.globalThis = box;
if (block) {
  // Without mp the block stops after handing over the factory.
  vm.runInNewContext(block, box);
}
const create = box.__thornswoodSpoilageCreate;
yes('B the block hands over its factory', typeof create === 'function');
if (typeof create !== 'function') {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(1);
}

// ------------------------------------------------------------- the world --
const VENISON = 0x65c99, SALMON = 0x106e1b, APPLE = 0x64b2f, ALE = 0x34c5e, HONEY = 0x0;
const SOUP = 0x3cd5b, FINE_SOUP = 0x5019010, BEEF_STEW = 0x1000001, MILK = 0x6003534;
const SALT = 0x34cdf, WOOD = 0x6f993, SWORD = 0x12eb7, POTION = 0x3eae3, CHEESE = 0x64b33;
const SPOILED = 0x5019100;
const DESC = {};
function descFor(id, wanted) { DESC[id] = wanted; }
// Records picked out of the real table by group, so the test follows it.
function firstOf(group) {
  return Object.keys(GROUPS.items).filter(function (d) {
    return GROUPS.items[d] === group && own(S.names, d) && !own(S.keeps, d);
  }).sort()[0];
}
const venisonDesc = Object.keys(S.names).filter(function (d) { return S.names[d] === 'Venison'; })[0] || firstOf('raw');
descFor(VENISON, venisonDesc);
descFor(SALMON, firstOf('raw') === venisonDesc ? Object.keys(GROUPS.items).filter(function (d) {
  return GROUPS.items[d] === 'raw' && d !== venisonDesc && own(S.names, d);
}).sort()[0] : firstOf('raw'));
descFor(APPLE, firstOf('ingredient'));
descFor(ALE, Object.keys(GROUPS.items).filter(function (d) { return GROUPS.items[d] === 'ale'; })[0]);
descFor(SOUP, '3cd5b:Dragonborn.esm');
descFor(FINE_SOUP, GROUPS.quality.fine['3cd5b:Dragonborn.esm']);
descFor(BEEF_STEW, firstOf('cooked'));
descFor(MILK, '3534:HearthFires.esm');
descFor(CHEESE, '64b33:Skyrim.esm');
descFor(SALT, S.salt);
descFor(WOOD, S.firewood);
descFor(SWORD, '12eb7:Skyrim.esm');
descFor(POTION, '3eae3:Skyrim.esm');
descFor(SPOILED, S.spoiled);
void HONEY;
const ID = {};
Object.keys(DESC).forEach(function (id) { ID[DESC[id]] = Number(id); });
const FINE_TO_PLAIN = {};
Object.keys(GROUPS.quality.fine).forEach(function (p) { FINE_TO_PLAIN[GROUPS.quality.fine[p]] = p; });

const COOK = 0xff000001, STRANGER = 0xff000002, CHEST = 0x10a001, COLD_CHEST = 0x10a002, DOOR = 0x10a003;
function world() {
  const w = {
    inv: {}, packClock: {}, chestClock: {}, said: [], shown: [], lines: {}, writes: 0,
    failWrite: false, fire: false, cooks: {}, coldIds: {}, winter: function () { return false; }
  };
  w.api = {
    table: S,
    descOf: function (id) { return DESC[id] || ''; },
    idOf: function (desc) { return ID[desc] || 0; },
    groupOfDesc: function (desc) { return own(GROUPS.items, desc) ? GROUPS.items[desc] : ''; },
    plainOfFine: function (desc) { return own(FINE_TO_PLAIN, desc) ? FINE_TO_PLAIN[desc] : ''; },
    inventory: function (id) { return w.inv[id] ? JSON.parse(JSON.stringify(w.inv[id])) : null; },
    setInventory: function (id, entries) {
      if (w.failWrite) { return false; }
      w.writes++;
      w.inv[id] = JSON.parse(JSON.stringify(entries));
      return true;
    },
    packClock: function (id) { return w.packClock[id] || null; },
    setPackClock: function (id, c) { w.packClock[id] = c; },
    chestClock: function (id) { return w.chestClock[id] || null; },
    setChestClock: function (id, c) { w.chestClock[id] = c; },
    cold: function (id) { return !!w.coldIds[id]; },
    winterAt: function (t) { return w.winter(t); },
    isContainer: function (desc) { return desc === 'chest'; },
    stateOf: function (id) { return { id: id }; },
    canWork: function (state, half) { return !!(w.cooks[state.id] && w.cooks[state.id] === half); },
    fireNear: function () { return w.fire; },
    setLine: function (id, on) { w.lines[id] = on; },
    show: function (id, v) { w.shown.push({ id: id, v: v }); },
    say: function (id, line) { w.said.push({ id: id, line: line }); },
    log: function () {}
  };
  w.rot = create(w.api);
  return w;
}
const DAY = 24 * 60 * 60 * 1000;
function e(baseId, count, name) { const o = { baseId: baseId, count: count }; if (name) { o.name = name; } return o; }
function names(entries) { return (entries || []).map(function (x) { return x.baseId.toString(16) + 'x' + x.count + (x.name ? ' ' + x.name : ''); }).sort(); }

// ------------------------------------------------------------ C. lifeOf --
(function () {
  const w = world();
  yes('C1 raw meat keeps 7 days', w.rot.lifeOf(VENISON) === 7);
  yes('C1 fruit and vegetables keep 7 days', w.rot.lifeOf(APPLE) === 7);
  yes('C1 a cooked dish keeps 14 days', w.rot.lifeOf(BEEF_STEW) === 14 && w.rot.lifeOf(SOUP) === 14);
  yes('C1 a fine dish keeps as its plain dish does', w.rot.lifeOf(FINE_SOUP) === w.rot.lifeOf(SOUP));
  yes('C1 milk, outside the groups that spoil, keeps 7 days', w.rot.lifeOf(MILK) === 7);
  yes('C1 cheese, a keep, never spoils', w.rot.lifeOf(CHEESE) === 0);
  yes('C1 ale, a potion, salt and a sword never spoil',
      [ALE, POTION, SALT, SWORD].every(function (id) { return w.rot.lifeOf(id) === 0; }));
  yes('C2 the days are read off the end of a name, and a preserving too',
      w.rot.leftOf({ name: 'Venison (6 days left)' }) === 6 && w.rot.leftOf({ name: 'Venison (1 day left)' }) === 1 &&
      w.rot.leftOf({ name: 'Venison' }) === -1 && w.rot.keptOf({ name: 'Venison (salted)' }) === 'salted' &&
      w.rot.keptOf({ name: 'Venison (smoked)' }) === 'smoked' && w.rot.keptOf({ name: 'Venison' }) === '');
  yes('C2 the name a person reads is the food\'s own, from the table when it has none',
      w.rot.bareName(e(VENISON, 1, 'Venison (6 days left)')) === 'Venison' &&
      w.rot.bareName(e(VENISON, 1)) === 'Venison' && w.rot.bareName(e(VENISON, 1, 'Venison (smoked)')) === 'Venison');
  yes('C2 a name this block wrote is told from somebody else\'s',
      w.rot.ownName(e(VENISON, 1, 'Venison (6 days left)')) && w.rot.ownName(e(VENISON, 1, 'Venison (salted)')) &&
      !w.rot.ownName(e(VENISON, 1, 'Grandma\'s Venison')) && !w.rot.ownName(e(SWORD, 1, 'Iron Sword (6 days left)')));
})();

// ------------------------------------------------------------- D. aged --
(function () {
  const w = world();
  const r0 = w.rot.aged([e(VENISON, 2), e(BEEF_STEW, 1), e(ALE, 3)], 0);
  yes('D1 plain food is named at its full life and nothing else is touched',
      JSON.stringify(names(r0.entries)) === JSON.stringify(names([
        e(VENISON, 2, 'Venison (7 days left)'), e(BEEF_STEW, 1, S.names[DESC[BEEF_STEW]] + ' (14 days left)'), e(ALE, 3)])) &&
      r0.gone.length === 0);
  const r1 = w.rot.aged([e(VENISON, 1, 'Venison (2 days left)'), e(VENISON, 2, 'Venison (3 days left)')], 1);
  yes('D2 a day comes off every piece, and two stacks that come to the same days fold into one',
      JSON.stringify(names(r1.entries)) === JSON.stringify(names([e(VENISON, 1, 'Venison (1 day left)'), e(VENISON, 2, 'Venison (2 days left)')])));
  const r2 = w.rot.aged([e(VENISON, 1, 'Venison (1 day left)'), e(VENISON, 1, 'Venison (1 day left)')], 1);
  yes('D3 food that reaches 0 is spoiled food named for what it was, and said',
      r2.entries.length === 1 && r2.entries[0].baseId === SPOILED && r2.entries[0].count === 2 &&
      r2.entries[0].name === 'Venison (spoiled)' && r2.gone.length === 2);
  const r2b = w.rot.aged([e(SPOILED, 3, 'Venison (spoiled)')], 40);
  yes('D3 and spoiled food never changes again', JSON.stringify(r2b.entries) === JSON.stringify([e(SPOILED, 3, 'Venison (spoiled)')]) &&
      r2b.gone.length === 0 && w.rot.lifeOf(SPOILED) === 0);
  const r3 = w.rot.aged([e(VENISON, 1, 'Venison (salted)'), e(VENISON, 1, 'Grandma\'s Venison'), e(SWORD, 1, 'Iron Sword (85%)')], 30);
  yes('D4 preserved food, a name somebody else gave and a sword\'s condition are left as they are',
      JSON.stringify(names(r3.entries)) === JSON.stringify(names([e(VENISON, 1, 'Venison (salted)'),
        e(VENISON, 1, 'Grandma\'s Venison'), e(SWORD, 1, 'Iron Sword (85%)')])) && r3.gone.length === 0);
  const r4 = w.rot.aged([e(VENISON, 1, 'Venison (40 days left)')], 0);
  yes('D5 a piece past its life by its name comes down to its life', r4.entries[0].name === 'Venison (7 days left)');
})();

// -------------------------------------------------------- E. the pack --
(function () {
  const w = world();
  const t0 = 1e12;
  w.inv[COOK] = [e(VENISON, 1)];
  w.rot.pass(COOK, t0);
  yes('E1 the first look names plain food and starts the pack\'s clock',
      w.inv[COOK][0].name === 'Venison (7 days left)' && w.packClock[COOK].at === t0 && w.packClock[COOK].ms === 0);
  w.rot.pass(COOK, t0 + 60000);
  yes('E2 time between two looks counts', w.packClock[COOK].ms === 60000);
  w.rot.pass(COOK, t0 + 60000 + w.rot.GAP_MS + 1);
  yes('E3 a gap longer than GAP_MS was time away and counts nothing (no spoiling offline)',
      w.packClock[COOK].ms === 60000 && w.inv[COOK][0].name === 'Venison (7 days left)');
  // A day of play, in looks a minute apart.
  let t = t0 + 60000 + w.rot.GAP_MS + 1;
  w.packClock[COOK] = { at: t, ms: DAY - 30000 };
  w.rot.pass(COOK, t + 60000);
  yes('E4 a whole day of play takes a day off, and what is left over stays on the clock',
      w.inv[COOK][0].name === 'Venison (6 days left)' && w.packClock[COOK].ms === 30000);
  w.inv[COOK] = [e(VENISON, 2, 'Venison (1 day left)')];
  w.packClock[COOK] = { at: t, ms: DAY - 1 };
  w.said = [];
  w.rot.pass(COOK, t + 60000);
  yes('E5 food that went off is spoiled food in the pack, and its owner is told',
      w.inv[COOK].length === 1 && w.inv[COOK][0].baseId === SPOILED && w.inv[COOK][0].name === 'Venison (spoiled)' &&
      w.said.length === 1 && w.said[0].id === COOK && w.said[0].line === 'Your 2 Venison went off.');
  w.inv[COOK] = [e(VENISON, 1, 'Venison (3 days left)')];
  w.packClock[COOK] = { at: t, ms: DAY - 1 };
  w.failWrite = true;
  w.rot.pass(COOK, t + 60000);
  yes('E6 a write that fails moves no clock, so the day is taken on the next look',
      w.packClock[COOK].ms === DAY - 1 && w.packClock[COOK].at === t);
  w.failWrite = false;
  const before = w.writes;
  w.inv[COOK] = [e(ALE, 1)];
  w.rot.pass(COOK, t + 120000);
  yes('E7 a pack with nothing to change is not written', w.writes === before);
})();

// ------------------------------------------------------- F. a chest --
(function () {
  const w = world();
  const t0 = 1e12;
  w.inv[CHEST] = [e(VENISON, 1, 'Venison (6 days left)'), e(SALMON, 1)];
  const r0 = w.rot.opened(CHEST, COOK, t0);
  yes('F1 the first opening starts the chest\'s clock and takes nothing off',
      r0.turned === 0 && w.chestClock[CHEST].at === t0 && w.chestClock[CHEST].days === 0 &&
      w.inv[CHEST].filter(function (x) { return x.name === 'Venison (6 days left)'; }).length === 1);
  yes('F1 and names plain food in it', w.inv[CHEST].filter(function (x) { return x.baseId === SALMON && / \(7 days left\)$/.test(x.name); }).length === 1);
  w.rot.opened(CHEST, COOK, t0 + 3 * DAY + 5);
  yes('F2 three real days later three come off, offline or not',
      w.inv[CHEST].filter(function (x) { return x.name === 'Venison (3 days left)'; }).length === 1 && w.chestClock[CHEST].days === 3);
  w.rot.opened(CHEST, COOK, t0 + 3 * DAY + 5000);
  yes('F3 opening it again the same day takes nothing more, and opening never resets it',
      w.inv[CHEST].filter(function (x) { return x.name === 'Venison (3 days left)'; }).length === 1 && w.chestClock[CHEST].at === t0);
  w.said = [];
  w.rot.opened(CHEST, STRANGER, t0 + 10 * DAY);
  yes('F4 food that went off in a chest is spoiled food there, and the opener is told',
      w.inv[CHEST].length === 2 && w.inv[CHEST].every(function (x) { return x.baseId === SPOILED && / \(spoiled\)$/.test(x.name); }) &&
      w.said.length === 1 && w.said[0].id === STRANGER &&
      /^The Venison and .* in this chest went off\.$/.test(w.said[0].line));
  w.inv[COLD_CHEST] = [e(VENISON, 1, 'Venison (6 days left)')];
  w.coldIds[COLD_CHEST] = true;
  w.rot.opened(COLD_CHEST, COOK, t0);
  const rc = w.rot.opened(COLD_CHEST, COOK, t0 + 4 * DAY);
  yes('F5 cold storage: the chest\'s days turn and none come off the food',
      rc.cold && w.inv[COLD_CHEST][0].name === 'Venison (6 days left)' && w.chestClock[COLD_CHEST].days === 4);
  w.coldIds[COLD_CHEST] = false;
  w.rot.opened(COLD_CHEST, COOK, t0 + 5 * DAY);
  yes('F5 and taken out of the cold it owes nothing for the cold days', w.inv[COLD_CHEST][0].name === 'Venison (5 days left)');
  // Every chest is cold in the winter week (Patrick, 26 October, B).
  const WINTER_FROM = t0 + 20 * DAY, WINTER_TO = t0 + 27 * DAY;
  w.winter = function (t) { return t >= WINTER_FROM && t < WINTER_TO; };
  const WARM = 0x10a004;
  w.inv[WARM] = [e(VENISON, 1, 'Venison (6 days left)')];
  w.rot.opened(WARM, COOK, t0 + 18 * DAY);
  const rw = w.rot.opened(WARM, COOK, t0 + 28 * DAY + 5);
  yes('F7 a chest anywhere keeps food through the winter week: 10 days pass and only the 3 outside winter come off',
      rw.turned === 3 && w.inv[WARM][0].name === 'Venison (3 days left)' && w.chestClock[WARM].days === 10);
  w.winter = function () { return false; };
  yes('F6 a press on something that is not a container is no chest clock',
      w.rot.pressed(COOK, DOOR, 'door', t0) === null && w.rot.pressed(COOK, CHEST, 'chest', t0) !== null);
})();

// ------------------------------------------- C3. no record, no spoiling --
(function () {
  const w = world();
  const saved = DESC[SPOILED];
  delete DESC[SPOILED];
  delete ID[saved];
  const logs = [];
  w.api.log = function () { logs.push(Array.prototype.join.call(arguments, ' ')); };
  w.rot = create(w.api);
  const r = w.rot.aged([e(VENISON, 1, 'Venison (1 day left)')], 3);
  yes('C3 without the spoiled food record nothing spoils, and the block says so once',
      w.rot.lifeOf(VENISON) === 0 && r.gone.length === 0 && r.entries[0].name === 'Venison (1 day left)' &&
      (w.rot.lifeOf(BEEF_STEW), logs.length === 1) && /no spoiled food record/.test(logs[0]));
  DESC[SPOILED] = saved;
  ID[saved] = SPOILED;
})();

// ------------------------------------------------- G. crafting --
(function () {
  const w = world();
  yes('G1 a dish comes off the pot at its full life', w.rot.outputName(BEEF_STEW) === S.names[DESC[BEEF_STEW]] + ' (14 days left)');
  yes('G1 and a fine dish too', w.rot.outputName(FINE_SOUP) === S.names[DESC[FINE_SOUP]] + ' (14 days left)');
  yes('G1 an output that never spoils is not named', w.rot.outputName(ALE) === '' && w.rot.outputName(SWORD) === '');
  yes('G2 plain inputs and food with its days on it may go into a craft',
      w.rot.inputRefusal([{ baseId: VENISON, count: 1 }, { baseId: VENISON, count: 1, name: 'Venison (2 days left)' },
                          { baseId: VENISON, count: 1, name: 'Venison (smoked)' }]) === '' && w.rot.inputRefusal(undefined) === '');
  yes('G3 a worn sword is never spent by a craft: no free repair through a named input',
      w.rot.inputRefusal([{ baseId: SWORD, count: 1, name: 'Iron Sword (85%)' }]) ===
      'Your Iron Sword (85%) cannot go into that. Keep it, or use a plain one.');
  yes('G3 nor food somebody else named', w.rot.inputRefusal([{ baseId: VENISON, count: 1, name: 'Grandma\'s Venison' }]) !== '');
})();

// ------------------------------------------------ H. preserving --
(function () {
  const w = world();
  w.inv[STRANGER] = [e(VENISON, 2, 'Venison (5 days left)'), e(SALT, 3)];
  yes('H1 somebody who is not a cook may not preserve', !w.rot.mayPreserve(STRANGER) &&
      !w.rot.preserve(STRANGER, 'salt', { baseId: VENISON, left: 5, name: 'Venison' }).ok &&
      w.inv[STRANGER][1].count === 3);
  w.cooks[COOK] = 'hearthcook';
  yes('H1 a Hearthcook may', w.rot.mayPreserve(COOK));
  w.cooks[STRANGER] = 'confectioner';
  yes('H1 and a Confectioner', w.rot.mayPreserve(STRANGER));

  w.inv[COOK] = [e(VENISON, 3, 'Venison (5 days left)'), e(VENISON, 1, 'Venison (2 days left)'),
                 e(BEEF_STEW, 1, S.names[DESC[BEEF_STEW]] + ' (9 days left)'), e(VENISON, 1, 'Venison (salted)'), e(SALT, 2), e(WOOD, 1)];
  w.fire = false;
  const v = w.rot.view(COOK);
  yes('H2 the panel lists only raw food not yet preserved, the nearest to spoiling first',
      v.may && v.rows.length === 2 && v.rows[0].left === 2 && v.rows[1].left === 5 && v.rows[1].count === 3 &&
      v.rows[0].base === VENISON.toString(16) && v.rows[0].name === 'Venison');
  yes('H2 and what the cook carries for it', v.salt === 2 && v.wood === 1 && v.fire === false && v.perWood === 5);

  const s = w.rot.preserve(COOK, 'salt', { baseId: VENISON, left: 5, name: 'Venison' });
  const inv = names(w.inv[COOK]);
  yes('H3 salting preserves as many as there is salt for, one Salt Pile a piece, the rest left as they were',
      s.ok && inv.indexOf(VENISON.toString(16) + 'x3 Venison (salted)') >= 0 &&
      inv.indexOf(VENISON.toString(16) + 'x1 Venison (5 days left)') >= 0 &&
      w.inv[COOK].filter(function (x) { return x.baseId === SALT; }).length === 0);
  yes('H3 and says so', s.line === '2 of your Venison are salted and will not spoil. You used 2 Salt Piles.');
  yes('H4 salting with no salt is refused', !w.rot.preserve(COOK, 'salt', { baseId: VENISON, left: 2, name: 'Venison' }).ok);
  yes('H5 smoking away from a fire is refused, and nothing is used',
      !w.rot.preserve(COOK, 'smoke', { baseId: VENISON, left: 2, name: 'Venison' }).ok &&
      w.inv[COOK].filter(function (x) { return x.baseId === WOOD; })[0].count === 1);
  w.fire = true;
  w.inv[COOK].push(e(VENISON, 7, 'Venison (4 days left)'));
  const k = w.rot.preserve(COOK, 'smoke', { baseId: VENISON, left: 4, name: 'Venison' });
  yes('H6 one Firewood smokes 5 pieces at a lit fire',
      k.ok && w.inv[COOK].filter(function (x) { return x.name === 'Venison (smoked)'; })[0].count === 5 &&
      w.inv[COOK].filter(function (x) { return x.name === 'Venison (4 days left)'; })[0].count === 2 &&
      w.inv[COOK].filter(function (x) { return x.baseId === WOOD; }).length === 0 &&
      k.line === '5 of your Venison are smoked and will not spoil. You used a Firewood.');
  yes('H7 a cooked dish is not preserved', !w.rot.preserve(COOK, 'salt', { baseId: BEEF_STEW, left: 9, name: S.names[DESC[BEEF_STEW]] }).ok);
  yes('H7 nor food that is not in the pack any more', w.rot.preserve(COOK, 'salt', { baseId: VENISON, left: 6, name: 'Venison' }).line ===
      'That food is not in your pack any more.');
  w.inv[COOK].push(e(SALT, 5));
  w.failWrite = true;
  const f = w.rot.preserve(COOK, 'salt', { baseId: VENISON, left: 2, name: 'Venison' });
  w.failWrite = false;
  yes('H8 a pack that cannot be written uses nothing', !f.ok && w.inv[COOK].filter(function (x) { return x.baseId === SALT; })[0].count === 5);

  w.shown = [];
  const said = w.rot.panel(COOK, ['salt', VENISON.toString(16), '2', 'Venison']);
  yes('H9 a row\'s button is the words after /preserve, and the panel is drawn again',
      /^Your Venison is salted/.test(said) && w.shown.length === 1 && w.shown[0].v.open === true);
  w.rot.panel(COOK, []);
  yes('H9 the key alone draws the panel', w.shown.length === 2);

  w.lines = {};
  w.inv[COOK] = [e(VENISON, 1, 'Venison (5 days left)')];
  w.rot.pass(COOK, 2e12);
  yes('H10 a cook carrying raw food has the inventory line', w.lines[COOK] === true);
  w.inv[COOK] = [e(VENISON, 1, 'Venison (smoked)')];
  w.rot.pass(COOK, 2e12 + 1000);
  yes('H10 and loses it once all of it is preserved', w.lines[COOK] === false);
  delete w.cooks[STRANGER];
  w.inv[STRANGER] = [e(VENISON, 1, 'Venison (5 days left)')];
  w.rot.pass(STRANGER, 2e12);
  yes('H10 somebody who is not a cook never has it', w.lines[STRANGER] === false);
})();

// ------------------------------------------------- I. the wiring --
const activate = slice(gm, 'THE CHEST\'S FOOD CLOCK (#3163)', 'touchedBench');
yes('I1 every press on a container is handed to the spoilage block before the engine sends what is in it',
    !!activate && /rot\.pressed\(casterRefrId, refrId, baseDesc, Date\.now\(\)\)/.test(activate));
const craft = slice(gm, 'mp.onCraft = guard(\'onCraft\'', '\n});');
yes('I2 a craft with a named input that is not food is refused before anything else is done',
    !!craft && /inputRefusal\(arguments\[6\]\)/.test(craft) && /if \(namedNo\) \{[\s\S]{0,400}return false;/.test(craft) &&
    craft.indexOf('inputRefusal(arguments[6])') < craft.indexOf('recipeSetInGame('));
yes('I3 a dish is named after cookedOutput, qualityOutput and wovenOutput have had their say',
    !!craft && /cookedOutput\(actorId, row\);\s*qualityOutput\(actorId, row, margin\);\s*wovenOutput\(actorId, row\);\s*spoilingOutput\(actorId\);/.test(craft));
const spoilingFn = slice(gm, 'function spoilingOutput(actorId) {', '\n}');
yes('I3 spoilingOutput names only an output nobody named, through craftOutput',
    !!spoilingFn && /out\.name\) \{ return; \}/.test(spoilingFn) && /mp\.set\(actorId, 'craftOutput', \{ name: name \}\)/.test(spoilingFn));
const pw = slice(gm, 'const PLAYER_WORDS', ';');
yes('I4 /preserve is a word the server answers, and not one a person is told to type',
    gm.indexOf('\'/preserve\',') >= 0 && /if \(word === '\/preserve'\) \{[\s\S]{0,300}rot\.panel\(actorId, parts\.slice\(1\)\)/.test(gm) &&
    (!pw || pw.indexOf('/preserve') < 0));
yes('I5 the pass runs over the online packs on a timer, and a reload clears the old one',
    /clearInterval\(g\.__thornswoodSpoilTimer\)/.test(block) && /setInterval\(passAll, PASS_MS\)/.test(block) &&
    /mp\.get\(0, 'onlinePlayers'\)/.test(block));
yes('I6 cold storage is the season block\'s snowy climates and its high mountains',
    /S\.snowy\(S\.climateOf\(containerId, null\)\)/.test(block) && /snowy: function \(climate\)/.test(gm) && /high: HIGH,/.test(gm));

const overlays = /const OVERLAYS = (\[[\s\S]*?\]);/.exec(front);
yes('I7 the client loads the preserving page', !!overlays && overlays[1].indexOf('\'thornswood-preserve.js\'') >= 0);
yes('I7 the key is the friend key, read again with it from the settings (#3126), and asked before the friend key\'s own work',
    /\n  let PRESERVE_KEY = FRIEND_KEY;/.test(front) &&
    /function readKeys\(text\) \{[\s\S]*\n    PRESERVE_KEY = FRIEND_KEY;[\s\S]*\n    PRESERVE_NAME = keyName\(PRESERVE_KEY\);[\s\S]*?\n  \}/.test(front) &&
    front.indexOf('e.code === PRESERVE_KEY && preservePress()') >= 0 &&
    front.indexOf('e.code === PRESERVE_KEY && preservePress()') < front.indexOf('if (e.code === FRIEND_KEY) { lookVerb(\'friend\'); return; }'));
yes('I7 the key only works in the inventory with something to preserve, and asks for the panel',
    /function preservePress\(\) \{[\s\S]{0,600}isMenuOpen\(INVENTORY_MENU\)[\s\S]{0,300}preserveCan\(\)[\s\S]{0,400}tellServer\('\/preserve'\)/.test(front));
yes('I7 the inventory line reads "Salt or smoke your food" above the furniture line',
    front.indexOf('\'Salt or smoke your food\'') >= 0 && /PRESERVE_CSS = REPAIR_CSS\.replace\('bottom:12%', 'bottom:27%'\)/.test(front));
yes('I8 the panel\'s buttons send /preserve salt and /preserve smoke with the row, and nothing tells anyone to type them',
    /net\('\/preserve ' \+ how \+ ' ' \+ row\.base \+ ' ' \+ row\.left \+ ' ' \+ row\.name\)/.test(ui) &&
    !/type \/preserve/i.test(ui) && !/type \/preserve/i.test(front));
yes('I9 the server\'s view reaches the page through its property', /window\.thornswoodPreserve\.setData\(d\)/.test(block));

const needs = slice(gm, '// ==== thornswood needs: hunger, thirst and exhaustion ====', '// ==== end thornswood needs ====') || '';
yes('I10 eating spoiled food fills nothing and starts food sickness, always',
    /if \(baseId && baseId === spoiledFood\(\)\) \{[\s\S]{0,300}meal\(actorId, \{ food: 0, sick: 'spoiled' \}\)/.test(needs) &&
    /row\.food === 0 \? 0 :/.test(needs) && /food: \{ raw: 0\.40, full: 1, spoiled: 1 \}/.test(gm) &&
    needs.indexOf('baseId === spoiledFood()') < needs.indexOf('if (baseId === burntMeal())'));
const plugin = fs.readFileSync(path.join(REPO_DIR, 'game', 'content', 'Thornswood-Content.esp'));
yes('I11 the content plugin carries the spoiled food record and its effect',
    plugin.indexOf(Buffer.from('ThornswoodFoodSpoiled\0', 'latin1')) >= 0 &&
    plugin.indexOf(Buffer.from('ThornswoodSpoiledEffect\0', 'latin1')) >= 0 &&
    plugin.indexOf(Buffer.from('Spoiled Food\0', 'latin1')) >= 0);

// ------------------------------------------------- J. the page --
yes('J1 docs/systems/spoilage.md is the design', page.length > 0);
yes('J1 and says the numbers: 7 days raw, 14 cooked, preserved never, a Salt Pile a piece, a Firewood for every 5',
    /7 days/.test(page) && /14 days/.test(page) && /never spoil/i.test(page) && /Salt Pile/.test(page) && /every 5 pieces/.test(page));
yes('J1 and that a pack does not spoil while its owner is offline', /offline/i.test(page));
yes('J1 and Patrick\'s answers of 26 October: cooks only, every chest cold in winter, spoiled food stays',
    /winter week/i.test(page) && /\(spoiled\)/.test(page) && /fills nothing/i.test(page) && /compost/i.test(page));
yes('J2 the page is linked from the food page', read('docs/systems/food.md').indexOf('spoilage.md') >= 0);
const words = (page + '\n' + block + '\n' + ui).match(/\bplayers?\b/gi) || [];
yes('J3 the page, the block and the panel never say player', words.length === 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
