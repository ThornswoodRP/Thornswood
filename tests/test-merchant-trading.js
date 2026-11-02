'use strict';
const assert = require('node:assert/strict');
const trading = require('../game/merchant-trading.js');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const mode = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname,'../game/gamemode.js'),'utf8'));
const lookupSource = mode.slice(mode.indexOf('  function findIn('),mode.indexOf('  function findBeast('));
const lookupContext = {globalThis:{},buildThings:()=>({'iron ingot':{name:'Iron Ingot',desc:'5ace4:Skyrim.esm'}}),idOf:()=>100};
vm.runInNewContext(lookupSource,lookupContext);
assert.equal(lookupContext.globalThis.__thornswoodResolveItem('Iron Ingot').baseId,100,
  'the production item lookup resolves capitalized price labels');

function memoryPurses(seed) {
  const states = new Map();
  for (const [id, state] of seed) states.set(id, JSON.parse(JSON.stringify(state)));
  return {
    namespace:'dev:test-ledger',
    callerGuard:true,
    read(id) { return this.prepare(id); },
    pendingRecords() { return Array.from(states).filter(([,state])=>state.pending).map(([merchantId,state])=>({merchantId,reference:state.reference,state:JSON.parse(JSON.stringify(state))})); },
    compareAndCommit(id,rev,next,caller) { if ((states.get(id).revision || 0)!==rev || caller && !caller()) return null; return this.commit(id,next); },
    prepare(id) {
      const state = states.get(id);
      return state ? JSON.parse(JSON.stringify(state)) : null;
    },
    commit(id, next) {
      const committed={...next,revision:(states.get(id).revision || 0)+1};
      states.set(id, JSON.parse(JSON.stringify(committed)));
      return JSON.parse(JSON.stringify(committed));
    }
  };
}

function worldOf(native) {
  const actors = {
    10: { pos: [0, 0, 0], cell: 'whiterun', profileId: 7, isHuman: true },
    1: { pos: [100, 0, 0], cell: 'whiterun', profileId: 0, isHuman: false },
    2: { pos: [900, 0, 0], cell: 'whiterun', profileId: 0, isHuman: false }
  };
  const inv = { 10: { 15: 40, 100: 8, 101: 2 } };
  const records = new Map();
  const live=new Map(),saved=new Map();
  return {
    actors, inv, records,
    // A character is a runtime form (formDesc its local hex alone, #2870); a merchant is placed.
    actor(id) { return actors[id] ? {desc:id.toString(16)+(actors[id].profileId>0?'':':Skyrim.esm'),lifeGeneration:0,runtimeIdentity:'100',...actors[id]} : null; },
    carry(id, baseId) { return (inv[id] && inv[id][baseId]) || 0; },
    save() { for (const [id,receipt] of live) saved.set(id,receipt); },
    transfer: {
      available() { return native.on; }, validate() {return true;},
      identity(id) { const a=actors[id]; return a && a.profileId>0 ? {desc:id.toString(16),profileId:a.profileId} : null; },
      resolve(desc) { return parseInt(desc.split(':')[0],16); },
      inventory(id) { return {entries:Object.entries(inv[id]).filter(([,count])=>count>0).map(([baseId,count])=>({baseId:Number(baseId),count}))}; },
      receipt(id) { return live.get(id) || "null"; }, saved(id) { return saved.get(id) || "null"; },
      cas(id,expected,receipt,next,sequence,profile) {
        if (native.fail === 'throw') throw new Error('native failed');
        if (native.fail === 'refuse') return false;
        if (receipt!==(live.get(id) || "null") || JSON.stringify(this.inventory(id))!==JSON.stringify(expected) || profile!==actors[id].profileId) return false;
        inv[id]={}; for(const row of next.entries) inv[id][row.baseId]=(inv[id][row.baseId] || 0)+row.count;
        live.set(id,JSON.stringify({actor:id.toString(16)+(actors[id].profileId>0?'':':Skyrim.esm'),profile,sequence}));
        if (native.fail!=='stuck') saved.set(id,live.get(id));
        return true;
      }
    }
  };
}

const places = {
  '1:Skyrim.esm': { name: 'Belethor', locationName: 'Whiterun', hold: 'Whiterun', bookHold: 'whiterun' },
  '2:Skyrim.esm': { name: 'Template', locationName: 'CWGuardTemplates', hold: 'no hold', bookHold: null }
};
const prices = {
  quote(hold, item) {
    if (hold !== 'whiterun') return { buy: null, sell: null };
    const key = String(item).toLowerCase();
    if (key === 'iron ingot') return { buy: 3, sell: 5 };
    if (key === 'free salt') return { buy: 0, sell: null };
    return { buy: null, sell: null };
  },
  catalog() {
    return [
      { name: 'Iron Ingot', buy: 3, sell: 5 },
      { name: 'Free Salt', buy: 0, sell: null }
    ];
  }
};
function resolve(name) {
  const key = String(name).toLowerCase();
  if (key === 'iron ingot') return { name: 'Iron Ingot', baseId: 100 };
  if (key === 'free salt') return { name: 'Free Salt', baseId: 101 };
  if (key === 'gold') return { name: 'Gold', baseId: 15 };
  return null;
}

function service(native, purse, clock, market, roleOptions) {
  const world = worldOf(native);
  const purses = memoryPurses([[1, {
    version: 1, reference: '1:Skyrim.esm', base: 'a:Skyrim.esm', purse: purse, stock: [], supply: {}
  }], [2, {
    version: 1, reference: '2:Skyrim.esm', base: 'b:Skyrim.esm', purse: 250, stock: []
  }]]);
  const deps = {
    purses, prices:market || prices, transfer: world.transfer, world, places, resolve,
    isTrader: function (id) { return id === 1 || id === 2; },
    now: clock || (() => 1_700_000_000_000)
  };
  Object.assign(deps,roleOptions);
  const api = trading.createMerchantTrading(deps);
  return { api, world, purses, deps };
}

function open(api) {
  return api.command({ actorId: 10, profileId: 7, parts: ['/merchant', '1'] });
}

