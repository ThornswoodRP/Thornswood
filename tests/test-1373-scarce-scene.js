'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const gmPath = path.join(root, 'game', 'gamemode.js');
const pagePath = path.join(root, 'docs', 'systems', 'quests.md');
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(gmPath, 'utf8')).replace(/\r/g, '');
const page = fs.readFileSync(pagePath, 'utf8').replace(/\r/g, '');
const startMark = '// ==== thornswood custom quests ====';
const endMark = '// ==== end thornswood custom quests ====';
const start = gm.indexOf(startMark);
const end = gm.indexOf(endMark);
if (start < 0 || end < 0 || end < start) {
  console.log('FAIL custom quest block is not in gamemode.js');
  process.exit(1);
}

function firstNumber(text) {
  const found = String(text).match(/(\d+)/);
  return found ? Number(found[1]) : null;
}
function hoursOf(text) {
  const found = String(text).match(/(\d+)\s+hours?/);
  return found ? Number(found[1]) : null;
}
function tables(md) {
  let mode = null;
  const scarce = [];
  const scene = [];
  md.split('\n').forEach(function (line) {
    if (line.indexOf('| Quest | Who |') === 0) mode = 'scarce';
    else if (line.indexOf('| Quest | What the server checks |') === 0) mode = 'scene';
    else if (line.indexOf('|') !== 0) mode = null;
    else if (line.indexOf('| ---') === 0) return;
    else if (mode) {
      const cells = line.split('|').slice(1, -1).map(function (cell) { return cell.trim(); });
      (mode === 'scarce' ? scarce : scene).push(cells);
    }
  });
  return { scarce: scarce, scene: scene };
}
function killCount(check) {
  if (!/^You kill/i.test(check)) return 0;
  return /three/i.test(check) ? 3 : 1;
}
function killMatch(check) {
  if (check.indexOf('sabre cat') >= 0) return 'sabre cat';
  if (check.indexOf('bandit') >= 0) return 'bandit';
  if (check.indexOf('draugr') >= 0) return 'draugr';
  if (check.indexOf('wolf') >= 0) return 'wolf';
  if (check.indexOf('bear') >= 0) return 'bear';
  if (check.indexOf('giant') >= 0) return 'giant';
  return null;
}

const doc = tables(page);
assert.equal(doc.scarce.length, 10, 'scarce table');
assert.equal(doc.scene.length, 13, 'scene table');

const block = gm.slice(start, end + endMark.length);
const ctx = {
  console: console, Map: Map, Set: Set, Date: Date, Math: Math, Number: Number,
  String: String, Buffer: Buffer, JSON: JSON, Object: Object, Array: Array,
  RegExp: RegExp, Error: Error
};
ctx.globalThis = ctx;
vm.createContext(ctx);
const eligibility = require('./quest-eligibility-fixture')(ctx, gm);
vm.runInContext(block, ctx);
const create = ctx.__thornswoodCustomQuestsCreate;
assert.equal(typeof create, 'function');

const docNames = doc.scarce.map(function (row) { return row[0]; })
  .concat(doc.scene.map(function (row) { return row[0]; }));
assert.ok(docNames.indexOf('Supply') < 0 && docNames.indexOf('A dragon') < 0);

