// test-2246-rest-places.js
//
// #2246. Survival starts too harsh, and where somebody rests or logs out
// should decide how much comes back (Djinn, #dev-test-results, 26 Sep): an
// inn or a temple the most, out in the wild the least.
//
// The hooks came first (#2363):
//
//   - the beds know an inn or a temple nobody holds, read off the room's own
//     records (CELL XLCN, the location's LocTypeInn or LocTypeTemple, never
//     a house sold as a home), and hand the needs block two kinds of their own,
//     common and commonfire;
//   - the needs block's NEEDS.away has a row for every kind of rest and for
//     somebody on their feet: how much of the clock the time away costs, and
//     what a night away gives back to rest, hunger and thirst.
//
// Then Patrick's numbers, 12 Oct 2026 on #2246, the recommended table: nothing
// drains while away in a bed indoors (your own, one you are allowed in, an inn
// or temple bed nobody holds); anywhere else the time away costs half the
// clock and takes no meter below 25; a night in an inn or temple bed gives
// full rest and 15 on hunger and thirst; a night on a bedroll or a bed on the
// road leaves rest at least 50; resting awake in an inn or temple bed is 40 an
// hour (45 by a fire); the clock stays. This harness holds the hooks, the
// table, and walks a new character through a first hour and a night away in
// each place, through the real beds and the real needs block (F below).
//
// The needs block and the property block are run as they stand, over a
// stand-in mp, a clock turned by hand and an online list this file controls.
//
// Read only, apart from its own temp folder.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
function read() {
  return fs.readFileSync(path.join.apply(path, [ROOT].concat([].slice.call(arguments))), 'utf8').split(CR).join('');
}
const gm = require('./gamemode-tables.js').joined(read('game', 'gamemode.js'));

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

const needsBlock = slice(gm, '// ==== thornswood needs: hunger, thirst and exhaustion ====', '// ==== end thornswood needs ====');
const propBlock = slice(gm, '// ==== thornswood property ====', '// ==== end thornswood property ====');
yes('the needs and property blocks are in the gamemode', !!needsBlock && !!propBlock);
if (!needsBlock || !propBlock) { done(); }

const HOUR = 3600000, MIN = 60000;
const clock = { t: Date.UTC(2026, 9, 12, 3, 0, 0) };
class FakeDate extends Date { static now() { return clock.t; } }

// ------------------------------------------------------------ the world --

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
function u32(n) { return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]; }

// Rooms, as the arrival inns and temples measured on 11 Oct have them.
const INN = '1605e:Skyrim.esm';         // WhiterunBanneredMare, nobody holds it here
const TEMPLE = '165a7:Skyrim.esm';      // WhiterunTempleofKynareth
const HONEYSIDE = '16bdd:Skyrim.esm';   // a house sold as a home that also carries LocTypeInn
const HALL = '165a3:Skyrim.esm';        // a room with no location at all
const HELD_INN = '16bdf:Skyrim.esm';    // RiftenBeeandBarb, held by Hulda
const BROKEN = '13a5c:Skyrim.esm';      // a room the engine throws on
const TUNDRA = '3c:Skyrim.esm';         // Tamriel
const BUILDING_NAME = {};
BUILDING_NAME[INN] = 'The Bannered Mare';
BUILDING_NAME[TEMPLE] = 'Temple of Kynareth';
BUILDING_NAME[HONEYSIDE] = 'Honeyside';
BUILDING_NAME[HELD_INN] = 'The Bee and Barb';
const BUILDING_BY_DOOR = { '1001:Skyrim.esm': INN, '1002:Skyrim.esm': TEMPLE, '1003:Skyrim.esm': HONEYSIDE,
                           '1004:Skyrim.esm': HELD_INN };

const KW = { LocTypeInn: 0x1cb87, LocTypeTemple: 0x1cb86, LocTypeDwelling: 0x130dc,
             LocTypePlayerHouse: 0xfc1a3, TGBusiness: 0xb2c4b };
