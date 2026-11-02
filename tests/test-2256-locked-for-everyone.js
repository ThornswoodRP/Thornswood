'use strict';
/*
  test-2256-locked-for-everyone.js

  #2256: when a door is locked, the message should make clear it is locked for
  everyone. The locker was told "You lock X. Anybody without a key will have
  to pick it.", and #615's line to others went to every player online on the
  whole server. Now the locker and the people near the door (LOCK_HEARD) are
  told "X is locked for everyone now", with who can still open it, and nobody
  across Skyrim hears about it.

  The real property block runs over the pretend engine test-1637-door-gui.js
  uses (copied, so the two can change apart), with Dave added far away.
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
/* One function by its whole first line, only if that line is there once. */
function liftFrom(src, first, indent) {
  const from = '\n' + indent + first;
  const a = src.indexOf(from);
  if (a < 0 || src.indexOf(from, a + 1) >= 0) { return null; }
  const end = '\n' + indent + '}\n';
  const b = src.indexOf(end, a + 1);
  return b < 0 ? null : src.slice(a + 1, b + end.length);
}
/* From one line to the end of the handler that starts at another. */
function liftSpan(src, first, lastOpen) {
  const a = src.indexOf(first);
  if (a < 0) { return null; }
  const c = src.indexOf(lastOpen, a);
  if (c < 0) { return null; }
  const SHUT = '\n  }));\n';
  const b = src.indexOf(SHUT, c);
  return b < 0 ? null : src.slice(a, b + SHUT.length);
}

const propBlock = slice(gm, '// ==== thornswood property ====', '// ==== end thornswood property ====');
const charBlock = slice(gm, '// ==== thornswood character ====', '// ==== end thornswood character ====');
const farmBlock = slice(gm, '// ==== thornswood farming ====', '// ==== end thornswood farming ====');
const addItemSrc = liftFrom(gm, 'function addItem(actorId, itemDesc, count) {', '');
const takeItemSrc = liftFrom(gm, 'function takeItem(actorId, itemDesc, count) {', '');
// The craft gate a key cut at a forge asks (#1733); nobody here is hurt or tired.
const unfitSrc = liftFrom(gm, 'function unfitToMake(actorId, workbenchId) {', '');
yes('the property, character and farming blocks and the pack helpers are in the gamemode',
    !!propBlock && !!charBlock && !!farmBlock && !!addItemSrc && !!takeItemSrc && !!unfitSrc);
if (!propBlock || !charBlock || !farmBlock || !addItemSrc || !takeItemSrc || !unfitSrc) { done(); }

// ================================================================ the server
const clock = { t: Date.UTC(2026, 9, 4, 20, 0, 0) };
class FakeDate extends Date { static now() { return clock.t; } }
const DAY = 86400000;

const TUNDRA = '3c:Skyrim.esm';
const HOME = '16778:Skyrim.esm';   // Honeyside, nobody's to start with
const SHOP = '1a2b3:Skyrim.esm';   // Bob's shop
const DOOR_OUT = '1002:Skyrim.esm';
const DOOR_IN = '1004:Skyrim.esm';
const SHOP_DOOR = '1001:Skyrim.esm';
const SHED = '1009:Skyrim.esm';    // a door the table does not know
const BUILDING_NAME = {};
BUILDING_NAME[HOME] = 'Honeyside';
BUILDING_NAME[SHOP] = 'The Shop';
const BUILDING_BY_DOOR = {};
BUILDING_BY_DOOR[DOOR_OUT] = HOME;
BUILDING_BY_DOOR[DOOR_IN] = HOME;
BUILDING_BY_DOOR[SHOP_DOOR] = SHOP;
const WAY_OUT = {};
WAY_OUT[DOOR_IN] = true;
const FORGE_BASE = '1a2ad:Skyrim.esm';
const BLOCK_BASE = 'b009:Skyrim.esm';
const BENCH_BY_BASE = {};
BENCH_BY_BASE[FORGE_BASE] = '88105:Skyrim.esm';
BENCH_BY_BASE[BLOCK_BASE] = 'a5cb3:Skyrim.esm';
const FORGE_REF = 0x00a00010, BLOCK_REF = 0x00a00011;
const INGOT = '5ace4:Skyrim.esm';

