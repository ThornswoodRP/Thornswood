// Write-SystemLists.js
//
// Turns the checked-in tables into the lists under docs/systems/lists.
// Read only apart from those markdown files. Run it after a recipe, harvest,
// ore or hunt table changes so the plan and the tables stay the same list.
//
//   node scripts/dev/Write-SystemLists.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'systems', 'lists');
const RECIPES = path.join(ROOT, 'game', 'data', 'recipes.json');
const HARVESTS = path.join(ROOT, 'game', 'data', 'harvests.json');
const ORES = path.join(ROOT, 'game', 'data', 'ores.json');
const HUNTS = path.join(ROOT, 'game', 'data', 'hunts.json');
const RACES = path.join(ROOT, 'game', 'data', 'races.json');
const SOURCES = path.join(ROOT, 'game', 'data', 'item-sources.json');

function clean(s) {
  return String(s == null ? '' : s)
    .replace(/\u2014/g, ',')
    .replace(/\u2013/g, '-')
    .replace(/\|/g, '/')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function benchShort(name) {
  return clean(name).replace(/^Crafting/, '');
}

function inputsOf(row) {
  const items = row.inputItems || [];
  if (!items.length) { return ''; }
  return items.map(function (it) {
    return (it.count || 1) + ' ' + clean(it.name || it.item);
  }).join(', ');
}

function write(file, body) {
  fs.writeFileSync(path.join(OUT, file), body, 'utf8');
}

function head(title, from, what) {
  return '# ' + title + '\n\n' +
    'Generated from `' + from + '` by `scripts/dev/Write-SystemLists.js`. ' +
    what + '\n\n';
}

const recipes = JSON.parse(fs.readFileSync(RECIPES, 'utf8'));
const harvests = JSON.parse(fs.readFileSync(HARVESTS, 'utf8'));
const ores = JSON.parse(fs.readFileSync(ORES, 'utf8'));
const hunts = JSON.parse(fs.readFileSync(HUNTS, 'utf8'));
const races = JSON.parse(fs.readFileSync(RACES, 'utf8'));
const sources = JSON.parse(fs.readFileSync(SOURCES, 'utf8'));

fs.mkdirSync(OUT, { recursive: true });

const ranks = ['novice', 'advanced', 'expert', 'master'];
const byHalf = {};
const anybody = [];
const refused = [];
const gated = [];
const raceRows = [];

Object.keys(recipes.recipes || {}).forEach(function (id) {
  const row = recipes.recipes[id];
  row._id = id;
  if (row.book === 'cut') { return; }
  if (row.roll) { gated.push(row); return; }
  if (row.race) { raceRows.push(row); }
  if (!row.owner || !row.half) { anybody.push(row); return; }
  const key = row.owner + '/' + row.half;
  if (!byHalf[key]) { byHalf[key] = []; }
  byHalf[key].push(row);
});

Object.keys(recipes.unowned || {}).forEach(function (id) {
  const row = recipes.unowned[id];
  row._id = id;
  anybody.push(row);
});

Object.keys(recipes.refused || {}).forEach(function (id) {
  const row = recipes.refused[id];
  row._id = id;
  refused.push(row);
});

function recipeTable(rows) {
  const lines = ['| Item | Makes | Rank | Kind | Bench | Asks for | Race | Server asked | Id |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  rows.sort(function (a, b) {
    const ar = ranks.indexOf(a.rank);
    const br = ranks.indexOf(b.rank);
    if (ar !== br) { return ar - br; }
    const af = clean(a.family);
    const bf = clean(b.family);
    if (af !== bf) { return af < bf ? -1 : 1; }
    const an = clean(a.name);
    const bn = clean(b.name);
    if (an !== bn) { return an < bn ? -1 : 1; }
    return clean(a.editorId) < clean(b.editorId) ? -1 : 1;
  });
  rows.forEach(function (row) {
    lines.push('| ' + [
      clean(row.name || row.editorId),
      row.makes || 1,
      clean(row.rank),
      clean(row.family),
      benchShort(row.benchName),
      inputsOf(row),
      clean(row.race),
      row.fires === false ? 'no' : 'yes',
      '`' + clean(row._id) + '`'
    ].join(' | ') + ' |');
  });
  return lines.join('\n') + '\n';
}

