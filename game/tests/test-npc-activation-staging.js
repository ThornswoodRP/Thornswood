'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../game/gamemode.js'),'utf8');
const ctx={Map,Set,Math,Number,JSON,Buffer,Date};vm.createContext(ctx);
for(const name of ['NPC MERCHANT PURSES','NPC POPULATION POLICY','NPC SERVER RUNTIME'])
  vm.runInContext(source.slice(source.indexOf('// '+name+' BEGIN'),source.indexOf('// '+name+' END')),ctx);
const data={version:1,plugins:['Skyrim.esm'],cut:['2:Skyrim.esm'],keep:[
  ['1:Skyrim.esm','a:Skyrim.esm','3c:Skyrim.esm',[10,20,30],100,45,'animal','farm',null,3,'farm1']]};
{
  let writes=0;
  const cuts=[],api={makeProperty(){},getIdFromDesc:d=>parseInt(d,16),setNpcPlacementExclusions:ids=>cuts.push(Array.from(ids)),
    set(){writes++;},setNpcDifficultyTier(){writes++;}};
  const population=ctx.createNpcPopulation(api,data,data.plugins,null,{suspended:true});
  assert.deepEqual(cuts,[],'constructing a staged policy must not apply any exclusions');
  assert.equal(population.configure(1,{isHuman:false}),null,'staged policy grants no ownership');
  // No cut list goes to the engine (#2468, #2486): Thornswood-Last.esp switches
  // every cut placement off at the record, so activation hands over nothing.
  population.commit();assert.deepEqual(cuts,[],'activation hands the engine no cut list');
  assert.equal(population.commit(),true,'a second commit of an active policy is a no-op');
  population.configure(1,{isHuman:false,pos:[10,20,30],cellOrWorld:60});
  population.stop();assert.throws(()=>population.commit(),/unavailable|revoked/);
  const before=writes;population.afterOwnership(1);assert.equal(writes,before,'stopped policy cannot mutate ownership state');
}
{
  // The engine's exclusion call is never reached, even where it would fail.
  let attempts=0;
  const api={makeProperty(){},getIdFromDesc:d=>parseInt(d,16),setNpcPlacementExclusions(){attempts++;throw Error('never called');}};
  const policy=ctx.createNpcPopulation(api,data,data.plugins,null,{suspended:true});
  assert.equal(policy.commit(),true);
  assert.equal(attempts,0,'activation never asks the engine to exclude placements');
  policy.stop();assert.throws(()=>policy.commit(),/unavailable|revoked/);
}
for(const failAt of Array.from({length:8},(_,i)=>i+1)) {
  const pending=new Map();let serial=0;
  const timers={setTimeout(fn){if(++serial===failAt)throw Error('timer registration failure');pending.set(serial,fn);return serial;},
    clearTimeout(handle){pending.delete(handle);}};
  assert.throws(()=>ctx.startSharedNpcServerRuntime({makeProperty(){}},timers,()=>0,()=>{}, {},{suspended:true}),/timer registration/);
  assert.equal(pending.size,0,'failed registration '+failAt+' must cancel every earlier owned callback');
}
{
  const pending=new Map();let serial=0,work=0;
  const timers={setTimeout(fn){pending.set(++serial,fn);return serial;},clearTimeout(handle){pending.delete(handle);}};
  const api=new Proxy({makeProperty(){}},{get(target,key){return target[key] || function(){work++;throw Error('native work before commit');};}});
  const runtime=ctx.startSharedNpcServerRuntime(api,timers,()=>0,()=>{}, {},{suspended:true});
  for(const [handle,fn] of Array.from(pending)) {pending.delete(handle);assert.doesNotThrow(()=>fn());}
  assert.equal(work,0,'registered timers remain suspended until activation');
  runtime.stop();assert.equal(pending.size,0);
  assert.throws(()=>runtime.start(),/unavailable|revoked/);
}
console.log('PASS staged population commit and owned runtime timer construction');

for(const boundary of ['spawnDelay','titleLookup','titleWrite','homeWrite','spawnPoint']) {
  let policy,revoked=false;const stale=[];
  const dynamic=['homeWrite','spawnPoint'].includes(boundary),id=dynamic?0xff000001:1;
  const catalogue=JSON.parse(JSON.stringify(data));
  if(!dynamic) {catalogue.keep[0][6]='transport';catalogue.keep[0][13]='Coach Driver';}
  function call(name) {if(revoked)stale.push(name);if(name===boundary){revoked=true;policy.stop();}}
  const api={makeProperty(){},getIdFromDesc:d=>parseInt(d,16),setNpcPlacementExclusions(){},
    get(_id,key){return key==='baseDesc'?'a:Skyrim.esm':undefined;},
    getDescFromId(){call('titleLookup');return '1:Skyrim.esm';},
    callPapyrusFunction(){call('titleWrite');},
    set(_id,key){call(key==='thornswoodNpcHome'?'homeWrite':key);},
    setNpcServerControlled(){call('ownership');},setNpcDifficultyTier(){call('tier');}};
  policy=ctx.createNpcPopulation(api,catalogue,data.plugins,{prepare(){call('purse');}},{suspended:true});
  policy.commit();
  assert.equal(policy.admit(id,{isHuman:false,pos:[10,20,30],cellOrWorld:60}),false);
  assert.deepEqual(stale,[],'revocation during '+boundary+' must prevent every later native mutation');
}

