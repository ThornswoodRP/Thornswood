// A Vortex reference tag wins before the MD5/file ID comparison (#6449).
// https://github.com/Nexus-Mods/Vortex/blob/master/src/renderer/src/extensions/mod_management/util/testModReference.ts
'use strict';
const assert = require('node:assert/strict');
const { applySwaps, checkRefreshedTags, checkRepairFiles } = require('../scripts/release/nexus-collection.js');

const old = { tag: 'oldReader', md5: 'a'.repeat(32), fileId: 122686 };
const collection = {
  mods: [
    { name: 'Reader', version: '3.9', source: {
      type: 'nexus', modId: 13048, fileId: old.fileId, md5: old.md5,
      fileSize: 1, logicalFilename: 'Reader SE', tag: old.tag
    } },
    { name: 'Unchanged', source: { type: 'nexus', modId: 2, fileId: 3, tag: 'keepThis' } }
  ],
  modRules: [
    { type: 'after', source: { tag: old.tag }, reference: { tag: 'keepThis' } },
    { type: 'before', source: { tag: 'keepThis' }, reference: { tag: old.tag, fileMD5: old.md5 } },
    { type: 'after', source: { tag: 'keepThis' }, reference: { fileMD5: 'c'.repeat(32), tag: 'different' } }
  ]
};
const untouched = JSON.stringify(collection.mods[1]);
const unrelatedRule = JSON.stringify(collection.modRules[2]);
const swap = { modId: 13048, fileId: 462773, version: '4.6', md5: 'b'.repeat(32),
  fileSize: 2, logicalFilename: 'Reader AE' };
applySwaps(collection, [swap]);
const next = collection.mods[0].source;

// Vortex accepts an equal tag before checking the file's other identifiers.
function existingArchiveMatches(source, installed) {
  if (source.tag && source.tag === installed.tag) return true;
  return source.md5 === installed.md5 && source.fileId === installed.fileId;
}
assert.equal(existingArchiveMatches(next, old), false,
  'an installed copy of the old archive must not satisfy the moved dependency');
assert.match(next.tag, /^[A-Za-z0-9_-]{10}$/);
assert.notEqual(next.tag, old.tag);
assert.equal(next.fileId, swap.fileId);
assert.equal(next.md5, swap.md5);
assert.equal(existingArchiveMatches(next, { tag: next.tag, md5: swap.md5, fileId: swap.fileId }), true);
assert.equal(collection.modRules[0].source.tag, next.tag, 'tag-only source follows the moved entry');
assert.equal(collection.modRules[1].reference.tag, next.tag, 'tagged reference follows the moved entry');
assert.equal(collection.modRules[1].reference.fileMD5, swap.md5);
assert.equal(collection.modRules[0].reference.tag, 'keepThis');
assert.equal(collection.modRules[1].source.tag, 'keepThis');
assert.equal(JSON.stringify(collection.mods[1]), untouched);
assert.equal(JSON.stringify(collection.modRules[2]), unrelatedRule);
console.log('PASS moved archives reject the old Vortex tag; ordering references follow and unchanged entries stay intact');

