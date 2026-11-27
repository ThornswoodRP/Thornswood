// A mod whose collection entry lists no files can still be taken out (#4511).
// MCM Recorder's entry carried no file hashes, and the revision run stopped
// with "nothing in the revision says which plugins it brings", so the record
// took it out and Nexus kept it. New-NexusRevision.ps1 now reads the files
// the entry's archive installs, as -Replicate reads them, and gives them with
// the remove; those name the plugins that come off the plugin list.
'use strict';
const assert = require('node:assert/strict');
const { applySwaps } = require('../scripts/release/nexus-collection.js');

const md5 = c => c.repeat(32);
function base() {
  return {
    info: { name: 'Thornswood' },
    mods: [
      { name: 'MCM Recorder', version: '1.0', optional: false, domainName: 'skyrimspecialedition',
        source: { type: 'nexus', modId: 61719, fileId: 258619, md5: md5('a'), fileSize: 5, logicalFilename: 'MCM Recorder', tag: 'mcmTag0001' },
        author: 'X', details: { category: 'Utilities', type: '' }, phase: 0 },
      { name: 'QuickLoot IE', version: '4', optional: false, domainName: 'skyrimspecialedition',
        source: { type: 'nexus', modId: 120075, fileId: 9, md5: md5('b'), fileSize: 6, logicalFilename: 'QL', tag: 'qlTag00001' },
        hashes: [{ path: 'QuickLootIE.esp', md5: md5('3') }], author: 'Y', details: { category: 'UI', type: '' }, phase: 0 }
    ],
    modRules: [], pluginRules: { plugins: [], groups: [] },
    plugins: [{ name: 'McmRecorder.esp', enabled: true }, { name: 'QuickLootIE.esp', enabled: true }]
  };
}
const read = [{ path: 'McmRecorder.esp', md5: md5('1') }, { path: 'Scripts\\SKI_ConfigBase.pex', md5: md5('2') }];
const masters = { masters: { 'QuickLootIE.esp': ['Skyrim.esm'] } };
const rm = extra => Object.assign({ remove: true, modId: '61719', fileExpression: 'MCM Recorder-61719-1-0' }, extra);
let failed = 0;
function yes(what, f) {
  try { f(); console.log('PASS  ' + what); } catch (e) { failed++; console.log('FAIL  ' + what + ': ' + e.message); }
}

yes('a mod with no file hashes is taken out with the files read from its archive, and its plugin comes off the list', () => {
  const c = base();
  const lines = applySwaps(c, [rm({ hashes: read }), masters]);
  assert.deepEqual(c.mods.map(m => m.name), ['QuickLoot IE']);
  assert.deepEqual(c.plugins, [{ name: 'QuickLootIE.esp', enabled: true }]);
  assert.deepEqual(lines, ['MCM Recorder\tremoved\t\tfile 258619', 'McmRecorder.esp\tplugin\t\tremoved']);
});
yes('  and the list read is not written into the revision', () => {
  const c = base();
  applySwaps(c, [rm({ hashes: read }), masters]);
  assert.ok(!JSON.stringify(c).includes('SKI_ConfigBase.pex'));
});
yes('a mod with no file hashes and none read is refused', () => {
  assert.throws(() => applySwaps(base(), [rm(), masters]), /no file hashes and the mod to take out gives none read from its archive/);
});
yes('a list read that is not file hashes is refused', () => {
  assert.throws(() => applySwaps(base(), [rm({ hashes: [{ path: 'McmRecorder.esp', md5: 'nothex' }] }), masters]), /is not 32 lower case hex/);
  assert.throws(() => applySwaps(base(), [rm({ hashes: [] }), masters]), /have no file hashes/);
});
yes('a list given for a mod that has its own is refused', () => {
  assert.throws(() => applySwaps(base(), [{ remove: true, modId: '120075', fileExpression: 'QL-120075', hashes: read }, { masters: { 'McmRecorder.esp': ['Skyrim.esm'] } }]),
    /carries file hashes, and the mod to take out gives another list/);
});
yes('a plugin left that has the read plugin as a master still stops it', () => {
  assert.throws(() => applySwaps(base(), [rm({ hashes: read }), { masters: { 'QuickLootIE.esp': ['Skyrim.esm', 'McmRecorder.esp'] } }]),
    /QuickLootIE\.esp, which the revision still installs, has McmRecorder\.esp as a master/);
});
yes('New-NexusRevision.ps1 reads the archive of a mod taken out that has no list, and gives it with the remove', () => {
  const ps = require('fs').readFileSync(require('path').join(__dirname, '..', 'scripts', 'release', 'New-NexusRevision.ps1'), 'utf8');
  const at = ps.indexOf('# Each mod taken out, with its file name on Nexus (TAKING A MOD OUT).');
  assert.ok(at > 0, 'the loop that takes mods out is there');
  const loop = ps.slice(at, ps.indexOf('# ------------------------------------------------- the files they install ---', at));
  assert.match(loop, /\$ef = Get-EntryFiles \$e/);
  assert.match(loop, /\$rm\.hashes = \[object\[\]\]@\(\$ef\.Hashes\)/);
  assert.ok(ps.indexOf('function Get-EntryFiles(') >= 0 && ps.indexOf('function Get-EntryFiles(') < at, 'the function is defined before the loop uses it');
});

console.log(failed ? failed + ' failed' : 'all passed');
process.exitCode = failed ? 1 : 0;
