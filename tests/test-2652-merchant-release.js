'use strict';
/*
  test-2652-merchant-release.js

      node tests/test-2652-merchant-release.js

  #2652, after #2351: when somebody is deleted, the game server lets go of
  what the guild traders' ledger (private\merchant-ledger.json) holds of
  their character, through the purse service's own release(), as the NPC
  startup reads the purses. This runs the real purse service of
  game\gamemode.js on a real ledger file in a scratch folder:

    S  the startup asks for the merchants' part once the purses are read,
       before trading is installed; 'merchants' is a part; the parts still
       waiting are said after the NPC startup, the last block that asks
    M  a supply wait of theirs goes, by profile and by form id; another's
       stays; a placed form's desc is never taken for a character
    T  a trade waiting on them is cleared: in debit the trader stays as it
       was, in credit it keeps what it already holds, with no supply wait
       stamped for them; a trade waiting on somebody else stays
    C  no coin or goods are made or lost: every purse and shelf is the same
    V  each changed entry's revision rises by one, the file verifies and
       loads again, and the service goes on (read, compareAndCommit)
    A  a retired trader's waiting trade is let go too
    K  each trader's own saved copy (the thornswoodMerchant property) that
       names them is written from the ledger, a retired trader's too, and no
       longer names them; a copy naming nobody there is not written; a copy
       left naming them by an earlier start whose copy write did not take is
       found and written on the next, with no ledger write
    N  a second run, or a list naming nobody there, writes nothing
    P  a commission promise held for them, and a finished one cooling down,
       goes (by profile, and by form id when the owner names no plugin);
       a commission waiting on them in debit is cleared with its promise;
       what is left still reads as promises
    B  a trader holding something of theirs while somebody else's trade
       waits there stops the part with nothing written, said
    F  a save that fails writes nothing, revokes the service, and the part
       waits for the next start (through the release block)
    L  the release block's log line is counts, never an id

  Nothing leaves this machine. The scratch folder goes at the end.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const gm = fs.readFileSync(path.join(REPO, 'game', 'gamemode.js'), 'utf8').split(String.fromCharCode(13)).join('');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function between(a, b, withEnd) {
  const i = gm.indexOf(a); if (i < 0) { return null; }
  const k = gm.indexOf(b, i + a.length); if (k < 0) { return null; }
  return gm.slice(i, withEnd ? k + b.length : k);
}
const purseSrc = between('// NPC MERCHANT PURSES BEGIN', '// NPC MERCHANT PURSES END');
const releaseSrc = between('// ==== thornswood release of deleted characters ====', '// ==== end thornswood release of deleted characters ====', true);
const startup = between('// NPC SERVER STARTUP BEGIN', '// NPC SERVER STARTUP END', true);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-2652-'));
function done() {
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
yes('S0 the purse service, the release block and the NPC startup are where this looks', !!purseSrc && !!releaseSrc && !!startup);
if (!purseSrc || !releaseSrc || !startup) { done(); }

// ---------------------------------------------------------------- S
const ask = "globalThis.__thornswoodRelease('merchants',merchants.release)";
yes('S1 the NPC startup asks for the merchants\' part', startup.indexOf(ask) > 0);
yes('S2 once the purses are read, before trading is installed',
    startup.indexOf('merchants=createNpcMerchantPurses(') < startup.indexOf(ask) &&
    startup.indexOf(ask) < startup.indexOf('MERCHANT_TRADING.installMerchantTrading('));
yes('S3 merchants is a part of the release', /var PARTS = \[[^\]]*'merchants'[^\]]*\];/.test(releaseSrc));
const waitAt = gm.indexOf('globalThis.__thornswoodReleaseWaiting();');
yes('S4 the parts still waiting are said once, after the NPC startup',
    waitAt > gm.indexOf('// NPC SERVER STARTUP END') && gm.indexOf('globalThis.__thornswoodReleaseWaiting();', waitAt + 1) < 0);
yes('S5 the purse service answers release beside compareAndCommit', /return \{prepare,read,commit,compareAndCommit,pendingRecords,ledgerStates,release,/.test(purseSrc));
const dp = fs.readFileSync(path.join(REPO, 'scripts', 'vps', 'Delete-Person.ps1'), 'utf8');
yes('S6 Delete-Person counts the merchant ledger as released', /const RELEASED = \/\^\([^)]*\|merchant-ledger\)\\\.json\$\/i;/.test(dp));
// S7, that the deletion runbook says the ledger is let go, left with
// WEBSITE-OPERATIONS.md for the private ops repo (#3693), whose
// tests/test-ops-docs.js holds it.

// ---------------------------------------------------------------- stand-ins
const NOW = Date.now();
const P1 = 5001, PY = 6001, P9 = 9999;
const A1 = 0xff000a01, A2 = 0xff000a02, AY = 0xff000a09;
const hex = (n) => n.toString(16);
// One shape (#2870): a supply key holds the full runtime form id, the same
// number the deleted-characters list names; a runtime desc is the local hex.
const key = (a, p, what) => JSON.stringify([a, p, what]);
const runtimeDesc = (a) => (a - 0xff000000).toString(16);
const REF = ['9:Skyrim.esm', '8:Skyrim.esm', '7:Skyrim.esm', '6:Skyrim.esm'];  // 6 is retired
const BASE = 'a:Skyrim.esm';
const sum = (doc) => crypto.createHash('sha256').update(JSON.stringify([doc.version, doc.entries])).digest('hex');
function entry(ref, extra) {
  return Object.assign({ version: 1, reference: ref, base: BASE, purse: 300, stock: [{ baseId: 4096, count: 2 }], revision: 4 }, extra);
}
function human(a, p) { return { desc: runtimeDesc(a), profileId: p }; }
function seed(priv) {
  fs.mkdirSync(priv, { recursive: true });
  const entries = {
    // Credit: the trader already holds next, which stamped their supply wait.
    '9:Skyrim.esm': entry('9:Skyrim.esm', {
      purse: 280, stock: [{ baseId: 4096, count: 3 }],
      supply: { [key(A1, P1, 'iron ore')]: NOW, [key(A2, P9, 'wheat')]: NOW - 1000, [key(AY, PY, 'iron ore')]: NOW, '7:Skyrim.esm placed': NOW },
      pending: { version: 3, id: 'dev:9:4', human: human(A1, P1), kind: 'supply', phase: 'credit',
                 previous: { supply: { [key(A2, P9, 'wheat')]: NOW - 1000, [key(AY, PY, 'iron ore')]: NOW } },
                 next: { purse: 280, stock: [{ baseId: 4096, count: 3 }], supply: {} }, credit: [{ baseId: 15, count: 20 }] }
    }),
    // Debit: the trader is still as it was before the trade.
    '8:Skyrim.esm': entry('8:Skyrim.esm', {
      supply: {},
      pending: { version: 3, id: 'dev:8:4', human: human(A2, 77), kind: 'buy', phase: 'debit',
                 previous: { purse: 300, stock: [{ baseId: 4096, count: 2 }], supply: {} },
                 next: { purse: 310, stock: [{ baseId: 4096, count: 1 }], supply: {} } }
    }),
    // Somebody else's waiting trade, and a key whose number is only A1's local part.
    '7:Skyrim.esm': entry('7:Skyrim.esm', {
      supply: { [JSON.stringify([0xa01, 0, 'wheat'])]: NOW },
      pending: { version: 3, id: 'dev:7:4', human: human(AY, PY), kind: 'sell', phase: 'debit',
                 previous: { purse: 300, stock: [{ baseId: 4096, count: 2 }], supply: {} },
                 next: { purse: 290, stock: [{ baseId: 4096, count: 3 }], supply: {} } }
    }),
    // Retired: it only finishes saved work, and lets go the same.
    '6:Skyrim.esm': entry('6:Skyrim.esm', {
      pending: { version: 3, id: 'dev:6:4', human: human(A1, P1), kind: 'buy', phase: 'credit',
                 previous: { supply: {} }, next: { purse: 320, stock: [], supply: {} } },
      purse: 320, stock: []
    })
  };
  const doc = { version: 2, entries: entries };
  fs.writeFileSync(path.join(priv, 'merchant-ledger.json'), JSON.stringify({ version: 2, entries: entries, sha256: sum(doc) }));
  fs.writeFileSync(path.join(priv, 'merchant-ledger.initialized'), '1');
}
function open(dir, opt) {
  opt = opt || {};
  const logged = [], mirror = new Map(opt.copies || []);
  const box = { require: require, Buffer: Buffer, console: { log: function () { logged.push(Array.prototype.join.call(arguments, ' ')); } },
                log: function () { logged.push(Array.prototype.join.call(arguments, ' ')); } };
  // The world the release block asks whether a listed id is held now: the
  // listed characters' forms are gone, which the engine says in its own words
  // (WorldState::GetFormAt, #5036).
  box.mp = { get: function (id) { throw new Error('Form with id 0x' + (Number(id) >>> 0).toString(16) + " doesn't exist"); } };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(purseSrc, box, { filename: 'gamemode.js (purses)' });
  const settings = { privDir: path.join(dir, 'private'), dataDir: path.join(dir, 'data'), thornswoodServer: 'dev' };
  fs.mkdirSync(settings.dataDir, { recursive: true });
  // The game server's durable writer (mp.writePrivateEconomyLedger), as a file replaced whole.
  const writer = function (name, bytes) {
    const file = path.join(settings.privDir, name + '-ledger.json');
    fs.writeFileSync(file + '.tmp', bytes); fs.renameSync(file + '.tmp', file); return true;
  };
  let storage = box.createPrivateMerchantLedger(fs, path, settings, REF, writer);
  if (opt.failSave) { const real = storage; storage = Object.assign({}, real, { save: function () { throw new Error('rename denied'); } }); }
  const api = {
    makeProperty: function () { }, getIdFromDesc: function (d) { return { '9:Skyrim.esm': 9, '8:Skyrim.esm': 8, '7:Skyrim.esm': 7, '6:Skyrim.esm': 6 }[d] || 0; },
    getNpcAIState: function () { return { isHuman: false }; },
    get: function (id, k) { return k === 'baseDesc' ? BASE : mirror.get(id); },
    set: function (id, k, v) {
      if (opt.failSet === id) { throw new Error('the copy could not be written'); }
      mirror.set(id, JSON.parse(JSON.stringify(v)));
    }
  };
  const data = { keep: REF.slice(0, 3).map(function (r) { return [r, BASE, null, null, null, null, 'trader']; }), merchantHistory: REF.map(function (r) { return [r, BASE]; }) };
  const purses = box.createNpcMerchantPurses(api, data, storage);
  return { box: box, purses: purses, logged: logged, mirror: mirror };
}
function whoOf(profiles, actors) {
  return { profile: function (n) { return profiles.indexOf(Number(n)) >= 0; }, actor: function (n) { return actors.indexOf(Number(n)) >= 0; } };
}
const fileOf = (dir) => path.join(dir, 'private', 'merchant-ledger.json');
const readFile = (dir) => JSON.parse(fs.readFileSync(fileOf(dir), 'utf8'));
const coin = (doc) => Object.keys(doc.entries).map(function (r) { return [r, doc.entries[r].purse, JSON.stringify(doc.entries[r].stock)]; });

try {
  // ============================================================ one release
  const dir = path.join(scratch, 'one');
  seed(path.join(dir, 'private'));
  const before = readFile(dir);
  // Each trader's own saved copy, as prepare() and the commits left it.
  const copies = [9, 8, 7, 6].map(function (id) { return [id, JSON.parse(JSON.stringify(before.entries[id + ':Skyrim.esm']))]; });
  const s1 = open(dir, { copies: copies });
  yes('T0 before: four traders hold a waiting trade, every one counted towards the limit', s1.purses.pendingRecords().length === 4);
  const r = s1.purses.release(whoOf([P1], [A1, A2]));
  const after = readFile(dir);
  const e9 = after.entries['9:Skyrim.esm'], e8 = after.entries['8:Skyrim.esm'], e7 = after.entries['7:Skyrim.esm'], e6 = after.entries['6:Skyrim.esm'];
  yes('M1 their supply wait goes by profile and form id, and the one by form id alone', !(key(A1, P1, 'iron ore') in e9.supply) && !(key(A2, P9, 'wheat') in e9.supply));
  yes('M2 somebody else\'s supply wait stays, stamp and all', e9.supply[key(AY, PY, 'iron ore')] === NOW && e9.supply['7:Skyrim.esm placed'] === NOW);
  yes('M3 a local form id is never taken for the full form id of a character', Object.keys(e7.supply).length === 1);
  yes('T1 credit: the trade waiting on them is cleared, and the trader keeps the next it already holds',
      e9.pending === null && e9.purse === 280 && JSON.stringify(e9.stock) === JSON.stringify([{ baseId: 4096, count: 3 }]));
  yes('T2 credit: no supply wait is stamped for them', Object.keys(e9.supply).length === 2);
  yes('T3 debit: the trade waiting on them (by form id) is cleared, the trader as it was before it',
      e8.pending === null && e8.purse === 300 && JSON.stringify(e8.stock) === JSON.stringify([{ baseId: 4096, count: 2 }]));
  yes('T4 a trade waiting on somebody else stays exactly as it was', JSON.stringify(e7) === JSON.stringify(before.entries['7:Skyrim.esm']));
  yes('A1 the retired trader\'s waiting trade is let go too', e6.pending === null && e6.purse === 320);
  yes('C1 no coin or goods are made or lost: every purse and shelf is the same', JSON.stringify(coin(after)) === JSON.stringify(coin(before)));
  yes('V1 each changed entry\'s revision rises by one, the other\'s does not',
      e9.revision === 5 && e8.revision === 5 && e6.revision === 5 && e7.revision === 4);
  yes('V2 the answer is counts and saved', r && r.saved === true &&
      JSON.stringify(r.counts) === JSON.stringify({ merchants: 3, supply: 2, commissions: 0, trades: 3, copies: 3 }));
  yes('V3 the file verifies', after.sha256 === sum(after));
  yes('V4 the service goes on: it reads what it wrote, and one waiting trade is left towards the limit',
      s1.purses.read(9).pending === null && s1.purses.pendingRecords().length === 1);
  // ---- K
  // Them anywhere in the copy, keys written as JSON inside JSON included, in
  // the one shape (#2870): a desc of their local hex, a key opening with
  // their runtime form id, or their profile id.
  const theirIds = new RegExp('"desc":"(' + runtimeDesc(A1) + '|' + runtimeDesc(A2) + ')"|\\[(' + A1 + '|' + A2 + '),|"profileId":' + P1 + '\\b|,' + P1 + ',', 'i');
  const namesThem = (copy) => theirIds.test(JSON.stringify(copy).replace(/\\"/g, '"'));
  yes('K0 before: the copies of 9, 8 and the retired 6 name them, 7\'s names nobody there',
      namesThem(copies[0][1]) && namesThem(copies[1][1]) && namesThem(copies[3][1]) && !namesThem(copies[2][1]));
  yes('K1 the retired trader\'s copy is written from the ledger and no longer names them',
      JSON.stringify(s1.mirror.get(6)) === JSON.stringify(e6) && !namesThem(s1.mirror.get(6)));
  yes('K2 an active trader\'s copies are written the same, without waiting for prepare()',
      JSON.stringify(s1.mirror.get(9)) === JSON.stringify(e9) && JSON.stringify(s1.mirror.get(8)) === JSON.stringify(e8) &&
      !namesThem(s1.mirror.get(9)) && !namesThem(s1.mirror.get(8)));
  yes('K3 a copy naming nobody there is not written', JSON.stringify(s1.mirror.get(7)) === JSON.stringify(copies[2][1]));
  s1.purses.prepare(9);
  yes('V5 prepare() finds the copy already right', s1.mirror.get(9).revision === 5 && s1.mirror.get(9).pending === null);
  const c = s1.purses.compareAndCommit(9, 5, Object.assign({}, s1.purses.read(9), { purse: 281 }));
  yes('V6 and a trade after it commits on the new revision', !!c && c.revision === 6);
  s1.purses.shutdown();
  const s2 = open(dir);
  yes('V7 the ledger loads again on the next start', s2.purses.read(9).purse === 281 && s2.purses.pendingRecords().length === 1);

  // ---- N
  const bytes = fs.readFileSync(fileOf(dir), 'utf8');
  const n1 = s2.purses.release(whoOf([P1], [A1, A2]));
  yes('N1 a second run finds nothing and writes nothing', n1.saved === true && n1.counts.merchants === 0 && fs.readFileSync(fileOf(dir), 'utf8') === bytes);
  const n2 = s2.purses.release(whoOf([123], [0xff000fff]));
  yes('N2 a list naming nobody there writes nothing', n2.saved === true && n2.counts.merchants === 0 && fs.readFileSync(fileOf(dir), 'utf8') === bytes);
  s2.purses.shutdown();

  // ============================================================ K: a copy write that did not take
  const dir5 = path.join(scratch, 'copy');
  seed(path.join(dir5, 'private'));
  const before5 = readFile(dir5);
  const copies5 = [[6, JSON.parse(JSON.stringify(before5.entries['6:Skyrim.esm']))]];
  const k1 = open(dir5, { copies: copies5, failSet: 6 });
  let copyWhy = '';
  try { k1.purses.release(whoOf([P1], [A1, A2])); } catch (e) { copyWhy = String(e.message); }
  const saved5 = fs.readFileSync(fileOf(dir5), 'utf8');
  yes('K4 a copy write that fails stops the part, said, after the ledger is let go',
      /could not be written/.test(copyWhy) && readFile(dir5).entries['6:Skyrim.esm'].pending === null && namesThem(k1.mirror.get(6)));
  k1.purses.shutdown();
  const k2 = open(dir5, { copies: [[6, k1.mirror.get(6)]] });
  const rk = k2.purses.release(whoOf([P1], [A1, A2]));
  yes('K5 the next start finds that copy and writes it, with no ledger write',
      rk.saved === true && rk.counts.merchants === 0 && rk.counts.copies === 1 && !namesThem(k2.mirror.get(6)) &&
      JSON.stringify(k2.mirror.get(6)) === JSON.stringify(readFile(dir5).entries['6:Skyrim.esm']) &&
      fs.readFileSync(fileOf(dir5), 'utf8') === saved5);
  k2.purses.shutdown();

  // ============================================================ P: commission promises
  // merchant-commission-state.js keys a promise by [owner, job] (owner()):
  // a runtime character is [full form id, '', profile] (#2870), a placed
  // form keeps [local form id, plugin, profile].
  const COMMISSIONS = require(path.join(REPO, 'game', 'merchant-commission-state.js'));
  const A3 = 0xff000a03;
  const ownerOf = (local, plugin, p) => JSON.stringify([local, plugin, p]);
  const pkey = (owner, job) => JSON.stringify([owner, job]);
  const held = (token, owner, job, gold) => ({ token: token, owner: owner, job: job, hash: 'a'.repeat(64),
    item: { baseId: 4096, name: 'Iron Ore' }, count: 1, unit: gold, gold: gold, at: NOW - 5000 });
  const OWN_P1 = ownerOf(A1, '', P1), OWN_PY = ownerOf(AY, '', PY), OWN_A3 = ownerOf(A3, '', 77), OWN_PLACED = ownerOf(0xa03, 'skyrim.esm', 78);
  const dir3 = path.join(scratch, 'promises');
  fs.mkdirSync(path.join(dir3, 'private'), { recursive: true });
  const promised = {
    '9:Skyrim.esm': entry('9:Skyrim.esm', { commissions: { v: 2, serial: 3,
      held: { [pkey(OWN_P1, 'q-iron-1')]: held(1, OWN_P1, 'q-iron-1', 50), [pkey(OWN_PY, 'q-iron-2')]: held(2, OWN_PY, 'q-iron-2', 20) },
      cool: { [pkey(OWN_A3, 'q-iron-3')]: [NOW - 100, 6], [pkey(OWN_PLACED, 'q-iron-4')]: NOW - 100 } } }),
    // A commission they were being paid for, still in debit: the promise is
    // what the trade would have paid out.
    '8:Skyrim.esm': entry('8:Skyrim.esm', { commissions: { v: 1, serial: 1, held: { [pkey(OWN_P1, 'q-wheat-1')]: held(1, OWN_P1, 'q-wheat-1', 30) }, cool: {} },
      pending: { version: 4, id: 'dev:8:4', human: { desc: 'a01', profileId: P1 }, kind: 'commission', phase: 'debit',
                 previous: { purse: 300, stock: [{ baseId: 4096, count: 2 }], supply: {} }, next: { purse: 270, stock: [{ baseId: 4096, count: 3 }], supply: {} } } }),
    '7:Skyrim.esm': entry('7:Skyrim.esm', {}),
    '6:Skyrim.esm': entry('6:Skyrim.esm', {})
  };
  fs.writeFileSync(fileOf(dir3), JSON.stringify({ version: 2, entries: promised, sha256: sum({ version: 2, entries: promised }) }));
  fs.writeFileSync(path.join(dir3, 'private', 'merchant-ledger.initialized'), '1');
  const before3 = readFile(dir3);
  const p1 = open(dir3);
  const rp = p1.purses.release(whoOf([P1], [A3]));
  const after3 = readFile(dir3);
  const c9 = after3.entries['9:Skyrim.esm'].commissions, c8 = after3.entries['8:Skyrim.esm'].commissions;
  yes('P1 a promise held for them goes by profile, and its gold is the trader\'s to spend again',
      !(pkey(OWN_P1, 'q-iron-1') in c9.held) && COMMISSIONS.spendable(after3.entries['9:Skyrim.esm']) === 300 - 20);
  yes('P2 somebody else\'s promise stays as it was', JSON.stringify(c9.held[pkey(OWN_PY, 'q-iron-2')]) === JSON.stringify(held(2, OWN_PY, 'q-iron-2', 20)));
  yes('P3 a finished one of theirs cooling down goes by form id; one whose owner names a plugin is never a character',
      !(pkey(OWN_A3, 'q-iron-3') in c9.cool) && c9.cool[pkey(OWN_PLACED, 'q-iron-4')] === NOW - 100);
  yes('P4 a commission waiting on them in debit is cleared with its promise, the trader as it was',
      after3.entries['8:Skyrim.esm'].pending === null && Object.keys(c8.held).length === 0 && after3.entries['8:Skyrim.esm'].purse === 300);
  yes('P5 what is left reads as promises (merchant-commission-state.js read), serials kept',
      !!COMMISSIONS.read(c9) && !!COMMISSIONS.read(c8) && c9.serial === 3 && c8.serial === 1);
  yes('P6 no coin or goods are made or lost', JSON.stringify(coin(after3)) === JSON.stringify(coin(before3)));
  yes('P7 the answer counts the promises', rp && rp.saved === true &&
      JSON.stringify(rp.counts) === JSON.stringify({ merchants: 2, supply: 0, commissions: 3, trades: 1, copies: 0 }));
  p1.purses.shutdown();

  // ============================================================ B: a trade with somebody else
  // The trading checks a trader's state against the saved snapshots of the
  // trade waiting on it, so a row of theirs is not taken from a trader while
  // somebody else's trade waits there: nothing changes and the part waits.
  const dir4 = path.join(scratch, 'busy');
  seed(path.join(dir4, 'private'));
  const busyDoc = readFile(dir4);
  busyDoc.entries['7:Skyrim.esm'].supply[key(A1, P1, 'wheat')] = NOW;
  delete busyDoc.sha256;
  fs.writeFileSync(fileOf(dir4), JSON.stringify({ version: 2, entries: busyDoc.entries, sha256: sum(busyDoc) }));
  const keep4 = fs.readFileSync(fileOf(dir4), 'utf8');
  const b1 = open(dir4);
  let busyWhy = '';
  try { b1.purses.release(whoOf([P1], [A1, A2])); } catch (e) { busyWhy = String(e.message); }
  yes('B1 a trader holding something of theirs while somebody else\'s trade waits there stops the part, said',
      /1 trader\(s\) holding something of theirs are waiting on a trade with somebody else, so nothing was let go/.test(busyWhy));
  yes('B2 and nothing is written, the other traders\' rows of theirs included', fs.readFileSync(fileOf(dir4), 'utf8') === keep4);
  yes('B3 the service goes on, so trading can settle that trade', b1.purses.pendingRecords().length === 4);
  b1.purses.shutdown();

  // ============================================================ F, through the release block
  const dir2 = path.join(scratch, 'fails');
  seed(path.join(dir2, 'private'));
  fs.writeFileSync(path.join(dir2, 'server-settings.json'), JSON.stringify({ privDir: 'private', dataDir: 'data' }));
  fs.writeFileSync(path.join(dir2, 'private', 'deleted-characters.json'),
    JSON.stringify({ profiles: [P1], actors: [A1, A2], done: { saves: 1, farms: 1, property: 1, embassy: 1, dungeon: 1, cargo: 1, stalls: 1, carts: 1, books: 1 } }));
  const was = process.cwd();
  process.chdir(dir2);
  let f1, f2;
  try {
    const keep = fs.readFileSync(fileOf(dir2), 'utf8');
    f1 = open(dir2, { failSave: true });
    vm.runInContext(releaseSrc, f1.box, { filename: 'gamemode.js (release)' });
    f1.box.__thornswoodRelease('merchants', f1.purses.release);
    yes('F1 a save that fails writes nothing', fs.readFileSync(fileOf(dir2), 'utf8') === keep);
    yes('F2 the part waits, said in the log', f1.logged.some(function (l) { return /release: merchants stopped: .*its part waits for the next start/.test(l); }) &&
        !('merchants' in JSON.parse(fs.readFileSync(path.join(dir2, 'private', 'deleted-characters.json'), 'utf8')).done));
    let revoked = false;
    try { f1.purses.read(9); } catch (e) { revoked = /unavailable/.test(String(e.message)); }
    yes('F3 and the service is revoked, as after a failed commit', revoked);
    // The next start, with a save that takes.
    f2 = open(dir2);
    vm.runInContext(releaseSrc, f2.box, { filename: 'gamemode.js (release)' });
    f2.box.__thornswoodRelease('merchants', f2.purses.release);
    const L = f2.logged.filter(function (l) { return /^release: /.test(l); });
    yes('F4 the next start lets go, and then the list is gone',
        L.some(function (l) { return l === 'release: merchants: merchants 3, supply 2, trades 3'; }) &&
        L.some(function (l) { return /every part is done, and the list is gone/.test(l); }) &&
        !fs.existsSync(path.join(dir2, 'private', 'deleted-characters.json')));
    const all = f1.logged.concat(f2.logged).join('\n');
    yes('L1 the log is counts, never a profile id, a form id or a label of theirs',
        [P1, A1, A2].every(function (n) { return !new RegExp('\\b(' + n + '|' + hex(n) + ')\\b', 'i').test(all); }) && !/iron ore|wheat/.test(all));
  } finally { process.chdir(was); }
} catch (e) {
  yes('the harness ran to the end: ' + (e && e.stack || e), false);
}
done();
