// test-3899-key-labels.js
//
// #3899. A key, a key mold and a deed are recognised by their name and
// nothing else, and the name was "Key to " plus the building's display name.
// 22 display names are carried by more than one building (six Halls of the
// Dead, two Warehouses in Windhelm, ...), so a key cut for one opened all of
// them, a deed to one presented at another's door handed that other one
// over, and a mold pressed at the second was read back as the first.
// Patrick, 27 Oct, answer A: the hold goes on the name, a short number where
// name and hold still clash, and the build fails if two buildings that can
// be held ever share a label.
//
// Part U is that build check, over the REAL door table the server carries:
// every building a door leads into, its key, mold and deed label, and no two
// alike. Part B runs the real property block over two real Halls of the Dead
// and does what the issue says broke: a key, a deed and a mold for one,
// tried at the other.
//
// Read only, apart from its own temp folder.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(process.env.GM || path.join(ROOT, 'game', 'gamemode.js'), 'utf8')).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
let dir = null;
const HOME = process.cwd();
function done() {
  process.chdir(HOME);
  if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { } }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

// ================================================ the tables the server carries
function table(name) {
  const m = new RegExp('^const ' + name + ' = (\\{.*\\});$', 'm').exec(gm);
  return m ? JSON.parse(m[1]) : null;
}
const BUILDING_BY_DOOR = table('BUILDING_BY_DOOR');
const BUILDING_NAME = table('BUILDING_NAME');
const WAY_OUT = table('WAY_OUT');
yes('U0 the door table, the names and the ways out are in the gamemode',
    !!BUILDING_BY_DOOR && !!BUILDING_NAME && !!WAY_OUT);
if (!BUILDING_BY_DOOR || !BUILDING_NAME || !WAY_OUT) { done(); }
// The town gates are added to the same tables at start (#2484), and a gate
// is held the way a house is, so they are run in too.
{
  const a = gm.indexOf('(function addTownGateProperties() {');
  const b = gm.indexOf('})();', a);
  yes('U0 and the town gates that are added to them at start', a >= 0 && b > a);
  if (a >= 0 && b > a) {
    vm.runInNewContext(gm.slice(a, b + 5), { BUILDING_BY_DOOR: BUILDING_BY_DOOR,
                                              BUILDING_NAME: BUILDING_NAME, WAY_OUT: WAY_OUT });
  }
}

// ===================================================== the property block
const propBlock = (function () {
  const a = gm.indexOf('// ==== thornswood property ====');
  const b = gm.indexOf('// ==== end thornswood property ====', a);
  return a >= 0 && b > a ? gm.slice(a, b) : null;
})();
yes('U0 the property block is in the gamemode', !!propBlock);
if (!propBlock) { done(); }

const HOUR = 3600000;
const clock = { t: Date.UTC(2026, 9, 27, 20, 0, 0) };
class FakeDate extends Date { static now() { return clock.t; } }

const ids = {};
let nextId = 0x05100000;
function idOf(desc) {
  desc = String(desc || '');
  if (!desc) { return 0; }
  if (!ids[desc]) {
    const m = /^([0-9a-f]+):Skyrim\.esm$/i.exec(desc);
    ids[desc] = m ? parseInt(m[1], 16) : (nextId++);
  }
  return ids[desc];
}
function descFromId(id) {
  for (const d in ids) { if (ids[d] === id) { return d; } }
  return '';
}

// Two of the six Halls of the Dead, and a street door into each.
const WHITERUN_HALL = '165aa:Skyrim.esm';
const MARKARTH_HALL = '23fd4:Skyrim.esm';
function streetDoor(building) {
  for (const d in BUILDING_BY_DOOR) {
    if (BUILDING_BY_DOOR[d] === building && !WAY_OUT[d] && /:Skyrim\.esm$/.test(d)) { return d; }
  }
  return null;
}
const W_DOOR = streetDoor(WHITERUN_HALL);
const M_DOOR = streetDoor(MARKARTH_HALL);
const STREET = '3c:Skyrim.esm';
const FORGE_BASE = '1a2ad:Skyrim.esm';
const FORGE_REF = 0x00a00010;
const INGOT = '5ace4:Skyrim.esm';
const MASTER_DESC = '154e0:Thornswood-Content.esp';
const DEED_DESC = '15493:Thornswood-Content.esp';
const KEY_DESC = '15494:Thornswood-Content.esp';
const MOLD_DESC = '15495:Thornswood-Content.esp';

