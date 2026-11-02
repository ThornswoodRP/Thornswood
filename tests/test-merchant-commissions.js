'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{prepareCommissions}=require('../game/merchant-commissions');
const policy=require('../game/merchant-commission-state'),crypto=require('node:crypto');
const mode=require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname,'../game/gamemode.js'),'utf8')),copy=value=>JSON.parse(JSON.stringify(value));
const runtime={require:createRequire(path.join(__dirname,'../game/merchant-trading.js')),Buffer,Uint8Array,console,__dirname:path.join(__dirname,'../game')};
vm.createContext(runtime);
vm.runInContext(mode.slice(mode.indexOf('// MERCHANT TRADING BUNDLE BEGIN'),mode.indexOf('// MERCHANT TRADING BUNDLE END'))+
 '\nglobalThis.bundle=MERCHANT_TRADING;',runtime);
vm.runInContext(mode.slice(mode.indexOf('// ==== thornswood progression ===='),mode.indexOf('// ==== end thornswood progression ====')),runtime);
const bundle=runtime.bundle,rules=bundle.createQuestEligibility({table:runtime.__thornswoodProgression.TABLE,spellIds:runtime.__thornswoodProgression.SPELL_IDS});
const ffile=path.join(__dirname,'test-merchant-trading.js'),fixtureContext={require:createRequire(ffile),__dirname,console:{log(){}}};
vm.createContext(fixtureContext);
vm.runInContext(fs.readFileSync(ffile,'utf8').split('const roleMarket=')[0]+';this.fixture={memoryPurses,worldOf};',fixtureContext);
const fixture=fixtureContext.fixture,catalog=require('../game/data/merchant-traders.json'),tables=require('../game/data/merchant-role-tables.json');
const raw=copy(bundle.commissionRows()),source=require('../game/data/merchant-quests.json').quests.concat(require('../game/data/merchant-ranked-quests.json').quests);
assert.equal(raw.length,241);
for(const defect of ['missing','empty','hash','substitution','definition','grandfather']) {
 const damaged=copy(raw);if(defect==='missing')damaged.pop();if(defect==='empty')damaged.length=0;
 if(defect==='hash')damaged[0].sourceHash='0'.repeat(64);
 if(defect==='substitution')damaged[0].id='q-substitute-commission';
 if(defect==='definition')damaged[damaged.length-1].goods[0].count++;
 if(defect==='grandfather')damaged.find(row=>row.id==='q-whiterun-tailor-winter-vestments').goods[1].count=6;
 let reads=0;
 assert.throws(()=>prepareCommissions(damaged,catalog,{resolveMerchant(){reads++;return 1;},resolveItem(){reads++;return 100;}}),
   /publish|commission/i,'published '+defect+' admission must refuse');
 assert.equal(reads,0,'publication refuses before any native preparation');
}
for(const row of raw)assert.equal(row.sourceHash,crypto.createHash('sha256').update(JSON.stringify(source.find(q=>q.id===row.id))).digest('hex'));
const ids=new Map();function id(desc){if(!ids.has(desc))ids.set(desc,1000+ids.size);return ids.get(desc);}
const allRows=prepareCommissions(raw,catalog,{
 resolveMerchant(reference,base){assert.equal(require('../game/data/merchant-roster.json').merchants.find(q=>q.reference===reference).base,base);return id(reference);},
 resolveItem(desc,type){assert.equal(tables.records[desc].type,type);return id(desc);}
});
const rows=allRows.filter(row=>row.deliveryVersion!==2),ranked=allRows.filter(row=>row.deliveryVersion===2);
const roles=Object.fromEntries(Object.entries(tables.tables).map(([name,table])=>[name,
 Object.fromEntries(Object.entries(table).map(([direction,descs])=>[direction,descs.map(id)]))]));
