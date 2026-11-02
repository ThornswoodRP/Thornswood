'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const file=path.join(__dirname,'test-1621-quest-state.js'),fixture=fs.readFileSync(file,'utf8');
const realm={require:createRequire(file),__dirname,console:{log(){}},Buffer};
vm.runInNewContext(fixture.slice(0,fixture.indexOf('let w = boot();'))+
 ';this.h={boot,form,have,fault,clock,reset(){forms={};}};',realm);
const h=realm.h,doc=require('../game/data/merchant-scarce-geodes.json'),item=doc.sources[0].item;
const refs=doc.sources.map(row=>parseInt(row.reference,16));
const gm=require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname,'../game/gamemode.js'),'utf8'));
const interception=Array.from(gm.matchAll(/\[(0x[0-9a-f, x]+)\]\.includes\(refrId\)/g));
assert.ok(interception.some(hit=>JSON.stringify(hit[1].split(',').map(x=>Number(x)))===JSON.stringify(refs)),'activation intercepts the six static sources');

function setup() {
 h.reset();h.fault.write=false;h.clock.now=1000000;
 const deadlines=new Map();let sourceGood=true,standing='novice',classRefusal=null,credit=0,normalGrants=0,takes=0;
 const stock={left:ref=>Math.max(0,(deadlines.get(ref)||0)-h.clock.now),take(ref,span,grant){takes++;
  const waitMs=this.left(ref);if(waitMs)return {ok:false,waitMs};
  const before=deadlines.get(ref)||0;deadlines.set(ref,h.clock.now+span);
  if(grant()===false){deadlines.set(ref,before);return {ok:false,waitMs:0};}return {ok:true,waitMs:0};
 }};
 const into=h.boot().ctx;
 into.__beforeQuestStartup=ctx=>{
  const desc=ctx.mp.getDescFromId,resolve=ctx.mp.getIdFromDesc;
  ctx.mp.getIdFromDesc=d=>doc.sources.some(r=>r.reference===d)?parseInt(d,16):resolve(d);
  ctx.mp.getDescFromId=id=>refs.includes(id)?doc.sources[refs.indexOf(id)].reference:
   id===7000?'1e7d6:Skyrim.esm':id===7001?'1a672:Skyrim.esm':desc(id);
  ctx.MERCHANT_TRADING.scarceGeodes=()=>JSON.parse(JSON.stringify(doc));
  ctx.MERCHANT_TRADING.createQuestGeodeSources=()=>({verify:(actor,ref)=>sourceGood&&refs.includes(ref)});
  ctx.__thornswoodResourceStock=stock;
  ctx.__thornswoodMerchantTrade.questRole=()=> 'Enchanter';
  ctx.__thornswoodMerchantTrade.questHold=()=> 'Winterhold';
  ctx.__questRankRead=()=>({v:1,cls:'warrior',prof:'enchanter',ranks:{bladebinder:standing}});
  ctx.classGate=()=>classRefusal;ctx.toolGate=()=>classRefusal;
  ctx.plantAt=()=>({produce:item,name:'Empty Petty Soul Gem',rank:''});
  ctx.RANK_LADDER=['novice','advanced','expert','master'];ctx.rankStep=()=>0;ctx.rankWord=v=>v;
 };
 const w=h.boot(into),gm=require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname,'../game/gamemode.js'),'utf8'));
 const at=gm.indexOf('function drawGeode(actorId');assert.ok(at>=0,'the actual geode interaction must exist');const end=gm.indexOf('\n}',at)+2;
 const helper=gm.indexOf('function _unusedGeodeHelper(');
 if(helper>=0)vm.runInContext(gm.slice(helper,gm.indexOf('\n}',helper)+2),w.ctx);
 Object.assign(w.ctx,{isCrop:()=>false,lastUse:new Map(),HARVEST_COOLDOWN_MS:1800000,
  stampCooldown(){},creditWork:()=>{credit++;return '';},addItem:()=>{normalGrants++;return true;}});
 vm.runInContext(gm.slice(at,end),w.ctx);
 return {w,stock,deadlines,pick:(ref=refs[0],base=doc.sources[0].base)=>w.ctx.drawGeode(500,ref,base),
  take:()=>w.svc.act(500,'take','geode',null,7000),source:v=>{sourceGood=v;},
  standing:v=>{standing=v;},refusal:v=>{classRefusal=v;},counts:()=>({credit,normalGrants}),takes:()=>takes};
}
{
 const s=setup();assert.match(s.pick(),/Take.*geode/i);assert.equal(s.counts().normalGrants,0);
 assert.equal(s.w.svc.act(500,'take','geode',null,7001).ok,false,'another Alchemist cannot repeat the offer');
 assert.equal(s.take().ok,true);s.refusal('An Enchanter tool is needed.');assert.match(s.pick(),/Enchanter/);
 s.refusal(null);s.standing('invalid');assert.match(s.pick(),/Enchanter|unavailable/);s.standing('novice');
 const standingRead=s.w.ctx.__questRankRead;
 s.w.ctx.__questRankRead=()=>({v:1,cls:'miner',prof:'smith',ranks:{edgewright:'master'}});
 assert.match(s.pick(),/Enchanter|unavailable/,'actual saved class is rechecked even when the ordinary class callback permits');
 assert.equal(h.have(500,item),0);assert.equal(s.stock.left(refs[0]),0);s.w.ctx.__questRankRead=standingRead;
 for(const ref of refs)assert.match(s.pick(ref),/Empty Petty Soul Gem/);
 assert.equal(h.have(500,item),6);h.clock.now+=1800000;assert.match(s.pick(),/all six/);
 assert.deepEqual(s.counts(),{credit:0,normalGrants:0});
 assert.equal(s.w.svc.act(500,'return','geode',null,7000).ok,true);assert.equal(h.have(500,item),4);
 assert.equal(h.form(500).props.thornswoodQuests.cool.geode,h.clock.now+12*3600000);
}
{
 const s=setup();assert.equal(s.take().ok,true);assert.match(s.pick(),/Empty Petty Soul Gem/);
 assert.match(s.pick(),/already.*worked/);assert.equal(h.have(500,item),1);
 assert.equal(s.w.svc.act(500,'abandon','geode',null,7000).ok,true);assert.equal(h.have(500,item),0);
 assert.equal(h.form(500).props.thornswoodQuests.cool.geode,undefined);assert.equal(s.take().ok,true);
 assert.match(s.pick(),/already.*worked/,'abandoning does not refill shared source stock');
}
{
 const s=setup();assert.equal(s.take().ok,true);s.source(false);assert.match(s.pick(),/unavailable|closer/);
 assert.equal(h.have(500,item),0);s.source(true);h.fault.write=true;assert.match(s.pick(),/unavailable/);
 assert.equal(h.have(500,item),0);assert.equal(s.stock.left(refs[0]),0);h.fault.write=false;
 s.w.ctx.__thornswoodQuests=null;assert.match(s.pick(),/unavailable/);assert.match(s.pick(refs[0],'other:Skyrim.esm'),/unavailable/);
 assert.equal(s.counts().normalGrants,0);
 s.w.ctx.MERCHANT_TRADING.scarceGeodes=()=>{throw new Error('unavailable source data');};
 s.w.ctx.mp.getDescFromId=()=>{throw new Error('unavailable descriptions');};
 assert.match(s.pick(999999),/unavailable/);assert.equal(s.counts().normalGrants,0,'direct nonselected geode calls cannot create goods');
 const hook=require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname,'../game/gamemode.js'),'utf8')).match(/^mp\.onActivate = guard\('onActivate',[\s\S]*?^\}\);/m)[0];
 const get=s.w.ctx.mp.get;s.w.ctx.mp.get=(id,key)=>refs.includes(id)&&key==='baseDesc'?'other:Skyrim.esm':get(id,key);
 s.w.ctx.guard=(name,fn)=>fn;s.w.ctx.notify=()=>{};vm.runInContext(hook,s.w.ctx);
 assert.equal(s.w.ctx.mp.onActivate(refs[0],500),false,'selected source stays intercepted with failed service and substituted base');
 assert.equal(s.counts().normalGrants,0);
 s.w.ctx.mp.get=()=>{throw new Error('native source lookup failed');};
 assert.equal(s.w.ctx.mp.onActivate(refs[0],500),false,'selected reference stays intercepted when native lookup throws');
 assert.equal(s.w.ctx.mp.onActivate(refs[0],0),false,'selected reference also refuses an absent activating actor');
 s.w.ctx.mp.get=(id,key)=>key==='baseDesc'?doc.sources[0].base:get(id,key);
 s.w.ctx.notify=()=>{throw new Error('notification failed');};
 assert.equal(s.w.ctx.mp.onActivate(refs[0],500),false,'a failed notification cannot permit native activation');
}
{
 const s=setup();assert.equal(s.take().ok,true);let changed=false;
 s.w.ctx.__questRankRead=()=>{if(!changed){changed=true;h.form(500).props.thornswoodQuests.open.geode.drawn=6;}
  return {v:1,cls:'warrior',prof:'enchanter',ranks:{bladebinder:'novice'}};};
 assert.match(s.pick(),/unavailable/);assert.equal(h.have(500,item),0);
 assert.equal(h.form(500).props.thornswoodQuests.open.geode.drawn,6);assert.equal(s.stock.left(refs[0]),0);
}
console.log('PASS geode actual harvesting, exact merchant, class, bounds, shared stock, cap, extras, abandon and zero-write refusals');

