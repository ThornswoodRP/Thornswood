'use strict';
/*
  test-4901-pack-first.js

      node tests/test-4901-pack-first.js

  #4901: gold or goods put in the drop box, posted as a notice, job,
  letter or haul, or set down as furniture, left the pack through a plain
  inventory write and went into the register at once. The register is
  written straight away and the pack is saved with the character later, so
  a server that stopped between the two came back with the thing in the
  pack as it was saved and in the register too: a copy made from nothing,
  taken out again as the box entry, the reward or the letter's pay when the
  post comes down, the haul's pay when it is cancelled, or the piece when
  it is picked up.

  The real property and furniture blocks of game/gamemode.js run here over
  a pretend engine that keeps each character's pack twice, as the engine
  does: the live pack, and the pack as it was last saved, each with its
  receipt (the shape and the rules of tests/stand-in-server.js).
  compareAndSetInventory writes the live pack with a receipt; a plain
  inventory write changes the live pack and no receipt; a save copies the
  live pack to the saved one; a restart throws the live pack away for the
  saved one and starts the block again over the register on disk. Placed
  references outlive a restart, as the fork keeps them with the world.

  For each move it holds, with the pack's save held back:
    1 a restart before the pack is saved finds the gold or the thing in
      exactly one place, the pack, and nothing of it in the register;
    2 a restart after the pack is saved finds it in exactly one place, the
      register, once;
    3 with no restart, it lands once the pack is saved, and only once.
  And: the property and furniture blocks carry the same pack first text.

  Read only, apart from its own temp folders, which it removes.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const REPO_DIR = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8')).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const START = process.cwd();
const temps = [];
function done() {
  process.chdir(START);
  temps.forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { console.log('      could not remove ' + d + ': ' + e.message); } });
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function slice(text, start, end) {
  const a = text.indexOf(start);
  if (a < 0) { return null; }
  const b = text.indexOf(end, a + start.length);
  return b < 0 ? null : text.slice(a, b + end.length);
}
const copy = function (v) { return JSON.parse(JSON.stringify(v)); };

const P = slice(gm, '// ==== thornswood property ====', '// ==== end thornswood property ====');
const F = slice(gm, '// ==== thornswood furniture ====', '// ==== end thornswood furniture ====');
yes('0 the property and furniture blocks are in the gamemode', !!P && !!F);
if (!P || !F) { done(); }

// ------------------------------------------------------ one text, two blocks
const BEGIN = '  // -- pack first (#4901), begin --';
const END = '  // -- pack first (#4901), end --';
const inP = slice(P, BEGIN, END), inF = slice(F, BEGIN, END);
yes('1 the property and furniture blocks each carry the pack first text, the same in both', !!inP && !!inF && inP === inF);

// ------------------------------------------------------------ the engine
const GOLD = 0xF;
const DAGGER = 0x1397e;
const STOOL = 0x16000;
const HOUSE = '165a7:Skyrim.esm';
const ALICE = { a: 0xff000303, pid: 303, name: 'Alice' };
const HOLD = 'whiterun';

/*
  One server's engine. people[a] = { live: { inv, receipt }, saved: { inv, receipt } }.
  It outlives a restart: restart() throws the live packs away for the saved ones.
*/
function engine() {
  const e = { people: {}, writes: 0, plain: 0 };
  e.people[ALICE.a] = {
    live: { inv: { entries: [{ baseId: GOLD, count: 500 }, { baseId: DAGGER, count: 2 }, { baseId: STOOL, count: 2 }] }, receipt: 'null' },
    saved: null
  };
  e.people[ALICE.a].saved = copy(e.people[ALICE.a].live);
  // Placed references, which the fork keeps with the world: they outlive a restart (furniture.ts, WHERE IT IS KEPT).
  e.refs = {};
  e.nextRef = 0xff100000;
  e.savePack = function (a) { e.people[a].saved = copy(e.people[a].live); };
  e.restart = function () { Object.keys(e.people).forEach(function (a) { e.people[a].live = copy(e.people[a].saved); }); };
  e.count = function (a, base, which) {
    return (e.people[a][which || 'live'].inv.entries || []).reduce(function (s, x) { return s + (x.baseId === base ? x.count : 0); }, 0);
  };
  return e;
}
function mpOf(e) {
  const where = { profileId: ALICE.pid, appearance: { name: ALICE.name }, worldOrCellDesc: '3c:Skyrim.esm', pos: [50, 0, 0] };
  return {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return [ALICE.a]; }
      if (!e.people[id]) { throw new Error('no reference ' + id); }
      if (key === 'inventory') { return copy(e.people[id].live.inv); }
      const v = where[key];
      return (v && typeof v === 'object') ? copy(v) : v;
    },
    set: function (id, key, v) {
      if (key === 'inventory' && e.people[id]) { e.people[id].live.inv = copy(v); e.plain++; }
    },
    getDescFromId: function (id) { return (id >>> 0).toString(16); },
    getIdFromDesc: function (desc) { const n = parseInt(String(desc), 16) >>> 0; return e.people[n] ? n : 0; },
    getNpcAIState: function (id) { return e.people[id] ? { isHuman: true, profileId: ALICE.pid } : null; },
    getInventoryReceipt: function (id) { return e.people[id].live.receipt; },
    getSavedInventoryReceipt: function (id) { return e.people[id].saved.receipt; },
    compareAndSetInventory: function (id, expected, receipt, next, sequence, profile) {
      const p = e.people[id];
      if (!p || p.live.receipt !== receipt || JSON.stringify(p.live.inv) !== JSON.stringify(expected)) { return false; }
      const was = receipt === 'null' ? 0 : JSON.parse(receipt).sequence;
      if (!(sequence > was)) { throw new Error('Inventory receipt sequence must advance'); }
      p.live.inv = copy(next);
      p.live.receipt = JSON.stringify({ actor: (id >>> 0).toString(16), profile: profile, sequence: sequence });
      e.writes++;
      return true;
    },
    getNeighborsByPosition: function () { return []; },
    lookupEspmRecordById: function () { return null; }
  };
}

