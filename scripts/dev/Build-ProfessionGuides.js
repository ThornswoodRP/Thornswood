#!/usr/bin/env node
'use strict';
/*
  Build-ProfessionGuides.js (#3165)

      node scripts/dev/Build-ProfessionGuides.js           write the GUIDES block
      node scripts/dev/Build-ProfessionGuides.js --check   fail when it is stale

  The K panel's Profession guides page, one page per profession (Patrick's
  answer A on #3165, 22 Oct: "a page per profession on the K panel"). Each
  page says what the profession makes, where its materials come from and how
  it ranks up. Every fact on it is read here out of what the server itself
  runs on, so the page cannot say something the server does not do:

    game/data/recipes.json        the rows the recipe book counts (every row
                                  not marked book "cut", the same 643 rows
                                  the gamemode's RECIPES_BY_ID table carries
                                  with a half), their families and ranks, and
                                  what each one asks for, with the class that
                                  gathers it and the rung that class needs
    game/data/mine-buildings.json which mines hold which ore, by vein count
    game/data/hunts.json          which animals give which part
    game/gamemode-tables          BENCH_ACCESS (who each bench opens for, at
                                  which rank, #5191)
    game/gamemode.js              MANEUVERS (a warrior's), and
                                  the numbers of the ladder: workPerRank, the
                                  rest a piece costs, CRAFT_REST, partyBonus,
                                  a mage's study work and TOOL_USES

  It writes one line into game/ui/thornswood-skills.js, between

      // ==== PROFESSION_GUIDES ====
      // ==== end PROFESSION_GUIDES ====

  The page is a browser drawn over a running Skyrim, and the server sends the
  panel on every write, so the guide rides in the page's own file rather than
  on the character's property: it is the same for everybody, and a person's
  own rank and count on it come from the panel the server already sends.

  The sentences around these facts are the page's own (GUIDE_TEXT in
  thornswood-skills.js). tests/test-3165-profession-guides.js holds the two
  together and runs --check.
*/
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const UI = path.join(ROOT, 'game', 'ui', 'thornswood-skills.js');
const GAMEMODE = path.join(ROOT, 'game', 'gamemode.js');
const TABLES = require('./GamemodeTables.js');
const BEGIN = '  // ==== PROFESSION_GUIDES ====\n';
const END = '  // ==== end PROFESSION_GUIDES ====\n';

const RANKS = ['novice', 'advanced', 'expert', 'master'];
// The profession keys of the K panel, in its order, and the halves of each.
const PROFESSIONS = ['warrior', 'mage', 'alchemist', 'cook', 'smith', 'enchanter', 'tailor', 'woodworker'];

/*
  What a person calls each bench, by the keyword BENCH_ACCESS names it by.
  The same words as docs/systems/professions.md's bench table. A bench that
  opens for a half and is not named here stops the build, so a new bench is
  given a name rather than shown as a keyword.
*/
const BENCH_WORDS = {
  BYOHCraftingOven: 'Oven',
  CraftingCookpot: 'Cookpot',
  isGrainMill: 'Grain mill',
  ThornswoodCraftingCharcoalKiln: 'Charcoal kiln',
  ThornswoodCraftingWoodworking: 'Woodworking bench',
  ThornswoodCraftingAlchemy: 'Alchemy lab',
  'the alchemy lab': 'Alchemy lab',
  'the arcane enchanter': 'Arcane enchanter',
  DLC2StaffEnchanter: 'Staff enchanter',
  CraftingSmithingSkyforge: 'Skyforge',
  DLC1CraftingDawnguard: 'Dawnguard bench',
  CraftingSmithingForge: 'Forge',
  CraftingTanningRack: 'Tanning rack',
  MCE_CraftingLoom: 'Loom',
  CraftingSmelter: 'Smelter'
};

// How many materials a page lists, how many places beside each, and how many
// things it names as a first piece of work for each half.
const MATERIALS = 10;
const PLACES = 3;
const FIRST_WORK = 4;

function readJson(...bits) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, ...bits), 'utf8').replace(/^﻿/, ''));
}

/** The one match of re in text, or a stop that names what is missing. */
function one(text, re, what) {
  const all = text.match(new RegExp(re.source, 'g')) || [];
  if (all.length !== 1) { throw new Error('game/gamemode.js needs exactly one ' + what + ', found ' + all.length); }
  return re.exec(text);
}

