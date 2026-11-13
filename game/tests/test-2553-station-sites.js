'use strict';
/*
  test-2553-station-sites.js

      node game/tests/test-2553-station-sites.js

  #2553, Patrick's A of 16 October 2026: Thornswood measures its own spots for
  its charcoal kilns, salt quarries, beehives and alchemy labs, the way the
  woodworking benches were placed (#516), and Thornswood-Content.esp places
  them. scripts/dev/Build-StationSites.py measures them over the load order
  into game/data/station-sites.json; scripts/mods/Add-ContentRecords.py
  places them from it. game/tests/test-2553-salvaged-gone.js holds the plugin to
  the table. This holds the table to its rules:

    T  every site names its kind, its anchor, its point and angle, its cell,
       and what was measured there (the ground under it, the nearest solid
       thing, why the cell's copy changes nothing); each placement has a form
       id of its own in the content plugin and the base of its kind
    K  the rules: a kiln in each of the nine towns with a woodworking bench,
       1,000 units or more from every bench (#2337); a salt quarry at each of
       the four hold capitals on the Sea of Ghosts; a hive at each named farm
       with 5 crop plots or more in its claim circle; a lab in the apothecary
       of each of the nine hold capitals, indoors; a study desk in each of
       the College's four halls (#1387)
    C  no two stations stand on top of each other
    B  the table was built against the collection's own bytes, and leaves
       out the content plugin it is written into; Thornswood's two plugins
       after it place nothing
    P  the docs page names every site

  On a machine with the game (C:\Thornswood\Game\Data, or THORNSWOOD_DATA)
  holding the collection's bytes it also runs the builder with --check: the
  plugins give the committed table.
*/
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const TABLE = path.join(ROOT, 'game', 'data', 'station-sites.json');
const BENCHES = path.join(ROOT, 'game', 'data', 'woodworking-benches.json');
const LAST = path.join(ROOT, 'game', 'data', 'last-plugin.json');
const COLLECTION = path.join(ROOT, 'records', 'collection-plugins.json');
const DOC = path.join(ROOT, 'docs', 'systems', 'station-placement.md');
const TOOL = path.join(ROOT, 'scripts', 'dev', 'Build-StationSites.py');
const CONTENT = 'Thornswood-Content.esp';
const BASES = {
  kiln: '1547e:Thornswood-Content.esp', salt: 'dde4ef:Thornswood-Content.esp',
  hive: 'dbf8b3:Thornswood-Content.esp', lab: '42e69:Thornswood-Content.esp',
  well: '18030:Thornswood-Content.esp', river: '18031:Thornswood-Content.esp',
  study: '18032:Thornswood-Content.esp',
};

let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

const table = JSON.parse(fs.readFileSync(TABLE, 'utf8'));
const sites = table.sites || {};
const names = Object.keys(sites).sort();
const of = (kind) => names.filter((n) => sites[n].kind === kind);
const desc = /^[0-9a-f]+:.+\.(esm|esp|esl)$/;

// ---------------------------------------------------------------- T
yes('T1 the table is the builder\'s, for #2553, with ' + names.length + ' sites',
    table.builtBy === 'scripts/dev/Build-StationSites.py' && table.issue === 2553 && names.length > 0);
yes('T2 each of the four kinds has its base, its rule and its count',
    Object.keys(BASES).every((k) => table.kinds[k] && table.kinds[k].base === BASES[k] &&
      typeof table.kinds[k].rule === 'string' && table.kinds[k].rule.length > 80 && table.kinds[k].count === of(k).length));
yes('T3 every site names its kind, where, anchor, point, angle, cell and space', names.every((n) => {
  const s = sites[n];
  return BASES[s.kind] && s.base === BASES[s.kind] && typeof s.where === 'string' && s.where.length > 3 &&
    desc.test(s.anchor) && desc.test(s.cell) && desc.test(s.space) && Array.isArray(s.pos) && s.pos.length === 3 &&
    s.pos.every(Number.isFinite) && Number.isFinite(s.angle) && s.angle >= 0 && s.angle < 360 &&
    typeof s.interior === 'boolean';
}));
const refs = names.map((n) => sites[n].ref);
yes('T4 each placement has a form id of its own in ' + CONTENT, refs.every((r) => /^[0-9a-f]+:Thornswood-Content\.esp$/.test(r)) &&
    new Set(refs).size === refs.length);
yes('T5 and what was measured there: the ground within the kind\'s flat, the station on its lowest point, 30 units or more to the nearest solid thing',
    names.every((n) => {
      const s = sites[n];
      const k = table.kinds[s.kind];
      return Array.isArray(s.groundUnder) && s.groundUnder[1] - s.groundUnder[0] <= k.flat + 0.2 &&
        Math.abs(s.pos[2] - s.groundUnder[0]) < 0.2 && (!s.nearest || s.nearest.units >= 30) &&
        s.fromAnchor <= k.reach + 1;
    }));
