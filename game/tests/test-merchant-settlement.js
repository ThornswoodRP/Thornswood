'use strict';
const assert = require('node:assert/strict');
const {createSettlement} = require('../../game/merchant-settlement');
const copy = x => JSON.parse(JSON.stringify(x));

function fixture() {
  const states = new Map([[1, {reference:'1:Skyrim.esm', base:'a:Skyrim.esm', revision:0, purse:250, stock:[], supply:{}}]]);
  const inv = {entries:[{baseId:15,count:40},{baseId:100,count:8,name:'Tempered iron',health:0.7}]};
  let live='null', saved='null', profile=7, available=true;
  const calls=[];
  const purses={
    read: id => copy(states.get(id)),
    pendingRecords: () => Array.from(states, ([merchantId,state]) => ({merchantId,reference:state.reference,state:copy(state)})).filter(x=>x.state.pending!==undefined && x.state.pending!==null),
    compareAndCommit(id,rev,next) {
      if (states.get(id).revision!==rev) return null;
      states.set(id,copy({...next,revision:rev+1}));
      return copy(states.get(id));
    }
  };
  const transfer={
    available: () => available, validate: () => true,
    identity: id => id===10 && profile>0 ? {desc:'10',profileId:profile} : null,
    resolve: desc => desc==='10' ? 10 : 0,
    inventory: () => copy(inv), receipt: () => live, saved: () => saved,
    cas(id,expected,receipt,next,sequence,expectedProfile) {
      assert.equal(id,10); assert.equal(expectedProfile,profile);
      calls.push(sequence);
      if (live!==receipt || JSON.stringify(inv)!==JSON.stringify(expected)) return false;
      inv.entries=copy(next.entries);
      live=JSON.stringify({actor:'10',profile,sequence});
      return true;
    }
  };
  const make=()=>createSettlement({purses,transfer,world:'dev:test-ledger'});
  return {states,purses,transfer,inv,calls,make,
    save:()=>{saved=live;}, live:()=>live,
    profile:n=>{profile=n;}, off:()=>{available=false;},
    offer:()=>({merchantId:1,humanId:10,profileId:7,previous:purses.read(1),
      next:{purse:247,stock:[{baseId:100,count:1,name:'Iron Ingot',entry:{baseId:100,count:1,name:'Tempered iron',health:0.7}}],supply:{}},
      debit:{entries:[{baseId:15,count:40},{baseId:100,count:7,name:'Tempered iron',health:0.7}]},
      credit:[{baseId:15,count:3}],expected:copy(inv),kind:'sell'})};
}

function offlineRecord(id) {
  const seed=fixture(),service=seed.make();service.begin(seed.offer());service.shutdown();
  const state=copy(seed.states.get(1)),pending=state.pending;
  state.reference=id.toString(16)+':Skyrim.esm';pending.reference=state.reference;
  pending.id='dev:test-ledger:'+state.reference+':0';
  pending.human={desc:id.toString(16),profileId:id};
  pending.debitReceipt=JSON.stringify({actor:pending.human.desc,profile:id,sequence:1});
  pending.finalReceipt=JSON.stringify({actor:pending.human.desc,profile:id,sequence:2});
  return state;
}

// Four large snapshots fit the initial phase but exceeded the old recovery
// record after debit. Saved debit snapshots must retire before credit growth.
{
  const large=fixture();
  large.inv.entries.push({baseId:200,count:1,name:''});
  large.inv.entries[2].name='x'.repeat(131000-Buffer.byteLength(JSON.stringify(large.inv)));
  assert.equal(Buffer.byteLength(JSON.stringify(large.inv)),131000);
  const offer=large.offer();offer.debit.entries.push(copy(large.inv.entries[2]));
  const settle=large.make();settle.begin(offer);large.save();settle.tick();
  assert.equal(large.inv.entries[0].count,43,'large valid inventory receives its saved credit');
  large.save();settle.tick();assert.equal(large.states.get(1).pending,null);
  assert.deepEqual(large.calls,[1,2]);
}
// A representation that cannot reserve two maximal recovery snapshots must
// refuse before charge, even though the initial representation would fit.
{
  const full=fixture(), state=full.states.get(1);
  const item={baseId:200,count:1,name:'x'.repeat(130700)};
  state.stock=[{baseId:200,count:1,name:'Large item',entry:item}];
  const offer=full.offer();offer.next.stock.unshift(copy(state.stock[0]));
  assert.throws(()=>full.make().begin(offer),/too large to recover/);
  assert.deepEqual(full.calls,[]);assert.equal(full.inv.entries[1].count,8);
  assert.equal(full.states.get(1).pending,undefined);
}

