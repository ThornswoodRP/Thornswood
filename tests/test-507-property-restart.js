'use strict';
/*
  test-507-property-restart.js

  #507, the card's own Done when: "set an owner on a plot reference through
  the gamemode path, restart the server, read it back, and confirm the
  ownership and the lock state survived."

  Nothing committed proved that before this. test-2254-master-key.js boots
  the block twice but reads back only the master key's number, and every
  other property harness builds its claims in memory or writes the register
  by hand and never boots again. The comment in load() records that this very
  failure shipped once: "every deploy and every restart silently unlocked
  every locked house".

  So the REAL property block is booted over a stand-in server (the shape
  test-2254 uses), in a temp folder with its own server-settings.json:

    1. Hulda opens Honeyside's door and the lock key claims it (/claim with
       the door's id, what the key sends), then locks it (/lock). Bob claims
       his shop and leaves it unlocked. A steward of the hold, by the role
       and the law register, sets 50 rent at the door, a week passes and
       the debt is counted, and Hulda opens her door again a day later.
    2. The register is read off disk as the next boot will see it, and three
       rows that are not claims are put in it: one that is not an object,
       one with no holder, and one keyed __proto__.
    3. A second boot of the block, from private\property.json alone.
       Every field of both claims is what it was: holder, name, when it was
       claimed and last touched, the lock (on for one, off for the other),
       the ground under the house, the rent with what is owed and when it
       was last counted, and the master key's number and who it was cut for.
       The rows that are not claims are dropped and the __proto__ one does
       not become the register's prototype.
    4. And the world behaves as the register says after the restart: the
       door is shut to a stranger, pushed to her game when she opens a door,
       while the way out stays open; a key, the master key and the deed
       still open it; the holder's line at the door says Unlock; the rent
       keeps counting from when it was last counted, not from the boot;
       and the claim lapses 14 days after the touch read back, not after
       the boot. A lapse is written, so a third boot finds the house free.

  Read only, apart from its own temp folder, which it removes.

      node tests\test-507-property-restart.js
*/
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8')).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const START = process.cwd();
let dir = null;
function done() {
  process.chdir(START);
  if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { } }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

function slice(start, end) {
  const a = gm.indexOf(start);
  if (a < 0) { return null; }
  const b = gm.indexOf(end, a + start.length);
  return b < 0 ? null : gm.slice(a, b + end.length);
}
const propBlock = slice('// ==== thornswood property ====', '// ==== end thornswood property ====');
yes('P0 the property block is in the gamemode', !!propBlock);
if (!propBlock) { done(); }

// The records the block names, read out of it rather than copied.
function recordOf(name) {
  const m = new RegExp("var " + name + " = '([0-9a-f]+:Thornswood-Content\\.esp)';").exec(propBlock);
  return m ? m[1] : null;
}
const DEED_DESC = recordOf('DEED');
const KEY_DESC = recordOf('KEY');
const MASTER_DESC = recordOf('MASTER_KEY');
yes('P0 the deed, key and master key records are read out of the block', !!DEED_DESC && !!KEY_DESC && !!MASTER_DESC);

// Honeyside's form id here is one BUILDING_HOLD files under a hold, so a
// steward of that hold settles it; the hold is read out of the table.
const HOUSE = '16778:Skyrim.esm';
const holdM = /"16778:Skyrim\.esm":"([a-z]+)"/.exec(propBlock);
const HOLD = holdM ? holdM[1] : null;
yes('P0 the building table files the test house under a hold (' + HOLD + ')', !!HOLD);
if (!DEED_DESC || !KEY_DESC || !MASTER_DESC || !HOLD) { done(); }

// ================================================================ the server
const HOUR = 3600000, DAY = 24 * HOUR;
const clock = { t: Date.UTC(2026, 9, 17, 18, 0, 0) };
class FakeDate extends Date { static now() { return clock.t; } }

const ids = {};
let nextId = 0x05200000;
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
function hex(desc) { return (idOf(desc) >>> 0).toString(16); }

const SHOP = 'shop:Test.esp';
const DOOR = '1001:Skyrim.esm';        // Honeyside's front door, from the street
const DOOR_IN = '1004:Skyrim.esm';     // its inside door, a way out
const SHOP_DOOR = '1002:Skyrim.esm';
const STREET = '3c:Skyrim.esm';
const BUILDING_BY_DOOR = { [DOOR]: HOUSE, [DOOR_IN]: HOUSE, [SHOP_DOOR]: SHOP };
const BUILDING_NAME = { [HOUSE]: 'Honeyside', [SHOP]: 'The Shop' };
const WAY_OUT = { [DOOR_IN]: true };
const GROUND = { cell: STREET, pos: [120, -40, 8] };

