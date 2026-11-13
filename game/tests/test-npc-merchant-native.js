'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// Run with no arguments (the nightly), check the gamemode sections this harness loads and SKIP the native part (#1881).
if(!process.argv[2]||!process.argv[3]){
  const src=require('node:fs').readFileSync(require('node:path').join(__dirname,'../../game/gamemode.js'),'utf8');
  for(const m of ["NPC MERCHANT PURSES","NPC POPULATION POLICY","NPC POPULATION DATA"]){
    const b=src.indexOf('// '+m+' BEGIN'),e=src.indexOf('// '+m+' END');
    if(b<0||e<=b){console.error('FAIL: gamemode.js section '+m+' missing');process.exit(1);}
  }
  console.log('SKIP: merchant native check needs <built addon .node path> <installed record .json path> (node game/tests/test-npc-merchant-native.js <addon> <installed.json>); gamemode sections present: NPC MERCHANT PURSES, NPC POPULATION POLICY, NPC POPULATION DATA');
  process.exit(0);
}
const addon=require(path.resolve(process.argv[2]));
const installed=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
assert.equal(installed.loadOrder.length,require('../../game/data/npc-population.json').loadOrder.length,'Use the current verified plugin cast');
const fixture=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'thornswood-merchant-native-'));
process.chdir(fixture);
const dataDir=path.join(fixture,'data');fs.mkdirSync(path.join(dataDir,'scripts'),{recursive:true});
const server=new addon.ScampServer(JSON.stringify({port:0,maxPlayers:2,offlineMode:true,
  name:'merchant-purse-check',dataDir,loadOrder:installed.loadOrder,
  npcEnabled:true,npcAllowEssential:true,npcAllowCrimeFaction:true,npcSettings:{},
  bannedEspmCharacterRaceIds:[0x10760a],logLevel:'error'}));
server._setSelf(server);
const source=fs.readFileSync(path.join(__dirname,'../../game/gamemode.js'),'utf8');
const ctx={Map,Set,Number,Math,JSON,require};vm.createContext(ctx);
for(const marker of ['NPC MERCHANT PURSES','NPC POPULATION POLICY','NPC POPULATION DATA']) {
  vm.runInContext(source.slice(source.indexOf('// '+marker+' BEGIN'),source.indexOf('// '+marker+' END')),ctx);
}
vm.runInContext('globalThis.catalogue=NPC_POPULATION_DATA;',ctx);
const api={};
for(const method of ['makeProperty','get','set','getIdFromDesc','getNpcAIState',
  'setNpcPlacementExclusions','setNpcServerControlled','setNpcDifficultyTier','callPapyrusFunction','getDescFromId']) api[method]=server[method].bind(server);
const data=ctx.catalogue,plugins=installed.loadOrder.map(file=>path.basename(file));
assert.deepEqual(Array.from(data.plugins),plugins);
const references=Array.from(ctx.npcMerchantManifest(data),row=>row.reference);
const storage=ctx.createPrivateMerchantLedger(fs,path,{privDir:path.join(fixture,'private'),dataDir},references);
require('../../tests/fixtures/merchant-ledger')(fs,path,path.join(fixture,'private'),references);
const merchants=ctx.createNpcMerchantPurses(api,data,storage);
const population=ctx.createNpcPopulation(api,data,plugins,merchants);
let cursor=0,total=server.prepareNpcLoad(),loaded=0,merchantIds=[];
while(cursor<total) {
  const batch=server.loadNpcBatch(cursor,16);
  assert.ok(batch.nextCursor>cursor);cursor=batch.nextCursor;total=batch.total;
  for(const id of batch.actorIds) {
    const state=server.getNpcAIState(id);
    assert.equal(population.admit(id,state),true);
    loaded++;
    const purse=merchants.prepare(id);
    if(purse) {assert.equal(purse.purse,250);assert.equal(purse.stock.length,0);merchantIds.push(id);}
  }
}
assert.equal(loaded,data.keep.length);assert.equal(merchantIds.length,60);
assert.equal(merchants.stats().verified,60);assert.equal(merchants.stats().initialized,60);
const chosen=merchantIds[0],reference=server.getDescFromId(chosen),doc=storage.load();
doc.entries[reference].purse=0;doc.entries[reference].stock=[{baseId:0x12eb7,count:5}];storage.save(doc);
merchants.shutdown();assert.throws(()=>merchants.prepare(chosen),/unavailable/);
server.set(chosen,'thornswoodMerchant',null);
server.clear(); // The normal gamemode reload clears property registrations.
const restored=ctx.createNpcMerchantPurses(api,data,storage);
assert.equal(restored.prepare(chosen).purse,0);
assert.equal(restored.prepare(chosen).stock[0].count,5);
assert.equal(restored.stats().initialized,0,'Recovering a lost native save is not another grant');
assert.equal(server.get(chosen,'thornswoodMerchant').purse,0);
console.log(JSON.stringify({passed:true,plugins:plugins.length,loaded,merchants:merchantIds.length,
  purseTotal:60*250,initialStock:0,recoveredPurse:0,recoveredStock:5,nativeMirrorRestored:true}));
restored.shutdown();
const target=fs.realpathSync(fixture);
assert.equal(path.dirname(target),fs.realpathSync(require('node:os').tmpdir()));
process.chdir(require('node:os').tmpdir());fs.rmSync(target,{recursive:true,force:true});
process.exit(0);
