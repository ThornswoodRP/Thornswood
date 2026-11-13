'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Run with no arguments (the nightly), check the gamemode sections this harness loads and SKIP the native part (#1881).
if(!process.argv[2]||!process.argv[3]){
  const src=require('node:fs').readFileSync(require('node:path').join(__dirname,'../../game/gamemode.js'),'utf8');
  for(const m of ["NPC SERVER RUNTIME","NPC POPULATION POLICY","NPC POPULATION DATA"]){
    const b=src.indexOf('// '+m+' BEGIN'),e=src.indexOf('// '+m+' END');
    if(b<0||e<=b){console.error('FAIL: gamemode.js section '+m+' missing');process.exit(1);}
  }
  console.log('SKIP: shared native check needs <built addon .node path> <installed record .json path> (node game/tests/test-npc-shared-native.js <addon> <installed.json>); gamemode sections present: NPC SERVER RUNTIME, NPC POPULATION POLICY, NPC POPULATION DATA');
  process.exit(0);
}
const addon = require(path.resolve(process.argv[2]));
const installed = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
// Acceptance fixture: the installed 102-plugin cast (48 full, 54 light since the
// engine loads light plugins, #1715), never a saved live world.
const originalExpectedLoaded = 11273, completionLimitMs = 300000;
let expectedLoaded = originalExpectedLoaded;
const populationMode = process.argv[5] === '--population';
const enumerationMode = process.argv[5] === '--enumerate-native-eligible';
const populationEnumerationMode = process.argv[5] === '--enumerate-population-native-eligible';
assert.ok(!process.argv[5] || populationMode || enumerationMode || populationEnumerationMode,'Known optional acceptance mode');
// One cold native placed-form load cannot yield midway through construction.
// Keep it separate from steady activity and do not accumulate a loading batch.
const maxCallbackMs = 50, maxColdLoadMs = 100, maxRssBytes = 2 * 1024 ** 3;
// A callback's limit bounds the work it does. Its wall time also counts two
// things that are not its work (#2032, measured on One on 11 Oct):
// - time the operating system gave the CPU to other programs. With the
//   machine at 80% and up to 37 threads waiting for a processor, 44 callbacks
//   in one run took 50 to 200 ms while their thread ran for at most 31 ms,
//   and a loop that only reads the clock lost the CPU for up to 71 ms;
// - a garbage collection that the heap's allocation, not this callback,
//   started inside it. Young collections took 3 to 7 ms on average there and
//   up to 179 ms when their helper threads were not given a processor.
// Its work is at most its wall time less the collections inside it, and at
// most the CPU time its thread used, read to the cycle by thread-clock.js.
// Either bound inside the limit means the work is. The CPU bound leaves out
// any wait in the kernel, a page of a memory-mapped plugin as well as a
// processor; the stalls measured that night came late in runs too, after both
// preparations had read every record, and at the same sizes as the clock loop's.
// Until 12 Oct the CPU bound read Windows' thread times, which move in steps
// of 15.6 ms, plus one step, and four of fifteen runs stopped on a meshTick
// reading 63 to 78 ms. Read to the cycle in eight runs on One on 12 Oct, no
// callback held to 50 ms used more than 35.1 ms of CPU (a meshTick 32.2), and
// with the run alone on the machine no more than 24.4. CPU time is the
// machine's as well as the work's, though: the same cold load used 20.3 ms
// held to a performance core, 32.9 on an efficient core, 45.3 on a low power
// one, and up to 96.4 with four runs side by side (1.5 GiB each). So run it
// with nothing else heavy on the machine.
const threadClock = require('../../tests/thread-clock.js').load();
// Collections arrive as performance entries once the event loop turns, so a
// callback over its limit in wall time is checked when advance next yields.
// (v8.GCProfiler reads them synchronously, but with it on every run stopped
// within 20 s on a callback using 47 to 63 ms of CPU; without it the same
// start ran on past a minute.)
const collections = [];
new (require('node:perf_hooks').PerformanceObserver)(list => {
  for(const entry of list.getEntries()) {
    collections.push([entry.startTime,entry.startTime+entry.duration]);
    worst.gcPause = Math.max(worst.gcPause,entry.duration);
  }
}).observe({entryTypes:['gc']});
const turn = () => new Promise(resolve => setTimeout(resolve,0)).then(() => new Promise(resolve => setImmediate(resolve)));
// 103 since #2468: the 102 the collection installs, then Thornswood-Last.esp,
// which switches every cut placement off at the record (light, so the 48 full
// plugins keep their indices).
assert.equal(installed.loadOrder.length, 103, 'Use the actual installed 103-plugin fixture');
assert.equal(path.basename(installed.loadOrder[102]), 'Thornswood-Last.esp', 'The fixture ends with Thornswood-Last.esp');
const server = new addon.ScampServer(JSON.stringify({port:0,maxPlayers:2,offlineMode:true,
  name:'npc-shared-native-check',dataDir:path.dirname(installed.loadOrder[0]),
  loadOrder:installed.loadOrder,npcEnabled:true,npcAllowEssential:true,npcAllowCrimeFaction:true,
  npcSettings:{},logLevel:'error',
  ...(populationMode || populationEnumerationMode ? {bannedEspmCharacterRaceIds:[0x10760a]} : {})}));
