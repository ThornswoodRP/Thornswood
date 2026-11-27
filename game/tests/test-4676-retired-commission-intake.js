'use strict';
// Actual commission preparation/runtime and canonical promise state, offline.
const assert=require('node:assert/strict');
const api=require('../merchant-commissions'),STATE=require('../merchant-commission-state');
const {createLedgerNativeValidators}=require('../merchant-ledger-native');
const copy=value=>JSON.parse(JSON.stringify(value));
const targets=['q-solitude-enchanter-advanced-parcel','q-riften-smith-advanced-parcel'];
const source=require('../data/merchant-quests.json').quests.concat(require('../data/merchant-ranked-quests.json').quests);
const author=source.filter(row=>Object.hasOwn(api.publication,row.id)).map(row=>({...copy(row),
 sourceHash:api.publication[row.id],itemType:'MISC',itemTypes:Object.fromEntries(row.goods.map(good=>[good.item,'MISC']))}));
const catalog=require('../data/merchant-traders.json'),ids=new Map();
function resolve(desc){if(!ids.has(desc))ids.set(desc,1000+ids.size);return ids.get(desc);}
const native={resolveMerchant:resolve,resolveItem:resolve};
const original=api.prepareCommissions(author,catalog,native);
const retired=copy(author);for(const row of retired)if(targets.includes(row.id))row.accepting=false;
let passed=0,failed=0;
function test(name,run){try{run();passed++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+': '+error.message);}}
const human={desc:'a',profileId:7},time=2000000000000;
function world(row,flags={}) {
 let state=copy(flags.state||{reference:row.merchantRef,purse:250,stock:[],supply:{}}),pack={entries:[]},writes=0,offers=[];
 const guards={current:()=>true,alive:()=>true};
 const deps={rows:[row],now:()=>time,eligible:()=>true,
  purses:{callerGuard:true,read:()=>copy(state),stats:()=>({catalogue:1,retired:0}),
   ledgerStates:()=>[{reference:row.merchantRef,state:copy(state)}]},
  transfer:{identity:()=>copy(human),inventory:()=>copy(pack)},
  rewards:{price:desc=>({gold:3,name:desc})},
  addStock:(stock,entries,name)=>stock.concat(entries.map(entry=>({...entry,name}))),
  settlement:{available:()=>true,canInventoryMutation:()=>true,
   changeCommissions(merchant,previous,next,who,current){if(!current())return false;writes++;state=copy(next);return true;},
   begin(offer){assert.equal(offer.caller(),true);offers.push(copy({...offer,caller:undefined}));writes++;
    state={...state,...copy(offer.next),pending:null};pack=copy(offer.debit);pack.entries.push(...copy(offer.credit));return {done:true};}}
 };
 let runtime=api.createCommissions(deps);
 return {view:()=>runtime.view(10,row.merchantId),act:(verb,arg)=>runtime.act(10,row.merchantId,verb,row.id,arg,guards),
  get state(){return copy(state);},set state(value){state=copy(value);},get writes(){return writes;},get offers(){return offers;},
  inventory(value){pack=copy(value);},reload(){runtime=api.createCommissions(deps);},guards,
  held(){const parts=row.goods||[row];return STATE.reserve(undefined,human,row.id,row.deliveryVersion===2?
   {hash:row.sourceHash,hours:row.hours,goods:parts.map(good=>({item:{baseId:good.itemId,name:good.itemDesc},count:good.count,unit:3}))}:
   {hash:row.sourceHash,item:{baseId:row.itemId,name:row.itemDesc},count:row.count,unit:3},time);}};
}
test('retirement metadata preserves all published definitions and source hashes',()=>{
 const rows=api.prepareCommissions(retired,catalog,native);
 assert.equal(rows.length,original.length);
 assert.deepEqual(rows.filter(row=>row.accepting===false).map(row=>row.id),original.filter(row=>targets.includes(row.id)).map(row=>row.id));
 assert.deepEqual(rows.map(({accepting,...row})=>row),original);
});
for(const value of [true,null,0,'false'])test('invalid intake metadata is refused before native resolution: '+JSON.stringify(value),()=>{
 const rows=copy(author);rows.find(row=>targets.includes(row.id)).accepting=value;let calls=0;
 assert.throws(()=>api.prepareCommissions(rows,catalog,{resolveMerchant(){calls++;},resolveItem(){calls++;}}),/publish|commission/i);
 assert.equal(calls,0);
});
for(const value of [true,null,0,'false'])test('invalid prepared intake metadata is also refused: '+JSON.stringify(value),()=>{
 assert.throws(()=>world({...copy(original[0]),accepting:value}),/commission/i);
});
test('retirement metadata cannot hide changed immutable goods',()=>{
 const rows=copy(retired);rows.find(row=>targets.includes(row.id)).goods[0].count++;
 assert.throws(()=>api.prepareCommissions(rows,catalog,native),/publish|commission/i);
});
for(const id of targets){
 const active=original.find(row=>row.id===id),row={...copy(active),accepting:false};
 const prior=world(active).view()[0],argument='@'+prior.quoteToken;
 test(id+' resolves its retained armour through actual native validation without role metadata',()=>{
  const desc=author.find(row=>row.id===id).goods[0].item,form=parseInt(desc,16),record={id:form,type:'ARMO',flags:0};
  const mp={getIdFromDesc:description=>description===desc?form:0,getDescFromId:value=>value===form?desc:'',
   lookupEspmRecordById:()=>({record,toGlobalRecordId:value=>value}),validateInventoryTransaction:()=>true};
  const validator=createLedgerNativeValidators(mp);assert.equal(validator.resolveItem(desc,'ARMO'),form);
  assert.throws(()=>validator.resolveItem(desc,'MISC'),/cannot be verified/);
  for(const flags of [4,0x20]){record.flags=flags;assert.throws(()=>validator.resolveItem(desc,'ARMO'),/cannot be verified/);}
 });
 test(id+' hides intake and refuses a previously valid quote without writing',()=>{
  const w=world(row);assert.deepEqual(w.view(),[]);assert.deepEqual(w.act('take',argument),{ok:false,why:'retired'});assert.equal(w.writes,0);
 });
 test(id+' refuses direct intake with a known valid quote independently of the menu',()=>{
  const w=world(row);assert.deepEqual(w.act('take',argument),{ok:false,why:'retired'});assert.equal(w.writes,0);
 });
 test(id+' remains routable and keeps an old promise after restart',()=>{
  const w=world(row),accepted=w.held();assert.equal(accepted.ok,true);w.state={...w.state,commissions:accepted.next};w.reload();
  const shown=w.view()[0];assert.equal(shown.id,id);assert.equal(shown.state,'open');assert.equal(shown.canTake,false);
  assert.equal(shown.canAbandon,true);assert.equal(shown.token,accepted.token);assert.equal(shown.gold,STATE.reserved(accepted.next));
 });
 test(id+' abandons an old promise and then disappears without changing the purse',()=>{
  const w=world(row),accepted=w.held();w.state={...w.state,commissions:accepted.next};
  assert.equal(w.act('abandon','@'+accepted.token).ok,true);assert.equal(w.state.purse,250);
  assert.equal(Object.keys(STATE.read(w.state.commissions).held).length,0);assert.deepEqual(w.view(),[]);
 });
 test(id+' returns an old promise at its original terms and then disappears',()=>{
  const w=world(row),accepted=w.held(),promise=accepted.next.held[STATE.key(human,id)];
  w.state={...w.state,commissions:accepted.next};w.inventory({entries:promise.goods.map(good=>({...good.item,count:good.count}))});
  assert.equal(w.view()[0].canReturn,true);assert.equal(w.act('return','@'+accepted.token).ok,true);
  assert.equal(w.offers[0].credit[0].count,promise.gold);assert.equal(w.offers[0].next.purse,250);
  assert.equal(w.offers[0].next.commissions.held[STATE.key(human,id)],undefined);assert.deepEqual(w.view(),[]);
 });
 test(id+' keeps its own pending settlement visible without new intake',()=>{
  const w=world(row),accepted=w.held(),finished=STATE.finish(accepted.next,human,id,accepted.token,time);
  w.state={...w.state,commissions:finished.next,pending:{kind:'commission',human,previous:{commissions:accepted.next}}};w.reload();
  const shown=w.view()[0];assert.equal(shown.id,id);assert.equal(shown.waiting,true);assert.equal(shown.canTake,false);
  assert.equal(shown.canReturn,false);assert.equal(shown.canAbandon,false);assert.equal(w.writes,0);
 });
 test(id+' does not expose a different character pending promise',()=>{
  const w=world(row),accepted=w.held();w.state={...w.state,pending:{kind:'commission',human:{desc:'b',profileId:7},previous:{commissions:accepted.next}}};
  assert.deepEqual(w.view(),[]);assert.equal(w.writes,0);
 });
 test(id+' retains saved-token, session and inventory refusal boundaries',()=>{
  const w=world(row),accepted=w.held();w.state={...w.state,commissions:accepted.next};
  assert.equal(w.act('return','@'+(accepted.token+1)).why,'session');assert.equal(w.act('return','@'+accepted.token).why,'short');
  w.guards.current=()=>false;assert.equal(w.act('abandon','@'+accepted.token).ok,false);assert.equal(w.writes,0);
 });
 test(id+' still counts as held work after intake retirement',()=>{
  const w=world(row),accepted=w.held();assert.equal(STATE.openCount([{...w.state,commissions:accepted.next}],human),1);
 });
}
test('unaffected work with no intake field retains normal quoting and acceptance',()=>{
 const row=original.find(row=>!targets.includes(row.id)&&row.deliveryVersion===2),w=world(row),shown=w.view()[0];
 assert.equal(Object.hasOwn(row,'accepting'),false);assert.equal(shown.canTake,true);
 assert.equal(w.act('take','@'+shown.quoteToken).ok,true);assert.equal(w.writes,1);
});
console.log(passed+' passed, '+failed+' failed');process.exitCode=failed?1:0;
