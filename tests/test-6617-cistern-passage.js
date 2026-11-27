'use strict';
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');
let result;
for (const command of ['python', 'python3']) {
  result = cp.spawnSync(command, [path.join(__dirname, 'cistern-passage-cases.py')], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 30000,
  });
  if (!result.error || result.error.code !== 'ENOENT') break;
}
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
assert(!result.error, String(result.error));
assert.equal(result.status, 0, 'the exact Cistern passage controls must pass');
assert.match(result.stderr, /Ran [1-9][0-9]* tests?/);
assert.match(result.stderr, /\bOK\b/);
console.log('PASS Cistern passage preserves both authored returns and rejects changed or protected roles');

// The aggregate floor/station harnesses use this actual shared helper.
const { doorReferenceOverrides } = require('./last-plugin-made.js');
const manifest = {
  gatesUnlocked: ['gate'], riftwealdUnlocked: ['bar'], claimableDoorsUnlocked: ['keyed'],
  authoredDoorsUnlocked: ['lock'], authoredDoorsDirectActivation: ['parent'],
  cisternPassage: { enabled: ['after1', 'after2'], disabled: ['before1', 'before2', 'cover'] },
  unrecognizedCategory: ['stray'],
};
const expected = ['gate', 'bar', 'keyed', 'lock', 'parent', 'after1', 'after2', 'before1', 'before2', 'cover'];
const edits = doorReferenceOverrides(manifest);
assert.equal(edits.size, expected.length);
for (const ref of expected) assert(edits.has(ref), ref);
assert(!edits.has('stray'));
assert.equal(doorReferenceOverrides({}).size, 0);
const duplicate = structuredClone(manifest);
duplicate.cisternPassage.enabled.push('gate');
assert.equal(doorReferenceOverrides(duplicate).size, expected.length);
assert(!doorReferenceOverrides({ other: { enabled: ['bad'] } }).has('bad'));
console.log('PASS five actual floor-helper controls retain exact reference accounting');
