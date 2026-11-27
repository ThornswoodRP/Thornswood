// Build-FuelTable.js
//
// Writes game\data\fuel-by-recipe.json, FUEL_BY_RECIPE: for every recipe at
// a forge, a skyforge or a smelter, the grade of charcoal it burns, the metal
// that asks for it, and whether it takes a Tool Handle. Thornswood-Last.esp
// is built from it (#6726); the gamemode reads none of it, so it is not a
// gamemode table (game\gamemode-tables is only what the gamemode reads,
// #5191), and like every built file it is out of git.
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
// THE HANDLE, ON THE SAME ROW (#1398, #6726). smith.md: a war axe, a
// battleaxe, a warhammer and a mace are a metal head on a wooden haft, and
// each takes 1 Tool Handle on top of its ingots. A recipe whose record
// already names the handle (the three tools) does not take a second one.
//
// WHERE THE TABLE GOES (#6726). The forge's list is the game's own menu, and
// it shows and takes what each record names, so the charcoal and the handle
// are written into the records: scripts/mods/Build-LastPlugin.py adds the
// grade's item (GRADE_ITEMS) and the handle to every recipe here it copies,
// and scripts/dev/Build-Recost.py puts one of a plugin it never copies in
// RECIPES_SET_IN_GAME with them on top, so each game adds them. Both take
// the items from this file, which names them beside the table. The server
// takes nothing of its own for either any more.
//
// Run it after Build-RecipeTable.ps1 rebuilds recipes.json, before
// Build-Recost.py. game\tests\test-1398-fuel.js
// fails while the table and this script disagree.
//
// Read only except for game\data\fuel-by-recipe.json, which it writes.
//
// Usage:
//   node scripts\dev\Build-FuelTable.js
//   node scripts\dev\Build-FuelTable.js --recipes <file> --out <file>
//   node scripts\dev\Build-FuelTable.js --print
'use strict';
const fs = require('fs');
const path = require('path');
const TABLES = require('./GamemodeTables.js');
const FILE = path.join(__dirname, '..', '..', 'game', 'data', 'fuel-by-recipe.json');

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

// The item each grade is, by grade (Add-ContentRecords.py CHARCOAL_GRADES).
// The Charcoal grade is Skyrim's own Charcoal, which the Charburner's kiln
// makes (Patrick's B on #6726), so the charcoal found in the world is the
// same thing.
const GRADE_ITEMS = [null, '15481:Thornswood-Content.esp', '33760:Skyrim.esm',
  '15484:Thornswood-Content.esp', '15485:Thornswood-Content.esp'];

// The Tool Handle, and the four families fitted to one.
const HANDLE = '15490:Thornswood-Content.esp';
const HAFTED_FAMILIES = ['War axes', 'Battleaxes', 'Warhammers', 'Maces'];

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

/** 1 when a row is fitted to a handle its record does not name, else 0. */
function handleOf(row) {
  if (HAFTED_FAMILIES.indexOf(String((row && row.family) || '')) === -1) { return 0; }
  for (const input of (row.inputItems || [])) {
    if (input && input.item === HANDLE) { return 0; }
  }
  return 1;
}

/** [grade, metal, bench, handle] for one row, or null when it is at no fuel
 *  bench. */
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
  return [grade, metal, bench, handleOf(row)];
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
 *  for it or nothing, the bench, 1 when it takes a handle], in desc order. */
function tableJson(table) {
  const keys = Object.keys(table).sort();
  return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + JSON.stringify(table[k]); }).join(',') + '}';
}

/** The file's text: the item each grade is (grades, by grade, none at 0),
 *  the handle, and the table (recipes), so the builders that read it take
 *  the items from here and not from copies of their own. */
function fileJson(table) {
  return '{"grades":' + JSON.stringify(GRADE_ITEMS) + ',"handle":' + JSON.stringify(HANDLE) + ',"recipes":' + tableJson(table) + '}';
}

/** The built file, from its place (or another): { grades, handle, recipes }. */
function read(file) {
  return JSON.parse(fs.readFileSync(file || FILE, 'utf8'));
}

/** Writes the table laid out as the gamemode tables are, LF; false when the
 *  file already holds it. */
function write(table, file) {
  const f = file || FILE;
  const body = TABLES.layout(fileJson(table));
  try { if (fs.readFileSync(f, 'utf8') === body) { return false; } } catch (e) { if (e.code !== 'ENOENT') { throw e; } }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
  return true;
}

module.exports = { FILE: FILE, read: read, write: write, fileJson: fileJson, METALS: METALS, INGOTS: INGOTS, GRADE_ITEMS: GRADE_ITEMS, HANDLE: HANDLE, HAFTED_FAMILIES: HAFTED_FAMILIES,
  fuelOf: fuelOf, handleOf: handleOf, fuelTable: fuelTable, tableJson: tableJson };

if (require.main === module) {
  const code = cli();
  if (code !== undefined) process.exitCode = code;
}
// Run as a program. A function, so a stop is a return and not node's exit
// function, which can hang on Node 24 (#6036).
function cli() {
  const opts = TABLES.options(process.argv.slice(2), ['--recipes', '--out'], ['--print']);
  if (!opts) return;
  const ROOT = path.join(__dirname, '..', '..');
  const RECIPES = opts['--recipes'] || path.join(ROOT, 'game', 'data', 'recipes.json');
  const OUT = opts['--out'] || FILE;
  const data = JSON.parse(fs.readFileSync(RECIPES, 'utf8').replace(/^﻿/, ''));
  const table = fuelTable(data);
  if (opts['--print']) {
    Object.keys(table).sort().forEach(function (k) {
      const row = (data.recipes || {})[k] || (data.unowned || {})[k] || {};
      console.log(table[k][2] + '\t' + table[k][0] + '\t' + (table[k][1] || '-') + '\t' + row.name + '\t' + k);
    });
    return 0;
  }
  const per = [0, 0, 0, 0, 0];
  let handles = 0;
  Object.keys(table).forEach(function (k) { per[table[k][0]]++; handles += table[k][3]; });
  const changed = write(table, OUT);
  console.log('FUEL_BY_RECIPE: ' + Object.keys(table).length + ' recipes at a forge, a skyforge or a smelter, out of ' +
    Object.keys(data.recipes || {}).length + '; ' + per[1] + ' burn Poor Charcoal, ' + per[2] + ' Charcoal, ' + per[3] +
    ' Charcoal Briquette and ' + per[4] + ' Coke; ' + handles + ' take a handle' + (changed ? '; written' : '; already current'));
}
