'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const file=path.join(__dirname,'test-1621-quest-state.js'),source=fs.readFileSync(file,'utf8');
const context={require:createRequire(file),__dirname,console:{log(){}},Buffer};
vm.runInNewContext(source.slice(0,source.indexOf('let w = boot();'))+
 ';this.harness={boot,form,have,ranks,reset(){forms={};},npcStates,npcIds};',context);
const h=context.harness;
const mode=require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname,'../game/gamemode.js'),'utf8'));
const bindings=vm.runInNewContext('('+mode.match(/var LEGACY_OFFER_REF = (\{[^;]+\});/)[1]+')');
const trades=vm.runInNewContext('('+mode.match(/var LEGACY_TRADE = (\{[^;]+\});/)[1]+')');
const roster=require('../game/data/merchant-roster.json').merchants;
assert.deepEqual(Object.keys(bindings).sort(),Object.keys(trades).sort());
for(const [job,reference] of Object.entries(bindings))assert.equal(roster.find(row=>row.reference===reference)?.role,trades[job]);
function setup() {
 h.reset();h.ranks['500:miner']='master';const w=h.boot();
 const desc=w.ctx.mp.getDescFromId;
 w.ctx.mp.getDescFromId=id=>id===9000?'1828f:Dragonborn.esm':id===9001?'1a67c:Skyrim.esm':desc(id);
 w.ctx.__thornswoodMerchantTrade.questRole=id=>id===9000||id===9001?'Smith':null;
 w.ctx.__thornswoodMerchantTrade.questHold=id=>id===9000?'Solstheim':'Whiterun';
 return w;
}
{
 const w=setup();
 assert.ok(w.svc.describe(500,9000).some(row=>row.id==='ebony'));
 assert.ok(!w.svc.describe(500,9001).some(row=>row.id==='ebony'),'a different hold Smith must not repeat the same new offer');
 assert.equal(w.svc.act(500,'take','ebony',null,9001).ok,false);
 assert.equal(w.svc.offer(500,'ebony',{traderRef:9001}).ok,false);
 assert.equal(h.form(500).props.thornswoodQuests,undefined,'wrong offering merchant makes zero quest writes');
 assert.equal(w.svc.act(500,'take','ebony',null,9000).ok,true);
 // Saved work from any former trader remains recoverable after the cut.
 assert.ok(w.svc.describe(500,9001).some(row=>row.id==='ebony'&&row.state==='open'&&row.canAbandon));
 assert.equal(w.svc.act(500,'abandon','ebony',null,9001).ok,true);
 assert.ok(!w.svc.describe(500,9001).some(row=>row.id==='ebony'));
}
{
 const w=setup();let changed=false;
 w.ctx.__questRankRead=()=>{changed=true;w.ctx.mp.getDescFromId=id=>id===9000?'1a67c:Skyrim.esm':'human:'+id;
  return {v:1,cls:'miner',ranks:{miner:'master'}};};
 assert.equal(w.svc.act(500,'take','ebony',null,9000).ok,false);
 assert.equal(changed,true);assert.equal(h.form(500).props.thornswoodQuests,undefined,
  'replacement merchant during eligibility cannot inherit acceptance');
}
{
 const w=setup();let reads=0;
 w.ctx.__thornswoodMerchantTrade.questRole=()=>{
  if(++reads===4)h.ranks['500:miner']='expert';
  return 'Smith';
 };
 assert.equal(w.svc.act(500,'take','ebony',null,9000).ok,false,
  'final merchant callbacks must precede the final progression snapshot');
 assert.ok(reads>=4);assert.equal(h.form(500).props.thornswoodQuests,undefined);
}
console.log('PASS appointed legacy offers, old compatible recovery and final merchant ownership');