const index = ['# Recipe and work lists', '',
  'Every row the recipe, harvest, ore and hunt tables currently hold. ' +
  'The pages that say what a profession or a class is are next to this folder. ' +
  'These lists are the items.',
  ''];

Object.keys(byHalf).sort().forEach(function (key) {
  const rows = byHalf[key];
  const file = key.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.md';
  const asked = rows.filter(function (r) { return r.fires !== false; }).length;
  let body = head(key, 'game/data/recipes.json',
    rows.length + ' recipes, ' + asked + ' of them reach the server. ' +
    'A row the server is not asked about is tempering: the armour table and the grindstone never call the server.');
  const byRank = {};
  rows.forEach(function (r) {
    const k = r.rank || 'unranked';
    byRank[k] = (byRank[k] || 0) + 1;
  });
  body += 'By rank: ' + ranks.map(function (r) {
    return r + ' ' + (byRank[r] || 0);
  }).join(', ') + '.\n\n';
  body += recipeTable(rows);
  write(file, body);
  index.push('- [' + key + '](' + file + ') (' + rows.length + ', ' + asked + ' reach the server)');
});

gated.sort(function (a, b) { return clean(a.name) < clean(b.name) ? -1 : 1; });
let gatedBody = head('Embassy and remnant rolls', 'game/data/recipes.json',
  gated.length + ' recipes are not a public bench. An embassy row needs the embassy roll. A thalmor row needs the remnant roll.');
gatedBody += '| Item | Roll | Half | Rank | Id |\n| --- | --- | --- | --- | --- |\n';
gated.forEach(function (row) {
  gatedBody += '| ' + clean(row.name) + ' | ' + clean(row.roll) + ' | ' + clean(row.half) + ' | ' + clean(row.rank) + ' | `' + clean(row._id) + '` |\n';
});
write('roll-gates.md', gatedBody);
index.push('- [Embassy and remnant rolls](roll-gates.md) (' + gated.length + ')');
anybody.sort(function (a, b) { return clean(a.name) < clean(b.name) ? -1 : 1; });
write('anybody.md', head('Anybody may make these', 'game/data/recipes.json',
  anybody.length + ' recipes with no profession. Smelting and tanning live here.') +
  recipeTable(anybody));
index.push('- [Anybody](anybody.md) (' + anybody.length + ')');

let refusedBody = head('Refused', 'game/data/recipes.json',
  refused.length + ' recipes the server refuses. House nails, hinges, locks and fittings.');
refusedBody += '| Item | Bench | Why | Id |\n| --- | --- | --- | --- |\n';
refused.forEach(function (row) {
  refusedBody += '| ' + clean(row.name) + ' | ' + benchShort(row.benchName) + ' | ' +
    clean(row.why) + ' | `' + clean(row._id) + '` |\n';
});
write('refused.md', refusedBody);
index.push('- [Refused](refused.md) (' + refused.length + ')');

raceRows.sort(function (a, b) {
  if (clean(a.race) !== clean(b.race)) { return clean(a.race) < clean(b.race) ? -1 : 1; }
  return clean(a.name) < clean(b.name) ? -1 : 1;
});
let raceBody = head('Race locked recipes', 'game/data/recipes.json',
  raceRows.length + ' recipes carry a race. Only the named race can make them. ' +
  'A material named for a people, such as Elven or Orcish or Nordic Carved, is not in this list.');
let lastRace = '';
raceRows.forEach(function (row) {
  if (row.race !== lastRace) {
    lastRace = row.race;
    raceBody += '\n## ' + clean(row.race) + '\n\n';
  }
  raceBody += '- ' + clean(row.name) + ' (' + clean(row.rank) + ', ' +
    clean(row.owner || 'anybody') + '/' + clean(row.half || 'none') + ', `' +
    clean(row._id) + '`)\n';
});
write('race-locks.md', raceBody);
index.push('- [Race locks](race-locks.md) (' + raceRows.length + ')');

