'use strict';
const assert=require('node:assert/strict');
const {createQuestGeodeSources}=require('../game/quest-resource-sources');
const rows=require('../game/data/merchant-scarce-geodes.json').sources;
const copy=v=>JSON.parse(JSON.stringify(v));
function fixture() {
 const ids=new Map(),descs=new Map(),records=new Map(),objects=new Map();let next=1000;
 const id=desc=>{if(!ids.has(desc)){const n=parseInt(desc.split(':')[0],16);ids.set(desc,n);descs.set(n,desc);}return ids.get(desc);};
 const record=(desc,type,fields=[])=>{const n=id(desc);records.set(n,{record:{id:n,type,flags:0,fields},toGlobalRecordId:raw=>raw});return n;};
 for(const row of rows) {
  const base=record(row.base,'ACTI');record(row.item,'SLGM',[{type:'SOUL',data:Buffer.from([0])},{type:'SLCP',data:Buffer.from([1])}]);record(row.world,'WRLD');
  const name=Buffer.alloc(4);name.writeUInt32LE(base);const data=Buffer.alloc(24);row.position.forEach((v,i)=>data.writeFloatLE(v,i*4));
  const ref=record(row.reference,'REFR',[{type:'NAME',data:name},{type:'DATA',data}]);
  objects.set(ref,{baseDesc:row.base,isDisabled:false,locationalData:{cellOrWorldDesc:row.world,pos:row.position.slice()}});
 }
 objects.set(10,{locationalData:{cellOrWorldDesc:rows[0].world,pos:rows[0].position.slice()}});
 const mp={getIdFromDesc:id,getDescFromId:n=>descs.get(n),lookupEspmRecordById:n=>records.get(n),
  get:(n,key)=>objects.get(n)?.[key]};
 return {mp,id,records,objects};
}
{
 const w=fixture(),sources=createQuestGeodeSources(w.mp,rows),ref=w.id(rows[0].reference);
 assert.equal(sources.contains(rows[0].reference),true);assert.equal(sources.contains('other:Skyrim.esm'),false);
 assert.equal(sources.verify(10,ref),true);
 for(const defect of ['disabled','deleted','base','world','position','actor-world','reach','missing','mapping']) {
  const f=fixture(),checked=createQuestGeodeSources(f.mp,rows),n=f.id(rows[0].reference),source=f.objects.get(n),actor=f.objects.get(10);
  if(defect==='disabled')source.isDisabled=true;
  if(defect==='deleted')f.records.get(n).record.flags=0x20;
  if(defect==='base')source.baseDesc='other:Skyrim.esm';
  if(defect==='world')source.locationalData.cellOrWorldDesc='3c:Skyrim.esm';
  if(defect==='position')source.locationalData.pos[0]+=129;
  if(defect==='actor-world')actor.locationalData.cellOrWorldDesc='3c:Skyrim.esm';
  if(defect==='reach')actor.locationalData.pos[0]+=401;
  if(defect==='missing')f.objects.delete(n);
  if(defect==='mapping')f.records.get(n).toGlobalRecordId=()=>123;
  assert.equal(checked.verify(10,n),false,defect);
 }
}
for(const defect of ['header','disabled','item','world','duplicate','nan','missing-name']) {
 const w=fixture(),bad=copy(rows),ref=w.id(rows[0].reference);
 if(defect==='header')w.records.get(ref).record.type='ACHR';
 if(defect==='disabled')w.objects.get(ref).isDisabled=true;
 if(defect==='item')w.records.get(w.id(rows[0].item)).record.type='INGR';
 if(defect==='world')w.records.get(w.id(rows[0].world)).record.type='CELL';
 if(defect==='duplicate')bad[1]=copy(bad[0]);
 if(defect==='nan')bad[0].position[0]=NaN;
 if(defect==='missing-name')w.records.get(ref).record.fields=[];
 assert.throws(()=>createQuestGeodeSources(w.mp,bad),/geode source/i,defect);
}
console.log('PASS exact native geode sources, live disable/deletion, world, bounds, reach and typed source evidence');


const {validateScarceGeodes}=require('../scripts/dev/MerchantScarceGeodeSources');
const doc=require('../game/data/merchant-scarce-geodes.json'),population=require('../game/data/npc-population.json');
assert.equal(validateScarceGeodes(doc,population).sources.length,6);
for(const key of ['reference','base','world','position','item','rank','returnMinutes']) {
 const bad=copy(doc);bad.sources[0][key]=key==='position'?[0,0,0]:'invalid';
 assert.throws(()=>validateScarceGeodes(bad,population),/source evidence/,key);
}
const bad=copy(population);bad.loadOrder[0].sha256='bad';
assert.throws(()=>validateScarceGeodes(doc,bad),/source evidence/);
{const rebuilt=copy(population);rebuilt.loadOrder.find(r=>r.name==='Thornswood-Last.esp').sha256='0'.repeat(64);
 assert.equal(validateScarceGeodes(doc,rebuilt).sources.length,doc.sources.length,'a rebuilt own plugin keeps the evidence (#613)');}


for(const field of ['SOUL','SLCP']) {const w=fixture();w.records.get(w.id(rows[0].item)).record.fields.find(f=>f.type===field).data[0]=2;assert.throws(()=>createQuestGeodeSources(w.mp,rows),/geode source/i);}

{
 const w=fixture(),checked=createQuestGeodeSources(w.mp,rows);
 w.records.get(w.id(rows[0].item)).record.fields.find(f=>f.type==='SOUL').data[0]=1;
 assert.equal(checked.verify(10,w.id(rows[0].reference)),false,'a live filled replacement is not an empty gem');
}

// Exercise the generated production exports, rather than replacing them with
// the controllable adapters used by the harvesting transaction fixture.
{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const gm=require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname,'../game/gamemode.js'),'utf8'));
 const begin=gm.indexOf('// MERCHANT TRADING BUNDLE BEGIN');
 const end=gm.indexOf('// MERCHANT TRADING BUNDLE END',begin);
 const context={require,Buffer,Uint8Array};vm.createContext(context);
 vm.runInContext(gm.slice(begin,end)+'\nthis.api=MERCHANT_TRADING;',context);
 assert.equal(typeof context.api.scarceGeodes,'function');
 assert.equal(typeof context.api.createQuestGeodeSources,'function');
 const data=context.api.scarceGeodes(),native=fixture();
 assert.equal(JSON.stringify(data),JSON.stringify(doc),'the production source manifest matches its validated input');
 const sources=context.api.createQuestGeodeSources(native.mp,data.sources);
 assert.equal(sources.verify(10,native.id(doc.sources[0].reference)),true);
 native.objects.get(native.id(doc.sources[0].reference)).isDisabled=true;
 assert.equal(sources.verify(10,native.id(doc.sources[0].reference)),false);
 console.log('PASS generated production geode exports and actual native source validation');
}

for(const defect of ['base-type','missing-data','moved-native']) {
 const w=fixture(),checked=createQuestGeodeSources(w.mp,rows),ref=w.id(rows[0].reference);
 if(defect==='base-type')w.records.get(w.id(rows[0].base)).record.type='MISC';
 else if(defect==='missing-data')w.records.get(ref).record.fields=w.records.get(ref).record.fields.filter(f=>f.type!=='DATA');
 else {const field=w.records.get(ref).record.fields.find(f=>f.type==='DATA');if(field)field.data.writeFloatLE(0,0);}
 assert.equal(checked.verify(10,ref),false,defect+' must fail native source verification');
}
