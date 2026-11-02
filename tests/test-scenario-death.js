'use strict';
/*
  test-scenario-death.js

  Scenario: systems/death.md

  #5198. Where a death wakes, and what a kill is worth: the WHOLE of
  game/gamemode.js over the stand-in server (tests/stand-in-server.js), on a
  dev server with every placed person the catalogue keeps, so the four
  bandits of Halted Stream Camp are loaded and server-controlled as they are
  live. A death is the engine's order: onDying, onDeath, and the respawn once
  the body has lain its spawnDelay, standing a character up at the
  spawnPoint the gamemode wrote.

  Brenna is a warrior (bulwark) and Corvin a tailor.

    A  The world kills Brenna at the camp, with nobody to blame: the wake is
       Whiterun's temple, and she stands up there after the engine's 25
       seconds.
    B  Outside Windhelm the wake is Windhelm's temple, and in a room the
       load order puts in the Rift it is Riften's.
    C  On Solstheim the nearer door wins: the Retching Netch by its door,
       the Raven Rock temple by its.
    D  Blackreach has no temple, temple or inn of its own: come into from a
       room of the Reach, the wake is Markarth's temple; with no door written
       down it is the fallback at Whiterun, and the log says why.
    E  Brenna kills a bandit: her bulwark work rises by the bandit's two
       pieces. Corvin, a tailor, kills one and nothing is counted. Brenna
       killing Corvin counts for nothing, and Corvin wakes at a temple; a
       fall, where she is her own killer, counts for nothing.
    F  A wolf lies 5 minutes for a hunter; no wake is written onto a bandit
       or a wolf.
    G  The server restarts: the wake written on Brenna is still there, and
       her bulwark work is as it was.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  Read only, apart from its temp folders, which it removes.

      node tests\test-scenario-death.js
*/
const standIn = require('./stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const CATALOGUE = standIn.npcCatalogue();
const P = CATALOGUE.population;
const DATA = require('../game/gamemode-tables/DATA.json');
const RACES = { imperial: '13744:Skyrim.esm', breton: '13741:Skyrim.esm' };
const CAMP = ['50533:Skyrim.esm', '50549:Skyrim.esm', '5054a:Skyrim.esm', '5054e:Skyrim.esm'];
const AT_CAMP = { cell: '3c:Skyrim.esm', pos: [15600, 20000, -4300] };       // Tamriel, Whiterun hold
const OUTSIDE_WINDHELM = { cell: '1691d:Skyrim.esm', pos: [132900, 37900, -11800] };
const RIFT_ROOM = Object.keys(DATA.cellToHold).find(function (c) { return DATA.cellToHold[c] === 'RiftHoldLocation'; });
const REACH_ROOM = Object.keys(DATA.cellToHold).find(function (c) { return DATA.cellToHold[c] === 'ReachHoldLocation'; });
const SOLSTHEIM = '800:Dragonborn.esm';
const SOLSTHEIM_WAKES = DATA.ownWorlds[SOLSTHEIM];
const NETCH = SOLSTHEIM_WAKES.find(function (w) { return w.kind === 'inn'; });
const RR_TEMPLE = SOLSTHEIM_WAKES.find(function (w) { return w.kind === 'temple'; });
const BLACKREACH = '2ee41:Skyrim.esm';
const INTO_BLACKREACH = Object.keys(DATA.ownWorldDoors).find(function (d) { return DATA.ownWorldDoors[d] === BLACKREACH; });
const TEMPLE = {
  whiterun: DATA.destinations.whiterun.temple, windhelm: DATA.destinations.windhelm.temple,
  riften: DATA.destinations.riften.temple, markarth: DATA.destinations.markarth.temple
};
const WOLF_BASE = '10fe05:Skyrim.esm';

const LEDGER = require('../scripts/ops/New-AlphaMerchantLedger.js')
  .createAlphaMerchantLedger(require('../game/data/merchant-roster.json'), require('../game/data/npc-population.json'));

const w = standIn.world({
  name: 'death',
  settings: { loadOrder: P.plugins, thornswoodServer: 'dev' },
  loadOrder: P.plugins,
  files: { 'private/merchant-ledger.json': LEDGER, 'private/merchant-ledger.initialized': '1' }
});
w.cast(CATALOGUE, RACES);
w.record(WOLF_BASE, 'NPC_', { race: '1320a:Skyrim.esm' });
const WOLF = w.ref(0xff00a001, { base: WOLF_BASE, type: 'NPC_', cell: AT_CAMP.cell, pos: [15900, 20200, -4300] });
w.ref(w.idOf(INTO_BLACKREACH), { base: '1ef3a:Skyrim.esm', type: 'DOOR', cell: REACH_ROOM, pos: [0, 0, 0] });

const BRENNA = w.person(0xff000c00, { profileId: 1000, name: 'Brenna', prof: 'warrior', half: 'bulwark', cell: AT_CAMP.cell, pos: AT_CAMP.pos });
const CORVIN = w.person(0xff000c01, { profileId: 1002, name: 'Corvin', prof: 'tailor', cell: AT_CAMP.cell, pos: [AT_CAMP.pos[0] + 60, AT_CAMP.pos[1], AT_CAMP.pos[2]] });

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
[BRENNA, CORVIN].forEach(w.arrive);
w.run(30000);
const BANDITS = CAMP.map(function (d) { return w.idOf(d); });
yes('P1 the four bandits of the camp are loaded and server-controlled',
  BANDITS.every(function (b) { return w.row(b) && w.row(b).serverControlled === true && !w.row(b).isDead; }));

function wake(a) { return w.prop(a, 'spawnPoint') || {}; }
function wokeAt(a, place) { const sp = wake(a); return sp.cellOrWorldDesc === place.desc && JSON.stringify(sp.pos) === JSON.stringify(place.pos); }
function work(a) { return ((w.prop(a, 'thornswoodCharacter') || {}).work || {}).bulwark || 0; }
function workOf(a, key) { return ((w.prop(a, 'thornswoodCharacter') || {}).work || {})[key] || 0; }
function dieAt(a, place, killer) { w.moveTo(a, place.cell, place.pos); w.run(500); w.die(a, killer || 0); w.run(500); }

// ------------------------------------------------------------ A. the world --
w.die(BRENNA, 0, null);
yes('A1 the world kills Brenna at the camp: the wake is Whiterun\'s temple (' + JSON.stringify(wake(BRENNA)) + ')',
  wokeAt(BRENNA, TEMPLE.whiterun));
w.run(24000);
yes('A2 she still lies there at 24 seconds', w.row(BRENNA).isDead === true);
w.run(1500);
w.respawn(BRENNA);   // the engine's RespawnWithDelay timer, at 25 seconds
yes('A3 she stands up in the Temple of Kynareth (' + w.row(BRENNA).worldOrCellDesc + ')',
  w.row(BRENNA).isDead === false && w.row(BRENNA).worldOrCellDesc === TEMPLE.whiterun.desc);

// --------------------------------------------------------------- B. holds --
dieAt(BRENNA, OUTSIDE_WINDHELM);
yes('B1 outside Windhelm the wake is Windhelm\'s temple (' + w.row(BRENNA).worldOrCellDesc + ')',
  wokeAt(BRENNA, TEMPLE.windhelm) && w.row(BRENNA).worldOrCellDesc === TEMPLE.windhelm.desc);
dieAt(BRENNA, { cell: RIFT_ROOM, pos: [0, 0, 0] });
yes('B2 in a room of the Rift it is Riften\'s (' + w.row(BRENNA).worldOrCellDesc + ')', wokeAt(BRENNA, TEMPLE.riften));

// ----------------------------------------------------------- C. Solstheim --
dieAt(BRENNA, { cell: SOLSTHEIM, pos: [NETCH.door[0] + 200, NETCH.door[1] + 200, 0] });
yes('C1 on Solstheim beside the Retching Netch\'s door, the wake is the inn (' + w.row(BRENNA).worldOrCellDesc + ')',
  wokeAt(BRENNA, NETCH));
dieAt(BRENNA, { cell: SOLSTHEIM, pos: [RR_TEMPLE.door[0] + 200, RR_TEMPLE.door[1] - 200, 0] });
yes('C2 beside the Raven Rock temple\'s door, the temple (' + w.row(BRENNA).worldOrCellDesc + ')', wokeAt(BRENNA, RR_TEMPLE));

// ---------------------------------------------------------- D. Blackreach --
dieAt(CORVIN, { cell: BLACKREACH, pos: [1000, 1000, 0] });
yes('D1 Corvin in Blackreach with no door written down wakes at the fallback, Whiterun (' + w.row(CORVIN).worldOrCellDesc + ')',
  wokeAt(CORVIN, TEMPLE.whiterun));
yes('D2 and the death log says why', w.logged(/own-world-no-door/).length > 0);
w.moveTo(BRENNA, REACH_ROOM, [10, 10, 0]);
w.activate(w.idOf(INTO_BLACKREACH), BRENNA);
w.run(500);
dieAt(BRENNA, { cell: BLACKREACH, pos: [1000, 1000, 0] });
yes('D3 Brenna came into Blackreach from a room of the Reach: Markarth\'s temple (' + w.row(BRENNA).worldOrCellDesc + ')',
  wokeAt(BRENNA, TEMPLE.markarth));

// ---------------------------------------------------- E. what a kill is worth --
w.moveTo(BRENNA, AT_CAMP.cell, AT_CAMP.pos);
w.moveTo(CORVIN, AT_CAMP.cell, [AT_CAMP.pos[0] + 60, AT_CAMP.pos[1], AT_CAMP.pos[2]]);
w.run(1000);
let before = work(BRENNA);
w.die(BANDITS[0], BRENNA, null);
w.run(500);
yes('E1 Brenna kills a bandit: her bulwark work rises by its two pieces (' + before + ' -> ' + work(BRENNA) + ')', work(BRENNA) === before + 2);
const corvinWork = JSON.stringify((w.prop(CORVIN, 'thornswoodCharacter') || {}).work || {});
w.die(BANDITS[1], CORVIN, null);
w.run(500);
yes('E2 Corvin, a tailor, kills one and nothing is counted (' + JSON.stringify((w.prop(CORVIN, 'thornswoodCharacter') || {}).work || {}) + ')',
  JSON.stringify((w.prop(CORVIN, 'thornswoodCharacter') || {}).work || {}) === corvinWork);
before = work(BRENNA);
w.die(CORVIN, BRENNA);
w.run(500);
yes('E3 Brenna killing Corvin counts for nothing (' + work(BRENNA) + ')', work(BRENNA) === before);
yes('E4 and Corvin wakes at Whiterun\'s temple (' + w.row(CORVIN).worldOrCellDesc + ')',
  w.row(CORVIN).isDead === false && wokeAt(CORVIN, TEMPLE.whiterun));
w.moveTo(BRENNA, AT_CAMP.cell, AT_CAMP.pos);
w.die(BRENNA, BRENNA);
w.run(500);
yes('E5 a fall, where she is her own killer, counts for nothing (' + work(BRENNA) + ')', work(BRENNA) === before);

// --------------------------------------------------------- F. bodies --
w.die(WOLF, BRENNA, null);
w.run(500);
yes('F1 a wolf lies 5 minutes for a hunter (' + w.prop(WOLF, 'spawnDelay') + ' seconds)', w.prop(WOLF, 'spawnDelay') === 300);
yes('F2 no wake is written onto a bandit or a wolf',
  w.prop(BANDITS[0], 'spawnPoint') === undefined && w.prop(WOLF, 'spawnPoint') === undefined);

// ------------------------------------------------------------- G. restart --
const wakeWas = JSON.stringify(wake(BRENNA)), workWas = work(BRENNA);
const r = w.restart();
yes('G1 the server comes back up', r.loaded);
[BRENNA, CORVIN].forEach(w.arrive);
w.run(30000);
yes('G2 the wake written on Brenna and her bulwark work are as they were (' + workWas + ')',
  JSON.stringify(wake(BRENNA)) === wakeWas && work(BRENNA) === workWas && workWas > 0 && workOf(CORVIN, 'bulwark') === 0);

t.done(w);
