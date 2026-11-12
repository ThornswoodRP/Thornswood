'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Run with no arguments (the nightly), check the gamemode sections this harness loads and SKIP the native part (#1881).
if(!process.argv[2]||!process.argv[3]){
  const src=require('node:fs').readFileSync(require('node:path').join(__dirname,'../../game/gamemode.js'),'utf8');
  for(const m of ["NPC SERVER RUNTIME"]){
    const b=src.indexOf('// '+m+' BEGIN'),e=src.indexOf('// '+m+' END');
    if(b<0||e<=b){console.error('FAIL: gamemode.js section '+m+' missing');process.exit(1);}
  }
  console.log('SKIP: runtime native check needs <built addon .node path> <installed record .json path> (node game/tests/test-npc-runtime-native.js <addon> <installed.json>); gamemode sections present: NPC SERVER RUNTIME');
  process.exit(0);
}
const addon = require(path.resolve(process.argv[2]));
const installed = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
// Read the installed load order only. No saved world, credentials or VPS state.
const server = new addon.ScampServer(JSON.stringify({
  port: 0, maxPlayers: 2, offlineMode: true, name: 'npc-runtime-check',
  dataDir: path.dirname(installed.loadOrder[0]), loadOrder: installed.loadOrder,
  npcEnabled: true, npcAllowEssential: true, npcAllowCrimeFaction: true,
  npcSettings: {}, logLevel: 'error'
}));
const source = fs.readFileSync(path.join(__dirname, '../../game/gamemode.js'), 'utf8');
const context = { Buffer, Math, Date, Number, Map, Set, JSON };
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('// NPC SERVER RUNTIME BEGIN'),
  source.indexOf('// NPC SERVER RUNTIME END')), context);
let time = Date.now(), nextHandle = 0, batchWorst = 0, batches = 0;
const pending = new Map(), lines = [];
const timers = {
  setTimeout(fn, delay) { const id = ++nextHandle; pending.set(id, {fn, at: time+delay}); return id; },
  clearTimeout(id) { pending.delete(id); }
};
const api = {};
for (const method of ['makeProperty','get','set','getIdFromDesc','getNavmeshRecords',
  'lookupEspmRecordById','setNpcServerControlled','updateNpcMovement']) api[method] = server[method].bind(server);
api.loadNpcBatch = function (cursor, limit) {
  const start = performance.now(), result = server.loadNpcBatch(cursor, limit);
  batchWorst = Math.max(batchWorst, performance.now()-start); batches++;
  return result;
};
function advance(ms) {
  const until = time+ms;
  let runs = 0;
  while (pending.size) {
    const [id, task] = [...pending].sort((a,b)=>a[1].at-b[1].at)[0];
    if (task.at > until) break;
    time = task.at; pending.delete(id); task.fn();
    assert.ok(++runs < 20000);
  }
  time = until;
}
const actor = server.getIdFromDesc('1a66e:Skyrim.esm');
const indexedAt = performance.now();
const candidates = server.prepareNpcLoad();
const indexingMs = performance.now()-indexedAt;
const runtime = context.startNpcServerRuntime(api, timers, ()=>time, line=>lines.push(line));
advance(20000);
assert.ok(lines.some(line=>line.includes('loading complete')), lines.join('\n'));
assert.ok(lines.some(line=>line.includes('routine ready')), lines.join('\n'));
const before = server.get(actor, 'locationalData');
advance(12000);
const after = server.get(actor, 'locationalData');
assert.notDeepEqual(after.pos, before.pos, 'Real native state advances without a human host');
advance(90000);
assert.ok(lines.some(line=>/moved [1-9]/.test(line)), lines.join('\n'));
assert.ok(lines.every(line=>!line.includes('stopped')), lines.join('\n'));
const saved = server.get(actor, 'thornswoodNpcRoutine');
assert.equal(saved.version, 1);
assert.equal(saved.route.length, 4);
runtime.stop();
assert.equal(pending.size, 0);
server.clear(); // requireUncached clears gamemode registrations before reload.
const reloaded = context.startNpcServerRuntime(api, timers, ()=>time, line=>lines.push(line));
advance(20000);
assert.ok(pending.size > 0, lines.join('\n'));
assert.equal(server.get(actor, 'thornswoodNpcRoutine').mesh, saved.mesh);
reloaded.stop();
assert.equal(pending.size, 0);
console.log(JSON.stringify({passed:true,candidates,indexingMs,batches,batchWorstMs:batchWorst,
  before:before.pos,after:after.pos,mesh:saved.mesh,route:saved.route,lines}));
process.exit(0);
