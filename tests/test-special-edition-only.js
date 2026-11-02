// test-special-edition-only.js
//
//     node tests\test-special-edition-only.js
//
// Issue #479, Patrick, 28 September: "Yes base only". Thornswood needs only
// Skyrim Special Edition. Nobody has to own the Anniversary upgrade (the
// Creation Club files, ccXXXSSE000-Name.esm and the rest), and somebody who
// owns it still plays. This holds that true, on a machine with no game at all:
//
//   1. The reader in scripts\mods\Check-CreationForms.js finds what it says it
//      finds, over plugins built here byte by byte: a Creation Club master, a
//      record pointing at one of Update.esm's Creation Club records (plain and
//      compressed), and not an override of one, not a reference the base game
//      already makes, not an ordinary record.
//   2. No plugin the server requires is a Creation Club file: the order table
//      of docs\COLLECTION-REVISION-2.md, which tests\test-collection-revision-2.ps1
//      holds to both servers' manifests, and every list of base game files the
//      installer, the launcher and the scripts carry.
//   3. No gamemode table hands out, spawns or sends anybody to Creation Club
//      content: no form key names a Creation Club file, and one of Update.esm's
//      Creation Club records (records\update-creation-club.json) appears only
//      in a table that describes a record. The table scripts skip the list.
//   4. The launcher does not stop an Anniversary owner over Creation Club
//      plugins switched on in their list (LoadOrder.NotInBuild in Verify.cs;
//      tests\test-load-order.ps1 drives the rule itself), and Thornswood's own
//      game folder still leaves Creation Club plugins out.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const REPO = path.join(__dirname, '..');
const C = require(path.join(REPO, 'scripts', 'mods', 'Check-CreationForms.js'));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function read(rel) {
  try { return fs.readFileSync(path.join(REPO, rel), 'utf8').replace(/\r/g, ''); } catch (e) { return ''; }
}

// ------------------------------------------------------ plugins built here --

function sub(type, data) {
  const h = Buffer.alloc(6);
  h.write(type, 0, 'latin1');
  h.writeUInt16LE(data.length, 4);
  return Buffer.concat([h, data]);
}
function zstr(s) { return Buffer.from(s + '\0', 'latin1'); }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }
function record(type, formId, subs, compressed) {
  let data = Buffer.concat(subs);
  let flags = 0;
  if (compressed) {
    data = Buffer.concat([u32(data.length), zlib.deflateSync(data)]);
    flags = 0x40000;
  }
  const h = Buffer.alloc(24);
  h.write(type, 0, 'latin1');
  h.writeUInt32LE(data.length, 4);
  h.writeUInt32LE(flags, 8);
  h.writeUInt32LE(formId >>> 0, 12);
  return Buffer.concat([h, data]);
}
function group(label, recs) {
  const body = Buffer.concat(recs);
  const h = Buffer.alloc(24);
  h.write('GRUP', 0, 'latin1');
  h.writeUInt32LE(body.length + 24, 4);
  h.write(label, 8, 'latin1');
  return Buffer.concat([h, body]);
}
function plugin(masters, groups, flags) {
  const subs = [sub('HEDR', Buffer.alloc(12))];
  for (const m of masters) { subs.push(sub('MAST', zstr(m))); subs.push(sub('DATA', Buffer.alloc(8))); }
  const head = record('TES4', 0, subs);
  head.writeUInt32LE(flags || 0, 8);
  return Buffer.concat([head].concat(groups));
}

// A small Update.esm: two Creation Club records of its own, one ordinary one,
// its override of Skyrim.esm's navmesh map naming a Creation Club door, as the
// real one does, and a Creation Club record of Skyrim.esm's it overrides,
// which is not its own and so not on the list.
const update = plugin(['Skyrim.esm'], [
  group('INGR', [record('INGR', 0x0100306e, [sub('EDID', zstr('ccBGS_RootScreamingMawIngredient'))])]),
  group('REFR', [record('REFR', 0x01003057, [sub('EDID', zstr('ccBGSSSE025_DungeonEntrance'))])]),
  group('MISC', [record('MISC', 0x01000800, [sub('EDID', zstr('SomethingOrdinary'))]),
                 record('MISC', 0x00012345, [sub('EDID', zstr('ccNotUpdatesOwn'))])]),
  group('NAVI', [record('NAVI', 0x00012fb4, [sub('EDID', zstr('')), sub('NVMI', Buffer.concat([u32(7), u32(0x01003057)]))])])
]);
const cc = C.creationRecords(update);
yes('Update.esm\'s own records with a cc editor id are the list', JSON.stringify(Object.keys(cc).sort()) === JSON.stringify(['3057', '306e']));
yes('...each with its editor id and type', cc['306e'] === 'ccBGS_RootScreamingMawIngredient INGR');
const base = C.baseReferences(update, cc);
yes('what Update.esm itself points at is the base game\'s part', base.has('12fb4:skyrim.esm|3057:update.esm'));