const clock = { t: Date.UTC(2026, 10, 12, 18, 0, 0) };
class FakeDate extends Date { static now() { return clock.t; } }
function folder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4901-'));
  temps.push(dir);
  fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
  fs.mkdirSync(path.join(dir, 'private'));
  fs.writeFileSync(path.join(dir, 'private', 'law.json'), JSON.stringify({ cells: {}, held: {} }));
  fs.writeFileSync(path.join(dir, 'private', 'property.json'), JSON.stringify({
    claims: {}, boards: { whiterun: { cell: '3c:Skyrim.esm', pos: [0, 0, 0], where: 'Whiterun', placed: true },
                          riften: { cell: '16bb4:Skyrim.esm', pos: [0, 0, 0], where: 'Riften', placed: true } },
    funds: {}, notices: {}
  }));
  return dir;
}
function inDir(dir, f) { const was = process.cwd(); process.chdir(dir); try { return f(); } finally { process.chdir(was); } }
function boot(dir, e) {
  const box = {
    console: { log: function () { } }, require: require, mp: mpOf(e), Date: FakeDate,
    BUILDING_BY_DOOR: {}, BUILDING_NAME: {}, WAY_OUT: {}, BENCH_BY_BASE: {},
    ITEM_NAMES: { dagger: ['Iron Dagger', (DAGGER).toString(16) + ':skyrim.esm'] },
    idOf: function () { return 0; }, notify: function () { }, say: function () { },
    guard: function (n, f) { return f; }, setInterval: function () { return 1; }, clearInterval: function () { },
    log: function () { },
    __thornswoodCharacter: { stateOf: function () { return { v: 1 }; }, writeState: function () { } },
    __thornswoodOffices: function () { return { jarl: [], court: [], steward: [], guard: [] }; },
    __thornswoodCompany: { haulFee: function () { return 10; }, stampHaul: function (n) { return n; },
                           cut: function () { return 0; } }
  };
  box.globalThis = box;
  inDir(dir, function () { vm.runInNewContext(P, box, { filename: 'gamemode.js property' }); });
  return box.__thornswoodProperty;
}
function command(dir, W, line) {
  const parts = String(line).trim().split(/\s+/);
  const said = [];
  inDir(dir, function () { W.command(parts[0].toLowerCase(), parts, ALICE.a, ALICE.pid, function (pid, m) { said.push(m); }); });
  return said.join(' ');
}
function settle(dir, W) { if (W && typeof W.settlePacks === 'function') { inDir(dir, function () { W.settlePacks(); }); } }
function register(dir) { return JSON.parse(fs.readFileSync(path.join(dir, 'private', 'property.json'), 'utf8')); }