const LOC = { inn: 0x1f86e, temple: 0x1f87d, honeyside: 0x2264c, held: 0x2264f };
const RECORDS = {};
const asked = [];
function rec(id, record) {
  RECORDS[id] = { record: record, toGlobalRecordId: function (local) { return local; } };
}
Object.keys(KW).forEach(function (k) { rec(KW[k], { type: 'KYWD', editorId: k, fields: [] }); });
function loc(id, words) {
  rec(id, { type: 'LCTN', editorId: 'Loc' + id.toString(16),
            fields: [{ type: 'KWDA', data: [].concat.apply([], words.map(function (w) { return u32(KW[w]); })) }] });
}
loc(LOC.inn, ['LocTypeDwelling', 'LocTypeInn', 'TGBusiness']);
loc(LOC.temple, ['LocTypeDwelling', 'LocTypeTemple']);
loc(LOC.honeyside, ['LocTypeDwelling', 'LocTypeInn', 'LocTypePlayerHouse']);
loc(LOC.held, ['LocTypeDwelling', 'LocTypeInn', 'TGBusiness']);
function cell(desc, locId) {
  rec(idOf(desc), { type: 'CELL', editorId: desc, fields: locId ? [{ type: 'XLCN', data: u32(locId) }] : [] });
}
cell(INN, LOC.inn);
cell(TEMPLE, LOC.temple);
cell(HONEYSIDE, LOC.honeyside);
cell(HALL, 0);
cell(HELD_INN, LOC.held);
rec(idOf(TUNDRA), { type: 'WRLD', editorId: 'Tamriel', fields: [] });

const BED = 'b001:Skyrim.esm';
rec(idOf(BED), { type: 'FURN', editorId: 'CommonBedDouble01', fields: [] });

const HULDA = { a: 0xff000101, pid: 101, name: 'Hulda' };   // holds the Bee and Barb
const CAROL = { a: 0xff000404, pid: 404, name: 'Carol' };   // carries its key
const EVE = { a: 0xff000606, pid: 606, name: 'Eve' };       // a stranger, new in town
const PEOPLE = [HULDA, CAROL, EVE];

const INN_BED = 0x00a00001, TEMPLE_BED = 0x00a00002, HONEY_BED = 0x00a00003, HALL_BED = 0x00a00004;
const HELD_BED = 0x00a00005, ROAD_BED = 0x00a00006, BROKEN_BED = 0x00a00007;

const KEY_DESC = (/var KEY = '([^']+:Thornswood-Content\.esp)';/.exec(propBlock) || [])[1];
yes('the key record is read out of the property block', !!KEY_DESC);

function world() {
  const refs = {};
  function put(id, cellDesc) { refs[id] = { baseDesc: BED, worldOrCellDesc: cellDesc, pos: [0, 0, 0] }; }
  put(INN_BED, INN); put(TEMPLE_BED, TEMPLE); put(HONEY_BED, HONEYSIDE); put(HALL_BED, HALL);
  put(HELD_BED, HELD_INN); put(ROAD_BED, TUNDRA); put(BROKEN_BED, BROKEN);
  PEOPLE.forEach(function (p) {
    const entries = [];
    if (p === CAROL) { entries.push({ baseId: idOf(KEY_DESC), count: 1, name: 'Key to The Bee and Barb, Riften' }); }
    refs[p.a] = { profileId: p.pid, appearance: { name: p.name }, worldOrCellDesc: TUNDRA,
                  pos: [90000, 90000, 0], inventory: { entries: entries } };
  });
  return refs;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-2246-rest-'));
fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
fs.mkdirSync(path.join(dir, 'private'));
fs.writeFileSync(path.join(dir, 'private', 'property.json'), JSON.stringify({ claims: {
  [HELD_INN]: { by: HULDA.pid, name: 'Hulda', at: clock.t, touched: clock.t }
} }));

let refs = world();
let online = PEOPLE.map(function (p) { return p.a; });
const logged = [];

function needsRig() {
  const store = {};
  const g = {};
  const fake = {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return online.slice(); }
      if (key === 'worldOrCellDesc') { return refs[id] ? refs[id].worldOrCellDesc : ''; }
      if (key === 'thornswoodNeeds') { return store[id] ? JSON.parse(JSON.stringify(store[id])) : undefined; }
      return refs[id] ? refs[id][key] : undefined;
    },
    set: function (id, key, v) { if (key === 'thornswoodNeeds') { store[id] = JSON.parse(JSON.stringify(v)); } }
  };
  const fn = new Function('globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
    'guard', 'notify', 'say', 'idOf', needsBlock + '\nreturn globalThis.__thornswoodNeeds;');
  const timers = [];
  const api = fn(g, fake, FakeDate, { log: function () { } },
                 function (f, ms) { timers.push({ f: f, ms: ms }); return timers.length; }, function () { },
                 function (n, f) { return f; }, function () { }, function () { }, idOf);
  api.store = store;
  api.tick = (timers.filter(function (t) { return t.ms === 20000; })[0] || {}).f;
  return api;
}

