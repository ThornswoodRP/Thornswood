// test-1734-rest-reconnect.js
//
// #1734. exhaustion.md: "You are resting only while the place is true." A
// person who logged out sitting on a seat or lying in a bed and came back
// without a server restart stayed in the beds' record (bedState.lying): it
// was kept for an offline person for 48 hours (LYING_FORGET_MS), and the
// beds' first sight of an arriving person passed over anybody still in it.
// Their meters still said the kind they logged out on, so the server went on
// counting the rest at that rate while they stood beside the furniture, and
// told them "You have left the seat" when they walked off.
//
// Nobody comes back into the world sitting or lying down. Read in the fork
// (engine/skymp at a247ef2): the client puts its own character into
// furniture only when the server answers a press (ProcessActivateNormal,
// FURN, SendOpenContainer; onOpenContainerMessage on the client), who sits
// where is held in memory and never saved, and PartOne::SetUserActor clears
// the last animation when a client is handed its character again. So the
// beds forget a person's place the moment they are gone, and coming back is
// the same first sight as after a restart.
//
// This drives the REAL needs block and the REAL property block's beds over
// one stand-in server, an online list this file controls and a clock turned
// by hand: sitting down, logging out, coming back without a restart, and
// the same again with a restart, side by side.
//
// Read only, apart from its own temp folder.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SRC = process.env.GM || path.join(ROOT, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(SRC, 'utf8')).split(CR).join('');

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
function slice(start, end) {
  const a = gm.indexOf(start);
  if (a < 0) { return null; }
  const b = gm.indexOf(end, a + start.length);
  return b < 0 ? null : gm.slice(a, b + end.length);
}

const needsBlock = slice('// ==== thornswood needs: hunger, thirst and exhaustion ====', '// ==== end thornswood needs ====');
const propBlock = slice('// ==== thornswood property ====', '// ==== end thornswood property ====');
yes('the needs and property blocks are in the gamemode', !!needsBlock && !!propBlock);
if (!needsBlock || !propBlock) { done(); }

const HOUR = 3600000;
const MIN = 60000;

// ---------------------------------------------------------------- the world --

const clock = { t: Date.UTC(2026, 9, 4, 20, 0, 0) };
class FakeDate extends Date { static now() { return clock.t; } }
const INN = '1a2b3:Skyrim.esm';
const HOME = '16778:Skyrim.esm';
const TUNDRA = '3c:Skyrim.esm';
const BUILDING_NAME = {};
BUILDING_NAME[INN] = 'The Bannered Mare';
BUILDING_NAME[HOME] = 'Honeyside';
const BUILDING_BY_DOOR = { '1001:Skyrim.esm': INN, '1002:Skyrim.esm': HOME };
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
const BED = 'b001:Skyrim.esm';
const CHAIR = 'c001:Skyrim.esm';
const RECORDS = {};
RECORDS[idOf(BED)] = { record: { type: 'FURN', editorId: 'CommonBedDouble01', fields: [] } };
RECORDS[idOf(CHAIR)] = { record: { type: 'FURN', editorId: 'CommonChair01', fields: [] } };

const SAM = { a: 0xff000101, pid: 101, name: 'Sam' };       // sits on a chair at the inn
const ALICE = { a: 0xff000202, pid: 202, name: 'Alice' };   // holds Honeyside
const EVE = { a: 0xff000303, pid: 303, name: 'Eve' };       // sleeps on the road
const TOM = { a: 0xff000404, pid: 404, name: 'Tom' };       // sits down the moment he is in
const PEOPLE = [SAM, ALICE, EVE, TOM];
const INN_CHAIR = 0x00a00001, HOME_BED = 0x00a00004, ROAD_BED = 0x00a00007, ROAD_CHAIR = 0x00a00009;

