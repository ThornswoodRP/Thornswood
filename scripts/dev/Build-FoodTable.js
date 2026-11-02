// Build-FoodTable.js
//
// Builds game\data\food.json: every ALCH record in the load order that somebody
// can eat or drink, what kind it is, and whether it is alcohol.
//
// WHY THERE IS ANYTHING TO BUILD
//
// Patrick, 23 September: "I also just ate food and my food percentage didn't
// change", and then "Water percentage doesn't change".
//
// Nothing was broken. The only thing that has ever fed anybody on this server
// is typing /eat: eating in the game is the client consuming an item in its
// own inventory, the server has no eat hook, and by the time the inventory
// sync arrives the food is simply gone, which looks exactly like dropping it.
// The client watches the equip event now, because in Skyrim eating is
// equipping, and tells the server WHAT was eaten. What it is worth has to be
// the server's answer, or a client could fill its own meters by saying so,
// and this table is that answer.
//
// WHAT COUNTS, MEASURED RATHER THAN TYPED
//
//   1. IT HAS TO BE FOOD. The ALCH record's ENIT flags carry the food bit,
//      which is Bethesda's own answer to "is this a meal or a medicine". A
//      potion of healing is not a meal and does not move a meter.
//
//   2. FOOD OR DRINK IS THE NAME, AND THAT IS A JUDGEMENT. Nothing on the
//      record says which: ale, water and a sweet roll are all food items with
//      the same flag. So the rule is the name, the list is written out below,
//      and anything not matching is food, because most food is food.
//
//   3. ALCOHOL IS ALSO THE NAME, for the same reason, and it matters more:
//      Patrick asked for alcohol to be thirst-quenching, hunger-making and
//      progressively worse with each one, so the server has to know which
//      drinks are drink.
//
//   4. ONE LINE PER RECORD, UNDER THE PLUGIN THAT MADE IT, WORTH WHAT THE
//      LAST PLUGIN SAYS. Djinn, 24 September: "if any drink is supposed to
//      satiate your thirst, any alcohol doesn't do this at all", with Thirst
//      at 0% and "You have eaten enough" on the screen. This used to key
//      every version of a record by the plugin it was read out of, so Ale
//      was three lines: 34c5e:Skyrim.esm reading food (its name is a strings
//      file number, so no word matched), 34c5e:Update.esm the same, and
//      34c5e:Gourmet.esp reading ale. An override keeps the form id of the
//      plugin that first made the record, so the game reports that ale as
//      34c5e of Skyrim.esm, the server found the food line, and the drink
//      filled hunger. The Gourmet.esp line could never be found at all.
//      So a record's high byte is read through the plugin's own MAST list,
//      the way Build-FireTable.js does it, and the version kept is the last
//      one in the load order, which is the one the game uses.
//
// Read only. It opens the plugins of the build and writes game\data\food.json.
//
// Usage:
//   node scripts\dev\Build-FoodTable.js
//   node scripts\dev\Build-FoodTable.js --print
//   node scripts\dev\Build-FoodTable.js --plugins "C:\path\to\plugins.txt"
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
const OUT = opt('out', path.join(__dirname, '..', '..', 'game', 'data', 'food.json'));
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
  Rule 2 and rule 3, written out so they can be argued with.

  A drink is a thing you swallow without chewing. The list is the words
  Bethesda and the collection actually use on ALCH records; anything else with
  the food flag is food.
*/
const DRINK = /\b(ale|mead|wine|brandy|spirits?|grog|rum|liquor|beer|cider|water|milk|juice|tea|broth|soup|stew|nog|brew|flagon|bottle)\b/i;
/*
  sujamma to homebrew were added on 24 September, once rule 4 put the last
  plugin's names in front of this list: Flin, Mazte, Shein, Sujamma, Sadri's
  Sujamma, Argonian Bloodwine and Windhelm Homebrew are the alcohol of this
  build and none of them matched, so they read food.
*/
const ALCOHOL = /\b(ale|mead|wine|brandy|spirits?|grog|rum|liquor|beer|cider|nog|firebrand|honningbrew|black-?briar|sujamma|shein|mazte|flin|bloodwine|homebrew)\b/i;
/*
  AND THE EDITOR ID, FOR A DRINK WITH NO DRINK WORD IN ITS NAME. Gourmet
  calls every drink it adds or takes over MAG_Drink..., and Cliff Racer,
  White-Gold Tower and Velvet LeChance are three of them whose names say
  nothing. Only the drink half is read off the editor id, never the alcohol
  half: WindhelmSSE.esp's Glacier Water is FoodMeadWHIceWater and its
  Snowberry Juice is BYOHFoodWineBottle03WHSnowJuice, so an editor id saying
  mead or wine is a reused bottle, not a fact about what is in it.
*/
const DRINK_EDID = /drink/i;

const FOOD_FLAG = 0x00000002;   // ENIT: this ALCH is a food item
const POISON_FLAG = 0x00020000; // ENIT: and this one is a poison

