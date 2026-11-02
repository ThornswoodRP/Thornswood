// test-1637-door-gui.js
//
// Property at the door, with nothing typed (#1637).
//
// Patrick, 4 October: "no more commands for things [people] do, only for dev
// and staff commands; everything else takes buttons and GUI". Claiming a
// building, unlocking it, listing what you hold and cutting a key were typed.
// Now the lock key, X unless LockKey moved it, does what one line under the
// crosshair says: Claim at a door of a building nobody holds, Lock or Unlock
// at one you hold (the suggested answer on the issue: one key, and the line
// says which), and Cut a key at a forge with a stamped key mold in the pack.
// What you hold is on the K panel's property page, with the rent owed on each
// building and the farm (the other suggested answer).
//
// THE SERVER. The real property block runs over a pretend engine: the line it
// writes on every door opened and after every press, a claim, a lock both
// ways, a door somebody else holds, a door opened too long ago, a deed carried
// to the door, and the key at a forge with each of its refusals. No line the
// server says on any of these paths names a command.
//
// THE CLIENT. The lock key's section of thornswood-front.js runs against a
// pretend game and a pretend page: the line is up only for a door of that
// building while the server's line still counts, or at a forge with a stamped
// mold; the key sends the word and the id under the crosshair; nothing is
// drawn or sent over a menu or while the chat has the keyboard.
//
// THE PAGE AND THE HELP. propertyView hands the K panel the rent and the farm,
// the page draws them, and no help, list, launcher row or system page names
// /claim at a door, /deed, /lock, /unlock, /mold or /key any more.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const read = function (p) { return fs.readFileSync(p, 'utf8').split(CR).join(''); };

