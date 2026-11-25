// Build-IngredientTable.js
//
// Builds game\data\ingredients.json: every ingredient (INGR) in the load order
// and the alchemy effects it carries, and every potion and poison (an ALCH
// without the food flag) and the effects it carries, each effect named by its
// magic effect's editor id (AlchRestoreHealth and the like).
//
// WHY. Issue #3470. Patrick, 26 Oct 2026, A+B on the report page: the dungeon
// pile pays ingredients instead of Skyrim's ten potion records (A), and the
// Physicker gets a bench recipe for each of those ten records (B). A recipe
// for a potion has to ask for ingredients that really carry its effect, and
// docs\systems\professions\alchemist.md says it plainly: "This repo does not
// have a table of which ingredient carries which effect". Which plant carries
// which effect is the game's own list (docs\systems\mixtures.md), so it is
// read off the records, never typed.
//
// HOW A RECORD IS READ. The same walk as Build-FoodTable.js: every plugin of
// the load order (OwnPlugins.js), compressed records inflated, a record's
// high byte read through the plugin's own MAST list so an override keeps the
// form id of the plugin that made it, and the last plugin in the load order
// wins. An effect is an EFID (the magic effect's form id) followed by its
// EFIT; only the EFIDs are kept, in record order, because what a batch can
// make is which effects two ingredients share, not how strong each is.
// Names come from EDID: FULL in a localized master is a number into a
// strings file, and food.json shows what reading it as text gives.
//
// UPDATE.ESM'S CREATION CLUB RECORDS ARE LEFT OUT. Update.esm holds records
// whose editor id starts with cc (three Creation Club roots among the
// ingredients), whose meshes and scripts come only with the Creation Club
// files, which Thornswood leaves out (#479). records\update-creation-club.json
// lists them and tests\test-special-edition-only.js holds every gamemode
// table to that list, so this skips them the way Build-HarvestTable.ps1 and
// Build-HuntTable.ps1 do: no recipe may ask for one.
//
// Read only. It opens the plugins of the build and writes
// game\data\ingredients.json.
//
// Usage:
//   node scripts\dev\Build-IngredientTable.js
//   node scripts\dev\Build-IngredientTable.js --data "C:\Thornswood\Game\Data" --plugins "C:\path\to\plugins.txt"
//   node scripts\dev\Build-IngredientTable.js --out <file>
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pluginPath, loadedOrder } = require('./OwnPlugins.js');

const args = process.argv.slice(2);
function opt(name, def) {
  const at = args.indexOf('--' + name);
  return at >= 0 && args[at + 1] ? args[at + 1] : def;
}
const DATA = opt('data', 'C:\\Thornswood\\Game\\Data');
const OUT = opt('out', path.join(__dirname, '..', '..', 'game', 'data', 'ingredients.json'));
const PLUGINS_TXT = opt('plugins', '');

const CREATION = {};
for (const local of Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'records', 'update-creation-club.json'), 'utf8')).records)) {
  CREATION[local.toLowerCase() + ':Update.esm'] = true;
}

// The plugin list, the same default as Build-FoodTable.js.
function pluginsTxt() {
  if (PLUGINS_TXT) { return PLUGINS_TXT; }
  const candidates = [
    path.join(DATA, '..', '..', 'Profile', 'Default', 'plugins.txt'),
    path.join(process.env.LOCALAPPDATA || '', 'Skyrim Special Edition', 'plugins.txt')
  ];
  return candidates.filter((f) => fs.existsSync(f))[0] || candidates[0];
}

const FOOD_FLAG = 0x00000002;   // ENIT on an ALCH: a food item
const POISON_FLAG = 0x00020000; // ENIT on an ALCH: a poison

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

// A master named the way the load order names it (Build-FoodTable.js says why).
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