// Where every item comes from (#3145), off scripts/dev/Build-ItemSources.js.
// The page lists what is not ordinary bench or class work, because that is
// what the balance against race, company, faction and quest goods (#3135)
// reads; the bench and class rows are on their own pages already.
(function () {
  const kinds = Object.keys(sources.kinds);
  // What asks for an item is the table's askedBy: a live recipe by id, a hair
  // dye by its row, or the water bottle.
  function askerName(by) {
    const row = (recipes.recipes || {})[by] || (recipes.unowned || {})[by];
    if (row) { return clean(row.name); }
    if (sources.items[by]) { return clean(sources.items[by].name); }
    return by === 'NEEDS.waterItems' ? 'a bottle of water' : by;
  }
  function nameOf(id) { return clean(sources.items[id].name) || '(no name in any table)'; }
  function byName(a, b) {
    const an = nameOf(a).toLowerCase();
    const bn = nameOf(b).toLowerCase();
    if (an !== bn) { return an < bn ? -1 : 1; }
    return a < b ? -1 : 1;
  }
  function viaText(v) {
    const parts = [v.kind];
    ['by', 'race', 'roll', 'quest', 'rank'].forEach(function (k) { if (v[k]) { parts.push(clean(v[k])); } });
    if (v.tier) { parts.push('tier ' + v.tier); }
    if (v.table && v.kind !== 'crafted') { parts.push('(' + clean(v.table) + ')'); }
    return parts.join(' ');
  }
  function viaAll(id) {
    const seen = {};
    return sources.items[id].via.map(viaText).filter(function (t) {
      if (seen[t]) { return false; }
      seen[t] = true;
      return true;
    }).join('; ');
  }
  let body = head('Where every item comes from', 'game/data/item-sources.json',
    sources.count + ' items: everything somebody can come to hold, and every input a live recipe asks for. ' +
    'Each is marked with every way it comes into the world. `scripts/dev/Build-ItemSources.js` builds the table; ' +
    'run it, then this script, after a recipe, work, quest or dungeon table changes. ' +
    'Balance is what a thing takes to make or get plus its stats, never gold.');
  body += '| Kind | What it means | Items | Only this |\n| --- | --- | --- | --- |\n';
  kinds.forEach(function (k) {
    body += '| ' + k + ' | ' + clean(sources.kinds[k]) + ' | ' + sources.counts[k] + ' | ' + sources.only[k] + ' |\n';
  });
  body += '\nNot a source: ' + clean(sources.notSources) + '.\n';
  body += '\n## Nothing hands these out\n\n' + sources.noSource.length +
    ' items a live recipe asks for, or a hair dye or a bottle of water needs, that no recipe, class, quest, dungeon or starting kit hands out. ' +
    'Every recipe that asks for one of them cannot be made.\n\n';
  body += '| Item | Asked for by | Id |\n| --- | --- | --- |\n';
  sources.noSource.slice().sort(byName).forEach(function (id) {
    const by = Array.from(new Set((sources.items[id].askedBy || []).map(askerName))).sort();
    const shown = by.length > 6 ? by.slice(0, 6).join(', ') + ' and ' + (by.length - 6) + ' more' : by.join(', ');
    body += '| ' + nameOf(id) + ' | ' + shown + ' | `' + id + '` |\n';
  });
  const sections = [
    ['quest', 'Only from a quest', 'Drawn only while a merchant\'s scarce work is open, a rare seam its quest opens, or a retrieval token.'],
    ['found', 'Only found', 'Created only by a dungeon chest or a body.'],
    ['faction', 'Faction work', 'Only the embassy roll or the remnant roll may make these.'],
    ['race', 'Race work', 'Only the named race may make these. An item also made by another source shows it.'],
    ['company', 'Company wares', 'The Free Skyrim Trading Company\'s wares.'],
    ['start', 'Handed to a new character', 'The first clothes, a class\'s tool and a farmer\'s first seeds, with whatever else makes them.']
  ];
  sections.forEach(function (sec) {
    const k = sec[0];
    const ids = Object.keys(sources.items).filter(function (id) {
      const s = sources.items[id].sources;
      return (k === 'quest' || k === 'found') ? (s.length === 1 && s[0] === k) : s.indexOf(k) >= 0;
    }).sort(byName);
    body += '\n## ' + sec[1] + '\n\n' + ids.length + ' items. ' + sec[2] + '\n\n';
    body += '| Item | Sources | Id |\n| --- | --- | --- |\n';
    ids.forEach(function (id) { body += '| ' + nameOf(id) + ' | ' + viaAll(id) + ' | `' + id + '` |\n'; });
  });
  write('item-sources.md', body);
  index.push('- [Where every item comes from](item-sources.md) (' + sources.count + ' items, ' + sources.noSource.length + ' with no source)');
})();

