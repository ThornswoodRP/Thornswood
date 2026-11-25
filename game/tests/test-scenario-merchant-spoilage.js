'use strict';
/* Scenario: systems/spoilage.md
   A real named-food sale to a guild Cook, then a stale buy after a real-day
   clock jump. Date.now is the server's wall clock; native receipt ticks stay
   in their ordinary order rather than running every game timer for two days.
*/
const standIn = require('../../tests/stand-in-server.js');
const t = standIn.checks(), yes = t.yes;
const catalogue = standIn.npcCatalogue(), population = catalogue.population;
const roster = require('../data/merchant-roster.json');
const ledger = require('../../scripts/ops/New-AlphaMerchantLedger.js')
  .createAlphaMerchantLedger(roster, require('../data/npc-population.json'));
const merchant = roster.merchants.find(x => x.bookHold === 'windhelm' && x.role === 'Cook');
const placed = population.keep.find(x => x[0] === merchant.reference);
const smith = roster.merchants.find(x => x.bookHold === 'windhelm' && x.role === 'Smith');
const smithPlaced = population.keep.find(x => x[0] === smith.reference);
// A valid pre-feature ledger has no food clock. Its exact food age is unknown.
const legacyEntry = {baseId:0x669a2,count:4,name:'Venison (2 days left)'};
ledger.entries[merchant.reference].stock.push({baseId:0x669a2,count:4,name:'Venison',entry:legacyEntry});
ledger.sha256 = require('node:crypto').createHash('sha256').update(JSON.stringify([ledger.version,ledger.entries])).digest('hex');
const w = standIn.world({ name: '4664-merchant-spoilage',
  settings: { loadOrder: population.plugins, thornswoodServer: 'dev' }, loadOrder: population.plugins,
  files: { 'private/merchant-ledger.json': ledger, 'private/merchant-ledger.initialized': '1',
    'private/allowed.json': { profiles: [1000,1002], accounts: { 1000: 'acct-cook', 1002:'acct-smith' }, businessOwnerProfiles: [1000] } } });