/*
  Each move: what it is, the line that makes it, what it takes out of the
  pack (base and count), and how much of it the register holds.
*/
const MOVES = [
  { name: 'gold in the drop box', line: '/dropbox gold 60', base: GOLD, n: 60,
    held: function (r) { return ((r.dropbox && r.dropbox[HOLD] && r.dropbox[HOLD].items) || []).reduce(function (s, x) { return s + (x.baseId === GOLD ? x.count : 0); }, 0); } },
  { name: 'a dagger left in the drop box', line: '/dropbox leave 1 1 Lydia', base: DAGGER, n: 1,
    held: function (r) { return ((r.dropbox && r.dropbox[HOLD] && r.dropbox[HOLD].items) || []).reduce(function (s, x) { return s + (x.baseId === DAGGER ? x.count : 0); }, 0); } },
  { name: 'a notice', line: '/notice Lost cat :: grey, answers to Biscuit', base: GOLD, n: 20,
    held: function (r) { return Number((r.funds || {})[HOLD]) || 0; } },
  { name: 'a job with a 40 reward', line: '/job 40 Firewood :: two cords to the Mare', base: GOLD, n: 70,
    held: function (r) { return Number((r.funds || {})[HOLD]) || 0; } },
  { name: 'a letter', line: '/letter "Lydia" Meet me at the Mare at dusk.', base: GOLD, n: 35,
    held: function (r) { return Number((r.funds || {})[HOLD]) || 0; } },
  { name: 'a haul to Riften with 50 pay', line: '/haul 50 riften a crate of mead', base: GOLD, n: 60,
    held: function (r) { return Number((r.funds || {})[HOLD]) || 0; } }
];

MOVES.forEach(function (m) {
  // ---------------------------------------- 1 a restart before the save
  {
    const dir = folder(), e = engine(), had = e.count(ALICE.a, m.base);
    const W = boot(dir, e);
    const said = command(dir, W, m.line);
    const moved = e.count(ALICE.a, m.base) === had - m.n;
    e.restart();
    const W2 = boot(dir, e);
    settle(dir, W2);
    const inPack = e.count(ALICE.a, m.base) === had;
    const inReg = m.held(register(dir));
    yes('2 ' + m.name + ': it leaves the live pack ("' + said.slice(0, 70) + '")', moved);
    yes('2 ' + m.name + ': a restart before the pack is saved finds it in the pack and nowhere in the register (pack ' +
        e.count(ALICE.a, m.base) + ' of ' + had + ', register ' + inReg + ')', inPack && inReg === 0);
  }
  // ----------------------------------------- 2 a restart after the save
  {
    const dir = folder(), e = engine(), had = e.count(ALICE.a, m.base);
    const W = boot(dir, e);
    command(dir, W, m.line);
    e.savePack(ALICE.a);
    e.restart();
    const W2 = boot(dir, e);
    settle(dir, W2);
    settle(dir, W2);
    const W3 = boot(dir, e);
    settle(dir, W3);
    const inPack = e.count(ALICE.a, m.base) === had - m.n;
    const inReg = m.held(register(dir));
    yes('3 ' + m.name + ': a restart after the pack is saved finds it in the register, once, and out of the pack (pack ' +
        e.count(ALICE.a, m.base) + ' of ' + had + ', register ' + inReg + ')', inPack && inReg === m.n);
  }
  // ------------------------------------------------- 3 no restart at all
  {
    const dir = folder(), e = engine(), had = e.count(ALICE.a, m.base);
    const W = boot(dir, e);
    command(dir, W, m.line);
    settle(dir, W);
    const before = m.held(register(dir));
    e.savePack(ALICE.a);
    settle(dir, W);
    settle(dir, W);
    const after = m.held(register(dir));
    yes('4 ' + m.name + ': it is in the register only once the pack is saved, and then once (' + before + ' before, ' +
        after + ' after)', before === 0 && after === m.n && e.count(ALICE.a, m.base) === had - m.n);
    yes('4 ' + m.name + ': the pack was written with a receipt, never a plain write', e.writes === 1 && e.plain === 0);
  }
});

