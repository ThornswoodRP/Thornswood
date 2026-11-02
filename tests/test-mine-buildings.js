// test-mine-buildings.js
//
// Measure-MineBuildings.py finds the buildings that hold placed ore veins, and
// the buildings a lock would shut a vein behind.
//
// WHY THIS EXISTS. Entry 325. Patrick's mining design of 17 September says
// "Nobody owns a mine", and his property ruling of 21 September says "every
// building in the game is claimable". Which one wins at a mine is his to
// decide. The measurement is what he decides it with, and until it existed the
// only list of mines was every building whose name ended in "Mine", which
// counts Miner's Barracks and misses a cave full of iron.
//
// So this builds a Data folder in a temp directory from nothing: five masters,
// one plugin that deletes a vein and places another, a folder of gamemode
// tables holding the three it reads, and a doors.json with a hall in front of one mine
// and a cave with two ways in. It runs the measurement on that and checks
// every answer: a vein in a building, a vein on open ground, a vein in a room
// no door leads to, a deleted vein, a disabled one, a compressed record, the
// only road in and a road with a second way round. Then it reads the committed
// game/data/mine-buildings.json against the real gamemode's tables, so the list
// Patrick reads is the list /claim would act on.
//
// The made-up world has worldspaces of its own too, because the first version
// counted the outdoors of every worldspace as open ground and so missed that a
// lock on Darkfall Cave shuts the Forgotten Vale's 50 veins. A vale reached only
// through a hall has to come out behind that hall, a worldspace with two roads
// in through two halls (Blackreach's lifts) has to stay open ground, and one no
// door reaches (Japhet's Folly, by boat) has to be open ground and said by name.
//
// Read only apart from its own temp folder, which it removes.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const REPO = REPO_DIR;
const MEASURE = path.join(REPO, 'scripts', 'dev', 'Measure-MineBuildings.py');
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const CRLF = CR + LF;

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

yes('the measurement is in tools', fs.existsSync(MEASURE));
if (!fs.existsSync(MEASURE)) done();

function findPython() {
  const tries = [['python', []], ['py', ['-3']], ['python3', []]];
  for (let i = 0; i < tries.length; i++) {
    const r = spawnSync(tries[i][0], tries[i][1].concat(['-c', 'import sys; print(sys.version_info[0])']),
      { encoding: 'utf8' });
    if (r.status === 0 && String(r.stdout).trim() === '3') return tries[i];
  }
  return null;
}
const PY = findPython();
yes('there is a Python 3 to run the measurement with', !!PY);
if (!PY) done();
function py(args) {
  return spawnSync(PY[0], PY[1].concat(args), {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' })
  });
}

// ---------------------------------------------------------------------------
// A plugin, byte by byte. A record is a 24 byte header and its data; a group
// is a 24 byte header whose size counts itself; a subrecord is a tag, a two
// byte size and its body.

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }
function f32(n) { const b = Buffer.alloc(4); b.writeFloatLE(n); return b; }
function cat(parts) { return Buffer.concat(parts.map(function (p) { return Buffer.isBuffer(p) ? p : Buffer.from(p, 'latin1'); })); }
function z(s) { return Buffer.from(s + String.fromCharCode(0), 'latin1'); }

