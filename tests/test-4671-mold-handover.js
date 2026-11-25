'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {createRequire} = require('node:module');
const file = path.join(__dirname,'test-mold-key.js'), source = fs.readFileSync(file,'utf8');
const stop = source.indexOf('if (missingGm.length === 0 && KEY_DESC');
assert(stop > 0);
const realm = {require:createRequire(file),__dirname,process,console:{log(){}},Buffer};
vm.runInNewContext(source.slice(0,stop) + '\nthis.fixture={engine,boot,held,ALICE,BOB,CARL,TAMRIEL,HEX,LABEL,first};',realm);
const h = realm.fixture, copy = x => JSON.parse(JSON.stringify(x));
let pass=0,fail=0;
function check(name,fn) {try {fn();pass++;console.log('PASS '+name);}catch(e){fail++;console.log('FAIL '+name+': '+e.message);}}
function setup(route,self=false,recipe=true) {
  const E=h.engine({recipe}), actor=self?h.ALICE:route==='/mold'?h.CARL:h.BOB;
  const blank=Object.assign(E.blank(),{count:2,health:1.2,enchantmentId:123,chargePercent:0.4});
  const unrelated={baseId:15,count:37,name:'Saved gold',health:1.4};
  E.person(h.ALICE,h.TAMRIEL,[1050,1000,0],self?[copy(blank),copy(unrelated)]:[copy(unrelated)]);
  if(!self) E.person(actor,h.TAMRIEL,[1080,1000,0],[copy(blank),copy(unrelated)]);
  const service=h.boot(E,h.held(),[actor.actor]), before=copy(E.packs);
  return {E,actor,before,run:()=>service.say(actor,route,h.HEX),reply:t=>h.first(t,actor)};
}
for(const route of ['/moldhere','/mold'])for(const self of [false,true]) {
  const label=route+' '+(self?'self':'other');
  check(label+' failed handover preserves the exact blank and unrelated metadata',()=>{
    const f=setup(route,self);
    f.E.native.hook(call=>call.next.entries.some(e=>e.name===h.LABEL)?false:undefined);
    const told=f.run();
    assert.equal(JSON.stringify(f.E.packs),JSON.stringify(f.before));
    assert.equal(f.E.molds(h.ALICE,h.LABEL),0);
    assert.match(f.reply(told),/could not|not delivered/i);
  });
  check(label+' accepted-then-error is delivered once without a blank refund',()=>{
    const f=setup(route,self);
    f.E.native.hook(call=>call.next.entries.some(e=>e.name===h.LABEL)?'throw-after':undefined);
    const told=f.run();
    assert.equal(f.E.blanks(f.actor),1);assert.equal(f.E.molds(h.ALICE,h.LABEL),1);
    assert.doesNotMatch(f.reply(told),/could not|not delivered/i);
    f.E.native.ack(); f.run();
    assert.equal(f.E.blanks(f.actor),1);assert.equal(f.E.molds(h.ALICE,h.LABEL),1);
  });
  check(label+' successful conversion preserves unrelated entries and spends only one blank',()=>{
    const f=setup(route,self);f.run();
    assert.equal(f.E.blanks(f.actor),1);assert.equal(f.E.molds(h.ALICE,h.LABEL),1);
    assert.equal(JSON.stringify(f.E.packs[f.actor.actor].find(e=>e.baseId===15)),JSON.stringify(f.before[f.actor.actor].find(e=>e.baseId===15)));
    assert.equal(JSON.stringify(f.E.packs[h.ALICE.actor].find(e=>e.baseId===15)),JSON.stringify(f.before[h.ALICE.actor].find(e=>e.baseId===15)));
    assert.equal(f.E.native.calls.length,self?1:2);
  });
}
for(const route of ['/moldhere','/mold']) {
  check(route+' precommit throw refunds the exact blank',()=>{
    const f=setup(route);f.E.native.hook(call=>call.actor===h.ALICE.actor?'throw-before':undefined);
    f.run();assert.equal(JSON.stringify(f.E.packs),JSON.stringify(f.before));
  });
  check(route+' refused refund is reported accurately without another handover',()=>{
    const f=setup(route);f.E.native.hook((call,n)=>n>=2?false:undefined);
    const told=f.run();assert.equal(f.E.blanks(f.actor),1);assert.equal(f.E.molds(h.ALICE,h.LABEL),0);
    assert.match(f.reply(told),/blank.*could not|could not.*blank|cannot confirm/i);
    assert.equal(f.E.native.calls.length,3);
  });
  for(const change of ['source-profile','source-runtime','source-inventory','source-receipt',
    'recipient-profile','recipient-runtime','recipient-inventory','recipient-receipt','unreadable-after','unreadable-committed']) {
    check(route+' '+change+' never causes a blind refund',()=>{
      const f=setup(route),oldGet=f.E.mp.get;
      f.E.native.hook((call,n)=>{
        if(n!==2)return;
        if(change==='source-profile')f.E.pid[f.actor.actor]++;
        if(change==='source-runtime')f.E.native.runtime[f.actor.actor]='999';
        if(change==='source-receipt')f.E.native.receipt[f.actor.actor]='null';
        if(change==='source-inventory')f.E.packs[f.actor.actor].push({baseId:99,count:1,name:'Arrived meanwhile'});
        if(change==='recipient-profile')f.E.pid[h.ALICE.actor]++;
        if(change==='recipient-runtime')f.E.native.runtime[h.ALICE.actor]='999';
        if(change==='recipient-inventory')f.E.packs[h.ALICE.actor].push({baseId:99,count:1,name:'Arrived meanwhile'});
        if(change==='recipient-receipt')f.E.native.receipt[h.ALICE.actor]=JSON.stringify({actor:h.ALICE.actor.toString(16),profile:h.ALICE.pid,sequence:1});
        if(change==='unreadable-after'||change==='unreadable-committed')f.E.mp.get=(id,key)=>{if(id===h.ALICE.actor&&key==='inventory')throw Error('unreadable outcome');return oldGet(id,key);};
        if(change==='unreadable-committed')return 'throw-after';
        return false;
      });
      const told=f.run();assert.equal(f.E.blanks(f.actor),1);assert.equal(f.E.native.calls.length,2);
      assert.match(f.reply(told),/could not|cannot confirm|changed/i);
      if(change==='source-inventory')assert(f.E.packs[f.actor.actor].some(e=>e.name==='Arrived meanwhile'));
      if(change==='recipient-inventory')assert(f.E.packs[h.ALICE.actor].some(e=>e.name==='Arrived meanwhile'));
      if(change==='unreadable-committed')assert.equal(f.E.molds(h.ALICE,h.LABEL),1);
    });
  }
  check(route+' unreadable recipient refuses before any blank debit',()=>{
    const f=setup(route),get=f.E.mp.get;
    f.E.mp.get=(id,key)=>{if(id===h.ALICE.actor&&key==='inventory')throw Error('unreadable recipient');return get(id,key);};
    f.run();assert.equal(JSON.stringify(f.E.packs),JSON.stringify(f.before));assert.equal(f.E.native.calls.length,0);
  });
  for (const blocked of ['reserved recipient','unsaved recipient','old lease service','mismatched recipient']) {
    check(route+' '+blocked+' refuses before any blank debit',()=>{
      const f=setup(route), native=f.E.native;
      if (blocked==='reserved recipient') native.reserved.add(h.ALICE.actor);
      if (blocked==='unsaved recipient') native.receipt[h.ALICE.actor]=JSON.stringify({actor:h.ALICE.actor.toString(16),profile:h.ALICE.pid,sequence:1});
      if (blocked==='old lease service') delete native.merchants.withPairedInventoryMutation;
      if (blocked==='mismatched recipient') {
        const paired=native.merchants.withPairedInventoryMutation;
        native.merchants.withPairedInventoryMutation=(actor,holder,change)=>
          paired(actor,holder,(human,alive,recipient)=>change(human,alive,{...recipient,desc:'42'}));
      }
      const told=f.run();
      assert.equal(JSON.stringify(f.E.packs),JSON.stringify(f.before));
      assert.equal(native.calls.length,0);
      assert.match(f.reply(told),/blank was not spent/);
    });
  }
  check(route+' missing CAS refuses before any blank debit',()=>{
    const f=setup(route);delete f.E.mp.compareAndSetInventory;
    f.run();assert.equal(JSON.stringify(f.E.packs),JSON.stringify(f.before));
  });
  check(route+' refused blank debit preserves everything without a handover',()=>{
    const f=setup(route);f.E.native.hook(()=>false);
    f.run();assert.equal(JSON.stringify(f.E.packs),JSON.stringify(f.before));assert.equal(f.E.native.calls.length,1);
  });
  check(route+' refund committed before its publication error is confirmed exactly once',()=>{
    const f=setup(route);f.E.native.hook((call,n)=>n===2?false:n===3?'throw-after':undefined);
    const told=f.run();assert.equal(JSON.stringify(f.E.packs),JSON.stringify(f.before));
    assert.match(f.reply(told),/blank is back/);assert.equal(f.E.native.calls.length,3);
  });
  check(route+' a pending receipt pauses before spending and gives a plain refusal',()=>{
    const f=setup(route);f.E.native.receipt[f.actor.actor]=JSON.stringify({actor:f.actor.actor.toString(16),profile:f.actor.pid,sequence:1});
    const told=f.run();assert.equal(JSON.stringify(f.E.packs),JSON.stringify(f.before));
    assert.match(f.reply(told),/blank was not spent/);assert.equal(f.E.native.calls.length,0);
  });
  check(route+' reserves a refund sequence before debiting for another holder',()=>{
    const f=setup(route);
    f.E.native.receipt[f.actor.actor]=JSON.stringify({actor:f.actor.actor.toString(16),profile:f.actor.pid,sequence:Number.MAX_SAFE_INTEGER-1});
    f.E.native.ack();f.E.native.hook(call=>call.actor===h.ALICE.actor?false:undefined);
    f.run();assert.equal(JSON.stringify(f.E.packs),JSON.stringify(f.before));assert.equal(f.E.native.calls.length,0);
  });
  check(route+' self conversion may use its final safe sequence without a refund slot',()=>{
    const f=setup(route,true);
    f.E.native.receipt[f.actor.actor]=JSON.stringify({actor:f.actor.actor.toString(16),profile:f.actor.pid,sequence:Number.MAX_SAFE_INTEGER-1});
    f.E.native.ack();f.run();
    assert.equal(f.E.blanks(f.actor),1);assert.equal(f.E.molds(h.ALICE,h.LABEL),1);assert.equal(f.E.native.calls.length,1);
  });
}
check('legacy typed mold without a blank recipe retains its existing behavior',()=>{
  const f=setup('/mold',false,false);delete f.E.mp.compareAndSetInventory;
  f.run();assert.equal(f.E.blanks(f.actor),2);assert.equal(f.E.molds(h.ALICE,h.LABEL),1);
});
console.log('\n'+pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