function boot(needs) {
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
    lookupEspmRecordById: function (id) {
      asked.push(id);
      if (id === idOf(BROKEN)) { throw new Error('the engine could not read it'); }
      return RECORDS[id] || null;
    }
  };
  const box = {
    console: { log: function () { logged.push([].slice.call(arguments).join(' ')); } },
    require: require, mp: mp, Date: FakeDate,
    BUILDING_BY_DOOR: BUILDING_BY_DOOR, BUILDING_NAME: BUILDING_NAME, WAY_OUT: {},
    idOf: idOf, notify: function () { }, say: function () { },
    guard: function (n, f) { return f; },
    setInterval: function () { return 0; }, clearInterval: function () { },
    log: function () { },
    __thornswoodNeeds: needs,
    __thornswoodCharacter: { stateOf: function () { return { v: 1 }; }, writeState: function () { } }
  };
  box.globalThis = box;
  const was = process.cwd();
  process.chdir(dir);
  try { vm.runInNewContext(propBlock, box, { filename: 'gamemode.js property' }); }
  finally { process.chdir(was); }
  return box;
}
function inDir(f) {
  const was = process.cwd();
  process.chdir(dir);
  try { return f(); } finally { process.chdir(was); }
}

const needs = needsRig();
const box = inDir(function () { return boot(needs); });
const beds = box.__thornswoodBeds;
yes('the property block publishes the beds and their reading of a room',
    !!beds && typeof beds.placeOf === 'function' && typeof beds.verdict === 'function');
if (!beds || !beds.placeOf) { done(); }

// ================================================= P. what a room is
{
  yes('P1 a room whose location carries LocTypeInn is an inn', beds.placeOf(INN) === 'inn');
  yes('P1 a room whose location carries LocTypeTemple is a temple', beds.placeOf(TEMPLE) === 'temple');
  yes('P2 a house sold as a home is not an inn, even with LocTypeInn on it (Honeyside)', beds.placeOf(HONEYSIDE) === '');
  yes('P2 a room with no location is neither', beds.placeOf(HALL) === '');
  yes('P2 a worldspace is neither', beds.placeOf(TUNDRA) === '');
  yes('P3 a room the engine cannot read is the road, not a refusal and not a throw', beds.placeOf(BROKEN) === '');
  yes('P3 and nothing at all is nothing', beds.placeOf('') === '');
  const before = asked.length;
  beds.placeOf(INN); beds.placeOf(TEMPLE); beds.placeOf(HONEYSIDE); beds.placeOf(BROKEN);
  yes('P4 each room is read once and kept: asking again reads no record', asked.length === before);
  yes('P5 the server log names each inn and temple it found, once',
      logged.filter(function (l) { return /rest place: 1605e:Skyrim\.esm is an inn/.test(l); }).length === 1 &&
      logged.filter(function (l) { return /rest place: 165a7:Skyrim\.esm is a temple/.test(l); }).length === 1);
}

// ================================================ V. what a bed is worth
function fireAt(p, away) { needs.place(p.a, '', '-', '0', '1', '0', away === null ? '-' : String(away)); }
function verdict(p, ref) { return inDir(function () { return beds.verdict(p.a, p.pid, ref); }); }
{
  fireAt(EVE, null);
  yes('V1 a bed in an inn nobody holds is the common kind', verdict(EVE, INN_BED).kind === 'common' &&
      verdict(EVE, INN_BED).place === 'inn');
  yes('V1 and so is a temple\'s', verdict(EVE, TEMPLE_BED).kind === 'common' && verdict(EVE, TEMPLE_BED).place === 'temple');
  fireAt(EVE, 120);
  yes('V2 with a fire in reach it is commonfire', verdict(EVE, INN_BED).kind === 'commonfire');
  fireAt(EVE, null);
  yes('V3 a house sold as a home, nobody holding it, is still the road: rough', verdict(EVE, HONEY_BED).kind === 'rough');
  yes('V3 so is a room nobody knows and a bed out of doors',
      verdict(EVE, HALL_BED).kind === 'rough' && verdict(EVE, ROAD_BED).kind === 'rough');
  fireAt(EVE, 120);
  yes('V3 and by a fire, camp', verdict(EVE, ROAD_BED).kind === 'camp');
  fireAt(EVE, null);
  yes('V4 a held inn is its holder\'s, as before: her own bed', verdict(HULDA, HELD_BED).kind === 'bed');
  yes('V4 a bed you are allowed in, by her key', verdict(CAROL, HELD_BED).kind === 'inn');
  const no = verdict(EVE, HELD_BED);
  yes('V4 and nobody else\'s, whatever the room is', no.kind === '' && /have not let you sleep there/.test(no.line));
  yes('V5 the beds count the two new kinds as rest, so getting up gets them off it',
      /common: true, commonfire: true/.test(propBlock));
}

