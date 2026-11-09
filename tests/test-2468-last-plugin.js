'use strict';
/*
  test-2468-last-plugin.js

  #2468: the NPCs the 1 October rules cut flashed for a moment in every
  person's game before the client's world cleaner removed them, and vanilla
  quests played their gate, door and arrival talk. game/content/
  Thornswood-Last.esp, built by scripts/mods/Build-LastPlugin.py, switches
  every cut placed actor off at the record and stops every vanilla quest from
  starting, except the ones game/data/last-plugin-policy.json keeps while
  Patrick decides.

  It reads the plugin with its own reader and holds it to the manifest
  (game/data/last-plugin.json), the catalogue (game/data/npc-population.json)
  and the policy. No repository holds the plugin since #2791 step 3, so it is
  made from its recipe out of the game's plugins (tests/last-plugin-made.js);
  without the game, the checks that read its records print SKIP and the rest,
  the manifest's, still run:

    P  the plugin: light, no record of its own, the manifest's bytes
    A  every actor the catalogue cuts is switched off here or listed with
       why it is not; every one switched off is off, with nothing that could
       switch it on again
    Q  every vanilla quest the manifest stops cannot start; the kept ones
       are exactly the policy's and are not in the plugin
    G  the gate, door and arrival talk the manifest lists is all stopped or
       kept, and the Whiterun gate's quest is stopped
    S  the server's own cut list in game/gamemode.js stays exactly as long as
       the plugin is not in the servers' load order (the catalogue's), and
       goes in the same change that puts it there
    B  the bytes it was built against are the ones the collection installs
       (records/collection-plugins.json) and the repository's content plugin,
       so a new collection revision or a content change without a rebuild
       turns this red (#2486); and it, and the NPC catalogue it is built
       after, were built against every plugin the collection installs, so a
       plugin the collection adds turns this red too (#4176)

  On a machine with the game (C:\Thornswood\Game\Data, or THORNSWOOD_DATA)
  holding the catalogue's load order, it also rebuilds the plugin and the
  manifest and gets the committed bytes back, which also reads the load order
  with the plugin at its end and finds no cut actor able to show and no cut
  quest able to start.
*/
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const lastPlugin = require('./last-plugin-made.js');
const MANIFEST = path.join(ROOT, 'game', 'data', 'last-plugin.json');
const POLICY = path.join(ROOT, 'game', 'data', 'last-plugin-policy.json');
const CATALOGUE = path.join(ROOT, 'game', 'data', 'npc-population.json');
const GM = path.join(ROOT, 'game', 'gamemode.js');
const COLLECTION = process.env.THORNSWOOD_COLLECTION_PLUGINS || path.join(ROOT, 'records', 'collection-plugins.json');
const CONTENT = path.join(ROOT, 'game', 'content', 'Thornswood-Content.esp');
const TOOL = path.join(ROOT, 'scripts', 'mods', 'Build-LastPlugin.py');
const POP_TOOL = path.join(ROOT, 'scripts', 'dev', 'Build-NpcPopulation.py');
const NAME = 'Thornswood-Last.esp';
const VANILLA = ['skyrim.esm', 'update.esm', 'dawnguard.esm', 'hearthfires.esm', 'dragonborn.esm'];
const COMPRESSED = 0x00040000, DISABLED = 0x800, DELETED = 0x20, LIGHT = 0x200;
const NEVER_TRUE = Buffer.from('80000000000000002f000000' + '0f000000' + '00000000' + '00000000' + '00000000' + 'ffffffff', 'hex');

let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }

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

const made = lastPlugin.made();
const esp = made.buf;
if (!esp) { console.log('SKIP  P, A3, A4, Q1, Q2, Q4b: ' + made.why); }
// A check that reads the plugin's records, only where it was made.
function yesR(w, c) { if (esp) { yes(w, c()); } }
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const policy = JSON.parse(fs.readFileSync(POLICY, 'utf8'));
const catalogue = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
const gm = fs.readFileSync(GM, 'utf8');

