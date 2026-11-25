// test-6351-dish-names.js
//
// Issue #6351: scripts\mods\Add-ContentRecords.py named each fine dish from
// game\data\recipes.json, a table the chain builds after the plugin, so the
// box's clean checkout stopped on the plugin once no built table was
// committed (#5191). It now reads the plain dish's name from its winning
// record in the load order. The cases are Python, beside this:
// tests\dish-names-cases.py says each one.
//
//     node tests/test-6351-dish-names.js

const path = require('path');
const { spawnSync } = require('child_process');

const CASES = path.join(__dirname, 'dish-names-cases.py');

function python(args) {
  for (const exe of ['python', 'py', 'python3']) {
    const p = spawnSync(exe, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
    if (!p.error) { return p; }
  }
  return null;
}

const run = python(['-W', 'ignore::ResourceWarning', CASES]);
if (!run) {
  console.log('FAIL  python is on this machine');
  console.log('');
  console.log('0 passed, 1 failed');
  process.exitCode = 1;
  return;
}
process.stdout.write(run.stdout);
if (run.stderr) { process.stdout.write(run.stderr); }
process.exitCode = run.status === 0 ? 0 : 1;