{
 const s=setup();assert.equal(s.take().ok,true);let reads=0;
 s.w.ctx.__questRankRead=()=>++reads===1?{v:1,cls:'warrior',prof:'enchanter',ranks:{bladebinder:'novice'}}:{v:1,cls:'miner',ranks:{miner:'master'}};
 assert.match(s.pick(),/unavailable/);assert.ok(reads>=2);assert.equal(h.have(500,item),0);
 assert.equal(h.form(500).props.thornswoodQuests.open.geode.drawn,0);assert.equal(s.stock.left(refs[0]),0);
}

{
 const s=setup();assert.equal(s.take().ok,true);let runtime='100';
 s.w.ctx.__runtimeIdentityApi={getActorRuntimeIdentity:()=>runtime,getDescFromId:()=> 'ff0001f4:Skyrim.esm',
  getNpcAIState:()=>({isHuman:true,profileId:500,lifeGeneration:0})};
 s.w.ctx.__questRankRead=()=>{runtime='101';return {v:1,cls:'warrior',prof:'enchanter',ranks:{bladebinder:'novice'}};};
 assert.match(s.pick(),/unavailable|Enchanter/);assert.equal(h.have(500,item),0);assert.equal(s.stock.left(refs[0]),0);
 assert.equal(h.form(500).props.thornswoodQuests.open.geode.drawn,0,'a replaced native actor session cannot receive the draw');
 assert.equal(s.takes(),0,'native actor replacement is rejected before source reservation');
}

{
 const s=setup();assert.equal(s.take().ok,true);
 const hook=require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname,'../game/gamemode.js'),'utf8')).match(/^mp\.onActivate = guard\('onActivate',[\s\S]*?^\}\);/m)[0];
 const get=s.w.ctx.mp.get;s.w.ctx.mp.get=(id,key)=>key==='baseDesc'?doc.sources[0].base:get(id,key);
 let toast='',ordinary=0;s.w.ctx.guard=(name,fn)=>fn;s.w.ctx.notify=(actor,line)=>{toast=line;};
 s.w.ctx.__thornswoodProperty={boardActivated(ref){if(ref===999999){ordinary++;return true;}return false;}};
 vm.runInContext(hook,s.w.ctx);
 assert.equal(s.w.ctx.mp.onActivate(refs[0],500),false);assert.match(toast,/Empty Petty Soul Gem/);
 assert.equal(h.have(500,item),1);assert.equal(s.takes(),1);
 assert.equal(s.w.ctx.mp.onActivate(999999,500),false);assert.equal(ordinary,1,'ordinary references reach their existing handler');
 assert.equal(h.have(500,item),1);assert.equal(s.takes(),1,'ordinary activation makes no quest reservation');
}
