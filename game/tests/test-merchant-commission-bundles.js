'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),state=require('../../game/merchant-commission-state');
const settlement=require('../../game/merchant-settlement'),copy=value=>JSON.parse(JSON.stringify(value));
const file=path.join(__dirname,'test-merchant-settlement.js'),ctx={require:createRequire(file),console:{log(){}}};
vm.runInNewContext(fs.readFileSync(file,'utf8').split('function offlineRecord')[0]+';this.fixture=fixture;',ctx);
const human={desc:'10',profileId:7},job='q-whiterun-smith-master-delivery',at=2000000000000;
const terms={hash:'b'.repeat(64),hours:12,goods:[
 {item:{baseId:100,name:'Iron Ingot'},count:2,unit:3},
 {item:{baseId:101,name:'Silver Ingot'},count:1,unit:4}
]};
const accepted=state.reserve(undefined,human,job,terms,at,250);
assert.equal(accepted.ok,true);assert.equal(accepted.next.v,2);assert.equal(state.reserved(accepted.next),10);
assert.deepEqual(accepted.next.held[state.key(human,job)].goods,terms.goods);
const done=state.finish(accepted.next,human,job,accepted.token,at+1);
assert.deepEqual(done.next.cool[state.key(human,job)],[at+1,12]);
assert.equal(state.reserve(done.next,human,job,terms,at+12*3600000,250).why,'cooldown');
assert.equal(state.reserve(done.next,human,job,terms,at+1+12*3600000,250).ok,true);
const legacyJob='q-whiterun-smith-straps',legacyTerms={hash:'a'.repeat(64),item:{baseId:100,name:'Iron Ingot'},count:1,unit:3};
const old=state.reserve(undefined,human,legacyJob,legacyTerms,at,250);
const mixed=state.reserve(old.next,human,job,terms,at,250);
assert.equal(mixed.next.v,2);assert.deepEqual(mixed.next.held[state.key(human,legacyJob)],old.next.held[state.key(human,legacyJob)]);
const oldPaid=state.finish(mixed.next,human,legacyJob,old.token,at);
assert.equal(oldPaid.next.cool[state.key(human,legacyJob)],at,'old jobs retain their original six-hour timestamp representation');
assert.deepEqual(oldPaid.next.held[state.key(human,job)],mixed.next.held[state.key(human,job)]);
for(const defect of ['duplicate','gold','hours','item','unit','sparse']) {
 const invalid=copy(terms);
 if(defect==='duplicate')invalid.goods[1]=invalid.goods[0];
 if(defect==='gold')invalid.goods[0].unit=2147483647;
 if(defect==='hours')invalid.hours=7;
 if(defect==='item')invalid.goods[0].item.baseId=15;
 if(defect==='unit')invalid.goods[0].unit=null;
 if(defect==='sparse')delete invalid.goods[0];
 assert.equal(state.reserve(undefined,human,job,invalid,at,250).ok,false,defect);
}
const golden=require('../../tests/fixtures/merchant-prebundle-transfers.json');
{
 const f=ctx.fixture(),made=state.reserve(undefined,human,legacyJob,legacyTerms,at,250);
 f.states.get(1).commissions=made.next;
 const offer=f.offer();offer.kind='commission';offer.next.commissions=state.finish(made.next,human,legacyJob,made.token,at).next;
 const s=settlement.createSettlement({purses:f.purses,transfer:f.transfer,world:'dev:test-ledger',now:()=>at});
 s.begin(offer);assert.deepEqual(copy(f.states.get(1)),golden.full,'pre-bundle v4 full bytes stay exact');
 f.save();s.tick();assert.deepEqual(copy(f.states.get(1)),golden.compact,'pre-bundle v4 compact bytes stay exact');
}
function fixture(){
 const f=ctx.fixture();f.inv.entries.push({baseId:101,count:2,name:'Marked silver',chargePercent:0.4});
 f.states.get(1).commissions=copy(accepted.next);
 const expected=copy(f.inv),first=settlement.takeEntries(expected,100,2),second=settlement.takeEntries(first.inventory,101,1);
 const next=state.finish(accepted.next,human,job,accepted.token,at);
 const offer={merchantId:1,humanId:10,profileId:7,kind:'commission',previous:copy(f.states.get(1)),expected,debit:second.inventory,
  credit:[{baseId:15,count:10}],next:{purse:240,supply:{},commissions:next.next,
   stock:first.entries.concat(second.entries).map(entry=>({baseId:entry.baseId,count:entry.count,
    name:entry.baseId===100?'Iron Ingot':'Silver Ingot',entry}))}};
 let time=at;const make=()=>settlement.createSettlement({purses:f.purses,transfer:f.transfer,world:'dev:test-ledger',now:()=>time});
 return {f,offer,make,clock:next=>{time=next;}};
}
{
 const w=fixture();let s=w.make();assert.equal(s.begin(w.offer).accepted,true);w.f.save();s.tick();
 assert.equal(w.f.inv.entries.find(row=>row.baseId===15).count,50);
 assert.equal(w.f.states.get(1).stock.find(row=>row.baseId===100).entry.health,0.7);
 assert.equal(w.f.states.get(1).stock.find(row=>row.baseId===101).entry.chargePercent,0.4);
 s.shutdown();w.f.save();w.clock(at+24*3600000);s=w.make();s.tick();
 assert.deepEqual(copy(w.f.states.get(1).commissions.cool[state.key(human,job)]),[at+24*3600000,12]);
 assert.equal(w.f.states.get(1).pending,null);assert.deepEqual(copy(w.f.calls),[1,2]);
}
for(const defect of ['missing-part','wrong-label','wrong-quantity','wrong-total','changed-cadence']) {
 const w=fixture();
 if(defect==='missing-part'){w.offer.debit.entries.find(row=>row.baseId===101).count=2;w.offer.next.stock.pop();}
 if(defect==='wrong-label')w.offer.next.stock[1].name='Another metal';
 if(defect==='wrong-quantity'){w.offer.debit.entries=w.offer.debit.entries.filter(row=>row.baseId!==101);w.offer.next.stock[1].count=2;w.offer.next.stock[1].entry.count=2;}
 if(defect==='wrong-total'){w.offer.credit[0].count=11;w.offer.next.purse=239;}
 if(defect==='changed-cadence')w.offer.next.commissions.cool[state.key(human,job)][1]=6;
 assert.throws(()=>w.make().begin(w.offer),/commission|conserve/i,defect);
 assert.deepEqual(copy(w.f.calls),[],'bad bundles never partially charge');
}
console.log('PASS bundled original terms, per-job cadence, mixed v1/v2 promises, exact v4 legacy bytes and all-or-nothing metadata conservation');
