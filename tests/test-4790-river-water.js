'use strict';
/*
  test-4790-river-water.js

      node tests/test-4790-river-water.js

  #4790. River Water is a record of its own in the content plugin, written by
  scripts/mods/Add-ContentRecords.py. tests/test-4790-river-water.py checks
  that builder against stand-in masters. The gate and the nightly start
  test-*.js and test-*.ps1 only (scripts/dev/Harness-Files.ps1), so this runs
  it with the machine's Python 3 and passes its lines on. No Python 3 is a
  failure, not a skip: the builder would go unchecked.
*/
const cp = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HARNESS = 'tests/test-4790-river-water.py';
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
yes('a Python 3 to run the harness (' + (PY || 'none found') + ')', PY !== null);
if (PY) {
  const r = cp.spawnSync(PY, (PY === 'py' ? ['-3'] : []).concat([path.join(ROOT, HARNESS)]),
    { cwd: ROOT, encoding: 'utf8', timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
  const said = ((r.stdout || '') + (r.stderr || '')).trim();
  const last = said.split(/\r?\n/).pop() || '';
  yes(HARNESS + ' passes (exit ' + r.status + ', ' + last + ')', r.status === 0 && /^OK\b/.test(last));
  if (r.status !== 0) { console.log(said.split(/\r?\n/).map((l) => '      ' + l).join('\n')); }
}
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