const gm = require('./gamemode-tables.js').joined(read(process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js')));
/*
  One topic of the help panel (#1633), as a fresh install reads it: /help's
  topics moved out of the gamemode into game/ui/thornswood-help.js, each a
  list of paragraphs made from the key names.
*/
function helpTopic(id) {
  const page = fs.readFileSync(path.join(REPO_DIR, 'game', 'ui', 'thornswood-help.js'), 'utf8')
    .split(String.fromCharCode(13)).join('');
  const a = page.indexOf('  var TOPICS = [');
  const b = a < 0 ? -1 : page.indexOf('\n  ];\n', a);
  const k = /var keys = (\{[\s\S]*?\});/.exec(page);
  if (a < 0 || b < 0 || !k) { return ''; }
  try {
    const topics = new Function('return ' + page.slice(page.indexOf('[', a), b + 4))();
    const t = topics.filter(function (x) { return x.id === id; })[0];
    return t ? t.text(new Function('return ' + k[1])()).join(' ') : '';
  } catch (e) { return ''; }
}
const front = read(process.env.FRONT || path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js'));
const skills = read(path.join(REPO_DIR, 'game', 'ui', 'thornswood-skills.js'));
// The rows on Settings in the game (#3126), where the Controls page's were.
const settingsPage = read(path.join(REPO_DIR, 'game', 'ui', 'thornswood-settings.js'));
const ini = read(path.join(REPO_DIR, 'launcher', 'Thornswood.ini'));

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
// What addItem and takeItem ask so a hair dye is never the plain item (#2675).
const mintedSrc = liftFrom(gm, 'function mintedEntry(entry) {', '');
// The craft gate a key cut at a forge asks (#1733); nobody here is hurt or tired.
const unfitSrc = liftFrom(gm, 'function unfitToMake(actorId, workbenchId) {', '');
yes('the property, character and farming blocks and the pack helpers are in the gamemode',
    !!propBlock && !!charBlock && !!farmBlock && !!addItemSrc && !!takeItemSrc && !!unfitSrc);
if (!propBlock || !charBlock || !farmBlock || !addItemSrc || !takeItemSrc || !unfitSrc) { done(); }

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
refs[FORGE_REF] = { baseDesc: FORGE_BASE, worldOrCellDesc: TUNDRA, pos: [1000, 1000, 0] };
refs[BLOCK_REF] = { baseDesc: BLOCK_BASE, worldOrCellDesc: TUNDRA, pos: [1100, 1000, 0] };
PEOPLE.forEach(function (p) {
  refs[p.a] = { profileId: p.pid, appearance: { name: p.name }, worldOrCellDesc: TUNDRA,
                pos: [1000, 1100, 0], inventory: { entries: [] } };
});
const online = PEOPLE.map(function (p) { return p.a; });
const made = {};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-1637-door-'));
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
  // Alice holds her hammer (#3162); tests/test-3162-bench-tools.js asks the refusal.
  toolGate: function () { return null; }, wearTool: function () { return null; },
  __thornswoodCharacter: {
    stateOf: function (actorId) { return { prof: actorId === ALICE.a ? 'smith' : 'cook' }; },
    writeState: function () { }
  }
};
box.globalThis = box;
inDir(function () {
  vm.runInNewContext(mintedSrc + '\n' + addItemSrc + '\n' + takeItemSrc + '\n' + unfitSrc + '\n' + propBlock, box,
                     { filename: 'gamemode.js property' });
});
const W = box.__thornswoodProperty;
yes('the property block runs and publishes itself', !!W && typeof W.command === 'function');
if (!W) { done(); }

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

// D0: the property is made the way the lock list is, for its owner alone.
{
  const m = made[W.DOOR_LINE_PROPERTY];
  yes('D0 the door line is a property only its owner sees, with a script on their client',
      W.DOOR_LINE_PROPERTY === 'thornswoodDoorLine' && !!m && m.isVisibleByOwner === true &&
      m.isVisibleByNeighbors === false && /globalThis\.thornswoodDoorLine/.test(m.updateOwner || ''));
}

// D1: THE DONE-WHEN. A door nobody holds, opened: the line says Claim.
open(ALICE, DOOR_OUT);
{
  const l = lineOf(ALICE);
  yes('D1 opening a door of a building nobody holds writes Claim, with its name',
      !!l && l.x === 'claim' && l.n === 'Honeyside');
  yes('D1 and both halves of its front door, as the crosshair hands them back',
      !!l && l.d.indexOf(hex(DOOR_OUT)) !== -1 && l.d.indexOf(hex(DOOR_IN)) !== -1 && l.d.length === 2);
  yes('D1 and the whole minute the server takes it as the door just opened', !!l && l.left === 60000);
}

// D2: the key's line, sent: the building is claimed and the line turns to Lock.
{
  const was = lineOf(ALICE).at;
  const r = word(ALICE, '/claim', [hex(DOOR_OUT)]);
  const held = W.holderOf(HOME);
  yes('D2 the claim the key sends is answered by the property block', r.handled === true);
  yes('D2 and Honeyside is Alice\'s, with the deed in her pack',
      !!held && held.by === ALICE.pid && holds(ALICE, DEED_DESC, W.deedLabel(HOME)));
  yes('D2 and the line at the door says Lock now, as a new write',
      lineOf(ALICE).x === 'lock' && lineOf(ALICE).at > was);
}

// D3: one key both ways, and the line says which.
{
  let r = word(ALICE, '/lock', [hex(DOOR_IN)]);
  yes('D3 the key on an unlocked door locks it: "' + r.told.split('\n')[0] + '"',
      W.holderOf(HOME).locked === true && /You lock Honeyside/.test(r.told));
  yes('D3 and the line says Unlock', lineOf(ALICE).x === 'unlock');
  r = word(ALICE, '/unlock', [hex(DOOR_IN)]);
  yes('D3 the key on a locked door unlocks it', W.holderOf(HOME).locked === false && /You unlock Honeyside/.test(r.told));
  yes('D3 and the line says Lock again', lineOf(ALICE).x === 'lock');
  r = word(ALICE, '/unlock', [hex(DOOR_IN)]);
  yes('D3 a word the line no longer says is answered plainly and changes nothing',
      W.holderOf(HOME).locked === false && /already unlocked/.test(r.told) && lineOf(ALICE).x === 'lock');
}

// D4: somebody else's door offers nothing, and the key does not take it.
open(CAROL, DOOR_OUT);
{
  const l = lineOf(CAROL);
  yes('D4 a door somebody else holds draws no line', !!l && l.x === '' && l.d.length === 0);
  const r = word(CAROL, '/lock', [hex(DOOR_OUT)]);
  yes('D4 and the word sent anyway is refused by name', /held by Alice/.test(r.told) && W.holderOf(HOME).locked === false);
  const c = word(CAROL, '/claim', [hex(DOOR_OUT)]);
  yes('D4 and so is a claim', /held by Alice/.test(c.told) && W.holderOf(HOME).by === ALICE.pid);
}
open(BOB, SHOP_DOOR);
yes('D4 Bob at his own shop is offered Lock', lineOf(BOB).x === 'lock' && lineOf(BOB).n === 'The Shop');

// D5: a door the table does not know writes nothing.
{
  const before = JSON.stringify(lineOf(BOB));
  open(BOB, SHED);
  yes('D5 a door no building owns leaves the line as it was', JSON.stringify(lineOf(BOB)) === before);
}

// D6: the minute runs out. The claim goes to farming, and the line goes.
{
  clock.t += 61000;
  const r = word(BOB, '/claim', [hex(SHOP_DOOR)]);
  yes('D6 a minute after the door, /claim is not the property block\'s', r.handled === false);
  const l = word(BOB, '/lock', [hex(SHOP_DOOR)]);
  yes('D6 and the lock says to open the door first, with nothing to type: "' + l.told + '"',
      /Open the door/.test(l.told) && W.holderOf(SHOP).locked !== true);
  yes('D6 and the line is down', lineOf(BOB).x === '' && lineOf(BOB).left === 0);
}

// D7: the deed carried to the door moves the place, and the line follows.
{
  const entries = pack(ALICE);
  const at = entries.findIndex(function (e) { return e.name === W.deedLabel(HOME); });
  pack(CAROL).push(entries.splice(at, 1)[0]);
  open(CAROL, DOOR_OUT);
  yes('D7 Carol carries the deed through the door and holds Honeyside', W.holderOf(HOME).by === CAROL.pid);
  yes('D7 and her line offers the lock straight away', lineOf(CAROL).x === 'lock');
}

// K: THE KEY AT A FORGE.
function smithAt(p, x) { refs[p.a].pos = [x, 1000, 0]; }
function give(p, baseDesc, n, name) {
  const e = { baseId: idOf(baseDesc), count: n };
  if (name) { e.name = name; }
  pack(p).push(e);
}
give(ALICE, MOLD_DESC, 1, W.moldLabel(HOME));
give(ALICE, INGOT, 2);
smithAt(ALICE, 1100);
{
  const r = word(ALICE, '/key', [FORGE_REF.toString(16)]);
  yes('K1 a smith at the forge with the mold cuts a key named for the building: "' + r.told + '"',
      holds(ALICE, KEY_DESC, W.keyLabel(HOME)));
  yes('K1 for one iron ingot, the Key\'s price at a forge', count(ALICE, INGOT) === 1);
  yes('K1 and the mold is kept', holds(ALICE, MOLD_DESC, W.moldLabel(HOME)));
}
function keys(p) { return pack(p).filter(function (e) { return e.baseId === idOf(KEY_DESC); }).length; }
{
  const had = keys(ALICE);
  smithAt(ALICE, 6000);
  const r = word(ALICE, '/key', [FORGE_REF.toString(16)]);
  yes('K2 too far from the forge cuts nothing and takes nothing',
      keys(ALICE) === had && count(ALICE, INGOT) === 1 && /forge/.test(r.told));
  smithAt(ALICE, 1100);
  const b = word(ALICE, '/key', [BLOCK_REF.toString(16)]);
  yes('K3 a bench that is not a forge cuts nothing', keys(ALICE) === had && count(ALICE, INGOT) === 1 && /forge/.test(b.told));
  const z = word(ALICE, '/key', ['zz']);
  yes('K4 an id that is not one cuts nothing', keys(ALICE) === had && count(ALICE, INGOT) === 1);
  refs[CAROL.a].pos = [1100, 1000, 0];
  give(CAROL, MOLD_DESC, 1, W.moldLabel(HOME));
  give(CAROL, INGOT, 1);
  const c = word(CAROL, '/key', [FORGE_REF.toString(16)]);
  yes('K5 somebody who is not a smith is told it is a smith\'s work', /smith/.test(c.told) && keys(CAROL) === 0 && count(CAROL, INGOT) === 1);
  word(ALICE, '/key', [FORGE_REF.toString(16)]);
  const n = word(ALICE, '/key', [FORGE_REF.toString(16)]);
  yes('K6 with no ingot left there is no key, and it says why: "' + n.told + '"',
      keys(ALICE) === had + 1 && count(ALICE, INGOT) === 0 && /iron ingot/.test(n.told));
}

// W: nothing the server said on any of these paths names a command.
{
  const named = every.filter(function (m) { return /\/(claim|deeds?|lock|unlock|mold|key)\b/.test(m); });
  yes('W1 no line the server said names /claim, /deed, /lock, /unlock, /mold or /key' +
      (named.length ? ' (' + named[0] + ')' : '') + ', over ' + every.length + ' lines',
      named.length === 0 && every.length >= 12);
  const r = word(ALICE, '/deed', []);
  yes('W2 /deed, which nobody is told about now, names nothing to type either',
      !/\/\w/.test(r.told) && every.length > 0);
}

// ================================================ the client's script half
{
  const m = /function doorLineScript\(\) \{[\s\S]*?\n  \}\n/.exec(propBlock);
  let script = '';
  try { script = new Function(m[0] + '\nreturn doorLineScript();')(); } catch (e) { script = ''; }
  const G = {};
  const run = function (v, now) {
    new Function('ctx', 'globalThis', 'Date', script)({ value: v }, G, { now: function () { return now; } });
  };
  run({ at: 5, x: 'claim', n: 'Honeyside', d: ['1002'], left: 60000 }, 1000);
  yes('S1 the script puts the line where the plugin reads it, on the client\'s clock',
      !!G.thornswoodDoorLine && G.thornswoodDoorLine.x === 'claim' && G.thornswoodDoorLine.seen === 1000 &&
      G.thornswoodDoorLine.d[0] === '1002' && G.thornswoodDoorLine.left === 60000);
  run({ at: 5, x: 'claim', n: 'Honeyside', d: ['1002'], left: 60000 }, 9000);
  yes('S2 and the same stamp every frame after does not restart the minute', G.thornswoodDoorLine.seen === 1000);
  run({ at: 6, x: 'lock', n: 'Honeyside', d: ['1002'], left: 30000 }, 9000);
  yes('S3 a new stamp does', G.thornswoodDoorLine.seen === 9000 && G.thornswoodDoorLine.x === 'lock');
}

// ================================================= the K panel's property page
{
  const pv = liftFrom(charBlock, 'function propertyView(actorId, profileId) {', '  ');
  yes('the property page view is in the character block', !!pv);
  const claims = W.claims();
  claims[HOME].rent = { amount: 50, everyDays: 7, owed: 0, since: clock.t - 8 * DAY };
  const g = { __thornswoodProperty: W, __thornswoodBeds: box.__thornswoodBeds,
              __thornswoodFarming: { farmOf: function (pid) { return pid === CAROL.pid ? { days: 9, reach: 1200 } : null; } } };
  let rows = null;
  inDir(function () {
    rows = new Function('g', 'mp', 'idOf', 'BUILDING_NAME', 'clog', 'PROPERTY_PAGE_MAX',
                        pv + '\nreturn propertyView(' + CAROL.a + ', ' + CAROL.pid + ');')(
      g, mp, idOf, BUILDING_NAME, function () { }, 24);
  });
  const home = (rows || []).filter(function (r) { return r.name === W.placeOf(HOME); })[0];
  const farm = (rows || []).filter(function (r) { return r.farm; })[0];
  yes('P1 a building you hold carries the rent on it, owed up to now',
      !!home && !!home.rent && home.rent.amount === 50 && home.rent.every === 7 && home.rent.owed === 50);
  yes('P2 and your farm is a row of its own, with the days it has left',
      !!farm && farm.mine === true && farm.days === 9 && farm.reach === 1200 && farm.name === 'Your farm');
  delete claims[HOME].rent;
  inDir(function () {
    rows = new Function('g', 'mp', 'idOf', 'BUILDING_NAME', 'clog', 'PROPERTY_PAGE_MAX',
                        pv + '\nreturn propertyView(' + CAROL.a + ', ' + CAROL.pid + ');')(
      g, mp, idOf, BUILDING_NAME, function () { }, 24);
  });
  const bare = (rows || []).filter(function (r) { return r.name === W.placeOf(HOME); })[0];
  yes('P3 a place with no rent says none', !!bare && bare.rent === null);

  // The farming block's own answer.
  const fo = liftFrom(farmBlock, 'function farmOf(profileId) {', '  ');
  const fclaims = { '404': { by: 404, at: clock.t - 5 * DAY, cell: TUNDRA, x: 0, y: 0 },
                    '505': { by: 505, at: clock.t - 20 * DAY, cell: TUNDRA, x: 0, y: 0 } };
  const lapsedCalls = [];
  const farmOf = fo ? new Function('claims', 'P', 'lapsed', 'tuning', 'Date', fo + '\nreturn farmOf;')(
    fclaims, { has: function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); } },
    function (k) { lapsedCalls.push(k); if (clock.t - fclaims[k].at > 14 * DAY) { delete fclaims[k]; return true; } return false; },
    function () { return { claimLapseDays: 14, claimRadius: 1200 }; }, FakeDate) : null;
  yes('P4 the farming block answers the farm a person holds, with whole days left',
      !!farmOf && JSON.stringify(farmOf(404)) === JSON.stringify({ days: 9, reach: 1200 }));
  yes('P5 and nothing for a lapsed farm, nobody, or no profile',
      !!farmOf && farmOf(505) === null && farmOf(606) === null && farmOf(0) === null);

  // And the page draws them.
  const parts = ['function propertyRows() {', 'function drawProperty() {', 'function rentLine(rent) {',
                 'function drawGuests(card, r) {', 'function el(tag, cls, text) {']
    .map(function (f) { return liftFrom(skills, f, '  '); });
  yes('the page\'s pieces are in thornswood-skills.js', parts.every(Boolean));
  if (parts.every(Boolean)) {
    function node(tag) {
      return { tag: tag, className: '', textContent: '', kids: [], title: '',
               appendChild: function (k) { this.kids.push(k); return k; } };
    }
    function text(n) { return [n.textContent].concat(n.kids.map(text)).join(' '); }
    const body = node('div');
    // The rows are on the panel view, mine.property, where writeState puts
    // them (#1717); tests/test-1717-property-page.js runs that whole road.
    const mine = { property: [
      { name: 'Honeyside', mine: true, locked: false, keyed: false, b: HOME, sleep: [],
        rent: { amount: 50, every: 7, owed: 50 } },
      { name: 'The Shop', mine: true, locked: true, keyed: true, b: SHOP, sleep: [], rent: null },
      { name: 'Your farm', mine: true, farm: true, days: 9, reach: 1200 }
    ] };
    new Function('document', 'elBody', 'mine', 'window', parts.join('\n') + '\ndrawProperty();')(
      { createElement: node }, body, mine, {});
    const all = text(body);
    yes('P6 the page says the rent and what is owed on it',
        /Rent is 50 gold every 7 days, 50 gold owed now\./.test(all) && /No rent on it\./.test(all));
    yes('P7 and the farm, with its days', /goes back in 9 days/.test(all) && /1200 out from the plot/.test(all));
    yes('P8 and where the lock is turned, with nothing to type: "' + (all.match(/Unlocked\.[^.]*\./) || [''])[0] + '"',
        /Open its door and the key the line names locks it/.test(all) && !/\/(claim|lock|unlock|deed)\b/.test(all));
  }
}

