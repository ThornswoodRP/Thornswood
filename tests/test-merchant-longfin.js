'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const file=path.join(__dirname,'test-1621-quest-state.js'),fixture=fs.readFileSync(file,'utf8');
const realm={require:createRequire(file),__dirname,console:{log(){}},Buffer};
vm.runInNewContext(fixture.slice(0,fixture.indexOf('let w = boot();'))+
 ';this.h={boot,form,have,fault,clock,reset(){forms={};}};',realm);
const h=realm.h,doc=require('../scripts/dev/MerchantScarceLongfinSources').longfinSources(require('../game/data/quest-content.json')),item=doc.sources[0].item;
function setup() {
 h.reset();h.fault.write=false;h.clock.now=1000000;
 const deadlines=new Map();let sourceGood=true,standing='master',tool=null,credit=0,worn=0,normalGrants=0;
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
  ctx.mp.getDescFromId=id=>id>=6000&&id<=6007?doc.sources[id-6000].reference:id===7000?'198d2:Skyrim.esm':
    id===7001?'1a672:Skyrim.esm':desc(id);
  ctx.MERCHANT_TRADING.scarceLongfin=()=>JSON.parse(JSON.stringify(doc));
  ctx.MERCHANT_TRADING.createQuestLongfinSources=()=>({verify:(actor,ref)=>sourceGood&&ref===6000});
  ctx.__thornswoodResourceStock=stock;
  ctx.__thornswoodMerchantTrade.questRole=()=> 'Alchemist';
  ctx.__thornswoodMerchantTrade.questHold=()=> 'Haafingar';
  ctx.__questRankRead=()=>({v:1,cls:'fisher',ranks:{fisher:standing}});
  ctx.toolGate=()=>tool;ctx.poleTooWeak=()=>null;
 };
 const w=h.boot(into),gm=require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname,'../game/gamemode.js'),'utf8'));
 const at=gm.indexOf('function fish(actorId'),end=gm.indexOf('\n}',at)+2;
 Object.assign(w.ctx,{isFish:()=>true,FISH_BY_BASE:{[doc.sources[0].base]:{produce:item,name:'Abecean Longfin',from:'Longfin Water',rank:'master'}},
  withinResourceReach:()=>true,FISH_TUNING:{cooldownMs:{master:14400000},yieldByStep:{2:[3,3]}},
  RANK_LADDER:['novice','advanced','master','master'],rankStep:()=>standing==='master'?2:0,rankWord:v=>v,
  waitWord:v=>String(v),randInt:()=>3,addItemsAtomic:()=>{normalGrants++;return true;},
  creditWork:()=>{credit++;return '';},wearTool:()=>{worn++;return '';}});
 vm.runInContext(gm.slice(at,end),w.ctx);
 const fish=()=>w.ctx.fish(500,6000,doc.sources[0].base),take=()=>w.svc.act(500,'take','longfin',null,7000);
 return {w,fish,take,deadlines,stock,standing:v=>{standing=v;},tool:v=>{tool=v;},
  source:v=>{sourceGood=v;},counts:()=>({credit,worn,normalGrants})};
}
{
 const s=setup();assert.match(s.fish(),/longfin work/);assert.equal(h.have(500,item),0);
 assert.equal(s.w.svc.act(500,'take','longfin',null,7001).ok,false,'another hold cannot repeat the new offer');
 assert.equal(s.take().ok,true);
 s.tool('A pole is needed.');assert.match(s.fish(),/pole/);assert.equal(h.have(500,item),0);s.tool(null);
 s.w.ctx.poleTooWeak=()=> 'A stronger pole is needed.';assert.match(s.fish(),/stronger pole/);
 s.w.ctx.poleTooWeak=()=>null;
 s.standing('novice');assert.match(s.fish(),/Master|master/);s.standing('master');
 assert.match(s.fish(),/1 Abecean Longfin/);assert.equal(h.have(500,item),1);
 assert.match(s.fish(),/fished out/);assert.equal(h.have(500,item),1);
 for(let n=0;n<7;n++){h.clock.now+=14400000;assert.match(s.fish(),/1 Abecean Longfin/);}
 h.clock.now+=14400000;assert.match(s.fish(),/all eight fish/);assert.equal(h.have(500,item),8);
 assert.deepEqual(s.counts(),{credit:8,worn:8,normalGrants:0});
 assert.equal(s.w.svc.act(500,'return','longfin',null,7000).ok,true);assert.equal(h.have(500,item),6,'completion keeps the extra six');
 assert.equal(h.form(500).props.thornswoodQuests.cool.longfin,h.clock.now+12*3600000);
}
{
 const s=setup();assert.equal(s.take().ok,true);assert.match(s.fish(),/1 Abecean Longfin/);
 assert.equal(s.w.svc.act(500,'abandon','longfin',null,7000).ok,true);assert.equal(h.have(500,item),0);
 assert.equal(h.form(500).props.thornswoodQuests.cool.longfin,undefined);assert.equal(s.take().ok,true);
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
  if(!changed){changed=true;h.form(500).props.thornswoodQuests.open.longfin.drawn=8;}
  return {v:1,cls:'fisher',ranks:{fisher:'master'}};
 };
 assert.match(s.fish(),/unavailable/);assert.equal(h.have(500,item),0);
 assert.equal(h.form(500).props.thornswoodQuests.open.longfin.drawn,8,'a concurrent draw cannot be overwritten');
 assert.equal(s.stock.left(6000),0);assert.equal(s.counts().normalGrants,0);
}
{
 const s=setup(),other='108e35:Skyrim.esm';
 s.w.ctx.FISH_BY_BASE[other]={produce:'a:Skyrim.esm',name:'Salmon',from:'Salmon',rank:'master'};
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
console.log('PASS longfin actual fishing path: appointed Alchemist, Master rank/pole, shared wait, cap, extras, abandon and failed writes');

{
 const s=setup();s.w.ctx.__thornswoodQuests=null;
 assert.match(s.fish(),/unavailable/);assert.equal(h.have(500,item),0);
 assert.equal(s.counts().normalGrants,0,'longfin cannot turn ordinary when the controller is missing');
}

{
 const s=setup();assert.equal(s.take().ok,true);
 const hook=require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname,'../game/gamemode.js'),'utf8')).match(/^mp\.onActivate = guard\('onActivate',[\s\S]*?^\}\);/m)[0];
 s.w.ctx.guard=(name,fn)=>fn;s.w.ctx.notify=()=>{};vm.runInContext(hook,s.w.ctx);
 s.w.ctx.mp.get=()=>{throw new Error('native lookup unavailable');};
 assert.equal(s.w.ctx.mp.onActivate(6000,500),false,'a registered longfin cannot fall through a failed native query');
 assert.equal(s.w.ctx.mp.onActivate(6000,0),false,'a registered longfin cannot fall through with no actor');
 assert.equal(h.have(500,item),0);
}