// ================================== N. the numbers, Patrick's of 12 Oct 2026
const N = needs.NEEDS;
{
  yes('N1 resting awake in an inn or temple bed nobody holds is 40 an hour, 45 by a fire',
      N.recover.common === 40 && N.recover.commonfire === 45);
  yes('N1 above a bedroll on the road, under a bed you are allowed in and your own',
      N.recover.rough < N.recover.common && N.recover.common < N.recover.inn && N.recover.inn < N.recover.bed &&
      N.recover.commonfire <= N.recover.inn);
  const kinds = Object.keys(N.recover).concat(['up']);
  const rows = kinds.filter(function (k) {
    const r = N.away[k];
    return r && typeof r.drain === 'number' && typeof r.floor === 'number' && typeof r.rest === 'number' &&
           typeof r.food === 'number' && typeof r.drink === 'number';
  });
  yes('N2 NEEDS.away has a row for every kind of rest and for somebody on their feet (' + rows.length + ' of ' + kinds.length + ')',
      rows.length === kinds.length);
  const INDOORS = ['bed', 'inn', 'common', 'commonfire'];
  const ELSEWHERE = ['camp', 'rough', 'campfire', 'sit', 'up'];
  yes('N3 nothing drains while away in a bed indoors: your own, one you are allowed in, an inn or temple bed',
      INDOORS.every(function (k) { return N.away[k].drain === 0 && N.away[k].floor === 0; }));
  yes('N3 anywhere else the time away costs half the clock and takes no meter below 25',
      ELSEWHERE.every(function (k) { return N.away[k].drain === 0.5 && N.away[k].floor === 25; }));
  yes('N3 a night in your own bed or one you are allowed in: rest to 100 and 25 on hunger and thirst, as before',
      ['bed', 'inn'].every(function (k) { return N.away[k].rest === 100 && N.away[k].food === 25 && N.away[k].drink === 25; }));
  yes('N3 a night in an inn or temple bed nobody holds: rest to 100 and 15 on hunger and thirst',
      ['common', 'commonfire'].every(function (k) { return N.away[k].rest === 100 && N.away[k].food === 15 && N.away[k].drink === 15; }));
  yes('N3 a night on a bedroll or a bed on the road: rest at least 50, nothing on hunger or thirst',
      ['camp', 'rough'].every(function (k) { return N.away[k].rest === 50 && N.away[k].food === 0 && N.away[k].drink === 0; }));
  yes('N3 a seat or your feet: nothing',
      ['campfire', 'sit', 'up'].every(function (k) { return N.away[k].rest === 0 && N.away[k].food === 0 && N.away[k].drink === 0; }));
  yes('N6 the clock stays as Patrick set it on 23 Sep: 2.5 times the old shape',
      near(N.drain.food, 2.5 * 100 / 6) && near(N.drain.drink, 2.5 * 100 / 3) && near(N.drain.rest, 2.5 * 100 / 20));
  yes('N4 a night away is still 24 real minutes', N.sleptFor === 24 * MIN);
  yes('N5 the old three numbers are gone, so nothing reads two tables',
      !('sleptIn' in N) && !('sleptRest' in N) && !('sleptAlso' in N));
}

