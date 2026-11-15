'use strict';
// #2005: the shared NPC navigation keeps each navmesh as its NVNM bytes and
// the 512-unit tile index as packed numbers, and makes a triangle object only
// when something reaches it. This builds navigation from the same records
// with that model and with the model it replaced (one object per triangle,
// arrays of triangle objects per tile, kept below as the reference) and
// requires the same tiles and reports after every work slice, the same links,
// the same floor lookups and the same routes.
//
//   node game/tests/test-npc-navigation-equivalence.js
//   node game/tests/test-npc-navigation-equivalence.js <scam_native.node> <server-settings.json>
//
// With no arguments it uses generated navmeshes. With the engine addon and the
// installed settings it also reads real navmeshes around a set of places.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../game/gamemode.js'), 'utf8');
const begin = source.indexOf('// NPC SERVER RUNTIME BEGIN');
const end = source.indexOf('// NPC SERVER RUNTIME END');
assert.ok(begin >= 0 && end > begin, 'Test the production runtime block');
const context = {Buffer, Math, Date, Number, Map, Set, JSON};
vm.createContext(context);
vm.runInContext(source.slice(begin, end), context);
assert.equal(typeof context.createNpcNavigation, 'function', 'The runtime builds navigation through createNpcNavigation');

// ---- Reference: the navigation as it was before #2005, kept unchanged. ----
const refTriangle = {
  get links() {return this.geometry.linksFor(this);},
  get flags() {return this.geometry.bytes.readUInt16LE(this.geometry.triangles+this.index*16+12);},
  get edges() {return [6,8,10].map(j=>this.geometry.bytes.readInt16LE(this.geometry.triangles+this.index*16+j));},
  get points() {
    const b=this.geometry.bytes,off=this.geometry.triangles+this.index*16;
    return [0,2,4].map(j=>{const v=b.readUInt16LE(off+j);return [0,4,8].map(k=>b.readFloatLE(20+v*12+k));});
  },
  get center() {const p=this.points;return [0,1,2].map(j=>(p[0][j]+p[1][j]+p[2][j])/3);}
};
const refPortal = {
  get middle() {const p=this.source.points,e=this.edge;return p[e].map((v,j)=>(v+p[(e+1)%3][j])/2);}
};
function* refReadMeshWork(id, lookup, linksFor) {
  const field = lookup.record.fields.find(f=>f.type === 'NVNM');
  if (!field) throw new Error('Missing NVNM geometry');
  const b = Buffer.from(field.data);
  if (b.length < 24 || b.readUInt32LE(0) !== 12) throw new Error('Unsupported NVNM geometry');
  const nv = b.readUInt32LE(16), at = 20 + nv*12;
  if (nv > 65536 || at+4 > b.length) throw new Error('Invalid nav vertices');
  const nt = b.readUInt32LE(at);
  if (nt > 32768 || at+4+nt*16 > b.length) throw new Error('Invalid nav triangles');
  for(let i=0;i<nv;i++) {
    const p=[0,4,8].map(j=>b.readFloatLE(20+i*12+j));
    if(!p.every(Number.isFinite)) throw new Error('Nonfinite nav geometry');
    if(i%128===127) yield {cost:128};
  }
  yield {cost:nv%128};
  const nodes=[],geometry={bytes:b,triangles:at+4,linksFor};
  for(let index=0;index<nt;index++) {
    const off = at+4+index*16;
    const ids = [0,2,4].map(j=>b.readUInt16LE(off+j));
    if (ids.some(v=>v >= nv)) throw new Error('Invalid triangle vertex');
    const node=Object.assign(Object.create(refTriangle),{mesh:id,index,geometry});
    nodes.push(node);
    yield {cost:1,node};
  }
  let off = at+4+nt*16;
  const externals = [];
  if (off+4 <= b.length) {
    const count = b.readUInt32LE(off); off += 4;
    if (count > 100000 || off+count*10 > b.length) throw new Error('Invalid edge links');
    for (let i=0;i<count;i++,off+=10) {
      externals.push({type:b.readUInt32LE(off),
        mesh:lookup.toGlobalRecordId ? lookup.toGlobalRecordId(b.readUInt32LE(off+4)) : b.readUInt32LE(off+4),
        index:b.readInt16LE(off+8)});
      if(i%128===127) yield {cost:128};
    }
  }
  return {id,nodes,externals};
}
function refSurface(node, pos) {
  const [a,b,c] = node.points;
  const area = (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  if (Math.abs(area)<0.01) return null;
  const u = ((pos[0]-a[0])*(c[1]-a[1])-(pos[1]-a[1])*(c[0]-a[0]))/area;
  const v = ((b[0]-a[0])*(pos[1]-a[1])-(b[1]-a[1])*(pos[0]-a[0]))/area;
  if (u < -0.00001 || v < -0.00001 || u+v > 1.00001) return null;
  return a[2]+u*(b[2]-a[2])+v*(c[2]-a[2]);
}
function referenceNavigation(api, now, report, ready) {
  const banks = new Map(), meshWork = [], sharedMeshes = new Map(), meshEntries = new Map(), cellTiles = new Map();
  let geometryVersion=0;
  const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
  const tile=(cell,p)=>cell+':'+Math.floor(p[0]/512)+':'+Math.floor(p[1]/512);
  function walkable(n,s) { return !(n.flags&(8|32)) && (!(n.flags&512) || s.canSwim); }
  function locate(bank,pos,s,lift) {
    let selected=null,best=Infinity;
    for(const node of bank.tiles.get(tile(bank.cell,pos)) || []) {
      if(!bank.meshes.has(node.mesh) || !walkable(node,s)) continue;
      const z=refSurface(node,pos);
      if(z===null) continue;
      const gap=Math.abs(pos[2]-z-(lift || 0));
      if(gap < (lift===undefined ? 96 : 2) && gap<best) { selected=node;best=gap; }
    }
    return selected;
  }
  function ensureBank(cell,pos) {
    const key=cell+':'+Math.floor(pos[0]/4096)+':'+Math.floor(pos[1]/4096);
    if(banks.has(key)) return banks.get(key);
    const ids=api.getNavmeshRecords(cell,pos);
    if(!cellTiles.has(cell)) cellTiles.set(cell,new Map());
    const bank={cell,ids,meshes:new Map(),tiles:cellTiles.get(cell),remaining:ids.length,ready:!ids.length,waiting:[]};
    banks.set(key,bank);
    for(const id of ids) {
      let entry=meshEntries.get(id);
      if(!entry) {entry={id,cell,banks:[],complete:false};meshEntries.set(id,entry);meshWork.push(entry);}
      if(entry.complete) finishMesh(bank,id);
      else entry.banks.push(bank);
    }
    return bank;
  }
  function finishMesh(bank,id) {
    const mesh=sharedMeshes.get(id);
    if(mesh) bank.meshes.set(id,mesh);
    if(--bank.remaining!==0) return;
    bank.ready=true;ready(bank);
  }
  function nodeLinks(n) {
    if(n.linksVersion===geometryVersion) return n.cachedLinks;
    const bank={meshes:sharedMeshes},links=[];
    if(!bank.meshes.has(n.mesh)) return links;
    for(let e=0;e<3;e++) {
      const mesh=bank.meshes.get(n.mesh);
      const external=!!(n.flags&(1<<e));
      const edge=n.edges[e];
      const ext=external && mesh.externals[edge];
      if(external && (!ext || ext.type!==0)) continue;
      const targetMesh=external ? bank.meshes.get(ext.mesh) : mesh;
      const other=targetMesh && targetMesh.nodes[external ? ext.index : edge];
      if(!other || other===n || other.flags&(8|32)) continue;
      const p=n.points[e],q=n.points[(e+1)%3];
      const oe=other.points.findIndex((v,j)=>
        (distance(v,p)<0.1 && distance(other.points[(j+1)%3],q)<0.1) ||
        (distance(v,q)<0.1 && distance(other.points[(j+1)%3],p)<0.1));
      if(oe<0) continue;
      const oext=!!(other.flags&(1<<oe));
      const om=bank.meshes.get(other.mesh),olink=oext && om.externals[other.edges[oe]];
      const reciprocal=oext ? olink && olink.type===0 && olink.mesh===n.mesh && olink.index===n.index :
        other.mesh===n.mesh && other.edges[oe]===n.index;
      if(!reciprocal) continue;
      if(!links.some(l=>l.node===other)) links.push(Object.assign(Object.create(refPortal),{node:other,source:n,edge:e}));
    }
    n.linksVersion=geometryVersion;n.cachedLinks=links;return links;
  }
  function work() {
    const job=meshWork.shift(),begin=now();
    if(!job) return;
    const {id}=job;
    try {
      if(!job.work) job.work=refReadMeshWork(id,api.lookupEspmRecordById(id),nodeLinks);
      let cost=0,insertions=0,done=false;
      while(cost<512 && insertions<512 && now()-begin<4) {
        if(!job.mesh) {
          const step=job.work.next();
          if(step.done) {job.mesh=step.value;job.at=0;continue;}
          cost+=step.value.cost;continue;
        }
        if(job.at===job.mesh.nodes.length) {sharedMeshes.set(id,job.mesh);geometryVersion++;done=true;break;}
        const n=job.mesh.nodes[job.at++];cost++;
        if(!n) continue;
        if(n.flags&(8|32)) continue;
        const xs=n.points.map(p=>Math.floor(p[0]/512)),ys=n.points.map(p=>Math.floor(p[1]/512));
        if((Math.max(...xs)-Math.min(...xs)+1)*(Math.max(...ys)-Math.min(...ys)+1)>256) continue;
        for(let x=Math.min(...xs);x<=Math.max(...xs);x++) for(let y=Math.min(...ys);y<=Math.max(...ys);y++) {
          const key=job.cell+':'+x+':'+y,tiles=cellTiles.get(job.cell);
          if(!tiles.has(key)) tiles.set(key,[]);
          tiles.get(key).push(n);insertions++;
        }
      }
      if(!done) {meshWork.unshift(job);return;}
    } catch(e) { report('NPC mesh '+id.toString(16)+' rejected: '+e); }
    job.complete=true;job.work=null;job.mesh=null;
    for(const bank of job.banks) finishMesh(bank,id);
    job.banks=[];
  }
  return {banks,ensureBank,locate,work,pending:()=>meshWork.length,meshes:sharedMeshes,cellTiles,walkable,
    triangle:(mesh,index)=>mesh.nodes[index],count:mesh=>mesh.nodes.length};
}

// ---- The two models side by side. ----
function pair(makeApi, clock) {
  const sides = {};
  for (const name of ['reference','production']) {
    const api = makeApi(name), log = [];
    let ticks = 0;
    const now = clock === 'counting' ? () => (ticks++)*0.05 : () => 0;
    const ready = bank => log.push('ready '+bank.cell+' '+bank.ids.join(','));
    const nav = name === 'reference' ? referenceNavigation(api, now, line => log.push(line), ready) :
      context.createNpcNavigation(api, now, line => log.push(line), ready);
    if (name === 'production') {
      nav.walkable = (n,s) => context.npcWalkable(n.flags,s);
      nav.triangle = (mesh,index) => context.npcTriangleAt(mesh,index);
      nav.count = mesh => mesh.count;
    }
    sides[name] = {api, nav, log};
  }
  return sides;
}
const id = n => n ? n.mesh+'/'+n.index : null;
function tilesOf(side, name) {
  const out = {};
  if (name === 'reference') {
    for (const tiles of side.nav.cellTiles.values())
      for (const [key, nodes] of tiles) out[key] = nodes.map(id).join(' ');
  } else {
    const {tiles, slots} = side.nav;
    for (const [cell, map] of side.nav.cellTiles)
      for (const [x, y] of tiles.keys(map))
        out[cell+':'+x+':'+y] = tiles.refs(map,x,y).map(ref => slots[Math.floor(ref/32768)].id+'/'+ref%32768).join(' ');
  }
  return out;
}
const sorted = obj => Object.fromEntries(Object.keys(obj).sort().map(k => [k, obj[k]]));
function bankStates(nav) {
  return [...nav.banks].map(([key,b]) => [key,b.cell,b.ready,b.remaining,[...b.meshes.keys()].join(','),b.waiting.length]);
}
const linkView = (nav, n) => n.links.map(l => [id(l.node), l.edge, l.middle, id(l.source)]);
function triangleView(nav, n) {
  return n && {id:id(n),flags:n.flags,edges:n.edges,points:n.points,center:n.center,links:linkView(nav,n)};
}
// pathTo with every point inside the home, as the runtime walks it.
function route(nav, bank, start, target, targetPos, s, lift) {
  if (start === target) return [targetPos];
  const queue = [start], previous = new Map([[start,null]]);
  for (let i = 0; i < queue.length && i < 128; i++) {
    const n = queue[i];
    if (n === target) {
      const edges = []; let at = n;
      while (previous.get(at)) { const edge = previous.get(at); edges.push(edge.middle); at = edge.from; }
      return edges.reverse().map(p => p.map((v,j) => v+(j===2 ? lift : 0))).concat([targetPos]);
    }
    for (const link of n.links) {
      if (!previous.has(link.node) && bank.meshes.has(link.node.mesh) && nav.walkable(link.node,s)) {
        previous.set(link.node,{from:n,middle:link.middle}); queue.push(link.node);
      }
    }
  }
  return null;
}

let checks = 0, crossMeshLinks = 0;
// Values from the runtime's own realm compared as plain data.
const same = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), message);
function compare(sides, label, banks, options = {}) {
  const {reference:r, production:p} = sides;
  for (const [cell,pos] of banks) { r.nav.ensureBank(cell,pos); p.nav.ensureBank(cell,pos); }
  same(bankStates(p.nav), bankStates(r.nav), label+': the same banks');
  let slice = 0;
  while (r.nav.pending() || p.nav.pending()) {
    r.nav.work(); p.nav.work(); slice++;
    assert.equal(p.nav.pending(), r.nav.pending(), label+': the same mesh jobs left after slice '+slice);
    same(p.log, r.log, label+': the same reports and ready banks after slice '+slice);
    if (!options.tileEvery || slice % options.tileEvery === 0) {
      same(sorted(tilesOf(p,'production')), sorted(tilesOf(r,'reference')), label+': the same tiles after slice '+slice);
      // Links computed between slices are cached by geometry version in both.
      for (const [meshId, mesh] of r.nav.meshes) {
        const other = p.nav.meshes.get(meshId);
        assert.ok(other, label+': the same finished meshes');
        // The first triangles, and every triangle with an external edge, so a
        // link cached before its neighbour mesh finished must be recomputed.
        for (let i = 0; i < r.nav.count(mesh); i++)
          if (i < 4 || r.nav.triangle(mesh,i).flags & 7) same(linkView(p.nav,p.nav.triangle(other,i)), linkView(r.nav,r.nav.triangle(mesh,i)), label+': links mid-build');
      }
    }
    assert.ok(slice < 1000000, 'Mesh work must finish');
  }
  same(sorted(tilesOf(p,'production')), sorted(tilesOf(r,'reference')), label+': the same tiles at the end');
  same(bankStates(p.nav), bankStates(r.nav), label+': the same banks at the end');
  same([...p.nav.meshes.keys()], [...r.nav.meshes.keys()], label+': the same finished meshes');
  // Every triangle: the same geometry and the same reciprocal links, and the
  // production model returns one object per triangle.
  for (const [meshId, mesh] of r.nav.meshes) {
    const other = p.nav.meshes.get(meshId);
    assert.equal(p.nav.count(other), r.nav.count(mesh));
    const step = Math.max(1, Math.floor(r.nav.count(mesh)/(options.trianglesPerMesh || Infinity)));
    for (let i = 0; i < r.nav.count(mesh); i += step) {
      const node = p.nav.triangle(other,i);
      assert.equal(node, p.nav.triangle(other,i), 'One object per triangle');
      same(triangleView(p.nav,node), triangleView(r.nav,r.nav.triangle(mesh,i)), label+': triangle '+meshId+'/'+i);
      for (const link of node.links) {
        assert.equal(link.node, p.nav.triangle(p.nav.meshes.get(link.node.mesh),link.node.index));
        if (link.node.mesh !== node.mesh) crossMeshLinks++;
      }
      checks++;
    }
  }
  // Floor lookups and routes from the same points.
  const swims = [{canSwim:false},{canSwim:true}];
  const points = options.points || [];
  for (const [cell,pos] of banks) {
    const rb = r.nav.ensureBank(cell,pos), pb = p.nav.ensureBank(cell,pos);
    const located = [];
    for (const point of points.filter(q => q.cell === cell)) for (const s of swims) for (const lift of [undefined,0,1.5]) {
      const a = r.nav.locate(rb,point.pos,s,lift), b = p.nav.locate(pb,point.pos,s,lift);
      assert.equal(id(b), id(a), label+': locate '+JSON.stringify(point.pos)+' lift '+lift);
      if (a && lift === undefined && !s.canSwim) located.push([a,b,point.pos]);
      checks++;
    }
    for (let i = 0; i+1 < located.length && i < (options.routes || 200); i++) {
      const [ra,pa,from] = located[i], [rt,pt,to] = located[(i*7+3) % located.length];
      const lift = from[2]-refSurface(ra,from);
      const target = [to[0],to[1],refSurface(rt,to)+lift];
      same(route(p.nav,pb,pa,pt,target,swims[0],lift), route(r.nav,rb,ra,rt,target,swims[0],lift),
        label+': route '+id(ra)+' to '+id(rt));
      checks++;
    }
  }
}

