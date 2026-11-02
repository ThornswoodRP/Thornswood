// test-1603-beds.js
//
// #1603, after #1392 and #1607. Who may sleep in a bed, how long a night is,
// what a bed nobody holds gives, and resting by sitting down.
//
// Patrick's answers on #1603, 4 Oct. The holder names who may sleep there,
// with buttons and GUI and not commands: a key on the look prompt while
// looking at somebody inside the building, and a Stop beside each guest on
// the property page of the K panel. A night is 8 hours. The server sells no
// night: "they pay from a regular trade and then the owner can grant bed
// access", so /bed, its price and the two-step /rest bed payment are gone,
// and gold #1392 kept for a holder who was away is handed over once. And the
// rest ladder, "use some common sense": a seat 20, a bed or bedroll nobody
// can lend you 25, a seat by a fire 35, that bed by a fire 45, a bed you are
// allowed in 50, your own bed 80. A key or the deed still counts as allowed.
// /rest is the plugin's, sent when somebody sits or lies down, and what
// counts is what the server saw them press, never the word (#1607 too).
//
// This runs the REAL property block and the REAL needs block out of
// gamemode.js over a stand-in mp, a clock turned by hand and a temp folder,
// so the book can be read back after a pretend restart. The /rest branch of
// the chat commands, the property page of the character block, the sleep key
// of the front plugin and the guest list of the K panel are lifted and run as
// they stand.
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
const read = function (p) { return fs.readFileSync(p, 'utf8').split(CR).join(''); };
const gm = require('./gamemode-tables.js').joined(read(SRC));
const front = read(path.join(ROOT, 'game', 'plugins', 'thornswood-front.js'));
const skills = read(path.join(ROOT, 'game', 'ui', 'thornswood-skills.js'));

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
/* One function by its whole first line, only if that line is there once. */
function liftFrom(src, first, indent) {
  const from = '\n' + indent + first;
  const a = src.indexOf(from);
  if (a < 0 || src.indexOf(from, a + 1) >= 0) { return null; }
  const end = '\n' + indent + '}\n';
  const b = src.indexOf(end, a + 1);
  return b < 0 ? null : src.slice(a + 1, b + end.length);
}

const propBlock = slice('// ==== thornswood property ====', '// ==== end thornswood property ====');
const needsA = '// ==== thornswood needs: hunger, thirst and exhaustion ====';
const needsBlock = slice(needsA, '// ==== end thornswood needs ====');
// The whole /rest branch of handle() since #1631 took /needs, /eat, /drink
// and /bard out of it: /rest is the only word it answers now.
const restBranch = slice("    if (word === '/rest') {\n", "\n    }\n");
const charBlock = slice('// ==== thornswood character ====', '// ==== end thornswood character ====');
const socialBlock = slice('// ==== thornswood social', '// ==== end thornswood social ====');
yes('the property, needs, character and social blocks and the /rest branch are in the gamemode',
    !!propBlock && !!needsBlock && !!restBranch && !!charBlock && !!socialBlock);
if (!propBlock || !needsBlock || !restBranch || !charBlock || !socialBlock) { done(); }

// ------------------------------------------------------------ the wiring --

const onAct = slice("mp.onActivate = guard('onActivate', function (refrId, casterRefrId) {", '\n});\n');
yes('W1 onActivate hands every press to the beds, with the furniture and its base',
    !!onAct && /beds\.touched\(casterRefrId, refrId, baseDesc\)/.test(onAct));
function arrayOf(name) {
  const m = new RegExp('^const ' + name + ' = (\\[[\\s\\S]*?\\]);$', 'm').exec(gm);
  if (!m) { return null; }
  try { return new Function('return ' + m[1])(); } catch (e) { return null; }
}
const WORDS = arrayOf('WORDS');
const PLAYER_WORDS = arrayOf('PLAYER_WORDS');
yes('W2 /bed is gone: the server does not answer it and nobody is told of it',
    !!WORDS && WORDS.indexOf('/bed') === -1 && !!PLAYER_WORDS && PLAYER_WORDS.indexOf('/bed') === -1 &&
    !/function bedCmd\(/.test(gm) && !/word === '\/bed'/.test(gm));
yes('W2 /rest and /sleephere are answered, and neither is in the list anybody is told of',
    WORDS.indexOf('/rest') !== -1 && WORDS.indexOf('/sleephere') !== -1 &&
    PLAYER_WORDS.indexOf('/rest') === -1 && PLAYER_WORDS.indexOf('/sleephere') === -1);
yes('W3 the character block hands /sleephere to the property block, and the property block answers it',
    /word === '\/rent' \|\| word === '\/sleephere' \|\|/.test(charBlock) &&
    /if \(word === '\/sleephere'\) \{ return sleepHere\(parts, actorId, profileId, toProfile\); \}/.test(propBlock));
yes('W4 every /rest goes to the beds, and the typed word never reaches the meter',
    /beds\.rest\(actorId, Number\(profileId\) \|\| 0\)/.test(restBranch) &&
    !/needs\.resting\(actorId, where\)/.test(restBranch));
{
  // Every quoted string in the gamemode: none tells anybody to type /bed or
  // /rest. The launcher's Help page was held to the same until it went (#3146).
  const strings = (gm.match(/'(?:[^'\\\n]|\\.)*'/g) || []).filter(function (s) {
    return /\/bed\b|\/rest (sit|bed|campfire|inn|up)\b/.test(s);
  });
  yes('W5 no line the server says names /bed or a /rest word' + (strings.length ? ' (' + strings.slice(0, 3).join(' | ') + ')' : ''),
      strings.length === 0);
}
yes('W6 the look prompt\'s near list carries the sleep mark from the beds',
    /s: \(beds && beds\.mark\) \? beds\.mark\(me\.pid, them\.pid, me\.cell\) : 0/.test(socialBlock));
