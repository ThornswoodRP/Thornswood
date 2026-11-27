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
// (game/data/cut-items.json), so a cut row kept the forge its mod put it
// at, and the forge still listed it.
//
// This holds the loop: it moves a cut row with the rest. It also holds the
// rows themselves, in the box's content build laid over the checkout
// (game/data/recipes.json and game/data/last-plugin.json, #5191), so a
// build that puts one back at the forge fails in the merge release's content
// checks before any release carries it:
// - the Woodwright's bows (family Bows), arrows and bolts (family Arrows and
//   bolts), instruments (its why says the output is an instrument) and
//   fishing poles (name starts Fishing Pole) are each found, so a reader that
//   finds nothing cannot pass;
// - not one of them, in any of the table's three lists, is at the forge
//   (CraftingSmithingForge), named by kind, name, record and editor ID;
// - each one at the woodworking bench that its mod put at the forge carries
//   movedFrom, and Thornswood-Last.esp's benchMoves moves that record from
//   the forge to the woodworking bench, which is what the crafting menu
//   reads. Read only.

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

// #5886: the rule that gives a fishing pole that is a MISC record to the
// Woodwright matched the spear words too, and outside a WEAP "Spear" is in
// the name of two Playable Rieklings spell tomes. It matches the fishing
// pole words alone.
const poleWords = (ps.match(/^\$FISHING_POLE_WORDS = @\(([^)]*)\)/m) || [])[1] || '';
yes('the fishing pole words are only fishing pole words (#5886)',
  /Fishing ?Pole/.test(poleWords) && !/'(Spear|Pike|Halberd)'/.test(poleWords));
const poleAt = ps.indexOf("$reason = 'the output is a fishing pole");
const poleRule = poleAt < 0 ? '' : ps.slice(ps.lastIndexOf('\n', ps.lastIndexOf('if (', poleAt)), poleAt);
yes('the rule for a fishing pole that is not a WEAP matches the fishing pole words, not the spear words (#5886)',
  /MatchesWord \$o\.Edid \$FISHING_POLE_WORDS/.test(poleRule) && /MatchesWord \$o\.Name \$FISHING_POLE_WORDS/.test(poleRule) &&
  poleRule.indexOf('$SPEAR_WORDS') < 0);

// ---- the rows, in the content build -----------------------------------------

const FORGE = 'CraftingSmithingForge';
const BENCH = 'ThornswoodCraftingWoodworking';
const table = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'recipes.json'), 'utf8'));
const last = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'last-plugin.json'), 'utf8'));

function kind(row) {
  if (row.family === 'Bows') return 'bow';
  if (row.family === 'Arrows and bolts') return 'arrow or bolt';
  if (/^the output is an instrument\b/.test(row.why || '')) return 'instrument';
  if (/^Fishing Pole\b/.test(row.name || '')) return 'fishing pole';
  return null;
}
const KINDS = ['bow', 'arrow or bolt', 'instrument', 'fishing pole'];

const found = {};
for (const k of KINDS) found[k] = 0;
const atForge = [];
const noMovedFrom = [];
const notMoved = [];
const moves = new Map((last.benchMoves || []).map(m => [String(m.recipe).toLowerCase(), m]));
// The woodworking bench's keyword, as the rows give it.
let benchKey = null;

for (const list of ['recipes', 'refused', 'unowned']) {
  for (const [id, row] of Object.entries(table[list] || {})) {
    const woodwright = row.owner === 'Woodworker' && row.half === 'Woodwright';
    // A row the table gives nobody still shows at its bench, so the forge is
    // read for every row of these kinds; a kind is counted for the Woodwright.
    const k = kind(row);
    if (!k) continue;
    if (woodwright && list === 'recipes') found[k]++;
    const what = k + ' ' + row.name + ' (' + id + ', ' + row.editorId + ', ' + list + ')';
    if (row.benchName === FORGE) atForge.push(what);
    if (row.benchName === BENCH) {
      if (!benchKey) benchKey = String(row.bench).toLowerCase();
      if (row.movedFromName === FORGE) {
        if (!row.movedFrom) { noMovedFrom.push(what); continue; }
        const m = moves.get(id.toLowerCase());
        if (!m || String(m.from).toLowerCase() !== String(row.movedFrom).toLowerCase()
          || String(m.to).toLowerCase() !== String(row.bench).toLowerCase()) notMoved.push(what);
      }
    }
  }
}
// A spell tome is never woodworking (#5886), in any of the three lists.
const tomes = [];
for (const list of ['recipes', 'refused', 'unowned']) {
  for (const [id, row] of Object.entries(table[list] || {})) {
    if ((row.type === 'BOOK' || /^Spell Tome\b/.test(row.name || '')) && (row.owner === 'Woodworker' || row.half === 'Woodwright')) {
      tomes.push(row.name + ' (' + id + ', ' + row.editorId + ', ' + list + ')');
    }
  }
}
yes('no spell tome or other book is the Woodwright\'s (#5886)', tomes.length === 0);
for (const w of tomes) console.log('      the Woodwright\'s: ' + w);
for (const k of KINDS) yes('the table has the Woodwright\'s ' + k + ' rows (' + found[k] + ')', found[k] > 0);
yes('the woodworking bench is a keyword of Thornswood-Content.esp', !!benchKey && /:thornswood-content\.esp$/.test(benchKey));
yes('no bow, arrow, bolt, instrument or fishing pole is at the forge', atForge.length === 0);
for (const w of atForge) console.log('      at the forge: ' + w);
yes('each one moved off the forge says where from (movedFrom)', noMovedFrom.length === 0);
for (const w of noMovedFrom) console.log('      no movedFrom: ' + w);
yes('Thornswood-Last.esp moves each one from the forge to the woodworking bench', notMoved.length === 0);
for (const w of notMoved) console.log('      not in benchMoves: ' + w);
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
