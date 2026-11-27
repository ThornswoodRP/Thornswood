// A patched collection entry moved to a new Nexus file (#6908). Since #6888
// each patched entry lists the files it installs in place of its installer
// answers, and a move carried only the new archive's name, md5 and size, so
// the publisher refused every patched entry it was asked to move. A move now
// gives the new archive's file list, made by the installer with the answers
// records/collection.json keeps for the new file, and the entry's patches are
// still held to what the new archive holds.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
const { applySwaps } = require('../scripts/release/nexus-collection.js');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
}

const md5 = c => c.repeat(32);
const oldList = [{ path: 'BetterContainerControls.esp', md5: md5('1') }, { path: 'Interface\\bcc.swf', md5: md5('2') }];
const newList = [{ path: 'BetterContainerControls.esp', md5: md5('3') }, { path: 'Interface\\bcc.swf', md5: md5('4') }];
function base() {
  return {
    info: { name: 'Thornswood' },
    mods: [
      { name: 'Better Container Controls', version: '31', optional: false, domainName: 'skyrimspecialedition',
        source: { type: 'nexus', modId: 25271, fileId: 244865, md5: md5('b'), fileSize: 6, logicalFilename: 'BCC', updatePolicy: 'exact', tag: 'bccTag0001' },
        hashes: oldList, patches: { 'BetterContainerControls.esp': 'FC7EBAEF' }, author: 'Y', details: { category: 'UI', type: '' }, phase: 0 },
      { name: 'Unpatched', version: '1', optional: false, domainName: 'skyrimspecialedition',
        source: { type: 'nexus', modId: 2, fileId: 3, md5: md5('c'), fileSize: 7, logicalFilename: 'U', updatePolicy: 'exact', tag: 'keepThis00' },
        author: 'Z', details: { category: 'Misc', type: '' }, phase: 0 }
    ],
    modRules: [], plugins: []
  };
}
function move(extra) {
  return Object.assign({ modId: '25271', fileId: '300001', version: '32', md5: md5('e'), fileSize: 9, logicalFilename: 'BCC 32',
    fileExpression: 'Better Container Controls 32', patchCrcs: { 'BetterContainerControls.esp': 'FC7EBAEF' }, hashes: newList }, extra || {});
}

check('a patched entry with a file list moves to the new file, its list becomes the new archive\'s, and its patch stays', () => {
  const c = base();
  const lines = applySwaps(c, [move()]);
  const e = c.mods[0];
  assert.equal(e.source.fileId, 300001);
  assert.equal(e.source.md5, md5('e'));
  assert.deepEqual(e.hashes, newList);
  assert.deepEqual(e.patches, { 'BetterContainerControls.esp': 'FC7EBAEF' });
  assert.deepEqual(Object.keys(e), ['name', 'version', 'optional', 'domainName', 'source', 'hashes', 'patches', 'author', 'details', 'phase']);
  assert.deepEqual(c.mods[1], base().mods[1], 'an entry not named is untouched');
  assert.ok(lines.includes('Better Container Controls\thashes\t2 files\t2 files'), lines.join(' | '));
});
check('a move of an entry with a file list that gives none for the new archive is refused, naming it', () => {
  const sw = move(); delete sw.hashes;
  assert.throws(() => applySwaps(base(), [sw]), /Better Container Controls lists the files its archive installs, and the move gives no list for the new one/);
});
check('the patch is still held to the new archive: another CRC-32 is refused, naming -DropPatch', () => {
  assert.throws(() => applySwaps(base(), [move({ patchCrcs: { 'BetterContainerControls.esp': '01234567' } })]), /so the patch would not apply.*-DropPatch 25271:BetterContainerControls\.esp/);
});
check('a new list that does not name the patched file is refused', () => {
  assert.throws(() => applySwaps(base(), [move({ hashes: [{ path: 'Interface\\bcc.swf', md5: md5('4') }] })]), /no BetterContainerControls\.esp, which the entry patches/);
});
check('with the patch dropped, the new list need not name its file, and the patch goes', () => {
  const c = base();
  applySwaps(c, [move({ patchCrcs: { 'BetterContainerControls.esp': '01234567' }, dropPatches: ['BetterContainerControls.esp'], hashes: [{ path: 'Interface\\bcc.swf', md5: md5('4') }] })]);
  assert.equal(c.mods[0].patches, undefined);
  assert.deepEqual(c.mods[0].hashes, [{ path: 'Interface\\bcc.swf', md5: md5('4') }]);
});
check('a malformed new list is refused', () => {
  assert.throws(() => applySwaps(base(), [move({ hashes: [...newList, { path: '..\\x.esp', md5: md5('5') }] })]), /not a path inside the mod/);
});
check('a list for an entry that lists no files is refused: that is -Replicate', () => {
  const c = base();
  assert.throws(() => applySwaps(c, [{ modId: '2', fileId: '9', version: '2', md5: md5('f'), fileSize: 1, logicalFilename: 'U2', hashes: newList }]), /Unpatched lists no files of its own, so a move gives it none/);
});
check('an entry with FOMOD answers and no list, or with fileOverrides, is still refused', () => {
  const c = base(); c.mods[1].choices = { type: 'fomod', options: [] };
  assert.throws(() => applySwaps(c, [{ modId: '2', fileId: '9', version: '2', md5: md5('f'), fileSize: 1, logicalFilename: 'U2' }]), /carries choices/);
  const o = base(); o.mods[0].fileOverrides = ['x'];
  assert.throws(() => applySwaps(o, [move()]), /carries fileOverrides/);
});

