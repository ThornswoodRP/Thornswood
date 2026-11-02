'use strict';
/*
  test-516-woodworking-benches.js

      node tests/test-516-woodworking-benches.js

  #516. Since #2529 the bows, arrows, bolts, our three fishing poles and the
  fish trap are made at Thornswood-Content.esp's woodworking bench, and no
  plugin places that bench. The server stands one beside the public forge of
  each town in game/data/woodworking-benches.json, which
  scripts/dev/Build-WoodworkingBenches.py works out of the plugins. This
  holds all of it together:

    T  the table: every site names a forge, a worldspace, a point and an
       angle, and what was measured there (the ground under it, the nearest
       solid thing); every town of the placement brief is either a site or
       skipped with its reason; no bench stands near a charcoal kiln
    G  the gamemode's WOODWORKING_BENCHES table is the table, row for row
    P  the bench is furniture in the repository's content plugin, carrying
       the woodworking keyword
    B  the table was built against the collection's own bytes and the
       repository's own plugins, so a new revision or a content change
       without a rebuild turns this red
    R  the 26 recipes #2529 moved are at the woodworking bench in
       game/data/recipes.json, and the bench tables open it for the
       Woodwright
    S  the real property block over a pretend engine: at start every bench
       stands at its point next to its forge, turned before it is moved, so
       a game near it is sent the right angle; standing them again does
       nothing; a bench that is gone is stood again, once; after a restart
       the same references are used; a forge the server does not have in
       its worldspace places nothing and says so; there is no timer

  On a machine with the game (C:\Thornswood\Game\Data, or THORNSWOOD_DATA)
  holding the collection's bytes it also runs the builder with --check: the
  plugins give the committed table and block.
*/
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const read = (p) => fs.readFileSync(p, 'utf8').split(CR).join('');
const TABLE = path.join(ROOT, 'game', 'data', 'woodworking-benches.json');
const RECIPES = path.join(ROOT, 'game', 'data', 'recipes.json');
const CONTENT = path.join(ROOT, 'game', 'content', 'Thornswood-Content.esp');
const COLLECTION = path.join(ROOT, 'records', 'collection-plugins.json');
const TOOL = path.join(ROOT, 'scripts', 'dev', 'Build-WoodworkingBenches.py');
const gm = require('./gamemode-tables.js').joined(read(path.join(ROOT, 'game', 'gamemode.js')));
const BENCH = '154e2:Thornswood-Content.esp';
const KEYWORD = '154e1:Thornswood-Content.esp';
const OURS = ['Thornswood-Content.esp', 'Thornswood-Last.esp'];

let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}
function near(a, b, eps) { return !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) < (eps || 0.01)); }

const table = JSON.parse(fs.readFileSync(TABLE, 'utf8'));
const sites = table.benches || {};
const names = Object.keys(sites);

// ---------------------------------------------------------------- T
yes('T1 the table is the builder\'s and names the bench ' + BENCH,
    table.builtBy === 'scripts/dev/Build-WoodworkingBenches.py' && table.bench === BENCH && table.keyword === KEYWORD);
yes('T2 every site names its forge, worldspace, point and angle (' + names.length + ')', names.length > 0 &&
    names.every((s) => {
      const r = sites[s];
      return /^[0-9a-f]+:.+\.(esm|esp|esl)$/.test(r.forge) && /^[0-9a-f]+:.+\.(esm|esp)$/.test(r.cell) &&
        Array.isArray(r.pos) && r.pos.length === 3 && r.pos.every(Number.isFinite) &&
        Number.isFinite(r.angle) && r.angle >= 0 && r.angle < 360 && typeof r.where === 'string' && r.where;
    }));
yes('T3 and what was measured there: the ground under it within a few units, and the nearest solid thing',
    names.every((s) => {
      const r = sites[s];
      return Array.isArray(r.groundUnder) && r.groundUnder[1] - r.groundUnder[0] <= 16 && (!r.nearest || r.nearest.units >= 30) &&
        r.pos[2] >= r.groundUnder[0] && r.pos[2] <= r.groundUnder[1] && typeof r.why === 'string' && r.why.length > 20;
    }));