const HULDA = { a: 0xff000101, pid: 101, name: 'Hulda' };     // holds Whiterun's
const CAROL = { a: 0xff000303, pid: 303, name: 'Carol' };     // holds Markarth's
const ADRIAN = { a: 0xff000202, pid: 202, name: 'Adrian' };   // a smith
const EVE = { a: 0xff000404, pid: 404, name: 'Eve' };         // carries Hulda's things
const PEOPLE = [HULDA, CAROL, ADRIAN, EVE];

let refs = {};
let online = [];
function world() {
  refs = {};
  [W_DOOR, M_DOOR].forEach(function (d) {
    refs[idOf(d)] = { baseDesc: 'door:Test.esp', worldOrCellDesc: STREET, pos: [0, 0, 0] };
  });
  refs[FORGE_REF] = { baseDesc: FORGE_BASE, worldOrCellDesc: STREET, pos: [100, 0, 0] };
  PEOPLE.forEach(function (p) {
    refs[p.a] = { profileId: p.pid, appearance: { name: p.name }, worldOrCellDesc: STREET,
                  pos: [50, 0, 0], inventory: { entries: [] } };
  });
  online = PEOPLE.map(function (p) { return p.a; });
}
world();

dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-3899-labels-'));
fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
fs.mkdirSync(path.join(dir, 'private'));
// Every read of a claim can lapse it and write the register, so the whole
// run stands in the temp folder (and leaves it at the end, see done).
process.chdir(dir);
const told = [];

function inv(p) { return refs[p.a].inventory.entries; }
function named(p, desc) {
  const id = idOf(desc);
  return inv(p).filter(function (e) { return e.baseId === id; }).map(function (e) { return String(e.name || ''); });
}
function give(p, desc, n, name) {
  const e = { baseId: idOf(desc), count: n };
  if (name) { e.name = name; }
  inv(p).push(e);
}
function drop(p, name) {
  refs[p.a].inventory.entries = inv(p).filter(function (e) { return String(e.name || '') !== name; });
}

function boot() {
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
    getDescFromId: function (id) { return descFromId(id) || (id.toString(16) + ':Skyrim.esm'); },
    getNeighborsByPosition: function (cell) {
      return online.filter(function (a) { return refs[a] && refs[a].worldOrCellDesc === cell; });
    },
    lookupEspmRecordById: function (id) {
      return id === idOf(MASTER_DESC) ? { record: { type: 'MISC' } } : null;
    }
  };
  function takeItem(actorId, desc, n) {
    const baseId = idOf(desc);
    const entries = refs[actorId].inventory.entries;
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].baseId !== baseId) { continue; }
      if (entries[i].count < n) { return false; }
      entries[i].count -= n;
      if (entries[i].count <= 0) { entries.splice(i, 1); }
      return true;
    }
    return false;
  }
  function addItem(actorId, desc, n) { refs[actorId].inventory.entries.push({ baseId: idOf(desc), count: n }); }
  const box = {
    console: { log: function () { } },
    require: require, mp: mp, Date: FakeDate,
    BUILDING_BY_DOOR: BUILDING_BY_DOOR, BUILDING_NAME: BUILDING_NAME, WAY_OUT: WAY_OUT,
    BENCH_BY_BASE: { [FORGE_BASE]: '88105:Skyrim.esm' },
    idOf: idOf, takeItem: takeItem, addItem: addItem,
    unfitToMake: function () { return ''; },
    // The hammer a key is cut with (#3162): the smith here holds one.
    // test-3162-bench-tools holds the refusal and the wear.
    toolGate: function () { return null; }, wearTool: function () { return null; },
    notify: function (a, line) { told.push({ a: a, line: line }); },
    say: function (a, line) { told.push({ a: a, line: line }); },
    guard: function (n, f) { return f; },
    setInterval: function () { return 0; }, clearInterval: function () { },
    log: function () { },
    __thornswoodCharacter: {
      stateOf: function (a) { return { v: 1, prof: a === ADRIAN.a ? 'smith' : 'farmer' }; },
      writeState: function () { }
    }
  };
  box.globalThis = box;
  vm.runInNewContext(propBlock, box, { filename: 'gamemode.js property' });
  return box;
}
const box = boot();
const W = box.__thornswoodProperty;
yes('U0 the property block publishes the labels', !!W && typeof W.keyLabel === 'function' &&
    typeof W.placeOf === 'function' && !!W.LABEL_NO);
