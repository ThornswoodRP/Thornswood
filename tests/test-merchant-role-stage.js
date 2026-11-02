'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=name=>JSON.parse(fs.readFileSync(path.join(root,'game/data',name+'.json'),'utf8'));
const copy=value=>JSON.parse(JSON.stringify(value));
const {prepareMerchantRoleStage}=require('../game/merchant-role-stage');
const roster=read('merchant-roster'),currentCatalog=read('merchant-traders'),roleDoc=read('merchant-role-tables'),tables=roleDoc.tables;
const source=require('./gamemode-tables.js').joined(fs.readFileSync(path.join(root,'game/gamemode.js'),'utf8')),context={};vm.createContext(context);
assert.ok(!source.slice(source.indexOf('// MERCHANT TRADING BUNDLE BEGIN'),source.indexOf('// MERCHANT TRADING BUNDLE END'))
  .includes('"f:Skyrim.esm"'),'unused currency evidence must not enter a role bundle');
vm.runInContext(source.slice(source.indexOf('// NPC POPULATION DATA BEGIN'),source.indexOf('// NPC POPULATION DATA END'))+'\nglobalThis.data=NPC_POPULATION_DATA;',context);
const currentPopulation=copy(context.data),population=copy(currentPopulation);
delete population.merchantRoster;delete population.merchantHistory;delete population.merchantRoles;
const sourceRows=read('npc-population').npcs.filter(row=>row.role==='trader');
const catalog={version:1,count:249,byRef:{}};
for(const row of sourceRows) {
 if(!population.keep.some(kept=>kept[0]===row.ref))population.keep.push([row.ref,row.base,row.world||row.cell,row.pos,row.leash,row.returnMinutes,row.role,row.habitat,row.tier,row.cap||null,row.populationBucket||null,0,row.species]);
 catalog.byRef[row.ref]={name:row.name,hold:row.hold,bookHold:roster.merchants.find(m=>m.hold===row.hold)?.bookHold || 'whiterun',locationName:row.locationName,cell:row.cell,world:row.world,pos:row.pos};
}
const stage={version:1,history:roster.history,merchants:roster.merchants,tables,types:Object.fromEntries(Object.entries(roleDoc.records).map(([d,r])=>[d,r.type]))};
function fixture() {
  const ids=new Map();let serial=1000;
  return {population:copy(population),catalog:copy(catalog),stage:copy(stage),
    resolve:desc=>{if(!ids.has(desc))ids.set(desc,++serial);return ids.get(desc);}};
}
function prepare(f) {return prepareMerchantRoleStage(f.population,f.catalog,f.stage,{resolveMerchant:f.resolve,resolveItem:f.resolve});}
const f=fixture(),before=JSON.stringify([f.population,f.catalog,f.stage]),result=prepare(f);
assert.equal(JSON.stringify([f.population,f.catalog,f.stage]),before,'stage must not mutate its source');
assert.equal(result.population.keep.length,population.keep.length);
assert.equal(result.population.keep.filter(row=>row[6]==='trader').length,249,'roles do not retire anyone');
assert.equal(Object.keys(result.population.merchantRoles).length,60);
assert.equal(result.population.merchantRoster,undefined,'role admission is not retirement admission');
for(const merchant of roster.merchants) {
  assert.equal(result.catalog.byRef[merchant.reference].role,merchant.role);
  assert.equal(result.catalog.byRef[merchant.reference].name,merchant.role);
  const row=result.population.keep.find(row=>row[0]===merchant.reference),original=population.keep.find(row=>row[0]===merchant.reference);
  assert.deepEqual(row.slice(0,13),original.slice(0,13),'placement, ecology and identity stay unchanged');
  assert.equal(row[13],merchant.role);
}
for(const row of population.keep) if(!result.population.merchantRoles[row[0]])
  assert.deepEqual(result.population.keep.find(next=>next[0]===row[0]),row,'other NPCs remain unchanged');
assert.equal(Object.values(result.catalog.byRef).filter(row=>row.role).length,60);
for(const role of Object.keys(tables)) for(const direction of ['buy','sell','supply'])
  assert.deepEqual(result.roleTables[role][direction],tables[role][direction].map(f.resolve));
