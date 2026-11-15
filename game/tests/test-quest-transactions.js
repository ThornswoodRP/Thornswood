'use strict';
const assert=require('node:assert/strict');
const {createQuestTransactions,actorIdentity,targetIdentity}=require('../../game/quest-transactions');
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(options={}) {
  let inventory={entries:[{baseId:15,count:40},{baseId:100,count:4,name:'Keepsake',health:0.75}]};
  let record={v:1,open:{wolf:{kills:1}},cool:{}},receipt='null',saved='null',profile=7,pending=false;
  let calls=0,mode='',busy=false,runtime='10';
  const human=()=>({desc:'ff000010:Skyrim.esm',profileId:profile});
  const mp={
    getActorRuntimeIdentity:()=>runtime,
    getNpcAIState:()=>({isHuman:true,profileId:profile,lifeGeneration:0}),
    getDescFromId:()=>human().desc,getIdFromDesc:d=>d==='f:Skyrim.esm'?15:d==='ore:Skyrim.esm'?100:0,
    get:(id,key)=>{if(mode==='readback' && calls)throw Error('readback unavailable');return clone(key==='inventory'?inventory:record);},
    getInventoryReceipt:()=>receipt,getSavedInventoryReceipt:()=>saved,
    compareAndSetActorProperty(id,owner,change) {
      calls++;assert.equal(owner,profile);assert.equal(change.expectedLifeGeneration,0);
      assert.equal(change.expectedRuntimeIdentity,runtime);
      if(mode==='before')throw new Error('before mutation');
      if(mode==='refuse')return false;
      assert.deepEqual(change.expected,record);record=clone(change.replacement);
      if(mode==='unknown' || mode==='readback'){record={other:true};throw new Error('unknown outcome');}
      if(mode==='after')throw new Error('uncertain queued outcome');
      return true;
    },
    compareAndSetInventoryAndProperty(id,expected,old,next,seq,owner,change) {
      calls++;assert.equal(owner,profile);assert.equal(change.expectedLifeGeneration,0);
      assert.equal(change.expectedRuntimeIdentity,runtime);
      if(mode==='before')throw new Error('before mutation');
      if(mode==='refuse')return false;
      assert.deepEqual(expected,inventory);assert.equal(old,receipt);assert.deepEqual(change.expected,record);
      inventory=clone(next);record=clone(change.replacement);
      receipt=JSON.stringify({actor:human().desc,profile,sequence:seq});
      if(mode==='unknown' || mode==='readback'){record={other:true};throw new Error('unknown outcome');}
      if(mode==='after')throw new Error('notification failed');
      return true;
    }
  };
  const transfer=createQuestTransactions({mp,log:options.log,withInventoryMutation:(id,fn)=>{
    if(busy || pending || receipt!==saved)return {ok:false,why:'waiting'};
    busy=true;try{return fn(human(),()=>true);}finally{busy=false;}
  }});
  return {mp,transfer,record:()=>clone(record),inventory:()=>clone(inventory),receipt:()=>receipt,
    calls:()=>calls,mode:m=>mode=m,pending:b=>pending=b,profile:p=>profile=p,runtime:r=>runtime=r,save:()=>saved=receipt};
}
const next={v:1,open:{},cool:{wolf:1000}};
for(const goods of [[],[{item:'f:Skyrim.esm',count:25}]]) {
  const guarded=fixture(),beforeRecord=guarded.record(),beforeInventory=guarded.inventory();
  let current=true,reads=0;
  guarded.mp.getActorRuntimeIdentity=()=>{if(++reads===2)current=false;return '10';};
  assert.equal(guarded.transfer.commit(10,beforeRecord,next,goods,()=>current).ok,false,
    'a native identity callback cannot cross a replaced quest panel');
  assert.equal(guarded.calls(),0);assert.deepEqual(guarded.record(),beforeRecord);assert.deepEqual(guarded.inventory(),beforeInventory);
}
let f=fixture();
assert.equal(f.transfer.commit(10,f.record(),next,[{item:'f:Skyrim.esm',count:25}]).ok,true);
assert.deepEqual(f.record(),next);assert.equal(f.inventory().entries[0].count,65);
assert.equal(f.inventory().entries[1].name,'Keepsake');assert.equal(f.calls(),1);
assert.equal(f.transfer.commit(10,next,next,[]).ok,true,'metadata survives an unsaved preceding inventory commit');
f.save();
assert.equal(f.transfer.commit(10,next,next,[{item:'ore:Skyrim.esm',count:-2}]).ok,true);
assert.equal(f.inventory().entries.find(x=>x.baseId===100).count,2);
assert.equal(f.inventory().entries.find(x=>x.baseId===100).health,0.75);
for(const mode of ['before','refuse']) {
  f=fixture();const before=f.inventory(),record=f.record();f.mode(mode);
  assert.equal(f.transfer.commit(10,record,next,[{item:'f:Skyrim.esm',count:25}]).ok,false);
  assert.deepEqual(f.inventory(),before);assert.deepEqual(f.record(),record);assert.equal(f.receipt(),'null');
}
f=fixture();f.mode('after');
assert.equal(f.transfer.commit(10,f.record(),next,[{item:'f:Skyrim.esm',count:25}]).ok,true,'live receipt establishes a committed write despite notification error');
assert.equal(f.calls(),1);assert.equal(f.inventory().entries[0].count,65);
// A records-only save that throws after the engine wrote it (#4524): the
// record read back is the new one, so it counts as saved, and quests stay on
// for everyone. Before, this one case switched the service off server-wide.
f=fixture();f.mode('after');
const written={...next,open:{ebony:{drawn:1,gem:undefined}}};
{
  const r=f.transfer.commit(10,f.record(),written,[]);
  assert.equal(r.ok,true,'a records-only save found already written counts as saved');
  assert.notEqual(r.uncertain,true);
  assert.deepEqual(f.record(),JSON.parse(JSON.stringify(written)));
  assert.equal(f.transfer.available(),true,'one written save does not switch quests off for everyone');
  f.mode('');
  assert.equal(f.transfer.commit(10,f.record(),next,[]).ok,true,'the next quest step for anybody still saves');
}
// The second outcome: it threw before writing, so the record read back is the
// old one: refused, and the service stays on.
f=fixture();f.mode('before');
{
  const old=f.record(),r=f.transfer.commit(10,old,next,[]);
  assert.equal(r.ok,false);assert.equal(r.why,'unwritten');assert.notEqual(r.uncertain,true);
  assert.deepEqual(f.record(),old);assert.equal(f.transfer.available(),true);
}
f=fixture();f.mode('unknown');
assert.equal(f.transfer.commit(10,f.record(),next,[]).ok,false);assert.equal(f.transfer.available(),false);
f.mode('');assert.equal(f.transfer.commit(10,f.record(),next,[]).ok,false);assert.equal(f.calls(),1);
f=fixture({log:()=>{throw Error('logger failed');}});f.mode('readback');
assert.equal(f.transfer.commit(10,f.record(),next,[]).uncertain,true);
assert.equal(f.transfer.available(),false,'revocation must precede fallible diagnostics');
f=fixture();f.pending(true);
const metadataReceipt=f.receipt(),metadataInventory=f.inventory();
for(let kills=1;kills<=3;kills++) {
  assert.equal(f.transfer.commit(10,f.record(),{...next,open:{camp:{kills}}},[]).ok,true,
    'successive camp kills cannot wait for inventory save acknowledgement');
}
assert.equal(f.calls(),3);assert.equal(f.receipt(),metadataReceipt);assert.deepEqual(f.inventory(),metadataInventory);
assert.equal(f.transfer.commit(10,f.record(),next,[{item:'f:Skyrim.esm',count:25}]).ok,false,
  'goods and rewards remain fenced while a merchant transfer is pending');
