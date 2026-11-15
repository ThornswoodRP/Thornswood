// test-4160-runtime-count-gate.js
//
//     node tests/test-4160-runtime-count-gate.js
//
// tests\test-third-party.js holds the files the launcher installed from the
// Thornswood Client Runtime (Profile\OwnGame\files.txt) to the notices: that
// each is named in the section, and that the section gives their count. Its
// checks on Vortex's own copy skip, saying why, when Vortex holds an older
// runtime than THIRD-PARTY.md describes. The files.txt comparison did not ask,
// so a machine that had not caught up failed it (#4160).
//
// HOW. test-third-party.js runs as a child against stand-in folders: a Vortex
// mods folder holding the runtime at a version, and a profile whose
// files.txt gives the collection 9973 files under Data\Platform\Distribution,
// a count the section does not give. It proves:
//   1. with an older runtime, the comparison says SKIP with the reason, and
//      neither of its checks fails;
//   2. with the version the notices describe, the count check still fails.
//
// Everything it writes is in its own temp folder.
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
const COUNT = 9973;
const COUNT_LINE = 'the section says ' + COUNT + ' files, as files.txt does';
const NAMES_LINE = 'every file the collection puts under Data\\Platform\\Distribution is in the Client Runtime section (' + COUNT + ')';

// A launcher profile whose files.txt gives the collection COUNT files there.
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
  return (r.stdout || '') + (r.stderr || '');
}
function lines(out) { return out.split(/\r?\n/); }

try {
  // 1. An older runtime than any the notices describe.
  const older = runWith('0.0.1');
  const gate = /^SKIP  Vortex here holds the Client Runtime 0\.0\.1, older than the (\d+(?:\.\d+)*) THIRD-PARTY\.md describes$/m.exec(older);
  yes('test-third-party.js reads the stand-in Vortex copy as older than the notices' + (gate ? ' (' + gate[1] + ')' : ''), !!gate);
  yes('with an older runtime, the files.txt comparison says SKIP, giving the reason',
      lines(older).some(function (l) { return /^SKIP  the 9973 files files\.txt gives the collection .* were not held to the section: Vortex here holds the Client Runtime 0\.0\.1, older than the /.test(l); }));
  yes('  and the count check does not fail', older.indexOf('FAIL  ' + COUNT_LINE) < 0);
  yes('  nor the check that each file is named in the section', older.indexOf('FAIL  ' + NAMES_LINE) < 0);

  // 2. The version the notices describe, with a count they do not give.
  if (gate) {
    const same = runWith(gate[1]);
    yes('with the version the notices describe (' + gate[1] + '), the comparison runs',
        same.indexOf('PASS  THIRD-PARTY.md describes the Client Runtime Vortex holds here, ' + gate[1]) >= 0);
    yes('  and a count the section does not give fails the count check', same.indexOf('FAIL  ' + COUNT_LINE) >= 0);
  } else {
    yes('the version the notices describe is known, for the second case', false);
  }
} finally {
  fs.rmSync(T, { recursive: true, force: true });
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
