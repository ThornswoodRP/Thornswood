'use strict';
/*
  test-4258-record-first.js

      node tests/test-4258-record-first.js

  #4258: taking from the drop box, a hauler's owed pay and an inn's takings
  all put the gold in the person's pack first, then saved the record that
  it was gone. The pack is saved with the character later, and the register
  is written now, so a register write that failed, or a server that stopped
  before it, left the gold in the saved pack and still in the register, to
  be paid again after the restart.

  Since #4258 a payout writes no pack. What the register stops holding is
  owed to the profile in the same register (owing), and the server's pack
  tick pays it through packFirst (#4901): the debit row durably first, then
  the pack and its marker together, and the owed row comes off only once the
  engine says the pack was saved with that marker.

  The real property block of game/gamemode.js runs here over a pretend
  engine that keeps each character's pack twice, as the engine does: the
  live pack, and the pack as it was last saved, each with its receipt (the
  engine of tests/test-4901-pack-first.js). A restart throws the live pack
  away for the saved one and starts the block again over the register on
  disk.

  For gold and for a dagger taken out of the drop box, with the pack's save
  held back, it holds that the thing is in exactly one place, the box, what
  the register owes, or the pack as it is saved, at every point:
    1 the take owes it in the same register write that takes the row down;
    2 a restart after the take, before any tick, finds it owed, once;
    3 a restart after the tick wrote the live pack, before the pack was
      saved, finds it owed and not in the pack, and the next ticks pay it;
    4 a restart after the pack was saved finds it in the pack and no longer
      owed;
    5 with no restart, it is in the pack and off the register, once;
    6 a register that cannot be written pays nothing into the pack.
  And: the takings #1392 kept are not read.

  Read only, apart from its own temp folders, which it removes.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const REPO_DIR = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const gm = fs.readFileSync(path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8').split(CR).join('');

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
  process.exitCode = fail ? 1 : 0;
}
function slice(text, start, end) {
  const a = text.indexOf(start);
  if (a < 0) { return null; }
  const b = text.indexOf(end, a + start.length);
  return b < 0 ? null : text.slice(a, b + end.length);
}
const copy = function (v) { return JSON.parse(JSON.stringify(v)); };

const property = slice(gm, '// ==== thornswood property ====', '// ==== end thornswood property ====');
yes('0 the property block is in the gamemode', !!property);
if (!property) { done(); throw new Error('missing the property block'); }
const { joined } = require('./gamemode-tables.js');
const P = joined(property);

// ------------------------------------------------------------ the engine
const GOLD = 0xF;
const DAGGER = 0x1397e;
const ALICE = { a: 0xff000303, pid: 303, name: 'Alice' };
const HOLD = 'whiterun';

function engine() {
  const e = { people: {}, writes: 0, plain: 0 };
  e.people[ALICE.a] = {
    live: { inv: { entries: [{ baseId: GOLD, count: 500 }, { baseId: DAGGER, count: 2 }] }, receipt: 'null', properties: {} },
    saved: null
  };
  e.people[ALICE.a].saved = copy(e.people[ALICE.a].live);
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
      if (key in e.people[id].live.properties) { return copy(e.people[id].live.properties[key]); }
      const v = where[key];
      return (v && typeof v === 'object') ? copy(v) : v;
    },
    set: function (id, key, v) {
      if (key === 'inventory' && e.people[id]) { e.people[id].live.inv = copy(v); e.plain++; }
    },
    getDescFromId: function (id) { return (id >>> 0).toString(16); },
    getIdFromDesc: function (desc) { const n = parseInt(String(desc), 16) >>> 0; return e.people[n] ? n : 0; },
    getNpcAIState: function (id) { return e.people[id] ? { isHuman: true, profileId: ALICE.pid, lifeGeneration: 0 } : null; },
    getActorRuntimeIdentity: function () { return '123'; },
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
    compareAndSetInventoryAndProperty: function (id, expected, receipt, next, sequence, profile, property) {
      const live = e.people[id].live;
      if ((live.properties[property.name] ?? null) !== property.expected) { return false; }
      if (property.expectedLifeGeneration !== 0 || property.expectedRuntimeIdentity !== '123') { return false; }
      const changed = this.compareAndSetInventory(id, expected, receipt, next, sequence, profile);
      if (changed) { live.properties[property.name] = property.replacement; }
      return changed;
    },
    writeFileWhole: function (file, text) {
      if (e.refuseRegister === path.basename(file)) { throw new Error('register replacement temporarily refused'); }
      fs.writeFileSync(file + '.tmp', text);
      fs.renameSync(file + '.tmp', file);
    },
    getNeighborsByPosition: function () { return []; },
    lookupEspmRecordById: function () { return null; }
  };
}

const clock = { t: Date.UTC(2026, 10, 26, 18, 0, 0) };
class FakeDate extends Date { static now() { return clock.t; } }
function folder(beds) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4258-'));
  temps.push(dir);
  fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
  fs.mkdirSync(path.join(dir, 'private'));
  fs.writeFileSync(path.join(dir, 'private', 'law.json'), JSON.stringify({ cells: {}, held: {} }));
  fs.writeFileSync(path.join(dir, 'private', 'property.json'), JSON.stringify({
    claims: {}, boards: { whiterun: { cell: '3c:Skyrim.esm', pos: [0, 0, 0], where: 'Whiterun', placed: true } },
    funds: {}, notices: {}
  }));
  if (beds) { fs.writeFileSync(path.join(dir, 'private', 'beds.json'), JSON.stringify(beds)); }
  return dir;
}
function inDir(dir, f) { const was = process.cwd(); process.chdir(dir); try { return f(); } finally { process.chdir(was); } }
function registerModules(e) {
  const files = Object.create(fs);
  files.renameSync = function (from, to) {
    if (e.refuseRegister === path.basename(to)) { throw new Error('register replacement temporarily refused'); }
    return fs.renameSync(from, to);
  };
  return function (name) { return name === 'fs' ? files : require(name); };
}
function boot(dir, e) {
  const box = {
    console: { log: function () { } }, require: registerModules(e), mp: mpOf(e), Date: FakeDate,
    BUILDING_BY_DOOR: {}, BUILDING_NAME: {}, WAY_OUT: {}, BENCH_BY_BASE: {},
    ITEM_NAMES: { dagger: ['Iron Dagger', (DAGGER).toString(16) + ':skyrim.esm'] },
    idOf: function () { return 0; }, notify: function () { }, say: function () { },
    guard: function (n, f) { return f; }, setInterval: function () { return 1; }, clearInterval: function () { },
    log: function () { },
    __thornswoodCharacter: { stateOf: function () { return { v: 1 }; }, writeState: function () { } },
    __thornswoodOffices: function () { return { jarl: [], court: [], steward: [], guard: [] }; },
    __thornswoodCompany: { haulFee: function () { return 10; }, stampHaul: function (n) { return n; }, cut: function () { return 0; } }
  };
  box.__thornswoodMerchantTrade = {
    withQuestInventoryMutation: function (actor, change) {
      const ai = box.mp.getNpcAIState(actor);
      return change({ desc: box.mp.getDescFromId(actor), profileId: ai.profileId }, function () { return true; });
    }
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
function tick(dir, W) { inDir(dir, function () { W.settlePacks(); }); }
function register(dir) { return JSON.parse(fs.readFileSync(path.join(dir, 'private', 'property.json'), 'utf8')); }
function inBox(r, base) {
  return ((r.dropbox && r.dropbox[HOLD] && r.dropbox[HOLD].items) || []).reduce(function (s, x) { return s + (x.baseId === base ? x.count : 0); }, 0);
}
function owed(r, base) {
  return ((r.owing && r.owing[ALICE.pid]) || []).reduce(function (s, row) {
    return s + row.entries.reduce(function (n, x) { return n + (x.baseId === base ? x.count : 0); }, 0);
  }, 0);
}

/*
  A box row of Alice's, put in, landed and saved, so the take starts from a
  quiet pack: 60 gold, or one of her two daggers.
*/
const THINGS = [
  { name: 'gold', put: '/dropbox gold 60', base: GOLD, n: 60 },
  { name: 'a dagger', put: '/dropbox leave 1 1 Alice', base: DAGGER, n: 1 }
];
function ready(m) {
  const dir = folder(), e = engine();
  const W = boot(dir, e);
  command(dir, W, m.put);
  e.savePack(ALICE.a);
  tick(dir, W);
  const row = register(dir).dropbox[HOLD].items.filter(function (x) { return x.baseId === m.base; })[0];
  const total = e.count(ALICE.a, m.base, 'saved') + inBox(register(dir), m.base);
  return { dir: dir, e: e, W: W, row: row, total: total };
}
/* Where the thing is, counted the way a restart would find it: the saved pack, the box and what is owed, on disk. */
function places(s) {
  const r = register(s.dir);
  return { pack: s.e.count(ALICE.a, s.row.baseId, 'saved'), box: inBox(r, s.row.baseId), owed: owed(r, s.row.baseId) };
}
function once(s, p) { return p.pack + p.box + p.owed === s.total; }
function said(p) { return 'saved pack ' + p.pack + ', box ' + p.box + ', owed ' + p.owed; }

