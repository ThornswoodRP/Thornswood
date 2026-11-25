'use strict';
// An actual pre-change target: generic Dungeon + Cave-set metadata must not
// invalidate accepted work. This uses the unchanged canonical contract module.
const assert = require('node:assert/strict');
const {createKillContracts} = require('../kill-contracts');
const population = require('../data/npc-population.json');
const compact = require('../../tests/gamemode-tables').table('NPC_POPULATION_DATA');
const target = require('../../tests/fixtures/4763-saved-kill-target.json');
const copy = value => JSON.parse(JSON.stringify(value));
const ids = new Map(), states = new Map();
population.npcs.filter(row => row.keep).forEach((row,index) => {
  ids.set(row.ref,index+100);
  states.set(index+100,{ref:row.ref,base:row.base,world:row.world || row.cell,pos:row.pos.slice(),
    race:row.species === 'sabre-cat' ? 'SabreCatRace' : row.species+'Race',profileId:-1,isHuman:false,
    isDead:false,isServerControlled:true,lifeGeneration:0,runtimeLifeIdentity:'100'});
});
const mp = {getIdFromDesc:ref=>ids.get(ref),getDescFromId:id=>states.get(id).ref,
  getNpcAIState:id=>copy(states.get(id)),
  get:(id,key)=>key === 'baseDesc' ? states.get(id).base : key === 'worldOrCellDesc' ? states.get(id).world : undefined};
const spec = {id:'q-4763-saved-source',kind:'kill',merchant:{hold:'the Pale'},count:1,targets:[target]};
const create = data => createKillContracts({mp,population:data,expandedRows:[spec],
  raceOf:id=>states.get(id).race,identity:id=>id === 1 ? 'human-session' : null});
const before = create(compact), book = {open:{},expected:{v:1,open:{},cool:{}}};
assert.equal(before.take(book,spec.id).ok,true,'the historical exact target can be accepted');
const saved = copy(book), after = create(compact);
assert.equal(after.verified(saved,spec.id),true,'saved work still verifies after controller recreation');
const id = ids.get(target.ref); states.get(id).isDead = true;
assert.equal(after.credit(saved,1,id).ok,true,'the historical target still credits the accepted work');
assert.equal(after.ready(saved,spec.id),true,'the accepted work can complete without target migration');
assert.equal(after.credit(saved,1,id).ok,false,'the same life still credits only once');
const relabeled = copy(compact); relabeled.keep.find(row=>row[0] === target.ref)[7] = 'cave';
assert.throws(()=>create(relabeled),/kill source disagrees/i,'a habitat-only change remains rejected by the strict validator');
console.log('PASS accepted historical kill target survives classification rebuild, completes and rejects replay');
console.log('PASS a habitat-only target change is still refused without weakening the validator');
