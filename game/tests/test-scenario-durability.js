'use strict';
/*
  test-scenario-durability.js

  Scenario: systems/durability.md

  #5198. Condition, wear and repair kits, end to end: the WHOLE of
  game/gamemode.js over the stand-in server (tests/stand-in-server.js), every
  step a message the engine sends in the order it sends them. A hit is
  ActionListener::OnWeaponHit: onPapyrusEvent:OnHit to the target with the
  aggressor, the weapon and the blocked flag. What is worn is the equipment
  record the client sends when something goes on, set here as the client
  would have left it. The repair panel's key and buttons send /repair; a
  press on a bench is onActivate. The condition is on the piece's name.

  Brenna is a novice Platewright in iron armour with an iron shield and a
  sword. Corvin is a novice Edgewright with a sword. Dagny is a novice
  Haberdasher in a belted tunic with a sword and no shield. Eirik wears an iron
  helmet at 0% and carries a second one, at 0% too. Fenna is a Platewright
  at Master.

    A  Corvin hits Brenna: her armour and her shield lose 1% each, and so does
       the sword he landed it with. Her own sword, in her hand, does not: a
       weapon is not worn down when its holder is hit.
    B  Dagny blocks a hit with no shield: her clothes and the sword that
       blocked it lose 1%. Brenna blocks one with her shield: the shield and
       armour lose it, and her sword still does not.
    C  At 0%: a hit on a roll of 50% leaves Eirik's helmet on at 0%; a hit on
       a roll of 5%, under the 10%, breaks it, it is gone and he is told.
       The 0% helmet in his pack, not worn, is untouched.
    D  The repair panel: Brenna's key draws it, her armour worst first. She
       has no Weapon Kit for her sword and is told who makes one. Her Armor
       Kit mends her armour to 100%, a novice's number, and is used up.
       Fenna, at Master, mends a piece to 120%. Dagny, a Haberdasher of any
       rank, mends her clothes to 120% with a Sewing Kit. Corvin, a novice,
       mends his sword to 100%, and a repair that would not raise a piece is
       refused with nothing used.
    E  The sharpening wheel and the armour table do not open, for anybody,
       and say a piece is mended with a kit.
    F  The server restarts: every condition is on its piece where it was.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  The 5% a real day in a held building's chest is the Dull rule, gold.md's,
  and runs in that system's scenario.

  Read only, apart from its temp folders, which it removes.

      node game\tests\test-scenario-durability.js
*/
const standIn = require('../../tests/stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const w = standIn.world({ name: 'durability' });
const CITY = '1691d:Skyrim.esm';                     // Windhelm
function bod2(slots, kind) { return { type: 'BOD2', data: [slots & 255, (slots >> 8) & 255, (slots >> 16) & 255, (slots >>> 24) & 255, kind, 0, 0, 0] }; }
const SWORD = '12eb7:Skyrim.esm', ARMOR = '12e49:Skyrim.esm', SHIELD = '12eb6:Skyrim.esm', HELMET = '12e4d:Skyrim.esm', CLOTHES = '1be1a:Skyrim.esm';
w.record(SWORD, 'WEAP', { editorId: 'IronSword', fields: [{ type: 'DNAM', data: [1, 0, 0, 0] }] });
w.record(ARMOR, 'ARMO', { fields: [bod2(1 << 2, 1)] });       // body, heavy armour
w.record(SHIELD, 'ARMO', { fields: [bod2(1 << 9, 1)] });      // the shield slot, heavy armour
w.record(HELMET, 'ARMO', { fields: [bod2(1 << 1, 1)] });      // the head, heavy armour
w.record(CLOTHES, 'ARMO', { fields: [bod2(1 << 2, 2)] });     // body, clothing
const WEAPON_KIT = '154b0:Thornswood-Content.esp', ARMOR_KIT = '154b1:Thornswood-Content.esp', SEWING_KIT = '154b2:Thornswood-Content.esp';
[WEAPON_KIT, ARMOR_KIT, SEWING_KIT].forEach(function (d) { w.record(d, 'MISC'); });
const WHEEL_BASE = '6e9c2:Skyrim.esm', TABLE_BASE = 'd932f:Skyrim.esm';   // the sharpening wheel and the armour table, by BENCH_BY_BASE
w.record(WHEEL_BASE, 'FURN');
w.record(TABLE_BASE, 'FURN');
const id = w.idOf;
const WHEEL = w.ref(0xff200050, { base: WHEEL_BASE, cell: CITY, pos: [2300, 0, 0] });
const TABLE = w.ref(0xff200051, { base: TABLE_BASE, cell: CITY, pos: [2300, 200, 0] });

/* A piece in the pack and on the body: the pack's entry flagged worn, and the equipment record naming it. */
function wearing(list) { return list.map(function (x) { return Object.assign({ baseId: id(x[0]), count: 1, worn: true }, x[1] ? { name: x[1] } : {}); }); }
function at(n) { return [2000 + 40 * n, 0, 0]; }
function dressed(profileId, name, rank, half, prof, worn, carried) {
  const entries = wearing(worn).concat(carried || []);
  const row = { profileId: profileId, name: name, prof: prof, half: half, rank: rank, cell: CITY, pos: at(profileId - 1000),
    inventory: { entries: entries } };
  return row;
}
const BRENNA = w.person(0xff000f00, dressed(1000, 'Brenna', 'novice', 'platewright', 'smith', [[ARMOR], [SHIELD], [SWORD]],
  [{ baseId: id(ARMOR_KIT), count: 1 }]));
const CORVIN = w.person(0xff000f01, dressed(1002, 'Corvin', 'novice', 'edgewright', 'smith', [[SWORD]],
  [{ baseId: id(WEAPON_KIT), count: 2 }]));
const DAGNY = w.person(0xff000f02, dressed(1004, 'Dagny', 'novice', 'haberdasher', 'tailor', [[CLOTHES], [SWORD]],
  [{ baseId: id(SEWING_KIT), count: 1 }]));
const EIRIK = w.person(0xff000f03, dressed(1006, 'Eirik', 'novice', 'edgewright', 'smith', [[HELMET, 'Iron Helmet (0%)']],
  [{ baseId: id(HELMET), count: 1, name: 'Iron Helmet (0%)' }]));
const FENNA = w.person(0xff000f04, dressed(1008, 'Fenna', 'master', 'platewright', 'smith', [[ARMOR, 'Iron Armor (90%)']],
  [{ baseId: id(ARMOR_KIT), count: 1 }]));
const EVERYONE = [BRENNA, CORVIN, DAGNY, EIRIK, FENNA];
EVERYONE.forEach(function (a) {
  w.row(a).equipment = { inv: { entries: w.row(a).inventory.entries.filter(function (e) { return e.worn; })
    .map(function (e) { return Object.assign({}, e); }) } };
});

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
EVERYONE.forEach(w.arrive);
w.run(30000);

function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function say(a, text) { w.say(a, text); w.run(300); return last(a); }
/* What a pack holds, by name, plain ones by their record and worn ones marked. */
function held(a) {
  const n = {};
  w.row(a).inventory.entries.forEach(function (e) {
    if (!(e.count > 0)) { return; }
    const k = (e.name || ('plain ' + e.baseId.toString(16))) + (e.worn ? ' worn' : '');
    n[k] = (n[k] || 0) + e.count;
  });
  return n;
}
function has(a, k) { return held(a)[k] || 0; }
function show(a) { return JSON.stringify(held(a)); }
const plainSword = 'plain ' + id(SWORD).toString(16) + ' worn';
let answer = '';

// ----------------------------------------------------------------- A. wear --
w.hit(BRENNA, CORVIN, SWORD, { damage: 5 });
w.run(300);
yes('A1 Corvin hits Brenna: her armour and her shield lose 1% each (' + show(BRENNA) + ')',
  has(BRENNA, 'Iron Armor (99%) worn') === 1 && has(BRENNA, 'Iron Shield (99%) worn') === 1);
yes('A1 and so does the sword he landed it with (' + show(CORVIN) + ')', has(CORVIN, 'Iron Sword (99%) worn') === 1);
yes('A2 her own sword, in her hand, does not', has(BRENNA, plainSword) === 1);

// ---------------------------------------------------------------- B. block --
w.hit(DAGNY, CORVIN, SWORD, { blocked: true, damage: 1 });
w.run(300);
yes('B1 Dagny blocks with no shield: her clothes and the sword that blocked lose 1% (' + show(DAGNY) + ')',
  has(DAGNY, 'Belted Tunic (99%) worn') === 1 && has(DAGNY, 'Iron Sword (99%) worn') === 1);
w.hit(BRENNA, CORVIN, SWORD, { blocked: true, damage: 1 });
w.run(300);
yes('B2 Brenna blocks with her shield: the shield and armour lose it, and her sword still does not (' + show(BRENNA) + ')',
  has(BRENNA, 'Iron Armor (98%) worn') === 1 && has(BRENNA, 'Iron Shield (98%) worn') === 1 && has(BRENNA, plainSword) === 1);
yes('B2 the equipment record follows the names, so what is worn stays worn (' + JSON.stringify(w.row(BRENNA).equipment.inv.entries.map(function (e) { return e.name || ''; })) + ')',
  w.row(BRENNA).equipment.inv.entries.some(function (e) { return e.name === 'Iron Armor (98%)' && e.worn; }));

// -------------------------------------------------------------- C. at 0% --
w.dice(0.5);
w.hit(EIRIK, CORVIN, SWORD, { damage: 1 });
w.run(300);
w.dice(null);
yes('C1 a hit on a roll of 50% leaves Eirik\'s helmet on at 0% (' + show(EIRIK) + ')', has(EIRIK, 'Iron Helmet (0%) worn') === 1);
w.dice(0.05);
w.hit(EIRIK, CORVIN, SWORD, { damage: 1 });
w.run(300);
w.dice(null);
yes('C2 a hit on a roll of 5% breaks it: it is gone, and he is told (' + last(EIRIK) + ', ' + show(EIRIK) + ')',
  !has(EIRIK, 'Iron Helmet (0%) worn') && last(EIRIK) === 'Your Iron Helmet broke. It was at 0%, and a kit would have mended it.');
yes('C3 the 0% helmet in his pack, not worn, is untouched', has(EIRIK, 'Iron Helmet (0%)') === 1);

// ------------------------------------------------------- D. the repair panel --
say(BRENNA, '/repair');
const view = w.prop(BRENNA, 'thornswoodRepairView') || {};
yes('D1 Brenna\'s key draws the panel: her armour and shield at 98%, a repair by her to 100% (' + JSON.stringify(view.rows) + ')',
  view.open === true && (view.rows || []).length === 2 && view.rows.every(function (r) { return r.cond === 98 && r.to === 100 && r.can; }) &&
  view.kits.some(function (k) { return k.name === 'Armor Kit' && k.count === 1; }));
w.hit(BRENNA, DAGNY, SWORD, { blocked: true, damage: 1 });   // Dagny's sword at 99% lands it; Brenna's shield is up
w.hit(CORVIN, BRENNA, SWORD, { damage: 1 });                 // and Brenna's sword lands one: it is 99% now
w.run(300);
answer = say(BRENNA, '/repair mend ' + id(SWORD).toString(16) + ' 99 Iron Sword');
yes('D2 she has no Weapon Kit for her sword, and is told who makes one (' + answer + ')',
  answer === 'Your Iron Sword is mended with a Weapon Kit, and you have none. An Edgewright makes them.' && has(BRENNA, 'Iron Sword (99%) worn') === 1);
answer = say(BRENNA, '/repair mend ' + id(ARMOR).toString(16) + ' 97 Iron Armor');
yes('D3 her Armor Kit mends her armour to 100%, a novice\'s number, and is used up (' + answer + ', ' + show(BRENNA) + ')',
  answer === 'Your Iron Armor is at 100% now. The Armor Kit is used up.' && has(BRENNA, 'plain ' + id(ARMOR).toString(16) + ' worn') === 1 &&
  w.count(BRENNA, id(ARMOR_KIT)) === 0);
answer = say(FENNA, '/repair mend ' + id(ARMOR).toString(16) + ' 90 Iron Armor');
yes('D4 Fenna, a Platewright at Master, mends hers to 120% (' + answer + ')',
  answer === 'Your Iron Armor is at 120% now. The Armor Kit is used up.' && has(FENNA, 'Iron Armor (120%) worn') === 1);
answer = say(DAGNY, '/repair mend ' + id(CLOTHES).toString(16) + ' 99 Belted Tunic');
yes('D5 Dagny, a novice Haberdasher, mends her clothes to 120% with a Sewing Kit (' + answer + ')',
  answer === 'Your Belted Tunic is at 120% now. The Sewing Kit is used up.' && has(DAGNY, 'Belted Tunic (120%) worn') === 1);
const corvinSword = Object.keys(held(CORVIN)).filter(function (k) { return /^Iron Sword \(\d+%\) worn$/.test(k); })[0] || '';
const corvinCond = Number((/\((\d+)%\)/.exec(corvinSword) || [])[1]);
answer = say(CORVIN, '/repair mend ' + id(SWORD).toString(16) + ' ' + corvinCond + ' Iron Sword');
yes('D6 Corvin, a novice Edgewright, mends his sword from ' + corvinCond + '% to 100% (' + answer + ')',
  answer === 'Your Iron Sword is at 100% now. The Weapon Kit is used up.' && has(CORVIN, plainSword) === 1 && w.count(CORVIN, id(WEAPON_KIT)) === 1);
answer = say(CORVIN, '/repair mend ' + id(SWORD).toString(16) + ' 100 Iron Sword');
yes('D7 a repair that would not raise it is refused, and nothing is used (' + answer + ')',
  answer === 'Your Iron Sword is at 100%. A repair by you would not raise it.' && w.count(CORVIN, id(WEAPON_KIT)) === 1);

// ------------------------------------------------------------ E. the benches --
const e1 = w.activate(WHEEL, BRENNA);
answer = last(BRENNA);
const e2 = w.activate(TABLE, FENNA);
yes('E1 the sharpening wheel and the armour table do not open, and say a piece is mended with a kit (' + answer + ', ' + last(FENNA) + ')',
  !e1.opened && !e2.opened && /^Tempering is not done here\. A piece is mended with a repair kit/.test(answer) &&
  /^Tempering is not done here\. A piece is mended with a repair kit/.test(last(FENNA)));

// ------------------------------------------------------------- F. restart --
const before = EVERYONE.map(show);
const r = w.restart();
yes('F1 the server comes back up', r.loaded);
EVERYONE.forEach(w.arrive);
w.run(30000);
yes('F2 every condition is on its piece where it was', JSON.stringify(EVERYONE.map(show)) === JSON.stringify(before));

t.done(w);
