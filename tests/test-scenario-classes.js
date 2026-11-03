'use strict';
/*
  test-scenario-classes.js

  Scenario: systems/classes.md

  #5198. Where the raw material comes from, end to end: the WHOLE of
  game/gamemode.js over the stand-in server (tests/stand-in-server.js), every
  step a message the engine sends in the order it sends them. Picking a class
  is the K panel's line through the voice queue (/pick class <class>); a
  press on a seam, a plant or a body is onActivate. Time is the stand-in's
  clock running the gamemode's own timers, the swing of a pick among them.
  A login is the launcher's pass and onThornswoodLogin.

  Brenna has no class yet. Corvin is a Gatherer, Hilde a Hunter, and Ulf a
  Miner who has lost his pickaxe. They stand at an iron seam, a gold seam,
  a plant and a rabbit's body in Windhelm.

    A  Brenna, with no class, is turned away from the seam, the plant and the
       body, each told to choose one.
    B  She picks Miner on K: she is handed a pickaxe. A second pick of a
       class is refused.
    C  She presses the iron seam: the pick goes up and ore comes off it a
       strike at a time until she presses again to put it down. Each strike
       is a piece of Miner work and a use of the pickaxe.
    D  The gold seam takes an Expert Miner: refused by name. Ebony and the
       gems are quest work, which the quests scenario covers.
    E  Ulf, a Miner with no pickaxe, is told he needs one and who makes it.
    F  Each verb is its class's alone: Corvin is refused the seam and the
       body, Brenna the plant. Corvin picks the plant and it is a piece of
       Gatherer work.
    G  Hilde takes the rabbit's legs off its body: Hunter work. A second
       press finds nothing more on it.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  Fishing and farming have their own scenarios' worth of steps (the pole,
  the water, the plot and the season) and are not this one.

  Read only, apart from its temp folders, which it removes.

      node tests\test-scenario-classes.js
*/
const standIn = require('./stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const w = standIn.world({ name: 'classes' });
const WINDHELM = '3c:Skyrim.esm';
const IRON_SEAM = '10dcc9:Skyrim.esm', GOLD_SEAM = 'a2bfe:Skyrim.esm', IRON_ORE = '71cf3:Skyrim.esm';
const PLANT = '16e24:Dragonborn.esm', POD = '16e26:Dragonborn.esm';           // Ashen Grass Pod, a novice plant
const RABBIT = 'eb3:Skyrim.esm', LEG = '65c9e:Skyrim.esm';
const PICKAXE = 'e3c16:Skyrim.esm';
w.record(IRON_SEAM, 'ACTI');
w.record(GOLD_SEAM, 'ACTI');
w.record(PLANT, 'FLOR');
w.record(RABBIT, 'NPC_');
const id = w.idOf;
const STREET = [130000, -9000, 9000];
function at(dx, dy) { return [STREET[0] + dx, STREET[1] + dy, STREET[2]]; }
const SEAM = w.ref(0xff2000c0, { base: IRON_SEAM, cell: WINDHELM, pos: at(0, 0) });
const GOLD = w.ref(0xff2000c1, { base: GOLD_SEAM, cell: WINDHELM, pos: at(0, 120) });
const BUSH = w.ref(0xff2000c2, { base: PLANT, cell: WINDHELM, pos: at(120, 0) });
const BODY = w.ref(0xff2000c3, { base: RABBIT, type: 'NPC_', cell: WINDHELM, pos: at(120, 120), isDead: true });

const BRENNA = w.person(0xff001900, { profileId: 1000, name: 'Brenna', prof: 'smith', cls: null, cell: WINDHELM, pos: at(40, 40),
  inventory: { entries: [{ baseId: 0xf, count: 10 }] } });
const CORVIN = w.person(0xff001901, { profileId: 1002, name: 'Corvin', prof: 'tailor', cls: 'gatherer', cell: WINDHELM, pos: at(60, 40),
  inventory: { entries: [{ baseId: 0xf, count: 10 }] } });
const HILDE = w.person(0xff001902, { profileId: 1004, name: 'Hilde', prof: 'cook', cls: 'hunter', cell: WINDHELM, pos: at(80, 80),
  inventory: { entries: [{ baseId: 0xf, count: 10 }] } });
const ULF = w.person(0xff001903, { profileId: 1006, name: 'Ulf', prof: 'smith', cls: 'miner', cell: WINDHELM, pos: at(20, 20),
  inventory: { entries: [{ baseId: 0xf, count: 10 }] } });
[CORVIN, HILDE, ULF].forEach(function (a) { const c = w.row(a).thornswoodCharacter; c.ranks[c.cls] = 'novice'; });
const EVERYONE = [BRENNA, CORVIN, HILDE, ULF];
EVERYONE.forEach(function (a) { w.row(a).thornswoodNeeds = { food: 80, drink: 90, rest: 90, temp: 50, at: w.now() }; });

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
EVERYONE.forEach(w.arrive);
w.run(30000);

function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function say(a, text) { w.say(a, text); w.run(300); return last(a); }
function press(ref, a) { w.activate(ref, a); w.run(300); return last(a); }
function ch(a) { return w.prop(a, 'thornswoodCharacter') || {}; }
function work(a, key) { return (ch(a).work || {})[key] || 0; }
function pickaxes(a) { return w.count(a, id(PICKAXE)); }
let heardAt = 0;

// ------------------------------------------------------------- A. no class --
const NO_CLASS = 'You have not chosen a class yet. Press K and choose one.';
yes('A1 Brenna, with no class, is turned away from the seam (' + press(SEAM, BRENNA) + ')', last(BRENNA) === NO_CLASS && w.count(BRENNA, id(IRON_ORE)) === 0);
yes('A1 the plant (' + press(BUSH, BRENNA) + ')', last(BRENNA) === NO_CLASS && w.count(BRENNA, id(POD)) === 0);
yes('A1 and the body (' + press(BODY, BRENNA) + ')', last(BRENNA) === NO_CLASS && w.count(BRENNA, id(LEG)) === 0);

// ------------------------------------------------------------ B. the pick --
heardAt = w.heard(BRENNA).length;
say(BRENNA, '/pick class miner');
yes('B1 she picks Miner on K and is handed a pickaxe (' + w.heardSince(BRENNA, heardAt).join(' | ') + ')',
  ch(BRENNA).cls === 'miner' && pickaxes(BRENNA) === 1);
yes('B2 a second pick of a class is refused (' + say(BRENNA, '/pick class hunter') + ')',
  /^No: /.test(last(BRENNA)) && ch(BRENNA).cls === 'miner' && pickaxes(BRENNA) === 1);

// ------------------------------------------------------------- C. the seam --
const workWas = work(BRENNA, 'miner');
const usesWas = JSON.stringify(w.prop(BRENNA, 'thornswoodTools') || {});
w.activate(SEAM, BRENNA);
// The first strike lands 900 ms after the press; each after it a swing (2500) and a landing (900) later.
w.run(900 + 3400 * 2 + 300);
const strikes = w.count(BRENNA, id(IRON_ORE));
yes('C1 she presses the iron seam: ore comes off it a strike at a time (' + strikes + ' after three swings)', strikes >= 3);
const down = press(SEAM, BRENNA);
const kept = w.count(BRENNA, id(IRON_ORE));
w.run(10000);
yes('C2 and pressing again puts the pick down: no more comes (' + down + ', ' + kept + ' -> ' + w.count(BRENNA, id(IRON_ORE)) + ')',
  down === 'You put the pick down.' && w.count(BRENNA, id(IRON_ORE)) === kept);
yes('C3 each strike is a piece of Miner work (' + workWas + ' -> ' + work(BRENNA, 'miner') + ' for ' + kept + ' strikes)',
  work(BRENNA, 'miner') >= workWas + 3 && work(BRENNA, 'miner') <= workWas + kept);
yes('C3 and a use of the pickaxe (' + usesWas + ' -> ' + JSON.stringify(w.prop(BRENNA, 'thornswoodTools') || {}) + ')',
  JSON.stringify(w.prop(BRENNA, 'thornswoodTools') || {}) !== usesWas && pickaxes(BRENNA) === 1);

// ------------------------------------------------------------- D. the rank --
yes('D1 the gold seam takes an Expert Miner: refused by name (' + press(GOLD, BRENNA) + ')',
  last(BRENNA) === 'This seam is Gold Ore. Working it takes an Expert Miner. Work the seams you can until you are one.');

// ------------------------------------------------------------- E. the tool --
yes('E1 Ulf, a Miner with no pickaxe, is told he needs one and who makes it (' + press(SEAM, ULF) + ')',
  /^You need a pickaxe in your pack for that\. /.test(last(ULF)) && w.count(ULF, id(IRON_ORE)) === 0);

// ------------------------------------------------------- F. each its own --
yes('F1 Corvin, a Gatherer, is refused the seam (' + press(SEAM, CORVIN) + ')', last(CORVIN) === 'Only a miner can work a seam. Ask one.');
yes('F1 and the body (' + press(BODY, CORVIN) + ')', last(CORVIN) === 'Only a hunter can take anything off a carcass. Ask one.');
yes('F2 Brenna, a Miner, is refused the plant (' + press(BUSH, BRENNA) + ')', last(BRENNA) === 'Only a gatherer can pull that out of the ground. Ask one.');
const gWas = work(CORVIN, 'gatherer');
const picked = press(BUSH, CORVIN);
yes('F3 Corvin picks the plant, and it is a piece of Gatherer work (' + picked + ', ' + gWas + ' -> ' + work(CORVIN, 'gatherer') + ')',
  w.count(CORVIN, id(POD)) >= 1 && work(CORVIN, 'gatherer') === gWas + 1);

// --------------------------------------------------------------- G. a body --
const hWas = work(HILDE, 'hunter');
const took = press(BODY, HILDE);
yes('G1 Hilde takes the rabbit\'s legs off its body: Hunter work (' + took + ', ' + hWas + ' -> ' + work(HILDE, 'hunter') + ')',
  /^You take [0-9]+ Raw Rabbit Leg off the Rabbit\./.test(took) && w.count(HILDE, id(LEG)) >= 1 && work(HILDE, 'hunter') === hWas + 1);
const legs = w.count(HILDE, id(LEG));
yes('G2 a second press finds nothing more on it (' + press(BODY, HILDE) + ')',
  last(HILDE) === 'There is nothing more to take off this Rabbit.' && w.count(HILDE, id(LEG)) === legs && work(HILDE, 'hunter') === hWas + 1);

t.done(w);
