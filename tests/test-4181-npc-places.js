// test-4181-npc-places.js
//
// Issue #4181: the Locations table on docs/NPC-POPULATION.md took each
// place's hold, habitat and tier from its first NPC and its count from all of
// them. The open ground of Tamriel was one row of 218 under Falkreath, though
// they stand in nine holds, so the place rows gave Falkreath 603 while the
// hold table gave 401. Faldar's Tooth read as a bandit camp of 20 when it is
// 7 bandits and 13 animals.
//
// Build-NpcPopulation.py (place_table) now writes one row for each hold,
// habitat and tier among a place's NPCs, with the roles that make up the
// count. This holds the page to what it is written from:
//
//   1. the place rows add up, hold by hold, to the page's own hold table;
//   2. every row is one hold, habitat and tier of one place, with the count
//      and roles game/data/NPC-SPAWNS.csv (the same retained rows, written
//      by the same run) gives it, and no row is missing or extra;
//   3. the generator builds the table from each NPC, not from a place's
//      first one.
//
// Read only.
//
//     node tests/test-4181-npc-places.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + why : '')); }
}
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/^﻿/, '').split('\r').join(''); }

/* RFC 4180 rows: a quoted field may hold a comma or a doubled quote. */
function csv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; }
      else { field += c; }
    } else if (c === '"') { quoted = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else { field += c; }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length === head.length)
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const page = read('docs/NPC-POPULATION.md');
const spawns = csv(read('game/data/NPC-SPAWNS.csv'));
const builder = read('scripts/dev/Build-NpcPopulation.py');

// ------------------------------------------------------- the page's tables
const holdTable = {};
const holdPart = page.slice(page.indexOf('| Hold | Retained NPCs |'), page.indexOf('## Locations'));
for (const line of holdPart.split('\n')) {
  const m = /^\| ([^|]+) \| ([\d,]+) \|$/.exec(line);
  if (m) { holdTable[m[1]] = Number(m[2].replace(/,/g, '')); }
}
const places = page.slice(page.indexOf('## Locations')).split('\n')
  .filter((l) => /^\| /.test(l) && !/^\| Location \|/.test(l))
  .map((l) => {
    const c = l.split('|').slice(1, -1).map((s) => s.trim());
    return { name: c[0], hold: c[1], habitat: c[2], tier: c[3], count: Number(c[4]), who: c[5], minutes: c[6] };
  });
yes('the page has a hold table and a Locations table (' + Object.keys(holdTable).length + ' holds, ' + places.length + ' place rows)',
    Object.keys(holdTable).length > 0 && places.length > 0);
yes('the Locations table says who makes up each count',
    /\| Location \| Hold \| Habitat \| Tier \| NPC count \| Who \| Return minutes \|/.test(page));

// ------------------------------------------------- 1. rows add up by hold
const byHold = {};
for (const p of places) { byHold[p.hold] = (byHold[p.hold] || 0) + p.count; }
const off = Object.keys(Object.assign({}, holdTable, byHold))
  .filter((h) => holdTable[h] !== byHold[h])
  .map((h) => h + ': place rows ' + (byHold[h] || 0) + ', hold table ' + (holdTable[h] || 0));
yes('the place rows add up to the hold table, hold by hold', off.length === 0, off.join('; '));

// ------------------------------------- 2. each row is what the NPCs have
const groups = new Map();
for (const r of spawns) {
  const key = [r.location, r.hold, r.habitat, r.tier].join('\u0001');
  if (!groups.has(key)) { groups.set(key, []); }
  groups.get(key).push(r);
}
function sig(p) { return [p.name, p.hold, p.habitat, p.tier, p.count, p.who, p.minutes].join(' | '); }
const want = [...groups.values()].map((rs) => {
  const roles = {};
  for (const r of rs) { roles[r.role] = (roles[r.role] || 0) + 1; }
  return sig({ name: rs[0].locationName.replace(/\|/g, '/'), hold: rs[0].hold, habitat: rs[0].habitat, tier: rs[0].tier,
    count: rs.length,
    who: Object.keys(roles).sort().map((k) => k + ' ' + roles[k]).join(', '),
    minutes: [...new Set(rs.map((r) => Number(r.returnMinutes)))].sort((a, b) => a - b).join(', ') });
}).sort();
const have = places.map(sig).sort();
const missing = want.filter((w) => have.indexOf(w) < 0);
const extra = have.filter((h) => want.indexOf(h) < 0);
yes('every place row is one hold, habitat and tier of one place, as NPC-SPAWNS.csv has it (' + spawns.length + ' NPCs, ' + want.length + ' rows)',
    missing.length === 0 && extra.length === 0,
    'not on the page: ' + missing.slice(0, 3).join(' ; ') + ' / not in the spawns: ' + extra.slice(0, 3).join(' ; '));
const faldar = places.filter((p) => p.name === "Faldar's Tooth");
yes("Faldar's Tooth reads as 7 bandits and 13 animals, not a bandit camp of 20 enemies (" + faldar.map(sig).join(' ; ') + ')',
    faldar.length === 1 && faldar[0].who === 'animal 13, enemy 7');
const openGround = spawns.filter((r) => r.locationName === 'open ground in Tamriel' && r.location === 'd74:Skyrim.esm');
const openHolds = new Set(openGround.map((r) => r.hold));
yes('the open ground of Tamriel is split by hold (' + openHolds.size + ' holds), not filed under one',
    openHolds.size > 1 && [...openHolds].every((h) => places.some((p) => p.name === 'open ground in Tamriel' && p.hold === h)));

// ----------------------------------------------------- 3. the generator
const writer = builder.slice(builder.indexOf('def write_catalogues('), builder.indexOf('def write_merchants('));
yes('the generator writes the Locations table with place_table, from every retained NPC',
    /lines \+= \[''\] \+ place_table\(kept\)/.test(writer) && /def place_table\(kept\):/.test(writer));
yes("and no longer takes a place's hold, habitat or tier from its first NPC on the page",
    !/payload\['locations'\]/.test(writer));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
