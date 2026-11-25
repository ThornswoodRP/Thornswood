'use strict';
// Exercise real needs settlement and eligibility, not filled replacement bars.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../gamemode/needs.ts'),'utf8');
let checks=0;
function test(name,run){run();checks++;console.log('PASS  '+name);}
function setup(){
  let god=false,failWrite=false,now=1000000000000;
  const store=new Map(),said=[];
  const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
  const ctx={console:{log:()=>{}},Date:{now:()=>now},Math,Number,Object,String,Array,JSON,isFinite,
    setInterval:()=>0,clearInterval:()=>{},guard:(_,fn)=>fn,notify:(_,line)=>said.push(line),say:()=>{},
    mp:{makeProperty:()=>{},get:(id,key)=>{
      if(id===0&&key==='onlinePlayers')return [10];
      if(key==='isGodMode')return god;
      if(key==='thornswoodNeeds')return clone(store.get(id));
      if(key==='worldOrCellDesc')return '3c:Skyrim.esm';
      return undefined;
    },set:(id,key,value)=>{if(failWrite)throw Error('save refused');if(key==='thornswoodNeeds')store.set(id,clone(value));}}
  };
  vm.createContext(ctx);vm.runInContext(source,ctx);
  const api=ctx.__thornswoodNeeds;
  store.set(10,Object.assign(api.fresh(),{food:12,drink:8,rest:3,temp:2}));
  return {api,store,ctx,god:v=>{god=v;},advance:ms=>{now+=ms;},fail:v=>{failWrite=v;}};
}
test('god mode pauses actual meter clocks without replacing saved values',()=>{
  const r=setup();r.god(true);const before=r.store.get(10);r.advance(3600000);const after=r.api.settle(10);
  for(const key of ['food','drink','rest','temp'])assert.equal(after[key],before[key]);
  assert.equal(after.at,before.at+3600000);
});
test('god mode suppresses needs penalties and crafting exhaustion at the decision point',()=>{
  const r=setup();const before=r.api.effects(10,r.api.read(10));assert.ok(Object.values(before).some(v=>v<0));
  assert.equal(r.api.tooTiredToCraft(10),true);r.god(true);
  assert.equal(Object.keys(r.api.effects(10,r.api.read(10))).length,0);
  assert.equal(r.api.tooTiredToCraft(10),false);assert.equal(r.api.craftRefusal(10),'');
});
test('leaving god mode restores normal penalties and only new elapsed drain',()=>{
  const r=setup();r.god(true);r.advance(3600000);r.api.settle(10);r.god(false);
  const before=r.api.settle(10);assert.equal(before.food,12);
  assert.ok(Object.values(r.api.effects(10,before)).some(v=>v<0));
  r.advance(60000);const after=r.api.settle(10);assert.ok(after.food<12&&after.food>10);
});
test('work in god mode does not spend the saved Rest value',()=>{
  const r=setup();r.god(true);r.api.worked(10,'mine');assert.equal(r.api.read(10).rest,3);
});
test('clear effects removes source intoxication while retaining needs and unrelated states',()=>{
  const r=setup(),n=r.store.get(10);
  Object.assign(n,{ale:5,aleAt:1000000000000,aleHelpUntil:1000000100000,drunk:true,
    drugUntil:1000000100000,drugCrash:3,drugged:true,doses:[999999999999],withdrawalUntil:1000000100000,
    hangoverUntil:1000000100000,look:'high',teaUntil:1000000100000,teaCrash:1});
  r.api.clearIntoxication(10);const after=r.api.read(10);
  for(const key of ['ale','aleHelpUntil','drugUntil','drugCrash','withdrawalUntil','hangoverUntil'])assert.equal(after[key],0);
  assert.equal(after.drunk,false);assert.equal(after.drugged,false);assert.equal(after.doses.length,0);
  assert.equal(after.look,'');assert.equal(after.teaUntil,n.teaUntil);assert.equal(after.teaCrash,1);
  for(const key of ['food','drink','rest','temp'])assert.equal(after[key],n[key]);
});
test('failed clear effects writes report failure and preserve the stored source',()=>{
  const r=setup();r.store.get(10).ale=5;r.fail(true);
  assert.throws(()=>r.api.clearIntoxication(10));assert.equal(r.store.get(10).ale,5);
});
test('a refused pause-clock save is observable and preserves the saved meters',()=>{
  const r=setup(),before=JSON.stringify(r.store.get(10));
  r.god(true);r.advance(60000);r.fail(true);
  assert.throws(()=>r.api.settle(10),/paused needs clock.*saved/i);
  assert.equal(JSON.stringify(r.store.get(10)),before);
});
console.log(checks+' needs checks passed');
