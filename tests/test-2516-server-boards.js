'use strict';
/*
  test-2516-server-boards.js

      node tests/test-2516-server-boards.js

  #2516. Each game used to put the notice boards down itself and, two seconds
  later, could no longer find a copy it had moved into a cell that was not
  loaded, so it put another down at the person, for every far town, for ever
  (Patrick on dev, 12 Oct). Now the server stands one board and one drop box
  per hold, as its own references every game is sent, and answers E on them.

  The real property block runs over a pretend engine that keeps references,
  places them (mp.place, at Tamriel's 0, 0, 0) and runs the two Papyrus calls
  the block makes, MoveTo and SetAngle, the way the fork's
  PapyrusObjectReference does for an object: MoveTo puts it in the target's
  cell, at the target's point plus the offset, and keeps its own angle. It
  also keeps the angle each client was last SENT, the way the fork does: a
  reference's angle reaches a client in the message that streams it to them,
  which a move sends, and SetAngle sends nothing. It checks:
    - at start every board stands at its spot, a board in Tamriel next to
      itself and one elsewhere (Raven Rock's inn) next to its anchor, with
      nobody in the cell; each turned to face its reader (facing + 180), and
      its box at BOX_AT turned with it, on the shelf;
    - the angle is set before the move, so what a client is sent is right;
    - standing them again moves and places nothing; a board standing at an
      old point is moved to its spot, not to twice its point;
    - a board whose reference is gone, in a cell with no anchor, is not
      placed at Tamriel's middle, and says why;
    - a steward's move takes the cell or worldspace, the point and the
      facing where they stand, and turns the board to face them;
    - E on the board opens only the board, E on the box only the box;
    - after a restart the same references are used, not new ones;
    - there is no timer: boardTick, somebodyIn and the ten seconds are gone;
    - each of the nine sites carries its own worldspace, and each spot outside
      Tamriel an anchor.
*/
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const read = function (p) { return fs.readFileSync(p, 'utf8').split(CR).join(''); };
const gm = require('./gamemode-tables.js').joined(read(path.join(REPO_DIR, 'game', 'gamemode.js')));
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
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
const propBlock = slice(gm, '// ==== thornswood property ====', '// ==== end thornswood property ====');
yes('the property block is in the gamemode', !!propBlock);
if (!propBlock) { done(); }

const TAMRIEL = '3c:Skyrim.esm';
const NETCH = '17ec0:Dragonborn.esm';
const WHITERUN_WORLD = '1a26f:Skyrim.esm';
const INSIDE = 'abcde:Skyrim.esm';
const BOARD_BASE = 0x0B00593B, BOX_BASE = 0x0B0154D0;
const NETCH_CHEST = 0x04025029;        // 25029:Dragonborn.esm, Raven Rock's anchor
const STEWARD = { a: 0xff000606, pid: 606, name: 'Proventus' };
const ALICE = { a: 0xff000303, pid: 303, name: 'Alice' };
const BOB = { a: 0xff000404, pid: 404, name: 'Bob' };
const PEOPLE = [STEWARD, ALICE, BOB];
const WR_SPOT = [23139.4, -7891.7, -3494.4];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-2516-'));
fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
fs.mkdirSync(path.join(dir, 'private'));
// An office is one character's (#2551, Patrick, 16 Oct): the law register
// names the character that holds each office for its account. A profile the
// door ties to no account is an account of its own, 'p:<profile>'.
fs.writeFileSync(path.join(dir, 'private', 'law.json'), JSON.stringify({ cells: {}, held: { 'steward:whiterun': { 'p:606': { pid: 606, name: 'Proventus' } } } }));
function writeRegister(boards) {
  fs.writeFileSync(path.join(dir, 'private', 'property.json'), JSON.stringify({
    claims: {}, boxes: {}, funds: {}, notices: {}, boards: boards
  }));
}
writeRegister({
  whiterun: { cell: TAMRIEL, pos: WR_SPOT, facing: 188.4, where: 'Whiterun', placed: 1 },
  ravenrock: { cell: NETCH, pos: [-39, -178.2, 0], where: 'Raven Rock', seed: 5 }
});
function inDir(f) {
  const was = process.cwd();
  process.chdir(dir);
  try { return f(); } finally { process.chdir(was); }
}

