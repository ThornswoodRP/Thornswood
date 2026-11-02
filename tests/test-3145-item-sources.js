// test-3145-item-sources.js
//
// #3145. One table marks every item's source, so the balance #3135 asks for
// (what people craft against race crafts, company goods, faction-only and
// quest-only items) can be read off one row instead of five files.
// scripts/dev/Build-ItemSources.js writes game/data/item-sources.json.
//
//   T  the table that is checked in is what the builder writes now, and the
//      builder finds nothing in it that contradicts the cut list.
//   S  every row's sources are the kinds its via names, in the table's order,
//      and the counts at the top are the rows'.
//   R  read back against the recipe table directly: every live recipe's
//      output carries the kind its row says (crafted, race or faction), every
//      company ware is a riekling recipe, and a cut or tempering row is no
//      source of anything.
//   Q  the rare seams the custom quests open are quest, never gathered; the
//      dungeon's exclusive list is found; the starting tools are start;
//      each hair dye is its own row and the plain record it rides on none;
//      each scarce draw names who works it.
//   N  an input nothing hands out is under noSource, and one that something
//      does hand out is not; askedBy and goldAskedBy name what asks for it.
//   P  the builder refuses, on a copy in a temporary folder, a table where
//      the cut list says an item is not found while the dungeon hands it
//      out, and a faction item a public bench also makes.
//   L  docs/systems/lists/item-sources.md says the table's counts.
//
// Read only. Part P writes only in its temporary folder.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const BUILD = path.join(REPO, 'scripts', 'dev', 'Build-ItemSources.js');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function json(rel) { return JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8')); }

// ---------------------------------------------------------------- T
const check = spawnSync(process.execPath, [BUILD, '--check'], { encoding: 'utf8' });
yes('T1 game/data/item-sources.json is what Build-ItemSources.js writes, with nothing contradicting the cut list' +
    (check.status === 0 ? '' : ': ' + (check.stderr || check.stdout).trim().split('\n').slice(0, 5).join(' / ')),
    check.status === 0);
const table = json('game/data/item-sources.json');
yes('T2 the table says it is the builder\'s, for #3145',
    table.builtBy === 'scripts/dev/Build-ItemSources.js' && table.issue === 3145);

// ---------------------------------------------------------------- S
const KINDS = ['crafted', 'race', 'company', 'faction', 'quest', 'gathered', 'found', 'start'];
yes('S1 the kinds are the five #3145 names and the three that keep "only" true',
    JSON.stringify(Object.keys(table.kinds)) === JSON.stringify(KINDS));
const ids = Object.keys(table.items);
const badRows = ids.filter(function (id) {
  const r = table.items[id];
  const want = KINDS.filter(function (k) { return r.via.some(function (v) { return v.kind === k; }); });
  return JSON.stringify(r.sources) !== JSON.stringify(want) || r.via.some(function (v) { return KINDS.indexOf(v.kind) < 0; });
});
yes('S2 every row\'s sources are the kinds its via names, in order (' + badRows.slice(0, 3).join(', ') + ')', badRows.length === 0);
const counted = {};
const onlyCounted = {};
KINDS.forEach(function (k) { counted[k] = 0; onlyCounted[k] = 0; });
ids.forEach(function (id) {
  const s = table.items[id].sources;
  s.forEach(function (k) { counted[k]++; });
  if (s.length === 1) { onlyCounted[s[0]]++; }
});
yes('S3 count, counts and only are the rows\'',
    table.count === ids.length && JSON.stringify(counted) === JSON.stringify(table.counts) &&
    JSON.stringify(onlyCounted) === JSON.stringify(table.only));
yes('S4 no row is gold', ids.every(function (id) { return id.toLowerCase() !== 'f:skyrim.esm'; }));

