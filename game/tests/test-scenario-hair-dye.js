'use strict';
/*
  test-scenario-hair-dye.js

  Scenario: systems/hair-dye.md

  #5198. Hair dye, end to end: the WHOLE of game/gamemode.js over the
  stand-in server (tests/stand-in-server.js), every step a message the engine
  sends in the order it sends them. A press on the cooking spot is
  onActivate; the client reports the fire with its /place line, which is what
  finishes or loses a steep; K's and P's buttons send /hairdye, and the
  offer's prompt sends /yes or /no. The dyes are the staff's list,
  game/data/hair-dyes.json. Every roll is made with the dice held at the
  middle, so the colour a dye gives is the list's sum with no wander.

  Dagny is a Haberdasher, Corvin a smith, Brenna a smith with brown hair.
  They are in Windhelm, by a cooking spot.

    A  Corvin, carrying the Copper dye's makings, presses the cooking spot:
       he is told it is a Haberdasher's or Liverywright's work, and nothing
       is taken.
    B  Dagny presses it at the fire: the Copper dye is set to steep for its
       minute, and the cooking menu stays shut without a line saying nothing
       can be made there. Her client reports the fire after the minute: it has steeped,
       the makings and the bottle are gone, and the dye is in her pack as a
       Bowl named for it.
    C  A second steep, and she walks away from the fire before it is done:
       the steep is lost and nothing is taken.
    D  She dyes her own hair: each channel goes the dye's strength of the way
       to the dye's colour, and the dye is used up.
    E  She offers to dye Brenna's hair from across the street: stand closer.
       Beside her: Brenna is asked, and nothing is used or changed until she
       answers. She refuses: nothing. Asked again, she accepts: her hair
       changes, the dye is gone from Dagny's pack, and both are told.
    F  The Hair Wash takes Brenna's hair the wash's strength of the way back
       to the colour she was made with, kept from her first dye.
    G  The server restarts: the colours and the colour Brenna was made with
       are where they were.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  Read only, apart from its temp folders, which it removes.

      node game\tests\test-scenario-hair-dye.js
*/
const standIn = require('../../tests/stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const LIST = require('../../game/data/hair-dyes.json');
const COPPER = LIST.dyes.filter(function (d) { return d.id === 'copper'; })[0];
const WASH = LIST.dyes.filter(function (d) { return d.id === 'hair-wash'; })[0];
yes('P0 the staff\'s list has the Copper dye and the Hair Wash', !!COPPER && !!WASH);
if (!COPPER || !WASH) { t.done(); }

const w = standIn.world({ name: 'hair-dye' });
const CITY = '1691d:Skyrim.esm';
const POT_BASE = '1a2ae:Skyrim.esm';
const BENCHES = require('../../game/gamemode-tables/BENCH_BY_BASE.json');
const COOKPOT = Object.keys(BENCHES).filter(function (b) { return BENCHES[b] === LIST.steepAt; })[0];
w.record(COOKPOT, 'FURN');
w.record(LIST.item, 'MISC');
COPPER.inputs.concat(WASH.inputs).forEach(function (x) { w.record(x.item, 'INGR'); });
w.record('13f598:WindhelmSSE.esp', 'ALCH');
const id = w.idOf;
const POT = w.ref(0xff200070, { base: COOKPOT, cell: CITY, pos: [2000, 0, 0] });
function makings(dye, times) { return dye.inputs.map(function (x) { return { baseId: id(x.item), count: x.count * times }; }); }
function hair(name, c) { return { name: name, raceId: 0x13746, isFemale: true, hairColor: c, weight: 50, headpartIds: [] }; }
const BROWN = 0x5a3a22, FAIR = 0xc8b088;

const DAGNY = w.person(0xff001100, { profileId: 1004, name: 'Dagny', prof: 'tailor', half: 'haberdasher', cell: CITY, pos: [2050, 0, 0],
  inventory: { entries: makings(COPPER, 2).concat(makings(WASH, 1)) }, appearance: hair('Dagny', FAIR) });
const CORVIN = w.person(0xff001101, { profileId: 1002, name: 'Corvin', prof: 'smith', cell: CITY, pos: [2080, 0, 0],
  inventory: { entries: makings(COPPER, 1) } });
const BRENNA = w.person(0xff001102, { profileId: 1000, name: 'Brenna', prof: 'smith', cell: CITY, pos: [2600, 0, 0], appearance: hair('Brenna', BROWN) });
const EVERYONE = [DAGNY, CORVIN, BRENNA];

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
EVERYONE.forEach(w.arrive);
EVERYONE.forEach(function (a) { w.say(a, '/place indoors - 0 1 0 -'); });
w.run(30000);

function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function say(a, text) { w.say(a, text); w.run(300); return last(a); }
function hex(a) { return a.toString(16); }
function colour(a) { return w.row(a).appearance.hairColor; }
function c6(c) { return '#' + ('000000' + (c >>> 0).toString(16)).slice(-6); }
function dyesIn(a, dye) { return (w.row(a).inventory.entries || []).filter(function (e) { return e.baseId === id(LIST.item) && e.name === dye.name; })
  .reduce(function (n, e) { return n + e.count; }, 0); }
function held(a, dye) { return dye.inputs.map(function (x) { return w.count(a, id(x.item)); }).join(','); }
/* The list's sum with the wander at its middle: each channel the strength of the way from old to the target. */
function mixed(old, to, s) {
  let out = 0;
  for (let shift = 16; shift >= 0; shift -= 8) {
    const o = (old >> shift) & 255, tt = (to >> shift) & 255;
    out = out * 256 + Math.max(0, Math.min(255, Math.round(o + (tt - o) * s)));
  }
  return out;
}
const COPPER_RGB = parseInt(COPPER.colour.slice(1), 16);
let answer = '', heardAt = 0;

// ------------------------------------------------------------ A. not his --
const corvinHad = held(CORVIN, COPPER);
heardAt = w.heard(CORVIN).length;
w.activate(POT, CORVIN);
w.run(LIST.steepSeconds * 1000 + 1000);
const notHis = w.heardSince(CORVIN, heardAt).filter(function (l) { return /Haberdasher/.test(l) && /Liverywright/.test(l); });
yes('A1 Corvin, a smith, is told dye is a Haberdasher\'s or Liverywright\'s work, and nothing is taken (' + w.heardSince(CORVIN, heardAt).join(' | ') + ')',
  notHis.length === 1 && held(CORVIN, COPPER) === corvinHad && !dyesIn(CORVIN, COPPER));

// --------------------------------------------------------------- B. steep --
w.say(DAGNY, '/place indoors - 0 1 0 50');
w.run(1000);
heardAt = w.heard(DAGNY).length;
w.activate(POT, DAGNY);
w.run(300);
yes('B1 Dagny presses the cooking spot at the fire: the Copper dye steeps for its minute (' + w.heardSince(DAGNY, heardAt).join(' | ') + ')',
  w.heardSince(DAGNY, heardAt).indexOf('You set Copper Hair Dye to steep. Stay by the fire for 1 minute.') >= 0);
yes('B1 and the cooking menu, which is not hers, stays shut without telling her nothing can be made there (#5465)',
  !w.heardSince(DAGNY, heardAt).some(function (l) { return /^There is nothing you can make here/.test(l); }));
const dagnyHad = COPPER.inputs.map(function (x) { return w.count(DAGNY, id(x.item)); });
function less(times) { return COPPER.inputs.map(function (x, i) { return dagnyHad[i] - times * x.count; }).join(','); }
w.run(LIST.steepSeconds * 1000 + 1000);
heardAt = w.heard(DAGNY).length;
w.say(DAGNY, '/place indoors - 0 1 0 40');
w.run(1000);
yes('B2 after the minute her client reports the fire: it has steeped (' + w.heardSince(DAGNY, heardAt).join(' | ') + ')',
  w.heardSince(DAGNY, heardAt).indexOf('Copper Hair Dye has steeped. It is in your pack.') >= 0);
yes('B2 the makings and the bottle are gone, and it is a Bowl named for the dye (' + dagnyHad + ' -> ' + held(DAGNY, COPPER) + ')',
  held(DAGNY, COPPER) === less(1) && dyesIn(DAGNY, COPPER) === 1);

// --------------------------------------------------------- C. walked off --
w.activate(POT, DAGNY);
w.run(20000);
heardAt = w.heard(DAGNY).length;
w.say(DAGNY, '/place indoors - 0 1 0 -');
w.run(1000);
yes('C1 she leaves the fire before it is done: the steep is lost and nothing is taken (' + w.heardSince(DAGNY, heardAt).join(' | ') + ')',
  w.heardSince(DAGNY, heardAt).indexOf('You left the fire, and Copper Hair Dye did not steep.') >= 0 &&
  held(DAGNY, COPPER) === less(1) && dyesIn(DAGNY, COPPER) === 1);

// ----------------------------------------------------------- D. her own --
w.dice(0.5);
answer = say(DAGNY, '/hairdye self copper');
w.dice(null);
const dagnyWant = mixed(FAIR, COPPER_RGB, COPPER.strength);
yes('D1 she dyes her own hair: ' + c6(FAIR) + ' goes ' + COPPER.strength + ' of the way to ' + COPPER.colour + ' (' + answer + ', ' + c6(colour(DAGNY)) + ')',
  answer === 'You dye your hair with Copper Hair Dye.' && colour(DAGNY) === dagnyWant && dyesIn(DAGNY, COPPER) === 0);

// ------------------------------------------------------------- E. offer --
w.say(DAGNY, '/place indoors - 0 1 0 50');
w.run(1000);
w.activate(POT, DAGNY);
w.run(LIST.steepSeconds * 1000 + 1000);
w.say(DAGNY, '/place indoors - 0 1 0 40');
w.run(1000);
yes('E0 she steeps another', dyesIn(DAGNY, COPPER) === 1);
answer = say(DAGNY, '/hairdye offer ' + hex(BRENNA) + ' copper');
yes('E1 from across the street she is told to stand closer (' + answer + ')', answer === 'Stand closer to Brenna to dye their hair.');
w.moveTo(BRENNA, CITY, [2100, 0, 0]);
heardAt = w.heard(BRENNA).length;
answer = say(DAGNY, '/hairdye offer ' + hex(BRENNA) + ' copper');
yes('E2 beside her, Brenna is asked, and nothing is used or changed yet (' + answer + ', ' + w.heardSince(BRENNA, heardAt).join(' | ') + ')',
  /^Asked Brenna\./.test(answer) && w.heardSince(BRENNA, heardAt).indexOf('Dagny offers to dye your hair with Copper Hair Dye. Accept or refuse on the prompt.') >= 0 &&
  colour(BRENNA) === BROWN && dyesIn(DAGNY, COPPER) === 1);
say(BRENNA, '/no');
yes('E3 she refuses: nothing changes and nothing is used', colour(BRENNA) === BROWN && dyesIn(DAGNY, COPPER) === 1);
say(DAGNY, '/hairdye offer ' + hex(BRENNA) + ' copper');
heardAt = w.heard(DAGNY).length;
w.dice(0.5);
answer = say(BRENNA, '/yes');
w.dice(null);
const brennaWant = mixed(BROWN, COPPER_RGB, COPPER.strength);
yes('E4 asked again, she accepts: her hair changes and the dye leaves Dagny\'s pack (' + answer + ', ' + c6(colour(BRENNA)) + ')',
  answer === 'Dagny dyes your hair with Copper Hair Dye.' && colour(BRENNA) === brennaWant && dyesIn(DAGNY, COPPER) === 0);
yes('E4 and Dagny is told (' + w.heardSince(DAGNY, heardAt).join(' | ') + ')', w.heardSince(DAGNY, heardAt).indexOf('You dye Brenna\'s hair with Copper Hair Dye.') >= 0);

// --------------------------------------------------------------- F. wash --
w.say(DAGNY, '/place indoors - 0 1 0 50');
w.run(1000);
w.activate(POT, DAGNY);
w.run(LIST.steepSeconds * 1000 + 1000);
w.say(DAGNY, '/place indoors - 0 1 0 40');
w.run(1000);
yes('F0 she steeps the Hair Wash', dyesIn(DAGNY, WASH) === 1);
say(DAGNY, '/hairdye offer ' + hex(BRENNA) + ' hair-wash');
const dyed = colour(BRENNA);
w.dice(0.5);
say(BRENNA, '/yes');
w.dice(null);
const washed = mixed(dyed, BROWN, WASH.strength);
yes('F1 the wash takes Brenna\'s hair ' + WASH.strength + ' of the way back to the brown she was made with (' + c6(dyed) + ' -> ' + c6(colour(BRENNA)) + ')',
  colour(BRENNA) === washed && dyesIn(DAGNY, WASH) === 0);

// ------------------------------------------------------------ G. restart --
const before = { dagny: colour(DAGNY), brenna: colour(BRENNA), made: JSON.stringify(w.prop(BRENNA, 'thornswoodHairMade') || null) };
const r = w.restart();
yes('G1 the server comes back up', r.loaded);
EVERYONE.forEach(w.arrive);
w.run(30000);
yes('G2 the colours, and the colour Brenna was made with, are where they were (' + c6(colour(DAGNY)) + ', ' + c6(colour(BRENNA)) + ')',
  colour(DAGNY) === before.dagny && colour(BRENNA) === before.brenna &&
  before.made !== 'null' && JSON.stringify(w.prop(BRENNA, 'thornswoodHairMade') || null) === before.made);

t.done(w);
