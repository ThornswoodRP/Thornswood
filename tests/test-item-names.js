// test-item-names.js
//
// #2252, #2253, #2257: the deed, the key mold and the key show in the game as
// plain "Deed", "Key Mold" and "Key", not "Deed to Honeyside", "Key mold for
// Honeyside" and "Key to Honeyside". The name is on the server's inventory
// entry (the property block gives every one of them a name and never stacks
// them); the game shows it only if the client applies it.
//
// N: THE SERVER. The real property block over a pretend engine (the same rig
//    as test-1637-door-gui.js): a claim hands over the deed, the mold is cut at
//    the door, a key is cut at a forge and a key made in the crafting menu is
//    named off the mold. Every one is one entry of count 1 with its name, the
//    labels the block publishes, and survives the JSON the engine stores.
// P: THE DROP AND THE PICKUP (#1719). The engine's DropItem (fork #49,
//    8400e636) resolves the dropped entry with its extra, puts the extra on the
//    reference and gives it back on the pickup. That is ported here and run
//    over the three named pieces: the name comes back, the property block
//    still knows the key, the mold and the deed by it, a plain key dropped
//    beside a named one goes as the plain one, and the gamemode's own drop
//    handler writes nothing.
// C: THE CLIENT. sync/inventory.ts after fork #56 (1afaf2ef) compares names
//    exactly, a missing name meaning the base's own name. Ported here: every
//    rename the server makes to these pieces is a difference the client
//    applies, and the server's plain entry against the game's own base name
//    is not. When the engine checkout is there (engine/skymp, or
//    THORNSWOOD_ENGINE), the port is checked against its source; when it is
//    not (CI), those checks say SKIP.
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
const keysCs = read(path.join(REPO_DIR, 'launcher', 'app', 'Keys.cs'));
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-item-names-'));
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

// =============================================================== N: server
function give(p, baseDesc, n, name) {
  const e = { baseId: idOf(baseDesc), count: n };
  if (name) { e.name = name; }
  pack(p).push(e);
}
function entriesOf(p, baseDesc) { return pack(p).filter(function (e) { return e.baseId === idOf(baseDesc); }); }
const DEED_NAME = 'Deed to Honeyside, Windhelm', MOLD_NAME = 'Key mold for Honeyside, Windhelm', KEY_NAME = 'Key to Honeyside, Windhelm';
yes('N0 the labels the block publishes are the three names on the issues, with the hold (#3899)',
    W.deedLabel(HOME) === DEED_NAME && W.moldLabel(HOME) === MOLD_NAME && W.keyLabel(HOME) === KEY_NAME);

open(ALICE, DOOR_OUT);
{
  const r = word(ALICE, '/claim', [hex(DOOR_OUT)]);
  const d = entriesOf(ALICE, DEED_DESC);
  yes('N1 a claim hands over the deed as one entry, count 1, named "' + (d[0] && d[0].name) + '"',
      r.handled === true && d.length === 1 && d[0].count === 1 && d[0].name === DEED_NAME);
}
give(ALICE, MOLD_DESC, 2);
{
  const r = word(ALICE, '/mold', [hex(DOOR_OUT)]);
  const named = entriesOf(ALICE, MOLD_DESC).filter(function (e) { return !!e.name; });
  yes('N2 the mold cut at the door is its own entry, count 1, named "' + (named[0] && named[0].name) + '"' +
      (named.length ? '' : ' (' + r.told + ')'),
      named.length === 1 && named[0].count === 1 && named[0].name === MOLD_NAME);
  yes('N2 and the plain molds beside it keep no name', count(ALICE, MOLD_DESC) === 2);
}
give(ALICE, INGOT, 1);
refs[ALICE.a].pos = [1100, 1000, 0];
{
  const r = word(ALICE, '/key', [FORGE_REF.toString(16)]);
  const k = entriesOf(ALICE, KEY_DESC);
  yes('N3 the key cut at the forge is one entry, count 1, named "' + (k[0] && k[0].name) + '"' + (k.length ? '' : ' (' + r.told + ')'),
      k.length === 1 && k[0].count === 1 && k[0].name === KEY_NAME);
}
// A plain key beside a second named one, for the drops below (the crafting menu's
// plain key and its timer are gone since #2487, so the test gives them).
give(ALICE, KEY_DESC, 1);
give(ALICE, KEY_DESC, 1, KEY_NAME);
{
  const inv = refs[ALICE.a].inventory;
  const back = JSON.parse(JSON.stringify(inv));
  const keysOk = back.entries.every(function (e) {
    return Object.keys(e).every(function (k) { return k === 'baseId' || k === 'count' || k === 'name'; });
  });
  yes('N5 what the engine stores is base, count and name, nothing it would drop', keysOk);
  yes('N5 and the names come back through JSON as they went in',
      JSON.stringify(back) === JSON.stringify(inv) &&
      inDir(function () { return W.holdsDeed(ALICE.a, HOME) && W.holdsMold(ALICE.a, HOME) && W.holdsKey(ALICE.a, HOME); }));
  yes('N5 and no name is near the client\'s 128 character crop',
      back.entries.every(function (e) { return !e.name || e.name.length < 128; }));
}

