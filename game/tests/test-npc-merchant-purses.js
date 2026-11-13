'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../game/gamemode.js'),'utf8');
const start=source.indexOf('// NPC MERCHANT PURSES BEGIN'),end=source.indexOf('// NPC MERCHANT PURSES END');
assert.ok(start>=0 && end>start,'The production merchant purse service must exist');
const ctx={Map,Number,JSON};vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
const saved=new Map(),writes=[];
const ids={'1:Skyrim.esm':1,'2:Skyrim.esm':2,'a:Skyrim.esm':10};
let human=false,brokenRead=false,brokenWrite=false;
const api={makeProperty(){},getIdFromDesc:d=>ids[d],get:(id,p)=>{
  if(brokenRead) throw new Error('unavailable');
  if(p==='baseDesc') return 'a:Skyrim.esm';
  return saved.get(id+':'+p);
},set:(id,p,v)=>{
  if(brokenWrite) throw new Error('save unavailable');
  saved.set(id+':'+p,JSON.parse(JSON.stringify(v)));writes.push(id);
},getNpcAIState:()=>({isHuman:human,profileId:human?1:0,isDead:false})};
const data={keep:[['1:Skyrim.esm','a:Skyrim.esm',null,null,null,null,'trader'],
  ['2:Skyrim.esm','a:Skyrim.esm',null,null,null,null,'enemy']]};
let ledger={version:2,entries:{'1:Skyrim.esm':null}};
const storage={load:()=>JSON.parse(JSON.stringify(ledger)),save:next=>{ledger=JSON.parse(JSON.stringify(next));}};
function make(){return ctx.createNpcMerchantPurses(api,data,storage);}
let service=make();
const initial=service.prepare(1);
assert.equal(initial.purse,250);assert.equal(initial.stock.length,0);
assert.equal(writes.length,1);
assert.equal(service.prepare(1).purse,250);assert.equal(writes.length,1,'repeated admission does not hand out another purse');
ledger.entries['1:Skyrim.esm'].purse=0;
saved.get('1:thornswoodMerchant').purse=0;
const retiredService=service;service=make();
assert.throws(()=>retiredService.prepare(1),/unavailable/,'a replaced controller is revoked');
assert.equal(service.prepare(1).purse,0,'a new service retains a depleted saved purse');
assert.equal(writes.length,1,'restart does not top up the purse');
saved.set('1:thornswoodMerchant',null);
service=make();
assert.equal(service.prepare(1).purse,0,'a missing native save restores the authoritative depleted balance');
assert.equal(ledger.entries['1:Skyrim.esm'].purse,0);
assert.equal(writes.length,2,'restoring the projection is not another grant');
assert.equal(service.prepare(2),null,'an enemy never gets a merchant purse');
assert.equal(service.prepare(0xff000001),null,'a dynamic copy never gets an authored merchant purse');
human=true;assert.throws(()=>service.prepare(1),/human/i);human=false;
brokenRead=true;assert.throws(()=>service.prepare(1),/unavailable/);brokenRead=false;
saved.get('1:thornswoodMerchant').purse=-1;
assert.throws(()=>service.prepare(1),/saved merchant/i,'bad saved state refuses service instead of resetting to 250');
saved.delete('1:thornswoodMerchant');brokenWrite=true;
assert.throws(()=>service.prepare(1),/save unavailable/);assert.equal(writes.length,2);brokenWrite=false;
const current=make();
const fresh=current.prepare(1);fresh.purse=999;
assert.equal(current.prepare(1).purse,0,'returned state does not mutate the saved purse');
saved.get('1:thornswoodMerchant').reference='other:Skyrim.esm';
assert.throws(()=>current.prepare(1),/saved merchant/i,'saved identity must match the authored reference');
const population=JSON.parse(fs.readFileSync(path.join(__dirname,'../../game/data/npc-population.json'),'utf8'));
assert.equal(population.npcs.filter(n=>n.keep && n.role==='trader').length,60);
console.log('PASS NPC merchant purse initialization, depletion, reload, identity and failure checks');