const playable = [];
Object.keys(races.items || {}).forEach(function (id) {
  const r = races.items[id];
  if (r.p) { playable.push(clean(r.n || r.e) + ' (`' + id + '`)'); }
});
playable.sort();
write('playable-races.md', head('Races a person can be', 'game/data/races.json',
  playable.length + ' races have the playable bit set.') +
  playable.map(function (n) { return '- ' + n; }).join('\n') + '\n');
index.push('- [Playable races](playable-races.md) (' + playable.length + ')');

function distinctWork(title, from, bag, extra, opts) {
  opts = opts || {};
  const groups = {};
  Object.keys(bag).forEach(function (id) {
    const row = bag[id];
    const name = clean(row.name || id);
    const rank = clean(row.rank);
    const key = name + '\0' + rank;
    if (!groups[key]) {
      groups[key] = {
        name: name, rank: rank, n: 0, gives: {}, world: {},
        yield: row.yield, grow: {}
      };
    }
    const g = groups[key];
    g.n++;
    if (row.gives && row.gives.length) {
      row.gives.forEach(function (part) {
        g.gives[clean(part.name)] = true;
      });
    } else if (row.name) {
      g.gives[clean(row.name)] = true;
    }
    if (row.from) { g.world[clean(row.from)] = true; }
    if (row.growMinutes != null) { g.grow[String(row.growMinutes)] = true; }
    if (opts.world) {
      const world = opts.world(id, row);
      if (world) { g.world[clean(world)] = true; }
    }
  });
  const rows = Object.keys(groups).map(function (k) { return groups[k]; });
  rows.sort(function (a, b) {
    const ar = ranks.indexOf(a.rank);
    const br = ranks.indexOf(b.rank);
    if (ar !== br) { return ar - br; }
    return a.name < b.name ? -1 : 1;
  });
  const showWorld = rows.some(function (row) { return Object.keys(row.world).length; });
  const showGrow = rows.some(function (row) { return Object.keys(row.grow).length; });
  const showYield = rows.some(function (row) { return row.yield; });
  const heads = ['Name', 'Rank', 'Records', 'You receive'];
  if (showWorld) { heads.push('In the world'); }
  if (showGrow) { heads.push('Grow minutes'); }
  if (showYield) { heads.push('Yield novice, advanced, expert, master'); }
  let table = '| ' + heads.join(' | ') + ' |\n| ' + heads.map(function () { return '---'; }).join(' | ') + ' |\n';
  rows.forEach(function (row) {
    const cells = [
      row.name,
      row.rank,
      String(row.n),
      Object.keys(row.gives).sort().join(', ')
    ];
    if (showWorld) { cells.push(Object.keys(row.world).sort().join(', ')); }
    if (showGrow) { cells.push(Object.keys(row.grow).sort(function (a, b) { return Number(a) - Number(b); }).join(', ')); }
    if (showYield) {
      cells.push(row.yield ? row.yield.map(function (pair) { return pair[0] + '-' + pair[1]; }).join(', ') : '');
    }
    table += '| ' + cells.join(' | ') + ' |\n';
  });
  const body = head(title, from, rows.length + ' rows, ' +
    Object.keys(bag).length + ' placed records. ' + (extra || '')) + table;
  return { body: body, names: rows.length, records: Object.keys(bag).length, table: table };
}

function harvestWorld(id) {
  const detail = harvests.detail && harvests.detail[id];
  return detail && detail.name ? detail.name : '';
}

