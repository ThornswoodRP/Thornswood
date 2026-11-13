'use strict';
const crypto=require('node:crypto');
const {loadOrderSha256}=require('./MerchantLoadOrderPin.js');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
// The pin covers what was measured, not the Content plugin's bytes: those are
// checked against the file itself below, so a change to Content (a header, a
// record elsewhere in it) is a rebuild of the manifest, not a new pin (#2993).
// Nor the load order it was measured in (#5191): the manifest names that
// order, held to the catalogue's below, and each source's place in it, held
// to the catalogue's name there. So a new collection revision that moves no
// source is a rebuild on the box, and one that moves a source is a new pin.
const measured=doc=>{
 const m=JSON.parse(JSON.stringify(doc));m.contentSha256='';m.loadOrderSha256='';
 for(const row of m.sources||[])if(row.provenance&&typeof row.provenance==='object'){
  if(row.provenance.plugin==='Thornswood-Content.esp')row.provenance.pluginSha256='';
  row.provenance.fileIndex=null;
 }
 return m;
};
function validateRetrievalSources(doc,population,content,roster) {
 const fail=()=>{throw new Error('Invalid retrieval source evidence');};
 if(!doc||hash(measured(doc))!=='073dcea22f0774ceec6acdd4d1e4208593e88586d8a046821d85eb474b50ea52'||
   !population||loadOrderSha256(population)!==doc.loadOrderSha256||
   !Buffer.isBuffer(content)||crypto.createHash('sha256').update(content).digest('hex')!==doc.contentSha256||
   !roster||!Array.isArray(roster.merchants))fail();
 for(const row of doc.sources) {
  for(const [ref,hold] of [[row.merchant,row.hold],[row.destination,row.quest==='dispatch'?'Eastmarch':row.hold]]) {
   const matches=roster.merchants.filter(r=>r.reference===ref);
   if(matches.length!==1||matches[0].hold!==hold||matches[0].role!==row.role||
     ref===row.destination&&matches[0].bookHold!==row.destinationHold)fail();
  }
  const source=population.loadOrder[row.provenance.fileIndex];
  if(!source||source.name!==row.provenance.plugin||
    (source.name!=='Thornswood-Content.esp'&&source.sha256!==row.provenance.pluginSha256)||
    (source.name==='Thornswood-Content.esp'&&doc.contentSha256!==row.provenance.pluginSha256))fail();
 }
 return JSON.parse(JSON.stringify(doc));
}
module.exports={validateRetrievalSources};
