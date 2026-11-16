// test-3156-map-calendar.js
//
// #3156. The in-game date, the season and the server clock show on the map
// menu (Patrick, 22 Oct 2026, on his page: C).
//
// Two halves, each run as it stands:
//
//   gamemode.js, the season block and THE DATE, THE SEASON AND THE SERVER
//   CLOCK ON THE MAP: over a stand-in mp, the calendar property is made for
//   its owner only, the pass sets it once on each person online and again only
//   when a season turns, and its client script hands the value to the front
//   once, and only once the front's hook is there.
//
//   thornswood-front.js, THE MAP'S CALENDAR: over a stand-in game, the strip
//   is drawn when MapMenu opens, says the game's date, the season and the
//   server clock, is written again only when a line changes, and is taken off
//   when the map closes. The page script it writes is run in a stand-in page.
//
// Read only, apart from its own temp folder.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const GM = process.env.GM || path.join(ROOT, 'game', 'gamemode.js');
const FRONT = process.env.FRONT || path.join(ROOT, 'game', 'plugins', 'thornswood-front.js');
const CR = String.fromCharCode(13);
const gm = fs.readFileSync(GM, 'utf8').split(CR).join('');
const front = fs.readFileSync(FRONT, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function between(src, from, to) {
  const a = src.indexOf(from);
  if (a < 0) { return null; }
  const b = src.indexOf(to, a + from.length);
  return b < 0 ? null : src.slice(a, b);
}

const H = 3600000;
const WEEK = 7 * 24 * H;

// ------------------------------------------------------------- the server --

const seasonSrc = between(gm, '// ==== thornswood season ====', '// ==== end thornswood season ====');
const calSrc = between(gm, '// ==== thornswood map calendar ====', '// ==== end thornswood map calendar ====');
yes('the season block is in the gamemode', !!seasonSrc);
yes('the map calendar block is in the gamemode, after the season block',
  !!calSrc && gm.indexOf('// ==== thornswood map calendar ====') > gm.indexOf('// ==== end thornswood season ===='));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-3156-'));
const prevCwd = process.cwd();
process.chdir(tmp);

const made = {};
const sets = [];
let online = [];
global.mp = {
  makeProperty: function (name, opts) { made[name] = opts; },
  get: function (id, key) { return (id === 0 && key === 'onlinePlayers') ? online.slice() : ''; },
  set: function (id, key, value) { sets.push({ id: id, key: key, value: value }); }
};
global.idOf = function () { return 0; };
global.WEATHER = { items: {} };
global.holdOfCell = function () { return null; };
global.nearestCapital = function () { return null; };
global.WORLDSPACES = { has: function () { return false; } };

const realLog = console.log;
const realSetInterval = global.setInterval;
const timers = [];
let C = null, S = null;
try {
  global.setInterval = function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; };
  global.require = require;
  console.log = function () { };
  if (seasonSrc && calSrc) {
    (0, eval)(seasonSrc);
    (0, eval)(calSrc);
  }
  S = global.__thornswoodSeason;
  C = global.__thornswoodCalendar;
} catch (e) {
  console.log = realLog;
  console.log('the blocks threw: ' + (e && e.stack || e));
} finally {
  console.log = realLog;
  global.setInterval = realSetInterval;
  delete global.require;
}
yes('both blocks load', !!S && !!C && typeof C.pass === 'function');

const prop = made.thornswoodCalendar;
yes('the calendar property is made, seen by its owner only, with a client script',
  !!prop && prop.isVisibleByOwner === true && prop.isVisibleByNeighbors === false &&
  typeof prop.updateOwner === 'string' && prop.updateOwner.length > 0 && prop.updateNeighbor === '');
yes('the pass runs on its own timer every 5 seconds', timers.length === 1 && timers[0].ms === 5000);

const EPOCH = Date.UTC(2026, 9, 20, 6, 0, 0);
if (S) { S.setEpoch(EPOCH); }

yes('turnsAt is a week after the count for the first season, and each later one turns a week on',
  !!S && S.turnsAt(EPOCH) === EPOCH + WEEK && S.turnsAt(EPOCH + WEEK - 1) === EPOCH + WEEK &&
  S.turnsAt(EPOCH + WEEK) === EPOCH + 2 * WEEK && S.turnsAt(EPOCH + 3 * WEEK + 5) === EPOCH + 4 * WEEK &&
  S.turnsAt(EPOCH - 1000) === EPOCH + WEEK);

