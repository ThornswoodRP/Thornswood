'use strict';
const assert=require('node:assert/strict'),{createQuestMammothSources}=require('../../game/quest-mammoth-sources');
const all=require('../../game/data/npc-population.json').npcs;
const refs=['33fa6:Skyrim.esm','846ea:Skyrim.esm','846eb:Skyrim.esm'];
const population={keep:all.filter(r=>refs.includes(r.ref)).map(r=>[r.ref,r.base,r.world,r.pos,r.leash,r.returnMinutes,r.role,r.habitat,r.tier,r.cap,r.populationBucket,0,r.species])};
function fixture() {
 const states=new Map(),records=new Map(),props=new Map();
 for(const row of population.keep) {
  const id=parseInt(row[0],16),base=parseInt(row[1],16),name=Buffer.alloc(4),data=Buffer.alloc(24);
  name.writeUInt32LE(base);row[3].forEach((v,i)=>data.writeFloatLE(v,4*i));
  records.set(id,{record:{id,type:'ACHR',flags:0,fields:[{type:'NAME',data:name},{type:'DATA',data}]},toGlobalRecordId:v=>v});
  records.set(base,{record:{id:base,type:'NPC_',flags:0,fields:[]},toGlobalRecordId:v=>v});
  states.set(id,{profileId:-1,isHuman:false,isServerControlled:true,isDead:true,isDisabled:false,lifeGeneration:0,runtimeLifeIdentity:String(id),pos:row[3].slice()});
  props.set(id,{baseDesc:row[1],worldOrCellDesc:row[2]});
 }
 props.set(10,{locationalData:{cellOrWorldDesc:'3c:Skyrim.esm',pos:population.keep[0][3].slice()}});
 const mp={getIdFromDesc:desc=>parseInt(desc,16),getDescFromId:id=>id.toString(16)+':Skyrim.esm',
  lookupEspmRecordById:id=>records.get(id),getNpcAIState:id=>states.get(id),get:(id,key)=>props.get(id)?.[key]};
 return {mp,states,records,props};
}
for(const ref of refs) {
 const w=fixture(),n=parseInt(ref,16),sources=createQuestMammothSources(w.mp,population);
 w.props.get(10).locationalData.pos=w.states.get(n).pos.slice();
 const body=sources.read(10,n);assert(body,ref);assert.equal(body.ref,ref);assert.equal(sources.verify(10,n,body),true);
 w.states.get(n).runtimeLifeIdentity='9999';assert.equal(sources.verify(10,n,body),false,'body replacement expires the receipt');
}
for(const defect of ['alive','human','profile','disabled','authority','bounds','leash','reach','world','base','life','body','native-base']) {
 const w=fixture(),id=parseInt(refs[0],16),sources=createQuestMammothSources(w.mp,population),s=w.states.get(id);
 if(defect==='alive')s.isDead=false;if(defect==='human')s.isHuman=true;if(defect==='profile')s.profileId=7;
 if(defect==='disabled')s.isDisabled=true;if(defect==='authority')s.isServerControlled=false;
 if(defect==='bounds')s.pos[0]=1001;if(defect==='leash')s.pos[2]+=2049;
 if(defect==='reach')w.props.get(10).locationalData.pos[0]+=401;
 if(defect==='world')w.props.get(id).worldOrCellDesc='elsewhere:Skyrim.esm';
 if(defect==='base')w.props.get(id).baseDesc='23ab4:Skyrim.esm';
 if(defect==='life')s.lifeGeneration=-1;if(defect==='body')s.runtimeLifeIdentity='01';
 if(defect==='native-base')w.records.get(id).record.fields[0].data.writeUInt32LE(1);
 assert.equal(sources.read(10,id),null,defect);
}
console.log('PASS exact three native mammoths, original placement/leash/ground, dead server ownership, body identity and reach');
{
 const w=fixture(),bad=JSON.parse(JSON.stringify(population)),row=bad.keep[0],id=parseInt(row[0],16);
 row[3][0]+=10;w.records.get(id).record.fields[1].data.writeFloatLE(row[3][0],0);
 assert.throws(()=>createQuestMammothSources(w.mp,bad),/source evidence/,'matching modified population and native positions cannot move an original source');
}
