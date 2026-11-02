'use strict';
/*
  test-2680-holder-word.js

  #2680, split from #507 at Patrick's decision 6B: a holder is told, in the
  world, when somebody picks their door's lock or presents their deed, and
  it decides nothing. The design is on the issue.

  The REAL property block is booted over a stand-in server (the shape
  test-507-property-restart.js uses), in a temp folder with its own
  server-settings.json, and reads the real game/data/property-word.json:

    K  a pick that counts: the report, the word written for the holder, not
       handed over before it is due, handed over once when it is, naming
       nobody, and waiting for a holder who is away.
    X  every report that must not count: no door, a way out, an unlocked or
       unheld building, somebody with a key, the holder, too far away, no
       lockpick, and a cell door.
    L  the limits: the same picker, a second picker added to a word not yet
       gone out, a day's cap, a full queue, and turning picks off.
    D  a deed presented at the door: word for the old holder, never held
       back, and the claim still moves exactly as before.
    S  the register: a restart keeps a word that has not gone out, a row that
       is not a word is dropped, and a word is dropped after keepDays and
       pruned after it has gone out.
    U  the staff data: the real file, a file with wrong keys, and no file.
    C  the client half: the lock script takes a door off the published list
       before it opens it, and the front plugin reports a door on that list
       that opened, once, and nothing else.

  Read only, apart from its own temp folders, which it removes.

      node tests\test-2680-holder-word.js
*/
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8')).split(CR).join('');
const front = fs.readFileSync(path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js'), 'utf8').split(CR).join('');
const RULES_FILE = path.join(REPO_DIR, 'game', 'data', 'property-word.json');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const START = process.cwd();
const dirs = [];
function done() {
  process.chdir(START);
  dirs.forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { } });
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
function recordOf(name) {
  const m = new RegExp("var " + name + " = '([0-9a-f]+:Thornswood-Content\\.esp)';").exec(propBlock);
  return m ? m[1] : null;
}
const DEED_DESC = recordOf('DEED');
const KEY_DESC = recordOf('KEY');
const MASTER_DESC = recordOf('MASTER_KEY');
const HOUSE = '16778:Skyrim.esm';
const holdM = /"16778:Skyrim\.esm":"([a-z]+)"/.exec(propBlock);
const HOLD = holdM ? holdM[1] : null;
const townM = HOLD ? new RegExp(HOLD + ": '([A-Za-z ]+)'").exec(propBlock) : null;
const TOWN = townM ? townM[1] : null;
yes('P0 the records, the test house\'s hold and its town are read out of the block (' + HOLD + ', ' + TOWN + ')',
    !!DEED_DESC && !!KEY_DESC && !!MASTER_DESC && !!HOLD && !!TOWN);
if (!DEED_DESC || !KEY_DESC || !MASTER_DESC || !HOLD || !TOWN) { done(); }

// ================================================================ the server
const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const clock = { t: Date.UTC(2026, 9, 18, 18, 0, 0) };
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
const NOHOLD = 'nohold:Test.esp';
const DOOR = '1001:Skyrim.esm';        // Honeyside's front door, from the street
const DOOR_IN = '1004:Skyrim.esm';     // its inside door, a way out
const SHOP_DOOR = '1002:Skyrim.esm';
const NOHOLD_DOOR = '1003:Skyrim.esm';
const STREET = '3c:Skyrim.esm';
const LOCKPICK = 'a:Skyrim.esm';
const BUILDING_BY_DOOR = { [DOOR]: HOUSE, [DOOR_IN]: HOUSE, [SHOP_DOOR]: SHOP, [NOHOLD_DOOR]: NOHOLD };
const BUILDING_NAME = { [HOUSE]: 'Honeyside', [SHOP]: 'The Shop', [NOHOLD]: 'The Lonely Hut' };
const WAY_OUT = { [DOOR_IN]: true };

