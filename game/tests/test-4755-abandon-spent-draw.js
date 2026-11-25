'use strict';
// Real quest controller and inventory/property transaction; only the native
// CAS boundary is modeled. Ordinary turn-in remains an exact debit.
const assert = require('node:assert/strict');
const {h} = require('../../tests/merchant-retrieval-fixture');
const {createQuestTransactions} = require('../../game/quest-transactions');
const huntBundles = require('../../game/quest-hunt-bundles');
const retrieval = require('../../game/data/merchant-retrievals.json').sources[0];
const clone = x => JSON.parse(JSON.stringify(x));
const ORE = '5ad9d:Skyrim.esm', TUSK = '3ad6c:Skyrim.esm', SNOUT = '669a4:Skyrim.esm';
let pass = 0, fail = 0;
function check(name, fn) { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message); } }
function fixture(kind = 'ebony', restored) {
  h.reset(); h.fault.write = false;
  const ctx = h.boot().ctx;
  let record = restored ? clone(restored.record) : null, inventory = restored ? clone(restored.inventory) : {entries: []};
  let receipt = restored ? restored.receipt : 'null', saved = restored ? restored.saved : 'null', runtime = '10', session = true, refuse = false, calls = 0, beforeCommit;
  const ids = new Map([[ORE,100], [TUSK,101], [SNOUT,102], [retrieval.item,103], ['f:Skyrim.esm',15]]);
  const trader = 7000, source = 7001;
  const description = id => id === 500 ? 'ff000500:Skyrim.esm' : id === trader ?
    kind === 'mammoth' ? '1a66e:Skyrim.esm' : kind === 'retrieval' ? retrieval.merchant : '1828f:Dragonborn.esm' : retrieval.reference;
  const mp = {
    getActorRuntimeIdentity: () => runtime,
    getNpcAIState: () => ({isHuman:true,profileId:7,lifeGeneration:0}),
    getDescFromId: description, getIdFromDesc: d => ids.get(d),
    get: (id,key) => clone(key === 'inventory' ? inventory : record),
    getInventoryReceipt: () => receipt, getSavedInventoryReceipt: () => saved,
    compareAndSetActorProperty(id,profile,change) { return publish(profile,change); },
    compareAndSetInventoryAndProperty(id,expected,old,next,sequence,profile,change) {
      if (beforeCommit) { const fn = beforeCommit; beforeCommit = undefined; fn(); }
      if (refuse || JSON.stringify(expected) !== JSON.stringify(inventory) || old !== receipt || !publish(profile,change)) return false;
      inventory = clone(next); receipt = JSON.stringify({actor:description(500),profile,sequence}); return true;
    }
  };
  function publish(profile,change) {
    if (refuse || profile !== 7 || change.expectedLifeGeneration !== 0 || change.expectedRuntimeIdentity !== runtime ||
        JSON.stringify(change.expected) !== JSON.stringify(record)) return false;
    calls++; record = clone(change.replacement); return true;
  }
  ctx.mp = mp; ctx.MERCHANT_TRADING.huntBundles = huntBundles;
  const tx = createQuestTransactions({mp,withInventoryMutation:(actor,fn) => receipt === saved ? fn({desc:description(500),profileId:7},()=>true) : {ok:false,why:'waiting'}});
  const deps = {
    now: () => 1000000, goldDesc:'f:Skyrim.esm', load: () => clone(record), commit:tx.commit, identity:tx.identity, available:tx.available,
    eligibility:ctx.MERCHANT_TRADING.createQuestEligibility({table:ctx.__thornswoodProgression.TABLE,spellIds:ctx.__thornswoodProgression.SPELL_IDS}),
    readCharacter:()=>({v:1,cls:'miner',ranks:{miner:'master'}}),
    traderRole:()=>kind === 'mammoth' ? 'Cook' : kind === 'retrieval' ? retrieval.role : 'Smith',
    traderAdmission:()=>()=>session, cellOf:()=> 'reserve', ready:()=>receipt === saved,
    classGate:()=>null,toolGate:()=>null,mining:()=>false,stopMining(){},swinging:()=>false,toolIdIn:()=>1,
    swing:(actor,animation,done)=>done(),swingAnim:'mine',notify(){},say(){},creditWork(){},wearTool(){}
  };
  if (kind === 'retrieval') Object.assign(deps,{retrievalData:{sources:[retrieval]},retrievalSources:{verify:()=>true}});
  if (kind === 'mammoth') deps.mammothSources = {};
  const svc = ctx.__thornswoodCustomQuestsCreate(deps);
  svc.bindPlace('ebony',{cell:'reserve'});
  const quest = kind === 'retrieval' ? retrieval.quest : kind;
  function save() { saved = receipt; }
  function held(item) { return inventory.entries.filter(e=>e.baseId===ids.get(item)).reduce((n,e)=>n+e.count,0); }
  function setHeld(item,count) { inventory.entries = inventory.entries.filter(e=>e.baseId!==ids.get(item)); if(count) inventory.entries.push({baseId:ids.get(item),count}); save(); }
  function draw() {
    if (kind === 'ebony') {
      assert.equal(svc.act(500,'take','ebony',null,trader).ok,true);
      for(let i=0;i<12;i++) { svc.mineRare(500,source,{name:'Ebony Ore',ore:ORE}); save(); }
      assert.equal(record.open.ebony.drawn,12); assert.equal(held(ORE),12);
      assert.match(svc.mineRare(500,source,{name:'Ebony Ore',ore:ORE}),/nothing left/);
    } else if (kind === 'retrieval') {
      assert.equal(svc.act(500,'take',quest,null,trader).ok,true);
      assert.equal(svc.onActivate(500,source),'You take it.'); save();
    } else {
      // A validated native three-body draw has independent tusk and snout totals.
      record = {v:1,open:{mammoth:{drawn:3,kills:0,itemDesc:null,bundles:[
        {ref:'33fa6:Skyrim.esm',life:0,body:'1',goods:[2,3]},
        {ref:'846ea:Skyrim.esm',life:0,body:'2',goods:[2,3]},
        {ref:'846eb:Skyrim.esm',life:0,body:'3',goods:[2,3]}]}},cool:{}};
      assert(huntBundles.readMammothDraw(record.open.mammoth)); setHeld(TUSK,6); setHeld(SNOUT,9);
    }
  }
  return {draw,held,setHeld,save,record:()=>clone(record),inventory:()=>clone(inventory),calls:()=>calls,
    snapshot:()=>clone({record,inventory,receipt,saved}),
    leave:()=>svc.act(500,'abandon',quest,null,trader),turnIn:()=>svc.act(500,'return',quest,null,trader),
    refuse:v=>refuse=v,session:v=>session=v,beforeCommit:fn=>beforeCommit=fn,runtime:v=>runtime=v,
    retake:()=>svc.act(500,'take',quest,null,trader),tryDraw:()=>svc.mineRare(500,source,{name:'Ebony Ore',ore:ORE})};
}
for(const remaining of [0,1,3,11,12,15]) check('full ore draw can be left with '+remaining+' pieces still held',()=>{
  const f=fixture(); f.draw(); f.setHeld(ORE,remaining); const gold=f.held('f:Skyrim.esm');
  assert.equal(f.leave().ok,true); assert.equal(f.held(ORE),Math.max(0,remaining-12));
  assert.equal(f.record().open.ebony,undefined); assert.equal(f.record().cool.ebony,remaining<12?1000000+24*3600000:undefined); assert.equal(f.held('f:Skyrim.esm'),gold);
  f.save();
  if(remaining<12)for(let i=0;i<3;i++) {
    assert.equal(f.retake().ok,false,'missing goods retain the normal cooldown instead of refreshing the draw');
    assert.match(f.tryDraw(),/shut/);assert.equal(f.held(ORE),0);assert.equal(f.held('f:Skyrim.esm'),gold);
  }
  else { assert.equal(f.retake().ok,true); assert.equal(f.retake().ok,false,'only one new job opens'); }
});
check('turn-in still refuses when its full required goods are missing',()=>{
  const f=fixture(); f.draw(); f.setHeld(ORE,3); const before=JSON.stringify([f.record(),f.inventory()]);
  assert.equal(f.turnIn().ok,false); assert.equal(JSON.stringify([f.record(),f.inventory()]),before); assert.equal(f.held('f:Skyrim.esm'),0);
});
check('a spent retrieval token cannot trap its open work',()=>{
  const f=fixture('retrieval');f.draw();f.setHeld(retrieval.item,0);assert.equal(f.leave().ok,true);assert.equal(f.record().open[retrieval.quest],undefined);assert.equal(f.held('f:Skyrim.esm'),0);f.save();assert.equal(f.retake().ok,false);
});
for(const counts of [[0,0],[1,4],[7,10]]) check('mammoth work collects only remaining bundle goods '+counts.join('/'),()=>{
  const f=fixture('mammoth');f.draw();f.setHeld(TUSK,counts[0]);f.setHeld(SNOUT,counts[1]);
  assert.equal(f.leave().ok,true);assert.equal(f.held(TUSK),Math.max(0,counts[0]-6));assert.equal(f.held(SNOUT),Math.max(0,counts[1]-9));assert.equal(f.record().open.mammoth,undefined);assert.equal(f.held('f:Skyrim.esm'),0);assert.equal(f.record().cool.mammoth,counts[0]<6||counts[1]<9?1000000+24*3600000:undefined);
});
check('leaving before drawing anything keeps the existing immediate-retake rule',()=>{
  const f=fixture();assert.equal(f.retake().ok,true);assert.equal(f.leave().ok,true);assert.equal(f.record().cool.ebony,undefined);assert.equal(f.retake().ok,true);
});
check('a saved partial departure stays closed and cooling after a fresh service restart',()=>{
  const f=fixture();f.draw();f.setHeld(ORE,3);assert.equal(f.leave().ok,true);f.save();
  const saved=f.snapshot(),again=fixture('ebony',saved);
  assert.deepEqual(again.snapshot(),saved);assert.equal(again.leave().ok,false);assert.equal(again.retake().ok,false);
  assert.match(again.tryDraw(),/shut/);assert.equal(again.held(ORE),0);assert.equal(again.held('f:Skyrim.esm'),0);
});
for(const mode of ['refused','closed-session','changed-inventory','changed-runtime']) check(mode+' preserves the remaining goods and open record',()=>{
  const f=fixture();f.draw();f.setHeld(ORE,3);
  if(mode==='refused')f.refuse(true);if(mode==='closed-session')f.session(false);
  if(mode==='changed-inventory')f.beforeCommit(()=>f.setHeld(ORE,2));
  if(mode==='changed-runtime')f.beforeCommit(()=>f.runtime('11'));
  const before=f.record(),commits=f.calls();assert.equal(f.leave().ok,false);assert.deepEqual(f.record(),before);assert.equal(f.calls(),commits);assert.equal(f.held(ORE),mode==='changed-inventory'?2:3);
});
console.log('\n'+pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