const ids = {};
let nextId = 0x05000000;
function idOf(desc) {
  desc = String(desc || '');
  if (!desc) { return 0; }
  if (!ids[desc]) {
    const m = /^([0-9a-f]+):Skyrim\.esm$/i.exec(desc);
    ids[desc] = m ? parseInt(m[1], 16) : (nextId++);
  }
  return ids[desc];
}
function hex(desc) { return (idOf(desc) >>> 0).toString(16); }

const KEY_DESC = (/var KEY = '([^']+:Thornswood-Content\.esp)';/.exec(propBlock) || [])[1];
const MOLD_DESC = (/var MOLD = '([^']+:Thornswood-Content\.esp)';/.exec(propBlock) || [])[1];
const DEED_DESC = (/var DEED = '([^']+:Thornswood-Content\.esp)';/.exec(propBlock) || [])[1];
yes('the key, mold and deed records are read out of the property block', !!KEY_DESC && !!MOLD_DESC && !!DEED_DESC);

const ALICE = { a: 0xff000202, pid: 202, name: 'Alice' };   // a smith
const BOB = { a: 0xff000303, pid: 303, name: 'Bob' };       // holds the shop
const CAROL = { a: 0xff000404, pid: 404, name: 'Carol' };   // a cook
const PEOPLE = [ALICE, BOB, CAROL];

const refs = {};
refs[FORGE_REF] = { baseDesc: FORGE_BASE, worldOrCellDesc: TUNDRA, pos: [1000, 1000, 0] };
refs[BLOCK_REF] = { baseDesc: BLOCK_BASE, worldOrCellDesc: TUNDRA, pos: [1100, 1000, 0] };
PEOPLE.forEach(function (p) {
  refs[p.a] = { profileId: p.pid, appearance: { name: p.name }, worldOrCellDesc: TUNDRA,
                pos: [1000, 1100, 0], inventory: { entries: [] } };
});
const online = PEOPLE.map(function (p) { return p.a; });
const made = {};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-1637-door-'));
fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
fs.mkdirSync(path.join(dir, 'private'));
fs.writeFileSync(path.join(dir, 'private', 'property.json'), JSON.stringify({ claims: {
  [SHOP]: { by: BOB.pid, name: 'Bob', at: clock.t, touched: clock.t }
} }));
function inDir(f) {
  const was = process.cwd();
  process.chdir(dir);
  try { return f(); } finally { process.chdir(was); }
}

const mp = {
  makeProperty: function (name, opts) { made[name] = opts; },
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
  getDescFromId: function (id) { return id.toString(16) + ':Skyrim.esm'; },
  lookupEspmRecordById: function () { return null; },
  getNeighborsByPosition: function () { return []; }
};
const box = {
  console: { log: function () { } }, require: require, mp: mp, Date: FakeDate,
  BUILDING_BY_DOOR: BUILDING_BY_DOOR, BUILDING_NAME: BUILDING_NAME, WAY_OUT: WAY_OUT,
  BENCH_BY_BASE: BENCH_BY_BASE, idOf: idOf,
  notify: function () { }, say: function () { },
  guard: function (n, f) { return f; },
  setInterval: function () { return 1; }, clearInterval: function () { },
  log: function () { },
  __thornswoodCharacter: {
    stateOf: function (actorId) { return { prof: actorId === ALICE.a ? 'smith' : 'cook' }; },
    writeState: function () { }
  }
};
box.globalThis = box;
inDir(function () {
  vm.runInNewContext(addItemSrc + '\n' + takeItemSrc + '\n' + unfitSrc + '\n' + propBlock, box,
                     { filename: 'gamemode.js property' });
});
const W = box.__thornswoodProperty;
yes('the property block runs and publishes itself', !!W && typeof W.command === 'function');
if (!W) { done(); }

