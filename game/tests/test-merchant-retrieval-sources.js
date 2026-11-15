'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..','..');
const {validateRetrievalSources}=require('../../scripts/dev/MerchantRetrievalSources');
const doc=require('../../game/data/merchant-retrievals.json'),population=require('../../game/data/npc-population.json');
const roster=require('../../game/data/merchant-roster.json'),content=fs.readFileSync(path.join(root,'game/content/Thornswood-Content.esp'));
const copy=v=>JSON.parse(JSON.stringify(v));
assert.equal(validateRetrievalSources(doc,population,content,roster).sources.length,7);
for(const key of ['reference','base','world','position','item','merchant','destination','gold','hours','provenance']) {
 const bad=copy(doc);bad.sources[0][key]=key==='position'?[0,0,0]:'invalid';
 assert.throws(()=>validateRetrievalSources(bad,population,content,roster),/retrieval/i,key);
}
{
 const bad=copy(population);bad.loadOrder[0].sha256='bad';assert.throws(()=>validateRetrievalSources(doc,bad,content,roster),/retrieval/i);
 // A rebuilt own plugin is not a new measurement (#613): the pin names it and leaves its bytes out.
 const rebuilt=copy(population);rebuilt.loadOrder.find(r=>r.name==='Thornswood-Last.esp').sha256='0'.repeat(64);
 assert.equal(validateRetrievalSources(doc,rebuilt,content,roster).sources.length,7,'a rebuilt Last.esp keeps the evidence');
 const moved=copy(population);moved.loadOrder.reverse();assert.throws(()=>validateRetrievalSources(doc,moved,content,roster),/retrieval/i,'a reordered load order is a new measurement');
 const grown=copy(population);grown.loadOrder.splice(grown.loadOrder.length-1,0,{name:'New Revision.esp',sha256:'1'.repeat(64)});
 const {loadOrderSha256}=require('../../scripts/dev/MerchantLoadOrderPin.js');
 assert.throws(()=>validateRetrievalSources(doc,grown,content,roster),/retrieval/i,'evidence from the order before a move is refused');
 assert.equal(validateRetrievalSources({...copy(doc),loadOrderSha256:loadOrderSha256(grown)},grown,content,roster).sources.length,7,'measured again in a moved order that moves no source, it holds (#5191)');
 const bytes=Buffer.from(content);bytes[bytes.length-1]^=1;assert.throws(()=>validateRetrievalSources(doc,population,bytes,roster),/retrieval/i);
 const changed=copy(roster);changed.merchants.find(r=>r.reference===doc.sources[0].merchant).role='Cook';
 assert.throws(()=>validateRetrievalSources(doc,population,content,changed),/retrieval/i,'appointed role cannot drift');
}
const roles=require('../../game/data/merchant-role-tables.json');
for(const source of doc.sources)for(const table of Object.values(roles.tables))for(const direction of ['buy','sell','supply'])
 assert(!table[direction].includes(source.item),'a dedicated token cannot be ordinary merchant stock');
console.log('PASS seven exact retrieval source/merchant/terms proofs, native file provenance and matching Content');
