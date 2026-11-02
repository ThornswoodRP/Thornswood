// Build-ItemSources.js
//
// Writes game/data/item-sources.json: every item somebody can come to hold,
// and every way it comes into the world, marked by kind (#3145).
//
// WHY
//
// Patrick asked for what people craft to be balanced against race crafts,
// Free Skyrim Trading Company goods, faction-only items and quest-only items
// (#3135), and decided on 22 Oct 2026 that balance is measured by what a thing
// takes to make or get, plus its stats, never by gold. "What it takes to get"
// is a question about where a thing comes from, and until this table nothing
// answered it in one place: the recipe table knows the benches, the work
// tables know the classes, the merchant files know the quest sources, and the
// dungeon pile, the starting kit and the rare seams are written into the
// gamemode. So each item is marked here with every source those tables give
// it, and a check can read "only from a quest" or "nothing hands it out" off
// one row instead of five files.
//
// THE KINDS
//
//   crafted   made at a bench by a profession, or by anybody where no
//             profession owns the recipe (smelting, tanning, jewellery
//             today), and the cook's fine and burnt dishes and the tailor's
//             hair dye, which the server makes in place of a recipe's output
//             (each dye is a row keyed hair-dye:<id>, never the plain
//             record it is carried on)
//   race      a recipe only the named race may make (docs/systems/races.md)
//   company   a Free Skyrim Trading Company ware: the Riekling pieces kept in
//             the open book (docs/systems/cut-items.md)
//   faction   a recipe only the embassy roll or the Thalmor remnant roll may
//             make (docs/systems/lists/roll-gates.md)
//   quest     drawn only while a merchant's scarce work is open, or the
//             retrieval token a merchant asks for (docs/systems/quests.md)
//   gathered  a class's work: picked, grown, fished, hunted, mined, or pressed
//             at a churn, a nest, a hive or the salt quarry
//   found     created by a dungeon chest or a body (docs/systems/dungeon-loot.md)
//   start     handed to a new character: the first clothes, a class's tool
//             and a farmer's first seeds
//
// The five #3145 names (crafted, race, company, faction, quest) are the
// balance question. The other three are there because an item that is also
// gathered, found or handed out at creation is not "only" any of the five,
// and a registry that left them out would call ebony ore quest-only when a
// tier 4 chest also creates it.
//
// WHAT IS NOT A SOURCE
//
//   A recipe cut from the open book (book "cut"), and a tempering row: the
//   grindstone and the armour table hand back the item they were given.
//   Hearthfire building rows: a house is a place already standing, and their
//   outputs are pieces only Papyrus opens (docs/systems/cut-items.md).
//   A deed, a key and a key mold: a claim's paper, carried as a named entry,
//   not goods (docs/systems/property.md).
//   Gold. It is money, not an item (docs/systems/gold.md).
//
// Every input a live recipe asks for is in the table too, so an input that
// nothing hands out shows up with no sources at all, under noSource.
//
// Read only apart from game/data/item-sources.json. It reads the checked-in
// tables and game/gamemode.js as text and runs none of the gamemode.
//
// Usage:
//   node scripts/dev/Build-ItemSources.js           writes the table
//   node scripts/dev/Build-ItemSources.js --check   writes nothing; exits 1
//                                                   when the table is not what
//                                                   this would write, or a
//                                                   source contradicts the cut
//                                                   list
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const args = process.argv.slice(2);
function arg(name, dflt) { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; }
const ROOT = path.resolve(arg('--root', path.join(__dirname, '..', '..')));
const OUT = path.join(ROOT, 'game', 'data', 'item-sources.json');
const CHECK = args.indexOf('--check') >= 0;