const classFiles = [
  ['miner.md', 'Miner', 'game/data/ores.json', ores.ores,
    'A pair of zeroes means that rank cannot work the seam. Yield is least-most per swing: 1, and a chance of one more. An ore has no gold price.',
    {}],
  ['gatherer.md', 'Gatherer', 'game/data/harvests.json', harvests.harvests,
    'Reagents. One pick is one of the produce. The rank is the rank on the row. A plant has no gold price. Wheat is in this table and is a crop: the server treats it as the farmer\'s.',
    { world: harvestWorld }],
  ['farmer.md', 'Farmer', 'game/data/harvests.json', harvests.crops,
    'Ranked by how hard the crop is to grow. A crop has no gold price. Grow minutes are the novice wait, before the rank multiplier.',
    {}],
  ['fisher.md', 'Fisher', 'game/data/harvests.json', harvests.fish,
    'Pressed at the water. No rod. A fish has no gold price.',
    {}],
  ['hunter.md', 'Hunter', 'game/data/hunts.json', hunts.hunts,
    'Only a hunter loots the body. Yield is least-most of each part. The rank is the rank on the row. A part has no gold price.',
    {}]
];

const classGot = {};
classFiles.forEach(function (spec) {
  const got = distinctWork(spec[1], spec[2], spec[3] || {}, spec[4], spec[5]);
  write(spec[0], got.body);
  classGot[spec[0]] = got;
  index.push('- [' + spec[1] + '](' + spec[0] + ') (' + got.names + ' rows, ' + got.records + ' records)');
});

if (harvests.game) {
  const got = distinctWork('Eggs and wild food', 'game/data/harvests.json', harvests.game,
    'The harvest table\'s game list, separate from a hunter\'s carcass.');
  write('wild-food.md', got.body);
  index.push('- [Eggs and wild food](wild-food.md) (' + got.names + ')');
}
if (harvests.unranked) {
  const got = distinctWork('Unranked world plants', 'game/data/harvests.json', harvests.unranked,
    'In the harvest file with no rank. The plan\'s ranks, and which of these are the farmer\'s, are on the gatherer page.');
  write('unranked.md', got.body);
  index.push('- [Unranked](unranked.md) (' + got.names + ')');
}

// Written by scripts/dev/Check-Makers.js, which the gate runs (#3132).
index.push('- [Who makes what the world hands out](who-makes-it.md)');
index.push('');
write('README.md', index.join('\n') + '\n');

// The profession and class pages carry the same rows, so a count is not
// the only place the item lives. Markers keep the hand-written rules.
function spellBook() {
  // The gamemode's SPELL_IDS table (game/gamemode-tables, #5191).
  const book = require(path.join(ROOT, 'scripts', 'dev', 'GamemodeTables.js')).read('SPELL_IDS');
  const flat = {};
  Object.keys(book).forEach(function (name) {
    flat[name.toLowerCase().replace(/[^a-z0-9]/g, '')] = name;
  });
  return { book: book, flat: flat };
}

function inBook(flat, editorId) {
  if (!editorId) { return ''; }
  const key = String(editorId).toLowerCase().replace(/[^a-z0-9]/g, '');
  return flat[key] ? 'yes, ' + flat[key] : 'no';
}

function spellOf(row) {
  const needs = row.needs || [];
  for (let i = 0; i < needs.length; i++) {
    if (needs[i].ofType === 'SPEL') { return clean(needs[i].of); }
  }
  return '';
}

function namesByRank(rows, onlyAsked) {
  const lines = [];
  ranks.forEach(function (rank) {
    const names = [];
    const seen = {};
    rows.forEach(function (row) {
      if (onlyAsked && row.fires === false) { return; }
      if (clean(row.rank) !== rank) { return; }
      const name = clean(row.name || row.editorId);
      if (seen[name]) { return; }
      seen[name] = true;
      names.push(name);
    });
    names.sort();
    if (!names.length) {
      lines.push('**' + rank.charAt(0).toUpperCase() + rank.slice(1) + '.** None.');
      return;
    }
    const word = names.length === 1 ? 'name' : 'names';
    lines.push('**' + rank.charAt(0).toUpperCase() + rank.slice(1) + '** (' + names.length + ' ' + word + '). ' + names.join('. ') + '.');
  });
  return lines.join('\n\n');
}