function roleConfig(role) {
  const tables=Object.fromEntries(['Smith','Woodworker','Tailor','Enchanter','Cook','Alchemist']
    .map(name=>[name,{buy:[100],sell:[100],supply:[100]}]));
  tables.Tailor={buy:[101],sell:[101],supply:[]};
  return {roleTables:tables,places:{...places,'1:Skyrim.esm':{...places['1:Skyrim.esm'],role}}};
}
function roleAction(box,verb,name='Iron Ingot') {
  return box.api.command({actorId:10,profileId:7,parts:['/merchant',verb]
    .concat(verb==='supply'?[]:['1']).concat(name.split(' '))});
}
const roleMarket={catalog:prices.catalog,quote(hold,name){return name==='Free Salt'?{buy:1,sell:2}:prices.quote(hold,name);}};
for(const role of ['Smith','Woodworker','Tailor','Enchanter','Cook','Alchemist']) {
  const configured=service({on:true},250,undefined,roleMarket,roleConfig(role));
  assert.equal(configured.api.questRole(1),role);
  assert.equal(configured.api.questRole(900),null,'unknown merchants have no quest role');
  const permitted=role==='Tailor'?'Free Salt':'Iron Ingot',refused=role==='Tailor'?'Iron Ingot':'Free Salt';
  assert.deepEqual(open(configured.api).view.offers.map(row=>row.name),[permitted]);
  assert.match(roleAction(configured,'sell',refused).text,/does not buy/);
  configured.api.shutdown();
}
const tailor=service({on:true},250,undefined,roleMarket,roleConfig('Tailor'));
const tailoredView=open(tailor.api).view;
assert.deepEqual(tailoredView.offers.map(row=>row.name),['Free Salt'],'off-table goods never appear');
assert.equal(tailoredView.supply.length,0,'buy permission does not imply supply work');
const roleBefore=JSON.stringify([tailor.world.inv,tailor.purses.read(1)]);
let roleWrites=0;const roleCommit=tailor.purses.commit;
tailor.purses.commit=function(...args){roleWrites++;return roleCommit.apply(this,args);};
for(const verb of ['buy','sell','supply']) assert.match(roleAction(tailor,verb).text,/does not (buy|sell|request)/i);
assert.equal(roleWrites,0,'forged off-table requests cannot even prune the ledger');
assert.equal(JSON.stringify([tailor.world.inv,tailor.purses.read(1)]),roleBefore);
assert.match(roleAction(tailor,'sell','Free Salt').text,/Sold 1/,'the role can buy its permitted goods');
assert.match(roleAction(tailor,'supply','Free Salt').text,/does not request/,'supply requires its own table');
const shelf=service({on:true},0,undefined,roleMarket,roleConfig('Tailor'));
shelf.purses.commit(1,{...shelf.purses.read(1),stock:[{baseId:101,count:2,name:'Free Salt'}]});
const shelfView=open(shelf.api).view;
assert.equal(shelfView.offers[0].maxSell,0);assert.equal(shelfView.offers[0].stock,2);
assert.equal(shelfView.offers[0].sell,2,'an empty purse does not hide permitted stocked goods');
assert.match(roleAction(shelf,'buy','Free Salt').text,/Bought 1/);
const wrongShelf=service({on:true},250,undefined,prices,roleConfig('Smith'));
const foreignStock={baseId:101,count:2,name:'Iron Ingot'};
wrongShelf.purses.commit(1,{...wrongShelf.purses.read(1),stock:[foreignStock]});
assert.equal(open(wrongShelf.api).view.offers[0].stock,0,'a matching name cannot advertise a different native item');
assert.equal(open(wrongShelf.api).view.offers[0].baseId,null);
wrongShelf.purses.commit(1,{...wrongShelf.purses.read(1),stock:[foreignStock,{baseId:100,count:1,name:'Iron Ingot'}]});
const correctShelf=open(wrongShelf.api).view.offers[0];
assert.equal(correctShelf.stock,1);assert.equal(correctShelf.baseId,100,'the shelf exposes only the resolved permitted item');
assert.match(roleAction(wrongShelf,'buy').text,/Bought 1/);
assert.deepEqual(wrongShelf.purses.read(1).stock,[foreignStock],'off-table retained goods remain untouched');
const saleOnly=roleConfig('Smith');saleOnly.roleTables.Smith.buy=[];saleOnly.roleTables.Smith.supply=[];
const directional=service({on:true},250,undefined,prices,saleOnly);
assert.equal(open(directional.api).view.offers[0].buy,null,'buy/sell permissions are independent');
assert.equal(open(directional.api).view.offers[0].sell,5);
const purchaseOnly=roleConfig('Smith');purchaseOnly.roleTables.Smith.sell=[];
const purchaser=service({on:true},250,undefined,prices,purchaseOnly);
assert.equal(open(purchaser.api).view.offers[0].sell,null);
assert.match(roleAction(purchaser,'buy').text,/does not sell/);
let roleResolutions=0;const roleResolver=purchaser.deps.resolve;
purchaser.deps.resolve=name=>{roleResolutions++;return roleResolver(name);};
open(purchaser.api);assert.equal(roleResolutions,2,'supply permissions use the already resolved offer identity');
const immutableConfig=roleConfig('Smith'),immutable=service({on:true},250,undefined,roleMarket,immutableConfig);
immutableConfig.roleTables.Smith.buy.push(101);immutableConfig.places['1:Skyrim.esm'].role='Tailor';
assert.equal(immutable.api.questRole(1),'Smith','quest routes use the copied role binding');
open(immutable.api);assert.match(roleAction(immutable,'sell','Free Salt').text,/does not buy/,'caller mutation cannot change authority');
const capturedAdmission=immutable.api.questAdmission(10,1),originalActor=immutable.world.actor;
let admissionReads=0;immutable.world.actor=function(id){admissionReads++;return originalActor.call(this,id);};
assert.equal(capturedAdmission(),true);assert.equal(admissionReads,0,'the final admission predicate invokes no native lookups');
immutable.world.actor=originalActor;assert.equal(immutable.api.questAdmission(10,2),null,'the conversation must match its trader');
immutable.api.shutdown();assert.equal(capturedAdmission(),false,'controller revocation invalidates captured admission');
const roleAlias=service({on:true},250,undefined,aliasMarketForRole(),roleConfig('Tailor'));
function aliasMarketForRole(){return {catalog(){return [{name:'Metal',buy:3,sell:5}];},quote(){return {buy:3,sell:5};}};}
roleAlias.deps.resolve=name=>name==='Metal'?{baseId:100,name:'Iron Ingot'}:resolve(name);
assert.equal(open(roleAlias.api).view.offers.length,0);assert.match(roleAction(roleAlias,'sell','Metal').text,/does not buy/);
for(const alter of [
  config=>delete config.roleTables,
  config=>config.places['1:Skyrim.esm'].role='Merchant',
  config=>config.roleTables.Smith.buy.push(15),
  config=>config.roleTables.Smith.buy.push(0),
  config=>config.roleTables.Smith.buy.push(0xff000001),
  config=>config.roleTables.Smith.buy.push(100),
  config=>config.roleTables.Smith.buy.push('100'),
  config=>config.roleTables.Smith.buy.length++,
  config=>config.roleTables.Smith.supply.push(101),
  config=>delete config.roleTables.Smith.sell,
]) {
  const config=roleConfig('Smith');alter(config);
  assert.throws(()=>service({on:true},250,undefined,prices,config),/role|table|permission/i);
}
const roleLegacyNative={on:true,fail:'stuck'},legacyRole=service(roleLegacyNative,250);
open(legacyRole.api);roleAction(legacyRole,'sell');
assert.ok(legacyRole.purses.read(1).pending);
legacyRole.api.shutdown();roleLegacyNative.fail=undefined;legacyRole.world.save();
const legacyRecovery=trading.createMerchantTrading({...legacyRole.deps,...roleConfig('Tailor')});
legacyRecovery.recover();legacyRole.world.save();legacyRecovery.recover();
assert.equal(legacyRole.purses.read(1).pending,null,'new role restrictions do not strand an original saved trade');
assert.equal(legacyRole.world.inv[10][15],43);assert.equal(legacyRole.purses.read(1).stock[0].baseId,100);
legacyRecovery.shutdown();

// The synthetic trader represents the appointed Solstheim Smith for ebony work.
const roleQuestContext={Buffer,log(){},mp:{makeProperty(){},getDescFromId(id) {
  return id===1?'1828f:Dragonborn.esm':id.toString(16)+':Skyrim.esm';
}}};
vm.runInNewContext(mode.slice(mode.indexOf('// ==== thornswood custom quests ===='),
  mode.indexOf('// ==== end thornswood custom quests ====')),roleQuestContext);
