// test-1896-worldspaces.js
//
// #1896. DATA.worldspaces (game/data/data.json, and the DATA line of
// game/gamemode.js) is the set the server reads as "a worldspace, not a room":
// resolveArrival, for the temple a death writes and the one a person who comes
// back dead gets, and climateOf, for which hold's sky somebody stands under.
// It was recovered into JSON when tools\thornswood-src was retired and kept by
// hand, and on 5 October it named 39 of the 65 WRLD records of the Main
// install's load order (101 plugins, Profile\OwnGame\plugins.txt): none of
// Dawnguard.esm's nine, neither of WindhelmSSE.esp's two, none of Solitude
// Arena.esp's 14, nor Update.esm's TestSnow.
//
// Which count is decided: every WRLD record of the load order, since that is
// what the set means. scripts/dev/Build-WorldspaceTable.js reads them out of
// the plugins and writes the list into data.json and the DATA line, nothing
// else. MEASURED below is what it read that day, each with the editor id of
// its record.
//
// This holds the list to MEASURED, runs the builder against plugins made here
// (an override is not a worldspace of its own, the #1007 trap; a deleted one
// is out; a plugin switched off is not read; a missing one stops the build),
// holds its install to changing the list and nothing else, and holds both
// readers of the set to choosing the same hold with or without a worldspace
// in it. Given a Data folder and its plugins.txt (THORNSWOOD_DATA and
// THORNSWOOD_PLUGINS) it reads the load order again with the builder's own
// reader; without them it says it did not.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const TABLES = require('./gamemode-tables.js');
const gm = TABLES.joined(fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'), 'utf8')).split(CR).join('');
const jsonText = fs.readFileSync(path.join(ROOT, 'game', 'data', 'data.json'), 'utf8');
const data = JSON.parse(jsonText);
const Build = require(path.join(ROOT, 'scripts', 'dev', 'Build-WorldspaceTable.js'));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const MEASURED = {
  "104217:Skyrim.esm": "LabyrinthianMazeWorld",
  "1408:Dawnguard.esm": "DLC01SoulCairn",
  "1691d:Skyrim.esm": "WindhelmWorld",
  "16bb4:Skyrim.esm": "RiftenWorld",
  "16d71:Skyrim.esm": "MarkarthWorld",
  "16fd:Solitude Arena.esp": "AAALSDarencombSOLIDUPLICATE001",
  "1a26f:Skyrim.esm": "WhiterunWorld",
  "1a651:Solitude Arena.esp": "aLSDQUET",
  "1a654:Solitude Arena.esp": "AAALSDarencombSOLI",
  "1b44a:Skyrim.esm": "CWTestHold",
  "1c0b2:Dragonborn.esm": "DLC2ApocryphaWorld",
  "1cdd3:Skyrim.esm": "LabyrinthianWorld",
  "1cdd9:Skyrim.esm": "LabyrinthianWorld03",
  "1db8:Dawnguard.esm": "DLC1HunterHQWorld",
  "1e49d:Skyrim.esm": "MossMotherCavernWorld",
  "1ee62:Skyrim.esm": "Blackreach",
  "1fae2:Skyrim.esm": "BloatedMansGrottoWorld",
  "204c7:Skyrim.esm": "FallowstoneCaveWorldEnd",
  "20bfe:Skyrim.esm": "SouthfringeWorld",
  "20dcb:Skyrim.esm": "BlindCliffCaveWorld",
  "21edb:Skyrim.esm": "LabyrinthianWorld04",
  "243de:Skyrim.esm": "FallowstoneCaveWorldStart",
  "278dd:Skyrim.esm": "SkuldafnWorld",
  "291835:WindhelmSSE.esp": "0WHMiniBearQuestWorld",
  "293a:Update.esm": "TestSnow",
  "29ab7:Skyrim.esm": "DeepwoodRedoubtWorld",
  "2a9d8:Skyrim.esm": "ShadowgreenCavernWorld",
  "2b101:Skyrim.esm": "RedEagleRedoubtWorld",
  "2c965:Skyrim.esm": "DarkwaterWorld",
  "2ee41:Skyrim.esm": "Sovngarde",
  "2f64:Dawnguard.esm": "DLC1ForebearsHoldout",
  "34240:Skyrim.esm": "BluePalaceWingWorld",
  "351b:Solitude Arena.esp": "aaalsdarenedeso",
  "35699:Skyrim.esm": "KarthspireRedoubtWorld",
  "37edf:Skyrim.esm": "SolitudeWorld",
  "38c22:WindhelmSSE.esp": "00WHThePitWorldspace",
  "3a9d6:Skyrim.esm": "EldergleamSanctuaryWorld",
  "3c:Skyrim.esm": "Tamriel",
  "419e1:Skyrim.esm": "CWSiegeTestWorld",
  "42c2:Dawnguard.esm": "TestMeganWorld",
  "46033:Skyrim.esm": "WhiterunDragonsreachWorld",
  "48c7:Dawnguard.esm": "DLC1AncestorsGladeWorld",
  "4bea:Dawnguard.esm": "DLC1DarkfallPassageWorld",
  "4f838:Skyrim.esm": "EastEmpireWarehouse",
  "50015:Skyrim.esm": "BrinewaterGrottoWorld",
  "528d:Dawnguard.esm": "DLC01Boneyard",
  "670f:Solitude Arena.esp": "aLSDQUETDUPLICATE001",
  "69857:Skyrim.esm": "AlftandWorld",
  "6ed38:Skyrim.esm": "FXLightWorldSpace",
  "7202:Dawnguard.esm": "DLC1VampireCastleCourtyard",
  "7f00:Solitude Arena.esp": "ArnedeMorrowind",
  "800:Dragonborn.esm": "DLC2SolstheimWorld",
  "8ba7:Solitude Arena.esp": "aLSDvalbois",
  "931b:Solitude Arena.esp": "aBlackMARsh",
  "93a7:Solitude Arena.esp": "ahighrock",
  "94b35:Skyrim.esm": "JaphetsFollyWorld",
  "99b1:Solitude Arena.esp": "aLenclume",
  "a7f3:Solitude Arena.esp": "LSDmerdesvainqueurs",
  "bb5:Dawnguard.esm": "DLC01FalmerValley",
  "c350d:Skyrim.esm": "KatariahWorld",
  "c97eb:Skyrim.esm": "FrostmereCryptWorld",
  "d45f0:Skyrim.esm": "WindhelmPitWorldspace",
  "d7a:Solitude Arena.esp": "aaAWAconquest",
  "dfd:Solitude Arena.esp": "AAALSDarencombSOLIDUPLICATE002",
  "dff:Solitude Arena.esp": "aLSDQUETDUPLICATE002"
};

// ---- the list ------------------------------------------------------------------
const m = TABLES.lineOf(gm, 'DATA');
let DATA = null;
try { DATA = m ? JSON.parse(m[1]) : null; } catch (e) { DATA = null; }
const ws = data.worldspaces || [];
yes('the gamemode\'s DATA line holds the same worldspaces as data.json (' + ws.length + ')',
  !!DATA && JSON.stringify(DATA.worldspaces) === JSON.stringify(ws));
yes('no entry is listed twice, and the list is in the order the builder writes it',
  new Set(ws).size === ws.length && JSON.stringify(ws.slice().sort()) === JSON.stringify(ws));
const unknown = ws.filter(function (d) { return !Object.prototype.hasOwnProperty.call(MEASURED, d); });
yes('every entry is a WRLD record measured in the load order' + (unknown.length ? ' (not: ' + unknown.join(', ') + ')' : ''),
  unknown.length === 0);
const absent = Object.keys(MEASURED).filter(function (d) { return ws.indexOf(d) < 0; });
yes('and every one of the ' + Object.keys(MEASURED).length + ' measured is listed' + (absent.length ? ' (not: ' + absent.join(', ') + ')' : ''),
  absent.length === 0);
const dawnguard = ['1408', 'bb5', '528d', '4bea', '48c7', '7202', '1db8', '2f64', '42c2'].map(function (x) { return x + ':Dawnguard.esm'; });
yes('the nine Dawnguard.esm worldspaces the issue names, the Soul Cairn and the Forgotten Vale among them, are listed',
  dawnguard.every(function (d) { return ws.indexOf(d) >= 0; }));
yes('WindhelmSSE.esp\'s two, Solitude Arena.esp\'s 14 and Update.esm\'s TestSnow are listed',
  ['38c22:WindhelmSSE.esp', '291835:WindhelmSSE.esp', '293a:Update.esm'].every(function (d) { return ws.indexOf(d) >= 0; }) &&
  ws.filter(function (d) { return /:Solitude Arena\.esp$/.test(d); }).length === 14);
yes('the three Dragonborn.esm overrides #1007 took out stay out',
  ['3c', '1691d', '1b44a'].every(function (x) { return ws.indexOf(x + ':Dragonborn.esm') < 0 && ws.indexOf(x + ':Skyrim.esm') >= 0; }));

// ---- what the list changes for its readers --------------------------------------
// resolveArrival and climateOf both skip holdOfCell for a worldspace in the set
// and ask it for one out of the set; holdOfCell answers from cellToHold, which
// names no worldspace, so the hold is the nearest capital to the position
// either way.
const inCells = ws.filter(function (d) { return Object.prototype.hasOwnProperty.call(data.cellToHold, d); });
yes('no worldspace is a key of DATA.cellToHold, so a worldspace in the set or out of it gets the same hold' +
  (inCells.length ? ' (are: ' + inCells.join(', ') + ')' : ''), inCells.length === 0);

function sliceFn(src, start, end) {
  const a = src.indexOf(start);
  const b = a < 0 ? -1 : src.indexOf(end, a);
  return a < 0 || b < 0 ? null : src.slice(a, b);
}
const arrivalSrc = sliceFn(gm, '\nfunction dist2(', '\nfunction ensureProperties(');
yes('resolveArrival and the helpers it calls are sliced out of gamemode.js', !!arrivalSrc);
function resolver(set) {
  return new Function('DATA', 'WORLDSPACES', 'PREFER_SLOT', 'FALLBACK_DESTINATION',
    arrivalSrc + '\nreturn resolveArrival;')(DATA, set, 'temple', 'whiterun');
}
if (arrivalSrc && DATA) {
  const now = resolver(new Set(DATA.worldspaces));
  const without = resolver(new Set());
  // Spots where npc-population.json stands somebody, in the Soul Cairn, the
  // Forgotten Vale, the Pit under Windhelm and one of the arena's floors. All
  // four have coordinates of their own, so since #1909 they wake by their own
  // worldspace (DATA.ownWorlds) before the set is asked at all, in it or out.
  const spots = [
    { desc: '1408:Dawnguard.esm', pos: [11694.0, -3113.3, 941.1] },
    { desc: 'bb5:Dawnguard.esm', pos: [-9689.1, -234.4, 3013.8] },
    { desc: '38c22:WindhelmSSE.esp', pos: [137821.2, 43137.9, -12463.9] },
    { desc: '1a654:Solitude Arena.esp', pos: [1576, 2038, 2304] }
  ];
  for (const s of spots) {
    const a = now(s), b = without(s);
    yes('a death in ' + MEASURED[s.desc] + ' wakes by its own worldspace (' + a.via + '), in the set or out of it',
      a.via === 'own-world-no-door' && b.via === a.via && a.desc === b.desc);
  }
  // In Tamriel's coordinates the set still decides. LabyrinthianWorld is laid
  // out in them (its doors land beside Tamriel's) and stands in Hjaalmarch,
  // which has no temple of its own: in the set the borrowed door is measured
  // from where they fell, out of it from Morthal.
  const lab = { desc: '1cdd3:Skyrim.esm', pos: [-12404, 44258, 1711] };
  const a = now(lab), b = without(lab);
  yes('in LabyrinthianWorld, where the nearest capital is Morthal\'s, the borrowed door is measured from where they fell: ' +
      a.destination + ' ' + a.slot + ' (' + a.via + '), out of the set ' + b.destination + ' ' + b.slot + ' (' + b.via + ')',
    a.via === 'nearest-capital' && b.via === 'unmapped-interior' &&
    a.hold === 'HjaalmarchHoldLocation' && b.hold === a.hold && a.reason === 'borrowed' && b.reason === 'borrowed' &&
    a.destination === 'whiterun' && a.slot === 'hallOfTheDead' && b.destination === 'solitude' && b.slot === 'hallOfTheDead');
  const interior = { desc: '165a7:Skyrim.esm', pos: [1056.2, 254.9, 63] };
  yes('a room is still not outdoors (the Temple of Kynareth)', now(interior).via !== 'nearest-capital');
}

// ---- the builder, against plugins made here -------------------------------------
function sub(type, body) {
  const h = Buffer.alloc(6);
  h.write(type, 0, 'ascii'); h.writeUInt16LE(body.length, 4);
  return Buffer.concat([h, body]);
}
function zstr(s) { return Buffer.from(s + '\0', 'latin1'); }
function record(type, flags, formId, body, pack) {
  let d = body;
  if (pack) {
    const n = Buffer.alloc(4); n.writeUInt32LE(body.length, 0);
    d = Buffer.concat([n, zlib.deflateSync(body)]);
    flags |= 0x00040000;
  }
  const h = Buffer.alloc(24);
  h.write(type, 0, 'ascii'); h.writeUInt32LE(d.length, 4); h.writeUInt32LE(flags >>> 0, 8); h.writeUInt32LE(formId >>> 0, 12);
  return Buffer.concat([h, d]);
}
function group(label, kind, parts) {
  const body = Buffer.concat(parts);
  const h = Buffer.alloc(24);
  h.write('GRUP', 0, 'ascii'); h.writeUInt32LE(24 + body.length, 4);
  if (typeof label === 'string') { h.write(label, 8, 'ascii'); } else { h.writeUInt32LE(label, 8); }
  h.writeUInt32LE(kind, 12);
  return Buffer.concat([h, body]);
}
function plugin(masters, groups) {
  const hedr = Buffer.alloc(12);
  const parts = [sub('HEDR', hedr)];
  masters.forEach(function (n) { parts.push(sub('MAST', zstr(n)), sub('DATA', Buffer.alloc(8))); });
  return Buffer.concat([record('TES4', 0, 0, Buffer.concat(parts))].concat(groups));
}
function world(formId, edid, opts) {
  opts = opts || {};
  const rec = record('WRLD', opts.deleted ? 0x20 : 0, formId, sub('EDID', zstr(edid)), !!opts.pack);
  // Each worldspace is followed by a group of its cells, which the reader skips.
  const cells = group(formId, 1, [record('CELL', 0, (formId & 0xff000000) | 0x9999, sub('EDID', zstr('NotAWorld')))]);
  return [rec, cells];
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-1896-'));
const dir = path.join(tmp, 'Data');
fs.mkdirSync(dir);
const kywd = group('KYWD', 0, [record('KYWD', 0, 0x100, sub('EDID', zstr('SomeKeyword')))]);
fs.writeFileSync(path.join(dir, 'Skyrim.esm'), plugin([], [kywd,
  group('WRLD', 0, [].concat(world(0x3c, 'Tamriel'), world(0x1ee62, 'Blackreach', { pack: true }), world(0x1b44a, 'CWTestHold')))]));
['Update.esm', 'Dawnguard.esm', 'HearthFires.esm'].forEach(function (n) {
  fs.writeFileSync(path.join(dir, n), plugin(['Skyrim.esm'], []));
});
// Dragonborn.esm: Tamriel and CWTestHold again (overrides, master byte 0),
// and Solstheim, its own (master byte 1).
fs.writeFileSync(path.join(dir, 'Dragonborn.esm'), plugin(['Skyrim.esm', 'Update.esm'], [
  group('WRLD', 0, [].concat(world(0x0000003c, 'Tamriel'), world(0x0001b44a, 'CWTestHold'), world(0x02000800, 'DLC2SolstheimWorld')))]));
fs.writeFileSync(path.join(dir, 'Arena.esp'), plugin(['Skyrim.esm'], [
  group('WRLD', 0, [].concat(world(0x01000d7a, 'ArenaFloor', { pack: true }), world(0x0001b44a, 'CWTestHold', { deleted: true })))]));
fs.writeFileSync(path.join(dir, 'Switched Off.esp'), plugin(['Skyrim.esm'], [
  group('WRLD', 0, world(0x01000aaa, 'NeverLoaded'))]));
const list = path.join(tmp, 'plugins.txt');
fs.writeFileSync(list, '# made by test-1896\r\n*Arena.esp\r\nSwitched Off.esp\r\n');

const got = Build.readWorldspaces(dir, list);
yes('the made-up load order reads with no problem (' + (got.problems.join('; ') || 'none') + ')', got.problems.length === 0);
yes('Skyrim.esm\'s worldspaces are read, the compressed one too',
  got.worlds['3c:Skyrim.esm'] === 'Tamriel' && got.worlds['1ee62:Skyrim.esm'] === 'Blackreach');
yes('Dragonborn.esm\'s copies of Tamriel are the record they override, not 3c:Dragonborn.esm (#1007)',
  !('3c:Dragonborn.esm' in got.worlds) && !('1b44a:Dragonborn.esm' in got.worlds));
yes('a worldspace a plugin defines is under that plugin\'s name, with its own editor id',
  got.worlds['800:Dragonborn.esm'] === 'DLC2SolstheimWorld' && got.worlds['d7a:Arena.esp'] === 'ArenaFloor');
yes('a worldspace the last plugin to carry it deletes is out', !('1b44a:Skyrim.esm' in got.worlds));
yes('a plugin plugins.txt has switched off is not read', !('aaa:Switched Off.esp' in got.worlds));
yes('a cell group under a worldspace is not read as a worldspace',
  Object.keys(got.worlds).every(function (d) { return got.worlds[d] !== 'NotAWorld'; }));
yes('and that is all of them',
  JSON.stringify(Object.keys(got.worlds)) === JSON.stringify(['1ee62:Skyrim.esm', '3c:Skyrim.esm', '800:Dragonborn.esm', 'd7a:Arena.esp']));

// The install changes the list and nothing else. The gamemode's DATA table
// is data.json laid out (#5191), written from it.
const small = '{\n "a": 1.0,\n "worldspaces": [\n  "3c:Skyrim.esm",\n  "gone:Skyrim.esm"\n ],\n "solstheim": 2000800\n}\n';
const smallTable = '{\n"a":1.0,\n"worldspaces":[\n"3c:Skyrim.esm",\n"gone:Skyrim.esm"\n],\n"solstheim":2000800\n}\n';
const inst = Build.install(['3c:Skyrim.esm', 'd7a:Arena.esp'], small);
yes('the install writes the list into data.json at its own layout, and nothing else moves',
  inst.json === '{\n "a": 1.0,\n "worldspaces": [\n  "3c:Skyrim.esm",\n  "d7a:Arena.esp"\n ],\n "solstheim": 2000800\n}\n');
const crlf = Build.install(['3c:Skyrim.esm', 'd7a:Arena.esp'], small.split('\n').join(CR + '\n'));
yes('a checkout from before .gitattributes, CRLF, gets the same list, written LF (#3029)',
  !crlf.error && crlf.json.indexOf('"worldspaces": [\n  "3c:Skyrim.esm",\n  "d7a:Arena.esp"\n ]') >= 0);
yes('it refuses a data.json with two lists rather than guess which',
  !!Build.install(['3c:Skyrim.esm'], '{"worldspaces":[],"b":{"worldspaces":[]}}').error);
yes('the install of the list this load order has today changes nothing',
  (function () { const r = Build.install(ws, jsonText); return r.json === jsonText; })());
yes('the gamemode\'s DATA table is data.json laid out',
  fs.readFileSync(TABLES.file('DATA'), 'utf8') === require(path.join(ROOT, 'scripts', 'dev', 'GamemodeTables.js')).layout(jsonText));

// The command: --check writes nothing and says no; a missing plugin stops it.
const j = path.join(tmp, 'data.json'), g = path.join(tmp, 'tables');
const tableOf = function () { try { return fs.readFileSync(path.join(g, 'DATA.json'), 'utf8'); } catch (e) { return null; } };
fs.writeFileSync(j, small); fs.mkdirSync(g, { recursive: true }); fs.writeFileSync(path.join(g, 'DATA.json'), smallTable);
const quiet = console.log, quietErr = console.error;
const said = [];
console.log = function (s) { said.push(String(s)); };
console.error = function (s) { said.push(String(s)); };
let c1, c2, c3, c4;
try {
  c1 = Build.main(['--data', dir, '--plugins', list, '--json', j, '--tables', g, '--check']);
  const untouched = fs.readFileSync(j, 'utf8') === small && tableOf() === smallTable;
  c2 = Build.main(['--data', dir, '--plugins', list, '--json', j, '--tables', g]);
  c3 = Build.main(['--data', dir, '--plugins', list, '--json', j, '--tables', g, '--check']);
  fs.writeFileSync(list, '*Arena.esp\r\n*Not Here.esp\r\n');
  const before = fs.readFileSync(j, 'utf8');
  c4 = Build.main(['--data', dir, '--plugins', list, '--json', j, '--tables', g]);
  c4 = { code: c4, untouched: untouched, kept: fs.readFileSync(j, 'utf8') === before };
} finally { console.log = quiet; console.error = quietErr; }
yes('--check on a list that differs says so and writes nothing', c1 === 1 && c4.untouched);
yes('the build writes it and the DATA table laid out from it, and --check then agrees', c2 === 0 && c3 === 0 &&
  JSON.parse(fs.readFileSync(j, 'utf8')).worldspaces.length === 4 &&
  tableOf() === require(path.join(ROOT, 'scripts', 'dev', 'GamemodeTables.js')).layout(fs.readFileSync(j, 'utf8')));
yes('a plugin switched on and missing from the Data folder stops the build, and nothing is written',
  c4.code === 1 && c4.kept && said.some(function (s) { return s.indexOf('Not Here.esp is switched on') >= 0; }));
fs.rmSync(tmp, { recursive: true, force: true });

// ---- again, against a load order on this machine ------------------------------
const DATA_DIR = process.env.THORNSWOOD_DATA, LIST = process.env.THORNSWOOD_PLUGINS;
if (DATA_DIR && LIST && fs.existsSync(DATA_DIR) && fs.existsSync(LIST)) {
  const real = Build.readWorldspaces(DATA_DIR, LIST);
  yes('read again from ' + real.order.length + ' plugins with the builder\'s own reader, no problem' +
      (real.problems.length ? ' (' + real.problems.join('; ') + ')' : ''), real.problems.length === 0);
  const keys = Object.keys(real.worlds);
  yes('the list is exactly its ' + keys.length + ' WRLD records',
    JSON.stringify(keys.slice().sort()) === JSON.stringify(ws));
  const renamed = keys.filter(function (d) { return real.worlds[d] !== MEASURED[d]; });
  yes('and each is the record MEASURED names' + (renamed.length ? ' (not: ' + renamed.join(', ') + ')' : ''), renamed.length === 0);
} else {
  console.log('      not read again: set THORNSWOOD_DATA to a Data folder and THORNSWOOD_PLUGINS to its plugins.txt');
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
