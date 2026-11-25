'use strict';
// Run the actual server tool module and its native property scripts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../gamemode/staff-tools.ts'), 'utf8');
const staffSource = fs.readFileSync(path.join(__dirname, '../gamemode/staff.ts'), 'utf8');
const catalogSource = fs.readFileSync(path.join(__dirname, '../gamemode/command-tools.ts'), 'utf8');
let checks = 0;
function test(name, run) { run(); checks++; console.log('PASS  ' + name); }
function setup() {
  const rows = new Map([[10, {profileId: 123, pos: [0,0,0], angle: [0,0,0], worldOrCellDesc: '3c:Skyrim.esm', isDead: false,
    isGodMode: false,npc:{runtimeLifeIdentity:'actor-10-life-1'}}], [20, {profileId: 456}]]);
  const writes = [], said = [], records = [], properties = {}, natives = [], timers = [], teleports = [];
  let staff = true, tester = true, admin = true, cuffed = false, jailed = false, clearCount = 0;
  const context = {console, Date, Math, Number, Object, Array, JSON, String, WORDS:[],serverRunId:()=> 'test-run',
    log: (...args) => said.push(args.join(' ')), guard: (_, fn) => fn,
    setInterval: fn => { timers.push(fn); return timers.length; }, clearInterval: () => {},
    __thornswoodPassSeen: {passes: {123: {x: Date.now() + 60000}}},
    __thornswoodStaffState: {frozen: {}},
    __thornswoodIsStaff: () => staff,
    __thornswoodCommandRoles:{playtester:()=>tester,staff:()=>staff,admin:()=>admin},
    __thornswoodCuffs: {cuffedBy: () => cuffed},
    __thornswoodProperty: {lockedJailHere: () => jailed},
    __thornswoodNeeds: {clearIntoxication: () => { clearCount++; },settle:()=>{},godmodeChanged:()=>{}},
    __thornswoodNpcPopulation: {staffKillable: () => true},
    __thornswoodStuck: {teleported:(pid,actor)=>teleports.push([pid,actor])},
    __thornswoodStaff: {
      unproven: (cmd, pid) => !cmd || cmd.proven !== true ? 'unproven' :
        !(context.__thornswoodPassSeen.passes[pid]?.x > Date.now()) ? 'expired' : '',
      record: (...args) => records.push(args)
    },
    __thornswoodToProfile: (_, text) => said.push(text),
    mp: {
      get: (id, name) => { if (id === 0 && name === 'onlinePlayers') return [10,20];
        if (!rows.has(id) || !(name in rows.get(id))) throw Error('unreadable ' + name);
        return rows.get(id)[name]; },
      set: (id, name, value) => {
        writes.push({id, name, value});
        if(name==='locationalData') {
          const row=rows.get(id);row.worldOrCellDesc=value.cellOrWorldDesc;row.pos=value.pos;row.angle=value.rot;
        } else rows.get(id)[name] = value;
      },
      makeProperty: (name, spec) => { properties[name] = spec; },
      getIdFromDesc: () => 60,
      getNeighborsByPosition: () => Array.from(rows.keys()),
      getNpcAIState: id => rows.get(id).npc,
      getActorRuntimeIdentity:id=>rows.get(id).npc.runtimeLifeIdentity
    }
  };
  vm.createContext(context); vm.runInContext(catalogSource,context); vm.runInContext(source, context); vm.runInContext(staffSource,context);
  context.__thornswoodStaff.record = (...args) => records.push(args);
  const tools = context.__thornswoodStaffTools;
  const run = (word, args = [], cmd = {proven:true}, pid = 123, actor = 10) =>
    context.__thornswoodCommandTools.command(cmd, word, [word].concat(args), pid, actor);
  return {context, tools, rows, writes, said, records, properties, natives, timers, teleports, run,
    staff: v => {staff = v;}, tester:v=>{tester=v;}, admin:v=>{admin=v;}, cuffs: v => {cuffed = v;}, jail: v => {jailed = v;}, cleared: () => clearCount};
}
test('only a proven, currently admitted playtest actor can use tools', () => {
  const w = setup();
  w.tester(false); w.run('/godmode', ['on']);
  w.tester(true); w.run('/godmode', ['on'], {proven:false});
  w.run('/godmode', ['on'], {proven:true}, 123, 20);
  w.context.__thornswoodPassSeen.passes[123].x = 1; w.run('/godmode', ['on']);
  assert.equal(w.writes.length, 0); assert.equal(w.records.length, 0);
});
test('a playtester can use self tools on either channel, but killall is admin only', () => {
  const w = setup(); w.staff(false); w.admin(false);
  w.run('/godmode',['on']); assert.equal(w.rows.get(10).isGodMode,true);
  w.run('/killall'); assert.equal(w.records.filter(r=>r[0]==='killall').length,0);
});
test('tool names and arguments cannot select arbitrary targets or native calls', () => {
  const w = setup(); assert.equal(w.run('/notatool'), false);
  w.run('/godmode', ['on', 'somebody']); w.run('/fly', ['whatever']);
  assert.equal(w.writes.length, 0);
});
test('god mode changes the native server protection before publishing the owner mode', () => {
  const w = setup(); w.run('/godmode', ['on']);
  assert.equal(w.rows.get(10).isGodMode, true);
  assert.equal(w.writes[0].name, 'isGodMode');
  assert.equal(w.rows.get(10).thornswoodStaffTools.godmode, true);
  assert.equal(w.rows.get(10).thornswoodStaffTools.fly, true);
  w.run('/godmode', ['off']); assert.equal(w.rows.get(10).isGodMode, false);
});
test('god mode refuses a missing native binding and never revives the dead', () => {
  const w = setup(); delete w.rows.get(10).isGodMode;
  w.run('/godmode', ['on']); assert.equal(w.writes.length, 0);
  w.rows.get(10).isGodMode = false; w.rows.get(10).isDead = true;
  w.run('/godmode', ['on']); assert.equal(w.writes.length, 0);
});
test('flight and phasing respect freezes, cuffs and locked jails', () => {
  for (const kind of ['freeze','cuffs','jail']) {
    const w = setup();
    if (kind === 'freeze') w.context.__thornswoodStaffState.frozen[123] = {};
    if (kind === 'cuffs') w.cuffs(true);
    if (kind === 'jail') w.jail(true);
    w.run('/fly', ['on']); w.run('/phase'); assert.equal(w.writes.length, 0);
  }
});
test('phase is a fixed short server move in the same cell', () => {
  const w = setup(); w.run('/phase');
  const move = w.writes.find(x => x.name === 'locationalData');
  assert.equal(move.value.cellOrWorldDesc, '3c:Skyrim.esm');
  assert.deepEqual(Array.from(move.value.pos), [0,256,0]);
  assert.equal(w.records[0][0], 'phase');
  assert.deepEqual(w.teleports,[[123,10]]);
});

