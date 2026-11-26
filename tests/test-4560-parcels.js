'use strict';
/*
  test-4560-parcels.js

      node tests/test-4560-parcels.js

  #4560: no job carried an item from one person to another. A parcel is a
  letter with one real stack in it (Patrick, 12 Nov: the board's 20 and a
  courier pay the sender names, at least 15, held like a haul's). The sender
  picks the stack at the board, it leaves their pack with the gold through
  packFirst (#4901), it is held on the notice on the hold's ledger, and the
  courier hands it over face to face into the recipient's pack, through the
  same write with a receipt.

  The real property block of game/gamemode.js runs here over a pretend
  engine that keeps each character's pack twice, live and saved, with its
  receipt, the way tests/test-4901-pack-first.js does, for three people:
  Alice sends, Bob carries, Cara receives.

    A  posting: the stack and the gold leave the pack, and the parcel is on
       the board only once that pack is saved; refusals take nothing.
    B  a restart between the sender's pack write and the register write
       leaves the stack in exactly one place.
    C  the hand over: the stack goes into Cara's pack, and the parcel comes
       off the board as delivered with Bob's pay owed, once her pack is saved.
    D  a restart between Cara's pack write and the register write leaves the
       stack in exactly one place, and a parcel left on the board is handed
       over again afterwards.
    E  taken down before it is carried: the pay comes back and the stack is
       in the drop box for its sender, who takes it back there.

  Read only, apart from its own temp folders, which it removes.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const REPO_DIR = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const gm = fs.readFileSync(process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const START = process.cwd();
const temps = [];
function slice(text, start, end) {
  const a = text.indexOf(start);
  if (a < 0) { return null; }
  const b = text.indexOf(end, a + start.length);
  return b < 0 ? null : text.slice(a, b + end.length);
}
const copy = function (v) { return JSON.parse(JSON.stringify(v)); };

const property = slice(gm, '// ==== thornswood property ====', '// ==== end thornswood property ====');
yes('0 the property block is in the gamemode', !!property);
if (!property) { throw new Error('missing the property block'); }
// The parcel rules read none of the world's tables (jails, benches, items), so each table('NAME')
// the block loads is given empty here: the harness runs in any tree, not only one the content
// chain has built game/gamemode-tables in.
const P = property.replace(/\btable\('([A-Z][A-Z0-9_]*)'\)/g, '{}');

const GOLD = 0xF;
const DAGGER = 0x1397e;
const HOLD = 'whiterun';
const CELL = '3c:Skyrim.esm';
const ALICE = { a: 0xff000303, pid: 303, name: 'Alice Brightwater', pos: [50, 0, 0] };
const BOB = { a: 0xff000404, pid: 404, name: 'Bob Carter', pos: [60, 0, 0] };
const CARA = { a: 0xff000505, pid: 505, name: 'Cara Stone', pos: [100, 0, 0] };
const PEOPLE = [ALICE, BOB, CARA];
const byA = {};
PEOPLE.forEach(function (p) { byA[p.a] = p; });

/* One server's engine. people[a] = { live: { inv, receipt, properties }, saved: copy }. It outlives a restart. */
function engine() {
  const e = { people: {}, writes: 0, plain: 0 };
  PEOPLE.forEach(function (p) {
    const entries = p === ALICE ? [{ baseId: GOLD, count: 500 }, { baseId: DAGGER, count: 2 }, { baseId: 0x12eb7, count: 1, worn: true }]
      : p === BOB ? [{ baseId: GOLD, count: 10 }] : [];
    e.people[p.a] = { live: { inv: { entries: entries }, receipt: 'null', properties: {} }, saved: null };
    e.people[p.a].saved = copy(e.people[p.a].live);
  });
  e.savePack = function (a) { e.people[a].saved = copy(e.people[a].live); };
  e.restart = function () { Object.keys(e.people).forEach(function (a) { e.people[a].live = copy(e.people[a].saved); }); };
  e.count = function (a, base, which) {
    return (e.people[a][which || 'live'].inv.entries || []).reduce(function (s, x) { return s + (x.baseId === base ? x.count : 0); }, 0);
  };
  return e;
}
function mpOf(e) {
  return {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return PEOPLE.map(function (p) { return p.a; }); }
      const who = byA[id];
      if (!e.people[id] || !who) { throw new Error('no reference ' + id); }
      if (key === 'inventory') { return copy(e.people[id].live.inv); }
      if (key in e.people[id].live.properties) { return copy(e.people[id].live.properties[key]); }
      if (key === 'profileId') { return who.pid; }
      if (key === 'appearance') { return { name: who.name }; }
      if (key === 'worldOrCellDesc') { return CELL; }
      if (key === 'pos') { return who.pos.slice(); }
      return undefined;
    },
    set: function (id, key, v) {
      if (key === 'inventory' && e.people[id]) { e.people[id].live.inv = copy(v); e.plain++; }
    },
    getDescFromId: function (id) { return (id >>> 0).toString(16); },
    getIdFromDesc: function (desc) { const n = parseInt(String(desc), 16) >>> 0; return e.people[n] ? n : 0; },
    getNpcAIState: function (id) { return byA[id] ? { isHuman: true, profileId: byA[id].pid, lifeGeneration: 0 } : null; },
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
      fs.writeFileSync(file + '.tmp', text);
      fs.renameSync(file + '.tmp', file);
    },
    getNeighborsByPosition: function () { return []; },
    lookupEspmRecordById: function () { return null; }
  };
}