// ---------------------------------------------------------------- R
const recipes = json('game/data/recipes.json');
const cuts = json('docs/systems/cut-items.json');
const cutRecipe = {};
cuts.items.forEach(function (c) { if (c.disposition === 'cut') { cutRecipe[c.id] = true; } });
const TEMPER = /^CraftingSmithing(SharpeningWheel|ArmorTable)$/;
let live = 0;
const wrong = [];
const fromCut = [];
Object.keys(recipes.recipes).forEach(function (id) {
  const r = recipes.recipes[id];
  const row = table.items[r.out];
  const isLive = r.out && r.book !== 'cut' && !cutRecipe[id] && !TEMPER.test(r.benchName || '');
  const viaThis = row ? row.via.filter(function (v) { return v.recipe === id; }) : [];
  if (!isLive) {
    if (viaThis.length) { fromCut.push(r.name + ' ' + id); }
    return;
  }
  live++;
  const kind = r.roll ? 'faction' : r.race ? 'race' : 'crafted';
  if (!viaThis.some(function (v) { return v.kind === kind && v.by === r.owner + '/' + r.half && v.rank === r.rank; })) {
    wrong.push(r.name + ' ' + id + ' should be ' + kind);
  }
});
yes('R1 every one of the ' + live + ' live owned recipes marks its output with its own kind, half and rank (' +
    wrong.slice(0, 3).join(', ') + ')', live > 500 && wrong.length === 0);
yes('R2 no cut or tempering recipe is the source of anything (' + fromCut.slice(0, 3).join(', ') + ')', fromCut.length === 0);
const faction = ids.filter(function (id) { return table.items[id].sources.indexOf('faction') >= 0; });
const rollRows = Object.keys(recipes.recipes).filter(function (id) { return recipes.recipes[id].roll; });
yes('R3 the ' + rollRows.length + ' embassy and remnant rows are the faction items, and nothing else makes them',
    rollRows.length > 0 && faction.length === new Set(rollRows.map(function (id) { return recipes.recipes[id].out; })).size &&
    faction.every(function (id) { return table.items[id].sources.length === 1; }));
const company = ids.filter(function (id) { return table.items[id].sources.indexOf('company') >= 0; });
const companyNames = new Set(company.map(function (id) { return table.items[id].name; }));
yes('R4 every company ware is riekling race work, and every name in rieklingKept is one (' + companyNames.size + ')',
    company.every(function (id) { return table.items[id].via.some(function (v) { return v.kind === 'race' && v.race === 'riekling'; }); }) &&
    cuts.rieklingKept.every(function (n) { return companyNames.has(n); }));

// ---------------------------------------------------------------- Q
const ores = json('game/data/ores.json');
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(REPO, 'game', 'gamemode.js'), 'utf8'));
const rareAt = gm.indexOf('var RARE = {', gm.indexOf('// ==== thornswood custom quests ===='));
const rareNames = rareAt < 0 ? [] : (gm.slice(rareAt, gm.indexOf('};', rareAt)).match(/'([^']+)':/g) || []).map(function (s) { return s.slice(1, -2); });
const rareOres = new Set();
Object.keys(ores.ores).forEach(function (ref) { if (rareNames.indexOf(ores.ores[ref].name) >= 0) { rareOres.add(ores.ores[ref].ore); } });
yes('Q1 the ' + rareOres.size + ' rare seams (' + rareNames.join(', ') + ') are quest and never gathered',
    rareOres.size >= 6 && Array.from(rareOres).every(function (d) {
      const r = table.items[d];
      return r && r.sources.indexOf('quest') >= 0 && !r.via.some(function (v) { return v.kind === 'gathered' && v.table === 'ores.json'; });
    }));
const exclusiveAt = gm.indexOf('var EXCLUSIVE = [');
const exclusive = exclusiveAt < 0 ? [] : (gm.slice(exclusiveAt, gm.indexOf('];', exclusiveAt)).match(/desc: '([^']+)'/g) || []).map(function (s) { return s.slice(7, -1); });
yes('Q2 every dungeon exclusive (' + exclusive.length + ') is found',
    exclusive.length > 0 && exclusive.every(function (d) { return table.items[d] && table.items[d].sources.indexOf('found') >= 0; }));