// What sets the rank on a half's rows, said on its page. The dearest
// ingredient a class produces, except the Bladebinder's staves: Patrick,
// 4 October (#1622), each college book staff at its spell's rank, below the
// master heart stone every staff asks for (RECIPE_RANK in Build-RecipeTable.ps1).
function rankSentence(key) {
  if (key === 'Enchanter/Bladebinder') {
    return 'The rank on the row is the rank. It is the rank of the staff\'s spell in the college book, not the dearest ingredient: every staff asks for heart stone, which is master mining, so a Bladebinder below master buys it. An item has no gold price.\n\n';
  }
  return 'The rank on the row is the rank. It is the dearest ingredient a class produces. An item has no gold price.\n\n';
}

function spliceDetail(rel, markdown) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    console.log('skip missing ' + rel);
    return;
  }
  let text = fs.readFileSync(file, 'utf8');
  const begin = '<!-- detail:begin -->';
  const end = '<!-- detail:end -->';
  const block = begin + '\n\n' + markdown.trim() + '\n\n' + end;
  if (text.indexOf(begin) !== -1 && text.indexOf(end) !== -1) {
    text = text.replace(new RegExp(begin + '[\\s\\S]*?' + end), block);
  } else {
    const marker = '\n## Where this is\n';
    const at = text.indexOf(marker);
    if (at === -1) { text = text.trimEnd() + '\n\n' + block + '\n'; }
    else { text = text.slice(0, at) + '\n' + block + '\n' + text.slice(at); }
  }
  fs.writeFileSync(file, text, 'utf8');
}

const spells = spellBook();

Object.keys(byHalf).sort().forEach(function (key) {
  const rows = byHalf[key];
  const file = key.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.md';
  const owner = key.split('/')[0].toLowerCase();
  const half = key.split('/')[1].toLowerCase();
  const rel = 'docs/systems/professions/' + owner + '/' + half + '.md';
  const link = '../../lists/' + file;
  const asked = rows.filter(function (r) { return r.fires !== false; });
  const silent = rows.length - asked.length;
  const temperSentence = silent === 0
    ? 'None of them are tempering.'
    : (silent + ' are tempering and do not.');
  let body = '## Every recipe\n\n' +
    'Generated from `game/data/recipes.json` by `scripts/dev/Write-SystemLists.js`. ' +
    rows.length + ' recipes. ' + asked.length + ' reach the server. ' +
    temperSentence + ' The same rows, with ids, are in [' +
    file.replace('.md', '') + '](' + link + ').\n\n' +
    rankSentence(key) +
    '### Names that reach the server\n\n' +
    namesByRank(rows, true) + '\n\n';
  if (key === 'Enchanter/Bladebinder') {
    let inBookCount = 0;
    let spellRows = 0;
    rows.forEach(function (row) {
      const spell = spellOf(row);
      if (!spell) { return; }
      spellRows++;
      if (inBook(spells.flat, spell).indexOf('yes') === 0) { inBookCount++; }
    });
    body += 'The spell column is the HasSpell the crafting menu asks for. ' +
      'In the college book means that editor id is one of the spells on the mage pages. ' +
      inBookCount + ' of ' + spellRows + ' staves ask for a spell that is in that book. ' +
      'The rest name a mod spell. A staff whose spell is not in the book can sit at novice in this table and still be unmakeable, because the menu will not list it for someone who was never granted the spell.\n\n';
    const lines = ['| Item | Rank | Bench | Asks for | Spell the menu asks for | In the college book |',
      '| --- | --- | --- | --- | --- | --- |'];
    rows.slice().sort(function (a, b) {
      const ar = ranks.indexOf(a.rank);
      const br = ranks.indexOf(b.rank);
      if (ar !== br) { return ar - br; }
      return clean(a.name) < clean(b.name) ? -1 : 1;
    }).forEach(function (row) {
      const spell = spellOf(row);
      lines.push('| ' + [
        clean(row.name),
        clean(row.rank),
        benchShort(row.benchName),
        inputsOf(row),
        spell,
        inBook(spells.flat, spell)
      ].join(' | ') + ' |');
    });
    body += lines.join('\n') + '\n';
  } else {
    body += recipeTable(rows);
  }
  spliceDetail(rel, body);
});