/*
  The masters a plugin declares, in order. A record's high byte is an index
  into this list, and anything past the end is the plugin's own. The same
  reading as Build-FireTable.js.
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

function subrecords(rec) {
  const got = { EDID: '', FULL: '', value: 0, flags: 0 };
  let k = 0, over = 0;
  while (k + 6 <= rec.length) {
    const sub = rec.toString('ascii', k, k + 4);
    let sz = rec.readUInt16LE(k + 4);
    k += 6;
    if (over > 0) { sz = over; over = 0; }
    if (sub === 'XXXX') { over = rec.readUInt32LE(k); k += sz; continue; }
    if ((sub === 'EDID' || sub === 'FULL') && sz > 1 && k + sz <= rec.length) {
      got[sub] = rec.toString('latin1', k, k + sz - 1);
    }
    // ENIT on an ALCH: value, flags, addiction, chance, sound.
    if (sub === 'ENIT' && sz >= 8 && k + sz <= rec.length) {
      got.value = rec.readUInt32LE(k);
      got.flags = rec.readUInt32LE(k + 4);
    }
    k += sz;
  }
  return got;
}

const rows = [];
// Which plugin the walk is inside, and what it declares as its masters.
const here = { file: '', masters: [], order: [] };
let scanned = 0;
let notFood = 0;

/*
  Which record this is: the plugin that made it and the id within that
  plugin. An index inside the master list means the record belongs to that
  master and this plugin is only changing it. See rule 4.
*/
function ownerOf(formId) {
  const idx = (formId >>> 24) & 0xff;
  const local = formId & 0x00ffffff;
  const file = idx < here.masters.length ? asLoaded(here.masters[idx], here.order) : here.file;
  return { file: file, local: '0x' + local.toString(16) };
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
    if (type === 'ALCH') {
      scanned++;
      let rec = null;
      try {
        rec = b.slice(j + 24, j + 24 + dataSize);
        if (flags & 0x00040000) {                      // compressed
          rec = zlib.inflateSync(rec.slice(4));
        }
      } catch (e) { rec = null; }
      if (rec) {
        const s = subrecords(rec);
        if (!(s.flags & FOOD_FLAG)) {
          /*
            A POTION IS A LIQUID, which is Patrick on 23 September: "Potions
            and poisons should be counted towards thirst they are liquids".
            They are not a meal and they are not a pint, so they are their own
            kind and the server gives them a swallow's worth. A poison is one
            as well: smearing it on a blade fires the same equip event as
            drinking it and there is no way to tell the two apart from here,
            so it counts, and that is said out loud rather than pretended
            away.
          */
          notFood++;
          const pname = s.FULL || s.EDID;
          const pown = ownerOf(formId);
          rows.push({
            file: pown.file,
            local: pown.local,
            from: here.file,
            edid: s.EDID,
            name: pname,
            kind: (s.flags & POISON_FLAG) ? 'poison' : 'potion',
            gold: s.value
          });
        } else {
          const name = s.FULL || s.EDID;
          const drink = DRINK.test(name) || DRINK_EDID.test(s.EDID);
          const booze = ALCOHOL.test(name);
          const own = ownerOf(formId);
          rows.push({
            file: own.file,
            local: own.local,
            from: here.file,
            edid: s.EDID,
            name: name,
            kind: booze ? 'ale' : (drink ? 'drink' : 'food'),
            gold: s.value
          });
        }
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
  here.masters = [];
  try {
    if (buf.length > 24 && buf.toString('ascii', 0, 4) === 'TES4') { here.masters = mastersOf(buf); }
  } catch (e) { here.masters = []; }
  try { walk(buf, 0, buf.length); } catch (e) {
    console.error('FAIL  ' + file + ' would not parse: ' + e.message);
    process.exitCode = 1;
  }
}

// Later plugins win, the way the game resolves them. Every version of a
// record has the same key now (rule 4), so this is one line per record and
// the one left standing is the last plugin's, which row.from names.
const byDesc = {};
for (const r of rows) {
  byDesc[r.local.replace(/^0x/, '') + ':' + r.file] = r;
}

const items = {};
for (const desc in byDesc) {
  const r = byDesc[desc];
  items[desc] = { k: r.kind };
}

const counts = { food: 0, drink: 0, ale: 0, potion: 0, poison: 0 };
for (const desc in items) { counts[items[desc].k]++; }

console.log(order.length + ' plugins in the order');
console.log(scanned + ' ALCH records read, ' + Object.keys(items).length +
            ' can be swallowed');
console.log('  food   ' + counts.food);
console.log('  drink  ' + counts.drink);
console.log('  ale    ' + counts.ale);
console.log('  potion ' + counts.potion);
console.log('  poison ' + counts.poison);

if (PRINT) {
  const all = Object.keys(byDesc).map((d) => byDesc[d])
    .sort((a, b) => (a.kind + a.name).localeCompare(b.kind + b.name));
  for (const r of all) {
    console.log('  ' + r.kind.padEnd(6) + r.local.padEnd(10) + (r.name || '').padEnd(34) + r.file);
  }
}

/*
  INSTALLED INTO gamemode.js AS WELL.

  food.json keeps the name and the editor id, because "why is this thing ale"
  has to be answerable. The server needs neither: it asks one question, which
  is what kind this is, so the line that goes into the gamemode is the kind
  and nothing else.
*/
function install() {
  const changed = TABLES.write('FOODS', { items: items });
  console.log((changed ? 'wrote ' : 'already current: ') + Object.keys(items).length + ' rows' + ' in game\\gamemode-tables\\FOODS.json');
}

if (!Object.keys(items).length) {
  console.error('FAIL  nothing came out, so nothing is written');
  process.exitCode = 1;
} else if (!process.exitCode) {
  install();
  fs.writeFileSync(OUT, JSON.stringify({
    builtBy: 'scripts\dev\Build-FoodTable.js',
    builtAt: new Date().toISOString(),
    source: 'the ALCH records of the plugins in load order',
    readFrom: 'ENIT for the food and poison flags, FULL for the name',
    note: 'what a kind is WORTH is balance and lives in NEEDS in gamemode.js',
    count: Object.keys(items).length,
    byKind: counts,
    items: byDesc
  }, null, 1));
  console.log('wrote ' + OUT);
}