const HULDA = { a: 0xff000101, pid: 101, name: 'Hulda', race: 'NordRace', female: true };
const BOB = { a: 0xff000202, pid: 202, name: 'Bob', race: 'ImperialRace', female: false };
const CAROL = { a: 0xff000303, pid: 303, name: 'Carol', race: 'BretonRace', female: true };
const EVE = { a: 0xff000404, pid: 404, name: 'Eve', race: 'NordRace', female: true };
const DAN = { a: 0xff000505, pid: 505, name: 'Dan', race: 'OrcRaceVampire', female: false };
const FIN = { a: 0xff000606, pid: 606, name: 'Fin', race: 'KhajiitRace', female: false };
const GUS = { a: 0xff000707, pid: 707, name: 'Gus', race: 'DremoraRace', female: false };
const PEOPLE = [HULDA, BOB, CAROL, EVE, DAN, FIN, GUS];

const refs = {};
function resetWorld() {
  for (const k in refs) { delete refs[k]; }
  refs[idOf(DOOR)] = { baseDesc: 'door:Test.esp', worldOrCellDesc: STREET, pos: [0, 0, 0] };
  refs[idOf(DOOR_IN)] = { baseDesc: 'door:Test.esp', worldOrCellDesc: HOUSE, pos: [0, 0, 0] };
  refs[idOf(SHOP_DOOR)] = { baseDesc: 'door:Test.esp', worldOrCellDesc: STREET, pos: [300, 0, 0] };
  refs[idOf(NOHOLD_DOOR)] = { baseDesc: 'door:Test.esp', worldOrCellDesc: STREET, pos: [600, 0, 0] };
  PEOPLE.forEach(function (p) {
    refs[p.a] = { profileId: p.pid, appearance: { name: p.name, isFemale: p.female, raceId: p.pid },
                  worldOrCellDesc: STREET, pos: [50, 0, 0], inventory: { entries: [] } };
  });
}
resetWorld();
let online = PEOPLE.map(function (p) { return p.a; });

function newDir(tag, rulesText) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-2680-' + tag + '-'));
  dirs.push(d);
  fs.writeFileSync(path.join(d, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
  fs.mkdirSync(path.join(d, 'private'));
  fs.mkdirSync(path.join(d, 'game', 'data'), { recursive: true });
  if (rulesText !== null) {
    fs.writeFileSync(path.join(d, 'game', 'data', 'property-word.json'),
                     rulesText === undefined ? fs.readFileSync(RULES_FILE, 'utf8') : rulesText);
  }
  return d;
}
let dir = newDir('main');
function inDir(f) {
  const was = process.cwd();
  process.chdir(dir);
  try { return f(); } finally { process.chdir(was); }
}

let logged = [];
let told = [];
let timers = [];
function boot() {
  logged = [];
  timers = [];
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
    getDescFromId: function (id) {
      const d = descFromId(id);
      if (!d) { throw new Error('no form ' + id); }
      return d;
    },
    getNeighborsByPosition: function (cell) {
      return online.filter(function (a) { return refs[a] && refs[a].worldOrCellDesc === cell; });
    },
    lookupEspmRecordById: function (id) { return id === idOf(MASTER_DESC) ? { record: { type: 'MISC' } } : null; }
  };
  function takeItem() { return false; }
  function addItem(actorId, desc, n) { refs[actorId].inventory.entries.push({ baseId: idOf(desc), count: n }); }
  const box = {
    console: { log: function () { logged.push([].slice.call(arguments).join(' ')); } },
    require: require, mp: mp, Date: FakeDate,
    __dirname: path.join(dir, 'game'),
    BUILDING_BY_DOOR: BUILDING_BY_DOOR, BUILDING_NAME: BUILDING_NAME, WAY_OUT: WAY_OUT,
    BENCH_BY_BASE: {},
    idOf: idOf, takeItem: takeItem, addItem: addItem,
    unfitToMake: function () { return ''; },
    notify: function (a, line) { told.push({ a: a, line: line, how: 'notify' }); },
    say: function (a, line) { told.push({ a: a, line: line, how: 'say' }); },
    guard: function (n, f) { return f; },
    setInterval: function (f, ms) { timers.push({ f: f, ms: ms }); return timers.length; },
    clearInterval: function () { },
    log: function () { },
    // The character's race editor id, the way the recipes read it.
    raceOf: function (actorId) {
      for (const p of PEOPLE) { if (p.a === actorId) { return p.race.toLowerCase(); } }
      return '';
    },
    __thornswoodCharacter: {
      stateOf: function () { return { v: 1, prof: 'farmer' }; },
      writeState: function () { }
    },
    __thornswoodFarming: { groundOf: function () { return null; } },
    __thornswoodOffices: function () { return { jarl: [], court: [], steward: [], guard: [] }; }
  };
  box.globalThis = box;
  inDir(function () { vm.runInNewContext(propBlock, box, { filename: 'gamemode.js property' }); });
  return box;
}