// ---------------------------------------------------------------- P
const hs = esp ? esp.readUInt32LE(4) : 0;
const hflags = esp ? esp.readUInt32LE(8) : 0;
const head = esp ? subs(esp.subarray(24, 24 + hs)) : [];
const masters = esp ? head.filter((s) => s.t === 'MAST').map((s) => s.b.toString('latin1').replace(/\0+$/, '')) : manifest.masters;
yesR('P1 the plugin starts with a TES4 header', () => esp.toString('latin1', 0, 4) === 'TES4');
yesR('P2 it is flagged light, so it takes no full load order slot', () => (hflags & LIGHT) !== 0);
yesR('P3 it is not localised: every name in it is written out', () => (hflags & 0x80) === 0);
yesR('P4 the manifest names its size and sha256', () =>
    manifest.plugin.name === NAME && manifest.plugin.size === esp.length &&
    manifest.plugin.sha256 === crypto.createHash('sha256').update(esp).digest('hex'));
yesR('P5 its masters are the manifest\'s: ' + masters.length, () => JSON.stringify(masters) === JSON.stringify(manifest.masters));
const loIndex = {};
manifest.loadOrder.forEach((n, i) => { loIndex[n.toLowerCase()] = i; });
yes('P6 its masters are in load order', masters.every((m, i) => i === 0 || loIndex[m.toLowerCase()] > loIndex[masters[i - 1].toLowerCase()]));
const catalogueOrder = catalogue.loadOrder.map((r) => r.name).filter((n) => n !== NAME);
yes('P7 it was built against the catalogue\'s load order (rebuild it after the catalogue)',
    JSON.stringify(manifest.loadOrder) === JSON.stringify(catalogueOrder));

const recs = {};
let own = 0, count = 0, groups = 0;
if (esp) (function walk(s, e) {
  let p = s;
  while (p + 24 <= e) {
    const tag = esp.toString('latin1', p, p + 4);
    const size = esp.readUInt32LE(p + 4);
    if (tag === 'GRUP') { groups++; walk(p + 24, p + size); p += size; continue; }
    const flags = esp.readUInt32LE(p + 8), fid = esp.readUInt32LE(p + 12);
    let d = esp.subarray(p + 24, p + 24 + size);
    if (flags & COMPRESSED) { d = zlib.inflateSync(d.subarray(4)); }
    if ((fid >>> 24) >= masters.length) { own++; }
    recs[tag + ':' + fid] = { tag: tag, flags: flags, fid: fid, subs: subs(d) };
    count++;
    p += 24 + size;
  }
})(24 + hs, esp.length);
yesR('P8 every record is an override of a master\'s, none is new', () => own === 0);
yesR('P9 the header counts every record and group', () => head[0].t === 'HEDR' && head[0].b.readInt32LE(4) === count + groups);

function fidOf(desc) {
  const at = desc.indexOf(':');
  const obj = parseInt(desc.slice(0, at), 16), plugin = desc.slice(at + 1).toLowerCase();
  const i = masters.findIndex((m) => m.toLowerCase() === plugin);
  return i < 0 ? null : ((i << 24) | obj) >>> 0;
}

// ---------------------------------------------------------------- A
const cut = catalogue.npcs.filter((r) => !r.keep && r.ref !== '14:Skyrim.esm');
const lists = manifest.refs;
const listed = {};
let twice = 0;
for (const k of ['disabled', 'deleted', 'alreadyOff', 'corpseKept', 'heldByServer']) {
  for (const d of (lists[k] || [])) { if (listed[d]) { twice++; } listed[d] = k; }
}
yes('A1 the catalogue cuts ' + cut.length + ' placed actors, and each is in exactly one of the manifest\'s lists',
    twice === 0 && cut.every((r) => listed[r.ref]) && Object.keys(listed).length === cut.length);
