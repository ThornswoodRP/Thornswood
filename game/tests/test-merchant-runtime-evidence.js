'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const seed=require('../../tests/fixtures/merchant-ledger');
const source=fs.readFileSync(path.join(__dirname,'../../game/gamemode.js'),'utf8'),ctx={require};
vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('// NPC MERCHANT PURSES BEGIN'),source.indexOf('// NPC MERCHANT PURSES END')),ctx);
const os=require('node:os'),scratch=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(scratch,'merchant-evidence-'));
try {
 for(const missing of ['both','ledger','marker'])for(const native of [false,true]) {
  const settings={privDir:path.join(root,missing+native,'private'),dataDir:path.join(root,'served')};
  if(missing!=='both') {
   seed(fs,path,settings.privDir,['1:Skyrim.esm']);
   fs.unlinkSync(path.join(settings.privDir,missing==='ledger'?'merchant-ledger.json':'merchant-ledger.initialized'));
  }
  const before=fs.existsSync(settings.privDir)?fs.readdirSync(settings.privDir).map(name=>[name,fs.readFileSync(path.join(settings.privDir,name),'utf8')]):null;
  let writes=0,nativeWrites=0;const io=Object.create(fs);
  for(const method of ['writeFileSync','mkdirSync','renameSync','openSync'])io[method]=()=>{writes++;throw Error('unexpected write');};
  const writer=native?()=>{nativeWrites++;return true;}:undefined;
  const storage=ctx.createPrivateMerchantLedger(io,path,settings,['1:Skyrim.esm'],writer);
  assert.throws(()=>storage.load(),/missing/i,missing+' evidence must stop before writes');
  assert.equal(writes,0);assert.equal(nativeWrites,0);
  const after=fs.existsSync(settings.privDir)?fs.readdirSync(settings.privDir).map(name=>[name,fs.readFileSync(path.join(settings.privDir,name),'utf8')]):null;
  assert.deepEqual(after,before,'remaining evidence must stay byte-for-byte intact');
 }
 for(const missing of ['ledger','marker']) {
  const settings={privDir:path.join(root,'during-read-'+missing),dataDir:path.join(root,'served')};
  seed(fs,path,settings.privDir,['1:Skyrim.esm']);let nativeWrites=0;const io=Object.create(fs);
  io.readFileSync=(file,encoding)=>{const bytes=fs.readFileSync(file,encoding);fs.unlinkSync(path.join(settings.privDir,missing==='ledger'?'merchant-ledger.json':'merchant-ledger.initialized'));return bytes;};
  const storage=ctx.createPrivateMerchantLedger(io,path,settings,[],()=>{nativeWrites++;return true;});
  assert.throws(()=>storage.load(),/missing/i,'evidence lost during read must stop before native validation rewrite');
  assert.equal(nativeWrites,0);
 }
 {
  const settings={privDir:path.join(root,'after-exists'),dataDir:path.join(root,'served')};seed(fs,path,settings.privDir,['1:Skyrim.esm']);
  const ledger=path.join(settings.privDir,'merchant-ledger.json'),marker=path.join(settings.privDir,'merchant-ledger.initialized'),io=Object.create(fs);let armed=false,nativeWrites=0;
  io.existsSync=file=>{const exists=fs.existsSync(file);if(armed && file===marker && exists){armed=false;fs.unlinkSync(ledger);fs.unlinkSync(marker);}return exists;};
  const storage=ctx.createPrivateMerchantLedger(io,path,settings,['1:Skyrim.esm'],()=>{nativeWrites++;return true;});armed=true;
  assert.throws(()=>storage.load(),/missing|ENOENT/i);assert.equal(nativeWrites,0,'the generic absent-file branch must never initialize a merchant ledger');
 }
 for(const missing of ['ledger','marker']) {
  const settings={privDir:path.join(root,'during-save-'+missing),dataDir:path.join(root,'served')};seed(fs,path,settings.privDir,['1:Skyrim.esm']);
  const io=Object.create(fs);let afterRead=false,nativeWrites=0;
  io.readFileSync=(file,encoding)=>{const bytes=fs.readFileSync(file,encoding);afterRead=true;return bytes;};
  io.realpathSync=file=>{const resolved=fs.realpathSync(file);if(afterRead){afterRead=false;fs.unlinkSync(path.join(settings.privDir,missing==='ledger'?'merchant-ledger.json':'merchant-ledger.initialized'));}return resolved;};
  const storage=ctx.createPrivateMerchantLedger(io,path,settings,[],()=>{nativeWrites++;return true;});
  assert.throws(()=>storage.load(),/missing/i,'evidence lost in save privacy checks must stop native rewrite');assert.equal(nativeWrites,0);
 }
 const settings={privDir:path.join(root,'valid'),dataDir:path.join(root,'served')};seed(fs,path,settings.privDir,['1:Skyrim.esm']);
 const storage=ctx.createPrivateMerchantLedger(fs,path,settings),doc=storage.load();
 doc.entries['1:Skyrim.esm']={version:1,reference:'1:Skyrim.esm',base:'a:Skyrim.esm',revision:9,purse:0,stock:[],pending:{id:'retained'}};
 storage.save(doc);let nativeWrites=0;
 const reopened=ctx.createPrivateMerchantLedger(fs,path,settings,[],(name,bytes)=>{nativeWrites++;assert.equal(name,'merchant');assert.equal(JSON.parse(bytes).entries['1:Skyrim.esm'].purse,0);return true;});
 assert.equal(reopened.load().entries['1:Skyrim.esm'].pending.id,'retained');assert.equal(nativeWrites,1);
 assert.equal(fs.readFileSync(path.join(settings.privDir,'merchant-ledger.initialized'),'utf8'),'1','legacy marker is not migrated');
 console.log('PASS missing merchant world evidence refuses every writer and preserves legacy balances');
} finally {
 assert.ok(root.startsWith(scratch+path.sep));fs.rmSync(root,{recursive:true,force:true});
}
