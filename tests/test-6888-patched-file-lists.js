// A patched collection entry lists the files it installs (#6888). Vortex
// patches only a copy it installs while it installs the collection, and up
// to 1.15 it takes a copy of the same Nexus file somebody already had as the
// collection's when the entry has no file list, so that copy kept the
// author's plugin. The file list check is strict in every version.
// https://github.com/Nexus-Mods/Vortex/blob/v1.15.2/src/extensions/mod_management/util/testModReference.ts
'use strict';
const assert = require('node:assert/strict');
const { applySwaps, checkReplicated } = require('../scripts/release/nexus-collection.js');

const md5 = c => c.repeat(32);
function base() {
  return {
    info: { name: 'Thornswood', summary: 'old', description: 'old' },
    mods: [
      { name: 'Deadly Spell Impacts', version: '1.9', optional: false, domainName: 'skyrimspecialedition',
        source: { type: 'nexus', modId: 12939, fileId: 536557, md5: md5('a'), fileSize: 5, logicalFilename: 'DSI', tag: 'dsiTag0001' },
        choices: { type: 'fomod', options: [{ name: 'Main', groups: [{ name: 'Pick', choices: [{ name: 'Default', idx: 0 }] }] }] },
        patches: { 'DeadlySpellImpacts.esp': '759121EA' }, author: 'X', details: { category: 'Visuals', type: '' }, phase: 0 },
      { name: 'Better Container Controls', version: '31', optional: false, domainName: 'skyrimspecialedition',
        source: { type: 'nexus', modId: 25271, fileId: 244865, md5: md5('b'), fileSize: 6, logicalFilename: 'BCC', tag: 'bccTag0001' },
        patches: { 'BetterContainerControls.esp': 'FC7EBAEF' }, author: 'Y', details: { category: 'UI', type: '' }, phase: 0 },
      { name: 'Unpatched', version: '1', optional: false, domainName: 'skyrimspecialedition',
        source: { type: 'nexus', modId: 2, fileId: 3, md5: md5('c'), fileSize: 7, logicalFilename: 'U', tag: 'keepThis00' },
        author: 'Z', details: { category: 'Misc', type: '' }, phase: 0 }
    ],
    modRules: [], plugins: []
  };
}
const dsiList = [{ path: 'DeadlySpellImpacts.esp', md5: md5('1') }, { path: 'Textures\\DSI\\a.dds', md5: md5('2') }];
const bccList = [{ path: 'BetterContainerControls.esp', md5: md5('3') }];
const swaps = () => [
  { replicate: true, modId: '12939', fileId: '536557', hashes: dsiList },
  { replicate: true, modId: '25271', fileId: '244865', hashes: bccList }
];

const before = base();
const after = base();
const lines = applySwaps(after, swaps());
const dsi = after.mods[0], bcc = after.mods[1];
assert.deepEqual(dsi.hashes, dsiList);
assert.deepEqual(bcc.hashes, bccList);
assert.equal(dsi.choices, undefined, 'the list installer takes the place of the FOMOD answers');
assert.deepEqual(Object.keys(dsi), ['name', 'version', 'optional', 'domainName', 'source', 'hashes', 'patches', 'author', 'details', 'phase']);
assert.deepEqual(dsi.patches, before.mods[0].patches, 'the patch and its CRC-32 stay');
assert.deepEqual(dsi.source, before.mods[0].source, 'the archive and the tag stay');
assert.deepEqual(after.mods[2], before.mods[2], 'an entry not named is untouched');
assert.ok(lines.some(l => l === 'Deadly Spell Impacts\treplicate\tFOMOD answers\t2 file hashes'));
assert.ok(lines.some(l => l === 'Better Container Controls\treplicate\tits own installer\t1 file hash'));
console.log('PASS each named entry gets its file list after its source, in place of its answers, and nothing else changes');