function sub(tag, body) { return cat([tag, u16(body.length), body]); }
function rec(tag, flags, fid, body, packed) {
  let data = body;
  if (packed) {
    data = cat([u32(body.length), zlib.deflateSync(body)]);
    flags = flags | 0x00040000;
  }
  return cat([tag, u32(data.length), u32(flags), u32(fid), Buffer.alloc(8), data]);
}
function grp(label, type, kids) {
  const body = cat(kids);
  const lab = typeof label === 'string' ? Buffer.from(label, 'latin1') : u32(label);
  return cat(['GRUP', u32(24 + body.length), lab, u32(type), Buffer.alloc(8), body]);
}
function tes4(masters) {
  const subs = [sub('HEDR', cat([f32(1.7), u32(0), u32(0x800)]))];
  masters.forEach(function (m) { subs.push(sub('MAST', z(m))); subs.push(sub('DATA', Buffer.alloc(8))); });
  return rec('TES4', 0, 0, cat(subs));
}
function cell(fid, edid, full, inside, packed) {
  const subs = [sub('EDID', z(edid))];
  if (full) subs.push(sub('FULL', z(full)));
  subs.push(sub('DATA', Buffer.from([inside ? 1 : 0, 0])));
  return rec('CELL', 0, fid, cat(subs), packed);
}
function refr(fid, base, flags, packed) {
  return rec('REFR', flags || 0, fid, cat([sub('NAME', u32(base)), sub('DATA', Buffer.alloc(24))]), packed);
}
function inCell(fid, refs) { return grp(fid, 6, [grp(fid, 9, refs)]); }
function interiors(pairs) {
  // An interior cell block and sub-block, then each cell and its children.
  const kids = [];
  pairs.forEach(function (p) { kids.push(p[0]); if (p[1]) kids.push(p[1]); });
  return grp('CELL', 0, [grp(0, 2, [grp(0, 3, kids)])]);
}

const IRON = 0x100, GOLD = 0x101, BARREL = 0x999;
const DELETED = 0x20, DISABLED = 0x800;
const A = 0xA01, H = 0xA02, N = 0xA03, M = 0xA04, S = 0xA05, K = 0xA06, T = 0xA07;
// The gate hall into the vale, a cave inside the vale, the two lifts into the
// reach, and a den reached only from the far world.
const G = 0xA08, VC = 0xA09, L1 = 0xA0A, L2 = 0xA0B, FR = 0xA0C;
const TAMRIEL = 0x3C, X = 0xB01;
const VALE = 0x3D, VX = 0xB02, REACH = 0x3E, RX = 0xB03, FAR = 0x3F, FX = 0xB04;
const SOLSTHEIM = 0x40, SX = 0xB05;

// A worldspace, its one outdoor cell and what stands in it.
function world(fid, edid, full, cellFid, refs) {
  const subs = [sub('EDID', z(edid))];
  if (full) subs.push(sub('FULL', z(full)));
  return [rec('WRLD', 0, fid, cat(subs)),
          grp(fid, 1, [grp(0, 4, [grp(0, 5, [
            cell(cellFid, edid + 'Cell', '', false), inCell(cellFid, refs)])])])];
}

const skyrim = cat([
  tes4([]),
  interiors([
    [cell(A, 'TestMine', 'Test Mine', true), inCell(A, [
      refr(0x2001, IRON), refr(0x2002, GOLD), refr(0x2003, IRON, DISABLED), refr(0x2004, BARREL)])],
    [cell(H, 'TestHall', 'Test Hall', true), null],
    // A room no door leads into, stored compressed the way a large cell is.
    [cell(N, 'TestVault', 'Sealed Vault', true, true), inCell(N, [refr(0x2005, GOLD, 0, true)])],
    [cell(M, 'OldMine', 'Old Mine', true), null],
    [cell(S, 'MinersBarracks', "Miner's Barracks", true), null],
    [cell(K, 'BackCave', 'Back Cave', true), inCell(K, [refr(0x2007, IRON)])],
    [cell(T, 'TwinHall', 'Twin Hall', true), null],
    [cell(G, 'GateHall', 'Gate Hall', true), null],
    [cell(VC, 'ValeCave', 'Vale Cave', true), inCell(VC, [refr(0x2009, IRON)])],
    [cell(L1, 'LiftOne', 'Lift One', true), null],
    [cell(L2, 'LiftTwo', 'Lift Two', true), null],
    [cell(FR, 'FarDen', 'Far Den', true), inCell(FR, [refr(0x200D, IRON)])]
  ]),
  grp('WRLD', 0, [].concat(
    world(TAMRIEL, 'Tamriel', '', X, [refr(0x2006, IRON)]),
    world(VALE, 'TestValeWorld', 'Test Vale', VX, [refr(0x2008, GOLD)]),
    world(REACH, 'TestReachWorld', 'Test Reach', RX, [refr(0x200A, IRON)]),
    world(FAR, 'TestFarWorld', 'Test Far', FX, [refr(0x200B, IRON)]),
    world(SOLSTHEIM, 'DLC2SolstheimWorld', 'Solstheim', SX, [refr(0x200C, IRON)])))
]);