function to(pid, line) { told.push({ a: pid, line: line }); }
let box = boot();
let W = box.__thornswoodProperty;
yes('P1 the property block boots and publishes the word', !!W && typeof W.picked === 'function' &&
    typeof W.wordTick === 'function' && typeof W.wordBook === 'function');
if (!W || typeof W.picked !== 'function') { done(); }
yes('P2 the word is ticked on a timer of everySeconds', timers.some(function (t) { return t.ms === 30000; }));

function open(p, door) { inDir(function () { W.touched(p.a, door); }); }
function word(p, w, args) {
  inDir(function () { W.command(w, [w].concat(args || []), p.a, p.pid, to, w + ' ' + (args || []).join(' ')); });
}
function inv(p) { return refs[p.a].inventory.entries; }
function give(p, desc, name, n) { const e = { baseId: idOf(desc), count: n || 1 }; if (name) { e.name = name; } inv(p).push(e); }
function held(b) { return inDir(function () { return W.holderOf(b); }); }
function pick(p, door) { return inDir(function () { return W.picked(p.a, p.pid, door === undefined ? hex(DOOR) : door); }); }
function tick() { inDir(function () { W.wordTick(); }); }
function book() { return W.wordBook().list; }
function toldTo(p) { return told.filter(function (t) { return t.a === p.a; }); }
function at(p, cell, pos) { refs[p.a].worldOrCellDesc = cell; refs[p.a].pos = pos; }
function register() { return JSON.parse(fs.readFileSync(path.join(dir, 'private', 'property.json'), 'utf8')); }

// Hulda claims Honeyside and locks it. Bob claims the shop and leaves it open.
open(HULDA, DOOR); word(HULDA, '/claim', [hex(DOOR)]);
open(HULDA, DOOR); word(HULDA, '/lock', [hex(DOOR)]);
open(BOB, SHOP_DOOR); word(BOB, '/claim', [hex(SHOP_DOOR)]);
yes('P3 Hulda holds Honeyside, locked, and Bob his shop, open',
    held(HOUSE) && held(HOUSE).by === HULDA.pid && held(HOUSE).locked === true &&
    held(SHOP) && held(SHOP).by === BOB.pid && held(SHOP).locked === false);
give(EVE, LOCKPICK, null, 3);
give(DAN, LOCKPICK, null, 1);
give(FIN, LOCKPICK, null, 1);
give(GUS, LOCKPICK, null, 1);
give(CAROL, LOCKPICK, null, 1);
give(CAROL, KEY_DESC, W.keyLabel(HOUSE));
give(HULDA, LOCKPICK, null, 1);

// ============================================================ K. a pick
told = [];
const PICKED_AT = clock.t;
let r = pick(EVE);
yes('K1 Eve, at the door with a lockpick and no key, picks it: "' + r + '"', r === 'new');
let w = book()[0];
yes('K2 one word, for Hulda, about Honeyside, due 20 minutes later',
    book().length === 1 && w.kind === 'pick' && w.holder === HULDA.pid && w.building === HOUSE &&
    w.due === PICKED_AT + 20 * MIN && w.count === 1 && w.sent === 0);
