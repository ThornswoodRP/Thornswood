'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = require('./gamemode-tables.js').joined(fs.readFileSync(process.argv[2] || path.join(__dirname,'../game/gamemode.js'),'utf8'));
function fn(name,optional = false) {
  const match = source.match(new RegExp('^function '+name+'\\([^\\r\\n]*\\)[\\s\\S]*?^\\}','m'));
  if(optional && !match) return '';
  assert.ok(match,'Extract production '+name); return match[0];
}
function table(name) {
  const match = source.match(new RegExp('^(?:var|const) '+name+' = (?:\\{[^\\n]*\\};$|\\{[\\s\\S]*?^\\};)','m'));
  assert.ok(match,'Extract production '+name); return match[0];
}
const begin = source.indexOf('// SHARED RESOURCE STOCK BEGIN'),end = source.indexOf('// SHARED RESOURCE STOCK END');
assert.ok(begin >= 0 && end > begin);
const code = [source.slice(begin,end),...['FISH_BY_BASE','HUNTS_BY_BASE','FISH_TUNING','HUNT_TUNING','GAME_BY_BASE','GAME_TUNING','RACKS_BY_HAND','RACK_OWNERS'].map(table),
  "const RANK_LADDER=['novice','advanced','expert','master']; const lastUse=new Map(); const COOLDOWN_MS=20000; let lastUseSweepAt=5000; const PARTY_BANK={};",
  ...['isFish','isGame','isCarcass','idOf','mintedEntry','addItem','cooldownLeft','stampCooldown','waitWord','classGate','rankStep','rankWord','creditWork','economyGathered','saidInOrder','fish','loot','rackOf','game'].map(name => fn(name)),
  fn('withinResourceReach',true),fn('addItemsAtomic',true)].join('\n');
