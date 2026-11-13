// Build-ItemStats.js
//
// Builds game\data\item-stats.json: for every item game\data\item-sources.json
// names, what the records say it is. Its record type and weight for all of
// them; the armour rating, armour type, body slots and keywords of armour;
// the damage, weapon type, speed, reach and keywords of a weapon; the damage
// of ammunition.
//
// WHY. Issue #4558. What people craft is weighed against race crafts, the
// Free Skyrim Trading Company's goods, and faction and quest items of the
// same kind, and Patrick decided on 22 Oct that balance is what a thing takes
// to make or get plus its stats, never gold. What a thing takes is in
// recipes.json and item-sources.json. Its stats were in no table: the server
// reads them off the records at run time (skill-perks.ts reads DNAM for the
// armour cap), so a written comparison had nothing to read. This reads them
// off the records, never typed.
//
// HOW A RECORD IS READ. The same walk as Build-IngredientTable.js: every
// plugin of the load order (OwnPlugins.js), compressed records inflated, a
// record's high byte read through the plugin's own MAST list so an override
// keeps the form id of the plugin that made it, and the last plugin in the
// load order wins. Keywords are written by their KYWD editor id. A keyword no
// plugin defines stays its desc and is counted, so a gap is seen.
//
// The fields, Skyrim Special Edition's:
//   ARMO  DNAM  int32 armour rating times 100
//         DATA  int32 value, float weight
//         BOD2  uint32 body slots, uint32 armour type (0 light, 1 heavy,
//               2 clothing); BODT carries the type at byte 8 when it is 12
//   WEAP  DATA  uint32 value, float weight, uint16 damage
//         DNAM  byte weapon type, then float speed at 4 and float reach at 8
//   AMMO  DATA  projectile, flags, float damage, value, float weight (SE)
//   ALCH  DATA  float weight
//   BOOK  DATA  the weight is the float at byte 12
//   other DATA  uint32 value, float weight (MISC, INGR, SLGM, KEYM)
// Value is not written: balance is never judged by gold.
//
// UPDATE.ESM'S CREATION CLUB RECORDS ARE LEFT OUT, as Build-IngredientTable.js
// says why (#479).
//
// Read only. It opens the plugins of the build and writes
// game\data\item-stats.json.
//
// Usage:
//   node scripts\dev\Build-ItemStats.js
//   node scripts\dev\Build-ItemStats.js --data "C:\Thornswood\Game\Data" --plugins "C:\path\to\plugins.txt"
//   node scripts\dev\Build-ItemStats.js --sources <item-sources.json> --out <file>
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pluginPath, loadedOrder } = require('./OwnPlugins.js');

const args = process.argv.slice(2);
function opt(name, def) {
  const at = args.indexOf('--' + name);
  return at >= 0 && args[at + 1] ? args[at + 1] : def;
}
const ROOT = path.join(__dirname, '..', '..');
const DATA = opt('data', 'C:\\Thornswood\\Game\\Data');
const OUT = opt('out', path.join(ROOT, 'game', 'data', 'item-stats.json'));
const SOURCES = opt('sources', path.join(ROOT, 'game', 'data', 'item-sources.json'));
const PLUGINS_TXT = opt('plugins', '');

const CREATION = {};
for (const local of Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'records', 'update-creation-club.json'), 'utf8')).records)) {
  CREATION[local.toLowerCase() + ':Update.esm'] = true;
}

// The items to read: every row of the item source table, by desc.
const WANTED = {};
for (const d of Object.keys(JSON.parse(fs.readFileSync(SOURCES, 'utf8')).items)) { WANTED[d.toLowerCase()] = d; }

// The plugin list, the same default as Build-IngredientTable.js.
function pluginsTxt() {
  if (PLUGINS_TXT) { return PLUGINS_TXT; }
  const candidates = [
    path.join(DATA, '..', '..', 'Profile', 'Default', 'plugins.txt'),
    path.join(process.env.LOCALAPPDATA || '', 'Skyrim Special Edition', 'plugins.txt')
  ];
  return candidates.filter((f) => fs.existsSync(f))[0] || candidates[0];
}

const ITEM_TYPES = ['ARMO', 'WEAP', 'AMMO', 'ALCH', 'BOOK', 'MISC', 'INGR', 'SLGM', 'KEYM'];
const ARMOUR_TYPES = ['light', 'heavy', 'clothing'];
const WEAPON_TYPES = ['hand to hand', 'one-handed sword', 'dagger', 'war axe', 'mace', 'greatsword',
                      'battleaxe or warhammer', 'bow', 'staff', 'crossbow'];

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

function asLoaded(name, order) {
  const low = name.toLowerCase();
  for (const n of order) { if (n.toLowerCase() === low) { return n; } }
  return name;
}

const here = { file: '', masters: [], order: [] };
function descOf(formId) {
  const idx = (formId >>> 24) & 0xff;
  const local = (formId & 0x00ffffff).toString(16);
  const file = idx < here.masters.length ? asLoaded(here.masters[idx], here.order) : here.file;
  return local + ':' + file;
}

function round(n) { return Math.round(n * 100) / 100; }

