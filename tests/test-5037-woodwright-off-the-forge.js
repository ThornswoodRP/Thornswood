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
// Thornswood-Last.esp, but the loop passed over a cut row
// (docs/systems/cut-items.json), so a cut row kept the forge its mod put it
// at, and the forge still listed it.
//
// This holds the loop: it moves a cut row with the rest. The tables it builds
// (game/data/recipes.json and what is read out of it) come from the merged
// loop in a pull request of their own, which adds the check on the rows
// themselves (#5037). Read only.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0;
let fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const ps = fs.readFileSync(path.join(ROOT, 'scripts', 'dev', 'Build-RecipeTable.ps1'), 'utf8');
const loopAt = ps.indexOf('\n$movedCount = @{}');
const loopEnd = loopAt < 0 ? -1 : ps.indexOf('\nif ($movedCount.Count -eq 0)', loopAt);
const loop = (loopAt >= 0 && loopEnd > loopAt) ? ps.slice(loopAt, loopEnd) : '';
yes('Build-RecipeTable.ps1 has its move loop', loop.indexOf('MovedFromName') >= 0);
yes('the move loop does not pass over a cut row', !!loop && !/Book\s+-eq\s+'cut'/.test(loop));
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