const now = EPOCH + 2 * WEEK + 4 * 24 * H;   // autumn, three days left
const v = C ? C.at(now) : null;
const zone = -new Date(now).getTimezoneOffset();
yes('the calendar is the season, the next one, when it turns, and the server zone',
  !!v && v.season === 'autumn' && v.next === 'winter' && v.turns === EPOCH + 3 * WEEK &&
  v.off === zone && typeof v.tz === 'string');
yes('the zone name is short or empty, never a sentence', !!v && /^([A-Za-z][A-Za-z0-9+:-]{1,8})?$/.test(v.tz));

online = [7, 9];
if (C) { C.pass(now); }
yes('the first pass sets it on everybody online',
  sets.length === 2 && sets[0].id === 7 && sets[1].id === 9 &&
  sets.every(function (s) { return s.key === 'thornswoodCalendar' && s.value.season === 'autumn'; }));
sets.length = 0;
if (C) { C.pass(now + 60000); }
yes('a pass with nothing changed sets nothing and asks the engine for nothing more', sets.length === 0);
online = [7, 9, 11];
if (C) { C.pass(now + 120000); }
yes('somebody who comes on gets it at the next pass, and only they do', sets.length === 1 && sets[0].id === 11);
sets.length = 0;
if (C) { C.pass(EPOCH + 3 * WEEK + 1000); }
yes('when the season turns, everybody online is told winter, then spring',
  sets.length === 3 && sets.every(function (s) { return s.value.season === 'winter' && s.value.next === 'spring'; }));
sets.length = 0;
online = [7];
if (C) { C.pass(EPOCH + 3 * WEEK + 2000); }
online = [7, 9];
if (C) { C.pass(EPOCH + 3 * WEEK + 3000); }
yes('somebody who went off and came back is set again once', sets.length === 1 && sets[0].id === 9);

// The client script, the way the engine runs it: every update, ctx.value and
// ctx.state, sharing globalThis with the front.
function runScript(value, state) {
  new Function('ctx', prop.updateOwner)({ value: value, state: state, sp: {} });
}
const handed = [];
const state = {};
const val = v ? JSON.parse(JSON.stringify(v)) : {};
delete globalThis.thornswoodCalendar;
if (prop) { runScript(val, state); }
yes('with no front hook yet, nothing is marked as handed over', !state.thornswoodCalendar);
globalThis.thornswoodCalendar = function (x) { handed.push(x); };
if (prop) { runScript(val, state); runScript(val, state); runScript(val, state); }
yes('once the hook is there, the value is handed over once, not every update',
  handed.length === 1 && handed[0].season === 'autumn' && handed[0].next === 'winter' &&
  handed[0].turns === EPOCH + 3 * WEEK && handed[0].off === zone);
const later = Object.assign({}, val, { season: 'winter', next: 'spring', turns: EPOCH + 4 * WEEK });
if (prop) { runScript(later, state); }
yes('a changed value is handed over again', handed.length === 2 && handed[1].season === 'winter');
delete globalThis.thornswoodCalendar;

process.chdir(prevCwd);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { console.log('could not remove ' + tmp + ': ' + e); }

// -------------------------------------------------------------- the front --

const frontSrc = between(front, "  // ------------------------------------------------- the map's calendar --",
  "  // ------------------------------------------------ end the map's calendar --");
yes("the map's calendar is in the front plugin", !!frontSrc);

const game = { 0x35: 252, 0x36: 9, 0x37: 26 };
const handlers = { menuOpen: [], menuClose: [], update: [] };
const written = [];
const logs = [];
const sp = {
  on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
  Game: { getFormEx: function (id) { return Object.prototype.hasOwnProperty.call(game, id) ? { id: id } : null; } },
  GlobalVariable: { from: function (f) { return f ? { getValue: function () { return game[f.id]; } } : null; } }
};
const T = { js: function (src) { written.push(src); return true; } };
function guard(name, fn) { return fn; }
function log() { logs.push(Array.prototype.join.call(arguments, ' ')); }

let F = null;
try {
  F = new Function('sp', 'T', 'guard', 'log',
    frontSrc + '\nreturn { ordinal: ordinal, clock12: clock12, lines: mapCalendarLines, untilWords: untilWords };')(sp, T, guard, log);
} catch (e) { console.log('the front section threw: ' + (e && e.stack || e)); }
yes("the map's calendar section loads", !!F);