const roleEligibility=require('./quest-eligibility-fixture')(roleQuestContext,mode);
for(const replacement of ['close','replace']) for(const entry of ['act','offer','return']) {
  const routed=service({on:true},250,undefined,prices,roleConfig('Smith'));
  let record=entry==='return'?{v:1,open:{ebony:{drawn:4,kills:0,itemDesc:'ore'}},cool:{}}:null,questWrites=0,armed=false;
  const quest=roleQuestContext.__thornswoodCustomQuestsCreate({now:()=>1,load:()=>record,
    identity:()=> 'quest-owner',ready:()=>true,available:()=>true,eligibility:roleEligibility,
    readCharacter:()=>({v:1,cls:'miner',ranks:{miner:'master'}}),
    commit(actor,expected,next,goods,guard) {
      if(guard && !guard())return {ok:false};questWrites++;record=JSON.parse(JSON.stringify(next));return {ok:true};
    },traderAdmission:(actor,ref)=>routed.api.questAdmission(actor,ref),traderRole() {
      if(armed){armed=false;if(replacement==='close')routed.api.command({actorId:10,profileId:7,parts:['/merchant','close']});else open(routed.api);}
      return 'Smith';
    }});
  quest.bindPlace('ebony',{cell:'test'});routed.deps.quests=()=>quest;
  const forgedHeld=quest.capture(10);forgedHeld.admission=()=>true;
  if(entry==='act')quest.act(10,'take','ebony',null,1,forgedHeld,()=>true);
  else if(entry==='offer')quest.offer(10,'ebony',{traderRef:1,admission:()=>true},forgedHeld);
  else quest.turnIn(10,'ebony',1,forgedHeld);
  assert.equal(questWrites,0,'direct '+entry+' cannot supply its own panel admission');
  open(routed.api);const before=JSON.stringify(routed.world.inv);armed=true;
  const previousRecord=JSON.stringify(record);
  if(entry==='act')routed.api.command({actorId:10,profileId:7,parts:['/merchant','quest','take','ebony']});
  else if(entry==='offer')quest.offer(10,'ebony',{traderRef:1});
  else quest.turnIn(10,'ebony',1);
  assert.equal(questWrites,0,replacement+' during role lookup cannot mutate quests');
  assert.equal(JSON.stringify(record),previousRecord);assert.equal(JSON.stringify(routed.world.inv),before);
  routed.api.shutdown();quest.shutdown();
}

for(const capture of ['missing','replace']) for(const entry of ['act','offer','return']) {
  const routed=service({on:true},250,undefined,prices,roleConfig('Smith'));
  let record=entry==='return'?{v:1,open:{ebony:{drawn:4,kills:0,itemDesc:'ore'}},cool:{}}:null,questWrites=0;
  const quest=roleQuestContext.__thornswoodCustomQuestsCreate({now:()=>1,load:()=>record,
    identity:()=> 'quest-owner',ready:()=>true,available:()=>true,eligibility:roleEligibility,
    readCharacter:()=>({v:1,cls:'miner',ranks:{miner:'master'}}),
    commit(actor,expected,next,goods,guard) {
      if(guard && !guard())return {ok:false};questWrites++;record=JSON.parse(JSON.stringify(next));return {ok:true};
    },traderAdmission:(actor,ref)=>routed.api.questAdmission(actor,ref),traderRole:()=> 'Smith'});
  quest.bindPlace('ebony',{cell:'test'});routed.deps.quests=()=>quest;
  if(capture==='replace')open(routed.api);
  const beforeRecord=JSON.stringify(record),beforeInventory=JSON.stringify(routed.world.inv),originalActor=routed.world.actor;
  let armed=true;
  routed.world.actor=function(id) {
    if(armed){armed=false;open(routed.api);}
    return originalActor.call(this,id);
  };
  if(entry==='act')quest.act(10,'take','ebony',null,1);
  else if(entry==='offer')quest.offer(10,'ebony',{traderRef:1});
  else quest.turnIn(10,'ebony',1);
  assert.equal(questWrites,0,capture+' panel during admission lookup cannot authorize direct '+entry);
  assert.equal(JSON.stringify(record),beforeRecord);assert.equal(JSON.stringify(routed.world.inv),beforeInventory);
  routed.api.shutdown();quest.shutdown();
}
{
  const routed=service({on:true},250,undefined,prices,roleConfig('Smith'));
  let record=null,questWrites=0,inCommit=false;
  const quest=roleQuestContext.__thornswoodCustomQuestsCreate({now:()=>1,load:()=>record,
    identity:()=> 'quest-owner',ready:()=>true,available:()=>true,eligibility:roleEligibility,
    readCharacter:()=>({v:1,cls:'miner',ranks:{miner:'master'}}),
    commit(actor,expected,next,goods,guard) {
      inCommit=true;
      if(guard && !guard())return {ok:false};questWrites++;record=JSON.parse(JSON.stringify(next));return {ok:true};
    },traderAdmission:(actor,ref)=>routed.api.questAdmission(actor,ref),traderRole:()=> 'Smith'});
  quest.bindPlace('ebony',{cell:'test'});routed.deps.quests=()=>quest;open(routed.api);
  const originalAdmission=routed.api.questAdmission(10,1),beforeInventory=JSON.stringify(routed.world.inv);
  const result=quest.act(10,'take','ebony',null,1,undefined,function() {
    if(inCommit)open(routed.api);
    return true;
  });
  assert.equal(originalAdmission(),false,'the supplied origin callback replaces the original conversation');
  assert.equal(result.ok,false,'the actual session is checked after a supplied origin callback');
  assert.equal(questWrites,0);assert.equal(record,null);assert.equal(JSON.stringify(routed.world.inv),beforeInventory);
  routed.api.shutdown();quest.shutdown();
}
for(const replacement of ['close','replace']) {
  const routed=service({on:true},250,undefined,prices,roleConfig('Smith'));
  let record=null,questWrites=0,inCommit=false,reentered=false;
  const quest=roleQuestContext.__thornswoodCustomQuestsCreate({now:()=>1,load:()=>record,
    identity:()=> 'quest-owner',ready:()=>true,available:()=>true,eligibility:roleEligibility,
    readCharacter() {
      if(inCommit && !reentered) {
        reentered=true;
        if(replacement==='close')routed.api.command({actorId:10,profileId:7,parts:['/merchant','close']});
        else open(routed.api);
      }
      return {v:1,cls:'miner',ranks:{miner:'master'}};
    },
    commit(actor,expected,next,goods,guard) {
      inCommit=true;
      if(guard && !guard())return {ok:false};
      questWrites++;record=JSON.parse(JSON.stringify(next));return {ok:true};
    },traderAdmission:(actor,ref)=>routed.api.questAdmission(actor,ref),traderRole:()=> 'Smith'});
  quest.bindPlace('ebony',{cell:'test'});routed.deps.quests=()=>quest;open(routed.api);
  const original=routed.api.questAdmission(10,1),inventory=JSON.stringify(routed.world.inv);
  const outcome=quest.offer(10,'ebony',{traderRef:1});
  assert.ok(reentered && !original(),replacement+' happened during the final eligibility read');
  assert.equal(outcome.ok,false,replacement+' during the final read revokes acceptance');
  assert.equal(questWrites,0);assert.equal(record,null);assert.equal(JSON.stringify(routed.world.inv),inventory);
  routed.api.shutdown();quest.shutdown();
}
{
  const routed=service({on:true},250,undefined,prices,roleConfig('Smith'));
  let record=null,questWrites=0,inCommit=false,standing='master';
  const quest=roleQuestContext.__thornswoodCustomQuestsCreate({now:()=>1,load:()=>record,
    identity:()=> 'quest-owner',ready:()=>true,available:()=>true,eligibility:roleEligibility,
    readCharacter:()=>({v:1,cls:'miner',ranks:{miner:standing}}),
    commit(actor,expected,next,goods,guard) {
      inCommit=true;if(guard && !guard())return {ok:false};
      questWrites++;record=JSON.parse(JSON.stringify(next));return {ok:true};
    },traderAdmission:(actor,ref)=>routed.api.questAdmission(actor,ref),traderRole:()=> 'Smith'});
  quest.bindPlace('ebony',{cell:'test'});routed.deps.quests=()=>quest;open(routed.api);
  const outcome=quest.act(10,'take','ebony',null,1,undefined,()=>{if(inCommit)standing='advanced';return true;});
  assert.equal(standing,'advanced','the origin callback changed standing inside the commit');
  assert.equal(outcome.ok,false,'origin callbacks happen before the final eligibility snapshot');
  assert.equal(questWrites,0);assert.equal(record,null);
  routed.api.shutdown();quest.shutdown();
}
let native = { on: true };
let box = service(native, 250);
let opened = open(box.api);
assert.equal(opened.view.open, true);
assert.equal(opened.view.purse, 250);
assert.equal(opened.view.transfer, true);
assert.equal(opened.view.offers[0].stock, 0);
assert.equal(opened.view.offers[0].carried, 8, 'the server supplies the carried count for a quoted item');
assert.equal(opened.view.offers[1].carried, 2, 'zero-price goods still have a carried count');
assert.equal(opened.view.offers[0].maxSell, 8);
assert.equal(opened.view.sellReason, '');
const partial=service({on:true},10);
assert.equal(open(partial.api).view.offers[0].maxSell,3,'the purse limits the selectable quantity');
const emptyPurse=service({on:true},0);
assert.equal(open(emptyPurse.api).view.offers[0].maxSell,0);
assert.equal(open(emptyPurse.api).view.offers[1].maxSell,2,'free quoted goods can be given to an empty purse');
delete emptyPurse.world.inv[10][101];
assert.match(open(emptyPurse.api).view.sellReason,/cannot afford/);
const noPrices=service({on:true},250,undefined,{catalog(){return [];},quote(){return {buy:null,sell:null};}});
assert.equal(open(noPrices.api).view.offers.length,0);
assert.match(open(noPrices.api).view.sellReason,/no submitted buy prices/);
const aliasMarket={catalog(){return [{name:'iron ingots',buy:9,sell:12}];},
  quote(hold,name){return name==='iron ingots'?{buy:9,sell:12}:{buy:null,sell:null};}};