yes('T4 each bench stands beside its forge, not across the town (within 800 units)',
    names.every((s) => Math.hypot(sites[s].pos[0] - sites[s].forgeAt[0], sites[s].pos[1] - sites[s].forgeAt[1]) < 800));
const BRIEF = ['whiterun', 'solitude', 'windhelm', 'markarth', 'riften', 'falkreath', 'dawnstar', 'morthal',
  'winterhold', 'riverwood', 'rorikstead', 'ivarstead', 'dragonbridge'];
const skipped = table.skipped || {};
yes('T5 every town of the placement brief has a bench or is skipped with its reason',
    BRIEF.every((t) => (sites[t] && !skipped[t]) || (!sites[t] && typeof skipped[t] === 'string' && skipped[t].length > 20)));
const CAPITALS = ['whiterun', 'solitude', 'windhelm', 'markarth', 'riften', 'falkreath', 'dawnstar'];
yes('T6 the seven hold capitals with a public forge each have a bench', CAPITALS.every((t) => !!sites[t]));
yes('T7 Whiterun\'s is not at the Skyforge, Riften\'s is at the Scorched Hammer\'s forge',
    !!sites.whiterun && sites.whiterun.forgeEdid !== 'CraftingBlackSmithForgeSkyforge' &&
    sites.whiterun.cell === '1a26f:Skyrim.esm' && !!sites.riften && sites.riften.forge === '53481:Skyrim.esm');

// The charcoal kilns are Thornswood-Content.esp's own references (#2337): no bench near one.
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
const esp = fs.readFileSync(CONTENT);
const hs = esp.readUInt32LE(4);
const masters = subs(esp.subarray(24, 24 + hs)).filter((s) => s.t === 'MAST').map((s) => s.b.toString('latin1').replace(/\0+$/, ''));
const own = masters.length;
const records = {};      // own form id -> { tag, subs }
const placed = [];       // { base (full id), pos, world (full id) }
(function walk(p, end, world) {
  while (p + 24 <= end) {
    const tag = esp.toString('latin1', p, p + 4);
    const size = esp.readUInt32LE(p + 4);
    if (tag === 'GRUP') {
      const gtype = esp.readInt32LE(p + 12);
      walk(p + 24, p + size, gtype === 1 ? esp.readUInt32LE(p + 8) : world);
      p += size;
      continue;
    }
    const flags = esp.readUInt32LE(p + 8);
    const fid = esp.readUInt32LE(p + 12);
    let body = esp.subarray(p + 24, p + 24 + size);
    if (flags & 0x40000) { body = zlib.inflateSync(body.subarray(4)); }
    const ss = subs(body);
    if (tag === 'REFR') {
      const name = ss.find((s) => s.t === 'NAME');
      const data = ss.find((s) => s.t === 'DATA');
      if (name && data) { placed.push({ base: name.b.readUInt32LE(0), pos: [0, 1, 2].map((i) => data.b.readFloatLE(i * 4)), world: world }); }
    } else if ((fid >>> 24) === own) {
      records[fid & 0xffffff] = { tag: tag, subs: ss };
    }
    p += 24 + size;
  }
})(24 + hs, esp.length, 0);
function edid(r) { const e = r && r.subs.find((s) => s.t === 'EDID'); return e ? e.b.toString('latin1').replace(/\0+$/, '') : ''; }
const kilnBases = Object.keys(records).filter((k) => /^ThornswoodCraftingCharcoalKiln/.test(edid(records[k]))).map(Number);
// Since #2553 a kiln stands in each bench town, the walled cities' own worldspaces included, so each
// bench is held against every kiln in its worldspace (the content plugin's masters start with Skyrim.esm,
// so a Skyrim.esm worldspace keeps its own id there).
const kilns = placed.filter((r) => (r.base >>> 24) === own && kilnBases.indexOf(r.base & 0xffffff) >= 0 && r.world);
const worldOf = (cell) => /:Skyrim\.esm$/i.test(cell) ? parseInt(cell, 16) : -1;
yes('T8 no bench stands within 1,000 units of a charcoal kiln in its worldspace (' + kilns.length + ' kilns read)',
    kilns.length > 0 && names.every((s) =>
      kilns.every((k) => k.world !== worldOf(sites[s].cell) || Math.hypot(k.pos[0] - sites[s].pos[0], k.pos[1] - sites[s].pos[1]) > 1000)));

