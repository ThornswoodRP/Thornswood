'use strict';
/*
  #3296: after a gamemode reload the NPCs carry on instead of starting over.

  A reload keeps the engine, its actors and where they stand. Until 22 Oct
  2026 the NPC SERVER STARTUP block stopped the old runtime and the new one
  took every NPC back from nothing: a batch every 10 ms, each NPC prepared
  again and its navigation read again, 3 min 50 s on dev in which they stood
  still. Now the old runtime and population hand over what they know and the
  new ones go on from it, when both loads have the same NPC code and catalogue.

  This holds four things:
  - a carried runtime does none of the load again (no batch, no ownership, no
    policy, no navigation read) and every NPC is active at once and moving;
  - a reload in the middle of loading goes on from where the batches were;
  - what is carried holds no function or triangle of the old load, so none of
    the old load stays in memory;
  - the startup carries only when both loads' NPC code and catalogue match,
    and otherwise takes the full load and says why.
*/
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const REPO_DIR = path.join(__dirname, '..', '..');
const GAMEMODE = path.join(REPO_DIR, 'game/gamemode.js');
const source = fs.readFileSync(GAMEMODE, 'utf8');
const block = name => {
  const begin = source.indexOf('// ' + name + ' BEGIN'), end = source.indexOf('// ' + name + ' END', begin);
  assert.ok(begin >= 0 && end > begin, 'the production ' + name + ' block is present');
  return source.slice(begin, end);
};
const POLICY = block('NPC POPULATION POLICY'), RUNTIME = block('NPC SERVER RUNTIME');
const plain = value => JSON.parse(JSON.stringify(value));

// One load of the gamemode: its own context, so its functions are its own.
function load() {
  const ctx = {Buffer, Math, Date, Number, Map, Set, JSON};
  vm.createContext(ctx);
  vm.runInContext(POLICY, ctx);
  vm.runInContext(RUNTIME, ctx);
  return ctx;
}

// A 600 by 600 floor of two triangles in cell 60.
function square() {
  const vertices = [[0,0,0],[600,0,0],[0,600,0],[600,600,0]], triangles = [[0,1,2],[1,3,2]];
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
      b.writeInt16LE(triangles.findIndex((o, k) => k !== i && edge.every(v => o.includes(v))), at + 6 + j * 2);
    }
  });
  return b;
}