let f=fixture(), s=f.make();
// A quest or another inventory transaction can have a live receipt that has
// not reached storage. Reserving against it would strand a trade on restart.
const questReceipt=JSON.stringify({actor:'10',profile:7,sequence:1});
f.transfer.cas(10,copy(f.inv),'null',copy(f.inv),1,7);
let result=s.begin(f.offer());
assert.equal(result.accepted,false,'an unsaved preceding transaction blocks admission');
assert.equal(f.states.get(1).pending,undefined,'no ledger intent depends on an unsaved receipt');
assert.equal(f.live(),questReceipt);
f.save();
result=s.begin(f.offer());assert.equal(result.accepted,true,'exact saved acknowledgement permits the next trade');
assert.deepEqual(f.calls,[1,2]);

f=fixture();s=f.make();
let guarded=false;
assert.equal(s.withInventoryMutation(10,(human,alive)=>{
  guarded=true;assert.equal(human.profileId,7);assert.equal(alive(),true);
  assert.equal(s.begin(f.offer()).accepted,false,'a quest mutation owns the synchronous admission lease');
  s.shutdown();assert.equal(alive(),false,'reload revokes the held lease');
  return {ok:false};
}).ok,false);
assert.equal(guarded,true);assert.deepEqual(f.calls,[]);
f=fixture();s=f.make();s.begin(f.offer());guarded=false;
assert.equal(s.withInventoryMutation(10,()=>{guarded=true;}).ok,false);
assert.equal(guarded,false,'an unresolved merchant reservation prevents quest inventory work');
f=fixture();s=f.make();let heldLease;
assert.equal(s.withInventoryMutation(10,(human,alive)=>{heldLease=alive;return {ok:true};}).ok,true);
assert.equal(heldLease(),false,'a returned synchronous lease has expired');
for(let i=0;i<25;i++) f.states.set(100+i,offlineRecord(100+i));
assert.equal(s.canInventoryMutation(10),true,'unrelated reservations do not consume quest capacity');
assert.equal(s.withInventoryMutation(10,()=>({ok:true})).ok,true);
assert.equal(s.withInventoryMutation(10,()=>({ok:false,uncertain:true})).ok,false);
assert.equal(s.available(),false,'an uncertain shared receipt revokes every inventory writer');
f=fixture();s=f.make();
result=s.begin(f.offer());
assert.equal(result.done,false);
assert.equal(f.inv.entries[1].count,7,'debit removes only the outgoing goods');
assert.equal(f.inv.entries[0].count,40,'incoming payment is quarantined before saved debit');
assert.equal(f.states.get(1).purse,250);
assert.equal(s.begin(f.offer()).accepted,false,'one person cannot have two unsettled trades');
f.save(); s.tick();
assert.equal(f.states.get(1).purse,247);
assert.equal(f.inv.entries[0].count,43);
assert.ok(f.states.get(1).pending,'final credit must also be saved');
f.save(); s.tick();
assert.equal(f.states.get(1).pending,null);
s.tick(); assert.deepEqual(f.calls,[1,2],'reconciliation never repeats a settled transfer');

// Restart at every durable boundary, retaining ordinary inventory changes.
f=fixture(); s=f.make(); s.begin(f.offer()); s.shutdown();
s=f.make(); s.tick(); assert.deepEqual(f.calls,[1]);
f.save(); f.inv.entries.push({baseId:200,count:4,chargePercent:0.17});
s.tick(); assert.equal(f.inv.entries[2].count,4,'credit preserves intervening earnings');
s.shutdown(); s=f.make(); s.tick(); assert.deepEqual(f.calls,[1,2]);
f.save(); s.tick(); assert.equal(f.states.get(1).pending,null);

// An exception after native mutation cannot clear or repeat the debit.
f=fixture(); const cas=f.transfer.cas;
f.transfer.cas=(...args)=>{cas(...args);throw new Error('notification failed after mutation');};
s=f.make(); s.begin(f.offer()); assert.ok(f.states.get(1).pending);
f.transfer.cas=cas; f.save(); s.tick(); f.save(); s.tick();
assert.deepEqual(f.calls,[1,2]); assert.equal(f.inv.entries[0].count,43);

// Ambiguous ledger persistence revokes the service before any native mutation.
f=fixture(); const commit=f.purses.compareAndCommit;
f.purses.compareAndCommit=(...args)=>{commit(...args);throw new Error('ack lost');};
s=f.make(); assert.throws(()=>s.begin(f.offer()),/ack lost/);
assert.deepEqual(f.calls,[]); assert.equal(s.available(),false);
f.purses.compareAndCommit=commit; s=f.make(); s.tick();
assert.deepEqual(f.calls,[1]);

// Profile replacement and cross-world replay stay reserved and do not pay.
f=fixture(); s=f.make(); s.begin(f.offer()); f.save(); f.profile(9); s.tick();
assert.equal(f.inv.entries[0].count,40); assert.ok(f.states.get(1).pending);
s.shutdown(); s=createSettlement({purses:f.purses,transfer:f.transfer,world:'main:test-ledger'});
f.profile(7); assert.throws(()=>s.tick(),/Pending merchant records cannot be verified/);
assert.equal(s.available(),false);assert.equal(f.inv.entries[0].count,40);

