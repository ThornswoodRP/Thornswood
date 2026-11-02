'use strict';
/*
  test-502-jail-cells.js

  #502. Patrick, 11 October: "jail cells should be usable by guards and guards
  should have jail cell access ... only wiithin their own hold", and "guards
  will be players no NPC guards".

  The real property block runs over a pretend engine with the real door,
  building and jail tables out of the gamemode, a guard of Whiterun and a
  guard of Riften (each by their Discord role since #2551, which the door
  hands the block as __thornswoodOffices), and a law register written before
  #2551, still carrying guards and a Jarl's seat. It checks:
    - the jail table: ten holds, every jail door a door of its jail building
      and a way out of it, and game/data/jails.json saying the same;
    - the register is read, a row that is not a cell dropped, and the old
      guards and seat neither read nor written back;
    - at a cell door the lock key offers the cell to a guard of that hold and
      to nobody else, and only a guard of that hold turns it;
    - what each person's game is told: the cells a guard locked are shut to
      everybody but that hold's guards, who have every cell of their hold
      open, and a cell nobody turned is left as the game ships it;
    - a claim on the jail building never opens a cell;
    - the people at the door hear it, and the server log records who did it;
    - onActivate refuses a press on a locked cell that reaches the server;
    - all of it survives a restart.
*/
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const read = function (p) { return fs.readFileSync(p, 'utf8').split(CR).join(''); };
const gm = require('./gamemode-tables.js').joined(read(process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js')));
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
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}
function table(kind, name) {
  const head = '\n' + kind + ' ' + name + ' = ';
  const a = gm.indexOf(head);
  if (a < 0) { return null; }
  const b = gm.indexOf(';\n', a + head.length);
  try { return JSON.parse(gm.slice(a + head.length, b)); } catch (e) { return null; }
}

const propBlock = slice(gm, '// ==== thornswood property ====', '// ==== end thornswood property ====');
yes('the property block is in the gamemode', !!propBlock);
if (!propBlock) { done(); }

// ------------------------------------------------------------ the tables
const BUILDING_BY_DOOR = table('const', 'BUILDING_BY_DOOR');
const BUILDING_NAME = table('const', 'BUILDING_NAME');
const WAY_OUT = table('const', 'WAY_OUT');
const JAIL_DOOR = table('  var', 'JAIL_DOOR');
const JAIL_NAME = table('  var', 'JAIL_NAME');
const JAIL_SHUT = table('  var', 'JAIL_SHUT');
yes('the door, building and jail tables are in the gamemode',
    !!BUILDING_BY_DOOR && !!BUILDING_NAME && !!WAY_OUT && !!JAIL_DOOR && !!JAIL_NAME && !!JAIL_SHUT);
if (!JAIL_DOOR || !BUILDING_BY_DOOR) { done(); }
const HOLDS10 = ['whiterun', 'solitude', 'riften', 'markarth', 'windhelm',
                 'falkreath', 'morthal', 'dawnstar', 'winterhold', 'ravenrock'];
yes('T1 every one of the ten holds has a jail, by name', HOLDS10.every(function (h) { return !!JAIL_NAME[h]; }) &&
    Object.keys(JAIL_NAME).length === 10);
yes('T2 and at least one door in it', HOLDS10.every(function (h) {
  return Object.keys(JAIL_DOOR).some(function (d) { return JAIL_DOOR[d] === h; });
}));
const notBuilding = Object.keys(JAIL_DOOR).filter(function (d) { return !BUILDING_BY_DOOR[d] || !WAY_OUT[d]; });
yes('T3 every jail door is a door of its jail building and a way out of it, which is why a claim never locked one' +
    (notBuilding.length ? ' (not: ' + notBuilding.join(', ') + ')' : ''), notBuilding.length === 0);
const oneBuilding = HOLDS10.every(function (h) {
  const bs = {};
  Object.keys(JAIL_DOOR).forEach(function (d) { if (JAIL_DOOR[d] === h) { bs[BUILDING_BY_DOOR[d]] = true; } });
  return Object.keys(bs).length === 1 && BUILDING_NAME[Object.keys(bs)[0]] === JAIL_NAME[h];
});
yes('T4 each hold\'s doors stand in one building, the jail of that name', oneBuilding);
yes('T5 the doors the game ships locked are jail doors', Object.keys(JAIL_SHUT).every(function (d) { return !!JAIL_DOOR[d]; }));
let jails = null;
try { jails = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'game', 'data', 'jails.json'), 'utf8')); } catch (e) { jails = null; }
const fromJson = {};
if (jails && jails.jails) {
  Object.keys(jails.jails).forEach(function (h) {
    Object.keys(jails.jails[h].doors || {}).forEach(function (d) { fromJson[d] = h; });
  });
}
yes('T6 game/data/jails.json is the script\'s, and names the same doors and holds',
    !!jails && jails.builtBy === 'scripts/dev/Build-JailTable.py' &&
    JSON.stringify(Object.keys(fromJson).sort()) === JSON.stringify(Object.keys(JAIL_DOOR).sort()) &&
    Object.keys(fromJson).every(function (d) { return fromJson[d] === JAIL_DOOR[d]; }));
