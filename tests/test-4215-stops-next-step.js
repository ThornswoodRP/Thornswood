'use strict';
/*
  test-4215-stops-next-step.js

      node tests/test-4215-stops-next-step.js

  #4215. nexus-collection.js, which New-NexusRevision.ps1 runs to write a new
  revision's collection.json, stopped on these with what was wrong and no
  next step, so whoever ran it was left to work out what to do:

    S1  -Mod names a mod the revision has no entry for (use -Add)
    S2  -Mod names a mod with two entries (make it in Vortex on One)
    R1  -Remove names a mod the revision has no entry for
    R2  -Remove names a mod with two entries (Vortex on One)
    M1  a mod rule names the moved mod by its file name on Nexus and the
        swap gives none, named only by its place in collection.json
    M2  a mod rule matches the moved mod by another version, the same
    A1  -Add brings a plugin the list already names

  Each stop is driven through the script itself, against a made-up
  collection, and has to exit 1, say what it said before, and name its next
  step. The rule stops have to say which rule it is by what it names, not
  only its index.

  tests/test-2754-revision-layout.ps1 holds Install-NexusRevision.ps1's stops
  in the same issue (the download, the circle of mod rules, the shared files,
  the plugins no mod has), since only it has the stand-in Nexus they need.
  And P reads the last step of Enable-MCM.ps1 and Fix-QuickLoot.ps1, which
  are retired and refuse to run. The third script the issue named, the old
  load order sync, is gone from the repository (#4688).
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'scripts', 'release', 'nexus-collection.js');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-4215-'));

let pass = 0, fail = 0;
function yes(w, c, said) {
  if (c) { pass++; console.log('PASS  ' + w); }
  else { fail++; console.log('FAIL  ' + w); if (said !== undefined) console.log('      it said: ' + said.trim()); }
}

const md5 = (n) => String(n).padStart(32, '0');
function entry(name, modId, fileId, extra) {
  return Object.assign({
    name, version: '1.0', optional: false, domainName: 'skyrimspecialedition',
    source: { type: 'nexus', modId, fileId, md5: md5(fileId), fileSize: 10, logicalFilename: name + ' File', updatePolicy: 'exact', tag: 'tag' + fileId },
    author: 'Someone', details: { category: 'Misc', type: '' }, phase: 0,
  }, extra || {});
}
function collection() {
  return {
    info: { author: 'Someone', name: 'Made Up', domainName: 'skyrimspecialedition', gameVersions: ['1.6.1170.0'] },
    mods: [
      entry('Alpha', 10, 100, { hashes: [{ path: 'Alpha.esp', md5: md5(1) }] }),
      entry('Twin One', 20, 200),
      entry('Twin Two', 20, 201),
      entry('Charlie', 30, 300),
      entry('Delta', 40, 400),
    ],
    modRules: [
      { type: 'after', source: { logicalFileName: 'Alpha File', versionMatch: '*' }, reference: { logicalFileName: 'Charlie File', fileExpression: 'Charlie File-30-1-0', versionMatch: '*' } },
      { type: 'before', source: { fileMD5: md5(400), logicalFileName: 'Delta File', versionMatch: '2.0.0' }, reference: { logicalFileName: 'Alpha File', versionMatch: '*' } },
    ],
    tools: [],
    plugins: [{ name: 'Alpha.esp', enabled: true }],
    pluginRules: { plugins: [], groups: [] },
    collectionConfig: { recommendNewProfile: true, referenceTagScheme: 'v1' },
  };
}

function run(name, swaps) {
  const dir = path.join(T, name);
  fs.mkdirSync(dir);
  const col = path.join(dir, 'collection.json');
  const sw = path.join(dir, 'swaps.json');
  fs.writeFileSync(col, JSON.stringify(collection(), undefined, 2));
  fs.writeFileSync(sw, JSON.stringify(swaps));
  const r = spawnSync(process.execPath, [JS, col, sw, path.join(dir, 'out.json'), path.join(dir, 'payload.json')], { encoding: 'utf8' });
  return { code: r.status, said: String(r.stderr || '') + String(r.stdout || '') };
}
const swap = (modId, extra) => Object.assign({ modId, fileId: 999, version: '2.0', md5: md5(999), fileSize: 11, logicalFilename: 'New File' }, extra || {});

let r = run('s1', [swap(99)]);
yes('S1 -Mod with no entry stops, as before', r.code === 1 && /The revision has 0 entries for Nexus mod 99/.test(r.said), r.said);
yes('S1 and says a mod the revision does not carry goes in with -Add', /goes in with -Add/.test(r.said), r.said);

r = run('s2', [swap(20)]);
yes('S2 -Mod with two entries stops, as before', r.code === 1 && /The revision has 2 entries for Nexus mod 20/.test(r.said), r.said);
yes('S2 and names both entries', /Twin One/.test(r.said) && /Twin Two/.test(r.said), r.said);
yes('S2 and says that revision is made in Vortex on One', /in Vortex on One/.test(r.said), r.said);

r = run('r1', [{ remove: true, modId: 99 }]);
yes('R1 -Remove with no entry stops, as before', r.code === 1 && /The revision has 0 entries for Nexus mod 99/.test(r.said), r.said);
yes('R1 and says nothing of mod 99 is there to take out, so -Remove names a mod the revision carries', /takes a mod the revision carries/.test(r.said), r.said);

r = run('r2', [{ remove: true, modId: 20 }]);
yes('R2 -Remove with two entries stops, as before', r.code === 1 && /The revision has 2 entries for Nexus mod 20/.test(r.said), r.said);
yes('R2 and names both entries and says to take it out in Vortex on One', /Twin One/.test(r.said) && /Twin Two/.test(r.said) && /Take it out in Vortex on One/.test(r.said), r.said);

r = run('m1', [swap(30)]);
yes('M1 a rule naming the mod by its Nexus file name, with none given, stops, as before', r.code === 1 && /Mod rule 0 \([^)]*\) names Charlie by its file name on Nexus/.test(r.said), r.said);
yes('M1 and says which rule by what it names (Alpha File after Charlie File)', /Alpha File after Charlie File/.test(r.said), r.said);
yes('M1 and says New-NexusRevision.ps1 reads that name from Nexus, from where staff run it', /\.\\scripts\\release\\New-NexusRevision\.ps1/.test(r.said), r.said);

r = run('m2', [swap(40, { fileExpression: 'Delta File-40-2-0' })]);
yes('M2 a rule matching another version stops, as before', r.code === 1 && /Mod rule 1 \([^)]*\) matches Delta by the version "2\.0\.0"/.test(r.said), r.said);
yes('M2 and says which rule by what it names (Delta File before Alpha File)', /Delta File before Alpha File/.test(r.said), r.said);
yes('M2 and says that revision is made in Vortex on One', /in Vortex on One/.test(r.said), r.said);

r = run('a1', [{ add: true, modId: 50, fileId: 500, version: '1.0', md5: md5(500), fileSize: 10, logicalFilename: 'Echo File', name: 'Echo', author: 'Someone', category: 'Misc', plugins: [{ name: 'Alpha.esp', after: ['Skyrim.esm'] }] }]);
yes('A1 -Add of a plugin the list already names stops, as before', r.code === 1 && /The plugin list already names Alpha\.esp, so Echo would put a second one in Data/.test(r.said), r.said);
yes('A1 and says which mod brings it now, and what to do', /Alpha brings it now/.test(r.said) && /-Remove 10/.test(r.said), r.said);

fs.rmSync(T, { recursive: true, force: true });

// P: Enable-MCM.ps1 and Fix-QuickLoot.ps1 are retired and refuse to run, so
// their last step is read, not driven: it named .\Publish-Server.ps1, which
// is in scripts\release, not beside them, so it ran from nowhere.
for (const f of ['Enable-MCM.ps1', 'Fix-QuickLoot.ps1']) {
  const text = fs.readFileSync(path.join(ROOT, 'scripts', 'oneoff', f), 'utf8');
  yes('P ' + f + ' no longer names .\\Publish-Server.ps1 as if it were beside it', !/Note '\s*\.\\Publish-Server\.ps1'/.test(text));
  yes('P ' + f + ' names .\\scripts\\release\\Publish-Server.ps1, which runs from the repository', /Note '\s*\.\\scripts\\release\\Publish-Server\.ps1'/.test(text));
}
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
