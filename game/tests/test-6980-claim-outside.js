'use strict';
/*
  test-6980-claim-outside.js

      node game/tests/test-6980-claim-outside.js

  #6980: a building could not be claimed from outside its front door. The
  lock key's line comes from the door the server last saw opened, and a
  front door opened from the street is a load door that takes the person
  inside first. Now the front plugin asks about the door under the
  crosshair (/doorlook and its id) and the property block writes the line
  for it when it is a building's door and the person stands at it.

  The real property block runs over the pretend engine test-2250-claim-door.js
  uses (copied, so the two can change apart). The front plugin's ask is
  lifted out of game/plugins/thornswood-front.js and run over a pretend
  crosshair.

  What it checks:
    S1 looking at a door of a building nobody holds, standing at it, writes
       the line Claim with that building's doors, and /claim then claims it;
    S2 too far from the door, or in another cell, writes nothing;
    S3 a door no building owns, or junk, writes nothing;
    S4 at a building somebody else holds the line offers nothing;
    S5 the holder looking at their own door gets Lock;
    S6 a look keeps no claim alive (touched is not moved) and presents no deed;
    S7 /doorlook is a word the chat block hands to the property block;
    P1 the front asks only on the second look at the same door;
    P2 and not again within DOOR_ASK_MS, and again after it;
    P3 nothing is asked for no door, or with a menu up.
*/
const REPO_DIR = require('path').join(__dirname, '..', '..');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const read = function (p) { return fs.readFileSync(p, 'utf8').split(CR).join(''); };
const gm = require('../../tests/gamemode-tables.js').joined(read(process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js')));
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
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
if (!propBlock || !charBlock || !farmBlock || !addItemSrc || !takeItemSrc || !unfitSrc) { done(); } else {

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
refs[idOf(DOOR_OUT)] = { worldOrCellDesc: TUNDRA, pos: [1000, 1300, 0] };
refs[idOf(SHOP_DOOR)] = { worldOrCellDesc: TUNDRA, pos: [1000, 1200, 0] };
refs[idOf(DOOR_IN)] = { worldOrCellDesc: '16779:Skyrim.esm', pos: [0, 0, 0] };
refs[FORGE_REF] = { baseDesc: FORGE_BASE, worldOrCellDesc: TUNDRA, pos: [1000, 1000, 0] };
refs[BLOCK_REF] = { baseDesc: BLOCK_BASE, worldOrCellDesc: TUNDRA, pos: [1100, 1000, 0] };
PEOPLE.forEach(function (p) {
  refs[p.a] = { profileId: p.pid, appearance: { name: p.name }, worldOrCellDesc: TUNDRA,
                pos: [1000, 1100, 0], inventory: { entries: [] } };
});
const online = PEOPLE.map(function (p) { return p.a; });
const made = {};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-6980-door-'));
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
if (!W) { done(); } else {

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



function look(p, door) { return word(p, '/doorlook', [door === null ? 'zz' : hex(door)]); }
function clearLine(p) { delete refs[p.a].thornswoodDoorLine; delete refs[p.a].thornswoodDoor; }

// S1
{
  clearLine(CAROL);
  const r = look(CAROL, DOOR_OUT);
  const line = lineOf(CAROL);
  yes('S1 /doorlook is answered by the property block', r.handled === true && r.told === '');
  yes('S1 standing at Honeyside\'s front door the line says Claim', !!line && line.x === 'claim' && line.n === 'Honeyside');
  yes('S1 and carries both halves of the front door', !!line && line.d.indexOf(hex(DOOR_OUT)) >= 0 && line.d.indexOf(hex(DOOR_IN)) >= 0);
  const c = word(CAROL, '/claim', [hex(DOOR_OUT)]);
  yes('S1 the lock key then claims it from outside: "' + c.told.split('\n')[0] + '"', !!W.holderOf(HOME) && W.holderOf(HOME).by === CAROL.pid);
}
// S2
{
  clearLine(ALICE);
  refs[ALICE.a].pos = [1000, 1800, 0];   // 500 from the door
  look(ALICE, DOOR_OUT);
  yes('S2 500 units from the door writes no line', !lineOf(ALICE) && !refs[ALICE.a].thornswoodDoor);
  refs[ALICE.a].pos = [1000, 1300, 0];
  refs[ALICE.a].worldOrCellDesc = '16779:Skyrim.esm';
  look(ALICE, DOOR_OUT);
  yes('S2 the right spot in another cell writes no line', !lineOf(ALICE));
  refs[ALICE.a].worldOrCellDesc = TUNDRA;
  refs[ALICE.a].pos = [1000, 1100, 0];
}
// S3
{
  clearLine(ALICE);
  look(ALICE, SHED);
  look(ALICE, null);
  yes('S3 a door no building owns, or junk, writes nothing', !lineOf(ALICE) && !refs[ALICE.a].thornswoodDoor);
}
// S4
{
  clearLine(ALICE);
  look(ALICE, DOOR_OUT);   // Carol holds it now
  const line = lineOf(ALICE);
  yes('S4 at a building somebody else holds the line offers nothing', !!line && line.x === '');
}
// S5
{
  clearLine(BOB);
  refs[BOB.a].pos = [1000, 1150, 0];
  look(BOB, SHOP_DOOR);
  const line = lineOf(BOB);
  yes('S5 the holder looking at their own door gets Lock', !!line && line.x === 'lock' && line.n === 'The Shop');
}
// S6
{
  const before = JSON.stringify(W.holderOf(SHOP));
  clock.t += 3 * DAY;
  look(BOB, SHOP_DOOR);
  yes('S6 a look keeps no claim alive: the claim is as it was', JSON.stringify(W.holderOf(SHOP)) === before);
  clock.t -= 3 * DAY;
}
// S7
{
  const cb = charBlock || '';
  yes('S7 the character block hands /doorlook to the property block', /word === '\/doorlook'/.test(cb));
  const chat = slice(gm, '// ==== thornswood chat ====', '// ==== end thornswood chat ====') || gm;
  yes('S7 the chat block lists /doorlook among the words the server answers', /'\/doorlook'/.test(chat));
}

// P: the front plugin's ask.
{
  const front = read(path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js'));
  const a = front.indexOf('  const DOOR_ASK_MS = ');
  const b = front.indexOf('\n  }\n', front.indexOf('  function askDoor(hex) {'));
  yes('P0 the front plugin has DOOR_ASK_MS, doorLookedAt and askDoor', a >= 0 && b > a);
  if (a >= 0 && b > a) {
    const sent = [];
    const fake = { t: 1000, ref: null, menu: false, claim: false };
    const fx = new Function('sp', 'tellServer', 'busyMenuOpenNow', 'anyClaim', 'DOOR_TYPE', 'Date',
      front.slice(a, b + 4) + '\nreturn { ask: askDoor, at: doorLookedAt, every: DOOR_ASK_MS };')(
      { Game: { getCurrentCrosshairRef: function () { return fake.ref; } } },
      function (line) { sent.push(line); }, function () { return fake.menu; }, function () { return fake.claim; }, 29,
      { now: function () { return fake.t; } });
    const door = { getFormID: function () { return 0x1002; }, getBaseObject: function () { return { getType: function () { return 29; } }; } };
    const chest = { getFormID: function () { return 0x2000; }, getBaseObject: function () { return { getType: function () { return 28; } }; } };
    fake.ref = door;
    yes('P0 doorLookedAt names the door under the crosshair', fx.at() === '1002');
    fake.ref = chest;
    yes('P0 and nothing for a container', fx.at() === '');
    fake.ref = door;
    fx.ask(fx.at());
    yes('P1 the first look asks nothing', sent.length === 0);
    fake.t += 320; fx.ask(fx.at());
    yes('P1 the second look asks /doorlook 1002', sent.length === 1 && sent[0] === '/doorlook 1002');
    fake.t += 320; fx.ask(fx.at());
    yes('P2 not again within DOOR_ASK_MS', sent.length === 1);
    fake.t += fx.every; fx.ask(fx.at());
    yes('P2 and again after it', sent.length === 2);
    sent.length = 0;
    fx.ask(''); fx.ask('');
    fake.menu = true; fx.ask('1004'); fx.ask('1004');
    fake.menu = false; fake.claim = true; fx.ask('1004'); fx.ask('1004');
    yes('P3 nothing is asked for no door, with a menu up, or while something holds the keys', sent.length === 0);
  }
}
done();
}}