/** The numbers of the ladder, out of the gamemode's own tuning. */
function ladderOf(gm) {
  const per = one(gm, /workPerRank: \{ advanced: (\d+), expert: (\d+), master: (\d+) \}/, 'workPerRank');
  const rest = one(gm, /\n {4}work: \{ novice: ([\d.]+), advanced: ([\d.]+), expert: ([\d.]+), master: ([\d.]+) \},/, 'needs work rest line');
  const craftRest = one(gm, /var CRAFT_REST = (\d+);/, 'CRAFT_REST');
  const party = one(gm, /partyBonus: ([\d.]+),/, 'partyBonus');
  const study = one(gm, /study: \{ perSpell: (\d+), perRank: (\d+) \}/, 'study');
  const tool = one(gm, /\nconst TOOL_USES = (\d+);/, 'TOOL_USES');
  return {
    per: { advanced: Number(per[1]), expert: Number(per[2]), master: Number(per[3]) },
    rest: { novice: Number(rest[1]), advanced: Number(rest[2]), expert: Number(rest[3]), master: Number(rest[4]) },
    craftRest: Number(craftRest[1]),
    party: Math.round(Number(party[1]) * 100),
    perSpell: Number(study[1]),
    perRank: Number(study[2]),
    toolUses: Number(tool[1])
  };
}

/** Each half's benches, as [ words, the lowest rank it opens at ], lowest rank first. */
function benchesOf(gm) {
  // The gamemode reads BENCH_ACCESS from its table file (#5191); gm is kept
  // for the callers that still read the gamemode's own lines.
  const access = TABLES.read('BENCH_ACCESS');
  const out = {};
  for (const id of Object.keys(access).sort()) {
    const b = access[id];
    if (b.shut || !b.halves) { continue; }
    for (const half of Object.keys(b.halves)) {
      const words = BENCH_WORDS[b.name];
      if (!words) { throw new Error('bench ' + b.name + ' (' + id + ') opens for ' + half + ' and has no name in BENCH_WORDS'); }
      const rank = b.halves[half];
      const list = out[half] = out[half] || [];
      const had = list.find(function (x) { return x[0] === words; });
      if (had) { if (RANKS.indexOf(rank) < RANKS.indexOf(had[1])) { had[1] = rank; } }
      else { list.push([words, rank]); }
    }
  }
  for (const half of Object.keys(out)) {
    out[half].sort(function (a, b) { return RANKS.indexOf(a[1]) - RANKS.indexOf(b[1]) || (a[0] < b[0] ? -1 : 1); });
  }
  return out;
}

/** A warrior's maneuvers, by half, in rank order: [ name, rank, stamina, seconds of wait ]. */
function maneuversOf(gm) {
  const start = gm.indexOf('  var MANEUVERS = {');
  const stop = start < 0 ? -1 : gm.indexOf('\n  };', start);
  if (start < 0 || stop < 0) { throw new Error('game/gamemode.js has no MANEUVERS table'); }
  const table = new Function('return ' + gm.slice(gm.indexOf('{', start), stop + 4))();
  const out = {};
  for (const key of Object.keys(table)) {
    const r = table[key];
    (out[r.half] = out[r.half] || []).push([r.name, r.rank, r.stamina, r.cooldown]);
  }
  for (const half of Object.keys(out)) {
    out[half].sort(function (a, b) { return RANKS.indexOf(a[1]) - RANKS.indexOf(b[1]); });
  }
  return out;
}

/** Every ore, by name, with the mines that hold it, most veins first. */
function minesByOre() {
  const m = readJson('game', 'data', 'mine-buildings.json');
  const out = {};
  for (const id of Object.keys(m.buildings)) {
    const b = m.buildings[id];
    for (const ore of Object.keys(b.ores || {})) {
      (out[ore] = out[ore] || []).push({ name: b.name, veins: b.ores[ore] });
    }
  }
  for (const ore of Object.keys(out)) {
    out[ore].sort(function (a, b) { return b.veins - a.veins || (a.name < b.name ? -1 : 1); });
  }
  return out;
}

