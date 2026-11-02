'use strict';
const assert=require('node:assert/strict');
const {createQuestRetrievalSources}=require('../game/quest-resource-sources');
const rows=require('../game/data/merchant-retrievals.json').sources,fixture=require('./retrieval-source-fixture');
for(const row of rows) {
 const w=fixture(),sources=createQuestRetrievalSources(w.mp,rows),ref=w.id(row.reference);
 w.objects.get(10).locationalData={cellOrWorldDesc:row.world,pos:row.position.slice()};
 assert.equal(sources.verify(10,ref),true,row.quest);
 assert.equal(sources.contains(row.reference),true);
}
for(const defect of ['file-index','raw-id','native-field','disabled','deleted','base','space','drift','reach','actor-space','token-value','token-weight','token-type','source-type','query']) {
 const w=fixture(),source=createQuestRetrievalSources(w.mp,rows),row=rows[0],ref=w.id(row.reference),record=w.records.get(ref),obj=w.objects.get(ref);
 if(defect==='file-index')record.fileIndex++;
 if(defect==='raw-id')record.record.id++;
 if(defect==='native-field')record.record.fields.push({type:'EDID',data:Buffer.from('changed')});
 if(defect==='disabled')obj.isDisabled=true;
 if(defect==='deleted')record.record.flags|=0x20;
 if(defect==='base')obj.baseDesc='97f55:Skyrim.esm';
 if(defect==='space')obj.locationalData.cellOrWorldDesc='133c9:Skyrim.esm';
 if(defect==='drift')obj.locationalData.pos[0]+=129;
 if(defect==='reach')w.objects.get(10).locationalData.pos[0]+=401;
 if(defect==='actor-space')w.objects.get(10).locationalData.cellOrWorldDesc='133c9:Skyrim.esm';
 if(defect==='token-value')w.records.get(w.id(row.item)).record.fields[0].data.writeUInt32LE(1);
 if(defect==='token-weight')w.records.get(w.id(row.item)).record.fields[0].data.writeFloatLE(1,4);
 if(defect==='token-type')w.records.get(w.id(row.item)).record.type='CONT';
 if(defect==='source-type')w.records.get(w.id(row.base)).record.type='MISC';
 if(defect==='query')w.objects.delete(ref);
 assert.equal(source.verify(10,ref),false,defect);
}
{
 const w=fixture();w.records.get(w.id(rows[0].reference)).fileIndex++;
 assert.throws(()=>createQuestRetrievalSources(w.mp,rows),/retrieval source/i,'provenance mismatch refuses even with identical live position');
}
console.log('PASS all seven measured native retrieval records, winning provenance, token types, worlds, reach and live failures');
{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const gm=require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname,'../game/gamemode.js'),'utf8'));
 const begin=gm.indexOf('// MERCHANT TRADING BUNDLE BEGIN'),end=gm.indexOf('// MERCHANT TRADING BUNDLE END',begin);
 const ctx={require,Buffer,Uint8Array};vm.createContext(ctx);
 vm.runInContext(gm.slice(begin,end)+'\nthis.api=MERCHANT_TRADING;',ctx);
 const data=ctx.api.retrievalSources();assert.equal(JSON.stringify(data.sources),JSON.stringify(rows));
 const w=fixture(),sources=ctx.api.createQuestRetrievalSources(w.mp,data.sources);
 assert.equal(sources.verify(10,w.id(rows[0].reference)),true);
 const policy=ctx.api.createQuestItemPolicy(w.mp);
 assert.equal(policy.blocked(w.id(rows[0].item)),true);
 assert.equal(policy.blocked(w.id('f:Skyrim.esm')),false);
 console.log('PASS generated retrieval manifest, native validator and bound-item policy exports');
}
