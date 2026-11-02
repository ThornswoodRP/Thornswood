'use strict';
/*
  test-3150-hold-only.js

  #3150. Patrick: "for the specfic things for holds we can make it so they
  only spawn within that hold but not only the holds that way if you are in
  that hold you can just grab it but not while in a differnet hod". His page
  answer, 22 Oct 2026 (A): each hold has 2 to 3 hold-only plants, ores or
  animals (docs/DECIDED.md).

  scripts/mods/Build-LastPlugin.py (step 10) switches every placed reference of
  a hold-only plant or ore off in game/content/Thornswood-Last.esp wherever it
  stands outside its hold, the way it switches off a floor item (#3077): no
  machine draws it and the server's reader never makes it. The ones in their
  hold stay. game/data/last-plugin-policy.json holdOnly names which, each with
  what scripts/dev/Measure-HoldResources.py measured.

  This reads the committed policy, manifest and gamemode, and the plugin made
  from its recipe (tests/last-plugin-made.js: no repository holds the plugin
  since #2791 step 3, so P prints SKIP without the game), and holds them
  together:

    H  the policy names plants and ores only, each by a produce the plant or
       ore table gives under that name, each in one of the nine holds, none
       twice, and every hold has 2 or 3 of them
    M  the manifest was built from that policy: the same resources, each with
       placements left standing in its hold, and its counts add up
    P  every reference the manifest switches off is in the plugin, initially
       disabled, keeping only its base and place, and its base is a base of
       its resource
    D  the gatherer and miner pages (docs/systems/classes) name every one
    G  the ones the server holds off instead are in the gamemode's
       HELD_BY_SERVER block

  On a machine with the game, Build-LastPlugin.py --verify reads the plugin
  back in the load order and finds every placement outside its hold off and
  none in it.
*/
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'game', 'data');
const lastMade = require('./last-plugin-made.js').made();
const COMPRESSED = 0x00040000, DISABLED = 0x800, DELETED = 0x20;
const NINE = ['WhiterunHoldLocation', 'HaafingarHoldLocation', 'RiftHoldLocation', 'ReachHoldLocation',
  'EastmarchHoldLocation', 'FalkreathHoldLocation', 'HjaalmarchHoldLocation', 'PaleHoldLocation',
  'WinterholdHoldLocation'];

let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }
const read = (n) => JSON.parse(fs.readFileSync(path.join(DATA, n), 'utf8'));

function subs(d) {
  const out = [];
  let i = 0, big = null;
  while (i + 6 <= d.length) {
    const t = d.toString('latin1', i, i + 4);
    let n = d.readUInt16LE(i + 4);
    if (t === 'XXXX') { big = d.readUInt32LE(i + 6); i += 6 + n; continue; }
    if (big !== null) { n = big; big = null; }
    out.push({ t: t, b: d.subarray(i + 6, i + 6 + n) });
    i += 6 + n;
  }
  return out;
}

/** The plugin's placed references, each with its form id and its base as 'object id:plugin'. */
function refsOf(file, own) {
  const buf = fs.readFileSync(file);
  const hs = buf.readUInt32LE(4);
  const masters = subs(buf.subarray(24, 24 + hs)).filter((s) => s.t === 'MAST')
    .map((s) => s.b.toString('latin1').replace(/\0+$/, ''));
  const desc = (fid) => (fid & 0xffffff).toString(16) + ':' + ((fid >>> 24) < masters.length ? masters[fid >>> 24] : own);
  const out = new Map();
  (function walk(s, e) {
    let p = s;
    while (p + 24 <= e) {
      const tag = buf.toString('latin1', p, p + 4);
      const size = buf.readUInt32LE(p + 4);
      if (tag === 'GRUP') { walk(p + 24, p + size); p += size; continue; }
      if (tag === 'REFR') {
        const flags = buf.readUInt32LE(p + 8), fid = buf.readUInt32LE(p + 12);
        let d = buf.subarray(p + 24, p + 24 + size);
        if (flags & COMPRESSED) { d = zlib.inflateSync(d.subarray(4)); }
        const ss = subs(d);
        const name = ss.find((x) => x.t === 'NAME');
        out.set(desc(fid), { flags: flags, tags: ss.map((x) => x.t).join(','),
          base: name ? desc(name.b.readUInt32LE(0)) : '' });
      }
      p += 24 + size;
    }
  })(24 + hs, buf.length);
  return out;
}

const lower = (s) => String(s).toLowerCase();
const policy = read('last-plugin-policy.json');
const manifest = read('last-plugin.json');
const harvests = read('harvests.json').harvests;
const ores = read('ores.json').ores;
const rules = policy.holdOnly || {};
const rows = rules.resources || [];

