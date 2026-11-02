'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const roster=require('../game/data/merchant-roster.json').merchants;
const rows=require('../game/data/merchant-quests.json').quests.concat(require('../game/data/merchant-ranked-quests.json').quests);
const holds=['whiterun','riften','markarth','solitude','morthal','falkreath','windhelm','dawnstar','winterhold','ravenrock'],ranks=['novice','advanced','expert','master'];
const missing=[];
for(const merchant of roster.filter(row=>holds.includes(row.bookHold)))for(const rank of ranks)
 if(!rows.some(row=>row.merchant.reference===merchant.reference&&row.tier===rank))missing.push(merchant.bookHold+'/'+merchant.role+'/'+rank);
assert.deepEqual(missing,[],'Every specialist in all ten holds needs each rank: '+missing.length+' missing');
assert.equal(roster.filter(row=>holds.includes(row.bookHold)).length,60);
const mode=require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname,'../game/gamemode.js'),'utf8')),ctx={};
vm.runInNewContext(mode.slice(mode.indexOf('// ==== thornswood progression ===='),mode.indexOf('// ==== end thornswood progression ====')),ctx);
const table=ctx.__thornswoodProgression.TABLE;
let halves=0;
for(const [profession,meta]of Object.entries(table.professions)) {
 if(profession==='mage')continue;
 for(const half of Object.keys(meta.halves)) {
  assert.ok(rows.some(row=>row.gate.profession===profession&&row.gate.half===half&&row.gate.rank==='master'),profession+'/'+half);
  halves++;
 }
}
for(const school of table.schools)assert.ok(rows.some(row=>row.gate.profession==='mage'&&row.gate.school===school&&row.gate.rank==='master'),school);
for(const classKey of Object.keys(table.classes)) {
 assert.ok(rows.filter(row=>row.gate.classKey===classKey).length>=2,classKey+'/two jobs');
 assert.ok(rows.some(row=>row.gate.classKey===classKey&&row.gate.rank==='master'&&row.gate.half===undefined),classKey+'/Master without half');
}
assert.equal(halves,14);assert.equal(table.schools.length,5);
console.log('PASS all240 merchant/rank slots, every14 non-Mage mastered half, all5 Master schools and each Master class without a half');
