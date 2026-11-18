'use strict';
/*
  test-5191-last-loop.js

      node tests/test-5191-last-loop.js

  #5191, Patrick's B on q-5191-last-plugin-loop: the steps before
  Build-LastPlugin.py never read Thornswood-Last.esp, and each takes that
  plugin's effect from the data that decides it. The builders that changed
  for it are held by Python harnesses, which build small Data folders with
  the builders' own record readers:

    tests/test-5191-door-gates.py       the gates the plugin unlocks
    tests/test-5191-cast-holds.py       the places it gives a hold
    tests/test-5191-catalogue-holds.py  the NPC catalogue and fishing spots

  The gate and the nightly start test-*.js and test-*.ps1 only
  (scripts/dev/Harness-Files.ps1), so until this ran them the first two were
  merged and run by nothing. This runs each with the machine's Python 3 and
  passes its lines on: one PASS or FAIL per harness, then each one's own
  lines. No Python 3 is a failure, not a skip: the builders would go
  unchecked.
*/
const cp = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HARNESSES = ['tests/test-5191-door-gates.py', 'tests/test-5191-cast-holds.py', 'tests/test-5191-catalogue-holds.py'];
let pass = 0;
let fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}

let PY = null;
for (const name of ['python', 'python3', 'py']) {
  const r = cp.spawnSync(name, (name === 'py' ? ['-3'] : []).concat(['-c', 'import sys; print(sys.version_info[0])']), { encoding: 'utf8' });
  if (!r.error && r.status === 0 && r.stdout.trim() === '3') { PY = name; break; }
}
yes('a Python 3 to run the harnesses (' + (PY || 'none found') + ')', PY !== null);
if (PY) {
  for (const h of HARNESSES) {
    const r = cp.spawnSync(PY, (PY === 'py' ? ['-3'] : []).concat([path.join(ROOT, h)]),
      { cwd: ROOT, encoding: 'utf8', timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
    const said = ((r.stdout || '') + (r.stderr || '')).trim();
    const last = said.split(/\r?\n/).pop() || '';
    yes(h + ' passes (exit ' + r.status + ', ' + last + ')', r.status === 0 && /^\d+ passed, 0 failed$/.test(last));
    if (r.status !== 0) { console.log(said.split(/\r?\n/).map((l) => '      ' + l).join('\n')); }
  }
}
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