// The plugin after it deletes one vein in the mine and places a new one, as a
// mod that reworks a mine would. Index 0 is Skyrim.esm, index 1 is itself.
const later = cat([
  tes4(['Skyrim.esm']),
  interiors([[cell(A, 'TestMine', 'Test Mine', true), inCell(A, [
    rec('REFR', DELETED, 0x2002, Buffer.alloc(0)),
    refr(0x01000800, GOLD)])]])
]);

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-mines-'));
const DATA = path.join(ROOT, 'Data');
fs.mkdirSync(DATA);
fs.writeFileSync(path.join(DATA, 'Skyrim.esm'), skyrim);
['Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'].forEach(function (m) {
  fs.writeFileSync(path.join(DATA, m), tes4(['Skyrim.esm']));
});
fs.writeFileSync(path.join(DATA, 'Later.esp'), later);
fs.writeFileSync(path.join(ROOT, 'plugins.txt'), '# a comment' + CRLF + '*Later.esp' + CRLF);

function d(fid) { return fid.toString(16) + ':Skyrim.esm'; }
const doorPairs = [
  // outside -> Test Hall -> Test Mine: the hall is the only road in.
  ['e01', X, 'e02', H], ['e03', H, 'e04', A],
  ['e05', X, 'e06', M], ['e07', X, 'e08', S],
  // outside -> Twin Hall -> Back Cave, and outside -> Back Cave as well.
  ['e09', X, 'e0a', T], ['e0b', T, 'e0c', K], ['e0d', X, 'e0e', K],
  // outside -> Gate Hall -> the vale, and the vale -> Vale Cave. Each pair is
  // written with the building last, since that is the building both halves
  // answer with.
  ['e0f', X, 'e10', G], ['e11', VX, 'e12', G], ['e13', VX, 'e14', VC],
  // outside -> Lift One -> the reach, and outside -> Lift Two -> the reach.
  ['e15', X, 'e16', L1], ['e17', RX, 'e18', L1], ['e19', X, 'e1a', L2], ['e1b', RX, 'e1c', L2],
  // The far world has no door from anywhere, and one to the den inside it.
  ['e1d', FX, 'e1e', FR]
];
const doors = { cells: {}, doors: {} };
const byDoor = {};
doorPairs.forEach(function (p) {
  doors.doors[d(parseInt(p[0], 16))] = { cell: d(p[1]), to: d(parseInt(p[2], 16)) };
  doors.doors[d(parseInt(p[2], 16))] = { cell: d(p[3]), to: d(parseInt(p[0], 16)) };
  // Both halves of a pair answer with the room on the far end, which is how
  // Build-DoorTable.py writes BUILDING_BY_DOOR.
  byDoor[d(parseInt(p[0], 16))] = d(p[3]);
  byDoor[d(parseInt(p[2], 16))] = d(p[3]);
});
[X, VX, RX, FX].forEach(function (c) { doors.cells[d(c)] = { edid: 'x', interior: false }; });
[A, H, M, S, K, T, G, VC, L1, L2, FR].forEach(function (c) { doors.cells[d(c)] = { edid: 'x', interior: true }; });
fs.writeFileSync(path.join(ROOT, 'doors.json'), JSON.stringify(doors));

