'use strict';
/*
  test-scenario-mixtures.js

  Scenario: systems/mixtures.md

  #5198. Brewing at a lab, end to end: the WHOLE of game/gamemode.js over the
  stand-in server (tests/stand-in-server.js), every step a message the engine
  sends in the order it sends them. A brew is CraftService at the alchemy
  lab: onCraftWork, then onCraft with the bottle the brewing client made (a
  runtime form, above 0xff000000), the magic effects the ingredients share
  (the engine's sixth argument) and the ingredients it takes; the engine
  then takes them and gives the bottle, or the count the gamemode set in
  craftOutput. Tasting an ingredient is onEatItem. The ingredients carry
  their game effects on their records.

  Brenna is a smith. Birna is a novice Blightbrewer, Dagny a novice
  Physicker, Helga a Physicker at Master, Eirik a novice Physicker with no
  alembic. They stand at a lab in Windhelm.

    A  Brenna, no Alchemist, is refused the lab and nothing is taken.
    B  Birna brews Red Mountain Flower and Nightshade, which share Damage
       Health, before she has eaten either: refused, naming both, and nothing
       is taken. She eats one of each and is told she knows the taste. Then
       the brew goes through: one bottle, the ingredients gone, one piece of
       Blightbrewer work, the mix remembered and said, and the alembic used.
    C  Dagny brews Blue Mountain Flower and Wheat, which share Restore Health
       and Fortify Health: Fortify Health is advanced, so it is refused,
       naming the rank, and nothing is taken.
    D  She brews Damage Health, the Blightbrewer's novice poison: a sister
       half works its novice list, so it goes through.
    E  Blue Mountain Flower and Nightshade share only Damage Magicka Regen,
       which is on neither list: refused as off the mixtures list.
    F  Helga, at Master, brews Restore and Fortify Health: Master Chemist, two
       bottles, and still one piece of work.
    G  Eirik has no alembic: refused, told who makes one, nothing taken.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  Read only, apart from its temp folders, which it removes.

      node tests\test-scenario-mixtures.js
*/
const standIn = require('./stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const w = standIn.world({ name: 'mixtures' });
const CITY = '1691d:Skyrim.esm';
const LAB_BASE = 'bad0c:Skyrim.esm';                 // an alchemy lab: BENCH_BY_BASE names it the alchemy lab
const ALEMBIC = '1b001:Thornswood-Content.esp';
// The magic effects, Skyrim.esm's MGEF records.
const RESTORE_HEALTH = '3eb15:Skyrim.esm', FORTIFY_HEALTH = '3eaf3:Skyrim.esm', DAMAGE_HEALTH = '3eb42:Skyrim.esm';
const DAMAGE_MAGICKA_REGEN = '73f2b:Skyrim.esm', RAVAGE_MAGICKA = '73f27:Skyrim.esm', RESTORE_MAGICKA = '3eb17:Skyrim.esm';
const FORTIFY_MAGICKA = '3eaf8:Skyrim.esm';
// The ingredients, with the effects the game gives them that matter here.
const BLUE = '77e1c:Skyrim.esm', WHEAT = '4b0ba:Skyrim.esm', RED = '77e1d:Skyrim.esm', NIGHTSHADE = '516c8:Skyrim.esm';
function ingredient(desc, effects) { w.record(desc, 'INGR', { fields: effects.map(function (e) { return { type: 'EFID', data: { ref: e } }; }) }); }
[RESTORE_HEALTH, FORTIFY_HEALTH, DAMAGE_HEALTH, DAMAGE_MAGICKA_REGEN, RAVAGE_MAGICKA, RESTORE_MAGICKA, FORTIFY_MAGICKA].forEach(function (d) { w.record(d, 'MGEF'); });
ingredient(BLUE, [RESTORE_HEALTH, FORTIFY_HEALTH, DAMAGE_MAGICKA_REGEN]);
ingredient(WHEAT, [RESTORE_HEALTH, FORTIFY_HEALTH]);
ingredient(RED, [RESTORE_MAGICKA, RAVAGE_MAGICKA, FORTIFY_MAGICKA, DAMAGE_HEALTH]);
ingredient(NIGHTSHADE, [DAMAGE_HEALTH, DAMAGE_MAGICKA_REGEN]);
w.record(LAB_BASE, 'FURN', { editorId: 'CraftingAlchemyWorkbench' });
w.record(ALEMBIC, 'MISC');
const id = w.idOf;
const LAB = w.ref(0xff200080, { base: LAB_BASE, cell: CITY, pos: [2000, 0, 0] });

function pack(extra) {
  return { entries: [{ baseId: id(BLUE), count: 4 }, { baseId: id(WHEAT), count: 4 }, { baseId: id(RED), count: 4 },
    { baseId: id(NIGHTSHADE), count: 4 }].concat(extra || []) };
}
const WITH_ALEMBIC = [{ baseId: id(ALEMBIC), count: 1 }];
function at(n) { return [2040 + 30 * n, 0, 0]; }
const BRENNA = w.person(0xff001300, { profileId: 1000, name: 'Brenna', prof: 'smith', cell: CITY, pos: at(0), inventory: pack(WITH_ALEMBIC) });
const BIRNA = w.person(0xff001301, { profileId: 1002, name: 'Birna', prof: 'alchemist', half: 'blightbrewer', cell: CITY, pos: at(1), inventory: pack(WITH_ALEMBIC) });
const DAGNY = w.person(0xff001302, { profileId: 1004, name: 'Dagny', prof: 'alchemist', half: 'physicker', cell: CITY, pos: at(2), inventory: pack(WITH_ALEMBIC) });
const HELGA = w.person(0xff001303, { profileId: 1006, name: 'Helga', prof: 'alchemist', half: 'physicker', rank: 'master', cell: CITY, pos: at(3), inventory: pack(WITH_ALEMBIC) });
const EIRIK = w.person(0xff001304, { profileId: 1008, name: 'Eirik', prof: 'alchemist', half: 'physicker', cell: CITY, pos: at(4), inventory: pack() });
const EVERYONE = [BRENNA, BIRNA, DAGNY, HELGA, EIRIK];
EVERYONE.forEach(function (a) { w.row(a).thornswoodNeeds = { food: 80, drink: 90, rest: 90, temp: 50, at: w.now() }; });

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
EVERYONE.forEach(w.arrive);
w.run(30000);

function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function show(a) {
  return JSON.stringify(w.row(a).inventory.entries.filter(function (e) { return e.count > 0; }).map(function (e) { return e.baseId.toString(16) + 'x' + e.count; }).sort());
}
function work(a, half) { return (((w.prop(a, 'thornswoodCharacter') || {}).work) || {})[half] || 0; }
function eaten(a, desc) { const r = w.prop(a, 'thornswoodAlchemy') || {}; return !!(r.eaten && r.eaten[desc]); }
let bottle = 0xff000a00;
/* One brew: the bottle a client makes is a new runtime form each time. */
function brew(a, with2, effects) {
  bottle++;
  return w.craft(a, LAB, { output: bottle, count: 1, recipe: 0, effects: effects.map(id),
    inputs: with2.map(function (d) { return { baseId: id(d), count: 1 }; }) });
}
let heardAt = 0;

// ------------------------------------------------------------ A. not hers --
w.activate(LAB, BRENNA);
let before = show(BRENNA);
const a1 = brew(BRENNA, [RED, NIGHTSHADE], [DAMAGE_HEALTH]);
yes('A1 Brenna, no Alchemist, is refused the lab and nothing is taken (' + last(BRENNA) + ')', !a1.made && show(BRENNA) === before);
w.activate(LAB, BRENNA);

// ---------------------------------------------------------- B. a first brew --
w.activate(LAB, BIRNA);
before = show(BIRNA);
const b1 = brew(BIRNA, [RED, NIGHTSHADE], [DAMAGE_HEALTH]);
yes('B1 Birna has eaten neither: refused, naming both, and nothing is taken (' + last(BIRNA) + ')',
  !b1.made && /^You have never eaten .* or .*, so you do not know what they do\./.test(last(BIRNA)) && show(BIRNA) === before);
heardAt = w.heard(BIRNA).length;
w.eat(BIRNA, id(RED));
w.run(9000);
w.eat(BIRNA, id(NIGHTSHADE));
w.run(1000);
yes('B2 she eats one of each and is told she knows the taste (' + w.heardSince(BIRNA, heardAt).join(' | ') + ')',
  eaten(BIRNA, RED) && eaten(BIRNA, NIGHTSHADE) &&
  w.heardSince(BIRNA, heardAt).filter(function (l) { return /^You know the taste of .* now\. It can go in a brew\.$/.test(l); }).length === 2);
const workWas = work(BIRNA, 'blightbrewer');
heardAt = w.heard(BIRNA).length;
const b3 = brew(BIRNA, [RED, NIGHTSHADE], [DAMAGE_HEALTH]);
yes('B3 then it goes through: one bottle, and the ingredients gone (' + JSON.stringify(b3) + ')',
  b3.made && b3.count === 1 && w.count(BIRNA, bottle) === 1 && w.count(BIRNA, id(RED)) === 2 && w.count(BIRNA, id(NIGHTSHADE)) === 2);
yes('B3 one piece of Blightbrewer work (' + workWas + ' -> ' + work(BIRNA, 'blightbrewer') + ')', work(BIRNA, 'blightbrewer') === workWas + 1);
yes('B3 the mix is remembered and said (' + w.heardSince(BIRNA, heardAt).join(' | ') + ')',
  w.heardSince(BIRNA, heardAt).some(function (l) { return /^You will remember this mix at any alchemy lab: .* make Damage Health\.$/.test(l); }) &&
  ((w.prop(BIRNA, 'thornswoodAlchemy') || {}).recipes || []).length === 1);
w.activate(LAB, BIRNA);

// ----------------------------------------------------------- C. above her --
[BLUE, WHEAT, RED, NIGHTSHADE].forEach(function (d) { w.eat(DAGNY, id(d)); w.run(9000); });
w.activate(LAB, DAGNY);
before = show(DAGNY);
const c1 = brew(DAGNY, [BLUE, WHEAT], [RESTORE_HEALTH, FORTIFY_HEALTH]);
yes('C1 Dagny\'s Restore and Fortify Health: Fortify Health is advanced, refused naming the rank, nothing taken (' + last(DAGNY) + ')',
  !c1.made && /Advanced/.test(last(DAGNY)) && /Fortify Health/.test(last(DAGNY)) && show(DAGNY) === before);

// ------------------------------------------------------- D. a sister half --
const d1 = brew(DAGNY, [RED, NIGHTSHADE], [DAMAGE_HEALTH]);
yes('D1 Damage Health, the Blightbrewer\'s novice poison: a sister half works its novice list (' + last(DAGNY) + ')',
  d1.made && w.count(DAGNY, bottle) === 1);

// ---------------------------------------------------------- E. off the list --
before = show(DAGNY);
const e1 = brew(DAGNY, [BLUE, NIGHTSHADE], [DAMAGE_MAGICKA_REGEN]);
yes('E1 Damage Magicka Regen is on neither list: refused as off the mixtures list (' + last(DAGNY) + ')',
  !e1.made && last(DAGNY) === 'A lab here brews only what the mixtures list names, and that brew carries an effect that is not on it.' &&
  show(DAGNY) === before);
w.activate(LAB, DAGNY);

// ------------------------------------------------------- F. Master Chemist --
[BLUE, WHEAT].forEach(function (d) { w.eat(HELGA, id(d)); w.run(9000); });
w.activate(LAB, HELGA);
const helgaWas = work(HELGA, 'physicker');
const f1 = brew(HELGA, [BLUE, WHEAT], [RESTORE_HEALTH, FORTIFY_HEALTH]);
yes('F1 Helga, at Master, brews Restore and Fortify Health: Master Chemist, two bottles (' + JSON.stringify(f1) + ')',
  f1.made && w.count(HELGA, bottle) === 2 && w.count(HELGA, id(BLUE)) === 2 && w.count(HELGA, id(WHEAT)) === 2);
yes('F1 and still one piece of work (' + helgaWas + ' -> ' + work(HELGA, 'physicker') + ')', work(HELGA, 'physicker') === helgaWas + 1);
w.activate(LAB, HELGA);

// ---------------------------------------------------------- G. no alembic --
[RED, NIGHTSHADE].forEach(function (d) { w.eat(EIRIK, id(d)); w.run(9000); });
w.activate(LAB, EIRIK);
before = show(EIRIK);
const g1 = brew(EIRIK, [RED, NIGHTSHADE], [DAMAGE_HEALTH]);
yes('G1 Eirik has no alembic: refused, told who makes one, nothing taken (' + last(EIRIK) + ')',
  !g1.made && last(EIRIK) === 'You need an alembic in your pack for that. A smith forges them.' && show(EIRIK) === before);
w.activate(LAB, EIRIK);

t.done(w);
