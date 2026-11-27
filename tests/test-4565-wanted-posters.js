'use strict';
/*
  test-4565-wanted-posters.js

      node tests/test-4565-wanted-posters.js

  #4565, decided 22 Oct: a person writes a wanted poster and puts it on a
  hold's notice board; its reward is put up front and held until a guard
  of that hold confirms it was earned; that hold's Jarl and guards take a
  poster down. Nothing in the game detects a crime, and Skyrim's own bounty
  stays out of it.

  The real property block of game/gamemode.js runs here over a pretend
  engine that keeps each character's pack twice, live and saved, with its
  receipt (tests/test-4901-pack-first.js has the same shape), so every take
  out of a pack and every pay into one is packFirst's.

    A  posting: the 30 and the reward leave the pack, and the poster is on
       the board only once that pack is saved; a reward of nothing, or gold
       not there, takes nothing.
    B  a restart between the poster's pack write and the register write
       leaves the gold in exactly one place.
    C  only a guard of the hold confirms the bounty, never the one who put
       it up, the Jarl, or a guard who took it; the taker is paid once.
    D  a restart between the taker's pack write and the register write
       leaves the bounty in exactly one place.
    E  only a guard or the Jarl takes a poster down, taken or not; the
       reward goes back to whoever put it up, held while they are away.

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
// The board's rules read none of the world's tables, so each table('NAME') is given empty: the
// harness runs in any tree, not only one the content chain has built game/gamemode-tables in.
// Except JAIL_NAME, the ten holds the law register keeps an office for (loadLaw): Whiterun's
// row is all this needs, so the guards and the Jarl below are read as holding their offices.
const P = property.replace(/\btable\('JAIL_NAME'\)/g, JSON.stringify({ whiterun: 'Dragonsreach Dungeon' }))
  .replace(/\btable\('([A-Z][A-Z0-9_]*)'\)/g, '{}');

const GOLD = 0xF;
const HOLD = 'whiterun';
const CELL = '3c:Skyrim.esm';
const ALICE = { a: 0xff000303, pid: 303, name: 'Alice Brightwater', gold: 500 };   // puts the poster up
const BOB = { a: 0xff000404, pid: 404, name: 'Bob Carter', gold: 10 };            // takes the bounty
const GUARD = { a: 0xff000101, pid: 101, name: 'Hrongar', gold: 0 };             // a guard of Whiterun
const GUARD2 = { a: 0xff000102, pid: 102, name: 'Irileth', gold: 0 };             // another guard of Whiterun
const JARL = { a: 0xff000111, pid: 111, name: 'Balgruuf', gold: 0 };              // the Jarl of Whiterun
const POOR = { a: 0xff000606, pid: 606, name: 'Poor', gold: 40 };
const GUARD3 = { a: 0xff000103, pid: 103, name: 'Lydia', gold: 500 };            // a guard of Whiterun who puts a poster up
const PEOPLE = [ALICE, BOB, GUARD, GUARD2, JARL, POOR, GUARD3];
const byA = {};
PEOPLE.forEach(function (p) { byA[p.a] = p; });
const OFFICES = { 101: { guard: ['whiterun'] }, 102: { guard: ['whiterun'] }, 103: { guard: ['whiterun'] }, 111: { jarl: ['whiterun'] } };

/* One server's engine. It outlives a restart; a restart puts every pack back to what was saved. */
function engine() {
  const e = { people: {}, away: {} };
  PEOPLE.forEach(function (p) {
    e.people[p.a] = { live: { inv: { entries: p.gold ? [{ baseId: GOLD, count: p.gold }] : [] }, receipt: 'null', properties: {} } };
    e.people[p.a].saved = copy(e.people[p.a].live);
  });
  e.savePack = function (a) { e.people[a].saved = copy(e.people[a].live); };
  e.restart = function () { Object.keys(e.people).forEach(function (a) { e.people[a].live = copy(e.people[a].saved); }); };
  e.gold = function (p, which) {
    return (e.people[p.a][which || 'live'].inv.entries || []).reduce(function (s, x) { return s + (x.baseId === GOLD ? x.count : 0); }, 0);
  };
  return e;
}
function mpOf(e) {
  return {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return PEOPLE.filter(function (p) { return !e.away[p.pid]; }).map(function (p) { return p.a; }); }
      const who = byA[id];
      if (!e.people[id] || !who) { throw new Error('no reference ' + id); }
      if (key === 'inventory') { return copy(e.people[id].live.inv); }
      if (key in e.people[id].live.properties) { return copy(e.people[id].live.properties[key]); }
      if (key === 'profileId') { return who.pid; }
      if (key === 'appearance') { return { name: who.name }; }
      if (key === 'worldOrCellDesc') { return CELL; }
      if (key === 'pos') { return [50, 0, 0]; }
      return undefined;
    },
    set: function (id, key, v) {
      if (key === 'inventory' && e.people[id]) { e.people[id].live.inv = copy(v); }
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4565-'));
  temps.push(dir);
  fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
  fs.mkdirSync(path.join(dir, 'private'));
  // An office is one character's (#2551): the law register names who holds each.
  fs.writeFileSync(path.join(dir, 'private', 'law.json'), JSON.stringify({ cells: {}, held: {
    'guard:whiterun': { 'p:101': { pid: 101, name: 'Hrongar' }, 'p:102': { pid: 102, name: 'Irileth' }, 'p:103': { pid: 103, name: 'Lydia' } },
    'jarl:whiterun': { 'p:111': { pid: 111, name: 'Balgruuf' } }
  } }));
  fs.writeFileSync(path.join(dir, 'private', 'property.json'), JSON.stringify({
    claims: {}, boards: { whiterun: { cell: CELL, pos: [0, 0, 0], where: 'Whiterun', placed: true } },
    funds: {}, notices: {}
  }));
  return dir;
}
function inDir(dir, f) { const was = process.cwd(); process.chdir(dir); try { return f(); } finally { process.chdir(was); } }
function boot(dir, e) {
  const mp = mpOf(e);
  const box = {
    console: { log: function () { } }, require: require, mp: mp, Date: FakeDate,
    BUILDING_BY_DOOR: {}, BUILDING_NAME: {}, WAY_OUT: {}, BENCH_BY_BASE: {},
    idOf: function () { return 0; }, notify: function () { }, say: function () { },
    guard: function (n, f) { return f; }, setInterval: function () { return 1; }, clearInterval: function () { },
    log: function () { },
    __thornswoodCharacter: { stateOf: function () { return { v: 1 }; }, writeState: function () { } },
    __thornswoodOffices: function (pid) {
      const o = OFFICES[pid] || {};
      return { jarl: o.jarl || [], court: [], steward: [], guard: o.guard || [] };
    },
    __thornswoodCompany: { haulFee: function () { return 10; }, stampHaul: function (n) { return n; }, cut: function () { return 0; } },
    __thornswoodMerchantTrade: {
      withQuestInventoryMutation: function (actor, change) {
        const ai = mp.getNpcAIState(actor);
        return change({ desc: mp.getDescFromId(actor), profileId: ai.profileId }, function () { return true; });
      }
    },
    __thornswoodSocial: {
      findPerson: function () { return { why: 'Nobody here by that name.' }; },
      nameOfPerson: function (a) { return byA[a] ? byA[a].name : ''; },
      profileOf: function (a) { return byA[a] ? byA[a].pid : 0; },
      push: function () { }
    }
  };
  box.globalThis = box;
  inDir(dir, function () { vm.runInNewContext(P, box, { filename: 'gamemode.js property' }); });
  return box.__thornswoodProperty;
}
function command(dir, W, who, line) {
  const parts = String(line).trim().split(/\s+/);
  const said = [];
  inDir(dir, function () { W.command(parts[0].toLowerCase(), parts, who.a, who.pid, function (pid, m) { if (pid === who.pid) { said.push(m); } }); });
  return said.join(' ');
}
function postWanted(dir, W, who, reward) {
  const said = [];
  inDir(dir, function () {
    W.postExact('wanted', reward, 'Wanted: Hjalti the Horse Thief',
                'Took three horses from the Whiterun stables. Bring him to the guard.', HOLD,
                who.a, who.pid, function (pid, m) { if (pid === who.pid) { said.push(m); } });
  });
  return said.join(' ');
}
function settle(dir, W) { inDir(dir, function () { W.settlePacks(); }); }
function haulTick(dir, W) { inDir(dir, function () { W.haulTick(); }); }
function register(dir) { return JSON.parse(fs.readFileSync(path.join(dir, 'private', 'property.json'), 'utf8')); }
function posters(doc) { return ((doc.notices || {})[HOLD] || []).filter(function (n) { return n && n.wanted; }); }
function ledger(doc) { return Number((doc.funds || {})[HOLD]) || 0; }
function owedTo(doc, p) {
  return (((doc.owing || {})[String(p.pid)]) || []).reduce(function (s, r) {
    return s + r.entries.reduce(function (t, x) { return t + (x.baseId === GOLD ? x.count : 0); }, 0);
  }, 0);
}
function heldOn(doc) {
  return ((doc.notices || {})[HOLD] || []).reduce(function (s, n) {
    return s + (n && !n.down ? (Math.floor(Number(n.pay)) || 0) : 0) + (n ? (Math.floor(Number(n.owed)) || 0) : 0);
  }, 0);
}
/* A wanted poster up on the board, its pack saved, and Bob holding it. */
function upAndTaken(dir, reward) {
  const e = engine();
  const W = boot(dir, e);
  postWanted(dir, W, ALICE, reward || 100);
  e.savePack(ALICE.a);
  settle(dir, W);
  command(dir, W, BOB, '/take 1');
  return { e: e, W: W };
}
/* Whatever is owed into a pack, written, saved and landed. */
function payOut(dir, W, e, who) { settle(dir, W); e.savePack(who.a); settle(dir, W); }