for(const boundary of ['stateRead','ownership','activityRead','rejectionOwnership']) {
  let runtime,revoked=false,serial=0,ownershipCalls=0;const pending=new Map(),stale=[];
  const timers={setTimeout(fn){pending.set(++serial,fn);return serial;},clearTimeout(id){pending.delete(id);}};
  function stopAt(name){if(name===boundary){runtime.stop();revoked=true;}}
  const api={makeProperty(){},getNpcAIState(){stopAt('stateRead');return {isHuman:false,cellOrWorld:60,pos:[0,0,0],rot:[0,0,0],
      aggression:0,confidence:1,meleeReach:1,meleeAllowance:16,factions:[]};},
    setNpcServerControlled(){if(revoked)stale.push('ownership');stopAt(++ownershipCalls===1?'ownership':'rejectionOwnership');},
    get(){stopAt('activityRead');throw Error('activity read failed');},
    stopNpcMovement(){if(revoked)stale.push('movement');}};
  runtime=ctx.startSharedNpcServerRuntime(api,timers,()=>0,()=>{},null,{suspended:true});
  runtime.enroll(1);
  const [handle,callback]=Array.from(pending).find(([,fn])=>fn.npcRuntimeTask==='prepareTick');
  pending.delete(handle);callback();
  assert.equal(runtime.start(),false,'queued native callback can revoke activation');
  assert.deepEqual(stale,[],'queued '+boundary+' failure cannot mutate NPCs after runtime stop');
  assert.equal(pending.size,0);
}

{
  let serial=0,clears=0;const pending=new Map();
  const timers={setTimeout(fn){pending.set(++serial,fn);return serial;},clearTimeout(id){
    clears++;if(id===1)throw Error('timer cancellation failed');pending.delete(id);}};
  const runtime=ctx.startSharedNpcServerRuntime({makeProperty(){}},timers,()=>0,()=>{},null,{suspended:true});
  assert.throws(()=>runtime.stop(),/cancellation/);
  assert.equal(clears,serial,'one timer cancellation error must not skip the other owned handles');
  assert.throws(()=>runtime.start(),/revoked/);
  for(const callback of pending.values())assert.doesNotThrow(()=>callback(),'uncancelled callbacks remain revoked');
}

for(const method of ['getNavmeshRecords','lookupEspmRecordById']) for(const boundary of ['lookup','return']) {
  let runtime,serial=0,revoked=false;const pending=new Map(),stale=[];
  const timers={setTimeout(fn){pending.set(++serial,fn);return serial;},clearTimeout(id){pending.delete(id);}};
  const api={makeProperty(){},getNpcAIState:()=>({isHuman:false,cellOrWorld:60,pos:[0,0,0],rot:[0,0,0],
      aggression:0,confidence:1,meleeReach:1,meleeAllowance:16,factions:[]}),
    setNpcServerControlled(){if(revoked)stale.push('ownership');},get:()=>null,
    stopNpcMovement(){if(revoked)stale.push('movement');},getNavmeshRecords:()=>[1]};
  Object.defineProperty(api,method,{get(){
    if(boundary==='lookup'){runtime.stop();revoked=true;}
    return function(){if(revoked)stale.push(method);if(boundary==='return'){runtime.stop();revoked=true;}return [1];};
  }});
  runtime=ctx.startSharedNpcServerRuntime(api,timers,()=>0,()=>{},null,{suspended:true});
  runtime.enroll(1);
  for(const task of ['prepareTick','meshTick']) {
    const [handle,callback]=Array.from(pending).find(([,fn])=>fn.npcRuntimeTask===task);
    pending.delete(handle);callback();
  }
  assert.equal(runtime.start(),false,'delegated native '+method+' revokes activation at '+boundary);
  assert.deepEqual(stale,[],'navigation may not invoke natives after runtime revocation');
  assert.equal(pending.size,0);
}

