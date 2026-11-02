'use strict';
/*
  test-scenario-needs.js

  Scenario: systems/hunger.md
  Scenario: systems/thirst.md
  Scenario: systems/exhaustion.md
  Scenario: systems/food.md
  Scenario: systems/drink.md
  Scenario: systems/potions.md
  Scenario: systems/temperature.md

  #5198. Hunger, thirst, rest, food, water, potions and the cold, end to end: the
  WHOLE of game/gamemode.js over the stand-in server
  (tests/stand-in-server.js), every step a message the engine sends in the
  order it sends them. Eating is the engine's MpActor::OnEquip: it fires
  onEatItem for a food or potion in the pack, the gamemode may set
  eatItemScale inside that event alone, and the engine takes one off the pack
  whatever the handler answers. Time is the stand-in's clock running the
  gamemode's own timers, the minute tick among them.

  Brenna and Aldis are in Windhelm, indoors. Corvin goes swimming.

    A  They come in and the needs record is full. An hour indoors: hunger
       falls by the page's 41.67 an hour, thirst by its 83.33 and rest by
       its 12.5, and Brenna is told when thirst gets worse.
    B  She eats bread: one leaves her pack, hunger rises by the page's 15,
       and the engine is told to apply none of the bread's own magic (food
       in a stripped group, #2682). A second inside the 8 seconds is still taken by
       the engine and does nothing to hunger. A meal on a full stomach does
       not raise it.
    C  Water at the well bucket: an empty bottle becomes a full one and the
       line says it is clean. Drinking it is 20 thirst and says clean
       water. The same well again inside the day is refused with the wait.
    D  Three potions inside a minute: the engine is told to apply the first
       whole, the second at half and the third at a quarter, each a sip of
       5 thirst. A minute later a potion is whole again.
    E  Corvin swims for half an hour while Aldis stays indoors: Corvin's
       warmth falls and his hunger falls faster than Aldis's.
    F  A restart: the meters are where they were, and the clock goes on.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  Read only, apart from its temp folders, which it removes.

      node tests\test-scenario-needs.js
*/
const standIn = require('./stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const w = standIn.world({ name: 'needs' });
const CITY = '1691d:Skyrim.esm';
const BREAD = '65c98:Skyrim.esm';               // Bread, an ALCH in the prepared group: 15
const POTION = 'f84b0:Skyrim.esm';              // a potion, by the food table
const EMPTY = 'f2012:Skyrim.esm';               // an empty wine bottle
const FULL = '13f598:WindhelmSSE.esp';          // a bottle of water
const BUCKET = '18030:Thornswood-Content.esp';  // the well bucket the content plugin stands by a well
w.record(BREAD, 'ALCH');
w.record(POTION, 'ALCH');
w.record(FULL, 'ALCH');
w.record(EMPTY, 'MISC');
w.record(BUCKET, 'ACTI');
const WELL = w.ref(0xff200020, { base: BUCKET, cell: CITY, pos: [2000, 0, 0] });
const id = w.idOf;

const BRENNA = w.person(0xff000a00, { profileId: 1000, name: 'Brenna', prof: 'smith', half: 'platewright', cell: CITY, pos: [2050, 0, 0],
  inventory: { entries: [{ baseId: 0xf, count: 40 }, { baseId: id(BREAD), count: 6 }, { baseId: id(POTION), count: 4 }, { baseId: id(EMPTY), count: 2 }] } });
const ALDIS = w.person(0xff000a01, { profileId: 1001, name: 'Aldis', prof: 'cook', cell: CITY, pos: [2100, 0, 0] });
const CORVIN = w.person(0xff000a02, { profileId: 1002, name: 'Corvin', prof: 'tailor', cell: CITY, pos: [2150, 0, 0] });
const ALL = [BRENNA, ALDIS, CORVIN];

yes('P0 the whole gamemode loads over the stand-in', w.boot() || !console.log(w.loadError()));
if (!w.loaded()) { t.done(w); }
ALL.forEach(w.arrive);
ALL.forEach(function (a) { w.say(a, '/place indoors - 0 1 0 -'); });
w.run(30000);
const N = () => w.box().__thornswoodNeeds;
function m(a) { return N().read(a) || {}; }
function about(x, want, slack) { return typeof x === 'number' && Math.abs(x - want) <= slack; }
function f1(x) { return typeof x === 'number' ? x.toFixed(1) : String(x); }

// ------------------------------------------------------------- A. a clock --
const a0 = m(BRENNA);
yes('A1 the needs record is full when they come in (' + f1(a0.food) + ' / ' + f1(a0.drink) + ')', a0.food >= 99 && a0.drink >= 99);
let heardAt = w.heard(BRENNA).length;
const t0 = w.now();
w.run(60 * 60 * 1000);
const hours = (w.now() - t0) / 3600000;
const a1 = m(BRENNA);
yes('A2 an hour indoors: hunger fell by about 41.67 (' + f1(a0.food) + ' to ' + f1(a1.food) + ')', about(a0.food - a1.food, 41.67 * hours, 1.5));
yes('A2 and thirst by about 83.33 (' + f1(a0.drink) + ' to ' + f1(a1.drink) + ')', about(a0.drink - a1.drink, 83.33 * hours, 1.5));
yes('A2 and rest by about 12.5 (' + f1(a0.rest) + ' to ' + f1(a1.rest) + ')', about(a0.rest - a1.rest, 12.5 * hours, 1));
yes('A2 she was told when thirst got worse (' + w.heardSince(BRENNA, heardAt).join(' | ') + ')',
    w.heardSince(BRENNA, heardAt).some(function (l) { return /thirst/i.test(l); }));

// ------------------------------------------------------------ B. a meal --
let before = m(BRENNA).food, breads = w.count(BRENNA, id(BREAD));
const b1 = w.eat(BRENNA, id(BREAD));
yes('B1 she eats bread: the engine sends it and applies none of its own magic (' + JSON.stringify(b1) + ')', b1.sent && b1.scale === 0);
yes('B1 one leaves her pack', w.count(BRENNA, id(BREAD)) === breads - 1);
yes('B1 hunger rose by the page\'s 15 (' + f1(before) + ' to ' + f1(m(BRENNA).food) + ')', about(m(BRENNA).food - before, 15, 0.5));
before = m(BRENNA).food;
w.run(2000);
const b2 = w.eat(BRENNA, id(BREAD));
yes('B2 a second inside the 8 seconds: the engine still takes it', b2.sent && w.count(BRENNA, id(BREAD)) === breads - 2);
yes('B2 and hunger does not move (' + f1(before) + ' to ' + f1(m(BRENNA).food) + ')', about(m(BRENNA).food, before, 0.2));
w.run(10000);
breads = w.count(BRENNA, id(BREAD));
for (let i = 0; i < 3 && m(BRENNA).food < 90; i++) { w.eat(BRENNA, id(BREAD)); w.run(10000); }
before = m(BRENNA).food;
heardAt = w.heard(BRENNA).length;
const b3 = w.eat(BRENNA, id(BREAD));
yes('B3 at ' + f1(before) + ', a full stomach: the meal does not raise hunger', b3.sent && m(BRENNA).food <= before + 0.2);
yes('B3 and she is told it sits badly (' + w.heardSince(BRENNA, heardAt).join(' | ') + ')',
    w.heardSince(BRENNA, heardAt).indexOf('You are already full. It sits badly.') >= 0);
const none = w.eat(ALDIS, id(BREAD));
yes('B4 Aldis has no bread: the engine sends nothing', !none.sent);

// ------------------------------------------------------------ C. a well --
heardAt = w.heard(BRENNA).length;
const c1 = w.activate(WELL, BRENNA);
yes('C1 the well bucket: an empty bottle becomes a full one (' + w.heardSince(BRENNA, heardAt).join(' | ') + ')',
    c1.allowed && w.count(BRENNA, id(EMPTY)) === 1 && w.count(BRENNA, id(FULL)) === 1);
yes('C1 and the line says it is clean', w.heardSince(BRENNA, heardAt).indexOf('You fill a bottle at the well. The water is clean.') >= 0);
before = m(BRENNA).drink;
heardAt = w.heard(BRENNA).length;
const c2 = w.eat(BRENNA, id(FULL));
yes('C2 she drinks it: 20 thirst (' + f1(before) + ' to ' + f1(m(BRENNA).drink) + ')', c2.sent && about(m(BRENNA).drink - before, 20, 0.5));
yes('C2 the bottle is gone and the line says clean water (' + w.heardSince(BRENNA, heardAt).join(' | ') + ')',
    w.count(BRENNA, id(FULL)) === 0 && w.heardSince(BRENNA, heardAt).some(function (l) { return /Clean water\./.test(l); }));
w.activate(WELL, BRENNA); // stands up from it: a second press, no event
heardAt = w.heard(BRENNA).length;
w.activate(WELL, BRENNA);
yes('C3 the same well again inside the day is refused with the wait (' + w.heardSince(BRENNA, heardAt).join(' | ') + ')',
    w.count(BRENNA, id(EMPTY)) === 1 && w.heardSince(BRENNA, heardAt).some(function (l) { return /^You have drawn from this well today\. Try another well, or wait \d+ minutes?\.$/.test(l); }));

// --------------------------------------------------------- D. potions --
w.run(60000);
const scales = [];
before = m(BRENNA).drink;
for (let i = 0; i < 3; i++) { scales.push(w.eat(BRENNA, id(POTION)).scale); w.run(5000); }
yes('D1 three potions inside a minute: the engine applies them at 1, 0.5 and 0.25 (' + scales.join(', ') + ')',
    scales[0] === 1 && scales[1] === 0.5 && scales[2] === 0.25);
yes('D1 each a sip of 5 thirst (' + f1(before) + ' to ' + f1(m(BRENNA).drink) + ')', about(m(BRENNA).drink - before, 15, 1));
w.run(60000);
yes('D2 a minute later a potion is whole again', w.eat(BRENNA, id(POTION)).scale === 1);
yes('D2 four potions left her pack', w.count(BRENNA, id(POTION)) === 0);

// ------------------------------------------------------------ E. cold --
const e0 = { corvin: m(CORVIN), aldis: m(ALDIS) };
w.say(CORVIN, '/place water - 0 0 0 -');
w.run(30 * 60 * 1000);
const e1 = { corvin: m(CORVIN), aldis: m(ALDIS) };
yes('E1 Corvin swims for half an hour: his warmth falls (' + f1(e0.corvin.temp) + ' to ' + f1(e1.corvin.temp) + ')',
    e1.corvin.temp < e0.corvin.temp - 5);
yes('E1 and his hunger fell faster than Aldis\'s indoors (' + f1(e0.corvin.food - e1.corvin.food) + ' against ' + f1(e0.aldis.food - e1.aldis.food) + ')',
    (e0.corvin.food - e1.corvin.food) > (e0.aldis.food - e1.aldis.food) + 0.5);

// ---------------------------------------------------------- F. restart --
w.say(CORVIN, '/place indoors - 0 1 0 -');
w.run(20000);
const f0 = { brenna: m(BRENNA), corvin: m(CORVIN) };
const r = w.restart();
yes('F1 the server restarts and the gamemode loads again', r.loaded);
ALL.forEach(w.arrive);
w.run(20000);
const f1b = m(BRENNA);
yes('F1 her meters are where they were (' + f1(f0.brenna.food) + ' / ' + f1(f0.brenna.drink) + ' then ' + f1(f1b.food) + ' / ' + f1(f1b.drink) + ')',
    about(f1b.food, f0.brenna.food, 1.5) && about(f1b.drink, f0.brenna.drink, 1.5));
w.run(10 * 60 * 1000);
yes('F2 and the clock goes on (' + f1(f1b.food) + ' to ' + f1(m(BRENNA).food) + ')', m(BRENNA).food < f1b.food - 5);

// ------------------------------------------------------------- Z. clean --
yes('Z no handler threw and nothing the engine would refuse was done (' + w.faults.slice(0, 3).join(' | ') + ')', w.faults.length === 0);
yes('Z no timer threw (' + w.threw.slice(0, 2).join(' | ') + ')', w.threw.length === 0);
yes('Z the gamemode logged no handler error (' + w.logged(/\] on[A-Z][A-Za-z]+ threw/).slice(0, 2).join(' | ') + ')',
    w.logged(/\] on[A-Z][A-Za-z]+ threw/).length === 0);
t.done(w);
