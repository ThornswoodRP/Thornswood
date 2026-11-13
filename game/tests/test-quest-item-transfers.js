'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../../game/gamemode.js'),'utf8').replace(/\r\n/g,'\n');
const {createQuestItemPolicy}=require('../../game/quest-items');
const ids=Array.from({length:7},(_,i)=>0x05017000+i);
let failed=false,writes=0,reads=0;
const mp={getDescFromId:id=>{if(failed)throw Error('native identity unavailable');return ids.includes(id)?(id&0xffffff).toString(16)+':Thornswood-Content.esp':id.toString(16)+':Skyrim.esm';},
 get:()=>{reads++;return {entries:[{baseId:ids[0],count:1},{baseId:15,count:7},{baseId:12,count:2}]};},set:()=>{writes++;}};
const policy=createQuestItemPolicy(mp);
const ctx={mp,Buffer,questItemBlocked:id=>policy.blocked(id),guard:(name,fn)=>fn,
 log:()=>{throw Error('diagnostic is unavailable');},auditPerson:()=>'',auditItem:()=>'',auditSource:()=>'',auditCell:()=>'',
 unconfirm:()=>{},push:()=>{},globalThis:{},copy:v=>JSON.parse(JSON.stringify(v)),TRADE_DOCK:{isCoin:id=>id===15},itemName:()=>'',
 pieceOf:e=>String(e.baseId),pieceName:()=>'',categoryOf:()=>'',g:{}};
vm.createContext(ctx);
const hooks=['onPutItem','onTakeItem','onDropItem'];
for(const name of hooks) {
 const match=source.match(new RegExp('^mp\\.'+name+" = guard\\('"+name+"',[\\s\\S]*?^\\}\\);",'m'));
 assert(match,name);vm.runInContext(match[0],ctx);
 for(const id of ids) {
  const args=name==='onDropItem'?[1,id,1]:[2,1,id,1];
  assert.equal(ctx.mp[name](...args),false,name+' refuses before logging');
 }
}
function lift(name) {
 const match=source.match(new RegExp('^(  |    )function '+name+'\\([^\\n]*\\)[\\s\\S]*?^\\1\\}','m'));
 assert(match,name);return match[0];
}
for(const name of ['packList','packTake','packGive','carrying','moveById','saleById','swap'])vm.runInContext(lift(name),ctx);
for(const id of ids) {
 assert.equal(ctx.moveById(1,2,[[15,7],[id,1]]),false);
 assert.equal(ctx.saleById(1,2,[{id,c:1}],5,5),false);
 assert.match(ctx.swap({offerA:[{id:15,c:7}],offerB:[{id,c:1}]}),/Quest items/);
 assert.throws(()=>ctx.packTake(1,id,0,1),/Quest items/);
 assert.throws(()=>ctx.packGive(1,{baseId:id,count:1}),/Quest items/);
}
assert.equal(writes,0);assert.equal(reads,0,'final transfer guards refuse before reading or mutating packs');
assert.equal(ctx.packList(1).some(r=>ids.includes(r.baseId)),false);
assert.equal(ctx.carrying(1).some(r=>ids.includes(r.id)),false);
assert.equal(ctx.packList(1).some(r=>r.baseId===12),true);
assert.equal(ctx.carrying(1).some(r=>r.id===12),true);
failed=true;
assert.equal(ctx.moveById(1,2,[[12,1]]),false,'failed native identities refuse ordinary transfers too');
assert.equal(writes,0);
{
 const helper=source.match(/^function questItemBlocked\([^\n]*\)[\s\S]*?^\}/m)[0];
 const missing={};vm.createContext(missing);vm.runInContext('var QUEST_ITEM_POLICY;\n'+helper,missing);
 assert.equal(missing.questItemBlocked(12),true,'partial bootstrap cannot allow transfers before its native policy exists');
}
console.log('PASS seven bound tokens refused by put/take/drop, both trade paths and ship cargo; ordinary goods remain visible');