console.log('Native server constructed with '+installed.loadOrder.length+' plugins');
server._setSelf(server);
// Obtain the exact native eligibility set in a separate, short-lived process.
// It exits before the policy process loads any actors, so cut identities never
// remain allocated as disabled old actors in the policy acceptance world.
if(enumerationMode || populationEnumerationMode) {
  let cursor = 0, total = server.prepareNpcLoad(), peak = process.memoryUsage().rss;
  const ids = new Set();
  while(cursor < total) {
    const batch = server.loadNpcBatch(cursor,8);
    assert.ok(batch.nextCursor > cursor && batch.nextCursor <= batch.total);
    cursor = batch.nextCursor;total = batch.total;
    for(const id of batch.actorIds) {
      assert.notEqual(server.getDescFromId(id),'14:Skyrim.esm','Baseline cannot create the human reference');
      assert.ok(!ids.has(id),'Native preload must enumerate identities once');
      ids.add(id);
    }
    peak = Math.max(peak,process.memoryUsage().rss);
    assert.ok(peak <= maxRssBytes,'Baseline native identity enumeration must stay below 2 GiB RSS');
  }
  if(enumerationMode) assert.equal(ids.size,originalExpectedLoaded,'Verify the unchanged native eligibility fixture');
  assert.deepEqual(server.getLoadedNpcIds(),[...ids].sort((a,b) => a-b));
  console.log(JSON.stringify({nativeEligibleIds:[...ids],peakRssMiB:peak/1048576,candidates:total}));
  process.exit(0);
}
// Optional isolated previous source supports RED verification without editing
// the working runtime while its replacement is under review.
const sourcePath = process.argv[4] || path.join(__dirname,'../../game/gamemode.js');
const source = fs.readFileSync(sourcePath,'utf8');
const context = {Buffer,Math,Date,Number,Map,Set,JSON};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('// NPC SERVER RUNTIME BEGIN'),
  source.indexOf('// NPC SERVER RUNTIME END')),context);
