// test-race-table.js
//
// A race is one line in the race table, under the plugin that made it, worth
// what the last plugin in the load order says.
//
// Found on 24 September by the ale fix (#322). Build-FoodTable.js filed one
// line per plugin that carried a record, and the ale agent measured the same
// shape in RACES: "1052a3:Skyrim.esm", "1052a3:Update.esm" and
// "1052a3:Dragonborn.esm" were three lines. An override keeps the form id of
// the plugin that first made the record, so the game reports UndeadDragonRace
// as 1052a3 of Skyrim.esm and the server read Skyrim.esm's version of it, not
// the one the game uses. The Update.esm and Dragonborn.esm lines resolved to
// ids nothing ever reports.
//
// Measured on this build when it was fixed: 258 versions of 215 races, 43
// lines nobody could reach, and no race the game reports answered
// differently, because no plugin in the order changes a race's editor id or
// its playable bit. So part A is the proof that matters: it runs the builder
// on plugins that DO change a race, the way a mod one day will.
//
// Two halves.
//
//   A. The builder itself, scripts/dev/Build-RaceTable.js, run on plugins this
//      harness writes, so it runs on any machine: one line per record, keyed
//      by the plugin that made it, worth what the last plugin says.
//
//   B. The table that ships, the RACES line in game/gamemode.js, through the
//      REAL raceOf and raceGate, with the race ids the game reports.
//
// Read only. The builder runs on a copy in a temporary folder and writes only
// there.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = REPO_DIR;
const SRC = process.env.GM || path.join(REPO, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ------------------------------------------------------------------ A --

/*
  A plugin, written out byte by byte in the shape the builder reads: a TES4
  header with its MAST list, then one RACE group. A number for a name is a
  localised plugin's strings file id, which is what Skyrim.esm really
  carries. The playable bit is bit 0 of the four bytes at 32 in DATA, the
  offset Build-RaceTable.js measured.
*/
function zs(s) { return Buffer.concat([Buffer.from(s, 'latin1'), Buffer.alloc(1)]); }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }
function sub(tag, data) {
  const h = Buffer.alloc(6);
  h.write(tag, 0, 'ascii');
  h.writeUInt16LE(data.length, 4);
  return Buffer.concat([h, data]);
}
function record(type, formId, flags, data) {
  const h = Buffer.alloc(24);
  h.write(type, 0, 'ascii');
  h.writeUInt32LE(data.length, 4);
  h.writeUInt32LE(flags >>> 0, 8);
  h.writeUInt32LE(formId >>> 0, 12);
  return Buffer.concat([h, data]);
}
function group(label, recs) {
  const body = Buffer.concat(recs);
  const h = Buffer.alloc(24);
  h.write('GRUP', 0, 'ascii');
  h.writeUInt32LE(24 + body.length, 4);
  h.write(label, 8, 'ascii');
  return Buffer.concat([h, body]);
}
function race(formId, edid, name, playable) {
  const data = Buffer.alloc(128);
  data.writeUInt32LE(playable ? 1 : 0, 32);
  return record('RACE', formId, 0, Buffer.concat([
    sub('EDID', zs(edid)),
    sub('FULL', typeof name === 'number' ? u32(name) : zs(name)),
    sub('DATA', data)
  ]));
}
function plugin(headerFlags, masters, recs) {
  const hedr = Buffer.alloc(12);
  hedr.writeFloatLE(1.71, 0);
  hedr.writeUInt32LE(recs.length, 4);
  hedr.writeUInt32LE(0x800, 8);
  const parts = [sub('HEDR', hedr)];
  masters.forEach(function (m) {
    parts.push(sub('MAST', zs(m)));
    parts.push(sub('DATA', Buffer.alloc(8)));
  });
  return Buffer.concat([record('TES4', 0, headerFlags, Buffer.concat(parts)), group('RACE', recs)]);
}

const FIVE = ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'];
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-race-'));
const DATA = path.join(TMP, 'Game', 'Data');
fs.mkdirSync(DATA, { recursive: true });
// The gamemode and its tables sit in game\ since phase 6 (issue #440).
fs.mkdirSync(path.join(TMP, 'game', 'data'), { recursive: true });
// And the table builders in scripts\dev since phase 8.
fs.mkdirSync(path.join(TMP, 'scripts', 'dev'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'Profile', 'Default'), { recursive: true });

