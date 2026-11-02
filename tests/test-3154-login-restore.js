'use strict';
/*
  test-3154-login-restore.js

  #3154: after a logout or a crash, a character's needs, effects, location,
  inventory and claims come back exactly as they were, checked in one place
  and end to end. This is that place.

  The WHOLE of game/gamemode.js runs here, loaded the way the fork loads it
  (gamemodeLoad.ts: a fresh module each time, over the same globalThis and
  the same mp), over a stand-in server whose characters are change forms:
  position, cell, pack, worn things and the custom properties, kept in one
  store the way the engine keeps them. A restart throws the process away,
  round-trips every change form through JSON the way the database does, and
  loads the file again from that. The server's own files (the property
  register) are in this harness's temp folder.

  One finished character, a smith, is in the world with something in each
  of the five: hunger, thirst, rest and a temperature, standing in the snow
  at night; a drug window that holds the rest drain, ales, and a meal's
  warmth; a broken arm and a withering; a place, a facing and a pack with
  things worn; and a claim on a house, locked. Then four ways out and back:

    relog     out for half an hour on their feet, then back, same process
    reload    the gamemode reloaded under them while they are on, as every
              gamemode deploy does
    restart   out for half an hour, the server restarted, then back
    crash     the server gone while they are on, started again, and back
              half an hour later

  After each one:

    L  the place, facing and cell are what they were, and nothing at the
       login moved them;
    I  the pack and what is worn are what they were, and nothing at the
       login wrote them;
    C  the claim is on disk as it was, and the property block still names
       them its holder;
    E  the wound, the withering, the K panel's effects and the drug, ale
       and meal windows are what they were;
    N  hunger and thirst are what they were less exactly what the time away
       costs (exhaustion.md, hunger.md, thirst.md: half the clock on your
       feet, never under 25); rest is what it was, because the drug held its
       drain; and the temperature is the one they left with, because the
       snow they logged out in is not where they spent the time. A reload is
       not time away: the clock runs as it did and the meter goes on toward
       the snow;
    H  the login is seen once: their profession is said once for each login
       and not at all for the reload;
    X  and no other property of the character moved, apart from the views
       the server sends their game again, worked out from what is kept, and
       the stamp of the two records a login restamps on purpose (the alchemy
       lesson and the pack's spoil clock), whose contents must not move.

  And somebody in the creation hall at a reload is not taken for a
  reconnect: their wait is not started over (the hall's own first sight).

  Read only, apart from its own temp folder, which it removes.

      node tests\test-3154-login-restore.js
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const REPO_DIR = path.join(__dirname, '..');
const SRC = path.resolve(process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js'));
const CR = String.fromCharCode(13);
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(SRC, 'utf8')).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const START = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'login-restore-'));
function done() {
  process.chdir(START);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function copy(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

// The rates and the time-away row are read out of the needs block, not copied.
const drainM = /drain: \{ food: ([0-9.]+) \* 100 \/ ([0-9.]+), drink: ([0-9.]+) \* 100 \/ ([0-9.]+), rest:/.exec(gm);
const upM = /\n\s+up: +\{ drain: ([0-9.]+), floor: ([0-9.]+), rest: 0, food: 0, drink: 0 \}/.exec(gm);
const profM = /notify\(actorId, 'Your profession: ' \+ prof\.name/.test(gm);
yes('P0 the needs block\'s clock and its time away on your feet, and the login\'s profession line, are where ' +
    'this reads them', !!drainM && !!upM && profM);
if (!drainM || !upM || !profM) { done(); }
const DRAIN = { food: Number(drainM[1]) * 100 / Number(drainM[2]), drink: Number(drainM[3]) * 100 / Number(drainM[4]) };
const UP = { share: Number(upM[1]), floor: Number(upM[2]) };

// ------------------------------------------------------------ the folder --
['data', 'private', 'world'].forEach(function (d) { fs.mkdirSync(path.join(dir, d)); });
fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({
  dataDir: 'data', privDir: 'private', port: 7777, name: 'login restore', loadOrder: [],
  thornswoodRequirePass: false
}));
process.chdir(dir);

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
// Long enough to matter, short enough that no meter changes band, so the K
// panel's effects are the same before and after.
const AWAY = 30 * MIN;
let clock = Date.UTC(2026, 9, 26, 12, 0, 0);
class FakeDate extends Date {
  constructor(...a) { if (a.length) { super(...a); } else { super(clock); } }
  static now() { return clock; }
}

// Honeyside, a house the property block files under a hold.
const HOUSE = '16778:Skyrim.esm';
yes('P0 the building table has the house this claims', gm.indexOf('"' + HOUSE + '":') >= 0);
const ME = 0xff000800, PID = 1000;
const HALL = 0xff000801;
const CLAIM = { by: PID, name: 'Tester', at: clock - DAY, touched: clock - HOUR, locked: true };
fs.writeFileSync(path.join(dir, 'private', 'property.json'), JSON.stringify({ claims: { [HOUSE]: CLAIM } }));
function claimsOnDisk() {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'private', 'property.json'), 'utf8')).claims; }
  catch (e) { return 'unreadable: ' + e.message; }
}

// ------------------------------------------------------------- the world --
/* Every change form, as the engine keeps it. */
let store = new Map();
store.set(ME, {
  profileId: PID, pos: [1000, 2000, 64], angle: [0, 0, 10], worldOrCellDesc: '1a26f:Skyrim.esm',
  appearance: { name: 'Tester', raceId: 0x13746, isFemale: false }, isDead: false,
  thornswoodChargen: { stage: 'done', at: 1 },
  thornswoodCharacter: { prof: 'smith', v: 1 },
  inventory: { entries: [{ baseId: 0xf, count: 25 }, { baseId: 0x12eb7, count: 1 }, { baseId: 0x13911, count: 1, worn: true }] },
  equipment: { inv: { entries: [{ baseId: 0x13911, count: 1, worn: true }] } },
  baseDesc: '7:Skyrim.esm'
});
let online = [ME];

