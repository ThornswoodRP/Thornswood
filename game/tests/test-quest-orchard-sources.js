'use strict';
const assert=require('node:assert/strict');
const {createQuestOrchardSources}=require('../../game/quest-resource-sources');
const rows=require('../../game/data/merchant-orchard.json').sources;
function fixture() {
 const ids=new Map(),descs=new Map(),records=new Map(),objects=new Map();let next=1000;
 const id=desc=>{if(!ids.has(desc)){ids.set(desc,next);descs.set(next++,desc);}return ids.get(desc);};
 const field=(type,n)=>{const data=Buffer.alloc(4);data.writeUInt32LE(n);return {type,data};};
 const record=(desc,type,fields=[])=>{const n=id(desc);records.set(n,{record:{id:n,type,flags:0,fields},toGlobalRecordId:raw=>raw});return n;};
 for(const row of rows) {
  const item=record(row.item,'ALCH'),base=record(row.base,'FLOR',[field('PFIG',item)]);record(row.world,'WRLD');
  const data=Buffer.alloc(24);row.position.forEach((v,i)=>data.writeFloatLE(v,4*i));
  const ref=record(row.reference,'REFR',[field('NAME',base),{type:'DATA',data}]);
  objects.set(ref,{baseDesc:row.base,isDisabled:false,locationalData:{cellOrWorldDesc:row.world,pos:row.position.slice()}});
 }
 objects.set(10,{locationalData:{cellOrWorldDesc:rows[0].world,pos:rows[0].position.slice()}});
 return {id,objects,records,mp:{getIdFromDesc:id,getDescFromId:n=>descs.get(n),lookupEspmRecordById:n=>records.get(n),get:(n,key)=>objects.get(n)?.[key]}};
}
for(const defect of ['none','disabled','moved','reach','actor-world','produce','base','deleted']) {
 const f=fixture(),sources=createQuestOrchardSources(f.mp,rows),ref=f.id(rows[0].reference);
 if(defect==='disabled')f.objects.get(ref).isDisabled=true;
 if(defect==='moved')f.objects.get(ref).locationalData.pos[0]+=129;
 if(defect==='reach')f.objects.get(10).locationalData.pos[0]+=401;
 if(defect==='actor-world')f.objects.get(10).locationalData.cellOrWorldDesc='elsewhere';
 if(defect==='produce')f.records.get(f.id(rows[0].base)).record.fields[0].data.writeUInt32LE(15);
 if(defect==='base')f.objects.get(ref).baseDesc='other';
 if(defect==='deleted')f.records.get(ref).record.flags=0x20;
 assert.equal(sources.verify(10,ref),defect==='none',defect);
}
{
 const f=fixture(),bad=JSON.parse(JSON.stringify(rows));bad[0].position=Array(3);
 assert.throws(()=>createQuestOrchardSources(f.mp,bad));
}
console.log('PASS ten exact native orchard references, apple produce, original placements, reach and live refusal boundaries');