const HULDA = { a: 0xff000101, pid: 101, name: 'Hulda' };   // claims Honeyside
const BOB = { a: 0xff000202, pid: 202, name: 'Bob' };       // claims the shop
const CAROL = { a: 0xff000303, pid: 303, name: 'Carol' };   // carries a key
const EVE = { a: 0xff000404, pid: 404, name: 'Eve' };       // a stranger
const STEN = { a: 0xff000909, pid: 909, name: 'Sten' };     // steward of the hold
const PEOPLE = [HULDA, BOB, CAROL, EVE, STEN];

const refs = {};
refs[idOf(DOOR)] = { baseDesc: 'door:Test.esp', worldOrCellDesc: STREET, pos: [0, 0, 0] };
refs[idOf(DOOR_IN)] = { baseDesc: 'door:Test.esp', worldOrCellDesc: HOUSE, pos: [0, 0, 0] };
refs[idOf(SHOP_DOOR)] = { baseDesc: 'door:Test.esp', worldOrCellDesc: STREET, pos: [300, 0, 0] };
PEOPLE.forEach(function (p) {
  refs[p.a] = { profileId: p.pid, appearance: { name: p.name }, worldOrCellDesc: STREET,
                pos: [50, 0, 0], inventory: { entries: [] } };
});
const online = PEOPLE.map(function (p) { return p.a; });

dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-507-restart-'));
fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
fs.mkdirSync(path.join(dir, 'private'));
// Sten holds the hold's Steward office: the role (__thornswoodOffices below)
// says his account may, and the law register says this character does.
fs.writeFileSync(path.join(dir, 'private', 'law.json'), JSON.stringify({ cells: {}, held: {
  ['steward:' + HOLD]: { ['p:' + STEN.pid]: { pid: STEN.pid, name: STEN.name, at: clock.t } }
} }));
const REGISTER = path.join(dir, 'private', 'property.json');
function inDir(f) {
  const was = process.cwd();
  process.chdir(dir);
  try { return f(); } finally { process.chdir(was); }
}

let logged = [];
const told = [];
function boot() {
  logged = [];
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
    // The master key record is in the server's content plugin.
    lookupEspmRecordById: function (id) { return id === idOf(MASTER_DESC) ? { record: { type: 'MISC' } } : null; }
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
    console: { log: function () { logged.push([].slice.call(arguments).join(' ')); } },
    require: require, mp: mp, Date: FakeDate,
    BUILDING_BY_DOOR: BUILDING_BY_DOOR, BUILDING_NAME: BUILDING_NAME, WAY_OUT: WAY_OUT,
    BENCH_BY_BASE: {},
    idOf: idOf, takeItem: takeItem, addItem: addItem,
    unfitToMake: function () { return ''; },
    notify: function (a, line) { told.push({ a: a, line: line }); },
    say: function (a, line) { told.push({ a: a, line: line }); },
    guard: function (n, f) { return f; },
    setInterval: function () { return 0; }, clearInterval: function () { },
    log: function () { },
    __thornswoodCharacter: {
      stateOf: function () { return { v: 1, prof: 'farmer' }; },
      writeState: function () { }
    },
    // The ground outside a door, the farming block's own measure.
    __thornswoodFarming: {
      groundOf: function (refId) { return refId === idOf(DOOR) ? JSON.parse(JSON.stringify(GROUND)) : null; }
    },
    // The office roles each account holds, as the door reads them.
    __thornswoodOffices: function (pid) {
      return pid === STEN.pid ? { jarl: [], court: [], steward: [HOLD], guard: [] } : { jarl: [], court: [], steward: [], guard: [] };
    }
  };
  box.globalThis = box;
  inDir(function () { vm.runInNewContext(propBlock, box, { filename: 'gamemode.js property' }); });
  return box;
}

function to(pid, line) { told.push({ a: pid, line: line }); }
let box = boot();
let W = box.__thornswoodProperty;
yes('P1 the property block boots and publishes itself', !!W && typeof W.command === 'function' && typeof W.claims === 'function');
if (!W || typeof W.command !== 'function') { done(); }

