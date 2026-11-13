'use strict';
/*
  test-scenario-npcs.js

  Scenario: systems/npcs.md

  #5198. The people who are not people, end to end: the WHOLE of
  game/gamemode.js over the stand-in server (tests/stand-in-server.js), on a
  dev server with the load order the catalogue was built for and a part of
  the placements it keeps, so the NPC startup loads that cast as it does
  live (PrepareNpcLoad, LoadNpcBatch, setNpcServerControlled). A
  death is the engine's order: onDying, onDeath, and the respawn once the
  body has lain its spawnDelay, at the spawnPoint the server wrote.

    A  The cast: every placement the world's plugins have is loaded, and
       the server owns it.
    B  Transport workers show what they do: nine Coach Drivers, sixteen Ferry
       Operators and two Ship Captains, each with the title the server set.
       The sixty guild traders show their trade the same way: in each of the
       ten holds one Smith, Woodworker, Tailor, Enchanter, Cook and Alchemist,
       each named by the server for the roster's role.
    C  Home: a camp bandit's home is its catalogue place, inside its leash.
       A wild horse killed away from home lies its place's return time,
       then stands up at home, the same identity, server-owned, and with no
       second copy.
    D  Habitat: a wolf that turns up in Whiterun's market is not admitted;
       the server switches it off.
    E  A restart: the cast loads again, owned, the bandit home again, and
       the coach driver and every guild trader still titled.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  What a body carries is the dungeon loot scenario's; a guild trader's
  purse and stock are the merchants scenario's; the Thalmor patrols are the
  Thalmor's. The caps and the catalogue's own rules are in
  tests/test-npc-population-runtime.js.

  Read only, apart from its temp folders, which it removes.

      node game\tests\test-scenario-npcs.js
*/
const standIn = require('../../tests/stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const CATALOGUE = standIn.npcCatalogue();
const P = CATALOGUE.population;
const LEDGER = require('../../scripts/ops/New-AlphaMerchantLedger.js')
  .createAlphaMerchantLedger(require('../../game/data/merchant-roster.json'), require('../../game/data/npc-population.json'));
const w = standIn.world({
  name: 'npcs',
  settings: { loadOrder: P.plugins, thornswoodServer: 'dev' },
  loadOrder: P.plugins,
  files: { 'private/merchant-ledger.json': LEDGER, 'private/merchant-ledger.initialized': '1' }
});
const BANDIT_ROW = P.keep.find(function (r) { return r[0] === '15a56:Skyrim.esm'; });
const HORSE_ROW = P.keep.find(function (r) { return r[0] === '1015dd:Skyrim.esm'; });   // a wild horse: 20 minutes, the shortest return
/*
  The world's plugins place a part of the cast: the bandit's camp, the wild
  horses of one meadow, every
  transport worker, the guild's traders (whose purses the merchant ledger
  checks against them) and the wolves of one stretch of wilderness. The
  catalogue the server checks is the whole one; only the placements are
  fewer, which keeps a return quick to run.
*/
const PLACED = P.keep.filter(function (r) { return r[10] === BANDIT_ROW[10] || r[10] === HORSE_ROW[10] || r[6] === 'transport' || r[6] === 'trader' || r[10] === '[["3c:Skyrim.esm",13,5],"wolf"]'; });
w.cast({ population: Object.assign({}, P, { keep: PLACED }), types: CATALOGUE.types }, { imperial: '13744:Skyrim.esm', nord: '13746:Skyrim.esm' });
const COACH_ROW = P.keep.find(function (r) { return r[13] === 'Coach Driver'; });
/*
  The guild's sixty, read from the roster the server admits rather than from
  the catalogue rows, so a roster trader the server never names counts as
  wrong instead of being left out.
*/
const ROSTER = require('../../game/data/merchant-roster.json').merchants;
const TRADES = ['Smith', 'Woodworker', 'Tailor', 'Enchanter', 'Cook', 'Alchemist'];
function guildTitles() {
  const seen = {};
  ROSTER.forEach(function (m) {
    const shown = w.row(w.idOf(m.reference)).displayName;
    const key = shown === m.role ? m.role : 'wrong';
    seen[key] = (seen[key] || 0) + 1;
  });
  return seen;
}
function everyHoldHasEachTrade(seen) {
  const holds = new Set(ROSTER.map(function (m) { return m.bookHold; }));
  return ROSTER.length === 60 && holds.size === 10 && !seen.wrong &&
    TRADES.every(function (role) { return seen[role] === 10; });
}
const MARKET = { cell: '1a26f:Skyrim.esm', pos: [20000, -8000, -3500] };
const WOLF_BASE = '1e7a3:Skyrim.esm';
w.record(WOLF_BASE, 'NPC_', { race: '1320a:Skyrim.esm' });
const STRAY = w.ref(0xff00a101, { base: WOLF_BASE, type: 'NPC_', cell: MARKET.cell, pos: MARKET.pos });
Object.assign(w.row(STRAY), { profileId: -1, percentages: { health: 1, magicka: 1, stamina: 1 } });

const BRENNA = w.person(0xff001b00, { profileId: 1000, name: 'Brenna', prof: 'warrior', half: 'bulwark', cell: '3c:Skyrim.esm',
  pos: [BANDIT_ROW[3][0] + 3000, BANDIT_ROW[3][1], BANDIT_ROW[3][2]] });

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
w.arrive(BRENNA);
w.run(30000);

const KEPT = PLACED.map(function (r) { return w.idOf(r[0]); });
function owned(id) { const r = w.row(id); return !!r && r.serverControlled === true && !r.isDisabled; }
/* The startup loads the cast in batches over the first minutes; wait until it has stopped growing. */
function settle() { let n = -1, k = 0; while (k < 20 && KEPT.filter(owned).length !== n) { n = KEPT.filter(owned).length; w.run(15000); k++; } return n; }
settle();
function sameSpot(a, b) { return a && b && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1; }

// -------------------------------------------------------------- A. the cast --
const loaded = KEPT.filter(owned);
yes('A1 every placement the world has is loaded, and the server owns it (' + loaded.length + ' of ' + KEPT.length + ')',
    loaded.length === KEPT.length);

// --------------------------------------------------------- B. their titles --
const titled = {};
PLACED.forEach(function (r) { if (r[6] === 'transport' && w.row(w.idOf(r[0])).displayName === r[13]) { titled[r[13]] = (titled[r[13]] || 0) + 1; } });
yes('B1 nine Coach Drivers, sixteen Ferry Operators and two Ship Captains, each titled by the server (' + JSON.stringify(titled) + ')',
    titled['Coach Driver'] === 9 && titled['Ferry Operator'] === 16 && titled['Ship Captain'] === 2);
const guild = guildTitles();
yes('B2 the sixty guild traders each show their trade, ten of each across the ten holds (' + JSON.stringify(guild) + ')',
    everyHoldHasEachTrade(guild));

// ---------------------------------------------------------------- C. home --
const BANDIT = w.idOf(BANDIT_ROW[0]);
const policy = w.box().__thornswoodNpcPopulation.configure(BANDIT, { isHuman: false }) || {};
yes('C1 the camp bandit\'s home is its catalogue place, inside its leash (' + JSON.stringify(policy) + ')',
    sameSpot(policy.home, BANDIT_ROW[3]) && policy.leash === BANDIT_ROW[4]);
const HORSE = w.idOf(HORSE_ROW[0]);
yes('C2 a wild horse lies its place\'s return time: ' + HORSE_ROW[5] + ' minutes', w.prop(HORSE, 'spawnDelay') === HORSE_ROW[5] * 60);
const sameBase = function () { let n = 0; w.mp().getLoadedNpcIds().forEach(function (id) { if (w.row(id).baseDesc === HORSE_ROW[1]) { n++; } }); return n; };
const copies = sameBase();
w.moveTo(BRENNA, HORSE_ROW[2], [HORSE_ROW[3][0] + 1200, HORSE_ROW[3][1], HORSE_ROW[3][2]]);
w.moveTo(HORSE, HORSE_ROW[2], [HORSE_ROW[3][0] + 900, HORSE_ROW[3][1], HORSE_ROW[3][2]]);
w.hurtBy(HORSE, 1000, BRENNA);
yes('C3 Brenna kills it away from home', w.row(HORSE).isDead === true);
w.run((HORSE_ROW[5] * 60 - 30) * 1000);
yes('C3 it still lies just short of its return time', w.row(HORSE).isDead === true);
w.run(60 * 1000);
yes('C4 then it stands up at home, not where it fell (' + w.row(HORSE).pos.map(Math.round).join(',') + ')',
    w.row(HORSE).isDead === false && sameSpot(w.row(HORSE).pos, HORSE_ROW[3]));
yes('C4 the same identity, server-owned, and no second copy (' + copies + ' -> ' + sameBase() + ')',
    owned(HORSE) && sameBase() === copies);

// ------------------------------------------------------------- D. habitat --
yes('D1 a wolf that turns up in Whiterun\'s market is not admitted: the server switches it off', w.row(STRAY).isDisabled === true);

// ------------------------------------------------------------- E. restart --
const r = w.restart();
yes('E1 the server restarts', r.loaded);
w.arrive(BRENNA);
w.run(30000);
settle();
yes('E1 the cast loads again, owned (' + KEPT.filter(owned).length + ')', KEPT.filter(owned).length === KEPT.length);
yes('E2 the bandit owned at home again', owned(BANDIT) && sameSpot((w.box().__thornswoodNpcPopulation.configure(BANDIT, { isHuman: false }) || {}).home, BANDIT_ROW[3]));
yes('E3 and the coach driver still titled', w.row(w.idOf(COACH_ROW[0])).displayName === 'Coach Driver');
const guildAgain = guildTitles();
yes('E4 and every guild trader still shows their trade (' + JSON.stringify(guildAgain) + ')', everyHoldHasEachTrade(guildAgain));

// ------------------------------------------------------------- Z. clean --
yes('Z no handler threw and nothing the engine would refuse was done (' + w.faults.slice(0, 3).join(' | ') + ')', w.faults.length === 0);
yes('Z no timer threw (' + w.threw.slice(0, 2).join(' | ') + ')', w.threw.length === 0);
yes('Z the gamemode logged no handler error (' + w.logged(/\] on[A-Z][A-Za-z]+ threw/).slice(0, 2).join(' | ') + ')',
    w.logged(/\] on[A-Z][A-Za-z]+ threw/).length === 0);
t.done(w);
