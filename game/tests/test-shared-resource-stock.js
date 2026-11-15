'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../../game/gamemode.js'),'utf8');
const begin = source.indexOf('// SHARED RESOURCE STOCK BEGIN');
const end = source.indexOf('// SHARED RESOURCE STOCK END');
assert.ok(begin >= 0 && end > begin,'The production shared resource stock helper must exist');
const context = {Math,Date,Number,Map,Set,JSON};
vm.createContext(context);
vm.runInContext(source.slice(begin,end),context);
assert.equal(typeof context.createSharedResourceStock,'function');
const property = 'thornswoodResourceStock';
const copy = value => value == null ? null : JSON.parse(JSON.stringify(value));

class MemoryMp {
  constructor() { this.values = new Map(); this.dead = new Map(); this.readFailure = false; this.writeFailure = false; }
  makeProperty() {}
  get(ref,name) {
    if(this.readFailure) throw new Error('Reference stock read failed');
    if(name === 'isDead') return this.dead.get(ref) === true;
    return copy(this.values.get(ref+':'+name));
  }
  set(ref,name,value) {
    if(this.writeFailure) throw new Error('Reference stock write failed');
    this.values.set(ref+':'+name,copy(value));
  }
}
function fixture(authoritative = false) {
  let time = 10000;
  const api = new MemoryMp();
  if(authoritative) {
    api.life = new Map();
    api.getNpcAIState = ref => ({isDead:api.dead.get(ref) === true,
      lifeGeneration:api.life.get(ref) || 0});
  }
  const make = () => context.createSharedResourceStock(api,() => time);
  return {api,stock:make(),reload:make,advance(ms) { time += ms; }};
}
function accepted(result) { return result === true || !!(result && result.ok === true); }
function refuses(fn) {
  let result;
  try { result = fn(); } catch(error) { return; }
  assert.ok(!accepted(result),'The refused action cannot report success');
}
let passed = 0,failed = 0;
function test(name,fn) {
  try { fn(); passed++; console.log('PASS '+name); }
  catch(error) { failed++; console.error('FAIL '+name+': '+error.message); }
}

test('Different people consume one shared reference stock',() => {
  const f = fixture(); let alice = 0,bob = 0;
  assert.equal(f.stock.left(71,1000),0);
  const first = f.stock.take(71,1000,() => { alice++; return true; });
  assert.equal(first.ok,true);
  const second = f.stock.take(71,1000,() => { bob++; return true; });
  assert.equal(second.ok,false); assert.equal(second.waitMs,1000);
  assert.equal(alice,1); assert.equal(bob,0);
  assert.equal(f.stock.left(71,1000),1000);
  assert.ok(f.api.values.has('71:'+property),'The stock belongs to the reference');
});
test('Different references have independent stock',() => {
  const f = fixture(); let grants = 0;
  for(const ref of [71,72]) assert.equal(f.stock.take(ref,1000,() => { grants++; return true; }).ok,true);
  assert.equal(grants,2);
});
test('Reload preserves the cooldown deadline instead of refilling stock',() => {
  const f = fixture(); let grants = 0;
  f.stock.take(71,1000,() => { grants++; return true; }); f.advance(250);
  const reloaded = f.reload();
  assert.equal(reloaded.left(71,1000),750);
  assert.equal(reloaded.take(71,1000,() => { grants++; return true; }).ok,false);
  assert.equal(grants,1);
});
test('Long elapsed time refills one stock without accumulating rewards',() => {
  const f = fixture(); let grants = 0;
  f.stock.take(71,1000,() => { grants++; return true; }); f.advance(100000);
  assert.equal(f.stock.left(71,1000),0);
  assert.equal(f.stock.take(71,1000,() => { grants++; return true; }).ok,true);
  assert.equal(f.stock.take(71,1000,() => { grants++; return true; }).ok,false);
  assert.equal(grants,2);
});
test('Reservation precedes a reentrant grant and prevents double payment',() => {
  const f = fixture(); let grants = 0,nested;
  const result = f.stock.take(71,1000,() => {
    grants++;
    nested = f.stock.take(71,1000,() => { grants++; return true; });
    return true;
  });
  assert.equal(result.ok,true); assert.equal(nested.ok,false); assert.equal(grants,1);
});
for(const failure of ['false','throw']) {
  test('A grant returning '+failure+' restores the reserved stock',() => {
    const f = fixture(); let grants = 0;
    refuses(() => f.stock.take(71,1000,() => {
      if(failure === 'throw') throw new Error('Inventory grant failed');
      return false;
    }));
    assert.equal(f.stock.left(71,1000),0);
    assert.equal(f.stock.take(71,1000,() => { grants++; return true; }).ok,true);
    assert.equal(grants,1);
  });
}
test('A successful grant with no explicit return consumes stock',() => {
  const f = fixture(); let grants = 0;
  assert.equal(f.stock.take(71,1000,() => { grants++; }).ok,true);
  assert.equal(f.stock.take(71,1000,() => { grants++; }).ok,false);
  assert.equal(grants,1);
});
for(const failure of ['readFailure','writeFailure']) {
  test('A reference '+failure+' refuses before inventory payment',() => {
    const f = fixture(); let grants = 0;
    f.api[failure] = true;
    refuses(() => f.stock.take(71,1000,() => { grants++; return true; }));
    assert.equal(grants,0);
    f.api[failure] = false;
    assert.equal(f.stock.take(71,1000,() => { grants++; return true; }).ok,true);
    assert.equal(grants,1);
  });
}
for(const saved of [42,[],{}, {version:999}, {version:1,nextAt:'invalid'}]) {
  test('Malformed persisted reference stock refuses payment: '+JSON.stringify(saved),() => {
    const f = fixture(); let grants = 0;
    f.api.values.set('71:'+property,saved);
    refuses(() => f.stock.take(71,1000,() => { grants++; return true; }));
    assert.equal(grants,0);
  });
}

