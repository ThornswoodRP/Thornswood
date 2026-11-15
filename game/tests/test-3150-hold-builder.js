'use strict';
/*
  test-3150-hold-builder.js

  #3150. Patrick's page answer, 22 Oct 2026 (A): each hold has 2 to 3
  hold-only plants, ores or animals, which grow only in their own hold.
  scripts/mods/Build-LastPlugin.py (step 10) switches off every placed one
  standing outside its hold, once game/data/last-plugin-policy.json holdOnly
  names them.

  This runs tests/hold-only-cases.py, which holds the builder's part to small
  records made there, without the game.

    B1  the cases pass
*/
const path = require('path');
const { spawnSync } = require('child_process');
const CASES = path.join(__dirname, '..', '..', 'tests', 'hold-only-cases.py');

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
yes('B1 the hold-only cases pass (python tests/hold-only-cases.py)', !!run && run.status === 0);
if (!run || run.status !== 0) { console.log(run ? run.stdout + run.stderr : 'no python here'); }

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