const INPUTS = [
  'game/data/recipes.json',
  'docs/systems/cut-items.json',
  'game/data/food-groups.json',
  'game/data/hair-dyes.json',
  'game/data/harvests.json',
  'game/data/hunts.json',
  'game/data/ores.json',
  'game/data/items.json',
  'game/data/chargen.json',
  'game/data/quest-content.json',
  'game/data/merchant-retrievals.json',
  'game/data/merchant-scarce-fishing.json',
  'game/data/merchant-scarce-geodes.json',
  'game/data/merchant-scarce-harvest.json',
  'game/data/merchant-orchard.json',
  'game/data/merchant-role-tables.json',
  'game/gamemode-tables/ITEM_NAMES.json',
  'game/gamemode-tables/ADMIN_ITEMS.json',
  'game/gamemode-tables/ADMIN_ACTORS.json',
  'game/gamemode.js'
];
const KINDS = ['crafted', 'race', 'company', 'faction', 'quest', 'gathered', 'found', 'start'];
const GOLD = 'f:skyrim.esm';

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function json(rel) { return JSON.parse(read(rel)); }
function die(why) { console.error('Build-ItemSources: ' + why); process.exit(1); }

// ------------------------------------------------------------ the gamemode
// The dungeon pile, the starting tools, the farmer's first seeds and the rare
// seams are written into game/gamemode.js as plain literals. Each is read
// between the brackets that follow its declaration and evaluated on its own,
// with nothing else of the file in scope, so only a literal can be read
// (or a literal naming another literal read the same way, given as scope).
const GM = read('game/gamemode.js').split('\r').join('');

function literalAfter(marker, from, scope) {
  const at = GM.indexOf(marker, from || 0);
  if (at < 0) { die('game/gamemode.js no longer declares ' + marker.trim()); }
  let i = at + marker.length;
  while (i < GM.length && GM[i] !== '{' && GM[i] !== '[') { i++; }
  const open = i;
  let depth = 0;
  let quote = '';
  for (; i < GM.length; i++) {
    const c = GM[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) { quote = ''; }
      continue;
    }
    if (c === '\'' || c === '"') { quote = c; continue; }
    if (c === '/' && GM[i + 1] === '/') { i = GM.indexOf('\n', i); continue; }
    if (c === '/' && GM[i + 1] === '*') { i = GM.indexOf('*/', i) + 1; continue; }
    if (c === '{' || c === '[') { depth++; }
    if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) { return vm.runInNewContext('(' + GM.slice(open, i + 1) + ')', Object.assign(Object.create(null), scope || {})); }
    }
  }
  return die('the literal after ' + marker.trim() + ' in game/gamemode.js does not close');
}

const DUNGEON = GM.indexOf('// ==== thornswood dungeon loot ====');
const QUESTS = GM.indexOf('// ==== thornswood custom quests ====');
if (DUNGEON < 0 || QUESTS < 0) { die('game/gamemode.js lost its dungeon loot or custom quests block'); }
const dungeonGoods = literalAfter('var GOODS = ', DUNGEON);
const dungeonTomes = literalAfter('var TOMES = ', DUNGEON);
const dungeonExclusive = literalAfter('var EXCLUSIVE = ', DUNGEON);
const tools = literalAfter('const TOOLS = ');
const rareSeams = literalAfter('var RARE = ', QUESTS);
// Who works each scarce draw: its gate, as the trader offers it.
const scarceWork = {};
literalAfter('var SCARCE = ', QUESTS, { GEMS: literalAfter('var GEMS = ', QUESTS) }).forEach(function (row) {
  scarceWork[row.id] = { by: row.gate.classKey || row.gate.profession, rank: row.gate.rank || '' };
});
function worker(quest) {
  if (!scarceWork[quest]) { die('the scarce work ' + quest + ' is not in SCARCE in game/gamemode.js'); }
  return scarceWork[quest];
}
const seeds = (function () {
  const m = /startingSeeds:\s*(\d+),\s*startingCrops:\s*(\[[^\]]*\])/.exec(GM);
  if (!m) { die('game/gamemode.js no longer says startingSeeds and startingCrops together'); }
  return { count: Number(m[1]), crops: vm.runInNewContext('(' + m[2] + ')', Object.create(null)) };
})();

