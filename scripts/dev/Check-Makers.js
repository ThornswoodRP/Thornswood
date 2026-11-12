// Check-Makers.js
//
// Everything the server itself puts into a pack has somebody who makes it or
// gathers it (#3132). Patrick, 22 Oct 2026, on his report page: everything in
// the world has a recipe except named uniques and quest items (docs/DECIDED.md,
// Items and coin). Before this nothing held a new loot row to that, so the
// dungeon table grew bread, ale, bows, gems, soul gems and every college tome
// that no trade could make, and two of its rows named a second record of a
// common item (an orichalcum ingot and a petty soul gem) that no bench asks
// for and no producer gives.
//
//   node scripts/dev/Check-Makers.js           check, exit 1 on any problem
//   node scripts/dev/Check-Makers.js --write   write the list page, then check
//
// WHAT THE SERVER HANDS OUT and WHO MAKES OR GATHERS AN ITEM are both read
// from game/data/item-sources.json, the one table of where every item comes
// from (#3145, scripts/dev/Build-ItemSources.js, which game/tests/test-3145-item-sources.js
// holds current). Nothing here reads the recipe, class or loot tables for
// sources a second time.
//   Handed out: a found source (the dungeon and body loot: GOODS, TOMES,
//     EXCLUSIVE, docs/systems/dungeon-loot.md), a start source (a new
//     character's clothes, a class pick's tool, a farmer's first seeds), and
//     anything a live recipe, a hair dye or the water bottle asks for
//     (askedBy), since that recipe is dead until somebody can make or gather
//     each of its inputs. Gold a recipe asks for is goldAskedBy, since gold is
//     never a row.
//   Made or gathered: a crafted, race, faction, gathered or quest source.
// Merchants are not on it: an NPC trader sells only stock somebody sold or
// hauled to it (the merchant ledger), so nothing there comes from nothing.
// The alchemy lab makes no record: a bottle it brews is a new form above
// 0xff000000 (docs/systems/professions/alchemist.md), so a potion record the
// world hands out needs a maker of its own like anything else.
//
// AN ITEM NOBODY MAKES YET is a failure unless Check-Makers.waiting.json names
// it with the open issue that gives it a maker. An entry that now has a maker,
// or that the world no longer hands out, is a failure too, so the file cannot
// grow stale. Named uniques and quest items go in its exempt list with why.
//
// Read only apart from docs/systems/lists/who-makes-it.md with --write.
// game/tests/test-3132-makers.js runs it on every pull request.
'use strict';
const fs = require('fs');
const path = require('path');

const SOURCES = path.join('game', 'data', 'item-sources.json');
const PAGE = path.join('docs', 'systems', 'lists', 'who-makes-it.md');
const WAITING = path.join('scripts', 'dev', 'Check-Makers.waiting.json');
const GOLD = { desc: 'f:Skyrim.esm', name: 'Gold' };
// The kinds of source item-sources.json has that make or gather an item. A
// company ware is a riekling recipe, which its race row already names.
const MAKER_KINDS = ['crafted', 'race', 'faction', 'gathered', 'quest'];
// The halves whose work is a menu at their bench rather than recipe rows, so a
// count of 0 is not "nothing to do" (docs/systems/professions/alchemist.md and
// enchanter.md).
const MENU_WORK = {
  'Alchemist/Blightbrewer': 'brews poisons in the alchemy lab\'s menu, which has no recipe rows',
  'Alchemist/Physicker': 'also brews medicine in the alchemy lab\'s menu, which has no recipe rows',
  'Enchanter/Wardweaver': 'enchants armour and clothing in the arcane enchanter\'s menu, which has no recipe rows',
  'Enchanter/Bladebinder': 'also enchants in the arcane enchanter\'s menu'
};
const CLASSES = ['Farmer', 'Fisher', 'Gatherer', 'Hunter', 'Miner'];

function key(desc) { return String(desc).toLowerCase(); }
function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

