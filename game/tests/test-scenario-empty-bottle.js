'use strict';
/*
  Scenario: systems/drink.md
  Actual compiled recipe/bench tables, cow onActivate, timed craft, well and drink.
  A winter Farmer/Hearthcook starts with a ladle and no milk, bottle or water.
*/
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const standIn = require('../../tests/stand-in-server.js'), tables = require('../../tests/gamemode-tables');
const t = standIn.checks(), yes = t.yes;
const DESC = '154c9:Thornswood-Content.esp';
const recipes = JSON.parse(fs.readFileSync(path.join(standIn.REPO_DIR, 'game/data/recipes.json'), 'utf8')).recipes;
const raw = recipes[DESC], row = tables.table('RECIPES_BY_ID')[DESC];
assert(raw && row, 'compile the actual new bottle recipe before running this scenario');
assert.equal(raw.editorId, 'ThornswoodRecipeEmptyBottleFromMilk');
assert.deepEqual([raw.out, row.owner, row.half, row.rank, row.makes],
  ['f2012:Skyrim.esm', 'Cook', 'Hearthcook', 'novice', 1]);
assert.deepEqual(raw.inputItems.map(x => [x.item, x.count]), [['3534:HearthFires.esm', 1]]);
const benchBase = Object.keys(tables.table('BENCH_BY_BASE')).find(k => tables.table('BENCH_BY_BASE')[k] === raw.bench);
assert(benchBase, 'the compiled cookpot must have furniture');
const w = standIn.world({ name: '4652-empty-bottle', start: Date.UTC(2026, 11, 21, 12) });
try {
  const CITY = '1691d:Skyrim.esm', POS = [1000, 0, 0];
  const MILK = w.idOf('3534:HearthFires.esm'), EMPTY = w.idOf(raw.out), FULL = w.idOf('13f598:WindhelmSSE.esp');
  const LADLE = w.idOf('319e5:Skyrim.esm');
  w.record(benchBase, 'FURN');
  w.record('6681e:Skyrim.esm', 'NPC_');
  w.record('18030:Thornswood-Content.esp', 'ACTI');
  w.record('13f598:WindhelmSSE.esp', 'ALCH');
  w.record('3534:HearthFires.esm', 'ALCH');
  const pot = w.ref(0xff004650, { base: benchBase, cell: CITY, pos: POS });
  const cow = w.ref(0xff004651, { base: '6681e:Skyrim.esm', type: 'NPC_', isDead: false, cell: CITY, pos: POS });
  const deadCow = w.ref(0xff004652, { base: '6681e:Skyrim.esm', type: 'NPC_', isDead: true, cell: CITY, pos: POS });
  const well = w.ref(0xff004653, { base: '18030:Thornswood-Content.esp', cell: CITY, pos: POS });
  const people = [['cook', 'farmer'], ['smith', 'farmer'], ['cook', 'hunter'], ['cook', 'farmer'],
    ['cook', 'farmer'], ['cook', 'farmer']].map(([prof, cls], i) => {
    const a = w.person(0xff004660 + i, { profileId: 1000 + i * 2, name: 'Maker ' + i, prof, cls,
      half: prof === 'cook' ? 'hearthcook' : 'edgewright', rank: i === 5 ? 'master' : 'novice',
      cell: CITY, pos: [1040 + i * 10, 0, 0],
      inventory: { entries: i === 4 ? [] : [{ baseId: LADLE, count: 1 }] } });
    w.row(a).thornswoodCharacter.ranks[cls] = 'novice';
    return a;
  });
  const [maker, smith, hunter, empty, noLadle, chef] = people;
  yes('the whole gamemode loads with the compiled bottle and bench tables', w.boot());
  if (w.loaded()) {
    people.forEach(w.arrive); w.run(30000);
    people.forEach(a => { w.row(a).thornswoodNeeds = { food: 60, drink: 60, rest: 90, temp: 50, at: w.now() }; });
    const needs = a => w.box().__thornswoodNeeds.read(a);
    yes('the novice winter Farmer starts without milk, empty bottles or water',
      w.count(maker, MILK) === 0 && w.count(maker, EMPTY) === 0 && w.count(maker, FULL) === 0);
    w.activate(cow, maker);
    yes('a real living-cow activation supplies one milk in winter', w.count(maker, MILK) === 1);
    w.activate(cow, maker);
    yes('the normal cow cooldown prevents a second milk', w.count(maker, MILK) === 1 &&
      w.heard(maker).some(x => /milked this cow for now/.test(x)));
    w.activate(cow, hunter); w.activate(deadCow, empty);
    yes('a different class and a dead cow do not supply milk', w.count(hunter, MILK) === 0 && w.count(empty, MILK) === 0);
    w.activate(cow, smith);
    const craft = { recipe: w.idOf(DESC), output: EMPTY, count: 1,
      inputs: raw.inputItems.map(x => ({ baseId: w.idOf(x.item), count: x.count })) };
    const smithPack = JSON.stringify(w.row(smith).inventory);
    const refused = w.craft(smith, pot, craft);
    yes('a Farmer with another profession cannot decant or spend milk',
      !refused.started && !refused.made && JSON.stringify(w.row(smith).inventory) === smithPack);
    const missingPack = JSON.stringify(w.row(empty).inventory);
    const missing = w.craft(empty, pot, craft);
    yes('without milk the request cannot start or change inventory',
      !missing.started && !missing.made && JSON.stringify(w.row(empty).inventory) === missingPack);
    // arrive() supplies a Cook's normal starter ladle. Model having lost it.
    w.row(noLadle).inventory.entries = w.row(noLadle).inventory.entries.filter(x => x.baseId !== LADLE);
    w.activate(cow, noLadle);
    const barePack = JSON.stringify(w.row(noLadle).inventory), bare = w.craft(noLadle, pot, craft);
    yes('the existing ladle gate still refuses work without spending milk',
      w.count(noLadle, LADLE) === 0 && !bare.made && JSON.stringify(w.row(noLadle).inventory) === barePack &&
      w.heard(noLadle).some(x => /need a wooden ladle/.test(x)));
    const before = needs(maker), eatEvents = w.did.filter(d => d[2] === 'event' && d[3] === 'onEatItem').length;
    const opened = w.activate(pot, maker);
    yes('the normal cooking-pot activation admits the novice Hearthcook', opened.opened && w.holds(pot) === maker);
    const made = w.craft(maker, pot, craft);
    yes('normal timed Cook work spends one milk for one ordinary empty bottle',
      made.started && made.made && made.workMs > 0 && w.count(maker, MILK) === 0 && w.count(maker, EMPTY) === 1);
    const after = needs(maker);
    yes('decanting grants no food, thirst or native drink event', after.food <= before.food && after.drink <= before.drink &&
      w.did.filter(d => d[2] === 'event' && d[3] === 'onEatItem').length === eatEvents);
    const exhausted = w.craft(maker, pot, craft);
    yes('the spent milk cannot create a second bottle', !exhausted.made && w.count(maker, EMPTY) === 1);
    w.activate(pot, maker);
    w.activate(well, maker);
    yes('the existing well path converts that empty to clean water',
      w.count(maker, EMPTY) === 0 && w.count(maker, FULL) === 1 &&
      w.heard(maker).includes('You fill a bottle at the well. The water is clean.'));
    const thirst = needs(maker).drink;
    const drank = w.eat(maker, FULL);
    yes('only drinking the resulting water restores thirst, with no automatic empty refund',
      drank.sent && Math.abs(needs(maker).drink - thirst - 20) < 0.2 && w.count(maker, FULL) === 0 && w.count(maker, EMPTY) === 0);
    w.activate(cow, chef);
    w.activate(pot, chef);
    const chefMade = w.craft(chef, pot, craft);
    yes('the existing Master Cook Grand Chef perk still doubles yield from one milk',
      chefMade.made && w.count(chef, MILK) === 0 && w.count(chef, EMPTY) === 2);
    yes('no event or timer throws', w.faults.length === 0 && w.threw.length === 0 &&
      w.logged(/\] on[A-Z][A-Za-z]+ threw/).length === 0);
  }
  t.done(w);
} finally { w.done(); }
