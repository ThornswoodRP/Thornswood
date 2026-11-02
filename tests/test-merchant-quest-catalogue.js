'use strict';
// Authored source and explicit activation only. No game or world is accessed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r/g, '');
const catalogue = JSON.parse(read('game/data/merchant-quests.json'));
const roster = JSON.parse(read('game/data/merchant-roster.json'));
const population = JSON.parse(read('game/data/npc-population.json'));
const gm = require('./gamemode-tables.js').joined(read('game/gamemode.js'));
const activation=JSON.parse(read('game/data/merchant-quest-activation.json'));
assert.deepEqual(Object.keys(activation).sort(),['commissions','killScenes','version']);
assert.equal(activation.version,1);assert.equal(activation.killScenes.length,4);
const pins=activation.killScenes.concat(activation.commissions),enabled=new Set(pins.map(row=>row.id));
assert.equal(enabled.size,pins.length);assert.equal(activation.commissions.length,241);
const begin = gm.indexOf('// ==== thornswood progression ====');
const end = gm.indexOf('// ==== end thornswood progression ====');
assert.ok(begin >= 0 && end > begin);
const context = {};
vm.createContext(context);
vm.runInContext(gm.slice(begin, end), context);
const P = context.__thornswoodProgression;
const rules = require('../game/quest-eligibility').createQuestEligibility({table: P.TABLE, spellIds: P.SPELL_IDS});
const recipes = JSON.parse(read('game/data/recipes.json')).recipes;
const tables = JSON.parse(read('game/data/merchant-role-tables.json')).tables;
const harvests = JSON.parse(read('game/data/harvests.json')).harvests;
const proofFields = ['owner', 'half', 'rank', 'out', 'makes', 'bench', 'inputItems', 'needs'];
// Settled class-Novice slots. Recipe/output authority stays in the catalogue.
const beginnerClasses = new Map([
  ['1a67c:Skyrim.esm', 'miner'], ['19dd0:Skyrim.esm', 'fisher'],
  ['1939ba:aaaGraniteHill.esp', 'hunter'], ['198a0:Skyrim.esm', 'farmer'],
  ['1aa61:Skyrim.esm', 'gatherer']
]);