// ---------------------------------------------------------------- H
yes('H1 the policy has a holdOnly list for #3150', rules.issue === 3150 && Array.isArray(rules.resources));
const basesOf = {};
const badRows = rows.filter((r) => {
  const table = r.kind === 'plant' ? harvests : r.kind === 'ore' ? ores : null;
  const field = r.kind === 'plant' ? 'produce' : 'ore';
  if (!table) { return true; }
  const bases = Object.keys(table).filter((b) => table[b][field] === r.produce);
  basesOf[r.produce] = new Set(bases.map(lower));
  return !bases.length || bases.some((b) => table[b].name !== r.name) || NINE.indexOf(r.holdEdid) < 0;
});
yes('H2 each is a plant or an ore the tables give under its name, kept to one of the nine holds' +
    (badRows.length ? ' (not: ' + badRows.map((r) => r.name).join(', ') + ')' : ''), rows.length > 0 && !badRows.length);
yes('H3 none is named twice', new Set(rows.map((r) => r.produce)).size === rows.length);
const per = {};
for (const r of rows) { per[r.holdEdid] = (per[r.holdEdid] || 0) + 1; }
yes('H4 every hold has 2 or 3 (Patrick, 22 Oct 2026): ' + NINE.map((h) => h.replace('HoldLocation', '') + ' ' +
    (per[h] || 0)).join(', '), NINE.every((h) => per[h] >= 2 && per[h] <= 3));
yes('H5 each says what was measured for it', rows.every((r) => typeof r.measured === 'string' && r.measured.length > 0));
const decided = fs.readFileSync(path.join(ROOT, 'docs', 'DECIDED.md'), 'utf8');
yes('H6 docs/DECIDED.md records the decision', /2 to 3 hold-only plants, ores or animals[\s\S]{0,200}#3150/.test(decided));

// ---------------------------------------------------------------- M
const ho = manifest.holdOnly || null;
yes('M1 the manifest has the hold-only plants and ores (rebuild the tables through the gate: '
    + 'pwsh scripts/vps/Box-Run.ps1 -Line \'Rebuild-ContentTables -Pull <number> -Head <its full head commit>\')', !!ho);
const made = ho ? ho.resources.map((r) => [r.produce, r.name, r.kind, r.hold].join('|')).sort() : [];
const want = rows.map((r) => [r.produce, r.name, r.kind, r.holdEdid].join('|')).sort();
yes('M2 it was built from this policy', JSON.stringify(made) === JSON.stringify(want));
const empty = ho ? ho.resources.filter((r) => !(r.kept > 0)) : [];
yes('M3 each still grows in its own hold' + (empty.length ? ' (not: ' + empty.map((r) => r.name).join(', ') + ')' : ''),
    !!ho && ho.resources.length > 0 && !empty.length);
const outside = ho ? ho.resources.reduce((n, r) => n + r.outside, 0) : -1;
yes('M4 what stands outside a hold is switched off here, left as a plugin has it, or held off by the server, and ' +
    'nothing else (' + outside + ')', !!ho &&
    outside === ho.off.length + ho.deleted.length + ho.alreadyOff.length + ho.heldByServer.length &&
    manifest.counts.holdOnlyOff === ho.off.length);

// ---------------------------------------------------------------- P
if (lastMade.buf) {
  const refs = refsOf(lastMade.path, 'Thornswood-Last.esp');
  const all = new Set([].concat(...Object.values(basesOf).map((s) => [...s])));
  const wrong = ho ? ho.off.filter((d) => {
    const r = refs.get(d);
    return !r || !(r.flags & DISABLED) || (r.flags & DELETED) || (r.tags !== 'NAME,DATA' && r.tags !== 'EDID,NAME,DATA') ||
      !all.has(lower(r.base));
  }) : ['no manifest'];
  yes('P1 every one it switches off is in the plugin, initially disabled, keeping only its base and place, ' +
      'and is a hold-only plant or ore' + (wrong.length ? ' (not: ' + wrong.slice(0, 5).join(', ') + ')' : ''),
      !wrong.length);
} else {
  console.log('SKIP  P1: ' + lastMade.why);
}

// ---------------------------------------------------------------- D
const page = (n) => fs.readFileSync(path.join(ROOT, 'docs', 'systems', 'classes', n), 'utf8').toLowerCase();
const unnamed = rows.filter((r) => page(r.kind === 'plant' ? 'gatherer.md' : 'miner.md')
  .indexOf(r.name.toLowerCase().replace(/ ore$/, '')) < 0);
yes('D1 the gatherer and miner pages name every one' + (unnamed.length ? ' (not: ' + unnamed.map((r) => r.name).join(', ') + ')' : ''),
    rows.length > 0 && !unnamed.length);

// ---------------------------------------------------------------- G
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'), 'utf8'));
const at = /var HELD_BY_SERVER = (\[[^\]]*\]);/.exec(gm);
const held = new Set(at ? JSON.parse(at[1]) : []);
yes('G1 the ones the server holds off are in the gamemode\'s HELD_BY_SERVER block',
    !!at && !!ho && ho.heldByServer.every((d) => held.has(d)));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