test('A living animal cannot be dressed',() => {
  const f = fixture(); let grants = 0;
  refuses(() => f.stock.dress(81,() => { grants++; return true; }));
  assert.equal(grants,0);
});
test('Malformed persisted corpse stock refuses inventory payment',() => {
  const f = fixture(); let grants = 0;
  f.api.dead.set(81,true);
  f.api.values.set('81:'+property,{version:999});
  refuses(() => f.stock.dress(81,() => { grants++; return true; }));
  assert.equal(grants,0);
});
test('All people share one corpse reward per life, including after reload',() => {
  const f = fixture(); let alice = 0,bob = 0;
  f.api.dead.set(81,true); f.stock.recordDeath(81);
  assert.ok(accepted(f.stock.dress(81,() => { alice++; return true; })));
  refuses(() => f.stock.dress(81,() => { bob++; return true; }));
  refuses(() => f.reload().dress(81,() => { bob++; return true; }));
  assert.equal(alice,1); assert.equal(bob,0);
});
test('Duplicate death notifications cannot refill a claimed corpse',() => {
  const f = fixture(); let grants = 0;
  f.api.dead.set(81,true); f.stock.recordDeath(81);
  f.stock.dress(81,() => { grants++; return true; }); f.stock.recordDeath(81);
  refuses(() => f.stock.dress(81,() => { grants++; return true; }));
  assert.equal(grants,1);
});
test('A respawn notification while still dead cannot refill a claimed corpse',() => {
  const f = fixture(); let grants = 0;
  f.api.dead.set(81,true); f.stock.recordDeath(81);
  f.stock.dress(81,() => { grants++; return true; });
  try { f.stock.recordRespawn(81); } catch(error) {}
  refuses(() => f.stock.dress(81,() => { grants++; return true; }));
  assert.equal(grants,1); assert.equal(f.api.dead.get(81),true);
});
test('A natural live respawn opens exactly one reward for the next death',() => {
  const f = fixture(); let grants = 0;
  f.api.dead.set(81,true); f.stock.recordDeath(81);
  f.stock.dress(81,() => { grants++; return true; });
  f.api.dead.set(81,false); f.stock.recordRespawn(81);
  refuses(() => f.stock.dress(81,() => { grants++; return true; }));
  f.api.dead.set(81,true); f.stock.recordDeath(81);
  assert.ok(accepted(f.stock.dress(81,() => { grants++; return true; })));
  refuses(() => f.stock.dress(81,() => { grants++; return true; }));
  assert.equal(grants,2);
});
test('Corpse claim precedes a reentrant grant',() => {
  const f = fixture(); let grants = 0,nested;
  f.api.dead.set(81,true); f.stock.recordDeath(81);
  assert.ok(accepted(f.stock.dress(81,() => {
    grants++; nested = f.stock.dress(81,() => { grants++; return true; }); return true;
  })));
  assert.ok(!accepted(nested)); assert.equal(grants,1);
});
for(const failure of ['false','throw']) {
  test('A failed corpse grant '+failure+' permits one later successful claim',() => {
    const f = fixture(); let grants = 0;
    f.api.dead.set(81,true); f.stock.recordDeath(81);
    refuses(() => f.stock.dress(81,() => {
      if(failure === 'throw') throw new Error('Corpse grant failed');
      return false;
    }));
    assert.ok(accepted(f.stock.dress(81,() => { grants++; return true; })));
    refuses(() => f.stock.dress(81,() => { grants++; return true; }));
    assert.equal(grants,1);
  });
}
for(const failure of ['readFailure','writeFailure']) {
  test('A corpse '+failure+' refuses before inventory payment',() => {
    const f = fixture(); let grants = 0;
    f.api.dead.set(81,true); f.stock.recordDeath(81); f.api[failure] = true;
    refuses(() => f.stock.dress(81,() => { grants++; return true; }));
    assert.equal(grants,0);
  });
}