function world(ranks) {
  const chosen = new Map();
  const population = require('../game/data/npc-population.json');
  const compact = {keep:population.npcs.filter(r=>r.keep).map(r=>[r.ref,r.base,r.world||r.cell,r.pos,r.leash,
    r.returnMinutes,r.role,r.habitat,r.tier,r.cap,r.populationBucket,0,r.species])};
  const bodies = new Map(), ids = new Map();
  compact.keep.forEach((r,i)=>{
    ids.set(r[0],i+100);
    bodies.set(i+100,{ref:r[0],base:r[1],world:r[2],pos:r[3].slice(),race:r[12]+'Race',
      profileId:-1,isHuman:false,isDead:false,isServerControlled:true,lifeGeneration:0,runtimeLifeIdentity:'100'});
  });
  const native = {getIdFromDesc:ref=>ids.get(ref),getDescFromId:id=>bodies.get(id).ref,
    getNpcAIState:id=>JSON.parse(JSON.stringify(bodies.get(id))),
    get:(id,key)=>key==='baseDesc'?bodies.get(id).base:key==='worldOrCellDesc'?bodies.get(id).world:undefined};
  const killContracts = require('../game/kill-contracts').createKillContracts({mp:native,population:compact,
    raceOf:id=>bodies.get(id).race,identity:actor=>'actor:'+actor});
  const inv = new Map();
  const adds = [];
  let purseTouches = 0;
  const purse = { touch: function () { purseTouches++; throw new Error('purse'); } };
  // Each person's quests are kept on the character (#1621).
  const kept = new Map();
  const svc = create({
    eligibility,
    readCharacter(actor) {
      const saved = {};
      Object.keys(ranks || {}).forEach(key => {if(key.startsWith(actor + ':')) saved[key.slice(String(actor).length + 1)] = ranks[key];});
      const cls = chosen.get(actor) || Object.keys(saved).find(key => Object.hasOwn(ctx.__thornswoodProgression.TABLE.classes, key)) || null;
      return {v:1,cls,prof:saved.bladebinder || saved.wardweaver ? 'enchanter' : null,ranks:saved};
    },
    now: function () { return clock; },
    goldDesc: 'f:Skyrim.esm',
    load: function (actor) { return kept.has(actor) ? JSON.parse(kept.get(actor)) : undefined; },
    save: function (actor, rec) { kept.set(actor, JSON.stringify(rec)); },
    identity: function (actor) {return 'actor:'+actor;},
    killContracts: killContracts,
    commit: function (actor, expected, next, changes) {
      assert.deepEqual(kept.has(actor)?JSON.parse(kept.get(actor)):null,expected);
      const pack=new Map(inv);
      for (const change of changes) {
        const key=actor+'|'+change.item,count=(pack.get(key)||0)+change.count;
        if(count<0)return {ok:false};
        pack.set(key,count);
      }
      for (const [key,count] of pack) inv.set(key,count);
      kept.set(actor,JSON.stringify(next));
      changes.filter(change=>change.count>0).forEach(change=>adds.push({actor,item:change.item,count:change.count}));
      return {ok:true};
    },
    addItem: function (actor, item, count) {
      const key = actor + '|' + item;
      inv.set(key, (inv.get(key) || 0) + count);
      adds.push({ actor: actor, item: item, count: count });
      return true;
    },
    takeItem: function (actor, item, count) {
      const key = actor + '|' + item;
      if ((inv.get(key) || 0) < count) return false;
      inv.set(key, inv.get(key) - count);
      return true;
    },
    creatureName: function (id) { return names[id] || ''; },
    cellOf: function (id) { return cells[id] || ''; },
    traderHold: function (id) { return holds[id] || ''; },
    debitPurse: function () { purseTouches++; throw new Error('purse'); },
    classGate: function () { return null; },
    toolGate: function () { return null; },
    mining: function () { return false; },
    stopMining: function () {},
    swinging: function () { return false; },
    toolIdIn: function () { return 1; },
    swing: function (actor, anim, done) { done(); },
    swingAnim: 'mine',
    notify: function () {},
    say: function () {},
    creditWork: function () { return null; },
    wearTool: function () { return null; }
  });
  return { svc: svc, inv: inv, adds: adds, purse: purse, bodies, ids, chooseClass:(actor,cls)=>chosen.set(actor,cls), touches: function () { return purseTouches; } };
}
let clock = 1000;
const names = {};
const cells = {};
const holds = {};
const box = world({
  '1:miner': 'master', '1:fisher': 'novice', '1:gatherer': 'novice',
  '1:hunter': 'master', '1:farmer': 'expert', '1:wardweaver': 'novice',
  '2:miner': 'advanced', '3:miner': 'master', '4:bladebinder': 'novice'
});
const svc = box.svc;
const line = svc.lineup();
assert.equal(line.supply, undefined);
assert.equal(typeof svc.supply, 'undefined');
assert.equal(JSON.stringify(line.scarce.map(function (row) { return row.name; })), JSON.stringify(doc.scarce.map(function (row) { return row[0]; })));
assert.equal(JSON.stringify(line.scene.map(function (row) { return row.name; })), JSON.stringify(doc.scene.map(function (row) { return row[0]; })));
doc.scarce.forEach(function (cellsRow, index) {
  const row = line.scarce[index];
  assert.equal(row.who, cellsRow[1], row.name);
  assert.equal(row.ask, firstNumber(cellsRow[2]), row.name);
  assert.equal(row.holds, firstNumber(cellsRow[3]), row.name);
  assert.equal(row.hours, hoursOf(cellsRow[4]), row.name);
});
doc.scene.forEach(function (cellsRow, index) {
  const row = line.scene[index];
  assert.equal(row.check, cellsRow[1], row.name);
  assert.equal(row.gold, Number(cellsRow[2]), row.name);
  assert.equal(row.hours, hoursOf(cellsRow[3]), row.name);
  assert.equal(row.count, killCount(cellsRow[1]), row.name);
  assert.equal(row.match, killMatch(cellsRow[1]), row.name);
  assert.equal(row.kind, killCount(cellsRow[1]) ? 'kill' : 'retrieval');
});
assert.ok(line.scene.every(function (row) { return row.gold !== 250; }));
assert.equal(svc.offer(1, 'supply').ok, false);