yes('T7 scripts/dev/Build-JailTable.py is in the repo',
    fs.existsSync(path.join(REPO_DIR, 'scripts', 'dev', 'Build-JailTable.py')));

// Two cells in Dragonsreach Dungeon and one in Riften Jail, all shipped locked.
const W_CELLS = Object.keys(JAIL_DOOR).filter(function (d) { return JAIL_DOOR[d] === 'whiterun' && JAIL_SHUT[d]; });
const R_CELL = Object.keys(JAIL_DOOR).filter(function (d) { return JAIL_DOOR[d] === 'riften' && JAIL_SHUT[d]; })[0];
const CELL = W_CELLS[0], CELL2 = W_CELLS[1];
yes('the test has two shipped locked cells in Whiterun\'s jail and one in Riften\'s', !!CELL && !!CELL2 && !!R_CELL);
const JAIL = BUILDING_BY_DOOR[CELL];

// ============================================================== the server
const clock = { t: Date.UTC(2026, 9, 12, 7, 0, 0) };
class FakeDate extends Date { static now() { return clock.t; } }

const DUNGEON = JAIL;   // standing in the jail
function idOf(desc) {
  const m = /^([0-9a-f]+):(Skyrim\.esm|Dragonborn\.esm)$/i.exec(String(desc || ''));
  if (!m) { return 0; }
  return parseInt(m[1], 16) + (m[2].toLowerCase() === 'dragonborn.esm' ? 0x04000000 : 0);
}
function hex(desc) { return (idOf(desc) >>> 0).toString(16); }
function descOf(id) {
  if (id >= 0x04000000 && id < 0x05000000) { return (id - 0x04000000).toString(16) + ':Dragonborn.esm'; }
  return id.toString(16) + ':Skyrim.esm';
}

const GUARD_W = { a: 0xff000101, pid: 101, name: 'Hrongar' };   // a guard of Whiterun
const GUARD_R = { a: 0xff000202, pid: 202, name: 'Maul' };      // a guard of Riften
const PRISONER = { a: 0xff000303, pid: 303, name: 'Lucan' };
const FAR = { a: 0xff000404, pid: 404, name: 'Ysolda' };         // across the city
const PEOPLE = [GUARD_W, GUARD_R, PRISONER, FAR];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-502-cells-'));
fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
fs.mkdirSync(path.join(dir, 'private'));
// Somebody holds the jail building and has locked it: a claim's lock never
// reaches a cell.
fs.writeFileSync(path.join(dir, 'private', 'property.json'), JSON.stringify({ claims: {
  [JAIL]: { by: 909, name: 'Somebody', at: clock.t, touched: clock.t, locked: true }
} }));
const bogusCell = '999999:Skyrim.esm';
// Written before #2551: guards and a Jarl's seat, which the roles replace.
fs.writeFileSync(path.join(dir, 'private', 'law.json'), JSON.stringify({
  guards: { '101': 'whiterun', '202': 'riften', '303': 'whiterun', 'x': 'whiterun' },
  jarls: { whiterun: { pid: 404, actor: 0xff000404, name: 'Ysolda', at: 1 } },
  cells: { [bogusCell]: true },
  // Which character holds each office (#2551): the two guards.
  held: { 'guard:whiterun': { 'p:101': { pid: 101, name: 'Hrongar' } }, 'guard:riften': { 'p:202': { pid: 202, name: 'Maul' } } }
}));
function inDir(f) {
  const was = process.cwd();
  process.chdir(dir);
  try { return f(); } finally { process.chdir(was); }
}