{
 const s=setup();assert.equal(s.take().ok,true);
 const hook=require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname,'../game/gamemode.js'),'utf8')).match(/^mp\.onActivate = guard\('onActivate',[\s\S]*?^\}\);/m)[0];
 const get=s.w.ctx.mp.get;s.w.ctx.mp.get=(id,key)=>id===6000&&key==='baseDesc'?doc.sources[0].base:get(id,key);
 let toast='',ordinary=0;s.w.ctx.guard=(name,fn)=>fn;s.w.ctx.notify=(actor,line)=>{toast=line;};
 s.w.ctx.__thornswoodProperty={boardActivated(ref){if(ref===999999){ordinary++;return true;}return false;}};
 vm.runInContext(hook,s.w.ctx);
 assert.equal(s.w.ctx.mp.onActivate(6000,500),false);assert.match(toast,/1 Abecean Longfin/);assert.equal(h.have(500,item),1);
 s.w.ctx.notify=()=>{throw new Error('notification unavailable');};
 assert.equal(s.w.ctx.mp.onActivate(6000,500),false);assert.equal(h.have(500,item),1);
 assert.equal(s.w.ctx.mp.onActivate(999999,500),false);assert.equal(ordinary,1);assert.equal(h.have(500,item),1);
}
{
 const s=setup();assert.equal(s.take().ok,true);let runtime='100';
 s.w.ctx.__runtimeIdentityApi={getActorRuntimeIdentity:()=>runtime,getDescFromId:()=> 'ff0001f4:Skyrim.esm',
  getNpcAIState:()=>({isHuman:true,profileId:500,lifeGeneration:0})};
 s.w.ctx.__questRankRead=()=>{runtime='101';return {v:1,cls:'fisher',ranks:{fisher:'master'}};};
 assert.match(s.fish(),/unavailable|Master/);assert.equal(h.have(500,item),0);assert.equal(s.stock.left(6000),0);
 assert.equal(h.form(500).props.thornswoodQuests.open.longfin.drawn,0);
}
