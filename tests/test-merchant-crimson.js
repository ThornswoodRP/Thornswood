'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const file=path.join(__dirname,'test-1621-quest-state.js'),fixture=fs.readFileSync(file,'utf8');
const realm={require:createRequire(file),__dirname,console:{log(){}},Buffer};
vm.runInNewContext(fixture.slice(0,fixture.indexOf('let w = boot();'))+
 ';this.h={boot,form,have,fault,clock,reset(){forms={};}};',realm);
const h=realm.h,doc=require('../game/data/merchant-scarce-harvest.json'),item=doc.sources[0].item;
const refs=doc.sources.map(row=>parseInt(row.reference,16));
const gm=require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname,'../game/gamemode.js'),'utf8'));
const interception=Array.from(gm.matchAll(/\[(0x[0-9a-f, x]+)\]\.includes\(refrId\)/g)).filter(hit=>hit[1].split(',').length===8);
assert.equal(interception.length,2,'activation and direct harvesting both intercept the eight static sources');
for(const hit of interception)assert.deepEqual(hit[1].split(',').map(x=>Number(x)),refs);

function setup() {
 h.reset();h.fault.write=false;h.clock.now=1000000;
 const deadlines=new Map();let sourceGood=true,standing='novice',classRefusal=null,credit=0,normalGrants=0;
 const stock={left:ref=>Math.max(0,(deadlines.get(ref)||0)-h.clock.now),take(ref,span,grant){
  const waitMs=this.left(ref);if(waitMs)return {ok:false,waitMs};
  const before=deadlines.get(ref)||0;deadlines.set(ref,h.clock.now+span);
  if(grant()===false){deadlines.set(ref,before);return {ok:false,waitMs:0};}return {ok:true,waitMs:0};
 }};
 const into=h.boot().ctx;
 into.__beforeQuestStartup=ctx=>{
  const desc=ctx.mp.getDescFromId,resolve=ctx.mp.getIdFromDesc;
  ctx.mp.getIdFromDesc=d=>doc.sources.some(r=>r.reference===d)?parseInt(d,16):resolve(d);
  ctx.mp.getDescFromId=id=>refs.includes(id)?doc.sources[refs.indexOf(id)].reference:
   id===7000?'1c1aa:Skyrim.esm':id===7001?'1a6b5:Skyrim.esm':desc(id);
  ctx.MERCHANT_TRADING.scarceHarvest=()=>JSON.parse(JSON.stringify(doc));
  ctx.MERCHANT_TRADING.createQuestHarvestSources=()=>({verify:(actor,ref)=>sourceGood&&refs.includes(ref)});
  ctx.__thornswoodResourceStock=stock;
  ctx.__thornswoodMerchantTrade.questRole=()=> 'Alchemist';
  ctx.__thornswoodMerchantTrade.questHold=()=> 'Winterhold';
  ctx.__questRankRead=()=>({v:1,cls:'gatherer',ranks:{gatherer:standing}});
  ctx.classGate=()=>classRefusal;
  ctx.plantAt=()=>({produce:item,name:'Crimson Nirnroot',rank:''});
  ctx.RANK_LADDER=['novice','advanced','expert','master'];ctx.rankStep=()=>0;ctx.rankWord=v=>v;
 };
 const w=h.boot(into),gm=require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname,'../game/gamemode.js'),'utf8'));
 const at=gm.indexOf('function harvest(actorId'),end=gm.indexOf('\n}',at)+2;
 const helper=gm.indexOf('function harvestCrimson(');
 if(helper>=0)vm.runInContext(gm.slice(helper,gm.indexOf('\n}',helper)+2),w.ctx);
 Object.assign(w.ctx,{isCrop:()=>false,lastUse:new Map(),HARVEST_COOLDOWN_MS:600000,
  stampCooldown(){},creditWork:()=>{credit++;return '';},economyGathered:()=>{},addItem:()=>{normalGrants++;return true;},
  outOfSeason:()=>''});
 vm.runInContext(gm.slice(at,end),w.ctx);
 return {w,stock,deadlines,pick:(ref=refs[0],base=doc.sources[0].base)=>w.ctx.harvest(500,ref,base),
  take:()=>w.svc.act(500,'take','crimson',null,7000),source:v=>{sourceGood=v;},
  standing:v=>{standing=v;},refusal:v=>{classRefusal=v;},counts:()=>({credit,normalGrants})};
}
{
 const s=setup();assert.match(s.pick(),/Take.*crimson/i);assert.equal(s.counts().normalGrants,0);
 assert.equal(s.w.svc.act(500,'take','crimson',null,7001).ok,false,'another Alchemist cannot repeat the offer');
 assert.equal(s.take().ok,true);s.refusal('Only a Gatherer can pick this.');assert.match(s.pick(),/Gatherer/);
 s.refusal(null);s.standing('invalid');assert.match(s.pick(),/Gatherer|unavailable/);s.standing('novice');
 const standingRead=s.w.ctx.__questRankRead;
 s.w.ctx.__questRankRead=()=>({v:1,cls:'miner',ranks:{gatherer:'novice'}});
 assert.match(s.pick(),/Gatherer|unavailable/,'actual saved class is rechecked even when the ordinary class callback permits');
 assert.equal(h.have(500,item),0);assert.equal(s.stock.left(refs[0]),0);s.w.ctx.__questRankRead=standingRead;
 for(const ref of refs)assert.match(s.pick(ref),/Crimson Nirnroot/);
 assert.equal(h.have(500,item),8);h.clock.now+=600000;assert.match(s.pick(),/all eight/);
 assert.deepEqual(s.counts(),{credit:8,normalGrants:0});
 assert.equal(s.w.svc.act(500,'return','crimson',null,7000).ok,true);assert.equal(h.have(500,item),5);
 assert.equal(h.form(500).props.thornswoodQuests.cool.crimson,h.clock.now+12*3600000);
}
{
 const s=setup();assert.equal(s.take().ok,true);assert.match(s.pick(),/Crimson Nirnroot/);
 assert.match(s.pick(),/already.*picked/);assert.equal(h.have(500,item),1);
 assert.equal(s.w.svc.act(500,'abandon','crimson',null,7000).ok,true);assert.equal(h.have(500,item),0);
 assert.equal(h.form(500).props.thornswoodQuests.cool.crimson,undefined);assert.equal(s.take().ok,true);
 assert.match(s.pick(),/already.*picked/,'abandoning does not refill shared source stock');
}
{
 const s=setup();assert.equal(s.take().ok,true);s.source(false);assert.match(s.pick(),/unavailable|closer/);
 assert.equal(h.have(500,item),0);s.source(true);h.fault.write=true;assert.match(s.pick(),/unavailable/);
 assert.equal(h.have(500,item),0);assert.equal(s.stock.left(refs[0]),0);h.fault.write=false;
 s.w.ctx.__thornswoodQuests=null;assert.match(s.pick(),/unavailable/);assert.match(s.pick(refs[0],'other:Skyrim.esm'),/unavailable/);
 assert.equal(s.counts().normalGrants,0);
 s.w.ctx.MERCHANT_TRADING.scarceHarvest=()=>{throw new Error('unavailable source data');};
 s.w.ctx.mp.getDescFromId=()=>{throw new Error('unavailable descriptions');};
 assert.match(s.pick(999999),/You pick/);assert.equal(s.counts().normalGrants,1,'ordinary plants do not consult quest services');
 const hook=require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname,'../game/gamemode.js'),'utf8')).match(/^mp\.onActivate = guard\('onActivate',[\s\S]*?^\}\);/m)[0];
 const get=s.w.ctx.mp.get;s.w.ctx.mp.get=(id,key)=>refs.includes(id)&&key==='baseDesc'?'other:Skyrim.esm':get(id,key);
 s.w.ctx.guard=(name,fn)=>fn;s.w.ctx.notify=()=>{};vm.runInContext(hook,s.w.ctx);
 assert.equal(s.w.ctx.mp.onActivate(refs[0],500),false,'selected source stays intercepted with failed service and substituted base');
 assert.equal(s.counts().normalGrants,1);
 s.w.ctx.mp.get=()=>{throw new Error('native source lookup failed');};
 assert.equal(s.w.ctx.mp.onActivate(refs[0],500),false,'selected reference stays intercepted when native lookup throws');
 assert.equal(s.w.ctx.mp.onActivate(refs[0],0),false,'selected reference also refuses an absent activating actor');
 s.w.ctx.mp.get=(id,key)=>key==='baseDesc'?doc.sources[0].base:get(id,key);
 s.w.ctx.notify=()=>{throw new Error('notification failed');};
 assert.equal(s.w.ctx.mp.onActivate(refs[0],500),false,'a failed notification cannot permit native activation');
}
{
 const s=setup();assert.equal(s.take().ok,true);let changed=false;
 s.w.ctx.__questRankRead=()=>{if(!changed){changed=true;h.form(500).props.thornswoodQuests.open.crimson.drawn=8;}
  return {v:1,cls:'gatherer',ranks:{gatherer:'novice'}};};
 assert.match(s.pick(),/unavailable/);assert.equal(h.have(500,item),0);
 assert.equal(h.form(500).props.thornswoodQuests.open.crimson.drawn,8);assert.equal(s.stock.left(refs[0]),0);
}
console.log('PASS crimson actual harvesting, exact merchant, class, bounds, shared stock, cap, extras, abandon and zero-write refusals');

{
 const s=setup();assert.equal(s.take().ok,true);let reads=0;
 s.w.ctx.__questRankRead=()=>++reads===1?{v:1,cls:'gatherer',ranks:{gatherer:'novice'}}:{v:1,cls:'miner',ranks:{miner:'master'}};
 assert.match(s.pick(),/unavailable/);assert.ok(reads>=2);assert.equal(h.have(500,item),0);
 assert.equal(h.form(500).props.thornswoodQuests.open.crimson.drawn,0);assert.equal(s.stock.left(refs[0]),0);
}
