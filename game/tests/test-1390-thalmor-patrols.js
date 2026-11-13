// test-1390-thalmor-patrols.js
//
// #1390. Thalmor patrols: 2 to 4 on a road between holds, never inside a
// walled city, at most 3 patrols in the province and one on a road
// (docs/systems/thalmor.md). Which roads, how many, how long a return takes
// and whether any patrol is out are staff settings in
// game/data/thalmor-patrols.json. The NPC population policy gives a patrol
// member its road's rule; the patrol keeper stands up the missing members
// once at start, with no timer, and takes down the members of a road staff
// turned off.
//
// Read only. Runs the real policy section and the real keeper block against
// stand-ins for the engine, the disk and the runtime.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const gm = fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'), 'utf8').split('\r\n').join('\n');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function between(a, b) {
  const i = gm.indexOf(a);
  const j = i < 0 ? -1 : gm.indexOf(b, i + a.length);
  return i < 0 || j < 0 ? null : gm.slice(i, j + b.length);
}

const POLICY = between('// NPC POPULATION POLICY BEGIN', '// NPC POPULATION POLICY END');
const KEEPER = between('// ==== thornswood thalmor patrols ====', '// ==== end thornswood thalmor patrols ====');
const STARTUP = between('// NPC SERVER STARTUP BEGIN', '// NPC SERVER STARTUP END');
yes('the policy section, the patrol keeper and the NPC startup are in the gamemode', !!POLICY && !!KEEPER && !!STARTUP);
yes('the keeper comes after the NPC startup, so the population it admits into exists',
    gm.indexOf('// ==== thornswood thalmor patrols ====') > gm.indexOf('// NPC SERVER STARTUP END'));
yes('the startup hands the population the keeper\'s roads',
    /patrols:\(\)=>globalThis\.__thornswoodThalmorPatrols/.test(STARTUP));

const dataText = fs.readFileSync(path.join(ROOT, 'game', 'data', 'thalmor-patrols.json'), 'utf8');
yes('thalmor-patrols.json is UTF-8 without a BOM', dataText.charCodeAt(0) !== 0xFEFF);
const SHIPPED = JSON.parse(dataText);

const dataLine = gm.slice(gm.indexOf('const NPC_POPULATION_DATA = ') + 'const NPC_POPULATION_DATA = '.length);
const KEEP = JSON.parse(dataLine.slice(0, dataLine.indexOf('\n')).replace(/;\s*$/, '')).keep;

const policyCtx = { Math, JSON, Number, Array, Object, Set, Map, Error, Reflect, String, console };
vm.createContext(policyCtx);
vm.runInContext(POLICY + '\nglobalThis.T={thalmorPatrolTable,thalmorPatrolCap,createNpcPopulation,THALMOR_PATROL_WORLD};', policyCtx);
const { thalmorPatrolTable } = policyCtx.T;
const clone = o => JSON.parse(JSON.stringify(o));

// ------------------------------------------------------- the staff's file --