THINGS.forEach(function (m) {
  // ------------------------------------------ 1 and 2, the take, then a restart
  {
    const s = ready(m);
    yes('1 ' + m.name + ' is in the box to start with, once', !!s.row && inBox(register(s.dir), m.base) === m.n);
    const writes = s.e.writes;
    command(s.dir, s.W, '/dropbox take ' + s.row.n);
    let p = places(s);
    yes('1 ' + m.name + ': the take owes it in the same register write that takes the row down, and writes no pack (' + said(p) + ')',
        p.box === 0 && p.owed === m.n && once(s, p) && s.e.writes === writes && s.e.plain === 0);
    s.e.restart();
    const W2 = boot(s.dir, s.e);
    p = places(s);
    yes('2 ' + m.name + ': a restart before any tick finds it owed, once, and not in the pack (' + said(p) + ')',
        p.owed === m.n && once(s, p));
    tick(s.dir, W2);
    s.e.savePack(ALICE.a);
    tick(s.dir, W2);
    p = places(s);
    yes('2 ' + m.name + ': and the ticks after it pay it into the pack, once (' + said(p) + ')',
        p.owed === 0 && p.box === 0 && once(s, p));
  }
  // ------------------------- 3, the tick wrote the live pack, not yet saved
  {
    const s = ready(m);
    command(s.dir, s.W, '/dropbox take ' + s.row.n);
    tick(s.dir, s.W);
    const live = s.e.count(ALICE.a, m.base) - s.e.count(ALICE.a, m.base, 'saved');
    let p = places(s);
    yes('3 ' + m.name + ': the tick writes it into the live pack with a receipt, and it stays owed until the pack is saved (' + said(p) + ')',
        live === m.n && p.owed === m.n && once(s, p) && s.e.plain === 0);
    s.e.restart();
    const W2 = boot(s.dir, s.e);
    tick(s.dir, W2);
    p = places(s);
    yes('3 ' + m.name + ': a restart before the pack is saved finds it owed and not in the pack (' + said(p) + ')',
        p.owed === m.n && p.pack === s.total - m.n && once(s, p));
    s.e.savePack(ALICE.a);
    tick(s.dir, W2);
    tick(s.dir, W2);
    p = places(s);
    yes('3 ' + m.name + ': and once the pack is saved it is in the pack and owed no more, once (' + said(p) + ')',
        p.owed === 0 && p.pack === s.total && once(s, p));
  }
  // ---------------------------------------- 4, the pack saved, then a restart
  {
    const s = ready(m);
    command(s.dir, s.W, '/dropbox take ' + s.row.n);
    tick(s.dir, s.W);
    s.e.savePack(ALICE.a);
    s.e.restart();
    const W2 = boot(s.dir, s.e);
    let p = places(s);
    yes('4 ' + m.name + ': a restart after the pack is saved, before the tick lands it, still has it in one place, the pack, with the owing waiting on the debit (' + said(p) + ')',
        p.pack === s.total && (register(s.dir).debits || []).length === 1);
    tick(s.dir, W2);
    tick(s.dir, W2);
    p = places(s);
    yes('4 ' + m.name + ': the first tick lands it: owed no more, and paid once (' + said(p) + ')',
        p.owed === 0 && p.pack === s.total && once(s, p) && s.e.count(ALICE.a, m.base) === s.total);
  }
  // ------------------------------------------------------- 5, no restart
  {
    const s = ready(m);
    command(s.dir, s.W, '/dropbox take ' + s.row.n);
    tick(s.dir, s.W);
    s.e.savePack(ALICE.a);
    tick(s.dir, s.W);
    tick(s.dir, s.W);
    tick(s.dir, s.W);
    const p = places(s);
    yes('5 ' + m.name + ': with no restart it is in the pack and off the register, once, and more ticks pay nothing more (' + said(p) + ')',
        p.owed === 0 && p.pack === s.total && s.e.count(ALICE.a, m.base) === s.total && once(s, p) &&
        (register(s.dir).debits || []).length === 0);
  }
  // ---------------------------------------- 6, the register cannot be written
  {
    const s = ready(m);
    s.e.refuseRegister = 'property.json';
    const writes = s.e.writes;
    command(s.dir, s.W, '/dropbox take ' + s.row.n);
    tick(s.dir, s.W);
    tick(s.dir, s.W);
    let p = places(s);
    yes('6 ' + m.name + ': a register that cannot be written pays nothing into the pack, live or saved (' + said(p) + ')',
        s.e.writes === writes && s.e.count(ALICE.a, m.base) === s.total - m.n && p.box === m.n && p.owed === 0 && once(s, p));
    s.e.restart();
    const W2 = boot(s.dir, s.e);
    tick(s.dir, W2);
    p = places(s);
    yes('6 ' + m.name + ': and a restart finds it in the box, once, as the register last said (' + said(p) + ')',
        p.box === m.n && p.owed === 0 && once(s, p));
  }
});

// ---------------------------------------------- the takings #1392 kept
{
  const dir = folder({ guests: {}, takings: { [ALICE.pid]: 20 } }), e = engine();
  const W = boot(dir, e);
  tick(dir, W);
  e.savePack(ALICE.a);
  tick(dir, W);
  yes('the takings #1392 kept are not read, and nothing pays them into a pack', e.count(ALICE.a, GOLD) === 500 && e.writes === 0);
}

done();
