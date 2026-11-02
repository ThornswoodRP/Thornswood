// test-2254-master-key.js
//
// #2254. Patrick, 12 Oct 2026: a "Master key to" one building, handed with
// the deed when the building is claimed, which opens it and turns its lock,
// works only while the person it was cut for holds the building, and is
// re-cut from the mold for 2 iron ingots, the new one replacing the old.
//
// Part R reads the record in the committed content plugin with its own
// reader: ThornswoodMiscMasterKey, a MISC on the key's mesh, and no recipe
// anywhere makes it. Part A runs the REAL property block over a stand-in
// server (packs, places, the people online, the engine's record lookup) and a
// clock turned by hand: the claim, the door, the lock, the beds, a lapse, a
// deed presented at the door, a cut at a forge with each refusal, a restart,
// and a holding from before master keys.
//
// Read only, apart from its own temp folder.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'), 'utf8')).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  if (typeof HOME === 'string') {
    process.chdir(HOME);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

// ============================================== R. the record in the plugin
const ESP = path.join(ROOT, 'game', 'content', 'Thornswood-Content.esp');
const MASTER = 0x50154E0, KEY = 0x5015494;
function records(buf) {
  const out = {};
  const hs = buf.readUInt32LE(4);
  (function walk(s, e) {
    let p = s;
    while (p + 24 <= e) {
      const tag = buf.toString('latin1', p, p + 4);
      const size = buf.readUInt32LE(p + 4);
      if (tag === 'GRUP') { walk(p + 24, p + size); p += size; continue; }
      const flags = buf.readUInt32LE(p + 8), fid = buf.readUInt32LE(p + 12);
      let d = buf.subarray(p + 24, p + 24 + size);
      if (flags & 0x00040000) { d = zlib.inflateSync(d.subarray(4)); }
      const subs = {};
      let i = 0;
      while (i + 6 <= d.length) {
        const t = d.toString('latin1', i, i + 4), n = d.readUInt16LE(i + 4);
        if (!(t in subs)) { subs[t] = d.subarray(i + 6, i + 6 + n); }
        i += 6 + n;
      }
      out[fid] = { tag: tag, subs: subs };
      p += 24 + size;
    }
  })(24 + hs, buf.length);
  return out;
}
const z = (b) => b ? b.toString('latin1').replace(/\0+$/, '') : '';
{
  const r = records(fs.readFileSync(ESP));
  const m = r[MASTER];
  yes('R1 the plugin has ThornswoodMiscMasterKey at 0x50154E0, a MISC called Master Key',
      !!m && m.tag === 'MISC' && z(m.subs.EDID) === 'ThornswoodMiscMasterKey' && z(m.subs.FULL) === 'Master Key');
  yes('R2 on the key\'s own mesh, weightless and worth nothing, like the key',
      !!m && !!r[KEY] && z(m.subs.MODL) === z(r[KEY].subs.MODL) && z(m.subs.MODL) === 'Clutter\\Key01.nif' &&
      m.subs.DATA.readUInt32LE(0) === 0 && m.subs.DATA.readFloatLE(4) === 0);
  const makers = Object.keys(r).filter(function (fid) {
    return r[fid].tag === 'COBJ' && r[fid].subs.CNAM && r[fid].subs.CNAM.readUInt32LE(0) === MASTER;
  });
  yes('R3 no recipe makes one: it is handed at a claim and cut at a forge by the server', makers.length === 0);
  const tool = fs.readFileSync(path.join(ROOT, 'scripts', 'mods', 'Add-ContentRecords.py'), 'utf8');
  yes('R4 the content tool builds it, so the plugin is the tool\'s output',
      /MASTER_KEY = 0x50154E0/.test(tool) && /misc\(MASTER_KEY, 'ThornswoodMiscMasterKey',/.test(tool));
  yes('R5 and the gamemode names the same record', /var MASTER_KEY = '154e0:Thornswood-Content\.esp';/.test(gm));
}

// ===================================================== A. the property block
function slice(start, end) {
  const a = gm.indexOf(start);
  if (a < 0) { return null; }
  const b = gm.indexOf(end, a + start.length);
  return b < 0 ? null : gm.slice(a, b + end.length);
}
const propBlock = slice('// ==== thornswood property ====', '// ==== end thornswood property ====');
yes('A0 the property block is in the gamemode', !!propBlock);
if (!propBlock) { done(); }

const HOUR = 3600000, DAY = 24 * HOUR;
const clock = { t: Date.UTC(2026, 9, 12, 20, 0, 0) };
class FakeDate extends Date { static now() { return clock.t; } }

const ids = {};
let nextId = 0x05100000;
function idOf(desc) {
  desc = String(desc || '');
  if (!desc) { return 0; }
  if (!ids[desc]) {
    const m = /^([0-9a-f]+):Skyrim\.esm$/i.exec(desc);
    ids[desc] = m ? parseInt(m[1], 16) : (nextId++);
  }
  return ids[desc];
}
const descOf = {};
function descFromId(id) {
  for (const d in ids) { if (ids[d] === id) { return d; } }
  return descOf[id] || '';
}

const HOUSE = 'house:Test.esp';
const DOOR = '1001:Skyrim.esm';         // its front door, from the street
const STREET = '3c:Skyrim.esm';         // Tamriel
const BUILDING_BY_DOOR = { [DOOR]: HOUSE };
const BUILDING_NAME = { [HOUSE]: 'Honeyside' };
const FORGE_BASE = '1a2ad:Skyrim.esm';
const FORGE_REF = 0x00a00010;
const BED = 'b001:Skyrim.esm';
const HOUSE_BED = 0x00a00020;
const INGOT = '5ace4:Skyrim.esm';
const MASTER_DESC = '154e0:Thornswood-Content.esp';
const DEED_DESC = '15493:Thornswood-Content.esp';
const MOLD_DESC = '15495:Thornswood-Content.esp';
const KEY_DESC = '15494:Thornswood-Content.esp';

const HULDA = { a: 0xff000101, pid: 101, name: 'Hulda' };     // claims it
const ADRIAN = { a: 0xff000202, pid: 202, name: 'Adrian' };   // a smith
const CAROL = { a: 0xff000303, pid: 303, name: 'Carol' };     // Hulda's partner
const EVE = { a: 0xff000404, pid: 404, name: 'Eve' };         // a thief
const PEOPLE = [HULDA, ADRIAN, CAROL, EVE];

const w = { masterRecord: true };
let refs = {};
let online = [];
function world() {
  refs = {};
  refs[idOf(DOOR)] = { baseDesc: 'door:Test.esp', worldOrCellDesc: STREET, pos: [0, 0, 0] };
  refs[FORGE_REF] = { baseDesc: FORGE_BASE, worldOrCellDesc: STREET, pos: [100, 0, 0] };
  refs[HOUSE_BED] = { baseDesc: BED, worldOrCellDesc: HOUSE, pos: [0, 0, 0] };
  PEOPLE.forEach(function (p) {
    refs[p.a] = { profileId: p.pid, appearance: { name: p.name }, worldOrCellDesc: STREET,
                  pos: [50, 0, 0], inventory: { entries: [] } };
  });
  online = PEOPLE.map(function (p) { return p.a; });
}
world();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-2254-master-'));
fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
fs.mkdirSync(path.join(dir, 'private'));
// Every read of a claim can lapse it and write the register, wherever it is
// asked from, so the whole run stands in the temp folder (and leaves it at
// the end, see done).
var HOME = process.cwd();
process.chdir(dir);
const told = [];
const logged = [];

function inv(p) { return refs[p.a].inventory.entries; }
function count(p, desc) {
  const id = idOf(desc);
  return inv(p).filter(function (e) { return e.baseId === id; })
               .reduce(function (n, e) { return n + e.count; }, 0);
}
function masters(p) {
  const id = idOf(MASTER_DESC);
  return inv(p).filter(function (e) { return e.baseId === id; }).map(function (e) { return String(e.name || ''); });
}
function give(p, desc, n, name) {
  const e = { baseId: idOf(desc), count: n };
  if (name) { e.name = name; }
  inv(p).push(e);
}
function drop(p, name) {
  refs[p.a].inventory.entries = inv(p).filter(function (e) { return String(e.name || '') !== name; });
}

function boot() {
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
    getDescFromId: function (id) { return descFromId(id) || (id.toString(16) + ':Skyrim.esm'); },
    getNeighborsByPosition: function (cell) {
      return online.filter(function (a) { return refs[a] && refs[a].worldOrCellDesc === cell; });
    },
    lookupEspmRecordById: function (id) {
      if (id === idOf(MASTER_DESC)) { return w.masterRecord ? { record: { type: 'MISC' } } : null; }
      return null;
    }
  };
  function takeItem(actorId, desc, n) {
    const baseId = idOf(desc);
    const entries = refs[actorId].inventory.entries;
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].baseId !== baseId) { continue; }
      if (entries[i].count < n) { return false; }
      entries[i].count -= n;
      if (entries[i].count <= 0) { entries.splice(i, 1); }
      return true;
    }
    return false;
  }
  function addItem(actorId, desc, n) { refs[actorId].inventory.entries.push({ baseId: idOf(desc), count: n }); }
  const box = {
    console: { log: function () { logged.push([].slice.call(arguments).join(' ')); } },
    require: require, mp: mp, Date: FakeDate,
    BUILDING_BY_DOOR: BUILDING_BY_DOOR, BUILDING_NAME: BUILDING_NAME, WAY_OUT: {},
    BENCH_BY_BASE: { [FORGE_BASE]: '88105:Skyrim.esm' },
    idOf: idOf, takeItem: takeItem, addItem: addItem,
    unfitToMake: function () { return ''; },
    // The smith holds a hammer (#3162); tests/test-3162-bench-tools.js asks the refusal.
    toolGate: function () { return null; }, wearTool: function () { return null; },
    notify: function (a, line) { told.push({ a: a, line: line }); },
    say: function (a, line) { told.push({ a: a, line: line }); },
    guard: function (n, f) { return f; },
    setInterval: function () { return 0; }, clearInterval: function () { },
    log: function () { },
    __thornswoodCharacter: {
      stateOf: function (a) { return { v: 1, prof: a === ADRIAN.a ? 'smith' : 'farmer' }; },
      writeState: function () { }
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
let box = inDir(boot);
let W = box.__thornswoodProperty;
yes('A0 the property block publishes the master key', !!W && typeof W.holdsMasterKey === 'function');
if (!W || !W.holdsMasterKey) { done(); }

function linesTo(p, since) {
  return told.slice(since || 0).filter(function (t) { return t.a === p.pid || t.a === p.a; }).map(function (t) { return t.line; });
}
function to(pid, line) { told.push({ a: pid, line: line }); }
function atDoor(p) { inDir(function () { W.touched(p.a, DOOR); }); }
function claim(p) { atDoor(p); return inDir(function () { return W.claim(p.a, p.pid, to); }); }
function lock(p, on) { atDoor(p); const s = told.length; inDir(function () { W.setLock(p.a, p.pid, to, on); }); return linesTo(p, s).join(' '); }
function shut(p) { return inDir(function () { return W.shutFor(p.a, p.pid).shut.indexOf(idOf(DOOR)) !== -1; }); }
function cut(p) {
  const s = told.length;
  inDir(function () { W.cutKey(p.a, p.pid, to, ['/key', FORGE_REF.toString(16), 'master']); });
  return linesTo(p, s).join(' ');
}
function label(no) { return 'Master key to Honeyside, no. ' + no; }
function claimed() { return W.claims()[HOUSE]; }

// ---------------------------------------------------------------- the claim
{
  claim(HULDA);
  yes('C1 claiming hands the deed and the master key together',
      count(HULDA, DEED_DESC) === 1 && masters(HULDA).length === 1 && masters(HULDA)[0] === label(1));
  yes('C1 and says so', linesTo(HULDA).some(function (l) { return /master key is in your pack/.test(l); }));
  yes('C2 the claim names the number and who it was cut for',
      claimed().master && claimed().master.no === 1 && claimed().master.for === HULDA.pid);
  yes('C3 a master key is its own record, not a Key to it', count(HULDA, KEY_DESC) === 0);
}

// ------------------------------------------- what it does in somebody's hand
{
  lock(HULDA, true);
  yes('D1 locked, a stranger finds the door shut', shut(EVE) === true);
  yes('D1 and so does Carol before she has the master key', shut(CAROL) === true);
  // Hulda hands it to Carol, the way any item changes hands.
  drop(HULDA, label(1));
  give(CAROL, MASTER_DESC, 1, label(1));
  yes('D2 Carol carrying it finds the door open', shut(CAROL) === false && W.mayPass(CAROL.a, CAROL.pid, HOUSE) === true);
  atDoor(CAROL);
  yes('D3 the line at the door offers her the lock', refs[CAROL.a].thornswoodDoorLine.x === 'unlock');
  const said = lock(CAROL, false);
  yes('D3 and it turns it: "' + said + '"', claimed().locked === false && /You unlock Honeyside/.test(said));
  lock(CAROL, true);
  yes('D3 both ways', claimed().locked === true);
  yes('D4 an ordinary key still only opens: it does not turn the lock', (function () {
    give(EVE, KEY_DESC, 1, 'Key to Honeyside');
    const s = lock(EVE, false);
    drop(EVE, 'Key to Honeyside');
    return claimed().locked === true && /holder's to turn/.test(s);
  })());
  yes('D5 a master key with a number that is not the claim\'s opens nothing', (function () {
    give(EVE, MASTER_DESC, 1, label(7));
    const r = shut(EVE) === true && W.holdsMasterKey(EVE.a, HOUSE) === false;
    drop(EVE, label(7));
    return r;
  })());
  const beds = box.__thornswoodBeds;
  yes('D6 it counts as a key for the beds: a bed you are allowed in',
      inDir(function () { return beds.verdict(CAROL.a, CAROL.pid, HOUSE_BED).kind; }) === 'inn' &&
      inDir(function () { return beds.verdict(EVE.a, EVE.pid, HOUSE_BED).kind; }) === '');
  yes('D7 the lock line names it among what opens the door',
      /Only a key to it, its master key or its deed opens it/.test(lock(HULDA, true) + told.map(function (t) { return t.line; }).join(' ')));
}

// --------------------------------------- cut again at a forge, the new one replaces the old
{
  give(ADRIAN, INGOT, 2);
  let s = cut(ADRIAN);
  yes('F1 no mold in the pack cuts nothing: "' + s + '"', /key mold/.test(s) && count(ADRIAN, INGOT) === 2);
  give(ADRIAN, MOLD_DESC, 1, 'Key mold for Honeyside');
  online = online.filter(function (a) { return a !== HULDA.a; });
  s = cut(ADRIAN);
  yes('F2 with the holder not there, nothing is cut and nothing is taken: "' + s + '"',
      /has to be standing here/.test(s) && count(ADRIAN, INGOT) === 2);
  online.push(HULDA.a);
  s = cut(EVE);
  yes('F3 somebody who is not a smith cuts nothing: "' + s + '"', /smith/.test(s));
  const one = inv(ADRIAN).filter(function (e) { return e.baseId === idOf(INGOT); })[0];
  one.count = 1;
  s = cut(ADRIAN);
  yes('F4 one ingot is not enough: "' + s + '"', /2 iron ingots/.test(s) && count(ADRIAN, INGOT) === 1);
  one.count = 2;
  refs[ADRIAN.a].pos = [5000, 0, 0];
  s = cut(ADRIAN);
  yes('F5 away from the forge cuts nothing: "' + s + '"', /forge/.test(s) && count(ADRIAN, INGOT) === 2);
  refs[ADRIAN.a].pos = [50, 0, 0];
  const since = told.length;
  s = cut(ADRIAN);
  yes('F6 a smith at the forge with the mold and the holder there cuts a new one: "' + s + '"',
      count(ADRIAN, INGOT) === 0 && /You cut a master key to Honeyside and hand it to Hulda/.test(s));
  yes('F6 for two iron ingots, and it goes to the holder it is cut for, with the next number',
      masters(HULDA).indexOf(label(2)) !== -1 && masters(ADRIAN).length === 0 && claimed().master.no === 2);
  yes('F7 the one cut before it stops working: Carol\'s no. 1 opens nothing now',
      shut(CAROL) === true && W.holdsMasterKey(CAROL.a, HOUSE) === false);
  yes('F7 and both are told the old one no longer opens anything',
      /no longer opens anything/.test(s) && linesTo(HULDA, since).some(function (l) { return /no longer opens anything/.test(l); }));
  yes('F8 the mold is not spent', count(ADRIAN, MOLD_DESC) === 1);
}

// ------------------------------------------------------- a restart keeps it
{
  box = inDir(boot);
  W = box.__thornswoodProperty;
  yes('S1 after a restart the claim still names no. 2 for Hulda, and her key still works',
      claimed().master.no === 2 && claimed().master.for === HULDA.pid && W.holdsMasterKey(HULDA.a, HOUSE));
  const reg = JSON.parse(fs.readFileSync(path.join(dir, 'private', 'property.json'), 'utf8'));
  yes('S1 and the counter is in the register', reg.masters === 2);
}

// ---------------------------------- the deed presented at the door: a new holder
{
  // Eve steals the deed and walks in (the door is unlocked for this).
  lock(HULDA, false);
  drop(HULDA, 'Deed to Honeyside');
  give(EVE, DEED_DESC, 1, 'Deed to Honeyside');
  atDoor(EVE);
  yes('T1 the deed takes the house', claimed().by === EVE.pid);
  yes('T1 and Hulda\'s master key stops opening it', W.holdsMasterKey(HULDA.a, HOUSE) === false);
  yes('T2 Eve is handed a master key of her own, the next number',
      masters(EVE).indexOf(label(3)) !== -1 && claimed().master.no === 3 && claimed().master.for === EVE.pid);
  lock(EVE, true);
  yes('T3 Hulda, locked out of her old house, cannot turn its lock with her old master key either',
      shut(HULDA) === true && /holder's to turn/.test(lock(HULDA, false)) && claimed().locked === true);
}

// --------------------------------------------------- a lapse ends it as well
{
  clock.t += 15 * DAY;
  yes('L1 when the claim lapses the master key opens nothing', W.holdsMasterKey(EVE.a, HOUSE) === false &&
      !W.claims()[HOUSE]);
  claim(CAROL);
  yes('L2 the next holder\'s master key never reuses a number', masters(CAROL).indexOf(label(4)) !== -1 &&
      claimed().master.no === 4);
  yes('L2 and Eve\'s old no. 3 still opens nothing', W.holdsMasterKey(EVE.a, HOUSE) === false);
}

// ------------------------------------------ a holding from before master keys
{
  const reg = JSON.parse(fs.readFileSync(path.join(dir, 'private', 'property.json'), 'utf8'));
  delete reg.claims[HOUSE].master;
  reg.claims[HOUSE].touched = clock.t;
  fs.writeFileSync(path.join(dir, 'private', 'property.json'), JSON.stringify(reg));
  box = inDir(boot);
  W = box.__thornswoodProperty;
  refs[CAROL.a].inventory.entries = [];
  atDoor(CAROL);
  yes('O1 its holder is handed one at their own door, once', masters(CAROL).length === 1 &&
      masters(CAROL)[0] === label(5) && claimed().master.no === 5);
  atDoor(CAROL);
  yes('O1 and only once', masters(CAROL).length === 1);
  atDoor(EVE);
  yes('O2 nobody else is handed one at that door', masters(EVE).indexOf(label(5)) === -1);
}

// ------------------------------------ before the server's plugin has the record
{
  w.masterRecord = false;
  fs.writeFileSync(path.join(dir, 'private', 'property.json'), JSON.stringify({ claims: {} }));
  box = inDir(boot);
  W = box.__thornswoodProperty;
  world();
  claim(HULDA);
  yes('N1 a server without the record hands the deed and no master key, and the claim names none',
      count(HULDA, DEED_DESC) === 1 && masters(HULDA).length === 0 && !claimed().master);
  give(ADRIAN, INGOT, 2);
  give(ADRIAN, MOLD_DESC, 1, 'Key mold for Honeyside');
  const s = cut(ADRIAN);
  yes('N2 and a forge cuts none, taking nothing: "' + s + '"', /no master keys on this server yet/.test(s) &&
      count(ADRIAN, INGOT) === 2);
  w.masterRecord = true;
}

done();
