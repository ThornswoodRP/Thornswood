'use strict';
/*
  test-502-jail-rules.js

  #502. Patrick, 12 October: jails can be claimed by the Jarl only, and the
  rest of the jail rules as written on the issue: no timer, release by that
  hold's guards, lockpicking allowed, the game's jail keys open nothing,
  /stuck does not move someone out of a locked cell, dying in a cell wakes
  at a temple.

  The real property block runs over a pretend engine with the real door,
  building and jail tables, a Jarl of Whiterun, a Jarl of Riften, a guard of
  Whiterun and a prisoner, each office by its Discord role since #2551 (the
  door hands the block the roles as __thornswoodOffices). The real spoils block, the real stuck block and
  the real respawn resolver run beside it. It checks:
    - the tables: each hold's jail building and the keys the game made for
      the cells, and game/data/jails.json saying the same;
    - the claim: only the Jarl of the jail's hold is offered it, may make it,
      or takes it by presenting its deed; a house anywhere is as it was;
    - the keys: none lies on the floor (#3077) and a press on one is not
      refused, one in a chest is taken out with the swords, any other key is
      untouched;
    - /stuck: refused in a jail where a guard has a cell locked, for anybody
      but that hold's guards, and nowhere else;
    - a death in any of the ten jails wakes on consecrated ground outside it;
    - no timer: nothing in the cells' code unlocks by itself.
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
const spoilsBlock = slice(gm, '// ==== thornswood spoils ====', '// ==== end thornswood spoils ====');
const stuckBlock = slice(gm, '// ==== thornswood stuck ====', '// ==== end thornswood stuck ====');
yes('the property, spoils and stuck blocks are in the gamemode', !!propBlock && !!spoilsBlock && !!stuckBlock);
if (!propBlock || !spoilsBlock || !stuckBlock) { done(); }

// ------------------------------------------------------------ the tables
const BUILDING_BY_DOOR = table('const', 'BUILDING_BY_DOOR');
const BUILDING_NAME = table('const', 'BUILDING_NAME');
const WAY_OUT = table('const', 'WAY_OUT');
const JAIL_DOOR = table('  var', 'JAIL_DOOR');
const JAIL_NAME = table('  var', 'JAIL_NAME');
const JAIL_BUILDING = table('  var', 'JAIL_BUILDING');
const JAIL_KEY = table('  var', 'JAIL_KEY');
const DATA = table('const', 'DATA');
yes('the jail building and jail key tables are in the generated block', !!JAIL_BUILDING && !!JAIL_KEY && !!DATA);
if (!JAIL_BUILDING || !JAIL_KEY || !JAIL_DOOR || !BUILDING_BY_DOOR) { done(); }
const HOLDS10 = ['whiterun', 'solitude', 'riften', 'markarth', 'windhelm',
                 'falkreath', 'morthal', 'dawnstar', 'winterhold', 'ravenrock'];
const byHold = {};
Object.keys(JAIL_BUILDING).forEach(function (b) { byHold[JAIL_BUILDING[b]] = b; });
yes('T1 each of the ten holds has one jail building', Object.keys(JAIL_BUILDING).length === 10 &&
    HOLDS10.every(function (h) { return !!byHold[h]; }));
yes('T2 each is the building its cells stand in, under the jail\'s own name', HOLDS10.every(function (h) {
  return BUILDING_NAME[byHold[h]] === JAIL_NAME[h] && Object.keys(JAIL_DOOR).every(function (d) {
    return JAIL_DOOR[d] !== h || BUILDING_BY_DOOR[d] === byHold[h];
  });
}));
let jails = null;
try { jails = JSON.parse(read(path.join(REPO_DIR, 'game', 'data', 'jails.json'))); } catch (e) { jails = null; }
const keysJson = {};
const cellsJson = {};
if (jails && jails.jails) {
  Object.keys(jails.jails).forEach(function (h) {
    cellsJson[jails.jails[h].cell] = h;
    const ds = jails.jails[h].doors || {};
    Object.keys(ds).forEach(function (d) { if (ds[d].lock && ds[d].lock.key) { keysJson[ds[d].lock.key] = h; } });
  });
}
yes('T3 game/data/jails.json names the same buildings', JSON.stringify(Object.keys(cellsJson).sort()) ===
    JSON.stringify(Object.keys(JAIL_BUILDING).sort()) &&
    Object.keys(cellsJson).every(function (c) { return cellsJson[c] === JAIL_BUILDING[c]; }));
yes('T4 and every key a cell door\'s lock names is a jail key, to its hold (' + Object.keys(JAIL_KEY).length + ')',
    Object.keys(keysJson).length > 0 && JSON.stringify(Object.keys(keysJson).sort()) === JSON.stringify(Object.keys(JAIL_KEY).sort()) &&
    Object.keys(keysJson).every(function (k) { return keysJson[k] === JAIL_KEY[k]; }));
yes('T5 Whiterun\'s own jail key is among them', JAIL_KEY['5aec4:Skyrim.esm'] === 'whiterun');

// ============================================================== the server
const clock = { t: Date.UTC(2026, 9, 12, 20, 0, 0) };
class FakeDate extends Date { static now() { return clock.t; } }
const PLUGIN_BASE = { 'skyrim.esm': 0, 'dragonborn.esm': 0x04000000, 'thornswood-content.esp': 0x05000000 };
function idOf(desc) {
  const m = /^([0-9a-f]+):(.+)$/i.exec(String(desc || ''));
  if (!m || !Object.prototype.hasOwnProperty.call(PLUGIN_BASE, m[2].toLowerCase())) { return 0; }
  return parseInt(m[1], 16) + PLUGIN_BASE[m[2].toLowerCase()];
}
function descOf(id) {
  if (id >= 0x05000000 && id < 0x06000000) { return (id - 0x05000000).toString(16) + ':Thornswood-Content.esp'; }
  if (id >= 0x04000000 && id < 0x05000000) { return (id - 0x04000000).toString(16) + ':Dragonborn.esm'; }
  return id.toString(16) + ':Skyrim.esm';
}

const JAIL = byHold.whiterun;                       // Dragonsreach Dungeon
const FRONT = Object.keys(BUILDING_BY_DOOR).filter(function (d) {
  return BUILDING_BY_DOOR[d] === JAIL && !JAIL_DOOR[d];
})[0];                                              // a door into it that is not a cell
const CELL = Object.keys(JAIL_DOOR).filter(function (d) { return JAIL_DOOR[d] === 'whiterun'; })[0];
const HOUSE = 'house';
const HOUSE_DOOR = Object.keys(BUILDING_BY_DOOR).filter(function (d) {
  return !JAIL_BUILDING[BUILDING_BY_DOOR[d]] && !JAIL_DOOR[d] && !WAY_OUT[d];
})[0];
yes('the test has a door into Dragonsreach Dungeon that is not a cell, a cell, and a house door',
    !!FRONT && !!CELL && !!HOUSE_DOOR);

const JARL_W = { a: 0xff000501, pid: 501, name: 'Balgruuf', hold: 'whiterun' };
const JARL_R = { a: 0xff000502, pid: 502, name: 'Laila', hold: 'riften' };
const GUARD_W = { a: 0xff000503, pid: 503, name: 'Hrongar' };
const PRISONER = { a: 0xff000504, pid: 504, name: 'Lucan' };
const PEOPLE = [JARL_W, JARL_R, GUARD_W, PRISONER];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-502-rules-'));
fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
fs.mkdirSync(path.join(dir, 'private'));
// An office is one character's (#2551, Patrick, 16 Oct): the law register
// names the character that holds each office for its account. A profile the
// door ties to no account is an account of its own, 'p:<profile>'.
fs.writeFileSync(path.join(dir, 'private', 'law.json'), JSON.stringify({ cells: {}, held: { 'jarl:whiterun': { 'p:501': { pid: 501, name: 'Balgruuf' } }, 'jarl:riften': { 'p:502': { pid: 502, name: 'Laila' } }, 'guard:whiterun': { 'p:503': { pid: 503, name: 'Hrongar' } } } }));
// The offices are Discord roles (#2551): Balgruuf holds the Jarl of Whiterun
// role, Laila the Jarl of Riften, Hrongar the Guard of Whiterun.
const ROLES = {
  501: { jarl: ['whiterun'], court: [], steward: [], guard: [] },
  502: { jarl: ['riften'], court: [], steward: [], guard: [] },
  503: { jarl: [], court: [], steward: [], guard: ['whiterun'] }
};
function officesOf(pid) {
  const o = ROLES[pid];
  return o ? JSON.parse(JSON.stringify(o)) : { jarl: [], court: [], steward: [], guard: [] };
}
function inDir(f) {
  const was = process.cwd();
  process.chdir(dir);
  try { return f(); } finally { process.chdir(was); }
}

const refs = {};
PEOPLE.forEach(function (p) {
  refs[p.a] = { profileId: p.pid, appearance: { name: p.name }, worldOrCellDesc: JAIL,
                pos: [100, 100, 0], angle: [0, 0, 0], inventory: { entries: [] } };
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
  lookupEspmRecordById: function (id) {
    const kind = kinds[id];
    return kind ? { record: { type: kind } } : null;
  },
  getNeighborsByPosition: function () { return []; },
  getServerSettings: function () { return { privDir: 'private', thornswoodServer: 'dev' }; }
};
const kinds = {};
const states = {};
const said = [];
const box = {
  console: { log: function () { logged.push(Array.prototype.join.call(arguments, ' ')); } },
  require: require, mp: mp, Date: FakeDate,
  BUILDING_BY_DOOR: Object.assign({}, BUILDING_BY_DOOR, { [HOUSE_DOOR]: HOUSE }),
  BUILDING_NAME: Object.assign({}, BUILDING_NAME, { [HOUSE]: 'Breezehome' }), WAY_OUT: WAY_OUT,
  BENCH_BY_BASE: {}, idOf: idOf,
  notify: function () { }, say: function (a, m) { said.push([a, m]); },
  guard: function (n, f) { return f; },
  setInterval: function () { return 1; }, clearInterval: function () { },
  setTimeout: function () { return 0; },
  log: function () { logged.push(Array.prototype.join.call(arguments, ' ')); },
  __thornswoodOffices: officesOf,
  __thornswoodOfficesOnRecord: officesOf,
  __thornswoodCharacter: {
    stateOf: function (aid) { return states[aid] || { prof: 'cook' }; },
    writeState: function () { }
  }
};
box.globalThis = box;
inDir(function () { vm.runInNewContext(propBlock, box, { filename: 'gamemode.js property' }); });
const W = box.__thornswoodProperty;
yes('the property block runs and publishes the jail rules', !!W && typeof W.mayHold === 'function' &&
    typeof W.lockedJailHere === 'function' && typeof W.jailKeyHold === 'function' && !!W.JAIL_KEY);
if (!W) { done(); }

function open(p, door) { inDir(function () { W.touched(p.a, door); }); }
function lineOf(p) { return refs[p.a].thornswoodDoorLine || null; }
function word(p, w, args) {
  const by = {};
  let handled = null;
  inDir(function () {
    handled = W.command(w, [w].concat(args || []), p.a, p.pid, function (pid, m) { (by[pid] = by[pid] || []).push(m); });
  });
  return { handled: handled, mine: (by[p.pid] || []).join(' ') };
}
function claimOf(b) { return W.claims()[b] || null; }

// ---------------------------------------------------------- C. the claim
yes('C1 Dragonsreach Dungeon is Whiterun\'s jail, and a house is no jail',
    W.jailOfBuilding(JAIL) === 'whiterun' && W.jailOfBuilding(HOUSE) === null);
open(PRISONER, FRONT);
let ln = lineOf(PRISONER);
yes('C2 at the jail\'s door somebody who is not its Jarl is offered no claim', !!ln && ln.x === '');
let r = word(PRISONER, '/claim');
yes('C3 and a claim that comes anyway is refused, and says whose it is: "' + r.mine + '"',
    !claimOf(JAIL) && r.mine === 'Dragonsreach Dungeon is Whiterun\'s jail. Only the Jarl of Whiterun claims it.');
open(JARL_R, FRONT);
r = word(JARL_R, '/claim');
yes('C4 so is the Jarl of another hold: "' + r.mine + '"', !claimOf(JAIL) && lineOf(JARL_R).x === '' &&
    /Only the Jarl of Whiterun claims it/.test(r.mine));
open(GUARD_W, FRONT);
r = word(GUARD_W, '/claim');
yes('C5 and a guard of the hold', !claimOf(JAIL) && lineOf(GUARD_W).x === '');
open(JARL_W, FRONT);
ln = lineOf(JARL_W);
yes('C6 the Jarl of Whiterun is offered it', !!ln && ln.x === 'claim');
r = word(JARL_W, '/claim');
yes('C7 and claims it, and gets its deed: "' + r.mine.slice(0, 60) + '"',
    !!claimOf(JAIL) && claimOf(JAIL).by === JARL_W.pid && /^You claim Dragonsreach Dungeon\./.test(r.mine));
// The deed passes to somebody else's pack and is presented at the door.
const deed = refs[JARL_W.a].inventory.entries.filter(function (e) { return e.name === 'Deed to Dragonsreach Dungeon, Whiterun'; })[0];
yes('C8 the deed is in the Jarl\'s pack', !!deed);
if (deed) {
  refs[PRISONER.a].inventory.entries.push(JSON.parse(JSON.stringify(deed)));
  refs[JARL_R.a].inventory.entries.push(JSON.parse(JSON.stringify(deed)));
}
open(PRISONER, FRONT);
open(JARL_R, FRONT);
yes('C9 the jail\'s deed presented at its door by anybody but its Jarl claims nothing',
    claimOf(JAIL).by === JARL_W.pid && !logged.some(function (l) { return /presented the deed at Dragonsreach/.test(l); }));
// A house is the same as ever: anybody claims it.
open(PRISONER, HOUSE_DOOR);
r = word(PRISONER, '/claim');
yes('C10 a house is claimed by anybody, as before', !!claimOf(HOUSE) && claimOf(HOUSE).by === PRISONER.pid);

// ------------------------------------- F. every office, read in one place
const ow = W.officeOf(JARL_W.pid), og = W.officeOf(GUARD_W.pid), op = W.officeOf(PRISONER.pid);
yes('F1 officeOf says the Jarl of Whiterun is a Jarl of Whiterun and keeps it as its steward, and no guard',
    ow.jarl === true && ow.jarlOf.join() === 'whiterun' && ow.steward === true && ow.stewardOf.join() === 'whiterun' &&
    ow.guardOf.length === 0);
yes('F2 a guard of Whiterun is that and nothing else; somebody with no office has none',
    og.jarl === false && og.jarlOf.length === 0 && og.steward === false && og.guardOf.join() === 'whiterun' &&
    !op.jarl && !op.jarlOf.length && !op.steward && !op.guardOf.length && !op.courtOf.length);
const outside = gm.replace(propBlock, '');
yes('F3 no block outside the property block reads the law register or the Jarl\'s hold itself',
    !/law\.guards|officeHold|law\.json/.test(outside));

// ----------------------------------------- R. no timer, release by its guards
const law = slice(propBlock, '  function lockCell(', '\n  }\n') || '';
yes('R1 nothing in the cell lock runs on a clock: no timer and no release by itself',
    !/setTimeout|setInterval/.test(law) && !/setTimeout|setInterval/.test(slice(propBlock, '  function cellLists(', '\n  }\n') || ''));
open(GUARD_W, CELL);
r = word(GUARD_W, '/lock', [(idOf(CELL) >>> 0).toString(16)]);
const lockedNow = W.cellLocked(CELL);
r = word(GUARD_W, '/unlock', [(idOf(CELL) >>> 0).toString(16)]);
yes('R2 a guard of the hold locks and releases (' + r.mine + ')', lockedNow === true && W.cellLocked(CELL) === false);
open(JARL_W, CELL);
r = word(JARL_W, '/lock', [(idOf(CELL) >>> 0).toString(16)]);
yes('R3 the Jarl, who is no guard, does not turn a cell', W.cellLocked(CELL) === false && /A cell is a guard's to lock/.test(r.mine));

// ------------------------------------------------------------- S. /stuck
const told = [];
const stuckMp = {
  get: function (id, key) {
    if (key === 'isDead') { return false; }
    if (key === 'percentages') { return { health: 1 }; }
    return mp.get(id, key);
  },
  set: function (id, key, v) { mp.set(id, key, v); },
  getServerSettings: mp.getServerSettings
};
const fakeFs = { appendFileSync: function () { }, mkdirSync: function () { } };
const sbox = {
  mp: stuckMp, Date: FakeDate, DATA: DATA, console: { log: function () { } },
  require: function (n) { return n === 'fs' ? fakeFs : require(n); },
  log: function () { }, guard: function (n, f) { return f; },
  setInterval: function () { return 1; }, clearInterval: function () { },
  __thornswoodProperty: W,
  __thornswoodToProfile: function (pid, m) { told.push([pid, m]); }
};
sbox.globalThis = sbox;
vm.runInNewContext(stuckBlock, sbox, { filename: 'gamemode.js stuck' });
const stuck = sbox.__thornswoodStuck;
function useStuck(p) {
  told.length = 0;
  delete refs[p.a].locationalData;
  stuck.state.used = {};
  stuck.command(p.pid, p.a, clock.t);
  return { told: told.filter(function (t) { return t[0] === p.pid; }).map(function (t) { return t[1]; }).join(' '),
           moved: !!refs[p.a].locationalData };
}
let s = useStuck(PRISONER);
yes('S1 in a jail with no cell locked by a guard, /stuck works as anywhere (' + s.told.slice(0, 50) + ')', s.moved);
open(GUARD_W, CELL);
word(GUARD_W, '/lock', [(idOf(CELL) >>> 0).toString(16)]);
refs[PRISONER.a].worldOrCellDesc = JAIL;
s = useStuck(PRISONER);
yes('S2 once a guard has a cell locked there, it does not move the prisoner, and says why: "' + s.told + '"',
    !s.moved && /A guard has a cell locked here in Dragonsreach Dungeon, so \/stuck does not move anybody out of the jail/.test(s.told) &&
    /\/helpme reaches staff/.test(s.told));
refs[JARL_R.a].worldOrCellDesc = JAIL;
s = useStuck(JARL_R);
yes('S3 nor anybody else in the jail who is not a guard of the hold', !s.moved);
refs[GUARD_W.a].worldOrCellDesc = JAIL;
s = useStuck(GUARD_W);
yes('S4 a guard of the hold still can', s.moved);
refs[PRISONER.a].worldOrCellDesc = byHold.riften;
s = useStuck(PRISONER);
yes('S5 in another hold\'s jail, where no cell is locked, it works', s.moved);
refs[PRISONER.a].worldOrCellDesc = '3c:Skyrim.esm';
s = useStuck(PRISONER);
yes('S6 outdoors it works as ever', s.moved);

// ---------------------------------------------------------------- K. keys
const KEY_W = idOf('5aec4:Skyrim.esm');   // WhiterunJailKey
const KEY_HOUSE = idOf('1234:Skyrim.esm');
const SWORD = idOf('12eb7:Skyrim.esm');
const CHEST = 0x000a0001;
Object.keys(JAIL_KEY).forEach(function (k) { kinds[idOf(k)] = 'KEYM'; });
kinds[KEY_HOUSE] = 'KEYM';
kinds[SWORD] = 'WEAP';
kinds[0x0000000f] = 'MISC';
kinds[idOf('c2cdb:Skyrim.esm')] = 'CONT';
refs[CHEST] = { inventory: { entries: [{ baseId: KEY_W, count: 1 }, { baseId: SWORD, count: 1 }, { baseId: KEY_HOUSE, count: 1 }] } };
const kbox = {
  mp: mp, idOf: idOf, TOOLS: {}, console: { log: function () { } },
  setTimeout: function () { return 0; }, __thornswoodProperty: W
};
kbox.globalThis = kbox;
vm.runInNewContext(spoilsBlock, kbox, { filename: 'gamemode.js spoils' });
const spoils = kbox.__thornswoodSpoils;
// The world hands no jail key out, so the spoils block keeps no list of them:
// no chest holds one the world put there (#3078) and none lies on the floor
// (#3077). The keys stay in JAIL_KEY for the doors.
yes('K1 the spoils block keeps no jail key list, because nothing in the world hands one out',
    spoils.isJailKey === undefined && !/JAIL_KEY/.test(spoilsBlock) && Object.keys(JAIL_KEY).length > 0);
// No jail key lies where the game put it: Thornswood-Last.esp switches every
// placed item off (#3077), so the block answers no press on a floor key.
yes('K2 a press on a key is never refused by the spoils block, a jail key or any other (#3077)',
    spoils.activate(PRISONER.a, 0x000f1228, '5aec4:Skyrim.esm') === null &&
    spoils.activate(PRISONER.a, 0x000f2000, '1234:Skyrim.esm') === null &&
    !/belonged to the old jail/.test(spoilsBlock));
// #3078: the engine puts nothing of a container's record in it
// (forbiddenBaseContainer), so a jail key in a chest is one a person put
// there, and the press leaves the chest as it is.
spoils.activate(PRISONER.a, CHEST, 'c2cdb:Skyrim.esm');
const left = refs[CHEST].inventory.entries.map(function (e) { return e.baseId; });
yes('K5 a press takes nothing out of a chest, jail key, sword or other key',
    left.length === 3 && left[0] === KEY_W && left[1] === SWORD && left[2] === KEY_HOUSE);
const onAct = slice(gm, '\n  const spoils = globalThis.__thornswoodSpoils;\n  if (spoils && spoils.activate)', '\n  }\n');
yes('K6 onActivate lets the spoils block see a press before anything else answers it',
    !!onAct && /spoils\.activate\(/.test(onAct) && gm.indexOf(onAct) < gm.indexOf('const quests = globalThis.__thornswoodQuests;'));

// ------------------------------------------------------------- D. a death
const arrivalSrc = (function () {
  const a = gm.indexOf('\nfunction dist2(');
  const b = a < 0 ? -1 : gm.indexOf('\nfunction ensureProperties(', a);
  return a < 0 || b < 0 ? null : gm.slice(a, b);
}());
yes('D0 the respawn resolver is sliced out of the gamemode', !!arrivalSrc);
if (arrivalSrc) {
  const resolve = new Function('DATA', 'WORLDSPACES', 'PREFER_SLOT', 'FALLBACK_DESTINATION', 'mp', 'log',
    arrivalSrc + '\nreturn resolveArrival;')(DATA, new Set(DATA.worldspaces), 'temple', 'whiterun', null, function () { });
  const where = [];
  const ok = HOLDS10.every(function (h) {
    const a = resolve({ desc: byHold[h], pos: [0, 0, 0] });
    where.push(h + ' ' + (a && a.cell));
    return !!a && !JAIL_BUILDING[a.desc] && (a.slot === 'temple' || a.slot === 'hallOfTheDead') && a.reason !== 'fallback';
  });
  yes('D1 a death in any of the ten jails wakes in a temple or a hall of the dead, out of the jail (' +
      where.join(', ') + ')', ok);
  const own = HOLDS10.filter(function (h) {
    const a = resolve({ desc: byHold[h], pos: [0, 0, 0] });
    return a && a.reason === 'own-ground' && a.slot === 'temple';
  });
  yes('D2 the six holds with a temple of their own wake there', own.length === 6);
}

// ------------------------- P. claims on a jail made before the rule end, once
/*
  Patrick, 12 October evening: jail claims made before the jail rule end once
  if there are any, and then the rule holds. A fresh server folder holds
  property.json as an older server left it: a claim on Dragonsreach Dungeon by
  somebody who is not Whiterun's Jarl, one on Riften Jail by Riften's Jarl
  (by the Jarl of Riften role, read on record: nobody has sent a pass at a
  server start), and a house. The property block is started on it three times.
*/
function startOn(folder) {
  const out = [];
  const pbox = Object.assign({}, box, {
    console: { log: function () { out.push(Array.prototype.join.call(arguments, ' ')); } },
    log: function () { out.push(Array.prototype.join.call(arguments, ' ')); }
  });
  delete pbox.__thornswoodProperty;
  pbox.globalThis = pbox;
  const was = process.cwd();
  process.chdir(folder);
  try { vm.runInNewContext(propBlock, pbox, { filename: 'gamemode.js property' }); }
  finally { process.chdir(was); }
  return { W: pbox.__thornswoodProperty, logged: out };
}
const old = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-502-rule-once-'));
fs.writeFileSync(path.join(old, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
fs.mkdirSync(path.join(old, 'private'));
fs.writeFileSync(path.join(old, 'private', 'law.json'), JSON.stringify({ cells: {}, held: { 'jarl:riften': { 'p:502': { pid: 502, name: 'Laila' } } } }));
const RIFTEN_JAIL = byHold.riften;
const before = { claims: {
  [JAIL]: { by: 909, name: 'Erik', at: clock.t, touched: clock.t, locked: true },
  [RIFTEN_JAIL]: { by: 502, name: 'Laila', at: clock.t, touched: clock.t, locked: false },
  [HOUSE]: { by: 909, name: 'Erik', at: clock.t, touched: clock.t, locked: false }
}, boxes: { whiterun: 1234 }, funds: { whiterun: 77 } };
fs.writeFileSync(path.join(old, 'private', 'property.json'), JSON.stringify(before));
let run1 = startOn(old);
const reg1 = JSON.parse(fs.readFileSync(path.join(old, 'private', 'property.json'), 'utf8'));
yes('P1 at the first start, the claim on a jail by somebody who is not its hold\'s Jarl ends',
    !!run1.W && !run1.W.claims()[JAIL] && !reg1.claims[JAIL]);
yes('P2 the Jarl\'s claim on their own jail, and a house, are kept',
    !!reg1.claims[RIFTEN_JAIL] && reg1.claims[RIFTEN_JAIL].by === 502 && !!reg1.claims[HOUSE]);
yes('P3 the log names the holder, the profile and the jail, and counts what ended',
    run1.logged.some(function (l) { return /law: the jail rule ends Erik's claim \(profile 909\) on Dragonsreach Dungeon, made before only the Jarl of whiterun could hold it/.test(l); }) &&
    run1.logged.some(function (l) { return /applied to the claims made before it once: 1 claim\(s\) ended/.test(l); }));
// boxes is the steward-marked chest, retired by #2298: a register written
// before then still has it, and it is simply not written again.
yes('P4 the register records that it ran, and keeps every other part it holds, but not the retired boxes',
    Number(reg1.steps && reg1.steps.jailRule) > 0 && reg1.boxes === undefined &&
    reg1.funds && reg1.funds.whiterun === 77);
// A claim on a jail somehow in the register after that (written by hand, say) is not touched again.
reg1.claims[JAIL] = { by: 909, name: 'Erik', at: clock.t, touched: clock.t, locked: false };
fs.writeFileSync(path.join(old, 'private', 'property.json'), JSON.stringify(reg1));
const run2 = startOn(old);
yes('P5 at every start after that it does nothing: it runs once, not as a watch',
    !!run2.W.claims()[JAIL] && !run2.logged.some(function (l) { return /the jail rule/.test(l); }));
// A server with no such claim: nothing ends, and the mark is still written.
const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-502-rule-none-'));
fs.writeFileSync(path.join(clean, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
fs.mkdirSync(path.join(clean, 'private'));
fs.writeFileSync(path.join(clean, 'private', 'property.json'), JSON.stringify({ claims: {
  [HOUSE]: { by: 909, name: 'Erik', at: clock.t, touched: clock.t, locked: false } } }));
const run3 = startOn(clean);
const reg3 = JSON.parse(fs.readFileSync(path.join(clean, 'private', 'property.json'), 'utf8'));
yes('P6 with no claim on a jail nothing ends, and the mark is written',
    !!reg3.claims[HOUSE] && Number(reg3.steps && reg3.steps.jailRule) > 0 &&
    run3.logged.some(function (l) { return /once: 0 claim\(s\) ended/.test(l); }));
yes('P7 the step is no timer: the function has no clock in it and is called once, at load',
    (function () {
      const fn = slice(propBlock, '  function endPreRuleJailClaims() {', '\n  }\n') || '';
      return !!fn && !/setTimeout|setInterval/.test(fn) &&
        propBlock.split('endPreRuleJailClaims();').length === 2;
    }()));

done();