// ------------------------------------------------------------- the engine
const world = {};          // id -> { baseDesc, worldOrCellDesc, pos, angle, sent }
let next = 0xff00f000;
let placed = [];
let calls = [];            // [fn, id] in the order the block made them
PEOPLE.forEach(function (p) {
  world[p.a] = { profileId: p.pid, appearance: { name: p.name }, worldOrCellDesc: 'somewhere else',
                 pos: [0, 0, 0], angle: [0, 0, 0], inventory: { entries: [] } };
});
// The innkeeper's chest in The Retching Netch, a vanilla container that never moves.
world[NETCH_CHEST] = { baseDesc: '25018:Dragonborn.esm', worldOrCellDesc: NETCH, pos: [-64.9, -366.0, -122.6], angle: [0, 0, 0] };
const sets = [];
function idOfDesc(desc) {
  const d = String(desc || '').toLowerCase();
  if (d === '25029:dragonborn.esm') { return NETCH_CHEST; }
  const m = /^([0-9a-f]+)(:.*)?$/i.exec(d);
  return m ? parseInt(m[1], 16) : 0;
}
const mp = {
  makeProperty: function () { },
  get: function (id, key) {
    if (id === 0 && key === 'onlinePlayers') { return PEOPLE.map(function (p) { return p.a; }); }
    if (!world[id]) { throw new Error('no reference ' + id.toString(16)); }
    const v = world[id][key];
    return (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
  },
  set: function (id, key, v) {
    sets.push({ id: id, key: key, v: JSON.parse(JSON.stringify(v)) });
    if (!world[id]) { world[id] = {}; }
    world[id][key] = JSON.parse(JSON.stringify(v));
  },
  getDescFromId: function (id) { return (id >>> 0).toString(16) + (id >= 0xff000000 ? '' : ':Skyrim.esm'); },
  getIdFromDesc: function (desc) {
    const d = String(desc).toLowerCase();
    if (d === '593b:thornswood-content.esp') { return BOARD_BASE; }
    if (d === '154d0:thornswood-content.esp') { return BOX_BASE; }
    if (d === '25029:dragonborn.esm') { return NETCH_CHEST; }
    return 0;
  },
  lookupEspmRecordById: function (id) { return (id === BOARD_BASE || id === BOX_BASE) ? { record: { type: 'ACTI' } } : {}; },
  getNeighborsByPosition: function () { return []; },
  place: function (base) {
    const id = next++;
    world[id] = { baseDesc: base === BOARD_BASE ? '593b:Thornswood-Content.esp' : '154d0:Thornswood-Content.esp',
                  worldOrCellDesc: TAMRIEL, pos: [0, 0, 0], angle: [0, 0, 0], sent: null };
    placed.push(id);
    return id;
  },
  callPapyrusFunction: function (kind, cls, fn, self, args) {
    if (kind !== 'method' || cls !== 'ObjectReference') { throw new Error('unexpected call ' + cls + '.' + fn); }
    const id = idOfDesc(self.desc);
    const me = world[id];
    if (!me) { throw new Error('no self ' + self.desc); }
    calls.push([fn, id]);
    if (fn === 'MoveTo') {
      const target = world[idOfDesc(args[0].desc)];
      if (!target) { throw new Error('MoveTo - target object reference was nullptr'); }
      me.worldOrCellDesc = target.worldOrCellDesc;
      me.pos = [target.pos[0] + args[1], target.pos[1] + args[2], target.pos[2] + args[3]];
      if (args[4]) { me.angle = target.angle.slice(); }
      // The move streams it to whoever is near, with the angle it has now.
      me.sent = me.angle.slice();
      return null;
    }
    // MpObjectReference::SetAngle writes the change form and sends nothing.
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
    __thornswoodCharacter: { stateOf: function () { return {}; }, writeState: function () { } },
    // Proventus holds the Steward of Whiterun role (#2551), and nobody else holds an office.
    __thornswoodOffices: function (pid) {
      return { jarl: [], court: [], guard: [], steward: pid === STEWARD.pid ? ['whiterun'] : [] };
    }
  };
  box.globalThis = box;
  inDir(function () { vm.runInNewContext(propBlock, box, { filename: 'gamemode.js property' }); });
  return box.__thornswoodProperty;
}
function near(a, b, eps) { return !!a && !!b && a.every(function (v, i) { return Math.abs(v - b[i]) < (eps || 0.01); }); }
function plus(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }

// ------------------------------------------------------------ at start
let W = makeBlock();
yes('the property block runs, with the server\'s boards in it', !!W && typeof W.standBoards === 'function' &&
    typeof W.standBoard === 'function' && typeof W.boardActivated === 'function' && typeof W.boardAngle === 'function');
if (!W) { done(); }
function standAll() { inDir(function () { W.standBoards(); }); }

const wr = W.boards().whiterun;
const boardW = world[wr.ref], boxW = world[wr.boxRef];
yes('S1 at start Whiterun\'s board stands, in Tamriel, at its spot', !!boardW && boardW.worldOrCellDesc === TAMRIEL &&
    near(boardW.pos, WR_SPOT) && boardW.baseDesc === '593b:Thornswood-Content.esp');
yes('  turned to face its reader: facing 188.4 is a board at 8.4', near(boardW.angle, [0, 0, 8.4]) && W.boardAngle('whiterun') === 188.4 + 180 - 360);
const off = W.boxOffset(8.4);
yes('  and its drop box on the shelf, turned with it', !!boxW && boxW.worldOrCellDesc === TAMRIEL &&
    near(boxW.pos, plus(WR_SPOT, off)) && near(boxW.angle, [0, 0, 8.4]) &&
    boxW.baseDesc === '154d0:Thornswood-Content.esp');
yes('  and every game near it is sent that angle, because it was turned before the move',
    near(boardW.sent, [0, 0, 8.4]) && near(boxW.sent, [0, 0, 8.4]));
const rr = W.boards().ravenrock;
yes('S2 Raven Rock\'s, indoors, stands at start next to the inn\'s chest, with nobody in the cell',
    !!rr.ref && world[rr.ref].worldOrCellDesc === NETCH && near(world[rr.ref].pos, [-39, -178.2, 0]) &&
    near(world[rr.ref].angle, [0, 0, 180]) && near(world[rr.ref].sent, [0, 0, 180]));
yes('  and its box beside it, on the shelf, in the same cell', !!rr.boxRef && world[rr.boxRef].worldOrCellDesc === NETCH &&
    near(world[rr.boxRef].pos, plus([-39, -178.2, 0], W.boxOffset(180))) && placed.length === 4);
const order = calls.map(function (c) { return c[0]; }).join(',');
yes('  each one turned, then moved', order === 'SetAngle,MoveTo,SetAngle,MoveTo,SetAngle,MoveTo,SetAngle,MoveTo');

calls = [];
standAll();
yes('S3 standing them again places nothing and moves nothing', placed.length === 4 && calls.length === 0);

// A board that stands at an old point in its own cell (an older seeding, say) moves to its spot.
world[wr.ref].pos = [1000, 2000, 30];
standAll();
yes('S4 a board standing at an old point is moved to its spot, not to twice its point',
    near(world[wr.ref].pos, WR_SPOT) && placed.length === 4);
yes('  and its box with it', near(world[wr.boxRef].pos, plus(WR_SPOT, off)));
world[wr.ref].angle = [0, 0, 100];
standAll();
yes('  a board turned the wrong way is turned back, and sent so', near(world[wr.ref].angle, [0, 0, 8.4]) &&
    near(world[wr.ref].sent, [0, 0, 8.4]) && placed.length === 4);

const goneRef = wr.ref;
delete world[goneRef];
standAll();
yes('S5 a board that is gone is stood again, once, and its box with it',
    !!world[W.boards().whiterun.ref] && W.boards().whiterun.ref !== goneRef && placed.length === 5 &&
    near(world[W.boards().whiterun.ref].pos, WR_SPOT) &&
    near(world[W.boards().whiterun.boxRef].pos, plus(WR_SPOT, off)));

// ---------------------------------------------------------- a steward's move
const before = { ref: W.boards().whiterun.ref, box: W.boards().whiterun.boxRef };
world[STEWARD.a].worldOrCellDesc = WHITERUN_WORLD;
world[STEWARD.a].pos = [100, 200, -50];
world[STEWARD.a].angle = [3, 0, 90];
const said = [];
inDir(function () { W.command('/board', ['/board', 'move', 'whiterun'], STEWARD.a, STEWARD.pid, function (p, m) { said.push(m); }); });
const moved = W.boards().whiterun;
yes('S6 a steward\'s move records the worldspace, the point and the way they look',
    moved.cell === WHITERUN_WORLD && near(moved.pos, [100, 200, -50]) && moved.facing === 90 && moved.placed);
yes('  and moves the same board there, inside the walls, turned to face them',
    moved.ref === before.ref && world[moved.ref].worldOrCellDesc === WHITERUN_WORLD &&
    near(world[moved.ref].pos, [100, 200, -50]) && near(world[moved.ref].angle, [0, 0, 270]) &&
    near(world[moved.ref].sent, [0, 0, 270]));
const off270 = W.boxOffset(270);
yes('  and the same box with it', moved.boxRef === before.box && world[moved.boxRef].worldOrCellDesc === WHITERUN_WORLD &&
    near(world[moved.boxRef].pos, [100 + off270[0], 200 + off270[1], -50 + off270[2]]) && placed.length === 5);
yes('  and says so', /whiterun's board is here now/.test(said.join(' ')));

// -------------------------------------------------------------- the click
world[ALICE.a].worldOrCellDesc = WHITERUN_WORLD;
world[ALICE.a].pos = [150, 200, -50];
sets.length = 0;
let r = '';
inDir(function () { r = W.boardActivated(moved.ref, ALICE.a); });
const openedBoard = sets.filter(function (s) { return s.id === ALICE.a && s.key === 'thornswoodBoardOpen'; });
const openedBox = sets.filter(function (s) { return s.id === ALICE.a && s.key === 'thornswoodBoxView'; });
yes('S7 E on the board opens the board for her, and not the box', r === 'board' && openedBoard.length === 1 && openedBox.length === 0);
sets.length = 0;
inDir(function () { r = W.boardActivated(moved.boxRef, ALICE.a); });
const boxView = sets.filter(function (s) { return s.id === ALICE.a && s.key === 'thornswoodBoxView'; });
yes('  E on the box opens the box for her, and not the board', r === 'box' && boxView.length === 1 &&
    boxView[0].v.open === true && boxView[0].v.hold === 'whiterun' &&
    sets.filter(function (s) { return s.key === 'thornswoodBoardOpen'; }).length === 0);
inDir(function () { r = W.boardActivated(0xff00aaaa, ALICE.a); });
yes('  and E on anything else is not theirs', r === '');
const onActivate = slice(gm, "mp.onActivate = guard('onActivate', function (refrId, casterRefrId) {", 'WATER (#1382)') || '';
// Since #3166 the answer is kept, so that the board (and not its box) also ticks a
// newcomer's first steps before the press stops there.
yes('  and onActivate asks it first, and stops there when it answered',
    /const boardWhich = \(propBoard && propBoard\.boardActivated\) \? propBoard\.boardActivated\(refrId, casterRefrId\) : '';\s*if \(boardWhich\) \{[\s\S]{0,600}?\n      return false;\n    \}/.test(onActivate));

// --------------------------------------------------------------- a restart
const ids = JSON.stringify([W.boards().whiterun.ref, W.boards().whiterun.boxRef, W.boards().ravenrock.ref]);
calls = [];
W = makeBlock();
yes('S8 after a restart the same references stand, none is placed and none moved',
    JSON.stringify([W.boards().whiterun.ref, W.boards().whiterun.boxRef, W.boards().ravenrock.ref]) === ids &&
    placed.length === 5 && calls.length === 0);

// A board a steward put indoors, in a cell with no anchor, whose reference is gone.
writeRegister({
  whiterun: { cell: INSIDE, pos: [5, 6, 7], facing: 0, where: 'Whiterun', placed: 1, ref: 0xff00eeee }
});
logged.length = 0;
W = makeBlock();
yes('S9 a board with nothing to stand it next to is not placed in the middle of Tamriel',
    placed.length === 7 /* Raven Rock's two, seeded again */ &&
    !placed.slice(5).some(function (id) { return world[id].baseDesc === '593b:Thornswood-Content.esp' && world[id].worldOrCellDesc === TAMRIEL; }) &&
    /nothing to stand whiterun's board next to in abcde:Skyrim\.esm/.test(logged.join('\n')));

// ---------------------------------------------------------------- no timer
yes('S10 there is no timer: boardTick, somebodyIn and the ten second check are gone',
    gm.indexOf('function boardTick') < 0 && gm.indexOf('somebodyIn') < 0 && gm.indexOf('BOARD_CHECK_MS') < 0 &&
    /g\.__thornswoodBoardTimer = null;\s*standBoards\(\);/.test(gm));

// ---------------------------------------------------------------- the sites
{
  const a = gm.indexOf('  var BOARD_SITES = {');
  const b = gm.indexOf('\n  };\n', a);
  const sites = new Function('return ' + gm.slice(a + '  var BOARD_SITES = '.length, b + 4).replace(/;\s*$/, ''))();
  const nine = Object.keys(sites);
  yes('S11 each of the nine sites carries its own cell or worldspace', nine.length === 9 &&
      nine.every(function (h) { return typeof sites[h].cell === 'string' && sites[h].cell; }));
  yes('  and there is no single BOARD_CELL for all of them', gm.indexOf('BOARD_CELL') < 0);
  // Measured 15 Oct (#2516): the five walled cities in their own worldspaces, the four open towns in Tamriel.
  yes('  the five walled cities stand in their own worldspaces, as measured',
      sites.solitude.cell === '37edf:Skyrim.esm' && sites.whiterun.cell === '1a26f:Skyrim.esm' &&
      sites.riften.cell === '16bb4:Skyrim.esm' && sites.windhelm.cell === '1691d:Skyrim.esm' &&
      sites.markarth.cell === '16d71:Skyrim.esm');
  yes('  and the four open towns in Tamriel',
      ['falkreath', 'morthal', 'dawnstar', 'winterhold'].every(function (h) { return sites[h].cell === TAMRIEL; }));
  // Read out of the plugins on One, 15 Oct: a door, container or bench, persistent and enabled, near each spot.
  yes('  each walled city carries its anchor, a reference the server loads',
      sites.solitude.anchor === '101d9d:Skyrim.esm' && sites.whiterun.anchor === 'cdd7a:Skyrim.esm' &&
      sites.riften.anchor === '4227f:Skyrim.esm' && sites.windhelm.anchor === '23592:Skyrim.esm' &&
      sites.markarth.anchor === '1c38b:Skyrim.esm' &&
      ['falkreath', 'morthal', 'dawnstar', 'winterhold'].every(function (h) { return !sites[h].anchor; }));
  yes('  and so does Raven Rock\'s inn', /ravenrock: \{ cell: '17ec0:Dragonborn\.esm'[^}]*anchor: '25029:Dragonborn\.esm'/.test(gm));
  const seed = /var BOARD_SEED = (\d+);/.exec(gm);
  yes('  in a new seeding, so a saved board no steward moved is turned on the next deploy', !!seed && Number(seed[1]) >= 5);
}

done();