function boot() {
  const refs = {};
  PEOPLE.forEach(function (p) {
    refs[p.a] = { profileId: p.pid, appearance: { name: p.name }, worldOrCellDesc: DUNGEON,
                  pos: p === FAR ? [90000, 0, 0] : [100, 100, 0], inventory: { entries: [] } };
  });
  const online = PEOPLE.map(function (p) { return p.a; });
  const logged = [];
  const mp = {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return online.slice(); }
      if (!refs[id]) { throw new Error('no reference ' + id); }
      const v = refs[id][key];
      return (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
    },
    set: function (id, key, v) {
      if (!refs[id]) { refs[id] = {}; }
      refs[id][key] = JSON.parse(JSON.stringify(v));
    },
    getDescFromId: function (id) { return descOf(id); },
    lookupEspmRecordById: function () { return null; },
    getNeighborsByPosition: function () { return []; }
  };
  const box = {
    console: { log: function () { logged.push(Array.prototype.join.call(arguments, ' ')); } },
    require: require, mp: mp, Date: FakeDate,
    BUILDING_BY_DOOR: BUILDING_BY_DOOR, BUILDING_NAME: BUILDING_NAME, WAY_OUT: WAY_OUT,
    BENCH_BY_BASE: {}, idOf: idOf,
    notify: function () { }, say: function () { },
    guard: function (n, f) { return f; },
    setInterval: function () { return 1; }, clearInterval: function () { },
    log: function () { },
    __thornswoodCharacter: { stateOf: function () { return { prof: 'cook' }; }, writeState: function () { } },
    // The Guard of Whiterun and Guard of Riften roles (#2551).
    __thornswoodOffices: function (pid) {
      return { jarl: [], court: [], steward: [],
               guard: pid === GUARD_W.pid ? ['whiterun'] : (pid === GUARD_R.pid ? ['riften'] : []) };
    }
  };
  box.globalThis = box;
  inDir(function () { vm.runInNewContext(propBlock, box, { filename: 'gamemode.js property' }); });
  return { W: box.__thornswoodProperty, refs: refs, logged: logged };
}

let S = boot();
let W = S.W;
yes('the property block runs and publishes the guards and cells', !!W && typeof W.isGuard === 'function' &&
    typeof W.mayPassCell === 'function' && typeof W.jailHoldOf === 'function');
if (!W) { done(); }

// ------------------------------------------------------------ the register
yes('R1 the two guards are guards by their roles, each of their hold',
    W.guardHoldsOf(101).join() === 'whiterun' && W.guardHoldsOf(202).join() === 'riften');
yes('R2 a guard the old register names and no role does is nobody (#2551)',
    !W.isGuard(303, 'whiterun') && W.guardHoldsOf(303).length === 0);
yes('R3 and a cell that is not a jail door', W.cellLocked(bogusCell) === false && W.jailHoldOf(bogusCell) === null);
yes('R4 the log says what was read and what was dropped',
    S.logged.some(function (l) { return /law: dropped 1 row\(s\) that were not a cell door or a held office/.test(l); }) &&
    S.logged.some(function (l) { return /law: read 0 cell door\(s\) a guard has turned, and 2 office\(s\) held by a character/.test(l); }));
yes('R5 a guard is a guard of their own hold and no other',
    W.isGuard(101, 'whiterun') && !W.isGuard(101, 'riften') && !W.isGuard(303, 'whiterun') && !W.isGuard(0, 'whiterun'));