// The engine, which a reload keeps: actors, their properties, ownership.
function engine(count, options = {}) {
  let time = 0, serial = 0;
  const pending = new Map(), calls = new Map(), moves = [], states = new Map(), props = new Map();
  const controlled = new Set(), online = [], mesh = square();
  const ids = Array.from({length:count}, (_, i) => i + 1);
  // Off walkable ground: an ambush a step above the floor, anything else further.
  const height = id => !(options.off && options.off.includes(id)) ? 0 : options.ambush && options.ambush.includes(id) ? 200 : 300;
  const home = id => [100 + (id % 8) * 50, 100 + Math.floor(id / 8) * 50, height(id)];
  for (const id of ids) states.set(id, {pos:home(id), rot:[0,0,0], cellOrWorld:60, isDead:false, isDisabled:false,
    aggression:0, confidence:3, factions:[], combatTarget:0, canSwim:false, canFly:false, immobile:false,
    meleeReach:128, meleeAllowance:32, isHuman:false});
  const data = {version:1, plugins:['Skyrim.esm'], keep:ids.map(id => [id.toString(16) + ':Skyrim.esm', 'a:Skyrim.esm',
    '3c:Skyrim.esm', home(id), 2048, 45, 'animal', 'farm', null, 1000, 'farm', options.ambush && options.ambush.includes(id) ? 2 : 0])};
  const native = {
    makeProperty() {},
    getIdFromDesc: desc => parseInt(desc.split(':')[0], 16),
    getDescFromId: id => id.toString(16) + ':Skyrim.esm',
    loadNpcBatch(cursor, limit) {
      return {nextCursor:Math.min(cursor + limit, ids.length), total:ids.length, actorIds:ids.slice(cursor, cursor + limit)};
    },
    getLoadedNpcIds: () => ids.slice(),
    getNpcAIState(id) { return plain(states.get(id)); },
    getFactionReactions: () => [],
    get(id, key) {
      if (id === 0 && key === 'onlinePlayers') return online.slice();
      return props.has(id + ':' + key) ? plain(props.get(id + ':' + key)) : null;
    },
    set(id, key, value) {
      props.set(id + ':' + key, plain(value));
      if (key === 'locationalData') states.get(id).pos = value.pos.slice();
    },
    setNpcServerControlled(id, on) { if (on) controlled.add(id); else controlled.delete(id); },
    setNpcDifficultyTier() {},
    getNavmeshRecords: cell => cell === 60 ? [1000060] : [],
    lookupEspmRecordById: () => ({record:{fields:[{type:'NVNM', data:mesh}]}}),
    updateNpcMovement(id, pos, rot, speed) {
      assert.ok(controlled.has(id), 'movement needs server authority');
      if (Math.hypot(...pos.map((v, i) => v - states.get(id).pos[i])) > 0.001) moves.push({id, at:time});
      states.get(id).pos = pos.slice();
    },
    stopNpcMovement() {},
    serverNpcAttack: () => false
  };
  const api = new Proxy(native, {get(target, key) {
    if (typeof target[key] === 'function') calls.set(key, (calls.get(key) || 0) + 1);
    return target[key];
  }});
  const timers = {
    setTimeout(fn, delay) { pending.set(++serial, {fn, at:time + delay}); return serial; },
    clearTimeout(handle) { pending.delete(handle); }
  };
  function advance(ms) {
    const until = time + ms;
    for (let runs = 0; pending.size; runs++) {
      const [handle, task] = [...pending].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (task.at > until) break;
      time = task.at; pending.delete(handle); task.fn();
      assert.ok(runs < 200000, 'the runtime yields');
    }
    time = until;
  }
  return {api, data, ids, timers, pending, calls, moves, states, props, controlled, online, advance,
    now: () => time, count: name => calls.get(name) || 0, reset: () => calls.clear()};
}

// One load's population and runtime, started the way the startup starts them.
function start(world, ctx, carry = {}) {
  const logs = [], purses = [];
  const merchants = {prepare(id) { purses.push(id); return null; }, stats: () => null};
  const population = ctx.createNpcPopulation(world.api, world.data, ['Skyrim.esm'], merchants,
    {suspended:true, run:'run', key:'K', carry:carry.population || null});
  const runtime = ctx.startSharedNpcServerRuntime(world.api, world.timers, world.now, line => logs.push(line), population,
    {suspended:true, key:'K', carry:carry.runtime || null});
  population.commit();
  assert.equal(runtime.start(), true);
  return {population, runtime, logs, purses};
}
function handover(old) {
  return {runtime:old.runtime.handover(), population:old.population.handover()};
}

// Everything reachable from root whose prototype chain is one of ctx's
// functions, generators or triangle objects: what would keep that load alive.
function heldFrom(root, ctx) {
  const old = new Set(vm.runInContext('[Function.prototype,Object.getPrototypeOf(function*(){}).prototype,npcTriangle,npcPortal]', ctx));
  const seen = new Set(), stack = [root], found = [];
  while (stack.length) {
    const value = stack.pop();
    if (value === null || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) continue;
    seen.add(value);
    for (let p = Object.getPrototypeOf(value); p; p = Object.getPrototypeOf(p)) if (old.has(p)) { found.push(value); break; }
    if (ArrayBuffer.isView(value)) continue;
    if (value instanceof Map) { for (const [k, v] of value) stack.push(k, v); continue; }
    if (value instanceof Set) { for (const v of value) stack.push(v); continue; }
    for (const name of Object.getOwnPropertyNames(value)) {
      const d = Object.getOwnPropertyDescriptor(value, name);
      if ('value' in d) stack.push(d.value);
    }
  }
  return found;
}

