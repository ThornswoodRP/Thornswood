"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const {inspectRetirementLedger}=require('../../game/merchant-roster-admission');
const rosterBytes=fs.readFileSync(path.join(__dirname,'../../game/data/merchant-roster.json'));
const roster=JSON.parse(rosterBytes),kept=new Set(roster.merchants.map(row=>row.reference));
const ids=new Map(roster.history.map(([reference],i)=>[reference,i+1]));
const clone=value=>JSON.parse(JSON.stringify(value));
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function encode(doc){doc.sha256=hash(JSON.stringify([doc.version,doc.entries]));return Buffer.from(JSON.stringify(doc));}
function fixture(){
  const doc={version:2,entries:Object.fromEntries(roster.history.map(([reference,base])=>[reference,kept.has(reference)?
    {version:1,reference,base,purse:0,stock:[],unrelated:{keep:'private evidence'}}:null]))};
  return {doc,options:{rosterBytes:Buffer.from(rosterBytes),markerBytes:Buffer.from('1'),world:'dev:test-ledger',
    resolveMerchant:reference=>ids.get(reference),validateInventory:()=>true}};
}
{
  const f=fixture();f.options.ledgerBytes=encode(f.doc);
  const before=Buffer.from(f.options.ledgerBytes),result=inspectRetirementLedger(f.options);
  assert.equal(result.kind,'merchant-ledger-inspection');assert.equal(result.retained,60);assert.equal(result.retired,189);
  assert.equal(result.history,249);assert.equal(result.pending,0);assert.equal(result.ledgerSha256,hash(before));
  assert.ok(Object.isFrozen(result));assert.deepEqual(f.options.ledgerBytes,before);
  assert.ok(!JSON.stringify(result).includes('private evidence'));assert.ok(!JSON.stringify(result).includes(f.options.world));
}
for(const defect of ['checksum','missing-marker','marker','missing-entry','extra-entry','retained-null','base','purse','revision','stock','native','alias','world','utf8']){
  const f=fixture(),reference=roster.merchants[0].reference,state=f.doc.entries[reference];let callbacks=0;
  if(defect==='missing-entry')delete f.doc.entries[reference];
  if(defect==='extra-entry')f.doc.entries['1:Unknown.esp']=null;
  if(defect==='retained-null')f.doc.entries[reference]=null;
  if(defect==='base')state.base='1:Unknown.esp';
  if(defect==='purse')state.purse=-1;
  if(defect==='revision')state.revision=1.5;
  if(defect==='stock')state.stock=[{baseId:15,count:1,name:'Gold'}];
  if(defect==='native')f.options.validateInventory=()=>{callbacks++;return false;};
  if(defect==='alias')f.options.resolveMerchant=()=>1;
  if(defect==='world')delete f.options.world;
  if(defect==='missing-marker')delete f.options.markerBytes;
  if(defect==='marker')f.options.markerBytes=Buffer.from('not initialized');
  f.options.ledgerBytes=encode(f.doc);
  if(defect==='checksum')f.options.ledgerBytes=Buffer.from(f.options.ledgerBytes.toString().replace('private evidence','changed evidence'));
  if(defect==='utf8')f.options.ledgerBytes=Buffer.concat([f.options.ledgerBytes,Buffer.from([255])]);
  const before=Buffer.from(f.options.ledgerBytes);
  assert.throws(()=>inspectRetirementLedger(f.options),/verified|missing|initialized/i,defect);
  assert.deepEqual(f.options.ledgerBytes,before,defect+' preserves exact input bytes');
}
{
  const f=fixture();f.options.ledgerBytes=Buffer.concat([Buffer.from([239,187,191]),encode(f.doc)]);
  assert.equal(inspectRetirementLedger(f.options).ledgerSha256,hash(f.options.ledgerBytes),'legacy BOM is accepted and bound');
}
console.log('PASS read-only ledger membership, retained balances, native validation, aliases and input hashes');