// ---- Generated navmeshes. ----
function random(seed) {
  return () => { seed |= 0; seed = seed+0x6D2B79F5|0; let t = Math.imul(seed^seed>>>15,1|seed);
    t = t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; };
}
// A grid of squares, two triangles each, with reciprocal neighbours from
// shared vertices, flags from the generator, and external edges added later.
function grid(origin, columns, rows, size, height, flagFor) {
  const vertices = [], triangles = [];
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++)
    vertices.push([origin[0]+x*size, origin[1]+y*size, origin[2]+height(x,y)]);
  const at = (x,y) => y*(columns+1)+x;
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    triangles.push([at(x,y),at(x+1,y),at(x,y+1)], [at(x+1,y),at(x+1,y+1),at(x,y+1)]);
  }
  return {vertices, triangles, flags:triangles.map((t,i) => flagFor(i)), externals:[], extra:Buffer.alloc(0)};
}
function encode(mesh) {
  const {vertices, triangles} = mesh;
  const b = Buffer.alloc(24 + vertices.length*12 + triangles.length*16);
  b.writeUInt32LE(12,0); b.writeUInt32LE(vertices.length,16);
  vertices.forEach((v,i) => v.forEach((n,j) => b.writeFloatLE(n,20+i*12+j*4)));
  const offset = 20+vertices.length*12;
  b.writeUInt32LE(triangles.length,offset);
  const edgeOwner = new Map();
  triangles.forEach((t,i) => { for (let j = 0; j < 3; j++) {
    const k = [t[j],t[(j+1)%3]].sort((a,c) => a-c).join(',');
    if (!edgeOwner.has(k)) edgeOwner.set(k,[]); edgeOwner.get(k).push(i);
  } });
  triangles.forEach((t,i) => {
    const at = offset+4+i*16;
    t.forEach((n,j) => b.writeUInt16LE(n,at+j*2));
    let flags = mesh.flags[i] || 0;
    for (let j = 0; j < 3; j++) {
      const k = [t[j],t[(j+1)%3]].sort((a,c) => a-c).join(',');
      const external = mesh.externals.findIndex(e => e.triangle === i && e.edge === j);
      if (external >= 0) { flags |= 1<<j; b.writeInt16LE(external,at+6+j*2); continue; }
      const neighbour = edgeOwner.get(k).find(o => o !== i);
      b.writeInt16LE(neighbour === undefined ? -1 : neighbour,at+6+j*2);
    }
    b.writeUInt16LE(flags,at+12);
  });
  const links = Buffer.alloc(4+mesh.externals.length*10);
  links.writeUInt32LE(mesh.externals.length,0);
  mesh.externals.forEach((e,i) => { links.writeUInt32LE(e.type,4+i*10); links.writeUInt32LE(e.local,8+i*10); links.writeInt16LE(e.index,12+i*10); });
  return Buffer.concat([b,links,mesh.extra]);
}
function generated() {
  const rnd = random(2005);
  const flag = () => { const r = rnd(); return r < 0.04 ? 8 : r < 0.07 ? 32 : r < 0.12 ? 512 : 0; };
  const meshes = new Map(), placed = [];
  function add(meshId, cell, mesh, mapping, area) {
    meshes.set(meshId,{cell,mesh,mapping:mapping || new Map(),area});
  }
  // Two exterior grids that meet along x = 0, joined by external edges.
  const west = grid([-2560,-1280,0],40,40,64,(x,y) => Math.sin(x/5)*20+y, flag);
  const east = grid([0,-1280,40],40,40,64,(x,y) => y+Math.cos(y/7)*10, flag);
  for (let row = 0; row < 40; row++) {
    const w = row*80+79, e = row*80;            // west's right column, east's left column
    // West's second triangle of the last square has the right edge as its
    // first edge (x+1,y)-(x+1,y+1); east's first triangle of the first square
    // has its left edge as the third edge (x,y+1)-(x,y).
    const kind = row % 9;
    const toEast = {triangle:w,edge:0,type:kind === 4 ? 1 : 0,local:0x801,index:kind === 5 ? 9999 : e};
    const toWest = {triangle:e,edge:2,type:0,local:kind === 6 ? 0x899 : 0x802,index:kind === 7 ? -1 : w};
    west.externals.push(toEast); east.externals.push(toWest);
  }
  // The two grids meet at different heights; give the shared border the same
  // vertex heights so the edges match for the reciprocal check.
  for (let y = 0; y <= 40; y++) {
    const wv = y*41+40, ev = y*41;
    east.vertices[ev][2] = west.vertices[wv][2];
  }
  west.extra = Buffer.alloc(37,7);
  add(0x1000,60,west,new Map([[0x801,0x1001]]));
  add(0x1001,60,east,new Map([[0x802,0x1000]]));
  // An overlapping floor above part of the west grid, and one far away in
  // negative coordinates.
  add(0x1002,60,grid([-1500,-900,300],12,12,50,() => 0, flag));
  add(0x1003,60,grid([-90000,-70000,-500],20,10,120,(x,y) => x*3-y, flag));
  // One huge triangle (skipped by the 256-tile rule) and one beyond the
  // packed tile key range.
  // Also one spanning exactly 257 tiles (skipped) and one exactly 256 (kept).
  add(0x1004,60,{vertices:[[0,0,0],[20000,0,0],[0,20000,0],[9000000,9000000,0],[9000300,9000000,0],[9000000,9000300,0],
    [-131072,5700,0],[10,5750,0],[-131072,5800,0],[-9000,-9000,5],[-9000+8191,-9000,5],[-9000,-9000+8191,5]],
    triangles:[[0,1,2],[3,4,5],[6,7,8],[9,10,11]],flags:[0,0,0,0],externals:[],extra:Buffer.alloc(0)});
  // An interior cell with a mesh shared by two cells' banks.
  add(0x2000,70,grid([0,0,0],30,30,40,(x,y) => (x*y)%7, flag));
  // Records that cannot be read.
  const bad = grid([0,3000,0],30,30,40,() => 0, () => 0);
  const badBytes = encode(bad); badBytes.writeUInt16LE(60000,20+bad.vertices.length*12+4+(bad.triangles.length-2)*16);
  add(0x3000,60,{bytes:badBytes});
  add(0x3001,60,{bytes:encode(bad).subarray(0,21)});
  const nonfinite = encode(grid([0,4000,0],3,3,40,() => 0,() => 0)); nonfinite.writeFloatLE(NaN,20+5*12);
  add(0x3002,60,{bytes:nonfinite});
  for (const record of meshes.values()) record.bytes = record.mesh.bytes || encode(record.mesh);
  return meshes;
}
function recordApi(meshes, cells) {
  return () => ({
    getNavmeshRecords(cell) { return (cells.get(cell) || []).slice(); },
    lookupEspmRecordById(meshId) {
      const record = meshes.get(meshId);
      if (!record) throw new Error('missing mesh record');
      return {record:{fields:[{type:'NVNM',data:new Uint8Array(record.bytes)}]},
        toGlobalRecordId(local) { return record.mapping.get(local) || 0; }};
    }
  });
}
const meshes = generated();
const cells = new Map([[60,[0x1000,0x1001,0x1002,0x1003,0x1004,0x3000,0x3001,0x3002,0x9999]],[70,[0x2000]],[71,[0x2000]],[72,[]]]);
const points = [];
for (const [meshId, record] of meshes) {
  if (!record.mesh || !record.mesh.triangles) continue;
  const {vertices, triangles} = record.mesh;
  triangles.forEach((t,i) => {
    if (i % 29) return;
    const c = [0,1,2].map(j => (vertices[t[0]][j]+vertices[t[1]][j]+vertices[t[2]][j])/3);
    for (const dz of [0,50,95,97,-60]) points.push({cell:record.cell,pos:[c[0],c[1],c[2]+dz]});
    points.push({cell:record.cell,pos:vertices[t[0]].slice()});
  });
}
points.push(...points.filter(q => q.cell === 70).map(q => ({cell:71, pos:q.pos})));
const banks = [[60,[0,0,0]],[60,[-2000,-1000,0]],[70,[100,100,0]],[71,[100,100,0]],[72,[0,0,0]],[60,[-90000,-70000,0]]];
for (const clock of ['fixed','counting']) {
  const sides = pair(recordApi(meshes,cells),clock);
  // The clock only changes where slices end, so lookups and routes run once.
  compare(sides,'generated meshes, '+clock+' clock',banks,{points:clock === 'fixed' ? points : []});
  // The generated records reach every path the models could differ on.
  const {nav, log} = sides.production;
  assert.equal(log.filter(line => / rejected: /.test(line)).length, 4, 'Four unreadable records are reported');
  const links = [...nav.meshes.get(0x1000).nodes.values()].flatMap(n => n.links);
  assert.ok(links.some(l => l.node.mesh === 0x1001), 'Reciprocal external edges link the two grids');
  assert.ok([...nav.cellTiles.get(60).keys()].some(k => typeof k === 'string'), 'A tile outside the packed key range');
  assert.ok(nav.tiles.stats().chunks > nav.tiles.stats().tiles, 'Tiles that need more than one chunk');
}
console.log('PASS generated navmeshes: the same tiles, slices, links, lookups and routes ('+checks+' checks)');

