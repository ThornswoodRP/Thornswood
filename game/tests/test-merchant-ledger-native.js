'use strict';
const assert=require('node:assert/strict');
const {createLedgerNativeValidators}=require('../../game/merchant-ledger-native');
function fixture(light=false) {
  const reference='1234:Skyrim.esm',base=light?'827:Goods.esl':'827:Goods.esp';
  const referenceId=0x1234,baseId=light?0xfe029827:0x03000827;
  const name=Buffer.alloc(4);name.writeUInt32LE(0x01000827);
  // The winning placement is an override with a different master mapping.
  const placement={record:{id:0x02001234,type:'ACHR',fields:[{type:'NAME',data:name}]},
    toGlobalRecordId(raw){
      if((raw>>>24)===2)return raw&0xffffff;
      if((raw>>>24)===1)return light?0xfe029000+(raw&0xfff):0x03000000+(raw&0xffffff);
      return 0;
    }};
  // The base's own override has different masters again. Its mapping cannot
  // be substituted for the placement's NAME mapping.
  const npc={record:{id:0x02000827,type:'NPC_',fields:[]},
    toGlobalRecordId(raw){
      if((raw>>>24)===2)return light?0xfe029000+(raw&0xfff):0x03000000+(raw&0xffffff);
      if((raw>>>24)===1)return 0x04000000+(raw&0xffffff);
      return 0;
    }};
  let validates=0;
  const mp={
    getIdFromDesc:desc=>desc===reference?referenceId:desc===base?baseId:0,
    getDescFromId:id=>id===referenceId?reference:id===baseId?base:'unknown',
    lookupEspmRecordById:id=>id===referenceId?placement:id===baseId?npc:{},
    validateInventoryTransaction(snapshot){validates++;assert.deepEqual(snapshot,{entries:[]});return true;}
  };
  // Any actor, storage or lifecycle API would violate the adapter's contract.
  for(const key of ['get','set','prepareNpcLoad','loadNpcBatch','tick','attachSaveStorage','writePrivateEconomyLedger'])
    mp[key]=()=>{throw new Error('Forbidden native operation: '+key);};
  return {mp,reference,base,referenceId,baseId,placement,npc,name,validates:()=>validates};
}
for(const light of [false,true]) {
  const f=fixture(light),adapter=createLedgerNativeValidators(f.mp),snapshot={entries:[]};
  assert.ok(Object.isFrozen(adapter));
  assert.equal(adapter.resolveMerchant(f.reference,f.base),f.referenceId);
  assert.equal(adapter.validateInventory(snapshot),true);assert.deepEqual(snapshot,{entries:[]});
  assert.equal(f.validates(),1);
  for(const method of ['getIdFromDesc','getDescFromId','lookupEspmRecordById','validateInventoryTransaction'])
    f.mp[method]=()=>{throw new Error('replacement must not run');};
  assert.equal(adapter.resolveMerchant(f.reference,f.base),f.referenceId,'captures native methods');
  assert.equal(adapter.validateInventory(snapshot),true);
}
for(const defect of ['placement-type','base-type','missing-record','missing-name','duplicate-name','truncated-name',
  'array-name','wrong-name','wrong-header','wrong-base-header','name-light-alias','header-light-alias',
  'dynamic','description-alias','bad-mapping','native-error']) {
  const f=fixture(true);
  if(defect==='placement-type')f.placement.record.type='REFR';
  if(defect==='base-type')f.npc.record.type='ARMO';
  if(defect==='missing-record')delete f.placement.record;
  if(defect==='missing-name')f.placement.record.fields=[];
  if(defect==='duplicate-name')f.placement.record.fields.push(f.placement.record.fields[0]);
  if(defect==='truncated-name')f.placement.record.fields[0].data=Buffer.alloc(3);
  if(defect==='array-name')f.placement.record.fields[0].data=[0x27,8,0,1];
  if(defect==='wrong-name')f.name.writeUInt32LE(0x01000828);
  if(defect==='wrong-header')f.placement.record.id++;
  if(defect==='wrong-base-header')f.npc.record.id++;
  if(defect==='name-light-alias')f.name.writeUInt32LE(0x01001827);
  if(defect==='header-light-alias')f.npc.record.id=0x02001827;
  if(defect==='dynamic')f.mp.getIdFromDesc=()=>0xff000001;
  if(defect==='description-alias')f.mp.getDescFromId=()=>f.reference;
  if(defect==='bad-mapping')f.placement.toGlobalRecordId=()=>NaN;
  if(defect==='native-error')f.mp.lookupEspmRecordById=()=>{throw new Error('private path and evidence');};
  assert.throws(()=>createLedgerNativeValidators(f.mp).resolveMerchant(f.reference,f.base),
    error=>error.message==='Native merchant ledger evidence cannot be verified.',defect);
}
for(const key of ['getIdFromDesc','getDescFromId','lookupEspmRecordById','validateInventoryTransaction']) {
  const f=fixture();delete f.mp[key];assert.throws(()=>createLedgerNativeValidators(f.mp),/cannot be verified/);
}
for(const value of [false,1,'true',undefined]) {
  const f=fixture();f.mp.validateInventoryTransaction=()=>value;
  assert.throws(()=>createLedgerNativeValidators(f.mp).validateInventory({entries:[]}),/cannot be verified/);
}
{
  const f=fixture();f.mp.validateInventoryTransaction=()=>{throw new Error('private inventory details');};
  assert.throws(()=>createLedgerNativeValidators(f.mp).validateInventory({entries:[]}),
    error=>error.message==='Native merchant ledger evidence cannot be verified.');
}
assert.throws(()=>createLedgerNativeValidators(null),/cannot be verified/);
for(const light of [false,true]) {
  const f=fixture(light);f.npc.record.type='ARMO';f.npc.record.flags=0;
  const adapter=createLedgerNativeValidators(f.mp);
  assert.equal(adapter.resolveItem(f.base,'ARMO'),f.baseId);
  assert.throws(()=>adapter.resolveItem(f.base,'WEAP'),/cannot be verified/,'resolvable wrong-type item refuses');
  for(const flags of [4,0x20,undefined,-1,0x100000000]) {
    f.npc.record.flags=flags;assert.throws(()=>adapter.resolveItem(f.base,'ARMO'),/cannot be verified/,'untradeable or malformed flags');
  }
}
console.log('PASS native ledger full/light override identity binding, light aliases, read-only APIs and inventory validation');