// ====================================== L. a logout, through the hooks
const ME = 0xff000909;
function logout(kind, awayMs) {
  delete needs.store[ME];
  refs[ME] = { worldOrCellDesc: INN, pos: [0, 0, 0] };
  if (online.indexOf(ME) === -1) { online.push(ME); }
  needs.settle(ME);                       // arrives fresh
  clock.t += 2 * HOUR;
  needs.settle(ME);
  if (kind) { needs.resting(ME, kind); }
  const was = needs.read(ME);
  online = online.filter(function (a) { return a !== ME; });
  needs.tick();                           // the block sees them gone
  clock.t += awayMs;
  online.push(ME);
  const n = needs.settle(ME);             // the arrival
  return { was: was, n: n };
}
function near(a, b) { return Math.abs(a - b) < 1e-9; }
{
  const common = logout('common', 9 * HOUR);
  const rough = logout('rough', 9 * HOUR);
  yes('L1 a night logged out in an inn bed nobody holds gives more back than one on the road',
      common.n.food > rough.n.food && common.n.drink > rough.n.drink && common.n.rest > rough.n.rest);
  yes('L1 the inn bed: nothing drained, then rest 100 and 15 on hunger and thirst (' +
      [common.n.food, common.n.drink, common.n.rest].map(function (v) { return v.toFixed(1); }).join(', ') + ')',
      near(common.n.food, Math.min(100, common.was.food + 15)) && near(common.n.drink, Math.min(100, common.was.drink + 15)) &&
      common.n.rest === 100 && common.n.resting === '');
  const bed = logout('bed', 9 * HOUR);
  yes('L1 and your own bed: nothing drained, rest 100, 25 on hunger and thirst',
      bed.n.rest === 100 && near(bed.n.food, Math.min(100, bed.was.food + 25)) && near(bed.n.drink, Math.min(100, bed.was.drink + 25)));

  // The hooks move with the table and nothing else: Patrick's numbers are a
  // change of numbers. A made-up row, put back afterwards.
  const keep = JSON.parse(JSON.stringify(N.away.common));
  N.away.common = { drain: 0.5, rest: 95, food: 10, drink: 10 };
  const half = logout('common', 1 * HOUR);
  const d = N.drain;
  yes('H1 a drain of a half costs half the clock while away (' + half.n.food.toFixed(2) + ', ' + half.n.drink.toFixed(2) + ')',
      near(half.n.food, Math.min(100, Math.max(0, half.was.food - d.food * 0.5) + 10)) &&
      near(half.n.drink, Math.min(100, Math.max(0, half.was.drink - d.drink * 0.5) + 10)));
  yes('H1 rest is at least the row\'s 95 after the night, and they are up', half.n.rest === 95 && half.n.resting === '');
  N.away.common = { drain: 0, floor: 0, rest: 0, food: 0, drink: 0 };
  const none = logout('common', 9 * HOUR);
  yes('H2 a drain of 0 leaves the meters as they were left, and gives nothing on top',
      near(none.n.food, none.was.food) && near(none.n.drink, none.was.drink) && near(none.n.rest, none.was.rest) &&
      none.n.resting === 'common');
  // A floor: 9 hours away would empty all three; with a floor of 25 none
  // goes under it, and a meter already under it at logout stays put. After
  // 2 hours awake, rest is above it and hunger and thirst are under it.
  N.away.common = { drain: 1, floor: 25, rest: 0, food: 0, drink: 0 };
  const floored = logout('common', 9 * HOUR);
  const expect = function (was) { return was > 25 ? 25 : was; };
  yes('H5 a floor of 25: rest stops at 25, hunger and thirst already under it stay where they were (' +
      ['food', 'drink', 'rest'].map(function (k) { return k + ' ' + floored.was[k].toFixed(1) + ' to ' + floored.n[k].toFixed(1); }).join(', ') + ')',
      floored.was.rest > 25 && floored.was.food < 25 &&
      ['food', 'drink', 'rest'].every(function (k) { return near(floored.n[k], expect(floored.was[k])); }));
  N.away.common = keep;
  const short = logout('bed', N.sleptFor - MIN);
  yes('H3 away less than the night is no night: the drain only, no fill', short.n.rest < 100 && short.n.resting === 'bed');

  // Awake: the recover table is the rate, for the new kinds as for the old.
  delete needs.store[ME];
  needs.settle(ME);
  clock.t += 4 * HOUR;
  needs.settle(ME);
  needs.resting(ME, 'common');
  const r0 = needs.settle(ME).rest;
  clock.t += 30 * MIN;
  const r1 = needs.settle(ME).rest;
  yes('H4 resting awake in a common bed gains its recover rate less the drain, per hour',
      near(r1 - r0, (N.recover.common - N.drain.rest) * 0.5));
}