// ================================================================ the client
const CLIENT = {
  iniNumber: liftFrom(front, 'function iniNumber(text, key, fallback) {', '  '),
  keyName: liftFrom(front, 'function keyName(code) {', '  '),
  anyClaim: liftFrom(front, 'function anyClaim() {', '  '),
  gameMenuOpen: liftFrom(front, 'function gameMenuOpen() {', '  '),
  busyMenuOpenNow: liftFrom(front, 'function busyMenuOpenNow(except) {', '  '),
  stampedMolds: liftFrom(front, 'function stampedMolds(pc, base) {', '  '),
  menus: (function () {
    const a = front.indexOf('  const KEYBOARD_MENUS = [');
    const b = a < 0 ? -1 : front.indexOf('\n  ];\n', a);
    return b < 0 ? null : front.slice(a, b + 6);
  })(),
  lock: liftSpan(front, '  const LOCK_EVERY = ', "  sp.on('menuOpen', guard('lock menu',")
};
const missing = Object.keys(CLIENT).filter(function (k) { return !CLIENT[k]; });
yes('every piece of the plugin half is in thornswood-front.js' + (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''),
    missing.length === 0);
yes('the key handler asks lockPress for the lock key', /e\.code === LOCK_KEY && lockPress\(\)/.test(front));
yes('the lock key is still X, LockKey in Thornswood.ini, with its row on Settings in the game',
    /(?:const|let) LOCK_KEY\s*=\s*iniNumber\(ini, 'LockKey', 45\);/.test(front) &&
    /^\s*LockKey\s*=\s*45\s*$/m.test(ini) && /\{ ini: 'LockKey', def: 45,/.test(settingsPage));

const MOLD_RT = 0x0a015495;
const FORGE_HERE = 0x00a00010;
function client() {
  const w = { now: 1700000000000, crosshair: null, molds: 0, stamped: 0, menus: {}, claims: {},
              sent: [], handlers: {}, G: {} };
  const els = {};
  const doc = {
    getElementById: function (id) { return els[id] || null; },
    createElement: function () { return { id: '', style: { cssText: '', display: '' }, innerHTML: '' }; },
    body: { appendChild: function (el) { els[el.id] = el; } }
  };
  const T = { ready: true, js: function (src) { if (!T.ready) { return false; } new Function('document', src)(doc); return true; } };
  w.T = T;
  const files = { 'Skyrim.esm': 0x00000000, 'Dragonborn.esm': 0x04000000, 'North Keep.esp': 0x8a000000 };
  const sp = {
    on: function (name, fn) { (w.handlers[name] = w.handlers[name] || []).push(fn); },
    getExtraContainerChanges: function (id) {
      if (id !== 0x14) { return null; }
      const lists = w.stamped ? [[{ type: 'Count', count: w.stamped },
                                  { type: 'TextDisplayData', name: 'Key mold for Honeyside' }]] : [];
      return [{ baseId: MOLD_RT, countDelta: w.molds, extendDataList: lists }];
    },
    Game: {
      getPlayer: function () {
        return { getFormID: function () { return 0x14; },
                 getItemCount: function (form) { return form && form.id === MOLD_RT ? w.molds : 0; } };
      },
      getFormFromFile: function (id, file) {
        if (file === 'Thornswood-Content.esp') { return id === 0x15495 ? { getFormID: function () { return MOLD_RT; } } : null; }
        if (!Object.prototype.hasOwnProperty.call(files, file)) { return null; }
        return { getFormID: function () { return (files[file] | id) >>> 0; } };
      },
      getFormEx: function (id) { return id === MOLD_RT ? { id: id } : null; },
      getCurrentCrosshairRef: function () {
        const c = w.crosshair;
        if (!c) { return null; }
        return { getFormID: function () { return c.id; },
                 getBaseObject: function () { return { getType: function () { return c.type; },
                                                       getFormID: function () { return c.base; } }; } };
      }
    },
    Ui: { isMenuOpen: function (name) { return !!w.menus[name]; } },
    Utility: { isInMenuMode: function () { return false; } }
  };
  const body = [
    CLIENT.iniNumber, CLIENT.keyName, CLIENT.anyClaim, CLIENT.gameMenuOpen, CLIENT.menus,
    CLIENT.busyMenuOpenNow,
    'const LOCK_KEY = 45; const LOCK_NAME = keyName(LOCK_KEY);',
    'const MOLD_KEY = 22; const MOLD_NAME = keyName(MOLD_KEY);',
    "const MOLD_FILE = 'Thornswood-Content.esp'; const MOLD_ITEM = 0x15495; const DOOR_TYPE = 29;",
    'let moldBase = 0;',
    CLIENT.stampedMolds, CLIENT.lock,
    'return { lockPress: lockPress, lockKeyNow: lockKeyNow, masterPress: masterPress };'
  ].join('\n');
  w.api = new Function('sp', 'T', 'claims', 'tellServer', 'say', 'log', 'guard', 'globalThis', body)(
    sp, T, w.claims, function (line) { w.sent.push(line); }, function () { }, function () { },
    function (name, fn) { return fn; }, w.G);
  w.tick = function () { w.now += 400; (w.handlers.update || []).forEach(function (f) { f(); }); };
  w.menuOpens = function (name) { w.menus[name] = true; (w.handlers.menuOpen || []).forEach(function (f) { f({ name: name }); }); };
  w.lineText = function () {
    const d = els['ts-lock'];
    if (!d || d.style.display === 'none') { return ''; }
    return String(d.innerHTML).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  };
  w.door = function (x, n, d, left) { w.G.thornswoodDoorLine = { stamp: w.now, seen: w.now, left: left || 60000, x: x, n: n, d: d }; };
  return w;
}

const realNow = Date.now;
let clockOf = null;
Date.now = function () { return clockOf ? clockOf.now : realNow(); };
try {
  if (missing.length === 0) {
    const DOOR_A = { id: 0x1002, type: 29, base: 0x31 }, DOOR_B = { id: 0x1004, type: 29, base: 0x31 };
    const OTHER_DOOR = { id: 0x1001, type: 29, base: 0x31 };
    // C1: THE DONE-WHEN. The door just opened, nobody holds it: the line and the key.
    {
      const w = client(); clockOf = w;
      w.door('claim', 'Honeyside', ['1002', '1004']);
      w.crosshair = DOOR_A;
      w.tick();
      yes('C1 at the door just opened the line names the key and says Claim: "' + w.lineText() + '"',
          w.lineText() === 'X Claim Honeyside');
      yes('C1 and the key sends the claim with that door\'s id', w.api.lockPress() === true &&
          w.sent.length === 1 && w.sent[0] === '/claim 1002');
      yes('C1 and a second press in the same breath is not a second claim', w.api.lockPress() === true && w.sent.length === 1);
      w.now += 2000;
      w.api.lockPress();
      yes('C1 but one after a moment is', w.sent.length === 2);
      w.crosshair = DOOR_B;
      w.door('lock', 'Honeyside', ['1002', '1004']);
      w.tick();
      yes('C2 the inside half of the door is the same building, and the line says Lock: "' + w.lineText() + '"',
          w.lineText() === 'X Lock Honeyside');
      w.api.lockPress();
      yes('C2 and the key sends the lock', w.sent[w.sent.length - 1] === '/lock 1004');
      w.door('unlock', 'Honeyside', ['1002', '1004']);
      w.tick();
      yes('C2 a locked door says Unlock', w.lineText() === 'X Unlock Honeyside');
      w.now += 2000;
      w.api.lockPress();
      yes('C2 and the key sends the unlock', w.sent[w.sent.length - 1] === '/unlock 1004');
    }
    // C3: no line, no key.
    {
      const w = client(); clockOf = w;
      w.door('claim', 'Honeyside', ['1002', '1004']);
      w.crosshair = OTHER_DOOR;
      w.tick();
      yes('C3 another building\'s door draws nothing and the key falls through',
          w.lineText() === '' && w.api.lockPress() === false && w.sent.length === 0);
      w.crosshair = DOOR_A;
      w.door('', '', []);
      w.tick();
      yes('C3 a door the server offers nothing at draws nothing', w.lineText() === '' && w.api.lockPress() === false);
      w.door('constructor', 'Honeyside', ['1002']);
      w.tick();
      yes('C3 nor a word that is not one of the three', w.lineText() === '' && w.api.lockPress() === false);
      w.door('claim', 'Honeyside', ['1002', '1004']);
      w.now += 61000;
      w.tick();
      yes('C4 a minute after the door the line is gone and so is the key', w.lineText() === '' && w.api.lockPress() === false);
      w.door('claim', 'Honeyside', ['1002', '1004']);
      w.crosshair = null;
      w.tick();
      yes('C4 nothing under the crosshair, nothing', w.lineText() === '' && w.api.lockPress() === false && w.sent.length === 0);
    }
    // C5: never over a menu or the chat.
    {
      const w = client(); clockOf = w;
      w.door('claim', 'Honeyside', ['1002']);
      w.crosshair = DOOR_A;
      w.tick();
      yes('C5 the line is up', w.lineText() !== '');
      w.menuOpens('InventoryMenu');
      yes('C5 a menu that takes the keyboard takes the line down at once', w.lineText() === '');
      w.tick();
      yes('C5 and keeps it down, and the key sends nothing', w.lineText() === '' && w.api.lockPress() === false && w.sent.length === 0);
      w.menus = {};
      w.claims.chat = true;
      w.tick();
      yes('C6 while the chat has the keyboard an x is a letter', w.lineText() === '' && w.api.lockPress() === false && w.sent.length === 0);
      w.claims.chat = false;
      w.T.ready = false;
      yes('C6 and nothing is sent before the page is up', w.api.lockPress() === false && w.sent.length === 0);
    }
    // C7: at a forge with a stamped mold.
    {
      const w = client(); clockOf = w;
      w.crosshair = { id: FORGE_HERE, type: 40, base: 0x1a2ad };
      w.molds = 1; w.stamped = 1;
      w.tick();
      yes('C7 at a forge with a stamped mold the line says Cut a key, and U cuts a master key (#2254): "' + w.lineText() + '"',
          w.lineText() === 'X Cut a key from your key mold U Cut a master key from your key mold, 2 iron ingots');
      yes('C7 and the key sends /key with the forge\'s id', w.api.lockPress() === true && w.sent[0] === '/key a00010');
      yes('C9 the mold key there sends /key with the forge\'s id and master (#2254)',
          w.api.masterPress() === true && w.sent[1] === '/key a00010 master');
      yes('C9 and a double press is one line', w.api.masterPress() === true && w.sent.length === 2);
      w.crosshair = { id: FORGE_HERE, type: 40, base: (0x04000000 | 0x2b074) >>> 0 };
      w.tick();
      yes('C7 a Dragonborn forge is a forge too', /^X Cut a key from your key mold U Cut a master key/.test(w.lineText()));
      w.stamped = 0;
      w.tick();
      yes('C8 a blank mold alone draws nothing', w.lineText() === '' && w.api.lockPress() === false &&
          w.api.masterPress() === false);
      w.molds = 0;
      w.tick();
      yes('C8 nor no mold', w.lineText() === '');
      w.molds = 1; w.stamped = 1;
      w.crosshair = { id: FORGE_HERE, type: 40, base: 0x1a2ae };
      w.tick();
      yes('C8 nor a bench that is not a forge', w.lineText() === '' && w.api.lockPress() === false &&
          w.api.masterPress() === false && w.sent.length === 2);
    }
  }
} finally {
  Date.now = realNow;
}

// The forges the plugin knows are the forges the server knows.
{
  const line = gm.split('\n').filter(function (l) { return l.indexOf('const BENCH_BY_BASE = {') === 0; })[0] || '';
  let table = {};
  try { table = JSON.parse(line.slice(line.indexOf('{'), line.lastIndexOf('}') + 1)); } catch (e) { table = {}; }
  const server = Object.keys(table).filter(function (k) { return table[k] === '88105:Skyrim.esm'; })
    .map(function (k) { return k.toLowerCase(); }).sort();
  const m = /const FORGE_BASES = \[([\s\S]*?)\];/.exec(front);
  const mine = [];
  if (m) {
    const rx = /\['([^']+)', 0x([0-9a-f]+)\]/gi;
    let r;
    while ((r = rx.exec(m[1])) !== null) { mine.push((parseInt(r[2], 16).toString(16) + ':' + r[1]).toLowerCase()); }
  }
  mine.sort();
  yes('F1 the plugin\'s forges are the bench table\'s CraftingSmithingForge rows (' + server.length + ')',
      server.length > 0 && JSON.stringify(server) === JSON.stringify(mine));
}