const alias=service({on:true},250,undefined,aliasMarket);
alias.deps.resolve=name=>String(name).toLowerCase()==='iron ingots'?{name:'Iron Ingot',baseId:100}:resolve(name);
assert.equal(open(alias.api).view.offers[0].buy,9,'display quotes the actual submitted label');
assert.equal(open(alias.api).view.offers[0].name,'iron ingots');
assert.match(alias.api.command({actorId:10,profileId:7,parts:['/merchant','sell','1','@9','iron','ingots']}).text,/Sold 1/,
  'an alias-only price remains usable while the shelf stores its canonical inventory name');
const suppliedAlias=alias.api.command({actorId:10,profileId:7,parts:['/merchant','supply','iron','ingots']});
assert.match(suppliedAlias.text,/Sold 5/);
assert.equal(suppliedAlias.view.supply[0].ready,false,'an alias uses the canonical completed supply cooldown');
let liveBuy=3;
const changedQuote=service({on:true},250,undefined,{catalog:prices.catalog,quote(){return {buy:liveBuy,sell:5};}});
open(changedQuote.api);liveBuy=2;
const rejectedQuote=changedQuote.api.command({actorId:10,profileId:7,parts:['/merchant','sell','2','@3','Iron','Ingot']});
assert.match(rejectedQuote.text,/price changed/);
assert.equal(changedQuote.world.inv[10][100],8);
assert.equal(changedQuote.purses.read(1).purse,250);
assert.equal(rejectedQuote.view.offers[0].buy,2);
const replacedQuote=service({on:true},250,undefined,{catalog:prices.catalog,quote(){return {buy:2,sell:5};}});
open(replacedQuote.api);
let quoteReentered=false;
const quoteInventory=replacedQuote.world.transfer.inventory;
replacedQuote.world.transfer.inventory=function(id){
  if(!quoteReentered){quoteReentered=true;open(replacedQuote.api);}
  return quoteInventory.call(this,id);
};
const oldQuote=replacedQuote.api.command({actorId:10,profileId:7,parts:['/merchant','sell','1','@3','Iron','Ingot']});
assert.equal(oldQuote.view,null,'old quote feedback cannot take over a replacement panel');
const refresh=service({on:true},250);
let inventoryReads=0;
const readInventory=refresh.world.transfer.inventory;
refresh.world.transfer.inventory=function(id){inventoryReads++;return readInventory.call(this,id);};
const initial=open(refresh.api).view;
refresh.api.acknowledgeView(10,initial);
inventoryReads=0;
assert.deepEqual(refresh.api.recover(),[],'unchanged views are not republished');
assert.equal(inventoryReads,1,'one validated pack snapshot serves the entire catalogue');
refresh.world.inv[10][100]=1;
const updated=refresh.api.recover();
assert.equal(updated.length,1,'pack changes refresh sale eligibility without a settlement');
assert.equal(updated[0].view.offers[0].maxSell,1);
refresh.api.acknowledgeView(10,updated[0].view);
assert.deepEqual(refresh.api.recover(),[]);
const pendingUi=service({on:true,fail:'stuck'},250);
open(pendingUi.api);
pendingUi.api.command({actorId:10,profileId:7,parts:['/merchant','sell','1','Iron','Ingot']});
const heldView=open(pendingUi.api).view;
assert.equal(heldView.offers.every(row=>row.maxSell===0),true,'a pending transfer hides all pack sales');
assert.match(heldView.sellReason,/finishing|waiting/);
const swapped=service({on:true},250);
open(swapped.api);
const swapInventory=swapped.world.transfer.inventory;
swapped.world.transfer.inventory=function(id) {
  const result=swapInventory.call(this,id);
  swapped.world.actors[10].runtimeIdentity='999';
  return result;
};
const oldPack=swapped.api.recover();
assert.deepEqual(oldPack,[],'neither inventory nor a closure can publish to a replacement character');
const nestedView=service({on:true},250);
open(nestedView.api);
let replaceOnce=false;
const nestedInventory=nestedView.world.transfer.inventory;
nestedView.world.transfer.inventory=function(id) {
  if(!replaceOnce){replaceOnce=true;open(nestedView.api);}
  return nestedInventory.call(this,id);
};
assert.deepEqual(nestedView.api.recover(),[],'an old refresh cannot publish under a replacement panel session');
const feedback=service({on:true},250);
const feedbackView=open(feedback.api).view;
feedbackView.note='You take the work.';
feedback.api.acknowledgeView(10,feedbackView);
feedback.world.inv[10][100]=4;
assert.equal(feedback.api.recover()[0].view.note,'You take the work.','inventory updates retain quest feedback');
const corruptPack=service({on:true},250);
corruptPack.world.transfer.inventory=()=>({entries:[{baseId:100,count:-1}]});
const unreadable=open(corruptPack.api).view;
assert.equal(unreadable.offers.every(row=>row.maxSell===0),true);
assert.match(unreadable.sellReason,/could not be read/);
const questCalls=[],described=[];
box.deps.quests=()=>({describe:(...args)=>{described.push(args);return [{id:'ebony',name:'The ebony'}];},
  capture:()=>({owner:'held-session'}),
  act:(...args)=>{questCalls.push(args);return {ok:true};}});
