'use strict';
/*
  test-scenario-disease.js

  Scenario: systems/disease.md

  #5198. The five diseases, end to end: the WHOLE of game/gamemode.js over the
  stand-in server (tests/stand-in-server.js), every step a message the engine
  sends in the order it sends them. Eating and drinking are the engine's
  MpActor::OnEquip, which raises onEatItem for a thing in the pack; a press is
  onActivate; a bench is onCraftWork then onCraft; time is the stand-in's
  clock running the gamemode's own timers, the hurt tick among them. A roll is
  made with the dice held at a number, so the chance on the page is what is
  checked, from both sides.

  Brenna is a smith. Corvin has two points in Toughness and Dagny five, which
  is Purified Blood. Eirik is staff. Finn eats a feast. Aldis goes swimming.
  They are in Windhelm.

    A  What catches food sickness: raw meat on a roll of 35% catches it for
       Brenna, under its 40%. Corvin's two points of Toughness take 20% off,
       so 35% does not catch it for him and 31% does. Dagny's Purified Blood
       stops it on any roll. Eating on a full stomach catches it on a roll of
       99%.
    B  Fouled water: a bottle filled at the water bucket by the river, drunk
       unboiled, catches it on a roll of 14%, under the river's 15%. Corvin,
       with his Toughness, does not catch it on 13%.
    C  Caught: for 10 minutes nothing shows and nothing costs. Then it shows,
       she is told, and the meter it is closest to counts as weary although
       the meter itself is fine: hunger for food sickness, thirst for fouled
       water.
    D  Food sickness passes 30 minutes after it shows. Wound fever goes bad
       20 minutes after it shows: she is told, hunger counts as bad, and the
       bench refuses her before anything is taken. A potion of cure disease
       clears the fever, the one furthest along, and leaves the fouled water.
       Then the bench works.
    E  The temple rite: a shrine out in the city is a blessing only; a shrine
       in the Temple of Talos clears every disease she has.
    F  A cooked meal's guard: Finn eats a feast, and raw meat on a roll of 15%
       does not catch it, the chance a quarter of 40%. After its 10 minutes
       the guard is gone, and the same roll catches it.
    G  The chill: Aldis in the water at spent cold for an hour catches a chill.
       It shows after 10 minutes, and a fire shakes it off.
    H  The server restarts: Brenna's bad fever is still on her and still bad,
       and two hours of waiting do not clear it.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  Read only, apart from its temp folders, which it removes.

      node tests\test-scenario-disease.js
*/
const standIn = require('./stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const RECIPES = require('../game/data/recipes.json');
const BOOTS_R = 'dca01:Skyrim.esm';
const boots = (RECIPES.recipes || {})[BOOTS_R];
yes('P0 the server\'s recipe table has Leather Boots, at the forge', !!boots && boots.bench === '88105:Skyrim.esm');
if (!boots) { t.done(); }

const w = standIn.world({ name: 'disease', settings: { thornswoodDevs: [1006] } });
const CITY = '1691d:Skyrim.esm';                     // Windhelm
const TEMPLE = { desc: '16785:Skyrim.esm', pos: [-1, -1510, 149.8] };   // the Temple of Talos, a temple the wake uses
const RAW = '10211a:Skyrim.esm';                     // Mammoth Snout, raw meat by the food groups
const TART = '1a011:Thornswood-Content.esp';         // Midyear Jazbay Tart, a feast whose help is the guard
const CURE = 'ae723:Skyrim.esm';                     // Cure Disease, the potion
const EMPTY = 'f2012:Skyrim.esm';                    // an empty wine bottle
const FULL = '13f598:WindhelmSSE.esp';               // a bottle of water
const RIVER_BUCKET = '18031:Thornswood-Content.esp'; // the water bucket on a river bank
const TALOS = '100780:Skyrim.esm';                   // a shrine of Talos
const FORGE_BASE = '1a2ad:Skyrim.esm';               // a forge
[RAW, TART, CURE, FULL].forEach(function (d) { w.record(d, 'ALCH'); });
w.record(EMPTY, 'MISC');
w.record(RIVER_BUCKET, 'ACTI');
w.record(TALOS, 'ACTI');
w.record(FORGE_BASE, 'FURN');
const id = w.idOf;
const BUCKET = w.ref(0xff200030, { base: RIVER_BUCKET, cell: CITY, pos: [2000, 0, 0] });
const WAYSIDE = w.ref(0xff200031, { base: TALOS, cell: CITY, pos: [2000, 300, 0] });
const ALTAR = w.ref(0xff200032, { base: TALOS, cell: TEMPLE.desc, pos: [TEMPLE.pos[0] + 50, TEMPLE.pos[1], TEMPLE.pos[2]] });
const FORGE = w.ref(0xff200033, { base: FORGE_BASE, cell: CITY, pos: [1000, 0, 0] });
const HAMMER = id('5cae1:Skyrim.esm');
const CHARCOAL = id('15481:Thornswood-Content.esp');
const BOOTS = { recipe: id(BOOTS_R), output: id(boots.out), count: boots.makes || 1,
                inputs: boots.inputItems.map(function (x) { return { baseId: id(x.item), count: x.count }; }) };

function near(n) { return [2050 + 40 * n, 0, 0]; }
const BRENNA = w.person(0xff000d00, { profileId: 1000, name: 'Brenna', prof: 'smith', half: 'platewright', cell: CITY, pos: [1050, 0, 0],
  inventory: { entries: [{ baseId: 0xf, count: 40 }, { baseId: HAMMER, count: 1 }, { baseId: CHARCOAL, count: 5 },
    { baseId: id(RAW), count: 2 }, { baseId: id(CURE), count: 1 }, { baseId: id(EMPTY), count: 1 }, { baseId: id(FULL), count: 4 }]
    .concat(BOOTS.inputs.map(function (x) { return { baseId: x.baseId, count: x.count * 2 }; })) } });
const CORVIN = w.person(0xff000d01, { profileId: 1002, name: 'Corvin', prof: 'tailor', cell: CITY, pos: near(1),
  character: { tree: { toughness: 2 } },
  inventory: { entries: [{ baseId: id(RAW), count: 2 }, { baseId: id(EMPTY), count: 1 }] } });
const DAGNY = w.person(0xff000d02, { profileId: 1004, name: 'Dagny', prof: 'tailor', cell: CITY, pos: near(2),
  character: { tree: { toughness: 5 } },
  inventory: { entries: [{ baseId: id(RAW), count: 1 }] } });
const EIRIK = w.person(0xff000d03, { profileId: 1006, name: 'Eirik', cell: CITY, pos: near(3),
  inventory: { entries: [{ baseId: id(RAW), count: 1 }] } });
const FINN = w.person(0xff000d04, { profileId: 1008, name: 'Finn', prof: 'tailor', cell: CITY, pos: near(4),
  inventory: { entries: [{ baseId: id(TART), count: 1 }, { baseId: id(RAW), count: 2 }] } });
const ALDIS = w.person(0xff000d05, { profileId: 1010, name: 'Aldis', prof: 'tailor', cell: CITY, pos: near(5) });
const EVERYONE = [BRENNA, CORVIN, DAGNY, EIRIK, FINN, ALDIS];
function needs(food, drink) { return { food: food, drink: drink, rest: 95, temp: 50, at: w.now() }; }
w.row(BRENNA).thornswoodNeeds = needs(75, 70);
w.row(CORVIN).thornswoodNeeds = needs(60, 70);
w.row(DAGNY).thornswoodNeeds = needs(60, 70);
w.row(FINN).thornswoodNeeds = needs(65, 70);

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
/*
  The sky held to snow. The season block rolls each climate's weather with
  Math.random, and Aldis's swim reaches spent cold only under some of those
  skies (under a clear one it stops at bad), so a scenario that left it to
  the roll passed or failed by the weather. __thornswoodSeasonUnit is the
  season block's own way in for a fixed roll: just under 1 is the last kind,
  snow, for the longest spell it rolls.
*/
function steadySky() { w.box().__thornswoodSeasonUnit = function () { return 0.999; }; }
steadySky();
EVERYONE.forEach(w.arrive);
EVERYONE.forEach(function (a) { w.say(a, '/place indoors - 0 1 0 -'); });
w.say(ALDIS, '/place water - 0 0 0 -');
w.run(30000);

const N = () => w.box().__thornswoodNeeds;
function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function say(a, text) { w.say(a, text); w.run(300); return last(a); }
function rec(a) { return w.prop(a, 'thornswoodHurt') || {}; }
function ills(a) { return (rec(a).ills || []).map(function (i) { return i.k; }).sort(); }
function ill(a, k) { return (rec(a).ills || []).filter(function (i) { return i.k === k; })[0] || null; }
/* The lines on the left edge of the screen, as the hurt block draws them now. */
function shown(a) { const H = w.box().__thornswoodHurt; return H.lines(H.read(a), w.now()); }
/* The actor values the meters add up to, the map the client sets. */
function cost(a) { return N().effects(a, N().settle(a)) || {}; }
/* Eat with the dice held at a number, then let them go. Eight seconds on, the next meal counts. */
function eatAt(a, desc, dice) { w.dice(dice); const r = w.eat(a, id(desc)); w.run(300); w.dice(null); w.run(9000); return r; }
function until(at) { if (at > w.now()) { w.run(at - w.now()); } }
const MIN = 60000;
let answer = '', heardAt = 0;

// ---------------------------------------------------------- A. food sickness --
eatAt(BRENNA, RAW, 0.35);
yes('A1 raw meat on a roll of 35% catches food sickness for Brenna, under its 40% (' + ills(BRENNA).join() + ')',
  ills(BRENNA).join() === 'food' && w.count(BRENNA, id(RAW)) === 1);
eatAt(CORVIN, RAW, 0.35);
const corvinAt35 = ills(CORVIN).join();
eatAt(CORVIN, RAW, 0.31);
yes('A2 Corvin\'s two points of Toughness take 20% off: 35% does not catch it, 31% does (' + JSON.stringify(corvinAt35) + ', ' + ills(CORVIN).join() + ')',
  corvinAt35 === '' && ills(CORVIN).join() === 'food');
eatAt(DAGNY, RAW, 0);
yes('A3 Dagny\'s Purified Blood stops it on any roll (' + JSON.stringify(ills(DAGNY)) + ')', ills(DAGNY).length === 0 && w.count(DAGNY, id(RAW)) === 0);
heardAt = w.heard(EIRIK).length;
eatAt(EIRIK, RAW, 0.99);
yes('A4 eating on a full stomach catches it on a roll of 99% (' + w.heardSince(EIRIK, heardAt).join(' | ') + ', ' + ills(EIRIK).join() + ')',
  w.heardSince(EIRIK, heardAt).indexOf('You are already full. It sits badly.') >= 0 && ills(EIRIK).join() === 'food');

// ----------------------------------------------------------- B. fouled water --
w.moveTo(BRENNA, CITY, near(0));
heardAt = w.heard(BRENNA).length;
const b0 = w.activate(BUCKET, BRENNA);
yes('B1 the water bucket by the river fills her empty bottle, with the word to boil it (' + w.heardSince(BRENNA, heardAt).join(' | ') + ')',
  b0.allowed && w.count(BRENNA, id(EMPTY)) === 0 && w.count(BRENNA, id(FULL)) === 5 &&
  w.heardSince(BRENNA, heardAt).indexOf('You fill a bottle from the water. Boil it before you drink it.') >= 0);
heardAt = w.heard(BRENNA).length;
eatAt(BRENNA, FULL, 0.14);
yes('B2 drunk unboiled it catches fouled water on a roll of 14%, under the river\'s 15% (' + w.heardSince(BRENNA, heardAt).join(' | ') + ', ' + ills(BRENNA).join() + ')',
  ills(BRENNA).join() === 'food,fouled' && w.heardSince(BRENNA, heardAt).some(function (l) { return /tastes of where it came from/.test(l); }));
w.activate(BUCKET, CORVIN);
eatAt(CORVIN, FULL, 0.13);
yes('B3 Corvin, with his Toughness, does not catch it on 13% (' + ills(CORVIN).join() + ')', ills(CORVIN).join() === 'food' && w.count(CORVIN, id(FULL)) === 0);

// ----------------------------------------------------------- C. caught, ill --
const food = ill(BRENNA, 'food'), fouled = ill(BRENNA, 'fouled');
heardAt = w.heard(BRENNA).length;
until(food.at + 10 * MIN - 20000);
yes('C1 for 10 minutes nothing shows, she is told nothing and it costs nothing (' + JSON.stringify(shown(BRENNA)) + ', ' + JSON.stringify(cost(BRENNA)) + ')',
  shown(BRENNA).length === 0 && w.heardSince(BRENNA, heardAt).length === 0 && !cost(BRENNA).stamina && N().view(BRENNA).foodBand === 'fine');
until(food.at + 10 * MIN + 15000);
yes('C2 at 10 minutes food sickness shows and she is told (' + w.heardSince(BRENNA, heardAt).join(' | ') + ', ' + JSON.stringify(shown(BRENNA)) + ')',
  w.heardSince(BRENNA, heardAt).indexOf('Your stomach turns. Food sickness, for a while.') >= 0 && shown(BRENNA).join() === 'Food sickness');
yes('C2 hunger counts as weary though the meter is fine (' + N().view(BRENNA).food + ', ' + JSON.stringify(cost(BRENNA)) + ')',
  N().view(BRENNA).foodBand === 'fine' && cost(BRENNA).stamina === -20 && !cost(BRENNA).magicka);
until(fouled.at + 10 * MIN + 15000);
yes('C3 fouled water shows too, and thirst counts as weary though the meter is fine (' + JSON.stringify(shown(BRENNA)) + ', ' + JSON.stringify(cost(BRENNA)) + ')',
  w.heardSince(BRENNA, heardAt).indexOf('The water was bad. You are sick with it for a while.') >= 0 &&
  shown(BRENNA).join() === 'Food sickness,Fouled water' && cost(BRENNA).magicka === -20 && N().view(BRENNA).drinkBand === 'fine');

// ---------------------------------------------------- D. passed, bad, cured --
answer = say(EIRIK, '/hurt Brenna fever');
const fever = ill(BRENNA, 'fever');
yes('D1 staff give Brenna wound fever, caught now (' + answer + ')', !!fever && /shows in 10 minutes/.test(answer));
heardAt = w.heard(BRENNA).length;
until(food.at + 40 * MIN + 15000);
yes('D2 food sickness passes 30 minutes after it showed (' + w.heardSince(BRENNA, heardAt).join(' | ') + ', ' + ills(BRENNA).join() + ')',
  w.heardSince(BRENNA, heardAt).indexOf('The food sickness has passed.') >= 0 && ills(BRENNA).join() === 'fever,fouled');
heardAt = w.heard(BRENNA).length;
until(fever.at + 30 * MIN + 15000);
yes('D3 the fever turns bad 20 minutes after it showed, and she is told (' + w.heardSince(BRENNA, heardAt).join(' | ') + ', ' + JSON.stringify(shown(BRENNA)) + ')',
  w.heardSince(BRENNA, heardAt).indexOf('The wound fever is worse. You cannot work at a bench like this, and waiting will not clear it.') >= 0 &&
  shown(BRENNA).indexOf('Wound fever, bad') >= 0);
yes('D3 hunger counts as bad (' + JSON.stringify(cost(BRENNA)) + ')', cost(BRENNA).stamina <= -40);
for (let i = 0; i < 3; i++) { w.eat(BRENNA, id(FULL)); w.run(500); }
w.moveTo(BRENNA, CITY, [1050, 0, 0]);
w.activate(FORGE, BRENNA);
const packBefore = JSON.stringify(w.row(BRENNA).inventory.entries);
const d4 = w.craft(BRENNA, FORGE, BOOTS);
yes('D4 the bench refuses her before anything is taken (' + last(BRENNA) + ')',
  !d4.made && last(BRENNA) === 'You are too sick to work: the wound fever is bad. A potion of cure disease or a temple shrine clears it.' &&
  JSON.stringify(w.row(BRENNA).inventory.entries) === packBefore);
heardAt = w.heard(BRENNA).length;
w.eat(BRENNA, id(CURE));
w.run(500);
yes('D5 a potion of cure disease clears the fever, the one furthest along, and leaves the fouled water (' + w.heardSince(BRENNA, heardAt).join(' | ') + ', ' + ills(BRENNA).join() + ')',
  w.heardSince(BRENNA, heardAt).indexOf('The wound fever is gone.') >= 0 && ills(BRENNA).join() === 'fouled' && w.count(BRENNA, id(CURE)) === 0);
const d6 = w.craft(BRENNA, FORGE, BOOTS);
yes('D6 and the bench works (' + JSON.stringify(d6) + ')', d6.made && w.count(BRENNA, BOOTS.output) === 1);
w.activate(FORGE, BRENNA);

// -------------------------------------------------------------- E. temple --
say(EIRIK, '/hurt Brenna bitesick');
w.moveTo(BRENNA, CITY, [2000, 280, 0]);
heardAt = w.heard(BRENNA).length;
w.activate(WAYSIDE, BRENNA);
w.run(500);
yes('E1 a shrine out in the city is a blessing only (' + w.heardSince(BRENNA, heardAt).join(' | ') + ', ' + ills(BRENNA).join() + ')',
  w.heardSince(BRENNA, heardAt).indexOf('You take the blessing of Talos.') >= 0 && ills(BRENNA).join() === 'bite,fouled');
w.moveTo(BRENNA, TEMPLE.desc, TEMPLE.pos);
w.run(500);
heardAt = w.heard(BRENNA).length;
w.activate(ALTAR, BRENNA);
w.run(500);
yes('E2 a shrine in the Temple of Talos clears every disease she has (' + w.heardSince(BRENNA, heardAt).join(' | ') + ', ' + JSON.stringify(ills(BRENNA)) + ')',
  w.heardSince(BRENNA, heardAt).indexOf('You take the blessing of Talos. The temple sees to the sickness.') >= 0 && ills(BRENNA).length === 0);

// --------------------------------------------------------------- F. guard --
heardAt = w.heard(FINN).length;
eatAt(FINN, TART, 0.5);
yes('F1 Finn eats a feast: the guard is on him for its 10 minutes (' + w.heardSince(FINN, heardAt).join(' | ') + ')',
  w.count(FINN, id(TART)) === 0 && !!rec(FINN).guard && Math.abs(rec(FINN).guard.until - w.now() - 10 * MIN) < 15000);
eatAt(FINN, RAW, 0.15);
yes('F2 raw meat on a roll of 15% does not catch it, the chance a quarter of 40% (' + JSON.stringify(ills(FINN)) + ')',
  ills(FINN).length === 0 && w.count(FINN, id(RAW)) === 1);
until(rec(FINN).guard.until + 15000);
eatAt(FINN, RAW, 0.15);
yes('F3 after its 10 minutes the guard is gone, and the same roll catches it (' + ills(FINN).join() + ')',
  ills(FINN).join() === 'food' && w.count(FINN, id(RAW)) === 0);

// --------------------------------------------------------------- G. chill --
const coldFrom = rec(ALDIS).cold;
yes('G1 Aldis has been at spent cold in the water, and the hour is counting (' + N().view(ALDIS).tempBand + ')',
  N().view(ALDIS).tempBand === 'spent' && coldFrom > 0 && ills(ALDIS).length === 0);
for (let i = 0; i < 6 * 60 && !ill(ALDIS, 'chill'); i++) { w.run(10000); }
const chill = ill(ALDIS, 'chill');
yes('G2 an hour at spent cold catches a chill (' + (chill ? ((chill.at - coldFrom) / MIN).toFixed(2) : 'none') + ' minutes)',
  !!chill && chill.at - coldFrom >= 60 * MIN && chill.at - coldFrom < 61 * MIN);
heardAt = w.heard(ALDIS).length;
until(chill.at + 10 * MIN + 15000);
yes('G3 it shows after 10 minutes, and she is told (' + w.heardSince(ALDIS, heardAt).join(' | ') + ', ' + JSON.stringify(shown(ALDIS)) + ')',
  w.heardSince(ALDIS, heardAt).indexOf('A chill has settled in. A fire, a bed or getting warm again will shake it.') >= 0 &&
  shown(ALDIS).join() === 'Chilled');
heardAt = w.heard(ALDIS).length;
w.say(ALDIS, '/place indoors - 0 1 0 50');
w.run(15000);
yes('G4 a fire shakes it off (' + w.heardSince(ALDIS, heardAt).join(' | ') + ', ' + JSON.stringify(ills(ALDIS)) + ')',
  w.heardSince(ALDIS, heardAt).indexOf('The fire shakes the chill off.') >= 0 && ills(ALDIS).length === 0);

// ------------------------------------------------------------- H. restart --
say(EIRIK, '/hurt Brenna fever');
const fever2 = ill(BRENNA, 'fever');
until(fever2.at + 30 * MIN + 15000);
const r = w.restart();
yes('H1 the server comes back up', r.loaded);
steadySky();
EVERYONE.forEach(w.arrive);
w.run(30000);
yes('H2 Brenna\'s bad fever is still on her and still bad (' + JSON.stringify(shown(BRENNA)) + ')',
  !!ill(BRENNA, 'fever') && ill(BRENNA, 'fever').at === fever2.at && shown(BRENNA).indexOf('Wound fever, bad') >= 0);
w.run(2 * 60 * MIN);
yes('H3 two hours on, waiting has not cleared it (' + JSON.stringify(shown(BRENNA)) + ')',
  !!ill(BRENNA, 'fever') && shown(BRENNA).indexOf('Wound fever, bad') >= 0);

t.done(w);
