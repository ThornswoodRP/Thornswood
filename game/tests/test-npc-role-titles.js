'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../game/gamemode.js'),'utf8'),ctx={};
vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('// NPC POPULATION POLICY BEGIN'),source.indexOf('// NPC POPULATION POLICY END')),ctx);
for(const title of ['Coach Driver','Ferry Operator','Ship Captain']) {
 const calls=[],api={makeProperty(){},setNpcPlacementExclusions(){},getIdFromDesc:d=>({'1:Skyrim.esm':1,'a:Skyrim.esm':10,'3c:Skyrim.esm':60}[d]),
  getDescFromId:id=>id>=0xff000000?'5':'1:Skyrim.esm',get:(id,key)=>key==='baseDesc'?'a:Skyrim.esm':undefined,set(){},
  callPapyrusFunction:(...args)=>calls.push(args)};
 const row=['1:Skyrim.esm','a:Skyrim.esm','3c:Skyrim.esm',[10,20,30],100,45,'transport','city',null,4,'stop',0,'nord',title];
 const data={version:1,plugins:['Skyrim.esm'],cut:[],keep:[row]},state={pos:[10,20,30],cellOrWorld:60,isHuman:false};
 const policy=ctx.createNpcPopulation(api,data,data.plugins);
 assert.equal(policy.configure(1,{...state,isHuman:true}),null);assert.equal(calls.length,0,'a human is never renamed');
 assert.ok(policy.configure(1,state));assert.equal(calls.length,1,'title is applied during initial admission');
 const [kind,klass,method,self,args]=calls[0];
 assert.deepEqual([kind,klass,method,self.desc,args[0],args[1]],['method','ObjectReference','SetDisplayName','1:Skyrim.esm',title,true]);
 policy.configure(1,state);assert.equal(calls.length,1,'ordinary policy reads do not repeatedly rename the actor');
 assert.ok(policy.configure(0xff000005,state));assert.equal(calls[1][3].desc,'5','a dynamic instance must not rename its authored anchor');
 row[13]='Merchant';assert.throws(()=>ctx.createNpcPopulation(api,data,data.plugins),/title/i);
 delete row[13];assert.throws(()=>ctx.createNpcPopulation(api,data,data.plugins),/title/i,'every transport needs its descriptive title');
 row[6]='trader';row[13]='Smith';assert.throws(()=>ctx.createNpcPopulation(api,data,data.plugins),/title/i,'guild titles wait for matching role tables');
}
const catalogue=require('../../game/data/npc-population.json'),transport=catalogue.npcs.filter(row=>row.keep&&row.role==='transport');
for(const title of ['Smith','Woodworker','Tailor','Enchanter','Cook','Alchemist']) {
 const names=[],api={makeProperty(){},getIdFromDesc:d=>parseInt(d,16),getDescFromId:()=> '1:Skyrim.esm',
  get:(id,key)=>key==='baseDesc'?'a:Skyrim.esm':undefined,set(){},callPapyrusFunction:(...args)=>names.push(args)};
 const row=['1:Skyrim.esm','a:Skyrim.esm','3c:Skyrim.esm',[10,20,30],100,360,'trader','city',null,4,'shop',0,'nord',title];
 const data={version:1,plugins:['Skyrim.esm'],keep:[row],merchantRoles:{'1:Skyrim.esm':title}};
 const policy=ctx.createNpcPopulation(api,data,data.plugins);
 assert.ok(policy.configure(1,{pos:[10,20,30],cellOrWorld:60,isHuman:false}));
 assert.equal(names[0][4][0],title);
 data.merchantRoles['1:Skyrim.esm']='Merchant';
 assert.throws(()=>ctx.createNpcPopulation(api,data,data.plugins),/title/i,'an unrelated role map cannot authorize a title');
}
vm.runInContext(source.slice(source.indexOf('// NPC POPULATION DATA BEGIN'),source.indexOf('// NPC POPULATION DATA END'))+'\nglobalThis.runtime=NPC_POPULATION_DATA;',ctx);
assert.equal(transport.length,27);const counts={};
for(const row of transport) {
 const compact=ctx.runtime.keep.find(item=>item[0]===row.ref);assert.ok(compact);assert.equal(compact[13],row.displayName);
 counts[row.displayName]=(counts[row.displayName]||0)+1;
}
assert.deepEqual(counts,{'Ferry Operator':16,'Ship Captain':2,'Coach Driver':9});
assert.equal(ctx.runtime.keep.filter(row=>row[13]!==undefined).length,87,'transport and sixty guild roles are named at initial admission');
console.log('PASS descriptive NPC role titles use native names, correct instances and initial admission');