{
  const t = thalmorPatrolTable(SHIPPED, KEEP);
  yes('T1 as shipped the patrols are off: no road stands, none refused', t.on === false && t.roads.length === 0 && t.refused.length === 0);
  yes('T1 the shipped cap is the page\'s 3, return 45 minutes, leash 1536',
      SHIPPED.most === 3 && SHIPPED.returnMinutes === 45 && SHIPPED.leash === 1536);
  const on = clone(SHIPPED); on.on = true;
  const t2 = thalmorPatrolTable(on, KEEP);
  yes('T2 turned on: the Pale, Haafingar and Hjaalmarch roads stand, four each',
      t2.roads.map(r => r.id).join() === 'pale,haafingar,hjaalmarch' && t2.roads.every(r => r.points.length === 4) && t2.refused.length === 0);
  const pop = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'npc-population.json'), 'utf8'));
  const cut = pop.npcs.filter(n => /remnant patrols are not placed here/.test(n.reason) && n.world === '3c:Skyrim.esm');
  const near = (p, n) => Math.abs(p[0] - n.pos[0]) < 1 && Math.abs(p[1] - n.pos[1]) < 1 && Math.abs(p[2] - n.pos[2]) < 1;
  yes('T2 every point is a cut Immersive Patrols II Justiciar placement in Tamriel, with that placement\'s own record',
      SHIPPED.roads.every(r => r.points.every((p, i) => cut.some(n => near(p, n) && n.base === r.bases[i] && n.name === 'Thalmor Justiciar'))));
}
{
  const on = clone(SHIPPED); on.on = true;
  const four = clone(on.roads[0]); four.id = 'fourth'; on.roads.push(four);
  // the fourth is the Pale's points again; that only matters for the cap here
  const t = thalmorPatrolTable(on, KEEP);
  yes('T3 a fourth road that is on is refused over the province cap of 3',
      t.roads.length === 3 && t.refused.length === 1 && t.refused[0].id === 'fourth' && /province cap of 3/.test(t.refused[0].why));
  on.most = 2;
  yes('T3 staff lower the cap to 2: two roads stand', thalmorPatrolTable(on, KEEP).roads.length === 2);
  on.most = 3; on.roads[1].on = false;
  const t3 = thalmorPatrolTable(on, KEEP);
  yes('T3 a road staff turn off does not stand and does not count against the cap',
      t3.roads.map(r => r.id).join() === 'pale,hjaalmarch,fourth');
}
{
  const base = clone(SHIPPED); base.on = true;
  const one = clone(base); one.roads[0].points = one.roads[0].points.slice(0, 1); one.roads[0].bases = one.roads[0].bases.slice(0, 1);
  const five = clone(base); five.roads[0].points.push([1, 2, 3]); five.roads[0].bases.push(five.roads[0].bases[0]);
  const world = clone(base); world.roads[0].world = '1a26f:Skyrim.esm';
  const dup = clone(base); dup.roads[1].id = 'pale';
  const bases = clone(base); bases.roads[0].bases = bases.roads[0].bases.slice(0, 2);
  const why = (doc) => { const t = thalmorPatrolTable(doc, KEEP); return t.refused.map(r => r.id + ': ' + r.why).join(' | '); };
  yes('T4 a patrol of one is refused', /pale: needs 2 to 4 points/.test(why(one)));
  yes('T4 a patrol of five is refused', /pale: needs 2 to 4 points/.test(why(five)));
  yes('T4 a road off Tamriel\'s ground (a city worldspace) is refused', /pale: is not on Tamriel/.test(why(world)));
  yes('T4 two roads with one id: the second is refused', /pale: needs an id of its own/.test(why(dup)));
  yes('T4 a point without its record is refused', /pale: needs one base/.test(why(bases)));
  const town = KEEP.find(r => r[7] === 'city' && r[2] === '3c:Skyrim.esm');
  const walled = clone(base); walled.roads[2].points[0] = [town[3][0] + 500, town[3][1] - 500, town[3][2]];
  yes('T4 a point beside a town\'s kept placements is refused', /hjaalmarch: has a point in or beside a walled town/.test(why(walled)));
  const throwsOn = doc => { try { thalmorPatrolTable(doc, KEEP); return false; } catch (e) { return true; } };
  yes('T4 a file that is not version 1, or has a setting out of range, is thrown out whole',
      throwsOn(Object.assign(clone(base), { version: 2 })) && throwsOn(Object.assign(clone(base), { most: 11 })) &&
      throwsOn(Object.assign(clone(base), { returnMinutes: 0 })) && throwsOn(Object.assign(clone(base), { on: 'yes' })) &&
      throwsOn(null));
}

// ------------------------------------------------------------ the engine --