assert.equal(open(box.api).view.quests[0].id,'ebony');
assert.deepEqual(described.pop(),[10,1],'quest view receives the authenticated merchant');
assert.equal(box.api.questHold(1),'Whiterun');
assert.equal(box.api.questHold(900),'','unknown merchant has no offering hold');
assert.equal(box.api.command({actorId:10,profileId:9,parts:['/merchant','quest','take','ebony']}).view,null);
assert.equal(questCalls.length,0,'forged quest profile cannot reach the controller');
box.world.actors[11]={...box.world.actors[10]};
box.api.command({actorId:11,profileId:7,parts:['/merchant','quest','take','ebony']});
assert.equal(questCalls.length,0,'a replacement actor cannot reuse the old session');
open(box.api);
box.api.command({actorId:10,profileId:7,parts:['/merchant','quest','take','gem','Ruby']});
const routedQuestArgs=questCalls.pop();
assert.deepEqual(routedQuestArgs.slice(0,6),[10,'take','gem','Ruby',1,{owner:'held-session'}]);
assert.equal(typeof routedQuestArgs[6],'function');assert.equal(routedQuestArgs[6](),true);
box.world.actors[10].lifeGeneration=1;
box.api.command({actorId:10,profileId:7,parts:['/merchant','quest','take','ebony']});
assert.equal(questCalls.length,0,'an earlier life cannot reuse a merchant session');
open(box.api);
box.world.actors[10].runtimeIdentity='101';
box.api.command({actorId:10,profileId:7,parts:['/merchant','quest','take','ebony']});
assert.equal(questCalls.length,0,'a new native session cannot reuse an old merchant panel');
open(box.api);
box.world.actors[10].desc='new:Skyrim.esm';
box.api.command({actorId:10,profileId:7,parts:['/merchant','quest','take','ebony']});
assert.equal(questCalls.length,0,'a changed descriptor cannot reuse a merchant session');
open(box.api);
box.world.actors[10].pos=[900,0,0];
box.api.command({actorId:10,profileId:7,parts:['/merchant','quest','take','ebony']});
assert.equal(questCalls.length,0,'out-of-reach quest action cannot reach the controller');
box.world.actors[10].pos=[0,0,0];open(box.api);
{
  const actor=box.world.actor;
  box.world.actor=function(id) {
    if(id===1)box.world.actors[10].runtimeIdentity='102';
    return actor(id);
  };
  box.api.command({actorId:10,profileId:7,parts:['/merchant','quest','abandon','ebony']});
  assert.equal(questCalls.length,0,'a merchant location callback cannot redirect an old panel into a replacement session');
  box.world.actor=actor;
  open(box.api);
}

const cooldownPanel=service({on:true},250);
for (const during of ['reach','final']) {
  const nested=service({on:true},250), calls=[];
  nested.deps.quests=()=>({describe:()=>[],capture:()=>({}),act:()=>{calls.push(1);return {ok:true};}});
  open(nested.api);
  const lookup=nested.world.actor;let fired=false,reads=0;
  nested.world.actor=function(id) {
    if(!fired && (during==='reach'?id===1:id===10 && ++reads===2)) {
      fired=true;open(nested.api);
    }
    return lookup(id);
  };
  const refused=nested.api.command({actorId:10,profileId:7,parts:['/merchant','quest','take','ebony']});
  assert.equal(calls.length,0,'a '+during+' callback cannot redirect an old command into a replacement panel');
  assert.equal(refused.view,null,'a refused old command cannot close the replacement panel');
  nested.world.actor=lookup;
  nested.api.command({actorId:10,profileId:7,parts:['/merchant','quest','take','ebony']});
  assert.equal(calls.length,1,'the new panel keeps its command ownership after '+during);
}
let cooling=true;
cooldownPanel.deps.quests=()=>({describe:()=>[{id:'ebony',state:cooling?'cooldown':'available',canTake:!cooling}]});
open(cooldownPanel.api);
assert.equal(cooldownPanel.api.recover().length,0,'unchanged quest data does not republish');
cooling=false;
const refreshedWork=cooldownPanel.api.recover();
assert.equal(refreshedWork.length,1,'cooldown expiry updates an open panel without a trade');
assert.equal(refreshedWork[0].view.quests[0].canTake,true);
assert.equal(cooldownPanel.api.recover().length,1,'an unacknowledged publication is not cached as delivered');
cooldownPanel.api.acknowledgeView(10,refreshedWork[0].view);
assert.equal(cooldownPanel.api.recover().length,0,'a refreshed quest is not sent repeatedly');
let takenWork=false;
cooldownPanel.deps.quests=()=>({describe:()=>[{id:'ebony',state:takenWork?'open':'available'}],
  capture:()=>({owner:'held-session'}),
  act:()=>{takenWork=true;return {ok:true};}});
open(cooldownPanel.api);
const takenView=cooldownPanel.api.command({actorId:10,profileId:7,parts:['/merchant','quest','take','ebony']}).view;
assert.equal(takenView.note,'You take the work.');
cooldownPanel.api.acknowledgeView(10,takenView);
assert.equal(cooldownPanel.api.recover().length,0,'unchanged recovery retains the action feedback without replacing the view');
cooldownPanel.world.actors[10].lifeGeneration=1;
assert.deepEqual(cooldownPanel.api.recover(),[],'recovery retires the obsolete session without closing a replacement runtime');

// Each trade that went through is told to the hold economy (#3164), once.
const tradedRows = [];
box.deps.traded = (row) => tradedRows.push(row);
let sold = box.api.command({ actorId: 10, profileId: 7, parts: ['/merchant', 'sell', '2', 'Iron', 'Ingot'] });
assert.match(sold.text, /Sold 2/);
assert.equal(box.purses.prepare(1).purse, 244);
assert.equal(box.purses.prepare(1).stock[0].count, 2);
assert.equal(box.world.inv[10][100], 6);
assert.equal(box.world.inv[10][15], 46);
assert.equal(box.purses.prepare(1).purse + box.world.inv[10][15], 290);

let bought = box.api.command({ actorId: 10, profileId: 7, parts: ['/merchant', 'buy', '1', 'Iron', 'Ingot'] });
assert.match(bought.text, /Bought 1/);
assert.equal(box.purses.prepare(1).purse, 249);
assert.equal(box.purses.prepare(1).stock[0].count, 1);
assert.equal(box.world.inv[10][100], 7);
assert.equal(box.world.inv[10][15], 41);
assert.equal(box.purses.prepare(1).purse + box.world.inv[10][15], 290);
assert.equal(box.world.inv[10][100] + box.purses.prepare(1).stock[0].count, 8);

box.purses.commit(1, Object.assign(box.purses.prepare(1), { purse: 0 }));
let broke = box.api.command({ actorId: 10, profileId: 7, parts: ['/merchant', 'sell', '1', 'Iron', 'Ingot'] });
assert.match(broke.text, /cannot pay/);
assert.equal(box.purses.prepare(1).purse, 0);
assert.equal(box.purses.prepare(1).stock[0].count, 1);
assert.equal(box.world.inv[10][100], 7);

