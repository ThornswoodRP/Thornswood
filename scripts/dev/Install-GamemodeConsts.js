// Install-GamemodeConsts.js
//
// Installs DATA, STATIONS, ITEMS and CHARGEN from game\data\*.json into
// gamemode.js. These four tables are not read out of the plugins: they were
// recovered into JSON when tools\thornswood-src was retired (5d1f3f0, 21
// September), and they are maintained as checked-in JSON. The old comment at
// gamemode.js named respawn-holds.json; that file never lived in this
// repository. game\data\data.json is the source for DATA, which the gamemode
// reads from its table file, game\gamemode-tables\DATA.json (#5191); the
// other three are const lines in gamemode.js.
//
// Except DATA.worldspaces, which scripts\dev\Build-WorldspaceTable.js reads
// out of the WRLD records of the load order and writes into data.json and the
// DATA table (#1896). Do not edit that list by hand.
//
// Does not invent content. Edit the JSON, then run this to write the const
// lines. --check verifies the gamemode matches the JSON (by value) and writes
// nothing.
//
// Usage:
//   node scripts\dev\Install-GamemodeConsts.js
//   node scripts\dev\Install-GamemodeConsts.js --check
const fs = require('fs');
const path = require('path');

const CHECK = process.argv.indexOf('--check') !== -1;
const root = path.join(__dirname, '..', '..');
const gmPath = path.join(root, 'game', 'gamemode.js');
const dataDir = path.join(root, 'game', 'data');
const GT = require('./GamemodeTables.js');

const TABLES = [
  { name: 'DATA', file: 'data.json', table: true },
  { name: 'STATIONS', file: 'stations.json' },
  { name: 'ITEMS', file: 'items.json' },
  { name: 'CHARGEN', file: 'chargen.json' }
];

function loadJson(file) {
  const p = path.join(dataDir, file);
  if (!fs.existsSync(p)) {
    console.error('FAIL  missing ' + p);
    process.exitCode = 1;
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('FAIL  ' + p + ' does not parse: ' + e.message);
    process.exitCode = 1;
    return null;
  }
}

function parseConstLine(src, name) {
  const re = new RegExp('^const ' + name + ' = (.*);$', 'm');
  const m = src.match(re);
  if (!m) return null;
  try { return { match: m[0], value: JSON.parse(m[1]) }; }
  catch (e) { return { match: m[0], error: e.message }; }
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

let src;
try {
  src = fs.readFileSync(gmPath, 'utf8');
} catch (e) {
  console.error('FAIL  no gamemode.js at ' + gmPath);
  process.exit(1);
}

let next = src;
let changed = 0;
let matched = 0;

for (const t of TABLES) {
  const obj = loadJson(t.file);
  if (obj === null) continue;
  if (t.table) {
    // Laid out from the file's own text, as Build-WorldspaceTable.js writes it.
    const text = fs.readFileSync(path.join(dataDir, t.file), 'utf8');
    if (GT.isCurrent(t.name, text)) {
      console.log('ok    ' + t.name + ' matches game\\data\\' + t.file);
      matched++;
    } else {
      if (!CHECK) { GT.write(t.name, text); }
      changed++;
      console.log((CHECK ? 'DIFF  ' : 'wrote ') + t.name + ' table from game\\data\\' + t.file);
    }
    continue;
  }
  const parsed = parseConstLine(next, t.name);
  if (!parsed) {
    console.error('FAIL  gamemode.js has no "const ' + t.name + ' = {...};" line');
    process.exitCode = 1;
    continue;
  }
  if (parsed.error) {
    console.error('FAIL  ' + t.name + ' line does not parse: ' + parsed.error);
    process.exitCode = 1;
    continue;
  }
  if (sameValue(parsed.value, obj)) {
    console.log('ok    ' + t.name + ' matches game\\data\\' + t.file);
    matched++;
    continue;
  }
  const line = 'const ' + t.name + ' = ' + JSON.stringify(obj) + ';';
  next = next.replace(parsed.match, line);
  changed++;
  console.log((CHECK ? 'DIFF  ' : 'wrote ') + t.name + ' from game\\data\\' + t.file);
}

if (process.exitCode) process.exit(process.exitCode);

if (CHECK) {
  if (changed) {
    console.error('FAIL  gamemode.js is out of date with game\\data for ' + changed + ' table(s); run Install-GamemodeConsts.js');
    process.exit(1);
  }
  console.log('ok    all four consts match game\\data');
  process.exit(0);
}

if (changed === 0) {
  console.log('game\\gamemode.js and the DATA table already hold these tables');
} else if (next !== src) {
  fs.writeFileSync(gmPath, next);
  console.log('installed ' + changed + ' const(s) into game\\gamemode.js (' + matched + ' already matched)');
}