function readJson(root, rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

/** Who a maker source in item-sources.json is, as the page writes it. */
function makerText(v) {
  const rank = v.rank ? ', ' + v.rank : '';
  if (v.kind === 'gathered') return (v.by === 'anybody' ? 'Anybody' : cap(v.by)) + rank;
  if (v.kind === 'quest') return (v.by ? cap(v.by) + rank + ', ' : '') + 'only while the ' + v.quest + ' work is open';
  const who = v.by === 'anybody' ? 'Anybody' : v.by;
  if (v.kind === 'race') return who + rank + ', ' + cap(v.race) + ' only';
  if (v.kind === 'faction') return who + rank + ', the ' + v.roll + ' roll only';
  return who + rank;
}

/** Where a found or start source has it, as the page writes it. */
function handedText(v) {
  const t = String(v.table || '');
  if (v.kind === 'found') return /tomes/.test(t) ? 'Dungeon and body loot, tomes' : /exclusive/.test(t) ? 'Dungeon exclusive' : 'Dungeon and body loot';
  if (/TOOLS/.test(t)) return 'A class pick\'s tool';
  if (/chargen/.test(t)) return 'A new character\'s clothes';
  return 'A farmer\'s first seeds';
}

/** What an askedBy entry is, as the page writes it. */
function askerText(rec, sources, by) {
  const owned = rec.recipes[by];
  if (owned) return owned.half + ': ' + owned.name;
  const open = (rec.unowned || {})[by];
  if (open) return 'Anybody: ' + open.name;
  if (sources.items[by]) return 'Hair dye: ' + sources.items[by].name;
  return by;
}

function measure(root) {
  root = root || path.join(__dirname, '..', '..');
  const sources = readJson(root, SOURCES.split(path.sep).join('/'));
  const rec = readJson(root, 'game/data/recipes.json');
  const waiting = readJson(root, WAITING.split(path.sep).join('/'));
  const exempt = new Map((waiting.exempt || []).map(e => [key(e.desc), e]));
  const wait = new Map((waiting.items || []).map(e => [key(e.desc), e]));
  const who = new Map();
  const rows = new Map();
  function handed(desc, name, by, recipe) {
    const k = key(desc);
    const row = rows.get(k) || { desc: desc, name: name || desc, by: [], makers: Array.from(who.get(k) || []).sort() };
    if (row.by.indexOf(by) < 0) row.by.push(by);
    if (recipe) { row.recipes = row.recipes || []; if (row.recipes.indexOf(recipe) < 0) row.recipes.push(recipe); }
    rows.set(k, row);
  }
  for (const [desc, item] of Object.entries(sources.items)) {
    const made = item.via.filter(v => MAKER_KINDS.indexOf(v.kind) >= 0).map(makerText);
    if (made.length) who.set(key(desc), new Set(made));
  }
  for (const [desc, item] of Object.entries(sources.items)) {
    for (const v of item.via) if (v.kind === 'found' || v.kind === 'start') handed(desc, item.name, handedText(v));
    for (const by of item.askedBy || []) {
      if (by === 'NEEDS.waterItems') handed(desc, item.name, 'Filled into a bottle of water');
      else handed(desc, item.name, 'Asked for by a recipe', askerText(rec, sources, by));
    }
  }
  for (const by of sources.goldAskedBy || []) handed(GOLD.desc, GOLD.name, 'Asked for by a recipe', askerText(rec, sources, by));
  const madeByName = new Map();
  const written = new Map(Object.keys(sources.items).map(d => [key(d), d]));
  for (const [k] of who) {
    const n = String(sources.items[written.get(k)].name || '').toLowerCase();
    if (n && !madeByName.has(n)) madeByName.set(n, k);
  }
  const problems = [];
  for (const row of rows.values()) {
    const k = key(row.desc);
    if (row.makers.length) {
      if (wait.has(k)) problems.push(row.name + ' (' + row.desc + ') is in ' + WAITING + ' but ' + row.makers.join('; ') + ' makes it now. Take its entry out.');
      continue;
    }
    if (exempt.has(k)) { row.exempt = exempt.get(k); continue; }
    if (wait.has(k)) {
      const w = wait.get(k);
      if (!/^#\d+$/.test(String(w.issue || ''))) problems.push(row.name + ' (' + row.desc + ') waits in ' + WAITING + ' with no issue number.');
      row.waiting = w;
      continue;
    }
    // A same-named record somebody does make: the row names the wrong record.
    const twin = madeByName.get(String(row.name).toLowerCase());
    if (twin && twin !== k) {
      problems.push(row.name + ' (' + row.desc + '), from ' + row.by.join(', ') + ', is a record nobody makes. The trades make ' +
        sources.items[written.get(twin)].name + ' as ' + written.get(twin) + ': name that record.');
      continue;
    }
    problems.push(row.name + ' (' + row.desc + '), from ' + row.by.join(', ') + ', has nobody who makes or gathers it. ' +
      'Give it a maker, or name it in ' + WAITING + ' with the issue that will.');
  }
  for (const [k, w] of wait) {
    if (!rows.has(k)) problems.push(w.name + ' (' + w.desc + ') is in ' + WAITING + ' but the world no longer hands it out. Take its entry out.');
  }
  for (const [k, e] of exempt) {
    if (!rows.has(k)) problems.push(e.name + ' (' + e.desc + ') is exempt in ' + WAITING + ' but the world no longer hands it out. Take its entry out.');
    if (!e.why) problems.push(e.name + ' (' + e.desc + ') is exempt with no reason.');
  }
  return { rows: Array.from(rows.values()), problems: problems, trades: trades(rec, sources) };
}

/** What each half and class makes or gathers, counted by distinct item. */
function trades(rec, sources) {
  const out = [];
  const byWho = new Map();
  function count(who, desc) {
    if (!byWho.has(who)) byWho.set(who, new Set());
    byWho.get(who).add(key(desc));
  }
  for (const [desc, item] of Object.entries(sources.items)) {
    for (const v of item.via) {
      // A half's recipe rows, open book only, as item-sources.json reads them.
      if (v.recipe && v.by && v.by !== 'anybody' && ['crafted', 'race', 'faction'].indexOf(v.kind) >= 0) count(v.by, desc);
      // A class's own work, and the scarce draws and rare seams it works.
      if ((v.kind === 'gathered' || v.kind === 'quest') && CLASSES.indexOf(cap(v.by)) >= 0) count(cap(v.by), desc);
    }
  }
  for (const [p, info] of Object.entries(rec.professions)) {
    if (!info.halves) { out.push({ who: p, items: 0, note: info.why }); continue; }
    for (const h of info.halves) {
      const k = p + '/' + h;
      out.push({ who: k, items: (byWho.get(k) || new Set()).size, note: info.craftsAtAll ? (MENU_WORK[k] || '') : info.why });
    }
  }
  for (const c of CLASSES) out.push({ who: c, items: (byWho.get(c) || new Set()).size, note: '', isClass: true });
  return out;
}

function cell(s) { return String(s == null ? '' : s).replace(/\|/g, '/').replace(/\r?\n/g, ' ').trim(); }

function page(result) {
  const rows = result.rows.slice().sort((a, b) => String((a.waiting || {}).issue || '').localeCompare(String((b.waiting || {}).issue || '')) ||
    a.by[0].localeCompare(b.by[0]) || a.name.localeCompare(b.name));
  const none = rows.filter(r => !r.makers.length);
  const L = [];
  L.push('# Who makes what the world hands out');
  L.push('');
  L.push('Generated by `scripts/dev/Check-Makers.js` from the server\'s own tables, as `game/data/item-sources.json` reads them. Do not edit it by hand: run `node scripts/dev/Check-Makers.js --write`.');
  L.push('');
  L.push('Everything in the world has a recipe except named uniques and quest items (Patrick, 22 October 2026, #3132). ' +
    'The world here is what the server puts into a pack from nothing: the dungeon and body loot ([Dungeon loot](../dungeon-loot.md)), ' +
    'a new character\'s clothes, the tool a class pick hands over, a farmer\'s first seeds, and whatever a recipe in the open book, a hair dye or a bottle of water asks for. A trader sells only what somebody sold or hauled to it, so traders are not on this page.');
  L.push('');
  L.push('What the world hands out and who makes it both come from [Where every item comes from](item-sources.md) (`game/data/item-sources.json`). A maker is a recipe in the open book (not cut and not tempering), a class that gathers the item, or the scarce work or rare seam a class works. A bottle the alchemy lab brews is a new form, not a record, so the lab is the maker of no record. ' +
    'The build fails when the world hands out something with no maker that `scripts/dev/Check-Makers.waiting.json` does not name with the issue that will give it one.');
  L.push('');
  L.push(rows.length + ' items handed out. ' + (rows.length - none.length) + ' have a maker. ' + none.length + ' have none yet.');
  L.push('');
  L.push('## Nobody makes these yet');
  L.push('');
  if (!none.length) L.push('None.');
  else {
    L.push('| Item | Where the world has it | Recipes that wait on it | Waiting on | Why |');
    L.push('| --- | --- | --- | --- | --- |');
    for (const r of none) {
      const w = r.waiting || r.exempt || {};
      L.push('| ' + cell(r.name) + ' | ' + cell(r.by.join(', ')) + ' | ' + (r.recipes || []).length + ' | ' +
        cell(r.exempt ? 'exempt' : w.issue) + ' | ' + cell(w.why) + ' |');
    }
  }
  L.push('');
  L.push('## What each trade makes or gathers');
  L.push('');
  L.push('Distinct items, open book only. A profession half that makes nothing from a recipe row may still have work at its bench, which the note says.');
  L.push('');
  L.push('| Who | Items | Note |');
  L.push('| --- | --- | --- |');
  // A path in a note (scripts\\dev\\Build-SpellTable.ps1) is code, not prose.
  for (const t of result.trades) {
    L.push('| ' + cell(t.who) + ' | ' + t.items + ' | ' + cell(t.note).replace(/[\w.-]*\w(?:\\[\w.-]*\w)+/g, '`$&`') + ' |');
  }
  L.push('');
  L.push('## Every item and its maker');
  L.push('');
  L.push('| Item | Where the world has it | Who makes or gathers it | Id |');
  L.push('| --- | --- | --- | --- |');
  for (const r of rows) {
    if (!r.makers.length) continue;
    L.push('| ' + cell(r.name) + ' | ' + cell(r.by.join(', ')) + ' | ' + cell(r.makers.join('; ')) + ' | `' + r.desc + '` |');
  }
  L.push('');
  return L.join('\n');
}

function run(root, write) {
  root = root || path.join(__dirname, '..', '..');
  const result = measure(root);
  const want = page(result);
  const file = path.join(root, PAGE);
  if (write) fs.writeFileSync(file, want, 'utf8');
  const have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\r').join('') : '';
  if (have !== want) result.problems.push(PAGE.split(path.sep).join('/') + ' is out of date. Run node scripts/dev/Check-Makers.js --write and commit it.');
  return result;
}

module.exports = { measure: measure, page: page, run: run };

if (require.main === module) {
  const result = run(null, process.argv.indexOf('--write') >= 0);
  const none = result.rows.filter(r => !r.makers.length).length;
  console.log(result.rows.length + ' items handed out, ' + (result.rows.length - none) + ' with a maker, ' + none + ' waiting.');
  for (const p of result.problems) console.log('FAIL  ' + p);
  process.exit(result.problems.length ? 1 : 0);
}