yes('W7 the property page carries each held place\'s guests and its building',
    /keyed: W\.holdsKey\(actorId, b\), b: b,\s*\n\s*sleep: \(B && B\.guestsOf\) \? B\.guestsOf\(b\) : \[\] \}\);/.test(charBlock));

// ------------------------------------------------------------ the world --

const HOUR = 3600000;
const clock = { t: Date.UTC(2026, 9, 4, 20, 0, 0) };
class FakeDate extends Date { static now() { return clock.t; } }

const INN = '1a2b3:Skyrim.esm';
const HOME = '16778:Skyrim.esm';
const HALL = '165a3:Skyrim.esm';
const TUNDRA = '3c:Skyrim.esm';
const BUILDING_NAME = {};
BUILDING_NAME[INN] = 'The Bannered Mare';
BUILDING_NAME[HOME] = 'Honeyside';
BUILDING_NAME[HALL] = 'Dragonsreach';
const BUILDING_BY_DOOR = { '1001:Skyrim.esm': INN, '1002:Skyrim.esm': HOME, '1003:Skyrim.esm': HALL };

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
function bytes(s) { const out = []; for (let i = 0; i < s.length; i++) { out.push(s.charCodeAt(i)); } out.push(0); return out; }

const BED = 'b001:Skyrim.esm';        // CommonBedDouble01
const BED_FIELDS = 'b006:Skyrim.esm'; // an editor id only in the EDID field
const ROLL = 'b002:Skyrim.esm';       // BedRoll01
const CHAIR = 'b003:Skyrim.esm';      // CommonChair01
const SIDE = 'b004:Skyrim.esm';       // a FURN with bed in its name that is not one
const CHEST = 'b005:Skyrim.esm';      // a container called a bed chest
const BENCH = 'b007:Skyrim.esm';      // NobleBench01
const LAB = 'b008:Skyrim.esm';        // CraftingAlchemyWorkbench, a bench to the letters
const BLOCK = 'b009:Skyrim.esm';      // WoodChoppingBlock
const STOOL = 'b00a:Skyrim.esm';      // CommonStool01
const THRONE = 'b00b:Skyrim.esm';     // NobleThrone01
const RECORDS = {};
function furn(desc, edid, inFields) {
  RECORDS[idOf(desc)] = { record: inFields
    ? { type: 'FURN', fields: [{ type: 'EDID', data: bytes(edid) }] }
    : { type: 'FURN', editorId: edid, fields: [] } };
}
furn(BED, 'CommonBedDouble01');
furn(BED_FIELDS, 'NobleBedSingle01', true);
furn(ROLL, 'BedRoll01');
furn(CHAIR, 'CommonChair01');
furn(SIDE, 'NobleBedsideLean01');
furn(BENCH, 'NobleBench01');
furn(LAB, 'CraftingAlchemyWorkbench');
furn(BLOCK, 'WoodChoppingBlock');
furn(STOOL, 'CommonStool01', true);
furn(THRONE, 'NobleThrone01');
RECORDS[idOf(CHEST)] = { record: { type: 'CONT', editorId: 'NobleBedChest01', fields: [] } };

const GOLD = 0x0000000f;
// People: actor, profile, name.
const HULDA = { a: 0xff000101, pid: 101, name: 'Hulda' };   // holds the inn
const ALICE = { a: 0xff000202, pid: 202, name: 'Alice' };   // holds Honeyside
const BOB = { a: 0xff000303, pid: 303, name: 'Bob' };       // a guest, if Hulda says so
const CAROL = { a: 0xff000404, pid: 404, name: 'Carol' };   // carries a key to the inn
const DAVE = { a: 0xff000505, pid: 505, name: 'Dave' };     // carries the inn's deed
const EVE = { a: 0xff000606, pid: 606, name: 'Eve' };       // a stranger
const PEOPLE = [HULDA, ALICE, BOB, CAROL, DAVE, EVE];

// Placed things: the furniture, its base, its cell and where it stands.
const INN_BED = 0x00a00001, INN_BED2 = 0x00a00002, INN_ROLL = 0x00a00003, HOME_BED = 0x00a00004;
const HALL_BED = 0x00a00005, ROAD_ROLL = 0x00a00006, ROAD_BED = 0x00a00007, INN_CHAIR = 0x00a00008;
const INN_LAB = 0x00a00009, ROAD_BLOCK = 0x00a0000a, INN_BENCH = 0x00a0000b;

const KEY_DESC = (/var KEY = '([^']+:Thornswood-Content\.esp)';/.exec(propBlock) || [])[1];
const DEED_DESC = (/var DEED = '([^']+:Thornswood-Content\.esp)';/.exec(propBlock) || [])[1];
yes('the key and deed records are read out of the property block', !!KEY_DESC && !!DEED_DESC);

