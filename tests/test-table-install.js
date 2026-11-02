// test-table-install.js
//
// A table builder run on a load order that has not changed says the table is
// current and exits 0, and a table that changed is written whole.
//
// WHY THIS EXISTS. Issue #1138. Build-WarmthTable.js, Build-WaterTable.js and
// Build-WeatherTable.js installed their compact table into game/gamemode.js by
// replacing one line, and decided whether that worked by asking whether the
// file changed. When the table they built was the one already there, nothing
// changed, so they printed "FAIL could not find anywhere in gamemode.js to put
// the table" and exited 1: an up to date table read as a broken run. Seen for
// all three against a copy of origin/main where all three were current.
// Build-FoodTable.js and Build-RaceTable.js had been fixed the same way before.
// Since #5191 each writes game/gamemode-tables/<NAME>.json through
// scripts/dev/GamemodeTables.js instead, and never reads or writes
// gamemode.js; the same three states still hold.
//
// HOW. Each builder's own install() is lifted out of the file and run with
// the real GamemodeTables.js copied into a scratch tree, so the table goes to
// that tree's game/gamemode-tables, with a table of two rows, in three states:
//   1. no table yet: it is written, laid out one row to a line
//   2. run again: nothing written, it says so, exit not 1
//   3. a table that differs: it is replaced whole
//
// Writes only under its own scratch folder in the temp directory.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-table-install-'));
fs.mkdirSync(path.join(TMP, 'scripts', 'dev'), { recursive: true });
fs.copyFileSync(path.join(REPO_DIR, 'scripts', 'dev', 'GamemodeTables.js'), path.join(TMP, 'scripts', 'dev', 'GamemodeTables.js'));
const TABLES = require(path.join(TMP, 'scripts', 'dev', 'GamemodeTables.js'));

/* function install() { ... } out of a builder, by its braces. */
function liftInstall(src) {
  const at = src.indexOf('\nfunction install() {');
  if (at < 0) { return null; }
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') { depth++; }
    else if (src[i] === '}') { depth--; if (depth === 0) { return src.slice(at + 1, i + 1); } }
  }
  return null;
}

/*
  Each builder: the table it writes and the table variables its install()
  reads, two rows of each.
*/
const BUILDERS = [
  { file: 'Build-WarmthTable.js', name: 'WARMTH',
    vars: { items: { '1:Skyrim.esm': { m: 'fur', c: 4 }, '2:Skyrim.esm': { m: 'cloth', c: 2 } } } },
  { file: 'Build-WaterTable.js', name: 'WATERS',
    vars: { where: { 'a:Skyrim.esm': 'w1', 'b:Skyrim.esm': 'w2' },
            waters: { w1: { c: 'cold' }, w2: { c: 'warm' } } } },
  { file: 'Build-WeatherTable.js', name: 'WEATHER',
    vars: { items: { '3:Skyrim.esm': { w: 10, k: 'snow' }, '4:Skyrim.esm': { w: 2, k: 'clear' } },
            maxWind: 10, midWind: 5 } },
  { file: 'Build-FoodTable.js', name: 'FOODS',
    vars: { items: { '5:Skyrim.esm': 'ale', '6:Skyrim.esm': 'bread' } } },
  { file: 'Build-RaceTable.js', name: 'RACES',
    vars: { rows: { '7:Skyrim.esm': { e: 'NordRace', p: true }, '8:Skyrim.esm': { n: 'Riekling', p: false } } } }
];

/* One run of a lifted install(), with the scratch tree's GamemodeTables. */
function run(fn, vars) {
  const out = { said: [], failed: [] };
  const proc = { exitCode: undefined };
  const fakeConsole = {
    log: function (m) { out.said.push(String(m)); },
    error: function (m) { out.failed.push(String(m)); }
  };
  const failFn = function (m) { out.failed.push('FAIL  ' + m); proc.exitCode = 1; };
  const noGamemode = {
    readFileSync: function (p) { if (/gamemode\.js$/.test(String(p))) { out.readGamemode = true; } throw new Error('no file here: ' + p); },
    writeFileSync: function (p) { out.wroteElsewhere = String(p); }
  };
  const names = Object.keys(vars);
  const make = Function.apply(null, ['fs', 'path', '__dirname', 'console', 'process', 'fail', 'TABLES']
    .concat(names).concat([fn + '\nreturn install;']));
  const install = make.apply(null, [noGamemode, path, path.join(TMP, 'scripts', 'dev'), fakeConsole, proc, failFn, TABLES]
    .concat(names.map(function (n) { return vars[n]; })));
  install();
  out.exitCode = proc.exitCode;
  return out;
}

for (const b of BUILDERS) {
  const src = fs.readFileSync(path.join(REPO_DIR, 'scripts', 'dev', b.file), 'utf8').split('\r').join('');
  const fn = liftInstall(src);
  yes(b.file + ': install() is there to lift', !!fn);
  if (!fn) { continue; }
  yes(b.file + ': takes its table writer from GamemodeTables.js', /\nconst TABLES = require\('\.\/GamemodeTables\.js'\);\n/.test(src));
  const file = TABLES.file(b.name);

  // 1. no table yet
  fs.rmSync(file, { force: true });
  const r1 = run(fn, b.vars);
  const wrote = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  yes(b.file + ': with no table yet it writes game/gamemode-tables/' + b.name + '.json, laid out one row to a line',
      wrote !== null && wrote === TABLES.layout(wrote) && r1.exitCode !== 1 && r1.failed.length === 0);
  yes(b.file + ': and neither reads nor writes gamemode.js nor any other file', !r1.readGamemode && !r1.wroteElsewhere);
  if (wrote === null) { continue; }

  // 2. the same table again
  const before = fs.statSync(file).mtimeMs;
  const r2 = run(fn, b.vars);
  yes(b.file + ': run again on the same tables, the file is the same and it does not fail',
      fs.readFileSync(file, 'utf8') === wrote && r2.exitCode !== 1 && r2.failed.length === 0);
  yes(b.file + ': and it says the table is already current (' + (r2.said[0] || '') + ')',
      r2.said.some(function (s) { return /already current/.test(s); }) && fs.statSync(file).mtimeMs === before);

  // 3. a table that differs
  fs.writeFileSync(file, '{\n"items":{\n"old":1\n}\n}\n');
  const r3 = run(fn, b.vars);
  yes(b.file + ': a table that differs is written whole',
      fs.readFileSync(file, 'utf8') === wrote && r3.exitCode !== 1 && r3.said.some(function (s) { return /^wrote /.test(s); }));
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { }

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
