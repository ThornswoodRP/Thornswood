'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '../../game/gamemode.js'), 'utf8');
const ctx = {Map, Set, Number, JSON, require};
vm.createContext(ctx);
vm.runInContext(src.slice(src.indexOf('// NPC MERCHANT PURSES BEGIN'), src.indexOf('// NPC MERCHANT PURSES END')), ctx);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-merchant-revisions-'));
try {
  const settings = {privDir: path.join(root, 'private'), dataDir: path.join(root, 'served')};
  const write = (name,bytes) => {
    fs.mkdirSync(settings.privDir,{recursive:true});
    const file=path.join(settings.privDir,name+'-ledger.json');
    fs.writeFileSync(file+'.tmp',bytes); fs.renameSync(file+'.tmp',file); return true;
  };
  const storage = ctx.createPrivateMerchantLedger(fs, path, settings, ['1:Skyrim.esm'], write);
  require('../../tests/fixtures/merchant-ledger')(fs,path,settings.privDir,['1:Skyrim.esm']);
  const props = new Map();
  const api = {makeProperty() {}, getIdFromDesc: () => 1, getNpcAIState: () => ({isHuman: false}),
    get: (id, key) => key === 'baseDesc' ? 'a:Skyrim.esm' : props.get(id),
    set: (id, key, value) => props.set(id, JSON.parse(JSON.stringify(value)))};
  const data = {keep: [['1:Skyrim.esm', 'a:Skyrim.esm', null, null, null, null, 'trader']]};
  const purse = ctx.createNpcMerchantPurses(api, data, storage);
  const initial = purse.prepare(1);
  assert.equal(initial.revision || 0, 0);
  const pending = {...initial, pending: {id: 'first', humanProfile: 7}};
  const armed = purse.compareAndCommit(1, 0, pending);
  assert.equal(armed.revision, 1);
  assert.equal(purse.compareAndCommit(1, 0, {...initial, purse: 0}), null, 'stale offers cannot alter balances');
  assert.equal(purse.prepare(1).purse, 250);
  assert.equal(purse.pendingRecords().length, 1, 'pending enumeration comes from the canonical ledger');
  const exposed = purse.pendingRecords(); exposed[0].state.pending.id = 'tampered';
  assert.equal(purse.pendingRecords()[0].state.pending.id, 'first', 'returned intents cannot mutate saved state');
  purse.shutdown();
  assert.throws(() => purse.compareAndCommit(1, 1, {...armed, pending: null}), /unavailable/);
  const restarted = ctx.createNpcMerchantPurses(api, data, storage);
  assert.equal(restarted.pendingRecords()[0].state.revision, 1, 'reservations and revisions survive a real file reload');
  const done = restarted.compareAndCommit(1, 1, {...armed, pending: null, purse: 247});
  assert.equal(done.revision, 2);
  assert.equal(restarted.compareAndCommit(1, 1, {...armed, pending: null}), null, 'stale settlement cannot overwrite a completed intent');
  assert.equal(restarted.pendingRecords().length, 0);
  assert.equal(restarted.prepare(1).purse, 247);
  const io = Object.create(fs); io.renameSync = () => {throw new Error('rename denied');};
  const broken = ctx.createNpcMerchantPurses(api, data, {durable:true,load:()=>storage.load(),save:()=>{throw new Error('rename denied');}});
  assert.throws(() => broken.compareAndCommit(1, 2, {...done, purse: 0}), /rename denied/);
  assert.equal(ctx.createNpcMerchantPurses(api, data, storage).prepare(1).purse, 247, 'failed durable replacement leaves the previous ledger intact');
  const ambiguousStorage = {load: () => storage.load(), save: () => undefined, durable: true};
  const ambiguous = ctx.createNpcMerchantPurses(api, data, ambiguousStorage);
  assert.throws(() => ambiguous.compareAndCommit(1, 2, {...done, purse: 0}), /acknowledgement/);
  assert.throws(() => ambiguous.prepare(1), /unavailable/, 'missing save acknowledgement revokes admission');
  const oldStorage=ctx.createPrivateMerchantLedger(fs,path,settings);
  assert.equal(oldStorage.durable,false,'the old rename writer cannot acknowledge transaction reservations');
  const oldPurse=ctx.createNpcMerchantPurses(api,data,oldStorage);
  assert.throws(()=>oldPurse.compareAndCommit(1,2,{...done,purse:0}),/acknowledgement/);
  props.clear();
  const initializing=ctx.createNpcMerchantPurses(api,data,{durable:true,load:()=>({version:2,entries:{'1:Skyrim.esm':null}}),save:()=>{throw new Error('initial ack lost');}});
  assert.throws(()=>initializing.prepare(1),/initial ack lost/);
  assert.throws(()=>initializing.prepare(1),/unavailable/,'ambiguous initialization also revokes retained service');
  console.log('PASS merchant durable revisions, stale offer/settlement refusal, restart, pending isolation and persistence failure');
} finally {
  const full = path.resolve(root);
  assert(full.startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(full, {recursive: true, force: true});
}
