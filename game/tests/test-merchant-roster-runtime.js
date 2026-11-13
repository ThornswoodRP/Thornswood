'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../game/gamemode.js'),'utf8');
const ctx={Map,Set,Number,JSON,require};vm.createContext(ctx);
vm.runInContext(source.slice(source.indexOf('// NPC MERCHANT PURSES BEGIN'),source.indexOf('// NPC MERCHANT PURSES END')),ctx);
const copy=value=>JSON.parse(JSON.stringify(value));
const state={version:1,reference:'2:Skyrim.esm',base:'a:Skyrim.esm',revision:5,purse:0,stock:[],supply:{old:1}};
function make(entry,marker={version:1,worldMode:'existing'}) {
  let writes=0;
  const data={keep:[['2:Skyrim.esm','a:Skyrim.esm',null,null,null,null,'trader']],
    merchantHistory:[['1:Skyrim.esm','a:Skyrim.esm'],['2:Skyrim.esm','a:Skyrim.esm']],merchantRoster:marker};
  const ledger={version:2,entries:{'1:Skyrim.esm':null,'2:Skyrim.esm':entry}};
  const api={makeProperty(){},getIdFromDesc:desc=>parseInt(desc,16),get(){throw Error('no actor access during admission');},
    getNpcAIState(){throw Error('no actor access during admission');},set(){writes++;}};
  const service=ctx.createNpcMerchantPurses(api,data,{load:()=>copy(ledger),save(){writes++;},durable:true,namespace:{}});
  assert.equal(writes,0,'existing-world admission performs no grants or projections');
  return service;
}
assert.throws(()=>make(null),/existing|activation|saved/i,'retained null purse must not become a fresh grant');
for(const marker of [null,{},true,{version:1,worldMode:'new'},{version:2,worldMode:'existing'}])
  assert.throws(()=>make(copy(state),marker),/roster|existing|activation/i);
assert.deepEqual(copy(make(copy(state)).read(2)),state,'depleted state and saved metadata survive activation admission');
assert.throws(()=>require('../../game/merchant-trading').installMerchantTrading({
  mp:{getIdFromDesc:()=>1,makeProperty(){throw Error('panel registration failure');}},
  catalog:{byRef:{}},purses:{},g:{},suspended:true
}),/panel registration failure/,'failed panel registration must not become a usable controller');
const {createRequire}=require('node:module');
const tradingFixture=path.join(__dirname,'test-merchant-trading.js');
const tradingContext={require:createRequire(tradingFixture),console,__dirname};vm.createContext(tradingContext);
vm.runInContext(fs.readFileSync(tradingFixture,'utf8').split('const roleMarket=')[0],tradingContext);
{
  const box=tradingContext.service({on:true},0,undefined,undefined,{suspended:true});
  assert.match(tradingContext.open(box.api).text,/unavailable/,'suspended activation cannot interact');
  assert.equal(box.api.questReady(10),false);
  let changed=false;
  box.api.withQuestInventoryMutation(10,()=>{changed=true;});
  assert.equal(changed,false,'suspended activation cannot mutate quest inventory');
  assert.deepEqual(copy(box.api.recover()),[]);
  assert.equal(box.api.retirementReady(),true);
  box.api.start();assert.ok(tradingContext.open(box.api).view);
  box.api.shutdown();assert.throws(()=>box.api.start(),/unavailable|revoked/);
  assert.equal(box.api.retirementReady(),false);
}
for(const suspended of [undefined,false]) {
  const box=tradingContext.service({on:true},0,undefined,undefined,{suspended,retirementRequired:true});
  assert.match(tradingContext.open(box.api).text,/unavailable/,'required retirement always starts suspended');
  assert.equal(box.api.questReady(10),false);
  box.api.start();assert.ok(tradingContext.open(box.api).view);box.api.shutdown();
}
{
  let reads=0;
  const mp={makeProperty(){},getIdFromDesc:()=>1};
  for(const name of ['validateInventoryTransaction','compareAndSetInventory','getInventoryReceipt',
      'getSavedInventoryReceipt','getNpcAIState','getDescFromId','get']) mp[name]=()=>true;
  const purses={durable:true,namespace:'dev:timer',read:()=>null,compareAndCommit(){},
    pendingRecords(){reads++;return [];}};
  const install=timers=>require('../../game/merchant-trading').installMerchantTrading({mp,purses,g:{},
    catalog:{byRef:{}},suspended:true,timers});
  assert.throws(()=>install({setTimeout(){throw Error('initial trade timer failure');},clearTimeout(){}}),/initial trade timer failure/);
  assert.equal(reads,0,'failed initial trade timer registration cannot recover anything');
  const pending=new Map();let serial=0;
  const timers={setTimeout(fn){pending.set(++serial,fn);return serial;},clearTimeout(id){pending.delete(id);}};
  const service=install(timers);assert.equal(pending.size,1,'initial trade timer is registered before commit');
  assert.equal(reads,0);
  const callback=pending.get(1);pending.delete(1);callback();assert.equal(reads,0,'premature timer remains suspended');
  service.start();assert.ok(reads>0);assert.equal(pending.size,1);
  service.start();assert.equal(pending.size,1,'repeated start never duplicates the recovery timer');
  service.shutdown();assert.equal(pending.size,0);callback();assert.equal(pending.size,0);
}
{
  const file=path.join(__dirname,'test-merchant-settlement.js');
  const env={require:createRequire(file),console};vm.createContext(env);
  vm.runInContext(fs.readFileSync(file,'utf8').split('// Four large snapshots')[0],env);
  const box=env.fixture(),settle=box.make();settle.begin(box.offer());box.save();settle.shutdown();
  box.states.get(1).pending.version=2;delete box.states.get(1).pending.terms;
  box.calls.length=0;box.purses.namespace='dev:test-ledger';
  const before=JSON.stringify(Array.from(box.states)),inventory=JSON.stringify(box.inv);
  const api=require('../../game/merchant-trading').createMerchantTrading({suspended:true,retirementRequired:true,purses:box.purses,
    transfer:box.transfer,world:{},places:{},prices:{}});
  assert.equal(api.retirementReady(),false,'legacy work blocks the cut before recovery');
  assert.throws(()=>api.start(),/retire|legacy|activation/i);
  assert.deepEqual(copy(api.recover()),[]);
  assert.equal(JSON.stringify(Array.from(box.states)),before);
  assert.equal(JSON.stringify(box.inv),inventory);assert.equal(box.calls.length,0);
  api.shutdown();
}
console.log('PASS existing-world roster refuses missing purse state before grants');

