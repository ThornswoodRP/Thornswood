'use strict';
/*
  test-4429-script-runs.js

      node tests/test-4429-script-runs.js

  Issue #4429. The words under scripts/ about where a check runs had fallen
  behind the workflows:

    1. scripts/README.md, which New-ScriptIndex.ps1 writes, said
       tests/test-script-index.ps1 is one "the nightly checks run", though the
       pull request gate runs every harness tests/gate-excluded.txt does not
       name, and that file does not name it;
    2. script headers named build.yml as what runs on a pull request, though
       build.yml runs on a push to main and a pull request runs build-pr.yml,
       which scripts/dev/Build-PrWorkflow.js generates from it;
    3. the index's row for Check-Swallow.ps1 must name every area it reads.

  This holds all three to the files that decide them. Reads files only.
*/
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }
function read(p) { try { return fs.readFileSync(path.join(REPO, p), 'utf8').replace(/\r\n/g, '\n'); } catch (e) { return ''; } }

// ---- 1. where test-script-index.ps1 runs ---------------------------------
const excluded = read('tests/gate-excluded.txt');
const indexExcluded = /^(tests\/)?test-script-index\.ps1\s/m.test(excluded);
const index = read('scripts/README.md');
const gen = read('scripts/dev/New-ScriptIndex.ps1');
yes('read tests/gate-excluded.txt, scripts/README.md and New-ScriptIndex.ps1', !!excluded && !!index && !!gen);
if (!indexExcluded) {
  const flat = (s) => s.replace(/'\)\s*\n\s*\$out\.Add\('/g, ' ').replace(/\s+/g, ' ');
  yes('the gate runs test-script-index.ps1, and scripts/README.md does not say the nightly runs it instead',
    !/test-script-index\.ps1, which the nightly/.test(flat(index)));
  yes('  and neither does the text New-ScriptIndex.ps1 writes it from',
    !/test-script-index\.ps1, which the nightly/.test(flat(gen)));
  yes('  and scripts/README.md says it runs in the pull request gate',
    /test-script-index\.ps1[^|]{0,80}pull request gate/.test(flat(index)));
}

// ---- 2. nothing under scripts/ names build.yml as a pull request's run ---
const prRun = read('.github/workflows/build-pr.yml');
const mainRun = read('.github/workflows/build.yml');
yes('a pull request runs build-pr.yml, generated from build.yml, and build.yml does not run on one',
    /GENERATED from build\.yml/.test(prRun) && !/^\s+pull_request:/m.test(mainRun.split(/\njobs:/)[0]));
const WRONG = [
  /build\.yml runs (it|this|them) on (every|each|a) pull request/i,
  /pull request gate \(build\.yml/i
];
const found = [];
(function walk(dir) {
  for (const e of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) { if (e.name !== 'node_modules') { walk(rel); } continue; }
    if (!/\.(ps1|psm1|js|py|cs|md)$/.test(e.name)) { continue; }
    const lines = read(rel).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const two = lines[i] + ' ' + (lines[i + 1] || '').trim();
      if (WRONG.some((r) => r.test(two)) && !WRONG.some((r) => r.test(lines[i - 1] + ' ' + lines[i].trim()))) {
        found.push(rel + ':' + (i + 1));
      }
    }
  }
})('scripts');
yes('no file under scripts/ names build.yml as what runs on a pull request' +
    (found.length ? ' (' + found.join(', ') + ')' : ''), found.length === 0);

// ---- 3. the Check-Swallow row names every area it reads -------------------
const row = (index.split('\n').filter((l) => l.indexOf('[dev/Check-Swallow.ps1]') >= 0)[0]) || '';
for (const area of ['launcher', 'scripts', 'installer', 'site', 'voice', 'bot', 'game', 'tools']) {
  yes('the index row for Check-Swallow.ps1 names ' + area, row.indexOf(area) >= 0);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