// ---- Real navmeshes, when the engine and the installed settings are given. ----
if (process.argv[2] && process.argv[3]) {
  const addon = require(path.resolve(process.argv[2]));
  const installed = JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
  const server = new addon.ScampServer(JSON.stringify({port:0,maxPlayers:2,offlineMode:true,
    name:'npc-navigation-equivalence',dataDir:path.dirname(installed.loadOrder[0]),loadOrder:installed.loadOrder,
    npcEnabled:false,npcSettings:{},logLevel:'error'}));
  server._setSelf(server);
  const api = () => ({getNavmeshRecords:server.getNavmeshRecords.bind(server),
    lookupEspmRecordById:server.lookupEspmRecordById.bind(server)});
  // Tamriel around Whiterun, Riverwood, Solitude and Windhelm, and the
  // Bannered Mare interior.
  const tamriel = 0x3c, places = [[22000,-8000],[17000,-46000],[-58000,95000],[132000,35000]];
  const realBanks = [];
  for (const [x,y] of places) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
    realBanks.push([tamriel,[x+dx*4096,y+dy*4096,0]]);
  const mare = server.getIdFromDesc('1605e:Skyrim.esm');
  realBanks.push([mare,[0,0,0]]);
  const sides = pair(api,'fixed');
  // Floor points: the centres of every tenth triangle of the banks' meshes.
  const realPoints = [];
  for (const [cell,pos] of realBanks) for (const meshId of server.getNavmeshRecords(cell,pos)) {
    const field = server.lookupEspmRecordById(meshId).record.fields.find(f => f.type === 'NVNM');
    if (!field) continue;
    const b = Buffer.from(field.data), nv = b.readUInt32LE(16), at = 20+nv*12, nt = b.readUInt32LE(at);
    for (let i = 0; i < nt; i += 10) {
      const v = [0,2,4].map(j => b.readUInt16LE(at+4+i*16+j)).map(k => [0,4,8].map(o => b.readFloatLE(20+k*12+o)));
      const c = [0,1,2].map(j => (v[0][j]+v[1][j]+v[2][j])/3);
      realPoints.push({cell,pos:c},{cell,pos:[c[0]+7,c[1]-5,c[2]+40]});
    }
  }
  const before = checks, crossBefore = crossMeshLinks;
  compare(sides,'installed navmeshes',realBanks,{points:realPoints,tileEvery:50,trianglesPerMesh:200,routes:400});
  console.log('PASS installed navmeshes: '+sides.reference.nav.meshes.size+' meshes, '+realPoints.length+
    ' floor points, '+(crossMeshLinks-crossBefore)+' links between meshes, the same tiles, links, lookups and routes ('+(checks-before)+' checks)');
  assert.ok(crossMeshLinks > crossBefore, 'Installed navmeshes link across meshes');
}