const ebony = line.scarce[0];
assert.equal(svc.offer(2, 'ebony').ok, false, 'advanced miner cannot take a master scarce quest');
assert.equal(svc.offer(1, 'heartstone').ok, true);
assert.equal(svc.mineRare(1, 'heart-a', { name: 'Heart Stone', ore: 'heart' }), 'This place is shut.');
svc.walkAway(1, 'heartstone');
assert.equal(svc.offer(1, 'gem').why, 'gem');
assert.equal(svc.offer(1, 'gem', { gem: 'Diamond' }).ok, false);
assert.equal(svc.offer(1, 'gem', { gem: 'Emerald' }).ok, true);
svc.bindPlace('gem', { cells: { Emerald: 'barrow-1' } });
cells['em-1'] = 'barrow-1';
cells['em-2'] = 'tower-1';
assert.equal(svc.mineRare(1, 'em-2', { name: 'Emerald', ore: 'em' }), 'This place is shut.');
assert.equal(svc.mineRare(1, 'em-1', { name: 'Ruby', ore: 'ruby' }), 'This place is shut.');
assert.equal(svc.mineRare(1, 'em-1', { name: 'Emerald', ore: 'em' }), '');
assert.equal(box.inv.get('1|em'), 1);
svc.walkAway(1, 'gem');
assert.equal(box.inv.get('1|em') || 0, 0);
assert.equal(svc.offer(1, 'gem', { gem: 'Emerald' }).ok, true, 'walking away does not start the cooldown');

assert.equal(svc.offer(1, ebony.id).ok, true);
assert.equal(svc.offer(1, ebony.id).why, 'open');
assert.equal(svc.offer(3, ebony.id).ok, true, 'another person can hold the same quest');
svc.bindPlace('ebony', { cell: 'mine-1' });
cells['vein-a'] = 'mine-1';
cells['vein-b'] = 'cave-1';
const seam = { name: 'Ebony Ore', ore: 'ebony-ore' };
assert.equal(svc.mineRare(1, 'vein-b', seam), 'This place is shut.');
assert.equal(box.inv.get('1|ebony-ore') || 0, 0, 'an extra vein gives nothing');
for (let i = 0; i < ebony.holds; i++) assert.equal(svc.mineRare(1, 'vein-a', seam), '');
assert.notEqual(svc.mineRare(1, 'vein-a', seam), '');
assert.equal(box.inv.get('1|ebony-ore'), ebony.holds);
assert.equal(svc.turnIn(3, ebony.id).ok, false, 'the other copy is not this person');
const turned = svc.turnIn(1, 'ebony');
assert.equal(turned.ok, true);
assert.equal(box.inv.get('1|ebony-ore'), ebony.holds - ebony.ask, 'the extra stays');
assert.ok(!box.adds.some(function (row) { return row.item === 'f:Skyrim.esm'; }), 'scarce does not mint gold');
assert.equal(svc.offer(1, 'ebony').why, 'cooldown');
clock += (ebony.hours * 60 * 60 * 1000) - 1;
assert.equal(svc.offer(1, 'ebony').why, 'cooldown');
clock += 1;
assert.equal(svc.offer(1, 'ebony').ok, true);
svc.walkAway(1, 'ebony');