// ------------------------------------------------------------ the tables
const recipes = json('game/data/recipes.json');
const cuts = json('docs/systems/cut-items.json');
const foodGroups = json('game/data/food-groups.json');
const hairDyes = json('game/data/hair-dyes.json');
const harvests = json('game/data/harvests.json');
const hunts = json('game/data/hunts.json');
const ores = json('game/data/ores.json');
const stationItems = json('game/data/items.json');
const chargen = json('game/data/chargen.json');
const questContent = json('game/data/quest-content.json');
const retrievals = json('game/data/merchant-retrievals.json');
const { longfinSources } = require(path.join(ROOT, 'scripts', 'dev', 'MerchantScarceLongfinSources.js'));

const items = {};
const names = {};
const types = {};
// The names the dungeon pile and the tool table write are lower case, said
// in a sentence. The record's own name wins where any table has it; then
// ITEM_NAMES (Build-ItemNameTable.js, every recipe output and input) and
// ADMIN_ITEMS (Build-AdminNameTables.py, read out of the plugins). Each of
// those keeps one record per name, so a record can be in one and not the
// other.
const lowNames = {};
const adminNames = {};
// The gamemode's tables (game/gamemode-tables, #5191): each row is
// lower-case name -> [name as written, record]; ADMIN_ACTORS is read too, as
// it was while it shared the ADMIN_NAMES block with ADMIN_ITEMS.
const TABLES = require(path.join(ROOT, 'scripts', 'dev', 'GamemodeTables.js'));
['ITEM_NAMES', 'ADMIN_ITEMS', 'ADMIN_ACTORS'].forEach(function (name) {
  let rows;
  try { rows = TABLES.read(name, path.join(ROOT, 'game', 'gamemode-tables')); } catch (e) { die('the ' + name + ' table does not read: ' + e.message); }
  Object.keys(rows).forEach(function (k) {
    const r = rows[k];
    if (!Array.isArray(r) || typeof r[0] !== 'string' || typeof r[1] !== 'string') { die('the ' + name + ' row ' + k + ' is not [name, record]'); }
    if (!adminNames[r[1]]) { adminNames[r[1]] = r[0]; }
  });
});
const recordTypes = {};
(function () {
  const records = json('game/data/merchant-role-tables.json').records || {};
  Object.keys(records).forEach(function (d) { recordTypes[d] = records[d].type; });
})();

function key(desc) { return String(desc || ''); }
function isGold(desc) { return key(desc).toLowerCase() === GOLD; }
function note(desc, name, type) {
  if (!desc) { return; }
  if (name && !names[desc]) { names[desc] = String(name); }
  if (type && !types[desc]) { types[desc] = String(type); }
}
function row(desc) {
  if (!items[desc]) { items[desc] = { via: [] }; }
  return items[desc];
}
function add(desc, via) {
  if (!desc || isGold(desc)) { return; }
  const r = row(desc);
  const same = r.via.find(function (v) { return JSON.stringify(Object.assign({}, v, { records: 0 })) === JSON.stringify(Object.assign({}, via, { records: 0 })); });
  if (same && via.records) { same.records += via.records; return; }
  if (same) { return; }
  r.via.push(via);
}
// by is what asks for it: a recipe id, a hair dye's row, or the water bottle.
// Gold is never a row; what asks for it is kept apart, since no recipe may
// (#3115).
const goldAskedBy = [];
function asked(desc, name, type, by) {
  if (!desc) { return; }
  if (isGold(desc)) { if (goldAskedBy.indexOf(by) < 0) { goldAskedBy.push(by); } return; }
  note(desc, name, type);
  const r = row(desc);
  if (!r.askedBy) { r.askedBy = []; }
  if (r.askedBy.indexOf(by) < 0) { r.askedBy.push(by); }
}

