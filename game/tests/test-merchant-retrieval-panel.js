'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const nodes=new Map();
const node=()=>({style:{},querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);},querySelectorAll:()=>[],appendChild(){}});
const document={head:node(),body:node(),createElement:node,addEventListener(){}};
const ctx={document,window:{skyrimPlatform:{sendMessage(){}}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../game/ui/thornswood-merchant.js'),'utf8'),ctx);
for(const [state,drawn] of [['available',0],['open',0],['open',1]]) {
 ctx.window.thornswoodMerchant.setData({open:true,sessionId:'retrieval',trader:'Cook',place:'Whiterun',purse:0,offers:[],quests:[{
  id:'dispatch',name:'The dispatch',kind:'retrieval',who:'Open to anyone',state,drawn,gold:60,hours:12,
  locations:'Halted Stream Camp. Return to the Eastmarch Cook.',canTake:state==='available',canReturn:drawn===1,canAbandon:state==='open'
 }]});
 const body=nodes.get('#ts-merchant-body').innerHTML;
 assert.match(body,/60 gold/);assert.match(body,/Eastmarch Cook/);assert.match(body,/12 hours/);
 assert(!body.includes('undefined'),'retrieval terms do not use scarce-only ask or holds fields');
 if(state==='open')assert.match(body,drawn?/Item collected/ : /Find the named item/);
 if(drawn===1)assert.match(body,/data-action="return"[^>]*>Turn in work/);
}
console.log('PASS actual retrieval panel reward, destination, rest, collection status and return action');
