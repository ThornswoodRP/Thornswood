'use strict';
/*
  test-scenario-merchants.js

  Scenario: systems/merchants-guild.md

  #5198. Trading with a guild trader, end to end: the WHOLE of
  game/gamemode.js over the stand-in server (tests/stand-in-server.js), on a
  dev server with the load order the merchant catalogue was built for, the
  alpha merchant ledger the box is given (scripts/ops/New-AlphaMerchantLedger.js)
  and every placed person the catalogue keeps, so the NPC startup loads the
  cast, checks the sixty traders' roles against their records and opens
  their purses. Every trade goes through the engine's inventory receipts:
  the gamemode's compare-and-set on the person's pack, then the save
  storage's acknowledgement in a later tick, then the second half.

  Brenna holds Business Owner. Corvin does not. The Windhelm Smith has the
  250 gold purse every trader starts with and an empty shelf.

    A  Before any list is submitted, the Smith's panel opens and says it has
       no buy prices. Corvin cannot found a business. Brenna founds one and
       prices Iron Ingot at 7 to the trader and 10 from it; submitting away
       from the hold's board is refused, at Windhelm's board it is accepted.
    B  The panel shows the line, what she carries and how many she can sell.
    C  She sells 5. The trade waits on the save, then within two seconds the
       ingots are on the shelf, the gold in her pack, the purse down by 35,
       the panel says "Sold" (#5419) and the hold counts it.
    D  She buys 2 back: the same, the other way.
    E  Refusals, and nothing moves: more than the shelf holds, more than she
       carries, an item the Smith does not trade, more than the purse can
       pay, and trading from across the room, which closes the panel.
    F  While the save storage acknowledges nothing, a sale takes the ingot
       and pays nothing yet, and her next trade waits for it; when the
       saves land, the gold arrives and the sale is said.
    G  Supply: five ingots for 35, then the same supply is not due again.
    H  The server restarts: the purse, the shelf and the price list are what
       they were, and the panel opens on them.
    I  A commission: with Fur Boots and Stormcloak Officer Bracers priced,
       the Smith's novice parcel pays 21; she takes it and turns the goods
       in, the purse pays once the save lands, and the panel says so.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  Read only, apart from its temp folders, which it removes.

      node tests\test-scenario-merchants.js
*/
const standIn = require('./stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const CATALOGUE = standIn.npcCatalogue();
const P = CATALOGUE.population;
const ROSTER = require('../game/data/merchant-roster.json');
const LEDGER = require('../scripts/ops/New-AlphaMerchantLedger.js')
  .createAlphaMerchantLedger(ROSTER, require('../game/data/npc-population.json'));
const SMITH_ROW = ROSTER.merchants.find(function (m) { return m.bookHold === 'windhelm' && m.role === 'Smith'; });
const PLACED = P.keep.find(function (r) { return r[0] === SMITH_ROW.reference; });
const SHOP = PLACED[2];
const AT_SMITH = [PLACED[3][0] + 100, PLACED[3][1], PLACED[3][2]];
const BOARD = { cell: '1691d:Skyrim.esm', pos: [134265.1, 35842.3, -12397.5] };   // Windhelm's notice board
const GOLD = 0xf, IRON = 0x5ace4;                // Iron Ingot, Skyrim.esm: in the Smith's buy, sell and supply tables
const GARLIC = 0x34d22;                           // Garlic, Skyrim.esm: a cook's ingredient, not the Smith's

const w = standIn.world({
  name: 'merchants',
  settings: { loadOrder: P.plugins, thornswoodServer: 'dev' },
  loadOrder: P.plugins,
  files: {
    'private/merchant-ledger.json': LEDGER,
    'private/merchant-ledger.initialized': '1',
    'private/allowed.json': { profiles: [1000, 1002], accounts: { 1000: 'acct-brenna', 1002: 'acct-corvin' }, businessOwnerProfiles: [1000] }
  }
});
w.cast(CATALOGUE);
w.record(w.descOf(GARLIC), 'INGR');

const BRENNA = w.person(0xff000b00, { profileId: 1000, name: 'Brenna', prof: 'smith', half: 'platewright', town: 'windhelm', cell: SHOP, pos: AT_SMITH,
  inventory: { entries: [{ baseId: GOLD, count: 300 }, { baseId: IRON, count: 20 }, { baseId: GARLIC, count: 3 }] } });
const CORVIN = w.person(0xff000b01, { profileId: 1002, name: 'Corvin', prof: 'tailor', town: 'windhelm', cell: SHOP, pos: [AT_SMITH[0], AT_SMITH[1] + 60, AT_SMITH[2]] });

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
[BRENNA, CORVIN].forEach(w.arrive);
w.run(30000);
const SMITH = w.idOf(SMITH_ROW.reference);
const trade = w.box().__thornswoodMerchantTrade;
yes('P1 the NPC startup loaded the Windhelm Smith and trading runs on the native transfer',
  !!trade && trade.nativeReady() === true && w.row(SMITH) && w.row(SMITH).type === 'NPC_');
function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function view() { return w.prop(BRENNA, 'thornswoodMerchantView') || {}; }
function iron() { return (view().offers || []).find(function (o) { return o.name === 'Iron Ingot'; }) || {}; }
function counted(kind) {
  const days = w.box().__thornswoodEconomy.snapshot().days || {};
  let n = 0;
  Object.keys(days).forEach(function (d) {
    const k = ((days[d].windhelm || {})[kind]) || {};
    Object.keys(k).forEach(function (item) { n += k[item]; });
  });
  return n;
}
function pack() { return { gold: w.count(BRENNA, GOLD), iron: w.count(BRENNA, IRON) }; }
function say(text) { w.say(BRENNA, text); w.run(300); return last(BRENNA); }
let answer = '';

// ------------------------------------------------------------- A. prices --
w.activate(SMITH, BRENNA);
w.run(500);
yes('A1 the Smith\'s panel opens on its 250 gold purse (' + last(BRENNA) + ')', /^Trading with Smith in Windhelm\. Purse 250\./.test(last(BRENNA)) && view().open === true);
yes('A2 before any list is submitted the trader has no buy prices (' + view().sellReason + ')', view().sellReason === 'This trader has no submitted buy prices.');
w.say(CORVIN, '/book new business Corvin\'s Cloth');
yes('A3 Corvin, without Business Owner, cannot found a business (' + last(CORVIN) + ')', last(CORVIN) === 'Your Discord account does not hold Business Owner.');
yes('A4 Brenna founds one', say('/book new business Brenna\'s Forge') === 'Founded Brenna\'s Forge.');
yes('A5 and prices Iron Ingot', say('/book price Brenna\'s Forge Iron Ingot | 7 | 10') === 'Set Iron Ingot in Brenna\'s Forge.');
answer = say('/book submit Brenna\'s Forge');
yes('A6 submitting away from the hold\'s board is refused (' + answer + ')', answer === 'Stand at the hold\'s notice board, then submit the list.');
w.moveTo(BRENNA, BOARD.cell, BOARD.pos);
w.run(2000);
answer = say('/book submit Brenna\'s Forge');
yes('A7 at Windhelm\'s board it is accepted (' + answer + ')', /^Submitted Brenna's Forge to windhelm's box\./.test(answer));
w.moveTo(BRENNA, SHOP, AT_SMITH);
w.run(2000);

// -------------------------------------------------------------- B. panel --
w.activate(SMITH, BRENNA);
w.run(500);
yes('B1 the panel shows the line at 7 to the trader and 10 from it (' + JSON.stringify(iron()) + ')', iron().buy === 7 && iron().sell === 10);
yes('B2 and that she carries 20 and can sell all 20, with nothing on the shelf', iron().carried === 20 && iron().maxSell === 20 && iron().stock === 0);

// --------------------------------------------------------------- C. sell --
let before = pack();
answer = say('/merchant sell 5 Iron Ingot');
yes('C1 she sells 5, and the trade waits on the save (' + answer + ')', answer === 'The transfer is waiting on the save.');
w.run(2000);
let after = pack();
yes('C2 within two seconds the 5 ingots left her pack and 35 gold came in (' + JSON.stringify(after) + ')',
  after.iron === before.iron - 5 && after.gold === before.gold + 35);
yes('C3 the purse is down by 35 and the 5 are on the shelf (' + view().purse + ', ' + iron().stock + ')', view().purse === 215 && iron().stock === 5);
yes('C4 the panel says the sale went through, not that it still waits (#5419) (' + view().note + ')', view().note === 'Sold 5 Iron Ingot for 35. Purse 215.');
yes('C5 and the hold counts the 5 sold', counted('sold') === 5);

// ---------------------------------------------------------------- D. buy --
before = pack();
yes('D1 she buys 2 back, and that waits on the save too', say('/merchant buy 2 Iron Ingot') === 'The transfer is waiting on the save.');
w.run(2000);
after = pack();
yes('D2 the 2 are back in her pack and 20 gold left it (' + JSON.stringify(after) + ')', after.iron === before.iron + 2 && after.gold === before.gold - 20);
yes('D3 the purse is up by 20, the shelf holds 3, and the panel says so (' + view().note + ')',
  view().purse === 235 && iron().stock === 3 && view().note === 'Bought 2 Iron Ingot for 20. Purse 235.');
yes('D4 and the hold counts the 2 bought', counted('bought') === 2);

// ----------------------------------------------------------- E. refusals --
before = pack();
answer = say('/merchant buy 4 Iron Ingot');
yes('E1 more than the shelf holds is refused (' + answer + ')', answer === 'The shelf is empty.');
answer = say('/merchant sell 25 Iron Ingot');
yes('E2 more than she carries is refused (' + answer + ')', answer === 'You are not carrying that.');
answer = say('/merchant sell 1 Garlic');
yes('E3 an item the Smith does not trade is refused (' + answer + ')', answer === 'This trader does not buy that item.');
w.give(BRENNA, IRON, 30);
answer = say('/merchant sell 34 Iron Ingot');
yes('E4 more than the purse can pay is refused (' + answer + ')', answer === 'The trader cannot pay from its unreserved purse.');
w.row(BRENNA).inventory.entries.find(function (e) { return e.baseId === IRON; }).count -= 30;
after = pack();
yes('E5 none of those moved a coin or an ingot', after.iron === before.iron && after.gold === before.gold && view().purse === 235 && iron().stock === 3);
w.moveTo(BRENNA, SHOP, [AT_SMITH[0] + 600, AT_SMITH[1], AT_SMITH[2]]);
answer = say('/merchant sell 1 Iron Ingot');
yes('E6 from across the room she is not close enough (' + answer + ')', answer === 'You are not close enough to trade.');
yes('E7 and the panel closed', view().open === false);
w.moveTo(BRENNA, SHOP, AT_SMITH);
w.activate(SMITH, BRENNA);
w.run(500);

// ------------------------------------------------- F. the save storage lags --
before = pack();
w.holdSaves(true);
yes('F1 while the saves are held, a sale of 1 waits on the save', say('/merchant sell 1 Iron Ingot') === 'The transfer is waiting on the save.');
w.run(5000);
after = pack();
yes('F2 the ingot has left her pack and no gold has come yet (' + JSON.stringify(after) + ')', after.iron === before.iron - 1 && after.gold === before.gold);
yes('F3 the purse has not paid it and the panel still says it waits (' + view().purse + ', ' + view().note + ')',
  view().purse === 235 && view().note === 'The transfer is waiting on the save.');
answer = say('/merchant sell 1 Iron Ingot');
yes('F4 her next trade waits for it (' + answer + ')', answer === 'This trader has a transfer waiting.');
w.holdSaves(false);
w.run(3000);
after = pack();
yes('F5 once the saves land, the 7 gold arrives and only the one ingot went (' + JSON.stringify(after) + ')', after.iron === before.iron - 1 && after.gold === before.gold + 7);
yes('F6 and the panel says the sale (' + view().note + ')', view().purse === 228 && view().note === 'Sold 1 Iron Ingot for 7. Purse 228.');

// -------------------------------------------------------------- G. supply --
before = pack();
yes('G1 she turns in a supply of Iron Ingot', say('/merchant supply Iron Ingot') === 'The transfer is waiting on the save.');
w.run(2000);
after = pack();
yes('G2 five ingots for 35 (' + JSON.stringify(after) + ')', after.iron === before.iron - 5 && after.gold === before.gold + 35 && view().purse === 193);
answer = say('/merchant supply Iron Ingot');
yes('G3 the same supply is not due again (' + answer + ')', answer === 'That supply is not due.');

// ------------------------------------------------------------- H. restart --
const kept = { purse: view().purse, stock: iron().stock, gold: pack().gold };
const r = w.restart();
yes('H1 the server comes back up', r.loaded);
w.arrive(BRENNA);
w.run(30000);
w.activate(SMITH, BRENNA);
w.run(500);
yes('H2 the purse, the shelf and the price list are what they were (' + JSON.stringify([view().purse, iron().stock, iron().buy, iron().sell]) + ')',
  view().purse === kept.purse && iron().stock === kept.stock && iron().buy === 7 && iron().sell === 10);
yes('H3 and she can trade on: buying 1 settles', say('/merchant buy 1 Iron Ingot') === 'The transfer is waiting on the save.' &&
  (w.run(2000), pack().gold === kept.gold - 10 && view().note === 'Bought 1 Iron Ingot for 10. Purse ' + (kept.purse + 10) + '.'));

// ---------------------------------------------------------- I. commission --
const BOOTS = 0xa6d7f, BRACERS = 0x86983;        // Fur Boots, Stormcloak Officer Bracers: the novice parcel's goods
const PARCEL = 'q-windhelm-smith-novice-parcel';
function parcel() { return (view().quests || []).find(function (q) { return q.id === PARCEL; }) || {}; }
say('/book price Brenna\'s Forge Fur Boots | 12 | -');
say('/book price Brenna\'s Forge Stormcloak Officer Bracers | 9 | -');
w.moveTo(BRENNA, BOARD.cell, BOARD.pos);
w.run(2000);
say('/book submit Brenna\'s Forge');
w.moveTo(BRENNA, SHOP, AT_SMITH);
w.give(BRENNA, BOOTS, 1);
w.give(BRENNA, BRACERS, 1);
w.activate(SMITH, BRENNA);
w.run(500);
yes('I1 with the parcel\'s goods priced, the Smith offers its novice parcel for 21 gold (' + parcel().state + ', ' + parcel().gold + ')',
  parcel().state === 'available' && parcel().gold === 21 && typeof parcel().quoteToken === 'string');
answer = say('/merchant quest take ' + PARCEL + ' @' + parcel().quoteToken);
yes('I2 she takes it (' + answer + ')', answer === 'You take the work.' && parcel().state === 'open' && parcel().canReturn === true);
before = pack();
const parcelPurse = view().purse;
answer = say('/merchant quest return ' + PARCEL + ' @' + parcel().token);
yes('I3 she turns it in, and the transfer waits on the save (' + answer + ')', answer === 'The transfer is waiting for its saved inventory.');
w.run(2000);
yes('I4 the boots and bracers left her pack and 21 gold came in (' + JSON.stringify([w.count(BRENNA, BOOTS), w.count(BRENNA, BRACERS), pack().gold - before.gold]) + ')',
  w.count(BRENNA, BOOTS) === 0 && w.count(BRENNA, BRACERS) === 0 && pack().gold === before.gold + 21);
yes('I5 the purse paid it, and the panel says the turn-in went through (#5419) (' + view().note + ')',
  view().purse === parcelPurse - 21 && view().note === 'The work is turned in. Paid 21 gold.' && parcel().state === 'cooldown');

t.done(w);
