'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const file=path.join(__dirname,'..','game','tests','test-1621-quest-state.js'),fixture=fs.readFileSync(file,'utf8');
const realm={require:createRequire(file),__dirname:path.dirname(file),console:{log(){}},Buffer};
vm.runInNewContext(fixture.slice(0,fixture.indexOf('let w = boot();'))+';this.h={boot,form,have,fault,clock,reset(){forms={};},clone(){forms=JSON.parse(JSON.stringify(forms));}};',realm);
const h=realm.h,data=require('../game/data/merchant-retrievals.json'),roster=require('../game/data/merchant-roster.json').merchants;
function setup() {
 h.reset();h.fault.write=false;h.clock.now=1000000;
 let sourceGood=true,session=true,roleGood=true,sourceChange=null;
 const into=h.boot().ctx,ids=new Map(),descs=new Map();let next=6000;
 const id=desc=>{if(!ids.has(desc)){ids.set(desc,next);descs.set(next++,desc);}return ids.get(desc);};
 data.sources.forEach(r=>{id(r.reference);id(r.merchant);id(r.destination);});
 into.__beforeQuestStartup=ctx=>{
  const resolve=ctx.mp.getIdFromDesc,describe=ctx.mp.getDescFromId;
  ctx.mp.getIdFromDesc=desc=>ids.has(desc)?id(desc):resolve(desc);
  ctx.mp.getDescFromId=n=>descs.has(n)?descs.get(n):describe(n);
  ctx.MERCHANT_TRADING.retrievalSources=()=>JSON.parse(JSON.stringify(data));
  ctx.MERCHANT_TRADING.createQuestRetrievalSources=()=>({verify:(actor,ref)=>{
   if(sourceChange)sourceChange();return sourceGood&&data.sources.some(r=>id(r.reference)===ref);
  }});
  ctx.__thornswoodMerchantTrade.questRole=n=>roleGood?roster.find(r=>r.reference===descs.get(n))?.role:null;
  ctx.__thornswoodMerchantTrade.questHold=n=>roster.find(r=>r.reference===descs.get(n))?.bookHold;
  ctx.__thornswoodMerchantTrade.questAdmission=()=>()=>session;
 };
 let w=h.boot(into);
 return {get w(){return w;},restart(){h.clone();w=h.boot(into);},id,session:v=>{session=v;},source:v=>{sourceGood=v;},role:v=>{roleGood=v;},sourceChange:f=>{sourceChange=f;},
  take:r=>w.svc.act(500,'take',r.quest,null,id(r.merchant)),
  pickup:r=>w.svc.onActivate(500,id(r.reference)),
  finish:r=>w.svc.act(500,'return',r.quest,null,id(r.destination)),
  leave:r=>w.svc.act(500,'abandon',r.quest,null,id(r.merchant))};
}
module.exports={setup,h,data};