{
  // A loaded cast, carried to the next load.
  const world = engine(40), first = load();
  const a = start(world, first);
  world.advance(60000);
  const before = a.runtime.getStatus();
  assert.equal(before.loadingComplete, true, 'the first load finished loading');
  assert.equal(before.active, 40, 'every NPC is active before the reload');
  const carried = handover(a);
  assert.equal(world.pending.size, 0, 'the old runtime stops every timer when it hands over');
  assert.ok(heldFrom(carried, first).length > 0, 'the old carry holds the old load\'s triangles (so the check below means something)');
  assert.equal(a.runtime.handover(), null, 'a stopped runtime hands nothing over');
  assert.equal(a.population.handover(), null, 'a stopped population hands nothing over');

  // The full load, for comparison: a runtime that starts from nothing.
  const fresh = engine(40), freshLoad = start(fresh, load());
  fresh.advance(100);
  assert.ok(freshLoad.runtime.getStatus().active < 40, 'a full load takes the cast back a batch at a time');
  freshLoad.runtime.stop();

  world.reset();
  const second = load(), b = start(world, second, carried);
  assert.equal(b.runtime.getStatus().active, 40, 'every NPC is active the moment the new load starts');
  assert.equal(b.runtime.getStatus().loadingComplete, true);
  assert.ok(b.logs.some(line => /^Shared NPC runtime carried on from the previous gamemode load: 40 active, 40 loaded, .*loading complete$/.test(line)),
    'the reload says it carried on: ' + b.logs.join(' | '));
  const at = world.now(), moved = new Set();
  world.advance(16000);
  for (const m of world.moves) if (m.at > at) moved.add(m.id);
  assert.equal(moved.size, 40, 'every NPC moves again within one unseen turn of the reload');
  for (const name of ['loadNpcBatch', 'setNpcServerControlled', 'setNpcDifficultyTier', 'getNavmeshRecords', 'lookupEspmRecordById'])
    assert.equal(world.count(name), 0, name + ' is not done again after a reload');
  assert.equal(world.count('set'), 0, 'no policy, home or activity is written again');
  assert.deepEqual(b.purses.slice().sort((x, y) => x - y), world.ids, 'each carried NPC has its purse read by the new purse service');
  // The policy the runtime moves NPCs by is the population's own object.
  assert.equal(b.population.configure(7, world.states.get(7)), carried.runtime.policies.get(7),
    'the new population answers with the carried policy, deciding nothing again');
  assert.equal(b.population.spawned().length, 0);

  // What the new load keeps holds nothing of the old one.
  const next = handover(b);
  assert.deepEqual(heldFrom(next, first), [], 'nothing the new load keeps holds a function or triangle of the old load');
  // And it carries again, to a third load.
  world.reset();
  const c = start(world, load(), next);
  assert.equal(c.runtime.getStatus().active, 40, 'a second reload carries on too');
  world.advance(16000);
  assert.equal(world.count('loadNpcBatch'), 0);
  c.runtime.stop();
}
console.log('PASS a reload carries every NPC on: nothing loaded, owned or read again, and nothing of the old load kept');

{
  // A reload while the cast is still loading goes on from the old cursor.
  const world = engine(40), a = start(world, load());
  world.advance(105);
  const partway = a.runtime.getStatus();
  assert.ok(partway.loaded > 0 && partway.loaded < 40, 'the reload comes in the middle of loading: ' + partway.loaded);
  const carried = handover(a), owned = new Set(world.controlled);
  world.reset();
  const b = start(world, load(), carried);
  world.advance(60000);
  assert.equal(b.runtime.getStatus().active, 40, 'every NPC is active once loading finishes');
  assert.equal(b.runtime.getStatus().loaded, 40, 'none is counted twice');
  assert.equal(world.count('loadNpcBatch'), 40 - partway.loaded, 'only the batches the old load had not reached are read');
  assert.equal(world.count('setNpcServerControlled'), 40 - owned.size, 'only the NPCs the old load had not owned are owned');
  b.runtime.stop();
}
console.log('PASS a reload in the middle of loading goes on from where the batches were');