const corpses = cut.filter((r) => r.reason === 'Authored corpse, not a living encounter' &&
                              listed[r.ref] !== 'deleted' && listed[r.ref] !== 'alreadyOff');
if (policy.corpses.action === 'keep') {
  yes('A2 the policy keeps the authored corpses, and those ' + corpses.length + ' are the only ones left on',
      lists.corpseKept.length === corpses.length && corpses.every((r) => listed[r.ref] === 'corpseKept'));
} else {
  yes('A2 the policy cuts the authored corpses, and none is left on', lists.corpseKept.length === 0);
}
let off = 0, bad = [];
for (const d of lists.disabled) {
  const f = fidOf(d);
  const r = f === null ? null : recs['ACHR:' + f];
  const tags = r ? r.subs.map((s) => s.t).join(',') : '';
  if (r && (r.flags & DISABLED) && !(r.flags & DELETED) && (tags === 'NAME,DATA' || tags === 'EDID,NAME,DATA')) { off++; } else { bad.push(d); }
}
yesR('A3 all ' + lists.disabled.length + ' switched off: initially disabled, keeping only their base and place, ' +
    'with no enable parent, script or link that could switch one on' + (bad.length ? ' (not: ' + bad.slice(0, 5).join(', ') + ')' : ''),
    () => off === lists.disabled.length && lists.disabled.length > 0);
const achr = Object.keys(recs).filter((k) => k.startsWith('ACHR:')).length;
yesR('A4 the plugin switches off nothing else: ' + achr + ' placed actors', () => achr === lists.disabled.length);
const guard = catalogue.npcs.find((r) => r.name === 'Whiterun Guard' && !r.keep && listed[r.ref] === 'disabled');
yes('A5 a cut Whiterun guard is among them' + (guard ? ' (' + guard.ref + ')' : ''), !!guard);

// ---------------------------------------------------------------- Q
const qrecs = Object.keys(recs).filter((k) => k.startsWith('QUST:')).map((k) => recs[k]);
const stopped = manifest.quests.stopped, kept = manifest.quests.kept, modStopped = manifest.quests.modStopped;
const propped = manifest.questScriptProperties || [];
yesR('Q1 every quest in the plugin is one the manifest stops (' + (qrecs.length - propped.length) + '), or one whose ' +
    'script properties the policy sets (' + propped.length + ', tests/test-3101-unbound-start-gear.js)',
    () => qrecs.length === stopped.length + modStopped.length + propped.length &&
    stopped.concat(modStopped, propped).every((q) => recs['QUST:' + fidOf(q.quest)]));
const proppedFids = new Set(propped.map((q) => fidOf(q.quest)));
let qbad = [];
for (const r of qrecs.filter((x) => !proppedFids.has(x.fid))) {
  const t = r.subs.map((s) => s.t);
  const dnam = r.subs.find((s) => s.t === 'DNAM').b;
  const n = t.indexOf('NEXT');
  if ((dnam.readUInt16LE(0) & 1) || n < 0 || t.lastIndexOf('NEXT') !== n || !r.subs[n + 1] ||
      r.subs[n + 1].t !== 'CTDA' || !r.subs[n + 1].b.equals(NEVER_TRUE)) { qbad.push(r.fid.toString(16)); }
}
yesR('Q2 none starts with the game, and the first Story Manager condition of each is never true' +
    (qbad.length ? ' (not: ' + qbad.slice(0, 5).join(', ') + ')' : ''), () => qbad.length === 0);
yes('Q3 the vanilla list holds only vanilla quests', stopped.every((q) => VANILLA.indexOf(q.quest.split(':')[1].toLowerCase()) >= 0));
const modPolicy = (policy.modQuestsStopped || []).map((q) => q.quest + ' ' + q.edid);
yes('Q3b the mod quests stopped are exactly the policy\'s ' + modPolicy.length + ', none of them vanilla',
    JSON.stringify(modStopped.map((q) => q.quest + ' ' + q.edid)) === JSON.stringify(modPolicy) &&
    modStopped.every((q) => VANILLA.indexOf(q.quest.split(':')[1].toLowerCase()) < 0));