// ---------------------------------------------------------------- P
const benchRec = records[0x154e2];
const kwRec = records[0x154e1];
const kwda = benchRec && benchRec.subs.find((s) => s.t === 'KWDA');
const kws = kwda ? Array.from({ length: kwda.b.length / 4 }, (_, i) => kwda.b.readUInt32LE(i * 4)) : [];
yes('P1 the bench is furniture in the repository\'s content plugin, ThornswoodCraftingWoodworkingWorkbench',
    !!benchRec && benchRec.tag === 'FURN' && edid(benchRec) === 'ThornswoodCraftingWoodworkingWorkbench');
yes('P2 carrying the keyword ThornswoodCraftingWoodworking', !!kwRec && kwRec.tag === 'KYWD' &&
    edid(kwRec) === 'ThornswoodCraftingWoodworking' && kws.indexOf(((own << 24) | 0x154e1) >>> 0) >= 0);

// ---------------------------------------------------------------- B
const built = table.builtAgainst || [];
const record = JSON.parse(fs.readFileSync(COLLECTION, 'utf8'));
const rec = {};
for (const r of record.plugins) { rec[r.name.toLowerCase()] = r; }
yes('B1 the table records the bytes of every plugin it read (' + built.length + ')', built.length > 100 &&
    built.every((r) => /^[0-9a-f]{64}$/.test(r.sha256) && r.size > 0));
const other = built.filter((r) => OURS.indexOf(r.name) < 0 &&
  !(rec[r.name.toLowerCase()] && rec[r.name.toLowerCase()].sha256.toLowerCase() === r.sha256 && rec[r.name.toLowerCase()].size === r.size));
yes('B2 every plugin but ours is the collection\'s own bytes, revision ' + record.revision +
    (other.length ? ' (not: ' + other.slice(0, 4).map((r) => r.name).join(', ') + '; rebuild the table)' : ''), other.length === 0);
// Thornswood-Last.esp is in no repository since #2791 step 3: its bytes are
// the ones its manifest names, which its recipe makes.
const lastNamed = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'last-plugin.json'), 'utf8')).plugin;
const stale = OURS.filter((n) => {
  const row = built.find((r) => r.name === n);
  if (n === lastNamed.name) { return !row || row.sha256 !== lastNamed.sha256 || row.size !== lastNamed.size; }
  const p = path.join(ROOT, 'game', 'content', n);
  return !row || !fs.existsSync(p) || row.sha256 !== crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
});
yes('B3 and ours are the repository\'s, Thornswood-Last.esp the one its manifest names (after a content change, run scripts/mods/Rebuild-ContentTables.ps1)' +
    (stale.length ? ' (not: ' + stale.join(', ') + ')' : ''), stale.length === 0);

// ---------------------------------------------------------------- G
// The gamemode reads both from game/gamemode-tables (#5191).
const GT = require('./gamemode-tables.js');
let base = null, inBlock = null;
try { base = GT.inGamemode(gm, 'WOODWORKING_BENCH_BASE'); inBlock = GT.inGamemode(gm, 'WOODWORKING_BENCHES'); } catch (e) { inBlock = null; }
yes('G1 the gamemode carries WOODWORKING_BENCH_BASE and WOODWORKING_BENCHES', base !== null && !!inBlock);
yes('G2 and it is the table, row for row', !!inBlock && base === BENCH &&
    JSON.stringify(Object.keys(inBlock).sort()) === JSON.stringify(names.slice().sort()) &&
    names.every((s) => inBlock[s].forge === sites[s].forge && inBlock[s].cell === sites[s].cell &&
      near(inBlock[s].pos, sites[s].pos) && inBlock[s].angle === sites[s].angle && inBlock[s].where === sites[s].where));

