'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../../game/gamemode.js'),'utf8');
const begin=source.indexOf('// NPC POPULATION POLICY BEGIN'),end=source.indexOf('// NPC POPULATION POLICY END');
assert.ok(begin>=0 && end>begin,'Production population policy must be present');
const context={Map,Set,Math,Number,JSON};vm.createContext(context);vm.runInContext(source.slice(begin,end),context);
const descriptors=new Map([['1:Skyrim.esm',1],['2:Skyrim.esm',2],['3:Skyrim.esm',3],['a:Skyrim.esm',10],['3c:Skyrim.esm',60]]);
function fixture(){
  const writes=[],props=new Map(),excluded=[];
  const api={makeProperty(){},getIdFromDesc:d=>descriptors.get(d),
    getDescFromId:id=>id.toString(16)+':Skyrim.esm',
    setNpcPlacementExclusions:ids=>excluded.push(...ids),
    get:(id,p)=>p==='baseDesc' ? 'a:Skyrim.esm' : props.get(id+':'+p),
    set:(id,p,v)=>{props.set(id+':'+p,v);writes.push({id,p,v});}};
  const data={version:1,plugins:['Skyrim.esm'],cut:['2:Skyrim.esm'],keep:[
    ['1:Skyrim.esm','a:Skyrim.esm','3c:Skyrim.esm',[10,20,30],100,45,'animal','farm',null,3,'farm1']]};
  const policy=context.createNpcPopulation(api,data,['Skyrim.esm']);
  return {api,policy,props,writes,excluded,data};
}
const plain=x=>JSON.parse(JSON.stringify(x));
const state={pos:[10,20,30],cellOrWorld:60,isHuman:false};
// No cut list goes to the engine (#2468): Thornswood-Last.esp switches every
// cut placement off at the record, so a catalogue row left out is simply not
// configured.
const f=fixture();assert.deepEqual(f.excluded,[]);
assert.deepEqual(plain(f.policy.configure(1,state)),{home:[10,20,30],cell:60,leash:100,swims:false,ambush:false});
// Row 11 (#2067): 1 a race that swims and cannot walk, kept below the depth it
// was placed at; 2 an ambush placement.
{
  const g=fixture();
  g.data.keep[0].push(3);
  const flagged=context.createNpcPopulation(g.api,g.data,['Skyrim.esm']);
  assert.deepEqual(plain(flagged.configure(1,state)),{home:[10,20,30],cell:60,leash:100,swims:true,ambush:true,top:30});
  g.data.keep[0][11]=2;
  const ambush=context.createNpcPopulation(g.api,g.data,['Skyrim.esm']);
  assert.deepEqual(plain(ambush.configure(1,state)),{home:[10,20,30],cell:60,leash:100,swims:false,ambush:true});
}
assert.equal(f.props.get('1:spawnDelay'),2700);assert.equal(f.policy.returnMinutes(1),45);
assert.equal(f.policy.configure(2,state),null);assert.equal(f.policy.configure(3,state),null);
assert.equal(f.policy.configure(0xff000010,{...state,isHuman:true}),null);
assert.equal(f.policy.configure(0xff000010,{...state,cellOrWorld:99}),null);
const dyn=f.policy.configure(0xff000011,state);assert.ok(dyn);assert.equal(f.policy.returnMinutes(0xff000011),45);
assert.deepEqual(plain(f.props.get(0xff000011+':spawnPoint')),
  {cellOrWorldDesc:'3c:Skyrim.esm',pos:[10,20,30],rot:[0,0,0]});
assert.ok(f.policy.configure(0xff000012,state));
assert.equal(f.policy.configure(0xff000013,state),null,'Shared habitat cap includes authored and dynamic residents');
assert.throws(()=>context.createNpcPopulation(f.api,{version:1,plugins:['Update.esm'],cut:[],keep:[]},['Skyrim.esm']));
const restored=fixture(),dynamicId=0xff000020;
assert.ok(restored.policy.configure(dynamicId,{...state,pos:[100,20,30]}));
const next=context.createNpcPopulation(restored.api,restored.data,['Skyrim.esm']);
assert.ok(next.configure(dynamicId,{...state,pos:[190,20,30]}),
  'A restored NPC inside its accepted home leash remains enrolled after moving');
console.log('NPC population runtime checks passed');

const freed=fixture();
assert.ok(freed.policy.configure(0xff000021,state));
assert.ok(freed.policy.configure(0xff000022,state));
assert.equal(freed.policy.configure(0xff000023,state),null);
assert.equal(typeof freed.policy.reconcile,'function','Destroyed dynamic identities must release their habitat capacity');
freed.policy.reconcile([1,0xff000022]);
assert.ok(freed.policy.configure(0xff000024,state),'A destroyed actor releases one slot');
assert.equal(freed.policy.configure(0xff000025,state),null,'A still-loaded dead actor retains its return slot');