const refs = {};
function placeRef(id, base, cell, pos) { refs[id] = { baseDesc: base, worldOrCellDesc: cell, pos: pos }; }
placeRef(INN_CHAIR, CHAIR, INN, [0, 0, 0]);
placeRef(HOME_BED, BED, HOME, [0, 0, 0]);
placeRef(ROAD_BED, BED, TUNDRA, [60000, 50000, 0]);
placeRef(ROAD_CHAIR, CHAIR, TUNDRA, [70000, 50000, 0]);
PEOPLE.forEach(function (p) {
  refs[p.a] = { profileId: p.pid, appearance: { name: p.name }, worldOrCellDesc: TUNDRA,
                pos: [90000, 90000, 0], inventory: { entries: [] } };
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-1734-rest-'));
fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
fs.mkdirSync(path.join(dir, 'private'));
fs.writeFileSync(path.join(dir, 'private', 'property.json'), JSON.stringify({ claims: {
  [HOME]: { by: ALICE.pid, name: 'Alice', at: clock.t, touched: clock.t }
} }));
function inDir(f) {
  const was = process.cwd();
  process.chdir(dir);
  try { return f(); } finally { process.chdir(was); }
}

let online = PEOPLE.map(function (p) { return p.a; });
const told = [];
const needsG = {};
const needsStore = {};
const needsNamed = {};
const needs = new Function('globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
  'guard', 'notify', 'say', needsBlock + '\nreturn globalThis.__thornswoodNeeds;')(
  needsG, {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return online.slice(); }
      if (key === 'worldOrCellDesc') { return refs[id] ? refs[id].worldOrCellDesc : ''; }
      return needsStore[id];
    },
    set: function (id, key, v) { needsStore[id] = JSON.parse(JSON.stringify(v)); }
  }, FakeDate, { log: function () { } }, function () { return 0; }, function () { },
  function (n, f) { needsNamed[n] = f; return f; }, function () { },
  function (id, text) { told.push({ id: id, text: text }); });

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
    getDescFromId: function (id) { return id.toString(16) + ':Skyrim.esm'; },
    lookupEspmRecordById: function (id) { return RECORDS[id] || null; }
  };
  const box = {
    console: { log: function () { } }, require: require, mp: mp, Date: FakeDate,
    BUILDING_BY_DOOR: BUILDING_BY_DOOR, BUILDING_NAME: BUILDING_NAME, WAY_OUT: {},
    idOf: idOf,
    notify: function () { },
    say: function (id, text) { told.push({ id: id, text: text }); },
    guard: function (n, f) { return f; },
    setInterval: function () { return 0; },
    clearInterval: function () { },
    log: function () { },
    __thornswoodNeeds: needs,
    __thornswoodCharacter: { stateOf: function () { return { v: 1 }; }, writeState: function () { } }
  };
  box.globalThis = box;
  inDir(function () { vm.runInNewContext(propBlock, box, { filename: 'gamemode.js property' }); });
  needsG.__thornswoodBeds = box.__thornswoodBeds;
  return box;
}

let box = boot();
function beds() { return box.__thornswoodBeds; }
function standBy(p, ref, dx) {
  refs[p.a].worldOrCellDesc = refs[ref].worldOrCellDesc;
  refs[p.a].pos = refs[ref].pos.slice();
  refs[p.a].pos[0] += dx || 0;
}
/* What the client does on furnitureEnter after the server answered the press. */
function sitOrLie(p, ref) {
  standBy(p, ref);
  beds().touched(p.a, ref, refs[ref].baseDesc);
  return inDir(function () { return beds().rest(p.a, p.pid); });
}
function bedTick() { inDir(function () { beds().tick(); }); }
function needsTick() { needsNamed.needsTick(); }
function tickFor(ms) {
  for (let t = 0; t < ms; t += 5000) { clock.t += 5000; needsTick(); bedTick(); }
}
function leave(p) { online = online.filter(function (a) { return a !== p.a; }); needsTick(); bedTick(); }
function back(p) { online.push(p.a); }
function restart() { delete box.__thornswoodBedState; box = boot(); }
function linesFor(p, since) {
  return told.slice(since || 0).filter(function (t) { return t.id === p.a; }).map(function (t) { return t.text; });
}
function held(p) {
  const st = beds().state;
  return {
    lying: Object.prototype.hasOwnProperty.call(st.lying, p.a),
    pressed: Object.prototype.hasOwnProperty.call(st.pressed, p.a),
    seen: Object.prototype.hasOwnProperty.call(st.seen, p.a)
  };
}
const LEFT = /You have left the (seat|bed)/;

// Everybody arrives, and is tired.
PEOPLE.forEach(function (p) { needs.settle(p.a); });
clock.t += 6 * HOUR;
needsTick();
bedTick();

// -------------------------------------------- a seat, out and back in --

{
  sitOrLie(SAM, INN_CHAIR);
  yes('S1 Sam sitting on a chair rests at the seat rate', needs.read(SAM.a).resting === 'sit' && held(SAM).lying);
  leave(SAM);
  const away = held(SAM);
  yes('S1 the moment he is gone, the beds hold nothing of his: no place, no press, not seen',
      !away.lying && !away.pressed && !away.seen);
  clock.t += 5 * MIN;
  back(SAM);
  standBy(SAM, INN_CHAIR, 50);   // he comes back standing where he logged out, beside the chair
  const since = told.length;
  bedTick();                      // the beds' first sight of him
  const n = needs.read(SAM.a);
  yes('S2 back without a restart, standing beside the chair, he is not resting', n.resting === '' && !held(SAM).lying);
  const before = needs.settle(SAM.a).rest;
  tickFor(HOUR);
  const after = needs.settle(SAM.a).rest;
  yes('S2 an hour beside the chair is an hour of the ordinary drain, not the seat\'s 20 an hour (' +
      before.toFixed(2) + ' to ' + after.toFixed(2) + ')',
      after < before && Math.abs((before - after) - 12.5) < 0.01);
  standBy(SAM, INN_CHAIR, 5000);
  tickFor(10000);
  yes('S2 and walking off, nobody tells him he has left a seat he never sat on this session',
      !linesFor(SAM, since).some(function (l) { return LEFT.test(l) || /settle down to rest|You get up/.test(l); }));
  sitOrLie(SAM, INN_CHAIR);
  yes('S3 he sits down again, his client says so after the press, and it counts again',
      needs.read(SAM.a).resting === 'sit' && held(SAM).lying);
  tickFor(10000);
  yes('S3 and goes on counting while he sits', needs.read(SAM.a).resting === 'sit');
}

