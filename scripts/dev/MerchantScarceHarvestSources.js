'use strict';
const crypto=require('node:crypto');
const {loadOrderSha256}=require('./MerchantLoadOrderPin.js');
// Measured by Build-MerchantRetrievalSources.py in the catalogue's load order
// (#5191). The pin covers what was measured; the order it was measured in is
// held to the catalogue's, so a move that changes no source is a rebuild.
function validateScarceHarvest(doc,population) {
 const sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
 if(!doc||sha({...doc,loadOrderSha256:''})!=='3a28835f938ca15067665ff3602c0133d7d11ddb3c114bc3d1169e84efffadb9'||
    !population||loadOrderSha256(population)!==doc.loadOrderSha256)
  throw new Error('Invalid scarce harvest source evidence');
 return JSON.parse(JSON.stringify(doc));
}
module.exports={validateScarceHarvest};
