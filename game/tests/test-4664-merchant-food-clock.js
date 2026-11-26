'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const path = require('node:path'), trading = require('../merchant-trading');
const root = path.resolve(__dirname,'../..'), groups = require('../data/food-groups.json');
const box = {console:{log(){}}}; box.globalThis = box;
vm.runInNewContext(fs.readFileSync(path.join(root,'game/gamemode/spoilage.ts'),'utf8'),box);
const DAY = 86400000, AT = Date.UTC(2026,9,26,12), RAW = 100, SPOILED = 101, TOOL = 102;
const descs = {[RAW]:'669a2:Skyrim.esm',[SPOILED]:groups.spoil.spoiled,[TOOL]:'319e5:Skyrim.esm'};
let checks = 0;
function check(name,run){run();checks++;console.log('PASS '+name);}
function spoil(options={}) {
  return box.__thornswoodSpoilageCreate({table:groups.spoil,descOf:id=>descs[id],
    idOf:desc=>Number(Object.keys(descs).find(id=>descs[id]===desc)) || 0,
    groupOfDesc:desc=>groups.items[desc],plainOfFine:()=>'',log(){},
    cold:id=>options.cold===id,winterAt:at=>!!(options.winter && options.winter(at))});
}
const row = (left=3)=>({baseId:RAW,count:2,name:'Venison',entry:{baseId:RAW,count:2,name:`Venison (${left} days left)`,health:0.75}});
const state = ()=>({version:1,reference:'1:Skyrim.esm',base:'2:Skyrim.esm',purse:250,revision:4,
  stock:[row()],supply:{},spoilClock:{at:AT,days:0}});
const age = (s,time,options)=>{
  const out=trading.agedMerchantStock(s,spoil(options),7,time);
  return out && JSON.parse(JSON.stringify(out)); // normalize the real VM's object prototypes
};
check('partial days do not age food or produce a write',()=>assert.equal(age(state(),AT+DAY-1),null));
check('one exact day ages only the name and preserves all other metadata',()=>{
  const s=state(),before=JSON.stringify(s),out=age(s,AT+DAY);
  assert.equal(out.stock[0].entry.name,'Venison (2 days left)');assert.equal(out.stock[0].entry.health,0.75);
  assert.equal(JSON.stringify(s),before);assert.equal(out.purse,250);assert.deepEqual(out.spoilClock,{at:AT,days:1});
});
check('repeating a committed clock does not age twice',()=>{
  const once=age(state(),AT+DAY);assert.equal(age(once,AT+DAY),null);
  assert.equal(age(once,AT+2*DAY).stock[0].entry.name,'Venison (1 day left)');
});
check('expired verified food becomes the canonical retained spoiled record',()=>{
  const out=age(state(),AT+3*DAY);assert.equal(out.stock[0].baseId,SPOILED);
  assert.equal(out.stock[0].entry.name,'Venison (spoiled)');assert.equal(out.stock[0].count,2);
  assert.equal(out.stock[0].name,'Venison (spoiled)');
});
check('cold storage advances the same clock without taking days',()=>{
  const out=age(state(),AT+2*DAY,{cold:7});assert.deepEqual(out.stock[0],row());assert.equal(out.spoilClock.days,2);
  assert.equal(age(out,AT+3*DAY).stock[0].entry.name,'Venison (2 days left)');
});
check('only boundaries that turn during winter are exempt, exactly like chests',()=>{
  const out=age(state(),AT+2*DAY,{winter:at=>at<AT+DAY});assert.equal(out.stock[0].entry.name,'Venison (2 days left)');
  assert.equal(out.spoilClock.days,2);
});
check('preserved food and unrelated goods keep all metadata',()=>{
  const s=state();s.stock[0].entry.name='Venison (salted)';
  s.stock.push({baseId:TOOL,count:1,name:'Ladle',entry:{baseId:TOOL,count:1,name:'A keepsake',health:0.6}});
  assert.deepEqual(age(s,AT+9*DAY).stock,s.stock);
});
check('legacy perishable stock keeps its exact entry privately without guessing age',()=>{
  const s=state();delete s.spoilClock;const out=age(s,AT+20*DAY);
  assert.equal(out.stock[0].ageUnknown,true);assert.deepEqual(out.stock[0].entry,s.stock[0].entry);
  assert.deepEqual(out.spoilClock,{at:AT+20*DAY,days:0});
  assert.equal(age(out,AT+21*DAY).stock[0].entry.name,'Venison (3 days left)');
});
check('missing clocks do not quarantine preserved food or ordinary goods',()=>{
  const s=state();delete s.spoilClock;s.stock[0].entry.name='Venison (smoked)';
  assert(!age(s,AT+10*DAY).stock[0].ageUnknown);
});
for(const clock of [null,{},[],{at:AT,days:-1},{at:AT+DAY,days:0},{at:AT,days:1},
  {at:AT,days:0,extra:true},{at:'bad',days:0},{at:AT,days:Infinity}]) {
  check('invalid or future clock refuses unchanged: '+JSON.stringify(clock),()=>{
    const s=state();s.spoilClock=clock;const before=JSON.stringify(s);
    assert.throws(()=>age(s,AT),/clock cannot be verified/);assert.equal(JSON.stringify(s),before);
  });
}
check('malformed marker/count refuses without changing stock',()=>{
  for(const corrupt of [s=>s.stock[0].ageUnknown=false,s=>s.stock[0].entry.count++]) {
    const s=state();corrupt(s);const before=JSON.stringify(s);assert.throws(()=>age(s,AT+DAY),/cannot be verified/);
    assert.equal(JSON.stringify(s),before);
  }
});
console.log(checks+' passed, 0 failed');
