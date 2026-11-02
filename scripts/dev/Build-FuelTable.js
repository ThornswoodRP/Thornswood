// Build-FuelTable.js
//
// Writes the gamemode's FUEL_BY_RECIPE table (game\gamemode-tables, #5191):
// for every recipe the
// server is asked about at a forge, a skyforge or a smelter, the grade of
// charcoal it burns and the metal that asks for it.
//
// WHY (#1398)
//
// docs\systems\professions\smith.md: "Every forge and every skyforge burns
// one charcoal. No charcoal of the grade the metal asks for, the piece is not
// made." Then the grade table, and "Smelting an ingot uses the same grade as
// that metal. A skyforge asks for one grade poorer than the table."
//
// The server could not answer that from what it carries. Its recipe table,
// RECIPES_BY_ID, has no bench and no ingredients on its rows (measured on
// 4 October: no installed row carries benchName), so the old charcoal rule
// never fired, and nothing on a row says what metal it is. game\data\recipes.json
// has both, so the grade is worked out here, once, and installed as a table.
//
// HOW A ROW GETS ITS GRADE
//
//   1. The metals it is or holds. A metal the smith page's table names counts
//      when its word is in the name of what the row makes ("Ebony Sword",
//      "Ancient Nord Helmet", "Nordic Bow"), or when the row makes or asks for
//      that metal's ingot. The ingot of a metal is the vanilla one: elven is
//      Refined Moonstone and glass is Refined Malachite, the way Skyrim's own
//      recipes make them.
//   2. The hottest of those, because a higher metal needs more heat. A row
//      naming none of the table's metals (leather, fur, corundum, a lute)
//      still burns one charcoal, the lowest grade.
//   3. At a skyforge, one grade poorer, and Poor Charcoal does not get poorer.
//
// Rows a profession owns that are not cut, at those three benches, and the
// smelts nobody owns that make one of the table's ingots (the dwarven smelt
// KEPT_SMELT keeps is one). A row that is not in this table burns nothing.
//
// Run it after Build-RecipeTable.ps1 rebuilds recipes.json. tests\test-1398-fuel.js
// fails while the table and this script disagree.
//
// Read only except for the FUEL_BY_RECIPE table, which it writes.
//
// Usage:
//   node scripts\dev\Build-FuelTable.js
//   node scripts\dev\Build-FuelTable.js --recipes <file> --tables <folder>
//   node scripts\dev\Build-FuelTable.js --print
'use strict';
const fs = require('fs');
const path = require('path');
const TABLES = require('./GamemodeTables.js');

// The bench keyword, and what it is called in the sentence that refuses.
const BENCHES = {
  CraftingSmithingForge: 'forge',
  CraftingSmithingSkyforge: 'skyforge',
  CraftingSmelter: 'smelter'
};

// The smith page's table: metal -> grade. 1 Poor Charcoal, 2 Charcoal,
// 3 Charcoal Briquette, 4 Coke.
const METALS = {
  'iron': 1, 'steel': 1, 'ancient nord': 1, 'skyforge steel': 1,
  'silver': 2, 'dwarven': 2, 'elven': 2, 'orcish': 2, 'falmer': 2,
  'nordic': 3, 'glass': 3, 'ebony': 3,
  'stalhrim': 4
};

// Each metal's ingot, by the name the records give it.
const INGOTS = {
  'iron ingot': 'iron',
  'steel ingot': 'steel',
  'silver ingot': 'silver',
  'dwarven metal ingot': 'dwarven',
  'refined moonstone': 'elven',
  'orichalcum ingot': 'orcish',
  'refined malachite': 'glass',
  'ebony ingot': 'ebony',
  'stalhrim': 'stalhrim'
};

/** The table's metals whose word is in a name, as whole words. */
function metalsInName(name) {
  const low = ' ' + String(name || '').toLowerCase().replace(/[^a-z]+/g, ' ') + ' ';
  const out = [];
  for (const metal of Object.keys(METALS)) {
    if (low.indexOf(' ' + metal + ' ') !== -1) { out.push(metal); }
  }
  return out;
}

/** [grade, metal, bench] for one row, or null when it is at no fuel bench. */
function fuelOf(row) {
  const bench = BENCHES[String((row && row.benchName) || '')];
  if (!bench) { return null; }
  const found = metalsInName(row.name);
  const named = INGOTS[String(row.name || '').toLowerCase()];
  if (named) { found.push(named); }
  for (const input of (row.inputItems || [])) {
    const metal = INGOTS[String((input && input.name) || '').toLowerCase()];
    if (metal) { found.push(metal); }
  }
  let grade = 1, metal = '';
  for (const m of found) {
    // The first metal named at the hottest grade: the name before the inputs.
    if (METALS[m] > grade || (METALS[m] === grade && !metal)) { grade = METALS[m]; metal = m; }
  }
  if (bench === 'skyforge') { grade = Math.max(1, grade - 1); }
  return [grade, metal, bench];
}

/** Every row the table carries, by recipe. */
function fuelTable(data) {
  const out = {};
  const owned = data.recipes || {};
  for (const id of Object.keys(owned)) {
    const row = owned[id];
    if (!row || row.book === 'cut' || row.fires === false) { continue; }
    const fuel = fuelOf(row);
    if (fuel) { out[id] = fuel; }
  }
  const unowned = data.unowned || {};
  for (const id of Object.keys(unowned)) {
    const row = unowned[id];
    if (!row || row.benchName !== 'CraftingSmelter') { continue; }
    if (!INGOTS[String(row.name || '').toLowerCase()]) { continue; }
    const fuel = fuelOf(row);
    if (fuel) { out[id] = fuel; }
  }
  return out;
}

/** The table as JSON text, recipe desc -> [grade 1 to 4, the metal that asks
 *  for it or nothing, the bench], in desc order. */
function tableJson(table) {
  const keys = Object.keys(table).sort();
  return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + JSON.stringify(table[k]); }).join(',') + '}';
}

module.exports = { METALS: METALS, INGOTS: INGOTS, fuelOf: fuelOf, fuelTable: fuelTable, tableJson: tableJson };

if (require.main === module) {
  const opts = TABLES.options(process.argv.slice(2), ['--recipes', '--tables'], ['--print']);
  const ROOT = path.join(__dirname, '..', '..');
  const RECIPES = opts['--recipes'] || path.join(ROOT, 'game', 'data', 'recipes.json');
  const DIR = opts['--tables'] || TABLES.DIR;
  const data = JSON.parse(fs.readFileSync(RECIPES, 'utf8').replace(/^﻿/, ''));
  const table = fuelTable(data);
  if (opts['--print']) {
    Object.keys(table).sort().forEach(function (k) {
      const row = (data.recipes || {})[k] || (data.unowned || {})[k] || {};
      console.log(table[k][2] + '\t' + table[k][0] + '\t' + (table[k][1] || '-') + '\t' + row.name + '\t' + k);
    });
    process.exit(0);
  }
  const per = [0, 0, 0, 0, 0];
  Object.keys(table).forEach(function (k) { per[table[k][0]]++; });
  const changed = TABLES.write('FUEL_BY_RECIPE', tableJson(table), DIR);
  console.log('FUEL_BY_RECIPE: ' + Object.keys(table).length + ' recipes at a forge, a skyforge or a smelter, out of ' +
    Object.keys(data.recipes || {}).length + '; ' + per[1] + ' burn Poor Charcoal, ' + per[2] + ' Charcoal, ' + per[3] +
    ' Charcoal Briquette and ' + per[4] + ' Coke' + (changed ? '; written' : '; already current'));
}
