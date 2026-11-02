'use strict';
/*
  test-scenario-gold.js

  Scenario: systems/gold.md

  #5198. Where coin comes from and what sits loses: the WHOLE of
  game/gamemode.js over the stand-in server (tests/stand-in-server.js), every
  step a message the engine sends in the order it sends them. A login is the
  launcher's pass and onThornswoodLogin; a press on a door, a chest or a bench
  is onActivate; putting a piece in a chest is onPutItem. Time is the
  stand-in's clock running the gamemode's own timers.

  Brenna is a smith with no coin, in Windhelm. Corvin already has 12 gold.
  Neither has been handed the purse yet: characters made before it existed,
  which it reaches on purpose.

    A  The first purse: each of them is handed 40 gold, once, the first time
       they are in the world, on top of what they carry.
    B  Not again: a second login, a death and a restart pay nothing more.
    C  The Dull: Brenna claims Jorn's Home and puts an iron sword and a piece
       of iron armour at 90% in a chest inside it, opening it first. Two real
       days on, opening it takes 5% a day off each piece. Opening it again
       the same day takes nothing more.
    D  A pack does not dull: the sword she kept is as it was. A chest out in
       the street, in no held building, does not dull either.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  Dungeon chest and body coin are Dungeon loot's scenario; trade between two
  people is Trade's; the fees and payouts on ledgers are in the notice
  boards and offices scenarios.

  Read only, apart from its temp folders, which it removes.

      node tests\test-scenario-gold.js
*/
const standIn = require('./stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const w = standIn.world({ name: 'gold' });
const WINDHELM = '3c:Skyrim.esm';
const FRONT = w.idOf('11aeda:WindhelmSSE.esp');   // the front door of Jorn's Home, a way in
const HOUSE = '115c21:WindhelmSSE.esp';            // Jorn's Home, the room behind it
function bod2(slots, kind) { return { type: 'BOD2', data: [slots & 255, (slots >> 8) & 255, (slots >> 16) & 255, (slots >>> 24) & 255, kind, 0, 0, 0] }; }
const SWORD = '12eb7:Skyrim.esm', ARMOR = '12e49:Skyrim.esm';
const DOOR_BASE = '1a6f4:Skyrim.esm', CHEST_BASE = '1a6f3:Skyrim.esm';
w.record(SWORD, 'WEAP', { editorId: 'IronSword', fields: [{ type: 'DNAM', data: [1, 0, 0, 0] }] });
w.record(ARMOR, 'ARMO', { fields: [bod2(1 << 2, 1)] });
w.record(DOOR_BASE, 'DOOR');
w.record(CHEST_BASE, 'CONT');
w.record('15493:Thornswood-Content.esp', 'BOOK');
const STREET = [130000, -9000, 9000];
function at(dx, dy) { return [STREET[0] + dx, STREET[1] + dy, STREET[2]]; }
w.ref(FRONT, { base: DOOR_BASE, cell: WINDHELM, pos: at(0, 0) });
const CHEST = w.ref(0xff200060, { base: CHEST_BASE, cell: HOUSE, pos: [0, 0, 0] });
const STREET_CHEST = w.ref(0xff200061, { base: CHEST_BASE, cell: WINDHELM, pos: at(-200, 0) });
const id = w.idOf;

const BRENNA = w.person(0xff001000, { profileId: 1000, name: 'Brenna', prof: 'smith', town: 'windhelm', cell: WINDHELM, pos: at(60, 0),
  inventory: { entries: [{ baseId: id(SWORD), count: 3 }, { baseId: id(ARMOR), count: 1, name: 'Iron Armor (90%)' }] }, thornswoodPurse: 0 });
const CORVIN = w.person(0xff001001, { profileId: 1002, name: 'Corvin', prof: 'tailor', town: 'windhelm', cell: WINDHELM, pos: at(80, 80),
  inventory: { entries: [{ baseId: 0xf, count: 12 }] }, thornswoodPurse: 0 });

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function gold(a) { return w.count(a, 0xf); }
function named(ref, name) {
  return (w.row(ref).inventory.entries || []).filter(function (e) { return (e.name || '') === name; })
    .reduce(function (n, e) { return n + e.count; }, 0);
}
function show(ref) {
  return JSON.stringify((w.row(ref).inventory.entries || []).filter(function (e) { return e.count > 0; })
    .map(function (e) { return (e.name || e.baseId.toString(16)) + ' x' + e.count; }));
}
const DAY = 24 * 60 * 60000;

// ----------------------------------------------------------- A. the purse --
[BRENNA, CORVIN].forEach(w.arrive);
w.run(30000);
yes('A1 Brenna, with no coin, is handed 40 gold the first time she is in the world (' + gold(BRENNA) + ')', gold(BRENNA) === 40);
yes('A1 and Corvin 40 on top of the 12 he carried (' + gold(CORVIN) + ')', gold(CORVIN) === 52);

// --------------------------------------------------------------- B. once --
w.leave(BRENNA);
w.run(60000);
w.arrive(BRENNA);
w.run(30000);
yes('B1 a second login pays nothing more (' + gold(BRENNA) + ')', gold(BRENNA) === 40);
w.die(CORVIN, 0);
w.run(30000);
yes('B2 a death pays nothing more (' + gold(CORVIN) + ', ' + (w.row(CORVIN).isDead ? 'down' : 'up') + ')', !w.row(CORVIN).isDead && gold(CORVIN) === 52);
const r = w.restart();
yes('B3 the server restarts', r.loaded);
[BRENNA, CORVIN].forEach(w.arrive);
w.run(30000);
yes('B3 and a restart pays nothing more (' + gold(BRENNA) + ', ' + gold(CORVIN) + ')', gold(BRENNA) === 40 && gold(CORVIN) === 52);

// ------------------------------------------------------------- C. the Dull --
w.activate(FRONT, BRENNA);
w.say(BRENNA, '/claim');
w.run(300);
yes('C1 Brenna claims Jorn\'s Home (' + last(BRENNA) + ')', /^You claim Jorn's Home\./.test(last(BRENNA)));
w.moveTo(BRENNA, HOUSE, [40, 0, 0]);
w.run(500);
w.activate(CHEST, BRENNA);
const c1 = w.put(CHEST, BRENNA, id(SWORD), 1);
const c2 = w.put(CHEST, BRENNA, id(ARMOR), 1, 'Iron Armor (90%)');
w.activate(CHEST, BRENNA);
w.moveTo(BRENNA, WINDHELM, at(-180, 0));
w.run(500);
w.activate(STREET_CHEST, BRENNA);
const c3 = w.put(STREET_CHEST, BRENNA, id(SWORD), 1);
w.activate(STREET_CHEST, BRENNA);
yes('C2 a sword and the armour at 90% go in the chest in her house, and a sword in one out in the street (' + show(CHEST) + ', ' + show(STREET_CHEST) + ')',
  c1.moved && c2.moved && c3.moved && w.count(CHEST, id(SWORD)) === 1 && named(CHEST, 'Iron Armor (90%)') === 1 && w.count(STREET_CHEST, id(SWORD)) === 1);
const putAt = w.now();
[BRENNA, CORVIN].forEach(w.leave);
w.run(2 * DAY + 60000 - (w.now() - putAt));
w.arrive(BRENNA);
w.run(30000);
w.moveTo(BRENNA, HOUSE, [40, 0, 0]);
w.run(500);
w.activate(CHEST, BRENNA);
w.run(300);
yes('C3 two real days on, opening it takes 5% a day off each piece (' + show(CHEST) + ')',
  named(CHEST, 'Iron Sword (90%)') === 1 && named(CHEST, 'Iron Armor (80%)') === 1);
w.activate(CHEST, BRENNA);
w.activate(CHEST, BRENNA);
w.run(300);
yes('C4 opening it again the same day takes nothing more (' + show(CHEST) + ')',
  named(CHEST, 'Iron Sword (90%)') === 1 && named(CHEST, 'Iron Armor (80%)') === 1);
w.activate(CHEST, BRENNA);

// ---------------------------------------------------- D. what does not dull --
yes('D1 a pack does not dull: the swords she kept are as they were (' + show(BRENNA) + ')', named(BRENNA, '') >= 1 &&
  (w.row(BRENNA).inventory.entries || []).filter(function (e) { return e.baseId === id(SWORD) && e.count > 0; }).every(function (e) { return !e.name; }) &&
  w.count(BRENNA, id(SWORD)) === 1);
w.moveTo(BRENNA, WINDHELM, at(-180, 0));
w.run(500);
w.activate(STREET_CHEST, BRENNA);
w.run(300);
yes('D2 a chest in the street, in no held building, does not dull (' + show(STREET_CHEST) + ')',
  w.count(STREET_CHEST, id(SWORD)) === 1 && !(w.row(STREET_CHEST).inventory.entries || []).some(function (e) { return e.name; }));
w.activate(STREET_CHEST, BRENNA);

t.done(w);