const decided = ['13eb3:Skyrim.esm', '17f01:Skyrim.esm', '68d73:Skyrim.esm', '750ba:Skyrim.esm', '5a6dc:Skyrim.esm',
  'bcc94:Skyrim.esm', '1aa70:Dawnguard.esm', '38566:Dragonborn.esm', '39f82:Skyrim.esm', 'fc1a2:Skyrim.esm',
  '13e06:Skyrim.esm', 'eafd5:Skyrim.esm', '2ba16:Skyrim.esm', '2c09:Dawnguard.esm', '16e02:Dragonborn.esm'];
yes('Q3c Patrick\'s 12 Oct answers: barter, carriages, followers, courier and the start-up quests are stopped (15)',
    decided.every((d) => stopped.some((q) => q.quest === d)));
yes('Q3d ...and the creature voices are the only quests kept',
    kept.length > 0 && kept.every((q) => q.edid.startsWith('CreatureDialogue')));
const keptNames = policy.questsKept.map((q) => q.quest);
yes('Q4 every quest the policy keeps is kept (' + keptNames.length + ' by name)',
    keptNames.every((k) => kept.some((q) => q.quest === k)));
yesR('Q4b and none of them is in the plugin', () => keptNames.every((k) => !recs['QUST:' + fidOf(k)]));
const prefixes = Object.keys(policy.questEditorIdPrefixesKept || {});
yes('Q5 and nothing else is kept: the rest are kept by the policy\'s editor id prefixes (' + prefixes.join(', ') + ')',
    kept.every((q) => keptNames.indexOf(q.quest) >= 0 || prefixes.some((p) => q.edid.startsWith(p))) &&
    stopped.every((q) => !prefixes.some((p) => q.edid.startsWith(p))));
const gate = stopped.find((q) => q.quest === 'd1984:Skyrim.esm');
yes('Q6 the Whiterun gate guard\'s quest, DialogueWhiterunGuardGateStop, is stopped', !!gate && gate.edid === 'DialogueWhiterunGuardGateStop');

// ---------------------------------------------------------------- G
const arrive = manifest.arrivalTalk;
const stoppedSet = new Set(stopped.concat(modStopped).map((q) => q.quest)), keptSet = new Set(kept.map((q) => q.quest));
yes('G1 every quest with gate, door or arrival talk (' + arrive.length + ', vanilla and the mods\') is stopped',
    arrive.length > 0 && arrive.every((r) => stoppedSet.has(r.quest)));
const wr = manifest.arrivalTalk.find((r) => r.quest === 'd1984:Skyrim.esm');
yes('G2 the Whiterun gate is found by its door\'s script', !!wr && wr.why.indexOf('a door names it') >= 0);
const riften = stopped.find((q) => q.edid === 'DialogueRiftenGateGuards');
yes('G3 Riften\'s gate guards are stopped too', !!riften);