// ---------------------------------------------------------------- R
const recipes = JSON.parse(fs.readFileSync(RECIPES, 'utf8').replace(/^\uFEFF/, ''));
const atBench = Object.keys(recipes.recipes || {}).concat(Object.keys(recipes.unowned || {}), Object.keys(recipes.refused || {}))
  .map((k) => (recipes.recipes[k] || (recipes.unowned || {})[k] || (recipes.refused || {})[k]))
  .filter((r) => r && r.bench === KEYWORD);
// And the furniture (#2679): one recipe for each row of game/data/furniture.json
// whose type is on, written by Add-ContentRecords.py at the same bench.
const furnitureDoc = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'furniture.json'), 'utf8').replace(/^\uFEFF/, ''));
const furnitureOuts = furnitureDoc.pieces.filter((p) => furnitureDoc.limits.types[p.type])
  .map((p) => p.item + ':Thornswood-Content.esp');
// And the Woodwright's forge rows #3120 moved to its home bench (movedFrom
// keeps the forge their mod put them at), and the cook's wooden ladle
// (#3162), a woodwright's, written by Add-ContentRecords.py at the same bench.
const benchMoved = atBench.filter((r) => r.movedFrom).length;
const ladles = atBench.filter((r) => r.editorId === 'ThornswoodRecipeToolLadle');
const movedAt = atBench.length - furnitureOuts.length - benchMoved - ladles.length;
yes('R1 game/data/recipes.json has the 26 rows #2529 moved at the woodworking bench, the 9 #3120 moved off the forge, one for each piece of furniture and the ladle (' +
    atBench.length + ', ' + benchMoved + ' moved off the forge, ' + furnitureOuts.length + ' of them furniture, ' + ladles.length + ' ladle)',
    movedAt === 26 && benchMoved === 9 && ladles.length === 1 &&
    atBench.filter((r) => r.movedFrom).every((r) => r.movedFromName === 'CraftingSmithingForge') &&
    furnitureOuts.every((o) => atBench.some((r) => r.out === o)) &&
    atBench.every((r) => r.benchName === 'ThornswoodCraftingWoodworking'));
const bbb = /const BENCH_BY_BASE = (\{.*\});/.exec(gm);
const bac = /const BENCH_ACCESS = (\{.*\});/.exec(gm);
const byBase = bbb ? JSON.parse(bbb[1]) : {};
const access = bac ? JSON.parse(bac[1]) : {};
yes('R2 the bench tables know the bench: its furniture is the woodworking keyword, and the Woodwright may open it',
    byBase[BENCH] === KEYWORD && !!access[KEYWORD] && access[KEYWORD].name === 'ThornswoodCraftingWoodworking' &&
    !!access[KEYWORD].halves.woodwright);

