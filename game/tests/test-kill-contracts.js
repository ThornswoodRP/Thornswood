'use strict';
const assert=require('node:assert/strict');
const population=require('../../game/data/npc-population.json');
const {createKillContracts}=require('../../game/kill-contracts');
const clone=value=>JSON.parse(JSON.stringify(value));
const compact={keep:population.npcs.filter(r=>r.keep).map(r=>[r.ref,r.base,r.world||r.cell,r.pos,r.leash,
  r.returnMinutes,r.role,r.habitat,r.tier,r.cap,r.populationBucket,0,r.species])};
const mode=require('node:fs').readFileSync(require('node:path').join(__dirname,'../../game/gamemode.js'),'utf8');
const runtime=JSON.parse(/const NPC_POPULATION_DATA = ([^\r\n]+);/.exec(mode)[1]);
function world() {
  const states=new Map(),ids=new Map();
  population.npcs.filter(r=>r.keep).forEach((r,i)=>{
    ids.set(r.ref,i+100);states.set(i+100,{ref:r.ref,base:r.base,world:r.world||r.cell,
      pos:r.pos.slice(),race:r.species==='sabre-cat'?'SabreCatRace':r.species+'Race',profileId:-1,isHuman:false,isDead:false,isServerControlled:true,lifeGeneration:0,runtimeLifeIdentity:'100'});
  });
  const mp={getIdFromDesc:ref=>ids.get(ref),getDescFromId:id=>states.get(id).ref,
    getNpcAIState:id=>clone(states.get(id)),get:(id,key)=>key==='baseDesc'?states.get(id).base:
      key==='worldOrCellDesc'?states.get(id).world:undefined};
  const svc=createKillContracts({mp,population:compact,raceOf:id=>states.get(id).race,identity:id=>id===1?'human-session':null});
  return {svc,states,ids,mp};
}
const held=()=>({open:{},expected:{v:1,open:{},cool:{}}});
let w=world();
assert.ok(w.svc.take({open:{},expected:null},'wolf').ok,'a new character has no retained quest record');
assert.equal(w.svc.rows.length,6);
assert.equal(w.svc.rows.reduce((n,r)=>n+r.refs.length,0),14);
for(const row of w.svc.rows) {
  for(const ref of row.refs)assert.ok(population.npcs.some(r=>r.ref===ref&&r.keep));
  const b=held();assert.equal(w.svc.take(b,row.id).ok,true);
  const victim=w.ids.get(row.refs[0]);w.states.get(victim).isDead=true;
  assert.equal(w.svc.credit(b,1,victim).ok,true);
  assert.equal(b.open[row.id].kills,1);
  assert.equal(w.svc.credit(b,1,victim).ok,false,'same body counted once');
  assert.equal(b.open[row.id].kills,1);
  w.states.get(victim).isDead=false;
}
for(const row of world().svc.rows)for(const ref of row.refs) {
  w=world();const b=held(),id=w.ids.get(ref);
  assert.equal(runtime.keep.find(r=>r[0]===ref)[12],compact.keep.find(r=>r[0]===ref)[12]);
  assert.ok(w.svc.take(b,row.id).ok);
  w.states.get(id).isDead=true;
  assert.ok(w.svc.credit(b,1,id).ok,'all fourteen authored sources credit with their canonical race');
  assert.equal(b.open[row.id].kills,1);
}
for(const mutation of [s=>s.isDead=false,s=>s.isHuman=true,s=>s.isServerControlled=false,
  s=>s.lifeGeneration=-1,s=>s.lifeGeneration='0',s=>s.base='7:Skyrim.esm',
  s=>s.world='3c:Skyrim.esm',s=>s.pos[0]+=100000,s=>s.runtimeLifeIdentity='0']) {
  w=world();const b=held();w.svc.take(b,'wolf');const id=w.ids.get('86a88:Skyrim.esm');
  w.states.get(id).isDead=true;mutation(w.states.get(id));
  const before=clone(b);assert.equal(w.svc.credit(b,1,id).ok,false);assert.deepEqual(b,before);
}
w=world();{
  const b=held();w.svc.take(b,'camp');const refs=w.svc.rows.find(r=>r.id==='camp').refs;
  for(const ref of refs.slice(0,3)){const id=w.ids.get(ref);w.states.get(id).isDead=true;assert.ok(w.svc.credit(b,1,id).ok);}
  assert.equal(w.svc.ready(b,'camp'),true);assert.equal(b.open.camp.credited.length,3);
  const saved={v:1,open:clone(b.open),cool:{},killHistory:clone(b.killHistory)};
  const reloaded={open:clone(saved.open),expected:saved};
  assert.equal(w.svc.credit(reloaded,1,w.ids.get(refs[0])).ok,false);
}
{
  const b=held();w.svc.take(b,'wolf');const id=w.ids.get('86a88:Skyrim.esm');w.states.get(id).isDead=true;
  w.svc.credit(b,1,id);w.svc.abandon(b,'wolf');
  b.expected={v:1,open:clone(b.open),cool:{},killHistory:clone(b.killHistory)};
  assert.ok(w.svc.take(b,'wolf').ok);assert.equal(w.svc.credit(b,1,id).ok,false);
  w.states.get(id).lifeGeneration=1;assert.ok(w.svc.credit(b,1,id).ok);
}
{
  const b={open:{wolf:{kills:1}},expected:{v:1,open:{wolf:{kills:1}},cool:{}}};
  assert.equal(w.svc.ready(b,'wolf'),false);assert.ok(w.svc.abandon(b,'wolf').ok);
  assert.equal(b.killUncertain.wolf,true);
  b.expected={v:1,open:{},cool:{},killUncertain:clone(b.killUncertain)};
  assert.ok(w.svc.take(b,'wolf').ok);
  const id=w.ids.get('86a88:Skyrim.esm');assert.equal(w.svc.credit(b,1,id).ok,false);
  w.states.get(id).lifeGeneration++;assert.ok(w.svc.credit(b,1,id).ok);
}
assert.throws(()=>createKillContracts({mp:w.mp,population:{keep:[]},identity:()=>null}),/source/i);
{
  w=world();const b=held();w.svc.take(b,'camp');const id=w.ids.get('50533:Skyrim.esm');
  w.states.get(id).isDead=true;w.svc.credit(b,1,id);
  delete b.killHistory;b.expected.killHistory={};
  const before=clone(b);
  assert.equal(w.svc.credit(b,1,id).ok,false,'lost retained history cannot repeat an existing credit');
  assert.deepEqual(b,before);
}
{
  w=world();const b=held();w.svc.take(b,'wolf');const id=w.ids.get('86a88:Skyrim.esm');
  w.states.get(id).isDead=true;w.svc.credit(b,1,id);delete b.killHistory;
  assert.equal(w.svc.ready(b,'wolf'),false,'completed credits need matching retained history');
  assert.ok(w.svc.abandon(b,'wolf').ok);
  assert.equal(b.killUncertain.wolf,true,'inconsistent saved credits need a recovery floor');
}
for(const id of ['constructor','toString','__proto__']) {
  w=world();const b=held();const before=clone(b);
  assert.equal(w.svc.take(b,id).ok,false);
  assert.equal(w.svc.ready(b,id),false);
  assert.equal(w.svc.available(id),false);
  assert.equal(w.svc.abandon(b,id).ok,false);
  assert.deepEqual(b,before);
}
{
  w=world();const b={open:{wolf:{kills:0,credited:[]}},expected:{killHistory:{'86a88:Skyrim.esm':-1}}};
  assert.ok(w.svc.abandon(b,'wolf').ok,'explicit abandonment remains available with malformed retained history');
  assert.equal(b.expected.killHistory['86a88:Skyrim.esm'],-1,'abandonment never erases malformed history');
  assert.equal(w.svc.take(b,'wolf').ok,false,'invalid history blocks new work pending recovery');
}
{
  w=world();const b=held();w.svc.take(b,'wolf');w.svc.abandon(b,'wolf');w.svc.take(b,'wolf');
  const id=w.ids.get('86a88:Skyrim.esm');w.states.get(id).isDead=true;
  assert.ok(w.svc.credit(b,1,id).ok,'an uncredited living body can count after valid zero-progress abandonment');
}
console.log('PASS six authored kill contracts, exact sources, lifecycle credit, replay protection and legacy recovery');
{
  w=world();const b=held();w.svc.take(b,'wolf');const id=w.ids.get('86a88:Skyrim.esm');
  w.states.get(id).isDead=true;w.states.get(id).race='BearRace';
  assert.equal(w.svc.credit(b,1,id).ok,false,'correct reference and base cannot hide a changed current race');
  const corrupt=clone(compact);corrupt.keep.find(r=>r[0]==='86a88:Skyrim.esm')[12]='bear';
  assert.throws(()=>createKillContracts({mp:w.mp,population:corrupt,raceOf:()=> 'WolfRace',identity:()=>null}),/source/i);
}