const itemNames=new Map(allRows.flatMap(row=>(row.goods||[row]).map(good=>[good.itemId,'Goods '+good.itemId])));
// The stand-in resolver looks a name up in this, built once. It spread the whole
// map into an array and searched it on every call, which was 65 of the 100 s
// this harness took (#3114).
const itemByName=new Map();for(const [baseId,name] of itemNames)if(!itemByName.has(name))itemByName.set(name,{baseId,name});
const merchants=[...new Map(allRows.map(row=>[row.merchantId,row])).values()];
const legacyMerchants=[...new Map(rows.map(row=>[row.merchantId,row])).values()];
function world(startingPurse=250) {
 const native={on:true},box=fixture.worldOf(native);let time=2000000000000,unit=2,standing;
 for(const row of merchants)box.actors[row.merchantId]={...box.actors[1],pos:[100,0,0]};
 box.inv[10]={15:40};
 const purses=fixture.memoryPurses(merchants.map(row=>[row.merchantId,
  {version:1,reference:row.merchantRef,base:'a:Skyrim.esm',purse:startingPurse,stock:[],supply:{}}]));
 purses.stats=()=>({catalogue:merchants.length,retired:1});
 purses.ledgerStates=()=>merchants.map(row=>({merchantId:row.merchantId,reference:row.merchantRef,state:purses.read(row.merchantId)}))
  .concat([{merchantId:999,reference:'f:Skyrim.esm',state:null}]);
 const deps={purses,world:box,transfer:box.transfer,places:catalog.byRef,roleTables:roles,commissions:allRows,
  isTrader:merchant=>merchants.some(row=>row.merchantId===merchant),now:()=>time,
  resolve:name=>{const found=itemByName.get(name);return found?{baseId:found.baseId,name:found.name}:null;},
  prices:{catalog:()=>[...itemNames.values()].map(name=>({name,buy:unit,sell:unit+1})),quote:()=>({buy:unit,sell:unit+1})},
  commissionEligible:(actor,gate)=>{if(deps.onRankRead)deps.onRankRead();return rules.allows(gate,standing);}};
 let api=bundle.createMerchantTrading(deps);
 const command=(...parts)=>api.command({actorId:10,profileId:7,parts:['/merchant',...parts]});
 const open=row=>command(row.merchantId.toString(16)).view;
 const select=row=>{standing=row.gate.classKey?{v:1,cls:row.gate.classKey,ranks:{[row.gate.classKey]:'master'}}:
  row.gate.profession==='mage'?{v:1,prof:'mage',schools:[row.gate.school],ranks:{[row.gate.school]:'master'},
    spells:{known:[runtime.__thornswoodProgression.TABLE.spells[row.gate.school].master.find(name=>runtime.__thornswoodProgression.SPELL_IDS[name])]}}:
  {v:1,prof:row.gate.profession,ranks:{[row.gate.half]:'master'}};return open(row);};
 const quote=row=>select(row).quests.find(q=>q.id===row.id);
 const take=row=>{const q=quote(row);return command('quest','take',row.id,'@'+(q.quoteToken||q.quotedUnit));};
 const token=row=>'@'+purses.read(row.merchantId).commissions.held[policy.key(box.transfer.identity(10),row.id)].token;
 return {get api(){return api;},box,purses,deps,native,command,open,select,quote,take,token,
  reload:()=>{api.shutdown();api=bundle.createMerchantTrading(deps);},unit:n=>{unit=n;},rank:n=>{standing=n;},
  clock:n=>{time=n;},now:()=>time,settle:()=>{for(let i=0;i<3;i++)api.recover();}};
}
for(const row of rows) {
 const w=world();assert.equal(w.quote(row).canTake,true,row.id);
 assert.match(w.take(row).text,/take the work/);
 const held=w.purses.read(row.merchantId).commissions.held[policy.key(w.box.transfer.identity(10),row.id)];
 assert.equal(held.gold,row.count*2);assert.equal(w.box.inv[10][row.itemId],undefined,'acceptance never draws or requires the goods');
 assert.match(w.command('quest','return',row.id,w.token(row)).text,/not.*enough|carrying|drawn/);
 assert.equal(w.purses.read(row.merchantId).purse,250);
 w.box.inv[10][row.itemId]=row.count;w.unit(9);w.rank({v:1,cls:'other',ranks:{}});
 const originalToken=w.token(row);w.reload();w.open(row);w.command('quest','return',row.id,originalToken);w.settle();
 const state=w.purses.read(row.merchantId);
 assert.equal(state.purse,250-held.gold);assert.equal(w.box.inv[10][15],40+held.gold);
 assert.equal(w.box.inv[10][row.itemId]||0,0);assert.equal(state.stock[0].count,row.count);
 assert.equal(Object.keys(state.commissions.held).length,0);assert.equal(state.pending,null);
 assert.match(w.command('quest','return',row.id,originalToken).text,/Choose the work/);
 assert.equal(w.box.inv[10][15],40+held.gold,'duplicate completion never pays twice');
 assert.equal(w.open(row).quests.find(q=>q.id===row.id).state,'cooldown');
}
{
 const row=rows[0],w=world();w.select(row);w.unit(null);
 const q=w.open(row).quests.find(q=>q.id===row.id);assert.equal(q.canTake,false);assert.equal(q.gold,null);
 assert.match(w.command('quest','take',row.id,'@2').text,/price/);assert.equal(w.purses.read(row.merchantId).commissions,undefined);
}
{
 const row=rows[0],w=world();const q=w.quote(row);w.unit(7);
 assert.match(w.command('quest','take',row.id,'@'+q.quotedUnit).text,/price/);
 assert.equal(w.purses.read(row.merchantId).commissions,undefined);
 w.unit(2);w.take(row);const stale=w.token(row);w.command('quest','abandon',row.id,stale);w.take(row);
 assert.notEqual(w.token(row),stale);assert.match(w.command('quest','abandon',row.id,stale).text,/Choose the work/);
 assert.ok(w.purses.read(row.merchantId).commissions.held[policy.key(w.box.transfer.identity(10),row.id)]);
}
{
 const row=rows[0],w=world();w.take(row);const held=w.purses.read(row.merchantId).commissions;
 w.box.inv[10][row.itemId]=1000;w.open(row);
 const quote=w.open(row).offers.find(item=>item.name===itemNames.get(row.itemId));
 assert.equal(quote.maxSell,Math.floor((250-policy.reserved(held))/2));
 assert.match(w.command('sell','125',itemNames.get(row.itemId)).text,/unreserved/);
 assert.equal(w.purses.read(row.merchantId).purse,250);
}
{
 const row=rows[0],w=world();w.select(row);let armed=true;
 w.deps.onRankRead=()=>{if(armed){armed=false;w.open(row);}};
 w.command('quest','take',row.id,'@2');
 assert.equal(armed,false,'the eligibility callback actually replaced the conversation');
 assert.equal(w.purses.read(row.merchantId).commissions,undefined,'replacement conversation cannot inherit acceptance');
}
function seedPromise(w,row) {
 const state=w.purses.read(row.merchantId),made=policy.reserve(state.commissions,w.box.transfer.identity(10),row.id,
  {hash:row.sourceHash,item:{baseId:row.itemId,name:itemNames.get(row.itemId)},count:row.count,unit:2},w.now(),state.purse);
 assert.equal(made.ok,true);w.purses.commit(row.merchantId,{...state,commissions:made.next});
}
{
 const w=world(),row=rows[0],elsewhere=legacyMerchants.filter(other=>other.merchantId!==row.merchantId).slice(0,3);
 elsewhere.forEach(other=>seedPromise(w,other));
 assert.equal(w.quote(row).canTake,false);assert.match(w.take(row).text,/three open jobs/);
 assert.equal(w.purses.read(row.merchantId).commissions,undefined,'all merchants share the character limit');
}
{
 const w=world(),row=rows[0],elsewhere=legacyMerchants.filter(other=>other.merchantId!==row.merchantId).slice(0,3);
 elsewhere.slice(0,2).forEach(other=>seedPromise(w,other));w.select(row);let reads=0;
 w.deps.onRankRead=()=>{if(++reads===2)seedPromise(w,elsewhere[2]);};
 w.command('quest','take',row.id,'@2');assert.ok(reads>=2);
 assert.equal(w.purses.read(row.merchantId).commissions,undefined,'final count sees promises added during an eligibility callback');
}
{
 const w=world(),row=rows[0];w.select(row);
 const enumerate=w.purses.ledgerStates;w.purses.ledgerStates=()=>enumerate().slice(1);
 assert.throws(()=>w.command('quest','take',row.id,'@2'),/complete commission ledger/);
 assert.equal(w.purses.read(row.merchantId).commissions,undefined,'incomplete enumeration never reserves a promise');
}
for(const row of rows) {
 const w=world();w.rank({v:1,cls:'other',prof:'other',ranks:{}});
 assert.equal(w.open(row).quests.find(q=>q.id===row.id).canTake,false);
 assert.match(w.command('quest','take',row.id,'@2').text,/requirements/);
 assert.equal(w.purses.read(row.merchantId).commissions,undefined);
}
console.log('PASS all ten compiled commissions: exact specialists, actual gates, pre-goods acceptance, original reserved payment, native settlement and stale-panel refusal');
for(const row of ranked) {
 const w=world(),q=w.quote(row);assert.equal(q.canTake,true,row.id);assert.equal(q.goods.length,row.goods.length);
 assert.equal(q.hours,row.hours);assert.equal(q.gold,row.goods.reduce((sum,good)=>sum+good.count*2,0));
 assert.match(q.quoteToken,/^[0-9a-f]{64}$/);assert.equal(q.quotedUnit,null);
 assert.match(w.take(row).text,/take the work/);const token=w.token(row);
 const state=w.purses.read(row.merchantId),held=state.commissions.held[policy.key(w.box.transfer.identity(10),row.id)];
 assert.equal(held.hours,row.hours);assert.equal(held.gold,q.gold);
 // A partial parcel makes no inventory, stock or purse write.
 row.goods.slice(0,-1).forEach(good=>{w.box.inv[10][good.itemId]=good.count;});
 const before=copy(w.box.inv[10]);w.command('quest','return',row.id,token);
 assert.deepEqual(w.box.inv[10],before);assert.deepEqual(w.purses.read(row.merchantId),state);
 row.goods.forEach(good=>{w.box.inv[10][good.itemId]=good.count;});
 w.unit(9);w.rank({v:1,prof:'other',ranks:{}});w.reload();w.open(row);
 w.command('quest','return',row.id,token);w.settle();
 const paid=w.purses.read(row.merchantId);assert.equal(paid.purse,250-q.gold);assert.equal(w.box.inv[10][15],40+q.gold);
 assert.equal(paid.stock.length,row.goods.length);assert.deepEqual(copy(paid.commissions.cool[policy.key(w.box.transfer.identity(10),row.id)]),[w.now(),row.hours]);
 row.goods.forEach(good=>assert.equal(w.box.inv[10][good.itemId]||0,0));
 w.command('quest','return',row.id,token);assert.equal(w.box.inv[10][15],40+q.gold);
 w.clock(w.now()+row.hours*3600000-1);assert.equal(w.quote(row).state,'cooldown');
 w.clock(w.now()+1);assert.notEqual(w.quote(row).state,'cooldown');
}
for(const row of ranked) {
 const w=world(),q=w.quote(row);w.unit(3);w.command('quest','take',row.id,'@'+q.quoteToken);
 assert.equal(w.purses.read(row.merchantId).commissions,undefined,'changed parcel prices refuse before a reservation');
 w.unit(2);w.select(row);let armed=true;w.deps.onRankRead=()=>{if(armed){armed=false;w.open(row);}};
 w.command('quest','take',row.id,'@'+q.quoteToken);
 assert.equal(w.purses.read(row.merchantId).commissions,undefined,'replacement panels never inherit bundle acceptance');
}
for(const row of ranked.filter(row=>row.tier==='master')) {
 const wrong=row.gate.classKey?{v:1,cls:row.gate.classKey,ranks:{[row.gate.classKey]:'expert'}}:
  row.gate.profession==='mage'?{v:1,prof:'mage',schools:[row.gate.school],ranks:{[row.gate.school]:'master'},spells:{known:[]}}:
  {v:1,prof:row.gate.profession,ranks:{wronghalf:'master',[row.gate.half]:'expert'}};
 assert.equal(rules.allows(row.gate,wrong),false,'Master class/half and mapped school spell are required');
}
for(const row of [rows[0],ranked[0]]) {
 const w=world(),q=w.quote(row);let reads=0;
 w.deps.onRankRead=()=>{if(++reads===2)w.box.actors[10].runtimeIdentity='101';};
 w.command('quest','take',row.id,'@'+(q.quoteToken||q.quotedUnit));
 assert.ok(reads>=2);assert.equal(w.purses.read(row.merchantId).commissions,undefined,
  'native replacement during the final eligibility callback cannot reserve a promise');
}
console.log('PASS231 ranked compiled parcel jobs: actual gates, complete delivery, original multi-item quote, exact cadence and stale-panel refusal');
{
 const row=ranked[ranked.length-1],w=world(1),quote=w.quote(row);
 assert.ok(quote.gold>1);assert.equal(quote.canTake,false);w.take(row);
 assert.equal(w.purses.read(row.merchantId).purse,1);assert.equal(w.purses.read(row.merchantId).commissions,undefined,
  'a valid source parcel cannot create the missing gold or reserve beyond a poor purse');
}