/*
  The same shape as this build, measured 24 September: Skyrim.esm makes the
  races with names that are strings file numbers, Update.esm, Dawnguard.esm
  and Dragonborn.esm override some of them without changing them, and
  Dragonborn.esm makes a race of its own. Then two plugins this build does
  not have and one day might: RaceMod.esp makes FalmerRace playable, renames
  NordRaceVampire, makes Dragonborn's riekling playable and adds a race of its
  own; LowerCase.esp writes its master as "skyrim.esm", which a plugin is
  allowed to do and the server's exact file match is not.
*/
fs.writeFileSync(path.join(DATA, 'Skyrim.esm'), plugin(0x81, [], [
  race(0x00013746, 'NordRace', 0x2a1f, true),
  race(0x00013740, 'ArgonianRace', 0x2a19, true),
  race(0x001052a3, 'UndeadDragonRace', 0x8c01, false),
  race(0x000131f4, 'FalmerRace', 0x2b30, false),
  race(0x00088794, 'NordRaceVampire', 0x2a1f, false)
]));
fs.writeFileSync(path.join(DATA, 'Update.esm'), plugin(0x81, ['Skyrim.esm'], [
  race(0x00013746, 'NordRace', 0x2a1f, true),
  race(0x001052a3, 'UndeadDragonRace', 0x8c01, false)
]));
fs.writeFileSync(path.join(DATA, 'Dawnguard.esm'), plugin(0x81, ['Skyrim.esm', 'Update.esm'], [
  race(0x00088794, 'NordRaceVampire', 0x2a1f, false)
]));
// HearthFires.esm carries no race here, but a game folder holds it and the
// builder stops on a plugin of the load order that is not on disk (#2976).
fs.writeFileSync(path.join(DATA, 'HearthFires.esm'), plugin(0x81, ['Skyrim.esm', 'Update.esm'], []));
fs.writeFileSync(path.join(DATA, 'Dragonborn.esm'), plugin(0x81, ['Skyrim.esm', 'Update.esm'], [
  race(0x001052a3, 'UndeadDragonRace', 0x8c01, false),
  race(0x02017f44, 'DLC2RieklingRace', 0x3c11, false)
]));
fs.writeFileSync(path.join(DATA, 'RaceMod.esp'), plugin(0, ['Skyrim.esm', 'Update.esm', 'Dragonborn.esm'], [
  race(0x000131f4, 'FalmerRace', 'Falmer', true),
  race(0x00088794, 'NordVampireRace', 'Nord Vampire', false),
  race(0x02017f44, 'DLC2RieklingRace', 'Riekling', true),
  race(0x03000800, 'SnowElfRace', 'Snow Elf', true)
]));
fs.writeFileSync(path.join(DATA, 'LowerCase.esp'), plugin(0, ['skyrim.esm'], [
  race(0x00013740, 'ArgonianRace', 'Argonian', true)
]));
fs.writeFileSync(path.join(TMP, 'Profile', 'Default', 'plugins.txt'),
  ['*RaceMod.esp', '*LowerCase.esp', ''].join(String.fromCharCode(13, 10)));
fs.copyFileSync(path.join(REPO, 'scripts', 'dev', 'Build-RaceTable.js'), path.join(TMP, 'scripts', 'dev', 'Build-RaceTable.js'));
fs.copyFileSync(path.join(REPO, 'scripts', 'dev', 'OwnPlugins.js'), path.join(TMP, 'scripts', 'dev', 'OwnPlugins.js'));
fs.copyFileSync(path.join(REPO, 'scripts', 'dev', 'GamemodeTables.js'), path.join(TMP, 'scripts', 'dev', 'GamemodeTables.js'));
// The table the gamemode reads is its own file since #5191.
const TABLE = path.join(TMP, 'game', 'gamemode-tables', 'RACES.json');

function build() {
  return spawnSync(process.execPath, [path.join(TMP, 'scripts', 'dev', 'Build-RaceTable.js'), '--data', DATA],
                   { encoding: 'utf8' });
}
function installed() {
  try { return JSON.parse(fs.readFileSync(TABLE, 'utf8')).items; } catch (e) { return null; }
}

const run1 = build();
if (run1.status !== 0) { console.log(run1.stdout + run1.stderr); }
yes('A1 the builder runs on a load order of seven plugins and exits 0', run1.status === 0);
const got = installed() || {};
const built = (function () {
  try { return JSON.parse(fs.readFileSync(path.join(TMP, 'game', 'data', 'races.json'), 'utf8')).items; }
  catch (e) { return {}; }
})();
function linesFor(local) {
  return Object.keys(got).filter(function (d) { return d.split(':')[0] === local; });
}