let populationData = null, expectedIds = null, cutIds = null, baselineSummary = null;
const expectedTierById = new Map();
const pluginNames = installed.loadOrder.map(file => path.basename(file));
if(populationMode) {
  const policyBegin = source.indexOf('// NPC POPULATION POLICY BEGIN');
  const policyEnd = source.indexOf('// NPC POPULATION POLICY END');
  const dataBegin = source.indexOf('// NPC POPULATION DATA BEGIN');
  const dataEnd = source.indexOf('// NPC POPULATION DATA END');
  assert.ok(policyBegin >= 0 && policyEnd > policyBegin && dataBegin >= 0 && dataEnd > dataBegin);
  vm.runInContext(source.slice(policyBegin,policyEnd)+'\n'+source.slice(dataBegin,dataEnd)+
    '\n globalThis.populationData=NPC_POPULATION_DATA;',context);
  populationData = context.populationData;
  assert.ok(populationData && populationData.version === 1,'Use generated production population data');
  assert.deepEqual(Array.from(populationData.plugins),pluginNames,'Population catalogue must match all installed plugins in order');
  let exclusionsAttempted = false;
  assert.throws(() => context.createNpcPopulation({setNpcPlacementExclusions() { exclusionsAttempted = true; }},
    populationData,pluginNames.slice().reverse()),/does not match the installed load order/);
  assert.equal(exclusionsAttempted,false,'Reject a stale catalogue before native exclusions change');
  const humanId = server.getIdFromDesc('14:Skyrim.esm');
  assert.throws(() => server.setNpcPlacementExclusions([humanId]),/existing placed NPC identities/,
    'Native policy exclusions must protect the human reference');
  // The gamemode no longer carries a cut list (#2468): the catalogue's own
  // left out rows are the cut, and Thornswood-Last.esp keeps them out.
  assert.equal(populationData.cut,undefined,'The gamemode hands the engine no cut list');
  const cutRows = JSON.parse(fs.readFileSync(path.join(__dirname,'../../game/data/npc-population.json'),'utf8')).npcs
    .filter(row => !row.keep && row.ref !== '14:Skyrim.esm');
  cutIds = new Set(cutRows.map(row => server.getIdFromDesc(row.ref)));
  const keepIds = new Set(populationData.keep.map(row => server.getIdFromDesc(row[0])));
  for(const row of populationData.keep) expectedTierById.set(server.getIdFromDesc(row[0]),row[8] || 0);
  assert.equal(cutIds.size,cutRows.length,'Cut catalogue identities are unique');
  assert.equal(keepIds.size,populationData.keep.length,'Retained catalogue identities are unique');
  assert.ok(!cutIds.has(humanId),'Production catalogue cannot exclude the human reference');
  for(const id of keepIds) assert.ok(!cutIds.has(id),'Retained and cut catalogues cannot overlap');
  const baselineRoot = path.resolve(__dirname,'../../../../temp/whiterun-release');
  fs.mkdirSync(baselineRoot,{recursive:true});
  const baselineDirectory = fs.mkdtempSync(path.join(baselineRoot,'npc-baseline-'));
  try {
    const output = require('node:child_process').execFileSync(process.execPath,
      [__filename,process.argv[2],process.argv[3],sourcePath,'--enumerate-population-native-eligible'],
      {cwd:baselineDirectory,encoding:'utf8',maxBuffer:4*1024*1024,timeout:300000});
    const line = output.split(/\r?\n/).find(value => value.startsWith('{"nativeEligibleIds":'));
    assert.ok(line,'Isolated native baseline must report exact identities');
    const baseline = JSON.parse(line), baselineIds = new Set(baseline.nativeEligibleIds);
    assert.equal(baselineIds.size,baseline.nativeEligibleIds.length,'Independent native baseline identities are unique');
    assert.ok(baseline.peakRssMiB <= maxRssBytes/1048576);
    for(const id of baselineIds) assert.ok(keepIds.has(id) || cutIds.has(id),
      'Catalogue must account for each original native-eligible placement');
    expectedIds = new Set([...baselineIds].filter(id => keepIds.has(id)));
    expectedLoaded = expectedIds.size;
    assert.equal(expectedLoaded,keepIds.size,'Every retained source identity must be native eligible with the population race configuration');
    baselineSummary = {nativeEligible:baselineIds.size,originalDefaultRaceNativeEligible:originalExpectedLoaded,
      raceConfigurationDelta:baselineIds.size-originalExpectedLoaded,bannedEspmCharacterRaceIds:[0x10760a],retainedNativeEligible:expectedLoaded,
      excludedNativeEligible:[...baselineIds].filter(id => cutIds.has(id)).length,
      catalogueKeep:keepIds.size,catalogueCut:cutIds.size,baselinePeakRssMiB:baseline.peakRssMiB};
    assert.equal(baselineSummary.retainedNativeEligible+baselineSummary.excludedNativeEligible,baselineIds.size);
    // With Thornswood-Last.esp at the end of the order the engine finds no
    // cut placement eligible at all: it skips a disabled reference.
    assert.equal(baselineSummary.excludedNativeEligible,0,'No cut placement is native eligible with Thornswood-Last.esp');
    console.log(JSON.stringify({populationAcceptance:baselineSummary}));
  } finally {
    const ownedDirectory = fs.realpathSync(baselineDirectory);
    assert.equal(path.dirname(ownedDirectory),fs.realpathSync(baselineRoot),'Cleanup stays inside the owned baseline fixture root');
    fs.rmSync(ownedDirectory,{recursive:true,force:true});
  }
}
let time = Date.now(), sequence = 0, current = null, callbackAt = 0, callbacks = 0;
let runtime = null, restarting = false, peakRss = process.memoryUsage().rss;
const pending = new Map(), loaded = new Set(), controlled = new Set(), moved = new Set();
const observedNativeIds = new Set();
const protectedHumanId = server.getIdFromDesc('14:Skyrim.esm');
const unavailable = new Set(), lines = [], positions = new Map(), firstWrites = new Map();
const acceptedAttackers = new Set();
const attackAttempts = new Map(), nativeStates = new Map();
const nativeSpeeds = new Map(), stoppedActors = new Set();
const savedBeforeRestart = new Map(), writeSequences = new Map(), writeModes = new Map();
const validationFailures = [];
const worst = {callback:0,callbackTask:'',callbackWork:0,callbackWorkTask:'',counterGHz:threadClock.counterGHz,gcPause:0,wallOverLimit:0,
  load:0,state:0,nav:0,geometry:0,movement:0,attack:0};