try {
  w.cast(catalogue);
  let writeFault = '';
  const VENISON = w.idOf('669a2:Skyrim.esm'), GOLD = 15;
  w.record('669a2:Skyrim.esm', 'ALCH');
  const pos = [placed[3][0] + 100, placed[3][1], placed[3][2]];
  const actor = w.person(0xff004664, { profileId: 1000, name: 'Maker', prof: 'cook', town: 'windhelm',
    cell: placed[2], pos, inventory: { entries: [{ baseId: GOLD, count: 300 },
      { baseId: VENISON, count: 3, name: 'Venison (2 days left)' }] } });
  const second = w.person(0xff004665, { profileId:1002,name:'Smith customer',prof:'smith',town:'windhelm',
    cell:smithPlaced[2],pos:[smithPlaced[3][0]+100,smithPlaced[3][1],smithPlaced[3][2]],
    inventory:{entries:[{baseId:GOLD,count:100},{baseId:w.idOf('5ace4:Skyrim.esm'),count:1}]} });
  yes('the whole gamemode loads over the current trader roster', w.boot());
  if (w.loaded()) {
    const nativeWrite = w.mp().writePrivateEconomyLedger;
    w.mp().writePrivateEconomyLedger = function(name,bytes) {
      if (name === 'merchant' && writeFault === 'refuse') return false;
      const committed = nativeWrite(name,bytes);
      if (name === 'merchant' && writeFault === 'after') throw new Error('The merchant write reported an error after commit.');
      return committed;
    };
    yes('the real controller loads against the controlled native save boundary', w.reload());
    w.arrive(actor); w.arrive(second); w.run(30000);
    const trader = w.idOf(merchant.reference);
    function say(line) { w.say(actor, line); w.run(300); return w.heard(actor).slice(-1)[0]; }
    const view = () => w.prop(actor, 'thornswoodMerchantView') || {};
    const stock = () => (w.readPrivate('merchant-ledger.json').entries[merchant.reference].stock || []);
    say('/book new business Maker Kitchen');
    say('/book price Maker Kitchen Venison | 2 | 3');
    say('/book price Maker Kitchen Iron Ingot | 2 | 3');
    w.moveTo(actor, '1691d:Skyrim.esm', [134265.1, 35842.3, -12397.5]); w.run(2000);
    const submitted = say('/book submit Maker Kitchen');
    yes('the price list is submitted through the real hold board', /^Submitted/.test(submitted));
    w.moveTo(actor, placed[2], pos); w.run(2000);
    w.activate(trader, actor); w.run(300);
    yes('unknown legacy food is retained exactly but removed from the sellable offer',
      stock().some(x => x.ageUnknown === true && JSON.stringify(x.entry) === JSON.stringify(legacyEntry)) &&
      !(view().offers || []).some(x => x.name === 'Venison' && x.stock > 0) && /no verified age/.test(view().note));
    const sold = say('/merchant sell 3 @2 Venison'); w.run(2000);
    yes('the real sale settles three named pieces onto the merchant shelf', /waiting/.test(sold) &&
      stock().some(x => !x.ageUnknown && x.count === 3 && x.entry.name === 'Venison (2 days left)'));
    yes('fresh intake never merges with the identical unknown-age legacy entry', stock().length === 2 &&
      stock().some(x => x.ageUnknown && JSON.stringify(x.entry) === JSON.stringify(legacyEntry)));
    const before = w.count(actor, GOLD);
    const now = w.now();
    w.box().Date.now = () => now + 24 * 60 * 60 * 1000 + 1;
    yes('the aging interval ends outside winter', w.box().__thornswoodSeason.seasonAt(w.box().Date.now()) !== 'winter');
    const boughtAt = w.heard(actor).length;
    say('/merchant buy 1 @3 Venison'); w.run(2000);
    yes('a stale open offer buys food with one day left after one real day',
      w.heardSince(actor,boughtAt).some(line => /waiting|Bought 1 Venison/.test(line)) &&
      w.row(actor).inventory.entries.some(x => x.baseId === VENISON && x.count === 1 && x.name === 'Venison (1 day left)') &&
      w.count(actor, GOLD) === before - 3);
    w.box().Date.now = () => now + 2 * 24 * 60 * 60 * 1000 + 1;
    const pack = JSON.stringify(w.row(actor).inventory), purse = view().purse;
    const savedBefore = JSON.stringify(w.readPrivate('merchant-ledger.json'));
    writeFault = 'refuse';
    const failAt = w.heard(actor).length;
    say('/merchant buy 1 @3 Venison'); w.run(2000);
    yes('a refused aging save spends nothing and advances neither stock nor clock',
      JSON.stringify(w.row(actor).inventory) === pack && JSON.stringify(w.readPrivate('merchant-ledger.json')) === savedBefore &&
      w.heardSince(actor,failAt).some(line => /acknowledgement|unavailable|retained/.test(line)));
    writeFault = '';
    yes('the real ledger reopens after the refused writer is replaced', w.reload());
    w.box().Date.now = () => now + 24 * 60 * 60 * 1000 + 1;
    w.activate(trader, actor); w.run(500);
    w.box().Date.now = () => now + 2 * 24 * 60 * 60 * 1000 + 1;
    // A quest response can publish a new offer before the periodic aging pass.
    const questRefresh = w.box().__thornswoodMerchantTrade.command({actorId:actor,profileId:1000,
      parts:['/merchant','quest','take','no-such-work']});
    yes('a quest response applies expiration before publishing a fresh shelf view',
      questRefresh.view && questRefresh.view.open && /no appointed place/.test(questRefresh.text) &&
      !questRefresh.view.offers.some(x => x.name === 'Venison' && x.stock > 0) &&
      w.readPrivate('merchant-ledger.json').entries[merchant.reference].spoilClock.days === 2 &&
      JSON.stringify(w.row(actor).inventory) === pack);
    w.activate(trader, actor); w.run(500);
    say('/merchant buy 1 @3 Venison'); w.run(2000);
    yes('another stale buy cannot pay for or receive expired food', JSON.stringify(w.row(actor).inventory) === pack && view().purse === purse);
    yes('expired venison is no longer on sale', !(view().offers || []).some(x => x.name === 'Venison' && x.stock > 0));
    yes('verified expired food becomes retained Spoiled Food and unknown stock stays exact',
      stock().some(x => x.baseId === w.idOf('19100:Thornswood-Content.esp') && x.count === 2 && x.entry.name === 'Venison (spoiled)') &&
      stock().some(x => x.ageUnknown && JSON.stringify(x.entry) === JSON.stringify(legacyEntry)));
    const stockAfterExpiry = JSON.stringify(stock());
    w.box().Date.now = () => now + 3 * 24 * 60 * 60 * 1000 + 1;
    writeFault = 'after';
    say('/merchant buy 1 @3 Venison'); w.run(2000);
    yes('accepted-then-error retains the committed clock without charging the customer',
      w.readPrivate('merchant-ledger.json').entries[merchant.reference].spoilClock.days === 3 &&
      JSON.stringify(w.row(actor).inventory) === pack && JSON.stringify(stock()) === stockAfterExpiry);
    writeFault = ''; w.reload();
    w.box().Date.now = () => now + 3 * 24 * 60 * 60 * 1000 + 1;
    w.activate(trader, actor); w.run(500);
    yes('restarting from the committed clock cannot repeat aging or release unknown food',
      JSON.stringify(stock()) === stockAfterExpiry && !(view().offers || []).some(x => x.name === 'Venison' && x.stock > 0));
    // Spend the earlier bought piece through the native food event first;
    // the next native sale must actually debit the new two-day entry.
    w.eat(actor,VENISON);
    yes('the previous bought piece is no longer mixed with the new intake', w.count(actor,VENISON) === 0);
    w.give(actor,VENISON,1,{name:'Venison (2 days left)'});
    w.holdSaves(true);
    say('/merchant sell 1 @2 Venison'); w.run(2000);
    const pendingBefore = w.readPrivate('merchant-ledger.json').entries[merchant.reference];
    yes('a new real sale waits on its native saved inventory receipt', !!pendingBefore.pending);
    w.box().Date.now = () => now + 4 * 24 * 60 * 60 * 1000 + 1;
    w.run(2000);
    const pendingAfter = w.readPrivate('merchant-ledger.json').entries[merchant.reference];
    yes('a day boundary cannot rewrite a pending transfer or its stock clock',
      JSON.stringify(pendingAfter) === JSON.stringify(pendingBefore));
    w.holdSaves(false); w.run(3000);
    const finished = w.readPrivate('merchant-ledger.json').entries[merchant.reference];
    yes('after the saved transfer settles its verified food catches up exactly once', !finished.pending &&
      finished.spoilClock.days === 4 && stock().some(x => !x.ageUnknown && x.baseId === VENISON &&
        x.count === 1 && x.entry.name === 'Venison (1 day left)'));
    const paidBefore = w.count(actor,GOLD);
    say('/merchant buy 1 @3 Venison'); w.run(2000);
    yes('new verified intake remains saleable without releasing or relabeling quarantined food',
      w.count(actor,GOLD) === paidBefore-3 && stock().some(x => x.ageUnknown &&
        JSON.stringify(x.entry) === JSON.stringify(legacyEntry)) && !stock().some(x => !x.ageUnknown && x.baseId === VENISON));
    // Two real sessions: a corrupt Cook clock must not abort delivery of a
    // healthy Smith's receipt-backed sale in the same recovery pass.
    const smithId = w.idOf(smith.reference), iron = w.idOf('5ace4:Skyrim.esm');
    w.activate(smithId,second); w.run(300);
    const healthyGold = w.count(second,GOLD);
    w.holdSaves(true);
    // At this four-day artificial wall-clock offset, exercise the actual
    // authenticated controller boundary, independently of relay arrival timers.
    const healthySale = w.box().__thornswoodMerchantTrade.command({actorId:second,profileId:1002,
      parts:['/merchant','sell','1','@2','Iron','Ingot']});
    yes('the healthy controller really arms a receipt-backed sale', /waiting/.test(healthySale.text));
    const purses = w.box().__thornswoodNpcMerchants, cookState = purses.read(trader);
    const invalid = JSON.parse(JSON.stringify(cookState)); invalid.spoilClock.at = w.box().Date.now()+86400000;
    purses.compareAndCommit(trader,cookState.revision,invalid,()=>true);
    const invalidBefore = JSON.stringify(purses.read(trader));
    w.holdSaves(false);
    let recovered, recoveryError;
    try { recovered = w.box().__thornswoodMerchantTrade.recover(); } catch(error) { recoveryError = error; }
    yes('one bad food clock does not abort the two-session recovery pass', !recoveryError && Array.isArray(recovered));
    if (recovered) recovered.forEach(result => w.box().__thornswoodMerchantTrade.push(result.actorId,result.view));
    w.run(3000);
    yes('the affected view closes with an honest food-clock notice and unchanged state',
      JSON.stringify(purses.read(trader)) === invalidBefore && w.prop(actor,'thornswoodMerchantView').open === false &&
      w.heard(actor).some(line => /food clock cannot be verified/.test(line)));
    yes('the healthy session still settles and receives its refreshed view',
      w.count(second,iron) === 0 && w.count(second,GOLD) === healthyGold+2 &&
      (w.prop(second,'thornswoodMerchantView').offers || []).some(x => x.name === 'Iron Ingot' && x.stock === 1));
    yes('no handler or timer throws', w.faults.length === 0 && w.threw.length === 0 && w.logged(/\] on[A-Z][A-Za-z]+ threw/).length === 0);
  }
  t.done(w);
} finally { w.done(); }