if (!W || !W.keyLabel || !W.placeOf || !W.LABEL_NO) { done(); }

// ========================================================= U. the build check
{
  const holdable = {};
  for (const d in BUILDING_BY_DOOR) { holdable[BUILDING_BY_DOOR[d]] = true; }
  const buildings = Object.keys(holdable).sort();
  yes('U1 every building a door leads into has a name (' + buildings.length + ' of them)',
      buildings.length > 800 && buildings.every(function (b) { return !!BUILDING_NAME[b]; }));
  [['key', W.keyLabel], ['key mold', W.moldLabel], ['deed', W.deedLabel]].forEach(function (k) {
    const by = {};
    buildings.forEach(function (b) {
      const l = k[1](b);
      (by[l] = by[l] || []).push(b);
    });
    const shared = Object.keys(by).filter(function (l) { return by[l].length > 1; });
    shared.forEach(function (l) { console.log('      "' + l + '" is ' + by[l].join(', ')); });
    yes('U2 no two buildings that can be held share a ' + k[0] + '\'s name' +
        (shared.length ? ': give each of the ones above the next number of its group in LABEL_NO' : ''),
        shared.length === 0);
  });
  const stale = Object.keys(W.LABEL_NO).filter(function (b) { return !holdable[b]; });
  stale.forEach(function (b) { console.log('      ' + b + ' is not a building any door leads into'); });
  yes('U3 every number in LABEL_NO is on a building the door table has', stale.length === 0);
  const groups = {};
  Object.keys(W.LABEL_NO).forEach(function (b) {
    const g = W.placeOf(b).replace(/, no\. \d+$/, '');
    (groups[g] = groups[g] || []).push(W.LABEL_NO[b]);
  });
  const lone = Object.keys(groups).filter(function (g) { return groups[g].length < 2; });
  yes('U4 a number is only on a name and hold that more than one building shares' +
      (lone.length ? ': ' + lone.join('; ') : ''), lone.length === 0);
  yes('U5 the hold is on the name: "' + W.keyLabel(WHITERUN_HALL) + '"',
      W.keyLabel(WHITERUN_HALL) === 'Key to Hall of the Dead, Whiterun' &&
      W.moldLabel(MARKARTH_HALL) === 'Key mold for Hall of the Dead, Markarth' &&
      W.deedLabel(MARKARTH_HALL) === 'Deed to Hall of the Dead, Markarth');
  yes('U5 and a number where name and hold still clash: "' + W.keyLabel('965b3:Skyrim.esm') + '"',
      W.keyLabel('90232:WindhelmSSE.esp') === 'Key to Warehouse, Windhelm, no. 1' &&
      W.keyLabel('965b3:Skyrim.esm') === 'Key to Warehouse, Windhelm, no. 2');
  yes('U5 a building whose name is its own still says its hold: "' + W.deedLabel('165a8:Skyrim.esm') + '"',
      W.deedLabel('165a8:Skyrim.esm') === 'Deed to Breezehome, Whiterun');
}

// ============================================= B. two Halls of the Dead
function linesTo(p, since) {
  return told.slice(since || 0).filter(function (t) { return t.a === p.pid || t.a === p.a; }).map(function (t) { return t.line; });
}
function to(pid, line) { told.push({ a: pid, line: line }); }
function at(p, door) { W.touched(p.a, door); }
function claim(p, door) { at(p, door); return W.claim(p.a, p.pid, to); }
function lock(p, door) { at(p, door); W.setLock(p.a, p.pid, to, true); }
function holder(b) { const c = W.claims()[b]; return c ? c.by : 0; }
function shutTo(p, door) { return W.shutFor(p.a, p.pid).shut.indexOf(idOf(door)) !== -1; }