function subrecords(rec) {
  const got = { EDID: '', flags: 0, effects: [] };
  let k = 0, over = 0;
  while (k + 6 <= rec.length) {
    const sub = rec.toString('ascii', k, k + 4);
    let sz = rec.readUInt16LE(k + 4);
    k += 6;
    if (over > 0) { sz = over; over = 0; }
    if (sub === 'XXXX') { over = rec.readUInt32LE(k); k += sz; continue; }
    if (k + sz > rec.length) { break; }
    if (sub === 'EDID' && sz > 1) { got.EDID = rec.toString('latin1', k, k + sz - 1); }
    if (sub === 'ENIT' && sz >= 8) { got.flags = rec.readUInt32LE(k + 4); }
    if (sub === 'EFID' && sz >= 4) { got.effects.push(descOf(rec.readUInt32LE(k))); }
    k += sz;
  }
  return got;
}

const mgef = {};        // magic effect desc -> editor id, last plugin wins
const ingredients = {}; // desc -> { edid, from, effects: [effect desc] }
const potions = {};     // desc -> { edid, from, kind, effects: [effect desc] }
let read = 0;
let creation = 0;   // Update.esm's Creation Club records, left out

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
    if (type === 'INGR' || type === 'ALCH' || type === 'MGEF') {
      const flags = b.readUInt32LE(j + 8);
      const formId = b.readUInt32LE(j + 12);
      let rec = b.slice(j + 24, j + 24 + dataSize);
      if (flags & 0x00040000) { rec = zlib.inflateSync(rec.slice(4)); }
      const s = subrecords(rec);
      const desc = descOf(formId);
      read++;
      if (CREATION[desc] && type !== 'MGEF') {
        creation++;
      } else if (type === 'MGEF') {
        mgef[desc] = s.EDID;
      } else if (type === 'INGR') {
        ingredients[desc] = { edid: s.EDID, from: here.file, effects: s.effects };
      } else if (!(s.flags & FOOD_FLAG)) {
        potions[desc] = { edid: s.EDID, from: here.file, kind: (s.flags & POISON_FLAG) ? 'poison' : 'potion', effects: s.effects };
      }
    }
    j += 24 + dataSize;
  }
}

const order = loadedOrder(pluginsTxt(), DATA);
if (!order) return;
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

// An effect is written by its editor id. One no plugin defines stays its desc,
// and is counted, so a gap is seen rather than dropped.
let unnamed = 0;
function named(list) {
  return list.map((d) => { if (mgef[d]) { return mgef[d]; } unnamed++; return d; });
}
function sorted(o, kind) {
  const out = {};
  for (const d of Object.keys(o).sort()) {
    const r = o[d];
    out[d] = kind ? { edid: r.edid, from: r.from, kind: r.kind, effects: named(r.effects) } : { edid: r.edid, from: r.from, effects: named(r.effects) };
  }
  return out;
}
const ing = sorted(ingredients, false);
const pot = sorted(potions, true);

console.log(order.length + ' plugins in the order, ' + read + ' INGR, ALCH and MGEF records read, ' +
            creation + ' of them Update.esm\'s Creation Club records, left out');
console.log(Object.keys(ing).length + ' ingredients, ' + Object.keys(pot).length + ' potions and poisons, ' +
            unnamed + ' effect(s) no plugin names');

if (!Object.keys(ing).length) {
  console.error('FAIL  no ingredient came out, so nothing is written');
  process.exitCode = 1;
} else if (!process.exitCode) {
  fs.writeFileSync(OUT, JSON.stringify({
    builtBy: 'scripts/dev/Build-IngredientTable.js',
    source: 'the INGR, ALCH and MGEF records of the plugins in load order (#3470)',
    readFrom: 'EFID for each effect, named by its MGEF\'s EDID; ENIT for the food and poison flags',
    note: 'which effects a batch may carry, and at what rank, is docs/systems/mixtures.md (MIXTURES in game/gamemode.js)',
    ingredients: ing,
    potions: pot
  }, null, 1) + '\n');
  console.log('wrote ' + OUT);
}