const copy = value => value == null ? null : JSON.parse(JSON.stringify(value));
const fishBase = '108e35:Skyrim.esm',expertFish = '3828c:Dragonborn.esm';
// The named pet formerly used here is deliberately cut. Exercise retained
// authored cow and horse bases from the current 48-plugin catalogue.
const bodyBase = '23a90:Skyrim.esm',advancedBody = '109e3e:Skyrim.esm';
const stockProperty = 'thornswoodResourceStock';
class MemoryMp {
  constructor() {
    this.values = new Map(); this.missing = new Set(); this.inventoryWrites = 0;
    this.failStockWrite = false; this.failInventoryWrite = false;
    for(const id of [1,2,3,4]) {
      this.values.set(id+':inventory',{entries:[]});
      this.values.set(id+':locationalData',{pos:[0,20,0],rot:[0,0,0],cellOrWorldDesc:'3c:Skyrim.esm'});
    }
    for(const id of [71,81]) {
      this.values.set(id+':locationalData',{pos:[0,0,0],rot:[0,0,0],cellOrWorldDesc:'3c:Skyrim.esm'});
    }
    this.values.set('71:type','MpObjectReference'); this.values.set('81:type','MpActor');
    this.values.set('81:isDead',true);
  }
  makeProperty() {}
  get(id,name) { return copy(this.values.get(id+':'+name)); }
  set(id,name,value) {
    if(name === stockProperty && this.failStockWrite) throw new Error('Stock persistence failed');
    if(name === 'inventory') {
      this.inventoryWrites++;
      if(this.failInventoryWrite) throw new Error('Inventory persistence failed');
    }
    this.values.set(id+':'+name,copy(value));
  }
  getIdFromDesc(desc) {
    if(this.missing.has(desc)) return 0;
    const [hex,plugin] = desc.split(':');
    return parseInt(hex,16)+(plugin === 'HearthFires.esm' ? 0x02000000 : plugin === 'Dragonborn.esm' ? 0x04000000 : 0);
  }
}
function fixture() {
  let time = 1000000000,context;
  const api = new MemoryMp(),classes = new Map([[1,'fisher'],[2,'fisher'],[3,'hunter'],[4,'hunter']]);
  const ranks = new Map(),credits = [];
  function reload() {
    const stableMath = Object.create(Math); stableMath.random = () => 0;
    // Pole ownership is covered by test-1379-poles-trap.js; this harness isolates
    // shared stock ordering, so provide the same harmless gate stub as the
    // other resource-gate fixtures.
    context = {mp:api,Math:stableMath,Date:{now:() => time},Number,Map,Set,JSON,
      log() {},toolGate() { return null; },wearTool() { return null; },randInt:(min,max) => min};
    vm.createContext(context); vm.runInContext(code,context);
    context.__thornswoodCharacter = {
      gate(id,verb) { return classes.get(id) === (verb === 'fish' ? 'fisher' : 'hunter') ? null : 'This work belongs to another class.'; },
      rankOf(id) { return ranks.get(id) || 'novice'; },
      credit(id,verb) { credits.push({id,verb}); return null; }
    };
    context.__thornswoodResourceStock = context.createSharedResourceStock(api,() => time);
  }
  reload();
  return {api,classes,ranks,credits,reload,advance(ms) { time += ms; },
    fish(id=1,base=fishBase) { return context.fish(id,71,base); },
    loot(id=3,base=bodyBase) { return context.loot(id,81,base); },
    rack(id=3) { return context.game(id,71,Object.keys(context.GAME_BY_BASE).find(base=>context.GAME_BY_BASE[base].rank==='novice')); },
    stock:() => context.__thornswoodResourceStock,
    inventory:id => api.get(id,'inventory'),total(id) { return api.get(id,'inventory').entries.reduce((sum,item) => sum+item.count,0); }};
}
function attempt(fn) { try { return fn(); } catch(error) { return {error}; } }
let passed = 0,failed = 0;
function test(name,fn) {
  try { fn(); passed++; console.log('PASS '+name); }
  catch(error) { failed++; console.error('FAIL '+name+': '+error.message); }
}
test('Two fishers share the same water stock',() => {
  const f = fixture(); f.fish(1); f.fish(2);
  assert.equal(f.total(1),1); assert.equal(f.total(2),0,'A second character cannot collect the same shared fish');
  assert.equal(f.credits.length,1);
});
test('Reloading the real fish path preserves the reference wait',() => {
  const f = fixture(); f.fish(1); f.advance(250); f.reload(); f.fish(2);
  assert.equal(f.total(2),0);
  assert.equal(f.stock().left(71,600000),599750);
});
for(const gate of ['class','rank']) {
  test('Fishing '+gate+' refusal does not consume stock or credit work',() => {
    const f = fixture();
    if(gate === 'class') f.classes.set(1,'hunter');
    f.fish(1,gate === 'rank' ? expertFish : fishBase);
    assert.equal(f.total(1),0); assert.equal(f.stock().left(71,600000),0); assert.equal(f.credits.length,0);
    f.classes.set(1,'fisher'); f.ranks.set(1,'expert'); f.fish(1,gate === 'rank' ? expertFish : fishBase);
    assert.ok(f.total(1)>0,'An eligible press must remain available after refusal');
  });
}
test('A stock reservation write failure happens before fish payment',() => {
  const f = fixture(); f.api.failStockWrite = true; attempt(() => f.fish());
  assert.equal(f.total(1),0); assert.equal(f.credits.length,0);
  f.api.failStockWrite = false;
  assert.equal(f.stock().left(71,600000),0); f.fish(); assert.equal(f.total(1),1);
});
test('Two eligible hunters receive only one complete reward from a dead body',() => {
  const f = fixture(); f.stock().recordDeath(81); f.loot(3); f.loot(4);
  assert.equal(f.total(3),2); assert.equal(f.total(4),0); assert.equal(f.credits.length,1);
});
test('A duplicate death event does not reopen a body already dressed through loot',() => {
  const f = fixture(); f.stock().recordDeath(81); f.loot(3); f.stock().recordDeath(81); f.loot(4);
  assert.equal(f.total(4),0); assert.equal(f.credits.length,1);
});
test('A natural live respawn permits exactly one reward from the next life',() => {
  const f = fixture(); f.stock().recordDeath(81); f.loot(3);
  f.api.set(81,'isDead',false); f.stock().recordRespawn(81);
  f.api.set(81,'isDead',true); f.stock().recordDeath(81); f.loot(3); f.loot(4);
  assert.equal(f.total(3),4,'The same hunter may dress a genuinely new life without a stale personal wait');
  assert.equal(f.total(4),0); assert.equal(f.credits.length,2);
});
for(const gate of ['class','rank']) {
  test('Hunting '+gate+' refusal does not claim the corpse',() => {
    const f = fixture();
    if(gate === 'class') f.classes.set(3,'fisher');
    f.loot(3,gate === 'rank' ? advancedBody : bodyBase);
    assert.equal(f.total(3),0); assert.equal(f.credits.length,0);
    f.classes.set(3,'hunter'); f.ranks.set(3,'advanced'); f.loot(3,gate === 'rank' ? advancedBody : bodyBase);
    assert.ok(f.total(3)>0);
  });
}
test('A missing second body item leaves no partial payout or final claim',() => {
  const f = fixture(); f.api.missing.add('65c99:Skyrim.esm'); attempt(() => f.loot(3));
  assert.equal(f.total(3),0,'A missing later item cannot leave the first item in inventory');
  assert.equal(f.credits.length,0);
  f.api.missing.clear(); f.loot(4); assert.equal(f.total(4),2,'A failed bundle must remain available');
});
test('An inventory write failure leaves no body items or final corpse claim',() => {
  const f = fixture(); f.api.failInventoryWrite = true; attempt(() => f.loot(3));
  assert.equal(f.total(3),0); assert.equal(f.credits.length,0);
  f.api.failInventoryWrite = false; f.loot(4); assert.equal(f.total(4),2);
});
test('A complete multi-item body payout commits inventory once',() => {
  const f = fixture(); f.loot(); assert.equal(f.total(3),2);
  assert.equal(f.api.inventoryWrites,1,'All body products must use one inventory write');
});
for(const work of ['fish','loot']) for(const remote of ['distance','cell']) {
  test(work+' refuses remote '+remote+' without consuming shared rewards',() => {
    const f = fixture(),actor = work === 'fish' ? 1 : 3;
    const location = f.api.get(actor,'locationalData');
    if(remote === 'distance') location.pos = [0,401,0];
    else location.cellOrWorldDesc = '3d:Skyrim.esm';
    f.api.set(actor,'locationalData',location); f[work](actor);
    assert.equal(f.total(actor),0); assert.equal(f.credits.length,0);
    f.api.set(actor,'locationalData',{pos:[0,20,0],rot:[0,0,0],cellOrWorldDesc:'3c:Skyrim.esm'});
    f[work](actor); assert.ok(f.total(actor)>0,'A remote refusal cannot consume the reference');
  });
}
test('A hanging meat rack has one shared collection and persists its wait through reload',() => {
  const f=fixture();f.rack(3);assert.ok(f.total(3)>0);f.reload();f.rack(4);
  assert.equal(f.total(4),0);assert.equal(f.credits.length,1);
  f.advance(3600000);f.rack(4);assert.ok(f.total(4)>0);
});
test('A distant hanging rack press cannot collect or reserve stock',() => {
  const f=fixture();f.api.set(3,'locationalData',{pos:[0,401,0],cellOrWorldDesc:'3c:Skyrim.esm'});
  f.rack(3);assert.equal(f.total(3),0);f.rack(4);assert.ok(f.total(4)>0);
});
test('A failed hanging rack grant leaves it available to another hunter',() => {
  const f=fixture();f.api.failInventoryWrite=true;attempt(()=>f.rack(3));
  assert.equal(f.total(3),0);assert.equal(f.credits.length,0);
  f.api.failInventoryWrite=false;f.rack(4);assert.ok(f.total(4)>0);
});
console.log(JSON.stringify({passed,failed}));
process.exitCode = failed ? 1 : 0;
