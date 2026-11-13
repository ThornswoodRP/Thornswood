// test-4354-salvaged-list.js
//
// Issue #4354: scripts\mods\List-SalvagedRecords.py writes
// scripts\mods\content-salvaged.json with no git history, so it runs on the
// box, and keeps a salvaged cell a station stands in (the Hall of the
// Elements' study desk, #1387) as Bethesda's. The cases are Python, beside
// this: tests\salvaged-list-cases.py says each one.
//
//     node game/tests/test-4354-salvaged-list.js

const path = require('path');
const { spawnSync } = require('child_process');

const CASES = path.join(__dirname, '..', '..', 'tests', 'salvaged-list-cases.py');

function python(args) {
  for (const exe of ['python', 'py', 'python3']) {
    const p = spawnSync(exe, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
    if (!p.error) { return p; }
  }
  return null;
}

const run = python([CASES]);
if (!run) {
  console.log('FAIL  python is on this machine');
  console.log('');
  console.log('0 passed, 1 failed');
  process.exit(1);
}
process.stdout.write(run.stdout);
if (run.stderr) { process.stdout.write(run.stderr); }
process.exit(run.status === 0 ? 0 : 1);
