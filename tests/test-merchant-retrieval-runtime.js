'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {setup,h,data}=require('./merchant-retrieval-fixture');

for(const row of data.sources) {
 const s=setup();assert(s.w.svc.describe(500,s.id(row.merchant)).some(r=>r.id===row.quest&&r.canTake),row.quest+' panel');
 const wrong=data.sources.find(r=>r.role!==row.role).merchant;
 assert.equal(s.w.svc.act(500,'take',row.quest,null,s.id(wrong)).ok,false,'another role cannot offer '+row.quest);
 assert.equal(s.take(row).ok,true,row.quest+' take');assert.equal(h.have(500,row.item),0);
 assert.equal(s.pickup(row),'You take it.');assert.equal(h.have(500,row.item),1);
 assert.equal(s.pickup(row),'You already have this quest item.');assert.equal(h.have(500,row.item),1);
 assert.equal(s.finish(row).ok,true);assert.equal(h.have(500,row.item),0);
 assert.equal(h.have(500,'f:Skyrim.esm'),row.gold);assert.equal(h.form(500).props.thornswoodQuests.cool[row.quest],h.clock.now+row.hours*3600000);
 assert.equal(s.finish(row).ok,false);assert.equal(h.have(500,'f:Skyrim.esm'),row.gold);
}
{
 const s=setup(),row=data.sources[0],gm=require('./gamemode-tables.js').joined(fs.readFileSync(require('node:path').join(__dirname,'../game/gamemode.js'),'utf8'));
 const hook=gm.match(/^mp\.onActivate = guard\('onActivate',[\s\S]*?^\}\);/m)[0];
 s.w.ctx.guard=(name,fn)=>fn;s.w.ctx.notify=()=>{};vm.runInContext(hook,s.w.ctx);
 assert.equal(s.take(row).ok,true);assert.equal(s.w.ctx.mp.onActivate(s.id(row.reference),500),false);
 assert.equal(h.have(500,row.item),1,'native hook reaches the real atomic pickup');
 s.w.ctx.__thornswoodQuests=null;
 assert.equal(s.w.ctx.mp.onActivate(s.id(row.reference),500),false,'unavailable controller never falls through to container loot');
 assert.equal(s.w.ctx.mp.onActivate(s.id(row.reference),0),false,'missing actor never falls through');
 s.w.ctx.notify=()=>{throw Error('notification unavailable');};
 assert.equal(s.w.ctx.mp.onActivate(s.id(row.reference),500),false,'notification failure never enables native activation');
}
for(const row of data.sources) {
 const s=setup();assert.equal(s.take(row).ok,true);assert.equal(s.pickup(row),'You take it.');
 assert.equal(s.leave(row).ok,true);assert.equal(h.have(500,row.item),0);
 assert.equal(h.form(500).props.thornswoodQuests.cool[row.quest],undefined);assert.equal(s.take(row).ok,true);
}
for(const stage of ['take','return','abandon']) {
 const s=setup(),row=data.sources[0];
 if(stage!=='take'){assert.equal(s.take(row).ok,true);s.pickup(row);}
 s.w.ctx.__beforeQuestCommit=()=>s.session(false);
 const result=stage==='take'?s.take(row):stage==='return'?s.finish(row):s.leave(row);
 assert.equal(result.ok,false,stage+' cannot cross a closed conversation');
 assert.equal(h.have(500,'f:Skyrim.esm'),0);assert.equal(h.have(500,row.item),stage==='take'?0:1);
}
{
 const s=setup(),row=data.sources.find(r=>r.quest==='dispatch');assert.equal(s.take(row).ok,true);s.pickup(row);
 assert.equal(s.w.svc.act(500,'return',row.quest,null,s.id(row.merchant)).ok,false,'dispatch cannot return in Whiterun');
 assert.equal(s.w.svc.describe(500,s.id(row.destination)).find(r=>r.id===row.quest).canReturn,true);
 assert.equal(s.finish(row).ok,true);
}
for(const mode of ['invalid-source','failed-write','actor-replaced','quest-replaced']) {
 const s=setup(),row=data.sources[0];assert.equal(s.take(row).ok,true);
 if(mode==='invalid-source')s.source(false);
 if(mode==='failed-write')h.fault.write=true;
 if(mode==='actor-replaced')s.sourceChange(()=>{s.w.ctx.__identityToken='replacement';});
 if(mode==='quest-replaced')s.sourceChange(()=>{h.form(500).props.thornswoodQuests.open.satchel.drawn=1;});
 assert.notEqual(s.pickup(row),'You take it.',mode);assert.equal(h.have(500,row.item),0,mode);
 h.fault.write=false;
}
for(const mode of ['source-lost-at-commit','merchant-replaced-at-return']) {
 const s=setup(),row=data.sources[0];assert.equal(s.take(row).ok,true);
 if(mode==='source-lost-at-commit') {
  s.w.ctx.__beforeQuestCommit=()=>s.source(false);
  assert.notEqual(s.pickup(row),'You take it.');assert.equal(h.have(500,row.item),0);
 } else {
  s.pickup(row);s.w.ctx.__beforeQuestCommit=()=>s.role(false);
  assert.equal(s.finish(row).ok,false);assert.equal(h.have(500,row.item),1);assert.equal(h.have(500,'f:Skyrim.esm'),0);
 }
}
console.log('PASS seven retrieval panels, atomic pickup/return/abandon, exact dispatch destination, conversations and failed/replaced writes');