const satchel = line.scene.find(function (row) { return row.name === 'The satchel'; });
svc.bindPlace('satchel', { ref: 'sack-1', cell: 'road-1', item: 'satchel-item' });
assert.equal(svc.offer(1, 'satchel').ok, true);
assert.equal(svc.noteContainer(1, 'sack-2', 'road-1'), null);
assert.equal(svc.noteContainer(1, 'sack-1', 'other'), null);
assert.ok(svc.noteContainer(1, 'sack-1', 'road-1'));
assert.equal(svc.noteContainer(1, 'sack-1', 'road-1'), null, 'a retrieval is one item');
assert.equal(box.inv.get('1|satchel-item'), 1);
const beforeGold = box.adds.length;
assert.equal(svc.walkAway(1, 'satchel').ok, true);
assert.equal(box.inv.get('1|satchel-item') || 0, 0);
assert.equal(box.adds.length, beforeGold, 'walking away does not mint');
assert.equal(svc.offer(1, 'satchel').ok, true);
svc.noteContainer(1, 'sack-1', 'road-1');
const sceneTurn = svc.turnIn(1, 'satchel', 'trader-1');
assert.equal(sceneTurn.ok, true);
assert.equal(box.inv.get('1|satchel-item') || 0, 0);
const minted = box.adds.filter(function (row) { return row.item === 'f:Skyrim.esm'; });
assert.equal(minted.length, 1);
assert.equal(minted[0].count, satchel.gold);
assert.equal(box.touches(), 0, 'scene gold never touches a purse');
assert.equal(svc.offer(1, 'satchel').why, 'cooldown');

const wolf = line.scene.find(function (row) { return row.name === 'A wolf'; });
svc.bindPlace('wolf', { cell: 'pad-1' });
assert.equal(svc.offer(1, 'wolf').ok, true);
names[10] = 'Dragon'; cells[10] = 'pad-1';
svc.noteKill(1, 10);
const wolfId=box.ids.get('86a88:Skyrim.esm'), wolfBody=box.bodies.get(wolfId);
wolfBody.isDead=true;wolfBody.world='elsewhere';
svc.noteKill(1, wolfId);
assert.equal(svc.turnIn(1, 'wolf').ok, false);
assert.equal(box.adds.filter(function (row) { return row.count === wolf.gold; }).length, 0);
wolfBody.world='151f9:Skyrim.esm';
assert.equal(svc.noteKill(1, wolfId).ok,true);
holds['trader-1']='Whiterun';
assert.equal(svc.turnIn(1, 'wolf', 'trader-1').ok, true);
assert.equal(box.adds.filter(function (row) { return row.item === 'f:Skyrim.esm' && row.count === wolf.gold; }).length, 1);

const camp = line.scene.find(function (row) { return row.name === 'The camp'; });
svc.bindPlace('camp', { cell: 'camp-1' });
assert.equal(svc.offer(1, 'camp').ok, true);
const campIds=['50533','50549','5054a'].map(ref=>box.ids.get(ref+':Skyrim.esm'));
campIds.forEach(id=>{box.bodies.get(id).isDead=true;});
svc.noteKill(1, campIds[0]);
svc.noteKill(1, campIds[1]);
assert.equal(svc.turnIn(1, 'camp', 'trader-1').ok, false);
svc.noteKill(1, campIds[2]);
assert.equal(svc.turnIn(1, 'camp', 'trader-1').ok, true);
assert.equal(box.adds.filter(function (row) { return row.count === camp.gold; }).length, 1);

assert.equal(svc.offer(4, 'geode').ok, true, 'either Enchanter half may take the geode');
box.chooseClass(1,'fisher');
assert.equal(svc.offer(1, 'longfin').ok, false, 'a Novice Fisher cannot take the Master longfin work');
const masterFisher = world({'5:fisher':'master'});
masterFisher.chooseClass(5,'fisher');
assert.equal(masterFisher.svc.offer(5, 'longfin').ok, true, 'a Master Fisher may take the longfin');
assert.equal(svc.offer(3, 'longfin').ok, false, 'a miner is not a fisher');