yes('ordinals: 1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 23rd 31st',
  !!F && [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(F.ordinal).join(' ') ===
  '1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 23rd 31st');
yes('the clock is on twelve hours: 12:05 AM, 9:46 AM, 12:00 PM, 11:59 PM',
  !!F && F.clock12(0, 5) === '12:05 AM' && F.clock12(9, 46) === '9:46 AM' &&
  F.clock12(12, 0) === '12:00 PM' && F.clock12(23, 59) === '11:59 PM');
yes('how long until the season turns reads in days, then hours, then within the hour',
  !!F && F.untilWords(3 * 24 * H) === 'in 3 days' && F.untilWords(36 * H) === 'in 2 days' &&
  F.untilWords(5 * H) === 'in 5 hours' && F.untilWords(40 * 60000) === 'within the hour');

function fire(ev, arg) { (handlers[ev] || []).forEach(function (fn) { fn(arg); }); }

// A stand-in page to run what the strip writes.
function page() {
  const nodes = {};
  const doc = {
    body: { appendChild: function (d) { nodes[d.id] = d; d.parentNode = { removeChild: function (x) { delete nodes[x.id]; } }; } },
    getElementById: function (id) { return nodes[id] || null; },
    createElement: function () { return { style: {}, innerHTML: '' }; }
  };
  return { doc: doc, nodes: nodes, run: function (src) { new Function('document', src)(doc); } };
}
const p = page();

// The real clock is what the front reads; the server says the box is 6 hours
// behind UTC, as Mountain summer time is.
const realNow = Date.now;
const t0 = Date.UTC(2026, 9, 26, 15, 46, 10);
let clockAt = t0;
Date.now = function () { return clockAt; };
try {
  fire('menuOpen', { name: 'InventoryMenu' });
  fire('update');
  yes('another menu draws nothing', written.length === 0);

  fire('menuOpen', { name: 'MapMenu' });
  fire('update');
  yes('the map opening draws the strip with the date alone before the server has said anything',
    written.length === 1 && written[0].indexOf('26th of Frostfall, 4E 252') >= 0 &&
    written[0].indexOf('Server clock') < 0);
  written.forEach(p.run);

  globalThis.thornswoodCalendar({ season: 'autumn', next: 'winter', turns: t0 + 3 * 24 * H, off: -360, tz: 'MDT' });
  clockAt = t0 + 1500;
  fire('update');
  const last = written[written.length - 1];
  const lines = F ? F.lines(clockAt) : [];
  const mine = -new Date(clockAt).getTimezoneOffset();
  yes('the strip says the date, the season and the server clock in Mountain time',
    written.length === 2 && lines[0] === '26th of Frostfall, 4E 252' &&
    lines[1] === 'Autumn, winter in 3 days' &&
    lines[2].indexOf('Server clock 9:46 AM MDT') === 0);
  yes('your own clock shows only when your zone is not the server\'s',
    mine === -360 ? lines[2] === 'Server clock 9:46 AM MDT' : / yours \d{1,2}:\d\d [AP]M$/.test(lines[2]));
  yes('the page script writes the strip by its own id with the season line in it', last.indexOf('Autumn, winter in 3 days') >= 0 &&
    last.indexOf('ts-map-calendar') >= 0);
  p.run(last);
  yes('run in a page, it leaves one strip with three lines',
    !!p.nodes['ts-map-calendar'] && (p.nodes['ts-map-calendar'].innerHTML.match(/<div>/g) || []).length === 3);

  const before = written.length;
  clockAt = t0 + 3000; fire('update');
  clockAt = t0 + 4200; fire('update');
  yes('within the same minute nothing is written again', written.length === before);
  clockAt = t0 + 60000; fire('update');
  yes('the next minute is written', written.length === before + 1 &&
    written[written.length - 1].indexOf('Server clock 9:47 AM MDT') >= 0);

  game[0x37] = 'x';
  clockAt = t0 + 120000; fire('update');
  yes('a calendar that cannot be read leaves the date out and says so in the log once',
    written[written.length - 1].indexOf('Frostfall') < 0 &&
    logs.filter(function (l) { return l.indexOf('map calendar') >= 0; }).length === 1);
  game[0x37] = 26;

  fire('menuClose', { name: 'MapMenu' });
  p.run(written[written.length - 1]);
  yes('the map closing takes the strip off', !p.nodes['ts-map-calendar']);
  const shut = written.length;
  clockAt = t0 + 180000; fire('update');
  yes('with the map shut nothing is drawn', written.length === shut);

  fire('menuOpen', { name: 'MapMenu' });
  clockAt = t0 + 181000; fire('update');
  yes('opening the map again draws it again at once', written.length === shut + 1);
} finally {
  Date.now = realNow;
  delete globalThis.thornswoodCalendar;
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