// The record change that asks for the move: Get-CollectionChangeSet gives the
// move with the record's answers for the new file when the published entry
// lists its files, and still refuses answers on a move of an entry that has
// none (nothing there to make a list with them).
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-6908-'));
try {
  const pub = { mods: [
    { name: 'Listed', source: { type: 'nexus', modId: 10, fileId: 100 }, hashes: [{ path: 'L.esp', md5: md5('1') }], patches: { 'L.esp': '0A1B2C3D' } },
    { name: 'Plain', source: { type: 'nexus', modId: 20, fileId: 200 } }
  ], pluginRules: { plugins: [] } };
  const ch = { type: 'fomod', options: [{ name: 'Main', groups: [{ name: 'Pick', choices: [{ name: 'One', idx: 0 }] }] }] };
  const rec = { mods: [{ modId: 10, fileId: 101, name: 'Listed', plugins: [], choices: ch }, { modId: 20, fileId: 200, name: 'Plain', plugins: [] }], plugins: [] };
  const rec2 = { mods: [{ modId: 10, fileId: 100, name: 'Listed', plugins: [], choices: ch }, { modId: 20, fileId: 201, name: 'Plain', plugins: [], choices: ch }], plugins: [] };
  fs.writeFileSync(path.join(temp, 'pub.json'), JSON.stringify(pub));
  fs.writeFileSync(path.join(temp, 'rec.json'), JSON.stringify(rec));
  fs.writeFileSync(path.join(temp, 'rec2.json'), JSON.stringify(rec2));
  const lib = path.join(__dirname, '../scripts/release/CollectionRecord.ps1');
  const runner = path.join(temp, 'changeset.ps1');
  fs.writeFileSync(runner, 'param([string]$Lib, [string]$Pub, [string]$Rec)\n. $Lib\n' +
    '$p = [IO.File]::ReadAllText($Pub) | ConvertFrom-Json; $r = [IO.File]::ReadAllText($Rec) | ConvertFrom-Json\n' +
    '$cs = Get-CollectionChangeSet $r $p\n' +
    '[pscustomobject]@{ Move = @($cs.Move); Answers = @($cs.Answers); Problems = @($cs.Problems) } | ConvertTo-Json -Depth 12 -Compress\n');
  const ps = (r) => spawnSync('pwsh', ['-NoProfile', '-File', runner, '-Lib', lib, '-Pub', path.join(temp, 'pub.json'), '-Rec', path.join(temp, r)],
    { encoding: 'utf8', timeout: 60000 });
  check('the record moving a listed entry gives the move with the record\'s answers for the new file, and no problem', () => {
    const r = ps('rec.json');
    assert.equal(r.status, 0, r.stderr);
    const cs = JSON.parse(r.stdout);
    assert.deepEqual(cs.Problems, []);
    assert.equal(cs.Move.length, 1);
    assert.equal(cs.Move[0].modId, 10); assert.equal(cs.Move[0].fileId, 101);
    assert.deepEqual(cs.Move[0].choices, ch);
    assert.deepEqual(cs.Answers, [], 'a kept file with answers is not asked to change them');
  });
  check('answers on a kept listed entry are the ones its list was made by, not a change; on a move of an entry with no list they are still refused', () => {
    const r = ps('rec2.json');
    assert.equal(r.status, 0, r.stderr);
    const cs = JSON.parse(r.stdout);
    assert.deepEqual(cs.Answers, []);
    assert.ok(cs.Problems.some(p => /mod 20 moves to file 201 with choices/.test(p)), JSON.stringify(cs.Problems));
  });
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

// New-NexusRevision -Mod lists the new archive's files for an entry that lists
// its files, by the installer run with the record's answers for the new file,
// and Publish-CollectionRecord hands it the record it publishes.
const nn = fs.readFileSync(path.join(__dirname, '../scripts/release/New-NexusRevision.ps1'), 'utf8');
const pr = fs.readFileSync(path.join(__dirname, '../scripts/release/Publish-CollectionRecord.ps1'), 'utf8');
check('New-NexusRevision -Mod gives a listed entry\'s move the new archive\'s files, by its installer with the record\'s answers', () => {
  const loop = nn.slice(nn.indexOf('foreach ($rf in $Replicate)'), nn.indexOf('# ------------------------------------------------------------ the adds ---'));
  assert.ok(/Get-ArchiveFiles \$Archive\[\$i\]/.test(loop), 'the move lists the new archive by Get-ArchiveFiles');
  assert.ok(/\$swap\.hashes = /.test(loop), 'and gives the list to the swap');
  assert.ok(/\$moveAnswers/.test(loop), 'with the record\'s answers');
  const def = nn.indexOf('function Get-ArchiveFiles(');
  assert.ok(def > 0 && def < nn.indexOf('foreach ($rf in $Replicate)'), 'defined before the moves run');
  assert.ok(/Get-ArchiveFiles \$got\.Path/.test(nn.slice(nn.indexOf('function Get-EntryFiles('), nn.indexOf('function Get-EntryFiles(') + 1500)), '-Replicate lists by the same steps');
});
check('Publish-CollectionRecord hands New-NexusRevision the record whose answers a move uses', () => {
  assert.ok(/\$params\.CollectionRecord = \$Record/.test(pr));
});

process.exitCode = failed ? 1 : 0;