{
  const nord = linesFor('13746');
  yes('A2 NordRace is one line, not one per plugin that carries it (' + nord.join(', ') + ')',
      nord.length === 1 && nord[0] === '13746:Skyrim.esm');
  yes('A2 and nothing is keyed by a plugin that only overrides it',
      !Object.keys(got).some(function (d) {
        return /^(13746|13740|1052a3|131f4|88794):(Update\.esm|Dawnguard\.esm|Dragonborn\.esm|RaceMod\.esp|LowerCase\.esp)$/.test(d) ||
               /^17f44:RaceMod\.esp$/.test(d);
      }));
}
{
  const dragon = linesFor('1052a3');
  yes('A3 UndeadDragonRace is one line, 1052a3:Skyrim.esm (' + dragon.join(', ') + ')',
      dragon.length === 1 && dragon[0] === '1052a3:Skyrim.esm');
  yes('A3 and races.json says the version kept is Dragonborn.esm\'s, the last to carry it',
      !!built['1052a3:Skyrim.esm'] && built['1052a3:Skyrim.esm'].from === 'Dragonborn.esm');
}
yes('A4 the playable bit is the last plugin\'s: FalmerRace made playable by RaceMod.esp reads playable',
    !!got['131f4:Skyrim.esm'] && got['131f4:Skyrim.esm'].p === true &&
    !!built['131f4:Skyrim.esm'] && built['131f4:Skyrim.esm'].from === 'RaceMod.esp');
yes('A4 and so is the name, read off a plugin that is not localised (Falmer)',
    !!built['131f4:Skyrim.esm'] && built['131f4:Skyrim.esm'].n === 'Falmer');
yes('A4 the editor id is the last plugin\'s: 88794 reads NordVampireRace, not Dawnguard\'s NordRaceVampire',
    !!got['88794:Skyrim.esm'] && got['88794:Skyrim.esm'].e === 'NordVampireRace');
yes('A4 a race nobody overrides keeps its own values (NordRace, playable)',
    !!got['13746:Skyrim.esm'] && got['13746:Skyrim.esm'].e === 'NordRace' && got['13746:Skyrim.esm'].p === true);
yes('A5 an override of a race Dragonborn.esm made lands on Dragonborn.esm, playable',
    linesFor('17f44').join(',') === '17f44:Dragonborn.esm' && got['17f44:Dragonborn.esm'].p === true);
yes('A6 a race RaceMod.esp made itself is keyed RaceMod.esp (800, SnowElfRace)',
    !!got['800:RaceMod.esp'] && got['800:RaceMod.esp'].e === 'SnowElfRace');
yes('A7 a master written "skyrim.esm" lands on the load order\'s spelling',
    linesFor('13740').join(',') === '13740:Skyrim.esm' &&
    !!built['13740:Skyrim.esm'] && built['13740:Skyrim.esm'].from === 'LowerCase.esp');
yes('A8 fifteen versions of seven races make seven lines (' + Object.keys(got).length + ')',
    Object.keys(got).length === 7);
yes('A8 and races.json has the same seven',
    Object.keys(built).sort().join(',') === Object.keys(got).sort().join(','));

/*
  The line is generated, and generating it twice is the proof: the same load
  order gives the same line, and the builder says so instead of saying FAIL,
  which it did before 24 September whenever nothing had changed.
*/
{
  const before = fs.readFileSync(TABLE, 'utf8');
  const run2 = build();
  const after = fs.readFileSync(TABLE, 'utf8');
  yes('A9 run again on the same plugins, it exits 0 and leaves the same table',
      run2.status === 0 && before === after);
}