let bare = box.api.command({ actorId: 10, profileId: 7, parts: ['/merchant', 'buy', '5', 'Iron', 'Ingot'] });
assert.match(bare.text, /empty/);
assert.equal(box.purses.prepare(1).stock[0].count, 1);
assert.deepEqual(tradedRows, [
  { hold: 'whiterun', verb: 'sell', baseId: 100, name: 'Iron Ingot', count: 2 },
  { hold: 'whiterun', verb: 'buy', baseId: 100, name: 'Iron Ingot', count: 1 }
], 'the hold economy hears each trade that went through and none that was refused (#3164)');
box.deps.traded = () => { throw new Error('the count failed'); };
let countless = box.api.command({ actorId: 10, profileId: 7, parts: ['/merchant', 'buy', '1', 'Iron', 'Ingot'] });
assert.match(countless.text, /Bought 1/, 'a hold economy count that throws never stops the trade (#3164)');
assert.equal(box.purses.prepare(1).stock.length, 0);
delete box.deps.traded;

let off = service({ on: false }, 250);
open(off.api);
let blocked = off.api.command({ actorId: 10, profileId: 7, parts: ['/merchant', 'sell', '1', 'Iron', 'Ingot'] });
assert.match(blocked.text, /native transfer/);
assert.equal(off.purses.prepare(1).purse, 250);
assert.equal(off.purses.prepare(1).stock.length, 0);
assert.equal(off.world.inv[10][15], 40);
assert.equal(off.world.inv[10][100], 8);
assert.equal(off.purses.prepare(1).pending || null, null);

let far = service({ on: true }, 250);
let away = far.api.command({ actorId: 10, profileId: 7, parts: ['/merchant', '2'] });
assert.match(away.text, /not close enough/);
let stranger = far.api.command({ actorId: 10, profileId: 9, parts: ['/merchant', '1'] });
assert.match(stranger.text, /not yours/);
let join = far.api.command({ actorId: 10, profileId: 7, parts: ['/merchant', 'join'] });
assert.match(join.text, /cannot join/);
let scene = far.api.command({ actorId: 10, profileId: 7, parts: ['/merchant', 'scene'] });
assert.match(scene.text, /Scene quests/);
assert.equal(far.purses.prepare(1).purse, 250);

let held = service({ on: true }, 250);
open(held.api);
let none = held.api.command({ actorId: 10, profileId: 7, parts: ['/merchant', 'sell', '1', 'Unknown', 'Thing'] });
assert.match(none.text, /not known/);
let noPrice = held.api.command({ actorId: 10, profileId: 7, parts: ['/merchant', 'buy', '1', 'Free', 'Salt'] });
assert.match(noPrice.text, /No trader sells/);

let supply = service({ on: true }, 20);
open(supply.api);
let paid = supply.api.command({ actorId: 10, profileId: 7, parts: ['/merchant', 'supply', 'Iron', 'Ingot'] });
assert.match(paid.text, /Sold 5/);
assert.equal(supply.purses.prepare(1).purse, 5);
assert.equal(supply.purses.prepare(1).stock[0].count, 5);
assert.equal(supply.world.inv[10][100], 3);
assert.equal(supply.world.inv[10][15], 55);
let again = supply.api.command({ actorId: 10, profileId: 7, parts: ['/merchant', 'supply', 'Iron', 'Ingot'] });
assert.match(again.text, /not due/);
assert.equal(supply.purses.prepare(1).purse, 5);
// Supplies belong to the authenticated character, not everybody at a trader.
let supplyAt = 1_700_000_000_000;
const personal = service({on:true}, 250, () => supplyAt);
open(personal.api);
assert.match(personal.api.command({actorId:10,profileId:7,parts:['/merchant','supply','Iron','Ingot']}).text,/Sold 5/);
personal.world.actors[11]={pos:[0,0,0],cell:'whiterun',profileId:8,isHuman:true};
personal.world.inv[11]={15:40,100:8};
let secondCharacter=personal.api.command({actorId:11,profileId:8,parts:['/merchant','1']});
assert.equal(secondCharacter.view.supply[0].ready,true,'another character must have an independent supply offer');
assert.match(personal.api.command({actorId:11,profileId:8,parts:['/merchant','supply','Iron','Ingot']}).text,/Sold 5/);
// Another character on the same account also has its own cooldown.
personal.world.actors[12]={pos:[0,0,0],cell:'whiterun',profileId:7,isHuman:true};
personal.world.inv[12]={15:40,100:8};
assert.equal(personal.api.command({actorId:12,profileId:7,parts:['/merchant','1']}).view.supply[0].ready,true);
assert.match(personal.api.command({actorId:12,profileId:7,parts:['/merchant','supply','Iron','Ingot']}).text,/Sold 5/);
personal.api.shutdown();
const resumed=trading.createMerchantTrading(personal.deps);
personal.world.inv[10][100]=8;
assert.equal(open(resumed).view.supply[0].ready,false,'restart must retain this character cooldown');
assert.match(resumed.command({actorId:10,profileId:7,parts:['/merchant','supply','Iron','Ingot']}).text,/not due/);
supplyAt += 6*60*60*1000-1;
assert.equal(open(resumed).view.supply[0].ready,false);
supplyAt++;
assert.equal(open(resumed).view.supply[0].ready,true);
assert.match(resumed.command({actorId:10,profileId:7,parts:['/merchant','supply','Iron','Ingot']}).text,/Sold 5/);
assert.equal(personal.purses.prepare(1).purse,190);
assert.equal(personal.purses.prepare(1).stock[0].count,20);
assert.equal(personal.world.inv[10][15],70);
assert.equal(personal.world.inv[11][15],55);
assert.equal(personal.world.inv[12][15],55);

// A delayed or interrupted supply starts its window only at completion.
let completionAt=1_700_000_000_000;
const delayedNative={on:true,fail:'stuck'};
const delayed=service(delayedNative,250,()=>completionAt);
open(delayed.api);
assert.match(delayed.api.command({actorId:10,profileId:7,parts:['/merchant','supply','Iron','Ingot']}).text,/waiting on the save/);
assert.equal(open(delayed.api).view.supply[0].ready,false,'a pending supply is unavailable in the panel');
completionAt+=12*60*60*1000;
delayed.api.shutdown();
const delayedResume=trading.createMerchantTrading(delayed.deps);
delayed.world.save();
delete delayedNative.fail;
delayedResume.recover();
delayed.world.inv[10][100]=8;
assert.equal(open(delayedResume).view.supply[0].ready,false,'six hours start at saved completion after a long disconnect');
completionAt+=6*60*60*1000;
assert.equal(open(delayedResume).view.supply[0].ready,true);

// Expired history cannot permanently fill an otherwise empty merchant intent.
const history=service({on:true},250);
const state=history.purses.prepare(1);
for(let i=0;i<6000;i++)state.supply[JSON.stringify([0xff000100+i,i+1,'iron ingot'])]=1;
history.purses.commit(1,state);
open(history.api);
assert.match(history.api.command({actorId:10,profileId:7,parts:['/merchant','sell','1','Iron','Ingot']}).text,/Sold 1/);
assert.deepEqual(history.purses.prepare(1).supply,{});

const cleanupFailure=service({on:true},250);
let expired=cleanupFailure.purses.prepare(1);expired.supply={'old':1};cleanupFailure.purses.commit(1,expired);
cleanupFailure.purses.compareAndCommit=()=>{throw new Error('cleanup acknowledgement failed');};
open(cleanupFailure.api);
assert.match(cleanupFailure.api.command({actorId:10,profileId:7,parts:['/merchant','sell','1','Iron','Ingot']}).text,/unavailable/);
assert.equal(cleanupFailure.api.nativeReady(),false);
assert.equal(cleanupFailure.world.inv[10][100],8);
assert.equal(cleanupFailure.world.inv[10][15],40);

