'use strict';
/*
  test-scenario-quests.js

  Scenario: systems/quests.md

  #5198. A scene quest from a guild trader, end to end: the WHOLE of
  game/gamemode.js over the stand-in server (tests/stand-in-server.js), on a
  dev server with the merchant catalogue's load order, the alpha merchant
  ledger and every placed person the catalogue keeps, so the Whiterun
  Smith and the four bandits of Halted Stream Camp are loaded and
  server-controlled as they are live. The quest's record on the character
  is written with the engine's compare-and-set on a hidden property, and
  the reward with its compare-and-set on the pack.

  Brenna is a smith and Corvin a tailor. "The camp": kill three bandits in
  the camp the trader names, 45 gold, 6 hours.

    A  At the Whiterun Smith the camp is offered to both of them: open to
       anyone, its place, its gold, its count and its hours. The Tailor's
       Novice Warrior work is locked for Brenna, a smith (Who may take one).
    B  Brenna takes it; a second copy is refused.
    C  A bandit Corvin kills does not count for her, and she cannot turn the
       work in with nothing done.
    D  She kills the other three in the camp, and the work is ready.
    E  She turns it in at the Smith: 45 gold is made, the trader's purse is
       not touched, and the work rests for 6 hours; taking it again is
       refused.
    F  Corvin takes it and leaves it: nothing is paid and no rest starts.
    G  The server restarts: her rest and his free work are as they were.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  Read only, apart from its temp folders, which it removes.

      node game\tests\test-scenario-quests.js
*/
const standIn = require('../../tests/stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const CATALOGUE = standIn.npcCatalogue();
const P = CATALOGUE.population;
const ROSTER = require('../../game/data/merchant-roster.json');
const LEDGER = require('../../scripts/ops/New-AlphaMerchantLedger.js')
  .createAlphaMerchantLedger(ROSTER, require('../../game/data/npc-population.json'));
function placedTrader(hold, role) {
  const row = ROSTER.merchants.find(function (m) { return m.bookHold === hold && m.role === role; });
  const kept = P.keep.find(function (r) { return r[0] === row.reference; });
  return { desc: row.reference, cell: kept[2], beside: [kept[3][0] + 50, kept[3][1], kept[3][2]] };
}
const SMITH_AT = placedTrader('whiterun', 'Smith');
const TAILOR_AT = placedTrader('whiterun', 'Tailor');
// The races of the placed people the camp names (Skyrim.esm's playable races).
const RACES = { imperial: '13744:Skyrim.esm', breton: '13741:Skyrim.esm' };
const CAMP = ['50533:Skyrim.esm', '50549:Skyrim.esm', '5054a:Skyrim.esm', '5054e:Skyrim.esm'];
const AT_CAMP = { cell: '3c:Skyrim.esm', pos: [15600, 20000, -4300] };   // Tamriel, among the camp's tents
const GOLD = 0xf;

const w = standIn.world({
  name: 'quests',
  settings: { loadOrder: P.plugins, thornswoodServer: 'dev' },
  loadOrder: P.plugins,
  files: { 'private/merchant-ledger.json': LEDGER, 'private/merchant-ledger.initialized': '1' }
});
w.cast(CATALOGUE, RACES);

const BRENNA = w.person(0xff000c00, { profileId: 1000, name: 'Brenna', prof: 'smith', half: 'platewright', town: 'whiterun', cell: SMITH_AT.cell, pos: SMITH_AT.beside });
const CORVIN = w.person(0xff000c01, { profileId: 1002, name: 'Corvin', prof: 'tailor', town: 'whiterun', cell: SMITH_AT.cell,
  pos: [SMITH_AT.beside[0], SMITH_AT.beside[1] + 40, SMITH_AT.beside[2]] });

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
[BRENNA, CORVIN].forEach(w.arrive);
w.run(30000);
const SMITH = w.idOf(SMITH_AT.desc), TAILOR = w.idOf(TAILOR_AT.desc);
const BANDITS = CAMP.map(function (d) { return w.idOf(d); });
yes('P1 the four bandits of the camp are loaded and server-controlled',
  BANDITS.every(function (b) { return w.row(b) && w.row(b).serverControlled === true && !w.row(b).isDead; }));
function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function view(a) { return w.prop(a, 'thornswoodMerchantView') || {}; }
function quest(a, id) { return (view(a).quests || []).find(function (q) { return q.id === id; }) || {}; }
function atSmith(a) { w.moveTo(a, SMITH_AT.cell, a === BRENNA ? SMITH_AT.beside : [SMITH_AT.beside[0], SMITH_AT.beside[1] + 40, SMITH_AT.beside[2]]); w.activate(SMITH, a); w.run(500); }
function say(a, text) { w.say(a, text); w.run(300); return last(a); }
let answer = '';

// ----------------------------------------------------------- A. the offer --
atSmith(BRENNA);
atSmith(CORVIN);
const camp = quest(BRENNA, 'camp');
yes('A1 the Whiterun Smith offers the camp: three bandits at Halted Stream Camp, 45 gold, 6 hours (' + JSON.stringify([camp.count, camp.locations, camp.gold, camp.hours]) + ')',
  camp.kind === 'kill' && camp.count === 3 && camp.locations === 'Halted Stream Camp' && camp.gold === 45 && camp.hours === 6);
yes('A2 open to anyone: Brenna and Corvin can both take it (' + camp.state + ', ' + quest(CORVIN, 'camp').state + ')',
  camp.state === 'available' && camp.canTake === true && quest(CORVIN, 'camp').canTake === true);
w.moveTo(BRENNA, TAILOR_AT.cell, TAILOR_AT.beside);
w.activate(TAILOR, BRENNA);
w.run(500);
const road = quest(BRENNA, 'q-whiterun-tailor-cloth-road');
yes('A3 the Tailor\'s Novice Warrior work is locked for Brenna, a smith (' + road.who + ', ' + road.state + ')',
  road.who === 'Novice Warrior' && road.state === 'locked' && road.canTake === false);
atSmith(BRENNA);

// ------------------------------------------------------------- B. take it --
answer = say(BRENNA, '/merchant quest take camp @0');
yes('B1 Brenna takes it (' + answer + ')', answer === 'You take the work.' && quest(BRENNA, 'camp').state === 'open' && quest(BRENNA, 'camp').kills === 0);
answer = say(BRENNA, '/merchant quest take camp @0');
yes('B2 a second copy is refused (' + answer + ')', answer === 'You already hold this work.');

// ------------------------------------------------- C. kills that do not count --
w.moveTo(CORVIN, AT_CAMP.cell, AT_CAMP.pos);
w.die(BANDITS[3], CORVIN, null);
w.run(500);
atSmith(BRENNA);
yes('C1 a bandit Corvin kills does not count for her (' + quest(BRENNA, 'camp').kills + ')', quest(BRENNA, 'camp').kills === 0);
answer = say(BRENNA, '/merchant quest return camp @0');
yes('C2 she cannot turn it in with nothing done (' + answer + ')', answer === 'You have not drawn enough to turn this work in.' && quest(BRENNA, 'camp').canReturn === false);

// ------------------------------------------------------------ D. the camp --
w.moveTo(BRENNA, AT_CAMP.cell, AT_CAMP.pos);
w.run(1000);
BANDITS.slice(0, 3).forEach(function (b) { w.die(b, BRENNA, null); w.run(500); });
atSmith(BRENNA);
yes('D1 she kills the other three and the work is ready (' + quest(BRENNA, 'camp').kills + ')',
  quest(BRENNA, 'camp').kills === 3 && quest(BRENNA, 'camp').canReturn === true);

// ------------------------------------------------------------ E. turn in --
const gold = w.count(BRENNA, GOLD), purse = view(BRENNA).purse;
answer = say(BRENNA, '/merchant quest return camp @0');
yes('E1 she turns it in at the Smith (' + answer + ')', answer === 'The work is turned in.');
yes('E2 45 gold is made, and the trader\'s purse is not touched (' + (w.count(BRENNA, GOLD) - gold) + ', ' + view(BRENNA).purse + ')',
  w.count(BRENNA, GOLD) === gold + 45 && view(BRENNA).purse === purse && purse === 250);
yes('E3 the work rests for 6 hours (' + quest(BRENNA, 'camp').state + ', ' + quest(BRENNA, 'camp').waitMinutes + ' minutes)',
  quest(BRENNA, 'camp').state === 'cooldown' && quest(BRENNA, 'camp').waitMinutes === 360);
answer = say(BRENNA, '/merchant quest take camp @0');
yes('E4 taking it again is refused (' + answer + ')', answer === 'This work is still resting.');

// -------------------------------------------------------------- F. leave it --
w.respawn(BANDITS[3]);
atSmith(CORVIN);
answer = say(CORVIN, '/merchant quest take camp @0');
yes('F1 Corvin takes the camp too: Brenna\'s rest is hers (' + answer + ')', answer === 'You take the work.');
const corvinGold = w.count(CORVIN, GOLD);
answer = say(CORVIN, '/merchant quest abandon camp @0');
yes('F2 he leaves it: nothing is paid and no rest starts (' + answer + ', ' + quest(CORVIN, 'camp').state + ')',
  /leave the work/.test(answer) && w.count(CORVIN, GOLD) === corvinGold && quest(CORVIN, 'camp').state === 'available');

// ------------------------------------------------------------- G. restart --
const r = w.restart();
yes('G1 the server comes back up', r.loaded);
[BRENNA, CORVIN].forEach(w.arrive);
w.run(30000);
atSmith(BRENNA);
atSmith(CORVIN);
yes('G2 her rest and his free work are as they were (' + quest(BRENNA, 'camp').state + ', ' + quest(CORVIN, 'camp').state + ')',
  quest(BRENNA, 'camp').state === 'cooldown' && quest(CORVIN, 'camp').state === 'available');

t.done(w);
