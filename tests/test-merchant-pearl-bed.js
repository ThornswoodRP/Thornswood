'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const file=path.join(__dirname,'test-1621-quest-state.js'),fixture=fs.readFileSync(file,'utf8');
const realm={require:createRequire(file),__dirname,console:{log(){}},Buffer};
vm.runInNewContext(fixture.slice(0,fixture.indexOf('let w = boot();'))+
 ';this.h={boot,form,have,fault,clock,reset(){forms={};}};',realm);
const h=realm.h,doc=require('../game/data/merchant-scarce-fishing.json'),item=doc.sources[0].item;
function setup() {
 h.reset();h.fault.write=false;h.clock.now=1000000;
 const deadlines=new Map();let sourceGood=true,standing='expert',tool=null,credit=0,worn=0,normalGrants=0;
 const stock={left:ref=>Math.max(0,(deadlines.get(ref)||0)-h.clock.now),take(ref,span,grant){
  const waitMs=this.left(ref);if(waitMs)return {ok:false,waitMs};
  const before=deadlines.get(ref)||0;deadlines.set(ref,h.clock.now+span);
  if(grant()===false){deadlines.set(ref,before);return {ok:false,waitMs:0};}return {ok:true,waitMs:0};
 }};
 const into=h.boot().ctx;
 into.__beforeQuestStartup=ctx=>{
  const desc=ctx.mp.getDescFromId;
  const resolve=ctx.mp.getIdFromDesc;
  ctx.mp.getIdFromDesc=description=>{const n=doc.sources.findIndex(r=>r.reference===description);return n>=0?6000+n:resolve(description);};
  ctx.mp.getDescFromId=id=>id>=6000&&id<=6002?doc.sources[id-6000].reference:id===7000?'177da:Dragonborn.esm':
    id===7001?'1a672:Skyrim.esm':desc(id);
  ctx.MERCHANT_TRADING.scarceFishing=()=>JSON.parse(JSON.stringify(doc));
  ctx.MERCHANT_TRADING.createQuestFishingSources=()=>({verify:(actor,ref)=>sourceGood&&ref===6000});
  ctx.__thornswoodResourceStock=stock;
  ctx.__thornswoodMerchantTrade.questRole=()=> 'Enchanter';
  ctx.__thornswoodMerchantTrade.questHold=()=> 'Solstheim';
  ctx.__questRankRead=()=>({v:1,cls:'fisher',ranks:{fisher:standing}});
  ctx.toolGate=()=>tool;ctx.poleTooWeak=()=>null;
 };
 const w=h.boot(into),gm=require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname,'../game/gamemode.js'),'utf8'));
 const at=gm.indexOf('function fish(actorId'),end=gm.indexOf('\n}',at)+2;
 Object.assign(w.ctx,{isFish:()=>true,FISH_BY_BASE:{[doc.sources[0].base]:{produce:item,name:'Pearl',from:'Pearl Oyster',rank:'expert'}},
  withinResourceReach:()=>true,FISH_TUNING:{cooldownMs:{expert:3600000},yieldByStep:{2:[3,3]}},
  RANK_LADDER:['novice','advanced','expert','master'],rankStep:()=>standing==='expert'?2:0,rankWord:v=>v,
  waitWord:v=>String(v),randInt:()=>3,addItemsAtomic:()=>{normalGrants++;return true;},
  creditWork:()=>{credit++;return '';},economyGathered:()=>{},wearTool:()=>{worn++;return '';}});
 vm.runInContext(gm.slice(at,end),w.ctx);
 const fish=()=>w.ctx.fish(500,6000,doc.sources[0].base),take=()=>w.svc.act(500,'take','pearl',null,7000);
 return {w,fish,take,deadlines,stock,standing:v=>{standing=v;},tool:v=>{tool=v;},
  source:v=>{sourceGood=v;},counts:()=>({credit,worn,normalGrants})};
}
{
 const s=setup();assert.match(s.fish(),/pearl-bed work/);assert.equal(h.have(500,item),0);
 assert.equal(s.w.svc.act(500,'take','pearl',null,7001).ok,false,'another hold cannot repeat the new offer');
 assert.equal(s.take().ok,true);
 s.tool('A pole is needed.');assert.match(s.fish(),/pole/);assert.equal(h.have(500,item),0);s.tool(null);
 s.w.ctx.poleTooWeak=()=> 'A stronger pole is needed.';assert.match(s.fish(),/stronger pole/);
 s.w.ctx.poleTooWeak=()=>null;
 s.standing('novice');assert.match(s.fish(),/Expert|expert/);s.standing('expert');
 assert.match(s.fish(),/1 Pearl/);assert.equal(h.have(500,item),1);
 assert.match(s.fish(),/fished out/);assert.equal(h.have(500,item),1);
 for(let n=0;n<2;n++){h.clock.now+=3600000;assert.match(s.fish(),/1 Pearl/);}
 h.clock.now+=3600000;assert.match(s.fish(),/all three pearls/);assert.equal(h.have(500,item),3);
 assert.deepEqual(s.counts(),{credit:3,worn:3,normalGrants:0});
 assert.equal(s.w.svc.act(500,'return','pearl',null,7000).ok,true);assert.equal(h.have(500,item),2,'completion keeps the extra two');
 assert.equal(h.form(500).props.thornswoodQuests.cool.pearl,h.clock.now+8*3600000);
}
{
 const s=setup();assert.equal(s.take().ok,true);assert.match(s.fish(),/1 Pearl/);
 assert.equal(s.w.svc.act(500,'abandon','pearl',null,7000).ok,true);assert.equal(h.have(500,item),0);
 assert.equal(h.form(500).props.thornswoodQuests.cool.pearl,undefined);assert.equal(s.take().ok,true);
}
{
 const s=setup();assert.equal(s.take().ok,true);s.source(false);assert.match(s.fish(),/closer approach/);
 assert.equal(h.have(500,item),0);s.source(true);h.fault.write=true;assert.match(s.fish(),/unavailable/);
 assert.equal(h.have(500,item),0);assert.equal(s.stock.left(6000),0);h.fault.write=false;
 s.w.ctx.__thornswoodQuests=null;assert.match(s.fish(),/unavailable/);assert.equal(s.counts().normalGrants,0);
}
{
 const s=setup();assert.equal(s.take().ok,true);let changed=false;
 s.w.ctx.__questRankRead=()=>{
  if(!changed){changed=true;h.form(500).props.thornswoodQuests.open.pearl.drawn=3;}
  return {v:1,cls:'fisher',ranks:{fisher:'expert'}};
 };
 assert.match(s.fish(),/unavailable/);assert.equal(h.have(500,item),0);
 assert.equal(h.form(500).props.thornswoodQuests.open.pearl.drawn,3,'a concurrent draw cannot be overwritten');
 assert.equal(s.stock.left(6000),0);assert.equal(s.counts().normalGrants,0);
}
{
 const s=setup(),other='108e35:Skyrim.esm';
 s.w.ctx.FISH_BY_BASE[other]={produce:'a:Skyrim.esm',name:'Salmon',from:'Salmon',rank:'expert'};
 assert.match(s.w.ctx.fish(500,6000,other),/unavailable/);
 assert.equal(s.counts().normalGrants,0,'another fish base cannot bypass a selected reference');
 const gm=require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname,'../game/gamemode.js'),'utf8'));
 const hook=gm.match(/^mp\.onActivate = guard\('onActivate',[\s\S]*?^\}\);/m)[0];
 const get=s.w.ctx.mp.get;s.w.ctx.mp.get=(id,key)=>id===6000&&key==='baseDesc'?'other:Skyrim.esm':get(id,key);
 s.w.ctx.guard=(name,fn)=>fn;s.w.ctx.notify=()=>{};
 vm.runInContext(hook,s.w.ctx);
 assert.equal(s.w.ctx.mp.onActivate(6000,500),false,'a non-fishing replacement base is blocked before ordinary activation');
 assert.equal(s.counts().normalGrants,0);
}
console.log('PASS pearl-bed actual fishing path: exact new offer, rank/pole, shared stock, personal draw cap, extra goods, abandon and failed writes');

{
 const s=setup(),ordinary=6005;
 s.w.ctx.MERCHANT_TRADING.scarceFishing=()=>{throw new Error('source service unavailable');};
 s.w.ctx.mp.getDescFromId=()=>{throw new Error('source lookup unavailable');};
 assert.match(s.w.ctx.fish(500,ordinary,doc.sources[0].base),/3 Pearl/);
 assert.equal(s.counts().normalGrants,1,'ordinary sources do not depend on the quest service');
 s.w.ctx.__thornswoodQuests=null;assert.match(s.fish(),/unavailable/);
 assert.equal(s.counts().normalGrants,1,'selected sources remain shut');
 s.deadlines.delete(ordinary);
 s.stock.take=()=>{throw new Error('ordinary stock failure');};
 assert.throws(()=>s.w.ctx.fish(500,ordinary,doc.sources[0].base),/ordinary stock failure/);
}
