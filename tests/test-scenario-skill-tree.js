'use strict';
/*
  test-scenario-skill-tree.js

  Scenario: systems/skill-tree.md

  #5198. Spending points and what they do, end to end: the WHOLE of
  game/gamemode.js over the stand-in server (tests/stand-in-server.js), every
  step a message the engine sends in the order it sends them. The K panel's
  plus button is a line through the voice queue (/pick spend <sub-skill>, or
  /spend <sub-skill>), as the panel sends it; what a point does reaches the
  game as the map in the character's panel (effects), which the front plugin
  applies. Equipping is onEquipItemAttempt. Work is enchanting at an arcane
  enchanter. A login is the launcher's pass and onThornswoodLogin.

  Brenna is a smith with no points to spend and Might 1. Corvin has 6 points
  and Vitality 3. Wynn is a novice Bladebinder 99 pieces of work from
  advanced, with a rune knife at an arcane enchanter.

    A  Brenna has no points: refused, and the tree is as it was.
    B  Corvin puts a point in Vitality: 10 more health in what the game is
       sent. The fifth point fills it, and he is told Cheat Death is his. A
       sixth is refused.
    C  A point taken out, and a sub-skill that does not exist, are refused.
    D  A point in Precision says the game ignores critical chance.
    E  A rank is a free point: Wynn's next piece makes her an Advanced
       Bladebinder and hands her one, said.
    F  Might is strength: Brenna is refused a weapon of weight 30 (Might 3)
       and told so; Corvin, with Might 3, is not refused it, and is refused
       one of weight 50 (Might 5). A light sword needs none.
    G  A restart: the tree, the points and what the game is sent hold.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  When each filled perk fires is its own system's scenario: Cheat Death in
  Death, Purified Blood in Disease, Troll's Blood and the rest in combat.

  Read only, apart from its temp folders, which it removes.

      node tests\test-scenario-skill-tree.js
*/
const standIn = require('./stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const w = standIn.world({ name: 'skill-tree' });
const CITY = '1691d:Skyrim.esm';
const TABLE_BASE = 'bad0d:Skyrim.esm';
const KNIFE = '1b002:Thornswood-Content.esp';
const FIRE_DAMAGE = '4605a:Skyrim.esm';
const SWORD = '12eb7:Skyrim.esm', PETTY = '2e4e3:Skyrim.esm';
const WARHAMMER = '13981:Skyrim.esm', CLUB = 'f71dd:Skyrim.esm';
/* A WEAP's DATA: value u32, weight float, damage u16 (libespm WEAP.h). */
function data(weight) {
  const b = Buffer.alloc(10);
  b.writeUInt32LE(25, 0); b.writeFloatLE(weight, 4); b.writeUInt16LE(10, 8);
  return { type: 'DATA', data: Array.from(b) };
}
w.record(FIRE_DAMAGE, 'MGEF');
w.record(SWORD, 'WEAP', { editorId: 'IronSword', fields: [{ type: 'DNAM', data: [1, 0, 0, 0] }, data(9)] });
w.record(WARHAMMER, 'WEAP', { editorId: 'SteelWarhammer', fields: [data(30)] });
w.record(CLUB, 'WEAP', { editorId: 'GiantClub', fields: [data(50)] });
w.record(PETTY, 'SLGM', { editorId: 'SoulGemPettyFilled' });
w.record(TABLE_BASE, 'FURN', { editorId: 'CraftingEnchantingWorkbench' });
w.record(KNIFE, 'MISC');
const id = w.idOf;
const TABLE = w.ref(0xff2000b0, { base: TABLE_BASE, cell: CITY, pos: [2000, 0, 0] });

function at(n) { return [2040 + 30 * n, 0, 0]; }
const ARMS = [{ baseId: id(SWORD), count: 2 }, { baseId: id(WARHAMMER), count: 1 }, { baseId: id(CLUB), count: 1 }];
const BRENNA = w.person(0xff001700, { profileId: 1000, name: 'Brenna', prof: 'smith', cell: CITY, pos: at(0),
  inventory: { entries: ARMS.slice() }, character: { points: 0, tree: { might: 1, burden: 1, resilience: 1 } } });
const CORVIN = w.person(0xff001701, { profileId: 1002, name: 'Corvin', prof: 'tailor', cell: CITY, pos: at(1),
  inventory: { entries: ARMS.slice() }, character: { points: 6, tree: { vitality: 3, might: 3 } } });
const WYNN = w.person(0xff001702, { profileId: 1004, name: 'Wynn', prof: 'enchanter', half: 'bladebinder', cell: CITY, pos: at(2),
  inventory: { entries: [{ baseId: id(SWORD), count: 2 }, { baseId: id(PETTY), count: 2 }, { baseId: id(KNIFE), count: 1 }] },
  character: { points: 0, work: { bladebinder: 99 } } });
const EVERYONE = [BRENNA, CORVIN, WYNN];
EVERYONE.forEach(function (a) { w.row(a).thornswoodNeeds = { food: 80, drink: 90, rest: 90, temp: 50, at: w.now() }; });

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
EVERYONE.forEach(w.arrive);
w.run(30000);

function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function say(a, text) { w.say(a, text); w.run(300); return last(a); }
function ch(a) { return w.prop(a, 'thornswoodCharacter') || {}; }
function tree(a) { return ch(a).tree || {}; }
function effects(a) { return (ch(a).panel || {}).effects || {}; }
let heardAt = 0;

// ------------------------------------------------------------ A. no points --
const treeWas = JSON.stringify(tree(BRENNA));
yes('A1 Brenna has no points: refused, and the tree is as it was (' + say(BRENNA, '/pick spend vitality') + ')',
  last(BRENNA) === 'No: no points to spend.' && JSON.stringify(tree(BRENNA)) === treeWas);

// ------------------------------------------------------- B. Vitality --
const healthWas = effects(CORVIN).health || 0;
say(CORVIN, '/pick spend vitality');
yes('B1 Corvin puts a point in Vitality: 10 more health in what the game is sent (' + healthWas + ' -> ' + effects(CORVIN).health + ')',
  tree(CORVIN).vitality === 4 && ch(CORVIN).points === 5 && effects(CORVIN).health === healthWas + 10);
heardAt = w.heard(CORVIN).length;
say(CORVIN, '/spend vitality');
yes('B2 the fifth point fills it and he is told Cheat Death is his (' + w.heardSince(CORVIN, heardAt).join(' | ') + ')',
  tree(CORVIN).vitality === 5 && effects(CORVIN).health === healthWas + 20 &&
  w.heardSince(CORVIN, heardAt).some(function (l) { return /^Vitality is full\. Cheat Death: /.test(l); }));
yes('B3 a sixth is refused (' + say(CORVIN, '/spend vitality') + ')',
  last(CORVIN) === 'No: that one is full.' && tree(CORVIN).vitality === 5 && ch(CORVIN).points === 4);

// ------------------------------------------------- C. nothing comes back out --
yes('C1 a point taken out is refused (' + say(CORVIN, '/spend vitality -1') + ')',
  last(CORVIN) === 'No: a point goes in one at a time, and a point already placed cannot be moved.' &&
  tree(CORVIN).vitality === 5 && ch(CORVIN).points === 4);
yes('C2 a sub-skill that does not exist is refused (' + say(CORVIN, '/spend luck') + ')',
  last(CORVIN) === 'No: no such sub-skill.' && ch(CORVIN).points === 4);

// --------------------------------------------------------- D. Precision --
yes('D1 a point in Precision says the game ignores critical chance (' + say(CORVIN, '/spend precision') + ')',
  /^Critical chance is put on your character, and the game ignores it/.test(last(CORVIN)) && tree(CORVIN).precision === 1);

// ------------------------------------------------------- E. a rank's point --
heardAt = w.heard(WYNN).length;
w.activate(TABLE, WYNN);
const e1 = w.craft(WYNN, TABLE, { output: 0xff000d01, count: 1, recipe: 0, effects: [id(FIRE_DAMAGE)],
  inputs: [{ baseId: id(SWORD), count: 1 }, { baseId: id(PETTY), count: 1 }] });
w.activate(TABLE, WYNN);
w.run(300);
yes('E1 a rank is a free point: Wynn is an Advanced Bladebinder with one to spend, and is told (' + w.heardSince(WYNN, heardAt).join(' | ') + ')',
  e1.made && (ch(WYNN).ranks || {}).bladebinder === 'advanced' && ch(WYNN).points === 1 &&
  w.heardSince(WYNN, heardAt).some(function (l) { return /^You are now an Advanced Bladebinder\. 1 skill point to spend, on K\./.test(l); }));
say(WYNN, '/spend burden');
yes('E2 and she spends it (' + JSON.stringify(tree(WYNN)) + ', ' + effects(WYNN).carryWeight + ')',
  tree(WYNN).burden === 1 && ch(WYNN).points === 0 && effects(WYNN).carryWeight === 15);

// ------------------------------------------------------------ F. strength --
heardAt = w.heard(BRENNA).length;
const f1 = w.equip(BRENNA, id(WARHAMMER));
w.run(300);
yes('F1 Brenna, Might 1, is refused a weapon of weight 30, and told it needs Might 3 (' + w.heardSince(BRENNA, heardAt).join(' | ') + ')',
  f1 === false && w.heardSince(BRENNA, heardAt).some(function (l) { return l === 'You are not strong enough to wield this. Needs Might 3.'; }));
yes('F2 Corvin, Might 3, is not refused it', w.equip(CORVIN, id(WARHAMMER)) !== false);
heardAt = w.heard(CORVIN).length;
const f3 = w.equip(CORVIN, id(CLUB));
w.run(300);
yes('F3 and is refused one of weight 50, which needs Might 5 (' + w.heardSince(CORVIN, heardAt).join(' | ') + ')',
  f3 === false && w.heardSince(CORVIN, heardAt).some(function (l) { return l === 'You are not strong enough to wield this. Needs Might 5.'; }));
yes('F4 a light sword needs no Might', w.equip(BRENNA, id(SWORD)) !== false);

// ------------------------------------------------------------- G. restart --
const before = JSON.stringify([tree(CORVIN), ch(CORVIN).points, effects(CORVIN).health]);
const r = w.restart();
yes('G1 the server restarts', r.loaded);
EVERYONE.forEach(w.arrive);
w.run(30000);
const after = JSON.stringify([tree(CORVIN), ch(CORVIN).points, effects(CORVIN).health]);
yes('G1 and the tree, the points and what the game is sent hold (' + after + ')', after === before);

t.done(w);