const classPages = {
  'miner.md': 'docs/systems/classes/miner.md',
  'gatherer.md': 'docs/systems/classes/gatherer.md',
  'farmer.md': 'docs/systems/classes/farmer.md',
  'fisher.md': 'docs/systems/classes/fisher.md',
  'hunter.md': 'docs/systems/classes/hunter.md'
};
Object.keys(classPages).forEach(function (file) {
  const got = classGot[file];
  if (!got) { return; }
  spliceDetail(classPages[file],
    '## Every record\n\n' +
    'Generated from the work tables by `scripts/dev/Write-SystemLists.js`. ' +
    'The same rows are in [' + file.replace('.md', '') + '](../lists/' + file + ').\n\n' +
    got.table);
});

const schoolOrder = ['novice', 'advanced', 'expert', 'master'];
const schoolPages = {
  destruction: 'docs/systems/professions/mage/destruction.md',
  restoration: 'docs/systems/professions/mage/restoration.md',
  alteration: 'docs/systems/professions/mage/alteration.md',
  conjuration: 'docs/systems/professions/mage/conjuration.md',
  illusion: 'docs/systems/professions/mage/illusion.md'
};
const spellLists = {
  destruction: {
    novice: ['Flames', 'Frostbite', 'Sparks'],
    advanced: ['Firebolt', 'Ice Spike', 'Lightning Bolt', 'Fireball', 'Ice Storm', 'Chain Lightning', 'Flame Cloak', 'Frost Cloak', 'Lightning Cloak'],
    expert: ['Incinerate', 'Icy Spear', 'Thunderbolt', 'Wall of Flames', 'Wall of Frost', 'Wall of Storms'],
    master: ['Fire Storm', 'Blizzard', 'Lightning Storm']
  },
  restoration: {
    novice: ['Healing', 'Lesser Ward'],
    advanced: ['Healing Hands', 'Fast Healing', 'Steadfast Ward', 'Turn Undead', 'Close Wounds', 'Heal Other', 'Greater Ward', 'Repel Lesser Undead'],
    expert: ['Grand Healing', 'Circle of Protection', 'Repel Undead', 'Turn Greater Undead'],
    master: ['Guardian Circle', 'Bane of the Undead']
  },
  alteration: {
    novice: ['Candlelight', 'Oakflesh'],
    advanced: ['Magelight', 'Stoneflesh', 'Detect Life', 'Ironflesh', 'Telekinesis', 'Waterbreathing'],
    expert: ['Ebonyflesh', 'Paralyze', 'Detect Dead'],
    master: ['Dragonhide', 'Mass Paralysis']
  },
  conjuration: {
    novice: ['Conjure Familiar', 'Raise Zombie', 'Bound Sword'],
    advanced: ['Conjure Flame Atronach', 'Reanimate Corpse', 'Bound Battleaxe', 'Soul Trap', 'Conjure Frost Atronach', 'Banish Daedra', 'Revenant', 'Bound Bow'],
    expert: ['Conjure Storm Atronach', 'Dread Zombie', 'Conjure Dremora Lord', 'Expel Daedra', 'Command Daedra'],
    master: ['Dead Thrall', 'Flame Thrall', 'Frost Thrall', 'Storm Thrall']
  },
  illusion: {
    novice: ['Courage', 'Clairvoyance', 'Fury'],
    advanced: ['Calm', 'Fear', 'Muffle', 'Frenzy', 'Rally', 'Invisibility'],
    expert: ['Pacify', 'Rout', 'Call to Arms'],
    master: ['Harmony', 'Hysteria', 'Mayhem']
  }
};
Object.keys(schoolPages).forEach(function (school) {
  const lines = ['## The book', '',
    'Generated from the spell book and the gamemode\'s `SPELL_IDS` table by `scripts/dev/Write-SystemLists.js`. ' +
    'Apprentice and Adept are both Advanced. A blank id means the name is in the book and not yet granted.',
    '',
    '| Spell | Rank | Id |',
    '| --- | --- | --- |'];
  schoolOrder.forEach(function (rank) {
    (spellLists[school][rank] || []).forEach(function (name) {
      const id = spells.book[name] ? '`' + spells.book[name] + '`' : '';
      lines.push('| ' + name + ' | ' + rank + ' | ' + id + ' |');
    });
  });
  spliceDetail(schoolPages[school], lines.join('\n'));
});

console.log('wrote ' + fs.readdirSync(OUT).length + ' files to ' + OUT);
