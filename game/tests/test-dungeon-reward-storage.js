'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../game/gamemode.js'),'utf8');
const ctx={Map,Set,Number,JSON,require};vm.createContext(ctx);
vm.runInContext(source.slice(source.indexOf('// NPC MERCHANT PURSES BEGIN'),source.indexOf('// NPC MERCHANT PURSES END')),ctx);
const root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'tw-dungeon-ledger-'));
try {
  const settings={privDir:path.join(root,'private'),dataDir:path.join(root,'served')};
  const merchant=ctx.createPrivateMerchantLedger(fs,path,settings,['1:Skyrim.esm']);
  require('../../tests/fixtures/merchant-ledger')(fs,path,settings.privDir,['1:Skyrim.esm']);
  merchant.load();const merchantFile=path.join(settings.privDir,'merchant-ledger.json');
  const merchantBytes=fs.readFileSync(merchantFile,'utf8');
  const storage=ctx.createPrivateEconomyLedger(fs,path,settings,'dungeon-rewards',[]);
  assert.equal(Object.keys(storage.load().entries).length,0);
  const record={version:1,entries:{'2:Skyrim.esm':{at:1000000000000,actor:20,tier:1,gold:9,items:[]}}};
  storage.save(record);
  const file=path.join(settings.privDir,'dungeon-rewards-ledger.json');
  assert.equal(ctx.createPrivateEconomyLedger(fs,path,settings,'dungeon-rewards',[]).load().entries['2:Skyrim.esm'].at,1000000000000);
  assert.equal(fs.readFileSync(merchantFile,'utf8'),merchantBytes,'A chest reservation cannot rewrite the merchant purses');
  const previous=fs.readFileSync(file,'utf8'),io=Object.create(fs);
  io.renameSync=()=>{throw new Error('rename denied');};
  assert.throws(()=>ctx.createPrivateEconomyLedger(io,path,settings,'dungeon-rewards',[]).save({version:1,entries:{}}),/rename denied/);
  assert.equal(fs.readFileSync(file,'utf8'),previous);
  fs.writeFileSync(file,previous.replace('1000000000000','1000000000001'));
  assert.throws(()=>storage.load(),/integrity/);
  fs.unlinkSync(file);assert.throws(()=>storage.load(),/missing/);
  assert.throws(()=>ctx.createPrivateEconomyLedger(fs,path,settings,'../served',[]),/Unknown/);
  console.log('PASS separate durable dungeon ledger, reload, corruption, deletion and atomic replacement');
} finally {fs.rmSync(root,{recursive:true,force:true});}
