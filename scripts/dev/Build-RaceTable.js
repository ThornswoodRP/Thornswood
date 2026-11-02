// Build-RaceTable.js
//
// Builds game\data\races.json and installs it into gamemode.js: every RACE record
// in the load order, by descriptor, with the name the record calls itself.
//
// WHY THERE IS ANYTHING TO BUILD
//
// Patrick, 23 September: "Riekling stuff should only be able to be made by a
// riekling", and then "We already agreed on the race gate for race based items
// so if there is anything by another race aswell it should be race locked".
//
// The server CAN see somebody's race: it is raceId on the appearance the
// client uploads, which is a runtime form id. A recipe row says which race it
// belongs to as a WORD, because a word survives a load order moving and a
// runtime id does not. This table is the join between the two, and it is the
// only thing that can make one: nothing else in the gamemode has ever read a
// race for any purpose.
//
// ONE LINE PER RACE, UNDER THE PLUGIN THAT MADE IT, WORTH WHAT THE LAST
// PLUGIN SAYS. Found on 24 September by the ale fix (#322), which had the same
// fault in Build-FoodTable.js. This used to key every version of a record by
// the plugin it was read out of, so UndeadDragonRace was three lines,
// 1052a3:Skyrim.esm, 1052a3:Update.esm and 1052a3:Dragonborn.esm. An override
// keeps the form id of the plugin that first made the record, so the game
// reports that race as 1052a3 of Skyrim.esm, and the server read Skyrim.esm's
// version of it rather than the one the game uses. The other two lines
// resolved to ids nothing ever reports. So a record's high byte is read
// through the plugin's own MAST list, the way Build-FoodTable.js and
// Build-FireTable.js do it, and the version kept is the last one in the load
// order. races.json rows say which plugin's version they were read from.
//
// Measured on this build on 24 September: 258 versions are 215 races. 32 of
// them are overridden, every one by Update.esm, Dawnguard.esm or
// Dragonborn.esm, and none of those overrides changes the editor id or the
// playable bit, so no race the game reports answers differently. What went is
// 43 lines nobody could reach. It matters the day a plugin in the order
// changes a race.
//
// Read only. It opens the plugins of the build, writes game\data\races.json, and
// replaces one generated line in game\gamemode.js.
//
// Usage:
//   node scripts\dev\Build-RaceTable.js
//   node scripts\dev\Build-RaceTable.js --print
//   node scripts\dev\Build-RaceTable.js --plugins "C:\path\to\plugins.txt"
const fs = require('fs');
const path = require('path');
const { pluginPath, loadedOrder } = require('./OwnPlugins.js');
const TABLES = require('./GamemodeTables.js');
const zlib = require('zlib');

const args = process.argv.slice(2);
function opt(name, def) {
  const at = args.indexOf('--' + name);
  return at >= 0 && args[at + 1] ? args[at + 1] : def;
}
const PRINT = args.indexOf('--print') !== -1;
const DATA = opt('data', 'C:\\Thornswood\\Game\\Data');
const OUT = opt('out', path.join(__dirname, '..', '..', 'game', 'data', 'races.json'));
const PLUGINS_TXT = opt('plugins', '');

/* The plugin list the load order is read from (OwnPlugins.js loadedOrder). */
function pluginsTxt() {
  // --plugins <file>, same flag as Build-WarmthTable.js / Build-WaterTable.js /
  // Build-FireTable.js / Build-WeatherTable.js. Empty means today's default:
  // Profile\\Default next to Data, then %LOCALAPPDATA%\\Skyrim Special Edition.
  if (PLUGINS_TXT) { return PLUGINS_TXT; }
  const candidates = [
    path.join(DATA, '..', '..', 'Profile', 'Default', 'plugins.txt'),
    path.join(process.env.LOCALAPPDATA || '', 'Skyrim Special Edition', 'plugins.txt')
  ];
  return candidates.filter((f) => fs.existsSync(f))[0] || candidates[0];
}