const place=source.match(/^function placeActors\([^\r\n]*\)[\s\S]*?^\}/m);
assert.ok(place);
function spawnFixture(allow,commanded,keep) {
  const events=[],markers=[];
  const ctx={Math,Number,globalThis:null,serverRunId:()=>'run-now',mp:{lookupEspmRecordById:()=>({record:{type:'NPC_'}}),
    place:()=>0xff000010,set:(id,name,value)=>{events.push(name);if(name==='thornswoodNpcCommanded') markers.push(value);},
    getNpcAIState:()=>state,destroyActor:()=>events.push('destroy')},
    __thornswoodNpcPopulation:{configure:()=>allow?{home:state.pos,cell:60,leash:100}:null,
      admit:()=>{events.push('admit');return allow;},release:()=>events.push('release')},
    __thornswoodNpcRuntime:{enroll:()=>events.push('enroll')}};
  ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(place[0],ctx);
  const result=ctx.placeActors(10,{desc:'3c:Skyrim.esm',pos:state.pos,rot:[0,0,0]},1,0,commanded,keep);
  return {result,events,markers};
}
const refused=spawnFixture(false);
assert.equal(refused.result.made,0,'A habitat/cap refusal cannot count as a successful birth or encounter');
assert.ok(refused.events.includes('destroy'));
const admitted=spawnFixture(true);
assert.equal(admitted.result.made,1);
assert.ok(admitted.events.includes('admit') && admitted.events.includes('enroll'),
  'A dynamic actor enters server authority before the successful spawn returns');
console.log('Dynamic population lifecycle checks passed');

const failedBirth=fixture(),failedId=0xff000030,write=failedBirth.api.set;
failedBirth.api.set=(id,name,value)=>{
  if(id===failedId && name==='spawnDelay') throw new Error('Delay persistence unavailable');
  return write(id,name,value);
};
assert.throws(()=>failedBirth.policy.configure(failedId,state));
failedBirth.policy.release(failedId);failedBirth.policy.reconcile([1]);
assert.ok(failedBirth.policy.configure(0xff000031,state));
assert.ok(failedBirth.policy.configure(0xff000032,state),
  'An unsuccessful birth cannot permanently consume a habitat slot');
assert.equal(failedBirth.policy.configure(0xff000033,state),null);
console.log('Failed birth capacity recovery checks passed');

const commanded=fixture(),commandedId=0xff000040;
// A temporary spawn made in this run of the server (#2623).
const RUN={run:'run-now'};
commanded.policy=context.createNpcPopulation(commanded.api,commanded.data,['Skyrim.esm'],null,RUN);
commanded.props.set(commandedId+':thornswoodNpcCommanded',{run:'run-now'});
const away={...state,pos:[9000,8000,30],cellOrWorld:99};
const explicit=commanded.policy.configure(commandedId,away);
assert.ok(explicit,'An explicit command is accepted outside authored habitats');
assert.deepEqual(plain(explicit.home),away.pos);
assert.equal(explicit.cell,99);
assert.notEqual(commanded.props.get(commandedId+':isDisabled'),true);
const reloaded=context.createNpcPopulation(commanded.api,commanded.data,['Skyrim.esm'],null,RUN);
assert.ok(reloaded.configure(commandedId,{...away,pos:[9200,8000,30]}),
  'The persisted command marker survives rediscovery and a gamemode reload in the same run');
assert.deepEqual(plain(reloaded.configure(commandedId,away).home),away.pos,
  'Rediscovery retains the command location as its home');
assert.ok(commanded.policy.configure(0xff000041,state));
assert.ok(commanded.policy.configure(0xff000042,state));
assert.equal(commanded.policy.configure(0xff000043,state),null,
  'Explicit commands do not consume or remove ordinary habitat caps');
commanded.props.set(0xff000044+':thornswoodNpcCommanded',{run:'run-now'});
assert.equal(commanded.policy.configure(0xff000044,{...away,isHuman:true}),null,
  'The command marker cannot enroll a human');
console.log('Commanded spawn persistence and habitat isolation checks passed');

// #2623: a spawn is temporary unless staff keep it.
{
  const t=fixture(),discarded=[];
  const opts={run:'run-now',discard:id=>discarded.push(id)};
  const pol=context.createNpcPopulation(t.api,t.data,['Skyrim.esm'],null,opts);
  // Made this run and not kept: admitted, and marked temporary for death.
  t.props.set(0xff000050+':thornswoodNpcCommanded',{run:'run-now'});
  assert.ok(pol.configure(0xff000050,away));
  assert.equal(pol.isTemporary(0xff000050),true,'A spawn staff did not keep is temporary');
  // Kept: admitted in any run, and not temporary.
  t.props.set(0xff000051+':thornswoodNpcCommanded',{keep:true});
  assert.ok(pol.configure(0xff000051,away));
  assert.equal(pol.isTemporary(0xff000051),false,'A kept spawn stays');
  // Left from an earlier run: not admitted, handed to the gamemode to remove.
  t.props.set(0xff000052+':thornswoodNpcCommanded',{run:'run-before'});
  assert.equal(pol.configure(0xff000052,away),null,'A temporary spawn from an earlier run is not admitted');
  // The plain true every spawn carried before #2623 was never a choice to keep.
  t.props.set(0xff000053+':thornswoodNpcCommanded',true);
  assert.equal(pol.configure(0xff000053,away),null,'An old spawn nobody chose to keep is not admitted');
  assert.deepEqual(discarded,[0xff000052,0xff000053],'Both leftovers are handed over for removal, once each');
  // An ordinary resident is never temporary.
  assert.ok(pol.configure(1,state));assert.equal(pol.isTemporary(1),false);
  // The marker placeActors writes.
  assert.deepEqual(plain(spawnFixture(true,true,false).markers),[{run:'run-now'}],'An unkept spawn names this run');
  assert.deepEqual(plain(spawnFixture(true,true,true).markers),[{keep:true}],'keep marks it kept');
  console.log('Temporary and kept spawn checks passed');
}
