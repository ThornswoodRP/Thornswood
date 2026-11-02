// test-python-defaults.js
//
// Every path a Python script under scripts\ builds from its own folder lands
// inside this repository, and the table builders' defaults are this
// repository's game\ files.
//
// WHY THIS EXISTS. Issue #1139. The Python table builders moved from tools\ to
// scripts\dev\, one folder deeper, and four of them kept defaults that climbed
// three levels: from scripts\dev that is the folder that CONTAINS the
// repository. Run with no arguments, Build-DoorTable.py wrote doors.json and
// the gamemode blocks outside the repo, or stopped because game\gamemode.js was
// not there, so nothing in the repo changed and the table stayed stale without
// a word. Build-BenchTable.py, Build-CastTable.py and Measure-MineBuildings.py
// had the same climb.
//
// HOW. Read, not run: every os.path.join whose first argument is the script's
// own folder (a name assigned os.path.dirname(os.path.abspath(__file__)) in
// that file) and whose other arguments are plain strings is resolved from
// where the script sits, and must stay inside the repository. The four
// builders' defaults must be exactly the game\ files they build.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p, out); }
    else if (/\.py$/.test(e.name)) { out.push(p); }
  }
  return out;
}

const scripts = walk(path.join(REPO_DIR, 'scripts'), []);
yes('there are Python scripts under scripts to read (' + scripts.length + ')', scripts.length > 5);

const inside = REPO_DIR.replace(/[\\/]+$/, '') + path.sep;
const found = {};     // file -> [resolved paths]
const outside = [];
let joins = 0;
for (const file of scripts) {
  const src = fs.readFileSync(file, 'utf8').split('\r').join('');
  // The names this file gives its own folder.
  const bases = [];
  const baseRx = /\b([A-Za-z_]\w*)\s*=\s*os\.path\.dirname\(\s*os\.path\.abspath\(\s*__file__\s*\)\s*\)/g;
  let m;
  while ((m = baseRx.exec(src)) !== null) { if (bases.indexOf(m[1]) < 0) { bases.push(m[1]); } }
  if (!bases.length) { continue; }
  const joinRx = new RegExp('os\\.path\\.join\\(\\s*(' + bases.join('|') + ')\\s*,((?:\\s*\'[^\']*\'\\s*,?)+)\\)', 'g');
  while ((m = joinRx.exec(src)) !== null) {
    const parts = (m[2].match(/'[^']*'/g) || []).map(function (q) { return q.slice(1, -1); });
    const to = path.resolve(path.dirname(file), ...parts);
    joins++;
    (found[file] = found[file] || []).push(to);
    if (!(to + path.sep).startsWith(inside) && to !== REPO_DIR) {
      outside.push(path.relative(REPO_DIR, file) + ': ' + parts.join('/') + ' is ' + to);
    }
  }
}
yes('the paths built from a script\'s own folder were found to check (' + joins + ')', joins >= 10);
for (const o of outside) { console.log('      outside the repository: ' + o); }
yes('every one of them lands inside this repository', outside.length === 0);

// The four builders #1139 named, by their defaults, and where they write the
// gamemode's tables.
const WANT = {
  'Build-BenchTable.py': ['game/data/recipes.json'],
  'Build-CastTable.py': ['game/data/cast.json'],
  'Build-DoorTable.py': ['game/data/doors.json'],
  'Measure-MineBuildings.py': ['game/data/doors.json'],
  // The tables the gamemode reads, one file each since #5191: every builder
  // takes its folder from here unless --tables names another.
  'gamemode_tables.py': ['game/gamemode-tables']
};
for (const name of Object.keys(WANT)) {
  const file = path.join(REPO_DIR, 'scripts', 'dev', name);
  const got = (found[file] || []).map(function (p) { return path.relative(REPO_DIR, p).split(path.sep).join('/'); });
  const missing = WANT[name].filter(function (w) { return got.indexOf(w) < 0; });
  yes(name + '\'s defaults are this repository\'s ' + WANT[name].join(' and ') +
      (missing.length ? ' (not found: ' + missing.join(', ') + '; it builds ' + got.join(', ') + ')' : ''),
      missing.length === 0);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