for(const method of ['getNpcAIState','get','save','set']) for(const boundary of ['lookup','return']) {
  let armed=false,current=true,saves=0,mirrors=0;const stale=[];
  let document={version:2,entries:{'1:Skyrim.esm':null}};
  const native={makeProperty(){},getIdFromDesc:d=>ids[d],
    getNpcAIState:()=>({isHuman:false,profileId:-1}),get:(_id,key)=>key==='baseDesc'?'a:Skyrim.esm':null,
    set(){mirrors++;}};
  const disk={namespace:{},durable:true,load:()=>JSON.parse(JSON.stringify(document)),
    save(next){saves++;document=JSON.parse(JSON.stringify(next));return true;}};
  const target=method==='save'?disk:native,original=target[method];
  Object.defineProperty(target,method,{get(){
    if(armed && boundary==='lookup')current=false;
    return function(...args){
      assert.equal(this,target,'guarded calls preserve the API receiver');
      if(!current)stale.push(method);
      const result=original.apply(this,args);
      if(armed && boundary==='return')current=false;
      return result;
    };
  }});
  const purse=ctx.createNpcMerchantPurses(native,data,disk);armed=true;
  assert.throws(()=>purse.prepare(1,()=>current),/revoked/);
  assert.deepEqual(stale,[],method+' cannot run after its lookup revokes the caller');
  assert.equal(saves,method==='set' || method==='save' && boundary==='return'?1:0);
  assert.equal(mirrors,method==='set' && boundary==='return'?1:0);
  if(method==='getNpcAIState' || method==='get' || method==='save' && boundary==='lookup') {
    assert.doesNotThrow(()=>purse.read(1),'revoking a caller does not close a shared purse');
    armed=false;current=true;
    assert.equal(purse.prepare(1).purse,250,'a current caller can still initialize the untouched purse');
  }
}
console.log('PASS scoped merchant preparation at native lookup, return and durable-save boundaries');
for(const boundary of ['native-return','save-lookup','guard-reentry']) {
 let current=true,armed=false,saves=0;
 let document={version:2,entries:{'1:Skyrim.esm':null}};
 const native={makeProperty(){},getIdFromDesc:d=>ids[d],
  getNpcAIState:()=>{if(armed&&boundary==='native-return')current=false;return {isHuman:false,profileId:0};},
  get:(_id,key)=>key==='baseDesc'?'a:Skyrim.esm':null,set(){}};
 const disk={namespace:{},durable:true,load:()=>JSON.parse(JSON.stringify(document))};
 Object.defineProperty(disk,'save',{get(){if(armed&&boundary==='save-lookup')current=false;
  return next=>{saves++;document=JSON.parse(JSON.stringify(next));return true;};}});
 const purse=ctx.createNpcMerchantPurses(native,data,disk);const state=purse.prepare(1);armed=true;
 const rejected=purse.compareAndCommit(1,state.revision||0,{...state,purse:200},()=>{
  if(boundary==='guard-reentry')assert.throws(()=>purse.compareAndCommit(1,0,{...state,purse:1}),/busy/);
  return boundary==='guard-reentry'?false:current;
 });
 assert.equal(rejected,null,boundary+' revokes the final caller before any write');
 assert.equal(saves,1);assert.equal(document.entries['1:Skyrim.esm'].purse,250);
 assert.equal(purse.callerGuard,true);assert.equal(purse.ledgerStates().length,1);
}

{
  let current=true,armed=false,saves=0;
  let document={version:2,entries:{'1:Skyrim.esm':null}};
  const native={makeProperty(){},getIdFromDesc:d=>ids[d],getNpcAIState:()=>({isHuman:false,profileId:-1}),
    get:(_id,key)=>key==='baseDesc'?'a:Skyrim.esm':null,set(){}};
  const disk={namespace:{},load:()=>JSON.parse(JSON.stringify(document)),
    save(next){saves++;document=JSON.parse(JSON.stringify(next));return true;},
    get durable(){if(armed)current=false;return true;}};
  const purse=ctx.createNpcMerchantPurses(native,data,disk);armed=true;
  assert.throws(()=>purse.prepare(1,()=>current),/revoked/);
  assert.throws(()=>purse.read(1),/unavailable/,'post-save cancellation must revoke the stale writer');
  assert.throws(()=>purse.prepare(1),/unavailable/);
  assert.equal(saves,1,'a stale writer cannot initialize twice');
  armed=false;current=true;
  const successor=ctx.createNpcMerchantPurses(native,data,disk);
  assert.equal(successor.prepare(1).purse,250);
  assert.equal(saves,1,'a successor reads the committed purse without another grant');
}
{
  let reads=0,saves=0;
  const save=function(){assert.equal(this,disk);saves++;return true;};
  Object.defineProperty(save,'apply',{get(){reads++;throw Error('untrusted apply getter');}});
  const disk={namespace:{},durable:true,load:()=>({version:2,entries:{'1:Skyrim.esm':null}}),save};
  const native={makeProperty(){},getIdFromDesc:d=>ids[d],getNpcAIState:()=>({isHuman:false,profileId:-1}),
    get:(_id,key)=>key==='baseDesc'?'a:Skyrim.esm':null,set(){}};
  const purse=ctx.createNpcMerchantPurses(native,data,disk);
  assert.equal(purse.prepare(1).purse,250,'dispatch cannot consult the supplied function apply property');
  assert.equal(reads,0);assert.equal(saves,1);
}
