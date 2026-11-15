'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../game/gamemode.js'), 'utf8');
const begin = source.indexOf('function mintedBy(');
const end = source.lastIndexOf('/*', source.indexOf('WHICH RUN OF THE SERVER', begin));
assert.ok(begin >= 0 && end > begin, 'production inventory helpers exist');
const copy = value => JSON.parse(JSON.stringify(value));
for (const atomic of [false, true]) {
  let inventory = {entries:[{baseId:10,count:1,npcEquipment:true}]};
  const ctx = {idOf:()=>10,log(){},mp:{get:()=>copy(inventory),set:(_id,_key,value)=>{inventory=copy(value);}}};
  vm.createContext(ctx);
  vm.runInContext(source.slice(begin,end), ctx);
  assert.equal(ctx.mintedEntry(inventory.entries[0]), true,
    'inherited equipment is not an ordinary reward/stock stack, even before custom registrations');
  const success = atomic ? ctx.addItemsAtomic(1,[{item:'sword',count:3}]) : ctx.addItem(1,'sword',3);
  assert.equal(success, true);
  assert.deepEqual(inventory.entries,[{baseId:10,count:1,npcEquipment:true},{baseId:10,count:3}],
    'explicit NPC goods do not merge into inherited gear');
  assert.equal(ctx.mintedEntry(inventory.entries[1]), false);
  assert.equal(ctx.mintedEntry(null), false);
  ctx.mintedBy('test',entry=>entry.name==='dye');
  assert.equal(ctx.mintedEntry({baseId:10,count:1,name:'dye'}), true,
    'existing custom metadata registration remains effective');
}
console.log('PASS inherited NPC gear stays separate from deliberate item grants');