yes('K3 what a neighbour saw is written, a Nord woman, and who did it is kept for the log only',
    JSON.stringify(w.looks) === JSON.stringify(['a Nord woman']) && JSON.stringify(w.by) === JSON.stringify([EVE.pid]));
yes('K4 the log names her, for staff and the court',
    logged.some(function (l) { return /\[property\] word: Eve \(profile 404\) picked the lock of Honeyside held by Hulda/.test(l); }));
yes('K5 nobody is told anything at the moment it happens', told.length === 0);
yes('K6 the word is written in the register at once', register().word && register().word.list.length === 1);
yes('K7 and nothing about the claim or the lock changed', held(HOUSE).by === HULDA.pid && held(HOUSE).locked === true);

clock.t += 10 * MIN;
tick();
yes('K8 ten minutes on, the runner has not arrived', toldTo(HULDA).length === 0);
clock.t += 11 * MIN;
tick();
const huldaHeard = toldTo(HULDA);
const line = huldaHeard.length ? huldaHeard[0].line : '';
yes('K9 21 minutes on, Hulda is handed the word, on the screen and in chat: "' + line + '"',
    huldaHeard.length === 2 && huldaHeard.some(function (t) { return t.how === 'notify'; }) &&
    huldaHeard.some(function (t) { return t.how === 'say'; }));
yes('K10 from the steward\'s office of ' + TOWN + ', about Honeyside, roughly when',
    line.indexOf('A runner from the steward\'s office of ' + TOWN + ' finds you with word') === 0 &&
    /working the lock on the door of Honeyside within the hour\./.test(line));
yes('K11 with what she looked like, and the court for a grievance',
    /Whoever it was looked like a Nord woman\./.test(line) && /The office takes no side\. A grievance is for the court\./.test(line));
yes('K12 and never her name or her number', line.indexOf('Eve') === -1 && line.indexOf('404') === -1);
told = [];
tick();
yes('K13 the word is handed over once', toldTo(HULDA).length === 0 && book()[0].sent > 0);

// A holder who is away.
told = [];
clock.t += 7 * HOUR;
online = online.filter(function (a) { return a !== HULDA.a; });
r = pick(EVE);
yes('K14 a pick after the same picker\'s window counts again: "' + r + '"', r === 'new');
clock.t += 30 * MIN;
tick();
yes('K15 Hulda is away, so the word waits', toldTo(HULDA).length === 0 && book().filter(function (x) { return !x.sent; }).length === 1);
clock.t += 3 * HOUR;
online.push(HULDA.a);
tick();
const later = toldTo(HULDA).length ? toldTo(HULDA)[0].line : '';
yes('K16 and reaches her when she is back, saying how long ago: "' + later + '"',
    toldTo(HULDA).length === 2 && /about 4 hours ago\./.test(later));

// ======================================================= X. not counted
told = [];
const before = JSON.stringify(book());
function refused(what, got, pattern) {
  yes(what + ': "' + got + '"', pattern.test(got) && JSON.stringify(book()) === before);
}
clock.t += 7 * HOUR;
refused('X1 a report naming no door does not count', pick(EVE, 'zz'), /named no door/);
refused('X2 nor one naming something that is not a door of a building', pick(EVE, '7777'), /not a door of a building/);
refused('X3 nor the inside door, a way out', pick(EVE, hex(DOOR_IN)), /way out/);
refused('X4 nor a building that is not locked', pick(EVE, hex(SHOP_DOOR)), /not locked/);
refused('X5 nor a building nobody holds', pick(EVE, hex(NOHOLD_DOOR)), /held by nobody/);
refused('X6 nor somebody carrying its key', pick(CAROL), /may go through/);
refused('X7 nor its holder', pick(HULDA), /may go through/);
at(DAN, STREET, [5000, 0, 0]);
refused('X8 nor somebody nowhere near the door', pick(DAN), /not at that door/);
at(DAN, '99:Skyrim.esm', [0, 0, 0]);
refused('X9 nor somebody in another cell', pick(DAN), /not at that door/);
at(DAN, STREET, [50, 0, 0]);
inv(DAN).length = 0;
refused('X10 nor somebody with no lockpick', pick(DAN), /no lockpick/);
give(DAN, LOCKPICK, null, 1);
yes('X11 and the log says why for each, naming who reported it',
    logged.filter(function (l) { return /word: a pick reported by .* did not count:/.test(l); }).length >= 10);
