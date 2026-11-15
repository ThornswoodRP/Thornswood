'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../game/gamemode.js'), 'utf8');
const begin = source.indexOf('// NPC SERVER RUNTIME BEGIN');
const end = source.indexOf('// NPC SERVER RUNTIME END');
assert.ok(begin >= 0 && end > begin, 'Test the production runtime block');
const plain = value => JSON.parse(JSON.stringify(value));

// Valid TES5 NVNM geometry; flags and reciprocal links are independent.
function geometry(vertices, triangles, flags = [], reciprocal = true) {
  const b = Buffer.alloc(24 + vertices.length * 12 + triangles.length * 16);
  b.writeUInt32LE(12, 0);
  b.writeUInt32LE(vertices.length, 16);
  vertices.forEach((v, i) => v.forEach((n, j) => b.writeFloatLE(n, 20 + i * 12 + j * 4)));
  const offset = 20 + vertices.length * 12;
  b.writeUInt32LE(triangles.length, offset);
  triangles.forEach((t, i) => {
    const at = offset + 4 + i * 16;
    t.forEach((n, j) => b.writeUInt16LE(n, at + j * 2));
    for (let j = 0; j < 3; j++) {
      const edge = [t[j], t[(j + 1) % 3]];
      const neighbor = reciprocal ? triangles.findIndex((other, k) =>
        k !== i && edge.every(v => other.includes(v))) : -1;
      b.writeInt16LE(neighbor, at + 6 + j * 2);
    }
    b.writeUInt16LE(flags[i] || 0, at + 12);
  });
  return { data: b, vertices, triangles };
}
const square = () => geometry([[0,0,0],[600,0,0],[0,600,0],[600,600,0]], [[0,1,2],[1,3,2]]);
const isolated = flags => geometry([[0,0,0],[300,0,0],[0,300,0]], [[0,1,2]], flags);
function inside(points, p, lift = 0) {
  const signs = points.map((a, i) => {
    const b = points[(i + 1) % 3];
    return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
  });
  const [a,b,c] = points;
  const area = (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  if (Math.abs(area) < 0.01) return false;
  const u = ((p[0]-a[0])*(c[1]-a[1])-(p[1]-a[1])*(c[0]-a[0]))/area;
  const v = ((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))/area;
  const height = a[2]+u*(b[2]-a[2])+v*(c[2]-a[2]);
  return Math.abs(p[2]-height-lift) < 0.01 &&
    (signs.every(v => v >= -0.01) || signs.every(v => v <= 0.01));
}
function contains(mesh, p, lift = 0) {
  if (Array.isArray(mesh)) return mesh.some(part => contains(part, p, lift));
  return mesh.triangles.some(t => inside(t.map(i => mesh.vertices[i]), p, lift));
}
function actor(overrides = {}) {
  return Object.assign({ pos:[10,10,0], rot:[0,0,0], cellOrWorld:60,
    isDead:false, isDisabled:false, aggression:0, confidence:3,
    factions:[], combatTarget:0, canSwim:false, canFly:false, immobile:false,
    meleeReach:128,meleeAllowance:32 }, overrides);
}

function fixture(options = {}) {
  const context = { Buffer, Math, Date, Number, Map, Set, JSON };
  vm.createContext(context);
  vm.runInContext(source.slice(begin, end), context);
  assert.equal(typeof context.startSharedNpcServerRuntime, 'function',
    'A shared production entry must replace the single-actor deployed entry');
  let time = 0, sequence = 0, callback = null;
  const pending = new Map(), states = new Map(), persisted = new Map(), writes = [];
  // A spawn made in this run of the server (#2623); kept and temporary are
  // checked in test-npc-population-runtime.js.
  for(const id of options.commanded || []) persisted.set(id+':thornswoodNpcCommanded',{run:'run-now'});
  const ids = options.ids || Array.from({length:options.count || 3}, (_, i) => i + 1);
  ids.forEach(id => states.set(id, actor(options.npc && options.npc[id])));
  const humanIds = options.humans || [];
  humanIds.forEach(id => states.set(id, actor(options.human && options.human[id])));
  let online = humanIds.slice();
  const originalIds = [...states.keys()], moved = new Set(), controlled = new Set();
  const moves = [], attacks = [], attackAttempts = [], logs = [], controlEvents = [], snapshots = [], teleports = [];
  const meshes = options.meshes || new Map([[60, square()]]);
  const navLookedUp = new Set();
  const budgetViolations = [];
  const mappingCalls = [], policyEvents = [];
  let loadedLookups = 0;
  let runtime;
  function spend(key, amount = 1) {
    assert.ok(callback, 'API work must run inside a scheduled callback');
    callback[key] = (callback[key] || 0) + amount;
    const limits = { load:8, prepare:4, background:64, near:32 };
    const message = `${key} budget exceeded: ${callback[key]}`;
    if (callback[key] > limits[key]) budgetViolations.push(message);
    assert.ok(callback[key] <= limits[key], message);
  }
  const timers = {
    setTimeout(fn, delay) {
      assert.ok(Number.isFinite(delay) && delay >= 0);
      const handle = ++sequence;
      pending.set(handle, {fn, at:time + delay});
      return handle;
    },
    clearTimeout(handle) { pending.delete(handle); }
  };
  const api = {
    getLoadedNpcIds() { loadedLookups++; return ids.slice().sort((a,b) => a-b); },
    loadNpcBatch(cursor, limit) {
      assert.ok(Number.isInteger(limit) && limit > 0 && limit <= 8);
      spend('load', Math.min(limit, ids.length - cursor));
      return {nextCursor:Math.min(cursor + limit, ids.length), total:ids.length,
        actorIds:ids.slice(cursor, cursor + limit)};
    },
    makeProperty() {},
    setNpcPlacementExclusions() {},
    getNpcAIState(id) {
      if (options.badState === id) throw new Error('one malformed actor');
      assert.ok(states.has(id), `unknown actor ${id}`);
      return plain(states.get(id));
    },
    getFactionReactions() { return plain(options.reactions || []); },
    get(id, prop) {
      if (id === 0 && prop === 'onlinePlayers') {
        if (options.onlineFails && options.onlineFails()) throw new Error('observer list unreadable');
        return online.slice();
      }
      assert.ok(states.has(id), `unknown property actor ${id}`);
      const state = states.get(id);
      if (prop === 'locationalData') return {pos:state.pos.slice(), rot:state.rot.slice(),
        cellOrWorldDesc:state.cellOrWorld.toString(16) + ':Skyrim.esm'};
      if (prop === 'isDead' || prop === 'isDisabled') return state[prop];
      if (prop === 'baseDesc') return 'a:Skyrim.esm';
      if (options.badProfile === id) throw new Error('one corrupt routine profile');
      return persisted.has(id + ':' + prop) ? plain(persisted.get(id + ':' + prop)) : null;
    },
    set(id, prop, value) {
      persisted.set(id + ':' + prop, plain(value));
      writes.push({id, prop, at:time, value:plain(value)});
      // The engine teleports an actor whose locationalData is written.
      if (prop === 'locationalData') {
        const state = states.get(id);
        state.pos = value.pos.slice(); state.rot = value.rot.slice();
        teleports.push({id, pos:value.pos.slice(), at:time});
      }
    },
    getIdFromDesc(desc) { return parseInt(desc.split(':')[0], 16); },
    getDescFromId(id) { return id.toString(16)+':Skyrim.esm'; },
    getNavmeshRecords(cell) {
      if (options.badNavCell === cell) throw new Error('one unreadable navmesh');
      if (options.records) return [...options.records].filter(([,record]) => record.cell === cell)
        .map(([id]) => id);
      return meshes.has(cell) ? [cell + 1000000] : [];
    },
    lookupEspmRecordById(id) {
      if (options.records) {
        const record = options.records.get(id);
        if (!record) throw new Error('missing mesh record');
        navLookedUp.add(record.cell);
        return {record:{fields:[{type:'NVNM',data:record.mesh.data}]},
          toGlobalRecordId(local) {
            mappingCalls.push({id,local});
            return record.mapping.get(local) || 0;
          }};
      }
      const mesh = meshes.get(id - 1000000);
      if (!mesh) throw new Error('missing mesh record');
      navLookedUp.add(id - 1000000);
      return {record:{fields:[{type:'NVNM', data:mesh.data}]}};
    },
    setNpcServerControlled(id, on) {
      assert.ok(ids.includes(id), 'Authority must preserve loaded NPC identities');
      controlEvents.push({id, on, at:time});
      policyEvents.push({kind:"control",id,on,at:time,spawnDelay:persisted.get(id+":spawnDelay")});
      if (on) {
        spend('prepare');
        const state = states.get(id);
        if (state.isHuman || state.profileId >= 0) throw new Error('Native authority rejects human identities');
        controlled.add(id);
      } else controlled.delete(id);
    },
    updateNpcMovement(id, pos, rot, speed) {
      assert.ok(controlled.has(id), 'Movement requires server authority');
      const state = states.get(id), mesh = meshes.get(state.cellOrWorld);
      assert.ok(!state.isDead && !state.isDisabled && !state.immobile, 'Inactive NPCs pause');
      assert.ok(pos.length === 3 && pos.every(Number.isFinite));
      assert.ok(rot.length === 3 && rot.every(Number.isFinite));
      assert.ok(Number.isFinite(speed) && speed >= 0 && speed <= 300);
      const nearby = online.some(h => states.get(h).cellOrWorld === state.cellOrWorld &&
        Math.hypot(...states.get(h).pos.map((v,i) => v-state.pos[i])) <= 4096);
      spend(nearby ? 'near' : 'background');
      const lift = options.lifts && options.lifts[id] || 0;
      // Ids in options.free are held to their own test's rule instead.
      if (!(options.free && options.free.has(id))) {
        assert.ok(contains(mesh, pos, lift), 'Movement stays in a walkable triangle');
        for (let fraction = 0; fraction <= 1; fraction += 0.1) {
          assert.ok(contains(mesh, state.pos.map((v,i) => v+(pos[i]-v)*fraction), lift),
            'Every movement segment must stay on the local surface');
        }
      }
      if (Math.hypot(...pos.map((v,i) => v-state.pos[i])) > 0.001) moved.add(id);
      moves.push({id, pos:pos.slice(), from:state.pos.slice(), at:time, speed});
      snapshots.push({id,pos:pos.slice(),at:time,speed,
        runMode:speed > 0 ? 'Walking' : 'Standing',reliable:false});
      state.pos = pos.slice(); state.rot = rot.slice();
    },
    stopNpcMovement(id) {
      assert.ok(controlled.has(id),'Stopping movement requires retained server authority');
      const state = states.get(id);
      snapshots.push({id,pos:state.pos.slice(),at:time,speed:0,runMode:'Standing',reliable:true});
    },
    serverNpcAttack(id, target) {
      assert.ok(controlled.has(id));
      const attacker = states.get(id),victim = states.get(target);
      const attack = {id,target,at:time,distance:Math.hypot(...attacker.pos.map((v,i) =>
        v-victim.pos[i]))};
      attackAttempts.push(attack);
      if(!Number.isFinite(attacker.meleeReach) || attacker.meleeReach <= 0 ||
          attack.distance > Math.min(300,attacker.meleeReach+victim.meleeAllowance)) return false;
      attacks.push(attack);
      return true;
    },
    placeActor() { assert.fail('No new cast members'); },
    destroyActor() { assert.fail('No cast removals'); }
  };
  let population = options.population ? {
    configure(id,state) {
      policyEvents.push({kind:"configure",id,at:time});
      return options.population(id,plain(state),api);
    }
  } : undefined;
  if(options.populationData) {
    const policyBegin=source.indexOf('// NPC POPULATION POLICY BEGIN');
    const policyEnd=source.indexOf('// NPC POPULATION POLICY END');
    vm.runInContext(source.slice(policyBegin,policyEnd),context);
    population=context.createNpcPopulation(api,options.populationData,['Skyrim.esm'],null,{run:'run-now'});
  }
  // How often each of the runtime's tasks reads the clock (#3181): a read
  // per NPC it looks at, so it counts how many a pass looks at.
  const reads = new Map();
  let task = '';
  runtime = context.startSharedNpcServerRuntime(api, timers, () => { reads.set(task, (reads.get(task) || 0) + 1); return time; },
    text => logs.push(text), population);
  function advance(ms) {
    const until = time + ms;
    let runs = 0;
    while (pending.size) {
      const [handle, task] = [...pending].sort((a,b) => a[1].at-b[1].at || a[0]-b[0])[0];
      if (task.at > until) break;
      time = task.at; pending.delete(handle); callback = {};
      const named = task.fn.npcRuntimeTask || '';
      try { taskName(named); task.fn(); } finally { callback = null; taskName(''); }
      assert.ok(++runs < 30000, 'Each turn must yield rather than reschedule endlessly');
    }
    time = until;
    // The runtime deliberately catches individual failures. It must not hide
    // an exceeded scheduling budget by treating our assertion as an NPC fault.
    assert.deepEqual(budgetViolations, [], 'No callback may exceed its budget');
    assert.deepEqual([...states.keys()], originalIds, 'The current cast is preserved');
  }
  function taskName(name) { task = name; }
  function stop() { runtime.stop(); assert.equal(pending.size, 0, 'Stop cancels every timer'); }
  return {api, states, ids, moved, controlled, moves, attacks,attackAttempts,logs,controlEvents,mappingCalls,snapshots,teleports,writes,
    timers, policyEvents, loadedLookups:() => loadedLookups,
    addNpc(id, overrides = {}) {
      assert.ok(!states.has(id)); ids.push(id); states.set(id,actor(overrides));
      originalIds.push(id);
    },
    time:() => time, status:() => plain(runtime.getStatus()), reads,
    advance, stop, disconnect(id) { online = online.filter(other => other !== id); },
    forget(id) { runtime.forget(id); }};
}

let failed = 0, passed = 0;
function test(name, fn) {
  try { fn(); console.log('PASS ' + name); passed++; }
  catch (error) { console.error('FAIL ' + name + ': ' + error.message); failed++; }
}

test('All eligible loaded identities move unattended, with no cast changes', () => {
  const f = fixture({ids:[11,42,103,9001]});
  f.advance(30000);
  assert.deepEqual([...f.moved].sort((a,b) => a-b), f.ids);
  assert.equal(f.controlled.size, f.ids.length);
  f.stop();
});
test('A single isolated triangle supports safe background activity', () => {
  const f = fixture({count:2, meshes:new Map([[60, isolated()]])});
  f.advance(15000); assert.equal(f.moved.size, 2); f.stop();
});
test('An external-edge flag does not prevent movement inside its own triangle', () => {
  const f = fixture({count:2, meshes:new Map([[60, isolated([1])]])});
  f.advance(15000); assert.equal(f.moved.size, 2); f.stop();
});
test('Dead and disabled actors pause and resume after becoming active', () => {
  const f = fixture({count:3});
  f.advance(3000);
  const first = f.states.get(1), second = f.states.get(2);
  first.isDead = true; second.isDisabled = true;
  const paused = [first.pos.slice(), second.pos.slice()];
  f.advance(3000);
  assert.deepEqual([first.pos, second.pos], paused);
  const count = f.moves.length;
  first.isDead = false; second.isDisabled = false;
  f.advance(15000);
  assert.ok(f.moves.slice(count).some(m => m.id === 1 && m.speed > 0));
  assert.ok(f.moves.slice(count).some(m => m.id === 2 && m.speed > 0));
  f.stop();
});
for (const fault of ['badState', 'badProfile', 'badNavCell']) {
  test('One ' + fault + ' does not stop healthy actors', () => {
    const options = {count:3, [fault]:fault === 'badNavCell' ? 61 : 1,
      npc:{1:{cellOrWorld:61}}, meshes:new Map([[60,square()],[61,square()]])};
    const f = fixture(options);
    f.advance(15000);
    assert.ok(f.moved.has(2) && f.moved.has(3));
    assert.ok(f.controlled.has(1),'An unavailable routine cannot return an existing NPC to client authority');
    assert.ok(!f.moves.some(move => move.id === 1),'Faulted navigation or state must stay stationary');
    const status = f.status();
    assert.equal(status.controlled,3);
    assert.equal(status.active,2);
    assert.equal(status.unavailable,1);
    assert.equal(status.active+status.unavailable,status.loaded);
    assert.ok(f.logs.length, 'Individual failures must be observable');
    f.stop();
  });
}
for (const aggression of [0, 1]) {
  test('Aggression ' + aggression + ' does not proximity-attack neutral humans', () => {
    const f = fixture({count:1, humans:[100], npc:{1:{aggression}},
      human:{100:{pos:[20,20,0]}}});
    f.advance(15000); assert.equal(f.attacks.length, 0); assert.ok(f.moved.has(1)); f.stop();
  });
}
test('Enemy reaction value 1 allows hostility and value 0 remains neutral', () => {
  for (const reaction of [0,1,2,3]) {
    const f = fixture({count:1, humans:[100], npc:{1:{aggression:1, factions:[{id:7,rank:0}]}},
      human:{100:{pos:[20,20,0], factions:[{id:8,rank:0}]}},
      reactions:[{source:7,target:8,reaction}]});
    f.advance(15000);
    assert.equal(f.attacks.length > 0, reaction === 1, 'reaction ' + reaction);
    f.stop();
  }
});
test('Negative-rank faction entries cannot introduce hostility', () => {
  for (const negativeActor of ['npc','human']) {
    const npc = {aggression:1,factions:[{id:7,rank:negativeActor === 'npc' ? -1 : 0}]};
    const human = {pos:[20,20,0],factions:[{id:8,rank:negativeActor === 'human' ? -1 : 0}]};
    const f = fixture({count:1,humans:[100],npc:{1:npc},human:{100:human},
      reactions:[{source:7,target:8,reaction:1}]});
    f.advance(15000); assert.equal(f.attacks.length,0); f.stop();
  }
});
test('A live friendly faction change cancels spontaneous attacks before the observer snapshot refreshes', () => {
  const f = fixture({count:1,humans:[100],
    npc:{1:{aggression:1,factions:[{id:7,rank:0}]}},
    human:{100:{pos:[20,20,0],factions:[{id:8,rank:0}]}},
    reactions:[{source:7,target:8,reaction:1}]});
  f.advance(1100);
  assert.ok(f.attacks.length > 0,'The initial enemy relation must drive spontaneous combat');
  f.attacks.length = 0;
  f.states.get(100).factions = [{id:7,rank:0}];
  f.advance(500);
  assert.equal(f.attacks.length,0,'Fresh common faction membership must suppress cached hostility');
  assert.ok(f.controlled.has(1)); f.stop();
});
test('Retaliation approaches a distant target through connected triangles before attacking', () => {
  const f = fixture({count:1,humans:[100],npc:{1:{combatTarget:100}},
    human:{100:{pos:[500,500,0]}}});
  f.advance(30000);
  assert.ok(f.attacks.length > 0, 'Received hits can drive server retaliation');
  assert.ok(f.moves.some(m => m.id === 1 && m.pos[0]+m.pos[1] > 600),
    'Chase reaches the target triangle through the shared local region');
  assert.ok(f.attacks.every(a => a.distance <= 160), 'Attack requires approach, not distant hits');
  f.stop();
});
test('A short melee reach approaches within native range before accepted attacks', () => {
  const f = fixture({count:1,humans:[100],
    npc:{1:{combatTarget:100,meleeReach:32}},
    human:{100:{pos:[160,10,0],meleeAllowance:16}}});
  f.advance(15000);
  assert.ok(f.attacks.length > 0,'A target inside the old 160-unit threshold still requires a native-range approach');
  assert.ok(f.attacks.every(attack => attack.distance <= 48));
  assert.ok(f.moves.some(move => move.id === 1 &&
    Math.hypot(...move.pos.map((v,i) => v-f.states.get(100).pos[i])) <= 48));
  assert.ok(f.controlled.has(1)); f.stop();
});
test('A target above short melee reach cannot freeze ambient movement on the NPC surface', () => {
  const f = fixture({count:1,humans:[100],
    npc:{1:{combatTarget:100,meleeReach:32}},
    human:{100:{pos:[30,30,60],meleeAllowance:16}}});
  f.advance(15000);
  assert.equal(f.attacks.length,0,'A 60-unit vertical gap exceeds the native 48-unit reach');
  assert.ok(f.moves.some(move => move.id === 1 && move.at >= 10000 && move.speed > 0),
    'An unreachable vertical target must leave ambient activity running');
  assert.ok(f.moves.every(move => Math.abs(move.pos[2]) < 0.01),'NPC movement must stay on its own floor');
  assert.ok(f.controlled.has(1)); f.stop();
});
test('An NPC with zero melee reach keeps ambient activity instead of waiting for rejected hits', () => {
  const f = fixture({count:1,humans:[100],
    npc:{1:{combatTarget:100,meleeReach:0}},human:{100:{pos:[20,20,0]}}});
  f.advance(15000);
  assert.equal(f.attackAttempts.length,0,'Invalid native melee reach cannot authorize an attack attempt');
  assert.ok(f.moves.some(move => move.at >= 10000 && move.speed > 0));
  assert.ok(f.controlled.has(1)); f.stop();
});
test('Confidence-zero retaliation can flee without any melee reach', () => {
  const f = fixture({count:1,humans:[100],
    npc:{1:{confidence:0,combatTarget:100,meleeReach:0}},human:{100:{pos:[20,20,0]}}});
  f.advance(15000);
  assert.equal(f.attackAttempts.length,0);
  assert.ok(f.moves.some(move => move.at >= 10000 && move.speed > 0));
  assert.ok(f.moves.some(move => Math.hypot(move.pos[0]-20,move.pos[1]-20) > 150),
    'Melee capability cannot suppress confidence-driven flight');
  assert.ok(f.controlled.has(1)); f.stop();
});
for (const invalid of ['disconnected','cross-cell','dead']) {
  test('A ' + invalid + ' retaliation target clears and local activity resumes', () => {
    const f = fixture({count:1,humans:[100],npc:{1:{combatTarget:100}},
      human:{100:{pos:[500,500,0]}}});
    if (invalid === 'disconnected') f.disconnect(100);
    if (invalid === 'cross-cell') f.states.get(100).cellOrWorld = 61;
    if (invalid === 'dead') f.states.get(100).isDead = true;
    f.advance(15000);
    assert.equal(f.attacks.length,0);
    assert.ok(f.moved.has(1), 'Invalid target cannot freeze the NPC');
    f.stop();
  });
}
test('Nearby enemies separated by unlinked triangles cannot be attacked through a wall', () => {
  const mesh = geometry([[0,0,0],[90,0,0],[0,90,0],[90,90,0]], [[0,1,2],[1,3,2]], [], false);
  const f = fixture({count:1,humans:[100],meshes:new Map([[60,mesh]]),
    npc:{1:{combatTarget:100}},human:{100:{pos:[80,80,0]}}});
  f.advance(15000);
  assert.equal(f.attacks.length,0);
  assert.ok(f.moves.every(m => inside(mesh.triangles[0].map(i => mesh.vertices[i]),m.pos)),
    'Shared vertices cannot replace reciprocal triangle links');
  f.stop();
});
test('A reciprocal shared edge with tiny surface noise cannot freeze reachable combat', () => {
  const mesh = geometry([[0,0,0],[600,0,0],[0,600,0],[600,600,30]],
    [[0,1,2],[1,3,2]]);
  // The point is within navigation's edge tolerance on both triangles. Their
  // surface heights differ by 0.0001, so independent nearest-floor lookups
  // choose different triangles although every route point is within 0.01.
  const f = fixture({count:1,humans:[100],meshes:new Map([[60,mesh]]),
    npc:{1:{pos:[300.001,300.001,0],combatTarget:100}},
    human:{100:{pos:[300.001,300.001,0.0001]}}});
  f.advance(15000);
  assert.ok(f.attacks.length > 0 || f.moved.has(1),
    'Coincident portal points must resolve reachable combat or make actual movement progress');
  assert.ok(f.controlled.has(1),'Shared-edge precision cannot revoke server authority');
  assert.ok(!f.logs.some(line => line.includes('Movement crossed an unverified navigation edge')));
  f.stop();
});
test('An NPC standing on a shared edge beside its target attacks instead of waiting for a step it never takes', () => {
  // #2032: 526e9 stood on the middle of the edge its triangle shares with
  // its target's, and the target's position, the same point as 32-bit floats,
  // fell 1.3e-5 outside its triangle. Here the target is 0.0057 units over
  // the diagonal of the square: inside navigation's 0.01 arrival distance,
  // outside triangle 0's edge tolerance, so the route is all behind the NPC.
  const f = fixture({count:1,humans:[100],
    npc:{1:{pos:[300,300,0],combatTarget:100}},
    human:{100:{pos:[300.004,300.004,0]}}});
  f.advance(15000);
  assert.ok(f.attacks.length > 0,'An NPC that has arrived beside its target attacks it');
  assert.ok(f.controlled.has(1));
  f.stop();
});
test('An overlapping unlinked triangle cannot displace a verified movement neighbor', () => {
  const mesh = geometry([[0,0,0],[600,0,0],[0,600,0],[600,600,0]],
    [[0,1,2],[1,3,2],[1,3,2]],[],false);
  const offset = 24+mesh.vertices.length*12;
  mesh.data.writeInt16LE(2,offset+8);
  mesh.data.writeInt16LE(0,offset+2*16+10);
  const f = fixture({count:1,meshes:new Map([[60,mesh]])});
  // Nobody sees it, so it takes a step every 15 seconds (#3181).
  for (let i = 0; i < 9; i++) f.advance(10000);
  assert.ok(f.moves.some(m => m.pos[0]+m.pos[1] > 600),
    'Traversal must choose the reciprocal neighbor among overlapping surfaces');
  assert.ok(f.controlled.has(1),'Overlapping unrelated navigation cannot revoke authority');
  assert.ok(!f.logs.some(line => line.includes('Movement crossed an unverified navigation edge')));
  f.stop();
});
test('Malformed geometry stays server owned and stationary while valid cast members remain active', () => {
  const broken = square(); broken.data = broken.data.subarray(0,21);
  const f = fixture({count:3,npc:{1:{cellOrWorld:61}},meshes:new Map([[60,square()],[61,broken]])});
  f.advance(15000); assert.ok(f.controlled.has(1));
  assert.ok(!f.moves.some(move => move.id === 1),'Malformed geometry cannot authorize movement');
  assert.ok(f.moved.has(2) && f.moved.has(3)); f.stop();
});
test('An NPC with no local navigation remains stationary under server authority', () => {
  const f = fixture({count:3,npc:{1:{cellOrWorld:61}},meshes:new Map([[60,square()]])});
  f.advance(15000);
  assert.equal(f.controlled.size,3,'The entire existing cast remains server owned');
  assert.ok(!f.moves.some(move => move.id === 1),'No navigation means no movement');
  assert.ok(f.moved.has(2) && f.moved.has(3));
  const status = f.status();
  assert.equal(status.active,2); assert.equal(status.unavailable,1);
  assert.equal(status.active+status.unavailable,status.loaded); f.stop();
});
test('A displaced actor loses unsafe movement while retaining server ownership', () => {
  const f = fixture({count:2});
  f.advance(1000);
  assert.ok(f.moved.has(1),'The displaced actor must have published walking movement first');
  f.states.get(1).pos = [1000,1000,0];
  const count = f.moves.length;
  // Nobody sees either, so each is stepped once every 15 seconds (#3181).
  f.advance(16000);
  assert.ok(f.controlled.has(1),'Movement failure cannot return authority to clients');
  assert.ok(!f.moves.slice(count).some(move => move.id === 1));
  assert.ok(f.moves.slice(count).some(move => move.id === 2));
  const last = f.snapshots.filter(snapshot => snapshot.id === 1).at(-1);
  assert.equal(last.speed,0,'Parking must overwrite the last walking speed');
  assert.equal(last.runMode,'Standing');
  assert.equal(last.reliable,true,'Observers must receive a reliable terminal movement snapshot');
  assert.deepEqual(last.pos,[1000,1000,0],'Stopping cannot translate an actor onto assumed geometry');
  assert.deepEqual(f.states.get(1).pos,[1000,1000,0]);
  assert.equal(f.status().active,1); assert.equal(f.status().unavailable,1); f.stop();
});
for (const humanState of [{isHuman:true},{profileId:0}]) {
  test('Native human authority guards reject identity ' + JSON.stringify(humanState), () => {
    const f = fixture({count:2,npc:{1:humanState}});
    f.advance(3000);
    assert.ok(!f.controlled.has(1),'Human identities cannot become server controlled');
    assert.ok(!f.moves.some(move => move.id === 1));
    assert.ok(f.controlled.has(2) && f.moved.has(2)); f.stop();
  });
}
for (const near of [false,true]) {
  test('1200 ' + (near ? 'nearby' : 'background') + ' NPCs receive fair bounded activity within 30 seconds', () => {
    const f = fixture({count:1200,humans:near ? [100000] : [],
      human:{100000:{pos:[20,20,0]}}});
    f.advance(30000);
    assert.equal(f.moved.size,1200,'Every eligible identity must receive activity');
    assert.equal(f.controlled.size,1200);
    f.stop();
  });
}
test('Confidence zero retaliation flees and keeps moving after the portal phase', () => {
  const f = fixture({count:1,humans:[100],npc:{1:{confidence:0,combatTarget:100}},
    human:{100:{pos:[20,20,0]}}});
  f.advance(15000);
  assert.equal(f.attacks.length,0,'Cowardly retaliation must not attack');
  assert.ok(f.moves.some(m => m.at >= 10000 && m.speed > 0),
    'A flee route must not stall at an already-reached portal');
  assert.ok(f.moves.some(m => Math.hypot(m.pos[0]-20,m.pos[1]-20) > 150),
    'Retaliation moves away from the aggressor');
  assert.ok(f.controlled.has(1));
  f.stop();
});
test('An elevated retaliation target is approached on the NPC floor without authority loss', () => {
  const f = fixture({count:1,humans:[100],npc:{1:{combatTarget:100}},
    human:{100:{pos:[500,500,40]}}});
  f.advance(30000);
  assert.ok(f.moves.some(m => m.pos[0]+m.pos[1] > 600));
  assert.ok(f.moves.every(m => Math.abs(m.pos[2]) < 0.01));
  assert.ok(f.controlled.has(1));
  assert.ok(f.attacks.length > 0);
  f.stop();
});
test('A live NPC target displaced across an unlinked wall is revalidated before attack', () => {
  const mesh = geometry([[0,0,0],[90,0,0],[0,90,0],[90,90,0]],
    [[0,1,2],[1,3,2]],[],false);
  const f = fixture({count:2,meshes:new Map([[60,mesh]]),
    npc:{1:{combatTarget:2},2:{pos:[20,20,0],immobile:true}}});
  f.advance(100);
  f.attacks.length = 0;
  f.states.get(2).pos = [80,80,0];
  f.advance(20);
  assert.equal(f.attacks.length,0,'Cached target state cannot authorize a hit across the wall');
  f.stop();
});
test('Immobile NPCs pause while other cast members move, then resume when mobile', () => {
  const f = fixture({count:2,npc:{1:{immobile:true}}});
  f.advance(5000);
  assert.ok(!f.moved.has(1)); assert.ok(f.moved.has(2));
  f.states.get(1).immobile = false;
  // Nobody sees it, so its next step is within 15 seconds (#3181).
  f.advance(16000); assert.ok(f.moved.has(1)); f.stop();
});
test('A moving NPC becoming immobile publishes a reliable stop and resumes safely when mobile', () => {
  const f = fixture({count:1});
  f.advance(1000);
  assert.ok(f.moved.has(1));
  const position = f.states.get(1).pos.slice(),count = f.moves.length;
  f.states.get(1).immobile = true;
  // Nobody sees it, so its next step, the one that stops it, is within 15 seconds (#3181).
  f.advance(16000);
  assert.ok(f.controlled.has(1));
  assert.deepEqual(f.states.get(1).pos,position,'An immobile actor cannot translate');
  assert.equal(f.moves.length,count,'An immobile actor cannot submit walking updates');
  const last = f.snapshots.filter(snapshot => snapshot.id === 1).at(-1);
  assert.equal(last.speed,0); assert.equal(last.runMode,'Standing'); assert.equal(last.reliable,true);
  assert.deepEqual(last.pos,position);
  f.states.get(1).immobile = false;
  f.advance(16000);
  assert.ok(f.moves.slice(count).some(move => move.id === 1 && move.speed > 0));
  assert.ok(f.controlled.has(1)); f.stop();
});
for (const lift of [0,40]) {
  test('Sloped navigation retains actor foot height with lift ' + lift, () => {
    const mesh = geometry([[0,0,0],[600,0,120],[0,600,0],[600,600,120]],
      [[0,1,2],[1,3,2]]);
    const f = fixture({count:1,meshes:new Map([[60,mesh]]),lifts:{1:lift},
      npc:{1:{pos:[10,10,2+lift]}}});
    f.advance(15000); assert.ok(f.moved.has(1)); assert.ok(f.controlled.has(1));
    assert.ok(f.moves.every(m => Math.abs(m.pos[2]-m.pos[0]*0.2-lift) < 0.01));
    f.stop();
  });
}

function externalPair(reciprocal) {
  const a = geometry([[0,0,0],[600,0,0],[0,600,0]],[[0,1,2]],[2],false);
  const b = geometry([[600,0,0],[600,600,0],[0,600,0]],[[0,1,2]],[4],false);
  function append(mesh, edge, local) {
    const links = Buffer.alloc(14);
    links.writeUInt32LE(1,0); // one external connection, type 0
    links.writeUInt32LE(0,4);
    links.writeUInt32LE(local,8);
    links.writeInt16LE(0,12);
    mesh.data = Buffer.concat([mesh.data,links]);
    mesh.data.writeInt16LE(0,24+mesh.vertices.length*12+6+edge*2);
  }
  append(a,1,0x102); append(b,2,0x101);
  const records = new Map([
    [1000060,{cell:60,mesh:a,mapping:new Map([[0x102,1000061]])}],
    [1000061,{cell:60,mesh:b,mapping:new Map([[0x101,reciprocal ? 1000060 : 1000999]])}]
  ]);
  return {a,b,records};
}
for (const reciprocal of [true,false]) {
  test('External mapped NAVM links ' + (reciprocal ? 'allow reciprocal traversal' : 'reject a missing return link'), () => {
    const {a,b,records} = externalPair(reciprocal);
    const f = fixture({count:1,humans:[100],records,meshes:new Map([[60,[a,b]]]),
      npc:{1:{combatTarget:100}},human:{100:{pos:[500,500,0]}}});
    f.advance(30000);
    assert.ok(f.mappingCalls.some(call => call.id === 1000060 && call.local === 0x102));
    assert.ok(f.mappingCalls.some(call => call.id === 1000061 && call.local === 0x101));
    assert.equal(f.attacks.length > 0,reciprocal);
    if (reciprocal) assert.ok(f.moves.some(m => m.pos[0]+m.pos[1] > 600));
    else assert.ok(f.moves.every(m => inside(a.triangles[0].map(i => a.vertices[i]),m.pos)),
      'A one-way external connection cannot cross the boundary');
    assert.ok(f.controlled.has(1)); f.stop();
  });
}

// #2032: rereading every triangle's links at each finished mesh made one
// background route search cost 20 to 47 ms while the cast was prepared.
test('A triangle\'s links are read again only when a mesh they lead to arrives', () => {
  const {records} = externalPair(true);
  records.set(1000062,{cell:60,mesh:isolated(),mapping:new Map()});
  const context = {Buffer,Math,Date,Number,Map,Set,JSON};
  vm.createContext(context);
  vm.runInContext(source.slice(begin,end),context);
  let ids = [1000060];
  const nav = context.createNpcNavigation({
    getNavmeshRecords: () => ids.slice(),
    lookupEspmRecordById(id) {
      const record = records.get(id);
      return {record:{fields:[{type:'NVNM',data:record.mesh.data}]},toGlobalRecordId:local => record.mapping.get(local) || 0};
    }},() => 0,() => {},() => {});
  const load = (list,pos) => { ids = list; nav.ensureBank(60,pos); while(nav.pending()) nav.work(); };
  load([1000060],[100,100,0]);
  const node = context.npcTriangleAt(nav.meshes.get(1000060),0);
  assert.equal(nav.nodeLinks(node).length,0,'The mesh across its external edge has not arrived');
  load([1000061],[5000,5000,0]);
  const links = nav.nodeLinks(node);
  assert.equal(links.length,1,'Once it arrives the link is read');
  assert.equal(links[0].node.mesh,1000061);
  load([1000062],[9000,9000,0]);
  assert.ok(nav.nodeLinks(node) === links,'A mesh the triangle does not lead to leaves its links unread');
});
function largeMesh(corrupt) {
  const mesh = geometry([[0,0,0],[300,0,0],[0,300,0]],
    Array.from({length:2200},() => [0,1,2]),[],false);
  if (corrupt) {
    const lastTriangle = 24+mesh.vertices.length*12+(mesh.triangles.length-1)*16;
    mesh.data.writeUInt16LE(65535,lastTriangle);
  }
  return mesh;
}
test('Large mesh preparation yields to marker and heartbeat callbacks before movement', () => {
  const f = fixture({count:1,meshes:new Map([[60,largeMesh(false)]])});
  let marker = false, heartbeats = 0;
  f.timers.setTimeout(() => {
    marker = true;
    assert.equal(f.moves.length,0,'Geometry must finish before any movement');
  },20);
  function heartbeat() {
    if (!f.moved.has(1)) {
      heartbeats++; f.timers.setTimeout(heartbeat,5);
    }
  }
  f.timers.setTimeout(heartbeat,5);
  f.advance(1000);
  assert.ok(marker); assert.ok(heartbeats >= 3,'Parsing must yield beyond a single callback');
  assert.ok(f.controlled.has(1)); assert.ok(f.moved.has(1)); f.stop();
});
test('A late corrupt triangle preserves stationary ownership without movement on partial geometry', () => {
  const f = fixture({count:1,meshes:new Map([[60,largeMesh(true)]])});
  f.advance(1000);
  assert.equal(f.controlled.size,1);
  assert.ok(!f.controlEvents.some(event => !event.on),'A parse failure cannot relinquish server ownership');
  assert.equal(f.moves.length,0);
  assert.ok(f.logs.some(line => /rejected|unavailable/.test(line)));
  f.stop();
});
test('An actor displaced outside navigation while its mesh is preparing remains stationary and server owned', () => {
  const f = fixture({count:1,meshes:new Map([[60,largeMesh(false)]])});
  f.timers.setTimeout(() => { f.states.get(1).pos = [1000,1000,0]; },20);
  f.advance(1000);
  assert.ok(f.controlled.has(1));
  assert.equal(f.moves.length,0); f.stop();
});
test('An actor changing cells while waiting prepares its new cell before moving', () => {
  const f = fixture({count:1,meshes:new Map([[60,largeMesh(false)],[61,isolated()]])});
  f.timers.setTimeout(() => {
    f.states.get(1).cellOrWorld = 61;
    f.states.get(1).pos = [20,20,0];
  },20);
  f.advance(5000);
  assert.ok(f.controlled.has(1)); assert.ok(f.moved.has(1));
  assert.equal(f.states.get(1).cellOrWorld,61); f.stop();
});


const homePolicy = (home,cell,leash) => () => ({home:home.slice(),cell,leash});
function checkLeash(moves,home,leash) {
  assert.ok(moves.length > 0,'A home leash must still permit local activity');
  assert.ok(moves.every(move => Math.hypot(...move.pos.map((v,i) => v-home[i])) <= leash+0.01),
    'Every emitted movement endpoint remains within its authored home leash');
}
test('Population exclusion prevents preparation and movement for excluded identities', () => {
  const f = fixture({ids:[1,2,3],population:(id,state) => id === 2 ? null :
    {home:state.pos.slice(),cell:state.cellOrWorld,leash:80}});
  f.advance(15000);
  assert.ok(f.controlled.has(1) && f.controlled.has(3));
  assert.ok(!f.controlEvents.some(event => event.id === 2),'Excluded IDs are never prepared');
  assert.ok(!f.moves.some(move => move.id === 2));
  assert.ok(f.policyEvents.some(event => event.kind === 'configure' && event.id === 2));
  f.stop();
});
test('Population return interval is configured before native ownership', () => {
  const f = fixture({count:1,population:(id,state,api) => {
    api.set(id,'spawnDelay',1800);
    return {home:state.pos.slice(),cell:state.cellOrWorld,leash:80};
  }});
  f.advance(1000);
  const events = f.policyEvents.filter(event => event.id === 1);
  assert.ok(events.findIndex(event => event.kind === 'configure') >= 0);
  assert.ok(events.findIndex(event => event.kind === 'configure') <
    events.findIndex(event => event.kind === 'control' && event.on));
  assert.equal(events.find(event => event.kind === 'control' && event.on).spawnDelay,1800,
    'The configured interval is already present when native ownership begins');
  assert.equal(f.api.get(1,'spawnDelay'),1800);
  f.stop();
});
test('Fresh loaded identities enroll after pagination without duplicate preparation', () => {
  const f = fixture({count:1,population:homePolicy([100,100,0],60,80),
    npc:{1:{pos:[100,100,0]}}});
  f.advance(30000);
  f.addNpc(9001,{pos:[100,100,0]});
  f.advance(30000);
  assert.ok(f.loadedLookups() > 1,'Periodic discovery uses the fresh native enumeration');
  assert.ok(f.controlled.has(9001) && f.moved.has(9001));
  for (const id of [1,9001]) {
    assert.equal(f.controlEvents.filter(event => event.id === id && event.on).length,1,
      'Previously enrolled IDs retain one native ownership preparation');
  }
  f.stop();
});
test('Ambient routine remains active inside a narrow authored home leash', () => {
  const home = [300,300,0], leash = 25;
  const f = fixture({count:1,npc:{1:{pos:home.slice()}},population:homePolicy(home,60,leash)});
  f.advance(30000); checkLeash(f.moves,home,leash);
  assert.ok(f.moved.has(1)); f.stop();
});
test('Retaliation cannot chase outside the authored home leash', () => {
  const home = [100,100,0], leash = 40;
  const f = fixture({count:1,npc:{1:{pos:home.slice(),combatTarget:100}},
    humans:[100],human:{100:{pos:[500,500,0]}},population:homePolicy(home,60,leash)});
  f.advance(30000); checkLeash(f.moves,home,leash);
  assert.equal(f.attackAttempts.length,0); f.stop();
});
test('Cowardly retaliation flees without exceeding the authored home leash', () => {
  const home = [300,300,0], leash = 35;
  const f = fixture({count:1,npc:{1:{pos:home.slice(),combatTarget:100,confidence:0}},
    humans:[100],human:{100:{pos:[310,300,0]}},population:homePolicy(home,60,leash)});
  f.advance(15000); checkLeash(f.moves,home,leash);
  assert.equal(f.attackAttempts.length,0); f.stop();
});
test('An actor displaced into another cell cannot run a routine outside its home cell', () => {
  const home = [100,100,0];
  const f = fixture({count:1,npc:{1:{pos:home.slice()}},population:homePolicy(home,60,80),
    meshes:new Map([[60,square()],[61,square()]])});
  f.advance(3000);
  assert.ok(f.moved.has(1));
  const before = f.moves.length;
  f.states.get(1).cellOrWorld = 61;
  f.advance(5000);
  assert.equal(f.moves.length,before,'A cell change cannot silently replace the authored home');
  assert.ok(f.controlled.has(1)); f.stop();
});

test('A within-home displacement onto an adjacent face cannot exhaust ambient movement', () => {
  const home=[310,310,0],leash=50;
  const f=fixture({count:1,npc:{1:{pos:[290,290,0]}},population:homePolicy(home,60,leash)});
  f.advance(30000);f.moves.length=0;
  f.advance(30000);
  assert.ok(f.moves.some(m=>m.speed>0),'Unattended movement continues in the second activity window');
  checkLeash(f.moves,home,leash);f.stop();
});

test('A sloped face keeps an in-home actor moving when vertical home projection exceeds its leash', () => {
  const home=[1200,1200,0],leash=560;
  const mesh=geometry([[0,0,0],[4800,0,2400],[0,4800,0]],[[0,1,2]]);
  const f=fixture({count:1,meshes:new Map([[60,mesh]]),npc:{1:{pos:[960,1200,480]}},
    population:homePolicy(home,60,leash)});
  f.advance(30000);
  assert.ok(f.moves.some(move=>move.speed>0),'An in-home actor must keep moving on slopes');
  checkLeash(f.moves,home,leash);f.stop();
});

test('A forgotten actor is let go of at once, before it is destroyed (#2623)', () => {
  const gone=0xff000040,stays=0xff000041;
  // Somebody is near both, so each is stepped every near pass (#3181).
  const f=fixture({ids:[gone,stays],commanded:[gone,stays],humans:[100],human:{100:{pos:[500,500,0], aggression:0}},
    populationData:{version:1,plugins:['Skyrim.esm'],keep:[],cut:[]}});
  f.advance(3000);
  assert.ok(f.moves.some(move=>move.id===gone),'Both are active before');
  const at=f.time();f.forget(gone);
  f.advance(1500);
  assert.ok(!f.moves.some(move=>move.id===gone && move.at>at),'A forgotten actor is never stepped again');
  assert.ok(f.moves.some(move=>move.id===stays && move.at>at),'The rest carry on');
  f.stop();
});

test('A commanded actor survives five-second discovery under the real population policy', () => {
  const commanded=0xff000040,ordinary=0xff000041;
  const f=fixture({ids:[commanded,ordinary],commanded:[commanded],
    populationData:{version:1,plugins:['Skyrim.esm'],keep:[],cut:[]}});
  // Nobody sees it, so its second step is 15 seconds after its first (#3181).
  f.advance(11000);f.advance(11000);
  assert.ok(f.loadedLookups()>=2,'Exercise repeated native identity discovery');
  assert.ok(f.controlled.has(commanded),'The commanded NPC retains authority');
  assert.ok(!f.controlled.has(ordinary),'Uncommanded actors still need a habitat');
  assert.ok(!f.api.get(commanded,'isDisabled'),'The command stays visible');
  assert.ok(f.moves.some(move=>move.id===commanded && move.at>=5000),
    'The actor remains active after delayed rediscovery');
  f.stop();
});

// #2067: an actor placed off walkable ground is set down on the nearest
// walkable point out of everybody's sight; an ambush steps out when somebody
// comes near; a race that swims and cannot walk keeps to water.
const onSquare = p => p[0] >= -0.01 && p[0] <= 600.01 && p[1] >= -0.01 && p[1] <= 600.01;
test('An actor off walkable ground is set down on the nearest walkable point when nobody is near', () => {
  const f = fixture({count:1,npc:{1:{pos:[800,300,0]}},meshes:new Map([[60,square()]])});
  f.advance(1500);
  assert.equal(f.teleports.length,1,'Set down once');
  const at = f.teleports[0].pos;
  assert.ok(onSquare(at) && Math.hypot(at[0]-600,at[1]-300) < 2 && Math.abs(at[2]) < 0.01,
    'On the walkable point nearest its placement: '+JSON.stringify(at));
  f.advance(15000);
  assert.ok(f.moved.has(1),'It moves like the rest of the cast afterwards');
  assert.equal(f.status().held,0); assert.equal(f.status().unavailable,0); f.stop();
});
test('Nobody is set down while a person is within sight; it happens once they leave', () => {
  const f = fixture({count:1,npc:{1:{pos:[800,300,0]}},humans:[50],human:{50:{pos:[3000,300,0]}},
    meshes:new Map([[60,square()]])});
  f.advance(10000);
  assert.equal(f.teleports.length,0,'Not while somebody is within 4096 units');
  assert.equal(f.status().held,1);
  assert.ok(!f.moves.some(m => m.id === 1),'It waits where the game put it');
  f.disconnect(50); f.advance(2000);
  assert.equal(f.teleports.length,1,'Set down once nobody can see it'); f.stop();
});
test('An unreadable observer list sets nobody down that tick', () => {
  let failing = true;
  const f = fixture({count:1,npc:{1:{pos:[800,300,0]}},meshes:new Map([[60,square()]]),onlineFails:() => failing});
  f.advance(5000);
  assert.equal(f.teleports.length,0,'Not without knowing where everybody is');
  failing = false; f.advance(2000);
  assert.equal(f.teleports.length,1); f.stop();
});
test('Set down further than its leash, an actor takes the walkable point as its home and keeps moving', () => {
  const f = fixture({count:1,npc:{1:{pos:[800,300,0]}},meshes:new Map([[60,square()]]),
    population:homePolicy([800,300,0],60,100)});
  f.advance(20000);
  assert.equal(f.teleports.length,1);
  const home = f.teleports[0].pos;
  assert.ok(f.moves.some(m => m.id === 1 && m.speed > 0),'Not paused outside its leash');
  checkLeash(f.moves,home,100); f.stop();
});
test('An ambush waits in its alcove, then steps out onto the floor when somebody comes near', () => {
  const f = fixture({count:1,npc:{1:{pos:[640,300,0]}},humans:[50],human:{50:{pos:[2000,300,0]}},
    meshes:new Map([[60,square()]]),free:new Set([1]),
    population:() => ({home:[640,300,0],cell:60,leash:2000,ambush:true})});
  f.advance(10000);
  assert.ok(!f.moves.some(m => m.id === 1),'Still while nobody is within 1024 units');
  assert.equal(f.teleports.length,0,'An ambush is never set down unseen');
  assert.equal(f.status().held,1);
  f.states.get(50).pos = [900,300,0];
  f.advance(6000);
  const mine = f.moves.filter(m => m.id === 1);
  assert.ok(mine.length > 0,'It comes out');
  const out = mine.findIndex(m => onSquare(m.pos));
  assert.ok(out >= 0,'It reaches the floor');
  // One straight line from the alcove to the floor point it steps onto.
  const start = [640,300,0], end = mine[out].pos, line = end.map((v,j) => v-start[j]);
  const length = Math.hypot(...line);
  for (let i = 0; i <= out; i++) {
    const p = mine[i].pos.map((v,j) => v-start[j]), along = p.reduce((n,v,j) => n+v*line[j],0)/length;
    const off = Math.hypot(...p.map((v,j) => v-line[j]*along/length));
    assert.ok(off < 0.01 && along >= -0.01 && along <= length+0.01,'Straight out of the alcove toward the floor');
  }
  assert.ok(mine.slice(out).every(m => onSquare(m.pos)),'On the floor from then on');
  assert.equal(f.status().held,0); f.stop();
});
test('An ambush more than a step from any floor stays where the game put it', () => {
  const f = fixture({count:1,npc:{1:{pos:[1000,300,0]}},humans:[50],human:{50:{pos:[900,300,0]}},
    meshes:new Map([[60,square()]]),population:() => ({home:[1000,300,0],cell:60,leash:2000,ambush:true})});
  f.advance(10000);
  assert.ok(!f.moves.some(m => m.id === 1) && f.teleports.length === 0);
  assert.ok(f.logs.some(l => /Ambush placement with no floor within a step/.test(l)));
  assert.equal(f.status().unavailable,1); f.stop();
});
// Water on the left, land on the right, linked along x = 600.
function shore(bedAt600 = 0) {
  return geometry([[0,0,0],[600,0,bedAt600],[0,600,0],[600,600,bedAt600],[1200,0,bedAt600],[1200,600,bedAt600]],
    [[0,1,2],[1,3,2],[1,4,3],[4,5,3]],[512,512,0,0]);
}
const fish = top => () => ({home:[300,300,top],cell:60,leash:5000,swims:true,top});
test('A swimmer keeps to water, at its height over the bed and never above its depth', () => {
  const f = fixture({count:1,npc:{1:{pos:[300,300,200],canSwim:true}},meshes:new Map([[60,shore()]]),
    free:new Set([1]),population:fish(200)});
  for (let i = 0; i < 4; i++) f.advance(15000);
  const mine = f.moves.filter(m => m.id === 1);
  assert.ok(mine.some(m => m.speed > 0),'It swims');
  assert.ok(mine.every(m => m.pos[0] <= 600.01 && m.pos[2] <= 200.0001 && m.pos[2] >= 0),
    'Over the water triangles, between the bed and its depth');
  assert.equal(f.teleports.length,0); f.stop();
});
test('A swimmer over a rising bed stays below the depth it was placed at', () => {
  const bed = x => x/600*150;
  const f = fixture({count:1,npc:{1:{pos:[50,300,190],canSwim:true}},meshes:new Map([[60,shore(150)]]),
    free:new Set([1]),population:fish(190)});
  for (let i = 0; i < 8; i++) f.advance(15000);
  const mine = f.moves.filter(m => m.id === 1);
  assert.ok(mine.some(m => m.speed > 0));
  assert.ok(mine.every(m => m.pos[2] <= 190.0001 && m.pos[2] >= bed(m.pos[0])-0.01 && m.pos[0] <= 600.01),
    'Never above its depth, never under the bed, never over land');
  f.stop();
});
test('A swimmer placed off the water is set down in the water, not on land', () => {
  const f = fixture({count:1,npc:{1:{pos:[300,-150,120],canSwim:true}},meshes:new Map([[60,shore()]]),
    free:new Set([1]),population:() => ({home:[300,-150,120],cell:60,leash:5000,swims:true,top:120})});
  f.advance(1500);
  assert.equal(f.teleports.length,1);
  const at = f.teleports[0].pos;
  assert.ok(at[0] <= 600 && at[1] >= 0 && Math.abs(at[2]-120) < 0.01,'Into the water at its depth: '+JSON.stringify(at));
  f.stop();
});
test('A walker that can swim still treats a swimmer-only rule as not its own', () => {
  const f = fixture({count:1,npc:{1:{pos:[900,300,0],canSwim:false}},meshes:new Map([[60,shore()]])});
  f.advance(30000);
  assert.ok(f.moves.filter(m => m.id === 1).every(m => m.pos[0] >= 599.99),'A walker that cannot swim stays on land');
  f.stop();
});

// #2072: two ways an NPC used to stop for good mid walk, measured in the
// population harness (47954 and 45b7e).
test('A wall face in the navmesh is never a step: an NPC beside one keeps walking', () => {
  // The floor shares its x = 0 edge with a triangle standing upright on it,
  // all three corners at x = 0, so it has no ground seen from above.
  const wall = geometry([[0,0,0],[300,0,0],[0,300,0],[0,150,200]], [[0,1,2],[0,2,3]]);
  const f = fixture({count:1,npc:{1:{pos:[60,60,0]}},meshes:new Map([[60,wall]])});
  for (let i = 0; i < 4; i++) f.advance(15000);
  assert.ok(!f.logs.some(l => /activity unavailable/.test(l)),'Never stopped: '+f.logs.filter(l => /unavailable/.test(l)).join(' | '));
  assert.ok(f.moves.filter(m => m.id === 1 && m.speed > 0).length > 3,'It keeps walking on the floor');
  f.stop();
});
test('A raised NPC near the edge of its leash only steps where it would stand inside the leash', () => {
  // Small triangles; the NPC stands 60 above the floor. Its only neighbour's
  // center is 75 across from home, inside an 80 leash on the floor and 96
  // away where the NPC would stand.
  const grid = geometry([[0,0,0],[100,0,0],[0,100,0],[100,100,0],[200,0,0],[200,100,0]],
    [[1,3,2],[1,4,3],[4,5,3]]);
  const home = [200/3,200/3,0];
  const f = fixture({count:1,npc:{1:{pos:[200/3,200/3,60]}},lifts:{1:60},meshes:new Map([[60,grid]]),
    population:homePolicy(home,60,80)});
  for (let i = 0; i < 4; i++) f.advance(15000);
  assert.ok(!f.logs.some(l => /activity unavailable/.test(l)),'Never stopped: '+f.logs.filter(l => /unavailable/.test(l)).join(' | '));
  checkLeash(f.moves,home,80); f.stop();
});

// #3180: each write of the activity record saves the actor's whole record
// durably on the server. Every NPC used to be written every 30 seconds as it
// wandered, about 5,000 files every 32 seconds on each server with nobody on.
test('An NPC that only wanders is written once, when it is taken on, not as it walks', () => {
  const f = fixture({ids:[11,42,103]});
  for (let i = 0; i < 10; i++) f.advance(30000);
  for (const id of f.ids) {
    const own = f.writes.filter(w => w.id === id && w.prop === 'thornswoodNpcActivity');
    assert.ok(f.moves.some(m => m.id === id && m.speed > 0), 'It walks for the five minutes');
    assert.equal(own.length, 1, id + ' is written once in five minutes, not every 30 seconds: ' + own.length);
    assert.equal(own[0].value.mode, 'ambient');
  }
  f.stop();
});
test('A fight starting is written, with its mode, and the walk around it is not', () => {
  const f = fixture({count:1,humans:[100],npc:{1:{combatTarget:100}},
    human:{100:{pos:[500,500,0]}}});
  for (let i = 0; i < 4; i++) f.advance(30000);
  assert.ok(f.attacks.length > 0, 'It fights');
  const own = f.writes.filter(w => w.id === 1 && w.prop === 'thornswoodNpcActivity');
  assert.ok(own.some(w => w.value.mode === 'combat'), 'The fight starting is written');
  for (let i = 1; i < own.length; i++) assert.notEqual(own[i].value.mode, own[i-1].value.mode, 'Each write is a change of mode');
  f.stop();
});

// #3181, Patrick's C on his report page (22 Oct 2026): NPCs nobody can see
// are updated less often, never paused. On 21 Oct, with nobody on dev, the
// JavaScript thread was busy 0.187 of a core, nearly all of it this runtime
// stepping NPCs nobody was near, each on every pass over the cast.
function gaps(moves, id) {
  const at = moves.filter(m => m.id === id).map(m => m.at), out = [];
  for (let i = 1; i < at.length; i++) out.push(at[i] - at[i-1]);
  return out;
}
test('An NPC nobody can see that only wanders is stepped once every 15 seconds, and keeps walking', () => {
  const f = fixture({count:40});
  for (let i = 0; i < 6; i++) f.advance(10000);
  const from = f.moves.length;
  for (let i = 0; i < 12; i++) f.advance(10000);
  const later = f.moves.slice(from);
  for (const id of f.ids) {
    const g = gaps(later, id);
    assert.ok(g.length >= 6, id + ' is still stepped: ' + g.length + ' steps in two minutes');
    assert.ok(Math.min(...g) >= 15000, id + ' is stepped at most once every 15 seconds: ' + Math.min(...g) + ' ms');
    assert.ok(later.some(m => m.id === id && m.speed > 0), id + ' still walks');
  }
  assert.ok(f.logs.some(l => /background steps/.test(l)), 'The minute report counts the background steps');
  f.stop();
});
test('An NPC somebody can see is stepped as often as before', () => {
  const f = fixture({count:1, humans:[100], human:{100:{pos:[500,500,0], aggression:0}}});
  f.advance(30000);
  const g = gaps(f.moves.slice(5), 1);
  assert.ok(g.length > 50 && Math.max(...g) <= 1000, 'Stepped on every near pass: ' + g.length + ' steps, longest gap ' + Math.max(...g));
  f.stop();
});
test('A pass looks only at the NPCs that are due, not the whole cast', () => {
  const f = fixture({count:400});
  for (let i = 0; i < 12; i++) f.advance(10000);
  const before = f.reads.get('backgroundTick') || 0, from = f.moves.length;
  for (let i = 0; i < 6; i++) f.advance(10000);
  const looked = (f.reads.get('backgroundTick') || 0) - before;
  const stepped = f.moves.slice(from).length;
  assert.ok(stepped >= 400 * 3, 'Each of the 400 is still stepped about every 15 s: ' + stepped + ' steps in a minute');
  // A minute is 3,000 passes. Walking the cast read the clock at least once for
  // every NPC looked at, up to 256 a pass: about 1.5 million reads a minute.
  assert.ok(looked < 3000 * 2 + stepped * 8, 'The clock is read about twice a pass and a few times a step: ' + looked + ' reads for ' + stepped + ' steps');
  f.stop();
});
test('A forgotten NPC loses its turn, and the rest keep theirs', () => {
  const f = fixture({count:40});
  for (let i = 0; i < 6; i++) f.advance(10000);
  f.forget(7);
  const from = f.moves.length;
  for (let i = 0; i < 12; i++) f.advance(10000);
  const later = f.moves.slice(from);
  assert.ok(!later.some(m => m.id === 7), '7 is never stepped again');
  for (const id of f.ids.filter(id => id !== 7)) {
    const g = gaps(later, id);
    assert.ok(g.length >= 6 && Math.min(...g) >= 15000 && Math.max(...g) <= 15100, id + ' keeps its turn: ' + JSON.stringify([g.length, Math.min(...g), Math.max(...g)]));
  }
  f.stop();
});
test('An NPC is stepped in the background again within a second or two of being left alone', () => {
  const f = fixture({count:1, humans:[100], human:{100:{pos:[500,500,0], aggression:0}}});
  f.advance(30000);
  f.disconnect(100);
  const left = f.time(), from = f.moves.length;
  f.advance(10000);
  const next = f.moves.slice(from).find(m => m.id === 1);
  assert.ok(next && next.at - left <= 2100, 'Its first background step comes ' + (next ? next.at - left : 'never') + ' ms after');
  f.stop();
});
test('The mesh, search, prepare and near tasks sleep while they have nothing to do', () => {
  // #3181: on dev with nobody on, meshTick still woke every 2 ms with no mesh
  // work, and searchTick, prepareTick and nearTick every 10 or 100 ms.
  const idle = ['meshTick', 'searchTick', 'prepareTick', 'nearTick'];
  // A population, so the runtime looks for NPCs found later (discover).
  const f = fixture({count:3, humans:[100], human:{100:{pos:[500,500,0]}},
    population:(id, state) => ({home:state.pos.slice(), cell:state.cellOrWorld, leash:400}),
    meshes:new Map([[60, square()], [61, square()]])});
  f.advance(30000);
  assert.equal(f.status().active, 3, 'The cast is ready');
  const runs = () => Object.fromEntries(idle.map(name => [name, f.reads.get(name) || 0]));
  let before = runs();
  f.advance(60000);
  assert.ok(runs().nearTick > before.nearTick, 'Somebody is near, so nearTick runs');
  for (const name of ['meshTick', 'searchTick', 'prepareTick'])
    assert.equal(runs()[name], before[name], name + ' sleeps with nothing to do');
  f.disconnect(100);
  f.advance(2000);
  before = runs();
  f.advance(60000);
  assert.deepEqual(runs(), before, 'With nobody on and the cast ready, none of them runs');
  // An NPC found later, in a cell whose mesh is not loaded yet, wakes the
  // tasks that load the mesh and prepare it, and then walks.
  f.addNpc(9001, {cellOrWorld:61, pos:[100,100,0]});
  const from = f.moves.length;
  f.advance(30000);
  assert.ok(runs().meshTick > before.meshTick && runs().prepareTick > before.prepareTick,
    'The new NPC woke the mesh and prepare tasks: ' + JSON.stringify(runs()));
  assert.ok(f.moves.slice(from).some(m => m.id === 9001 && m.speed > 0), 'The new NPC walks');
  before = runs();
  f.advance(60000);
  for (const name of ['meshTick', 'searchTick', 'prepareTick'])
    assert.equal(runs()[name], before[name], name + ' sleeps again once its work is done');
  f.stop();
});
test('A fight nobody can see keeps its pace: the less frequent steps are for wandering only', () => {
  const f = fixture({count:2, npc:{1:{aggression:3, pos:[100,100,0]}, 2:{aggression:0, pos:[150,150,0]}}});
  for (let i = 0; i < 6; i++) f.advance(10000);
  const hits = f.attacks.filter(a => a.id === 1);
  assert.ok(hits.length > 15, 'Unseen, 1 still attacks 2 at its usual pace: ' + hits.length + ' attacks in a minute');
  f.stop();
});

console.log(JSON.stringify({passed,failed}));
process.exitCode = failed ? 1 : 0;
