'use strict';
// A failed decoded-name read remains visible in the server log while the
// real Trade reader still supplies its existing readable fallback.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const gm=fs.readFileSync(path.join(__dirname,'../gamemode.js'),'utf8');
const start=gm.indexOf('// ==== thornswood trade ===='),end=gm.indexOf('// ==== end thornswood trade ====',start);
assert(start>=0&&end>start);
const logs=[],g={__thornswoodProperty:{baseItemName(){throw Error('decoded fixture unavailable');}}};
const mp={makeProperty(){},get(){return[];},lookupEspmRecordById(){return{isLocalized:false,record:{type:'MISC',editorId:'CopperToken',fields:[]}};}};
new Function('globalThis','mp','console','setInterval','clearInterval','guard','say','notify',
  require('../../tests/fixtures/ordinary-quest-items')+gm.slice(start,end))(
    g,mp,{log(...args){logs.push(args.join(' '));}},()=>1,()=>{},(name,fn)=>fn,()=>{},()=>{});
let failed=0;
function yes(name,ok){console.log((ok?'PASS ':'FAIL ')+name);if(!ok)failed++;}
yes('decoded-name failure retains the real editor-ID fallback',g.__thornswoodTrade.labelOf(0x891)==='Copper Token');
yes('decoded-name failure is recorded with its reason',logs.some(line=>line.includes('decoded fixture unavailable')));
console.log((2-failed)+' passed, '+failed+' failed');process.exitCode=failed?1:0;