const names = {};
names[d(A)] = 'Test Mine'; names[d(H)] = 'Test Hall'; names[d(M)] = 'Old Mine';
names[d(S)] = "Miner's Barracks"; names[d(K)] = 'Back Cave'; names[d(T)] = 'Twin Hall';
names[d(G)] = 'Gate Hall'; names[d(VC)] = 'Vale Cave'; names[d(L1)] = 'Lift One';
names[d(L2)] = 'Lift Two'; names[d(FR)] = 'Far Den';
// The gamemode reads its tables from a folder (#5191): one with all three, and
// one with no ORES_BY_BASE.
const GT = require('../scripts/dev/GamemodeTables.js');
const ores = {
  '100:Skyrim.esm': { ore: '5:Skyrim.esm', name: 'Iron Ore', rank: 'novice', yield: [[1, 2], [1, 3], [1, 4], [1, 5]] },
  '101:Skyrim.esm': { ore: '6:Skyrim.esm', name: 'Gold Ore', rank: 'expert', yield: [[0, 0], [0, 0], [1, 4], [1, 5]] }
};
['tables', 'no-ores'].forEach(function (dir) {
  fs.mkdirSync(path.join(ROOT, dir));
  GT.write('BUILDING_BY_DOOR', byDoor, path.join(ROOT, dir));
  GT.write('BUILDING_NAME', names, path.join(ROOT, dir));
});
GT.write('ORES_BY_BASE', ores, path.join(ROOT, 'tables'));

function run(tables, out) {
  const args = [MEASURE, '--data', DATA, '--plugins', path.join(ROOT, 'plugins.txt'),
                '--tables', path.join(ROOT, tables), '--doors', path.join(ROOT, 'doors.json')];
  if (out) args.push('--out', out);
  return py(args);
}

// ---------------------------------------------------------------------------
// The measurement on the made-up world

