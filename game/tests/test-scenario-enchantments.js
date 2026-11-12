'use strict';
/*
  test-scenario-enchantments.js

  Scenario: systems/enchantments.md

  #5198. Enchanting at an arcane enchanter, end to end: the WHOLE of
  game/gamemode.js over the stand-in server (tests/stand-in-server.js), every
  step a message the engine sends in the order it sends them. An enchantment
  is CraftService at the arcane enchanter: onCraftWork, then onCraft with the
  piece the enchanting client made (a runtime form, above 0xff000000), the
  magic effects that went on it (the engine's sixth argument) and what it
  takes, the piece and the soul gem (the seventh); the engine then takes them
  and gives the enchanted piece. A login is the launcher's pass and
  onThornswoodLogin.

  Brenna is a smith. Wynn is a novice Bladebinder, Ulfr a novice Wardweaver,
  Sigrid a Wardweaver at Master, and Tova a novice Bladebinder with no rune
  knife. They stand at an arcane enchanter in Windhelm.

    A  Brenna, no Enchanter, is refused the bench and nothing is taken.
    B  Wynn puts Fire Damage on an iron sword with a petty gem: it goes
       through, the sword and the gem are gone, the enchanted sword is in her
       pack, and it is one piece of Bladebinder work.
    C  Absorb Health is advanced: refused, naming the rank, nothing taken.
    D  Fortify Health on armour is her sister half's novice list, so it goes
       through and counts for Wardweaver. Resist Fire is that half past
       novice: refused, naming the sister half, nothing taken.
    E  A lesser gem is advanced Bladebinder's work: refused, the gem and the
       piece left in her pack. The size of the gem is what is judged.
    F  Fortify Smithing is on neither list: refused as off the enchantments
       list, nothing taken.
    G  Twin Souls: Ulfr is handed one slot and Sigrid two when they arrive.
       Two enchantments on one piece is refused for Ulfr and goes through for
       Sigrid. Three is refused even for her.
    H  Tova has no rune knife: refused, told who makes one, nothing taken.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  A staff is a recipe at Bladebinder's, which the crafting scenario covers.

  Read only, apart from its temp folders, which it removes.

      node game\tests\test-scenario-enchantments.js
*/
const standIn = require('../../tests/stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const w = standIn.world({ name: 'enchantments' });
const CITY = '1691d:Skyrim.esm';
const TABLE_BASE = 'bad0d:Skyrim.esm';               // an arcane enchanter: BENCH_BY_BASE names it enchanting
const KNIFE = '1b002:Thornswood-Content.esp';         // the rune knife
// The enchanting effects, Skyrim.esm's MGEF records.
const FIRE_DAMAGE = '4605a:Skyrim.esm', ABSORB_HEALTH = 'aa155:Skyrim.esm';
const FORTIFY_HEALTH = '493aa:Skyrim.esm', FORTIFY_STAMINA = '49507:Skyrim.esm', FORTIFY_MAGICKA = '49504:Skyrim.esm';
const RESIST_FIRE = '48c8b:Skyrim.esm', FORTIFY_SMITHING = '7a102:Skyrim.esm';
// The pieces and the gems.
const SWORD = '12eb7:Skyrim.esm', ARMOR = '12e49:Skyrim.esm';
const PETTY = '2e4e3:Skyrim.esm', LESSER = '2e4e5:Skyrim.esm';
[FIRE_DAMAGE, ABSORB_HEALTH, FORTIFY_HEALTH, FORTIFY_STAMINA, FORTIFY_MAGICKA, RESIST_FIRE, FORTIFY_SMITHING]
  .forEach(function (d) { w.record(d, 'MGEF'); });
function bod2(slots, kind) { return { type: 'BOD2', data: [slots & 255, (slots >> 8) & 255, (slots >> 16) & 255, (slots >>> 24) & 255, kind, 0, 0, 0] }; }
w.record(SWORD, 'WEAP', { editorId: 'IronSword', fields: [{ type: 'DNAM', data: [1, 0, 0, 0] }] });
w.record(ARMOR, 'ARMO', { editorId: 'ArmorIronCuirass', fields: [bod2(1 << 2, 1)] });
w.record(PETTY, 'SLGM', { editorId: 'SoulGemPettyFilled' });
w.record(LESSER, 'SLGM', { editorId: 'SoulGemLesserFilled' });
w.record(TABLE_BASE, 'FURN', { editorId: 'CraftingEnchantingWorkbench' });
w.record(KNIFE, 'MISC');
const id = w.idOf;
const TABLE = w.ref(0xff200090, { base: TABLE_BASE, cell: CITY, pos: [2000, 0, 0] });

function pack(extra) {
  return { entries: [{ baseId: id(SWORD), count: 4 }, { baseId: id(ARMOR), count: 4 }, { baseId: id(PETTY), count: 4 },
    { baseId: id(LESSER), count: 2 }].concat(extra || []) };
}
const WITH_KNIFE = [{ baseId: id(KNIFE), count: 1 }];
function at(n) { return [2040 + 30 * n, 0, 0]; }
const BRENNA = w.person(0xff001400, { profileId: 1000, name: 'Brenna', prof: 'smith', cell: CITY, pos: at(0), inventory: pack(WITH_KNIFE) });
const WYNN = w.person(0xff001401, { profileId: 1002, name: 'Wynn', prof: 'enchanter', half: 'bladebinder', cell: CITY, pos: at(1), inventory: pack(WITH_KNIFE) });
const ULFR = w.person(0xff001402, { profileId: 1004, name: 'Ulfr', prof: 'enchanter', half: 'wardweaver', cell: CITY, pos: at(2), inventory: pack(WITH_KNIFE) });
const SIGRID = w.person(0xff001403, { profileId: 1006, name: 'Sigrid', prof: 'enchanter', half: 'wardweaver', rank: 'master', cell: CITY, pos: at(3), inventory: pack(WITH_KNIFE) });
const TOVA = w.person(0xff001404, { profileId: 1008, name: 'Tova', prof: 'enchanter', half: 'bladebinder', cell: CITY, pos: at(4), inventory: pack() });
const EVERYONE = [BRENNA, WYNN, ULFR, SIGRID, TOVA];
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
let piece = 0xff000b00;
/* One enchantment: the enchanted piece a client makes is a new runtime form each time. */
function enchant(a, what, gem, effects) {
  piece++;
  return w.craft(a, TABLE, { output: piece, count: 1, recipe: 0, effects: effects.map(id),
    inputs: [{ baseId: id(what), count: 1 }, { baseId: id(gem), count: 1 }] });
}
/* A refusal leaves the pack as it was and makes nothing. */
function refused(r, a, before) { return !r.made && show(a) === before; }

// ------------------------------------------------------------ A. not hers --
w.activate(TABLE, BRENNA);
let before = show(BRENNA);
const a1 = enchant(BRENNA, SWORD, PETTY, [FIRE_DAMAGE]);
yes('A1 Brenna, no Enchanter, is refused the bench and nothing is taken (' + last(BRENNA) + ')',
  refused(a1, BRENNA, before) && /^Only an Enchanter can work this bench\./.test(last(BRENNA)));
w.activate(TABLE, BRENNA);

// ------------------------------------------------- B. a first enchantment --
w.activate(TABLE, WYNN);
let was = work(WYNN, 'bladebinder');
const b1 = enchant(WYNN, SWORD, PETTY, [FIRE_DAMAGE]);
yes('B1 Wynn puts Fire Damage on an iron sword with a petty gem: the enchanted sword in her pack, the sword and the gem gone (' + JSON.stringify(b1) + ')',
  b1.made && w.count(WYNN, piece) === 1 && w.count(WYNN, id(SWORD)) === 3 && w.count(WYNN, id(PETTY)) === 3);
yes('B1 one piece of Bladebinder work (' + was + ' -> ' + work(WYNN, 'bladebinder') + ')', work(WYNN, 'bladebinder') === was + 1);

// ---------------------------------------------------------- C. above her --
before = show(WYNN);
const c1 = enchant(WYNN, SWORD, PETTY, [ABSORB_HEALTH]);
yes('C1 Absorb Health is advanced: refused, naming the rank, nothing taken (' + last(WYNN) + ')',
  refused(c1, WYNN, before) && /Absorb Health/.test(last(WYNN)) && /Advanced/.test(last(WYNN)));

// ------------------------------------------------------- D. a sister half --
was = work(WYNN, 'wardweaver');
const d1 = enchant(WYNN, ARMOR, PETTY, [FORTIFY_HEALTH]);
yes('D1 Fortify Health on armour is her sister half\'s novice list: it goes through (' + JSON.stringify(d1) + ')',
  d1.made && w.count(WYNN, piece) === 1 && w.count(WYNN, id(ARMOR)) === 3);
yes('D1 and counts for Wardweaver (' + was + ' -> ' + work(WYNN, 'wardweaver') + ')', work(WYNN, 'wardweaver') === was + 1);
before = show(WYNN);
const d2 = enchant(WYNN, ARMOR, PETTY, [RESIST_FIRE]);
yes('D2 Resist Fire is that half past novice: refused, naming the sister half, nothing taken (' + last(WYNN) + ')',
  refused(d2, WYNN, before) && /Resist Fire is Wardweaver work past novice, and Wardweaver is your sister half\./.test(last(WYNN)));

// ------------------------------------------------------------ E. the gem --
before = show(WYNN);
const e1 = enchant(WYNN, SWORD, LESSER, [FIRE_DAMAGE]);
yes('E1 a lesser gem is advanced Bladebinder\'s work: refused, the gem and the piece left in her pack (' + last(WYNN) + ')',
  refused(e1, WYNN, before) &&
  last(WYNN) === 'A lesser soul gem is an Advanced Bladebinder\'s work and you are a Novice Bladebinder. A petty gem works at any rank. The gem and the piece stay in your pack.');

// ---------------------------------------------------------- F. off the list --
before = show(WYNN);
const f1 = enchant(WYNN, SWORD, PETTY, [FORTIFY_SMITHING]);
yes('F1 Fortify Smithing is on neither list: refused as off the enchantments list, nothing taken (' + last(WYNN) + ')',
  refused(f1, WYNN, before) &&
  last(WYNN) === 'An arcane enchanter here puts on only what the enchantments list names, and that enchantment is not on it.');
w.activate(TABLE, WYNN);

// ------------------------------------------------------------ G. Twin Souls --
yes('G1 Ulfr is handed one enchantment slot and Sigrid, at Master, two (' + w.prop(ULFR, 'thornswoodEnchantSlots') + ', ' +
  w.prop(SIGRID, 'thornswoodEnchantSlots') + ')',
  w.prop(ULFR, 'thornswoodEnchantSlots') === 1 && w.prop(SIGRID, 'thornswoodEnchantSlots') === 2);
w.activate(TABLE, ULFR);
before = show(ULFR);
const g2 = enchant(ULFR, ARMOR, PETTY, [FORTIFY_HEALTH, FORTIFY_STAMINA]);
yes('G2 two enchantments on one piece is refused for Ulfr: Twin Souls is a master\'s (' + last(ULFR) + ')',
  refused(g2, ULFR, before) && /^Two enchantments on one piece is Twin Souls/.test(last(ULFR)));
w.activate(TABLE, ULFR);
w.activate(TABLE, SIGRID);
was = work(SIGRID, 'wardweaver');
const g3 = enchant(SIGRID, ARMOR, PETTY, [FORTIFY_HEALTH, FORTIFY_STAMINA]);
yes('G3 and goes through for Sigrid, one piece of work (' + JSON.stringify(g3) + ', ' + was + ' -> ' + work(SIGRID, 'wardweaver') + ')',
  g3.made && w.count(SIGRID, piece) === 1 && w.count(SIGRID, id(ARMOR)) === 3 && work(SIGRID, 'wardweaver') === was + 1);
before = show(SIGRID);
const g4 = enchant(SIGRID, ARMOR, PETTY, [FORTIFY_HEALTH, FORTIFY_STAMINA, FORTIFY_MAGICKA]);
yes('G4 three is refused even for her (' + last(SIGRID) + ')',
  refused(g4, SIGRID, before) && last(SIGRID) === 'No piece here holds more than 2 enchantments.');
w.activate(TABLE, SIGRID);

// ------------------------------------------------------------ H. no knife --
w.activate(TABLE, TOVA);
before = show(TOVA);
const h1 = enchant(TOVA, SWORD, PETTY, [FIRE_DAMAGE]);
yes('H1 Tova has no rune knife: refused, told who makes one, nothing taken (' + last(TOVA) + ')',
  refused(h1, TOVA, before) && last(TOVA) === 'You need a rune knife in your pack for that. A smith forges them.');
w.activate(TABLE, TOVA);

t.done(w);