const every = [];
function word(p, w, args) {
  const out = [];
  let handled = null;
  inDir(function () {
    handled = W.command(w, [w].concat(args || []), p.a, p.pid, function (pid, m) { out.push(m); });
  });
  out.forEach(function (m) { every.push(m); });
  return { handled: handled, told: out.join('\n') };
}
function open(p, door) { inDir(function () { W.touched(p.a, door); }); }
function lineOf(p) { return refs[p.a].thornswoodDoorLine || null; }
function pack(p) { return refs[p.a].inventory.entries; }
function holds(p, baseDesc, name) {
  return pack(p).some(function (e) { return e.baseId === idOf(baseDesc) && e.count > 0 && (name === undefined || e.name === name); });
}
function count(p, baseDesc) {
  let n = 0;
  pack(p).forEach(function (e) { if (e.baseId === idOf(baseDesc) && !e.name) { n += e.count; } });
  return n;
}


// Dave is online in another cell; Erin is in the same cell but across town.
const DAVE = { a: 0xff000505, pid: 505, name: 'Dave' };
const ERIN = { a: 0xff000606, pid: 606, name: 'Erin' };
refs[DAVE.a] = { profileId: DAVE.pid, appearance: { name: 'Dave' }, worldOrCellDesc: 'ff:Skyrim.esm', pos: [1000, 1100, 0], inventory: { entries: [] } };
refs[ERIN.a] = { profileId: ERIN.pid, appearance: { name: 'Erin' }, worldOrCellDesc: TUNDRA, pos: [90000, 1100, 0], inventory: { entries: [] } };
online.push(DAVE.a, ERIN.a);

function heard(fn) {
  const by = {};
  inDir(function () { fn(function (pid, m) { (by[pid] = by[pid] || []).push(m); }); });
  return by;
}
open(ALICE, DOOR_OUT);
word(ALICE, '/claim', [hex(DOOR_OUT)]);
let by = heard(function (tp) { W.command('/lock', ['/lock', hex(DOOR_OUT)], ALICE.a, ALICE.pid, tp); });
const mine = (by[ALICE.pid] || []).join(' ');
yes('L1 the locker is told it is locked for everyone: "' + mine + '"', /You lock Honeyside\. Honeyside is locked for everyone now\./.test(mine));
yes('L2 and who can still open it', /Only a key to it, its master key or its deed opens it/.test(mine) && /pick the lock/.test(mine));
yes('L3 and the lock took', W.holderOf(HOME).locked === true);
yes('L4 Bob and Carol, standing at the door, hear it is locked for everyone',
    (by[BOB.pid] || []).join(' ') === 'Honeyside is locked for everyone now. Only a key to it, its master key or its deed opens it; anybody else has to pick the lock.' &&
    /locked for everyone/.test((by[CAROL.pid] || []).join(' ')));
yes('L5 nobody hears it twice, the locker included', (by[ALICE.pid] || []).length === 1 && (by[BOB.pid] || []).length === 1);
yes('L6 Dave, in another cell, hears nothing (it went to the whole server before #2256)', !by[DAVE.pid]);
yes('L7 Erin, in the same cell but across town, hears nothing', !by[ERIN.pid]);
by = heard(function (tp) { W.command('/unlock', ['/unlock', hex(DOOR_OUT)], ALICE.a, ALICE.pid, tp); });
yes('U1 unlocking says it is open to everyone: "' + (by[ALICE.pid] || []).join(' ') + '"',
    (by[ALICE.pid] || []).join(' ') === 'You unlock Honeyside. Honeyside is open to everyone now.' && W.holderOf(HOME).locked === false);
yes('U2 and the people at the door hear the same, and Dave and Erin do not',
    (by[BOB.pid] || []).join(' ') === 'Honeyside is open to everyone now.' && !by[DAVE.pid] && !by[ERIN.pid]);
by = heard(function (tp) { W.command('/unlock', ['/unlock', hex(DOOR_OUT)], ALICE.a, ALICE.pid, tp); });
yes('U3 a word that changes nothing is said to nobody else', Object.keys(by).length === 1 && /already unlocked/.test(by[ALICE.pid][0]));
done();