const clock = { t: Date.UTC(2026, 10, 26, 18, 0, 0) };
class FakeDate extends Date { static now() { return clock.t; } }
function folder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4560-'));
  temps.push(dir);
  fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
  fs.mkdirSync(path.join(dir, 'private'));
  fs.writeFileSync(path.join(dir, 'private', 'law.json'), JSON.stringify({ cells: {}, held: {} }));
  fs.writeFileSync(path.join(dir, 'private', 'property.json'), JSON.stringify({
    claims: {}, boards: { whiterun: { cell: CELL, pos: [0, 0, 0], where: 'Whiterun', placed: true },
                          riften: { cell: '16bb4:Skyrim.esm', pos: [0, 0, 0], where: 'Riften', placed: true } },
    funds: {}, notices: {}
  }));
  return dir;
}
function inDir(dir, f) { const was = process.cwd(); process.chdir(dir); try { return f(); } finally { process.chdir(was); } }
function boot(dir, e, said, deleted) {
  const mp = mpOf(e);
  const box = {
    console: { log: function () { } }, require: require, mp: mp, Date: FakeDate,
    BUILDING_BY_DOOR: {}, BUILDING_NAME: {}, WAY_OUT: {}, BENCH_BY_BASE: {},
    ITEM_NAMES: { dagger: ['Iron Dagger', (DAGGER).toString(16) + ':skyrim.esm'] },
    idOf: function () { return 0; }, notify: function () { }, say: function (a, m) { (said || []).push([a, m]); },
    guard: function (n, f) { return f; }, setInterval: function () { return 1; }, clearInterval: function () { },
    log: function () { },
    __thornswoodCharacter: { stateOf: function () { return { v: 1 }; }, writeState: function () { } },
    __thornswoodOffices: function () { return { jarl: [], court: [], steward: [], guard: [] }; },
    __thornswoodCompany: { haulFee: function () { return 10; }, stampHaul: function (n) { return n; }, cut: function () { return 0; } },
    __thornswoodMerchantTrade: {
      withQuestInventoryMutation: function (actor, change) {
        const ai = mp.getNpcAIState(actor);
        return change({ desc: mp.getDescFromId(actor), profileId: ai.profileId }, function () { return true; });
      }
    },
    __thornswoodSocial: {
      findPerson: function (want) {
        const id = parseInt(want, 16) >>> 0;
        const p = byA[id] || PEOPLE.filter(function (x) { return x.name === want; })[0];
        return p ? { actorId: p.a } : { why: 'Nobody here by that name.' };
      },
      nameOfPerson: function (a) { return byA[a] ? byA[a].name : ''; },
      profileOf: function (a) { return byA[a] ? byA[a].pid : 0; },
      push: function () { }
    }
  };
  box.globalThis = box;
  // A start with Delete-Person's list naming these profiles (#2351): the block lets what they held go.
  if (deleted) { box.__thornswoodRelease = function (name, release) { release({ profile: function (pid) { return deleted.indexOf(pid) >= 0; } }); }; }
  inDir(dir, function () { vm.runInNewContext(P, box, { filename: 'gamemode.js property' }); });
  return box.__thornswoodProperty;
}
function command(dir, W, who, line, heard) {
  const parts = String(line).trim().split(/\s+/);
  const said = [];
  inDir(dir, function () {
    W.command(parts[0].toLowerCase(), parts, who.a, who.pid, function (pid, m) { said.push(m); if (heard) { heard.push([pid, m]); } });
  });
  return said.join(' ');
}
function settle(dir, W) { inDir(dir, function () { W.settlePacks(); }); }
function register(dir) { return JSON.parse(fs.readFileSync(path.join(dir, 'private', 'property.json'), 'utf8')); }
function ownerOf(W, who) {
  const o = W.boardSubmissions && W.boardSubmissions(who.a, who.pid);
  return o && o.owner ? [o.owner.profileId, o.owner.actorDesc, o.owner.runtime] : [who.pid, (who.a >>> 0).toString(16), '123'];
}
let ids = 0;
function sendParcel(dir, W, fields) {
  const f = Object.assign({ to: 'Cara', words: 'For the road.', pay: '25', slot: '1', baseId: String(DAGGER), count: '1' }, fields || {});
  const id = (++ids).toString(16).padStart(32, 'c');
  const said = [];
  inDir(dir, function () {
    if (typeof W.submitBoard !== 'function') { said.push('no submitBoard'); return; }
    W.submitBoard(['parcel', id, HOLD, ownerOf(W, ALICE), f.to, f.words, f.pay, f.slot, f.baseId, f.count],
                  ALICE.a, ALICE.pid, function (pid, m) { said.push(m); });
  });
  return said.join(' ');
}
function parcels(doc) { return ((doc.notices || {})[HOLD] || []).filter(function (n) { return n && n.parcel; }); }
function boxDaggers(doc, by) {
  return (((doc.dropbox || {})[HOLD] || {}).items || []).reduce(function (s, x) {
    return s + (x.baseId === DAGGER && (by === undefined || x.by === by) ? x.count : 0);
  }, 0);
}
/* Where Alice's two daggers are: [in packs, on the board, in the drop box], counting both packs. */
function places(e, doc) {
  const inPacks = e.count(ALICE.a, DAGGER) + e.count(CARA.a, DAGGER);
  const onBoard = parcels(doc).filter(function (n) { return !n.down; }).reduce(function (s, n) { return s + n.parcel.count; }, 0);
  return [inPacks, onBoard, boxDaggers(doc)];
}
/* A parcel on the board, posted and saved, and taken by Bob. Answers the engine and the property block. */
function posted(dir) {
  const e = engine();
  const W = boot(dir, e);
  sendParcel(dir, W);
  e.savePack(ALICE.a);
  settle(dir, W);
  command(dir, W, BOB, '/take 1');
  return { e: e, W: W };
}