// A plugin with Skyrim.esm and Update.esm as masters (index 1 is Update.esm).
const mod = plugin(['Skyrim.esm', 'Update.esm'], [
  group('CONT', [record('CONT', 0x02000801, [sub('EDID', zstr('MyChest')), sub('CNTO', Buffer.concat([u32(0x0100306e), u32(1)]))])]),
  group('LVLI', [record('LVLI', 0x02000802, [sub('EDID', zstr('MyList')), sub('LVLO', Buffer.concat([u32(1), u32(0x01000800), u32(1)]))])]),
  group('COBJ', [record('COBJ', 0x02000803, [sub('EDID', zstr('MyRecipe')), sub('CNAM', u32(0x0100306e))], true)]),
  group('INGR', [record('INGR', 0x0100306e, [sub('EDID', zstr('ccBGS_RootScreamingMawIngredient')), sub('DATA', u32(0x01003057))])]),
  group('NAVI', [record('NAVI', 0x00012fb4, [sub('NVMI', Buffer.concat([u32(7), u32(0x01003057)]))])]),
  group('ALCH', [record('ALCH', 0x02000804, [sub('FULL', zstr('\u0001\u0001\u0001 text is not an id')), sub('DATA', Buffer.from([0x6e, 0x30, 0x00, 0x05]))])])
]);
const uses = C.pluginUses(mod, cc, base, 'Mine.esp');
const where = uses.refs.map(function (r) { return r.edid + '.' + r.field + '>' + r.target; }).sort();
yes('a container stocking one is found', where.indexOf('MyChest.CNTO>306e:Update.esm') >= 0);
yes('a compressed recipe making one is found', where.indexOf('MyRecipe.CNAM>306e:Update.esm') >= 0);
yes('an ordinary Update.esm record is not', where.filter(function (w) { return /MyList/.test(w); }).length === 0);
yes('an override of the Creation Club record itself is not', where.filter(function (w) { return /ccBGS_Root/.test(w); }).length === 0);
yes('a reference the base game already makes, carried whole, is not', where.filter(function (w) { return /NVMI/.test(w); }).length === 0);
yes('text, and a four byte value with another master\'s index, are not', uses.refs.every(function (r) { return r.record !== 'ALCH'; }));
yes('so exactly the two', uses.refs.length === 2);
yes('it declares no Creation Club master', uses.masters.length === 0);

const paid = plugin(['Skyrim.esm', 'Update.esm', 'ccBGSSSE001-Fish.esm'], []);
yes('a plugin declaring a Creation Club master is found', JSON.stringify(C.pluginUses(paid, cc, base, 'Paid.esp').masters) === '["ccBGSSSE001-Fish.esm"]');
const noUpdate = plugin(['Skyrim.esm'], [group('CONT', [record('CONT', 0x01000801, [sub('CNTO', Buffer.concat([u32(0x0100306e), u32(1)]))])])]);
yes('with no Update.esm master, index 1 is its own record, not Update.esm\'s', C.pluginUses(noUpdate, cc, base, 'Own.esp').refs.length === 0);
const updateFirst = plugin(['Update.esm'], [group('CONT', [record('CONT', 0x01000801, [sub('CNTO', Buffer.concat([u32(0x0000306e), u32(1)]))])])]);
yes('with Update.esm as master 0, index 0 is read as Update.esm', C.pluginUses(updateFirst, cc, base, 'First.esp').refs.length === 1);

// ------------------------------------------------ the names, three copies --