for(const boundary of [1,2]) {
  const box=tradingContext.service({on:true},0,undefined,undefined,{suspended:true});
  let checks=0,prepares=0;
  const prepare=box.purses.prepare;
  box.purses.prepare=function(id){prepares++;return prepare.call(this,id);};
  box.world.transfer.available=function(){if(++checks===boundary)box.api.shutdown();return true;};
  assert.throws(()=>box.api.start(),/unavailable/,'availability callback cannot reactivate a stopped trader');
  assert.match(tradingContext.open(box.api).text,/unavailable/);
  assert.equal(prepares,0,'revoked trading cannot prepare a merchant purse');
}

for(const fails of [false,true]) {
  const mp={makeProperty(){},getIdFromDesc:()=>1};
  for(const name of ['validateInventoryTransaction','compareAndSetInventory','getInventoryReceipt',
      'getSavedInventoryReceipt','getNpcAIState','getDescFromId','get'])mp[name]=()=>true;
  const purses={durable:true,namespace:'dev:teardown-test',read:()=>null,compareAndCommit(){},pendingRecords:()=>[]};
  let closedAtCancel=false,clears=0,service;
  service=require('../../game/merchant-trading').installMerchantTrading({mp,purses,g:{},catalog:{byRef:{}},suspended:true,
    timers:{setTimeout:()=>1,clearTimeout(){clears++;closedAtCancel=!service.nativeReady();if(fails)throw Error('cancellation failed');}}});
  service.start();
  if(fails)assert.throws(()=>service.shutdown(),/cancellation/);else service.shutdown();
  assert.equal(closedAtCancel,true,'merchant authority closes before timer cancellation callbacks');
  assert.equal(service.nativeReady(),false,'timer cancellation failure cannot leave the underlying trader open');
  assert.throws(()=>service.start(),/unavailable/);
  service.shutdown();assert.equal(clears,1,'shutdown never retries an uncertain cancellation');
}
