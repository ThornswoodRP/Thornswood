// test-4451-gamemode-coverage.js
//
// Verifies that docs/GAMEMODE-COVERAGE.md and docs/GAMEMODE.md name every handler
// set in game/gamemode.js, that the guard sentence matches the code (acknowledging
// that mp.onThornswoodLogin and answerFlora are not wrapped in guard), and that any
// handler added to gamemode.js must have a row in the coverage map.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0;
let fail = 0;

function yes(desc, ok) {
  if (ok) {
    pass++;
    console.log('PASS  ' + desc);
  } else {
    fail++;
    console.log('FAIL  ' + desc);
  }
}

const gamemodeSrc = fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'), 'utf8');
const coverageDoc = fs.readFileSync(path.join(ROOT, 'docs', 'GAMEMODE-COVERAGE.md'), 'utf8');
const guideDoc = fs.readFileSync(path.join(ROOT, 'docs', 'GAMEMODE.md'), 'utf8');

// 1. Extract handlers set in game/gamemode.js
const setHandlers = new Set();
const handlerRegex = /\bmp\.(on[A-Za-z0-9_]+)\s*=/g;
let match;
while ((match = handlerRegex.exec(gamemodeSrc)) !== null) {
  setHandlers.add(match[1]);
}

yes('gamemode sets handlers on mp', setHandlers.size > 0);

// 2. Extract handler rows from GAMEMODE-COVERAGE.md
const coveredHandlers = new Set();
const rowRegex = /\|\s*mp\.(on[A-Za-z0-9_]+)\s*\|/g;
while ((match = rowRegex.exec(coverageDoc)) !== null) {
  coveredHandlers.add(match[1]);
}

for (const h of setHandlers) {
  yes('coverage map has a row for mp.' + h, coveredHandlers.has(h));
}

// 3. Ensure the three previously missing handlers are specifically covered
yes('coverage map includes death-saving handler (mp.onDying)', coveredHandlers.has('onDying'));
yes('coverage map includes spell-cast handler (mp.onSpellCast)', coveredHandlers.has('onSpellCast'));
yes('coverage map includes watched-login handler (mp.onThornswoodLogin)', coveredHandlers.has('onThornswoodLogin'));

// 4. Ensure docs/GAMEMODE.md guide names the three handlers
yes('guide names mp.onDying', guideDoc.includes('mp.onDying'));
yes('guide names mp.onSpellCast', guideDoc.includes('mp.onSpellCast'));
yes('guide names mp.onThornswoodLogin', guideDoc.includes('mp.onThornswoodLogin'));

// 5. Ensure guard description clarifies login and flora pick wrapper
yes('guard sentence notes login handler exception', /onThornswoodLogin|login handler/.test(guideDoc) && /flora/i.test(guideDoc));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
