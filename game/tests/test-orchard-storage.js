'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createOrchardStorage,createOrchardPlots}=require('../../game/quest-orchard-plots');
const refs=require('../../game/data/merchant-orchard.json').sources.map(r=>r.reference);
const parent=fs.mkdtempSync(path.join(os.tmpdir(),'thornswood-orchard-'));
try {
 const priv=path.join(parent,'private'),served=path.join(parent,'resources');fs.mkdirSync(priv);fs.mkdirSync(served);
 let writes=0,throwAfterWrite=false;
 const writer=(file,text)=>{writes++;fs.writeFileSync(file,text);if(throwAfterWrite)throw Error('publication acknowledgement unavailable');};
 const make=()=>createOrchardStorage(fs,path,{privDir:priv,dataDir:served},writer,refs);
 const storage=make(),p=createOrchardPlots(storage,refs);assert.equal(p.read(refs[0]),null);
 assert.equal(writes,2,'first initialization writes plots and evidence');
 p.write(refs[0],{by:0,crop:'',at:0,ms:0,step:0});
 assert.equal(createOrchardPlots(make(),refs).read(refs[0]).crop,'','reload reads authoritative cleared plot');
 const file=path.join(priv,'orchard-plots.json'),before=writes;
 fs.unlinkSync(file);assert.throws(()=>make().load(),/missing/);assert.equal(writes,before,'missing saved file cannot reset plots');
 fs.writeFileSync(file,'{}');assert.throws(()=>make().load(),/damaged/);assert.equal(writes,before);
 for(const location of [served,path.join(served,'private')]) {
  assert.throws(()=>createOrchardStorage(fs,path,{privDir:location,dataDir:served},writer,refs).load(),/private/);
 }
 fs.unlinkSync(file);fs.unlinkSync(file+'.initialized');
 const q=createOrchardPlots(make(),refs);throwAfterWrite=true;
 assert.equal(q.write(refs[0],{by:0,crop:'',at:0,ms:0,step:0}),false);
 assert.equal(q.available(),false,'write with unknown acknowledgement revokes its owner');
 throwAfterWrite=false;assert.equal(createOrchardPlots(make(),refs).read(refs[0]).crop,'');
} finally {
 assert(path.resolve(parent).startsWith(path.resolve(os.tmpdir())+path.sep+'thornswood-orchard-'));
 fs.rmSync(parent,{recursive:true,force:true});
}
console.log('PASS private authoritative orchard storage, initialization evidence, corruption/missing-state refusal and unknown writes');
