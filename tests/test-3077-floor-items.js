'use strict';
/*
  test-3077-floor-items.js

  #3077. Patrick, 21 Oct 2026: "change it from denying and giving a meessage
  when trying to pick things up from just not spawning them in, also expand
  that to everything don't spawn floor items anymore at all no matter what
  they are."

  The floor was refused, not emptied: the game's floor items were placed in
  every game, and the gamemode answered a press on a weapon, armour, a tool,
  coin, a coin purse or a jail key with a chat line. Now
  scripts/mods/Build-LastPlugin.py (step 5) switches every placed item and
  coin purse off in Thornswood-Last.esp, the way it switches off
  a cut actor (#2468): no machine draws it, the server's reader never makes
  it, and there is nothing left to refuse.

  This reads the plugin and holds it to the builder, the manifest and the
  gamemode. No repository holds the plugin since #2791 step 3, so P, N2, N3
  and N5 read it made from its recipe out of the game's plugins
  (tests/last-plugin-made.js), and print SKIP without the game; the rest
  still run:

    T  the builder's floor types are the item types the engine reloots
       (forbiddenReloot in both deploy scripts), and its coin purses are every
       coin-giving flora in game/data/harvests.json, no more
    M  the manifest counts the floor items it switched off, and its counts
       agree with each other
    P  every placed reference in the plugin but the three town gates and the
       hold-only plants and ores (#3150) is a floor item switched off:
       initially disabled, keeping only its base and place, with nothing that
       could switch it on; they are the manifest's number, and their ids hash
       to the manifest's refsSha256
    C  Thornswood-Content.esp places no item of its own on the floor (a
       Thornswood plugin's floor item is Patrick's to decide; the builder stops
       on one with the game's records too)
    N  nothing of a plugin the policy never copies from (notCopiedFrom:
       Immersive Armors, Patrick, 17 Oct 2026) is in the plugin but the
       records its row carries (Patrick, 21 Oct 2026: the 6 floor items it
       places, switched off, and the 5 cell and world headers they stand
       under)
    G  the gamemode refuses nothing off the floor: no "put here by the world"
       line, no coin purse rule, no jail key floor line

  On a machine with the game, tests/test-2468-last-plugin.js R1 rebuilds the
  plugin and reads it back in the load order, which finds every floor item of
  every plugin switched off.
*/
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ROOT = path.join(__dirname, '..');
const made = require('./last-plugin-made.js').made();
const CONTENT = path.join(ROOT, 'game', 'content', 'Thornswood-Content.esp');
const MANIFEST = path.join(ROOT, 'game', 'data', 'last-plugin.json');
const HARVESTS = path.join(ROOT, 'game', 'data', 'harvests.json');
const TOOL = path.join(ROOT, 'scripts', 'mods', 'Build-LastPlugin.py');
const GM = path.join(ROOT, 'game', 'gamemode.js');
const DEPLOYS = ['Deploy-Gamemode.ps1', 'Deploy-DevGamemode.ps1'].map((n) => path.join(ROOT, 'scripts', 'deploy', n));
const COMPRESSED = 0x00040000, DISABLED = 0x800, DELETED = 0x20;

let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }
// A check that reads the plugin's records, only where it was made.
function yesR(w, c) { if (made.buf) { yes(w, c()); } }

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

/** A plugin's masters and its records, each with its form id as 'object id:plugin'. */
function readPlugin(file, own) {
  const buf = fs.readFileSync(file);
  const hs = buf.readUInt32LE(4);
  const masters = subs(buf.subarray(24, 24 + hs)).filter((s) => s.t === 'MAST')
    .map((s) => s.b.toString('latin1').replace(/\0+$/, ''));
  const desc = (fid) => (fid & 0xffffff).toString(16) + ':' + ((fid >>> 24) < masters.length ? masters[fid >>> 24] : own);
  const recs = [];
  (function walk(s, e) {
    let p = s;
    while (p + 24 <= e) {
      const tag = buf.toString('latin1', p, p + 4);
      const size = buf.readUInt32LE(p + 4);
      if (tag === 'GRUP') { walk(p + 24, p + size); p += size; continue; }
      const flags = buf.readUInt32LE(p + 8), fid = buf.readUInt32LE(p + 12);
      let d = buf.subarray(p + 24, p + 24 + size);
      if (flags & COMPRESSED) { d = zlib.inflateSync(d.subarray(4)); }
      recs.push({ tag: tag, flags: flags, desc: desc(fid), subs: subs(d) });
      p += 24 + size;
    }
  })(24 + hs, buf.length);
  return { masters: masters, recs: recs, desc: desc };
}