// ===================================================== P: drop and pickup
// Ported from the fork, 8400e636 (#49): ActionListener.cpp ResolveDroppedEntry,
// MpActor::DropItem's SetPickupExtra (worn flags stay behind) and
// MpObjectReference's pickup adding the entry back with that extra.
function extraOf(e) { const x = Object.assign({}, e); delete x.baseId; delete x.count; delete x.worn; delete x.wornLeft; return x; }
function plain(e) { return Object.keys(extraOf(e)).length === 0; }
function resolveDropped(entries, baseId, n) {
  let chosen = null;
  for (const e of entries) {
    if (e.baseId !== baseId || e.count < n) { continue; }
    if (plain(e)) { return { baseId: baseId, count: n }; }
    if (!chosen) { chosen = e; }
  }
  return chosen ? Object.assign({}, chosen, { count: n }) : { baseId: baseId, count: n };
}
function removeEntry(entries, want) {
  const i = entries.findIndex(function (e) {
    return e.baseId === want.baseId && JSON.stringify(extraOf(e)) === JSON.stringify(extraOf(want)) && e.count >= want.count;
  });
  if (i < 0) { return false; }
  entries[i].count -= want.count;
  if (entries[i].count === 0) { entries.splice(i, 1); }
  return true;
}
function drop(p, baseDesc, n) {
  const entries = pack(p);
  const e = resolveDropped(entries, idOf(baseDesc), n);
  if (!removeEntry(entries, e)) { return null; }
  const extra = extraOf(e);
  return { baseId: e.baseId, count: n, pickupExtra: Object.keys(extra).length ? extra : null };
}
function pickup(p, ref) { pack(p).push(Object.assign({ baseId: ref.baseId, count: ref.count }, ref.pickupExtra || {})); }