/*
  Every animal part, by name, with the animals that give it. An animal with a
  name of its own (a unique, one record) is left out where its kind is there:
  the page names kinds of animal, the ones a hunter meets more than once.
*/
function animalsByPart() {
  const h = readJson('game', 'data', 'hunts.json');
  const records = {};
  for (const id of Object.keys(h.hunts)) { records[h.hunts[id].name] = (records[h.hunts[id].name] || 0) + 1; }
  const out = {};
  for (const id of Object.keys(h.hunts)) {
    const a = h.hunts[id];
    for (const g of a.gives || []) {
      const list = out[g.name] = out[g.name] || [];
      if (list.indexOf(a.name) < 0) { list.push(a.name); }
    }
  }
  for (const part of Object.keys(out)) {
    out[part].sort(function (a, b) { return records[b] - records[a] || (a < b ? -1 : 1); });
  }
  return { out: out, records: records };
}

/** Every recipe of recipes.json by its editor id, owned, unowned and refused alike. */
function recipesByEditorId(recipes) {
  const out = {};
  for (const part of ['recipes', 'unowned', 'refused']) {
    for (const id of Object.keys(recipes[part] || {})) {
      const r = recipes[part][id];
      if (r && r.editorId && !out[r.editorId]) { out[r.editorId] = r; }
    }
  }
  return out;
}

function placesFor(item, who, mines, animals) {
  if (who === 'miner' && mines[item]) {
    return { list: mines[item].slice(0, PLACES).map(function (x) { return x.name; }), more: Math.max(0, mines[item].length - PLACES) };
  }
  if (who === 'hunter' && animals.out[item]) {
    // Kinds first: a unique stands in only where nothing else gives the part.
    const all = animals.out[item];
    const kinds = all.filter(function (n) { return animals.records[n] > 1; });
    const list = (kinds.length ? kinds : all);
    return { list: list.slice(0, PLACES), more: Math.max(0, list.length - PLACES) };
  }
  return null;
}

/*
  One material a profession's recipes ask for:
    [ name, recipes that ask for it, class, rank, bench it is made at or '',
      [ what that bench makes it out of ], [ where ], how many more places ]
  The class and rank are the ones the recipe table records: the class whose
  work the input rests on and the rung that class has to reach to gather it.
*/
function materialsOf(rows, byEditor, mines, animals) {
  const seen = {};
  for (const row of rows) {
    for (const inp of row.inputItems || []) {
      const m = seen[inp.name] = seen[inp.name] || { name: inp.name, uses: 0, inp: inp };
      m.uses++;
    }
  }
  const list = Object.keys(seen).map(function (k) { return seen[k]; });
  list.sort(function (a, b) { return b.uses - a.uses || (a.name < b.name ? -1 : 1); });
  return list.slice(0, MATERIALS).map(function (m) {
    const inp = m.inp;
    const who = inp.suppliedBy || inp.producedBy || '';
    const at = inp.suppliedAt || inp.producedAt || '';
    let bench = '', from = [], where = null;
    if (inp.hops >= 1 && inp.suppliedVia) {
      const via = byEditor[inp.suppliedVia];
      if (via && BENCH_WORDS[via.benchName]) { bench = BENCH_WORDS[via.benchName]; }
      const raw = (via && via.inputItems) || [];
      from = raw.map(function (x) { return x.name; });
      // Where the dearest of what it is made from is found: the one the rank
      // was set by, which is the one a person has to go furthest for.
      const dear = raw.slice().sort(function (a, b) {
        return RANKS.indexOf(b.suppliedAt || b.producedAt) - RANKS.indexOf(a.suppliedAt || a.producedAt);
      })[0];
      if (dear) { where = placesFor(dear.name, dear.suppliedBy || dear.producedBy, mines, animals); }
    } else {
      where = placesFor(inp.name, who, mines, animals);
    }
    return [m.name, m.uses, who, at, bench, from, where ? where.list : [], where ? where.more : 0];
  });
}

