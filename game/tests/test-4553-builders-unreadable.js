// test-4553-builders-unreadable.js
//
// Issue #4553: the bench, cast, door, crime, jail, well and admin name
// builders passed over a plugin of the load order that did not read, and read
// a compressed record that would not inflate as an empty one, so they built
// empty tables, wrote them, and exited 0. The cases are Python, beside this:
// tests\builders-unreadable-cases.py says each one.
//
//     node game/tests/test-4553-builders-unreadable.js

const path = require('path');
const { spawnSync } = require('child_process');

const CASES = path.join(__dirname, '..', '..', 'tests', 'builders-unreadable-cases.py');

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
