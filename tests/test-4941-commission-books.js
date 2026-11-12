'use strict';
/*
  test-4941-commission-books.js

      node tests/test-4941-commission-books.js

  #4941: letting a person's holdings go walks both commission books (held
  and cool) on every trader. Every writer of the books is
  game/merchant-commission-state.js: empty() makes both, read() refuses a
  book missing or a key that does not read, and reserve, cancel and finish
  return what read() passed. So a record with one book, or a key that does
  not read, is never written by the game: it is damage. The ledger's load
  check never looked at commissions, so such a record loaded, and the let-go
  then threw on it and stopped for every trader without saying which one.

  This runs the REAL purse service of game/gamemode.js (the NPC MERCHANT
  PURSES block) over ledgers held in memory:

    G  a ledger whose books read loads, and the let-go drops a promise and a
       cooling one of theirs and keeps somebody else's
    L  a trader record with one book, or with a key that does not read (the
       whole key, or its owner), is refused where the ledger loads, the
       refusal names that trader, and nothing is saved
    C  a commit of a state with one book is refused, and nothing is saved
*/
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'game', 'gamemode.js'), 'utf8').split(String.fromCharCode(13)).join('');
const a = source.indexOf('// NPC MERCHANT PURSES BEGIN'), b = source.indexOf('// NPC MERCHANT PURSES END');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
yes('the purse service is in gamemode.js', a >= 0 && b > a);
if (!(a >= 0 && b > a)) { done(); }
const ctx = { Map, Set, Number, JSON, Object, Array, require };
vm.createContext(ctx);
vm.runInContext(source.slice(a, b), ctx);

const copy = (v) => JSON.parse(JSON.stringify(v));
const REFS = ['1:Skyrim.esm', '2:Skyrim.esm', '3:Skyrim.esm'];
const P1 = 5001, P2 = 6002;
const A1 = 0xff000a01, A2 = 0xff000a02;
const owner = (id, p) => JSON.stringify([id, '', p]);
const ckey = (id, p, job) => JSON.stringify([owner(id, p), job]);
function row(token, id, p, job) {
  return { token: token, owner: owner(id, p), job: job, hash: 'a'.repeat(64), item: { baseId: 100, name: 'Iron Ingot' },
           count: 2, unit: 5, gold: 10, at: 1000 };
}
function books() {
  return { v: 1, serial: 2,
           held: { [ckey(A1, P1, 'q-iron-1')]: row(1, A1, P1, 'q-iron-1'), [ckey(A2, P2, 'q-iron-2')]: row(2, A2, P2, 'q-iron-2') },
           cool: { [ckey(A1, P1, 'q-wheat-1')]: 2000, [ckey(A2, P2, 'q-wheat-1')]: 2000 } };
}
function entry(ref, commissions) {
  const e = { version: 1, reference: ref, base: 'a:Skyrim.esm', purse: 300, stock: [], revision: 3 };
  if (commissions !== undefined) { e.commissions = commissions; }
  return e;
}
function open(entries) {
  const disk = { doc: { version: 2, entries: entries }, saves: 0 };
  const data = { keep: REFS.map((r) => [r, 'a:Skyrim.esm', null, null, null, null, 'trader']) };
  const api = {
    makeProperty() { }, getIdFromDesc: (desc) => parseInt(desc, 16),
    getNpcAIState: () => ({ isHuman: false, profileId: 0 }),
    get: (id, what) => (what === 'baseDesc' ? 'a:Skyrim.esm' : undefined),
    set() { }
  };
  const storage = { durable: true, namespace: {}, load: () => copy(disk.doc),
                    save(doc) { disk.saves++; disk.doc = copy(doc); return true; } };
  let service = null, error = null;
  try { service = ctx.createNpcMerchantPurses(api, data, storage); } catch (e) { error = e; }
  return { service: service, error: error, disk: disk };
}
const who = { profile: (p) => p === P1, actor: (id) => id === A1 };

// ---------------------------------------------------------------- G
{
  const w = open({ '1:Skyrim.esm': entry('1:Skyrim.esm', books()), '2:Skyrim.esm': entry('2:Skyrim.esm'), '3:Skyrim.esm': entry('3:Skyrim.esm', { v: 1, serial: 0, held: {}, cool: {} }) });
  yes('G1 a ledger whose books read loads' + (w.error ? ' (' + w.error.message + ')' : ''), !!w.service);
  if (w.service) {
    let r = null, err = null;
    try { r = w.service.release(who); } catch (e) { err = e; }
    yes('G2 the let-go runs' + (err ? ' (' + err.message + ')' : ''), !!r && r.counts.commissions === 2 && r.counts.merchants === 1);
    const c = w.disk.doc.entries['1:Skyrim.esm'].commissions;
    yes('G3 their promise and their cooling one are gone, somebody else\'s stay',
        !c.held[ckey(A1, P1, 'q-iron-1')] && !c.cool[ckey(A1, P1, 'q-wheat-1')] &&
        !!c.held[ckey(A2, P2, 'q-iron-2')] && !!c.cool[ckey(A2, P2, 'q-wheat-1')]);
  }
}

// ---------------------------------------------------------------- L
const damaged = [
  ['a record with only the held book', (c) => { delete c.cool; }],
  ['a record with only the cool book', (c) => { delete c.held; }],
  ['a record whose cool book is not an object', (c) => { c.cool = 7; }],
  ['a key that does not read', (c) => { c.cool['not a key'] = 2000; }],
  ['a key whose owner does not read', (c) => { c.held[JSON.stringify(['nobody', 'q-iron-3'])] = row(3, A1, P1, 'q-iron-3'); }]
];
for (const [what, harm] of damaged) {
  const bad = books(); harm(bad);
  const w = open({ '1:Skyrim.esm': entry('1:Skyrim.esm', books()), '2:Skyrim.esm': entry('2:Skyrim.esm', bad), '3:Skyrim.esm': entry('3:Skyrim.esm') });
  let said = w.error ? w.error.message : '';
  if (w.service) {
    // On main it loads; then the let-go is what meets it.
    try { w.service.release(who); said = 'loaded, and the let-go went through'; } catch (e) { said = 'loaded, and the let-go stopped: ' + e.message; }
  }
  yes('L ' + what + ' is refused where the ledger loads (' + said + ')', !w.service && !!w.error);
  yes('  the refusal names that trader and its commission books', !!w.error && w.error.message.indexOf('2:Skyrim.esm') >= 0 && /commission/i.test(w.error.message));
  yes('  and nothing is saved', w.disk.saves === 0);
}

// ---------------------------------------------------------------- C
{
  const w = open({ '1:Skyrim.esm': entry('1:Skyrim.esm', books()), '2:Skyrim.esm': entry('2:Skyrim.esm'), '3:Skyrim.esm': entry('3:Skyrim.esm') });
  if (w.service) {
    const next = w.service.read(1);
    delete next.commissions.cool;
    let err = null;
    try { w.service.compareAndCommit(1, 3, next); } catch (e) { err = e; }
    yes('C1 a commit of a state with one book is refused' + (err ? ' (' + err.message + ')' : ' (it was saved)'), !!err);
    yes('C2 and nothing is saved', w.disk.saves === 0);
  } else {
    yes('C0 the ledger for the commit loads (' + (w.error && w.error.message) + ')', false);
  }
}
done();