const mineBody = gm.slice(gm.indexOf('function mineOre'), gm.indexOf('function chopWood'));
assert.ok(mineBody.indexOf('isRareSeam') >= 0, 'mineOre sends a rare seam to the scarce place');
assert.ok(gm.indexOf('noteKill(killerId, actorId)') >= 0, 'a death can count for a scene kill');
assert.equal(box.touches(), 0);

// The production quest rank adapter must not invoke the character reader
// that migrates on a missing or failed read. Compile those actual functions;
// only their native storage and presentation dependencies are controlled.
const characterBlock = gm.slice(gm.indexOf('// ==== thornswood character ===='), gm.indexOf('// ==== end thornswood character ===='));
assert.ok(characterBlock.length > 0, 'production character block envelope');
function productionFunction(name, parameter) {
  const signature = '  function ' + name + '(' + parameter + ') {';
  assert.equal(characterBlock.split(signature).length, 2, 'unique production ' + name);
  const begin = characterBlock.indexOf(signature), end = characterBlock.indexOf('\n  }', begin);
  assert.ok(end > begin);
  return characterBlock.slice(begin, end + '\n  }'.length);
}
const rankBegin = '        readCharacter: function (actor) {';
assert.equal(gm.split(rankBegin).length, 2, 'unique production quest rank adapter');
const rankStart = gm.indexOf(rankBegin);
const rankEnd = gm.indexOf('        creatureName:', rankStart);
assert.ok(rankEnd > rankStart);
const rankAdapter = gm.slice(rankStart + '        readCharacter: '.length, rankEnd).trim().replace(/,$/, '');
const characterRank = /rankOf: (function \(actorId, key\) \{ return P\.rankOf\(stateOf\(actorId\), key\); \})/.exec(gm);
assert.ok(characterRank, 'production character rank adapter envelope');
for (const sample of ['throw', undefined, null, [], {}, {v: 2, ranks: {miner: 'master'}},
  {v: 1, ranks: []}, {v: 1, ranks: {miner: 'invalid'}}, {v: 1, ranks: {miner: true}},
  {v: 1, cls:'miner', ranks: {miner: 'master'}}, {v: 1, cls:'miner', ranks: {miner: 'novice'}}]) {
  const writes = [];
  const rankContext = {
    CHAR_PROPERTY: 'thornswoodCharacter', RANK: ['novice', 'advanced', 'expert', 'master'],
    mp: {
      get(actor, property) {
        if (property !== 'thornswoodCharacter') return null;
        if (sample === 'throw') throw Error('transient character read failure');
        return sample;
      },
      set(...args) { writes.push(args); }
    },
    P: {
      fresh: () => ({v: 1, ranks: {}}),
      rankOf: (state, key) => state && state.ranks && Object.hasOwn(state.ranks, key) ? state.ranks[key] : null
    },
    writeState(actor, state) { rankContext.mp.set(actor, 'thornswoodCharacter', state); return state; },
    mapHalf: () => null,
    clog: () => {}
  };
  rankContext.globalThis = rankContext;
  vm.createContext(rankContext);
  vm.runInContext(productionFunction('readState', 'actorId') + '\n' +
    productionFunction('migrate', 'actorId') + '\n' + productionFunction('stateOf', 'actorId'), rankContext);
  rankContext.__thornswoodCharacter = {
    PROPERTY: 'thornswoodCharacter',
    rankOf: vm.runInContext('(' + characterRank[1] + ')', rankContext)
  };
  rankContext.questCharacterSource = rankContext.__thornswoodCharacter;
  const rules = require('./quest-eligibility-fixture')(rankContext, gm);
  const readRank = vm.runInContext('(' + rankAdapter + ')', rankContext);
  const gate = vm.runInContext('({classKey:"miner",rank:"novice"})', rankContext);
  const qualified = rules.allows(gate, readRank(91));
  assert.equal(writes.length, 0, 'quest eligibility never migrates or writes progression on a read');
  const expected = !!(sample && sample.v === 1 && sample.cls==='miner' && sample.ranks && ['master', 'novice'].includes(sample.ranks.miner));
  assert.equal(qualified, expected, 'only canonical saved rank entries and chosen class qualify');
}
console.log('PASS scarce and scene quests match docs/systems/quests.md');