function engine() {
  const ids = new Map(), descs = new Map(), props = new Map();
  let nextDesc = 0x100, nextRef = 0xff000100;
  const e = {
    placed: [], removed: [], disabled: [],
    getIdFromDesc(d) { if (!ids.has(d)) { ids.set(d, nextDesc); descs.set(nextDesc, d); nextDesc++; } return ids.get(d); },
    getDescFromId(id) { if (descs.has(id)) return descs.get(id); return (id >>> 0).toString(16) + ':Runtime'; },
    makeProperty() {},
    get(id, key) {
      if (!props.has(id)) throw new Error('Form ' + id.toString(16) + ' not found');
      return props.get(id)[key];
    },
    set(id, key, value) {
      if (!props.has(id)) throw new Error('Form ' + id.toString(16) + ' not found');
      props.get(id)[key] = value;
      if (key === 'isDisabled' && value) e.disabled.push(id);
    },
    place(baseId) {
      const id = nextRef++;
      props.set(id, { baseDesc: descs.get(baseId) });
      e.placed.push(id);
      return id;
    },
    getNpcAIState(id) {
      const p = props.get(id);
      return { isHuman: false, pos: p.locationalData.pos.slice(), cellOrWorld: e.getIdFromDesc(p.locationalData.cellOrWorldDesc) };
    },
    destroyActor(id) { props.delete(id); },
    setNpcServerControlled() {},
    callPapyrusFunction() {},
    getServerSettings() { return { privDir: 'priv' }; },
    exists: id => props.has(id),
    props
  };
  return e;
}

function memoryDisk(files) {
  return {
    readFileSync(p) {
      const k = String(p).split('\\').join('/');
      if (!Object.prototype.hasOwnProperty.call(files, k)) { const er = new Error('ENOENT ' + k); er.code = 'ENOENT'; throw er; }
      return files[k];
    },
    writeFileSync(p, text) { files[String(p).split('\\').join('/')] = String(text); },
    renameSync(a, b) { a = String(a).split('\\').join('/'); b = String(b).split('\\').join('/'); files[b] = files[a]; delete files[a]; },
    mkdirSync() {}
  };
}

const DATA_FILE = 'gm/data/thalmor-patrols.json';
const REG_FILE = 'priv/thalmor-patrol-slots.json';

