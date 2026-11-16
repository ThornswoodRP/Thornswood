"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'test-merchant-settlement.js'),'utf8');
const context={require,console};vm.createContext(context);
vm.runInContext(source.slice(0,source.indexOf('// Four large snapshots')),context);
const copy=value=>JSON.parse(JSON.stringify(value));
function buyRecord(quantity=1) {
  const f=context.fixture(),state=f.states.get(1);
  state.stock=[{baseId:300,count:quantity,name:'Iron Ingot',entry:{baseId:300,count:quantity,name:'Kept name',health:0.7}}];
  const offer={...f.offer(),kind:'buy',previous:copy(state),next:{purse:253,stock:[],supply:{}},
    debit:{entries:copy(f.inv.entries)},credit:[copy(state.stock[0].entry)]};
  offer.debit.entries[0].count=37;
  const service=f.make();assert.equal(service.begin(offer).accepted,true);service.shutdown();f.calls.length=0;
  return f;
}
for(const boundary of ['bytes','native-bytes','count']) {
  const f=buyRecord(boundary==='count'?8:1),p=f.states.get(1).pending;
  if(boundary==='count') {
    const filler=[{baseId:400,count:2147483647},{baseId:401,count:2147483600}];
    p.expected.entries.push(...copy(filler));p.debit.entries.push(...copy(filler));
  } else {
    const filler={baseId:400,count:1,name:''};p.expected.entries.push(copy(filler));p.debit.entries.push(copy(filler));
    const target=boundary==='bytes'?131040:131000;
    const length=target-Buffer.byteLength(JSON.stringify(p.debit));
    p.expected.entries.at(-1).name='x'.repeat(length);p.debit.entries.at(-1).name='x'.repeat(length);
    if(boundary==='native-bytes')f.transfer.validate=snapshot=>Buffer.byteLength(JSON.stringify(snapshot))<=131050;
  }
  const before=JSON.stringify(Array.from(f.states));
  assert.throws(()=>f.make().canRetire(),/large|verified|inventory/i,'combined replacement must pass '+boundary+' constraints');
  assert.equal(f.calls.length,0,'inspection never mutates native inventory');
  assert.equal(JSON.stringify(Array.from(f.states)),before,'inspection never rewrites saved records');
}
console.log('PASS canonical retirement checks combined JS/native replacement limits without writes');