// --------------------------- a bed nobody can lend you, out and back in --

{
  sitOrLie(EVE, ROAD_BED);
  yes('B1 Eve lying in a bed on the road rests at the rough rate', needs.read(EVE.a).resting === 'rough');
  leave(EVE);
  clock.t += 9 * HOUR;
  back(EVE);
  standBy(EVE, ROAD_BED, 30);
  const since = told.length;
  bedTick();
  // Since #2246 (Patrick, 12 Oct 2026) a night on a bed on the road leaves
  // rest at least 50, so that night's line is the one thing she is told.
  yes('B2 back without a restart, beside the bed, she is up: no rest counted, the road\'s night only, and no other line',
      needs.read(EVE.a).resting === '' && !held(EVE).lying && needs.read(EVE.a).rest === 50 &&
      linesFor(EVE, since).every(function (l) { return /You slept, though not well/.test(l); }));
  standBy(EVE, ROAD_BED, 5000);
  tickFor(10000);
  yes('B2 walking off says nothing about a bed she was not in', !linesFor(EVE, since).some(function (l) { return LEFT.test(l); }));
}

// ------------------------- your own bed: the night counts, then you are up --

{
  sitOrLie(ALICE, HOME_BED);
  yes('O1 Alice lying in her own bed rests at the own bed rate', needs.read(ALICE.a).resting === 'bed');
  leave(ALICE);
  clock.t += 5 * MIN;
  back(ALICE);
  standBy(ALICE, HOME_BED, 30);
  bedTick();
  yes('O1 back after five minutes, too short for a night: up, and no fill',
      needs.read(ALICE.a).resting === '' && !linesFor(ALICE).some(function (l) { return /slept well/i.test(l); }));
  sitOrLie(ALICE, HOME_BED);
  leave(ALICE);
  clock.t += 9 * HOUR;
  back(ALICE);
  standBy(ALICE, HOME_BED, 30);
  bedTick();
  const n = needs.read(ALICE.a);
  yes('O2 back after a night: the fill is counted at the beds\' first sight, and she is up',
      n.rest === 100 && n.resting === '' && !held(ALICE).lying &&
      linesFor(ALICE).filter(function (l) { return /slept well/i.test(l); }).length === 1);
}

// ------------------------------------ a reconnect is the same as a restart --

{
  function round(withRestart) {
    needs.settle(SAM.a);
    needsStore[SAM.a].rest = 50;    // both rounds from the same meter
    sitOrLie(SAM, ROAD_CHAIR);
    const was = needs.read(SAM.a);
    leave(SAM);
    clock.t += 10 * MIN;
    if (withRestart) { restart(); }
    back(SAM);
    standBy(SAM, ROAD_CHAIR, 40);
    bedTick();
    tickFor(30 * MIN);
    const n = needs.read(SAM.a);
    return { resting: n.resting, rest: n.rest, from: was.rest, lying: held(SAM).lying };
  }
  const plain = round(false);
  const after = round(true);
  yes('R1 a reconnect without a restart ends where one with a restart ends: up, not counted, the same rest',
      plain.resting === '' && after.resting === '' && !plain.lying && !after.lying &&
      Math.abs((plain.from - plain.rest) - (after.from - after.rest)) < 0.01);
}

// ------------------ somebody who sits down before the beds have seen them --

{
  leave(TOM);
  clock.t += 2 * MIN;
  back(TOM);
  sitOrLie(TOM, ROAD_CHAIR);      // pressed and sat before the next tick
  bedTick();                      // the first sight comes after it
  yes('T1 a seat taken this session, before the first sight, is kept: he goes on resting',
      needs.read(TOM.a).resting === 'sit' && held(TOM).lying);
}

// ------------------------------------------------------------ the wiring --

{
  const code = propBlock.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  yes('W1 nothing keeps a place for somebody who is gone: LYING_FORGET_MS is out of the code',
      code.indexOf('LYING_FORGET_MS') === -1);
  const tick = code.slice(code.indexOf('function bedTick() {'), code.indexOf('function guestsOf('));
  yes('W2 the tick lets go of the place of whoever is not online, beside who was seen and what was pressed',
      /for \(var l in bedState\.lying\) \{\s*if \(bedHas\(bedState\.lying, l\) && !on\[l\]\) \{ delete bedState\.lying\[l\]; \}/.test(tick));
  yes('W3 and the first sight still gets up whoever arrives resting in a place the server did not see',
      /if \(getUp\(id, needs\)\)/.test(tick));
}

try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
done();