/* What the gamemode did, while recording: [actor, kind, what, value, time]. */
let did = [];
function saw(actor, kind, what, value) { did.push([actor, kind, what, value, clock]); }

function makeMp() {
  const base = {
    get: function (id, k) {
      if (id === 0 && k === 'onlinePlayers') { return online.slice(); }
      const row = store.get(id);
      if (!row) { return undefined; }
      if (k === 'locationalData') { return { cellOrWorldDesc: row.worldOrCellDesc, pos: copy(row.pos), rot: copy(row.angle) }; }
      return copy(row[k]);
    },
    set: function (id, k, v) {
      saw(id, 'set', k, copy(v));
      const row = store.get(id) || {};
      if (k === 'locationalData') { row.worldOrCellDesc = v.cellOrWorldDesc; row.pos = copy(v.pos); row.angle = copy(v.rot); }
      else { row[k] = copy(v); }
      store.set(id, row);
    },
    makeProperty: function () { }, makeEventSource: function () { },
    getNeighborsByPosition: function () { return online.slice(); },
    callPapyrusFunction: function (kind, cls, fn, self, args) {
      if (cls === 'Debug' && fn === 'Notification') { saw(0, 'notify', String(args && args[0]), null); }
      return undefined;
    },
    getDescFromId: function (id) { return (id >>> 0).toString(16) + ':Skyrim.esm'; },
    getIdFromDesc: function (d) { const m = /^([0-9a-f]+):Skyrim\.esm$/i.exec(String(d)); return m ? parseInt(m[1], 16) : 0; },
    sendCustomPacket: function () { },
    findFormsByPropertyValue: function () { return []; },
    place: function () { return 0; },
    lookupEspmRecordById: function () { return { record: null }; },
    getEspmLoadOrder: function () { return ['Skyrim.esm', 'Update.esm']; },
    getServerSettings: function () { return JSON.parse(fs.readFileSync(path.join(dir, 'server-settings.json'), 'utf8')); },
    getUserByActor: function (a) { return online.indexOf(a); },
    getActorByUser: function (u) { return online[u] || 0; },
    getUserGuid: function (u) { return 'guid-' + u; },
    setRaceMenuOpen: function (a) { saw(a, 'raceMenu', '', null); },
    writeFileWhole: function (f, text) { fs.writeFileSync(f, text); },
    clear: function () { }
  };
  // Anything else the engine has answers nothing, the way an engine call
  // that finds nothing does.
  return new Proxy(base, {
    get: function (t, k) {
      if (k in t) { return t[k]; }
      if (typeof k === 'string' && !/^on/.test(k)) { return function () { return undefined; }; }
      return undefined;
    },
    set: function (t, k, v) { t[k] = v; return true; }
  });
}