function world() {
  const refs = {};
  function place(id, base, cell, pos) { refs[id] = { baseDesc: base, worldOrCellDesc: cell, pos: pos }; }
  place(INN_BED, BED, INN, [0, 0, 0]);
  place(INN_BED2, BED_FIELDS, INN, [1000, 0, 0]);
  place(INN_ROLL, ROLL, INN, [0, 1000, 0]);
  place(HOME_BED, BED, HOME, [0, 0, 0]);
  place(HALL_BED, BED, HALL, [0, 0, 0]);
  place(ROAD_ROLL, ROLL, TUNDRA, [50000, 50000, 0]);
  place(ROAD_BED, BED, TUNDRA, [60000, 50000, 0]);
  place(INN_CHAIR, CHAIR, INN, [2000, 0, 0]);
  place(INN_BENCH, BENCH, INN, [2000, 2000, 0]);
  place(INN_LAB, LAB, INN, [3000, 0, 0]);
  place(ROAD_BLOCK, BLOCK, TUNDRA, [70000, 50000, 0]);
  const gold = { 101: 0, 202: 0, 303: 100, 404: 0, 505: 5, 606: 50 };
  PEOPLE.forEach(function (p) {
    const entries = [];
    if (gold[p.pid]) { entries.push({ baseId: GOLD, count: gold[p.pid] }); }
    if (p === CAROL) { entries.push({ baseId: idOf(KEY_DESC), count: 1, name: 'Key to The Bannered Mare' }); }
    if (p === DAVE) { entries.push({ baseId: idOf(DEED_DESC), count: 1, name: 'Deed to The Bannered Mare' }); }
    refs[p.a] = { profileId: p.pid, appearance: { name: p.name }, worldOrCellDesc: TUNDRA,
                  pos: [90000, 90000, 0], inventory: { entries: entries } };
  });
  return refs;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-1603-beds-'));
fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
fs.mkdirSync(path.join(dir, 'private'));
fs.writeFileSync(path.join(dir, 'private', 'property.json'), JSON.stringify({ claims: {
  [INN]: { by: HULDA.pid, name: 'Hulda', at: clock.t, touched: clock.t },
  [HOME]: { by: ALICE.pid, name: 'Alice', at: clock.t, touched: clock.t }
} }));
/*
  THE BOOK. Eve a guest at the inn an hour ago, of its holder Hulda, and 20
  gold kept for Hulda while she was away. And the prices and paid nights
  #1392's book held, which are not read (#3265): Carol's night there would
  have made her a guest. Read by the first boot below.
*/
const BOOK = path.join(dir, 'private', 'beds.json');
const BOOK_TEXT = JSON.stringify({
  guests: { [INN]: { [EVE.pid]: { by: HULDA.pid, at: clock.t - HOUR, name: '' } } },
  takings: { [HULDA.pid]: 20 },
  prices: { [INN]: { by: HULDA.pid, price: 20 } },
  nights: { [INN]: { [CAROL.pid]: clock.t - HOUR } }
});
fs.writeFileSync(BOOK, BOOK_TEXT);

let refs = world();
let online = PEOPLE.map(function (p) { return p.a; });
let told = [];
let ticks = [];
let redraws = [];

function needsRig() {
  const store = {};
  const g = {};
  const fake = {
    makeProperty: function () { },
    get: function (id, key) { if (id === 0 && key === 'onlinePlayers') { return online.slice(); }
      if (key === 'worldOrCellDesc') { return refs[id] ? refs[id].worldOrCellDesc : ''; }
      return store[id];
    },
    set: function (id, key, v) { store[id] = v; }
  };
  const fn = new Function('globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
    'guard', 'notify', 'say', needsBlock + '\nreturn globalThis.__thornswoodNeeds;');
  return fn(g, fake, FakeDate, { log: function () { } }, function () { return 0; }, function () { },
            function (n, f) { return f; }, function () { }, function () { });
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
    lookupEspmRecordById: function (id) { return RECORDS[id] || null; }
  };
  const box = {
    console: { log: function () { } }, require: require, mp: mp, Date: FakeDate,
    BUILDING_BY_DOOR: BUILDING_BY_DOOR, BUILDING_NAME: BUILDING_NAME, WAY_OUT: {},
    idOf: idOf,
    notify: function () { },
    say: function (id, text) { told.push({ id: id, text: text }); },
    guard: function (n, f) { return f; },
    setInterval: function (f, ms) { ticks.push({ f: f, ms: ms }); return ticks.length; },
    clearInterval: function () { },
    log: function () { },
    __thornswoodNeeds: needs,
    // The K panel's writer, so a redraw of the holder's page can be counted.
    __thornswoodCharacter: {
      stateOf: function () { return { v: 1 }; },
      writeState: function (actorId) { redraws.push(actorId); }
    }
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

let needs = needsRig();
let box = inDir(function () { return boot(needs); });
const first = box.__thornswoodBeds;
yes('the property block publishes the beds',
    !!first && typeof first.rest === 'function' && typeof first.sleepHere === 'function' &&
    typeof first.mark === 'function' && typeof first.guestsOf === 'function' && !first.command);
if (!first || !box.__thornswoodProperty) { done(); }
const NIGHT_MS = first.NIGHT_MS;
yes('a night is 8 hours (Patrick, #1603)', NIGHT_MS === 8 * HOUR);
yes('the beds watch on a timer of their own', ticks.some(function (t) { return t.ms === first.BED_EVERY_MS; }));

function beds() { return box.__thornswoodBeds; }
function standAt(p, cell, pos) { refs[p.a].worldOrCellDesc = cell; refs[p.a].pos = pos.slice(); }
function standBy(p, ref) { standAt(p, refs[ref].worldOrCellDesc, refs[ref].pos); }
function press(p, ref) { beds().touched(p.a, ref, refs[ref].baseDesc); }
const every = [];
function heard(s) { every.push(s); return s; }
function rest(p, word) {
  const out = [];
  const run = new Function('globalThis', 'needs', 'parts', 'actorId', 'profileId', 'toProfile',
    'var word = "/rest";\nfunction needCharacter() { return true; }\n' + restBranch + '\nreturn false;');
  inDir(function () {
    run(box, needs, ['/rest'].concat(word ? [word] : []), p.a, p.pid, function (pid, m) { out.push(m); });
  });
  return heard(out.join('\n'));
}
function sleepHere(p, args) {
  const out = [];
  inDir(function () {
    box.__thornswoodProperty.command('/sleephere', ['/sleephere'].concat(args), p.a, p.pid,
                                     function (pid, m) { out.push(m); });
  });
  return heard(out.join('\n'));
}
function letSleep(holder, guest) { return sleepHere(holder, [guest.a.toString(16)]); }
function tick() { inDir(function () { beds().tick(); }); }
function goldOf(p) {
  return (refs[p.a].inventory.entries || []).reduce(function (s, e) { return s + (e.baseId === GOLD ? e.count : 0); }, 0);
}
function allGold() { return PEOPLE.reduce(function (s, p) { return s + goldOf(p); }, 0); }
function restingOf(p) { return needs.settle(p.a).resting; }
function lastTold(p) {
  for (let i = told.length - 1; i >= 0; i--) { if (told[i].id === p.a) { return heard(told[i].text); } }
  return '';
}
// The client's warmth report: a fire this far away, or none.
function fireAt(p, away) { needs.place(p.a, '', '-', '0', '1', '0', away === null ? '-' : String(away)); }
function up(p) { return rest(p, 'up'); }

// ----------------------------------------------------------- the book --

{
  const book = first.book();
  yes('O1 the book is read as written: Eve is a guest of Hulda at the inn, to the same end',
      !!book.guests[INN] && !!book.guests[INN][EVE.pid] && book.guests[INN][EVE.pid].by === HULDA.pid &&
      book.guests[INN][EVE.pid].at === clock.t - HOUR);
  yes('O1 the gold kept for Hulda is still kept, for her', book.takings[HULDA.pid] === 20);
  yes('O1 a paid night of #1392\'s book is not read: Carol is no guest (#3265)', !book.guests[INN][CAROL.pid]);
  yes('O1 and the book is not written over as it is read', fs.readFileSync(BOOK, 'utf8') === BOOK_TEXT);
}

// --------------------------------------------------------- the ladder --

{
  const r = needs.NEEDS.recover;
  // common and commonfire are an inn or a temple nobody holds (#2246):
  // Patrick, 12 Oct 2026, 40 an hour and 45 by a fire.
  yes('L1 the rates are Patrick\'s ladder: seat 20, rough 25, campfire 35, camp 45, inn 50, own bed 80, inn or temple 40 (45 by a fire)',
      JSON.stringify(r) === JSON.stringify({ sit: 20, rough: 25, campfire: 35, camp: 45, inn: 50, bed: 80,
                                             common: 40, commonfire: 45 }));
  yes('L1 an inn or temple bed nobody holds sits above the road and under a bed you are allowed in',
      r.rough < r.common && r.common < r.inn && r.commonfire <= r.inn);
  yes('L1 and each rung is above the one under it',
      r.sit < r.rough && r.rough < r.campfire && r.campfire < r.camp && r.camp < r.inn && r.inn < r.bed);
}

// ------------------------------------------------------- what furniture is --

{
  const k = function (b) { return beds().kindOf(b); };
  yes('K1 a double bed is a bed, read off its editor id', k(BED) === 'bed');
  yes('K1 an editor id only in the EDID field still reads', k(BED_FIELDS) === 'bed');
  yes('K1 a bedroll is a bedroll', k(ROLL) === 'roll');
  yes('K1 a chair, a bench, a stool and a throne are seats',
      k(CHAIR) === 'seat' && k(BENCH) === 'seat' && k(STOOL) === 'seat' && k(THRONE) === 'seat');
  yes('K1 an alchemy workbench and a chopping block are furniture, not seats',
      k(LAB) === 'furn' && k(BLOCK) === 'furn');
  yes('K1 a bedside piece is furniture, not a bed', k(SIDE) === 'furn');
  yes('K1 a container is not furniture whatever it is called', k(CHEST) === '');
  yes('K1 a base the engine knows nothing of is nothing', k('ffff:Skyrim.esm') === '');
}

// --------------------------------- saying it in the street does not count --

{
  standAt(BOB, TUNDRA, [90000, 90000, 0]);
  ['bed', 'inn', 'bedroll', 'sit', 'campfire', ''].forEach(function (w) {
    const said = rest(BOB, w);
    yes('S1 /rest ' + (w || '(alone)') + ' said in the street is refused (got "' + said + '")',
        /nothing here to rest on/i.test(said) && restingOf(BOB) === '');
  });
  // #1607: a campfire with nothing pressed is still nothing, fire or not.
  fireAt(BOB, 50);
  yes('S1 /rest campfire beside a fire with no seat is refused (#1607)',
      /nothing here to rest on/i.test(rest(BOB, 'campfire')) && restingOf(BOB) === '');
  fireAt(BOB, null);
  standBy(HULDA, INN_BED);
  press(HULDA, INN_BED);
  standAt(HULDA, TUNDRA, [90000, 90000, 0]);
  yes('S1 a bed pressed and then walked away from does not count',
      /nothing here to rest on/i.test(rest(HULDA, 'bed')) && restingOf(HULDA) === '');
  standBy(EVE, INN_CHAIR);
  press(EVE, INN_CHAIR);
  standAt(EVE, TUNDRA, [90000, 90000, 0]);
  yes('S1 a seat pressed and then walked away from does not count (#1607)',
      /nothing here to rest on/i.test(rest(EVE, 'sit')) && restingOf(EVE) === '');
}

// ----------------------------------------------------------- a seat --

{
  standBy(EVE, INN_CHAIR);
  press(EVE, INN_CHAIR);
  const sat = rest(EVE, 'sit');
  yes('T1 sitting down on a chair is a seat, 20', restingOf(EVE) === 'sit');
  yes('T1 and says nothing: people sit at every table, and the bar shows it', sat === '');
  up(EVE);
  rest(EVE, 'bed');
  yes('T1 the word does not matter: /rest bed on a chair is still the seat', restingOf(EVE) === 'sit');
  up(EVE);
  rest(EVE, 'campfire');
  yes('T1 and /rest campfire with no fire in reach is still the seat (#1607)', restingOf(EVE) === 'sit');
  fireAt(EVE, 120);
  tick();
  yes('T2 a fire reported in reach makes the seat a campfire, 35', restingOf(EVE) === 'campfire');
  fireAt(EVE, null);
  tick();
  yes('T2 and the fire out of reach makes it a seat again (#1607)', restingOf(EVE) === 'sit');
  standAt(EVE, TUNDRA, [90000, 90000, 0]);
  tick();
  yes('T3 getting off the seat stops the rest', restingOf(EVE) === '');
  yes('T3 and says why', /left the seat/.test(lastTold(EVE)));
  standBy(EVE, INN_BENCH);
  press(EVE, INN_BENCH);
  fireAt(EVE, 200);
  rest(EVE, 'sit');
  yes('T4 a bench by the hearth is a campfire from the moment you sit', restingOf(EVE) === 'campfire');
  const off = up(EVE);
  yes('T4 getting off a seat stops the rest and says nothing', off === '' && restingOf(EVE) === '');
  yes('T4 and getting up from nothing says nothing', up(EVE) === '');
  fireAt(EVE, null);
}

// ------------------------------------------- furniture that is not a rest --

{
  standBy(EVE, INN_LAB);
  press(EVE, INN_LAB);
  const lab = rest(EVE, 'sit');
  yes('F1 the plugin\'s sit at an alchemy workbench rests nobody and says nothing (got "' + lab + '")',
      lab === '' && restingOf(EVE) === '');
  standBy(EVE, ROAD_BLOCK);
  press(EVE, ROAD_BLOCK);
  yes('F1 nor at a chopping block', rest(EVE, 'sit') === '' && restingOf(EVE) === '');
  yes('F1 and getting off it says nothing either', up(EVE) === '');
}

// ------------------------------------------------- the holder's own bed --

{
  standBy(HULDA, INN_BED);
  press(HULDA, INN_BED);
  const lay = rest(HULDA, 'bed');
  yes('H1 the holder lies down in her own bed: 80', restingOf(HULDA) === 'bed' && /rest/i.test(lay));
  yes('H1 getting out of a bed says so', up(HULDA) === 'You get up.' && restingOf(HULDA) === '');
  rest(HULDA, 'inn');
  yes('H1 /rest inn in her own bed is still her own bed', restingOf(HULDA) === 'bed');
  up(HULDA);
  standBy(HULDA, INN_ROLL);
  press(HULDA, INN_ROLL);
  rest(HULDA, 'bed');
  yes('H1 a bedroll in her own building is her own bed: whose it is decides', restingOf(HULDA) === 'bed');
  up(HULDA);
}

// -------------------------------------------------- a stranger is refused --

{
  standBy(BOB, INN_BED);
  press(BOB, INN_BED);
  const before = allGold();
  const said = rest(BOB, 'bed');
  yes('R1 a stranger in somebody else\'s bed is refused (got "' + said + '")',
      /The Bannered Mare is Hulda's, and they have not let you sleep there/.test(said) && restingOf(BOB) === '');
  yes('R1 lying down again does not pay anything either', rest(BOB, 'bed') === said && allGold() === before &&
      goldOf(BOB) === 100);
}

// ------------------------------------------------ allowed: a key, a deed --

{
  standBy(CAROL, INN_BED);
  press(CAROL, INN_BED);
  rest(CAROL, 'bed');
  yes('A1 somebody carrying the key is allowed, at 50: not the holder\'s 80', restingOf(CAROL) === 'inn');
  up(CAROL);
  standBy(DAVE, INN_BED2);
  press(DAVE, INN_BED2);
  rest(DAVE, 'bed');
  yes('A1 somebody carrying the deed is allowed, at 50', restingOf(DAVE) === 'inn');
  up(DAVE);
}

// ------------------------------- THE LOOK PROMPT: let sleep here, and stop --

{
  standAt(HULDA, INN, [300, 300, 0]);
  standAt(BOB, INN, [400, 300, 0]);
  standAt(EVE, TUNDRA, [90000, 90000, 0]);
  yes('G1 the look prompt offers Hulda "Let sleep here" on Bob inside her inn',
      beds().mark(HULDA.pid, BOB.pid, INN) === 1);
  yes('G1 not to Bob on Hulda, who does not hold it', beds().mark(BOB.pid, HULDA.pid, INN) === 0);
  yes('G1 not to Hulda on herself', beds().mark(HULDA.pid, HULDA.pid, INN) === 0);
  yes('G1 not in a cell that is not hers', beds().mark(HULDA.pid, BOB.pid, TUNDRA) === 0 &&
      beds().mark(HULDA.pid, BOB.pid, HOME) === 0 && beds().mark(HULDA.pid, BOB.pid, HALL) === 0);

  const before = allGold();
  redraws = [];
  const said = letSleep(HULDA, BOB);
  yes('G2 the key lets Bob sleep there for one night (got "' + said + '")',
      /Bob may sleep at The Bannered Mare for one night, 8 hours from now/.test(said));
  yes('G2 Bob is told', /Hulda lets you sleep at The Bannered Mare tonight/.test(lastTold(BOB)));
  yes('G2 the prompt now offers to stop it', beds().mark(HULDA.pid, BOB.pid, INN) === 2);
  yes('G2 and her property page is drawn again', redraws.indexOf(HULDA.a) !== -1);
  const file = JSON.parse(fs.readFileSync(BOOK, 'utf8'));
  yes('G2 the guest is written down in beds.json, naming the holder who let him in',
      file.guests[INN][BOB.pid] && file.guests[INN][BOB.pid].by === HULDA.pid &&
      file.guests[INN][BOB.pid].name === 'Bob');
  standBy(BOB, INN_BED);
  press(BOB, INN_BED);
  rest(BOB, 'bed');
  yes('G3 Bob lies down and rests at a bed he is allowed in, 50', restingOf(BOB) === 'inn');
  yes('G3 and no gold moved: the night is paid in a trade', allGold() === before);
  up(BOB);
  standBy(BOB, INN_BED2);
  press(BOB, INN_BED2);
  rest(BOB, 'bed');
  yes('G3 any bed in the building the same night', restingOf(BOB) === 'inn');
  yes('G3 the K panel lists him under the inn, beside Eve\'s carried night, which has no name on the old book',
      JSON.stringify(beds().guestsOf(INN).map(function (x) { return x.name; })) ===
      JSON.stringify(['Bob', 'somebody who paid for the night']));

  // Pressed again on him: the night ends, and he gets up.
  standAt(HULDA, INN, [1300, 0, 0]);
  const stop = letSleep(HULDA, BOB);
  yes('G4 the same key on a guest ends his night (got "' + stop + '")',
      /Bob may no longer sleep at The Bannered Mare/.test(stop));
  yes('G4 he is got up and told why', restingOf(BOB) === '' &&
      /Hulda has stopped letting you sleep at The Bannered Mare/.test(lastTold(BOB)));
  yes('G4 and the prompt offers to let him again', beds().mark(HULDA.pid, BOB.pid, INN) === 1);
  yes('G4 his bed refuses him now', /have not let you sleep there/.test(rest(BOB, 'bed')));

  // The refusals.
  standAt(BOB, INN, [400, 300, 0]);
  yes('G5 only the holder lets people sleep there',
      /Only whoever holds The Bannered Mare/.test(letSleep(BOB, HULDA)));
  standAt(HULDA, TUNDRA, [80000, 80000, 0]);
  yes('G5 from outside any building she holds, nothing',
      /Stand inside a building you hold/.test(letSleep(HULDA, BOB)) && beds().mark(HULDA.pid, BOB.pid, INN) === 1);
  standAt(HULDA, INN, [300, 300, 0]);
  yes('G5 somebody who is not inside with her cannot be let in',
      /Look at somebody inside The Bannered Mare/.test(letSleep(HULDA, EVE)) &&
      !beds().book().guests[INN][EVE.pid + 1]);
  yes('G5 nor herself', /Look at somebody inside/.test(letSleep(HULDA, HULDA)));
  yes('G5 nor a form id that is nobody in the world',
      /Look at somebody inside/.test(sleepHere(HULDA, ['ff0fffff'])) &&
      /Look at somebody inside/.test(sleepHere(HULDA, ['zz'])) &&
      /Look at somebody inside/.test(sleepHere(HULDA, [])));
  online = online.filter(function (a) { return a !== BOB.a; });
  yes('G5 nor somebody who has left the world', /Look at somebody inside/.test(letSleep(HULDA, BOB)));
  online.push(BOB.a);
}

// ------------------------------------------------------ the night ends --

{
  standAt(HULDA, INN, [300, 300, 0]);
  standAt(BOB, INN, [400, 300, 0]);
  letSleep(HULDA, BOB);
  standBy(BOB, INN_BED);
  press(BOB, INN_BED);
  rest(BOB, 'bed');
  clock.t += 4 * HOUR;
  tick();
  yes('N1 four hours in, the night still holds', restingOf(BOB) === 'inn');
  redraws = [];
  clock.t += 4 * HOUR;
  tick();
  yes('N1 at 8 hours the night is over and the rest stops', restingOf(BOB) === '');
  yes('N1 and he is told the night is over', /Your night at The Bannered Mare is over/.test(lastTold(BOB)));
  yes('N1 the guest leaves the book and the holder\'s page is drawn again',
      !(beds().book().guests[INN] && beds().book().guests[INN][BOB.pid]) && redraws.indexOf(HULDA.a) !== -1);
  yes('N1 Eve\'s carried night ran out long before, too', beds().guestsOf(INN).length === 0);
  yes('N1 the prompt offers to let him again', beds().mark(HULDA.pid, BOB.pid, INN) === 1);
}

// ----------------------------------------------- the property page's Stop --

{
  standAt(HULDA, INN, [300, 300, 0]);
  standAt(BOB, INN, [400, 300, 0]);
  letSleep(HULDA, BOB);
  standAt(HULDA, TUNDRA, [80000, 80000, 0]);
  standAt(ALICE, HOME, [0, 0, 0]);
  yes('P1 somebody else\'s Stop is refused',
      /Only whoever holds The Bannered Mare/.test(sleepHere(ALICE, ['stop', String(BOB.pid), INN])) &&
      beds().mark(HULDA.pid, BOB.pid, INN) === 2);
  yes('P1 a Stop for nobody staying says so',
      /Nobody by that name is sleeping at The Bannered Mare/.test(sleepHere(HULDA, ['stop', String(EVE.pid), INN])));
  yes('P1 a Stop for a building that is nobody\'s is refused',
      /That is not a building you hold/.test(sleepHere(HULDA, ['stop', String(BOB.pid), 'nowhere'])));
  const said = sleepHere(HULDA, ['stop', String(BOB.pid), INN]);
  yes('P1 the holder\'s Stop ends the night from anywhere (got "' + said + '")',
      /Bob may no longer sleep at The Bannered Mare/.test(said) && beds().mark(HULDA.pid, BOB.pid, INN) === 1);
  yes('P1 and Bob is told', /Hulda has stopped letting you sleep at The Bannered Mare/.test(lastTold(BOB)));
}

// --------------------------------------------- a guest with a key stays --

{
  standAt(HULDA, INN, [300, 300, 0]);
  standAt(CAROL, INN, [400, 300, 0]);
  letSleep(HULDA, CAROL);
  standBy(CAROL, INN_BED);
  press(CAROL, INN_BED);
  rest(CAROL, 'bed');
  letSleep(HULDA, CAROL);
  yes('K2 ending the night of a guest who carries the key leaves her resting: the key still lets her',
      restingOf(CAROL) === 'inn');
  up(CAROL);
}

// ----------------------------------- a bed nobody holds, and the road --

{
  standBy(BOB, HALL_BED);
  press(BOB, HALL_BED);
  rest(BOB, 'bed');
  yes('U1 a bed in a building nobody holds is nobody\'s to lend: 25', restingOf(BOB) === 'rough');
  fireAt(BOB, 150);
  tick();
  yes('U1 with a fire in reach it is 45', restingOf(BOB) === 'camp');
  up(BOB);
  fireAt(BOB, null);
  standBy(BOB, ROAD_ROLL);
  press(BOB, ROAD_ROLL);
  rest(BOB, 'bed');
  yes('U2 a bedroll on the road is 25', restingOf(BOB) === 'rough');
  fireAt(BOB, 90);
  tick();
  yes('U2 a bedroll by a campfire is 45, better than the campfire\'s seat', restingOf(BOB) === 'camp' &&
      needs.NEEDS.recover.camp > needs.NEEDS.recover.campfire);
  fireAt(BOB, null);
  tick();
  yes('U2 and back to 25 when the fire is out of reach', restingOf(BOB) === 'rough');
  up(BOB);
  standBy(BOB, ROAD_BED);
  press(BOB, ROAD_BED);
  rest(BOB, 'bed');
  yes('U3 a bed out on the road is nobody\'s too, 25', restingOf(BOB) === 'rough');
  up(BOB);
}

// ------------------------------------------- a building changing hands --

{
  standAt(ALICE, HOME, [0, 0, 0]);
  standAt(EVE, HOME, [100, 0, 0]);
  letSleep(ALICE, EVE);
  yes('C1 Alice lets Eve sleep at Honeyside', beds().guestsOf(HOME).length === 1);
  box.__thornswoodProperty.claims()[HOME] = { by: BOB.pid, name: 'Bob', at: clock.t, touched: clock.t, locked: false };
  standBy(EVE, HOME_BED);
  press(EVE, HOME_BED);
  yes('C1 a building that changes hands does not keep the last holder\'s guests',
      /Honeyside is Bob's, and they have not let you sleep there/.test(rest(EVE, 'bed')) &&
      beds().guestsOf(HOME).length === 0 && beds().mark(BOB.pid, EVE.pid, HOME) === 1);
  standBy(ALICE, HOME_BED);
  press(ALICE, HOME_BED);
  yes('C1 and Alice is a stranger there now', /have not let you sleep there/.test(rest(ALICE, 'bed')));
}

// -------------------------------------------- the gold #1392 kept, once --

{
  // Hulda has been in the world all along in this test, so the first tick
  // already handed it over. Count from a fresh boot instead, below.
  yes('M1 the takings are handed to the holder on the first tick she is in the world',
      !beds().book().takings[HULDA.pid] && goldOf(HULDA) === 20);
  yes('M1 and she is told', told.some(function (t) {
    return t.id === HULDA.a && /20 gold was paid for nights in your beds/.test(t.text);
  }));
}

// ------------------------------------------------------- a restart --

{
  standAt(HULDA, INN, [300, 300, 0]);
  standAt(BOB, INN, [400, 300, 0]);
  letSleep(HULDA, BOB);
  standBy(BOB, INN_BED);
  press(BOB, INN_BED);
  rest(BOB, 'bed');
  standBy(EVE, INN_CHAIR);
  press(EVE, INN_CHAIR);
  rest(EVE, 'sit');
  const firstBox = box;
  ticks = [];
  told = [];
  delete box.__thornswoodBedState;
  box = inDir(function () { return boot(needs); });
  yes('Z1 the restart is a second server', box.__thornswoodBeds !== firstBox.__thornswoodBeds);
  yes('Z1 Bob is still Hulda\'s guest after it', beds().mark(HULDA.pid, BOB.pid, INN) === 2);
  tick();
  yes('Z1 somebody resting in a bed the server did not see them take gets up', restingOf(BOB) === '');
  yes('Z1 and so does somebody on a seat', restingOf(EVE) === '');
  press(BOB, INN_BED);
  rest(BOB, 'bed');
  yes('Z1 lying down again counts, the night still his', restingOf(BOB) === 'inn');
  const before = goldOf(HULDA);
  tick();
  yes('Z1 and the kept gold is not handed twice', goldOf(HULDA) === before);
  up(BOB);
}

// ------------------------------------------------------- the client --

{
  yes('X1 the sleep key is the mold\'s key, armed only on a person', /(?:const|let) SLEEP_KEY {3}= MOLD_KEY;/.test(front) &&
      /if \(e\.code === MOLD_KEY && moldPress\(\)\) \{ return; \}\n(\s*\/\/[^\n]*\n)*\s*if \(e\.code === SLEEP_KEY && sleepPress\(\)\) \{ return; \}/.test(front));
  yes('X1 the prompt draws Let sleep here or Stop letting sleep here from the server\'s mark',
      /\(row\.s \? keyRow\(SLEEP_NAME, row\.s === 2 \? 'Stop letting sleep here' : 'Let sleep here',/.test(front) &&
      /row\.y \+ '\|' \+ \(row\.s \|\| 0\)/.test(front));
  const sp = liftFrom(front, 'function sleepPress() {', '  ');
  yes('X2 the key\'s press is in the plugin', !!sp);
  if (sp) {
    const sent = [];
    const state = { lookingAt: '', chat: false, busy: '', near: {} };
    const run = function () {
      return new Function('lookingAt', 'claims', 'busyMenuOpenNow', 'nearList', 'lookVerb',
        sp + '\nreturn sleepPress();')(state.lookingAt, { chat: state.chat },
        function () { return state.busy; }, function () { return state.near; },
        function (v) { sent.push(v); return true; });
    };
    yes('X2 nobody under the crosshair: the key falls through', run() === false && !sent.length);
    state.lookingAt = 'ff000303';
    state.near = { ff000303: { n: 'Bob', s: 0 } };
    yes('X2 somebody the server does not offer: it falls through', run() === false && !sent.length);
    state.near.ff000303.s = 1;
    state.chat = true;
    yes('X2 not while the chat holds the keyboard', run() === false && !sent.length);
    state.chat = false;
    state.busy = 'InventoryMenu';
    yes('X2 not over a menu', run() === false && !sent.length);
    state.busy = '';
    yes('X2 offered: it sends /sleephere for the person looked at', run() === true &&
        sent.join(',') === 'sleephere');
    state.near.ff000303.s = 2;
    yes('X2 and the same for a guest, to end the night', run() === true && sent.length === 2);
  }
  yes('X3 the plugin says /rest bed at a bed and /rest sit at any other furniture, and /rest up off it',
      /tellServer\(bed \? '\/rest bed' : '\/rest sit'\)/.test(front) && /tellServer\('\/rest up'\)/.test(front));
}

// ------------------------------------------------------- the K panel --

{
  const dg = liftFrom(skills, 'function drawGuests(card, r) {', '  ');
  yes('Y1 the property page draws tonight\'s guests', !!dg && /if \(r\.mine\) drawGuests\(card, r\);/.test(skills));
  if (dg) {
    function Node(tag, cls, text) { this.tag = tag; this.className = cls || ''; this.textContent = text || ''; this.kids = []; }
    Node.prototype.appendChild = function (c) { this.kids.push(c); return c; };
    const el = function (tag, cls, text) { return new Node(tag, cls, text); };
    const said = [];
    const win = { thornswoodNet: { say: function (l) { said.push(l); return true; } } };
    const draw = new Function('el', 'window', dg + '\nreturn drawGuests;')(el, win);
    const card = new Node('div', 'card');
    draw(card, { name: 'The Bannered Mare', mine: true, b: INN, sleep: [{ pid: 303, name: 'Bob' }] });
    const rows = card.kids.filter(function (k) { return k.className === 'guest'; });
    yes('Y1 one row a guest, with the name and a Stop', rows.length === 1 && rows[0].kids[0].textContent === 'Bob' &&
        rows[0].kids[1].textContent === 'Stop');
    rows[0].kids[1].onclick({ stopPropagation: function () { } });
    yes('Y1 Stop sends /sleephere stop with the profile and the building',
        said.join('|') === '/sleephere stop 303 ' + INN);
    const empty = new Node('div', 'card');
    draw(empty, { name: 'Honeyside', mine: true, b: HOME, sleep: [] });
    yes('Y2 with nobody tonight it says how to let somebody, and sends nothing',
        empty.kids.length === 1 && /press the key the prompt shows/.test(empty.kids[0].textContent) && said.length === 1);
    every.push(card.kids[0].textContent, empty.kids[0].textContent);
  }
  const pv = liftFrom(charBlock, 'function propertyView(actorId, profileId) {', '  ');
  yes('Y3 the character block\'s property page is in the gamemode', !!pv);
  if (pv) {
    standAt(HULDA, INN, [300, 300, 0]);
    standAt(BOB, INN, [400, 300, 0]);
    // Still his night from the restart above; pressing again would end it.
    if (beds().mark(HULDA.pid, BOB.pid, INN) !== 2) { letSleep(HULDA, BOB); }
    let threw = '';
    const max = (/var PROPERTY_PAGE_MAX = (\d+);/.exec(charBlock) || [])[1];
    const view = new Function('g', 'mp', 'idOf', 'BUILDING_NAME', 'clog',
      'var PROPERTY_PAGE_MAX = ' + Number(max) + ';\n' + pv + '\nreturn propertyView;')(
      box, box.mp, idOf, BUILDING_NAME, function (a, e) { threw = String(e && e.stack || e); })(HULDA.a, HULDA.pid);
    if (threw) { console.log('      ' + threw.split('\n')[0]); }
    const inn = (view || []).filter(function (r) { return r.name === 'The Bannered Mare'; })[0];
    yes('Y3 Hulda\'s row for the inn carries the building and Bob as tonight\'s guest',
        !!inn && inn.mine && inn.b === INN && inn.sleep.length === 1 && inn.sleep[0].name === 'Bob' &&
        inn.sleep[0].pid === BOB.pid);
  }
}

// ----------------------------------------------------------- the writing --

{
  const bad = every.filter(function (s) {
    return s.indexOf(String.fromCharCode(0x2014)) !== -1 || /\bplayers?\b/i.test(s);
  });
  yes('W8 every line said keeps the writing rules (no em dash, no banned word)', every.length > 40 && bad.length === 0);
  const typed = every.filter(function (s) { return /\/(bed|rest|sleephere)\b/.test(s); });
  yes('W8 and none of them tells anybody to type /bed, /rest or /sleephere' +
      (typed.length ? ' (' + typed[0] + ')' : ''), typed.length === 0);
}

done();
