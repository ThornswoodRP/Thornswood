'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../game/gamemode.js'),'utf8');
const block=source.slice(source.indexOf('// NPC MERCHANT PURSES BEGIN'),source.indexOf('// NPC MERCHANT PURSES END'));
function fixture(){
 const ctx={require};vm.createContext(ctx);vm.runInContext(block,ctx);
 let saved={version:2,entries:{'1:Skyrim.esm':null,'2:Skyrim.esm':null}},reads=()=>{};
 const clone=x=>JSON.parse(JSON.stringify(x));
 const storage={namespace:'dev:private/merchant-ledger.json',durable:true,load:()=>clone(saved),save(doc){saved=clone(doc);return true;}};
 const props=new Map();
 const api={makeProperty(){},getIdFromDesc:desc=>Number(desc.split(':')[0]),getNpcAIState(){reads();return {isHuman:false};},
  get:(id,key)=>key==='baseDesc'?'a:Skyrim.esm':props.get(id),set:(id,key,value)=>props.set(id,clone(value))};
 const data={keep:[1,2].map(id=>[id+':Skyrim.esm','a:Skyrim.esm',null,null,null,null,'trader'])};
 const create=(store=storage)=>ctx.createNpcMerchantPurses(api,data,store);
 const first=create();first.prepare(1);first.prepare(2);
 return {ctx,create,first,storage,api,props,saved:()=>clone(saved),onRead(fn){reads=fn;},reload(){vm.runInContext(block,ctx);}};
}
{
 const f=fixture(),old=f.first,one=old.read(1),fresh=f.create();
 const two=fresh.read(2);fresh.compareAndCommit(2,0,{...two,purse:217});
 assert.throws(()=>old.compareAndCommit(1,0,{...one,purse:201}),/unavailable/,'the old full-document writer cannot erase another merchant trade');
 assert.equal(f.saved().entries['2:Skyrim.esm'].purse,217);
 assert.throws(()=>old.prepare(1),/unavailable/);
 assert.throws(()=>old.pendingRecords(),/unavailable/);
}
{
 const f=fixture(),one=f.first.read(1);
 f.reload();
 const fresh=f.create({...f.storage});
 fresh.compareAndCommit(2,0,{...fresh.read(2),purse:211});
 assert.throws(()=>f.first.compareAndCommit(1,0,{...one,purse:200}),/unavailable/,'the namespace fence survives function redefinition and a replacement storage object');
 assert.equal(f.saved().entries['2:Skyrim.esm'].purse,211);
}
{
 const f=fixture(),one=f.first.read(1);
 f.onRead(()=>{f.onRead(()=>{});f.create();});
 assert.throws(()=>f.first.compareAndCommit(1,0,{...one,purse:200}),/busy/,'replacement during actor reads is refused before either writer saves');
 assert.equal(f.saved().entries['1:Skyrim.esm'].purse,250);
 assert.equal(f.saved().entries['2:Skyrim.esm'].purse,250);
 assert.equal(f.first.compareAndCommit(1,0,{...one,purse:205}).purse,205,'the mutation guard releases after failure');
}
for(const boundary of ['save','projection']) {
 const f=fixture(),one=f.first.read(1);let refusal;
 let adapterReads=0;
 const replacement={namespace:f.storage.namespace,durable:true,
  get load(){adapterReads++;return f.storage.load;},get save(){adapterReads++;return f.storage.save;}};
 const replace=()=>{try{f.create(replacement);}catch(error){refusal=error;}};
 if(boundary==='save') {
  const save=f.storage.save;f.storage.save=function(doc){replace();return save(doc);};
 } else {
  const set=f.api.set;f.api.set=function(...args){replace();return set(...args);};
 }
 f.first.compareAndCommit(1,0,{...one,purse:188});
 assert.match(String(refusal),/busy/,'replacement cannot split the '+boundary+' boundary');
 assert.equal(adapterReads,0,'busy replacement invokes no storage method getter');
 assert.equal(f.saved().entries['1:Skyrim.esm'].purse,188);
 assert.equal(f.first.read(1).purse,188);
}
{
 const f=fixture(),one=f.first.prepare(1),two=f.first.read(2);
 f.first.compareAndCommit(2,0,{...two,purse:177});
 f.first.compareAndCommit(1,0,{...one,purse:166});
 assert.equal(f.saved().entries['2:Skyrim.esm'].purse,177,'a prepared offer does not retain a full document across another merchant commit');
}
{
 const f=fixture(),one=f.first.read(1);let nested;
 f.onRead(()=>{f.onRead(()=>{});try{f.first.compareAndCommit(1,0,{...one,purse:123});}catch(error){nested=error;}});
 const result=f.first.compareAndCommit(1,0,{...one,purse:199});
 assert.match(String(nested),/busy/,'a nested mutation cannot reuse a revision held by the outer mutation');
 assert.equal(result.revision,1);assert.equal(f.saved().entries['1:Skyrim.esm'].purse,199);
}
{
 const f=fixture(),other=f.create({...f.storage,namespace:'main:other/merchant-ledger.json'});
 assert.equal(f.first.read(1).purse,250,'another namespace does not revoke this channel');
 other.shutdown();assert.equal(f.first.prepare(1).purse,250);
}
console.log('PASS merchant namespace ownership, reload revocation, interleaved writes and reentrant mutations');