yes('X12 a cell door is refused before anything else is asked',
    /if \(jailHoldOf\(desc\)\) \{ return no\('that is a cell door'\); \}/.test(propBlock));

// Already inside: a load door has taken the picker through by the time the report lands.
at(DAN, HOUSE, [10, 10, 0]);
r = pick(DAN);
yes('X13 somebody already inside the building counts: "' + r + '"', r === 'new');
at(DAN, STREET, [50, 0, 0]);

// ============================================================ L. limits
told = [];
r = pick(DAN);
yes('L1 the same person at the same building inside 6 hours counts once: "' + r + '"', r === 'same');
at(FIN, STREET, [30, 20, 0]);
r = pick(FIN);
w = book().filter(function (x) { return !x.sent; })[0];
yes('L2 a second person before the word has gone out is added to it: "' + r + '"',
    r === 'bundled' && w.count === 2 && w.by.join(',') === DAN.pid + ',' + FIN.pid &&
    w.looks.join(' / ') === 'an Orc man / a Khajiit man' && book().filter(function (x) { return !x.sent; }).length === 1);
at(GUS, STREET, [30, -20, 0]);
r = pick(GUS);
w = book().filter(function (x) { return !x.sent; })[0];
yes('L3 a race that is not one of the ten playable is no description at all: "' + r + '"',
    r === 'bundled' && w.count === 3 && w.looks.length === 2);
clock.t += 25 * MIN;
told = [];
tick();
const many = toldTo(HULDA).length ? toldTo(HULDA)[0].line : '';
yes('L4 the word says more than once, and who was seen: "' + many + '"',
    /more than once, the last time within the hour\./.test(many) &&
    /Those seen looked like an Orc man and a Khajiit man\./.test(many) &&
    many.indexOf('Dan') === -1 && many.indexOf('Fin') === -1 && many.indexOf('Gus') === -1);

// The day's cap and the queue, with bundling off so each pick is a word.
const rules = W.wordRules();
rules.bundle = false;
rules.pick.samePickerMinutes = 0;
let today = book().filter(function (x) { return x.kind === 'pick' && clock.t - x.at < DAY; }).length;
const results = [];
while (today < rules.perHolderPerDay) { results.push(pick(EVE)); today++; }
r = pick(EVE);
yes('L5 picks are held to ' + rules.perHolderPerDay + ' words a day for a holder: "' + r + '"',
    results.every(function (x) { return x === 'new'; }) && r === 'day');
const pendingNow = book().filter(function (x) { return !x.sent && x.holder === HULDA.pid; }).length;
rules.perHolderPerDay = 0;
rules.maxPending = pendingNow;
r = pick(EVE);
yes('L6 a perHolderPerDay of 0 is no limit, and maxPending still holds: "' + r + '"', r === 'full');
rules.maxPending = 20;
rules.pick.on = false;
r = pick(EVE);
yes('L7 with picks off, a pick is no word: "' + r + '"', r === 'off');
rules.pick.on = true;
rules.bundle = true;
rules.perHolderPerDay = 6;
rules.pick.samePickerMinutes = 360;
clock.t += 25 * MIN;
tick();

// ============================================================ D. a deed
told = [];
online = online.filter(function (a) { return a !== HULDA.a; });
inv(EVE).push({ baseId: idOf(DEED_DESC), count: 1, name: W.deedLabel(HOUSE) });
const sentBefore = book().length;
const PRESENTED = clock.t;
open(EVE, DOOR);
yes('D1 Eve presents the stolen deed at the door, and Honeyside is hers, exactly as before',
    held(HOUSE).by === EVE.pid && toldTo(EVE).some(function (t) { return /You present the deed at Honeyside/.test(t.line); }));