// The cut list: an item reference in it is not found and not made. A recipe
// reference in it only takes that recipe out; the item stays where another
// live recipe makes it.
const cutRecipes = {};
const cutItems = {};
cuts.items.forEach(function (c) {
  if (recipes.recipes[c.id] || (recipes.unowned || {})[c.id] || (recipes.refused || {})[c.id]) {
    // An embassy or thalmor recipe reference is the faction row itself.
    if (c.disposition === 'cut') { cutRecipes[c.id] = true; }
  } else {
    cutItems[c.id] = c.disposition;
  }
});
const companyNames = {};
cuts.rieklingKept.forEach(function (n) { companyNames[n] = 0; });

const TEMPER = /^CraftingSmithing(SharpeningWheel|ArmorTable)$/;
function live(rowId, r) {
  return r.out && r.book !== 'cut' && !cutRecipes[rowId] && !TEMPER.test(r.benchName || '') &&
    !/^BYOHBuilding/.test(r.benchName || '');
}

// Owned recipes: crafted, race, faction, company.
Object.keys(recipes.recipes).sort().forEach(function (id) {
  const r = recipes.recipes[id];
  if (!live(id, r)) { return; }
  note(r.out, r.name, r.type);
  const by = r.owner + '/' + r.half;
  if (r.roll) {
    add(r.out, { kind: 'faction', roll: r.roll, by: by, rank: r.rank, recipe: id });
  } else if (r.race) {
    add(r.out, { kind: 'race', race: r.race, by: by, rank: r.rank, recipe: id });
  } else {
    add(r.out, { kind: 'crafted', by: by, rank: r.rank, recipe: id });
  }
  if (r.race === 'riekling' && Object.prototype.hasOwnProperty.call(companyNames, r.name)) {
    companyNames[r.name]++;
    add(r.out, { kind: 'company', recipe: id });
  }
  (r.inputItems || []).forEach(function (it) { asked(it.item, it.name, it.type, id); });
});

// Recipes nobody owns: anybody may make them (recipes.json "default").
Object.keys(recipes.unowned || {}).sort().forEach(function (id) {
  const r = recipes.unowned[id];
  if (!live(id, r)) { return; }
  note(r.out, r.name, r.type);
  add(r.out, { kind: 'crafted', by: 'anybody', rank: '', recipe: id });
  (r.inputItems || []).forEach(function (it) { asked(it.item, it.name, it.type, id); });
});

// What the server makes in place of a recipe's output: the cook's fine and
// burnt dishes (food-groups.json quality, #2906) and the tailor's hair dye
// (hair-dyes.json, #2675).
const outOwner = {};
Object.keys(recipes.recipes).forEach(function (id) {
  const r = recipes.recipes[id];
  if (live(id, r) && !outOwner[r.out]) { outOwner[r.out] = r.owner + '/' + r.half; }
});
const quality = foodGroups.quality || {};
Object.keys(quality.fine || {}).sort().forEach(function (base) {
  if (!outOwner[base]) { return; }
  add(quality.fine[base], { kind: 'crafted', by: outOwner[base], rank: '', table: 'food-groups.json quality fine', of: base });
});
if (quality.burnt) { add(quality.burnt, { kind: 'crafted', by: 'Cook', rank: '', table: 'food-groups.json quality burnt' }); }
// A dye is carried on a plain vanilla record that nothing else in game\ may
// name (#2675, test-2675-hair-dye.js B3), so each dye is its own row, keyed
// hair-dye:<its id in the list>, and the plain record is never a row here.
(hairDyes.dyes || []).forEach(function (d) {
  const key = 'hair-dye:' + d.id;
  Object.keys((hairDyes.who && hairDyes.who.halves) || {}).sort().forEach(function (half) {
    const by = 'Tailor/' + half.charAt(0).toUpperCase() + half.slice(1);
    add(key, { kind: 'crafted', by: by, rank: hairDyes.who.halves[half], table: 'hair-dyes.json' });
  });
  note(key, d.name, 'MISC');
  (d.inputs || []).forEach(function (it) { asked(it.item, '', '', key); });
});