function fakeRequire(name) {
  if (name === 'http' || name === 'https') {
    const r = { on: function () { return r; }, setTimeout: function () { return r; }, destroy: function () { },
                write: function () { }, end: function () { } };
    return { request: function () { return r; }, get: function () { return r; },
             createServer: function () { return { listen: function () { }, on: function () { } }; } };
  }
  if (name === 'child_process') { return { exec: function () { }, spawn: function () { return { on: function () { } }; } }; }
  return require(name);
}

/* One load of the file into a process: a fresh module, as requireTemp does. */
function load(proc) {
  const m = { exports: {} };
  vm.runInContext('(function (exports, require, module, __filename, __dirname) {' + gm + '\n})',
                  proc.box, { filename: 'gamemode.js' })
    .call(m.exports, m.exports, fakeRequire, m, SRC, path.dirname(SRC));
}

/* A server process: its globalThis, its timers, its log. */
function boot() {
  const timers = [];
  const logged = [];
  function line() { logged.push([].slice.call(arguments).join(' ')); }
  const box = {
    mp: makeMp(), require: fakeRequire, process: process, Buffer: Buffer,
    console: { log: line, error: line, warn: line, info: line },
    setInterval: function (fn, ms) { const t = { fn: fn, every: Number(ms) || 1000, at: clock + (Number(ms) || 1000) }; timers.push(t); return t; },
    clearInterval: function (t) { if (t) { t.gone = true; } },
    setTimeout: function (fn, ms) { const t = { fn: fn, at: clock + (Number(ms) || 0) }; t.unref = function () { return t; }; timers.push(t); return t; },
    clearTimeout: function (t) { if (t) { t.gone = true; } },
    setImmediate: function (fn) { timers.push({ fn: fn, at: clock }); },
    Date: FakeDate, URL: URL, TextEncoder: TextEncoder, TextDecoder: TextDecoder
  };
  box.globalThis = box;
  vm.createContext(box);
  const proc = { box: box, logged: logged, threw: [] };
  /* The clock moved on by ms, every timer due in it run in order. */
  proc.run = function (ms) {
    const end = clock + ms;
    for (;;) {
      let next = null;
      for (let i = 0; i < timers.length; i++) {
        if (!timers[i].gone && (!next || timers[i].at < next.at)) { next = timers[i]; }
      }
      if (!next || next.at > end) { break; }
      clock = Math.max(clock, next.at);
      if (next.every) { next.at += next.every; } else { next.gone = true; }
      try { next.fn(); } catch (e) { proc.threw.push(e && e.message); }
    }
    clock = end;
  };
  let err = null;
  try { load(proc); } catch (e) { err = e; }
  proc.err = err;
  return proc;
}

/* The change forms as the database hands them back after a restart. */
function saved() { return new Map(JSON.parse(JSON.stringify(Array.from(store.entries())))); }

// ------------------------------------------------------- in the world --
let proc = boot();
yes('P1 the whole gamemode loads over the stand-in' + (proc.err ? ' (it threw: ' + proc.err.message + ')' : ''), !proc.err);
if (proc.err) { done(); }
proc.run(30000);
const P = proc.box.__thornswoodProperty;
yes('P1 the property block read the claim off disk', !!P && same(P.claims()[HOUSE], CLAIM));

const hurt = proc.box.__thornswoodHurt;
yes('P1 a broken arm goes on them', !!hurt && /broken/.test(hurt.wound(ME, 'break', 'left arm')));
store.get(ME).thornswoodWithered = { drank: [], cast: [], until: clock + 6 * HOUR };

/* Their meters, as a needs record would hold them, in the snow at night. */
function setNeeds() {
  store.get(ME).thornswoodNeeds = {
    food: 90, drink: 90, rest: 70, temp: 45, at: clock, resting: '', worked: 0,
    place: 'snow', sky: 'snow', night: true, roof: false,
    drugUntil: clock + 6 * HOUR, drugCrash: 1, ale: 1, aleAt: clock - MIN,
    mealHelp: 'warm', mealHelpUntil: clock + 6 * HOUR
  };
}
setNeeds();
proc.run(20000);
// The K panel worked out again, the way the server sends it when an effect
// starts, since the records above were written behind its back.
const C = proc.box.__thornswoodCharacter;
C.writeState(ME, C.stateOf(ME));
proc.run(20000);

