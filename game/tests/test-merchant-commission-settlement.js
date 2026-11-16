'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{createSettlement}=require('../../game/merchant-settlement');
const policy=require('../../game/merchant-commission-state'),copy=value=>JSON.parse(JSON.stringify(value));
const file=path.join(__dirname,'test-merchant-settlement.js'),context={require:createRequire(file),console:{log(){}}};
vm.runInNewContext(fs.readFileSync(file,'utf8').split('function offlineRecord')[0]+';this.fixture=fixture;',context);
const old=require('../../tests/fixtures/merchant-precommission-transfers.json');
{
 const f=context.fixture(),s=f.make();s.begin(f.offer());
 assert.deepEqual(copy(f.states.get(1)),old.full,'legacy full intent retains its exact pre-commission bytes');
 f.save();s.tick();assert.deepEqual(copy(f.states.get(1)),old.compact,'legacy compact intent retains its exact pre-commission bytes');
 s.shutdown();const restored=f.make();f.save();restored.tick();
 assert.equal(f.states.get(1).pending,null);assert.equal(f.states.get(1).commissions,undefined);
}
const human={desc:'10',profileId:7},job='q-whiterun-smith-straps',at=2000000000000;
function guarded(f) {
 const compare=f.purses.compareAndCommit;
 f.purses.callerGuard=true;
 f.purses.compareAndCommit=function(id,revision,next,caller){
  if(caller&&caller()!==true)return null;return compare.call(this,id,revision,next);
 };
 return createSettlement({purses:f.purses,transfer:f.transfer,world:'dev:test-ledger',now:()=>at});
}
function reserve(f,count=1){
 const made=policy.reserve(undefined,human,job,{hash:'a'.repeat(64),item:{baseId:100,name:'Iron Ingot'},count,unit:3},at,250);
 f.states.get(1).commissions=made.next;return made;
}
{
 const f=context.fixture(),s=guarded(f),held=reserve(f),state=copy(f.states.get(1));
 assert.throws(()=>s.changeCommissions(1,state,{...state,commissions:policy.empty()},human,()=>true,
   {kind:'cancel',job,token:held.token,at}),/transition/i,'a cancellation cannot reset the serial or erase evidence');
 assert.equal(f.states.get(1).commissions.serial,held.token);assert.deepEqual(copy(f.calls),[]);
 const cancelled=policy.cancel(state.commissions,human,job,held.token,at);
 assert.equal(s.changeCommissions(1,state,{...state,commissions:cancelled.next},human,()=>false,
   {kind:'cancel',job,token:held.token,at}),null,'final caller refusal takes no promise');
 assert.deepEqual(copy(f.states.get(1)),state);
 assert.ok(s.changeCommissions(1,state,{...state,commissions:cancelled.next},human,()=>true,
   {kind:'cancel',job,token:held.token,at}));
 assert.equal(f.states.get(1).commissions.serial,held.token);assert.deepEqual(copy(f.calls),[]);
}
{
 const f=context.fixture(),s=guarded(f),held=reserve(f),state=copy(f.states.get(1));
 const cancel=policy.cancel(state.commissions,human,job,held.token,at);
 assert.throws(()=>s.changeCommissions(1,state,{...state,commissions:cancel.next,unknown:'altered'},human,()=>true,
   {kind:'cancel',job,token:held.token,at}),/action/i,'metadata writes cannot change unrelated ledger fields');
 assert.throws(()=>s.changeCommissions(1,state,{...state,commissions:cancel.next},{desc:'11',profileId:7},()=>true,
   {kind:'cancel',job,token:held.token,at}),/transition/i,'another human cannot cancel this promise');
 assert.deepEqual(copy(f.states.get(1)),state);assert.deepEqual(copy(f.calls),[]);
}
{
 const f=context.fixture(),held=reserve(f),offer=f.offer();let time=at;
 offer.kind='commission';offer.next.commissions=policy.finish(held.next,human,job,held.token,time).next;
 const make=()=>createSettlement({purses:f.purses,transfer:f.transfer,world:'dev:test-ledger',now:()=>time});
 let s=make();assert.equal(s.begin(offer).accepted,true);
 assert.equal(f.states.get(1).pending.version,4,'commission transfers have an explicit new format');
 assert.deepEqual(copy(f.inv.entries[1]),{baseId:100,count:7,name:'Tempered iron',health:0.7});
 f.save();s.tick();assert.equal(f.states.get(1).purse,247);
 assert.equal(f.inv.entries[0].count,43);assert.equal(Object.keys(f.states.get(1).commissions.held).length,0);
 const credit=copy(f.states.get(1));s.shutdown();f.save();time+=8*60*60*1000;
 s=make();s.tick();const settled=f.states.get(1);
 assert.equal(settled.pending,null);assert.equal(settled.commissions.cool[policy.key(human,job)],time,
   'six hours begins at successful ledger settlement after the saved receipt, including a delayed recovery');
 assert.equal(settled.stock[0].entry.health,0.7);assert.deepEqual(copy(f.calls),[1,2]);
 time+=100;s.tick();assert.equal(f.states.get(1).commissions.cool[policy.key(human,job)],time-100);
 assert.equal(credit.pending.version,4);
}
{
 const f=context.fixture();reserve(f,83);const offer=f.offer();offer.next.commissions=copy(offer.previous.commissions);
 assert.throws(()=>f.make().begin(offer),/reserv|commission/i,'ordinary trade cannot spend the promised249 gold');
 assert.deepEqual(copy(f.calls),[]);assert.equal(f.states.get(1).purse,250);
}
for(const defect of ['owner','payment','count','promise','foreign-cooldown']) {
 const f=context.fixture(),held=reserve(f),offer=f.offer();offer.kind='commission';
 offer.next.commissions=policy.finish(held.next,human,job,held.token,at).next;
 if(defect==='owner') {const nextHuman={desc:'11',profileId:7};const changed=policy.reserve(undefined,nextHuman,job,
   {hash:'a'.repeat(64),item:{baseId:100,name:'Iron Ingot'},count:1,unit:3},at,250);f.states.get(1).commissions=changed.next;
   offer.previous=copy(f.states.get(1));offer.next.commissions=policy.finish(changed.next,nextHuman,job,changed.token,at).next;}
 if(defect==='payment'){offer.next.purse=246;offer.credit[0].count=4;}
 if(defect==='count'){offer.debit.entries[1].count=6;offer.next.stock[0].count=2;offer.next.stock[0].entry.count=2;}
 if(defect==='promise')offer.next.commissions.held=copy(held.next.held);
 if(defect==='foreign-cooldown')offer.next.commissions.cool[policy.key(human,'q-other-work')]=at;
 assert.throws(()=>f.make().begin(offer),/commission|conserve/i,defect);
 assert.deepEqual(copy(f.calls),[],'malformed completion makes no native inventory write');
}
console.log('PASS commission conservation, reserved purse, metadata, delayed settlement and exact legacy pending compatibility');