/*
  WHETHER A RACE IS PLAYABLE, AND THE OFFSET WAS MEASURED RATHER THAN LOOKED UP.

  Patrick, 23 September, reading a list of race words: "Falmer, Dremora,
  Draugr are not playable races so they can be by anuone only playable races
  should be race locked".

  So the question is on the record. RACE carries a DATA subrecord and the
  playable bit is in it, and rather than trust a wiki this was found by
  testing every four byte offset in DATA against ten races everybody knows
  are playable and five everybody knows are not. Two offsets separate them,
  32 and 84, and 32 is the one the documented layout calls flags. At 32,
  NordRace and BretonRace carry bit 0 and FalmerRace, DremoraRace and
  DraugrRace do not.

  WHAT IT ANSWERS ON THIS BUILD: 215 races, twelve playable. The ten vanilla
  ones, and 1RieklingBlueRace and 1RieklingPurpleRace out of Playable
  Rieklings.esp, which is why riekling gear can be locked to rieklings at all.
*/
const PLAYABLE_AT = 32;
const PLAYABLE_BIT = 1;

/*
  A LOCALISED PLUGIN DOES NOT HOLD ITS NAMES.

  Skyrim.esm and the four other masters are localised: their FULL subrecord is
  a four byte number pointing into a strings file, not the name. Reading it as
  text put mojibake in races.json for every vanilla race, 'NordRace' coming
  out beside a name of one stray character. Nothing broke, because the editor
  id is what everything compares against and the name is only ever there so a
  person can answer 'why did this count as a riekling', but that is the one
  job the field has and it was not doing it.

  The bit is 0x80 in the TES4 header flags. When it is set the name is left
  empty rather than filled with the number, because an empty name reads as
  missing and a number reads as a name.
*/
const LOCALISED = 0x80;

/*
  The masters a plugin declares, in order. A record's high byte is an index
  into this list, and anything past the end is the plugin's own. The same
  reading as Build-FireTable.js and Build-FoodTable.js.
*/
function mastersOf(b) {
  const out = [];
  let k = 24;
  const end = 24 + b.readUInt32LE(4);
  while (k + 6 <= end) {
    const sub = b.toString('ascii', k, k + 4);
    const sz = b.readUInt16LE(k + 4);
    k += 6;
    if (sub === 'MAST' && sz > 1) { out.push(b.toString('latin1', k, k + sz - 1)); }
    k += sz;
  }
  return out;
}

/*
  A master named the way the load order names it. The server turns a
  descriptor into a form id by looking the file up in its own list with an
  exact match (FormDesc::ToFormId in the fork), so a plugin that happens to
  write "skyrim.esm" in its MAST must not put a line in the table the server
  cannot find.
*/
function asLoaded(name, order) {
  const low = name.toLowerCase();
  for (const n of order) {
    if (n.toLowerCase() === low) { return n; }
  }
  return name;
}

function subrecords(rec, localised) {
  const got = { EDID: '', FULL: '', playable: false };
  let k = 0, over = 0;
  while (k + 6 <= rec.length) {
    const sub = rec.toString('ascii', k, k + 4);
    let sz = rec.readUInt16LE(k + 4);
    k += 6;
    if (over > 0) { sz = over; over = 0; }
    if (sub === 'XXXX') { over = rec.readUInt32LE(k); k += sz; continue; }
    if (sub === 'EDID' && sz > 1 && k + sz <= rec.length) {
      got.EDID = rec.toString('latin1', k, k + sz - 1);
    }
    if (sub === 'FULL' && sz > 1 && k + sz <= rec.length && !localised) {
      got.FULL = rec.toString('latin1', k, k + sz - 1);
    }
    if (sub === 'DATA' && k + sz <= rec.length && sz >= PLAYABLE_AT + 4) {
      got.playable = !!(rec.readUInt32LE(k + PLAYABLE_AT) & PLAYABLE_BIT);
    }
    k += sz;
  }
  return got;
}

const rows = {};
// Which plugin the walk is inside, and what it declares as its masters.
const here = { file: '', localised: false, masters: [], order: [] };
let scanned = 0;

/*
  Which record this is: the plugin that made it and the id within that
  plugin. An index inside the master list means the record belongs to that
  master and this plugin is only changing it. See ONE LINE PER RACE.
*/
function ownerOf(formId) {
  const idx = (formId >>> 24) & 0xff;
  const local = formId & 0x00ffffff;
  const file = idx < here.masters.length ? asLoaded(here.masters[idx], here.order) : here.file;
  return local.toString(16) + ':' + file;
}