const tool = fs.readFileSync(TOOL, 'utf8');
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const gm = fs.readFileSync(GM, 'utf8');

// ---------------------------------------------------------------- T
const typesAt = /FLOOR_TYPES = \(([^)]*)\)/.exec(tool);
const types = typesAt ? (typesAt[1].match(/b'([A-Z_]{4})'/g) || []).map((t) => t.slice(2, 6)) : [];
for (const file of DEPLOYS) {
  const at = /forbiddenReloot -NotePropertyValue @\(([^)]*)\)/.exec(fs.readFileSync(file, 'utf8'));
  const reloot = at ? (at[1].match(/'([A-Z_]{4})'/g) || []).map((t) => t.slice(1, 5)).filter((t) => t !== 'CONT') : [];
  yes('T1 the floor types are the item types ' + path.basename(file) + ' stops relooting (' + reloot.length + ')',
      reloot.length > 0 && JSON.stringify(reloot.slice().sort()) === JSON.stringify(types.slice().sort()));
}
yes('T2 no flora or tree is a floor type: plants, fish and hanging game stay',
    types.indexOf('FLOR') < 0 && types.indexOf('TREE') < 0);
yes('T3 a light is a floor item only when it can be carried', /LIGHT_CARRIED = 0x2\b/.test(tool) &&
    /if tag == b'LIGH':[\s\S]{0,300}LIGHT_CARRIED/.test(tool));
const pursesAt = /COIN_PURSES = \(([\s\S]*?\))\)\s/.exec(tool);
const purses = pursesAt ? (pursesAt[1].match(/\('skyrim\.esm', 0x([0-9A-Fa-f]+)\)/g) || [])
  .map((t) => parseInt(/0x([0-9A-Fa-f]+)/.exec(t)[1], 16).toString(16) + ':Skyrim.esm') : [];
const un = JSON.parse(fs.readFileSync(HARVESTS, 'utf8')).unranked || {};
const coin = Object.keys(un).filter((k) => {
  const r = un[k] || {};
  return /coin/i.test(r.name || '') || /gold/i.test(r.produceName || '') || /purse/i.test(r.editorId || '');
}).sort();
yes('T4 the coin purses are every coin-giving flora in harvests.json (' + coin.length + ')',
    coin.length === 6 && JSON.stringify(purses.slice().sort()) === JSON.stringify(coin));

// ---------------------------------------------------------------- M
const fl = manifest.floorItems || null;
yes('M1 the manifest counts the floor items the plugin switches off (rebuild the plugin: '
    + 'python scripts/mods/Build-LastPlugin.py)', !!fl && fl.off > 0 && manifest.counts.floorItemsOff === fl.off);
const sum = (o) => Object.keys(o || {}).reduce((n, k) => n + o[k], 0);
yes('M2 by type and by the plugin that won each, they add up to the same number',
    !!fl && sum(fl.byType) === fl.off && sum(fl.byWinner) === fl.off);
yes('M3 the types are the floor types and the coin purses',
    !!fl && Object.keys(fl.byType).every((k) => types.indexOf(k) >= 0 || k === 'coin purse'));
yes('M4 the cells copied only for them are counted by the plugin that wins each',
    !!fl && typeof fl.cellsAdded === 'number' && sum(fl.cellsAddedByWinner) === fl.cellsAdded);

// ---------------------------------------------------------------- P
const last = made.buf ? readPlugin(made.path, 'Thornswood-Last.esp') : { recs: [], masters: [], desc: () => '' };
if (!made.buf) { console.log('SKIP  P, N2, N3, N5: ' + made.why); }
const gates = new Set(manifest.gatesUnlocked || []);
// The hold-only plants and ores switched off outside their hold (#3150) are
// game/tests/test-3150-hold-builder.js's and the builder's --verify.
const holdOff = new Set((manifest.holdOnly && manifest.holdOnly.off) || []);
const refs = last.recs.filter((r) => r.tag === 'REFR' && !gates.has(r.desc) && !holdOff.has(r.desc));
const bad = refs.filter((r) => {
  const tags = r.subs.map((s) => s.t).join(',');
  return !(r.flags & DISABLED) || (r.flags & DELETED) || (tags !== 'NAME,DATA' && tags !== 'EDID,NAME,DATA');
});
yesR('P1 every placed reference but the ' + gates.size + ' town gates and the hold-only plants and ores is ' +
    'switched off: initially disabled, ' +
    'keeping only its base and place, with no enable parent, script or link' +
    (bad.length ? ' (not: ' + bad.slice(0, 5).map((r) => r.desc).join(', ') + ')' : ''),
    () => gates.size === 3 && bad.length === 0);