const timers = {
  setTimeout(fn,delay) {
    assert.ok(Number.isFinite(delay) && delay >= 0, 'Scheduled delay is finite and nonnegative');
    const id = ++sequence;
    pending.set(id,{fn,at:time+delay,name:fn.npcRuntimeTask || fn.name || fn.toString().slice(0,120)});
    return id;
  },
  clearTimeout(id) { pending.delete(id); }
};
function sampleRss() {
  peakRss = Math.max(peakRss,process.memoryUsage().rss);
  assert.ok(peakRss <= maxRssBytes,'Native runtime exceeded 2 GiB RSS: '+(peakRss/1048576).toFixed(1)+' MiB');
}
function log(line) {
  lines.push(line);
  const rejection = /^NPC ([0-9a-f]+) remains loaded; activity unavailable:/.exec(line);
  if(rejection) unavailable.add(parseInt(rejection[1],16));
}
const api = {};
if(populationMode) assert.equal(typeof server.setNpcDifficultyTier,'function','Population acceptance requires the native difficulty tier setter');
for(const method of ['makeProperty','get','getIdFromDesc','getDescFromId','getLoadedNpcIds',
  'setNpcPlacementExclusions','getFactionReactions','serverNpcAttack','stopNpcMovement','callPapyrusFunction'])
  api[method] = server[method].bind(server);
