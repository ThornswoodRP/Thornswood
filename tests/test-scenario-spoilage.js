'use strict';
/*
  test-scenario-spoilage.js

  Scenario: systems/spoilage.md

  #5198. Food spoiling, end to end: the WHOLE of game/gamemode.js over the
  stand-in server (tests/stand-in-server.js), every step a message the engine
  sends in the order it sends them. A pack is looked at by the gamemode's own
  minute pass while its owner is online; a chest is a press (onActivate)
  before the engine sends what is in it, and putting food in is onPutItem;
  the preserving panel's buttons send /preserve; eating is onEatItem. Time is
  the stand-in's clock running the gamemode's own timers.

  Brenna is a Hearthcook with raw Mammoth Snout, two Salt Piles and a
  Firewood. Corvin is a tailor with plain snout and one piece bought with a
  day left. They are in Windhelm, and Brenna has a chest there and one in a
  room of Winterhold.

    A  Plain food has no days on it until the server first looks: within a
       pass every plain snout reads "Mammoth Snout (7 days left)", and the
       piece Corvin bought keeps its "(1 day left)".
    B  Preserving: Corvin is told it is a cook's work and nothing is used.
       Brenna's inventory shows the key's line. Salt: two snouts salted, a
       Salt Pile each. Smoke with no fire is refused, nothing used; at a fire
       one Firewood smokes five. The rest of the stack is left as it was.
    C  Brenna puts a snout in each chest, opening each first, and Corvin puts
       his day-left piece in the Windhelm chest.
    D  Corvin logs out. A day of Brenna's play: a day comes off her fresh
       snout, and the salted and smoked ones are as they were.
    E  Corvin comes back after the day away: nothing in his pack has moved.
       A day of his play: his bought piece goes off and stays in his pack as
       "Mammoth Snout (spoiled)", he is told what went off, and his fresh
       ones have a day fewer.
    F  The chests, two real days on: the Windhelm chest takes both days off
       the snout in it, and the opener is told Corvin's piece went off. The
       Winterhold chest is cold storage: its snout still has its 7 days, and
       opening it again takes nothing more.
    G  Eating spoiled food fills nothing and starts food sickness on any roll.
       (A fresh snout goes down first, so there is hunger to see not rise.)
    H  The server restarts: the days, the preserving and the spoiled food are
       on the names where they were.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  Read only, apart from its temp folders, which it removes.

      node tests\test-scenario-spoilage.js
*/
const standIn = require('./stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const DATA = require('../game/gamemode-tables/DATA.json');
const w = standIn.world({ name: 'spoilage' });
const CITY = '1691d:Skyrim.esm';                     // Windhelm
const WINTERHOLD_ROOM = Object.keys(DATA.cellToHold).find(function (c) { return DATA.cellToHold[c] === 'WinterholdHoldLocation'; });
const RAW = '10211a:Skyrim.esm';                     // Mammoth Snout, raw: 7 days
const SPOILED = '19100:Thornswood-Content.esp';      // Spoiled Food
const SALT = '34cdf:Skyrim.esm';                     // Salt Pile
const WOOD = '6f993:Skyrim.esm';                     // Firewood
const CHEST_BASE = '1a6f3:Skyrim.esm';
[RAW, SPOILED].forEach(function (d) { w.record(d, 'ALCH'); });
w.record(SALT, 'INGR');
w.record(WOOD, 'MISC');
w.record(CHEST_BASE, 'CONT');
const id = w.idOf;
const CHEST = w.ref(0xff200040, { base: CHEST_BASE, cell: CITY, pos: [2000, 100, 0] });
const COLD_CHEST = w.ref(0xff200041, { base: CHEST_BASE, cell: WINTERHOLD_ROOM, pos: [100, 0, 0] });
const SNOUT = 'Mammoth Snout';
function left(n) { return SNOUT + ' (' + (n === 1 ? '1 day' : n + ' days') + ' left)'; }

const BRENNA = w.person(0xff000e00, { profileId: 1000, name: 'Brenna', prof: 'cook', half: 'hearthcook', cell: CITY, pos: [2000, 0, 0],
  inventory: { entries: [{ baseId: id(RAW), count: 10 }, { baseId: id(SALT), count: 2 }, { baseId: id(WOOD), count: 1 }] } });
const CORVIN = w.person(0xff000e01, { profileId: 1002, name: 'Corvin', prof: 'tailor', cell: CITY, pos: [2040, 0, 0],
  inventory: { entries: [{ baseId: id(RAW), count: 2 }, { baseId: id(RAW), count: 2, name: left(1) }, { baseId: id(SALT), count: 1 }] } });
w.row(CORVIN).thornswoodNeeds = { food: 60, drink: 90, rest: 95, temp: 50, at: w.now() };

yes('P0 a room of Winterhold, where a chest is cold storage, is in the load order\'s rooms', !!WINTERHOLD_ROOM);
yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
[BRENNA, CORVIN].forEach(w.arrive);
[BRENNA, CORVIN].forEach(function (a) { w.say(a, '/place indoors - 0 1 0 -'); });

function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function say(a, text) { w.say(a, text); w.run(300); return last(a); }
/* What is in a pack or a chest, by name, plain ones by their record. */
function held(ref) {
  const n = {};
  (w.row(ref).inventory || { entries: [] }).entries.forEach(function (e) {
    if (!(e.count > 0)) { return; }
    const k = e.name || ('plain ' + e.baseId.toString(16));
    n[k] = (n[k] || 0) + e.count;
  });
  return n;
}
function has(ref, name) { return held(ref)[name] || 0; }
function show(ref) { return JSON.stringify(held(ref)); }
const MIN = 60000, DAY = 24 * 60 * MIN;
let answer = '', heardAt = 0;

// --------------------------------------------------------------- A. named --
w.run(70000);
yes('A1 within a pass every plain snout reads "' + left(7) + '" (' + show(BRENNA) + ')',
  has(BRENNA, left(7)) === 10 && !has(BRENNA, 'plain ' + id(RAW).toString(16)));
yes('A1 and the piece Corvin bought keeps its day (' + show(CORVIN) + ')', has(CORVIN, left(7)) === 2 && has(CORVIN, left(1)) === 2);

// ----------------------------------------------------------- B. preserving --
const corvinWas = show(CORVIN);
answer = say(CORVIN, '/preserve salt ' + id(RAW).toString(16) + ' 7 ' + SNOUT);
yes('B1 Corvin is told preserving is a cook\'s work, and nothing is used (' + answer + ')',
  /^Salting and smoking food is a cook's work\./.test(answer) && show(CORVIN) === corvinWas);
yes('B2 Brenna\'s inventory shows the key\'s line', !!w.prop(BRENNA, 'thornswoodPreserveLine') && w.prop(BRENNA, 'thornswoodPreserveLine').on === true);
say(BRENNA, '/preserve');
const view = w.prop(BRENNA, 'thornswoodPreserveView') || {};
yes('B2 the key draws the panel: her snout, 7 days, with her salt and wood (' + JSON.stringify(view.rows) + ')',
  view.may === true && view.salt === 2 && view.wood === 1 && (view.rows || []).length === 1 && view.rows[0].left === 7 && view.rows[0].count === 10);
answer = say(BRENNA, '/preserve salt ' + id(RAW).toString(16) + ' 7 ' + SNOUT);
yes('B3 Salt: two snouts salted, a Salt Pile each (' + answer + ', ' + show(BRENNA) + ')',
  answer === '2 of your Mammoth Snout are salted and will not spoil. You used 2 Salt Piles.' &&
  has(BRENNA, SNOUT + ' (salted)') === 2 && has(BRENNA, left(7)) === 8 && w.count(BRENNA, id(SALT)) === 0);
const brennaWas = show(BRENNA);
answer = say(BRENNA, '/preserve smoke ' + id(RAW).toString(16) + ' 7 ' + SNOUT);
yes('B4 smoking with no fire is refused and nothing is used (' + answer + ')',
  /^Smoking takes a lit fire\./.test(answer) && show(BRENNA) === brennaWas);
w.say(BRENNA, '/place indoors - 0 1 0 50');
w.run(1000);
answer = say(BRENNA, '/preserve smoke ' + id(RAW).toString(16) + ' 7 ' + SNOUT);
yes('B5 at a fire one Firewood smokes five, and the rest of the stack is left (' + answer + ', ' + show(BRENNA) + ')',
  answer === '5 of your Mammoth Snout are smoked and will not spoil. You used a Firewood.' &&
  has(BRENNA, SNOUT + ' (smoked)') === 5 && has(BRENNA, left(7)) === 3 && w.count(BRENNA, id(WOOD)) === 0);
w.say(BRENNA, '/place indoors - 0 1 0 -');

// --------------------------------------------------------------- C. chests --
const chestFrom = w.now();
w.activate(CHEST, BRENNA);
const c1 = w.put(CHEST, BRENNA, id(RAW), 1, left(7));
w.activate(CHEST, BRENNA);
w.activate(CHEST, CORVIN);
const c2 = w.put(CHEST, CORVIN, id(RAW), 1, left(1));
w.activate(CHEST, CORVIN);
w.moveTo(BRENNA, WINTERHOLD_ROOM, [60, 0, 0]);
w.run(500);
w.activate(COLD_CHEST, BRENNA);
const c3 = w.put(COLD_CHEST, BRENNA, id(RAW), 1, left(7));
w.activate(COLD_CHEST, BRENNA);
w.moveTo(BRENNA, CITY, [2000, 0, 0]);
yes('C1 a snout goes in each chest, and Corvin\'s day-left piece in the Windhelm one (' + show(CHEST) + ', ' + show(COLD_CHEST) + ')',
  c1.moved && c2.moved && c3.moved && has(CHEST, left(7)) === 1 && has(CHEST, left(1)) === 1 && has(COLD_CHEST, left(7)) === 1 &&
  has(BRENNA, left(7)) === 1 && has(CORVIN, left(1)) === 1);

// ------------------------------------------------------- D. a day of play --
w.leave(CORVIN);
const corvinAway = show(CORVIN);
w.run(DAY + 2 * MIN);
yes('D1 a day of Brenna\'s play takes a day off her fresh snout (' + show(BRENNA) + ')', has(BRENNA, left(6)) === 1 && !has(BRENNA, left(7)));
yes('D1 and her salted and smoked ones are as they were', has(BRENNA, SNOUT + ' (salted)') === 2 && has(BRENNA, SNOUT + ' (smoked)') === 5);
w.leave(BRENNA);

// ------------------------------------------------------------ E. Corvin's --
w.arrive(CORVIN);
w.run(3 * MIN);
yes('E1 Corvin back after his day away: nothing in his pack has moved (' + show(CORVIN) + ')', show(CORVIN) === corvinAway);
heardAt = w.heard(CORVIN).length;
w.run(DAY);
yes('E2 a day of his play: the bought piece goes off and stays in his pack as spoiled food (' + show(CORVIN) + ')',
  has(CORVIN, SNOUT + ' (spoiled)') === 1 && !has(CORVIN, left(1)) && w.count(CORVIN, id(SPOILED)) === 1);
yes('E2 he is told what went off (' + w.heardSince(CORVIN, heardAt).join(' | ') + ')',
  w.heardSince(CORVIN, heardAt).indexOf('Your Mammoth Snout went off.') >= 0);
yes('E2 and his fresh ones have a day fewer', has(CORVIN, left(6)) === 2);

// --------------------------------------------------------------- F. chests --
until(chestFrom + 2 * DAY + MIN);
w.arrive(BRENNA);
w.run(2000);
heardAt = w.heard(BRENNA).length;
w.activate(CHEST, BRENNA);
w.run(300);
yes('F1 two real days on, the Windhelm chest takes both days off its snout (' + show(CHEST) + ')',
  has(CHEST, left(5)) === 1 && has(CHEST, SNOUT + ' (spoiled)') === 1);
yes('F1 and the opener is told what went off in it (' + w.heardSince(BRENNA, heardAt).join(' | ') + ')',
  w.heardSince(BRENNA, heardAt).indexOf('The Mammoth Snout in this chest went off.') >= 0);
w.activate(CHEST, BRENNA);
w.moveTo(BRENNA, WINTERHOLD_ROOM, [60, 0, 0]);
w.run(500);
w.activate(COLD_CHEST, BRENNA);
w.run(300);
yes('F2 the Winterhold chest is cold storage: its snout still has its 7 days (' + show(COLD_CHEST) + ')', has(COLD_CHEST, left(7)) === 1);
w.activate(COLD_CHEST, BRENNA);
w.activate(COLD_CHEST, BRENNA);
w.run(300);
yes('F2 and opening it again takes nothing more', has(COLD_CHEST, left(7)) === 1);
w.activate(COLD_CHEST, BRENNA);
w.moveTo(BRENNA, CITY, [2000, 0, 0]);

// ------------------------------------------------------------- G. eating --
w.dice(0.99);
w.eat(CORVIN, id(RAW));   // a fresh snout first, so there is hunger to see not rise
w.run(9000);
const hungerWas = w.box().__thornswoodNeeds.view(CORVIN).food;
heardAt = w.heard(CORVIN).length;
w.eat(CORVIN, id(SPOILED));
w.run(300);
w.dice(null);
const ills = ((w.prop(CORVIN, 'thornswoodHurt') || {}).ills || []).map(function (i) { return i.k; });
yes('G1 eating spoiled food fills nothing (' + w.heardSince(CORVIN, heardAt).join(' | ') + ', ' + hungerWas + ' -> ' + w.box().__thornswoodNeeds.view(CORVIN).food + ')',
  w.heardSince(CORVIN, heardAt).some(function (l) { return /^It has gone off\. It fills nothing\./.test(l); }) &&
  hungerWas > 0 && w.box().__thornswoodNeeds.view(CORVIN).food <= hungerWas && w.count(CORVIN, id(SPOILED)) === 0);
yes('G1 and starts food sickness on a roll of 99% (' + ills.join() + ')', ills.join() === 'food');

// ------------------------------------------------------------ H. restart --
const before = { brenna: show(BRENNA), corvin: show(CORVIN), chest: show(CHEST) };
const r = w.restart();
yes('H1 the server comes back up', r.loaded);
[BRENNA, CORVIN].forEach(w.arrive);
w.run(70000);
yes('H2 the days, the preserving and the spoiled food are on the names where they were (' + show(BRENNA) + ')',
  show(BRENNA) === before.brenna && show(CORVIN) === before.corvin && show(CHEST) === before.chest);

function until(at) { if (at > w.now()) { w.run(at - w.now()); } }

t.done(w);