// ---------------------------------------------------------------- S
const propBlock = slice(gm, '// ==== thornswood property ====', '// ==== end thornswood property ====');
yes('S0 the property block is in the gamemode', !!propBlock);
if (!propBlock || !inBlock) { done(); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-516-'));
fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
fs.mkdirSync(path.join(dir, 'private'));
fs.writeFileSync(path.join(dir, 'private', 'property.json'), JSON.stringify({
  claims: {}, stewards: [], boxes: {}, funds: {}, notices: {}, boards: {}
}));
function inDir(f) {
  const was = process.cwd();
  process.chdir(dir);
  try { return f(); } finally { process.chdir(was); }
}

const world = {};
const ids = {};          // desc (lower case) -> id
let next = 0xff00f000;
let placedRefs = [];
let calls = [];
let nextForge = 0x00100000;
function idOfDesc(desc) { return ids[String(desc).toLowerCase()] || 0; }
names.forEach((s) => {
  // Each forge where the server would have it: in its worldspace, somewhere other than the table's
  // own reading, so a bench that lands on its point was moved by the difference.
  const id = nextForge++;
  ids[sites[s].forge.toLowerCase()] = id;
  world[id] = { baseDesc: 'forge', worldOrCellDesc: sites[s].cell, angle: [0, 0, 0],
                pos: [sites[s].forgeAt[0] + 3, sites[s].forgeAt[1] - 2, sites[s].forgeAt[2] + 1] };
});
const BENCH_ID = 0x0b0154e2;
const mp = {
  makeProperty: function () { },
  get: function (id, key) {
    if (id === 0 && key === 'onlinePlayers') { return []; }
    if (!world[id]) { throw new Error('no reference ' + id.toString(16)); }
    const v = world[id][key];
    return (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
  },
  set: function (id, key, v) { if (!world[id]) { world[id] = {}; } world[id][key] = JSON.parse(JSON.stringify(v)); },
  getDescFromId: function (id) {
    for (const d in ids) { if (ids[d] === id) { return d; } }
    return (id >>> 0).toString(16);
  },
  getIdFromDesc: function (desc) {
    const d = String(desc).toLowerCase();
    if (d === BENCH.toLowerCase()) { return BENCH_ID; }
    if (d === '593b:thornswood-content.esp') { return 0x0b00593b; }
    if (d === '154d0:thornswood-content.esp') { return 0x0b0154d0; }
    return idOfDesc(d);
  },
  lookupEspmRecordById: function (id) { return id === BENCH_ID ? { record: { type: 'FURN' } } : {}; },
  getNeighborsByPosition: function () { return []; },
  place: function (b) {
    const id = next++;
    ids[(id >>> 0).toString(16)] = id;
    world[id] = { baseDesc: b === BENCH_ID ? BENCH : 'board', worldOrCellDesc: '3c:Skyrim.esm',
                  pos: [0, 0, 0], angle: [0, 0, 0], sent: null };
    if (b === BENCH_ID) { placedRefs.push(id); }
    return id;
  },
  callPapyrusFunction: function (kind, cls, fn, self, args) {
    const id = idOfDesc(self.desc);
    const me = world[id];
    if (!me) { throw new Error('no self ' + self.desc); }
    if (me.baseDesc === BENCH) { calls.push([fn, id]); }
    if (fn === 'MoveTo') {
      const target = world[idOfDesc(args[0].desc)];
      if (!target) { throw new Error('MoveTo - target object reference was nullptr'); }
      me.worldOrCellDesc = target.worldOrCellDesc;
      me.pos = [target.pos[0] + args[1], target.pos[1] + args[2], target.pos[2] + args[3]];
      if (args[4]) { me.angle = target.angle.slice(); }
      me.sent = me.angle.slice();
      return null;
    }
    if (fn === 'SetAngle') { me.angle = [args[0], args[1], args[2]]; return null; }
    throw new Error('unexpected Papyrus ' + fn);
  }
};
const logged = [];
function makeBlock() {
  const box = {
    console: { log: function () { logged.push(Array.prototype.slice.call(arguments).join(' ')); } },
    require: require, mp: mp, Date: Date,
    BUILDING_BY_DOOR: {}, BUILDING_NAME: {}, WAY_OUT: {}, BENCH_BY_BASE: {},
    idOf: function () { return 0; }, notify: function () { }, say: function () { },
    guard: function (n, f) { return f; },
    setInterval: function () { return 1; }, clearInterval: function () { },
    log: function () { },
    __thornswoodCharacter: { stateOf: function () { return {}; }, writeState: function () { } }
  };
  box.globalThis = box;
  inDir(function () { vm.runInNewContext(propBlock, box, { filename: 'gamemode.js property' }); });
  return box.__thornswoodProperty;
}

let W = makeBlock();
yes('S1 the property block runs, with the benches in it', !!W && typeof W.standBenches === 'function' && typeof W.standBench === 'function');
if (!W) { done(); }
const refs = W.benchRefs();
yes('S2 at start every bench stands, with nobody online, in its forge\'s worldspace at its point (' + placedRefs.length + ')',
    placedRefs.length === names.length && names.every((s) => {
      const b = world[refs[s]];
      return !!b && b.baseDesc === BENCH && b.worldOrCellDesc === sites[s].cell && near(b.pos, sites[s].pos);
    }));
yes('  turned to its angle, and every game near it is sent that angle, because it was turned before the move',
    names.every((s) => near(world[refs[s]].angle, [0, 0, sites[s].angle]) && near(world[refs[s]].sent, [0, 0, sites[s].angle])));
yes('  each one turned, then moved', calls.map((c) => c[0]).join(',') === names.map(() => 'SetAngle,MoveTo').join(','));
yes('  and the server log says where each stood', names.every((s) => logged.some((l) =>
  l.indexOf('benches: stood ' + s + '\'s woodworking bench') >= 0 && l.indexOf(sites[s].cell) >= 0)));

calls = [];
inDir(() => W.standBenches());
yes('S3 standing them again places nothing and moves nothing', placedRefs.length === names.length && calls.length === 0);

const first = names[0];
world[refs[first]].pos = [1, 2, 3];
inDir(() => W.standBenches());
yes('S4 a bench found away from its point is moved back, not placed again', near(world[refs[first]].pos, sites[first].pos) &&
    placedRefs.length === names.length);
delete world[refs[first]];
inDir(() => W.standBenches());
const again = W.benchRefs()[first];
yes('S5 a bench that is gone is stood again, once', again !== refs[first] && !!world[again] &&
    near(world[again].pos, sites[first].pos) && placedRefs.length === names.length + 1);

calls = [];
const kept = JSON.stringify(W.benchRefs());
W = makeBlock();
yes('S6 after a restart the same references stand, none is placed and none moved',
    JSON.stringify(W.benchRefs()) === kept && placedRefs.length === names.length + 1 && calls.length === 0);

// A forge the server does not have in the table's worldspace: nothing is placed in Tamriel's middle.
const second = names[1] || names[0];
fs.writeFileSync(path.join(dir, 'private', 'benches.json'), '{}');
world[ids[sites[second].forge.toLowerCase()]].worldOrCellDesc = 'abcde:Skyrim.esm';
logged.length = 0;
const before = placedRefs.length;
W = makeBlock();
yes('S7 a forge the server has elsewhere stands no bench there, and the log says why',
    !W.benchRefs()[second] && placedRefs.length === before + names.length - 1 &&
    logged.some((l) => l.indexOf('benches: nothing to stand ' + second + '\'s woodworking bench') >= 0));

const code = slice(gm, '  function standBench(site) {', '\n  }\n') || '';
const stand = slice(gm, '  function standBenches() {', '\n  }\n') || '';
yes('S8 there is no timer: the benches are stood once, at start, after the boards',
    code.length > 0 && stand.length > 0 && !/setInterval|setTimeout/.test(code + stand) &&
    /standBoards\(\);\s*\/\/[^\n]*\n\s*standBenches\(\);/.test(gm));

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
  if (run && run.status === 2) {
    console.log('SKIP  R3: the game at ' + data + ' is not the collection\'s load order:');
    console.log(said.split('\n').filter((l) => /STOP/.test(l)).join('\n'));
  } else {
    yes('R3 read again from the plugins at ' + data + ', every spot is clear and gives the committed table and block',
        !!run && run.status === 0);
    if (!run || run.status !== 0) { console.log(said); }
  }
} else {
  console.log('SKIP  R3: no game at ' + data + ' (a machine with the game reads the plugins again)');
}
done();