// What one item record says, by its type.
function itemOf(type, rec) {
  const got = { type: type, edid: '', weight: null };
  const keywords = [];
  let k = 0, over = 0;
  while (k + 6 <= rec.length) {
    const sub = rec.toString('ascii', k, k + 4);
    let sz = rec.readUInt16LE(k + 4);
    k += 6;
    if (over > 0) { sz = over; over = 0; }
    if (sub === 'XXXX') { over = rec.readUInt32LE(k); k += sz; continue; }
    if (k + sz > rec.length) { break; }
    if (sub === 'EDID' && sz > 1) { got.edid = rec.toString('latin1', k, k + sz - 1); }
    if (sub === 'KWDA') { for (let q = 0; q + 4 <= sz; q += 4) { keywords.push(descOf(rec.readUInt32LE(k + q))); } }
    if (type === 'ARMO') {
      if (sub === 'DNAM' && sz >= 4) { got.rating = round(rec.readInt32LE(k) / 100); }
      if (sub === 'DATA' && sz >= 8) { got.weight = round(rec.readFloatLE(k + 4)); }
      if (sub === 'BOD2' && sz >= 8) { got.slots = rec.readUInt32LE(k); got.armourType = ARMOUR_TYPES[rec.readUInt32LE(k + 4)] || String(rec.readUInt32LE(k + 4)); }
      if (sub === 'BODT' && sz >= 12 && got.armourType === undefined) { got.slots = rec.readUInt32LE(k); got.armourType = ARMOUR_TYPES[rec.readUInt32LE(k + 8)] || String(rec.readUInt32LE(k + 8)); }
    } else if (type === 'WEAP') {
      if (sub === 'DATA' && sz >= 10) { got.weight = round(rec.readFloatLE(k + 4)); got.damage = rec.readUInt16LE(k + 8); }
      if (sub === 'DNAM' && sz >= 12) {
        got.weaponType = WEAPON_TYPES[rec.readUInt8(k)] || String(rec.readUInt8(k));
        got.speed = round(rec.readFloatLE(k + 4));
        got.reach = round(rec.readFloatLE(k + 8));
      }
    } else if (type === 'AMMO') {
      if (sub === 'DATA' && sz >= 12) { got.damage = round(rec.readFloatLE(k + 8)); }
      if (sub === 'DATA' && sz >= 20) { got.weight = round(rec.readFloatLE(k + 16)); }
    } else if (type === 'ALCH') {
      if (sub === 'DATA' && sz >= 4) { got.weight = round(rec.readFloatLE(k)); }
    } else if (type === 'BOOK') {
      if (sub === 'DATA' && sz >= 16) { got.weight = round(rec.readFloatLE(k + 12)); }
    } else if (sub === 'DATA' && sz >= 8) {
      got.weight = round(rec.readFloatLE(k + 4));
    }
    k += sz;
  }
  if (type === 'ARMO' || type === 'WEAP') { got.keywords = keywords; }
  return got;
}

const keywordName = {}; // KYWD desc -> editor id, last plugin wins
const items = {};       // desc -> what its winning record says
let read = 0;
let creation = 0;

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
    if (type === 'KYWD' || ITEM_TYPES.indexOf(type) >= 0) {
      const flags = b.readUInt32LE(j + 8);
      const formId = b.readUInt32LE(j + 12);
      let rec = b.slice(j + 24, j + 24 + dataSize);
      if (flags & 0x00040000) { rec = zlib.inflateSync(rec.slice(4)); }
      const desc = descOf(formId);
      if (type === 'KYWD') {
        keywordName[desc] = itemOf(type, rec).edid;
      } else if (CREATION[desc]) {
        creation++;
      } else if (WANTED[desc.toLowerCase()]) {
        read++;
        const it = itemOf(type, rec);
        it.from = here.file;
        items[WANTED[desc.toLowerCase()]] = it;
      }
    }
    j += 24 + dataSize;
  }
}

const order = loadedOrder(pluginsTxt(), DATA);
here.order = order;
for (const file of order) {
  let buf = null;
  try { buf = fs.readFileSync(pluginPath(DATA, file)); } catch (e) { continue; }
  here.file = file;
  here.masters = buf.length > 24 && buf.toString('ascii', 0, 4) === 'TES4' ? mastersOf(buf) : [];
  try { walk(buf, 0, buf.length); } catch (e) {
    console.error('FAIL  ' + file + ' would not parse: ' + e.message);
    process.exitCode = 1;
  }
}

let unnamed = 0;
const out = {};
for (const d of Object.keys(items).sort()) {
  const it = items[d];
  if (it.keywords) { it.keywords = it.keywords.map((kd) => { if (keywordName[kd]) { return keywordName[kd]; } unnamed++; return kd; }); }
  out[d] = it;
}
const missing = Object.values(WANTED).filter((d) => !out[d]).sort();

console.log(order.length + ' plugins in the order, ' + read + ' item records read, ' +
            creation + ' of them Update.esm\'s Creation Club records, left out');
console.log(Object.keys(out).length + ' of ' + Object.keys(WANTED).length + ' items found, ' +
            unnamed + ' keyword(s) no plugin names');

if (!Object.keys(out).length) {
  console.error('FAIL  no item came out, so nothing is written');
  process.exitCode = 1;
} else if (!process.exitCode) {
  fs.writeFileSync(OUT, JSON.stringify({
    builtBy: 'scripts/dev/Build-ItemStats.js',
    source: 'the item records of the plugins in load order, for every item game/data/item-sources.json names (#4558)',
    readFrom: 'ARMO DNAM, DATA and BOD2; WEAP DATA and DNAM; AMMO DATA; the weight in each type\'s DATA; KWDA by its KYWD editor id',
    note: 'no value is kept: balance is what a thing takes to make or get plus its stats, never gold (22 Oct)',
    notFound: missing,
    items: out
  }, null, 1) + '\n');
  console.log('wrote ' + OUT);
}