// Class work. A rare seam is a miner's draw too, but only inside the one
// place its merchant's scarce work opens (#1380), so it is quest, not
// gathered.
const CLASS_OF = { harvests: 'gatherer', crops: 'farmer', fish: 'fisher', game: 'hunter' };
Object.keys(CLASS_OF).forEach(function (group) {
  const bag = harvests[group] || {};
  Object.keys(bag).sort().forEach(function (ref) {
    const h = bag[ref];
    if (h.produce) {
      note(h.produce, h.name);
      add(h.produce, { kind: 'gathered', by: CLASS_OF[group], rank: h.rank || '', table: 'harvests.json ' + group, records: 1 });
    }
    (h.gives || []).forEach(function (part) {
      note(part.item, part.name);
      add(part.item, { kind: 'gathered', by: CLASS_OF[group], rank: h.rank || '', table: 'harvests.json ' + group, records: 1 });
    });
  });
});
Object.keys(hunts.hunts || {}).sort().forEach(function (ref) {
  const h = hunts.hunts[ref];
  (h.gives || []).forEach(function (part) {
    note(part.item, part.name);
    add(part.item, { kind: 'gathered', by: 'hunter', rank: h.rank || '', table: 'hunts.json', records: 1 });
  });
});
Object.keys(ores.ores || {}).sort().forEach(function (ref) {
  const o = ores.ores[ref];
  note(o.ore, o.name);
  if (Object.prototype.hasOwnProperty.call(rareSeams, o.name)) {
    add(o.ore, { kind: 'quest', quest: rareSeams[o.name], by: 'miner', rank: o.rank || '', table: 'ores.json, the rare seams of game/gamemode.js custom quests', records: 1 });
  } else {
    add(o.ore, { kind: 'gathered', by: 'miner', rank: o.rank || '', table: 'ores.json', records: 1 });
  }
});
// The presses: docs/systems/classes/farmer.md "Butter, milk, and the nest"
// and miner.md "The salt quarry" (fire, frost and void salts from expert).
const STATIONS = {
  saltPile: ['miner', 'novice'], fireSalts: ['miner', 'expert'], frostSalts: ['miner', 'expert'],
  voidSalts: ['miner', 'expert'], chickenEgg: ['farmer', 'novice'], honeycomb: ['farmer', 'novice'],
  milk: ['farmer', 'novice'], butter: ['farmer', 'novice']
};
Object.keys(STATIONS).forEach(function (k) {
  if (!stationItems[k]) { die('game/data/items.json has no ' + k); }
  add(stationItems[k], { kind: 'gathered', by: STATIONS[k][0], rank: STATIONS[k][1], table: 'items.json ' + k });
});

// Water: anybody fills an empty bottle at a well or the water bucket
// (docs/systems/drink.md), and the bottle of water is a new item.
const water = literalAfter('waterItems: ');
asked(water.empty, '', '', 'NEEDS.waterItems');
add(water.full, { kind: 'gathered', by: 'anybody', rank: '', table: 'game/gamemode.js NEEDS.waterItems, an empty bottle filled at a well or the water bucket' });

// Quests. The scarce work draws (each file names its item), the longfin
// markers, the mammoth ground (the hunting table's mammoth, dd641, which
// game/quest-mammoth-sources.js binds), and the seven retrieval tokens.
function scarce(rel, data) {
  const counts = {};
  (data.sources || []).forEach(function (s) { counts[s.item] = (counts[s.item] || 0) + 1; });
  Object.keys(counts).sort().forEach(function (item) {
    const w = worker(data.quest);
    add(item, { kind: 'quest', quest: data.quest, by: w.by, rank: w.rank, table: rel, records: counts[item] });
  });
}
['game/data/merchant-scarce-fishing.json', 'game/data/merchant-scarce-geodes.json',
  'game/data/merchant-scarce-harvest.json', 'game/data/merchant-orchard.json'].forEach(function (rel) { scarce(rel, json(rel)); });