// One server: the engine survives restarts (its saved forms), the disk too.
function server(files) {
  const mp = engine();
  const logs = [];
  const ctx = {
    mp, console: { log: line => logs.push(String(line)) }, Math, JSON, Number, Array, Object, Set, Map, Error, Reflect, String, parseInt,
    __dirname: 'gm',
    require: name => name === 'fs' ? memoryDisk(files) : name === 'path' ? path.posix : require(name),
    setTimeout: (f) => f()
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(POLICY + '\nconst NPC_POPULATION_DATA={version:1,plugins:["Skyrim.esm"],keep:[]};', ctx);
  let discarded = [];
  ctx.removeSpawned = id => { mp.removed.push(id); try { ctx.__thornswoodNpcPopulation.release(id); } catch (e) {} mp.destroyActor(id); return true; };
  // a start: a new population, the way the NPC startup makes one, then the keeper
  function start() {
    vm.runInContext('globalThis.__thornswoodNpcPopulation=createNpcPopulation(mp,NPC_POPULATION_DATA,["Skyrim.esm"],null,' +
      '{run:"r",discard:id=>{globalThis.__discarded.push(id);removeSpawned(id);},patrols:()=>globalThis.__thornswoodThalmorPatrols});' +
      'globalThis.__enrolled=[];globalThis.__thornswoodNpcRuntime={enroll:id=>globalThis.__enrolled.push(id)};', Object.assign(ctx, { __discarded: discarded }));
    const before = mp.placed.length;
    logs.length = 0;
    vm.runInContext(KEEPER, ctx);
    return { made: mp.placed.slice(before), logs: logs.slice() };
  }
  // the runtime's discovery: every saved form is asked about at a start
  function discover() {
    const out = [];
    for (const id of mp.props.keys()) out.push([id, ctx.__thornswoodNpcPopulation.configure(id, mp.getNpcAIState(id))]);
    return out;
  }
  return { mp, ctx, start, discover, discarded, logs };
}

function withFile(doc) { const files = {}; files[DATA_FILE] = JSON.stringify(doc); return files; }

{
  const files = withFile(SHIPPED);
  const s = server(files);
  const r = s.start();
  yes('K1 as shipped (off) nothing is stood up and no register is written', r.made.length === 0 && !(REG_FILE in files));
  yes('K1 the keeper says it is off', r.logs.some(l => /\[patrols\] off - stage \(none\) cap 3 - 0 road\(s\)/.test(l)));
}

const ON = clone(SHIPPED); ON.on = true;
{
  const files = withFile(ON);
  const s = server(files);
  const r = s.start();
  const reg = JSON.parse(files[REG_FILE]);
  yes('K2 turned on: twelve members, four on each of three roads', r.made.length === 12 &&
      ['pale', 'haafingar', 'hjaalmarch'].every(k => Object.keys(reg.roads[k] || {}).length === 4));
  const first = s.mp.props.get(parseInt(reg.roads.pale['0'], 16));
  yes('K2 a member stands at its own point in Tamriel, made from that point\'s record, marked with its road and slot',
      first.locationalData.cellOrWorldDesc === '3c:Skyrim.esm' &&
      JSON.stringify(first.locationalData.pos) === JSON.stringify(ON.roads[0].points[0]) &&
      first.baseDesc === ON.roads[0].bases[0] && first.thornswoodNpcPatrol.road === 'pale' && first.thornswoodNpcPatrol.slot === 0);
  yes('K2 the policy gave it the road\'s rule: home at its point, return 45 minutes, the road\'s leash, never the commanded marker',
      first.spawnDelay === 45 * 60 && JSON.stringify(first.spawnPoint.pos) === JSON.stringify(ON.roads[0].points[0]) &&
      first.thornswoodNpcHome.source === 'patrol:pale' && first.thornswoodNpcCommanded === undefined && !first.isDisabled);
  yes('K2 every member is enrolled in the shared runtime', s.ctx.__enrolled.length === 12);
  yes('K2 the register names nobody: road, slot and a form id only',
      !/profile|name|actor/i.test(files[REG_FILE].replace(/"version"/, '')));

  // a restart: the saved forms are discovered, the keeper runs again
  const again = s.start();
  const seen = s.discover();
  yes('K3 a restart stands up nothing new and discards nothing', again.made.length === 0 && s.discarded.length === 0 && seen.every(([, p]) => !!p));
  yes('K3 a restart discovers the twelve and gives each its point as home',
      seen.length === 12 && seen.every(([id, p]) => JSON.stringify(p.home) === JSON.stringify(s.mp.props.get(id).thornswoodNpcPatrol && ON.roads.find(x => x.id === s.mp.props.get(id).thornswoodNpcPatrol.road).points[s.mp.props.get(id).thornswoodNpcPatrol.slot])));

  // a dead member is still a form: it comes back by itself, so nothing is added
  const deadId = parseInt(reg.roads.haafingar['1'], 16);
  s.mp.props.get(deadId).isDead = true;
  yes('K4 a dead member waiting to return is not replaced', s.start().made.length === 0);

  // a member that is gone (deleted, or a wiped world) is replaced in its own slot only
  const goneId = parseInt(reg.roads.hjaalmarch['2'], 16);
  s.mp.destroyActor(goneId);
  const r5 = s.start();
  const reg5 = JSON.parse(files[REG_FILE]);
  yes('K5 a member that is gone is replaced, once, in its own slot',
      r5.made.length === 1 && reg5.roads.hjaalmarch['2'] === r5.made[0].toString(16) &&
      s.mp.props.get(r5.made[0]).thornswoodNpcPatrol.slot === 2);

  // a second form claiming a filled slot (a lost register) is discarded at discovery
  const intruder = s.mp.place(s.mp.getIdFromDesc(ON.roads[0].bases[0]));
  s.mp.set(intruder, 'locationalData', { cellOrWorldDesc: '3c:Skyrim.esm', pos: ON.roads[0].points[0].slice(), rot: [0, 0, 0] });
  s.mp.set(intruder, 'thornswoodNpcPatrol', { road: 'pale', slot: 0 });
  s.discover();
  yes('K6 a second form claiming a slot already filled is taken out of the world', s.discarded.includes(intruder) && !s.mp.exists(intruder));

  // a slot past the road's points is discarded too
  const stray = s.mp.place(s.mp.getIdFromDesc(ON.roads[0].bases[0]));
  s.mp.set(stray, 'locationalData', { cellOrWorldDesc: '3c:Skyrim.esm', pos: ON.roads[0].points[0].slice(), rot: [0, 0, 0] });
  s.mp.set(stray, 'thornswoodNpcPatrol', { road: 'pale', slot: 7 });
  s.discover();
  yes('K6 a member of a slot past the road\'s points is taken out of the world', s.discarded.includes(stray));

  // staff turn the Pale road off
  const paleIds = Object.values(JSON.parse(files[REG_FILE]).roads.pale).map(h => parseInt(h, 16));
  const off = clone(ON); off.roads[0].on = false;
  files[DATA_FILE] = JSON.stringify(off);
  const r7 = s.start();
  const reg7 = JSON.parse(files[REG_FILE]);
  yes('K7 a road staff turn off loses its four members at the next start, and the others stay',
      r7.made.length === 0 && paleIds.every(id => s.mp.removed.includes(id) && !s.mp.exists(id)) && !reg7.roads.pale &&
      Object.keys(reg7.roads.haafingar).length === 4 && Object.keys(reg7.roads.hjaalmarch).length === 4);

  // staff change a point's record: that member is replaced by one of the new record
  const swapped = clone(off); swapped.roads[1].bases[3] = swapped.roads[1].bases[0];
  files[DATA_FILE] = JSON.stringify(swapped);
  const oldId = parseInt(reg7.roads.haafingar['3'], 16);
  const r8 = s.start();
  yes('K8 a point whose record staff changed gets a member of the new record, and the old one is taken down',
      r8.made.length === 1 && s.mp.removed.includes(oldId) && s.mp.props.get(r8.made[0]).baseDesc === swapped.roads[1].bases[0]);

  // the file breaks: nothing is taken down, nothing stood up, nothing written
  const before = files[REG_FILE];
  const removedBefore = s.mp.removed.length;
  const standing = [...s.mp.props.keys()].length;
  files[DATA_FILE] = '{ not json';
  const r9 = s.start();
  const seen9 = s.discover();
  yes('K9 an unreadable file stands nobody up, takes nobody down and writes nothing',
      r9.made.length === 0 && files[REG_FILE] === before && [...s.mp.props.keys()].length === standing &&
      r9.logs.some(l => /would not read, so no patrol is stood up or taken down/.test(l)));
  yes('K9 with no readable file a member is only switched off, never deleted', seen9.every(([, p]) => p === null) && s.mp.removed.length === removedBefore);

  // the register breaks: same
  files[DATA_FILE] = JSON.stringify(ON);
  files[REG_FILE] = 'garbage';
  const r10 = s.start();
  yes('K10 an unreadable register changes nothing and is not written over', r10.made.length === 0 && files[REG_FILE] === 'garbage');
}

// #2873: on a server the gamemode runs from a temp copy with no data folder
// beside it, so the file is never there. STAFF_DATA, built into gamemode.js
// by scripts\dev\Build-StaffData.js, carries it instead.
{
  const files = {};
  const s = server(files);
  s.ctx.STAFF_DATA = { 'thalmor-patrols.json': clone(ON) };
  const r = s.start();
  yes('K2b with no data folder (the server), STAFF_DATA stands the patrols up: twelve members',
      r.made.length === 12 && !r.logs.some(l => /would not read/.test(l)));
  yes('K2b the keeper never opened game/data for the file', !(DATA_FILE in files));
}
{
  const files = {};
  const s = server(files);
  const r = s.start();
  yes('K2c with no data folder and no STAFF_DATA it says the file would not read and stands nobody up',
      r.made.length === 0 && r.logs.some(l => /would not read, so no patrol is stood up or taken down/.test(l)));
}

{
  // the policy's own province cap holds even if a table had more roads than its cap
  const s = server(withFile(ON));
  s.start();
  const t = s.ctx.__thornswoodThalmorPatrols;
  const extra = clone(t.roads[0]); extra.id = 'extra';
  t.roads.push(extra);
  const id = s.mp.place(s.mp.getIdFromDesc(extra.bases[0]));
  s.mp.set(id, 'locationalData', { cellOrWorldDesc: '3c:Skyrim.esm', pos: extra.points[0].slice(), rot: [0, 0, 0] });
  s.mp.set(id, 'thornswoodNpcPatrol', { road: 'extra', slot: 0 });
  s.ctx.__thornswoodNpcPopulation.configure(id, s.mp.getNpcAIState(id));
  yes('P1 a fourth road\'s member is refused by the policy\'s province cap of 3', s.discarded.includes(id));
  // an unmarked runtime NPC is still switched off as before
  const plain = s.mp.place(s.mp.getIdFromDesc('2b35e:Skyrim.esm'));
  s.mp.set(plain, 'locationalData', { cellOrWorldDesc: '3c:Skyrim.esm', pos: [0, 0, 0], rot: [0, 0, 0] });
  const pol = s.ctx.__thornswoodNpcPopulation.configure(plain, s.mp.getNpcAIState(plain));
  yes('P2 a runtime NPC with neither marker is still switched off, not discarded', pol === null && s.mp.props.get(plain).isDisabled === true && !s.discarded.includes(plain));
  // releasing a member frees its slot for a replacement
  const reg = JSON.parse(s.ctx.require('fs').readFileSync(REG_FILE));
  const m = parseInt(reg.roads.pale['1'], 16);
  s.ctx.__thornswoodNpcPopulation.release(m);
  s.mp.destroyActor(m);
  const n = s.mp.place(s.mp.getIdFromDesc(t.roads[0].bases[1]));
  s.mp.set(n, 'locationalData', { cellOrWorldDesc: '3c:Skyrim.esm', pos: t.roads[0].points[1].slice(), rot: [0, 0, 0] });
  s.mp.set(n, 'thornswoodNpcPatrol', { road: 'pale', slot: 1 });
  yes('P3 a released slot takes its replacement', !!s.ctx.__thornswoodNpcPopulation.configure(n, s.mp.getNpcAIState(n)));
}

// ------------------------------------------------ the cap for each stage (#2697) --

{
  const doc = clone(ON); doc.stageMost = { peace: 1, war: 3 };
  yes('S1 as shipped stageMost is empty, so the cap is most at every stage',
      JSON.stringify(SHIPPED.stageMost) === '{}' && thalmorPatrolTable(ON, KEEP, 'peace').roads.length === 3);
  yes('S1 with no stage (no world stage register) the cap is the plain most',
      thalmorPatrolTable(doc, KEEP).roads.length === 3 && thalmorPatrolTable(doc, KEEP, null).stage === null);
  const t = thalmorPatrolTable(doc, KEEP, 'peace');
  yes('S2 a stage staff gave a cap of 1 lets one road stand, the first in the file, and refuses the rest over that cap',
      t.stage === 'peace' && t.roads.map(r => r.id).join() === 'pale' &&
      t.refused.length === 2 && t.refused.every(r => /province cap of 1/.test(r.why)));
  yes('S3 a stage with no entry keeps most', thalmorPatrolTable(doc, KEEP, 'siege').roads.length === 3);
  const zero = clone(doc); zero.stageMost.truce = 0;
  yes('S3 a stage with a cap of 0 has no patrol', thalmorPatrolTable(zero, KEEP, 'truce').roads.length === 0);
  const throwsOn = d => { try { thalmorPatrolTable(d, KEEP, 'peace'); return false; } catch (e) { return true; } };
  yes('S4 a stageMost out of range, with a bad id, or not an object is thrown out whole',
      throwsOn(Object.assign(clone(ON), { stageMost: { peace: 11 } })) && throwsOn(Object.assign(clone(ON), { stageMost: { 'Open War': 1 } })) &&
      throwsOn(Object.assign(clone(ON), { stageMost: [1] })) && throwsOn(Object.assign(clone(ON), { stageMost: { peace: 1.5 } })));
}
{
  const doc = clone(ON); doc.stageMost = { peace: 1, war: 3 };
  const files = withFile(doc);
  const s = server(files);
  const r0 = s.start();
  yes('K11 with no world stage register the keeper uses most: twelve stand', r0.made.length === 12 &&
      r0.logs.some(l => /stage \(none\) cap 3 - 3 road\(s\)/.test(l)));
  let asked = 0;
  s.ctx.__thornswoodWorldStage = { worldStage: () => { asked++; return { id: 'peace', name: 'Peace', text: '', force: '', since: 1, by: 'staff' }; },
    setWorldStage: () => { throw new Error('the keeper must not move the world'); } };
  const r1 = s.start();
  const reg1 = JSON.parse(files[REG_FILE]);
  yes('K12 staff confirmed peace (cap 1): at the next start the two roads past the cap lose their members',
      r1.made.length === 0 && Object.keys(reg1.roads).join() === 'pale' && s.mp.removed.length === 8 &&
      r1.logs.some(l => /stage peace cap 1 - 1 road\(s\)/.test(l)) && asked === 1);
  const seen = s.discover();
  yes('K12 the policy agrees: the four on the Pale are admitted at that start', seen.filter(([, p]) => !!p).length === 4);
  s.ctx.__thornswoodWorldStage.worldStage = () => ({ id: 'war' });
  const r2 = s.start();
  yes('K13 the world moves to war (cap 3): the next start stands the other two roads up again', r2.made.length === 8 &&
      Object.keys(JSON.parse(files[REG_FILE]).roads).length === 3);
  s.ctx.__thornswoodWorldStage.worldStage = () => { throw new Error('register broken'); };
  const regText = files[REG_FILE];
  const r3 = s.start();
  yes('K14 a register that throws stands nobody up, takes nobody down and writes nothing',
      r3.made.length === 0 && s.mp.removed.length === 8 && files[REG_FILE] === regText && s.discarded.length === 0);
  yes('K14 it says so once, and never falls back to most',
      r3.logs.filter(l => /world stage register failed \(register broken\), so no patrol is stood up or taken down/.test(l)).length === 1 &&
      !r3.logs.some(l => /cap 3/.test(l)) && s.ctx.__thornswoodThalmorPatrols.hold === true);
  const seen3 = s.discover();
  yes('K14 the population keeps the twelve that stand, admitted, none discarded or switched off',
      seen3.filter(([, p]) => !!p).length === 12 && s.discarded.length === 0);
  s.ctx.__thornswoodWorldStage = { worldStage: () => ({ id: 'siege' }) };
  yes('K14 a stage with no entry keeps most', s.start().made.length === 0 && s.mp.removed.length === 8);
}
{
  // Codex's case (#2698 review, finding 1): a stage cap of 0, then the register throws
  const doc = clone(ON); doc.stageMost = { truce: 0, war: 1 };
  const files = withFile(doc);
  const s = server(files);
  s.ctx.__thornswoodWorldStage = { worldStage: () => ({ id: 'truce' }) };
  const r0 = s.start();
  yes('K15 at a stage with a cap of 0 nobody stands', r0.made.length === 0 && r0.logs.some(l => /stage truce cap 0 - 0 road\(s\)/.test(l)));
  s.ctx.__thornswoodWorldStage.worldStage = () => { throw new Error('war.json lost'); };
  const r1 = s.start();
  yes('K15 the register then throws: the cap does not come back as 3, nobody is stood up',
      r1.made.length === 0 && !(REG_FILE in files) && r1.logs.some(l => /world stage register failed \(war\.json lost\)/.test(l)));
  s.ctx.__thornswoodWorldStage.worldStage = () => ({ id: 'war' });
  const r2 = s.start();
  yes('K15 at a stage with a cap of 1, one road stands', r2.made.length === 4);
  s.ctx.__thornswoodWorldStage.worldStage = () => { throw new Error('again'); };
  const r3 = s.start();
  const seen = s.discover();
  yes('K15 the register throws at a cap of 1: still one road, its four admitted, nobody new',
      r3.made.length === 0 && s.mp.removed.length === 0 && seen.filter(([, p]) => !!p).length === 4 &&
      Object.keys(JSON.parse(files[REG_FILE]).roads).length === 1);
}
{
  // finding 2: stage ids are 1 to 32 of a-z, 0-9 and dash, the rule #2685's stage list
  // now uses as well (Wyrd's change on #2685). The two rules must stay matched.
  const id32 = 'a'.repeat(32), id33 = 'a'.repeat(33);
  const ok = d => { try { thalmorPatrolTable(d, KEEP, id32); return true; } catch (e) { return false; } };
  yes('S5 a stageMost key of 32 characters is a stage id and its cap is used',
      ok(Object.assign(clone(ON), { stageMost: { [id32]: 1 } })) &&
      thalmorPatrolTable(Object.assign(clone(ON), { stageMost: { [id32]: 1 } }), KEEP, id32).roads.length === 1);
  yes('S5 a key of 33 characters, or empty, is not a stage id and throws the file out',
      !ok(Object.assign(clone(ON), { stageMost: { [id33]: 1 } })) && !ok(Object.assign(clone(ON), { stageMost: { '': 1 } })));
}
{
  // finding 3: a stageMost key that names no stage is logged once at start, never refused
  const doc = clone(ON); doc.stageMost = { peace: 1, wra: 2 };
  const s = server(withFile(doc));
  const r0 = s.start();
  yes('U1 with no world stage register nothing is said about the keys', !r0.logs.some(l => /stageMost names/.test(l)));
  s.ctx.__thornswoodWorldStage = { worldStage: () => ({ id: 'peace' }), stages: () => [{ id: 'peace' }, { id: 'war' }] };
  const r1 = s.start();
  const named = r1.logs.filter(l => /stageMost names/.test(l));
  yes('U1 a key the stage list does not have (a typo) is logged once, by name, and only that one',
      named.length === 1 && /stageMost names wra but the world stage list has no such stage/.test(named[0]));
  yes('U1 it is logged, not refused: the file still stands, at peace\'s cap of 1',
      r1.logs.some(l => /stage peace cap 1 - 1 road\(s\)/.test(l)));
  s.ctx.__thornswoodWorldStage = { worldStage: () => ({ id: 'peace' }) };
  yes('U1 a register with no stage list logs nothing about the keys', !s.start().logs.some(l => /stageMost names/.test(l)));
  s.ctx.__thornswoodWorldStage = { worldStage: () => ({ id: 'peace' }), stages: () => { throw new Error('x'); } };
  yes('U1 a stage list that throws logs nothing about the keys and changes nothing',
      (r => !r.logs.some(l => /stageMost names/.test(l)) && r.made.length === 0)(s.start()));
}
yes('N3 the keeper reads the world stage register through worldStage() and stages() only, once, and never moves it',
    (KEEPER.match(/__thornswoodWorldStage/g) || []).length === 1 && /reg\.worldStage\(\)/.test(KEEPER) && /reg\.stages\(\)/.test(KEEPER) &&
    !/setWorldStage\(|proposeWorldStage\(|confirmWorldStage\(|dropWorldStageProposal\(/.test(KEEPER));

// ------------------------------------------------------- what it never does --

yes('N1 the keeper sets no timer and adds no command', !/setTimeout|setInterval|onChat|registerCommand|'\/[a-z]+/.test(KEEPER));
yes('N2 the keeper does not use the commanded marker', !/thornswoodNpcCommanded/.test(KEEPER));
const gx = fs.readFileSync(path.join(ROOT, 'tests', 'gate-excluded.txt'), 'utf8');
yes('W1 this harness is on the build gate (not in tests/gate-excluded.txt, #3009)', !/^game\/tests\/test-1390-thalmor-patrols\.js\s/m.test(gx));
const served = fs.readFileSync(path.join(ROOT, 'game', 'tests', 'test-2582-nothing-personal-served.js'), 'utf8');
yes('W2 thalmor-patrols.json is on the list of shipped data that names nobody', served.includes("'thalmor-patrols.json'"));
const page = fs.readFileSync(path.join(ROOT, 'docs', 'systems', 'thalmor.md'), 'utf8').replace(/\s+/g, ' ');
yes('W3 the Thalmor page says where the patrols are and that staff turn them on',
    page.includes('game/data/thalmor-patrols.json') && !page.includes('No patrol is spawned by the server yet'));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
