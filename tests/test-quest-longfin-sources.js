'use strict';
const assert=require('node:assert/strict');
const {createQuestLongfinSources}=require('../game/quest-resource-sources');
const rows=require('../scripts/dev/MerchantScarceLongfinSources').longfinSources(require('../game/data/quest-content.json')).sources;
const copy=v=>JSON.parse(JSON.stringify(v));
function fixture() {
 const ids=new Map(),descs=new Map(),records=new Map(),objects=new Map();let next=1000;
 const id=desc=>{if(!ids.has(desc)){ids.set(desc,next);descs.set(next++,desc);}return ids.get(desc);};
 const record=(desc,type,fields=[])=>{const n=id(desc);records.set(n,{record:{id:n,type,flags:0,fields},toGlobalRecordId:raw=>raw});return n;};
 for(const row of rows) {
  const base=record(row.base,'FLOR'),ingredient=record(row.item,'INGR');record(row.world,'WRLD');
  const produce=Buffer.alloc(4);produce.writeUInt32LE(ingredient);records.get(base).record.fields=[{type:'PFIG',data:produce}];
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
 const w=fixture(),sources=createQuestLongfinSources(w.mp,rows),ref=w.id(rows[0].reference);
 assert.equal(sources.contains(rows[0].reference),true);assert.equal(sources.contains('other:Skyrim.esm'),false);
 assert.equal(sources.verify(10,ref),true);
 for(const defect of ['disabled','deleted','base','world','position','actor-world','reach','missing','mapping']) {
  const f=fixture(),checked=createQuestLongfinSources(f.mp,rows),n=f.id(rows[0].reference),source=f.objects.get(n),actor=f.objects.get(10);
  if(defect==='disabled')source.isDisabled=true;
  if(defect==='deleted')f.records.get(n).record.flags=0x20;
  if(defect==='base')source.baseDesc='other:Skyrim.esm';
  if(defect==='world')source.locationalData.cellOrWorldDesc='800:Dragonborn.esm';
  if(defect==='position')source.locationalData.pos[0]+=129;
  if(defect==='actor-world')actor.locationalData.cellOrWorldDesc='800:Dragonborn.esm';
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
 if(defect==='item')w.records.get(w.id(rows[0].item)).record.type='MISC';
 if(defect==='world')w.records.get(w.id(rows[0].world)).record.type='CELL';
 if(defect==='duplicate')bad[1]=copy(bad[0]);
 if(defect==='nan')bad[0].position[0]=NaN;
 if(defect==='missing-name')w.records.get(ref).record.fields=[];
 assert.throws(()=>createQuestLongfinSources(w.mp,bad),/longfin source/i,defect);
}
console.log('PASS exact native longfin sources, live disable/deletion, world, bounds, reach and typed source evidence');

const {validateScarceFishing}=require('../scripts/dev/MerchantScarceFishingSources');
const doc=require('../game/data/merchant-scarce-fishing.json'),locations=require('../game/data/resource-locations.json');
assert.equal(validateScarceFishing(doc,locations).sources.length,3);
for(const key of ['reference','base','world','position','item','rank','returnMinutes']) {
 const bad=copy(doc);bad.sources[0][key]=key==='position'?[0,0,0]:'invalid';
 assert.throws(()=>validateScarceFishing(bad,locations),/source evidence/,key);
}

for(const mode of ['wrong-produce','missing-produce']) {
 const w=fixture(),base=w.records.get(w.id(rows[0].base));
 if(mode==='wrong-produce')base.record.fields[0].data.writeUInt32LE(w.id('other:Skyrim.esm'));
 else base.record.fields=[];
 assert.throws(()=>createQuestLongfinSources(w.mp,rows),/longfin source/i,mode);
}
{
 const w=fixture(),sources=createQuestLongfinSources(w.mp,rows);
 w.records.get(w.id(rows[0].base)).record.fields[0].data.writeUInt32LE(w.id('other:Skyrim.esm'));
 assert.equal(sources.verify(10,w.id(rows[0].reference)),false,'live produce substitution refuses');
}
const {longfinSources}=require('../scripts/dev/MerchantScarceLongfinSources'),content=require('../game/data/quest-content.json');
for(const key of ['ref','base','space','pos','interior']) {
 const bad=copy(content);bad.sites.longfin1[key]=key==='pos'?[NaN,0,0]:key==='interior'?true:'invalid';
 assert.throws(()=>longfinSources(bad),/Longfin/,key);
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
 assert.equal(typeof context.api.scarceLongfin,'function');
 assert.equal(typeof context.api.createQuestLongfinSources,'function');
 const data=context.api.scarceLongfin(),native=fixture();
 assert.equal(JSON.stringify(data),JSON.stringify(longfinSources(content)),'the production source manifest matches its validated input');
 const sources=context.api.createQuestLongfinSources(native.mp,data.sources);
 assert.equal(sources.verify(10,native.id(rows[0].reference)),true);
 native.objects.get(native.id(rows[0].reference)).isDisabled=true;
 assert.equal(sources.verify(10,native.id(rows[0].reference)),false);
 console.log('PASS generated production longfin exports and actual native source validation');
}
