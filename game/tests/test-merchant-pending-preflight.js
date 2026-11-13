'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'test-merchant-settlement.js'),'utf8');
const context={require,console};vm.createContext(context);vm.runInContext(source.slice(0,source.indexOf('// Four large snapshots')),context);
const copy=x=>JSON.parse(JSON.stringify(x));
function armed(){const f=context.fixture(),s=f.make();s.begin(f.offer());f.save();s.shutdown();f.calls.length=0;return f;}
for(const defect of ['transaction','human','human-alias','receipt','reference','base','previous','next','world','kind','phase','descriptor',
 'pending-false','pending-zero','pending-empty','previous-supply','next-supply','expected-receipt','expected-owner','expected-sequence','profile-overflow','stock-shape','receipt-whitespace','full-credit-receipt']){
 const f=armed(),state=copy(f.states.get(1)),p=state.pending;
 state.reference='2:Skyrim.esm';p.reference=state.reference;
 p.id='second';p.human={desc:'20',profileId:8};
 p.debitReceipt=JSON.stringify({actor:p.human.desc,profile:8,sequence:1});
 p.finalReceipt=JSON.stringify({actor:p.human.desc,profile:8,sequence:2});
 const first=f.states.get(1).pending;
 if(defect==='transaction')p.id=first.id;
 if(defect==='human'){p.human=copy(first.human);p.debitReceipt=first.debitReceipt;p.finalReceipt=first.finalReceipt;}
 if(defect==='human-alias'){
  p.human={desc:'000010',profileId:first.human.profileId};
  p.debitReceipt=JSON.stringify({actor:p.human.desc,profile:p.human.profileId,sequence:1});
  p.finalReceipt=JSON.stringify({actor:p.human.desc,profile:p.human.profileId,sequence:2});
 }
 if(defect==='receipt')p.debitReceipt=first.debitReceipt;
 if(defect==='reference')p.reference='wrong:Skyrim.esm';
 if(defect==='base')p.base='wrong:Skyrim.esm';
 if(defect==='previous')state.purse=249;
 if(defect==='next'){p.phase='credit';state.purse=999;}
 if(defect==='world')p.world='main:other-ledger';
 if(defect==='kind')p.kind='gift';
 if(defect==='phase')p.phase='paid';
 if(defect==='pending-false')state.pending=false;
 if(defect==='pending-zero')state.pending=0;
 if(defect==='pending-empty')state.pending='';
 if(defect==='previous-supply')p.previous.supply=false;
 if(defect==='next-supply')p.next.supply=false;
 if(defect==='expected-receipt')p.expectedReceipt='garbage';
 if(defect==='expected-owner')p.expectedReceipt=first.debitReceipt;
 if(defect==='expected-sequence')p.expectedReceipt=p.finalReceipt;
 if(defect==='stock-shape')p.next.stock=[null];
 if(defect==='receipt-whitespace')p.expectedReceipt=' null ';
 if(defect==='full-credit-receipt'){
  p.phase='credit';state.purse=p.next.purse;state.stock=copy(p.next.stock);delete p.expectedReceipt;
 }
 if(defect==='profile-overflow'){
  p.human.profileId=2147483648;
  p.debitReceipt=JSON.stringify({actor:p.human.desc,profile:p.human.profileId,sequence:1});
  p.finalReceipt=JSON.stringify({actor:p.human.desc,profile:p.human.profileId,sequence:2});
 }
 if(defect==='descriptor'){
  p.human.desc='20:Skyrim.esm:extra';
  p.debitReceipt=JSON.stringify({actor:p.human.desc,profile:8,sequence:1});
  p.finalReceipt=JSON.stringify({actor:p.human.desc,profile:8,sequence:2});
 }
 f.states.set(2,state);const before=JSON.stringify(Array.from(f.states));
 const s=f.make();assert.throws(()=>s.tick(),/pending.*verified/i,'the whole list is checked before the first recovery write: '+defect);
 assert.equal(s.available(),false);assert.equal(f.calls.length,0);
 assert.equal(JSON.stringify(Array.from(f.states)),before);
 assert.equal(f.inv.entries[0].count,40);
}
{
 const f=armed();f.states.get(1).pending.human.profileId='7';
 const s=f.make();assert.throws(()=>s.canInventoryMutation(10),/pending.*verified/i);
 assert.equal(s.available(),false);assert.equal(f.calls.length,0);
}
{
 const f=armed(),state=f.states.get(1);delete state.pending.previous.supply;delete state.pending.next.supply;
 state.unrelated={future:'retained'};
 state.pending.next.unrelated={future:'overwritten'};
 const s=f.make();s.tick();f.save();s.tick();
 assert.equal(s.available(),true);assert.equal(f.inv.entries[0].count,43);
 assert.equal(f.states.get(1).unrelated.future,'retained','legacy absent supply maps and unrelated fields survive');
 assert.equal(f.states.get(1).pending,null);
}
{
 const f=armed();f.make().tick();f.save();
 const state=f.states.get(1);assert.equal(state.pending.phase,'credit');
 delete state.pending.next.supply;state.unrelated={future:'retained'};
 const s=f.make();s.tick();
 assert.equal(f.inv.entries[0].count,43,'an acknowledged legacy credit is never credited twice');
 assert.equal(f.states.get(1).pending,null);assert.equal(f.states.get(1).unrelated.future,'retained');
}
for(const action of ['begin','prune','inventory']){
 const f=context.fixture(),bad=context.offlineRecord(2);bad.pending.world='wrong';f.states.set(2,bad);
 const before=JSON.stringify(Array.from(f.states)),s=f.make();let changed=false;
 const run=action==='begin'?()=>s.begin(f.offer()):action==='prune'?()=>s.pruneSupplyHistory(1,f.purses.read(1),100):
  ()=>s.withInventoryMutation(10,()=>{changed=true;return {ok:true};});
 assert.throws(run,/pending.*verified/i,action+' cannot write before whole-list validation');
 assert.equal(s.available(),false);assert.equal(changed,false);assert.equal(f.calls.length,0);
 assert.equal(JSON.stringify(Array.from(f.states)),before);
}
{
 const mode=fs.readFileSync(path.join(__dirname,'../../game/gamemode.js'),'utf8'),ctx={require};vm.createContext(ctx);
 vm.runInContext(mode.slice(mode.indexOf('// NPC MERCHANT PURSES BEGIN'),mode.indexOf('// NPC MERCHANT PURSES END')),ctx);
 for(const invalid of [false,0,'']){
  const f=context.fixture(),stored={version:2,entries:{'1:Skyrim.esm':copy(f.states.get(1))}};
  stored.entries['1:Skyrim.esm'].version=1;
  stored.entries['1:Skyrim.esm'].pending=invalid;
  const storage={durable:true,load:()=>copy(stored),save:()=>true};
  const api={makeProperty(){},getIdFromDesc:()=>1,getNpcAIState:()=>({isHuman:false}),get:()=> 'a:Skyrim.esm',set(){}};
  const purse=ctx.createNpcMerchantPurses(api,{keep:[['1:Skyrim.esm','a:Skyrim.esm',null,null,null,null,'trader']]},storage);
  assert.equal(purse.pendingRecords().length,1,'the production adapter exposes malformed falsy intents for quarantine');
 }
 for(const invalid of [false,null,[]]){
  const f=context.fixture(),state={...copy(f.states.get(1)),version:1,supply:invalid};let writes=0;
  const stored={version:2,entries:{'1:Skyrim.esm':state}},before=JSON.stringify(stored);
  const storage={durable:true,load:()=>copy(stored),save(){writes++;return true;}};
  const api={makeProperty(){},getIdFromDesc:()=>1,getNpcAIState:()=>({isHuman:false}),get:(id,key)=>key==='baseDesc'?'a:Skyrim.esm':undefined,set(){}};
  const purse=ctx.createNpcMerchantPurses(api,{keep:[['1:Skyrim.esm','a:Skyrim.esm',null,null,null,null,'trader']]},storage);
  const s=require('../../game/merchant-settlement').createSettlement({purses:purse,transfer:f.transfer,world:'dev:test-ledger'});
  const offer=f.offer();offer.previous=purse.read(1);
  assert.throws(()=>s.begin(offer),/pending.*verified/i);
  assert.equal(writes,0,'malformed current supply is rejected before the durable intent');
  assert.equal(JSON.stringify(stored),before);assert.equal(f.calls.length,0);
 }
}
{
 const f=context.fixture();f.transfer.receipt=()=> ' null ';f.transfer.saved=f.transfer.receipt;
 const before=JSON.stringify(Array.from(f.states)),s=f.make();
 assert.throws(()=>s.begin(f.offer()),/pending.*verified/i);
 assert.equal(JSON.stringify(Array.from(f.states)),before,'new intents have exact original receipts before reservation');
 assert.equal(f.calls.length,0);
}
console.log('PASS whole-list merchant pending identity/state validation before recovery and admission');