function walk(b, start, end) {
  let j = start;
  while (j + 24 <= end) {
    const type = b.toString('ascii', j, j + 4);
    const dataSize = b.readUInt32LE(j + 4);
    if (type === 'GRUP') {
      if (dataSize < 24) { return; }
      walk(b, j + 24, j + dataSize);
      j += dataSize;
      continue;
    }
    const flags = b.readUInt32LE(j + 8);
    const formId = b.readUInt32LE(j + 12);
    if (type === 'RACE') {
      scanned++;
      let rec = null;
      try {
        rec = b.slice(j + 24, j + 24 + dataSize);
        if (flags & 0x00040000) { rec = zlib.inflateSync(rec.slice(4)); }
      } catch (e) { rec = null; }
      if (rec) {
        const s = subrecords(rec, here.localised);
        // Every version of a record has the same key, and the plugins are
        // walked in load order, so the one left standing is the last one,
        // which is the one the game uses. from names it.
        const desc = ownerOf(formId);
        rows[desc] = { e: s.EDID, n: s.FULL || s.EDID, p: s.playable, from: here.file };
      }
    }
    j += 24 + dataSize;
  }
}

const order = loadedOrder(pluginsTxt(), DATA);
here.order = order;
for (const file of order) {
  const full = pluginPath(DATA, file);
  here.file = file;
  let buf = null;
  try { buf = fs.readFileSync(full); } catch (e) { continue; }
  // See LOCALISED. Read off the plugin's own header, not off a list of names.
  here.localised = false;
  try {
    if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'TES4') {
      here.localised = !!(buf.readUInt32LE(8) & LOCALISED);
    }
  } catch (e) { here.localised = false; }
  // See ONE LINE PER RACE.
  here.masters = [];
  try {
    if (buf.length > 24 && buf.toString('ascii', 0, 4) === 'TES4') { here.masters = mastersOf(buf); }
  } catch (e) { here.masters = []; }
  try { walk(buf, 0, buf.length); } catch (e) {
    console.error('FAIL  ' + file + ' would not parse: ' + e.message);
    process.exitCode = 1;
  }
}

console.log(order.length + ' plugins in the order');
const playableRows = Object.keys(rows).filter((d) => rows[d].p);
console.log(scanned + ' RACE records read, ' + Object.keys(rows).length + ' kept, ' +
            playableRows.length + ' of them playable');
playableRows.sort().forEach((d) => { console.log('  playable  ' + rows[d].e); });

if (PRINT) {
  Object.keys(rows).sort().forEach((d) => {
    console.log('  ' + d.padEnd(28) + (rows[d].e || '').padEnd(30) + (rows[d].n || ''));
  });
}

/*
  INSTALLED INTO gamemode.js, thinner than the json.

  races.json keeps the editor id, the display name and the plugin whose
  version was kept, because "why did this count as a riekling" has to be
  answerable. The server compares words, so the line that goes in carries the
  editor id alone.
*/
function install() {
  const thin = {};
  Object.keys(rows).sort().forEach((d) => {
    thin[d] = { e: rows[d].e || rows[d].n, p: !!rows[d].p };
  });
  const changed = TABLES.write('RACES', { items: thin });
  console.log((changed ? 'wrote ' : 'already current: ') + Object.keys(thin).length + ' races' + ' in game\\gamemode-tables\\RACES.json');
}

if (!Object.keys(rows).length) {
  console.error('FAIL  no races came out, so nothing is written');
  process.exitCode = 1;
} else if (!process.exitCode) {
  install();
  fs.writeFileSync(OUT, JSON.stringify({
    builtBy: 'scripts\\dev\\Build-RaceTable.js',
    builtAt: new Date().toISOString(),
    source: 'the RACE records of the plugins in load order',
    note: 'which recipes a race owns is in game\\data\\recipes.json; this only says what the races are',
    count: Object.keys(rows).length,
    items: rows
  }, null, 1));
  console.log('wrote ' + OUT);
}