yesR('P2 there are as many as the manifest says (' + refs.length + ')', () => !!fl && refs.length === fl.off);
const hash = crypto.createHash('sha256').update(refs.map((r) => r.desc).sort().join('\n'), 'utf8').digest('hex');
yesR('P3 and they are the ones it says: their ids hash to its refsSha256', () => !!fl && hash === fl.refsSha256);

// ---------------------------------------------------------------- N
// Nothing is copied out of a plugin Patrick rules is never handed on
// (notCopiedFrom in the policy: Immersive Armors, 17 Oct 2026, #2454), but
// the records its row carries. Immersive Armors carries none (Patrick, 22 Oct
// 2026, q-613-ia-recipes: its 6 floor items and their cell headers were never
// his to carry); the server holds those floor items off instead
// (game/tests/test-613-set-in-game.js).
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'last-plugin-policy.json'), 'utf8'));
const rows = policy.notCopiedFrom || [];
const never = rows.map((r) => r.plugin);
const carried = [].concat(...rows.map((r) => r.carried || []));
yes('N1 the policy never copies from Immersive Armors', never.indexOf('Hothtrooper44_ArmorCompilation.esp') >= 0);
const lower = (n) => n.toLowerCase();
const theirs = (d) => never.some((n) => lower(d).endsWith(':' + lower(n)));
const carries = new Set(carried.map(lower));
const extra = [];
for (const r of last.recs) {
  const name = r.tag === 'REFR' ? r.subs.find((s) => s.t === 'NAME') : null;
  const base = name ? last.desc(name.b.readUInt32LE(0)) : '';
  if ((theirs(r.desc) || theirs(base)) && !carries.has(lower(r.tag + ' ' + r.desc))) { extra.push(r.tag + ' ' + r.desc); }
}
yesR('N2 no record in Thornswood-Last.esp is or places one of a plugin it names, but the ones its row carries' +
    (extra.length ? ' (not: ' + extra.slice(0, 5).join(', ') + ')' : ''), () => never.length > 0 && extra.length === 0);
const needs = never.filter((n) => last.masters.some((m) => lower(m) === lower(n)));
yesR('N3 one is a master only when its row carries a record of its own (' + needs.join(', ') + ')',
    () => needs.every((n) => carried.some((c) => lower(c).endsWith(':' + lower(n)))));
yes('N4 the manifest was built with the same list and carries exactly those records (rebuild the plugin after a policy change)',
    !!manifest.notCopiedFrom && JSON.stringify(manifest.notCopiedFrom.plugins) === JSON.stringify(never.slice().sort()) &&
    JSON.stringify(manifest.notCopiedFrom.carried || []) === JSON.stringify(carried.slice().sort()));
const carriedRefs = carried.filter((c) => c.startsWith('REFR '));
yesR('N5 every carried reference is a floor item switched off here, keeping only its base and place',
    () => carriedRefs.every((c) => refs.some((r) => lower('REFR ' + r.desc) === lower(c))));

// ---------------------------------------------------------------- C
const content = readPlugin(CONTENT, 'Thornswood-Content.esp');
const kind = {};
for (const r of content.recs) { kind[r.desc] = r.tag; }
const ownFloor = content.recs.filter((r) => {
  if (r.tag !== 'REFR') { return false; }
  const name = r.subs.find((s) => s.t === 'NAME');
  const base = name ? content.desc(name.b.readUInt32LE(0)) : '';
  return types.indexOf(kind[base]) >= 0 || purses.indexOf(base) >= 0;
});
yes('C1 Thornswood-Content.esp places no floor item of its own' +
    (ownFloor.length ? ' (it does: ' + ownFloor.slice(0, 5).map((r) => r.desc).join(', ') + '; ask Patrick)' : ''),
    ownFloor.length === 0);
yes('C2 and the builder stops on a Thornswood plugin\'s floor item rather than switching it off unasked',
    /own_plugins\.is_own\(canon\[g\[0\]\]\) or own_plugins\.is_own\(src\.name\)/.test(tool));

// ---------------------------------------------------------------- G
const A = '// ==== thornswood spoils ====', B = '// ==== end thornswood spoils ====';
const block = gm.slice(gm.indexOf(A), gm.indexOf(B));
yes('G1 the spoils block is in the gamemode', gm.indexOf(A) >= 0 && gm.indexOf(B) > gm.indexOf(A));
yes('G2 it says no floor refusal: no "put here by the world", no coin purse rule, no jail key floor line',
    !/put here by the world/.test(block) && !/isPurse|PURSES/.test(block) && !/belonged to the old jail/.test(block));
yes('G3 and onActivate shows no line for it', !/const no = spoils\.activate\(/.test(gm));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
