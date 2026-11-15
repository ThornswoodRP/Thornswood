'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../game/gamemode.js'), 'utf8');
const start = source.indexOf('// NPC SERVER RUNTIME BEGIN');
const end = source.indexOf('// NPC SERVER RUNTIME END');
assert.ok(start >= 0 && end > start, 'The production NPC runtime must exist');
const context = { Buffer, Math, Date, Number, Map, Set, JSON };
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
const plain = value => JSON.parse(JSON.stringify(value));

function geometry(vertices, triangles) {
  const buf = Buffer.alloc(24 + vertices.length * 12 + triangles.length * 16);
  buf.writeUInt32LE(12, 0);
  buf.writeUInt32LE(vertices.length, 16);
  vertices.forEach((v, i) => v.forEach((n, j) => buf.writeFloatLE(n, 20 + i * 12 + j * 4)));
  const offset = 20 + vertices.length * 12;
  buf.writeUInt32LE(triangles.length, offset);
  triangles.forEach((t, i) => {
    t.forEach((n, j) => buf.writeUInt16LE(n, offset + 4 + i * 16 + j * 2));
    for (let j = 0; j < 3; ++j) {
      const edge = [t[j],t[(j+1)%3]];
      const neighbour = triangles.findIndex((other,k)=>k!==i && edge.every(v=>other.includes(v)));
      buf.writeInt16LE(neighbour, offset + 10 + i * 16 + j * 2);
    }
  });
  return buf;
}
const field = geometry([[0,0,0],[90,0,0],[0,90,0],[90,90,0]], [[0,1,2],[1,3,2]]);
const route = context.npcLocalRoute(field, [10,10,0]);
assert.equal(route.length, 4);
assert.deepEqual(plain(route[1]), [45,45,0]);
assert.deepEqual(plain(route[3]), [45,45,0]);
assert.equal(context.npcLocalRoute(field, [500,500,0]), null);
assert.equal(context.npcLocalRoute(field.subarray(0, 21), [10,10,0]), null);
const broken = Buffer.from(field);
broken.writeUInt16LE(600, 20 + 4 * 12 + 4);
assert.equal(context.npcLocalRoute(broken, [10,10,0]), null);
const nonfinite = Buffer.from(field);
nonfinite.writeFloatLE(NaN, 20);
assert.equal(context.npcLocalRoute(nonfinite, [10,10,0]), null);
const disconnected = Buffer.from(field);
for (let i=0;i<2;i++) for (let j=0;j<3;j++) disconnected.writeInt16LE(-1, 20+4*12+10+i*16+j*2);
assert.equal(context.npcLocalRoute(disconnected, [10,10,0]), null, 'Shared vertices without reciprocal links are not walkable');
const slope = geometry([[0,0,0],[90,0,90],[0,90,0],[90,90,90]], [[0,1,2],[1,3,2]]);
const slopedRoute = context.npcLocalRoute(slope, [10,10,10]);
assert.deepEqual(plain(slopedRoute[0]), [30,30,30], 'A route follows the surface on slopes');
assert.deepEqual(plain(context.npcLocalRoute(field, route[2], route)), plain(route), 'Recovery retains the ordered route from its other triangle');

let time = 0, nextHandle = 0;
const pending = new Map();
const timers = {
  setTimeout(fn, delay) { const handle = ++nextHandle; pending.set(handle, {fn, at: time + delay}); return handle; },
  clearTimeout(handle) { pending.delete(handle); }
};
function advance(ms) {
  const until = time + ms;
  let runs = 0;
  while (pending.size) {
    const [handle, task] = [...pending].sort((a,b) => a[1].at - b[1].at)[0];
    if (task.at > until) break;
    time = task.at; pending.delete(handle); task.fn();
    assert.ok(++runs < 10000, 'Runtime must yield and terminate each callback');
  }
  time = until;
}
let cursor = 0, loads = 0, moves = 0, controlled = false, dead = false;
const state = new Map(), logs = [];
const location = { cellOrWorldDesc: '1605e:Skyrim.esm', pos: [10,10,0], rot: [0,0,0] };
const api = {
  loadNpcBatch(at, limit) {
    assert.equal(at, cursor); assert.ok(limit <= 8); loads++;
    cursor = Math.min(24, at + limit);
    return {nextCursor: cursor, total: 24, actorIds: [loads]};
  },
  getIdFromDesc(desc) { return desc.startsWith('1a66e:') ? 10 : 20; },
  makeProperty() {},
  get(id, prop) {
    if (prop === 'locationalData') return plain(location);
    if (prop === 'isDead') return dead;
    if (prop === 'isDisabled') return false;
    return state.get(prop) || null;
  },
  set(id, prop, value) { state.set(prop, plain(value)); },
  getNavmeshRecords() { return [100]; },
  lookupEspmRecordById() { return { record: { fields: [{type:'NVNM', data:field}] } }; },
  setNpcServerControlled(id, on) { assert.equal(id, 10); controlled = on; },
  updateNpcMovement(id, pos, rot, speed) {
    assert.ok(controlled); assert.equal(id, 10); assert.ok(speed >= 0 && speed <= 60);
    assert.ok(Math.hypot(...pos.map((n,i)=>n-location.pos[i])) <= 12.01);
    location.pos = plain(pos); location.rot = plain(rot); moves++;
  }
};
const runtime = context.startNpcServerRuntime(api, timers, () => time, text => logs.push(text));
advance(1000);
assert.equal(loads, 3);
assert.ok(controlled);
const initial = plain(location.pos);
advance(60000);
assert.ok(moves > 10, 'The server routine advances without connections');
assert.ok(logs.some(text => text.includes('moved')));
assert.notDeepEqual(plain(location.pos), initial);
assert.ok(state.has('thornswoodNpcRoutine'));
const saved = plain(state.get('thornswoodNpcRoutine'));
runtime.stop();
assert.equal(pending.size, 0);
cursor = 0;
const concave = geometry([[0,0,0],[10,0,0],[100,100,0],[100,-100,0]], [[0,1,2],[1,0,3]]);
const concaveRoute = plain(context.npcLocalRoute(concave,[35,30,0]));
location.pos = concaveRoute[2].slice();
state.set('thornswoodNpcRoutine',{version:1,mesh:saved.mesh,route:concaveRoute,target:0,dwellUntil:0});
api.lookupEspmRecordById = () => ({record:{fields:[{type:'NVNM',data:concave}]}});
const reloaded = context.startNpcServerRuntime(api, timers, () => time, text => logs.push(text));
advance(100);
assert.ok(state.get('thornswoodNpcRoutine'));
assert.equal(state.get('thornswoodNpcRoutine').mesh, saved.mesh);
assert.deepEqual(plain(state.get('thornswoodNpcRoutine').route[0]),concaveRoute[2],
  'A rejected saved phase starts in the current triangle instead of crossing a concave exterior gap');
dead = true;
const movesBeforeDeath = moves;
advance(3000);
assert.equal(moves, movesBeforeDeath);
dead = false;
location.pos = [500,500,0];
advance(1000);
assert.equal(controlled, false, 'An unexpected position outside navigation releases authority without a straight return through walls');
reloaded.stop();
assert.equal(pending.size, 0);
console.log('NPC navigation, bounded loading, unattended movement, persistence, death and reload checks passed');
