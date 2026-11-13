'use strict';
const assert=require('node:assert/strict');
const {readMammothDraw,appendMammothDraw,mammothReturn,mammothAbandon}=require('../../game/quest-hunt-bundles');
const copy=v=>JSON.parse(JSON.stringify(v));
const body=(ref='33fa6:Skyrim.esm',life=0,body='1',goods=[2,3])=>({ref,life,body,goods});
let entry={drawn:0,bundles:[],kills:0,itemDesc:null};
assert(readMammothDraw(entry));assert.equal(mammothReturn(entry).ok,false);
entry=appendMammothDraw(entry,body()).next;
assert.equal(entry.drawn,1);assert.equal(appendMammothDraw(entry,body()).ok,false);
entry=appendMammothDraw(entry,body('846ea:Skyrim.esm',2,'7',[4,5])).next;
entry=appendMammothDraw(entry,body('846eb:Skyrim.esm',3,'9',[1,1])).next;
assert.equal(entry.drawn,3);assert.equal(appendMammothDraw(entry,body('33fa6:Skyrim.esm',4,'10')).ok,false);
assert.deepEqual(mammothReturn(entry),{ok:true,changes:[{item:'3ad6c:Skyrim.esm',count:-2},{item:'669a4:Skyrim.esm',count:-3}]});
assert.deepEqual(mammothAbandon(entry),{ok:true,changes:[{item:'3ad6c:Skyrim.esm',count:-7},{item:'669a4:Skyrim.esm',count:-9}]});
for(const change of [
 e=>{e.drawn=2;},e=>{e.drawn=-1;},e=>{e.bundles[0].goods[0]=0;},e=>{e.bundles[0].goods[1]=6;},
 e=>{e.bundles[0].goods.push(1);},e=>{e.bundles[0].life=NaN;},e=>{e.bundles[0].body='01';},
 e=>{e.bundles[0].body='18446744073709551616';},e=>{e.bundles[0].ref='other:Skyrim.esm';},
 e=>{e.bundles[1]=copy(e.bundles[0]);},e=>{delete e.bundles;},e=>{e.bundles.push(body());},
 e=>{e.itemDesc='f:Skyrim.esm';},e=>{e.kills=1;},e=>{e.bundles[0].goods=Array(2);}
]) {
 const bad=copy(entry);change(bad);assert.equal(readMammothDraw(bad),null);
 assert.equal(mammothReturn(bad).ok,false);assert.equal(mammothAbandon(bad).ok,false);
 assert.equal(appendMammothDraw(bad,body()).ok,false);
}
{
 const original=copy(entry),read=readMammothDraw(entry);read.bundles[0].goods[0]=5;
 assert.deepEqual(entry,original,'validated views do not mutate persisted records');
}
console.log('PASS bounded native mammoth body receipts, exact two-item bundles, cap, duplicate refusal, return/extras and full abandon');
