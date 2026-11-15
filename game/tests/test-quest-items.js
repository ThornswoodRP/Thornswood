'use strict';
const assert=require('node:assert/strict');
const {createQuestItemPolicy}=require('../../game/quest-items');
let desc='17000:Thornswood-Content.esp',broken=false;
const mp={getDescFromId(id){assert.equal(this,mp);if(broken)throw new Error('native identity unavailable');return desc;}};
const policy=createQuestItemPolicy(mp);assert(Object.isFrozen(policy));
for(let n=0;n<7;n++){desc=(0x17000+n).toString(16)+':Thornswood-Content.esp';assert.equal(policy.blocked(1000),true,desc);}
desc='0017000:THORNSWOOD-CONTENT.ESP';assert.equal(policy.blocked(1000),true,'canonical equivalent identity');
for(const ordinary of ['17007:Thornswood-Content.esp','17000:Other.esp','f:Skyrim.esm','abc:Some Mod.esl']) {
 desc=ordinary;assert.equal(policy.blocked(1000),false,ordinary);
}
for(const bad of ['',null,undefined,'not a native descriptor']){desc=bad;assert.equal(policy.blocked(1000),true,'unproven native identity');}
desc='f:Skyrim.esm';broken=true;assert.equal(policy.blocked(1000),true);broken=false;assert.equal(policy.blocked(1000),false);
for(const id of [0,-1,NaN,Infinity,1.5,'1000'])assert.equal(policy.blocked(id),true,'invalid native item ID');
// Later replacement of the API property cannot bypass the captured native
// lookup. Descriptor resolution still follows the native method's own state.
mp.getDescFromId=()=> 'f:Skyrim.esm';desc='17006:Thornswood-Content.esp';assert.equal(policy.blocked(1000),true);
assert.throws(()=>createQuestItemPolicy({}),/identity/);
console.log('PASS seven bound quest tokens, ordinary identities, failed queries and immutable native policy');