scarce('game/data/quest-content.json longfin sites', longfinSources(questContent));
const MAMMOTH = 'dd641:Skyrim.esm';
if (!hunts.hunts[MAMMOTH]) { die('game/data/hunts.json has no mammoth (' + MAMMOTH + ')'); }
hunts.hunts[MAMMOTH].gives.forEach(function (part) {
  add(part.item, { kind: 'quest', quest: 'mammoth', by: worker('mammoth').by, rank: worker('mammoth').rank, table: 'hunts.json ' + MAMMOTH, records: 3 });
});
(questContent.items || []).forEach(function (q) { note(q.ref, q.name, 'MISC'); });
(retrievals.sources || []).forEach(function (s) {
  add(s.item, { kind: 'quest', quest: s.quest, table: 'game/data/merchant-retrievals.json', records: 1 });
});

// Dungeon chests and bodies. The pile is the same list for both.
function low(desc, name) { if (!lowNames[desc]) { lowNames[desc] = name; } }
dungeonGoods.forEach(function (g) {
  low(g.desc, g.name);
  add(g.desc, { kind: 'found', table: 'dungeon goods', tier: g.tier });
});
Object.keys(dungeonTomes).forEach(function (rank) {
  dungeonTomes[rank].forEach(function (t) {
    low(t.desc, t.name);
    note(t.desc, '', 'BOOK');
    add(t.desc, { kind: 'found', table: 'dungeon tomes ' + rank });
  });
});
dungeonExclusive.forEach(function (x) {
  low(x.desc, x.name);
  add(x.desc, { kind: 'found', table: 'dungeon exclusive', tier: x.tier });
});

// A new character: the first clothes (chargen.json), a starting class's tool
// (TOOLS in game/gamemode.js) and a farmer's first seeds.
(chargen.shift || []).forEach(function (s) { add(s[0], { kind: 'start', table: 'chargen.json shift' }); });
(chargen.rieklingShift || []).forEach(function (s) { add(s[0], { kind: 'start', table: 'chargen.json rieklingShift' }); });
Object.keys(tools).sort().forEach(function (cls) {
  low(tools[cls].give, tools[cls].name);
  add(tools[cls].give, { kind: 'start', table: 'game/gamemode.js TOOLS', by: cls });
});
seeds.crops.forEach(function (ref) {
  const crop = (harvests.crops || {})[ref];
  if (!crop) { die('a starting crop, ' + ref + ', is not in harvests.json crops'); }
  add(crop.produce, { kind: 'start', table: 'game/gamemode.js startingCrops', by: 'farmer', count: seeds.count });
});

// ------------------------------------------------------------ what is wrong
const problems = [];
Object.keys(companyNames).forEach(function (n) {
  if (companyNames[n] === 0) { problems.push('the company ware "' + n + '" in cut-items.json rieklingKept is not made by any live riekling recipe'); }
});
Object.keys(items).forEach(function (desc) {
  const r = items[desc];
  if (cutItems[desc] && r.via.length) {
    problems.push(desc + ' (' + (names[desc] || '') + ') is ' + cutItems[desc] + ' in docs/systems/cut-items.json, not found and not made, yet ' +
      r.via.map(function (v) { return v.kind + ' ' + (v.table || v.recipe || ''); }).join(', ') + ' hands it out');
  }
  const kinds = r.via.map(function (v) { return v.kind; });
  if (kinds.indexOf('faction') >= 0 && kinds.some(function (k) { return k !== 'faction'; })) {
    problems.push(desc + ' (' + (names[desc] || '') + ') is faction work, yet ' +
      r.via.filter(function (v) { return v.kind !== 'faction'; }).map(function (v) { return v.kind + ' ' + (v.table || v.recipe || ''); }).join(', ') + ' also hands it out');
  }
});