for (const n of ['ccBGSSSE001-Fish.esm', 'ccQDRSSE001-SurvivalMode.esl', 'CCASVSSE001-ALMSIVI.ESM', 'ccKRTSSE001_Altar.esl']) {
  yes(n + ' is a Creation Club plugin', C.isCreation(n));
}
for (const n of ['_ResourcePack.esl', 'Update.esm', 'ccCustomMod.esp', 'CC Hunting.esp', 'ccBGSSSE001-Fish.bsa']) {
  yes(n + ' is not', !C.isCreation(n));
}
{
  const js = /function isCreation[\s\S]*?\/(\^cc[^/]*)\/i/.exec(read('scripts/mods/Check-CreationForms.js'));
  const cs = /Regex\.IsMatch\(name\.Trim\(\), @"(\^cc[^"]*)"/.exec(read('launcher/app/LoadOrder.cs'));
  const ps = /function Test-LoadOrderCreation[\s\S]*?-match '(\^cc[^']*)'/.exec(read('scripts/mods/LoadOrder.ps1'));
  yes('the reader, the launcher and the publisher name Creation Club plugins by one pattern',
      !!js && !!cs && !!ps && js[1] === cs[1] && cs[1] === ps[1]);
}

// ------------------------------------------------- what the server requires --

{
  const doc = read('docs/COLLECTION-REVISION-2.md');
  const a = doc.indexOf('<!-- order:start -->');
  const b = doc.indexOf('<!-- order:end -->');
  const rows = a >= 0 && b > a ? doc.slice(a, b).split('\n').map(function (l) {
    const m = /^\|\s*\d+\s*\|\s*([^|]+?)\s*\|/.exec(l);
    return m ? m[1].replace(/`/g, '') : null;
  }).filter(Boolean) : [];
  yes('the server\'s order is on the page (' + rows.length + ' plugins)', rows.length >= 40);
  yes('...and none of them is a Creation Club file', rows.filter(C.isCreation).length === 0);
  yes('...and _ResourcePack.esl is not in it either: it is light and the base game\'s', rows.indexOf('_ResourcePack.esl') < 0);
}

// Every list of what the base game is: none may name a Creation Club file.
function listed(rel, re) {
  const m = re.exec(read(rel));
  return m ? (m[1].match(/'[^']+'|"[^"]+"/g) || []).map(function (s) { return s.slice(1, -1).replace(/^Data\\\\/, ''); }) : null;
}
const baseLists = [
  ['the launcher\'s masters (OwnGame)', 'launcher/app/OwnGame.cs', /static readonly string\[\] Masters = \{([^}]*)\}/],
  ['the launcher\'s load order masters', 'launcher/app/LoadOrder.cs', /public static readonly string\[\] Masters = \{([^}]*)\}/],
  ['the publisher\'s load order masters', 'scripts/mods/LoadOrder.ps1', /\$script:LoadOrderMasters = ([^\n]*)/],
  ['what Check-Editions counts as the base game', 'scripts/mods/Check-Editions.ps1', /\$freeBase = @\(([^)]*)\)/]
];
for (const l of baseLists) {
  const names = listed(l[1], l[2]);
  yes(l[0] + ' is found (' + (names ? names.length : 0) + ' names)', !!names && names.length >= 5);
  yes('...and names no Creation Club file', !!names && names.filter(C.isCreation).length === 0);
}

// The Windows install script says Special Edition, and the page people read before
// installing says the upgrade is not needed. Neither is rewritten here.
yes('the download page still says Anniversary Edition is not required', /Anniversary Edition is not required/.test(read('site/data/site/join.md')));

// --------------------------------------------------------------- the gamemode --

const listFile = read('records/update-creation-club.json');
let list = null;
try { list = JSON.parse(listFile); } catch (e) { list = null; }
yes('records\\update-creation-club.json is there and reads', !!list && !!list.records);
const records = list ? list.records : {};
yes('it lists Update.esm\'s Creation Club records (' + Object.keys(records).length + ')', Object.keys(records).length > 100 && list.count === Object.keys(records).length);
yes('...every one with a cc editor id', Object.keys(records).every(function (k) { return /^cc/i.test(records[k]); }));
yes('...including the three roots, their produce, the horse armor and the bone wolf',
    ['306a', '306b', '306c', '306d', '306e', '306f', '30c9', '30ca', '3025'].every(function (k) { return !!records[k]; }));

const every = C.gamemodeUses(records, null, true);
const handsOut = every.filter(function (h) { return !h.allowed; });
yes('no gamemode table hands out, spawns or sends anybody to Creation Club content', handsOut.length === 0);
for (const h of handsOut.slice(0, 20)) { console.log('      ' + h.file + ':' + h.line + ' ' + h.key + ' (' + h.why + ') in ' + h.table); }
yes('no form key anywhere names a Creation Club file', every.filter(function (h) { return h.why === 'a Creation Club file'; }).length === 0);
const allowedTables = {};
every.forEach(function (h) { if (h.allowed) { allowedTables[h.table] = (allowedTables[h.table] || 0) + 1; } });
yes('the mentions left are all in tables that only describe a record or list it as left out (' +
    Object.keys(allowedTables).sort().map(function (t) { return t + ' ' + allowedTables[t]; }).join(', ') + ')',
    Object.keys(allowedTables).every(function (t) { return C.DESCRIBE_ONLY.indexOf(t) >= 0 || /\.json$/.test(t); }));

{
  // The gamemode's tables are files of their own (#5191).
  const T = require('./gamemode-tables.js');
  const gm = read('game/gamemode.js');
  for (const k of ['306a', '306b', '306c', '306d', '306e', '306f', '30c9', '30ca', '3025']) {
    const re = new RegExp('"' + k + ':Update\\.esm"');
    for (const name of ['HARVESTS_BY_BASE', 'HUNTS_BY_BASE', 'ADMIN_ITEMS', 'ADMIN_ACTORS']) {
      const m = gm.indexOf("table('" + name + "')") >= 0 && fs.existsSync(T.file(name)) ? [fs.readFileSync(T.file(name), 'utf8')] : null;
      const b = [name];
      yes(b[0] + ' is in the gamemode and has no ' + k + ':Update.esm (' + records[k] + ')', !!m && !re.test(m[0]));
    }
  }
}

// The checker itself, over a pretend gamemode: a harvest row is refused, the
// same record in WARMTH is not, a Creation Club file anywhere is refused.
{
  const fake = { name: 'gamemode.js', text: [
    'const WARMTH = {"items":{"306e:Update.esm":{"m":"cloth"}}};',
    'var HARVESTS_BY_BASE = {',
    '  "306a:Update.esm": { "produce": "306e:Update.esm", "name": "Screaming Maw" },',
    '  "1:Skyrim.esm": { "produce": "2:ccBGSSSE001-Fish.esm" }',
    '};'
  ].join('\n') };
  const got = C.gamemodeUses(records, [fake], true);
  yes('the checker refuses a harvest row that hands one out', got.some(function (h) { return !h.allowed && h.table === 'HARVESTS_BY_BASE' && /306e/.test(h.key); }));
  yes('...allows the same record in WARMTH, which only describes it', got.some(function (h) { return h.allowed && h.table === 'WARMTH'; }));
  yes('...and refuses a Creation Club file wherever it is', got.some(function (h) { return !h.allowed && h.why === 'a Creation Club file'; }));
  const json = { name: 'harvests.json', text: [
    '{',
    '  "harvests": {',
    '    "306a:Update.esm": { "produce": "306e:Update.esm" }',
    '  },',
    '  "unranked": {',
    '    "306b:Update.esm": { "why": "a Creation Club record" }',
    '  }',
    '}'
  ].join('\n') };
  const inJson = C.gamemodeUses(records, [json], true);
  yes('in harvests.json a row of the table is refused, and the left out list may name one',
      inJson.some(function (h) { return !h.allowed && /306a/.test(h.key); }) && inJson.some(function (h) { return h.allowed && /306b/.test(h.key); }));
  // npc-population.json is one line, so it is read row by row (#479, #1413).
  const population = { name: 'npc-population.json', text: JSON.stringify({
    npcs: [
      { role: 'cut', keep: false, reason: 'Deleted or initially switched off', ref: '3027:Update.esm', base: '3025:Update.esm' },
      { role: 'animal', keep: true, ref: '1:Skyrim.esm', base: '30c9:Update.esm' },
      { role: 'cut', keep: false, ref: '2:Skyrim.esm', base: '3:ccBGSSSE001-Fish.esm' }
    ],
    locations: [{ refs: ['3025:Update.esm'] }]
  }) };
  const inPopulation = C.gamemodeUses(records, [population], true);
  yes('in npc-population.json a row left out (keep false) may name one',
      inPopulation.some(function (h) { return h.allowed && /3025/.test(h.key); }));
  yes('...a kept row may not',
      inPopulation.some(function (h) { return !h.allowed && /30c9/.test(h.key); }));
  yes('...nor anything outside the rows',
      inPopulation.filter(function (h) { return !h.allowed && /3025/.test(h.key); }).length === 1);
  yes('...and a Creation Club file is refused even in a row left out',
      inPopulation.some(function (h) { return !h.allowed && h.why === 'a Creation Club file'; }));
  // last-plugin.json lists the quests Thornswood-Last.esp stops (#2468).
  const last = { name: 'last-plugin.json', text: JSON.stringify({
    quests: { stopped: [{ quest: '306a:Update.esm', edid: 'ccSomething' }],
              kept: [{ quest: '306b:Update.esm', edid: 'ccOther' }] },
    arrivalTalk: [{ quest: '306c:Update.esm' }]
  }) };
  const inLast = C.gamemodeUses(records, [last], true);
  yes('in last-plugin.json a stopped quest may name one',
      inLast.some(function (h) { return h.allowed && /306a/.test(h.key); }));
  yes('...a kept quest may not, nor the arrival talk',
      inLast.some(function (h) { return !h.allowed && /306b/.test(h.key); }) &&
      inLast.some(function (h) { return !h.allowed && /306c/.test(h.key); }));
}

// The twenty bone wolf rows are what keeps those refs out of the world: each is
// a cut row, and Thornswood-Last.esp keeps every cut ref out (#2468): each is
// switched off there, or already deleted or off in the plugins.
{
  let pop = null;
  try { pop = JSON.parse(read('game/data/npc-population.json').replace(/^\uFEFF/, '')); } catch (e) { pop = null; }
  const wolves = pop ? pop.npcs.filter(function (r) { return r.base === '3025:Update.esm'; }) : [];
  yes('npc-population.json reads, and every row with the bone wolf as its base is left out (' + wolves.length + ')',
      !!pop && wolves.length > 0 && wolves.every(function (r) { return r.keep === false && r.role === 'cut'; }));
  let last = null;
  try { last = JSON.parse(read('game/data/last-plugin.json').replace(/^\uFEFF/, '')); } catch (e) { last = null; }
  const off = last ? [].concat(last.refs.disabled, last.refs.deleted, last.refs.alreadyOff) : [];
  yes('...and every one of their refs is kept out by Thornswood-Last.esp: switched off there, or already deleted or off',
      !!last && wolves.every(function (r) { return off.indexOf(r.ref) >= 0; }));
}

// The table scripts skip the list, so running one again cannot bring a row back.
for (const s of ['scripts/dev/Build-HarvestTable.ps1', 'scripts/dev/Build-HuntTable.ps1', 'scripts/dev/Build-AdminNameTables.py']) {
  yes(s + ' reads records\\update-creation-club.json and skips what it names', /update-creation-club\.json/.test(read(s)) && /creation/.test(read(s)));
}

// ------------------------------------------------------------- the launcher --

{
  const verify = read('launcher/app/Verify.cs');
  // Since #2627 a plugin the server hands out, which is ours, is passed
  // over too, and each issue carries what Fix does about it.
  const loop = 'foreach (string p in LoadOrder.NotInBuild(have, want, LightOrMissing))\n' +
               '            {\n' +
               '                if (ServedByServer(cfg, p)) continue;\n' +
               '                issues.Add(Issue.Of(IssueKind.Plugins, p + " is enabled but is not part of this build.",';
  yes('Verify.cs asks LoadOrder.NotInBuild what is "not part of this build", so switched on Creation Club plugins that take no place do not stop Play',
      verify.indexOf(loop) >= 0);
  yes('...and nothing else in it says so', (verify.match(/is enabled but is not part of this build/g) || []).length === 1);
  const own = read('launcher/app/OwnGame.cs');
  yes('Thornswood\'s own game folder still leaves out every Creation Club plugin the reference list does not name',
      own.indexOf('if (!Regex.IsMatch(rel, @"^Data\\\\cc[^\\\\]*\\.(esm|esl|esp)$", RegexOptions.IgnoreCase)) return false;') >= 0 &&
      own.indexOf('return !wantedPlugins.Contains(rel.Substring("Data\\\\".Length));') >= 0);
  const clean = read('scripts/mods/Check-CleanInstall.ps1');
  yes('the clean install check does not count Creation Club plugins either', /Test-LoadOrderCreation \$n\) -or \(Test-LoadOrderLight/.test(clean));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