// ============ F. a new character's first hour and first night, in each place
//
// The walk on #2246, through the real beds: a new character arrives full,
// eats and drinks nothing for their first hour, lies down where the beds
// say (the kind is the beds' verdict on that bed for that person, never a
// word typed), logs out, and comes back after an 8 hour night. Before
// Patrick's numbers every one of these but the two beds came back at 0, 0, 0.
const NEW = 0xff000a0a;
function firstHour() {
  delete needs.store[NEW];
  refs[NEW] = { worldOrCellDesc: INN, pos: [0, 0, 0] };
  if (online.indexOf(NEW) === -1) { online.push(NEW); }
  needs.settle(NEW);                       // arrives fresh, in an inn
  clock.t += HOUR;
  return needs.settle(NEW);
}
function nightIn(kind, awayMs) {
  firstHour();
  if (kind) { needs.resting(NEW, kind); }
  const was = needs.read(NEW);
  online = online.filter(function (a) { return a !== NEW; });
  needs.tick();
  clock.t += awayMs;
  online.push(NEW);
  return { was: was, n: needs.settle(NEW) };
}
function r1(v) { return Math.round(v * 10) / 10; }
{
  const h = firstHour();
  yes('F1 the first hour awake with nothing eaten is the clock alone: Hunger 58.3, Thirst 16.7, Rest 87.5 (' +
      [h.food, h.drink, h.rest].map(r1).join(', ') + ')',
      r1(h.food) === 58.3 && r1(h.drink) === 16.7 && r1(h.rest) === 87.5);

  // The kinds, as the beds hand them out.
  fireAt(EVE, null);
  const innKind = verdict(EVE, INN_BED).kind, templeKind = verdict(EVE, TEMPLE_BED).kind;
  const roadKind = verdict(EVE, ROAD_BED).kind;
  fireAt(EVE, 120);
  const innFireKind = verdict(EVE, INN_BED).kind, campKind = verdict(EVE, ROAD_BED).kind;
  fireAt(EVE, null);
  const ownKind = verdict(HULDA, HELD_BED).kind, keyKind = verdict(CAROL, HELD_BED).kind;
  yes('F2 the beds hand out the kinds the walk uses',
      innKind === 'common' && templeKind === 'common' && innFireKind === 'commonfire' && roadKind === 'rough' &&
      campKind === 'camp' && ownKind === 'bed' && keyKind === 'inn');

  const NIGHT = 8 * HOUR;
  const walk = [
    ['in your own bed', ownKind, 83.3, 41.7, 100],
    ['in a bed you are allowed in, by its key', keyKind, 83.3, 41.7, 100],
    ['in the arrival inn\'s bed, nobody holding it', innKind, 73.3, 31.7, 100],
    ['in a temple bed nobody holds', templeKind, 73.3, 31.7, 100],
    ['in the inn bed by its fire', innFireKind, 73.3, 31.7, 100],
    // Hunger falls half the clock to the floor; thirst was already under 25
    // and stays; rest falls to 37.5 and the night lifts it to 50.
    ['in a bed on the road', roadKind, 25, 16.7, 50],
    ['on a bedroll by a campfire', campKind, 25, 16.7, 50],
    ['on a seat', 'sit', 25, 16.7, 37.5],
    ['on a seat by a fire', 'campfire', 25, 16.7, 37.5],
    ['on their feet', '', 25, 16.7, 37.5]
  ];
  walk.forEach(function (w) {
    const t = nightIn(w[1], NIGHT);
    const got = [t.n.food, t.n.drink, t.n.rest].map(r1);
    yes('F3 a night away ' + w[0] + ' comes back at Hunger ' + w[2] + ', Thirst ' + w[3] + ', Rest ' + w[4] +
        ' (' + got.join(', ') + ')',
        got[0] === w[2] && got[1] === w[3] && got[2] === w[4]);
  });

  // Nobody comes back spent from being away: every place leaves every
  // meter at or above where the first hour left it, or at 25.
  const spent = walk.filter(function (w) {
    const t = nightIn(w[1], 48 * HOUR);
    return t.n.food < Math.min(25, t.was.food) - 1e-9 || t.n.drink < Math.min(25, t.was.drink) - 1e-9 ||
           t.n.rest < Math.min(25, t.was.rest) - 1e-9;
  });
  yes('F4 two days away anywhere, no meter the first hour left above 25 comes back under it (' +
      spent.map(function (w) { return w[0]; }).join(', ') + ')', spent.length === 0);

  // Resting awake, the first hour spent lying down instead: the recover
  // table, less the clock's rest drain.
  const awake = [['common', 40], ['commonfire', 45], ['rough', 25], ['inn', 50], ['bed', 80]];
  awake.forEach(function (a) {
    delete needs.store[NEW];
    needs.settle(NEW);
    needs.store[NEW].rest = 20;
    needs.resting(NEW, a[0]);
    const r0 = needs.settle(NEW).rest;
    clock.t += HOUR;
    const r1v = needs.settle(NEW).rest;
    yes('F5 an hour awake in ' + a[0] + ' gains ' + a[1] + ' less the clock\'s ' + N.drain.rest + ' (' +
        (r1v - r0).toFixed(2) + ')', near(r1v - r0, a[1] - N.drain.rest));
  });
}