// ================================================= nobody is told to type them
{
  const pw = (/const PLAYER_WORDS = \[([\s\S]*?)\];/.exec(gm) || [])[1] || '';
  const gone = ['/deed', '/lock', '/unlock', '/mold', '/key'].filter(function (x) { return pw.indexOf("'" + x + "'") !== -1; });
  yes('H1 the list of words named to everybody has none of /deed, /lock, /unlock, /mold, /key' +
      (gone.length ? ' (' + gone.join(', ') + ')' : ''), pw.length > 0 && gone.length === 0);
  const words = (/const WORDS = \[([\s\S]*?)\];/.exec(gm) || [])[1] || '';
  yes('H2 and the server still answers the lines the key sends',
      ['/claim', '/lock', '/unlock', '/key', '/moldhere'].every(function (x) { return words.indexOf("'" + x + "'") !== -1; }));
  // The help is a panel since #1633: its Land topic, as a fresh install reads it.
  const said = helpTopic('land');
  yes('H3 the help panel\'s Land names none of them, and /claim only at a plot: "' + said.slice(0, 80) + '..."',
      said.length > 100 && !/\/(deeds?|lock|unlock|mold|key)\b/.test(said) &&
      (said.match(/\/claim/g) || []).length === (said.match(/\/claim at a plot/g) || []).length);
  yes('H4 and it says what the key does at a door', /claims a building nobody holds/.test(said) && /locks or unlocks/.test(said));
  const docs = ['docs/systems/property.md', 'docs/systems/embassy.md', 'docs/systems/thalmor.md'];
  const stale = docs.filter(function (p) {
    return /`\/(claim|deeds?|lock|unlock|mold|key)`/.test(read(path.join(REPO_DIR, p)));
  });
  yes('H5 property.md, embassy.md and thalmor.md tell nobody to type them' + (stale.length ? ' (' + stale.join(', ') + ')' : ''),
      stale.length === 0);
  const row = (/\{ ini: 'LockKey', def: 45,[^}]*\}/.exec(settingsPage) || [''])[0];
  yes('H6 the Settings row says what the key does, and names no command',
      /claims the building/.test(row) && /locks or unlocks/.test(row) && /cuts a key/.test(row) && !/\/(claim|lock|unlock|key)\b/.test(row));
  const iniBlock = (/((?:;[^\n]*\n)+)LockKey = 45/.exec(ini) || ['', ''])[1];
  yes('H7 and so does its line in Thornswood.ini', /claims the building/.test(iniBlock) && !/\/(claim|lock|unlock|key)\b/.test(iniBlock));
  const skillsText = (liftFrom(skills, 'function drawProperty() {', '  ') || '');
  yes('H8 the property page names nothing to type', skillsText.length > 0 && !/\/(claim|lock|unlock|deed)\b/.test(skillsText));
}

done();