try {
  // ------------------------------------------------------------------ A
  {
    const dir = folder(), e = engine();
    const W = boot(dir, e);
    const said = postWanted(dir, W, ALICE, 100);
    const live = e.gold(ALICE) === 370;
    const before = posters(register(dir)).length;
    e.savePack(ALICE.a);
    settle(dir, W);
    const doc = register(dir), p = posters(doc);
    yes('A1 a wanted poster takes the 30 and the 100 reward out of the pack ("' + said.slice(0, 70) + '")', live);
    yes('A2 it is on the board only once the pack is saved, then once, holding the 100',
        before === 0 && p.length === 1 && p[0].job === true && p[0].pay === 100 && !p[0].taken);
    yes('A3 the 130 is on the hold\'s ledger, and the reward is held there', ledger(doc) === 130 && heldOn(doc) === 100);
    let view = null;
    inDir(dir, function () { view = W.boardPanel(BOB.a, BOB.pid); });
    const row = view && view.wall.filter(function (r) { return r.wanted; })[0];
    yes('A4 the wall shows it as a wanted poster with its reward, and Bob is no guard there',
        !!row && row.reward === 100 && row.job && view.bountyGuard === false);
    inDir(dir, function () { view = W.boardPanel(GUARD.a, GUARD.pid); });
    yes('A5 a guard of the hold is told they confirm bounties there', !!view && view.bountyGuard === true && view.guard === true);
    inDir(dir, function () { view = W.boardPanel(JARL.a, JARL.pid); });
    yes('A6 the Jarl takes posters down there but confirms no bounty', !!view && view.guard === true && view.bountyGuard === false);

    const r0 = postWanted(dir, W, ALICE, 0);
    yes('A7 a bounty of nothing is refused, and nothing is taken ("' + r0.slice(0, 60) + '")',
        /^A bounty is a whole number of gold, above nothing/.test(r0) && e.gold(ALICE) === 370 && posters(register(dir)).length === 1);
    const poor = postWanted(dir, W, POOR, 50);
    e.savePack(POOR.a);
    settle(dir, W);
    yes('A8 a poster whose gold is not there is refused, and nothing is taken ("' + poor.slice(0, 60) + '")',
        /80 gold/.test(poor) && e.gold(POOR) === 40 && posters(register(dir)).length === 1);
  }

  // ------------------------------------------------------------------ B
  {
    const dir = folder(), e = engine();
    let W = boot(dir, e);
    postWanted(dir, W, ALICE, 100);
    e.restart();   // the server stops before the pack's take is saved
    W = boot(dir, e);
    settle(dir, W);
    settle(dir, W);
    const doc = register(dir);
    yes('B1 a restart before the pack is saved: the gold is still in the pack and no poster is up',
        e.gold(ALICE) === 500 && posters(doc).length === 0 && ledger(doc) === 0);
  }
  {
    const dir = folder(), e = engine();
    let W = boot(dir, e);
    postWanted(dir, W, ALICE, 100);
    e.savePack(ALICE.a);
    e.restart();   // the pack is saved, and the server stops before the register is written
    W = boot(dir, e);
    settle(dir, W);
    settle(dir, W);
    const doc = register(dir);
    yes('B2 a restart after the pack is saved: the gold is out of the pack and the poster is up, once',
        e.gold(ALICE) === 370 && posters(doc).length === 1 && ledger(doc) === 130 && heldOn(doc) === 100);
  }

  // ------------------------------------------------------------------ C
  {
    const dir = folder();
    const s = upAndTaken(dir);
    const e = s.e, W = s.W;
    const byPoster = command(dir, W, ALICE, '/job done 1');
    const byJarl = command(dir, W, JARL, '/job done 1');
    const byBob = command(dir, W, BOB, '/job done 1');
    let doc = register(dir);
    yes('C1 the one who put it up cannot confirm it ("' + byPoster.slice(0, 60) + '")',
        /Only a guard of whiterun confirms/.test(byPoster) && !posters(doc)[0].down);
    yes('C2 nor can the Jarl, or the one who took it', /Only a guard/.test(byJarl) && /Only a guard/.test(byBob) &&
        !posters(doc)[0].down && posters(doc)[0].pay === 100);
    const ok = command(dir, W, GUARD, '/job done 1');
    payOut(dir, W, e, BOB);
    doc = register(dir);
    yes('C3 a guard of the hold confirms it, and the 100 is in Bob\'s pack ("' + ok.slice(0, 60) + '")',
        /Confirmed/.test(ok) && e.gold(BOB) === 110 && owedTo(doc, BOB) === 0);
    yes('C4 the poster comes down as done, by that guard, and the fee stays with the hold',
        !!posters(doc)[0].down && posters(doc)[0].paid === 100 && Number(posters(doc)[0].doneBy) === GUARD.pid &&
        ledger(doc) === 30 && heldOn(doc) === 0);
    const again = command(dir, W, GUARD2, '/job done 1');
    payOut(dir, W, e, BOB);
    yes('C5 confirming it again pays nothing more', /taken down/.test(again) && e.gold(BOB) === 110 && ledger(register(dir)) === 30);
  }
  {
    const dir = folder(), e = engine();
    const W = boot(dir, e);
    postWanted(dir, W, ALICE, 60);
    e.savePack(ALICE.a);
    settle(dir, W);
    command(dir, W, GUARD2, '/take 1');
    const self = command(dir, W, GUARD2, '/job done 1');
    yes('C6 a guard who took the bounty cannot confirm it themselves ("' + self.slice(0, 60) + '")',
        /You took that bounty yourself/.test(self) && !posters(register(dir))[0].down);
    let view = null;
    inDir(dir, function () { view = W.boardPanel(GUARD2.a, GUARD2.pid); });
    const row = view && view.wall.filter(function (r) { return r.wanted; })[0];
    yes('C7 and their panel marks it as theirs, so it offers them no Confirm', !!row && row.held === true);
    command(dir, W, GUARD, '/job done 1');
    payOut(dir, W, e, GUARD2);
    yes('C8 another guard confirms it, and the guard who earned it is paid', e.gold(GUARD2) === 60);
  }
  {
    const dir = folder(), e = engine();
    const W = boot(dir, e);
    postWanted(dir, W, GUARD3, 60);
    e.savePack(GUARD3.a);
    settle(dir, W);
    command(dir, W, BOB, '/take 1');
    const own = command(dir, W, GUARD3, '/job done 1');
    yes('C8b a guard who put the poster up cannot confirm its bounty ("' + own.slice(0, 60) + '")',
        /You put that poster up yourself/.test(own) && !posters(register(dir))[0].down && posters(register(dir))[0].pay === 60);
    command(dir, W, GUARD, '/job done 1');
    payOut(dir, W, e, BOB);
    yes('C8c another guard of the hold confirms it, and the taker is paid', e.gold(BOB) === 70);
  }
  {
    const dir = folder();
    const s = upAndTaken(dir);
    const e = s.e, W = s.W;
    e.away[BOB.pid] = true;
    command(dir, W, GUARD, '/job done 1');
    settle(dir, W);
    haulTick(dir, W);
    let doc = register(dir);
    yes('C9 confirmed while the taker is away, the 100 stays held for them', e.gold(BOB) === 10 &&
        posters(doc)[0].owed === 100 && heldOn(doc) === 100);
    delete e.away[BOB.pid];
    haulTick(dir, W);
    payOut(dir, W, e, BOB);
    doc = register(dir);
    yes('C10 and it is in their pack when they are back, once', e.gold(BOB) === 110 && !posters(doc)[0].owed &&
        heldOn(doc) === 0 && owedTo(doc, BOB) === 0 && ledger(doc) === 30);
  }

  // ------------------------------------------------------------------ D
  {
    const dir = folder();
    const s = upAndTaken(dir);
    const e = s.e;
    let W = s.W;
    command(dir, W, GUARD, '/job done 1');
    settle(dir, W);   // the bounty is written into Bob's pack, not yet saved
    e.restart();
    W = boot(dir, e);
    let doc = register(dir);
    const owed = owedTo(doc, BOB);
    payOut(dir, W, e, BOB);
    doc = register(dir);
    yes('D1 a restart before Bob\'s pack is saved: the bounty is still owed, then paid once (' + owed + ' owed)',
        owed === 100 && e.gold(BOB) === 110 && owedTo(doc, BOB) === 0);
  }
  {
    const dir = folder();
    const s = upAndTaken(dir);
    const e = s.e;
    let W = s.W;
    command(dir, W, GUARD, '/job done 1');
    settle(dir, W);
    e.savePack(BOB.a);
    e.restart();   // Bob's pack is saved with the 100, and the server stops before the register is written
    W = boot(dir, e);
    settle(dir, W);
    settle(dir, W);
    e.savePack(BOB.a);
    settle(dir, W);
    const doc = register(dir);
    yes('D2 a restart after Bob\'s pack is saved: the 100 is in his pack and owed no more, so it is never paid twice',
        e.gold(BOB) === 110 && owedTo(doc, BOB) === 0);
  }

  // ------------------------------------------------------------------ E
  {
    const dir = folder(), e = engine();
    const W = boot(dir, e);
    postWanted(dir, W, ALICE, 100);
    e.savePack(ALICE.a);
    settle(dir, W);
    const own = command(dir, W, ALICE, '/unpin 1');
    const bob = command(dir, W, BOB, '/unpin 1');
    let doc = register(dir);
    yes('E1 the one who put it up cannot take it down, nor can anybody else ("' + own.slice(0, 60) + '")',
        /Only a guard of whiterun or its Jarl takes a wanted poster down/.test(own) && /Only a guard/.test(bob) &&
        !posters(doc)[0].down && heldOn(doc) === 100);
    const jarl = command(dir, W, JARL, '/unpin 1');
    payOut(dir, W, e, ALICE);
    doc = register(dir);
    yes('E2 the Jarl takes it down, and the 100 goes back to whoever put it up ("' + jarl.slice(0, 70) + '")',
        !!posters(doc)[0].down && e.gold(ALICE) === 470 && heldOn(doc) === 0);
    yes('E3 the 30 fee stays with the hold', ledger(doc) === 30);
  }
  {
    const dir = folder();
    const s = upAndTaken(dir, 80);
    const e = s.e, W = s.W;
    command(dir, W, GUARD, '/unpin 1');
    payOut(dir, W, e, ALICE);
    let doc = register(dir);
    let view = null;
    inDir(dir, function () { view = W.boardPanel(BOB.a, BOB.pid); });
    yes('E4 a guard takes down a poster somebody has taken, the 80 goes back, and it is off the taker\'s list',
        !!posters(doc)[0].down && e.gold(ALICE) === 500 - 30 && heldOn(doc) === 0 && !!view && view.jobs.length === 0);
    const late = command(dir, W, GUARD2, '/job done 1');
    yes('E5 a poster taken down pays no bounty after', /taken down/.test(late) && e.gold(BOB) === 10);
  }
  {
    const dir = folder(), e = engine();
    const W = boot(dir, e);
    postWanted(dir, W, ALICE, 100);
    e.savePack(ALICE.a);
    settle(dir, W);
    e.away[ALICE.pid] = true;
    command(dir, W, GUARD, '/unpin 1');
    settle(dir, W);
    haulTick(dir, W);
    let doc = register(dir);
    yes('E6 taken down while the one who put it up is away, the 100 is held for them', e.gold(ALICE) === 370 &&
        posters(doc)[0].owed === 100 && posters(doc)[0].owedFor === 'wanted');
    delete e.away[ALICE.pid];
    haulTick(dir, W);
    const owedLine = ((register(dir).owing || {})[String(ALICE.pid)] || []).map(function (r) { return r.line; }).join(' ');
    payOut(dir, W, e, ALICE);
    doc = register(dir);
    yes('E7 and back in their pack when they are, with a line that says it was a wanted poster ("' + owedLine.slice(0, 70) + '")',
        e.gold(ALICE) === 470 && /your wanted poster in whiterun was taken down/.test(owedLine) && heldOn(doc) === 0);
  }
} catch (err) {
  // A check that throws is a failed check, and the count below still prints.
  yes('the harness ran to its end (' + (err && err.message ? err.message : err) + ')', false);
} finally {
  process.chdir(START);
  temps.forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { } });
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
