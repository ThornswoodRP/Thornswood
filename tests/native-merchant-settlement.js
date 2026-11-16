'use strict';
// Opt-in native integration: addon path and the verified installed plugin order.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createNativeMerchantTransfer,installMerchantTrading}=require('../game/merchant-trading');
const {createSettlement,takeEntries}=require('../game/merchant-settlement');
const {createQuestTransactions,actorIdentity,targetIdentity}=require('../game/quest-transactions');
const addon=require(path.resolve(process.argv[2]));
const installed=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'tw-native-settlement-'));
const source=fs.readFileSync(path.join(__dirname,'../game/gamemode.js'),'utf8');
const ctx={Map,Set,Number,JSON,require};vm.createContext(ctx);
vm.runInContext(source.slice(source.indexOf('// NPC MERCHANT PURSES BEGIN'),source.indexOf('// NPC MERCHANT PURSES END')),ctx);
(async function () {
  const settings={port:0,maxPlayers:2,offlineMode:true,logLevel:'error',npcEnabled:true,npcAllowEssential:true,npcAllowCrimeFaction:true,
    privDir:path.join(root,'private'),dataDir:path.join(root,'resources'),loadOrder:installed.loadOrder};
  fs.mkdirSync(path.join(settings.dataDir,'scripts'),{recursive:true});
  const served=path.join(root,'data');fs.mkdirSync(served);
  process.chdir(root);
  const mp=new addon.ScampServer(JSON.stringify(settings)); mp._setSelf(mp); mp.attachSaveStorage();
  assert.equal(typeof mp.writePrivateEconomyLedger,'function');
  const merchantId=mp.getIdFromDesc('13487:Skyrim.esm');
  const base=mp.get(merchantId,'baseDesc');
  const data={keep:[['13487:Skyrim.esm',base,null,null,null,null,'trader']]};
  const storage=ctx.createPrivateMerchantLedger(fs,path,settings,['13487:Skyrim.esm'],mp.writePrivateEconomyLedger.bind(mp));
  require('./fixtures/merchant-ledger')(fs,path,settings.privDir,['13487:Skyrim.esm']);
  const purseApi={}; for(const key of ['makeProperty','getIdFromDesc','getNpcAIState','get','set']) purseApi[key]=mp[key].bind(mp);
  let purses=ctx.createNpcMerchantPurses(purseApi,data,storage); purses.prepare(merchantId);
  const human=mp.createActor(0,mp.get(merchantId,'pos'),0,mp.getIdFromDesc(mp.get(merchantId,'worldOrCellDesc')),7);
  const iron=0x5ace4;
  mp.set(human,'inventory',{entries:[{baseId:15,count:40},{baseId:iron,count:3,name:'Kept name',health:0.7,chargePercent:0.4}]});
  const transfer=createNativeMerchantTransfer(mp);
  let settle=createSettlement({purses,transfer,world:purses.namespace});
  const expected=mp.get(human,'inventory'),out=takeEntries(expected,iron,1);
  const previous=purses.prepare(merchantId);
  const offer={merchantId,humanId:human,profileId:7,previous,expected,debit:out.inventory,credit:[{baseId:15,count:3}],kind:'sell',
    next:{purse:247,stock:[{baseId:iron,count:1,name:'Iron Ingot',entry:out.entries[0]}],supply:{}}};
  assert.equal(settle.begin(offer).accepted,true);
  assert.equal(mp.get(human,'inventory').entries.find(x=>x.baseId===15).count,40,'real native debit cannot release incoming gold before acknowledgement');
  settle.shutdown();purses.shutdown();mp.clear();
  // Recreate the actual controller and canonical private file while the native
  // save worker is active. No fake receipt or persistence acknowledgement.
  purses=ctx.createNpcMerchantPurses(purseApi,data,storage);
  settle=createSettlement({purses,transfer,world:purses.namespace});
  for(let i=0;i<600 && purses.read(merchantId).pending;i++) {
    mp.tick(); settle.tick(); await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(purses.read(merchantId).pending,null,'both exact native receipts must be saved');
  assert.equal(purses.read(merchantId).purse,247);
  assert.equal(mp.get(human,'inventory').entries.find(x=>x.baseId===15).count,43);
  assert.equal(purses.read(merchantId).stock[0].entry.name,'Kept name');
  assert.equal(purses.read(merchantId).stock[0].entry.health,out.entries[0].health);
  const receipt=mp.getInventoryReceipt(human);
  assert.equal(mp.getSavedInventoryReceipt(human),receipt);
  for(let i=0;i<10;i++){mp.tick();settle.tick();}
  assert.equal(mp.getInventoryReceipt(human),receipt,'completion cannot replay the credit');
  assert.throws(()=>mp.compareAndSetInventory(human,mp.get(human,'inventory'),receipt,mp.get(human,'inventory'),3,9),/profile/);
  assert.throws(()=>mp.writePrivateEconomyLedger('../served','bad'),/Unknown/);
  // Canonical native float JSON uses more bytes than JSON.stringify at the
  // boundary. The read-only validator must reject this before any debit.
  const beforeValidation=mp.get(human,'inventory'),beforeReceipt=mp.getInventoryReceipt(human);
  const near={entries:[{baseId:15,count:40},{baseId:iron,count:1,health:1,name:''}]};
  near.entries[1].name='x'.repeat(131072-Buffer.byteLength(JSON.stringify(near)));
  assert.equal(Buffer.byteLength(JSON.stringify(near)),131072);
  assert.throws(()=>mp.validateInventoryTransaction(near),/round trip/);
  assert.deepEqual(mp.get(human,'inventory'),beforeValidation);
  assert.equal(mp.getInventoryReceipt(human),beforeReceipt);
  assert.equal(mp.validateInventoryTransaction(beforeValidation),true);

  settle.shutdown();
  const panel=installMerchantTrading({mp,purses,
    catalog:{byRef:{'13487:Skyrim.esm':{name:'Lucan',locationName:'Riverwood',bookHold:'whiterun'}}},
    g:{__thornswoodBooks:{guildPrice:()=>({buy:3,sell:5}),catalog:()=>[{name:'Iron Ingot',buy:3,sell:5}]},
      __thornswoodResolveItem:()=>({baseId:iron,name:'Iron Ingot'})},
    timers:{setTimeout:()=>1,clearTimeout(){}},log:console.log});
  assert.equal(panel.nativeReady(),true);
  const opened=panel.activate(human,merchantId);
  assert.equal(opened.view?.open,true,opened.text);
  assert.equal(opened.view.transfer,true,'actual native actor identity/reach opens usable trade panel');
  panel.command({actorId:human,profileId:7,parts:['/merchant','buy','1','Iron','Ingot']});
  for(let i=0;i<600 && purses.read(merchantId).pending;i++) {mp.tick();panel.recover();await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(purses.read(merchantId).pending,null);
  assert.equal(purses.read(merchantId).purse,252);
  assert.equal(purses.read(merchantId).stock.length,0);
  assert.equal(mp.get(human,'inventory').entries.find(x=>x.baseId===15).count,38);
  assert.equal(mp.get(human,'inventory').entries.find(x=>x.baseId===iron).count,3);
  assert.equal(mp.get(human,'inventory').entries.find(x=>x.baseId===iron).name,'Kept name');
  // Real native identities and separate saved receipts for two supply owners.
  const current=mp.get(human,'inventory');
  current.entries.find(x=>x.baseId===iron).count=8;
  mp.set(human,'inventory',current);
  const secondHuman=mp.createActor(0,mp.get(merchantId,'pos'),0,mp.getIdFromDesc(mp.get(merchantId,'worldOrCellDesc')),8);
  mp.set(secondHuman,'inventory',{entries:[{baseId:15,count:40},{baseId:iron,count:8}]});
  panel.command({actorId:human,profileId:7,parts:['/merchant',merchantId.toString(16)]});
  assert.equal(panel.command({actorId:human,profileId:7,parts:['/merchant','supply','Iron','Ingot']}).view.open,true);
  for(let i=0;i<600 && purses.read(merchantId).pending;i++){mp.tick();panel.recover();await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(purses.read(merchantId).pending,null);
  assert.equal(mp.get(human,'inventory').entries.find(x=>x.baseId===15).count,53);
  const secondOffer=panel.command({actorId:secondHuman,profileId:8,parts:['/merchant',merchantId.toString(16)]});
  assert.equal(secondOffer.view.supply.find(x=>x.name==='Iron Ingot').ready,true);
  panel.command({actorId:secondHuman,profileId:8,parts:['/merchant','supply','Iron','Ingot']});
  for(let i=0;i<600 && purses.read(merchantId).pending;i++){mp.tick();panel.recover();await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(purses.read(merchantId).pending,null);
  assert.equal(mp.get(secondHuman,'inventory').entries.find(x=>x.baseId===15).count,55);
  assert.equal(purses.read(merchantId).purse,222);
  assert.equal(purses.read(merchantId).stock.reduce((sum,x)=>sum+x.count,0),10);
  assert.equal(Object.keys(purses.read(merchantId).supply).length,2);
  assert.equal(mp.getSavedInventoryReceipt(secondHuman),mp.getInventoryReceipt(secondHuman));
  const largeHuman=mp.createActor(0,mp.get(merchantId,'pos'),0,mp.getIdFromDesc(mp.get(merchantId,'worldOrCellDesc')),9);
  const largeInventory={entries:[{baseId:15,count:40,name:''},{baseId:iron,count:8}]};
  largeInventory.entries[0].name='x'.repeat(131000-Buffer.byteLength(JSON.stringify(largeInventory)));
  assert.equal(mp.validateInventoryTransaction(largeInventory),true);
  mp.set(largeHuman,'inventory',largeInventory);
  panel.command({actorId:largeHuman,profileId:9,parts:['/merchant',merchantId.toString(16)]});
  panel.command({actorId:largeHuman,profileId:9,parts:['/merchant','supply','Iron','Ingot']});
  for(let i=0;i<600 && purses.read(merchantId).pending;i++){mp.tick();panel.recover();await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(purses.read(merchantId).pending,null,'native-valid large inventory must fit its complete recovery record');
  assert.equal(mp.get(largeHuman,'inventory').entries.filter(x=>x.baseId===15).reduce((sum,x)=>sum+x.count,0),55);
  assert.equal(purses.read(merchantId).purse,207);
  assert.equal(mp.getSavedInventoryReceipt(largeHuman),mp.getInventoryReceipt(largeHuman));
  // Run the production quest caller through the merchant controller's actual
  // admission lease and the native save worker, rather than a fake CAS.
  mp.makeProperty('thornswoodQuests',{isVisibleByOwner:false,isVisibleByNeighbors:false,updateOwner:'',updateNeighbor:''});
  const quests=createQuestTransactions({mp,withInventoryMutation:panel.withQuestInventoryMutation});
  assert.equal(quests.available(),true);
  const questBefore=mp.get(human,'inventory'),questGold=questBefore.entries.filter(x=>x.baseId===15).reduce((n,x)=>n+x.count,0);
  const questRecord={v:1,open:{},cool:{wolf:123456}};
  assert.equal(quests.commit(human,null,questRecord,[{item:'f:Skyrim.esm',count:25}]).ok,true);
  assert.deepEqual(mp.get(human,'thornswoodQuests'),questRecord);
  assert.equal(mp.get(human,'inventory').entries.filter(x=>x.baseId===15).reduce((n,x)=>n+x.count,0),questGold+25);
  assert.deepEqual(mp.get(human,'inventory').entries.filter(x=>x.baseId!==15),questBefore.entries.filter(x=>x.baseId!==15));
  const questReceipt=mp.getInventoryReceipt(human);
  assert.equal(quests.commit(human,questRecord,questRecord,[]).ok,true,'metadata can queue while a goods receipt is unsaved');
  assert.equal(mp.getInventoryReceipt(human),questReceipt,'metadata does not advance the goods receipt');
  assert.equal(quests.commit(human,questRecord,questRecord,[{item:'f:Skyrim.esm',count:1}]).ok,false,
    'another goods transaction still waits for its exact saved receipt');
  assert.equal(mp.get(human,'inventory').entries.filter(x=>x.baseId===15).reduce((n,x)=>n+x.count,0),questGold+25);
  for(let i=0;i<600 && mp.getSavedInventoryReceipt(human)!==questReceipt;i++){mp.tick();await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(mp.getSavedInventoryReceipt(human),questReceipt);
  assert.equal(quests.commit(human,null,questRecord,[{item:'f:Skyrim.esm',count:25}]).ok,false,'a stale quest record cannot pay twice');
  assert.equal(mp.getInventoryReceipt(human),questReceipt);
  assert.equal(panel.questReady(human),true,'saved quest receipts are accepted by merchant admission');
  const initialToken=actorIdentity(mp,human),initialBody=targetIdentity(mp,human),initialLife=mp.getNpcAIState(human).lifeGeneration;
  mp.set(human,'isDead',true);
  assert.notEqual(actorIdentity(mp,human),initialToken,'real human death must revoke the canonical caller token');
  assert.equal(targetIdentity(mp,human),initialBody,'a valid killing blow retains its native body');
  mp.set(human,'isDead',false);
  assert.notEqual(actorIdentity(mp,human),initialToken,'real human respawn cannot restore the old caller token');
  assert.notEqual(targetIdentity(mp,human),initialBody,'a real human respawn must revoke the queued target body');
  assert.equal(mp.getNpcAIState(human).lifeGeneration,initialLife,'the persisted NPC counter is not the human session fence');
  const inventoryBeforeReentry=mp.get(human,'inventory');
  const reentrantExpected={toJSON() {
    mp.set(human,'isDead',true);mp.set(human,'isDead',false);
    return questRecord;
  }};
  assert.equal(quests.commit(human,reentrantExpected,questRecord,[{item:'f:Skyrim.esm',count:25}]).ok,false,
    'native CAS must reject a human lifecycle change during argument serialization');
  assert.deepEqual(mp.get(human,'inventory'),inventoryBeforeReentry);
  assert.equal(mp.getInventoryReceipt(human),questReceipt);
  assert.deepEqual(mp.get(human,'thornswoodQuests'),questRecord);
  quests.shutdown();
  panel.shutdown();purses.shutdown();
  const alias=path.join(served,'private-alias');
  fs.symlinkSync(settings.privDir,alias,process.platform==='win32'?'junction':'dir');
  const ledger=path.join(settings.privDir,'merchant-ledger.json');
  const before=fs.readFileSync(ledger);
  assert.throws(()=>mp.writePrivateEconomyLedger('merchant','corrupt'),/alias/);
  assert.deepEqual(fs.readFileSync(ledger),before,'a served alias must refuse writes without changing the private ledger');
  const exposed=new addon.ScampServer(JSON.stringify({...settings,privDir:path.join(served,'private')}));exposed._setSelf(exposed);
  assert.throws(()=>exposed.writePrivateEconomyLedger('merchant','exposed'),/outside|alias/,'configured dataDir must not hide the actual HTTP root');
  console.log('PASS real addon durable ledger, profile-bound CAS, exact saved debit/credit, reload, metadata, quest atomicity and conservation');
  process.chdir(os.tmpdir());
  // Native save storage can still hold handles: retain this isolated evidence
  // directory for inspection rather than deleting files under its worker.
  process.exitCode = 0;
})().catch(error=>{console.error(error);process.exitCode = 1;});