/*
  --plugins <file> (#1140). Same flag as the warmth / water / fire / weather
  builders. The default path still works above; this proves another list is
  read when the flag is passed, and that Profile\\Default is ignored then.
*/
{
  const alt = path.join(TMP, 'elsewhere', 'plugins.txt');
  fs.mkdirSync(path.dirname(alt), { recursive: true });
  // Only LowerCase.esp: no RaceMod.esp, so Falmer stays unplayable and
  // SnowElfRace is never made.
  fs.writeFileSync(alt, ['*LowerCase.esp', ''].join(String.fromCharCode(13, 10)));
  fs.rmSync(TABLE, { force: true });
  const runAlt = spawnSync(process.execPath,
    [path.join(TMP, 'scripts', 'dev', 'Build-RaceTable.js'), '--data', DATA, '--plugins', alt],
    { encoding: 'utf8' });
  if (runAlt.status !== 0) { console.log(runAlt.stdout + runAlt.stderr); }
  yes('A10 --plugins reads an alternate list and exits 0', runAlt.status === 0);
  const gotAlt = installed() || {};
  yes('A10 without RaceMod.esp, SnowElfRace is absent',
      !gotAlt['800:RaceMod.esp']);
  yes('A10 without RaceMod.esp, FalmerRace stays unplayable',
      !!gotAlt['131f4:Skyrim.esm'] && gotAlt['131f4:Skyrim.esm'].p === false);
  yes('A10 LowerCase.esp still lands ArgonianRace on Skyrim.esm',
      !!gotAlt['13740:Skyrim.esm'] && gotAlt['13740:Skyrim.esm'].e === 'ArgonianRace');
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { }

// ------------------------------------------------------------------ B --

const RACES = (function () {
  const m = require('./gamemode-tables.js').lineOf(src, 'RACES');
  try { return m ? JSON.parse(m[1]) : null; } catch (e) { return null; }
})();
yes('B0 the RACES line is in the gamemode and parses', !!(RACES && RACES.items));
const items = (RACES && RACES.items) || {};
const json = (function () {
  try { return JSON.parse(fs.readFileSync(path.join(REPO, 'game', 'data', 'races.json'), 'utf8')).items; }
  catch (e) { return null; }
})();
yes('B0 game/data/races.json parses', !!json);

/*
  The line and the json come out of the same run. Build-RecipeTable.ps1 reads
  the json to decide which races are playable, and the server reads the line,
  so the two must say the same thing.
*/
{
  const j = json || {};
  const same = Object.keys(items).length === Object.keys(j).length &&
    Object.keys(items).every(function (d) {
      return !!j[d] && (j[d].e || j[d].n) === items[d].e && !!j[d].p === items[d].p;
    });
  yes('B1 the RACES line and races.json hold the same ' + Object.keys(items).length + ' races', same);
  yes('B1 and every races.json row says which plugin\'s version it was read from',
      Object.keys(j).length > 0 && Object.keys(j).every(function (d) { return typeof j[d].from === 'string' && j[d].from; }));
}

/*
  One version per race. The old builder wrote every version under the plugin
  it was read from, with the same editor id each time: NordRace was
  13746:Skyrim.esm and 13746:Update.esm. Two lines with the same id and the
  same editor id are that and nothing else.
*/
{
  const seen = {};
  const twice = [];
  Object.keys(items).forEach(function (d) {
    const k = d.split(':')[0] + '|' + items[d].e;
    if (seen[k]) { twice.push(seen[k] + ' and ' + d); } else { seen[k] = d; }
  });
  yes('B2 no race is in the table twice under different plugins (' + twice.length + ')', twice.length === 0);
}

/*
  THE SERVER'S LOAD ORDER, as far as a descriptor cares: the five masters,
  then every other plugin the table names. FormDesc::ToFormId in the fork
  turns "13746:Skyrim.esm" into index * 0x01000000 + 0x13746 with an exact
  file match and throws on a file it does not have, and mp.getIdFromDesc is
  that, so this is that. The ids that matter here are Skyrim.esm's, which are
  the same in every load order.
*/
const LOAD = FIVE.slice();
Object.keys(items).forEach(function (d) {
  const f = d.slice(d.indexOf(':') + 1);
  if (LOAD.indexOf(f) === -1) { LOAD.push(f); }
});
function getIdFromDesc(desc) {
  const at = desc.indexOf(':');
  const file = desc.slice(at + 1);
  const idx = LOAD.indexOf(file);
  if (idx === -1) { throw new Error(file + ' not found in loaded files'); }
  return idx * 0x01000000 + parseInt(desc.slice(0, at), 16);
}

// The real idOf, raceOf, RACE_CALLED and raceGate, out of the gamemode.
function piece(re) { const m = re.exec(src); return m ? m[0] : null; }
const idOfSrc = piece(/^function idOf\(descriptor\) \{[^]*?^\}$/m);
const raceOfSrc = piece(/^function raceOf\(actorId\) \{[^]*?^\}$/m);
const calledSrc = piece(/^var RACE_CALLED = \{[^]*?^\};$/m);
const gateSrc = piece(/^function raceGate\(actorId, row\) \{[^]*?^\}$/m);
yes('B0 idOf, raceOf, RACE_CALLED and raceGate are in the gamemode',
    !!(idOfSrc && raceOfSrc && calledSrc && gateSrc));

function rig() {
  const look = {};
  const said = [];
  const Fake = {
    get: function (id, key) { return key === 'appearance' ? look[id] : undefined; },
    getIdFromDesc: getIdFromDesc
  };
  const fn = new Function('mp', 'RACES', 'log',
    idOfSrc + '\nvar raceIndex = null;\n' + raceOfSrc + '\n' + calledSrc + '\n' + gateSrc +
    '\nreturn { raceOf: raceOf, raceGate: raceGate };');
  const api = fn(Fake, RACES, function () { said.push([].slice.call(arguments).join(' ')); });
  let next = 0xff000100;
  api.as = function (raceId) { const me = next++; look[me] = { raceId: raceId }; return me; };
  api.said = said;
  return api;
}

if (RACES && idOfSrc && raceOfSrc && calledSrc && gateSrc) {
  /*
    WHAT THE GAME REPORTS. The appearance the client uploads carries raceId,
    the runtime form id of the race, and an override does not move a record,
    so each of these is the Skyrim.esm id whatever Update.esm, Dawnguard.esm
    or Dragonborn.esm did to it.
  */
  const TEN = [
    ['ArgonianRace', 0x13740], ['BretonRace', 0x13741], ['DarkElfRace', 0x13742],
    ['HighElfRace', 0x13743], ['ImperialRace', 0x13744], ['KhajiitRace', 0x13745],
    ['NordRace', 0x13746], ['OrcRace', 0x13747], ['RedguardRace', 0x13748],
    ['WoodElfRace', 0x13749]
  ];
  const r = rig();
  TEN.forEach(function (row) {
    const name = row[0], id = row[1];
    const local = id.toString(16);
    const lines = Object.keys(items).filter(function (d) { return d.split(':')[0] === local; });
    yes('B3 ' + name + ' is one line in the table (' + lines.join(', ') + ')',
        lines.length === 1 && lines[0] === local + ':Skyrim.esm');
    yes('B3 and the server reads ' + local + ' as ' + name.toLowerCase(),
        r.raceOf(r.as(id)) === name.toLowerCase());
  });

  // The entry's own example.
  {
    const lines = Object.keys(items).filter(function (d) { return d.split(':')[0] === '1052a3'; });
    yes('B4 UndeadDragonRace is one line, 1052a3:Skyrim.esm (' + lines.join(', ') + ')',
        lines.length === 1 && lines[0] === '1052a3:Skyrim.esm');
    yes('B4 races.json says the version kept is not Skyrim.esm\'s own (' +
        (json && json['1052a3:Skyrim.esm'] ? json['1052a3:Skyrim.esm'].from : 'none') + ')',
        !!json && !!json['1052a3:Skyrim.esm'] && typeof json['1052a3:Skyrim.esm'].from === 'string' &&
        json['1052a3:Skyrim.esm'].from !== 'Skyrim.esm');
    yes('B4 and the server reads 1052a3 as undeaddragonrace',
        r.raceOf(r.as(0x1052a3)) === 'undeaddragonrace');
  }

  /*
    WHAT NOTHING REPORTS. 13746:Update.esm resolved to 0x01013746 and
    1052a3:Dragonborn.esm to 0x041052a3, and the game never hands the server
    either: those are Skyrim.esm's races, and the game calls them by Skyrim.esm's
    id. Before 24 September both answered a race; a line that can only be
    reached by an id nobody reports is a line that is not there.
  */
  yes('B5 the id 13746:Update.esm used to resolve to answers nothing now',
      r.raceOf(r.as(0x01013746)) === '');
  yes('B5 nor the one 1052a3:Dragonborn.esm used to resolve to',
      r.raceOf(r.as(0x041052a3)) === '');
  {
    const line = r.said.filter(function (s) { return s.indexOf('races:') === 0; })[0] || '';
    yes('B5 every line in the table resolves in this load order (' + line + ')',
        line === 'races: ' + Object.keys(items).length + ' resolved in this load order');
  }

  /*
    THE GATE, END TO END, ON THE TABLE THAT SHIPS. Patrick, 23 September:
    "Riekling stuff should only be able to be made by a riekling".
  */
  {
    const rk = Object.keys(items).filter(function (d) { return items[d].p && /riekling/i.test(items[d].e); });
    yes('B6 a riekling is a playable race in the table (' + rk.join(', ') + ')', rk.length > 0);
    const nord = r.as(0x13746);
    const bosmer = r.as(0x13749);
    const riek = rk.length ? r.as(getIdFromDesc(rk[0])) : 0;
    const no = r.raceGate(nord, { race: 'riekling' });
    yes('B6 a Nord is refused riekling work, by name: "' + no + '"',
        no.indexOf('That is Riekling work') === 0);
    yes('B6 a riekling is not', !!riek && r.raceGate(riek, { race: 'riekling' }) === '');
    yes('B6 a Wood Elf may make Bosmer dress', r.raceGate(bosmer, { race: 'woodelf' }) === '');
    yes('B6 and a Nord may not, and is told Wood Elf rather than woodelf',
        r.raceGate(nord, { race: 'woodelf' }).indexOf('That is Wood Elf work') === 0);
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