// ------------------------------------------------------------ the table
const ids = Object.keys(items).sort();
const counts = {};
const only = {};
KINDS.forEach(function (k) { counts[k] = 0; only[k] = 0; });
const noSource = [];
const lines = [];
ids.forEach(function (desc) {
  const r = items[desc];
  r.via.sort(function (a, b) {
    const ak = KINDS.indexOf(a.kind);
    const bk = KINDS.indexOf(b.kind);
    if (ak !== bk) { return ak - bk; }
    const as = JSON.stringify(a);
    const bs = JSON.stringify(b);
    return as < bs ? -1 : as > bs ? 1 : 0;
  });
  const sources = KINDS.filter(function (k) { return r.via.some(function (v) { return v.kind === k; }); });
  sources.forEach(function (k) { counts[k]++; });
  if (sources.length === 1) { only[sources[0]]++; }
  if (!sources.length) { noSource.push(desc); }
  const out = { name: names[desc] || adminNames[desc] || lowNames[desc] || '', type: types[desc] || recordTypes[desc] || '', sources: sources, via: r.via };
  if (r.askedBy) { out.askedBy = r.askedBy.slice().sort(); }
  lines.push('  ' + JSON.stringify(desc) + ': ' + JSON.stringify(out));
});

// What it read, by name and not by hash: the table itself is what --check
// compares, so a change to game/gamemode.js that moves no source leaves it
// current rather than stale.
const readFrom = INPUTS.concat(['scripts/dev/MerchantScarceLongfinSources.js', 'scripts/dev/GamemodeTables.js']);

const head = {
  builtBy: 'scripts/dev/Build-ItemSources.js',
  issue: 3145,
  about: 'Every item somebody can come to hold and every way it comes into the world. sources is the kinds, in this order; via is each source with where it was read; askedBy is every live recipe (by id), hair dye (hair-dye:<id>) or the water bottle (NEEDS.waterItems) that asks for it. An item with no sources is one something asks for and nothing hands out. Balance is what a thing takes to make or get plus its stats, never gold (Patrick, 22 Oct 2026, #3135).',
  kinds: {
    crafted: 'made at a bench by a profession, by anybody where no profession owns the recipe, or made by the server in place of a recipe\'s output (fine and burnt dishes, hair dye)',
    race: 'a recipe only the named race may make',
    company: 'a Free Skyrim Trading Company ware (cut-items.json rieklingKept)',
    faction: 'a recipe only the embassy roll or the remnant roll may make',
    quest: 'drawn only while a merchant\'s scarce work is open, a rare seam its quest opens, or a retrieval token',
    gathered: 'a class\'s work: picked, grown, fished, hunted, mined or pressed',
    found: 'created by a dungeon chest or a body',
    start: 'handed to a new character: first clothes, a class\'s tool, a farmer\'s first seeds'
  },
  notSources: 'a cut recipe, a tempering row (grindstone, armour table), a Hearthfire building row, a deed, key or key mold (named claim papers), and gold',
  readFrom: readFrom,
  count: ids.length,
  counts: counts,
  only: only,
  noSource: noSource,
  goldAskedBy: goldAskedBy.slice().sort()
};
let text = JSON.stringify(head, null, 1);
text = text.slice(0, text.length - 2) + ',\n "items": {\n' + lines.join(',\n') + '\n }\n}\n';

if (problems.length) {
  problems.forEach(function (p) { console.error('PROBLEM  ' + p); });
}
if (CHECK) {
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (have !== text) {
    console.error('game/data/item-sources.json is not what scripts/dev/Build-ItemSources.js writes. Run it and commit the table.');
    process.exit(1);
  }
  if (problems.length) { process.exit(1); }
  console.log('game/data/item-sources.json is current: ' + ids.length + ' items');
  process.exit(0);
}
fs.writeFileSync(OUT, text, 'utf8');
console.log('wrote ' + path.relative(ROOT, OUT) + ': ' + ids.length + ' items');
KINDS.forEach(function (k) { console.log('  ' + k + ' ' + counts[k] + ', only ' + only[k]); });
console.log('  no source ' + noSource.length);
if (problems.length) { process.exit(1); }
