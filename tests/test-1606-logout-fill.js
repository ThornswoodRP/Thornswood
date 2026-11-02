// test-1606-logout-fill.js
//
// #1606. exhaustion.md: "Logging out in a real bed fills rest to 100 when you
// come back, and puts 25 back on hunger and on thirst." The needs block had
// arrived() for it, exported, and nothing ever called it: its comment named
// the character block's first sight of somebody as the caller and that call
// was never written. Now the first settle after somebody comes back into the
// world is their arrival, whichever reader of the meters gets there first,
// and the night is counted there, once.
//
// Asked on #1606 and built as the suggested answer: your own bed and a bed
// you are allowed in (inn) count, and the night is at least 24 real minutes
// away (8 hours on the game clock). Since #2246 (Patrick, 12 Oct 2026) an
// inn or temple bed nobody holds fills too, with 15 on hunger and thirst,
// a bed or bedroll nobody can lend you leaves rest at least 50, and a bed
// indoors costs nothing for the time away: tests/test-2246-rest-places.js
// walks every place.
//
// Part A runs the REAL needs block over a stand-in mp, a clock turned by hand
// and an online list this file controls, with the block's own tick. Part B
// runs it beside the REAL property block's beds, lying down in a real bed the
// server saw pressed, logging out, a restart, and coming back.
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

// ------------------------------------------------------------ the wiring --