// A reentrant projection must not reuse the earlier character's cooldown key.
const replacedCharacter=service({on:true},250);
expired=replacedCharacter.purses.prepare(1);expired.supply={'old':1};replacedCharacter.purses.commit(1,expired);
const commitCleanup=replacedCharacter.purses.compareAndCommit.bind(replacedCharacter.purses);
replacedCharacter.purses.compareAndCommit=(...args)=>{
  const result=commitCleanup(...args);
  replacedCharacter.world.transfer.identity=()=>({desc:'b0',profileId:7});
  return result;
};
open(replacedCharacter.api);
assert.match(replacedCharacter.api.command({actorId:10,profileId:7,parts:['/merchant','supply','Iron','Ingot']}).text,/not yours/);
assert.equal(replacedCharacter.world.inv[10][100],8);
assert.equal(replacedCharacter.purses.prepare(1).purse,250);
assert.equal(replacedCharacter.purses.prepare(1).pending,undefined);
replacedCharacter.world.transfer.identity=(id)=>({desc:id.toString(16),profileId:7});
expired=replacedCharacter.purses.prepare(1);expired.supply={'old':1};replacedCharacter.purses.commit(1,expired);
assert.match(replacedCharacter.api.command({actorId:10,profileId:7,parts:['/merchant','sell','1','Iron','Ingot']}).text,/not yours/);
assert.equal(replacedCharacter.world.inv[10][100],8);
assert.equal(replacedCharacter.purses.prepare(1).purse,250);

const reentrantCleanup=service({on:true},250);
expired=reentrantCleanup.purses.prepare(1);expired.supply={'old':1};reentrantCleanup.purses.commit(1,expired);
open(reentrantCleanup.api);
const fencedCommit=reentrantCleanup.purses.compareAndCommit.bind(reentrantCleanup.purses);
let nestedCleanup=null;
reentrantCleanup.purses.compareAndCommit=(...args)=>{
  if(!nestedCleanup)nestedCleanup=reentrantCleanup.api.command({actorId:10,profileId:7,parts:['/merchant','sell','1','Iron','Ingot']});
  return fencedCommit(...args);
};
assert.match(reentrantCleanup.api.command({actorId:10,profileId:7,parts:['/merchant','sell','1','Iron','Ingot']}).text,/Sold 1/);
assert.match(nestedCleanup.text,/offer changed/);
assert.equal(reentrantCleanup.world.inv[10][100],7);
assert.equal(reentrantCleanup.purses.prepare(1).stock[0].count,1);


// Unidentified old completions retain their window. Old pending supplies
// finish under their original key without attributing them to somebody new.
let legacyAt=1_700_000_000_000;
const legacyNative={on:true,fail:'stuck'};
const legacy=service(legacyNative,250,()=>legacyAt);
open(legacy.api);
legacy.api.command({actorId:10,profileId:7,parts:['/merchant','supply','Iron','Ingot']});
let oldPending=legacy.purses.prepare(1);
oldPending.pending.next.supply={'iron ingot':legacyAt};
oldPending.pending.version=2;delete oldPending.pending.terms; // Explicit pre-summary legacy format keeps its item-only key.
legacy.purses.commit(1,oldPending);
legacyAt+=12*60*60*1000;
legacy.world.save();delete legacyNative.fail;
legacy.api.recover();
assert.equal(legacy.purses.prepare(1).pending,null);
assert.deepEqual(legacy.purses.prepare(1).supply,{'iron ingot':legacyAt});
assert.equal(open(legacy.api).view.supply[0].ready,false);
legacyAt+=6*60*60*1000;
assert.equal(open(legacy.api).view.supply[0].ready,true);

let poor = service({ on: true }, 14);
open(poor.api);
let skipped = poor.api.command({ actorId: 10, profileId: 7, parts: ['/merchant', 'supply', 'Iron', 'Ingot'] });
assert.match(skipped.text, /cannot pay/);
assert.equal(poor.purses.prepare(1).stock.length, 0);

let stuckNative = { on: true, fail: 'stuck' };
let stuck = service(stuckNative, 250);
open(stuck.api);
let waiting = stuck.api.command({ actorId: 10, profileId: 7, parts: ['/merchant', 'sell', '1', 'Iron', 'Ingot'] });
assert.match(waiting.text, /waiting on the save/);
assert.equal(stuck.purses.prepare(1).purse, 250);
assert.ok(stuck.purses.prepare(1).pending);
assert.equal(stuck.world.inv[10][100], 7);
let second = stuck.api.command({ actorId: 10, profileId: 7, parts: ['/merchant', 'sell', '1', 'Iron', 'Ingot'] });
assert.match(second.text, /waiting/);
assert.equal(stuck.purses.prepare(1).purse, 250);
stuck.world.save();
stuckNative.fail='';
stuck.api.recover([1]);
assert.equal(stuck.purses.prepare(1).purse, 247);
assert.equal(stuck.purses.prepare(1).stock[0].count, 1);
assert.equal(stuck.purses.prepare(1).pending, null);
stuck.api.recover([1]);
assert.equal(stuck.purses.prepare(1).purse, 247);

let fresh = service({ on: true }, 250);
open(fresh.api);
let free = fresh.api.command({ actorId: 10, profileId: 7, parts: ['/merchant', 'sell', '1', 'Free', 'Salt'] });
assert.match(free.text, /Sold 1/);
assert.equal(fresh.purses.prepare(1).purse, 250);
assert.equal(fresh.purses.prepare(1).stock[0].count, 1);

const absent = trading.createNativeMerchantTransfer({});
assert.equal(absent.available(), false);
assert.equal(typeof absent.cas, 'function');

assert.equal(trading.bookHoldOf('Whiterun'), 'whiterun');
assert.equal(trading.bookHoldOf('no hold'), null);
assert.equal(trading.bookHoldOf('Solstheim'), 'ravenrock');

let ebox = service({ on: false }, 250);
let keyed = ebox.api.activate(10, 1);
assert.equal(keyed.view.open, true);
assert.match(keyed.text, /open|Trading/);
let repeat = ebox.api.activate(10, 1);
assert.equal(repeat.text, '');
assert.equal(repeat.view.open, true);
assert.equal(ebox.api.activate(10, 99), null);
let quiet = ebox.api.command({ actorId: 10, profileId: 7, parts: ['/merchant', 'e', '63'] });
assert.equal(quiet.text, '');
assert.equal(quiet.view, null);
const seen = new Set(trading.GUILD_SITES.map(function (site) { return site.bookHold; }));
for (const hold of Object.values(trading.BOOK_HOLD)) {
  assert.equal(seen.has(hold), true);
  assert.ok(trading.guildSite(hold).place);
}