if(populationMode) api.setNpcDifficultyTier = server.setNpcDifficultyTier.bind(server);
api.getLoadedNpcIds = () => {
  const ids = server.getLoadedNpcIds();
  for(const id of ids) {
    assert.ok(Number.isSafeInteger(id) && id > 0);
    assert.notEqual(id,protectedHumanId,'Native discovery cannot enroll the human reference');
    if(populationMode) assert.ok(expectedIds.has(id),'Fresh policy discovery must stay inside the exact retained intersection');
    observedNativeIds.add(id);
  }
  return ids;
};
api.stopNpcMovement = id => {
  assert.ok(controlled.has(id),'A terminal stop must retain native server authority');
  const position = server.get(id,'locationalData').pos.slice();
  server.stopNpcMovement(id);
  nativeSpeeds.set(id,0);stoppedActors.add(id);
  assert.deepEqual(server.get(id,'locationalData').pos,position,
    'A trusted stop cannot translate an actor onto assumed navigation');
};
api.serverNpcAttack = (id,target) => {
  const count = attackAttempts.get(id) || {attempted:0,accepted:0,rejected:0,errors:0};
  const actorState = nativeStates.get(id), targetState = nativeStates.get(target);
  count.attempted++;
  count.last = {at:time,target:target.toString(16),
    distance:actorState && targetState ? Math.hypot(...actorState.pos.map((v,i) => v-targetState.pos[i])) : null,
    actorPosition:actorState && actorState.pos,targetPosition:targetState && targetState.pos,
    actorReach:actorState && actorState.meleeReach,targetAllowance:targetState && targetState.meleeAllowance};
  attackAttempts.set(id,count);
  try {
    const accepted = timed('attack','serverNpcAttack',[id,target]);
    if(accepted) { acceptedAttackers.add(id);count.accepted++; }
    else count.rejected++;
    return accepted;
  } catch(error) {
    count.errors++;count.last.error = String(error);
    throw error;
  }
};
function timed(key,method,args) {
  const at = performance.now(), out = server[method](...args);
  worst[key] = Math.max(worst[key],performance.now()-at);
  return out;
}
api.loadNpcBatch = (cursor,limit) => {
  const batch = timed('load','loadNpcBatch',[cursor,limit]);
  batch.actorIds.forEach(id => { loaded.add(id);observedNativeIds.add(id); });
  return batch;
};
api.getNpcAIState = id => {
  const state = timed('state','getNpcAIState',[id]);
  nativeStates.set(id,state);
  return state;
};
api.getNavmeshRecords = (cell,pos) => timed('nav','getNavmeshRecords',[cell,pos]);
api.lookupEspmRecordById = id => timed('geometry','lookupEspmRecordById',[id]);
api.setNpcServerControlled = (id,on) => {
  assert.ok(observedNativeIds.has(id),'Authority must use an independently observed existing native identity');
  server.setNpcServerControlled(id,on);
  if(on) {
    controlled.add(id);
    positions.set(id,server.get(id,'locationalData').pos.slice());
  } else controlled.delete(id);
};
api.set = (id,property,value) => {
  server.set(id,property,value);
  if(property !== 'thornswoodNpcActivity') return;
  assert.equal(value.version,2);
  assert.ok(Number.isSafeInteger(value.sequence),'Persist a finite integer activity sequence');
  if(!firstWrites.has(id)) {
    firstWrites.set(id,value.sequence);
    if(restarting && savedBeforeRestart.has(id)) {
      assert.equal(value.sequence,savedBeforeRestart.get(id).sequence,
        'Reload must recover the saved sequence for '+id.toString(16));
    }
  }
  if(writeSequences.has(id)) {
    assert.ok(value.sequence >= writeSequences.get(id),'Saved activity sequence cannot go backwards');
    // Written when its mode changes, never again as it wanders (#3180): each
    // write saves the actor's whole record durably.
    assert.notEqual(value.mode,writeModes.get(id),'Activity is rewritten only when its mode changes, not as it wanders: '+id.toString(16));
  }
  writeSequences.set(id,value.sequence);writeModes.set(id,value.mode);
};
api.updateNpcMovement = (id,pos,rot,speed) => {
  assert.ok(controlled.has(id),'Movement requires current native server authority');
  const previous = positions.get(id);
  timed('movement','updateNpcMovement',[id,pos,rot,speed]);
  nativeSpeeds.set(id,speed);
  // Check native positions, rather than treating a speed argument as proof.
  // The engine holds a position as three 32-bit floats (NiPoint3), which past
  // 131072 units from the origin are 1/64 of a unit apart, so a shorter step
  // is stored as no step. The runtime keeps its own position in doubles and
  // steps on from that, so the engine catches up on the next step (#2032: the
  // Castle Volkihar skeletons 2013cc0 and 2013cc2, at x -173213, were asked
  // for 0.011 units on the first tick after the reload).
  const engineCanMove = previous && pos.some((v,i) => Math.fround(v) !== Math.fround(previous[i]));
  if(!moved.has(id) && engineCanMove) {
    const actual = server.get(id,'locationalData').pos;
    assert.ok(Math.hypot(...actual.map((v,i) => v-previous[i])) > 0.000001,
      'Native position must advance for '+id.toString(16));
    assert.ok(Math.hypot(...actual.map((v,i) => v-pos[i])) < 0.25,
      'Native movement must reach the submitted safe position');
    moved.add(id);
  }
  positions.set(id,pos.slice());
  current.moves++;
};
// Production catches actor-local failures. Assertions in these instrumented
// APIs must still fail the test, rather than turning a defect into an exclusion.
for(const method of ['setNpcServerControlled','set','updateNpcMovement','stopNpcMovement','getLoadedNpcIds']) {
  const original = api[method];
  api[method] = (...args) => {
    try { return original(...args); }
    catch(error) {
      if(error instanceof assert.AssertionError) validationFailures.push(error.message);
      throw error;
    }
  };
}
const indexed = performance.now(), candidates = server.prepareNpcLoad();
const indexingMs = performance.now()-indexed;
console.log('Indexed '+candidates+' existing NPC candidates');
sampleRss();
const sampledNow = () => time+(callbackAt ? performance.now()-callbackAt : 0);
const overLimit = [];
function noteWork(name,work) {
  if(work > worst.callbackWork) { worst.callbackWork = work; worst.callbackWorkTask = name; }
}
async function checkOverLimit() {
  if(!overLimit.length) return;
  await turn();
  for(const c of overLimit) {
    let gc = 0;
    for(const [begin,end] of collections) gc += Math.max(0,Math.min(end,c.end)-Math.max(begin,c.start));
    const work = Math.min(c.duration-gc,c.cpu);
    noteWork(c.name,work);
    assert.ok(work <= c.limit,'Scheduled callback exceeded '+c.limit+' ms: '+c.name+' '+c.duration.toFixed(2)+' ms, '+
      gc.toFixed(1)+' ms of it collecting garbage, '+c.cpu.toFixed(1)+' ms on the CPU');
  }
  overLimit.length = 0;
  collections.length = 0;
}
async function advance(ms) {
  const until = time+ms;
  let calls = 0;
  while(pending.size) {
    const [id,task] = [...pending].sort((a,b) => a[1].at-b[1].at || a[0]-b[0])[0];
    if(task.at > until) break;
    time = task.at;
    pending.delete(id);
    current = {moves:0};
    const start = performance.now();
    callbackAt = start;
    const cpuAt = threadClock.ms();
    let duration=0, cpu=0;
    try { task.fn(); }
    finally {
      cpu = threadClock.ms()-cpuAt;
      duration = performance.now()-start;
      callbackAt = 0;
      if(duration > worst.callback) { worst.callback = duration; worst.callbackTask = task.name; }
    }
    assert.ok(current.moves <= 96,'A scheduled callback must bound movement work');
    assert.deepEqual(validationFailures,[],'Actor-local catches must not hide acceptance assertion failures');
    const limit=task.name==='preload' ? maxColdLoadMs : maxCallbackMs;
    if(duration > limit) {
      worst.wallOverLimit++;
      overLimit.push({name:task.name,start,end:start+duration,duration,cpu,limit});
    } else noteWork(task.name,Math.min(duration,cpu));
    if(++callbacks % 100 === 0) sampleRss();
    assert.ok(++calls < 200000,'Runtime must yield with finitely many scheduled callbacks');
    if(callbacks % 1000 === 0) await checkOverLimit();
  }
  time = until;
  await checkOverLimit();
  sampleRss();
}
function status() {
  assert.equal(typeof runtime.getStatus,'function','Expose complete cast preparation and authority diagnostics');
  const state = runtime.getStatus();
  for(const field of ['loaded','controlled','active','unavailable','preparing','pendingMeshes']) {
    assert.ok(Number.isSafeInteger(state[field]) && state[field] >= 0,'Finite diagnostic count: '+field);
  }
  assert.equal(state.loaded,loaded.size,'Diagnostics reflect all unique loaded native identities');
  assert.equal(state.controlled,controlled.size,'Diagnostics reflect current native authority');
  assert.equal(state.unavailable,unavailable.size,'Unavailable identities are unique and observable');
  // Native discovery can enroll existing actors before their preload batch is
  // revisited during gamemode reload. Native observations, not batch order,
  // establish their identity; completion still requires the exact full batch.
  assert.ok(state.controlled <= observedNativeIds.size,'Ownership cannot create extra native identities');
  assert.ok(state.active <= state.controlled,'Every active identity must be server owned');
  assert.ok(state.active+state.unavailable <= observedNativeIds.size,'Active and stationary classifications cannot count a native identity twice');
  assert.ok(typeof state.loadingComplete === 'boolean');
  return state;
}
async function finishPreparation(stage) {
  const start = time;
  while(time-start < completionLimitMs) {
    await advance(1000);
    const state = status();
    if(state.loadingComplete && state.preparing === 0 && state.pendingMeshes === 0 &&
        state.active+state.unavailable+(state.held || 0) === state.loaded) break;
  }
  const state = status();
  console.log(JSON.stringify({stage,elapsedMs:time-start,status:state,peakRssMiB:peakRss/1048576,worst}));
  assert.equal(loaded.size,expectedLoaded,'Load every identity in the installed cast');
  assert.equal(state.loadingComplete,true,'Native loading must finish');
  assert.equal(state.preparing,0,'Every queued actor must finish preparation within five simulated minutes');
  assert.equal(state.pendingMeshes,0,'Navigation preparation must finish within five simulated minutes');
  assert.equal(controlled.size,expectedLoaded,'Every existing native NPC remains server owned, including stationary actors');
  assert.equal(observedNativeIds.size,expectedLoaded,'Native discovery and preloading must identify exactly the same cast');
  const reasons = new Map();
  for(const line of lines) {
    const m = /activity unavailable: (.*)$/.exec(line);
    if(m) reasons.set(m[1],(reasons.get(m[1]) || 0)+1);
  }
  console.log(JSON.stringify({stage,stationaryReasons:Object.fromEntries(reasons)}));
  // Placed off walkable ground (#2067): set down out of sight, which with
  // nobody connected is at once, or for an ambush, waiting until somebody is
  // near. So with nobody connected only catalogued ambushes may still wait.
  const waiting = runtime.getHeldIds ? runtime.getHeldIds() : [];
  assert.equal(state.active+state.unavailable+(state.held || 0),expectedLoaded,
    'Every identity is active, stationary or waiting off walkable ground');
  if(populationMode) {
    const ambushes = new Set(populationData.keep.filter(row => (row[11] || 0) & 2).map(row => server.getIdFromDesc(row[0])));
    for(const id of waiting) assert.ok(ambushes.has(id),'Only an ambush waits with nobody near: '+id.toString(16));
  } else assert.equal(waiting.length,0,'With nobody connected nobody else waits off walkable ground');
  for(const id of loaded) {
    assert.ok(controlled.has(id),'No loaded NPC may return to client hosting');
    const nativeState = server.getNpcAIState(id);
    assert.equal(nativeState.isServerControlled,true,'Native authority must persist for '+id.toString(16));
    if(populationMode) assert.equal(nativeState.difficultyTier,expectedTierById.get(id),
      stage+' native difficulty must match the source row for '+id.toString(16));
  }
  if(populationMode) {
    const nativeLoaded = new Set(server.getLoadedNpcIds());
    assert.equal(nativeLoaded.size,expectedIds.size,'Preparation must load the exact policy cast');
    for(const id of expectedIds) assert.ok(nativeLoaded.has(id) && controlled.has(id),'Every source-retained identity must be loaded and owned');
    for(const id of cutIds) assert.ok(!nativeLoaded.has(id),'Fresh policy world must exclude every cut identity');
    console.log(JSON.stringify({stage,tierVerified:controlled.size,exactRetained:expectedIds.size,cutAbsent:cutIds.size}));
  }
  for(const id of unavailable) {
    assert.ok(loaded.has(id),'Every stationary identity belongs to the loaded cast');
    assert.ok(controlled.has(id),'Unavailable navigation cannot release native authority');
  }
}
async function proveActivity(stage) {
  // A fresh window after preparation prevents initial motion alone passing.
  moved.clear();
  acceptedAttackers.clear();
  attackAttempts.clear();
  const waiting = new Set(runtime.getHeldIds ? runtime.getHeldIds() : []);
  const stationaryPositions = new Map([...unavailable,...waiting].map(id =>
    [id,server.get(id,'locationalData').pos.slice()]));
  const eligible = [...controlled].filter(id => {
    if(unavailable.has(id) || waiting.has(id)) return false;
    const state = server.getNpcAIState(id);
    return !state.isDead && !state.isDisabled && !state.immobile;
  });
  assert.ok(eligible.length > 1000,'Exercise a substantial eligible native cast');
  await advance(120000);
  // Native combat can kill an eligible actor before its first scheduled turn.
  // Freeze activity evidence at the window boundary, then give terminal actors
  // a bounded fair sweep to publish their native stop and prove it stays still.
  const windowMoved = new Set(moved), windowAttackers = new Set(acceptedAttackers);
  const terminalPositions = new Map();
  for(const id of controlled) {
    if(unavailable.has(id) || waiting.has(id)) continue;
    const state = server.getNpcAIState(id);
    if(state.isDead || state.isDisabled || state.immobile) {
      terminalPositions.set(id,state.pos.slice());
    }
  }
  if(populationMode) {
    const nativeLoaded = new Set(server.getLoadedNpcIds());
    assert.equal(nativeLoaded.size,expectedIds.size,'A fresh policy world cannot keep allocated cut identities');
    for(const id of expectedIds) {
      assert.ok(loaded.has(id) && nativeLoaded.has(id) && controlled.has(id),
        'Each catalogue-retained native-eligible placement must load and remain owned: '+id.toString(16));
    }
    for(const id of loaded) assert.ok(expectedIds.has(id),'Policy cannot load an identity outside the exact retained intersection');
    for(const id of cutIds) assert.ok(!nativeLoaded.has(id) && !loaded.has(id),'Fresh policy world cannot load a cut placement');
  }
  // Fair means every terminal actor has had its next turn. Background work
  // gets 4 ms of wall time every 20 ms, so a pass over the cast takes as long
  // as the machine needs: in 10 s it reached 2,781 to 5,931 of 11,142 actors
  // on One on 11 Oct, and each actor that failed here had died after its last
  // turn and not had another (#2032). It steps at least one actor a tick, so
  // a pass over the full cast fits in five simulated minutes.
  const turns = new Map([...terminalPositions.keys()].map(id => [id,(runtime.getActorStatus(id) || {}).lastUpdate]));
  const sweepStart = time;
  await advance(10000);
  while(time-sweepStart < completionLimitMs && [...turns].some(([id,last]) => {
    const activity = runtime.getActorStatus(id);
    return activity && activity.lastUpdate === last;
  })) await advance(1000);
  const terminalSweepMs = time-sweepStart;
  for(const [id,position] of terminalPositions) {
    const native = server.getNpcAIState(id), activity = runtime.getActorStatus(id);
    assert.ok(controlled.has(id) && native.isServerControlled,'Terminal actors retain native authority');
    assert.equal(activity && activity.paused,true,'Terminal actor must pause after a fair scheduled sweep: '+id.toString(16));
    assert.deepEqual(Array.from(activity.path),[],'Paused actors cannot retain a route');
    assert.equal(activity.target,0,'Paused actors cannot retain a combat target');
    assert.ok(stoppedActors.has(id),'Terminal actor must call the native trusted stop: '+id.toString(16));
    assert.equal(nativeSpeeds.get(id),0,'Last native movement command must set zero speed');
    assert.deepEqual(native.pos,position,'Terminal actor must remain at its stopped native position');
  }
  for(const [id,position] of stationaryPositions) {
    assert.ok(controlled.has(id),'Stationary actors must remain server owned');
    assert.equal(server.getNpcAIState(id).isServerControlled,true);
    assert.deepEqual(server.get(id,'locationalData').pos,position,
      'Unavailable navigation cannot move a stationary actor: '+id.toString(16));
    assert.ok(!moved.has(id),'A stationary actor cannot enter the movement runtime');
  }
  let progressedSequences = 0;
  for(const id of eligible) {
    assert.ok(controlled.has(id),'Prepared actor must keep working: '+id.toString(16));
    if(terminalPositions.has(id)) continue;
    if(!windowMoved.has(id) && !windowAttackers.has(id)) {
      reportIdleActor(id,stage);
    }
    assert.ok(windowMoved.has(id) || windowAttackers.has(id),stage+' native activity missing for '+id.toString(16));
    const saved = server.get(id,'thornswoodNpcActivity');
    assert.equal(saved.version,2);
    // Only a fight or a flight writes it again (#3180), so most stay as taken on.
    if(saved.sequence > firstWrites.get(id)) progressedSequences++;
  }
  assert.ok(windowMoved.size > 1000,stage+' must physically move a substantial native cast');
  console.log(JSON.stringify({stage,eligible:eligible.length,moved:windowMoved.size,acceptedAttackers:windowAttackers.size,
    terminalPaused:terminalPositions.size,terminalSweepMs,
    progressedSequences,status:status(),peakRssMiB:peakRss/1048576,worst}));
}
function diagnosticRead(fn) {
  try { return fn(); }
  catch(error) { return {diagnosticError:String(error)}; }
}
function actorDetails(id) {
  if(!id) return null;
  return {id:id.toString(16),state:diagnosticRead(() => server.getNpcAIState(id)),
    location:diagnosticRead(() => server.get(id,'locationalData')),
    inventory:diagnosticRead(() => server.get(id,'inventory')),
    equipment:diagnosticRead(() => server.get(id,'equipment')),
    activity:diagnosticRead(() => runtime.getActorStatus(id)),
    saved:diagnosticRead(() => server.get(id,'thornswoodNpcActivity'))};
}
function sourceDetails(equipment) {
  const entries = equipment && equipment.inv && equipment.inv.entries || [];
  const sources = new Set([0x1f4,...entries.map(entry => entry.baseId).filter(Number.isInteger)]);
  return [...sources].map(id => diagnosticRead(() => {
    const record = server.lookupEspmRecordById(id).record;
    return {id:id.toString(16),type:record.type,editorId:record.editorId,
      fields:record.fields.filter(field => ['DNAM','DATA','OBND'].includes(field.type))
        .map(field => ({type:field.type,bytes:Buffer.from(field.data).toString('hex')}))};
  }));
}
function reportIdleActor(id,stage) {
  const actor = actorDetails(id);
  const targetId = actor.activity && actor.activity.target || actor.state && actor.state.combatTarget || 0;
  const target = actorDetails(targetId);
  const distance = target && Array.isArray(actor.state.pos) && Array.isArray(target.state.pos) ?
    Math.hypot(...actor.state.pos.map((v,i) => v-target.state.pos[i])) : null;
  console.log(JSON.stringify({idleId:id.toString(16),stage,actor,target,distance,
    attempts:attackAttempts.get(id) || {attempted:0,accepted:0,rejected:0,errors:0},
    targetAttempts:attackAttempts.get(targetId) || null,equippedSources:sourceDetails(actor.equipment)}));
}
(async () => {
try {
  let population = populationMode ? context.createNpcPopulation(api,populationData,pluginNames) : null;
  runtime = context.startSharedNpcServerRuntime(api,timers,sampledNow,log,population);
  await finishPreparation('initial preparation');
  await proveActivity('before gamemode reload');
  const originalIds = new Set(loaded);
  runtime.stop();
  assert.equal(pending.size,0,'Stop must cancel every scheduled callback');
  for(const id of controlled) {
    const saved = server.get(id,'thornswoodNpcActivity');
    if(saved && Number.isSafeInteger(saved.sequence)) savedBeforeRestart.set(id,saved);
  }
  server.clear();
  controlled.clear();unavailable.clear();moved.clear();positions.clear();firstWrites.clear();writeSequences.clear();writeModes.clear();
  nativeSpeeds.clear();stoppedActors.clear();
  loaded.clear();observedNativeIds.clear();restarting = true;
  population = populationMode ? context.createNpcPopulation(api,populationData,pluginNames) : null;
  runtime = context.startSharedNpcServerRuntime(api,timers,sampledNow,log,population);
  await finishPreparation('gamemode reload preparation');
  assert.equal(loaded.size,originalIds.size);
  for(const id of loaded) assert.ok(originalIds.has(id),'Reload must preserve each existing cast identity');
  for(const id of controlled) {
    if(savedBeforeRestart.has(id) && firstWrites.has(id)) {
      assert.equal(firstWrites.get(id),savedBeforeRestart.get(id).sequence);
    } else if(savedBeforeRestart.has(id)) {
      const saved = server.get(id,'thornswoodNpcActivity');
      assert.ok(saved,'Stationary ownership cannot discard persisted activity');
      assert.equal(saved.sequence,savedBeforeRestart.get(id).sequence);
    }
  }
  await proveActivity('after gamemode reload');
  runtime.stop();
  assert.equal(pending.size,0);
  console.log(JSON.stringify({passed:true,population:baselineSummary,candidates,indexingMs,loadedForms:server.getLoadedFormCount(),
    loaded:loaded.size,controlled:controlled.size,unavailable:unavailable.size,peakRssMiB:peakRss/1048576,worst,
    reasons:lines.filter(line => line.includes('activity unavailable')).slice(0,30)}));
  process.exit(0);
} catch(error) {
  if(runtime) runtime.stop();
  console.error(JSON.stringify({passed:false,error:error.stack,loaded:loaded.size,controlled:controlled.size,
    unavailable:unavailable.size,peakRssMiB:peakRss/1048576,worst,
    status:runtime && typeof runtime.getStatus === 'function' ? runtime.getStatus() : null}));
  process.exit(1);
}
})();