yes('B0 a street door into each of two Halls of the Dead: ' + W_DOOR + ', ' + M_DOOR, !!W_DOOR && !!M_DOOR);
if (!W_DOOR || !M_DOOR) { done(); }
{
  claim(HULDA, W_DOOR);
  claim(CAROL, M_DOOR);
  yes('B1 Hulda holds Whiterun\'s and Carol Markarth\'s', holder(WHITERUN_HALL) === HULDA.pid &&
      holder(MARKARTH_HALL) === CAROL.pid);
  yes('B1 and each deed names its own hall', named(HULDA, DEED_DESC)[0] === 'Deed to Hall of the Dead, Whiterun' &&
      named(CAROL, DEED_DESC)[0] === 'Deed to Hall of the Dead, Markarth');
  lock(HULDA, W_DOOR);
  lock(CAROL, M_DOOR);
  give(EVE, KEY_DESC, 1, W.keyLabel(WHITERUN_HALL));
  yes('B2 a key to Whiterun\'s opens Whiterun\'s', shutTo(EVE, W_DOOR) === false &&
      W.mayPass(EVE.a, EVE.pid, WHITERUN_HALL) === true);
  yes('B3 and not Markarth\'s', shutTo(EVE, M_DOOR) === true &&
      W.mayPass(EVE.a, EVE.pid, MARKARTH_HALL) === false);
  drop(EVE, W.keyLabel(WHITERUN_HALL));
  yes('B4 an old key with only the name on it opens neither', (function () {
    give(EVE, KEY_DESC, 1, 'Key to Hall of the Dead');
    const r = shutTo(EVE, W_DOOR) && shutTo(EVE, M_DOOR);
    drop(EVE, 'Key to Hall of the Dead');
    return r;
  })());
}
{
  // Hulda's deed, carried through Markarth's door (unlocked, so it opens).
  at(CAROL, M_DOOR);
  W.setLock(CAROL.a, CAROL.pid, to, false);
  const deed = named(HULDA, DEED_DESC)[0];
  drop(HULDA, deed);
  give(EVE, DEED_DESC, 1, deed);
  at(EVE, M_DOOR);
  yes('B5 a deed to Whiterun\'s presented at Markarth\'s door hands nothing over',
      holder(MARKARTH_HALL) === CAROL.pid && holder(WHITERUN_HALL) === HULDA.pid);
  at(EVE, W_DOOR);
  yes('B6 at Whiterun\'s own door it does', holder(WHITERUN_HALL) === EVE.pid);
}
{
  // A mold pressed at Markarth's hall, in a smith's pack: it is Markarth's.
  give(ADRIAN, MOLD_DESC, 1, W.moldLabel(MARKARTH_HALL));
  yes('B7 a mold for Markarth\'s is read back as Markarth\'s, not the first hall in the table',
      W.moldInHand(ADRIAN.a) === MARKARTH_HALL);
  yes('B8 and a mold for Markarth\'s is not one for Whiterun\'s', W.holdsMold(ADRIAN.a, WHITERUN_HALL) === false &&
      W.holdsMold(ADRIAN.a, MARKARTH_HALL) === true);
  give(ADRIAN, INGOT, 2);
  const was = W.claims()[MARKARTH_HALL].master.no;
  const since = told.length;
  W.cutKey(ADRIAN.a, ADRIAN.pid, to, ['/key', FORGE_REF.toString(16), 'master']);
  const s = linesTo(ADRIAN, since).join(' ');
  const m = W.claims()[MARKARTH_HALL].master;
  yes('B9 a master key cut from it is cut for Markarth\'s holder: "' + s + '"',
      m.no > was && m.for === CAROL.pid &&
      named(CAROL, MASTER_DESC).indexOf(W.masterLabel(MARKARTH_HALL, m.no)) !== -1);
}

done();
