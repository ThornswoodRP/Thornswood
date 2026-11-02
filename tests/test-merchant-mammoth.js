'use strict';
const assert=require('node:assert/strict');
const {h}=require('./merchant-retrieval-fixture');
const bundles=require('../game/quest-hunt-bundles');
function setup(options={}) {
 h.reset();h.fault.write=false;h.clock.now=1000000;
 const into=h.boot().ctx,bodies=new Map(),stock=new Map();let rank='master',session=true,valid=true;
 const ids=[0x33fa6,0x846ea,0x846eb];ids.forEach((id,i)=>bodies.set(id,{ref:id.toString(16)+':Skyrim.esm',life:0,body:String(i+1)}));
 const sources={read:(actor,ref)=>valid&&bodies.has(ref)?{...bodies.get(ref)}:null,
  verify:(actor,ref,expected)=>valid&&JSON.stringify(bodies.get(ref))===JSON.stringify(expected)};
 into.__beforeQuestStartup=ctx=>{
  const desc=ctx.mp.getDescFromId;ctx.mp.getDescFromId=id=>id===7000?'1a66e:Skyrim.esm':id===7001?'3a198:Skyrim.esm':desc(id);
  ctx.MERCHANT_TRADING.createQuestMammothSources=()=>sources;ctx.MERCHANT_TRADING.huntBundles=bundles;
  if(options.unknown) {
   const create=ctx.MERCHANT_TRADING.createQuestTransactions;
   ctx.MERCHANT_TRADING.createQuestTransactions=function(...args){
    const tx=create(...args),commit=tx.commit;
    tx.commit=function(...input){const result=commit(...input);if(result.ok&&input[3].length){ctx.__revoked=true;return {ok:false};}return result;};
    return tx;
   };
  }
  ctx.__thornswoodResourceStock={dress(ref,grant,fence){
   if(!fence())return {ok:false};const key=JSON.stringify(bodies.get(ref));if(stock.has(key))return {ok:false};
   stock.set(key,true);if(grant()===false){stock.delete(key);return {ok:false};}return {ok:true};
  }};
  ctx.HUNTS_BY_BASE={'dd641:Skyrim.esm':{yield:[[0,0],[0,0],[0,0],[1,5]],gives:[{item:'3ad6c:Skyrim.esm'},{item:'669a4:Skyrim.esm'}]}};
  ctx.randInt=()=>2;
  ctx.__thornswoodMerchantTrade.questRole=()=> 'Cook';ctx.__thornswoodMerchantTrade.questAdmission=()=>()=>session;
  ctx.__questRankRead=()=>({v:1,cls:'hunter',ranks:{hunter:rank}});
 };
 let w=h.boot(into);
 return {get w(){return w;},restart(){h.clone();w=h.boot(into);},ids,bodies,stock,rank:v=>{rank=v;},session:v=>{session=v;},source:v=>{valid=v;},
  take:()=>w.svc.act(500,'take','mammoth',null,7000),
  draw:ref=>w.svc.dressMammoth(500,ref,'dd641:Skyrim.esm'),
  finish:()=>w.svc.act(500,'return','mammoth',null,7000),leave:()=>w.svc.act(500,'abandon','mammoth',null,7000)};
}
{
 const s=setup();s.rank('expert');assert.equal(s.take().ok,false);s.rank('master');assert.equal(s.take().ok,true);
 assert.equal(s.w.svc.act(500,'take','mammoth',null,7001).ok,false,'another Cook cannot duplicate the offer');
 for(const ref of s.ids)assert.equal(s.draw(ref).ok,true);assert.equal(s.draw(s.ids[0]).ok,false);
 assert.equal(h.have(500,'3ad6c:Skyrim.esm'),6);assert.equal(h.have(500,'669a4:Skyrim.esm'),6);
 assert.equal(s.finish().ok,true);assert.equal(h.have(500,'3ad6c:Skyrim.esm'),4);assert.equal(h.have(500,'669a4:Skyrim.esm'),4);
 assert.equal(h.have(500,'f:Skyrim.esm'),0);assert.equal(h.form(500).props.thornswoodQuests.cool.mammoth,h.clock.now+24*3600000);
}
{
 const s=setup();s.take();s.ids.forEach(ref=>s.draw(ref));assert.equal(s.leave().ok,true);
 assert.equal(h.have(500,'3ad6c:Skyrim.esm'),0);assert.equal(h.have(500,'669a4:Skyrim.esm'),0);
 assert.equal(h.form(500).props.thornswoodQuests.cool.mammoth,undefined);assert.equal(s.take().ok,true);
}
for(const stage of ['draw','return','abandon']) {
 const s=setup();s.take();if(stage!=='draw')s.draw(s.ids[0]);
 s.w.ctx.__beforeQuestCommit=()=>stage==='draw'?s.source(false):s.session(false);
 const result=stage==='draw'?s.draw(s.ids[0]):stage==='return'?s.finish():s.leave();
 assert.equal(result.ok,false,stage);assert.equal(h.have(500,'3ad6c:Skyrim.esm'),stage==='draw'?0:2);
 if(stage==='draw')assert.equal(s.stock.size,0,'definite refusal releases its own claim');
}
{
 const s=setup();s.take();s.draw(s.ids[0]);
 assert.equal(s.w.svc.act(501,'take','mammoth',null,7000).ok,true);
 assert.equal(s.w.svc.dressMammoth(501,s.ids[0],'dd641:Skyrim.esm').ok,false,'shared corpse cannot pay another character');
 s.bodies.set(s.ids[0],{ref:'33fa6:Skyrim.esm',life:1,body:'10'});
 assert.equal(s.w.svc.dressMammoth(501,s.ids[0],'dd641:Skyrim.esm').ok,true,'a respawn is a new native body');
}
{
 const s=setup();s.take();s.draw(s.ids[0]);s.restart();
 assert.equal(s.draw(s.ids[0]).ok,false,'restart retains the shared corpse claim');
 assert.equal(h.form(500).props.thornswoodQuests.open.mammoth.bundles.length,1);
 assert.equal(s.finish().ok,true);assert.equal(h.have(500,'3ad6c:Skyrim.esm'),0);
}
{
 const s=setup();s.take();h.fault.noAdd=['669a4:Skyrim.esm'];
 assert.equal(s.draw(s.ids[0]).ok,false);assert.equal(h.have(500,'3ad6c:Skyrim.esm'),0);
 assert.equal(h.have(500,'669a4:Skyrim.esm'),0);assert.equal(s.stock.size,0);h.fault.noAdd=[];
 assert.equal(s.draw(s.ids[0]).ok,true);
}
{
 const s=setup({unknown:true});s.take();assert.equal(s.draw(s.ids[0]).ok,false);
 assert.equal(h.have(500,'3ad6c:Skyrim.esm'),2);assert.equal(s.stock.size,1,'unknown outcome retains the corpse claim');
 assert.equal(s.draw(s.ids[0]).ok,false);assert.equal(h.have(500,'3ad6c:Skyrim.esm'),2,'revoked service cannot replay the grant');
}
{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),s=setup(),gm=require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname,'../game/gamemode.js'),'utf8'));
 const at=gm.indexOf('function loot(actorId'),end=gm.indexOf('\n}',at)+2;let credit=0;
 s.w.ctx.creditWork=()=>{credit++;return '';};vm.runInContext(gm.slice(at,end),s.w.ctx);
 s.take();assert.match(s.w.ctx.loot(500,s.ids[0],'dd641:Skyrim.esm'),/Mammoth Tusk/);assert.equal(credit,1);
 s.w.ctx.loot(500,s.ids[0],'dd641:Skyrim.esm');assert.equal(credit,1,'duplicate presses give no hunting credit');
 const hook=gm.match(/^mp\.onActivate = guard\('onActivate',[\s\S]*?^\}\);/m)[0];
 s.w.ctx.guard=(name,fn)=>fn;s.w.ctx.notify=()=>{};vm.runInContext(hook,s.w.ctx);
 s.w.ctx.__thornswoodQuests=null;
 assert.equal(s.w.ctx.mp.onActivate(s.ids[0],500),false);assert.equal(s.w.ctx.mp.onActivate(s.ids[0],0),false);
}
console.log('PASS mammoth Master gate, exact Cook, shared native bodies, atomic normal goods, cap/extras/abandon and final source/conversation checks');