for(const defect of ['count','role','hold','duplicate','history','dynamic-id']) {
  const f=fixture(),policy=clone(roster);
  if(defect==='count')policy.merchants.pop();
  if(defect==='role')policy.merchants[0].role='Merchant';
  if(defect==='hold')policy.merchants[0].hold='Wrong hold';
  if(defect==='duplicate')policy.merchants[1]=clone(policy.merchants[0]);
  if(defect==='history')policy.history[1]=clone(policy.history[0]);
  if(defect==='dynamic-id')f.options.resolveMerchant=()=>0xff000001;
  f.options.rosterBytes=Buffer.from(JSON.stringify(policy));f.options.ledgerBytes=encode(f.doc);
  assert.throws(()=>inspectRetirementLedger(f.options),/verified/,defect);
}
const seedSource=fs.readFileSync(path.join(__dirname,'test-merchant-retirement-inspection.js'),'utf8');
const seedContext={require,console,__dirname};vm.createContext(seedContext);
vm.runInContext(seedSource.slice(0,seedSource.indexOf("for(const boundary")),seedContext);
function savedPending(retired,credit) {
  const f=fixture(),seed=seedContext.buyRecord();
  if(credit){seed.save();const service=seed.make();service.tick();service.shutdown();}
  const state=clone(seed.states.get(1));
  const reference=retired?roster.history.find(([ref])=>!kept.has(ref))[0]:roster.merchants[0].reference;
  state.version=1;state.reference=reference;state.base=new Map(roster.history).get(reference);
  state.pending.reference=reference;state.pending.base=state.base;state.pending.id='saved:'+reference;
  f.doc.entries[reference]=state;return {...f,state,seed};
}
for(const retired of [false,true])for(const credit of [false,true]) {
  const f=savedPending(retired,credit);f.options.ledgerBytes=encode(f.doc);
  const before=Buffer.from(f.options.ledgerBytes),calls=f.seed.calls.length;
  assert.equal(inspectRetirementLedger(f.options).pending,1,'valid saved transfer inspection');
  assert.equal(f.seed.calls.length,calls);assert.deepEqual(f.options.ledgerBytes,before);
}
for(const defect of ['legacy','world','terms','combined','duplicate-human']) {
  const f=savedPending(true,false),intent=f.state.pending;
  if(defect==='legacy'){intent.version=2;delete intent.terms;}
  if(defect==='world')intent.world='main:private evidence';
  if(defect==='terms')intent.terms.gold++;
  if(defect==='combined'){
    const filler={baseId:400,count:1,name:''};intent.expected.entries.push(clone(filler));intent.debit.entries.push(clone(filler));
    const length=131040-Buffer.byteLength(JSON.stringify(intent.debit));
    intent.expected.entries.at(-1).name='x'.repeat(length);intent.debit.entries.at(-1).name='x'.repeat(length);
  }
  if(defect==='duplicate-human'){
    const reference=roster.history.find(([ref])=>!kept.has(ref)&&ref!==f.state.reference)[0];
    const second=clone(f.state);second.reference=reference;second.base=new Map(roster.history).get(reference);
    second.pending.reference=reference;second.pending.base=second.base;second.pending.id='second:'+reference;
    f.doc.entries[reference]=second;
  }
  f.options.ledgerBytes=encode(f.doc);const before=Buffer.from(f.options.ledgerBytes);
  assert.throws(()=>inspectRetirementLedger(f.options),error=>/verified/.test(error.message)&&!error.message.includes('private evidence'),defect);
  assert.deepEqual(f.options.ledgerBytes,before);
}
{
  const f=fixture();f.options.ledgerBytes=encode(f.doc);const original=hash(f.options.ledgerBytes);
  f.options.validateInventory=()=>{f.options.ledgerBytes.fill(120);f.options.rosterBytes.fill(120);return true;};
  const result=inspectRetirementLedger(f.options);
  assert.equal(result.ledgerSha256,original,'fingerprint binds copied evidence before native dependencies');
  assert.equal(result.rosterSha256,hash(rosterBytes));
}
assert.throws(()=>inspectRetirementLedger(null),/verified/);
console.log('PASS roster policy and canonical v3 debit/credit/retired inspection; malformed or legacy transfers refuse');

for(const field of ['ledgerBytes','rosterBytes']) {
  const f=fixture();f.options.ledgerBytes=encode(f.doc);
  f.options[field]=Buffer.alloc((field==='ledgerBytes'?64:1)*1024*1024+1);
  assert.throws(()=>inspectRetirementLedger(f.options),/verified/,field+' size bound');
}
{
  const f=fixture();f.options.ledgerBytes=encode(f.doc);
  f.options.resolveMerchant=()=>{throw new Error('private evidence should never escape');};
  assert.throws(()=>inspectRetirementLedger(f.options),error=>/verified/.test(error.message)&&!error.message.includes('private evidence'));
}
console.log('PASS bounded inspection inputs and private native errors');

for(const direction of ['previous','next']) {
  const f=fixture(),seed=vm.runInContext('context.fixture()',seedContext),before=seed.states.get(1);
  const extra={baseId:301,count:1,name:'Extra stock',entry:{baseId:301,count:1,name:'y'.repeat(500)}};
  let offer;
  if(direction==='previous') {
    const sold={baseId:300,count:1,name:'Sold stock',entry:{baseId:300,count:1,name:'x'.repeat(500)}};
    before.stock=[sold,extra];
    offer={...seed.offer(),kind:'buy',previous:clone(before),next:{purse:253,stock:[clone(extra)],supply:{}},
      debit:{entries:clone(seed.inv.entries)},credit:[clone(sold.entry)]};
    offer.debit.entries[0].count=37;
  } else {
    before.stock=[extra];seed.inv.entries[1].name='x'.repeat(500);
    offer=seed.offer();offer.next.stock[0].entry.name=seed.inv.entries[1].name;
    offer.next.stock.unshift(clone(extra));offer.debit.entries[1].name=seed.inv.entries[1].name;
  }
  const service=seed.make();assert.equal(service.begin(offer).accepted,true);service.shutdown();
  const state=clone(seed.states.get(1)),intent=state.pending;
  if(direction==='previous'){
    intent.phase='credit';state.purse=intent.next.purse;state.stock=clone(intent.next.stock);
  }
  const reference=roster.history.find(([ref])=>!kept.has(ref))[0];
  state.version=1;state.reference=reference;state.base=new Map(roster.history).get(reference);
  intent.reference=reference;intent.base=state.base;intent.id='aggregate:'+reference;
  f.doc.entries[reference]=state;f.options.ledgerBytes=encode(f.doc);
  f.options.validateInventory=snapshot=>Buffer.byteLength(JSON.stringify(snapshot))<=1000;
  const original=Buffer.from(f.options.ledgerBytes);
  assert.throws(()=>inspectRetirementLedger(f.options),/verified/,'full pending '+direction+' stock must pass aggregate native bounds');
  assert.deepEqual(f.options.ledgerBytes,original);
}
console.log('PASS native aggregate bounds on full pending previous and next stock snapshots');
