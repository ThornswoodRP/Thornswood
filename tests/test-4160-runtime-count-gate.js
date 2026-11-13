// test-4160-runtime-count-gate.js
//
// A profile from an older runtime must not be compared as if it came from
// the current one (#4160), but must fail with the version mismatch instead
// of skipping (#4233). A current runtime still fails a wrong file count.
// All inputs are scratch folders, removed at the end.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const THIRD = path.join(__dirname, 'test-third-party.js');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4160-'));
const COUNT = 7;
const COUNT_LINE = 'the section says ' + COUNT + ' files, as files.txt does';
const NAMES_LINE = 'every file the collection puts under Data\\Platform\\Distribution is in the Client Runtime section (' + COUNT + ')';
const profile = path.join(T, 'Profile');
fs.mkdirSync(path.join(profile, 'OwnGame'), { recursive: true });
const rows = [];
for (let i = 0; i < COUNT; i++) { rows.push('x|V|x|x|Data\\Platform\\Distribution\\stand-in-4160-' + i + '.dll'); }
fs.writeFileSync(path.join(profile, 'OwnGame', 'files.txt'), rows.join('\n') + '\n');
function runWith(version) {
  const mods = path.join(T, 'mods-' + version.replace(/\./g, '-'));
  fs.mkdirSync(path.join(mods, 'Thornswood Client Runtime 192762 ' + version + ' 1700000000', 'Platform', 'Distribution'), { recursive: true });
  const env = Object.assign({}, process.env, { THORNSWOOD_VORTEX_MODS: mods, THORNSWOOD_PROFILE: profile });
  const r = spawnSync(process.execPath, [THIRD], { env: env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error || !/\d+ passed, \d+ failed/.test(r.stdout || '')) { console.log('child status ' + r.status + ', signal ' + r.signal + ': ' + (r.stdout || '').slice(-1600) + (r.stderr || '') + (r.error ? r.error.message : '')); }
  yes('the runtime check ran to its summary for ' + version, !r.error && /\d+ passed, \d+ failed/.test(r.stdout || ''));
  return (r.stdout || '') + (r.stderr || '');
}
try {
  const older = runWith('0.0.1');
  const gate = /^FAIL  Vortex here holds the Client Runtime 0\.0\.1, older than the (\d+(?:\.\d+)*) THIRD-PARTY\.md describes$/m.exec(older);
  yes('an older Vortex runtime fails with both versions', !!gate);
  yes('the files.txt comparison fails with the same version mismatch',
    /^FAIL  the 7 files files\.txt gives the collection .* were not held to the section: Vortex here holds the Client Runtime 0\.0\.1, older than the /m.test(older));
  yes('neither version mismatch is skipped', !/^SKIP  .*older than the /m.test(older));
  yes('an old runtime is not blamed for a current file count', !older.includes('FAIL  ' + COUNT_LINE));
  yes('nor for current file names', !older.includes('FAIL  ' + NAMES_LINE));
  if (gate) {
    const same = runWith(gate[1]);
    yes('the current runtime runs the file checks', same.includes('PASS  THIRD-PARTY.md describes the Client Runtime Vortex holds here, ' + gate[1]));
    yes('a wrong file count fails', same.includes('FAIL  ' + COUNT_LINE));
    yes('wrong file names fail', same.includes('FAIL  ' + NAMES_LINE));
    yes('the Vortex file count and size are checked too', /FAIL  the section gives the file count, 0 files/.test(same) && /FAIL  the section gives the size, 0 bytes/.test(same));
  } else { yes('the recorded version is known for the current-runtime case', false); }
} finally { fs.rmSync(T, { recursive: true, force: true }); }
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
