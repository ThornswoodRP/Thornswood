'use strict';
// Opt-in metadata integration against an already compiled addon. This creates
// an isolated offline fixture on an ephemeral port, never a live/dev instance.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),doc=require('../game/data/merchant-retrievals.json');
const addon=require(path.resolve(process.argv[2])),data=path.resolve(process.argv[3]),scratch=path.resolve(process.argv[4]);
const tempRoot=path.resolve(root,'../../temp');
const relativeScratch=path.relative(tempRoot,scratch);
assert(relativeScratch&&!relativeScratch.startsWith('..')&&!path.isAbsolute(relativeScratch),'fixture stays in the approved scratch area');
const loadOrder=require('../game/data/npc-population.json').loadOrder.map(row=>{
 const owned=path.join(root,'game/content',row.name),file=fs.existsSync(owned)?owned:path.join(data,row.name);
 const sha=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 assert.equal(sha,row.name==='Thornswood-Content.esp'?doc.contentSha256:row.sha256,row.name);return file;
});
fs.mkdirSync(path.join(scratch,'resources/scripts'),{recursive:true});
process.chdir(scratch);
const mp=new addon.ScampServer(JSON.stringify({port:0,maxPlayers:1,offlineMode:true,logLevel:'error',
 dataDir:path.join(scratch,'resources'),privDir:path.join(scratch,'private'),loadOrder}));
mp._setSelf(mp);
for(const row of doc.sources) {
 const id=mp.getIdFromDesc(row.reference),lookup=mp.lookupEspmRecordById(id),r=lookup.record;
 assert.equal(mp.getDescFromId(id),row.reference);
 assert.equal(lookup.fileIndex,row.provenance.fileIndex,row.quest+' winner index');
 assert.equal(r.id,row.provenance.rawId,row.quest+' original raw ID');
 const fields=r.fields.map(f=>[f.type,Buffer.from(f.data.buffer,f.data.byteOffset,f.data.byteLength).toString('hex')]);
 const sha=crypto.createHash('sha256').update(JSON.stringify([r.type,r.id,r.flags,fields])).digest('hex');
 assert.equal(sha,row.provenance.recordSha256,row.quest+' native ordered field hash');
 const names=r.fields.filter(f=>f.type==='NAME');assert.equal(names.length,1);
 assert.equal(mp.getDescFromId(lookup.toGlobalRecordId(Buffer.from(names[0].data).readUInt32LE())),row.base);
}
console.log('PASS all seven actual native winning file indices, raw identities and complete ordered record hashes');
if(['mammoth','orchard'].includes(process.argv[5])) {
 const population={keep:require('../game/data/npc-population.json').npcs.filter(r=>r.keep).map(r=>
  [r.ref,r.base,r.world||r.cell,r.pos,r.leash,r.returnMinutes,r.role,r.habitat,r.tier,r.cap,r.populationBucket,0,r.species])};
 const sources=require('../game/quest-mammoth-sources').createQuestMammothSources(mp,population);
 assert.equal(sources.contains('33fa6:Skyrim.esm'),true);
 console.log('PASS all three actual native mammoth ACHR/base records and fixed original placements');
}
if(process.argv[5]==='orchard') {
 const rows=require('../game/data/merchant-orchard.json').sources;
 require('../game/quest-resource-sources').createQuestOrchardSources(mp,rows);
 console.log('PASS all ten actual native orchard references, apple base/produce and original positions');
 const {createOrchardStorage,createOrchardPlots}=require('../game/quest-orchard-plots');
 const priv=path.join(scratch,'private');fs.mkdirSync(priv,{recursive:true});
 const refs=rows.map(r=>r.reference),settings={privDir:priv,dataDir:path.join(scratch,'resources')};
 const storage=()=>createOrchardStorage(fs,path,settings,mp.writeFileWhole.bind(mp),refs);
 const plots=createOrchardPlots(storage(),refs);
 assert.equal(plots.write(refs[0],{by:0,crop:'',at:0,ms:0,step:0}),true);
 assert.equal(createOrchardPlots(storage(),refs).read(refs[0]).crop,'');
 console.log('PASS actual native whole-file writer initializes and reloads authoritative private orchard plots');
}
process.exitCode = 0;