// ================================================ W. the words for them
{
  const skills = read('game', 'ui', 'thornswood-skills.js');
  const page = /var REST_WORDS = (\{[\s\S]*?\});/.exec(skills);
  let words = null;
  try { words = new Function('return ' + page[1])(); } catch (e) { words = null; }
  yes('W1 the Body page on K names both new kinds in words, not as a code',
      !!words && /inn or temple/.test(words.common || '') && /inn or temple/.test(words.commonfire || '') &&
      /fire/.test(words.commonfire || ''));
  const restSaid = /var REST_SAID = (\{[\s\S]*?\});/.exec(needsBlock);
  let said = null;
  try { said = new Function('return ' + restSaid[1])(); } catch (e) { said = null; }
  yes('W1 and /needs says them the same way', !!said && said.common === words.common && said.commonfire === words.commonfire);
  const ex = read('docs', 'systems', 'exhaustion.md');
  yes('W2 exhaustion.md says an inn or temple bed nobody holds is its own place, at 40, and why (#2246)',
      /inn or a temple nobody holds/.test(ex) && /#2246/.test(ex) && /\| An inn or temple bed nobody holds \| 40 \|/.test(ex));
  yes('W2 and has the logout table, by place',
      /\| Where you logged out \|/.test(ex) && /half/.test(ex) && /never under 25|below 25/.test(ex));
  const prop = read('docs', 'systems', 'property.md');
  yes('W2 property.md no longer says the inn or temple numbers wait on Patrick',
      !/until Patrick sets its own on #2246/.test(prop) && /inn\s+or\s+a\s+temple/.test(prop));

  // The Body page says what logging out where you are would do, in the
  // server's words, worked out from the same NEEDS.away row.
  yes('W3 the Body page shows the server\'s words for a logout under Rest',
      /v\.away \? ' ' \+ String\(v\.away\)/.test(skills));
  yes('W3 an inn or temple bed: nothing runs down, and a night gives full rest and 15 back',
      needs.awayWords('common') === 'Log out now and nothing runs down while you are away. ' +
      'Away 24 minutes or more and rest is full and 15 goes back on hunger and thirst when you come back.');
  yes('W3 a bed on the road: half the pace, never below 25, and rest at least 50 after a night',
      needs.awayWords('rough') === 'Log out now and hunger, thirst and rest fall at half the pace while you are away, ' +
      'and the time away takes none of them below 25. Away 24 minutes or more and rest is at least 50 when you come back.');
  yes('W3 on your feet: half the pace, never below 25, and nothing more',
      needs.awayWords('') === 'Log out now and hunger, thirst and rest fall at half the pace while you are away, ' +
      'and the time away takes none of them below 25.');
  delete needs.store[NEW];
  needs.settle(NEW);
  needs.resting(NEW, 'common');
  yes('W3 and the view the K panel reads carries them', needs.view(NEW).away === needs.awayWords('common'));
  const help = read('game', 'ui', 'thornswood-help.js');
  yes('W4 the help panel\'s Living page says where to log out (#2246)',
      /inn or temple bed/.test(help) && /log out/i.test(help) && /half/.test(help));
}

done();
