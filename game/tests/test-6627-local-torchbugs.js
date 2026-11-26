'use strict';
// Real front activation handler + real character owner script. Local critters
// have no remote identity; this fixture models their local script, not a new
// server catch/grant endpoint. Connected Gatherer yield still needs acceptance.
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../..');
const front=fs.readFileSync(process.env.FRONT||path.join(root,'game/plugins/thornswood-front.js'),'utf8').replace(/\r/g,'');
const character=fs.readFileSync(path.join(root,'game/gamemode/character.ts'),'utf8').replace(/\r/g,'');
const a=front.indexOf("  sp.on('activate', guard('activate', (e) => {"),b=front.indexOf('\n  }));\n',a);
if(a<0||b<a)throw Error('real activation handler missing');
const ga=front.indexOf('  // LOCAL TORCHBUG GATE BEGIN'),gb=front.indexOf('  // LOCAL TORCHBUG GATE END',ga);
const ca=character.indexOf('  function updateOwnerScript()'),cb=character.indexOf('\n  try {\n    mp.makeProperty',ca);
if(ca<0||cb<ca)throw Error('real owner script missing');
const owner=new Function(character.slice(ca,cb)+'\nreturn updateOwnerScript();')();
let pass=0,fail=0;
function yes(name,ok){console.log((ok?'PASS ':'FAIL ')+name);ok?pass++:fail++;}
function rig(){
  const handlers={},first=[],notes=[],logs=[],T={},globals={Thornswood:T},refs=[];
  const base={getFormID:()=>0xc2d3f,getType:()=>24,getName:()=> 'Torchbug'};
  const other={getFormID:()=>0x010c2d3f,getType:()=>24,getName:()=> 'Lever'};
  const cell={getNumRefs:t=>t===24?refs.filter(r=>!r.removed).length:0,getNthRef:(i,t)=>t===24?refs.filter(r=>!r.removed)[i]:null};
  const pc={getFormID:()=>0x14,getParentCell:()=>cell};let target=null;
  const sp={on:(event,fn)=>(handlers[event]||(handlers[event]=[])).push(fn),once:(event,fn)=>{if(event==='update')first.push(fn);},
    Game:{getFormFromFile:(id,file)=>id===0xc2d3f&&file==='Skyrim.esm'?base:null,getFormEx:id=>refs.find(r=>r.getFormID()===id&&!r.removed)||null,getPlayer:()=>pc,getCurrentCrosshairRef:()=>target},
    ObjectReference:{from:x=>x},Debug:{notification:text=>notes.push(text)},Utility:{wait:()=>({then(){}})}};
  const source=(ga>=0&&gb>ga?front.slice(ga,gb):'')+front.slice(a,b+7);
  new Function('sp','T','globalThis','guard','say','serverBases','lastForced','lastLogged','DOOR_RESCUE',
    'let reActivating=false;\n'+source)(sp,T,globals,(_name,fn)=>fn,line=>logs.push(line),{},{},{},false);
  function fire(event,e){for(const fn of handlers[event]||[])fn(e);}
  function make({preblocked=false,unrelated=false}={}){
    const ref={blocked:preblocked,consumed:false,yield:0,calls:0,getFormID:()=>0xff004321+refs.length,
      getBaseObject(){if(this.removed)throw Error('deleted reference');return unrelated?other:base;},isActivationBlocked(){return this.blocked;},blockActivation(v){this.blocked=v;},
      activate(){this.calls++;if(!this.blocked&&!this.consumed){this.consumed=true;this.yield++;}}};
    const id=ref.getFormID();ref.getFormID=()=>id;refs.push(ref);return ref;
  }
  return {make,notes,logs,fire,globals,T,first,pc,cell,
    state:classKey=>new Function('ctx','globalThis',owner)({value:{'class':classKey},sp:{printConsole:text=>logs.push(text),browser:{executeJavaScript(){}}}},globals),
    aim:ref=>{target=ref;fire('update');},
    press:ref=>{ref.activate();fire('activate',{target:ref,caster:pc});}};
}
{
  const r=rig(),bug=r.make();r.state('hunter');r.fire('objectLoaded',{object:bug,isLoaded:true});r.press(bug);
  yes('non-Gatherer activation preserves local torchbug and grants nothing',!bug.consumed&&bug.yield===0);
  yes('non-Gatherer receives a useful refusal',r.notes.some(n=>/Gatherer/.test(n)));
}
{
  const r=rig(),bug=r.make();r.fire('objectLoaded',{object:bug,isLoaded:true});r.press(bug);
  yes('unknown character state preserves the torchbug',!bug.consumed&&bug.yield===0);
}
{
  const r=rig(),bug=r.make();r.state('gatherer');r.fire('objectLoaded',{object:bug,isLoaded:true});r.press(bug);
  yes('qualified path is left to one local script activation',bug.consumed&&bug.yield===1&&bug.calls===1&&r.notes.length===0);
}
{
  const r=rig(),lever=r.make({unrelated:true});r.state('hunter');r.fire('objectLoaded',{object:lever,isLoaded:true});r.press(lever);
  yes('unrelated ACTI with same local form number remains unchanged',!lever.blocked&&lever.consumed&&r.notes.length===0);
}
{
  const r=rig(),bug=r.make();r.first.forEach(fn=>fn());
  yes('already-loaded torchbugs are blocked on the initial frame',bug.blocked);
  r.state('gatherer');yes('Gatherer arrival restores only the gate-owned block',!bug.blocked);
  r.state('hunter');yes('losing Gatherer class protects the same live torchbug',bug.blocked);
  r.state('gatherer');r.T.localCritterGate.selectProfile(1000);r.state('gatherer');
  r.T.localCritterGate.selectProfile(1002);yes('character selection resets stale Gatherer permission',bug.blocked);
  r.state('gatherer');r.T.localCritterGate.selectProfile(1002);
  yes('repeating the same selected profile does not revoke the current class',!bug.blocked);
}
{
  const r=rig(),bug=r.make({preblocked:true});r.state('hunter');r.state('gatherer');
  yes('a pre-existing activation block is never lifted',bug.blocked);
  r.fire('preLoadGame');yes('load cleanup also preserves a pre-existing block',bug.blocked);
}
{
  const r=rig();r.state('hunter');const bug=r.make();r.aim(bug);
  yes('current-target handling covers an unannounced local ff reference',bug.blocked&&bug.getFormID()>=0xff000000);
  r.fire('preLoadGame');yes('before load restores a gate-owned flag',!bug.blocked);
  r.fire('loadGame');yes('after load starts unknown and protects already-loaded insects',bug.blocked);
  r.state('gatherer');r.state(undefined);yes('missing authoritative class cannot retain Gatherer permission',bug.blocked);
}
{
  const r=rig(),old=r.make(),live=r.make();r.state('hunter');old.removed=true;r.state('gatherer');
  yes('a vanished local reference does not prevent a later valid class update',!live.blocked);
}
{
  const r=rig(),bug=r.make();r.state('hunter');r.fire('objectLoaded',{object:bug,isLoaded:false});
  yes('unloading releases the activation flag owned by this gate',!bug.blocked);
}
{
  const r=rig(),bug=r.make();r.fire('cellFullyLoaded',{cell:r.cell});
  yes('a fully loaded cell is scanned even without objectLoaded events',bug.blocked);
}
{
  const draws=[],logs=[],globals={Thornswood:{localCritterClass(){throw Error('fixture delivery failed');}}};
  new Function('ctx','globalThis',owner)({value:{'class':'hunter',panel:{'class':'hunter'}},state:{},
    sp:{printConsole:text=>logs.push(text),browser:{executeJavaScript:text=>draws.push(text)}}},globals);
  yes('failed critter delivery does not swallow the existing character panel',draws.length===1);
  yes('failed critter delivery is visible in the client log',logs.some(line=>line.includes('fixture delivery failed')));
}
console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
