'use strict';
/*
  test-2250-claim-door.js

  #2250: /claim at some doors answered "Only a farmer can bring a crop in".
  The property block only took /claim within a minute of the person opening a
  door the table knows; everything else went to farming, whose first question
  is the farmer gate. Now farming keeps the /claim words that are about a
  field (one naming a crop plot, or a bare one with a plot in reach), and the
  property block answers the rest about doors and claims nothing.

  The real property block runs over the pretend engine test-1637-door-gui.js
  uses (copied, so the two can change apart), with a farming stand-in that
  says which ids are plots and whether one is in reach. The farming block's
  own two answers are lifted and run against a pretend pack of neighbours.
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


// The farming stand-in. PLOT is a crop plot's id; near is whether one is in reach.
const PLOT = 0x00b00001;
const farmCalls = [];
const farm = { near: false,
  isPlotId: function (raw) { farmCalls.push('id ' + raw); return parseInt(raw, 16) === PLOT; },
  plotNear: function () { farmCalls.push('near'); return farm.near; } };
box.__thornswoodFarming = farm;

// C1: the done-when. A door the table does not know, sent by id: the property
// block answers it, about the door, and nobody is told about crops.
{
  const r = word(CAROL, '/claim', [hex(SHED)]);
  yes('C1 /claim at a door no building owns is answered by the property block', r.handled === true);
  yes('C1 and says the door cannot be held: "' + r.told + '"', /does not belong to a building anybody can hold/.test(r.told));
  yes('C1 and says nothing about farmers or crops', !/farmer|crop/i.test(r.told));
}
// C2: a known door, more than a minute after it was opened.
{
  open(CAROL, DOOR_OUT);
  clock.t += 61000;
  const r = word(CAROL, '/claim', [hex(DOOR_OUT)]);
  yes('C2 /claim at a known door after the minute is answered by the property block', r.handled === true);
  yes('C2 and names the building and says to open it again: "' + r.told + '"', /Open the door of Honeyside again/.test(r.told));
  yes('C2 and claims nothing', !W.holderOf(HOME));
}
// C3: still a claim within the minute, as before.
{
  open(CAROL, DOOR_OUT);
  const r = word(CAROL, '/claim', [hex(DOOR_OUT)]);
  yes('C3 within the minute the claim goes through as it always did', r.handled === true && !!W.holderOf(HOME) && W.holderOf(HOME).by === CAROL.pid);
}
// C4: the field words stay farming's.
{
  const r = word(ALICE, '/claim', [PLOT.toString(16)]);
  yes('C4 /claim naming a crop plot is left to farming', r.handled === false && r.told === '');
  open(ALICE, SHOP_DOOR);
  const r2 = word(ALICE, '/claim', [PLOT.toString(16)]);
  yes('C4 even straight after opening a door (#1636)', r2.handled === false);
  clock.t += 61000;
  farm.near = true;
  const r3 = word(ALICE, '/claim', []);
  yes('C4 a bare /claim with a plot in reach is left to farming', r3.handled === false);
  farm.near = false;
  const r4 = word(ALICE, '/claim', []);
  yes('C4 a bare /claim with no plot and no door says to open the door first: "' + r4.told + '"',
      r4.handled === true && /Open the door of the building you mean first/.test(r4.told));
}
// C5: with no farming loaded, nothing changes: farming's own "not running" answer stands.
{
  delete box.__thornswoodFarming;
  const r = word(CAROL, '/claim', [hex(SHED)]);
  yes('C5 without the farming block the word falls through as before', r.handled === false);
  box.__thornswoodFarming = farm;
}
// F: the farming block's two answers, lifted and run.
{
  const fb = slice(gm, '// ==== thornswood farming ====', '// ==== end thornswood farming ====');
  const m = /isPlotId: (function \(raw\) \{[\s\S]*?\n    \}),\n    plotNear: (function \(actorId\) \{[^\n]*\})/.exec(fb || '');
  yes('F0 farming publishes isPlotId and plotNear', !!m);
  if (m) {
    const CROP = 'abc:Skyrim.esm';
    const fx = new Function('mp', 'P', 'CROPS', 'nearestPlot', 'return [' + m[1] + ',' + m[2] + '];')(
      { get: function (id, k) { if (k !== 'baseDesc') { throw new Error(k); } return id === 0x10 ? CROP : (id === 0x11 ? 'door:Skyrim.esm' : (function () { throw new Error('gone'); })()); } },
      { has: function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); } },
      { [CROP]: {} }, function (a) { return a === 1 ? { refrId: 0x10 } : null; });
    yes('F1 a crop plot id is a plot', fx[0]('10') === true);
    yes('F2 a door id is not', fx[0]('11') === false);
    yes('F3 an id the engine does not know, or junk, is not', fx[0]('12') === false && fx[0]('zz') === false && fx[0]('') === false);
    yes('F4 plotNear is whether nearestPlot found one', fx[1](1) === true && fx[1](2) === false);
  }
}
done();
