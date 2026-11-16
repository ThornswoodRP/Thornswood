'use strict';
/*
  test-4186-installer-tests.js

      node tests/test-4186-installer-tests.js

  installer\README.md lists every installer test, what it covers, and which
  workflow runs it (#4186). Its section "The installer's tests" named one
  test, and nothing said that some of them run only at night and one runs
  in no workflow at all.

  AN INSTALLER TEST is a test-*.js, test-*.ps1 or test-*.py in tests\ or in a
  product's own tests folder (launcher\tests\, site\tests\ and the rest, the
  folders scripts\dev\Harness-Files.ps1 reads) whose text names one of the
  install's own files, launcher\app\Install{Window,Steps,Place,Agreements,
  Shortcut,Skyrim}.cs, or installer\README.md. A file that names one and
  does not test it goes in the section's second list with why.

  WHICH WORKFLOW RUNS IT, read from the files that decide it, never typed in:
    - a .js or .ps1 is on the pull request gate unless tests\gate-excluded.txt
      names it (scripts\dev\Gate-Harnesses.ps1), and the nightly runs every
      one (scripts\dev\Nightly-Harnesses.ps1). So: "Pull request and nightly",
      or "Nightly only".
    - a .py runs only where a workflow names it: "python tests/<name>" in
      build-pr.yml for a pull request, nightly.yml's own lines for the night,
      and nightly.yml's loop over bot\tests\test-*.py. Neither is "No
      workflow".

  This fails when an installer test on disk is in neither list, when either
  list names a file that is not there or that names no install file, when a
  row says another workflow than the files decide, or a row has an empty
  cell.

  Red before #4186: the section was not there.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n'); } catch (e) { return null; } };

let pass = 0, fail = 0;
function yes(what, ok, why) {
  if (ok) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? ' | ' + why : '')); }
}

// ---------------------------------------------------------------- on disk

// The folders Harness-Files.ps1 reads, and the name each file goes by there:
// one in tests\ by its file name, one in a product's folder by its path.
const SKIP_TOP = new Set(['tests', 'node_modules', 'worktrees', 'temp', 'local', '.git']);
const TEST_FILE = /^test-.*\.(js|ps1|py)$/;
function testFiles() {
  const out = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'tests'))) {
    if (TEST_FILE.test(f) && fs.statSync(path.join(ROOT, 'tests', f)).isFile()) out.push({ name: f, rel: 'tests/' + f });
  }
  for (const d of fs.readdirSync(ROOT).sort()) {
    if (SKIP_TOP.has(d)) continue;
    const t = path.join(ROOT, d, 'tests');
    let st; try { st = fs.statSync(t); } catch (e) { continue; }
    if (!st.isDirectory()) continue;
    for (const f of fs.readdirSync(t)) {
      if (TEST_FILE.test(f) && fs.statSync(path.join(t, f)).isFile()) out.push({ name: d + '/tests/' + f, rel: d + '/tests/' + f });
    }
  }
  return out;
}

// The install's own files, and the installer's read me.
const INSTALL_FILES = ['Window', 'Steps', 'Place', 'Agreements', 'Shortcut', 'Skyrim'].map((x) => 'Install' + x + '.cs');
const NAMES_INSTALL = new RegExp(
  INSTALL_FILES.map((f) => f.replace('.', '\\.')).join('|') +
  '|installer[\\\\/]+README\\.md' +
  "|'installer',\\s*'README\\.md'");

const all = testFiles();
const onDisk = new Map(all.map((t) => [t.name, t]));
const installerTests = all.filter((t) => NAMES_INSTALL.test(read(t.rel) || ''));
const isInstallerTest = new Set(installerTests.map((t) => t.name));
yes('installer tests are found on disk (' + installerTests.length + ')', installerTests.length >= 10,
  installerTests.map((t) => t.name).join(', '));

// ---------------------------------------------------------------- who runs it

const excluded = new Set();
for (const line of (read('tests/gate-excluded.txt') || '').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  excluded.add(t.split(/\s+/)[0]);
}
yes('tests/gate-excluded.txt is read (' + excluded.size + ' lines)', excluded.size > 0);

const buildPr = read('.github/workflows/build-pr.yml') || '';
const nightly = read('.github/workflows/nightly.yml') || '';
yes('the pull request and nightly workflows are read', buildPr.length > 0 && nightly.length > 0);
const nightlyRunsBotPy = /Get-ChildItem bot\/tests -Filter 'test-\*\.py'/.test(nightly);

function pythonRunIn(yml, rel) {
  const esc = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '[\\\\/]');
  return new RegExp('python3?\\s+(?:\\.[\\\\/])?' + esc + '\\b').test(yml);
}

function runsOn(t) {
  if (/\.py$/.test(t.name)) {
    const pr = pythonRunIn(buildPr, t.rel);
    const night = pythonRunIn(nightly, t.rel) || (nightlyRunsBotPy && t.rel.startsWith('bot/tests/'));
    if (pr && night) return 'Pull request and nightly';
    if (pr) return 'Pull request only';
    if (night) return 'Nightly only';
    return 'No workflow';
  }
  return excluded.has(t.name) ? 'Nightly only' : 'Pull request and nightly';
}

// ---------------------------------------------------------------- the read me

const readme = read('installer/README.md') || '';
const at = readme.search(/^## The installer's tests\s*$/m);
yes('installer/README.md has a section "The installer\'s tests"', at >= 0);
const section = at < 0 ? '' : readme.slice(at).split(/\n(?=## )/)[0];

const rows = section.split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l)).slice(1)
  .map((l) => l.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim()));
const bare = (cell) => cell.replace(/`/g, '').replace(/\\/g, '/').trim();
const listed = new Map();
const bad = [];
for (const r of rows) {
  if (r.length !== 3 || r.some((c) => c.length === 0)) { bad.push(r.join(' | ')); continue; }
  listed.set(bare(r[0]), r[2]);
}
yes('every row says the test, what it covers and which workflow runs it', at >= 0 && bad.length === 0, bad.slice(0, 5).join('; '));

// The second list: "- `name`: why" under "### Named here, not installer tests".
const notAt = section.search(/^### Named here, not installer tests\s*$/m);
const notList = new Map();
if (notAt >= 0) {
  for (const m of section.slice(notAt).matchAll(/^- `([^`]+)`:\s*(.+)$/gm)) notList.set(bare(m[1]), m[2].trim());
}

const missing = installerTests.filter((t) => !listed.has(t.name) && !notList.has(t.name)).map((t) => t.name);
yes('every installer test on disk is in the table or the list of files that only name the install', at >= 0 && missing.length === 0,
  missing.join(', '));

const gone = [...listed.keys(), ...notList.keys()].filter((n) => !onDisk.has(n));
yes('every file the section names is on disk', gone.length === 0, gone.join(', '));

const notInstall = [...listed.keys(), ...notList.keys()].filter((n) => onDisk.has(n) && !isInstallerTest.has(n));
yes('every file the section names names an install file or installer/README.md', notInstall.length === 0, notInstall.join(', '));

const both = [...listed.keys()].filter((n) => notList.has(n));
yes('no file is both a row and in the list of files that only name the install', both.length === 0, both.join(', '));

const wrong = [];
for (const [n, said] of listed) {
  const t = onDisk.get(n);
  if (!t) continue;
  const want = runsOn(t);
  if (said !== want) wrong.push(n + ' says "' + said + '", the workflows say "' + want + '"');
}
yes('every row\'s workflow is the one tests/gate-excluded.txt and the workflows give', at >= 0 && wrong.length === 0, wrong.join('; '));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
