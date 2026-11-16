'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../game/gamemode.js'),'utf8');
const block=source.slice(source.indexOf('// ==== thornswood dungeon loot ===='),source.indexOf('// ==== end thornswood dungeon loot ===='));
for (const channel of ['main', 'dev', undefined]) {
let ledger={version:1,entries:{}},clock=1000000000000,brokenSave=false,brokenPay=false,payments=0;
const storage={load:()=>JSON.parse(JSON.stringify(ledger)),save:next=>{
  if(brokenSave)throw new Error('disk unavailable');ledger=JSON.parse(JSON.stringify(next));}};
let cell='371de:Skyrim.esm',distance=20,dead=false,human=true;
const ctx={require,Map,Set,Math,Date:{now:()=>clock},console:{log(){}},
  createPrivateEconomyLedger:()=>storage,idOf:()=>100,
  addItem(){payments++;return true;},addItemsAtomic(){if(brokenPay)throw new Error('inventory unavailable');payments++;return true;},
  withinResourceReach:()=>distance<=400,
  mp:{getServerSettings:()=>({thornswoodServer:channel}),makeProperty(){},getDescFromId:id=>id.toString(16)+':Skyrim.esm',
    getNpcAIState:()=>({isHuman:human,profileId:human?1:0,isDead:dead,isDisabled:false}),
    get:(id,key)=>key==='worldOrCellDesc'?cell:key==='baseDesc'?'100:Skyrim.esm':undefined,
    set(){throw new Error('the chest return is the ledger alone');},
    lookupEspmRecordById:()=>({record:{fields:[{type:'EDID',data:Array.from(Buffer.from('TreasureChestLarge\0'))}]}})},say(){}};
function reload(){vm.createContext(ctx);vm.runInContext(block,ctx);return ctx.__thornswoodDungeonLoot;}
let service=reload();
brokenSave=true;assert.equal(service.onChest(1,2),null);assert.equal(payments,0,'A failed durable reservation cannot mint a reward');
brokenSave=false;assert.ok(service.onChest(1,2));assert.equal(payments,1,'The complete bundle has one inventory write');
assert.equal(service.onChest(1,2),null);assert.equal(payments,1,'The ledger alone holds the return');
assert.equal(service.onChest(3,2),null);assert.equal(payments,1,'A second person shares the same container return');
const old=service;service=reload();assert.equal(old.onChest(1,2),null,'Reload revokes the old award API');
assert.equal(service.onChest(1,2),null);assert.equal(payments,1,'Durable cooldown survives reload');
clock+=31*60000;distance=401;assert.equal(service.onChest(1,2),null);assert.equal(payments,1);
distance=20;dead=true;assert.equal(service.onChest(1,2),null);dead=false;
human=false;assert.equal(service.onChest(1,2),null);human=true;
assert.equal(payments,1,'Out-of-reach, dead and NPC activators cannot receive rewards');
brokenPay=true;assert.equal(service.onChest(1,2),null);brokenPay=false;
assert.equal(service.onChest(1,2),null);assert.equal(payments,1,'An uncertain inventory write is not replayed');
clock+=31*60000;assert.ok(service.onChest(1,2));assert.equal(payments,2,'The next legitimate return may pay');
ledger.entries['4:Skyrim.esm']={at:clock,legacy:true};
service=reload();assert.equal(service.onChest(1,2),null);assert.equal(payments,2,'A ledger entry that is not a reservation refuses awards');
delete ledger.entries['4:Skyrim.esm'];service=reload();
ledger.entries['2:Skyrim.esm'].at=-1;
service=reload();assert.equal(service.onChest(1,2),null);assert.equal(payments,2,'Invalid saved cooldown refuses awards');
console.log('PASS durable dungeon reward reservation, reload, uncertain writes and reach checks');
}