// Vortex's own check, as testModReference does it: a copy installed without
// the entry's file list is not the collection's, so Vortex installs and
// patches its own; the copy it installed from the entry is.
function counts(ref, mod) {
  if (ref.fileList != null && ref.fileList.length > 0 && JSON.stringify(ref.fileList) !== JSON.stringify(mod.fileList)) return false;
  return ref.md5 === mod.md5 && ref.fileId === mod.fileId;
}
const ref = e => ({ md5: e.source.md5, fileId: e.source.fileId, fileList: e.hashes });
assert.equal(counts(ref(before.mods[1]), { md5: md5('b'), fileId: 244865 }), true, 'before: a copy somebody had counts, and is never patched');
assert.equal(counts(ref(bcc), { md5: md5('b'), fileId: 244865 }), false, 'after: it does not');
assert.equal(counts(ref(bcc), { md5: md5('b'), fileId: 244865, fileList: bccList }), true, 'after: the copy installed from the entry does');
console.log('PASS a copy installed by hand no longer counts as the collection\'s; the one Vortex installs from the entry does');

assert.doesNotThrow(() => checkReplicated(before, after, ['536557', '244865']));
const other = JSON.parse(JSON.stringify(after)); other.mods[2].version = '2';
assert.throws(() => checkReplicated(before, other, ['536557', '244865']), /more than the file hashes/);
assert.throws(() => checkReplicated(before, after, ['536557']), /more than the file hashes/, 'an entry changed that was not named');
const lost = JSON.parse(JSON.stringify(after)); delete lost.mods[0].patches;
assert.throws(() => checkReplicated(before, lost, ['536557', '244865']), /no DeadlySpellImpacts\.esp|more than the file hashes/);
const moved = JSON.parse(JSON.stringify(after)); moved.mods[1].source.fileId = 1;
assert.throws(() => checkReplicated(before, moved, ['536557', '244865']), /no one entry for Nexus file 244865/);
assert.throws(() => checkReplicated(before, after, ['536557', '536557']), /distinct/);
assert.throws(() => checkReplicated(before, after, ['0']), /invalid file id/);
assert.throws(() => checkReplicated(after, after, ['244865']), /carried file hashes already/);
console.log('PASS the publisher\'s draft check passes only the named file lists and stops on any other change');

// A mod with two entries, as More Craftable Equipment has in revision 11:
// the entry is named by its file id, which its mod number cannot do.
const twoBefore = base();
twoBefore.mods.push({ name: 'BCC Extra', version: '1', optional: false, domainName: 'skyrimspecialedition',
  source: { type: 'nexus', modId: 25271, fileId: 111111, md5: md5('d'), fileSize: 8, logicalFilename: 'BCC extra', tag: 'bccExtra01' },
  author: 'Y', details: { category: 'UI', type: '' }, phase: 0 });
const twoAfter = JSON.parse(JSON.stringify(twoBefore));
applySwaps(twoAfter, [{ replicate: true, modId: '25271', fileId: '244865', hashes: bccList }]);
assert.deepEqual(twoAfter.mods[1].hashes, bccList);
assert.equal(twoAfter.mods[3].hashes, undefined, 'the mod\'s other entry is untouched');
assert.doesNotThrow(() => checkReplicated(twoBefore, twoAfter, ['244865']));
assert.throws(() => checkReplicated(twoBefore, twoAfter, ['25271']), /no one entry/, 'a mod number names neither entry');
console.log('PASS a mod with two entries gets the list on the one entry its file id names');