// ------------------------------------------------- a piece of furniture
/*
  The furniture block over the same engine, Alice standing in a house she
  holds, with two Bar Stools in her pack. What the register holds is the
  pieces of that row it lists.
*/
function furnitureMp(e) {
  const base = mpOf(e);
  const actorGet = base.get;
  base.get = function (id, key) {
    const r = e.refs[id];
    if (r) { return key === 'inventory' ? { entries: [] } : copy(r[key]); }
    if (id === ALICE.a && key === 'worldOrCellDesc') { return HOUSE; }
    if (id === ALICE.a && key === 'angle') { return [0, 0, 90]; }
    return actorGet(id, key);
  };
  base.place = function (baseId) {
    const id = e.nextRef++;
    e.refs[id] = { baseDesc: (baseId >>> 0).toString(16) + ':Skyrim.esm', worldOrCellDesc: HOUSE, pos: [0, 0, 0], angle: [0, 0, 0] };
    return id;
  };
  base.callPapyrusFunction = function (kind, cls, fn, self, args) {
    const id = parseInt(self.desc, 16) >>> 0;
    const r = e.refs[id];
    if (!r) { throw new Error('no reference ' + self.desc); }
    if (fn === 'SetAngle') { r.angle = args.slice(); }
    else if (fn === 'MoveTo') {
      const at = base.get(parseInt(args[0].desc, 16) >>> 0, 'pos');
      r.pos = [at[0] + args[1], at[1] + args[2], at[2] + args[3]];
    } else if (fn === 'Delete' || fn === 'Disable') { delete e.refs[id]; }
  };
  base.lookupEspmRecordById = function () { return { record: { type: 'FURN', fields: [] } }; };
  return base;
}
function bootFurniture(dir, e) {
  const doc = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'game', 'data', 'furniture.json'), 'utf8'));
  const box = {
    console: { log: function () { } }, require: require, mp: furnitureMp(e), Date: FakeDate,
    STAFF_DATA: { 'furniture.json': doc }, __dirname: path.join(REPO_DIR, 'game'),
    idOf: function (desc) {
      const s = String(desc).split(':');
      return /thornswood-content/i.test(s[1] || '') ? parseInt(s[0], 16) : (parseInt(s[0], 16) >>> 0);
    },
    notify: function () { }, say: function () { }, log: function () { },
    guard: function (n, f) { return f; }, setInterval: function () { return 1; }, clearInterval: function () { },
    __thornswoodProperty: {
      doorsOf: function (cell) { return cell === HOUSE ? ['d0d0:Skyrim.esm'] : []; },
      holderOf: function (b) { return b === HOUSE ? { by: ALICE.pid, name: ALICE.name } : null; },
      nameOf: function () { return 'the house'; },
      holdsDeed: function () { return false; }, holdsMasterKey: function () { return false; }
    }
  };
  box.globalThis = box;
  const said = [];
  box.log = function () { said.push(Array.prototype.slice.call(arguments).join(' ')); };
  box.console = { log: box.log };
  inDir(dir, function () { vm.runInNewContext(F, box, { filename: 'gamemode.js furniture' }); });
  if (!box.__thornswoodFurniture) { console.log('      the furniture block did not start: ' + said.join(' | ')); }
  return box.__thornswoodFurniture;
}
function stoolsKept(dir) {
  let doc = {};
  try { doc = JSON.parse(fs.readFileSync(path.join(dir, 'private', 'furniture.json'), 'utf8')); } catch (err) { doc = {}; }
  const pieces = doc.pieces || {};
  return Object.keys(pieces).filter(function (k) { return pieces[k] && pieces[k].key === 'stool'; }).length;
}
function place(dir, W) { let said = ''; inDir(dir, function () { said = W.command(ALICE.a, ['place', 'stool']); }); return said; }
function settleF(dir, W) { if (W && typeof W.settle === 'function') { inDir(dir, function () { W.settle(); }); } }

{
  const dir = folder(), e = engine();
  const W = bootFurniture(dir, e);
  const said = place(dir, W);
  const moved = e.count(ALICE.a, STOOL) === 1;
  e.restart();
  const W2 = bootFurniture(dir, e);
  settleF(dir, W2);
  yes('2 a stool set down: it leaves the live pack ("' + said + '")', moved);
  yes('2 a stool set down: a restart before the pack is saved finds it in the pack and nowhere in the register (pack ' +
      e.count(ALICE.a, STOOL) + ' of 2, register ' + stoolsKept(dir) + ')', e.count(ALICE.a, STOOL) === 2 && stoolsKept(dir) === 0);
}
{
  const dir = folder(), e = engine();
  const W = bootFurniture(dir, e);
  place(dir, W);
  e.savePack(ALICE.a);
  e.restart();
  const W2 = bootFurniture(dir, e);
  settleF(dir, W2);
  settleF(dir, W2);
  const W3 = bootFurniture(dir, e);
  settleF(dir, W3);
  yes('3 a stool set down: a restart after the pack is saved finds it in the register, once, and out of the pack (pack ' +
      e.count(ALICE.a, STOOL) + ' of 2, register ' + stoolsKept(dir) + ', standing ' + Object.keys(e.refs).length + ')',
      e.count(ALICE.a, STOOL) === 1 && stoolsKept(dir) === 1 && Object.keys(e.refs).length === 1);
}
{
  const dir = folder(), e = engine();
  const W = bootFurniture(dir, e);
  place(dir, W);
  settleF(dir, W);
  const before = stoolsKept(dir), stoodBefore = Object.keys(e.refs).length;
  e.savePack(ALICE.a);
  settleF(dir, W);
  settleF(dir, W);
  const after = stoolsKept(dir);
  yes('4 a stool set down: it is in the register and the world only once the pack is saved, and then once (' + before + ' before, ' +
      after + ' after, ' + stoodBefore + ' standing before)', before === 0 && stoodBefore === 0 && after === 1 &&
      Object.keys(e.refs).length === 1 && e.count(ALICE.a, STOOL) === 1);
  yes('4 a stool set down: the pack was written with a receipt, never a plain write', e.writes === 1 && e.plain === 0);
}

done();