{
  // Off walkable ground: an ambush held until somebody comes near, and a
  // placement whose search for the floor is under way when the reload comes.
  const ambush = [5], off = [5, 9];
  let carried = null, world = null, first = null;
  for (let t = 0; t < 400 && !carried; t++) {
    world = engine(12, {ambush, off});
    first = load();
    const a = start(world, first);
    world.advance(t);
    const handed = handover(a);
    if (handed.runtime.searching.length && handed.runtime.held.size) carried = handed;
  }
  assert.ok(carried, 'a reload comes while one search is under way and an ambush is held');
  const searchingIds = carried.runtime.searching.map(job => job.id);
  assert.ok(carried.runtime.searching.every(job => !('search' in job)), 'a search is handed over as what it looks for');
  const b = start(world, load(), carried);
  world.advance(5000);
  assert.ok(b.runtime.getStatus().active >= 12 - ambush.length, 'the searched placement is set down and joins the cast');
  for (const id of searchingIds) if (!ambush.includes(id)) assert.ok(b.runtime.getActorStatus(id), 'NPC ' + id + ' finished its search after the reload');
  // Somebody comes near the ambush: it steps out onto the floor.
  world.states.set(99, Object.assign(plain(world.states.get(1)), {pos:world.states.get(5).pos.slice(0, 2).concat([0])}));
  world.online.push(99);
  world.advance(5000);
  assert.ok(b.runtime.getActorStatus(5), 'the held ambush steps out after the reload');
  assert.equal(b.runtime.getStatus().unavailable, 0, 'nothing carried was rejected');
  assert.deepEqual(heldFrom(handover(b), first), [], 'held and searching NPCs keep nothing of the old load');
}
console.log('PASS held and searching NPCs carry on, and their searches start again in the new load');