// ---------------------------------------------------------------- S
const inOrder = catalogue.loadOrder.some((r) => r.name === NAME);
const calls = /api\.setNpcPlacementExclusions\(/.test(gm);
if (inOrder) {
  yes('S1 the plugin is in the servers\' load order, so the gamemode no longer hands the server its own cut list',
      !calls && !/"cut":\[/.test(gm));
} else {
  yes('S1 the plugin is not in the servers\' load order yet, so the gamemode still hands the server the cut list',
      calls);
}
if (inOrder) {
  const lastRow = catalogue.loadOrder[catalogue.loadOrder.length - 1];
  yes('S3 the catalogue lists it last, at the bytes the manifest names (rebuild the catalogue after the plugin)',
      lastRow.name === NAME && lastRow.sha256 === manifest.plugin.sha256);
}
const pop = fs.readFileSync(POP_TOOL, 'utf8');
yes('S2 the catalogue does not read this plugin\'s records, which are made from it',
    /LAST_PLUGIN = 'Thornswood-Last\.esp'/.test(pop) && /if name == LAST_PLUGIN:/.test(pop));

// ---------------------------------------------------------------- B
const built = manifest.builtAgainst || [];
yes('B1 the manifest records the bytes of every plugin it was built against, in load order (' + built.length + ')',
    JSON.stringify(built.map((r) => r.name)) === JSON.stringify(manifest.loadOrder) &&
    built.every((r) => /^[0-9a-f]{64}$/.test(r.sha256) && r.size > 0));
const record = JSON.parse(fs.readFileSync(COLLECTION, 'utf8'));
const rec = {};
for (const r of record.plugins) { rec[r.name.toLowerCase()] = r; }
const other = built.filter((r) => r.name !== 'Thornswood-Content.esp' &&
  !(rec[r.name.toLowerCase()] && rec[r.name.toLowerCase()].sha256.toLowerCase() === r.sha256 && rec[r.name.toLowerCase()].size === r.size));
yes('B2 every plugin but ours is the collection\'s own bytes, revision ' + record.revision +
    (other.length ? ' (not: ' + other.slice(0, 4).map((r) => r.name).join(', ') + '; rebuild the plugin for this revision)' : ''),
    other.length === 0);
// B2 asks only about the plugins it was built against. A plugin the
// collection adds is in neither list B2 reads, so these ask the other way
// round, of the plugin and of the catalogue it is built after (#4176).
const builtNames = new Set(built.map((r) => r.name.toLowerCase()));
const notBuilt = record.plugins.filter((r) => !builtNames.has(r.name.toLowerCase())).map((r) => r.name);
yes('B4 it was built against every plugin the collection installs, revision ' + record.revision +
    ' (' + (record.plugins.length - notBuilt.length) + ' of ' + record.plugins.length + ')' +
    (notBuilt.length ? ' (not: ' + notBuilt.slice(0, 4).join(', ') + '; rebuild the catalogue, then the plugin, for this revision)' : ''),
    notBuilt.length === 0);
const catalogued = new Set(catalogue.loadOrder.map((r) => r.name.toLowerCase()));
const notCatalogued = record.plugins.filter((r) => !catalogued.has(r.name.toLowerCase())).map((r) => r.name);
yes('B5 the NPC catalogue was built from every plugin the collection installs, revision ' + record.revision +
    ' (' + (record.plugins.length - notCatalogued.length) + ' of ' + record.plugins.length + ')' +
    (notCatalogued.length ? ' (not: ' + notCatalogued.slice(0, 4).join(', ') + '; rebuild the catalogue for this revision)' : ''),
    notCatalogued.length === 0);
const contentRow = built.find((r) => r.name === 'Thornswood-Content.esp');
yes('B3 and the content plugin is the repository\'s (after a content change, run scripts/mods/Rebuild-ContentTables.ps1)',
    !!contentRow && contentRow.sha256 === crypto.createHash('sha256').update(fs.readFileSync(CONTENT)).digest('hex'));

// ---------------------------------------------------------------- rebuild
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
  if (run && /is not the bytes npc-population\.json was built from|is not the repository's game\/content copy/.test(said)) {
    console.log('SKIP  R1: the game at ' + data + ' is not the catalogue\'s load order:');
    console.log(said.split('\n').filter((l) => /^\s+\S/.test(l)).slice(0, 5).join('\n'));
  } else {
    yes('R1 rebuilt from the game at ' + data + ', it is the committed plugin and manifest, and it reads back ' +
        'with no cut actor able to show and no cut quest able to start', !!run && run.status === 0);
    if (!run || run.status !== 0) { console.log(said); }
  }
} else {
  console.log('SKIP  R1: no game at ' + data + ' (a machine with the game rebuilds the plugin)');
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
