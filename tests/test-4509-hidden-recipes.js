'use strict';
/*
  test-4509-hidden-recipes.js

  #4509 (Patrick, 9 Nov 2026, option A): the instruments people own are
  Skyrim's own, not PlayFluteLuteDrum.esp's weapons. That plugin's three
  recipes turn Skyrim's instruments into the weapons, and it loads after
  Thornswood-Content.esp, so scripts/mods/Build-LastPlugin.py hides them in
  Thornswood-Last.esp, where the policy names them (recipesHidden).

  This runs tests/hidden-recipes-cases.py, which holds the builder to small
  records made there, without the game, and the policy to the three.

    H1  the cases pass
*/
const path = require('path');
const { spawnSync } = require('child_process');
const CASES = path.join(__dirname, 'hidden-recipes-cases.py');

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
yes('H1 the hidden recipe cases pass (python tests/hidden-recipes-cases.py)', !!run && run.status === 0);
if (!run || run.status !== 0) { console.log(run ? run.stdout + run.stderr : 'no python here'); }

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