// A published revision can need the identity repaired without changing files.
const repair = JSON.parse(JSON.stringify(collection));
repair.mods[0].hashes = [{ path: 'a.pex', md5: 'd'.repeat(32) }];
const before = JSON.parse(JSON.stringify(repair));
const previousTag = repair.mods[0].source.tag;
applySwaps(repair, [{ refreshTag: true, modId: 13048 }]);
const repairedTag = repair.mods[0].source.tag;
assert.notEqual(repairedTag, previousTag);
assert.match(repairedTag, /^[A-Za-z0-9_-]{10}$/);
assert.equal(existingArchiveMatches(repair.mods[0].source, { ...old, tag: previousTag }), false);
assert.equal(repair.modRules[0].source.tag, repairedTag);
assert.equal(repair.modRules[1].reference.tag, repairedTag);
assert.doesNotThrow(() => checkRefreshedTags(before, repair, [13048]));
assert.throws(() => checkRefreshedTags(before, before, [13048]), /fresh unique/);
const wrongFile = JSON.parse(JSON.stringify(repair));
wrongFile.mods[0].source.fileId++;
assert.throws(() => checkRefreshedTags(before, wrongFile, [13048]), /changed files/);
const staleRule = JSON.parse(JSON.stringify(repair));
staleRule.modRules[0].source.tag = previousTag;
assert.throws(() => checkRefreshedTags(before, staleRule, [13048]), /changed files/);
const unrelated = JSON.parse(JSON.stringify(repair));
unrelated.mods[1].name = 'Unexpected change';
assert.throws(() => checkRefreshedTags(before, unrelated, [13048]), /changed files/);
assert.throws(() => checkRefreshedTags(before, repair, [13048, 13048]), /distinct/);
repair.mods[0].source.tag = previousTag;
repair.modRules[0].source.tag = previousTag;
repair.modRules[1].reference.tag = previousTag;
assert.deepEqual(repair, before, 'identity repair changes no archive, choices, hashes, plugin or unrelated rule');
assert.throws(() => applySwaps(repair, [{ refreshTag: true, modId: 999 }]), /no one entry/);
console.log('PASS explicit identity repair preserves the published files and refuses an absent mod');

const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-6449-'));
try {
  const beforeDir = path.join(temp, 'before'), afterDir = path.join(temp, 'after');
  for (const dir of [beforeDir, afterDir]) {
    fs.mkdirSync(path.join(dir, 'patches'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'bundled'));
    fs.writeFileSync(path.join(dir, 'patches', 'one.diff'), 'original patch');
    fs.writeFileSync(path.join(dir, 'collection.json'), '{}');
  }
  assert.doesNotThrow(() => checkRepairFiles(beforeDir, afterDir));
  fs.writeFileSync(path.join(afterDir, 'patches', 'one.diff'), 'changed patch');
  assert.throws(() => checkRepairFiles(beforeDir, afterDir), /archive entries/);
  fs.writeFileSync(path.join(afterDir, 'patches', 'one.diff'), 'original patch');
  fs.writeFileSync(path.join(afterDir, 'extra'), 'unexpected file');
  assert.throws(() => checkRepairFiles(beforeDir, afterDir), /archive entries/);
  fs.unlinkSync(path.join(afterDir, 'extra'));
  fs.unlinkSync(path.join(afterDir, 'patches', 'one.diff'));
  assert.throws(() => checkRepairFiles(beforeDir, afterDir), /archive entries/);
  console.log('PASS archive validation rejects changed, added and missing payload files');

  for (const script of ['Publish-CollectionRecord.ps1', 'New-NexusRevision.ps1']) {
    for (const input of [',', ' ', '0', '13048,,1', '13048,13048']) {
      const out = path.join(temp, 'must-not-be-created');
      const args = ['-NoProfile', '-File', path.join(__dirname, '../scripts/release', script), '-RefreshTag', input];
      if (script === 'New-NexusRevision.ps1') args.push('-NoPause');
      else args.push('-Out', out);
      const child = spawnSync('pwsh', args, { encoding: 'utf8', timeout: 20000, env: {
        ...process.env, THORNSWOOD_NEXUS_API_KEY: '',
        THORNSWOOD_NEXUS_STANDIN: 'http://127.0.0.1:1', THORNSWOOD_NEXUS_STANDIN_KEY: 'test-only'
      } });
      assert.equal(child.status, 1, script + ': reject malformed repair input ' + JSON.stringify(input));
      assert.match(child.stdout + child.stderr, /nonempty list of distinct positive/);
      assert.equal(fs.existsSync(out), false, 'invalid repair input must not become an ordinary publication');
    }
  }
  console.log('PASS both publishers reject empty, malformed and duplicate repair lists before work begins');
} finally {
  assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep + 'thornswood-6449-'));
  fs.rmSync(temp, { recursive: true, force: true });
}