{
  const code = needsBlock.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const calls = code.match(/\barrived\(/g) || [];
  yes('W1 arrived() has a caller: settle, at an arrival, and nothing else calls it',
      calls.length === 2 && /var slept = arriving \? arrived\(actorId, n, away\) : '';/.test(code));
  yes('W1 and it is not handed out for anybody else to call',
      !/arrived: arrived/.test(code));
  yes('W2 the tick takes whoever has left out of here, so they arrive again',
      /for \(var h in here\) \{[\s\S]{0,200}online\.indexOf\(Number\(h\)\) === -1[\s\S]{0,40}delete here\[h\];/.test(code));
  yes('W3 nothing new runs on a timer: the block still sets only the burn and the needs tick, and no timeout',
      (code.match(/setInterval\(/g) || []).length === 2 && !/setTimeout\(/.test(code));
  // The whole gamemode: nobody calls the old shape any more.
  const all = gm.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  yes('W4 nothing outside the needs block calls arrived()',
      (all.match(/\barrived\(/g) || []).length === calls.length);
}

// ------------------------------------------------- part A: the needs block --

/*
  The block over a stand-in mp. Everybody with meters is online unless they
  have left. The block's timers are kept by name, so its own tick runs when
  this file says. The character block's writer is counted, and so is the
  beds' off.
*/
function rig(startAt, g) {
  const store = {};
  const clock = { now: startAt || Date.UTC(2026, 9, 4, 20, 0, 0) };
  const said = [];
  const gone = {};
  const named = {};
  const redrawn = [];
  const off = [];
  g = g || {};
  g.__thornswoodCharacter = {
    stateOf: function () { return { v: 1 }; },
    writeState: function (id) { redrawn.push(id); }
  };
  g.__thornswoodBeds = { off: function (id) { off.push(id); return ''; } };
  const mp = {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return Object.keys(store).map(Number).filter(function (id) { return !gone[id]; }); }
      if (key === 'worldOrCellDesc') { return 'cell:X.esm'; }
      return store[id];
    },
    set: function (id, key, v) { store[id] = JSON.parse(JSON.stringify(v)); }
  };
  const FakeDate = { now: function () { return clock.now; } };
  const api = new Function('globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
    'guard', 'notify', 'say', needsBlock + '\nreturn globalThis.__thornswoodNeeds;')(
    g, mp, FakeDate, { log: function () { } }, function () { return 0; }, function () { },
    function (n, f) { named[n] = f; return f; },
    function () { }, function (id, line) { said.push({ id: id, line: line }); });
  return {
    N: api, g: g, mp: mp, store: store, clock: clock, said: said, redrawn: redrawn, off: off,
    tick: function () { named.needsTick(); },
    leave: function (id) { gone[id] = true; named.needsTick(); },
    back: function (id) { delete gone[id]; },
    seed: function (id, at) { const n = api.fresh(); n.at = at || clock.now; store[id] = n; },
    slept: function (id) {
      return said.filter(function (s) { return s.id === id && /slept well/i.test(s.line); }).length;
    }
  };
}

const ME = 0xff000001;
const YOU = 0xff000002;

{
  const r = rig();
  const N = r.N.NEEDS;
  // NEEDS.away since #2246: a row for each kind of rest; the ones that fill
  // are the beds that count. tests/test-2246-rest-places.js has the rest.
  const fills = Object.keys(N.away).filter(function (k) { return N.away[k].rest >= 100; });
  yes('A0 the beds that fill rest are your own bed, a bed you are allowed in, and an inn or temple bed nobody holds',
      fills.sort().join(',') === 'bed,common,commonfire,inn');
  yes('A0 a night away is 8 hours of the game clock, 24 real minutes at twenty to one',
      N.sleptFor === 24 * MIN && N.sleptFor * 20 === 8 * HOUR);
  yes('A0 the fill is rest to 100 and 25 on hunger and thirst, as the page says',
      ['bed', 'inn'].every(function (k) {
        return N.away[k].rest === 100 && N.away[k].food === 25 && N.away[k].drink === 25;
      }));
}

/* Tired, lying down in kind, logged out, away for the time, back, and the
   first settle by whichever reader. Answers the meters and the rig. */
function night(kind, away, first) {
  const r = rig();
  r.seed(ME);
  r.N.settle(ME);                 // arrived, with nothing to count
  r.clock.now += 5 * HOUR;
  r.N.settle(ME);
  if (kind) { r.N.resting(ME, kind); }
  r.clock.now += 10 * 1000;
  r.tick();
  const was = JSON.parse(JSON.stringify(r.store[ME]));
  r.leave(ME);
  r.clock.now += away;
  r.back(ME);
  let n = null;
  if (first === 'tick') { r.tick(); n = r.N.read(ME); }
  else if (first === 'place') { r.N.place(ME, 'indoors', '-', '0', '1', '0', '-'); n = r.N.read(ME); }
  else if (first === 'view') { r.N.view(ME); n = r.N.read(ME); }
  else if (first === 'worked') { r.N.worked(ME); n = r.N.read(ME); }
  else { n = r.N.settle(ME); }
  return { r: r, was: was, n: n };
}

{
  const t = night('bed', 9 * HOUR);
  const d = t.r.N.NEEDS.drain;
  const share = t.r.N.NEEDS.away.bed.drain;
  const food = Math.max(0, t.was.food - d.food * 9 * share) + 25;
  const drink = Math.max(0, t.was.drink - d.drink * 9 * share) + 25;
  yes('A1 logging out in your own bed and coming back a night later fills rest to 100', t.n.rest === 100);
  yes('A1 hunger and thirst fell by the bed\'s share of the clock while away (none since #2246), and 25 is put back on each (' +
      t.n.food.toFixed(2) + ', ' + t.n.drink.toFixed(2) + ')',
      Math.abs(t.n.food - food) < 1e-9 && Math.abs(t.n.drink - drink) < 1e-9);
  yes('A1 they are up, not still resting', t.n.resting === '');
  yes('A1 they are told, once', t.r.slept(ME) === 1);
  yes('A1 the beds are told they are up', t.r.off.length === 1 && t.r.off[0] === ME);
  yes('A1 and the bands it moved go to the character', t.r.redrawn.indexOf(ME) !== -1);

  // Once: the meters move on from there the ordinary way.
  t.r.clock.now += HOUR;
  const later = t.r.N.settle(ME);
  t.r.tick();
  yes('A2 the fill is given once: an hour on, rest has fallen from 100 and nothing more was said',
      later.rest < 100 && t.r.slept(ME) === 1);
  // A second logout, not lying down again, is no night in a bed.
  t.r.leave(ME);
  t.r.clock.now += 9 * HOUR;
  t.r.back(ME);
  const again = t.r.N.settle(ME);
  yes('A2 logging out again on your feet gives nothing', again.rest < 100 && t.r.slept(ME) === 1);
}

{
  const t = night('inn', 9 * HOUR);
  yes('A3 a bed you are allowed in (inn) gets the fill', t.n.rest === 100 && t.r.slept(ME) === 1);
}
['rough', 'camp'].forEach(function (kind) {
  // Five hours awake left hunger and thirst under the floor of 25, so they
  // stay where they were; rest is at least 50 after the night (#2246).
  const t = night(kind, 9 * HOUR);
  yes('A3 resting at ' + kind + ' is no full night: not slept well, rest at least 50, nothing on hunger or thirst',
      t.r.slept(ME) === 0 && t.n.rest === 50 && t.n.food === t.was.food && t.n.drink === t.was.drink &&
      t.n.resting === '');
});
['sit', 'campfire'].forEach(function (kind) {
  const t = night(kind, 9 * HOUR);
  yes('A3 resting at ' + kind + ' gets no fill: no line, and hunger and thirst only fell',
      t.r.slept(ME) === 0 && t.n.food === 0 && t.n.drink === 0 && t.n.resting === kind);
});
{
  const t = night('', 9 * HOUR);
  yes('A3 logging out on your feet gets no fill', t.r.slept(ME) === 0 && t.n.rest < 100);
}

{
  const N = rig().N.NEEDS;
  const t = night('bed', N.sleptFor);
  yes('A4 away exactly the night, 24 minutes, counts', t.n.rest === 100 && t.r.slept(ME) === 1);
  const s = night('bed', N.sleptFor - MIN);
  const d = s.r.N.NEEDS;
  // #1764: the time away gains no rest, so a minute short of the night is
  // the drain alone, not the bed's rate.
  const rest = Math.max(0, s.was.rest - d.drain.rest * d.away.bed.drain * (N.sleptFor - MIN) / HOUR);
  yes('A4 away a minute less is no night: no line, and the time away only drained (#1764)',
      s.r.slept(ME) === 0 && Math.abs(s.n.rest - rest) < 1e-6 && s.n.resting === 'bed');
}

['tick', 'place', 'view', 'worked'].forEach(function (first) {
  const t = night('bed', 9 * HOUR, first);
  const restAfter = first === 'worked' ? 100 - t.r.N.NEEDS.work.novice : 100;
  yes('A5 the night counts whichever reader of the meters comes first: ' + first,
      Math.abs(t.n.rest - restAfter) < 1e-9 && t.r.slept(ME) === 1);
});

{
  // Online the whole time, lying in the bed: the bed's rate, never the fill.
  const r = rig();
  r.seed(ME);
  r.N.settle(ME);
  r.clock.now += 5 * HOUR;
  r.N.settle(ME);
  r.N.resting(ME, 'bed');
  for (let i = 0; i < 9 * 3; i++) { r.clock.now += 20 * MIN; r.tick(); }
  const n = r.N.read(ME);
  yes('A6 lying in a bed while online is the bed\'s rate and no fill: hunger and thirst are not topped up',
      r.slept(ME) === 0 && n.food === 0 && n.drink === 0 && n.resting === 'bed');
  // A long gap with nobody leaving is still not an arrival: only leaving is.
  r.clock.now += 9 * HOUR;
  r.N.settle(ME);
  yes('A6 a long gap between settles while online is not an arrival either', r.slept(ME) === 0);
}

{
  // Somebody else's logout does not touch you.
  const r = rig();
  r.seed(ME); r.seed(YOU);
  r.N.settle(ME); r.N.settle(YOU);
  r.N.resting(ME, 'bed'); r.N.resting(YOU, 'bed');
  r.leave(YOU);
  r.clock.now += 9 * HOUR;
  r.back(YOU);
  r.N.settle(ME); r.N.settle(YOU);
  yes('A7 only the person who left and came back is filled', r.slept(YOU) === 1 && r.slept(ME) === 0);
}

/* The block loaded again over the same global and the same stand-in mp,
   the way a hot reload does it. */
function reload(r) {
  return new Function('globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
    'guard', 'notify', 'say', needsBlock + '\nreturn globalThis.__thornswoodNeeds;')(
    r.g, r.mp, { now: function () { return r.clock.now; } }, { log: function () { } },
    function () { return 0; }, function () { }, function (n, f) { return f; },
    function () { }, function (id, line) { r.said.push({ id: id, line: line }); });
}

{
  // A hot reload is not an arrival.
  const r = rig();
  r.seed(ME);
  r.N.settle(ME);
  r.N.resting(ME, 'bed');
  const kept = r.g.__thornswoodNeedsHere;
  const N2 = reload(r);
  yes('A8 a reload keeps who has arrived, on the global', !!kept && r.g.__thornswoodNeedsHere === kept && !!kept[ME]);
  r.clock.now += 9 * HOUR;
  const n = N2.settle(ME);
  yes('A8 so somebody in the world across a reload is not filled by it', r.slept(ME) === 0 && n.resting === 'bed');
}

{
  // Whoever is online when the block first loads has already arrived.
  const r = rig();
  r.seed(ME, r.clock.now - 9 * HOUR);
  r.store[ME].resting = 'bed';
  delete r.g.__thornswoodNeedsHere;
  const N2 = reload(r);
  const n = N2.settle(ME);
  yes('A8 somebody online when the block first loads has already arrived: no fill',
      r.slept(ME) === 0 && n.resting === 'bed');
}

// ------------------------------------------ part B: beside the real beds --

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
const RECORDS = {};
RECORDS[idOf(BED)] = { record: { type: 'FURN', editorId: 'CommonBedDouble01', fields: [] } };

const HULDA = { a: 0xff000101, pid: 101, name: 'Hulda' };   // holds the inn
const ALICE = { a: 0xff000202, pid: 202, name: 'Alice' };   // holds Honeyside
const BOB = { a: 0xff000303, pid: 303, name: 'Bob' };       // Hulda's guest tonight
const EVE = { a: 0xff000606, pid: 606, name: 'Eve' };       // sleeps on the road
const PEOPLE = [HULDA, ALICE, BOB, EVE];
const INN_BED = 0x00a00001, HOME_BED = 0x00a00004, ROAD_BED = 0x00a00007;

const refs = {};
function placeRef(id, base, cell, pos) { refs[id] = { baseDesc: base, worldOrCellDesc: cell, pos: pos }; }
placeRef(INN_BED, BED, INN, [0, 0, 0]);
placeRef(HOME_BED, BED, HOME, [0, 0, 0]);
placeRef(ROAD_BED, BED, TUNDRA, [60000, 50000, 0]);
PEOPLE.forEach(function (p) {
  refs[p.a] = { profileId: p.pid, appearance: { name: p.name }, worldOrCellDesc: TUNDRA,
                pos: [90000, 90000, 0], inventory: { entries: [] } };
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-1606-fill-'));
fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
fs.mkdirSync(path.join(dir, 'private'));
fs.writeFileSync(path.join(dir, 'private', 'property.json'), JSON.stringify({ claims: {
  [INN]: { by: HULDA.pid, name: 'Hulda', at: clock.t, touched: clock.t },
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
  // One server: the needs block reaches the beds through the same global.
  needsG.__thornswoodBeds = box.__thornswoodBeds;
  return box;
}

let box = boot();
function beds() { return box.__thornswoodBeds; }
function standBy(p, ref) { refs[p.a].worldOrCellDesc = refs[ref].worldOrCellDesc; refs[p.a].pos = refs[ref].pos.slice(); }
function lieDown(p, ref) {
  standBy(p, ref);
  beds().touched(p.a, ref, refs[ref].baseDesc);
  return inDir(function () { return beds().rest(p.a, p.pid); });
}
function bedTick() { inDir(function () { beds().tick(); }); }
function needsTick() { needsNamed.needsTick(); }
function leave(p) { online = online.filter(function (a) { return a !== p.a; }); needsTick(); bedTick(); }
function back(p) { online.push(p.a); }
function sleptLines(p) { return told.filter(function (t) { return t.id === p.a && /slept well/i.test(t.text); }).length; }
function lyingIn(p) { return Object.prototype.hasOwnProperty.call(beds().state.lying, p.a); }

// Everybody arrives, and is tired.
PEOPLE.forEach(function (p) { needs.settle(p.a); });
clock.t += 6 * HOUR;
needsTick();
bedTick();

{
  // Alice lies down in her own bed, logs out, and comes back a night later
  // with no restart. Nobody comes back lying down, so the beds forget her bed
  // as she leaves (#1734), and their first sight of her is her arrival, the
  // same as after a restart.
  lieDown(ALICE, HOME_BED);
  yes('B1 Alice lying in her own bed rests at the own bed rate', needs.read(ALICE.a).resting === 'bed');
  leave(ALICE);
  yes('B1 gone from the world, the beds no longer have her lying there (#1734)', !lyingIn(ALICE));
  clock.t += 9 * HOUR;
  back(ALICE);
  yes('B1 back with no restart, her meters still say where she lay until her first settle',
      needs.read(ALICE.a).resting === 'bed');
  bedTick();                    // first sight: her arrival
  needs.place(ALICE.a, 'indoors', '-', '0', '1', '0', '-');   // her client's first report
  const n = needs.read(ALICE.a);
  yes('B1 she comes back rested, with 25 on hunger and thirst, and up',
      n.rest === 100 && n.food === 25 && n.drink === 25 && n.resting === '');
  yes('B1 told once', sleptLines(ALICE) === 1);
  yes('B1 the beds no longer count her as lying in it', !lyingIn(ALICE));
  const before = told.length;
  bedTick(); needsTick(); bedTick();
  yes('B1 and nothing more is said to her about a bed she has left',
      !told.slice(before).some(function (t) { return t.id === ALICE.a; }) && sleptLines(ALICE) === 1);
}

{
  // Bob is Hulda's guest, lies down, logs out; the server restarts while he
  // is away. The beds' first sight gets him up, and the night still counts.
  standBy(HULDA, INN_BED);
  standBy(BOB, INN_BED);
  inDir(function () {
    beds().sleepHere(['/sleephere', BOB.a.toString(16)], HULDA.a, HULDA.pid, function () { });
  });
  lieDown(BOB, INN_BED);
  yes('B2 Bob lying in the inn as a guest rests at the allowed rate', needs.read(BOB.a).resting === 'inn');
  leave(BOB);
  clock.t += 9 * HOUR;
  // The restart: the beds forget who lay down where.
  delete box.__thornswoodBedState;
  box = boot();
  back(BOB);
  bedTick();                    // first sight: he came in resting where the server did not see
  const n = needs.read(BOB.a);
  yes('B2 after a restart the first sight is his arrival, and the night counts',
      n.rest === 100 && n.food === 25 && n.drink === 25 && n.resting === '' && sleptLines(BOB) === 1);
}

{
  // Eve sleeps in a bed on the road, nobody's to lend.
  lieDown(EVE, ROAD_BED);
  yes('B3 a bed nobody holds is the rough rate', needs.read(EVE.a).resting === 'rough');
  leave(EVE);
  clock.t += 9 * HOUR;
  back(EVE);
  needs.place(EVE.a, 'outdoors', '-', '0', '0', '0', '-');
  const n = needs.read(EVE.a);
  yes('B3 a bed nobody can lend you gets no fill: hunger and thirst only fell, and no line',
      n.food === 0 && n.drink === 0 && sleptLines(EVE) === 0);
}

{
  // Hulda stays in the world in her own inn's bed all night.
  lieDown(HULDA, INN_BED);
  for (let i = 0; i < 27; i++) { clock.t += 20 * MIN; needsTick(); bedTick(); }
  const n = needs.read(HULDA.a);
  yes('B4 a night in your own bed without logging out is the own bed rate, and no fill',
      n.rest === 100 && n.food === 0 && n.drink === 0 && n.resting === 'bed' && sleptLines(HULDA) === 0);
}

try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
done();