const finalFailures=[];
function finalCase(name,run){try{run();}catch(error){finalFailures.push(name+': '+error.message);}}
finalCase('command keeps its originating session',()=>{
  const b=service({on:true},250);open(b.api);
  let nested=false;
  b.deps.resolve=name=>{if(!nested){nested=true;open(b.api);}return resolve(name);};
  const result=b.api.command({actorId:10,profileId:7,parts:['/merchant','sell','1','@4','Iron','Ingot']});
  assert.equal(result.view,null);
  assert.equal(b.world.inv[10][100],8);
});
finalCase('open keeps ownership across prepare',()=>{
  const b=service({on:true},250);open(b.api);
  const prepare=b.purses.prepare.bind(b.purses);let nested=false,newer;
  b.purses.prepare=id=>{if(!nested){nested=true;newer=open(b.api).view;}return prepare(id);};
  const old=open(b.api);
  assert.equal(old.view,null);
  b.purses.prepare=prepare;
  b.world.inv[10][100]++;
  assert.equal(b.api.recover()[0].view.sessionId,newer.sessionId);
});
finalCase('reach callback cannot delete replacement',()=>{
  const b=service({on:true},250);open(b.api);
  const actor=b.world.actor.bind(b.world);let nested=false;
  b.world.actor=id=>{if(id===10&&!nested){nested=true;open(b.api);return null;}return actor(id);};
  assert.deepEqual(b.api.recover(),[]);
  b.world.actor=actor;b.world.inv[10][100]++;
  assert.equal(b.api.recover().length,1);
});
finalCase('batch cannot retain an obsolete runtime view',()=>{
  const b=service({on:true},250);open(b.api);
  b.world.actors[11]={...b.world.actors[10],profileId:8};b.world.inv[11]={...b.world.inv[10]};
  b.api.command({actorId:11,profileId:8,parts:['/merchant','1']});
  b.world.inv[10][100]++;
  const inventory=b.world.transfer.inventory;let nested=false;
  b.world.transfer.inventory=function(id){if(id===11&&!nested){nested=true;b.world.actors[10].runtimeIdentity='200';open(b.api);}return inventory.call(this,id);};
  assert.equal(b.api.recover().some(row=>row.actorId===10),false);
});
finalCase('supply retains displayed price consent',()=>{
  const b=service({on:true},250);open(b.api);
  const result=b.api.command({actorId:10,profileId:7,parts:['/merchant','supply','@4','Iron','Ingot']});
  assert.match(result.text,/price changed/);
  assert.equal(b.world.inv[10][100],8);
  assert.equal(b.purses.read(1).purse,250);
});
finalCase('publication rechecks collected views and closures',()=>{
  const b=service({on:true},250);open(b.api);b.world.inv[10][100]++;
  const collected=b.api.recover()[0].view;
  assert.equal(b.api.isCurrentView(10,collected),true);
  open(b.api);
  assert.equal(b.api.isCurrentView(10,collected),false);
  b.world.actors[10].pos=[9000,0,0];
  const closed=b.api.recover()[0].view;
  assert.equal(b.api.isCurrentView(10,closed),true);
  b.world.actors[10].pos=[0,0,0];open(b.api);
  assert.equal(b.api.isCurrentView(10,closed),false);
});
finalCase('command closure cannot close a later panel',()=>{
  const b=service({on:true},250);open(b.api);
  const closed=b.api.command({actorId:10,profileId:7,parts:['/merchant','close']}).view;
  open(b.api);assert.equal(b.api.isCurrentView(10,closed),false);
});
finalCase('failure closures cannot close a later panel',()=>{
  for(const parts of [['/merchant','2'],['/merchant','sell','1','Iron','Ingot']]) {
    const b=service({on:true},250);open(b.api);
    b.world.actors[10].pos=[9000,0,0];
    const closed=b.api.command({actorId:10,profileId:7,parts}).view;
    assert.equal(closed.open,false);
    b.world.actors[10].pos=[0,0,0];open(b.api);
    assert.equal(b.api.isCurrentView(10,closed),false);
  }
});
finalCase('closure cannot cross to a different profile runtime',()=>{
  const b=service({on:true},250);open(b.api);b.world.actors[10].pos=[9000,0,0];
  const closed=b.api.recover()[0].view;
  Object.assign(b.world.actors[10],{pos:[0,0,0],profileId:8,runtimeIdentity:'200'});
  b.api.command({actorId:10,profileId:8,parts:['/merchant','1']});
  assert.equal(b.api.isCurrentView(10,closed),false);
});
finalCase('opening owns final timestamp construction',()=>{
  let b,armed=false,calls=0,newer;
  b=service({on:true},250,()=>{if(armed && ++calls===2){armed=false;newer=open(b.api).view;}return 1700000000000;});
  armed=true;
  const old=open(b.api);
  assert.equal(old.view,null);
  assert.equal(b.api.isCurrentView(10,newer),true);
});
finalCase('activation keeps ownership across trader lookup',()=>{
  const b=service({on:true},250);open(b.api);let newer;
  b.deps.isTrader=()=>{newer=open(b.api).view;return true;};
  const old=b.api.command({actorId:10,profileId:7,parts:['/merchant','e','1']});
  assert.equal(old.view,null);assert.equal(b.api.isCurrentView(10,newer),true);
});
finalCase('identity replacement blocks supply history mutation',()=>{
  const b=service({on:true},250);let state=b.purses.prepare(1);state.supply={expired:1};b.purses.commit(1,state);
  open(b.api);const identity=b.world.transfer.identity;let armed=true;
  b.world.transfer.identity=function(id){if(armed){armed=false;open(b.api);}return identity.call(this,id);};
  b.api.command({actorId:10,profileId:7,parts:['/merchant','sell','1','Iron','Ingot']});
  assert.deepEqual(b.purses.read(1).supply,{expired:1});
  assert.equal(b.world.inv[10][100],8);
});
finalCase('obsolete quest feedback is suppressed',()=>{
  const b=service({on:true},250);open(b.api);
  b.deps.quests=()=>({capture:()=>({}),describe:()=>[],act:()=>{open(b.api);return {ok:true};}});
  const old=b.api.command({actorId:10,profileId:7,parts:['/merchant','quest','take','ebony']});
  assert.deepEqual(old,{text:'',view:null});
});
finalCase('obsolete committed trade feedback is suppressed',()=>{
  const b=service({on:true},250);open(b.api);
  const prepare=b.purses.prepare.bind(b.purses);let armed=true;
  b.purses.prepare=id=>{const state=prepare(id);if(armed&&state.purse===247){armed=false;open(b.api);}return state;};
  const old=b.api.command({actorId:10,profileId:7,parts:['/merchant','sell','1','Iron','Ingot']});
  assert.deepEqual(old,{text:'',view:null});
  assert.equal(b.world.inv[10][100],7,'a committed trade is retained, never replayed or compensated');
});
finalCase('later validation cannot retain an earlier replaced view',()=>{
  const b=service({on:true},250);open(b.api);
  b.world.actors[11]={...b.world.actors[10],profileId:8};b.world.inv[11]={...b.world.inv[10]};
  b.api.command({actorId:11,profileId:8,parts:['/merchant','1']});
  b.world.inv[10][100]++;b.world.inv[11][100]++;
  const actor=b.world.actor.bind(b.world);let reads=0,newer;
  b.world.actor=id=>{if(id===11&&++reads===4)newer=open(b.api).view;return actor(id);};
  assert.equal(b.api.recover().some(row=>row.actorId===10),false);
  assert.ok(newer,'the replacement occurs during the later view validation');
});
finalCase('production publication checks after serialization',()=>{
  const b=service({on:true},250);let armed=false;
  const quests=[];
  b.deps.quests=()=>({describe:()=>quests});
  const view=open(b.api).view;
  view.quests.toJSON=()=>{if(armed){armed=false;open(b.api);}return [];};
  const source=fs.readFileSync(path.join(__dirname,'../game/merchant-trading.js'),'utf8');
  const push=source.slice(source.indexOf('  trading.push = function'),source.indexOf('  var timers=env.timers'));
  const writes=[];vm.runInNewContext(push,{trading:b.api,mp:{set:(...args)=>writes.push(args)},property:'view',log:()=>{}});
  armed=true;b.api.push(10,view);
  assert.deepEqual(writes,[]);
});
assert.deepEqual(finalFailures,[]);
console.log('PASS merchant trading quotes, stock, depletion, supply, reach and native gate');