// ------------------------------------------------------------ at the door
function open(p, door) { inDir(function () { W.touched(p.a, door); }); }
function lineOf(p) { return S.refs[p.a].thornswoodDoorLine || null; }
function locksOf(p) { return S.refs[p.a].thornswoodLocks || { shut: [], open: [] }; }
function word(p, w, args) {
  const by = {};
  let handled = null;
  inDir(function () {
    handled = W.command(w, [w].concat(args || []), p.a, p.pid, function (pid, m) { (by[pid] = by[pid] || []).push(m); });
  });
  return { handled: handled, mine: (by[p.pid] || []).join(' '), by: by };
}

open(GUARD_W, CELL);
let ln = lineOf(GUARD_W);
yes('D1 a guard of Whiterun at a Dragonsreach cell gets the cell on the lock key: "' + (ln && ln.x) + ' ' + (ln && ln.n) + '"',
    !!ln && ln.x === 'unlock' && ln.n === 'the cell' && ln.d.length === 1 && ln.d[0] === hex(CELL));
open(PRISONER, CELL);
ln = lineOf(PRISONER);
yes('D2 anybody else there is at a door of the jail building, not the cell', !!ln && ln.n !== 'the cell' &&
    ln.d.indexOf(hex(CELL)) === -1);
open(GUARD_R, CELL);
ln = lineOf(GUARD_R);
yes('D3 so is a guard of another hold', !!ln && ln.n !== 'the cell');

let r = word(GUARD_R, '/unlock', [hex(CELL)]);
yes('D4 a guard of Riften cannot turn a Whiterun cell: "' + r.mine + '"',
    r.handled === true && /That cell is in Dragonsreach Dungeon\. A guard keeps the cells of their own hold\./.test(r.mine) &&
    W.cellLocked(CELL) === true);
