'use strict';
// #4634: check both plugin writers against scratch masters on the gate.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const cases = path.join(__dirname, '..', '..', 'tests', 'test-4634-build-masters.py');
let run;
for (const [exe, args] of [['python3', []], ['python', []], ['py', ['-3']]]) {
  run = spawnSync(exe, [...args, cases], { encoding: 'utf8' });
  if (run.error?.code !== 'ENOENT') break;
}
const ok = !run.error && run.status === 0;
if (!ok) console.log(run.error || [run.stdout, run.stderr].join(''));
console.log((ok ? 'PASS' : 'FAIL') + '  both plugin writers check candidate bytes against masters');
console.log(ok ? '1 passed, 0 failed' : '0 passed, 1 failed');
process.exitCode = ok ? 0 : 1;