f=fixture();const original=f.inventory();
for(const changes of [[{item:'missing',count:1}],[{item:'ore:Skyrim.esm',count:-5}],[{item:'f:Skyrim.esm',count:0.5}]])
  assert.equal(f.transfer.commit(10,f.record(),next,changes).ok,false);
assert.equal(f.calls(),0);assert.deepEqual(f.inventory(),original);
const token=f.transfer.identity(10);f.profile(8);assert.notEqual(f.transfer.identity(10),token);
f.transfer.shutdown();assert.equal(f.transfer.commit(10,f.record(),next,[]).ok,false);
{
  const old=fixture(),before=old.inventory(),record=old.record();
  const replacement={toJSON(){old.runtime('11');return next;}};
  assert.equal(old.transfer.commit(10,record,replacement,[{item:'f:Skyrim.esm',count:25}]).ok,false,
    'replacement serialization cannot adopt a newer native session');
  assert.equal(old.calls(),0);assert.deepEqual(old.inventory(),before);assert.deepEqual(old.record(),record);
}
{
  let runtime='10';
  const mp={getActorRuntimeIdentity:()=>runtime,getNpcAIState:()=>({isHuman:true,profileId:7,lifeGeneration:0}),getDescFromId:()=> 'ff000010:Skyrim.esm'};
  const token=actorIdentity(mp,10);
  assert.deepEqual(JSON.parse(token),{desc:'ff000010:Skyrim.esm',profileId:7,life:0,runtime:'10'});
  runtime='11';
  assert.notEqual(actorIdentity(mp,10),token,'same human life/ownership changes cannot retain the token');
  for(const invalid of [undefined,null,0,1,'','0','01','-1','1.5',' 1','1\n','18446744073709551616']) {
    runtime=invalid;
    assert.equal(actorIdentity(mp,10),null,'unverifiable native revision refuses delayed ownership');
  }
  runtime='18446744073709551615';
  assert.notEqual(actorIdentity(mp,10),null,'uint64 revisions are not truncated by JS numbers');
  runtime='10';
  mp.getDescFromId=()=> 'ff000011:Skyrim.esm';
  assert.notEqual(actorIdentity(mp,10),token,'descriptor replacement cannot retain ownership');
  for(const ai of [null,{isHuman:false,profileId:7,lifeGeneration:0},
    {isHuman:true,profileId:0,lifeGeneration:0},{isHuman:true,profileId:7,lifeGeneration:-1},
    {isHuman:true,profileId:7,lifeGeneration:NaN},{isHuman:true,profileId:7,lifeGeneration:0.5}]) {
    mp.getNpcAIState=()=>ai;
    assert.equal(actorIdentity(mp,10),null,'unverifiable identity refuses delayed ownership');
  }
  mp.getNpcAIState=()=>{throw Error('actor unloaded');};
  assert.equal(actorIdentity(mp,10),null);
}
// A proposed budget is committed through the actual transaction adapter. The
// fixture supplies the native expected-record comparison; it is not a server.
{
  const budget=require('../../game/scene-reward-budget'),now=2000000000000;
  for(const reverse of [false,true]) {
    const f=fixture(),old=f.record(),initial=f.inventory();
    for(const method of ['compareAndSetActorProperty','compareAndSetInventoryAndProperty']) {
      const native=f.mp[method];
      f.mp[method]=function(...args) {
        const change=args[args.length-1];
        if(JSON.stringify(change.expected)!==JSON.stringify(f.record()))return false;
        return native(...args);
      };
    }
    const a=budget.reserve(undefined,'q-first',100,now),b=budget.reserve(undefined,'q-second',100,now);
    assert.equal(a.ok,true);assert.equal(b.ok,true);
    const proposals=reverse?[b,a]:[a,b],keys=reverse?['q-second','q-first']:['q-first','q-second'];
    const nextA={...old,expanded:proposals[0].next},nextB={...old,expanded:proposals[1].next};
    assert.equal(f.transfer.commit(10,old,nextA,[]).ok,true);
    assert.equal(f.transfer.commit(10,old,nextB,[]).ok,false,'one expected record cannot admit both reservations');
    assert.deepEqual(f.inventory(),initial);
    const accepted=f.record(),finish=budget.complete(accepted.expanded,keys[0],proposals[0].token,now+1);
    assert.equal(finish.ok,true);assert.equal(finish.gold,100);
    const paid={...accepted,expanded:finish.next};
    f.mode('refuse');
    assert.equal(f.transfer.commit(10,accepted,paid,[{item:'f:Skyrim.esm',count:finish.gold}]).ok,false);
    assert.deepEqual(f.record(),accepted);assert.deepEqual(f.inventory(),initial);
    f.mode('');
    assert.equal(f.transfer.commit(10,accepted,paid,[{item:'f:Skyrim.esm',count:finish.gold}]).ok,true);
    assert.deepEqual(f.record().open,old.open,'legacy work stays intact');
    assert.equal(f.inventory().entries.find(row=>row.baseId===15).count,140);
    assert.equal(f.record().expanded.paid[0][1],100);
    f.save();
    assert.equal(f.transfer.commit(10,accepted,paid,[{item:'f:Skyrim.esm',count:finish.gold}]).ok,false,
      'a stale completed projection cannot pay twice after the save fence clears');
    assert.equal(f.inventory().entries.find(row=>row.baseId===15).count,140);
  }
}
console.log('PASS quest atomic inventory/state, metadata, save admission, publication errors, refusal, revocation and source-only budget CAS composition');
{
  let body='100',dead=false;
  const ai={isHuman:false,profileId:-1,lifeGeneration:0};
  const mp={getNpcAIState:()=>({...ai,isDead:dead,runtimeLifeIdentity:body}),getDescFromId:()=> '86a88:Skyrim.esm'};
  const alive=targetIdentity(mp,10);assert.notEqual(alive,null);
  dead=true;assert.equal(targetIdentity(mp,10),alive,'a real killing blow still belongs to the same body');
  body='101';assert.notEqual(targetIdentity(mp,10),alive,'ownership or revival revokes an old body');
  ai.profileId=42;assert.notEqual(targetIdentity(mp,10),alive,'target profile replacement is fenced too');
  for(const invalid of [undefined,null,0,'','0','01','1\n','18446744073709551616']) {
    body=invalid;assert.equal(targetIdentity(mp,10),null,'missing or malformed body revisions fail closed');
  }
}