// The startup: it hands over, and carries only when both loads match.
{
  const STARTUP_BEGIN = source.lastIndexOf('// NPC SERVER STARTUP BEGIN');
  const STARTUP = source.slice(STARTUP_BEGIN, source.indexOf('// NPC SERVER STARTUP END', STARTUP_BEGIN));
  const manifest = source.slice(source.indexOf('function npcMerchantManifest('), source.indexOf('function createNpcMerchantPurses('));
  const made = [], logs = [];
  let legacy = false;
  const ctx = {
    require, setTimeout, clearTimeout, Date, serverRunId: () => 'run', removeSpawned() {}, mintedEntry: () => false,
    __filename: GAMEMODE, log: line => logs.push(line),
    mp: {getServerSettings: () => ({thornswoodServer:'dev', loadOrder:['Skyrim.esm']}), prepareNpcLoad() {}},
    NPC_POPULATION_DATA: {plugins:['Skyrim.esm'], keep:[['1:Skyrim.esm','a:Skyrim.esm',0,0,0,0,'trader']]},
    createPrivateMerchantLedger: () => ({}),
    createNpcMerchantPurses: () => ({shutdown() {}}),
    createNpcPopulation: (api, data, plugins, purses, options) => {
      const made1 = {kind:'population', options, stopped:0, handed:0};
      made.push(made1);
      return Object.assign({commit() {}, stop() { made1.stopped++; }},
        legacy ? {} : {handover() { made1.handed++; return {key:options.key, mark:'population'}; }});
    },
    startSharedNpcServerRuntime: (api, timers, now, report, population, options) => {
      const made1 = {kind:'runtime', options, stopped:0, handed:0};
      made.push(made1);
      return Object.assign({start: () => true, stop() { made1.stopped++; }},
        legacy ? {} : {handover() { made1.handed++; return {key:options.key, mark:'runtime'}; }});
    },
    MERCHANT_TRADING: {prepareRoles: population => ({population, catalog:{byRef:{}}, roleTables:{}}),
      installMerchantTrading: () => ({nativeReady: () => true, start() {}, shutdown() {}})}
  };
  vm.createContext(ctx);
  vm.runInContext(manifest, ctx);
  const run = () => { made.length = 0; logs.length = 0; vm.runInContext(STARTUP, ctx); return made.slice(); };
  const runtimeOf = list => list.find(m => m.kind === 'runtime'), populationOf = list => list.find(m => m.kind === 'population');

  let one = run();
  const key = runtimeOf(one).options.key;
  assert.match(key, /^[0-9a-f]{64}$/, 'the startup names its NPC code and catalogue');
  assert.equal(populationOf(one).options.key, key);
  assert.equal(runtimeOf(one).options.carry, null, 'the first load in a process has nothing to carry');
  assert.deepEqual(logs, [], 'a first load says nothing about a handover');

  const previous = one;
  const two = run();
  assert.equal(runtimeOf(previous).handed, 1, 'a reload asks the old runtime to hand over');
  assert.equal(runtimeOf(previous).stopped, 0, 'and does not also stop it');
  assert.equal(populationOf(previous).handed, 1, 'and the old population');
  assert.deepEqual(plain(runtimeOf(two).options.carry), {key, mark:'runtime'}, 'the same code and catalogue carry the runtime on');
  assert.deepEqual(plain(populationOf(two).options.carry), {key, mark:'population'}, 'and the population');
  assert.deepEqual(logs, []);

  // Another catalogue: the full load.
  ctx.NPC_POPULATION_DATA = {plugins:['Skyrim.esm'], keep:[['2:Skyrim.esm','a:Skyrim.esm',0,0,0,0,'trader']]};
  const three = run();
  assert.equal(runtimeOf(two).handed, 1);
  assert.equal(runtimeOf(three).options.carry, null, 'another catalogue starts over');
  assert.equal(populationOf(three).options.carry, null);
  assert.notEqual(runtimeOf(three).options.key, key, 'the catalogue is part of the key');
  assert.deepEqual(logs, ['Shared NPC runtime starts over: the previous gamemode load had other NPC code or another catalogue']);

  // Other NPC code: one character of the runtime block changed in the file that is loading.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'npc-handover-'));
  try {
    const changed = path.join(scratch, 'gamemode.js');
    const at = source.indexOf('const UNSEEN_EVERY = 15000');
    assert.ok(at > 0);
    fs.writeFileSync(changed, source.slice(0, at) + source.slice(at).replace('UNSEEN_EVERY = 15000', 'UNSEEN_EVERY = 15001'));
    const keyBefore = runtimeOf(three).options.key;
    ctx.__filename = changed;
    const four = run();
    assert.notEqual(runtimeOf(four).options.key, keyBefore, 'the runtime code is part of the key');
    assert.equal(runtimeOf(four).options.carry, null, 'other NPC code starts over');
    assert.deepEqual(logs, ['Shared NPC runtime starts over: the previous gamemode load had other NPC code or another catalogue']);
    // A file the startup cannot read names nothing: the full load, said once.
    ctx.__filename = path.join(scratch, 'missing.js');
    const five = run();
    assert.equal(runtimeOf(five).options.key, null);
    assert.equal(runtimeOf(five).options.carry, null);
    assert.equal(logs.length, 2);
    assert.match(logs[0], /^NPC handover is unavailable: /);
    assert.equal(logs[1], 'Shared NPC runtime starts over: this load cannot name its NPC code');
  } finally {
    fs.rmSync(scratch, {recursive:true, force:true});
  }
  ctx.__filename = GAMEMODE;

  // A runtime from before handover() existed is stopped, and the load starts over.
  legacy = true;
  const six = run();
  legacy = false;
  const seven = run();
  assert.equal(runtimeOf(six).stopped, 1, 'an old runtime without handover() is stopped');
  assert.equal(populationOf(six).stopped, 1, 'and its population');
  assert.equal(runtimeOf(seven).options.carry, null);
  assert.deepEqual(logs, ['Shared NPC runtime starts over: the previous gamemode load handed nothing over']);
}
console.log('PASS the startup carries the NPCs on only when both loads have the same NPC code and catalogue');
