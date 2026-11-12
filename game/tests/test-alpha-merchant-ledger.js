'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createAlphaMerchantLedger}=require('../../scripts/ops/New-AlphaMerchantLedger');
const roster=require('../../game/data/merchant-roster.json'),population=require('../../game/data/npc-population.json');
const copy=value=>JSON.parse(JSON.stringify(value));
const before=JSON.stringify([roster,population]),doc=createAlphaMerchantLedger(roster,population);
assert.equal(JSON.stringify([roster,population]),before);
assert.equal(Object.keys(doc.entries).length,249);assert.equal(Object.values(doc.entries).filter(Boolean).length,60);
assert.equal(Object.values(doc.entries).filter(Boolean).reduce((sum,row)=>sum+row.purse,0),15000);
assert.equal(doc.version,2,'the generated ledger is the one-shape version from #2870');
assert.equal(doc.sha256,crypto.createHash('sha256').update(JSON.stringify([2,doc.entries])).digest('hex'));
const source=fs.readFileSync(path.join(__dirname,'../../game/gamemode.js'),'utf8'),context={Map,Set,Number,JSON,require};
vm.createContext(context);vm.runInContext(source.slice(source.indexOf('// NPC MERCHANT PURSES BEGIN'),source.indexOf('// NPC MERCHANT PURSES END')),context);
const ids=new Map(roster.history.map(([ref],index)=>[ref,index+1]));
const data={keep:roster.merchants.map(row=>[row.reference,row.base,null,null,null,null,'trader']),
  merchantHistory:roster.history,merchantRoster:{version:1,worldMode:'existing'}};
const mirrors=new Map();let writes=0;
for(const row of roster.merchants)mirrors.set(ids.get(row.reference),{version:1,reference:row.reference,base:row.base,
  revision:999,purse:0,stock:[{baseId:100,count:10}],supply:{old:1},pending:{old:true}});
const native={makeProperty(){},getIdFromDesc:desc=>ids.get(desc),getNpcAIState:()=>({isHuman:false,profileId:0}),
  get:(id,key)=>key==='baseDesc'?roster.merchants.find(row=>ids.get(row.reference)===id).base:mirrors.get(id),
  set:(id,key,value)=>{writes++;mirrors.set(id,copy(value));}};
const disk={load:()=>copy(doc),durable:true,namespace:{},save(){throw Error('reset admission must not grant again');}};
const service=context.createNpcMerchantPurses(native,data,disk);
for(const row of roster.merchants) {
  const id=ids.get(row.reference),state=service.prepare(id);
  assert.deepEqual(copy(state),doc.entries[row.reference],'fresh ledger replaces an old projection, including pending and revision');
  assert.deepEqual(mirrors.get(id),doc.entries[row.reference]);
}
assert.equal(writes,60);assert.deepEqual(copy(service.pendingRecords()),[],'discarded mirror transfers are not recovery authority');
assert.equal(service.stats().initialized,0,'reset is not a recurring grant');service.shutdown();
{
  const alpha=copy(data);alpha.merchantRoster.worldMode='alpha';
  let saved=0,ledger={version:2,entries:Object.fromEntries(roster.history.map(([ref])=>[ref,null]))};
  mirrors.clear();
  const storage={load:()=>copy(ledger),durable:true,namespace:{},save:next=>{saved++;ledger=copy(next);return true;}};
  const admitted=context.createNpcMerchantPurses(native,alpha,storage);
  assert.equal(saved,0,'an alpha cut with no saved merchant state needs no pre-funding or reset');
  const selected=roster.merchants[0],id=ids.get(selected.reference);
  assert.equal(admitted.prepare(id).purse,250);assert.equal(saved,1,'ordinary first use grants once to a retained merchant');
  assert.equal(admitted.prepare(id).purse,250);assert.equal(saved,1);
  const retired=roster.history.find(([ref])=>!roster.merchants.some(row=>row.reference===ref));
  assert.equal(admitted.prepare(ids.get(retired[0])),null,'retired merchants never get an alpha grant');
  assert.equal(saved,1);admitted.shutdown();
}
for(const change of [r=>r.history.pop(),r=>r.merchants.pop(),r=>r.merchants[0].role='Merchant',
  r=>r.merchants[0].base='dead:Skyrim.esm',r=>r.merchants[0].bookHold='riften']) {
 const bad=copy(roster);change(bad);assert.throws(()=>createAlphaMerchantLedger(bad,population),/cannot be verified/);
}
{
 const bad=copy(roster),rows=copy(population),merchant=bad.merchants[0];
 merchant.reference='dead:Skyrim.esm';delete merchant.base;
 rows.npcs.push({ref:merchant.reference,role:'animal',hold:merchant.hold,keep:true});
 assert.throws(()=>createAlphaMerchantLedger(bad,rows),/cannot be verified/,'unknown selection cannot disappear from the generated ledger');
}
{
 const bad=copy(roster),rows=copy(population),merchant=bad.merchants[0];
 const row=rows.npcs.find(row=>row.ref===merchant.reference),index=bad.history.findIndex(pair=>pair[0]===merchant.reference);
 bad.history[index]=new Array(2);delete row.ref;delete row.base;delete merchant.reference;delete merchant.base;
 assert.throws(()=>createAlphaMerchantLedger(bad,rows),/cannot be verified/,'programmatic sparse pairs cannot bypass identity checks');
}
console.log('PASS alpha reset data, finite starting purses and ledger authority over stale NPC mirrors');

// A stopped process cannot replay its discarded intent. The human's native
// receipt remains authoritative and new work continues after that sequence.
const {createRequire}=require('node:module');
const settlementFile=path.join(__dirname,'test-merchant-settlement.js');
const settlementContext={require:createRequire(settlementFile),console};vm.createContext(settlementContext);
vm.runInContext(fs.readFileSync(settlementFile,'utf8').split('// Four large snapshots')[0],settlementContext);
const fixture=settlementContext.fixture(),old=fixture.make();old.begin(fixture.offer());fixture.save();
assert.equal(JSON.parse(fixture.live()).sequence,1);old.shutdown();
fixture.states.set(1,{reference:'1:Skyrim.esm',base:'a:Skyrim.esm',revision:0,purse:250,stock:[],supply:{}});
const pack=JSON.stringify(fixture.inv),fresh=fixture.make();
assert.deepEqual(copy(fresh.tick()),[]);assert.equal(JSON.stringify(fixture.inv),pack,'discarded debit gets no replay or compensating grant');
assert.equal(old.begin(fixture.offer()).accepted,false);
const offer=fixture.offer();offer.debit.entries[1].count=6;
fresh.begin(offer);assert.equal(JSON.parse(fixture.live()).sequence,2,'new debit uses the retained native sequence');
fixture.save();fresh.tick();assert.equal(JSON.parse(fixture.live()).sequence,3);
fixture.save();fresh.tick();assert.equal(fixture.states.get(1).pending,null);fresh.shutdown();
console.log('PASS discarded alpha intent cannot replay and new trades retain native receipt ordering');