for(const merchant of [false,true]) {
  let runtime,serial=0,revoked=false,stateReads=0,saves=0;const pending=new Map(),stale=[];
  const catalogue=JSON.parse(JSON.stringify(data));catalogue.keep[0][6]=merchant?'trader':'transport';
  if(!merchant)catalogue.keep[0][13]='Coach Driver';
  const timers={setTimeout(fn){pending.set(++serial,fn);return serial;},clearTimeout(id){pending.delete(id);}};
  const api={makeProperty(){},getIdFromDesc:d=>parseInt(d,16),setNpcPlacementExclusions(){},
    getNpcAIState(){if(merchant && ++stateReads===2){runtime.stop();revoked=true;}
      return {isHuman:false,profileId:-1,cellOrWorld:60,pos:[0,0,0],rot:[0,0,0],
        aggression:0,confidence:1,meleeReach:1,meleeAllowance:16,factions:[]};},
    getDescFromId(){if(!merchant){runtime.stop();revoked=true;}return '1:Skyrim.esm';},
    get(id,key){return key==='baseDesc'?'a:Skyrim.esm':null;},
    set(id,key){if(revoked)stale.push(key);},callPapyrusFunction(){if(revoked)stale.push('title');},
    setNpcServerControlled(){if(revoked)stale.push('ownership');},stopNpcMovement(){if(revoked)stale.push('movement');}};
  const purses=merchant?ctx.createNpcMerchantPurses(api,catalogue,{namespace:{},durable:true,
    load:()=>({version:2,entries:{'1:Skyrim.esm':null}}),save(){saves++;return true;}}):null;
  const policy=ctx.createNpcPopulation(api,catalogue,data.plugins,purses);
  runtime=ctx.startSharedNpcServerRuntime(api,timers,()=>0,()=>{},policy,{suspended:true});runtime.enroll(1);
  const [handle,callback]=Array.from(pending).find(([,fn])=>fn.npcRuntimeTask==='prepareTick');
  pending.delete(handle);callback();assert.equal(runtime.start(),false);
  assert.deepEqual(stale,[],'delegated population and purse work observes runtime revocation');
  assert.equal(saves,0,'a revoked caller cannot initialize a merchant purse');
  assert.equal(pending.size,0);
}

{
  let runtime,serial=0,reentered=false;const pending=new Map(),cleared=[];
  const timers={setTimeout(fn){pending.set(++serial,fn);return serial;},clearTimeout(id){
    cleared.push(id);
    if(!reentered){reentered=true;runtime.stop();}
    pending.delete(id);
  }};
  runtime=ctx.startSharedNpcServerRuntime({makeProperty(){}},timers,()=>0,()=>{},null,{suspended:true});
  runtime.stop();
  assert.equal(cleared.length,serial,'reentrant stop cannot cancel an owned timer twice');
  assert.equal(new Set(cleared).size,serial);
  assert.equal(pending.size,0);
}

{
  let reads=0,writes=0;const policyData=JSON.parse(JSON.stringify(data));
  const native={makeProperty(){},getIdFromDesc:d=>parseInt(d,16),setNpcPlacementExclusions(){},set(){},
    setNpcServerControlled(){assert.equal(this,native);writes++;},
    setNpcDifficultyTier(){assert.equal(this,native);writes++;}};
  for(const method of ['set','setNpcServerControlled','setNpcDifficultyTier'])
    Object.defineProperty(native[method],'apply',{get(){reads++;throw Error('untrusted apply getter');}});
  const policy=ctx.createNpcPopulation(native,policyData,data.plugins,null);
  assert.equal(policy.admit(1,{isHuman:false,pos:[10,20,30],cellOrWorld:60}),true);
  assert.equal(reads,0);assert.equal(writes,2);
}

{
  let serial=0,reads=0;const seen=new Set();const pending=new Map();
  const timers={setTimeout(fn){pending.set(++serial,fn);return serial;},clearTimeout(id){pending.delete(id);}};
  const native={makeProperty(){},getNpcAIState(){assert.equal(this,native);seen.add('state');
      return {isHuman:false,cellOrWorld:60,pos:[0,0,0],rot:[0,0,0],
        aggression:0,confidence:1,meleeReach:1,meleeAllowance:16,factions:[]};},
    setNpcServerControlled(){assert.equal(this,native);seen.add('ownership');},get(){assert.equal(this,native);seen.add('read');return null;}};
  for(const method of ['getNpcAIState','setNpcServerControlled','get'])
    Object.defineProperty(native[method],'apply',{get(){reads++;throw Error('untrusted apply getter');}});
  const runtime=ctx.startSharedNpcServerRuntime(native,timers,()=>0,()=>{},null,{suspended:true});runtime.enroll(1);
  const [handle,callback]=Array.from(pending).find(([,fn])=>fn.npcRuntimeTask==='prepareTick');
  pending.delete(handle);callback();assert.equal(runtime.start(),true);
  assert.equal(reads,0);assert.deepEqual(Array.from(seen).sort(),['ownership','read','state'],'runtime invokes the real natives with their original receiver');
  runtime.stop();assert.equal(pending.size,0);
}