test('A new native life remains claimable when death precedes the stock respawn callback',() => {
  const f = fixture(true); let grants = 0;
  f.api.dead.set(81,true); f.stock.recordDeath(81);
  assert.ok(accepted(f.stock.dress(81,() => { grants++; return true; })));
  f.api.dead.set(81,false); f.api.life.set(81,1);
  // Native resurrection has persisted, while its deferred stock callback has not run.
  f.api.dead.set(81,true); f.stock.recordDeath(81);
  assert.ok(accepted(f.stock.dress(81,() => { grants++; return true; })));
  f.stock.recordDeath(81);
  refuses(() => f.stock.dress(81,() => { grants++; return true; }));
  assert.equal(grants,2);
});
test('Restart after native resurrection preserves the next corpse reward without a callback',() => {
  const f = fixture(true); let grants = 0;
  f.api.dead.set(81,true); f.stock.recordDeath(81);
  assert.ok(accepted(f.stock.dress(81,() => { grants++; return true; })));
  f.api.dead.set(81,false); f.api.life.set(81,1);
  const restored = f.reload();
  f.api.dead.set(81,true);
  restored.recordDeath(81);
  assert.ok(accepted(restored.dress(81,() => { grants++; return true; })));
  refuses(() => f.reload().dress(81,() => { grants++; return true; }));
  assert.equal(grants,2);
});
test('Native life generation permits one corpse claim even when both stock callbacks were missed',() => {
  const f = fixture(true); let grants = 0;
  f.api.dead.set(81,true); f.stock.recordDeath(81);
  assert.ok(accepted(f.stock.dress(81,() => { grants++; return true; })));
  f.api.life.set(81,1);
  const restored = f.reload();
  assert.ok(accepted(restored.dress(81,() => { grants++; return true; })));
  refuses(() => restored.dress(81,() => { grants++; return true; }));
  assert.equal(grants,2);
});
test('Repeated callbacks for one native life cannot refill a claimed corpse',() => {
  const f = fixture(true); let grants = 0;
  f.api.life.set(81,4); f.api.dead.set(81,true); f.stock.recordDeath(81);
  assert.ok(accepted(f.stock.dress(81,() => { grants++; return true; })));
  for(let i=0;i<3;i++) {
    f.stock.recordDeath(81);
    try { f.stock.recordRespawn(81); } catch(error) {}
  }
  refuses(() => f.reload().dress(81,() => { grants++; return true; }));
  assert.equal(grants,1);
});

test('A fenced old-body refusal cannot undo the next body reservation',() => {
  const f=fixture(true);f.api.life.set(81,4);f.api.dead.set(81,true);f.stock.recordDeath(81);
  const fence=()=>f.api.life.get(81)===4;let newer=0;
  const result=f.stock.dress(81,()=>{
    f.api.life.set(81,5);f.stock.recordDeath(81);
    assert.equal(f.stock.dress(81,()=>{newer++;return true;}).ok,true);
    return false;
  },fence);
  assert.equal(result.ok,false);assert.equal(newer,1);
  assert.equal(f.stock.dress(81,()=>{newer++;return true;}).ok,false);
  assert.equal(newer,1,'old rollback cannot refill an already-dressed replacement');
});
test('A failed native body fence reserves nothing, and a definite refusal releases only its own claim',() => {
  const f=fixture(true);f.api.life.set(81,4);f.api.dead.set(81,true);let grants=0;
  assert.equal(f.stock.dress(81,()=>{grants++;return true;},()=>false).ok,false);
  assert.equal(grants,0);assert.equal(f.api.values.has('81:'+property),false);
  assert.equal(f.stock.dress(81,()=>false,()=>true).ok,false);
  assert.equal(f.stock.dress(81,()=>{grants++;return true;},()=>true).ok,true);
  assert.equal(grants,1);
});
for(const phase of ['death','reservation'])test('A reentrant '+phase+' fence cannot pay the same body twice',() => {
  const f=fixture(true);f.api.life.set(81,4);f.api.dead.set(81,true);
  if(phase==='reservation')f.stock.recordDeath(81);
  let calls=0,grants=0;
  const result=f.stock.dress(81,()=>{grants++;return true;},()=>{
    if(++calls===2)assert.equal(f.stock.dress(81,()=>{grants++;return true;}).ok,true);
    return true;
  });
  assert.equal(result.ok,false);assert.equal(grants,1);
  assert.equal(f.stock.dress(81,()=>{grants++;return true;}).ok,false);assert.equal(grants,1);
});

console.log(JSON.stringify({passed,failed}));
process.exitCode = failed ? 1 : 0;