function validate(catalogue, source = {recipes, tables, harvests}) {
  assert.deepEqual(Object.keys(catalogue).sort(), ['active', 'complete', 'quests', 'version']);
  assert.equal(catalogue.version, 1);
  assert.equal(catalogue.active, false, 'Draft data cannot activate work');
  assert.equal(catalogue.complete, false, 'The full catalogue and runtime prerequisites remain unfinished');
  assert.ok(Array.isArray(catalogue.quests) && catalogue.quests.length > 0);
  assert.ok(read('scripts/dev/Build-MerchantGamemode.js').includes('merchant-quest-activation.json'), 'Runtime uses explicit pinned admission');

  // Compare actual objective identities, not titles or merchant/hold labels.
  const killSource = read('game/kill-contracts.js');
  const specStart = killSource.indexOf('var SPEC=[');
  const specEnd = killSource.indexOf('\n];', specStart);
  assert.ok(specStart >= 0 && specEnd > specStart);
  const legacy = vm.runInNewContext(killSource.slice(specStart, specEnd + 3) + '\nSPEC');
  const objective = (count, refs) => JSON.stringify(['kill', count, refs.slice().sort()]);
  const objectives = new Set(legacy.map(row => objective(row.count, Object.keys(row.refs).map(ref => ref + ':Skyrim.esm'))));
  const ids = new Set();
  const targets = ['ref', 'base', 'cell', 'world', 'pos', 'leash', 'role', 'species',
    'location', 'locationName', 'hold', 'habitat', 'tier', 'returnMinutes'];
  let firstFinishGold = 0, dailyBound = 0;
  for (const row of catalogue.quests) {
    assert.ok(['kill', 'commission'].includes(row.kind), 'Unknown objective kind');
    const fields = ['id', 'name', 'text', 'tier', 'gate', 'merchant', 'kind', 'cooldownHours'];
    assert.deepEqual(Object.keys(row).sort(), fields.concat(row.kind === 'kill' ?
      ['count', 'targets', 'rewardGold'] : ['goods', 'reward']).sort());
    assert.match(row.id, /^q-[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(row.id.length <= 48 && !ids.has(row.id));
    ids.add(row.id);
    assert.ok(typeof row.name === 'string' && row.name.trim().length > 0);
    assert.ok(typeof row.text === 'string' && row.text.trim().length > 0);
    assert.ok(P.TABLE.ranks.includes(row.tier));
    const gate = rules.validate(row.gate);
    assert.notEqual(gate.open, true, 'New work needs its real class/profession gate');
    assert.equal(gate.rank, row.tier);
    const merchants = roster.merchants.filter(m => m.reference === row.merchant.reference);
    assert.equal(merchants.length, 1);
    assert.deepEqual(row.merchant, merchants[0]);
    const sourceMerchant = population.npcs.find(n => n.ref === row.merchant.reference);
    assert.ok(sourceMerchant && sourceMerchant.keep && sourceMerchant.role === 'trader');
    assert.equal(sourceMerchant.base, row.merchant.base);
    assert.ok(Number.isSafeInteger(row.cooldownHours) && row.cooldownHours > 0);
    assert.equal(gm.includes("'" + row.id + "'") || gm.includes('"' + row.id + '"'),enabled.has(row.id), 'Only explicitly admitted IDs are bundled');
    if (row.kind === 'commission') {
      assert.equal(row.tier, 'novice', 'Higher commissions need their own producer/cadence review');
      assert.equal(row.cooldownHours, 6);
      if (gate.classKey !== undefined) {
        assert.equal(gate.classKey, beginnerClasses.get(row.merchant.reference), 'Reserved class allocation');
      } else {
        assert.equal(gate.profession, row.merchant.role.toLowerCase());
      }
      assert.deepEqual(row.reward, {source: 'merchant-purse', pricing: 'submitted-hold-price'});
      assert.ok(Array.isArray(row.goods) && row.goods.length > 0 && row.goods.length <= 5);
      const items = new Set();
      for (const good of row.goods) {
        const plant = Object.hasOwn(good, 'harvest');
        assert.deepEqual(Object.keys(good).sort(), plant ? ['count', 'harvest', 'item'] : ['count', 'item', 'recipe']);
        assert.ok(typeof good.item === 'string' && !items.has(good.item)); items.add(good.item);
        assert.ok(Number.isSafeInteger(good.count) && good.count > 0 && good.count <= 255, 'Commission quantity');
        assert.ok(source.tables[row.merchant.role].buy.includes(good.item), 'Commission output needs ordinary buy permission too');
        if (plant) {
          assert.equal(gate.classKey, 'gatherer', 'Gatherer harvest gate');
          assert.ok(good.harvest && typeof good.harvest === 'object' && !Array.isArray(good.harvest) &&
            typeof good.harvest.reference === 'string' && source.harvests &&
            Object.hasOwn(source.harvests, good.harvest.reference), 'Public Gatherer harvest');
          const harvest = source.harvests[good.harvest.reference];
          assert.ok(harvest && typeof harvest === 'object' && !Array.isArray(harvest), 'Public Gatherer harvest');
          assert.deepEqual(Object.keys(harvest).sort(), ['name', 'produce', 'rank']);
          assert.deepEqual(good.harvest, {reference: good.harvest.reference, ...harvest}, 'Harvest evidence');
          assert.equal(harvest.rank, row.tier);
          assert.equal(good.item, harvest.produce);
          continue;
        }
        assert.deepEqual(Object.keys(good.recipe).sort(), ['reference', ...proofFields].sort());
        const recipe = source.recipes[good.recipe.reference];
        assert.ok(recipe && recipe.fires === true && recipe.book !== 'cut' &&
          recipe.roll === undefined && recipe.race === '', 'Commission needs a public firing recipe');
        assert.equal(recipe.owner, row.merchant.role);
        assert.equal(recipe.rank, row.tier);
        if (gate.classKey === undefined) assert.equal(gate.half, recipe.half.toLowerCase());
        assert.equal(good.item, recipe.out);
        for (const field of proofFields) {
          // A published definition is immutable (its hash is in accepted
          // promises), so its evidence is the recipe as it was published.
          // Since #4826 the last plugin takes Skyrim's perk tests (HasPerk,
          // function 448) off every recipe, and nothing else of the recipe
          // changed: a published row's needs may still name those tests.
          if (field === 'needs' && enabled.has(row.id) &&
              Array.isArray(good.recipe.needs) && good.recipe.needs.some(n => n && n.function === 448)) {
            assert.deepEqual(good.recipe.needs.filter(n => !(n && n.function === 448)), recipe.needs,
              'Recipe evidence/needs, less the perk tests #4826 took off');
            continue;
          }
          assert.deepEqual(good.recipe[field], recipe[field], 'Recipe evidence/' + field);
        }
        assert.ok(recipe.inputItems.length > 0 && recipe.inputItems.every(input =>
          input.suppliedAt === 'novice' && (Object.keys(P.TABLE.classes).includes(input.suppliedBy) ||
            Object.keys(P.TABLE.professions).includes(input.suppliedBy))), 'Novice supply provenance');
      }
      const signature = JSON.stringify(['commission', [...items].sort()]);
      assert.ok(!objectives.has(signature), 'A name or quantity change alone is not a new commission');
      objectives.add(signature);
      continue;
    }
    assert.equal(row.kind, 'kill', 'Other objective kinds need their own source validation');
    assert.ok(Array.isArray(row.targets) && row.targets.length > 0);
    assert.ok(Number.isSafeInteger(row.count) && row.count > 0 && row.count <= row.targets.length);
    const refs = new Set();
    for (const target of row.targets) {
      assert.deepEqual(Object.keys(target).sort(), targets.slice().sort());
      assert.ok(!refs.has(target.ref)); refs.add(target.ref);
      const source = population.npcs.find(n => n.ref === target.ref);
      assert.ok(source && source.keep && ['enemy', 'animal'].includes(source.role));
      assert.notEqual(source.habitat, 'city');
      for (const field of targets) assert.deepEqual(target[field], source[field], target.ref + '/' + field);
      assert.ok(typeof (target.world || target.cell) === 'string');
      assert.ok(target.pos.length === 3 && target.pos.every(Number.isFinite));
      assert.ok(Number.isFinite(target.leash) && target.leash > 0);
    }
    const signature = objective(row.count, [...refs]);
    assert.ok(!objectives.has(signature), 'Renaming an existing objective is not new work');
    objectives.add(signature);
    assert.ok(Number.isSafeInteger(row.rewardGold) && row.rewardGold > 0 && row.rewardGold <= 2147483647);
    assert.ok(Number.isSafeInteger(row.cooldownHours) && row.cooldownHours > 0);
    firstFinishGold += row.rewardGold;
    dailyBound += Math.ceil(24 / row.cooldownHours) * row.rewardGold;
    assert.equal(gm.includes("'" + row.id + "'") || gm.includes('"' + row.id + '"'),enabled.has(row.id), 'Only explicitly admitted IDs are bundled');
  }
  return {ids, firstFinishGold, dailyBound};
}
const {ids, firstFinishGold, dailyBound} = validate(catalogue);
for(const pin of pins) {
  assert.deepEqual(Object.keys(pin).sort(),['id','sha256']);
  const row=catalogue.quests.concat(JSON.parse(read('game/data/merchant-ranked-quests.json')).quests).find(row=>row.id===pin.id);assert.ok(row);
  assert.equal(row.kind,activation.killScenes.includes(pin)?'kill':'commission');
  assert.equal(require('node:crypto').createHash('sha256').update(JSON.stringify(row)).digest('hex'),pin.sha256);
}
const docs = read('docs/systems/merchant-quest-catalogue.md');
assert.ok(docs.includes('**' + (catalogue.quests.length+JSON.parse(read('game/data/merchant-ranked-quests.json')).quests.length) + ' authored definitions**'));
assert.ok(docs.includes('**' + firstFinishGold + ' gold**'));
assert.ok(docs.includes('**' + dailyBound + ' gold**'));
function proof(ref) {
  return {reference: ref, ...Object.fromEntries(proofFields.map(key => [key, recipes[ref][key]]))};
}
const commission = {id: 'q-whiterun-smith-straps', name: 'Straps for the forge',
  text: 'Bring six pieces of leather for the forge.', tier: 'novice',
  gate: {profession: 'smith', rank: 'novice', half: 'platewright'},
  merchant: roster.merchants.find(m => m.bookHold === 'whiterun' && m.role === 'Smith'),
  kind: 'commission', goods: [{item: 'db5d2:Skyrim.esm', count: 6, recipe: proof('1033de:Skyrim.esm')}],
  reward: {source: 'merchant-purse', pricing: 'submitted-hold-price'}, cooldownHours: 6};
const one = row => ({version: 1, active: false, complete: false, quests: [row]});
assert.doesNotThrow(() => validate(one(commission)), 'A source-bound inactive commission needs its own exact validation');
const clone = value => JSON.parse(JSON.stringify(value));
let refusals = 0;
function rejects(edit, expected) {
  const row = clone(commission); edit(row);
  assert.throws(() => validate(one(row)), expected); refusals++;
}
rejects(row => {row.kind = 'supply';}, /Unknown objective kind/);
rejects(row => {row.id += '\n';});
rejects(row => {row.gate.half = 'edgewright';});
rejects(row => {row.goods[0].item = '5ace4:Skyrim.esm';});
rejects(row => {row.goods[0].recipe.needs = [];}, /Recipe evidence\/needs/);
rejects(row => {row.goods[0].count = 0;}, /Commission quantity/);
rejects(row => {row.goods[0].count = 256;}, /Commission quantity/);
rejects(row => {row.goods[0].count = 1.5;}, /Commission quantity/);
rejects(row => {row.reward.source = 'mint';});
rejects(row => {row.reward.gold = 20;});
rejects(row => {row.goods.push(clone(row.goods[0]));});
rejects(row => {row.merchant.base = '13b9c:Skyrim.esm';});
for (const change of [{fires: false}, {book: 'cut'}, {roll: true}, {race: 'Nord'}]) {
  const source = {...recipes, '1033de:Skyrim.esm': {...recipes['1033de:Skyrim.esm'], ...change}};
  assert.throws(() => validate(one(commission), {recipes: source, tables}), /public firing recipe/); refusals++;
}
for (const change of [{suppliedAt: 'advanced'}, {suppliedBy: '__proto__'}, {suppliedBy: 'unknown'}]) {
  const row = clone(commission), recipe = clone(recipes['1033de:Skyrim.esm']);
  Object.assign(recipe.inputItems[0], change); row.goods[0].recipe.inputItems = clone(recipe.inputItems);
  assert.throws(() => validate(one(row), {recipes: {...recipes, '1033de:Skyrim.esm': recipe}, tables}), /Novice supply provenance/);
  refusals++;
}
const forbidden = clone(tables); forbidden.Smith.buy = forbidden.Smith.buy.filter(item => item !== 'db5d2:Skyrim.esm');
assert.throws(() => validate(one(commission), {recipes, tables: forbidden}), /buy permission/); refusals++;
const repeated = clone(commission); repeated.id = 'q-another-name'; repeated.goods[0].count++;
assert.throws(() => validate({...one(commission), quests: [commission, repeated]}), /quantity change alone/); refusals++;
const classCommission = clone(commission);
classCommission.gate = {classKey: 'miner', rank: 'novice'};
assert.doesNotThrow(() => validate(one(classCommission)), 'Delivery class is independent of crafting profession');
let classRefusals = 0, classEligibility = 0;
function rejectsClass(edit, expected) {
  const row = clone(classCommission); edit(row);
  assert.throws(() => validate(one(row)), expected); classRefusals++;
}
rejectsClass(row => {row.gate.classKey = 'fisher';}, /Reserved class allocation/);
rejectsClass(row => {row.merchant = roster.merchants.find(m => m.bookHold === 'riften' && m.role === 'Smith');}, /Reserved class allocation/);
rejectsClass(row => {row.gate.classKey = 'unknown';}, /Invalid quest gate/);
rejectsClass(row => {row.gate.half = 'platewright';}, /Invalid quest gate/);
rejectsClass(row => {row.gate.profession = 'smith';}, /Invalid quest gate/);
rejectsClass(row => {row.goods[0].item = '5ace4:Skyrim.esm';});
rejectsClass(row => {row.goods[0].recipe.half = 'edgewright';}, /Recipe evidence\/half/);
rejectsClass(row => {
  row.goods[0] = {item: recipes['1549c:Thornswood-Content.esp'].out, count: 1,
    recipe: proof('1549c:Thornswood-Content.esp')};
});
const plantSources = harvests;
const cotton = {id: 'q-hjaalmarch-alchemist-cotton-dressings', name: 'Cotton for marsh-road dressings',
  text: "Bring three bundles of tundra cotton to Hjaalmarch's Alchemist for marsh-road dressings.",
  tier: 'novice', gate: {classKey: 'gatherer', rank: 'novice'},
  merchant: roster.merchants.find(m => m.bookHold === 'morthal' && m.role === 'Alchemist'),
  kind: 'commission', goods: [{item: '3f7f8:Skyrim.esm', count: 3,
    harvest: {reference: 'bb947:Skyrim.esm', ...plantSources['bb947:Skyrim.esm']}}],
  reward: {source: 'merchant-purse', pricing: 'submitted-hold-price'}, cooldownHours: 6};
assert.doesNotThrow(() => validate(one(cotton)), 'Gatherer delivery uses actual harvest provenance, not an invented recipe');
let harvestRefusals = 0;
function rejectsHarvest(edit, expected) {
  const row = clone(cotton); edit(row);
  assert.throws(() => validate(one(row)), expected); harvestRefusals++;
}
rejectsHarvest(row => {row.goods[0].harvest.reference = 'unknown:Skyrim.esm';}, /Public Gatherer harvest/);
rejectsHarvest(row => {row.goods[0].harvest.reference = 'toString';}, /Public Gatherer harvest/);
rejectsHarvest(row => {row.goods[0].harvest.name = 'Garlic';}, /Harvest evidence/);
rejectsHarvest(row => {row.goods[0].harvest.rank = 'advanced';}, /Harvest evidence/);
rejectsHarvest(row => {row.goods[0].harvest.produce = '34d22:Skyrim.esm';}, /Harvest evidence/);
rejectsHarvest(row => {row.goods[0].item = '34d22:Skyrim.esm';});
rejectsHarvest(row => {row.gate.classKey = 'miner';}, /Reserved class allocation/);
rejectsHarvest(row => {row.gate = {profession: 'alchemist', half: 'physicker', rank: 'novice'};}, /Gatherer harvest gate/);
rejectsHarvest(row => {row.goods[0].recipe = proof('154c6:Thornswood-Content.esp');});
rejectsHarvest(row => {delete row.goods[0].harvest;});
rejectsHarvest(row => {row.goods[0].harvest.yield = 99;}, /Harvest evidence/);
const advancedPlant = clone(plantSources); advancedPlant['bb947:Skyrim.esm'].rank = 'advanced';
const advancedCotton = clone(cotton); advancedCotton.goods[0].harvest.rank = 'advanced';
assert.throws(() => validate(one(advancedCotton), {recipes, tables, harvests: advancedPlant})); harvestRefusals++;
const inheritedPlant = Object.create({'bb947:Skyrim.esm': plantSources['bb947:Skyrim.esm']});
assert.throws(() => validate(one(cotton), {recipes, tables, harvests: inheritedPlant}), /Public Gatherer harvest/); harvestRefusals++;
const noCotton = clone(tables); noCotton.Alchemist.buy = noCotton.Alchemist.buy.filter(item => item !== '3f7f8:Skyrim.esm');
assert.throws(() => validate(one(cotton), {recipes, tables: noCotton, harvests: plantSources}), /buy permission/); harvestRefusals++;
const duplicateCotton = clone(cotton); duplicateCotton.id = 'q-more-cotton'; duplicateCotton.goods[0].count++;
assert.throws(() => validate({...one(cotton), quests: [cotton, duplicateCotton]}), /quantity change alone/); harvestRefusals++;
for (const classKey of ['miner', 'fisher', 'hunter', 'farmer', 'gatherer']) {
  const gate = {classKey, rank: 'novice'};
  const state = {v: 1, cls: classKey, prof: 'warrior', ranks: {[classKey]: 'novice'}};
  for (const [snapshot, allowed] of [[state, true],
    [{...state, ranks: {[classKey]: 'master'}}, true],
    [{...state, cls: classKey === 'gatherer' ? 'miner' : 'gatherer'}, false], [{...state, ranks: {}}, false],
    [{...state, ranks: {[classKey]: 'invalid'}}, false]]) {
    assert.equal(rules.allows(gate, snapshot), allowed); classEligibility++;
  }
}
console.log('PASS ' + ids.size + ' authored quests, exact bindings and gates; ' + dailyBound + ' gold cooldown-only bound, '+enabled.size+' explicitly enabled');
console.log('PASS explicit commission source authority and ' + refusals + ' malformed-source/permission/quantity/bundle refusals');
console.log('PASS ' + classRefusals + ' class-allocation/source refusals and ' + classEligibility + ' cross-profession class eligibility cases');
console.log('PASS ' + harvestRefusals + ' harvest provenance/allocation/permission/bundle refusals');
