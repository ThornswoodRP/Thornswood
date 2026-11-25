'use strict';
// Scenario: systems/professions/tailor.md
// Real compiled recipe/bench tables and the actual CraftService event order.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const standIn = require('../../tests/stand-in-server'), tables = require('../../tests/gamemode-tables');
const t = standIn.checks(), yes = t.yes;
const DESC = '154c8:Thornswood-Content.esp';
const recipes = JSON.parse(fs.readFileSync(path.join(standIn.REPO_DIR, 'game/data/recipes.json'), 'utf8')).recipes;
const raw = recipes[DESC], compiled = tables.table('RECIPES_BY_ID'), row = compiled[DESC];
assert(raw && row, 'the content build must carry the actual linen recipe');
assert.equal(raw.editorId, 'ThornswoodRecipeLinenWrap');
assert.equal(raw.out, '34cd6:Skyrim.esm');
assert.deepEqual([row.owner, row.half, row.rank, row.makes], ['Tailor', 'Haberdasher', 'novice', 1]);
const base = Object.keys(tables.table('BENCH_BY_BASE')).find(key => tables.table('BENCH_BY_BASE')[key] === raw.bench);
assert(base, 'the actual compiled loom must have furniture');
const w = standIn.world({ name: '4647-linen-wrap' });
try {
  const CITY = '1691d:Skyrim.esm', COTTON = w.idOf('3f7f8:Skyrim.esm'), LINEN = w.idOf(raw.out);
  const SHEARS = w.idOf('1b000:Thornswood-Content.esp'), POS = [1000, 0, 0];
  w.record(base, 'FURN');
  const loom = w.ref(0xff004640, { base, cell: CITY, pos: POS });
  const people = ['tailor', 'smith', 'tailor'].map((prof, i) => w.person(0xff004647 + i, {
    profileId: 1000 + i * 2, name: 'Maker ' + i, prof,
    half: prof === 'tailor' ? 'haberdasher' : 'edgewright', cell: CITY, pos: [1040 + i * 10, 0, 0],
    inventory: { entries: [{ baseId: SHEARS, count: 1 }].concat(i === 2 ? [] : [{ baseId: COTTON, count: 2 }]) }
  }));
  yes('the whole gamemode loads with the generated linen tables', w.boot());
  if (w.loaded()) {
    const consumers = Object.entries(recipes).filter(([, recipe]) => recipe.inputItems.some(input => input.item === raw.out));
    yes('every current linen consumer has a supply path through the actual new recipe',
      consumers.length > 0 && consumers.every(([, recipe]) => recipe.inputItems.filter(input => input.item === raw.out)
        .every(input => input.suppliedVia === raw.editorId && input.hops === 1)));
    const cut = consumers.filter(([, recipe]) => recipe.book === 'cut');
    yes('cut consumers remain absent or refused in the server recipe table',
      cut.length > 0 && cut.every(([desc]) => !compiled[desc] || !!compiled[desc].nobody));
    people.forEach(w.arrive); w.run(30000);
    people.forEach(actor => { w.row(actor).thornswoodNeeds = { food: 90, drink: 90, rest: 90, temp: 50, at: w.now() }; });
    const craft = { recipe: w.idOf(DESC), output: LINEN, count: raw.makes,
      inputs: raw.inputItems.map(input => ({ baseId: w.idOf(input.item), count: input.count })) };
    const [tailor, smith, empty] = people;
    const before = w.count(tailor, COTTON);
    const made = w.craft(tailor, loom, craft);
    yes('a novice Haberdasher crafts one ordinary Linen Wrap from one cotton',
      made.made && w.count(tailor, LINEN) === 1 && w.count(tailor, COTTON) === before - 1);
    const smithPack = JSON.stringify(w.row(smith).inventory);
    const refused = w.craft(smith, loom, craft);
    yes('a different profession cannot craft linen or spend its cotton',
      !refused.started && !refused.made && JSON.stringify(w.row(smith).inventory) === smithPack);
    const emptyPack = JSON.stringify(w.row(empty).inventory);
    const missing = w.craft(empty, loom, craft);
    yes('without cotton there is no work, output or inventory change',
      !missing.started && !missing.made && JSON.stringify(w.row(empty).inventory) === emptyPack);
    const completed = w.craft(tailor, loom, craft);
    const exhausted = w.craft(tailor, loom, craft);
    yes('two cotton make two wraps and another request cannot create a third',
      completed.made && !exhausted.made && w.count(tailor, COTTON) === 0 && w.count(tailor, LINEN) === 2);
    yes('no handler or timer throws', w.faults.length === 0 && w.threw.length === 0 &&
      w.logged(/\] on[A-Z][A-Za-z]+ threw/).length === 0);
  }
  t.done(w);
} finally { w.done(); }
