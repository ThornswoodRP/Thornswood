'use strict';
// A new character's creation stage is written before the shift goes in its
// pack, so the clothes cannot make it look like a returning character on the
// next creation tick.
//
// This harness used to drive the wear script (thornswoodWear), the owner
// script that kept asking the client to equip the shift. That script was a
// band-aid for an equipment record the server could not write, and it came out
// when the engine gained the write and created() began to dress a new
// character before the hand-over (#1560). Its checks went with it; that
// dressing is held by test-dressed-at-creation.js. The order check below is
// about beginAppearance and still holds.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const gm=fs.readFileSync(path.join(__dirname,'../../game/gamemode.js'),'utf8').split('\r').join('');
assert.equal(gm.indexOf('function wearScript() {'),-1,'the wear script is gone (#1560)');
const appearanceStart=gm.indexOf('function beginAppearance(actorId) {'),appearanceEnd=gm.indexOf('\n}',appearanceStart)+2;
assert.ok(appearanceStart>=0,'beginAppearance is in the file');
const actions=[];
let savedStage;
const begin=new Function('mp','faceMark','firstSeen','HALL','setChargen','log','tellOnce','sendToHall','giveShift','chargenOf',
  gm.slice(appearanceStart,appearanceEnd)+';return beginAppearance;')(
  {get:()=>null},()=>'',new Map(),{desc:'hall'},(id,state)=>{savedStage=state;actions.push('stage');},()=>{},()=>{},()=>false,()=>actions.push('clothes'),()=>savedStage);
begin(1);assert.deepEqual(actions,['stage','clothes'],'persist the new creation stage, then put the shift in the pack');
console.log('PASS creation stage persisted before the shift goes in the pack; no wear script left');