r = word(PRISONER, '/unlock', [hex(CELL)]);
yes('D5 nor can anybody who is not a guard: "' + r.mine + '"', /A cell is a guard's to lock\./.test(r.mine));
r = word(GUARD_W, '/lock', [hex(CELL)]);
yes('D6 a cell the game ships locked is already locked: "' + r.mine + '"', /already locked/.test(r.mine));
r = word(GUARD_W, '/unlock', [hex(CELL2)]);
yes('D7 the key turns only the cell door they just opened', /Open the cell door you mean first\./.test(r.mine) &&
    W.cellLocked(CELL2) === true);

// ---------------------------------------------------------- what each is told
function has(list, desc) { return list.indexOf(idOf(desc)) !== -1; }
let L = locksOf(PRISONER);
yes('P1 before any guard turns a cell, nobody else is told anything about it', !has(L.shut, CELL) && !has(L.open, CELL));
yes('P2 and a claim on the locked jail building does not open its cells for them',
    Object.keys(JAIL_DOOR).filter(function (d) { return JAIL_DOOR[d] === 'whiterun'; })
      .every(function (d) { return !has(L.open, d) && !has(L.shut, d); }));
L = locksOf(GUARD_W);
yes('P3 a guard of Whiterun has every cell of Whiterun\'s jail open in their own game',
    Object.keys(JAIL_DOOR).filter(function (d) { return JAIL_DOOR[d] === 'whiterun'; })
      .every(function (d) { return has(L.open, d) && !has(L.shut, d); }));
yes('P4 and no other hold\'s', !has(L.open, R_CELL) && !has(L.shut, R_CELL));
yes('P5 a guard of Riften has Riften\'s cells open and not Whiterun\'s',
    has(locksOf(GUARD_R).open, R_CELL) && !has(locksOf(GUARD_R).open, CELL));

open(GUARD_W, CELL);
r = word(GUARD_W, '/unlock', [hex(CELL)]);
yes('U1 the guard unlocks the cell: "' + r.mine + '"', r.mine === 'You unlock the cell. It opens for anybody now.' &&
    W.cellLocked(CELL) === false);
yes('U2 and everybody\'s game is told it is open', has(locksOf(PRISONER).open, CELL) && !has(locksOf(PRISONER).shut, CELL) &&
    has(locksOf(GUARD_R).open, CELL));
yes('U3 the line says Lock now', lineOf(GUARD_W).x === 'lock');
r = word(GUARD_W, '/lock', [hex(CELL)]);
yes('L1 the guard locks it again: "' + r.mine + '"',
    r.mine === 'You lock the cell. Only a guard of this hold opens it now; anybody else has to pick the lock.' &&
    W.cellLocked(CELL) === true);
yes('L2 it is shut in the prisoner\'s game and in a Riften guard\'s', has(locksOf(PRISONER).shut, CELL) &&
    !has(locksOf(PRISONER).open, CELL) && has(locksOf(GUARD_R).shut, CELL));
yes('L3 and still open in the Whiterun guard\'s', has(locksOf(GUARD_W).open, CELL) && !has(locksOf(GUARD_W).shut, CELL));
yes('L4 the people at the door hear it, and somebody across the city does not',
    (r.by[PRISONER.pid] || []).join(' ') === 'The cell door is locked.' &&
    (r.by[GUARD_R.pid] || []).join(' ') === 'The cell door is locked.' && !r.by[FAR.pid] &&
    (r.by[GUARD_W.pid] || []).length === 1);
yes('L5 the server log says which guard of which hold turned which cell', S.logged.some(function (l) {
  return l.indexOf('law: a guard of whiterun (Hrongar, profile 101) locked cell door ' + CELL + ' in Dragonsreach Dungeon') >= 0;
}));
yes('L6 a guard of Whiterun may go through it, the prisoner may not',
    W.mayPassCell(GUARD_W.a, GUARD_W.pid, CELL) && !W.mayPassCell(PRISONER.a, PRISONER.pid, CELL) &&
    !W.mayPassCell(GUARD_R.a, GUARD_R.pid, CELL));
yes('L7 a cell no guard has turned is the game\'s, and the server refuses nobody at it',
    W.mayPassCell(PRISONER.a, PRISONER.pid, CELL2));
yes('L8 a door that is not a cell is not the cell lock\'s', W.mayPassCell(PRISONER.a, PRISONER.pid, '1234:Skyrim.esm'));

// ----------------------------------------------------- the server half
const refusal = slice(gm, '        if (prop.jailHoldOf && prop.jailHoldOf(doorDesc)) {', '\n        }\n');
yes('O1 onActivate has the cell refusal, ahead of the building\'s', !!refusal &&
    gm.indexOf(refusal) < gm.indexOf('        const shutTo = prop.buildingOf(doorDesc);'));
if (refusal) {
  const told = [];
  const run = new Function('prop', 'mp', 'casterRefrId', 'doorDesc', 'notify', 'say', 'log',
                           refusal + '\nreturn true;');
  const mpGet = { get: function (id) { return id === PRISONER.a ? PRISONER.pid : GUARD_W.pid; } };
  const no = run(W, mpGet, PRISONER.a, CELL, function (a, m) { told.push(m); }, function () { }, function () { });
  const yesGuard = run(W, mpGet, GUARD_W.a, CELL, function () { }, function () { }, function () { });
  yes('O2 a press on a locked cell that reaches the server is refused, and the person is told why',
      no === false && told[0] === 'The cell is locked, and only a guard of this hold opens it.');
  yes('O3 a guard of the hold is let through', yesGuard === true);
}

// ------------------------------------------------------------ a restart
S = boot();
W = S.W;
yes('S1 after a restart the cell is still locked and the guards are still guards',
    W.cellLocked(CELL) === true && W.cellLocked(CELL2) === true && W.isGuard(101, 'whiterun') && W.isGuard(202, 'riften'));
const saved = JSON.parse(fs.readFileSync(path.join(dir, 'private', 'law.json'), 'utf8'));
yes('S2 the register on disk is the one cell a guard turned and who holds the offices, and the old guards and seat are gone (#2551)',
    saved.cells[CELL] === true && Object.keys(saved.cells).length === 1 && !saved.guards && !saved.jarls &&
    Object.keys(saved).join() === 'cells,held' && saved.held['guard:whiterun']['p:101'].pid === 101);
yes('S3 property.json was not touched by any of it', !JSON.parse(fs.readFileSync(path.join(dir, 'private', 'property.json'), 'utf8')).guards);

done();
