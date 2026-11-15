'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.GM || path.join(__dirname,'../../game/gamemode.js'),'utf8');
function handler(name) {
  const start = source.indexOf("mp."+name+" = guard('"+name+"'");
  const end = source.indexOf('\n});',start);
  assert.ok(start >= 0 && end > start,'Extract the production '+name+' handler');
  return source.slice(start,end+4);
}
const handlerSource = handler('onDeath')+'\n'+handler('onRespawn');
const NPC = 0xff002001, HUMAN = 0xff000101, OTHER_NPC = 0xff002002;
const home = {cellOrWorldDesc:'home:Skyrim.esm',pos:[1,2,3],rot:[0,0,0]};
const temple = {desc:'temple:Skyrim.esm',pos:[100,200,300],rot:[0,0,90],
  cell:'Temple',slot:0,hold:'Whiterun',via:'death',reason:'safe'};
const plain = value => JSON.parse(JSON.stringify(value));
function fixture(options = {}) {
  const states = new Map([
    [NPC,{profileId:-1,baseDesc:options.carcass ? 'wolf:Skyrim.esm' : 'guard:Skyrim.esm',
      spawnPoint:plain(home),spawnDelay:25,worldOrCellDesc:'3c:Skyrim.esm',pos:[999,999,999],isDead:false}],
    [HUMAN,{profileId:17,baseDesc:'person:Skyrim.esm',spawnPoint:plain(home),spawnDelay:25,
      worldOrCellDesc:'3c:Skyrim.esm',pos:[5,6,7],isDead:false}],
    [OTHER_NPC,{profileId:-1,baseDesc:'bandit:Skyrim.esm',spawnPoint:plain(home),isDead:false}]
  ]);
  const writes = [], credits = [], arrivals = [], deaths = [], respawns = [], policyReads = [], pending = [];
  const logs = [], notices = [], removed = [];
  const context = {Number,Math,Date,JSON,mp:{
    get(id,property) {
      assert.ok(states.has(id),'Read an existing actor');
      return states.get(id)[property];
    },
    set(id,property,value) {
      writes.push({id,property,value:plain(value)});
      states.get(id)[property] = plain(value);
    }
  },
  guard(name,fn) { return fn; },
  // #2623: a spawn nobody kept, read off the actor's own marker in the real file.
  isTemporarySpawn(id) { return !!options.temporary && id === NPC; },
  removeSpawned(id) { removed.push(id); return true; },
  HUNT_TUNING:{bodySeconds:300},
  isCarcass(desc) { return desc === 'wolf:Skyrim.esm'; },
  creditWork(id,half) { credits.push({id,half});return 'Warrior rank increased'; },
  // How many pieces a kill is (#1386); its own harness is test-1386-warrior.js.
  killPieces() { return 1; },
  notify(id,message) { notices.push({id,message}); },
  say() {},log(...args) { logs.push(args); },
  cameInOf() { return null; },
  resolveArrival(site) { arrivals.push(plain(site));return options.noArrival ? null : plain(temple); },
  setTimeout(fn,delay) { pending.push({fn,delay});return pending.length; },
  __thornswoodCharacter:{stateOf(id) { return {prof:'warrior',half:'bulwark'}; }},
  __thornswoodResourceStock:{
    recordDeath(id) { deaths.push({id,isDead:states.get(id).isDead}); },
    recordRespawn(id) {
      assert.equal(states.get(id).isDead,false,'Stock can reset only after the native respawn flag clears');
      respawns.push(id);
    }
  }};
  if(!options.noPopulation) context.__thornswoodNpcPopulation = {
    returnMinutes(id) { policyReads.push(id);return options.minutes === undefined ? 23 : options.minutes; }
  };
  vm.createContext(context);
  vm.runInContext(handlerSource,context,{filename:'production-npc-death-handlers.js'});
  return {states,writes,credits,arrivals,deaths,respawns,policyReads,pending,logs,notices,removed,
    context,
    death(id,killer) { context.mp.onDeath(id,killer); },
    respawn(id) { context.mp.onRespawn(id); },
    flush() { while(pending.length) pending.shift().fn(); }
  };
}
let passed = 0, failed = 0;
function test(name,fn) {
  try { fn();passed++;console.log('PASS '+name); }
  catch(error) { failed++;console.error('FAIL '+name+': '+error.message); }
}
test('Native NPC profile -1 awards positive human Warrior credit and preserves its home',() => {
  const f = fixture();
  f.death(NPC,HUMAN);
  assert.deepEqual(f.credits,[{id:HUMAN,half:'bulwark'}]);
  assert.equal(f.notices.length,1);
  assert.deepEqual(f.arrivals,[],'NPC death cannot resolve a human temple arrival');
  assert.deepEqual(f.states.get(NPC).spawnPoint,home);
  assert.ok(!f.writes.some(write => write.id === NPC && write.property === 'spawnPoint'),
    'NPC home is never replaced with the person arrival');
});
test('NPC death records shared stock before native OnFireSuccess sets isDead',() => {
  const f = fixture();
  f.death(NPC,0);
  assert.deepEqual(f.deaths,[{id:NPC,isDead:false}]);
});
test('Population policy supplies non-carcass NPC return delay in seconds',() => {
  const f = fixture({minutes:23});
  f.death(NPC,0);
  assert.deepEqual(f.policyReads,[NPC]);
  assert.equal(f.states.get(NPC).spawnDelay,23*60);
});
test('Population policy overrides the old five-minute hunt carcass delay',() => {
  const f = fixture({carcass:true,minutes:47});
  f.death(NPC,HUMAN);
  assert.equal(f.states.get(NPC).spawnDelay,47*60);
  assert.deepEqual(f.states.get(NPC).spawnPoint,home);
  assert.deepEqual(f.deaths,[{id:NPC,isDead:false}]);
});
test('Hunt delay remains available before population initialization',() => {
  const f = fixture({carcass:true,noPopulation:true});
  f.death(NPC,0);
  assert.equal(f.states.get(NPC).spawnDelay,300);
  assert.deepEqual(f.arrivals,[]);
});
// #2623, Djinn 17 Oct: "leave the normal body time". A temporary spawn's
// body lies what the same creature gets in the wild, never a kept spawn's
// return minutes, and the stand-up at the end of it is refused and the
// spawn removed after the event.
test('A temporary spawn that is not an animal lies the engine\'s 25 seconds, not the return minutes',() => {
  const f = fixture({temporary:true,minutes:45});
  f.death(NPC,0);
  assert.deepEqual(f.policyReads,[]);
  assert.equal(f.states.get(NPC).spawnDelay,25);
  assert.deepEqual(f.removed,[],'Nothing is removed while the body lies there');
});
test('A temporary spawned animal lies the hunt body time',() => {
  const f = fixture({temporary:true,carcass:true,minutes:45});
  f.death(NPC,HUMAN);
  assert.equal(f.states.get(NPC).spawnDelay,300);
  assert.deepEqual(f.removed,[]);
});
test('A temporary spawn\'s stand-up is refused and it is removed after the event',() => {
  const f = fixture({temporary:true});
  f.states.get(NPC).isDead = true;
  const answer = f.context.mp.onRespawn(NPC);
  assert.equal(answer,false,'false blocks the native RespawnEvent');
  assert.deepEqual(f.removed,[],'Not removed inside the engine event');
  f.flush();
  assert.deepEqual(f.removed,[NPC]);
  assert.deepEqual(f.respawns,[],'No stock reset for a creature that is gone');
});
test('A kept or ordinary NPC still stands up',() => {
  const f = fixture();
  f.states.get(NPC).isDead = true;
  assert.notEqual(f.context.mp.onRespawn(NPC),false);
  f.states.get(NPC).isDead = false;
  f.flush();
  assert.deepEqual(f.removed,[]);
  assert.deepEqual(f.respawns,[NPC]);
});
test('Positive human death retains temple arrival and receives no NPC stock or population policy',() => {
  const f = fixture();
  f.death(HUMAN,OTHER_NPC);
  assert.deepEqual(f.arrivals,[{desc:'3c:Skyrim.esm',pos:[5,6,7],cameIn:null}]);
  assert.deepEqual(f.states.get(HUMAN).spawnPoint,
    {cellOrWorldDesc:temple.desc,pos:temple.pos,rot:temple.rot});
  assert.equal(f.states.get(HUMAN).spawnDelay,25);
  assert.deepEqual(f.deaths,[]);
  assert.deepEqual(f.policyReads,[]);
  assert.deepEqual(f.credits,[],'NPC killers cannot receive human Warrior work');
});
test('Positive human killing another person is not Warrior work',() => {
  const f = fixture();
  f.states.get(OTHER_NPC).profileId = 18;
  f.death(HUMAN,OTHER_NPC);
  assert.deepEqual(f.credits,[]);
  assert.equal(f.arrivals.length,1);
});
test('Native NPC killer profile -1 receives no Warrior credit for another NPC',() => {
  const f = fixture();
  f.death(NPC,OTHER_NPC);
  assert.deepEqual(f.credits,[]);
  assert.deepEqual(f.deaths,[{id:NPC,isDead:false}]);
});
test('Human death with no resolved arrival preserves the existing native spawn point',() => {
  const f = fixture({noArrival:true});
  f.death(HUMAN,0);
  assert.equal(f.arrivals.length,1);
  assert.deepEqual(f.states.get(HUMAN).spawnPoint,home);
});
test('NPC stock respawn is deferred until native isDead becomes false',() => {
  const f = fixture();
  f.states.get(NPC).isDead = true;
  f.respawn(NPC);
  assert.deepEqual(f.respawns,[],'Native invokes the handler while the actor still has the death flag');
  assert.equal(f.pending.length,1,'Queue stock reset after native event completion');
  assert.equal(f.pending[0].delay,0,'Defer to the next task without a new respawn delay');
  f.states.get(NPC).isDead = false;
  f.flush();
  assert.deepEqual(f.respawns,[NPC]);
});
test('A still-dead NPC cannot reset resource stock in a deferred respawn callback',() => {
  const f = fixture();
  f.states.get(NPC).isDead = true;
  f.respawn(NPC);
  f.flush();
  assert.deepEqual(f.respawns,[]);
});
test('Positive human respawn retains its existing behavior without NPC stock reset',() => {
  const f = fixture();
  f.respawn(HUMAN);
  f.flush();
  assert.deepEqual(f.respawns,[]);
  assert.ok(f.logs.some(args => args[0] === 'respawn' && args[1] === HUMAN));
});
console.log(JSON.stringify({passed,failed}));
process.exitCode = failed ? 1 : 0;
