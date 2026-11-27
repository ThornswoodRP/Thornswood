'use strict';
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');
let result;
for (const command of ['python', 'python3']) {
  result = cp.spawnSync(command, [path.join(__dirname, 'claimable-door-unlocks-cases.py')], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 30000,
  });
  if (!result.error || result.error.code !== 'ENOENT') break;
}
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
assert(!result.error, String(result.error));
assert.equal(result.status, 0, 'the four exact claimable-door controls must pass');
assert.match(result.stderr, /Ran [1-9][0-9]* tests?/);
assert.match(result.stderr, /\bOK\b/);
console.log('PASS four XLOC-only overrides preserve ownership, native fields and unlocked exits');