function open(p, door) { inDir(function () { W.touched(p.a, door); }); }
function word(p, w, args) {
  const s = told.length;
  inDir(function () { W.command(w, [w].concat(args || []), p.a, p.pid, to, w + ' ' + (args || []).join(' ')); });
  return told.slice(s).filter(function (t) { return t.a === p.pid || t.a === p.a; }).map(function (t) { return t.line; }).join(' ');
}
function inv(p) { return refs[p.a].inventory.entries; }
function give(p, desc, name) { const e = { baseId: idOf(desc), count: 1 }; if (name) { e.name = name; } inv(p).push(e); }
function held(b) { return inDir(function () { return W.holderOf(b); }); }
function shutTo(p, door) { return inDir(function () { return W.shutFor(p.a, p.pid).shut.indexOf(idOf(door)) !== -1; }); }
function copy(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
/*
  A claim as a value: keys in order, because load() rebuilds a row field by
  field and so writes them back in its own order, and a ground of null left
  out, because a claim made where the farming block finds no ground is
  written with ground: null and read back with no ground at all. Every
  reader asks c.ground for truth (coversGround, the deed's keepGround), so
  the two are the same claim.
*/
function canon(c) {
  if (!c || typeof c !== 'object') { return c; }
  if (Array.isArray(c)) { return c.map(canon); }
  const out = {};
  Object.keys(c).sort().forEach(function (k) {
    if (k === 'ground' && c[k] === null) { return; }
    out[k] = canon(c[k]);
  });
  return out;
}
function sameClaim(a, b) { return JSON.stringify(canon(a)) === JSON.stringify(canon(b)); }

// ============================================= 1. through the gamemode path
const CLAIMED_AT = clock.t;
open(HULDA, DOOR);
word(HULDA, '/claim', [hex(DOOR)]);
let h = held(HOUSE);
yes('C1 the lock key at the door claims Honeyside for Hulda', !!h && h.by === HULDA.pid && h.name === 'Hulda' && h.at === CLAIMED_AT);
yes('C2 with the ground outside its door', !!h && same(h.ground, GROUND));
yes('C3 and hands her the deed and master key no. 1',
    inv(HULDA).some(function (e) { return e.baseId === idOf(DEED_DESC) && e.name === W.deedLabel(HOUSE); }) &&
    !!h && !!h.master && h.master.no === 1 && h.master.for === HULDA.pid);
open(HULDA, DOOR);
word(HULDA, '/lock', [hex(DOOR)]);
yes('C4 the lock key locks it', held(HOUSE).locked === true);
open(BOB, SHOP_DOOR);
word(BOB, '/claim', [hex(SHOP_DOOR)]);
yes('C5 Bob claims his shop and leaves it unlocked', !!held(SHOP) && held(SHOP).by === BOB.pid && held(SHOP).locked === false);

open(STEN, DOOR);
const rentSaid = word(STEN, '/rent', ['50']);
h = held(HOUSE);
yes('C6 the steward of the hold sets 50 rent at the door: "' + rentSaid + '"',
    !!h.rent && h.rent.amount === 50 && h.rent.everyDays === 7 && h.rent.owed === 0 && h.rent.since === CLAIMED_AT);
yes('C6 and setting rent leaves the holder and the lock alone', h.by === HULDA.pid && h.locked === true);

clock.t += 8 * DAY;
inDir(function () { W.rentDue(); });
h = held(HOUSE);
yes('C7 a week on, the debt is counted: 50 owed, counted up to the week', h.rent.owed === 50 && h.rent.since === CLAIMED_AT + 7 * DAY);
open(HULDA, DOOR);
const TOUCHED = clock.t;
yes('C8 Hulda opening her door a day later is written as the last touch', held(HOUSE).touched === TOUCHED);

const before = copy(W.claims());
const regBefore = JSON.parse(fs.readFileSync(REGISTER, 'utf8'));
yes('C9 the register on disk carries what the block holds', same(regBefore.claims, before) && regBefore.masters === 2);

// ======================================== 2. rows that are not claims
// Written as text so the __proto__ key is an own key, as JSON.parse makes it.
const raw = fs.readFileSync(REGISTER, 'utf8');
const inject = '"claims": {\n  "__proto__": { "by": 666, "name": "Proto", "at": 1, "touched": 1, "locked": true },\n' +
               '  "junk:Test.esp": "not a claim",\n  "noone:Test.esp": { "name": "Nobody", "at": 5 },\n';
const tampered = raw.replace(/"claims":\s*\{\n?/, inject);
yes('T0 the three rows go into the register as the next boot reads it', tampered !== raw && /"__proto__"/.test(tampered));
fs.writeFileSync(REGISTER, tampered);

// ================================================= 3. the second boot
box = boot();
W = box.__thornswoodProperty;
const after = W.claims();
yes('R1 the restart boots the block again', !!W && typeof W.claims === 'function');
yes('R2 Honeyside comes back exactly as it was: ' + JSON.stringify(after[HOUSE]), sameClaim(after[HOUSE], before[HOUSE]));
yes('R3 the holder and the name', after[HOUSE].by === HULDA.pid && after[HOUSE].name === 'Hulda');
yes('R4 the lock: still locked', after[HOUSE].locked === true);
yes('R5 when it was claimed and last touched', after[HOUSE].at === CLAIMED_AT && after[HOUSE].touched === TOUCHED);
yes('R6 the ground under the house', same(after[HOUSE].ground, GROUND));
yes('R7 the rent, what is owed and when it was last counted',
    same(after[HOUSE].rent, { amount: 50, everyDays: 7, owed: 50, since: CLAIMED_AT + 7 * DAY }));
yes('R8 the master key\'s number and who it was cut for', same(after[HOUSE].master, { for: HULDA.pid, no: 1 }));
yes('R9 the shop comes back exactly as it was, unlocked: a restart turns no lock either way',
    sameClaim(after[SHOP], before[SHOP]) && after[SHOP].locked === false && after[SHOP].by === BOB.pid);
yes('R10 the rows that are not claims are dropped, and said so',
    Object.keys(after).sort().join(',') === [HOUSE, SHOP].sort().join(',') &&
    logged.some(function (l) { return /dropped 2 row\(s\) that were not claims/.test(l); }) &&
    logged.some(function (l) { return /read 2 claim\(s\)/.test(l); }));
yes('R11 the __proto__ row is not an own key and did not become the register\'s prototype',
    !Object.prototype.hasOwnProperty.call(after, '__proto__') && after.by === undefined && after.locked === undefined);
yes('R12 the next master key number is still above every one cut', JSON.parse(fs.readFileSync(REGISTER, 'utf8')).masters === 2);

// ============================== 4. the world behaves as the register says
yes('W1 after the restart the door is shut to a stranger', shutTo(EVE, DOOR) === true);
open(EVE, DOOR);
const pushed = refs[EVE.a].thornswoodLocks;
yes('W2 and opening a door pushes that to her game, with the way out left open',
    !!pushed && pushed.shut.indexOf(idOf(DOOR)) !== -1 && pushed.open.indexOf(idOf(DOOR_IN)) !== -1);
give(CAROL, KEY_DESC, W.keyLabel(HOUSE));
yes('W3 a key cut before the restart still opens it', shutTo(CAROL, DOOR) === false);
yes('W4 the holder still gets in, and her master key and deed still count',
    shutTo(HULDA, DOOR) === false &&
    inDir(function () { return W.holdsMasterKey(HULDA.a, HOUSE) && W.holdsDeed(HULDA.a, HOUSE); }));
open(HULDA, DOOR);
yes('W5 the holder\'s line at the door says Unlock, because it is still locked',
    !!refs[HULDA.a].thornswoodDoorLine && refs[HULDA.a].thornswoodDoorLine.x === 'unlock');
yes('W6 opening the door within the hour does not move the touch read back', held(HOUSE).touched === TOUCHED);
const unlockSaid = word(HULDA, '/unlock', [hex(DOOR)]);
yes('W7 and the lock turns from where the restart left it: "' + unlockSaid + '"',
    held(HOUSE).locked === false && /You unlock Honeyside/.test(unlockSaid));
word(HULDA, '/lock', [hex(DOOR)]);
yes('W7 and back', held(HOUSE).locked === true);

clock.t = CLAIMED_AT + 15 * DAY;
inDir(function () { W.rentDue(); });
yes('W8 the rent keeps counting from when it was last counted, not from the boot',
    !!held(HOUSE).rent && held(HOUSE).rent.owed === 100 && held(HOUSE).rent.since === CLAIMED_AT + 14 * DAY);

clock.t = TOUCHED + 14 * DAY - 60000;
yes('W9 a minute short of 14 days after the touch read back, it is still hers', !!held(HOUSE) && held(HOUSE).by === HULDA.pid);
clock.t = TOUCHED + 14 * DAY + 60000;
yes('W10 a minute past, it lapses: counted from the touch read back, not from the boot', held(HOUSE) === null);
yes('W11 the lapse opens the door to the stranger again', shutTo(EVE, DOOR) === false);
yes('W12 and the lapse is written to the register', !Object.prototype.hasOwnProperty.call(JSON.parse(fs.readFileSync(REGISTER, 'utf8')).claims, HOUSE));

box = boot();
W = box.__thornswoodProperty;
yes('W13 a third boot finds Honeyside free: a lapse survives a restart too',
    !Object.prototype.hasOwnProperty.call(W.claims(), HOUSE));
done();