/*
  One half's recipes: [ family, novice, advanced, expert, master ] most rows
  first, the first things a novice can make, and how many rows ask for a race.
  The rows are the recipe book's: not cut, and not a roll's (the server's
  book counts neither), so the page and the book agree on every number.
*/
function halfOf(rows) {
  const fam = {};
  for (const r of rows) {
    const f = fam[r.family] = fam[r.family] || [r.family, 0, 0, 0, 0];
    f[1 + Math.max(0, RANKS.indexOf(r.rank))]++;
  }
  const families = Object.keys(fam).map(function (k) { return fam[k]; });
  families.sort(function (a, b) { return (b[1] + b[2] + b[3] + b[4]) - (a[1] + a[2] + a[3] + a[4]) || (a[0] < b[0] ? -1 : 1); });
  /*
    The first things a new novice can make: rows at novice that Skyrim lists
    with no perk, spell or item first (canBeMadeOnDayOne, the book's open) and
    no race. One from each family, the families with the most such rows
    first, so a Platewright reads a cuirass and a helmet rather than four
    ingots that happen to sort first.
  */
  const day1 = rows.filter(function (r) { return r.rank === 'novice' && r.canBeMadeOnDayOne === true && !r.race; });
  const byFam = {};
  for (const r of day1) { (byFam[r.family] = byFam[r.family] || []).push(r.name); }
  const first = Object.keys(byFam)
    .sort(function (a, b) { return byFam[b].length - byFam[a].length || (a < b ? -1 : 1); })
    .map(function (f) { return byFam[f].slice().sort()[0]; })
    .filter(function (n, i, all) { return all.indexOf(n) === i; })
    .slice(0, FIRST_WORK);
  return { count: rows.length, families: families, first: first,
           race: rows.filter(function (r) { return !!r.race; }).length };
}

function guides() {
  const gm = fs.readFileSync(GAMEMODE, 'utf8');
  const recipes = readJson('game', 'data', 'recipes.json');
  const byEditor = recipesByEditorId(recipes);
  const mines = minesByOre();
  const animals = animalsByPart();
  const benches = benchesOf(gm);
  const maneuvers = maneuversOf(gm);
  const book = Object.keys(recipes.recipes).map(function (k) { return recipes.recipes[k]; })
    .filter(function (r) { return r.book !== 'cut' && !r.roll && r.half; });

  const out = { ladder: ladderOf(gm), professions: {} };
  for (const key of PROFESSIONS) {
    const name = key.charAt(0).toUpperCase() + key.slice(1);
    const p = recipes.professions[name];
    if (!p) { throw new Error('game/data/recipes.json names no profession ' + name); }
    const page = { halves: {} };
    const mine = book.filter(function (r) { return r.owner === name; });
    for (const halfName of p.halves || []) {
      const half = halfName.toLowerCase();
      const rows = mine.filter(function (r) { return r.half === halfName; });
      const h = halfOf(rows);
      h.benches = benches[half] || [];
      if (maneuvers[half]) { h.maneuvers = maneuvers[half]; }
      page.halves[half] = h;
    }
    page.materials = materialsOf(mine, byEditor, mines, animals);
    out.professions[key] = page;
  }
  return out;
}

function block() {
  return BEGIN +
    '  /* Built by scripts/dev/Build-ProfessionGuides.js out of game/data and game/gamemode.js. Do not hand edit. */\n' +
    '  var GUIDES = ' + JSON.stringify(guides()) + ';\n' +
    END;
}

function build(uiText) {
  const a = uiText.indexOf(BEGIN);
  const b = uiText.indexOf(END);
  if (a < 0 || b < a || uiText.indexOf(BEGIN, a + 1) >= 0) {
    throw new Error('game/ui/thornswood-skills.js needs exactly one PROFESSION_GUIDES block');
  }
  return uiText.slice(0, a) + block() + uiText.slice(b + END.length);
}

if (require.main === module) {
  /*
    Read and compared with LF line ends, and written back with the ends the
    file came with: a Windows checkout with core.autocrlf holds this file
    CRLF, and a marker searched for with \n alone would not be found there.
  */
  const raw = fs.readFileSync(UI, 'utf8');
  const crlf = raw.indexOf('\r\n') >= 0;
  const now = raw.split('\r\n').join('\n');
  const next = build(now);
  if (process.argv.includes('--check')) {
    if (next !== now) {
      console.log('PROFESSION_GUIDES in game/ui/thornswood-skills.js is stale: run node scripts/dev/Build-ProfessionGuides.js');
      process.exit(1);
    }
    console.log('PASS PROFESSION_GUIDES matches game/data and game/gamemode.js');
    process.exit(0);
  }
  if (next === now) { console.log('PROFESSION_GUIDES is already up to date'); process.exit(0); }
  fs.writeFileSync(UI, crlf ? next.split('\n').join('\r\n') : next, 'utf8');
  console.log('wrote PROFESSION_GUIDES into game/ui/thornswood-skills.js');
}

module.exports = { build, guides, BENCH_WORDS };