try {
  // ------------------------------------------------------------------ A
  {
    const dir = folder(), e = engine();
    const W = boot(dir, e);
    const said = sendParcel(dir, W);
    const live = e.count(ALICE.a, DAGGER) === 1 && e.count(ALICE.a, GOLD) === 455;
    const before = parcels(register(dir)).length;
    e.savePack(ALICE.a);
    settle(dir, W);
    settle(dir, W);
    const doc = register(dir);
    const p = parcels(doc);
    yes('A1 a parcel leaves the pack with its gold, 20 and the 25 pay, and one dagger ("' + said.slice(0, 80) + '")', live);
    yes('A2 it is on the board only once the pack is saved, then once, holding the dagger',
        before === 0 && p.length === 1 && p[0].parcel.count === 1 && p[0].parcel.entry.baseId === DAGGER &&
        p[0].pay === 25 && p[0].to === 'Cara' && p[0].letter === true && p[0].job === true);
    yes('A3 the 45 is on Whiterun\'s ledger, and the pack was written once with a receipt',
        doc.funds[HOLD] === 45 && e.writes === 1 && e.plain === 0 && e.count(ALICE.a, DAGGER) === 1);
    const wall = (W.boardPanel ? W.boardPanel(ALICE.a, ALICE.pid) : null);
    yes('A4 the board\'s pack list offers the dagger and not the gold or what is worn',
        !!wall && Array.isArray(wall.pack) && wall.pack.length === 1 && wall.pack[0].baseId === DAGGER && wall.pack[0].slot === 1);
    const sub = W.boardSubmissions(ALICE.a, ALICE.pid);
    yes('A5 the sender\'s page is told the parcel was posted', !!sub && sub.results.some(function (r) { return r.kind === 'parcel' && r.status === 'posted'; }));
  }
  {
    const dir = folder(), e = engine();
    const W = boot(dir, e);
    const low = sendParcel(dir, W, { pay: '14' });
    const worn = sendParcel(dir, W, { slot: '2', baseId: String(0x12eb7) });
    const many = sendParcel(dir, W, { count: '3' });
    const wrong = sendParcel(dir, W, { slot: '1', baseId: String(0x1397f) });
    e.savePack(ALICE.a);
    settle(dir, W);
    yes('A6 a pay under 15, a worn piece, more than the pack holds or a changed slot are refused, nothing taken (' +
        [low, worn, many, wrong].map(function (s) { return s.slice(0, 40); }).join(' | ') + ')',
        /15 or more/.test(low) && /Nothing was taken/.test(worn) && /Nothing was taken/.test(many) && /Nothing was taken/.test(wrong) &&
        e.count(ALICE.a, DAGGER) === 2 && e.count(ALICE.a, GOLD) === 500 && parcels(register(dir)).length === 0 && e.writes === 0);
  }
  // ------------------------------------------------------------------ B
  for (const stage of ['before the pack is saved', 'after the pack is saved']) {
    const dir = folder(), e = engine();
    const W = boot(dir, e);
    sendParcel(dir, W);
    if (stage === 'after the pack is saved') { e.savePack(ALICE.a); }
    e.restart();
    const W2 = boot(dir, e);
    settle(dir, W2);
    settle(dir, W2);
    const doc = register(dir), at = places(e, doc);
    yes('B a restart ' + stage + ' finds the dagger in one place, ' + (stage[0] === 'b' ? 'the pack' : 'the board') +
        ' (packs ' + at[0] + ', board ' + at[1] + ', box ' + at[2] + ')',
        stage[0] === 'b' ? (at[0] === 2 && at[1] === 0 && e.count(ALICE.a, GOLD) === 500 && (doc.funds[HOLD] || 0) === 0)
                         : (at[0] === 1 && at[1] === 1 && e.count(ALICE.a, GOLD) === 455 && doc.funds[HOLD] === 45));
  }
  // ------------------------------------------------------------------ C
  {
    const dir = folder();
    const s = posted(dir);
    const heard = [];
    const said = command(dir, s.W, BOB, '/deliver ' + (CARA.a >>> 0).toString(16), heard);
    const inPackBefore = s.e.count(CARA.a, DAGGER);
    const upBefore = parcels(register(dir))[0];
    s.e.savePack(CARA.a);
    settle(dir, s.W);
    settle(dir, s.W);
    const doc = register(dir), n = parcels(doc)[0];
    yes('C1 the courier hands it over: the dagger goes into Cara\'s pack with a receipt ("' + said.slice(0, 80) + '")',
        inPackBefore === 1 && !upBefore.down && s.e.plain === 0);
    yes('C2 once her pack is saved it is off the board as delivered to her, once, and Bob is owed the 25 off the ledger',
        !!n && !!n.down && n.deliveredTo === CARA.pid && n.owed === 25 && n.owedTo === BOB.pid && n.owedFor === 'carried' &&
        n.pay === 0 && doc.funds[HOLD] === 45 && (doc.debits || []).length === 0);
    yes('C3 one dagger, in Cara\'s pack and nowhere else', s.e.count(CARA.a, DAGGER) === 1 && places(s.e, doc).join() === '2,0,0' &&
        s.e.count(ALICE.a, DAGGER) === 1);
    const again = command(dir, s.W, BOB, '/deliver ' + (CARA.a >>> 0).toString(16));
    settle(dir, s.W);
    yes('C4 handing over again gives nothing more', s.e.count(CARA.a, DAGGER) === 1 && /not carrying/.test(again));
  }
  {
    const dir = folder();
    const s = posted(dir);
    const wrong = command(dir, s.W, BOB, '/deliver ' + (ALICE.a >>> 0).toString(16));
    yes('C5 the wrong person is refused and nothing moves', /What you carry is for Cara/.test(wrong) &&
        s.e.count(ALICE.a, DAGGER) === 1 && s.e.count(CARA.a, DAGGER) === 0 && !parcels(register(dir))[0].down);
    command(dir, s.W, BOB, '/deliver ' + (CARA.a >>> 0).toString(16));
    const drop = command(dir, s.W, BOB, '/dropjob 1');
    yes('C6 while it goes into her pack, the courier cannot put it back', /on its way/.test(drop) &&
        parcels(register(dir))[0].taken === BOB.pid);
  }
  // ------------------------------------------------------------------ D
  for (const stage of ['before her pack is saved', 'after her pack is saved']) {
    const dir = folder();
    const s = posted(dir);
    command(dir, s.W, BOB, '/deliver ' + (CARA.a >>> 0).toString(16));
    if (stage === 'after her pack is saved') { s.e.savePack(CARA.a); }
    s.e.restart();
    const W2 = boot(dir, s.e);
    settle(dir, W2);
    settle(dir, W2);
    const doc = register(dir), n = parcels(doc)[0], at = places(s.e, doc);
    if (stage[0] === 'b') {
      yes('D1 a restart before her pack is saved finds the dagger in one place, on the board, still Bob\'s to carry (packs ' +
          at[0] + ', board ' + at[1] + ')', at.join() === '1,1,0' && s.e.count(CARA.a, DAGGER) === 0 && !n.down &&
          n.taken === BOB.pid && n.pay === 25 && (doc.debits || []).length === 0);
      command(dir, W2, BOB, '/deliver ' + (CARA.a >>> 0).toString(16));
      s.e.savePack(CARA.a);
      settle(dir, W2);
      settle(dir, W2);
      const after = register(dir);
      yes('D2 and handed over again it lands once', s.e.count(CARA.a, DAGGER) === 1 && places(s.e, after).join() === '2,0,0' &&
          parcels(after)[0].owed === 25);
    } else {
      yes('D3 a restart after her pack is saved finds it in one place, her pack, and the parcel delivered once (packs ' +
          at[0] + ', board ' + at[1] + ')', at.join() === '2,0,0' && s.e.count(CARA.a, DAGGER) === 1 && !!n.down &&
          n.deliveredTo === CARA.pid && n.owed === 25 && (doc.debits || []).length === 0);
    }
  }
  // ------------------------------------------------------------------ E
  {
    const dir = folder(), e = engine();
    const W = boot(dir, e);
    sendParcel(dir, W);
    e.savePack(ALICE.a);
    settle(dir, W);
    const said = command(dir, W, ALICE, '/unpin 1');
    const doc = register(dir);
    yes('E1 the sender takes it down before anybody carries it: the 25 comes back and the dagger is in the drop box for her ("' +
        said.slice(0, 90) + '")', e.count(ALICE.a, GOLD) === 480 && boxDaggers(doc, ALICE.pid) === 1 &&
        parcels(doc)[0].down && places(e, doc).join() === '1,0,1');
    const row = ((((doc.dropbox || {})[HOLD] || {}).items) || []).filter(function (x) { return x.baseId === DAGGER; })[0];
    if (row) { inDir(dir, function () { W.command('/dropbox', ['/dropbox', 'take', String(row.n)], ALICE.a, ALICE.pid, function () { }); }); }
    yes('E2 and takes it back out of the box as her own', !!row && e.count(ALICE.a, DAGGER) === 2 && boxDaggers(register(dir)) === 0);
  }
  {
    const dir = folder(), e = engine();
    const W = boot(dir, e);
    sendParcel(dir, W);
    e.savePack(ALICE.a);
    settle(dir, W);
    boot(dir, e, null, [ALICE.pid]);
    const doc = register(dir);
    const p0 = parcels(doc)[0];
    yes('E3 the sender\'s character deleted: the parcel comes down and the dagger is in the drop box with no name on it, for the hold\'s officers',
        !!p0 && p0.down && boxDaggers(doc, 0) === 1 && places(e, doc).join() === '1,0,1');
  }
} finally {
  process.chdir(START);
  const temp = path.resolve(os.tmpdir());
  for (const dir of temps) {
    const owned = path.resolve(dir);
    if (owned.startsWith(temp + path.sep + 'ts-4560-') && owned !== temp) { fs.rmSync(owned, { recursive: true, force: true }); }
  }
}
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
