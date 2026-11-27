'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
let result;
for (const command of ['python', 'python3']) {
  result = spawnSync(command, [path.join(__dirname, 'authored-door-defaults-cases.py')], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 30000,
  });
  if (!result.error || result.error.code !== 'ENOENT') break;
}
if (result.stderr) process.stderr.write(result.stderr);
assert.ifError(result.error);
assert.equal(result.status, 0);
assert.match(result.stderr, /Ran [1-9][0-9]* tests?/);