yes('Q3 the pickaxe a new miner is handed is start, and crafted by a smith as well',
    table.items['e3c16:Skyrim.esm'] && table.items['e3c16:Skyrim.esm'].sources.indexOf('start') >= 0 &&
    table.items['e3c16:Skyrim.esm'].sources.indexOf('crafted') >= 0);
yes('Q4 the guild satchel a retrieval asks for is quest only',
    JSON.stringify((table.items['17000:Thornswood-Content.esp'] || {}).sources) === '["quest"]');
const dyes = json('game/data/hair-dyes.json');
yes('Q5 every hair dye (' + dyes.dyes.length + ') is its own Tailor row, and the plain record a dye is carried on is no row (test-2675-hair-dye.js B3)',
    !table.items[dyes.item] && dyes.dyes.length > 0 && dyes.dyes.every(function (d) {
      const r = table.items['hair-dye:' + d.id];
      return r && r.name === d.name && JSON.stringify(r.sources) === '["crafted"]' &&
        r.via.every(function (v) { return /^Tailor\//.test(v.by); });
    }));

const scarceAt = gm.indexOf('var SCARCE = [');
const gates = {};
(gm.slice(scarceAt, gm.indexOf('];', scarceAt)).match(/gate: \{(classKey|profession): '(\w+)', rank: '(\w+)'\}, id: '(\w+)'/g) || []).forEach(function (m) {
  const p = /gate: \{(?:classKey|profession): '(\w+)', rank: '(\w+)'\}, id: '(\w+)'/.exec(m);
  gates[p[3]] = { by: p[1], rank: p[2] };
});
const scarceVia = [];
ids.forEach(function (id) { table.items[id].via.forEach(function (v) { if (v.kind === 'quest' && gates[v.quest]) { scarceVia.push(v); } }); });
yes('Q6 every scarce draw (' + scarceVia.length + ') names who works it and at what rank, as SCARCE in the gamemode gates it',
    Object.keys(gates).length >= 8 && scarceVia.length >= 8 && scarceVia.every(function (v) { return v.by === gates[v.quest].by && v.rank === gates[v.quest].rank; }));

// ---------------------------------------------------------------- N
yes('N1 noSource is exactly the rows with no sources',
    JSON.stringify(table.noSource) === JSON.stringify(ids.filter(function (id) { return table.items[id].sources.length === 0; })));
yes('N2 an input nothing hands out stays in the table, so it can be seen: every live recipe input is a row',
    Object.keys(recipes.recipes).every(function (id) {
      const r = recipes.recipes[id];
      if (r.book === 'cut' || cutRecipe[id] || TEMPER.test(r.benchName || '')) { return true; }
      return (r.inputItems || []).every(function (it) { return it.item.toLowerCase() === 'f:skyrim.esm' || table.items[it.item]; });
    }));

// What asks for each item, which scripts/dev/Check-Makers.js reads as the
// recipe inputs the world must hand out (#3132).
const askWrong = [];
const goldAsks = [];
['recipes', 'unowned'].forEach(function (section) {
  Object.keys(recipes[section] || {}).forEach(function (id) {
    const r = recipes[section][id];
    const isLive = r.out && r.book !== 'cut' && !cutRecipe[id] && !TEMPER.test(r.benchName || '') && !/^BYOHBuilding/.test(r.benchName || '');
    (r.inputItems || []).forEach(function (it) {
      if (it.item.toLowerCase() === 'f:skyrim.esm') { if (isLive && goldAsks.indexOf(id) < 0) { goldAsks.push(id); } return; }
      const asks = ((table.items[it.item] || {}).askedBy || []).indexOf(id) >= 0;
      if (asks !== Boolean(isLive)) { askWrong.push(r.name + ' ' + id + ' -> ' + it.item); }
    });
  });
});
yes('N3 askedBy names every live recipe, owned or open, that asks for an item, and no dead one (' + askWrong.slice(0, 3).join(', ') + ')',
    askWrong.length === 0);
yes('N4 goldAskedBy is every live recipe that asks for gold, which no recipe may (#3115)',
    JSON.stringify(table.goldAskedBy) === JSON.stringify(goldAsks.sort()));
yes('N5 each hair dye\'s inputs and the water bottle\'s empty bottle are asked by them',
    dyes.dyes.every(function (d) {
      return d.inputs.every(function (it) { return ((table.items[it.item] || {}).askedBy || []).indexOf('hair-dye:' + d.id) >= 0; });
    }) && ids.some(function (id) { return (table.items[id].askedBy || []).indexOf('NEEDS.waterItems') >= 0; }));

// ---------------------------------------------------------------- P
function copyRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'item-sources-'));
  const files = table.readFrom.concat(['scripts/dev/Build-ItemSources.js', 'game/data/item-sources.json']);
  files.forEach(function (rel) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.copyFileSync(path.join(REPO, rel), path.join(dir, rel));
  });
  return dir;
}
function build(dir) {
  return spawnSync(process.execPath, [path.join(dir, 'scripts', 'dev', 'Build-ItemSources.js'), '--root', dir], { encoding: 'utf8' });
}
(function () {
  const dir = copyRoot();
  try {
    const plain = build(dir);
    yes('P1 the copy builds clean, and writes the table that is checked in',
        plain.status === 0 && fs.readFileSync(path.join(dir, 'game/data/item-sources.json'), 'utf8') ===
        fs.readFileSync(path.join(REPO, 'game/data/item-sources.json'), 'utf8'));
    const cutPath = path.join(dir, 'docs/systems/cut-items.json');
    const copy = JSON.parse(fs.readFileSync(cutPath, 'utf8'));
    copy.items.push({ id: 'cc842:Skyrim.esm', name: 'Ancient Nord Amulet', plugin: '', half: '', owner: '', family: '', rank: '', fires: true, disposition: 'cut', why: 'a harness row' });
    fs.writeFileSync(cutPath, JSON.stringify(copy));
    const found = build(dir);
    yes('P2 an item the cut list says is not found, which a dungeon chest hands out, is refused by name',
        found.status !== 0 && /PROBLEM\s+cc842:Skyrim\.esm/.test(found.stderr));
    fs.copyFileSync(path.join(REPO, 'docs/systems/cut-items.json'), cutPath);
    const recPath = path.join(dir, 'game/data/recipes.json');
    const rec = JSON.parse(fs.readFileSync(recPath, 'utf8'));
    const roll = Object.keys(rec.recipes).find(function (id) { return rec.recipes[id].roll; });
    const open = Object.keys(rec.recipes).find(function (id) {
      const r = rec.recipes[id];
      return !r.roll && !r.race && r.book !== 'cut' && r.owner === 'Smith';
    });
    rec.recipes[open] = Object.assign({}, rec.recipes[open], { out: rec.recipes[roll].out, name: rec.recipes[roll].name });
    fs.writeFileSync(recPath, JSON.stringify(rec));
    const leak = build(dir);
    yes('P3 a faction item a public bench also makes is refused by name',
        leak.status !== 0 && leak.stderr.indexOf('is faction work, yet') >= 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

// ---------------------------------------------------------------- L
const page = fs.readFileSync(path.join(REPO, 'docs', 'systems', 'lists', 'item-sources.md'), 'utf8');
yes('L1 the list page says the table\'s item count and how many have no source',
    page.indexOf(table.count + ' items') >= 0 && page.indexOf('## Nothing hands these out\n\n' + table.noSource.length + ' items') >= 0);
yes('L2 and every item with no source is on it', table.noSource.every(function (id) { return page.indexOf('`' + id + '`') >= 0; }));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