const OUT = path.join(ROOT, 'out.json');
const r = run('tables', OUT);
if (r.status !== 0) console.log(r.stdout + r.stderr);
yes('it runs and exits 0', r.status === 0);
let got = null;
try { got = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { got = null; }
yes('--out writes the measurement as JSON', !!got);
if (!got) { fs.rmSync(ROOT, { recursive: true, force: true }); done(); }
const c = got.counts || {};
const b = got.buildings || {};
const mine = b[d(A)] || {};

yes('twelve placed veins: three in the mine, one in the vault, one on Tamriel, one in the back cave, ' +
    'one in the vale and one in the cave inside it, one in the reach, one in the far world and one in ' +
    'the den inside it, one on Solstheim',
    c.placed === 12);
yes('the vein a later plugin deleted is not counted, and is counted as removed',
    c.removedByLaterPlugin === 1);
yes('the initially disabled vein is counted and said', c.disabled === 1 && mine.disabled === 1);
yes('a barrel in the mine is not a vein', mine.veins === 3);
yes('the mine holds two iron and the gold the later plugin placed',
    !!mine.ores && mine.ores['Iron Ore'] === 2 && mine.ores['Gold Ore'] === 1 &&
    Object.keys(mine.ores).length === 2);
yes('the mine is named the way BUILDING_NAME names it', mine.name === 'Test Mine');
yes('four buildings hold veins, the mine, the back cave, the vale cave and the far den, and nothing else',
    Object.keys(b).sort().join(',') === [d(A), d(K), d(VC), d(FR)].sort().join(',') && c.buildings === 4);
yes('six veins stand inside a building somebody can claim', c.inBuildings === 6);
yes('the vein on Tamriel is counted under its worldspace',
    !!got.openGround && got.openGround.Tamriel === 1);
yes('the vault no door leads into, compressed, is found and kept out of the buildings',
    c.noDoor === 1 && got.noDoor && got.noDoor[d(N)] && got.noDoor[d(N)].name === 'Sealed Vault' &&
    got.noDoor[d(N)].veins === 1 && !b[d(N)]);
yes('the hall is the only road into the mine, so it is on the way in',
    JSON.stringify(mine.onTheWayIn) === JSON.stringify([d(H)]));
yes('the hall is listed as shutting the mine, and as holding no vein of its own',
    !!got.onTheWayIn && !!got.onTheWayIn[d(H)] &&
    JSON.stringify(got.onTheWayIn[d(H)].shuts) === JSON.stringify([d(A)]) &&
    got.onTheWayIn[d(H)].holdsVein === false);
yes('a hall with a second way round it shuts nothing',
    JSON.stringify((b[d(K)] || {}).onTheWayIn) === '[]' && !got.onTheWayIn[d(T)]);
yes('a building called a mine with no vein is listed, and Miner\'s Barracks is not',
    JSON.stringify(got.calledAMineWithNoVein) === JSON.stringify({ 'a04:Skyrim.esm': 'Old Mine' }));
yes('the printed list names the mine and the road into it',
    /Test Mine\s+3\s+Iron Ore 2, Gold Ore 1/.test(r.stdout) &&
    /reached only through Test Hall/.test(r.stdout));
yes('the printed list names the hall under the buildings that hold no vein',
    /Test Hall\s+shuts Test Mine/.test(r.stdout));

// The worldspaces. Each is one place, whichever outdoor cell a door stands in.
const worlds = got.worlds || {};
const og = got.openGround || {};
const byNoDoor = got.reachedByNoDoor || [];
const vale = worlds[d(VALE)] || {};
yes('a worldspace reached only through a hall is behind that hall, not on open ground',
    JSON.stringify(vale.onTheWayIn) === JSON.stringify([d(G)]) && vale.veins === 1 &&
    vale.name === 'Test Vale' && vale.edid === 'TestValeWorld' && !!vale.ores &&
    vale.ores['Gold Ore'] === 1 && !og.TestValeWorld);
yes('its vein is counted as behind a building, in one worldspace',
    c.behindABuilding === 1 && c.worldsBehindABuilding === 1 && Object.keys(worlds).length === 1);
yes('a cave inside that worldspace is behind the same hall',
    JSON.stringify((b[d(VC)] || {}).onTheWayIn) === JSON.stringify([d(G)]));
yes('the hall is listed as shutting the worldspace and the cave in it, and as holding no vein',
    !!got.onTheWayIn && !!got.onTheWayIn[d(G)] &&
    JSON.stringify(got.onTheWayIn[d(G)].shuts) === JSON.stringify([d(VALE), d(VC)].sort()) &&
    got.onTheWayIn[d(G)].holdsVein === false);
yes('a worldspace with two roads in through two halls is open ground, and neither hall shuts it',
    og.TestReachWorld === 1 && !worlds[d(REACH)] &&
    !got.onTheWayIn[d(L1)] && !got.onTheWayIn[d(L2)]);
yes('a worldspace no door reaches is open ground, and said by name',
    og.TestFarWorld === 1 && byNoDoor.indexOf('TestFarWorld') >= 0);
yes('a room reached only from that worldspace is measured from it, not written off as doorless',
    !!b[d(FR)] && JSON.stringify(b[d(FR)].onTheWayIn) === '[]' && !b[d(FR)].noDoorRoad);
yes('Solstheim is open ground by default, not a place reached by no door',
    og.DLC2SolstheimWorld === 1 && byNoDoor.indexOf('DLC2SolstheimWorld') < 0 &&
    JSON.stringify(got.openWorlds) === JSON.stringify(['DLC2SolstheimWorld', 'Tamriel']));
yes('four veins on open ground: Tamriel, the reach, the far world and Solstheim',
    c.openGround === 4 && Object.keys(og).length === 4);
yes('the counts add up: open ground, behind a building, in buildings and doorless rooms',
    c.placed === c.openGround + c.behindABuilding + c.inBuildings + c.noDoor);
yes('the printed list names the worldspace, its vein and the hall it is behind',
    /Test Vale \(worldspace\)\s+1\s+Gold Ore 1\s+reached only through Gate Hall/.test(r.stdout) &&
    /Gate Hall\s+shuts Test Vale \(worldspace\), Vale Cave/.test(r.stdout));
yes('the printed list names the worldspace no door reaches',
    /Test Far \(worldspace\)\s+1\s+TestFarWorld/.test(r.stdout));

// ---------------------------------------------------------------------------
// Read only

const before = fs.readdirSync(ROOT).sort().join(',');
const r2 = run('tables', null);
yes('without --out it still runs', r2.status === 0);
yes('without --out it writes nothing and says so',
    fs.readdirSync(ROOT).sort().join(',') === before && /nothing was written/.test(r2.stdout));

// A missing table would make every answer "no mines", which reads like a world
// with none in it. It has to stop instead.
const r3 = run('no-ores', path.join(ROOT, 'never.json'));
yes('a gamemode with no ORES_BY_BASE stops rather than reporting no mines',
    r3.status !== 0 && /STOP/.test(r3.stdout) && !fs.existsSync(path.join(ROOT, 'never.json')));

fs.rmSync(ROOT, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// The committed measurement against the real gamemode

const COMMITTED = path.join(REPO, 'game', 'data', 'mine-buildings.json');
let real = null;
try { real = JSON.parse(fs.readFileSync(COMMITTED, 'utf8')); } catch (e) { real = null; }
yes('game/data/mine-buildings.json is committed and reads', !!real);
if (!real) done();
const gm = fs.readFileSync(path.join(REPO, 'game', 'gamemode.js'), 'utf8');
function table(name) { return require('./gamemode-tables.js').inGamemode(gm, name); }
const realByDoor = table('BUILDING_BY_DOOR');
const realNames = table('BUILDING_NAME');
yes('the real gamemode carries BUILDING_BY_DOOR and BUILDING_NAME', !!realByDoor && !!realNames);
if (!realByDoor || !realNames) done();
const claimable = {};
Object.keys(realByDoor).forEach(function (k) { claimable[realByDoor[k]] = true; });

const rb = real.buildings || {};
const rk = Object.keys(rb);
const stale = 'if this fails, the door table moved: run python scripts/dev/Measure-MineBuildings.py --out game/data/mine-buildings.json';
yes('every building in it is one /claim would take (' + stale + ')',
    rk.length > 0 && rk.every(function (k) { return claimable[k]; }));
yes('every building in it is named the way BUILDING_NAME names it',
    rk.every(function (k) { return rb[k].name === realNames[k]; }));
const rw = real.worlds || {};
yes('every building on the way in is one /claim would take, and shuts a building or worldspace in the list',
    Object.keys(real.onTheWayIn || {}).every(function (k) {
      return claimable[k] && real.onTheWayIn[k].shuts.every(function (s) { return !!rb[s] || !!rw[s]; });
    }));
yes('every worldspace behind a building names at least one building /claim would take',
    Object.keys(rw).every(function (k) {
      return rw[k].onTheWayIn.length > 0 && rw[k].onTheWayIn.every(function (x) { return claimable[x]; });
    }));
// The case the first version missed, pinned so a measurement written by it
// again cannot pass: Darkfall Cave is the only road into the Forgotten Vale.
yes('the Forgotten Vale is behind Darkfall Cave in it',
    !!rw['bb5:Dawnguard.esm'] &&
    JSON.stringify(rw['bb5:Dawnguard.esm'].onTheWayIn) === JSON.stringify(['4346:Dawnguard.esm']));
const rc = real.counts || {};
let inside = 0;
rk.forEach(function (k) { inside += rb[k].veins; });
let outside = 0;
Object.keys(real.openGround || {}).forEach(function (w) { outside += real.openGround[w]; });
let shutOut = 0;
Object.keys(rw).forEach(function (k) { shutOut += rw[k].veins; });
yes('its counts add up: open ground, worldspaces behind a building, buildings and doorless rooms make every placed vein',
    rc.placed === rc.openGround + rc.behindABuilding + rc.inBuildings + rc.noDoor &&
    rc.inBuildings === inside && rc.openGround === outside && rc.buildings === rk.length &&
    rc.behindABuilding === shutOut && rc.worldsBehindABuilding === Object.keys(rw).length);
yes('every building the gamemode calls a mine is accounted for in it',
    Object.keys(realNames).every(function (k) {
      return !/\bMines?\b/.test(realNames[k]) || !!rb[k] || !!(real.onTheWayIn || {})[k] ||
             !!(real.calledAMineWithNoVein || {})[k];
    }));
yes('nothing in it failed to inflate', rc.failedToInflate === 0);

done();