{
  const was = { deed: entriesOf(ALICE, DEED_DESC).length };
  const dKey = drop(ALICE, KEY_DESC, 1);
  yes('P1 with a plain key and named keys in the pack, a dropped key goes as the plain one',
      !!dKey && dKey.pickupExtra === null && entriesOf(ALICE, KEY_DESC).filter(function (e) { return e.name === KEY_NAME; }).length === 2);
  const dNamed = drop(ALICE, KEY_DESC, 1);
  yes('P2 with only named keys left, the dropped key carries "' + (dNamed && dNamed.pickupExtra && dNamed.pickupExtra.name) + '" on the reference',
      !!dNamed && !!dNamed.pickupExtra && dNamed.pickupExtra.name === KEY_NAME);
  pickup(CAROL, dNamed);
  yes('P2 and picked up by somebody else it is "' + KEY_NAME + '" in their pack, and the property block knows it',
      entriesOf(CAROL, KEY_DESC).some(function (e) { return e.name === KEY_NAME && e.count === 1; }) &&
      inDir(function () { return W.holdsKey(CAROL.a, HOME); }));
  const blanks = [drop(ALICE, MOLD_DESC, 1), drop(ALICE, MOLD_DESC, 1)];
  yes('P3 the blank molds beside the stamped one are what drop first', blanks.every(function (d) { return !!d && d.pickupExtra === null; }));
  const dMold2 = drop(ALICE, MOLD_DESC, 1);
  pickup(ALICE, dMold2);
  yes('P3 the stamped mold dropped and picked up again is still "' + MOLD_NAME + '"',
      !!dMold2 && !!dMold2.pickupExtra && dMold2.pickupExtra.name === MOLD_NAME &&
      inDir(function () { return W.holdsMold(ALICE.a, HOME); }));
  const dDeed = drop(ALICE, DEED_DESC, 1);
  pickup(ALICE, dDeed);
  yes('P4 the deed dropped and picked up again is still "' + DEED_NAME + '"',
      !!dDeed && !!dDeed.pickupExtra && dDeed.pickupExtra.name === DEED_NAME &&
      entriesOf(ALICE, DEED_DESC).length === was.deed && inDir(function () { return W.holdsDeed(ALICE.a, HOME); }));
  const worn = resolveDropped([{ baseId: 7, count: 1, name: 'Iron Helmet (85%)', worn: true }], 7, 1);
  yes('P5 a worn piece drops with its name and without its worn flag', extraOf(worn).name === 'Iron Helmet (85%)' && !('worn' in extraOf(worn)));
  const dropSrc = (/mp\.onDropItem = guard\('onDropItem', function \(actorId, baseId, count\) \{[\s\S]*?\n\}\);/.exec(gm) || [''])[0];
  yes('P6 the gamemode\'s drop handler is there and writes nothing, so the engine\'s extra is what the pickup gets',
      !!dropSrc && !/mp\.set\(|inventory/.test(dropSrc.replace(/\/\/.*$/gm, '')));
}

// ================================================================ C: client
// Ported from the fork, 1afaf2ef (#56): sync/inventory.ts namesEqual.
const FORM_NAME = {};
FORM_NAME[idOf(KEY_DESC)] = 'Key';
FORM_NAME[idOf(MOLD_DESC)] = 'Key Mold';
FORM_NAME[idOf(DEED_DESC)] = 'Deed';
function cropName(s) { return s && s.length >= 128 ? s.slice(0, 128) + '...' : s; }
function hasLevelAdded(named, pl) {
  return named.length > pl.length && named.substring(0, pl.length) === pl && /^ \([^()]+\)$/.test(named.substring(pl.length));
}
function namesEqual(a, b) {
  let aStr = a.name || '', bStr = b.name || '';
  if (cropName(aStr) === cropName(bStr)) { return true; }
  if (a.baseId === b.baseId && (!aStr || !bStr)) {
    const formName = FORM_NAME[a.baseId] || '';
    if (formName) {
      aStr = aStr || formName; bStr = bStr || formName;
      if (cropName(aStr) === cropName(bStr)) { return true; }
    }
  }
  if ((a.health || 1) > 1 || (b.health || 1) > 1) { return hasLevelAdded(aStr, bStr) || hasLevelAdded(bStr, aStr); }
  return false;
}
{
  const cases = [[KEY_DESC, 'Key', KEY_NAME], [MOLD_DESC, 'Key Mold', MOLD_NAME], [DEED_DESC, 'Deed', DEED_NAME]];
  cases.forEach(function (c) {
    const id = idOf(c[0]);
    yes('C1 the game\'s plain "' + c[1] + '" against the server\'s "' + c[2] + '" is a rename the client applies',
        !namesEqual({ baseId: id, name: c[1] }, { baseId: id, name: c[2] }) &&
        !namesEqual({ baseId: id }, { baseId: id, name: c[2] }));
    yes('C2 and once applied it is left alone', namesEqual({ baseId: id, name: c[2] }, { baseId: id, name: c[2] }));
    yes('C3 the server\'s unnamed "' + c[1] + '" against the game\'s own base name is no change',
        namesEqual({ baseId: id }, { baseId: id, name: c[1] }));
  });
  yes('C4 a key to one house is not a key to another', !namesEqual({ baseId: idOf(KEY_DESC), name: KEY_NAME }, { baseId: idOf(KEY_DESC), name: 'Key to The Shop' }));
}

const ENGINE = process.env.THORNSWOOD_ENGINE || path.join(REPO_DIR, 'engine', 'skymp');
const invTs = path.join(ENGINE, 'skymp5-client', 'src', 'sync', 'inventory.ts');
const listener = path.join(ENGINE, 'skymp5-server', 'cpp', 'server_guest_lib', 'ActionListener.cpp');
const actorCpp = path.join(ENGINE, 'skymp5-server', 'cpp', 'server_guest_lib', 'MpActor.cpp');
if (fs.existsSync(invTs) && fs.existsSync(listener) && fs.existsSync(actorCpp)) {
  const inv = read(invTs), al = read(listener), ac = read(actorCpp);
  yes('E1 the engine\'s inventory.ts has #56\'s exact compare (namesEqual, hasLevelAdded, renameInventoryItems)',
      /const namesEqual = \(a: Entry, b: Entry\): boolean =>/.test(inv) && /const hasLevelAdded =/.test(inv) &&
      /renameInventoryItems/.test(inv) && !/checkIfNameIsGeneratedByGame/.test(inv));
  yes('E2 the engine\'s drop resolves the entry with its extra and hands it to the pickup (#49)',
      /ResolveDroppedEntry/.test(al) && /SetPickupExtra/.test(ac));
} else {
  console.log('SKIP  E1, E2: no engine checkout at ' + ENGINE + ' (set THORNSWOOD_ENGINE to check the ports against it)');
}

try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
done();