const refuse = (sw, re, why) => assert.throws(() => applySwaps(base(), sw), re, why);
refuse([{ replicate: true, modId: '999', fileId: '1', hashes: bccList }], /no one entry/, 'an absent entry');
refuse([{ replicate: true, modId: '25271', fileId: '244865', hashes: [] }], /no file hashes/, 'an empty list');
refuse([{ replicate: true, modId: '25271', fileId: '244865', hashes: [{ path: 'Other.esp', md5: md5('3') }] }], /no BetterContainerControls\.esp, which the entry patches/, 'a list without the patched file');
refuse([{ replicate: true, modId: '25271', fileId: '244865', hashes: [...bccList, { path: 'betterContainerControls.esp', md5: md5('4') }] }], /twice/, 'a path twice');
refuse([{ replicate: true, modId: '25271', fileId: '244865', hashes: [...bccList, { path: '..\\x.esp', md5: md5('4') }] }], /not a path inside the mod/, 'a path that leaves the mod');
refuse([{ replicate: true, modId: '25271', fileId: '244865', hashes: [...bccList, { path: 'a/b.esp', md5: md5('4') }] }], /not a path inside the mod/, 'a forward slash');
refuse([{ replicate: true, modId: '25271', fileId: '244865', hashes: [{ path: 'BetterContainerControls.esp', md5: 'ABC' }] }], /32 lower case hex/, 'a bad md5');
refuse([{ replicate: true, modId: '25271', fileId: '244865', hashes: [{ path: 'BetterContainerControls.esp', md5: md5('3'), xxh64: '1' }] }], /not \{ path, md5 \}/, 'another key');
refuse([...swaps(), { replicate: true, modId: '25271', fileId: '244865', hashes: bccList }], /already carries file hashes/, 'twice in one run');
const overrides = base(); overrides.mods[1].fileOverrides = ['x'];
assert.throws(() => applySwaps(overrides, swaps()), /fileOverrides/);
console.log('PASS a file list is refused for an absent entry, an empty or malformed list, one missing a patched file, and an entry with a list or overrides');

// A patch needs the list, given before it in the same run.
const patch = { patch: true, fileId: '3', path: 'U.esp', crc: '0A1B2C3D' };
assert.throws(() => applySwaps(base(), [patch]), /carries no file hashes.*#6888/);
assert.throws(() => applySwaps(base(), [{ replicate: true, modId: '2', fileId: '3', hashes: [{ path: 'Other.esp', md5: md5('5') }] }, patch]), /do not name U\.esp/);
const ok = base();
applySwaps(ok, [{ replicate: true, modId: '2', fileId: '3', hashes: [{ path: 'U.esp', md5: md5('5') }] }, patch]);
assert.deepEqual(Object.keys(ok.mods[2]).slice(4, 7), ['source', 'hashes', 'patches']);
assert.equal(ok.mods[2].patches['U.esp'], '0A1B2C3D');
console.log('PASS a patch is refused on an entry with no file list, or one that does not name the patched file');

const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-6888-'));
try {
  for (const script of ['Publish-CollectionRecord.ps1', 'New-NexusRevision.ps1']) {
    for (const input of [',', ' ', '0', '25271,,1', '25271,25271']) {
      const out = path.join(temp, 'must-not-be-created');
      const args = ['-NoProfile', '-File', path.join(__dirname, '../scripts/release', script), '-Replicate', input];
      if (script === 'New-NexusRevision.ps1') args.push('-NoPause');
      else args.push('-Out', out);
      const child = spawnSync('pwsh', args, { encoding: 'utf8', timeout: 20000, env: {
        ...process.env, THORNSWOOD_NEXUS_API_KEY: '',
        THORNSWOOD_NEXUS_STANDIN: 'http://127.0.0.1:1', THORNSWOOD_NEXUS_STANDIN_KEY: 'test-only'
      } });
      assert.equal(child.status, 1, script + ': reject malformed file list input ' + JSON.stringify(input));
      assert.match(child.stdout + child.stderr, /nonempty list of distinct positive/);
      assert.equal(fs.existsSync(out), false, 'invalid input must not become an ordinary publication');
    }
  }
  const both = spawnSync('pwsh', ['-NoProfile', '-File', path.join(__dirname, '../scripts/release/Publish-CollectionRecord.ps1'),
    '-Replicate', '25271', '-RefreshTag', '25271', '-Out', path.join(temp, 'both')], { encoding: 'utf8', timeout: 20000, env: {
    ...process.env, THORNSWOOD_NEXUS_API_KEY: '', THORNSWOOD_NEXUS_STANDIN: 'http://127.0.0.1:1', THORNSWOOD_NEXUS_STANDIN_KEY: 'test-only' } });
  assert.equal(both.status, 1);
  assert.match(both.stdout + both.stderr, /each go in a revision of their own/);
  console.log('PASS both publishers reject empty, malformed and duplicate file list requests, and a tag repair in the same run, before work begins');
} finally {
  assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep + 'thornswood-6888-'));
  fs.rmSync(temp, { recursive: true, force: true });
}
