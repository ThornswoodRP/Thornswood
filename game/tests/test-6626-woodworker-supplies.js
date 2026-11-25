'use strict';
// Real generated role permissions -> whole gamemode -> queued merchant
// command -> saved inventory settlement. No deployed game or service is used.
const fs = require('fs'), path = require('path'), child = require('child_process');
const root = path.join(__dirname, '..', '..');
const standIn = require('../../tests/stand-in-server.js');
const t = standIn.checks(), yes = t.yes;
const stage = require('../gamemode-tables/MERCHANT_STAGE.json');
// Rebuild only the permission calculation from the real installed content
// snapshot and its measured item records, without editing generated files.
const script = [
  'import importlib.util,json,pathlib',
  'p=pathlib.Path("scripts/dev/Build-MerchantRoleTables.py")',
  's=importlib.util.spec_from_file_location("roles",p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)',
  'inputs,_=m.input_bundle()',
  'records=json.loads(pathlib.Path("game/data/merchant-role-tables.json").read_text())["records"]',
  'print(json.dumps(m.derive(*inputs,records)[0]))'
].join('\n');
stage.tables = JSON.parse(child.execFileSync('python', ['-c', script], { cwd: root, encoding: 'utf8' }));
const catalogue = standIn.npcCatalogue(), roster = require('../data/merchant-roster.json');
const ledger = require('../../scripts/ops/New-AlphaMerchantLedger.js').createAlphaMerchantLedger(roster, require('../data/npc-population.json'));
const wood = roster.merchants.find(m => m.role === 'Woodworker' && m.bookHold === 'windhelm');
const smith = roster.merchants.find(m => m.role === 'Smith' && m.bookHold === 'windhelm');
const place = ref => catalogue.population.keep.find(row => row[0] === ref);
const woodPlace = place(wood.reference), smithPlace = place(smith.reference);
const iron = 0x5ace4, firewood = 0x6f993, gold = 15;
const w = standIn.world({ name: '6626-woodworker-supplies', loadOrder: catalogue.population.plugins, settings: {
  loadOrder: catalogue.population.plugins, thornswoodServer: 'main'
}, files: {
  'private/merchant-ledger.json': ledger, 'private/merchant-ledger.initialized': '1',
  'private/allowed.json': { profiles: [1000], accounts: { 1000: 'acct-brenna' }, businessOwnerProfiles: [1000] }
} });
// world() first copies the packaged tables. Lay the newly generated stage
// into this isolated server root afterward, exactly before gamemode boot.
fs.writeFileSync(path.join(w.dir, 'gamemode-tables', 'MERCHANT_STAGE.json'), JSON.stringify(stage));
w.cast(catalogue);
const actor = w.person(0xff006626, { profileId: 1000, name: 'Brenna', prof: 'woodworker', half: 'woodwright',
  town: 'windhelm', cell: woodPlace[2], pos: [woodPlace[3][0] + 100, woodPlace[3][1], woodPlace[3][2]],
  inventory: { entries: [{ baseId: iron, count: 20 }, { baseId: firewood, count: 20 }, { baseId: gold, count: 100 }] } });
yes('whole gamemode loads with freshly derived role permissions', w.boot());
if (w.loaded()) {
  w.arrive(actor); w.run(30000);
  function say(text) { w.say(actor, text); w.run(2500); return w.heard(actor).slice(-1)[0] || ''; }
  say('/book new business Brenna Timber');
  say('/book price Brenna Timber Iron Ingot | 7 | 10');
  say('/book price Brenna Timber Firewood | 3 | 5');
  w.moveTo(actor, '1691d:Skyrim.esm', [134265.1, 35842.3, -12397.5]); w.run(2000);
  const submission = say('/book submit Brenna Timber');
  yes('actual hold price submission succeeds', /^Submitted /.test(submission));
  function visit(row) {
    w.moveTo(actor, row[2], [row[3][0] + 100, row[3][1], row[3][2]]); w.run(2000);
    w.activate(w.idOf(row[0]), actor); w.run(500);
    return w.prop(actor, 'thornswoodMerchantView');
  }
  let view = visit(woodPlace);
  yes('Woodworker still buys ordinary recipe ingredients through the normal trade offer',
    view.offers.some(o => o.name === 'Iron Ingot' && o.buy === 7));
  yes('Woodworker collection panel excludes blacksmith ingots', !view.supply.some(o => o.name === 'Iron Ingot'));
  const before = [w.count(actor, iron), w.count(actor, gold), view.purse];
  const refused = say('/merchant supply Iron Ingot');
  view = w.prop(actor, 'thornswoodMerchantView');
  yes('forged ingot collection turn-in refuses without taking goods or paying gold',
    /does not request that item/.test(refused) && w.count(actor, iron) === before[0] &&
    w.count(actor, gold) === before[1] && view.purse === before[2]);
  const woodBefore = w.count(actor, firewood), paidBefore = w.count(actor, gold);
  say('/merchant supply Firewood');
  yes('actual woodworking stock settles through the normal saved transfer',
    w.count(actor, firewood) === woodBefore - 5 && w.count(actor, gold) === paidBefore + 15);
  visit(smithPlace);
  const smithBefore = w.count(actor, iron), smithPaid = w.count(actor, gold);
  say('/merchant supply Iron Ingot');
  yes('Smith collection turn-ins still accept their own ingots',
    w.count(actor, iron) === smithBefore - 5 && w.count(actor, gold) === smithPaid + 35);
}
t.done(w);