yes('T6 and why the copy of its cell, and of an exterior\'s worldspace, changes nothing in the game',
    names.every((n) => {
      const s = sites[n];
      const ok = (w) => typeof w === 'string' && /^(carried after the content plugin by|won by )/.test(w);
      return ok(s.cellCopy) && (s.interior || ok(s.worldCopy));
    }));

// ---------------------------------------------------------------- K
// A site whose rule finds no clear spot beside any of its anchors is left out,
// with every anchor tried and why, the way the benches skip a town (#516).
const skipped = table.skipped || {};
const left = Object.keys(skipped);
yes('K0 every site left out names its kind, its place, and each anchor tried with why it was refused (' + left.length + ')',
    left.every((n) => BASES[skipped[n].kind] && typeof skipped[n].where === 'string' && !sites[n] &&
      Array.isArray(skipped[n].triedAnchors) && skipped[n].triedAnchors.every((t) => desc.test(t.anchor) &&
        /^no clear spot within \d+ units \(/.test(t.why)) &&
      (skipped[n].triedAnchors.length > 0 || /^no .* stands in the open world within \d+ units/.test(skipped[n].why || '') ||
       // A well with no bucket of its own (#1382): not there, in a cell the plugin cannot carry, or beside one that has it.
       (skipped[n].kind === 'well' && /^(the well |it shares the bucket of well-\d+, \d+ units away)/.test(skipped[n].why || '')))));
const placesOf = (kind) => of(kind).map((n) => sites[n].where).concat(left.filter((n) => skipped[n].kind === kind)
  .map((n) => skipped[n].where)).sort();
const benches = JSON.parse(fs.readFileSync(BENCHES, 'utf8')).benches;
const kilns = of('kiln');
const benchTowns = Object.keys(benches).map((t) => benches[t].where).sort();
yes('K1 a kiln for each of the ' + benchTowns.length + ' towns with a woodworking bench, placed or left out with its reasons (' +
    kilns.length + ' placed)', JSON.stringify(placesOf('kiln')) === JSON.stringify(benchTowns));
yes('K2 every kiln stands 1,000 units or more from every woodworking bench (#2337)',
    kilns.every((n) => Object.keys(benches).every((t) =>
      Math.hypot(benches[t].pos[0] - sites[n].pos[0], benches[t].pos[1] - sites[n].pos[1]) >= 1000)));
yes('K3 every kiln is measured from its town\'s forge, out of doors in the open world',
    kilns.every((n) => !sites[n].interior && sites[n].space === '3c:Skyrim.esm' &&
      Object.keys(benches).some((t) => benches[t].where === sites[n].where && benches[t].forge === sites[n].point)));
yes('K4 a salt quarry for each hold capital on the Sea of Ghosts, placed out of doors or left out (' + of('salt').length + ' placed)',
    JSON.stringify(placesOf('salt')) === JSON.stringify(['Dawnstar', 'Solitude', 'Windhelm', 'Winterhold']) &&
    of('salt').every((n) => !sites[n].interior));
yes('K5 a hive for each named farm, out of doors with 5 crop plots or more within 2,400 units (' + of('hive').length + ' placed)',
    placesOf('hive').length >= 12 && of('hive').every((n) => !sites[n].interior && desc.test(sites[n].farm) &&
      sites[n].plotsWithin2400 >= 5) && new Set(of('hive').map((n) => sites[n].farm)).size === of('hive').length);
yes('K6 a lab for each of the nine hold capitals, indoors beside Skyrim\'s own lab (' + of('lab').length + ' placed)',
    placesOf('lab').length === 9 && of('lab').every((n) => sites[n].interior && /AlchemyWorkbench/.test(sites[n].anchorEdid)) &&
    ['Whiterun', 'Solitude', 'Windhelm', 'Riften', 'Markarth', 'Falkreath', 'Dawnstar', 'Morthal', 'Winterhold']
      .every((t) => placesOf('lab').some((w) => w.indexOf(t) >= 0)));

yes('K9 a study desk for each of the College\'s four halls, indoors in that hall (' + of('study').length + ' placed, #1387)',
    placesOf('study').length === 4 && of('study').every((n) => sites[n].interior && sites[n].space === sites[n].cell &&
      ['1380e:Skyrim.esm', '1380f:Skyrim.esm', 'cab91:Skyrim.esm', '13810:Skyrim.esm'].indexOf(sites[n].cell) >= 0) &&
    new Set(of('study').map((n) => sites[n].cell)).size === of('study').length);

yes("K7 Patrick's B: a kiln may stand among small plants and a salt vein is set into rock, and no other kind loosens",
    table.kinds.kiln.amongPlants === true && table.kinds.salt.setIntoRock === true &&
    ['hive', 'lab', 'study'].every((k) => table.kinds[k].amongPlants === false && table.kinds[k].setIntoRock === false) &&
    table.kinds.kiln.setIntoRock === false && table.kinds.salt.amongPlants === false);
yes("K8 only Solitude's and Markarth's kilns look 20,000 units out for a chopping block",
    kilns.every((n) => (sites[n].townReach || 0) === 0 || ['Solitude', 'Markarth'].indexOf(sites[n].where) >= 0));

// ---------------------------------------------------------------- C
const close = [];
for (let i = 0; i < names.length; i++) {
  for (let j = i + 1; j < names.length; j++) {
    const a = sites[names[i]], b = sites[names[j]];
    if (a.space === b.space && Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]) < 300) { close.push(names[i] + ' and ' + names[j]); }
  }
}
yes('C1 no two stations stand within 300 units of each other' + (close.length ? ' (' + close.join('; ') + ')' : ''), close.length === 0);

