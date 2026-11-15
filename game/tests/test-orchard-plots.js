'use strict';
const assert=require('node:assert/strict');
const {createOrchardPlots}=require('../../game/quest-orchard-plots');
const refs=Array.from({length:10},(_,i)=>String(i)),copy=v=>JSON.parse(JSON.stringify(v));
const ripe={by:20,crop:"141081:JK's Whiterun's Outskirts.esp",at:100,ms:1000,step:2};
function fixture() {
 let saved={version:1,entries:Object.fromEntries(refs.map(ref=>[ref,null]))},writes=0,fail=false;
 const storage={durable:true,load:()=>copy(saved),save:doc=>{writes++;if(fail)throw Error('save unknown');saved=copy(doc);return true;}};
 return {open:()=>createOrchardPlots(storage,refs),saved:()=>copy(saved),writes:()=>writes,fail:()=>{fail=true;}};
}
{
 const f=fixture(),p=f.open();assert.equal(p.write('0',ripe),true);
 let paid=0;assert.equal(p.harvest('0',ripe,()=>true,fence=>{
  assert.equal(f.saved().entries['0'].crop,'','clear is durable before goods');
  assert.equal(p.write('0',ripe),false,'reentrant sowing refuses');
  assert.equal(p.harvest('1',null,()=>true,()=>{paid++;return true;}),false,'namespace lock covers other trees');
  assert.equal(fence(),true);paid++;return true;
 }),true);assert.equal(paid,1);
 assert.equal(f.open().read('0').crop,'','restart cannot resurrect harvested crop');
}
for(const refusal of [false,null,'throw']) {
 const f=fixture(),p=f.open();p.write('0',ripe);
 assert.equal(p.harvest('0',ripe,()=>true,()=>{if(refusal==='throw')throw Error('unknown');return refusal;}),false);
 if(refusal===false)assert.deepEqual(p.read('0'),ripe,'definite refusal restores');
 else {assert.equal(p.available(),false);assert.equal(f.open().read('0').crop,'','unknown award retains durable cleared source');}
}
{
 const f=fixture(),p=f.open();p.write('0',ripe);const before=f.writes();let paid=0;
 assert.equal(p.harvest('0',null,()=>true,()=>{paid++;return true;}),false);
 assert.equal(p.harvest('0',ripe,()=>false,()=>{paid++;return true;}),false);
 assert.equal(f.writes(),before);assert.equal(paid,0);
 f.fail();assert.equal(p.harvest('0',ripe,()=>true,()=>{paid++;return true;}),false);assert.equal(paid,0);assert.equal(p.available(),false);
}
{
 const f=fixture(),p=f.open();p.write('0',ripe);let valid=true;
 assert.equal(p.harvest('0',ripe,()=>valid,fence=>{valid=false;assert.equal(fence(),false);return false;}),false);
 assert.deepEqual(p.read('0'),ripe);
 p.shutdown();assert.equal(p.write('0',ripe),false);assert.throws(()=>p.read('0'));
}
{
 const f=fixture(),p=f.open();let seeds=2;
 assert.equal(p.sowWithSeed('0',null,ripe,()=>true,fence=>{
  assert.equal(p.sowWithSeed('0',null,ripe,()=>true,()=>{seeds--;return true;}),false);
  assert.equal(p.compareWrite('1',null,{by:0,crop:'',at:0,ms:0,step:0}),false);
  assert.equal(fence(),true);seeds--;return true;
 }),true);
 assert.equal(seeds,1);assert.deepEqual(p.read('0'),ripe);
 assert.equal(p.sowWithSeed('0',ripe,ripe,()=>true,()=>{seeds--;return true;}),false);
 assert.equal(p.sow('0',ripe),false,'a stale sow cannot overwrite a ripe plot');
 assert.equal(p.compareWrite('0',null,{by:0,crop:'',at:0,ms:0,step:0}),false,'stale ordinary harvest cannot clear a replacement plot');
}
console.log('PASS durable plot-before-goods ordering, restart, reentrant sowing/harvest refusal, definite rollback and unknown retention');