const VIEWS = ['thornswoodCharacter', 'thornswoodNeeds', 'thornswoodNear', 'thornswoodPartyAt',
               'thornswoodSocialView', 'thornswoodSky', 'thornswoodRecipeCounts'];
// Records whose at is a stamp that a login moves on purpose: the alchemy
// lesson goes out under a new stamp so the game is taught it again at each
// arrival (#3480), and the pack's spoil clock looks at the pack at a login
// and counts none of the time away (#4978). Everything else in them is kept.
const CLOCKS = ['thornswoodAlchemyLearn', 'thornswoodSpoilPack'];
function unstamped(v) {
  if (!v || typeof v !== 'object') { return v; }
  const o = Object.assign({}, v); delete o.at; return o;
}
const WINDOWS = ['drugUntil', 'drugCrash', 'ale', 'aleAt', 'mealHelp', 'mealHelpUntil', 'hangover'];

/* The first needs record written for them at or after t. */
function firstNeeds(t) {
  for (let i = 0; i < did.length; i++) {
    if (did[i][0] === ME && did[i][1] === 'set' && did[i][2] === 'thornswoodNeeds' && did[i][4] >= t) { return did[i][3]; }
  }
  return null;
}
function awayDrain(v, took, floor) {
  const after = Math.max(0, Math.min(100, v - took));
  if (floor > 0 && v > floor && after < floor) { return floor; }
  return v <= floor ? v : after;
}
function near(a, b) { return typeof a === 'number' && Math.abs(a - b) < 1e-9; }
function said(text) { return did.filter(function (d) { return d[1] === 'notify' && d[2].indexOf(text) === 0; }).length; }

function check(way, before, claims, back, away) {
  const after = store.get(ME);
  const atLogin = did.filter(function (d) { return d[0] === ME && d[1] === 'set'; }).map(function (d) { return d[2]; });

  yes(way + ' L the place, facing and cell are what they were',
      same(after.pos, before.pos) && same(after.angle, before.angle) && after.worldOrCellDesc === before.worldOrCellDesc);
  yes(way + ' L and nothing moved them at the login',
      !atLogin.some(function (k) { return k === 'locationalData' || k === 'spawnPoint' || k === 'pos'; }));
  yes(way + ' I the pack and what is worn are what they were',
      same(after.inventory, before.inventory) && same(after.equipment, before.equipment));
  yes(way + ' I and nothing wrote them at the login',
      atLogin.indexOf('inventory') < 0 && atLogin.indexOf('equipment') < 0);
  const nowP = proc.box.__thornswoodProperty;
  yes(way + ' C the claim is on disk as it was, and the property block names them its holder',
      same(claimsOnDisk(), claims) && !!nowP && same(nowP.claims()[HOUSE], claims[HOUSE]) &&
      !!nowP.holderOf(HOUSE) && nowP.holderOf(HOUSE).by === PID);
  yes(way + ' E the broken arm and the withering are what they were',
      same(after.thornswoodHurt, before.thornswoodHurt) && same(after.thornswoodWithered, before.thornswoodWithered));
  yes(way + ' E the K panel\'s effects are what they were: ' + JSON.stringify(after.thornswoodCharacter.panel.effects),
      same(after.thornswoodCharacter.panel.effects, before.thornswoodCharacter.panel.effects));
  const n0 = before.thornswoodNeeds, n1 = firstNeeds(back);
  yes(way + ' E the drug, ale and meal windows are what they were',
      !!n1 && WINDOWS.every(function (k) { return same(n1[k], n0[k]); }));
  if (!n1) { return; }
  const h = (n1.at - n0.at) / HOUR;
  const share = away ? UP.share : 1, floor = away ? UP.floor : 0;
  const food = awayDrain(n0.food, DRAIN.food * h * share, floor);
  const drink = awayDrain(n0.drink, DRAIN.drink * h * share, floor);
  yes(way + ' N hunger and thirst cost ' + (away ? 'half the clock for the ' + Math.round(h * 60) + ' minutes away' :
      'the clock as it ran, nothing more') + ': ' + n1.food.toFixed(3) + ' and ' + n1.drink.toFixed(3) +
      ' (' + food.toFixed(3) + ' and ' + drink.toFixed(3) + ')', near(n1.food, food) && near(n1.drink, drink));
  yes(way + ' N rest is what it was, the drug holding its drain: ' + n1.rest, near(n1.rest, n0.rest));
  if (away) {
    yes(way + ' N the temperature is the one they left with, not the snow\'s for the time away: ' +
        n1.temp + ' (' + n0.temp + ')', near(n1.temp, n0.temp));
  } else {
    yes(way + ' N the temperature goes on toward the snow: ' + n1.temp + ' (' + n0.temp + ')', n1.temp < n0.temp);
  }
  const moved = [];
  Object.keys(Object.assign({}, before, after)).forEach(function (k) {
    if (VIEWS.indexOf(k) >= 0) { return; }
    if (CLOCKS.indexOf(k) >= 0) {
      if (!same(unstamped(before[k]), unstamped(after[k]))) { moved.push(k); }
      return;
    }
    if (!same(before[k], after[k])) { moved.push(k); }
  });
  const ch = Object.assign({}, after.thornswoodCharacter), cb = Object.assign({}, before.thornswoodCharacter);
  // The panel, and asked, the stamp a redraw of it carries (#1730), are the view.
  delete ch.panel; delete cb.panel; delete ch.asked; delete cb.asked;
  if (!same(ch, cb)) { moved.push('thornswoodCharacter (outside its panel)'); }
  yes(way + ' X nothing else of theirs moved' + (moved.length ? ': ' + moved.join(', ') : ''), !moved.length);
}