// Definitive refusal releases capacity without requiring the old inventory.
f=fixture(); f.transfer.cas=()=>false; s=f.make();
assert.equal(s.begin(f.offer()).accepted,false); assert.equal(f.states.get(1).pending,null);
f=fixture(); f.transfer.cas=()=>{throw new Error('unknown outcome');}; s=f.make(); s.begin(f.offer());
assert.ok(f.states.get(1).pending,'ambiguous call stays reserved');
f.inv.entries[1].count=6; s.tick();
assert.equal(f.states.get(1).pending,null,'original receipt proves no debit even when inventory changed');

f=fixture(); for(let id=2;id<=26;id++) f.states.set(id,offlineRecord(id));
s=f.make(); assert.equal(s.begin(f.offer()).accepted,false,'25 identifiable offline intents fill global capacity');
f.states.delete(26); assert.equal(s.begin(f.offer()).accepted,true,'the twenty-fifth slot can be used');

// Unverifiable records quarantine admission without guessing or removing a lock.
f=fixture(); for(let id=2;id<=26;id++) f.states.set(id,{reference:id+':Skyrim.esm',revision:1,purse:250,stock:[],pending:{id:'legacy-'+id}});
s=f.make(); assert.throws(()=>s.begin(f.offer()),/Pending merchant records cannot be verified/);
assert.equal(s.available(),false);assert.deepEqual(f.calls,[]);
f=fixture(); f.states.set(2,{reference:'2:Skyrim.esm',revision:1,purse:250,stock:[],pending:{id:'legacy'}});
s=f.make(); assert.throws(()=>s.begin(f.offer()),/Pending merchant records cannot be verified/,'unknown legacy identity blocks admission');
assert.equal(s.available(),false);

// Stale closures and reentrant reloads cannot mutate native state after saving.
f=fixture(); s=f.make(); s.shutdown(); assert.equal(s.begin(f.offer()).accepted,false);
f=fixture(); s=f.make(); const save=f.purses.compareAndCommit;
f.purses.compareAndCommit=(...args)=>{const out=save(...args);s.shutdown();return out;};
s.begin(f.offer()); assert.deepEqual(f.calls,[]);

// Native serialization validation must happen before any durable reservation.
f=fixture();f.transfer.validate=()=>{throw new Error('native byte bound');};s=f.make();
assert.throws(()=>s.begin(f.offer()),/native byte bound/);assert.deepEqual(f.calls,[]);assert.equal(f.states.get(1).pending,undefined);

// Native inventory bounds apply to the aggregate, not just each stack.
f=fixture();f.inv.entries.push({baseId:200,count:2147483647},{baseId:201,count:2147483600});
s=f.make();const overfull=f.offer();overfull.debit=require('../../game/merchant-settlement').takeEntries(f.inv,100,1).inventory;assert.throws(()=>s.begin(overfull),/total/);assert.deepEqual(f.calls,[]);assert.equal(f.states.get(1).pending,undefined);

// A concurrent ordinary gain refuses the credit snapshot, then is preserved.
f=fixture(); s=f.make(); s.begin(f.offer()); f.save();
const ordinaryCas=f.transfer.cas; let raced=false;
f.transfer.cas=(...args)=>{if(args[4]===2 && !raced){raced=true;f.inv.entries.push({baseId:201,count:2});}return ordinaryCas(...args);};
s.tick(); assert.equal(f.inv.entries[0].count,40); assert.ok(f.states.get(1).pending);
s.tick(); assert.equal(f.inv.entries[0].count,43);assert.equal(f.inv.entries.at(-1).baseId,201);
f.save();s.tick();assert.equal(f.states.get(1).pending,null);

// Lost acknowledgements at merchant commit and final clear revoke the writer;
// a new controller uses durable state and never repeats the payment.
for(const phase of ['merchant','clear']) {
  f=fixture();s=f.make();s.begin(f.offer());f.save();
  const write=f.purses.compareAndCommit;let failed=false;
  f.purses.compareAndCommit=(...args)=>{const result=write(...args);if(!failed && (phase==='merchant'?args[2].pending?.phase==='credit':args[2].pending===null)){failed=true;throw new Error('lost '+phase+' acknowledgement');}return result;};
  if(phase==='clear'){s.tick();f.save();}
  assert.throws(()=>s.tick(),/acknowledgement/);assert.equal(s.available(),false);
  f.purses.compareAndCommit=write;s=f.make();s.tick();f.save();s.tick();
  assert.equal(f.inv.entries[0].count,43);assert.equal(f.states.get(1).pending,null);assert.deepEqual(f.calls,[1,2]);
}

console.log('PASS merchant debit quarantine, exact saved receipts, restart, identity, cap, ledger failure and reload');
