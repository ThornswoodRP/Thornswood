'use strict';
/*
  test-4826-perks-off.js

  #4826 (Patrick, 22 Oct 2026, B: the whole vanilla perk system goes).
  Nobody here holds a vanilla perk, so a recipe that tests one was hidden by
  the crafting menu from everybody, whatever the server allowed.
  scripts/mods/Build-LastPlugin.py takes every perk test out of every winning
  recipe in Thornswood-Last.esp, and scripts/dev/Build-RecipeTable.ps1 reads
  that end state.

  This runs tests/perks-off-cases.py, which holds both to small records made
  there, without the game.

    P1  the cases pass
*/
const path = require('path');
const { spawnSync } = require('child_process');
const CASES = path.join(__dirname, 'perks-off-cases.py');

let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }

function python(args) {
  for (const exe of ['python', 'py', 'python3']) {
    const p = spawnSync(exe, args, { encoding: 'utf8', maxBuffer: 1 << 24 });
    if (!p.error) { return p; }
  }
  return null;
}

const run = python([CASES]);
yes('P1 the perk cases pass (python tests/perks-off-cases.py)', !!run && run.status === 0);
if (!run || run.status !== 0) { console.log(run ? run.stdout + run.stderr : 'no python here'); }

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