const dw = book().filter(function (x) { return x.kind === 'deed'; })[0];
yes('D2 a word for Hulda, the old holder, due 10 minutes later',
    book().length === sentBefore + 1 && !!dw && dw.holder === HULDA.pid && dw.building === HOUSE &&
    dw.due === PRESENTED + 10 * MIN && JSON.stringify(dw.by) === JSON.stringify([EVE.pid]));
yes('D3 and the log keeps who presented it, for whom',
    logged.some(function (l) { return /word: the deed to Honeyside presented by Eve \(profile 404\), for Hulda \(profile 101\): word goes to the holder/.test(l); }));
yes('D4 Hulda is not told at the moment', toldTo(HULDA).length === 0);
clock.t += 11 * MIN;
tick();
yes('D5 she is away, so it waits', toldTo(HULDA).length === 0 && !dw.sent);
online.push(HULDA.a);
clock.t += 2 * HOUR;
tick();
const deedLine = toldTo(HULDA).length ? toldTo(HULDA)[0].line : '';
yes('D6 and reaches her when she is back: "' + deedLine + '"',
    /the deed to Honeyside was presented at its door about 2 hours ago, and the register named somebody else as its holder\./.test(deedLine) &&
    /Whoever it was looked like a Nord woman\./.test(deedLine) && deedLine.indexOf('Eve') === -1);
yes('D7 the word decided nothing: Eve still holds it', held(HOUSE).by === EVE.pid);
// The deed is never capped by the day's limit.
rules.perHolderPerDay = 1;
inv(HULDA).push({ baseId: idOf(DEED_DESC), count: 1, name: W.deedLabel(HOUSE) });
open(HULDA, DOOR);
const toEve = book().filter(function (x) { return x.kind === 'deed' && x.holder === EVE.pid; });
yes('D8 a deed is never held back by the day\'s cap: Hulda takes it back and Eve is sent word',
    held(HOUSE).by === HULDA.pid && toEve.length === 1);
rules.perHolderPerDay = 6;
// The holder presenting their own deed is no word.
const n0 = book().length;
open(HULDA, DOOR);
yes('D9 the holder carrying her own deed through her door sends nobody word', book().length === n0);
// A building no hold covers: word from a neighbour.
const hut = W.wordText({ kind: 'pick', building: NOHOLD, holder: 1, by: [], at: clock.t - 2 * DAY,
                         last: clock.t - 2 * DAY, count: 1, due: 1, looks: [], sent: 0 }, clock.t);
yes('D10 a building no hold covers sends word by a neighbour: "' + hut + '"',
    hut.indexOf('A neighbour finds you with word: ') === 0 && /2 days ago\./.test(hut) &&
    /Nobody here takes a side\. A grievance is for the court\./.test(hut));
yes('D11 the rough times read the way people say them',
    W.wordWhen(5 * MIN) === 'only a few minutes ago' && W.wordWhen(40 * MIN) === 'within the hour' &&
    W.wordWhen(70 * MIN) === 'about an hour ago' && W.wordWhen(5 * HOUR) === 'about 5 hours ago' &&
    W.wordWhen(30 * HOUR) === 'yesterday' && W.wordWhen(4 * DAY) === '4 days ago');

// ========================================================= S. the register
// One word waiting for somebody away, and rows that are not words.
online = online.filter(function (a) { return a !== EVE.a; });
clock.t += 1 * HOUR;
const waiting = JSON.parse(JSON.stringify(book().filter(function (x) { return !x.sent; })));
yes('S0 a word is waiting for Eve, who is away', waiting.length === 1 && waiting[0].holder === EVE.pid);
const reg = register();
yes('S1 the register on disk carries the word beside the claims', JSON.stringify(reg.word.list) === JSON.stringify(book()));
reg.word.list.push({ kind: 'shout', building: HOUSE, holder: 1, at: 1, due: 1 });
reg.word.list.push({ kind: 'pick', building: '__proto__', holder: 1, at: 1, due: 1 });
reg.word.list.push({ kind: 'pick', building: HOUSE, holder: 0, at: 1, due: 1 });
reg.word.list.push('not a word');
fs.writeFileSync(path.join(dir, 'private', 'property.json'), JSON.stringify(reg, null, 1));
box = boot();
W = box.__thornswoodProperty;
yes('S2 after a restart the waiting word is exactly as it was',
    JSON.stringify(W.wordBook().list.filter(function (x) { return !x.sent; })) === JSON.stringify(waiting));