for(const change of [
  f=>f.stage.merchants.pop(),f=>f.stage.history.pop(),
  f=>f.stage.merchants[0].base='dead:Skyrim.esm',f=>f.stage.merchants[0].hold='the Rift',
  f=>f.stage.merchants[0].role='Merchant',f=>f.stage.merchants[0].role=f.stage.merchants[1].role,
  f=>delete f.catalog.byRef[f.stage.merchants[0].reference],
  f=>f.population.keep.find(row=>row[0]===f.stage.merchants[0].reference)[1]='dead:Skyrim.esm',
  f=>f.population.keep.push(copy(f.population.keep[0])),f=>f.population.merchantRoster={version:1,worldMode:'existing'},
  f=>delete f.stage.tables.Smith,f=>f.stage.tables.Smith.buy.push(f.stage.tables.Smith.buy[0]),
  f=>f.stage.tables.Smith.supply.push('dead:Skyrim.esm'),
  f=>f.stage.tables.Smith.buy.push('f:Skyrim.esm'),
  f=>f.stage.tables.Smith.sell.push('ff000001:Skyrim.esm')]) {
  const f=fixture();change(f);let reads=0;f.resolve=()=>{reads++;return 1;};
  assert.throws(()=>prepare(f),/Merchant role stage/);assert.equal(reads,0,'bad source refuses before native callbacks');
}
for(const id of [0,15,-1,0xff000001,NaN,1.5,undefined]) {
  const f=fixture();f.resolve=()=>id;assert.throws(()=>prepare(f),/Merchant role stage/);
}
{const f=fixture();f.resolve=()=>100;assert.throws(()=>prepare(f),/Merchant role stage/,'distinct descriptors cannot alias');}
{const f=fixture(),resolve=f.resolve;let once=false;f.resolve=desc=>{
  if(!once){once=true;f.stage.tables.Smith.buy.length=0;f.catalog.byRef={};f.population.keep.length=0;}
  return resolve(desc);
};const detached=prepare(f);assert.equal(Object.keys(detached.catalog.byRef).length,249);assert.ok(detached.roleTables.Smith.buy.length>0);}
console.log('PASS staged sixty merchant roles preserve all249 NPCs and validate source and native identities');

// Use the generated bundle and its production installer, not a second wiring.
const {createRequire}=require('node:module');
const bundleContext={require:createRequire(path.join(root,'game/merchant-trading.js')),Buffer,Uint8Array,console,__dirname:path.join(root,'game')};
vm.createContext(bundleContext);
vm.runInContext(source.slice(source.indexOf('// MERCHANT TRADING BUNDLE BEGIN'),source.indexOf('// MERCHANT TRADING BUNDLE END'))+
  '\nglobalThis.bundle=MERCHANT_TRADING;',bundleContext);