test('a silent native phase refusal cannot reset history or audit success',()=>{
  const w=setup(),set=w.context.mp.set;
  w.context.mp.set=(id,key,value)=>key==='locationalData'?undefined:set(id,key,value);
  w.run('/phase');
  assert.equal(w.records.length,0);assert.equal(w.teleports.length,0);
  assert.match(w.said.join(' '),/could not complete/);
});

test('unreadable movement or restraint state cannot enable collision-free movement', () => {
  const missing = setup(); delete missing.context.__thornswoodStaffState;
  missing.run('/fly',['on']);
  assert.equal(missing.writes.length,0);
  const unknown = setup(); delete unknown.rows.get(10).worldOrCellDesc;
  unknown.run('/fly',['on']);
  assert.equal(unknown.writes.length,0);
});
test('clear effects delegates to authoritative intoxication state once', () => {
  const w = setup(); w.run('/cleareffects'); assert.equal(w.cleared(), 1);
  assert.equal(w.records[0][0], 'cleareffects');
});
test('role loss and an expiring pass revoke protection and visibility', () => {
  for (const reason of ['role','pass','actor']) {
    const w = setup(); w.run('/godmode', ['on']); w.run('/invisible', ['on']);
    if (reason === 'role') w.tester(false);
    if (reason === 'pass') w.context.__thornswoodPassSeen.passes[123].x = 1;
    if (reason === 'actor') w.rows.get(10).profileId = 789;
    w.tools.tick();
    assert.equal(w.rows.get(10).isGodMode, false);
    assert.equal(w.rows.get(10).thornswoodStaffVisible.invisible, false);
  }
});
test('a new freeze revokes active flight', () => {
  const w = setup(); w.run('/fly', ['on']);
  w.context.__thornswoodStaffState.frozen[123] = {};
  w.tools.tick(); assert.equal(w.rows.get(10).thornswoodStaffTools.fly, false);
});
test('redraw failure after granting god mode revokes rather than orphaning privilege', () => {
  const w=setup();w.context.__thornswoodNeeds.godmodeChanged=()=>{throw Error('redraw unavailable');};
  w.run('/godmode',['on']);assert.equal(w.rows.get(10).isGodMode,false);
});
test('unreadable needs cannot prevent authority revocation', () => {
  const w=setup();w.run('/godmode',['on']);w.tester(false);
  w.context.__thornswoodNeeds.settle=()=>{throw Error('needs unavailable');};
  w.tools.tick();assert.equal(w.rows.get(10).isGodMode,false);
});
test('actor runtime reassignment and renewed passes have explicit mode lifecycles',()=>{
  const w=setup();w.run('/fly',['on']);
  w.context.__thornswoodPassSeen.passes[123].x+=60000;w.tools.tick();
  assert.equal(w.rows.get(10).thornswoodStaffTools.until,w.context.__thornswoodPassSeen.passes[123].x);
  w.rows.get(10).npc.runtimeLifeIdentity='actor-10-life-2';w.tools.tick();
  assert.equal(w.rows.get(10).thornswoodStaffTools.fly,false);
});
function npc(pos, extra = {}) {
  return {profileId: -1, pos, worldOrCellDesc:'3c:Skyrim.esm', isDead:false,
    npc: Object.assign({profileId:-1,isHuman:false,isConnected:false,isServerControlled:true,
      isEssential:false,isProtected:false,isUnique:false,isDead:false,isDisabled:false,
      aggression:2,pos,cellOrWorld:60},extra)};
}
test('killall excludes people, protected, unique, distant, peaceful and unreadable actors', () => {
  const w = setup();
  w.rows.set(30,npc([100,0,0]));
  w.rows.set(31,npc([100,0,0],{isEssential:true}));
  w.rows.set(32,npc([100,0,0],{isProtected:true}));
  w.rows.set(33,npc([100,0,0],{isUnique:true}));
  w.rows.set(34,npc([2000,0,0]));
  w.rows.set(35,npc([100,0,0],{aggression:0}));
  w.rows.set(36,npc([100,0,0],{profileId:99}));
  w.rows.set(37,npc([100,0,0],{isHuman:true}));
  w.rows.set(38,npc([100,0,0],{isServerControlled:false}));
  w.rows.set(39,npc([100,0,0],{isUnique:undefined}));
  w.run('/killall');
  assert.deepEqual(w.writes.filter(x => x.name === 'isDead').map(x => x.id), [30]);
  assert.equal(w.records[0][0], 'killall');
});
test('killall processes at most forty eligible targets in deterministic range order', () => {
  const w = setup(); for(let i=0;i<45;i++) w.rows.set(100+i,npc([i+1,0,0]));
  w.run('/killall'); assert.equal(w.writes.filter(x => x.name === 'isDead').length, 40);
});
test('native property changes run once, with no browser-message/native-name bridge', () => {
  const w = setup(), calls = [], state = {};
  const sp = {storage:{},Debug:{toggleCollisions:()=>calls.push('collision'),setGodMode:v=>calls.push('god:'+v)},
    Game:{getPlayer:()=>({})},printConsole:msg=>calls.push(msg)};
  const ctx = {value:{fly:true,godmode:true,seq:1,run:'test-run',until:Date.now()+60000},state,sp};
  vm.runInNewContext(w.properties.thornswoodStaffTools.updateOwner,{ctx});
  vm.runInNewContext(w.properties.thornswoodStaffTools.updateOwner,{ctx});
  assert.deepEqual(calls,['collision','god:true']);
  ctx.value = {fly:false,godmode:false,seq:2,run:'test-run',until:Date.now()+60000};
  vm.runInNewContext(w.properties.thornswoodStaffTools.updateOwner,{ctx});
  assert.deepEqual(calls,['collision','god:true','collision','god:false']);
  const alpha = [], neighbor = {value:{invisible:true,seq:1,run:'test-run',until:Date.now()+60000},state:{},
    sp:{Actor:{from:x=>x},printConsole:()=>{}},refr:{setAlpha:v=>alpha.push(v)}};
  vm.runInNewContext(w.properties.thornswoodStaffVisible.updateNeighbor,{ctx:neighbor});
  vm.runInNewContext(w.properties.thornswoodStaffVisible.updateNeighbor,{ctx:neighbor});
  assert.deepEqual(alpha,[0]);
});
test('saved modes from another server run and expired passes cannot grant native modes',()=>{
  const w=setup(),calls=[];
  const ctx={value:{fly:true,godmode:true,seq:10,run:'previous-run',until:Date.now()+60000},state:{},
    sp:{storage:{},Debug:{toggleCollisions:()=>calls.push('flight'),setGodMode:v=>calls.push(v)},printConsole:()=>{}}};
  vm.runInNewContext(w.properties.thornswoodStaffTools.updateOwner,{ctx});assert.deepEqual(calls,[false]);
  ctx.value={fly:true,godmode:true,seq:11,run:'test-run',until:Date.now()+60000};
  vm.runInNewContext(w.properties.thornswoodStaffTools.updateOwner,{ctx});assert.deepEqual(calls,[false,'flight',true]);
  ctx.value.until=1;
  vm.runInNewContext(w.properties.thornswoodStaffTools.updateOwner,{ctx});assert.deepEqual(calls,[false,'flight',true,'flight',false]);
});
test('reload withdraws every reachable mode before surfacing an unreadable actor', () => {
  const w=setup();
  w.rows.set(20,{profileId:456,pos:[0,0,0],angle:[0,0,0],worldOrCellDesc:'3c:Skyrim.esm',
    isDead:false,isGodMode:false,npc:{runtimeLifeIdentity:'actor-20-life-1'}});
  w.context.__thornswoodPassSeen.passes[456]={x:Date.now()+60000};
  w.run('/godmode',['on']);w.run('/godmode',['on'],{proven:true},456,20);
  assert.equal(w.rows.get(20).isGodMode,true);
  w.rows.delete(10);
  assert.throws(()=>w.tools.shutdown());
  assert.equal(w.rows.get(20).isGodMode,false);
});
console.log(checks + ' behavioral checks passed');