yes('S3 the rows that are not words are dropped, and said so',
    W.wordBook().list.length === reg.word.list.length - 4 &&
    logged.some(function (l) { return /word: dropped 4 row\(s\) of the holders' word that were not words/.test(l); }));
yes('S4 and the claims came back with it', held(HOUSE).by === HULDA.pid && held(HOUSE).locked === true);
// Words that have gone out are pruned once the limits stop counting them.
clock.t += 7 * HOUR;
tick();
yes('S5 words that went out more than a day and 6 hours ago are pruned',
    W.wordBook().list.every(function (x) { return !x.sent || clock.t - x.sent < DAY; }));
clock.t += 15 * DAY;
tick();
yes('S6 a word that could not reach its holder in 14 days is dropped, and said so',
    W.wordBook().list.length === 0 &&
    logged.some(function (l) { return /word: the deed word about Honeyside for profile 404 did not reach them in 14 days and is dropped/.test(l); }));
yes('S7 and the register is written without them', register().word.list.length === 0);

// ======================================================= U. the staff data
const file = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
const R0 = W.wordRules();
yes('U1 the rules are the real game/data/property-word.json',
    R0.pick.delayMinutes === file.pick.delayMinutes && R0.deed.delayMinutes === file.deed.delayMinutes &&
    R0.perHolderPerDay === file.perHolderPerDay && R0.maxPending === file.maxPending &&
    R0.keepDays === file.keepDays && R0.reach === file.reach && R0.everySeconds === file.everySeconds &&
    R0.pick.samePickerMinutes === file.pick.samePickerMinutes && R0.needLockpick === file.needLockpick);
yes('U2 and the file says the same as the defaults the block falls back on',
    JSON.stringify(W.WORD_DEFAULTS.pick) === JSON.stringify(file.pick) &&
    JSON.stringify(W.WORD_DEFAULTS.deed) === JSON.stringify(file.deed) &&
    ['bundle', 'perHolderPerDay', 'maxPending', 'keepDays', 'reach', 'needLockpick', 'everySeconds']
      .every(function (k) { return W.WORD_DEFAULTS[k] === file[k]; }));
dir = newDir('bad', JSON.stringify({ pick: { delayMinutes: -1, on: 'yes' }, deed: 5, reach: 'far', keepDays: 3 }));
box = boot();
W = box.__thornswoodProperty;
const RB = W.wordRules();
yes('U3 wrong keys keep the defaults and the right ones are used',
    RB.pick.delayMinutes === 20 && RB.pick.on === true && RB.deed.delayMinutes === 10 && RB.reach === 400 && RB.keepDays === 3);
yes('U4 and the log says which were wrong',
    logged.some(function (l) { return /word: property-word\.json has pick\.on, pick\.delayMinutes, deed, reach wrong/.test(l); }));
dir = newDir('none', null);
box = boot();
W = box.__thornswoodProperty;
yes('U5 with no file, the defaults, and the log says so',
    JSON.stringify(W.wordRules()) === JSON.stringify(W.WORD_DEFAULTS) &&
    logged.some(function (l) { return /word: game\/data\/property-word\.json would not read, so the limits are the defaults/.test(l); }));

// ======================================================= the chat block
yes('W1 the chat block hands /tspicked to the property block, for a character in the world',
    /if \(word === '\/tspicked'\) \{\n\s+if \(!needCharacter\(\)\) \{ return; \}\n\s+var propPick = g\.__thornswoodProperty;/.test(gm));
yes('W2 it is a word the server answers, and a moment that is never held for later',
    /'\/tspicks',\n[^\n]*\n[^\n]*\n\s+'\/tspicked',/.test(gm) &&
    /var MOMENTS = \[[^\]]*'\/tspicked'[^\]]*\];/.test(gm));
yes('W3 commands.md lists it among the lines the game sends itself',
    /\| `\/tspicked <id>` \| The front plugin \|/.test(fs.readFileSync(path.join(REPO_DIR, 'docs', 'systems', 'commands.md'), 'utf8')));

// ======================================================= C. the client half
function lift(name) {
  const a = gm.indexOf('  function ' + name + '() {');
  if (a < 0) { return null; }
  const b = gm.indexOf('\n  }', a);
  return b > 0 ? gm.slice(a, b + 4) : null;
}
const builder = lift('lockScript');
const everyM = /var LOCK_EVERY_MS = (\d+);/.exec(gm);
yes('C0 the lock script is in the gamemode', !!builder && !!everyM);
if (builder && everyM) {
  const body = new Function('LOCK_EVERY_MS', builder + '\nreturn lockScript();')(Number(everyM[1]));
  const A = 0x111;
  const seen = [];
  const sp = {
    Game: { getFormEx: function (id) { return { id: id }; } },
    ObjectReference: {
      from: function (f) {
        return {
          lock: function (on) {
            const pub = global.__thornswoodPropertyShut;
            seen.push({ on: !!on, listed: !!(pub && pub[f.id]) });
          },
          isLocked: function () { return true; }
        };
      }
    }
  };
  global.__thornswoodPropertyShut = { [A]: true };
  new Function('ctx', 'Date', body)({ value: { shut: [], open: [A], at: 2 }, state: {}, sp: sp }, { now: function () { return 1; } });
  yes('C1 the lock script takes a door off the published list before it opens it',
      seen.length === 1 && seen[0].on === false && seen[0].listed === false);
  yes('C2 and the list it publishes after no longer has it', !global.__thornswoodPropertyShut[A]);
  delete global.__thornswoodPropertyShut;
}

const ha = front.indexOf('  const pickSaid = {};');
const hb = front.indexOf("  sp.on('lockChanged'", ha);
const hc = front.indexOf('\n  }));\n', hb);
yes('C3 the front plugin\'s lockChanged handler is found', ha >= 0 && hb > ha && hc > hb);
if (ha >= 0 && hb > ha && hc > hb) {
  const code = front.slice(ha, hc + 6);
  let handler = null;
  const sent = [];
  const fakeSp = { on: function (n, f) { if (n === 'lockChanged') { handler = f; } } };
  new Function('sp', 'guard', 'say', 'tellServer', code)(
    fakeSp, function (n, f) { return f; }, function () { }, function (l) { sent.push(l); });
  function lockedObject(id, type, locked) {
    return { lockedObject: {
      isLocked: function () { return locked; },
      getBaseObject: function () { return { getType: function () { return type; } }; },
      getFormID: function () { return id; },
      blockActivation: function () { }
    } };
  }
  const D = 0x1a2b3, X = 0x55555;
  global.__thornswoodPropertyShut = { [D]: true };
  handler(lockedObject(D, 29, false));
  yes('C4 a door on the list that opens is reported once as /tspicked with its id: ' + JSON.stringify(sent),
      sent.length === 1 && sent[0] === '/tspicked 1a2b3');
  handler(lockedObject(D, 29, false));
  yes('C5 the same door again within 10 seconds is not reported twice', sent.length === 1);
  handler(lockedObject(X, 29, false));
  yes('C6 a door that is not on the list is not reported', sent.length === 1);
  global.__thornswoodPropertyShut[X] = true;
  handler(lockedObject(X, 28, false));
  yes('C7 nor a chest', sent.length === 1);
  handler(lockedObject(X, 29, true));
  yes('C8 nor a door that locked', sent.length === 1);
  delete global.__thornswoodPropertyShut;
}
yes('C9 the plugin sends it on the channel /tspicks uses', /tellServer\('\/tspicked ' \+ id\.toString\(16\)\);/.test(front));

done();
