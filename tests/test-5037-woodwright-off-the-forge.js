'use strict';
// test-5037-woodwright-off-the-forge.js
//
//     node tests/test-5037-woodwright-off-the-forge.js
//
// Issue #5037: bows, arrows, instruments and fishing poles still showed at
// the forge, though they are the Woodwright's work and are made at the
// woodworking bench Thornswood-Content.esp ships (Patrick, 12 Oct 2026).
//
// Skyrim's crafting menu lists every recipe whose bench keyword (BNAM) is one
// of the bench's keywords, whatever the server would answer. TRADE_BENCHES in
// scripts/dev/Build-RecipeTable.ps1 moves a row to its trade's home bench
// (#3120), and scripts/mods/Build-LastPlugin.py carries that move in
// Thornswood-Last.esp, but it moved only rows somebody can make. A cut row
// (docs/systems/cut-items.json) kept the forge its mod put it at, so the
// forge still listed it.
//
// This reads game/data/recipes.json, the table the last plugin's moves come
// from, and fails on any Woodwright row of those four kinds whose bench is
// still the forge, cut or not, naming each. Read only.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0;
let fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const FORGE = 'CraftingSmithingForge';
const WOODWORKING = 'ThornswoodCraftingWoodworking';

// The four kinds the issue names, read off the row the way the recipe build
// sorted it: its family, or for an instrument or a fishing pole (a WEAP with
// no kind keyword, a MISC) the output itself.
function kindOf(row) {
  if (row.family === 'Bows') { return 'bow'; }
  if (row.family === 'Arrows and bolts') { return 'arrow or bolt'; }
  if (/instrument/i.test(String(row.why || ''))) { return 'instrument'; }
  if (/^Fishing Pole/i.test(String(row.name || ''))) { return 'fishing pole'; }
  return '';
}

const table = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'recipes.json'), 'utf8'));
const rows = table.recipes || {};
const found = { bow: 0, 'arrow or bolt': 0, instrument: 0, 'fishing pole': 0 };
const atForge = [];
for (const desc of Object.keys(rows)) {
  const row = rows[desc];
  if (row.owner !== 'Woodworker' || row.half !== 'Woodwright') { continue; }
  const kind = kindOf(row);
  if (!kind) { continue; }
  found[kind]++;
  if (row.benchName === FORGE) {
    atForge.push(kind + ': ' + row.name + ' (' + desc + ', ' + row.editorId + (row.book ? ', ' + row.book : '') +
      (row.fires === false ? ', never asked of the server' : '') + ')');
  }
}

// So a reader that finds nothing cannot pass.
for (const k of Object.keys(found)) {
  yes('the table has Woodwright ' + k + ' rows to check (' + found[k] + ')', found[k] > 0);
}
yes('no Woodwright bow, arrow, bolt, instrument or fishing pole is at the forge (' + atForge.length + ' are)', atForge.length === 0);
for (const line of atForge) { console.log('      at the forge: ' + line); }

// Each moved row says where its mod put it, which is what Build-LastPlugin.py
// reads to move it.
let unsaid = 0;
for (const desc of Object.keys(rows)) {
  const row = rows[desc];
  if (row.owner !== 'Woodworker' || row.half !== 'Woodwright' || !kindOf(row)) { continue; }
  if (row.benchName === WOODWORKING && row.movedFromName === FORGE && !row.movedFrom) { unsaid++; }
}
yes('every one moved off the forge carries movedFrom for the last plugin (' + unsaid + ' do not)', unsaid === 0);

// The source: the move loop in Build-RecipeTable.ps1 moves a cut row with the
// rest. The table half above holds once recipes.json is rebuilt from the game
// (scripts/mods/Rebuild-ContentTables.ps1); this half holds on the script.
const ps = fs.readFileSync(path.join(ROOT, 'scripts', 'dev', 'Build-RecipeTable.ps1'), 'utf8');
const loopAt = ps.indexOf('\n$movedCount = @{}');
const loopEnd = loopAt < 0 ? -1 : ps.indexOf('\nif ($movedCount.Count -eq 0)', loopAt);
const loop = (loopAt >= 0 && loopEnd > loopAt) ? ps.slice(loopAt, loopEnd) : '';
yes('Build-RecipeTable.ps1 has its move loop', loop.indexOf('MovedFromName') >= 0);
yes('the move loop does not pass over a cut row', !!loop && !/Book\s+-eq\s+'cut'/.test(loop));
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