function leaveAndBack(way, how) {
  setNeeds();
  proc.run(30000);
  const before = copy(store.get(ME));
  const claims = claimsOnDisk();
  did = [];
  const r = how();
  check(way, before, claims, r.back, r.away);
  return said('Your profession');
}

// The four ways out and back.
let lines = leaveAndBack('relog', function () {
  online = [];
  proc.run(AWAY);
  online = [ME];
  const back = clock;
  proc.run(30000);
  return { back: back, away: true };
});
yes('relog H their profession is said once for the login (' + lines + ')', lines === 1);

lines = leaveAndBack('reload', function () {
  const back = clock;
  load(proc);
  proc.run(30000);
  return { back: back, away: false };
});
yes('reload H a reload is not a login: their profession is not said again (' + lines + ')', lines === 0);

lines = leaveAndBack('restart', function () {
  online = [];
  proc.run(MIN);
  store = saved();
  proc = boot();
  proc.run(AWAY);
  online = [ME];
  const back = clock;
  proc.run(30000);
  return { back: back, away: true };
});
yes('restart H their profession is said once for the login (' + lines + ')', lines === 1);

lines = leaveAndBack('crash', function () {
  store = saved();
  online = [];
  proc = boot();
  proc.run(AWAY);
  online = [ME];
  const back = clock;
  proc.run(30000);
  return { back: back, away: true };
});
yes('crash H their profession is said once for the login (' + lines + ')', lines === 1);

// ------------------------------------------------ somebody in the hall --
store.set(HALL, {
  profileId: PID + 1, pos: [0, 0, 0], angle: [0, 0, 0], worldOrCellDesc: '19bad4:Skyrim Unbound.esp',
  appearance: null, isDead: false, thornswoodChargen: { stage: 'appearance', at: clock },
  inventory: { entries: [] }, equipment: { inv: { entries: [] } }, baseDesc: '7:Skyrim.esm'
});
online = [ME, HALL];
proc.run(30000);
const hallBefore = copy(store.get(HALL).thornswoodChargen);
yes('W the hall took its baseline for them: ' + JSON.stringify(hallBefore),
    hallBefore.stage === 'appearance' && !!hallBefore.seenAt && !!hallBefore.askedAt);
const wasLogged = proc.logged.length;
did = [];
load(proc);
proc.run(30000);
const hallAfter = store.get(HALL).thornswoodChargen;
const startedOver = proc.logged.slice(wasLogged).filter(function (l) { return /came back mid creation/.test(l); });
yes('W a reload is not a reconnect for somebody in the hall: the wait is not started over' +
    (startedOver.length ? ' (' + startedOver[0] + ')' : ''),
    !startedOver.length && hallAfter.seenAt === hallBefore.seenAt && hallAfter.askedAt === hallBefore.askedAt);

yes('Z no timer threw in the last process' + (proc.threw.length ? ': ' + proc.threw.slice(0, 3).join('; ') : ''),
    !proc.threw.length);
done();