const fixtureContext={require:createRequire(path.join(__dirname,'test-merchant-trading.js')),console,__dirname};
vm.createContext(fixtureContext);
vm.runInContext(fs.readFileSync(path.join(__dirname,'test-merchant-trading.js'),'utf8').split('const roleMarket=')[0],fixtureContext);
for(const merchant of roster.merchants.filter(row=>row.bookHold==='whiterun')) {
  const f=fixture(),descs=new Map(),records=new Map();
  function id(desc) {if(desc==='a')return 10;const value=desc==='a:Skyrim.esm'?10:f.resolve(desc);descs.set(value,desc);return value;}
  for(const row of roster.merchants) {
    const base=id(row.base),reference=id(row.reference),data=Buffer.alloc(4);data.writeUInt32LE(base);
    records.set(base,{id:base,type:'NPC_',flags:0,fields:[]});
    records.set(reference,{id:reference,type:'ACHR',flags:0,fields:[{type:'NAME',data}]});
  }
  for(const [desc,type] of Object.entries(stage.types)){const value=id(desc);records.set(value,{id:value,type,flags:0,fields:[]});}
  const box=fixtureContext.worldOf({on:true}),merchantId=id(merchant.reference);
  // The trading character (10) is a runtime form whose formDesc is its local hex alone (#2870).
  const native={getIdFromDesc:id,getDescFromId:value=>value===10?'a':descs.get(value) || value.toString(16)+':Skyrim.esm',
    lookupEspmRecordById:value=>({record:records.get(value),toGlobalRecordId:raw=>raw}),
    validateInventoryTransaction:()=>true,makeProperty(){},getActorRuntimeIdentity:()=> '100',
    getNpcAIState:value=>box.actor(value===merchantId?1:value),
    get:(value,key)=>key==='inventory'?box.transfer.inventory(value):undefined,
    getInventoryReceipt:value=>box.transfer.receipt(value),getSavedInventoryReceipt:value=>box.transfer.saved(value),
    compareAndSetInventory:(...args)=>box.transfer.cas(...args)};
  const prepared=bundleContext.bundle.prepareRoles(currentPopulation,native);
  const allowed=tables[merchant.role].supply[0],forbidden=Object.values(tables).flatMap(row=>row.buy)
    .find(desc=>!tables[merchant.role].buy.includes(desc));
  const goods=[allowed,forbidden],names=new Map(goods.map((desc,i)=>[desc,'Test Good '+i]));
  box.inv[10]={[id(allowed)]:10,[id(forbidden)]:10,15:100};
  const purses=fixtureContext.memoryPurses([[merchantId,{version:1,reference:merchant.reference,base:merchant.base,
    purse:250,stock:[],supply:{}}]]);
  const g={__thornswoodBooks:{catalog:()=>goods.map(desc=>({name:names.get(desc)})),guildPrice:()=>({buy:2,sell:3})},
    __thornswoodResolveItem:name=>{const desc=goods.find(desc=>names.get(desc)===name);return desc?{baseId:id(desc),name}:null;}};
  const trading=bundleContext.bundle.installMerchantTrading({mp:native,g,purses,catalog:prepared.catalog,
    roleTables:prepared.roleTables,timers:{setTimeout:()=>1,clearTimeout(){}}});
  const command=(...parts)=>trading.command({actorId:10,profileId:7,parts:['/merchant',...parts]});
  const view=command(merchantId.toString(16)).view;
  assert.equal(view.trader,merchant.role);assert.deepEqual(copy(view.offers.map(row=>row.name)),[names.get(allowed)]);
  assert.equal(view.supply.length,1);
  assert.match(command('sell','1',names.get(forbidden)).text,/does not buy/);
  assert.match(command('buy','1',names.get(forbidden)).text,/does not sell/);
  assert.match(command('supply',names.get(forbidden)).text,/does not request/);
  assert.match(command('sell','1',names.get(allowed)).text,/Sold 1/);
  command(merchantId.toString(16));assert.match(command('buy','1',names.get(allowed)).text,/Bought 1/);
  command(merchantId.toString(16));assert.match(command('supply',names.get(allowed)).text,/Supplied|Delivered|Sold 5/);
  assert.equal(trading.questRole(merchantId),merchant.role);trading.shutdown();
}
console.log('PASS production bundled installer enforces all six role tables for pack, shelf and supply actions');

{
  let writers=0,reads=0;
  const startup=source.slice(source.lastIndexOf('// NPC SERVER STARTUP BEGIN'),source.indexOf('// NPC SERVER STARTUP END',source.lastIndexOf('// NPC SERVER STARTUP BEGIN')));
  const ctx={require,Buffer,Uint8Array,setTimeout,clearTimeout,NPC_POPULATION_DATA:currentPopulation,
    MERCHANT_TRADING:bundleContext.bundle,log(){},
    createNpcMerchantPurses(){writers++;},createPrivateMerchantLedger(){writers++;},
    mp:{getServerSettings:()=>({thornswoodServer:'dev',loadOrder:currentPopulation.plugins}),prepareNpcLoad(){},
      getIdFromDesc(){reads++;ctx.__thornswoodNpcStartupOwner={};return 100;},
      getDescFromId(){throw Error('revoked native read');},lookupEspmRecordById(){throw Error('revoked native read');},
      validateInventoryTransaction:()=>true}};
  vm.createContext(ctx);vm.runInContext(startup,ctx);
  assert.equal(reads,1);assert.equal(writers,0,'native role lookup revocation stops before any private writer construction');
}
console.log('PASS production startup revokes role preparation before opening the ledger');