// ---------------------------------------------------------------- B
const order = JSON.parse(fs.readFileSync(LAST, 'utf8')).loadOrder;
const record = JSON.parse(fs.readFileSync(COLLECTION, 'utf8'));
const rec = {};
for (const r of record.plugins) { rec[r.name.toLowerCase()] = r; }
const built = table.builtAgainst || [];
yes('B1 the table records every plugin of the load order but the content plugin (' + built.length + ')',
    JSON.stringify(built.map((r) => r.name)) === JSON.stringify(order.filter((n) => n !== CONTENT)));
const other = built.filter((r) => !(rec[r.name.toLowerCase()] && rec[r.name.toLowerCase()].sha256.toLowerCase() === r.sha256 &&
  rec[r.name.toLowerCase()].size === r.size));
yes('B2 every one is the collection\'s own bytes, revision ' + record.revision +
    (other.length ? ' (not: ' + other.slice(0, 4).map((r) => r.name).join(', ') + '; rebuild the table)' : ''), other.length === 0);
function placements(b) {
  let n = 0;
  (function walk(p, end) {
    while (p + 24 <= end) {
      const tag = b.toString('latin1', p, p + 4);
      const size = b.readUInt32LE(p + 4);
      if (tag === 'GRUP') { walk(p + 24, p + size); p += size; continue; }
      if (tag === 'REFR') { n++; }
      p += 24 + size;
    }
  })(24 + b.readUInt32LE(4), b.length);
  return n;
}
// Thornswood-Last.esp places nothing new: its only placed references are the
// three town gates it overrides where they stand, without their lock (#2484),
// and the floor items it switches off (#3077, each one initially disabled:
// tests/test-3077-floor-items.js P1). Neither is a station, so the table need
// not read them. No repository holds the plugin since #2791 step 3, so this
// reads it made from its recipe out of the game's plugins
// (tests/last-plugin-made.js), and prints SKIP without the game.
const lastMade = require('../../tests/last-plugin-made.js').made();
const lastCounts = JSON.parse(fs.readFileSync(LAST, 'utf8')).counts || {};
const lastGates = lastCounts.gatesUnlocked;
if (lastMade.buf) {
  // And the hold-only plants and ores it switches off outside their hold (#3150).
  const holdOff = ((JSON.parse(fs.readFileSync(LAST, 'utf8')).holdOnly || {}).off || []).length;
  yes('B3 Thornswood-Last.esp places only the town gates it unlocks (' + lastGates + '), the floor items it switches off (' +
      lastCounts.floorItemsOff + ') and the hold-only plants and ores it switches off (' + holdOff + '), so the table need not read it',
      lastGates === 3 && placements(lastMade.buf) === lastGates + (lastCounts.floorItemsOff || 0) + holdOff);
} else {
  console.log('SKIP  B3: ' + lastMade.why);
}

// ---------------------------------------------------------------- P
const doc = fs.existsSync(DOC) ? fs.readFileSync(DOC, 'utf8') : '';
yes('P1 docs/systems/station-placement.md names every site\'s place, and every one left out', !!doc &&
    names.every((n) => doc.indexOf(sites[n].where) >= 0) && left.every((n) => doc.indexOf(skipped[n].where) >= 0));

// ---------------------------------------------------------------- R
function python(args) {
  for (const exe of ['python', 'py', 'python3']) {
    const p = spawnSync(exe, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
    if (!p.error) { return p; }
  }
  return null;
}
const data = process.env.THORNSWOOD_DATA || 'C:\\Thornswood\\Game\\Data';
if (fs.existsSync(path.join(data, 'Skyrim.esm'))) {
  const run = python([TOOL, '--check', '--data', data]);
  const said = run ? run.stdout + run.stderr : '';
  if (run && run.status === 2) {
    console.log('SKIP  R1: the game at ' + data + ' is not the collection\'s load order:');
    console.log(said.split('\n').filter((l) => /STOP/.test(l)).join('\n'));
  } else {
    yes('R1 read again from the plugins at ' + data + ', every spot is clear and gives the committed table', !!run && run.status === 0);
    if (!run || run.status !== 0) { console.log(said); }
  }
} else {
  console.log('SKIP  R1: no game at ' + data + ' (a machine with the game reads the plugins again)');
}
done();
