// NPC SERVER RUNTIME BEGIN
// NVNM geometry follows xEdit's TES5 definitions: 12-byte vertices and
// 16-byte triangles. Stay inside two adjacent walkable triangles and pass
// through their shared edge midpoint; do not cross doors or external links.
function npcLocalRoute(data, pos, preferredRoute) {
  const b = Buffer.from(data);
  if (b.length < 24 || b.readUInt32LE(0) !== 12 ||
      !Array.isArray(pos) || pos.length !== 3 || !pos.every(Number.isFinite)) return null;
  const nv = b.readUInt32LE(16);
  const offset = 20 + nv * 12;
  if (nv > 500000 || offset + 4 > b.length) return null;
  const nt = b.readUInt32LE(offset);
  if (nt > 500000 || offset + 4 + nt * 16 > b.length) return null;
  const vertices = [];
  for (let i = 0; i < nv; i++) {
    const v = [0, 4, 8].map(j => b.readFloatLE(20 + i * 12 + j));
    if (!v.every(Number.isFinite)) return null;
    vertices.push(v);
  }
  const triangles = [];
  for (let i = 0; i < nt; i++) {
    const at = offset + 4 + i * 16;
    const ids = [0, 2, 4].map(j => b.readUInt16LE(at + j));
    if (ids.some(id => id >= nv)) return null;
    const flags = b.readUInt16LE(at + 12);
    if (flags & (7 | 8 | 32 | 512 | 1024)) continue;
    const points = ids.map(id => vertices[id]);
    const center = [0, 1, 2].map(j => points.reduce((sum, v) => sum + v[j], 0) / 3);
    const neighbors = [6, 8, 10].map(j => b.readInt16LE(at + j));
    triangles.push({ids, points, center, neighbors, index: i});
  }
  function height(t, p) {
    const [a, b, c] = t.points;
    const area = (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    if (Math.abs(area) <= 1) return null;
    const u = ((p[0]-a[0])*(c[1]-a[1])-(p[1]-a[1])*(c[0]-a[0]))/area;
    const v = ((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))/area;
    return a[2]+u*(b[2]-a[2])+v*(c[2]-a[2]);
  }
  function contains(t, p, lift) {
    const [a, b, c] = t.points;
    const cross = (u,v) => (v[0]-u[0])*(p[1]-u[1])-(v[1]-u[1])*(p[0]-u[0]);
    const signs = [cross(a,b),cross(b,c),cross(c,a)];
    const z = height(t, p);
    return z !== null && (signs.every(v=>v >= -0.01) || signs.every(v=>v <= 0.01)) &&
      Math.abs(z+(lift || 0)-p[2]) < (lift === undefined ? 96 : 2);
  }
  function pairRoute(a, t, lift) {
    const shared = a.ids.filter(id => t.ids.includes(id));
    const distance = Math.hypot(...t.center.map((v,i)=>v-a.center[i]));
    if (shared.length !== 2 || distance < 24 || distance > 240 ||
        Math.abs(t.center[2]-a.center[2]) > 96) return null;
    const edge = triangle => triangle.ids.findIndex((id,j)=>shared.includes(id) && shared.includes(triangle.ids[(j+1)%3]));
    if (a.neighbors[edge(a)] !== t.index || t.neighbors[edge(t)] !== a.index) return null;
    const middle = [0,1,2].map(j=>(vertices[shared[0]][j]+vertices[shared[1]][j])/2);
    return [a.center,middle,t.center,middle].map(v=>[v[0],v[1],v[2]+lift]);
  }
  if (Array.isArray(preferredRoute) && preferredRoute.length === 4 &&
      preferredRoute.every(p=>Array.isArray(p) && p.length===3 && p.every(Number.isFinite))) {
    const centerMatches = (t,p)=>Math.hypot(t.center[0]-p[0],t.center[1]-p[1]) < 0.1;
    const a = triangles.find(t=>centerMatches(t,preferredRoute[0]));
    const t = triangles.find(t=>centerMatches(t,preferredRoute[2]));
    if (a && t) {
      const lift = preferredRoute[0][2]-a.center[2];
      const candidate = pairRoute(a,t,lift);
      if (Math.abs(lift)<96 && candidate && candidate.every((p,i)=>
          Math.hypot(...p.map((v,j)=>v-preferredRoute[i][j])) < 0.1) &&
          (contains(a,pos,lift) || contains(t,pos,lift))) return candidate;
    }
  }
  const a = triangles.filter(t=>contains(t,pos)).sort((a,b)=>
    Math.abs(height(a,pos)-pos[2])-Math.abs(height(b,pos)-pos[2]))[0];
  if (!a) return null;
  for (const t of triangles) {
    const candidate = pairRoute(a,t,pos[2]-height(a,pos));
    if (candidate) return candidate;
  }
  return null;
}
function startNpcServerRuntime(api, timers, now, report) {
  const property = 'thornswoodNpcRoutine';
  api.makeProperty(property, {isVisibleByOwner: false, isVisibleByNeighbors: false,
    updateOwner: '', updateNeighbor: ''});
  let stopped = false, handle = null, cursor = 0, loaded = 0, total = 0;
  let actor = 0, route = null, mesh = 0, meshData = null, expectedPos = null, target = 0, dwellUntil = 0;
  let lastTick = now(), lastReport = now(), moved = 0, cycles = 0;
  function schedule(fn, delay) {
    if (!stopped) handle = timers.setTimeout(fn, delay);
  }
  function stop() {
    stopped = true;
    if (handle !== null) timers.clearTimeout(handle);
  }
  function fault(error) {
    stop();
    if (actor) {
      try { api.setNpcServerControlled(actor, false); } catch (e) { }
    }
    report('NPC server routine stopped: ' + error);
  }
  function save() {
    api.set(actor, property, {version: 1, mesh, route, target, dwellUntil});
  }
  function onSegment(pos, a, b) {
    const delta = b.map((v,i)=>v-a[i]);
    const squared = delta.reduce((sum,v)=>sum+v*v,0);
    const fraction = squared ? Math.max(0,Math.min(1,pos.reduce((sum,v,i)=>sum+(v-a[i])*delta[i],0)/squared)) : 0;
    return Math.hypot(...pos.map((v,i)=>v-a[i]-fraction*delta[i])) < 2;
  }
  function prepare() {
    actor = api.getIdFromDesc('1a66e:Skyrim.esm');
    const loc = api.get(actor, 'locationalData');
    if (loc.cellOrWorldDesc !== '1605e:Skyrim.esm') {
      throw new Error('Hulda is outside the declared inn routine');
    }
    const meshes = api.getNavmeshRecords(api.getIdFromDesc(loc.cellOrWorldDesc));
    const saved = api.get(actor, property);
    for (const id of meshes) {
      const record = api.lookupEspmRecordById(id).record;
      const field = record.fields.find(f => f.type === 'NVNM');
      const candidate = field && npcLocalRoute(field.data, loc.pos,
        saved && saved.mesh === id ? saved.route : null);
      if (!candidate) continue;
      mesh = id;
      meshData = field.data;
      route = candidate;
      let recovered = false;
      if (saved && saved.version === 1 && saved.mesh === mesh &&
          Array.isArray(saved.route) && saved.route.length === 4 &&
          saved.route.every(p=>Array.isArray(p) && p.length===3 && p.every(Number.isFinite)) &&
          Number.isInteger(saved.target) && saved.target >= 0 && saved.target < 4 &&
          Number.isFinite(saved.dwellUntil)) {
        // Only recover the old route if its segments are the same walkable
        // geometry. A changed winning mesh requires rebuilding the route.
        const same = saved.route.every((p,i)=>Math.hypot(...p.map((v,j)=>v-candidate[i][j])) < 0.1);
        if (same && onSegment(loc.pos,route[(saved.target+3)%4],route[saved.target])) {
          target = saved.target; dwellUntil = saved.dwellUntil;
          recovered = true;
        }
      }
      if (!recovered) {
        route = npcLocalRoute(field.data,loc.pos);
        if (!route) continue;
        target = 0; dwellUntil = 0;
      }
      api.setNpcServerControlled(actor, true);
      expectedPos = loc.pos.slice();
      save();
      lastTick = now();
      report('NPC server routine ready for Hulda on mesh ' + mesh.toString(16));
      schedule(tick, 200);
      return;
    }
    throw new Error('No adjacent walkable inn triangles for Hulda');
  }
  function preload() {
    try {
      const batch = api.loadNpcBatch(cursor, 8);
      if (!Number.isInteger(batch.nextCursor) || !Number.isInteger(batch.total) ||
          batch.nextCursor <= cursor || batch.nextCursor > batch.total) {
        if (batch.nextCursor === cursor && cursor === batch.total) {
          total = batch.total;
        } else throw new Error('NPC loading cursor did not advance');
      }
      cursor = batch.nextCursor; total = batch.total; loaded += batch.actorIds.length;
      if (cursor < total) { schedule(preload, 10); return; }
      report('NPC server loading complete: ' + loaded + ' loaded from ' + total + ' candidates');
      prepare();
    } catch (e) { fault(e); }
  }
  function tick() {
    try {
      const at = now(), elapsed = Math.max(0, Math.min(200, at-lastTick));
      lastTick = at;
      if (!api.get(actor, 'isDead') && !api.get(actor, 'isDisabled')) {
        const loc = api.get(actor, 'locationalData');
        if (loc.cellOrWorldDesc !== '1605e:Skyrim.esm') throw new Error('Routine cell changed');
        if (Math.hypot(...loc.pos.map((v,i)=>v-expectedPos[i])) >= 2) {
          const replacement = npcLocalRoute(meshData,loc.pos);
          if (!replacement) throw new Error('NPC moved outside walkable local navigation');
          route = replacement; target = 0; dwellUntil = 0; save();
        }
        const delta = route[target].map((v,i)=>v-loc.pos[i]);
        const distance = Math.hypot(...delta);
        if (distance > 4096) throw new Error('NPC moved outside the local route');
        const step = Math.min(distance, 60*elapsed/1000);
        const walking = at >= dwellUntil && distance > 0.5;
        const pos = walking ? loc.pos.map((v,i)=>v+delta[i]*step/distance) : loc.pos;
        const rot = walking ? [0,0,Math.atan2(delta[0],delta[1])*180/Math.PI] : loc.rot;
        api.updateNpcMovement(actor, pos, rot, walking ? 60 : 0);
        expectedPos = pos.slice();
        if (walking) moved++;
        if (at >= dwellUntil && (distance <= 0.5 || step >= distance)) {
          if (target % 2 === 0) dwellUntil = at + 10000;
          target = (target+1)%route.length;
          if (target === 0) cycles++;
          save();
        }
      }
      if (at-lastReport >= 60000) {
        report('NPC server routine: moved ' + moved + ' steps, ' + cycles + ' cycles; ' +
          'activity continues with zero connections');
        moved = 0; cycles = 0; lastReport = at;
      }
      schedule(tick, 200);
    } catch (e) { fault(e); }
  }
  schedule(preload, 0);
  return {stop};
}
// Shared navigation keeps a spatial index and verifies each reciprocal edge.
// External links are resolved through the winning record's master mapping.
// Each NAVM is kept as its NVNM vertex and triangle bytes. A triangle becomes
// an object only when locating, linking or routing reaches it, and the tile
// index holds packed numbers, so the cast's navigation costs bytes per
// triangle instead of an object each (#2005).
function npcTriangleFlags(geometry, index) {
  return geometry.bytes.readUInt16LE(geometry.triangles+index*16+12);
}
function npcTrianglePoints(geometry, index) {
  const b=geometry.bytes,off=geometry.triangles+index*16;
  return [0,2,4].map(j=>{const v=b.readUInt16LE(off+j);return [0,4,8].map(k=>b.readFloatLE(20+v*12+k));});
}
const npcTriangle = {
  get links() {return this.geometry.linksFor(this);},
  get flags() {return npcTriangleFlags(this.geometry,this.index);},
  get edges() {return [6,8,10].map(j=>this.geometry.bytes.readInt16LE(this.geometry.triangles+this.index*16+j));},
  get points() {return npcTrianglePoints(this.geometry,this.index);},
  get center() {const p=this.points;return [0,1,2].map(j=>(p[0][j]+p[1][j]+p[2][j])/3);}
};
const npcPortal = {
  get middle() {const p=this.source.points,e=this.edge;return p[e].map((v,j)=>(v+p[(e+1)%3][j])/2);}
};
function* npcReadMeshWork(id, lookup, linksFor) {
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
  for(let index=0;index<nt;index++) {
    const off = at+4+index*16;
    if ([0,2,4].some(j=>b.readUInt16LE(off+j) >= nv)) throw new Error('Invalid triangle vertex');
    yield {cost:1};
  }
  let off = at+4+nt*16;
  // Three numbers per external edge: type, global mesh and triangle.
  const externals = [];
  if (off+4 <= b.length) {
    const count = b.readUInt32LE(off); off += 4;
    if (count > 100000 || off+count*10 > b.length) throw new Error('Invalid edge links');
    for (let i=0;i<count;i++,off+=10) {
      externals.push(b.readUInt32LE(off),
        lookup.toGlobalRecordId ? lookup.toGlobalRecordId(b.readUInt32LE(off+4)) : b.readUInt32LE(off+4),
        b.readInt16LE(off+8));
      if(i%128===127) yield {cost:128};
    }
  }
  // Keep only the vertices and triangles; the rest of the record is not read
  // again. Its own allocation, so a small mesh cannot hold a shared Buffer
  // pool block that also holds the discarded record copies.
  const kept = Buffer.allocUnsafeSlow(at+4+nt*16);
  b.copy(kept,0,0,at+4+nt*16);
  const geometry = {bytes:kept,triangles:at+4,linksFor};
  return {id,count:nt,geometry,externals,nodes:new Map()};
}
function npcExternal(mesh, edge) {
  if (!(edge>=0 && edge*3<mesh.externals.length)) return undefined;
  const e=mesh.externals;
  return {type:e[edge*3],mesh:e[edge*3+1],index:e[edge*3+2]};
}
// The triangle object for one index, made once and then reused, so the same
// triangle is always the same object for routes, links and actors.
function npcTriangleAt(mesh, index) {
  if (!(index>=0 && index<mesh.count)) return undefined;
  let node = mesh.nodes.get(index);
  if (!node) {
    node = Object.assign(Object.create(npcTriangle),{mesh:mesh.id,index,geometry:mesh.geometry});
    mesh.nodes.set(index,node);
  }
  return node;
}
function npcSurfaceOf(points, pos) {
  const [a,b,c] = points;
  const area = (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  if (Math.abs(area)<0.01) return null;
  const u = ((pos[0]-a[0])*(c[1]-a[1])-(pos[1]-a[1])*(c[0]-a[0]))/area;
  const v = ((b[0]-a[0])*(pos[1]-a[1])-(b[1]-a[1])*(pos[0]-a[0]))/area;
  if (u < -0.00001 || v < -0.00001 || u+v > 1.00001) return null;
  return a[2]+u*(b[2]-a[2])+v*(c[2]-a[2]);
}
function npcSurface(node, pos) { return npcSurfaceOf(node.points,pos); }
// A triangle seen edge on from above (a wall face in the navmesh) has no
// ground to stand on: npcSurfaceOf gives it no height, so nothing may route
// onto it (#2072).
function npcHasGround(points) {
  const [a,b,c] = points;
  return Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))>=0.01;
}
// A race that swims and cannot walk (s.swims, from the catalogue, #2067) moves
// on water triangles only: the beds of rivers, lakes and the sea.
function npcWalkable(flags, s) {
  if (flags&(8|32)) return false;
  if (s.swims) return !!(flags&512);
  return !(flags&512) || s.canSwim;
}
// A swimmer stays below the depth it was placed at (s.swimTop), so it only
// swims over a bed at least eight units under that.
function npcSwimRoom(points, s) {
  return !s.swims || Math.max(points[0][2],points[1][2],points[2][2]) <= s.swimTop-8;
}
// The point of a triangle nearest pos across the ground, one unit inside its
// edge so the triangle still contains it, on the triangle's surface.
function npcNearestOn(points, pos) {
  const center=[0,1,2].map(j=>(points[0][j]+points[1][j]+points[2][j])/3);
  let near=[pos[0],pos[1]];
  if (npcSurfaceOf(points,pos)===null) {
    let best=Infinity;
    for (let e=0;e<3;e++) {
      const a=points[e],b=points[(e+1)%3],dx=b[0]-a[0],dy=b[1]-a[1],size=dx*dx+dy*dy;
      const u=size ? Math.max(0,Math.min(1,((pos[0]-a[0])*dx+(pos[1]-a[1])*dy)/size)) : 0;
      const x=a[0]+u*dx,y=a[1]+u*dy,d=Math.hypot(pos[0]-x,pos[1]-y);
      if (d<best) {best=d;near=[x,y];}
    }
    const toward=Math.hypot(center[0]-near[0],center[1]-near[1]);
    if (toward>0) near=near.map((v,j)=>v+(center[j]-v)*Math.min(1,1/toward));
  }
  const z=npcSurfaceOf(points,[near[0],near[1],0]);
  return z===null ? null : [near[0],near[1],z];
}
// The 512-unit tile index. Each tile lists triangle references (mesh slot
// times 32768 plus triangle) in insertion order, in chunks of seven
// references and a link to the next chunk, inside shared blocks of words.
// kept is what carry() gave the previous load of the gamemode (#3296): its
// words, which are only numbers, so the index goes on where it was.
function createNpcNavTiles(kept) {
  const blockWords = 1<<18, blocks = kept ? kept.blocks : [];
  let chunks = kept ? kept.chunks : 0, tiles = kept ? kept.tiles : 0;
  let head = kept ? kept.head : new Uint32Array(1024), tail = kept ? kept.tail : new Uint32Array(1024),
    count = kept ? kept.count : new Uint32Array(1024);
  const key = (x,y) => x>-16384 && x<16384 && y>-16384 && y<16384 ? (x+16384)*32768+(y+16384) : x+':'+y;
  const read = word => blocks[Math.floor(word/blockWords)][word%blockWords];
  const write = (word,value) => { blocks[Math.floor(word/blockWords)][word%blockWords] = value; };
  function chunk() {
    const c = chunks++;
    if (Math.floor(c*8/blockWords) >= blocks.length) blocks.push(new Uint32Array(blockWords));
    return c;
  }
  function grow() {
    if (tiles < head.length) return;
    const larger = old => { const next = new Uint32Array(old.length*2); next.set(old); return next; };
    head = larger(head); tail = larger(tail); count = larger(count);
  }
  function add(cell, x, y, ref) {
    const k = key(x,y);
    let t = cell.get(k);
    if (t === undefined) { grow(); t = tiles++; cell.set(k,t); count[t] = 0; }
    const n = count[t];
    let c;
    if (n === 0) { c = chunk(); head[t] = c; tail[t] = c; }
    else if (n%7 === 0) { c = chunk(); write(tail[t]*8+7,c+1); tail[t] = c; }
    else c = tail[t];
    write(c*8+n%7,ref); count[t] = n+1;
  }
  function refs(cell, x, y) {
    const t = cell.get(key(x,y)), out = [];
    if (t === undefined) return out;
    for (let c = head[t], i = 0, n = count[t]; i < n; i++) {
      if (i && i%7 === 0) c = read(c*8+7)-1;
      out.push(read(c*8+i%7));
    }
    return out;
  }
  function keys(cell) {
    return Array.from(cell.keys(), k => typeof k === 'number' ?
      [Math.floor(k/32768)-16384, k%32768-16384] : k.split(':').map(Number));
  }
  return {cell:() => new Map(), add, refs, keys, stats:() => ({tiles, chunks, blocks:blocks.length}),
    carry:() => ({blocks, chunks, tiles, head, tail, count})};
}
// Navigation for one runtime: banks of nearby meshes, the sliced mesh work,
// the tile index, reciprocal links and floor lookup. ready(bank) runs when a
// bank's last mesh is finished. kept is what carry() gave the previous load
// of the gamemode (#3296): the meshes it read, their tile index, the banks
// and the mesh work still waiting, all of it data.
function createNpcNavigation(api, now, report, ready, kept) {
  const {banks, meshWork, sharedMeshes, meshEntries, cellTiles, slots} = kept ||
    {banks:new Map(), meshWork:[], sharedMeshes:new Map(), meshEntries:new Map(), cellTiles:new Map(), slots:[]};
  const tiles = createNpcNavTiles(kept && kept.tiles);
  let geometryVersion = kept ? kept.geometryVersion : 0;
  // A mesh's triangle objects, and the links cached on them, were made by the
  // previous load's code. They are dropped and made again here when something
  // reaches them, so nothing kept holds a function of that load, and none of
  // that load stays in memory. A mesh whose reading had not finished reads
  // again from its start; reading changes nothing until it finishes.
  if(kept) {
    for(const mesh of slots) {mesh.geometry.linksFor=nodeLinks;mesh.nodes=new Map();}
    for(const job of meshWork) job.work=null;
  }
  const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
  function locate(bank,pos,s,lift) {
    let selected=null,best=Infinity;
    for(const ref of tiles.refs(bank.tiles,Math.floor(pos[0]/512),Math.floor(pos[1]/512))) {
      const mesh=slots[Math.floor(ref/32768)],index=ref%32768;
      if(!bank.meshes.has(mesh.id) || !npcWalkable(npcTriangleFlags(mesh.geometry,index),s)) continue;
      const points=npcTrianglePoints(mesh.geometry,index);
      if(!npcSwimRoom(points,s)) continue;
      const z=npcSurfaceOf(points,pos);
      if(z===null) continue;
      const gap=Math.abs(pos[2]-z-(lift || 0));
      // A swimmer is anywhere between the bed and its depth, not on the bed.
      const fits=s.swims && lift===undefined ? pos[2]>=z-1 && pos[2]<=s.swimTop+1 :
        gap < (lift===undefined ? 96 : 2);
      if(fits && gap<best) { selected=ref;best=gap; }
    }
    return selected===null ? null : npcTriangleAt(slots[Math.floor(selected/32768)],selected%32768);
  }
  // The walkable point nearest pos in the bank's meshes, searched outward one
  // ring of 512-unit tiles at a time out to 8192 units (#2067). The game moves
  // an actor placed off its navmesh onto the nearest navmesh the same way.
  // A swimmer's point keeps its height, between the bed and its depth.
  // Sliced like the mesh work: step(begin) reads tiles until four ms have
  // gone, and says whether the search is finished.
  function search(bank,pos,s) {
    const tx=Math.floor(pos[0]/512),ty=Math.floor(pos[1]/512);
    let best=null,r=0,ring=[[0,0]],at=0,done=false;
    function next() {
      r++;ring=[];
      for(let d=-r;d<=r;d++) ring.push([d,-r],[d,r]);
      for(let d=-r+1;d<r;d++) ring.push([-r,d],[r,d]);
      at=0;
    }
    function step(begin) {
      while(!done && now()-begin<4) {
        if(at===ring.length) {
          if(r===16 || best && r*512>best.d) {done=true;break;}
          next();continue;
        }
        const [dx,dy]=ring[at++];
        for(const ref of tiles.refs(bank.tiles,tx+dx,ty+dy)) {
          const mesh=slots[Math.floor(ref/32768)],index=ref%32768;
          if(!bank.meshes.has(mesh.id) || !npcWalkable(npcTriangleFlags(mesh.geometry,index),s)) continue;
          const points=npcTrianglePoints(mesh.geometry,index);
          if(!npcSwimRoom(points,s)) continue;
          const on=npcNearestOn(points,pos);
          if(!on) continue;
          if(s.swims) on[2]=Math.max(on[2]+8,Math.min(pos[2],s.swimTop));
          const d=distance(pos,on);
          if(!best || d<best.d) best={d,pos:on,ref};
        }
      }
      return done;
    }
    function result() {
      return best && {d:best.d,pos:best.pos,node:npcTriangleAt(slots[Math.floor(best.ref/32768)],best.ref%32768)};
    }
    return {step,result};
  }
  function ensureBank(cell,pos) {
    const key=cell+':'+Math.floor(pos[0]/4096)+':'+Math.floor(pos[1]/4096);
    if(banks.has(key)) return banks.get(key);
    const ids=api.getNavmeshRecords(cell,pos);
    if(!cellTiles.has(cell)) cellTiles.set(cell,tiles.cell());
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
  // A triangle's links depend only on its own mesh and the meshes its
  // external edges lead to, so they are kept once every one of those was
  // loaded when they were read. Until then a link into a mesh still loading
  // is missing, and they are read again after the next mesh finishes. Reading
  // them all again at every finished mesh (#2032) made one background step's
  // route search reread up to 128 triangles, 20 to 47 ms on One while the
  // cast was being prepared. Each triangle's corners are read once here.
  function nodeLinks(n) {
    if(n.cachedLinks && (n.linksComplete || n.linksVersion===geometryVersion)) return n.cachedLinks;
    const links=[],mesh=sharedMeshes.get(n.mesh);
    if(!mesh) return links;
    const points=n.points,edges=n.edges,flags=n.flags;
    let complete=true;
    for(let e=0;e<3;e++) {
      const external=!!(flags&(1<<e));
      const edge=edges[e];
      const ext=external && npcExternal(mesh,edge);
      if(external && (!ext || ext.type!==0)) continue;
      const targetMesh=external ? sharedMeshes.get(ext.mesh) : mesh;
      if(!targetMesh) {complete=false;continue;}
      const other=npcTriangleAt(targetMesh,external ? ext.index : edge);
      if(!other || other===n) continue;
      const otherFlags=other.flags,corners=other.points;
      if(otherFlags&(8|32) || !npcHasGround(corners)) continue;
      const p=points[e],q=points[(e+1)%3];
      const oe=corners.findIndex((v,j)=>
        (distance(v,p)<0.1 && distance(corners[(j+1)%3],q)<0.1) ||
        (distance(v,q)<0.1 && distance(corners[(j+1)%3],p)<0.1));
      if(oe<0) continue;
      const oext=!!(otherFlags&(1<<oe)),otherEdge=other.edges[oe];
      const olink=oext && npcExternal(targetMesh,otherEdge);
      const reciprocal=oext ? olink && olink.type===0 && olink.mesh===n.mesh && olink.index===n.index :
        other.mesh===n.mesh && otherEdge===n.index;
      if(!reciprocal) continue;
      if(!links.some(l=>l.node===other)) links.push(Object.assign(Object.create(npcPortal),{node:other,source:n,edge:e}));
    }
    n.linksVersion=geometryVersion;n.linksComplete=complete;n.cachedLinks=links;return links;
  }
  // One slice of mesh work, inside the same cost, insertion and time budget.
  function work() {
    const job=meshWork.shift(),begin=now();
    if(!job) return;
    const {id}=job;
    try {
      if(!job.work && !job.mesh) job.work=npcReadMeshWork(id,api.lookupEspmRecordById(id),nodeLinks);
      let cost=0,insertions=0,done=false;
      while(cost<512 && insertions<512 && now()-begin<4) {
        if(!job.mesh) {
          const step=job.work.next();
          if(step.done) {
            // A reference packs the slot with a 15-bit triangle into 32 bits.
            if(slots.length>=131072) throw new Error('More than 131072 navigation meshes');
            job.mesh=step.value;job.mesh.slot=slots.length;slots.push(job.mesh);job.at=0;continue;
          }
          cost+=step.value.cost;continue;
        }
        if(job.at===job.mesh.count) {sharedMeshes.set(id,job.mesh);geometryVersion++;done=true;break;}
        const index=job.at++,geometry=job.mesh.geometry;cost++;
        if(npcTriangleFlags(geometry,index)&(8|32)) continue;
        const points=npcTrianglePoints(geometry,index);
        const xs=points.map(p=>Math.floor(p[0]/512)),ys=points.map(p=>Math.floor(p[1]/512));
        if((Math.max(...xs)-Math.min(...xs)+1)*(Math.max(...ys)-Math.min(...ys)+1)>256) continue;
        const ref=job.mesh.slot*32768+index;
        for(let x=Math.min(...xs);x<=Math.max(...xs);x++) for(let y=Math.min(...ys);y<=Math.max(...ys);y++) {
          tiles.add(cellTiles.get(job.cell),x,y,ref);insertions++;
        }
      }
      if(!done) {meshWork.unshift(job);return;}
    } catch(e) { report('NPC mesh '+id.toString(16)+' rejected: '+e); }
    job.complete=true;job.work=null;job.mesh=null;
    for(const bank of job.banks) finishMesh(bank,id);
    job.banks=[];
  }
  // The triangle this load uses for one the previous load handed over.
  function nodeAt(node) {
    const mesh=node && sharedMeshes.get(node.mesh);
    return mesh ? npcTriangleAt(mesh,node.index) : undefined;
  }
  return {banks,ensureBank,locate,search,nodeLinks,work,nodeAt,pending:()=>meshWork.length,
    meshes:sharedMeshes,cellTiles,tiles,slots,version:()=>geometryVersion,
    carry:()=>({banks,meshWork,sharedMeshes,meshEntries,cellTiles,slots,tiles:tiles.carry(),geometryVersion})};
}
function startSharedNpcServerRuntime(api, timers, now, report, population, options) {
  const invoke=Reflect.apply;
  const property = 'thornswoodNpcActivity';
  api.makeProperty(property, {isVisibleByOwner:false,isVisibleByNeighbors:false,updateOwner:'',updateNeighbor:''});
  /*
    WHAT THE PREVIOUS LOAD OF THE GAMEMODE KNEW (#3296). A gamemode reload
    keeps the engine, its actors and where they stand, and until 22 Oct 2026
    the new runtime still took every NPC back from nothing: a batch every 10
    ms, then each prepared again and its navigation read again, 3 min 50 s on
    dev in which the NPCs stood still. options.carry is what the old runtime's
    handover() gave instead, and this one goes on from it. The NPC SERVER
    STARTUP block passes it only when both loads have the same NPC code and
    the same catalogue, so its shape is this code's. It is data only:
    triangles are looked up again in this load's navigation, and the searches
    under way are started again, so no function of the old load is kept.
  */
  const carry = options && options.carry || null;
  const kept = carry || {actors:new Map(), preparing:[], owned:new Set(), unavailable:new Set(),
    reactions:new Map(), knownFactions:new Set(), npcTiles:new Map(), enrolled:new Set(), excluded:new Set(),
    policies:new Map(), held:new Map(), due:[], searching:[], cursor:0, total:0, loaded:0};
  const handles = new Set(), {actors, preparing, owned, unavailable, reactions, knownFactions} = kept;
  const navigation = createNpcNavigation({
    getNavmeshRecords:(...args)=>nativeCall('getNavmeshRecords',...args),
    lookupEspmRecordById:(...args)=>nativeCall('lookupEspmRecordById',...args)
  }, now, report, bank => {preparing.push(...bank.waiting);bank.waiting=[];}, carry && carry.navigation);
  const {banks, ensureBank, locate, search} = navigation;
  const {npcTiles, enrolled, excluded, policies} = kept;
  // Placed off walkable ground, waiting to be set down on it (#2067): out of
  // everybody's sight, or for an ambush once somebody comes near.
  const {held} = kept, AMBUSH_RANGE = 1024, AMBUSH_STEP = 256;
  // An NPC nobody can see that only wanders is stepped once in this long
  // (the first time at once) (#3181, Patrick's C on 22 Oct 2026: NPCs
  // nobody can see are updated less often, never paused). Before, every pass
  // over the cast stepped each of them as fast as its 4 ms a turn allowed,
  // about every 5 s: with nobody on, dev's 4,820 took about 59,000 moving
  // steps a minute on 22 Oct, and those steps (a native state read, a look
  // for a fight, a native move) were most of the 0.18 of a core dev's
  // JavaScript thread was busy. A 4 s turn, the first try, was no fewer.
  // Such a step covers up to UNSEEN_EVERY of walking, still no further than
  // the next point of its path; one somebody can see covers up to SEEN_STEP.
  // A fight or a flight nobody can see is stepped every BUSY_EVERY, as often
  // as nearTick steps one somebody can see. An NPC somebody can see is
  // stepped by nearTick, and looked at here again NEAR_RECHECK later.
  //
  // Each actor waits its turn in `due`, a heap ordered by when it is due, and
  // backgroundTick takes only the entries that are due. Until the second
  // dev profile on 22 Oct, a pass walked the whole cast in order and skipped
  // whoever was not due, so with 4,820 NPCs most of backgroundTick's 1,984
  // ms in 120 s went on looking at NPCs it then passed over.
  const UNSEEN_EVERY = 15000, SEEN_STEP = 4000, BUSY_EVERY = 100, NEAR_RECHECK = 1000;
  const {due} = kept;
  function queue(a,at) {
    let i=due.length;due.push(null);
    while(i>0) { const p=(i-1)>>1; if(due[p].at<=at) break; due[i]=due[p];i=p; }
    due[i]={a,at};
  }
  function unqueue() {
    const top=due[0],last=due.pop();
    if(due.length) {
      let i=0;
      for(;;) {
        const l=2*i+1,r=l+1;
        let c=l<due.length && due[l].at<last.at ? l : -1;
        if(r<due.length && due[r].at<(c<0 ? last.at : due[l].at)) c=r;
        if(c<0) break;
        due[i]=due[c];i=c;
      }
      due[i]=last;
    }
    return top;
  }
  let stopped=false,running=!options || options.suspended!==true,cursor=kept.cursor,total=kept.total,loaded=kept.loaded,nearCursor=0;
  const ready=[];
  let humans=new Map(),near=new Set(),nearOrder=[],moved=0,attacks=0,background=0,failed=0,lastReport=now();
  function schedule(fn, delay) {
    if (stopped) return;
    const callback=()=>{
      handles.delete(handle);
      if(stopped) return;
      if(!running) {ready.push(fn);return;}
      fn();
    };
    callback.npcRuntimeTask=fn.name;
    let handle;
    try {handle = timers.setTimeout(callback,delay);} catch(error) {stop();throw error;}
    handles.add(handle);
  }
  // meshTick, searchTick, prepareTick and nearTick run only while they have
  // work, and wake() starts whichever of them has some again (#3181). Each
  // used to set its next turn whatever it found, so on dev with nobody on and
  // 0 mesh jobs waiting, meshTick still woke every 2 ms and the other three
  // every 10 or 100 ms; in the 6:35 AM profile on 22 Oct 2026 that waking,
  // its timers and the minute line's count of each run were about 2.5 s of
  // the JavaScript thread's 15.5 s busy in 120 s. Everything that hands one
  // of them work calls wake(), and a task about to finish calls it too, so
  // work it found for another starts that one.
  const armed=new Set();
  function arm(fn,delay) {
    if(armed.has(fn)) return;
    armed.add(fn);schedule(fn,delay);
  }
  function wake() {
    if(navigation.pending()) arm(meshTick,2);
    if(searching.length) arm(searchTick,10);
    if(preparing.length) arm(prepareTick,10);
    if(nearOrder.length) arm(nearTick,100);
  }
  function stop() {
    stopped=true;ready.length=0;
    const ownedHandles=Array.from(handles);
    handles.clear();
    const errors=[];
    for(const h of ownedHandles) {try {timers.clearTimeout(h);} catch(error) {errors.push(error);}}
    if(errors.length) throw errors[0];
  }
  function start() {
    if(stopped) throw new Error('NPC runtime activation is revoked');
    if(running) return true;
    running=true;
    while(ready.length && !stopped) ready.shift()();
    return !stopped;
  }
  function nativeCall(method,...args) {
    if(stopped) throw new Error('NPC runtime activation is revoked');
    const fn=api[method];
    if(stopped) throw new Error('NPC runtime activation is revoked');
    const result=invoke(fn,api,args);
    // A native callback may replace this runtime before returning.
    if(stopped) throw new Error('NPC runtime activation is revoked');
    return result;
  }
  const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
  const tile=(cell,p)=>cell+':'+Math.floor(p[0]/512)+':'+Math.floor(p[1]/512);
  function indexActor(a) {
    const key=tile(a.cell,a.pos);
    if (a.tile===key) return;
    if (a.tile && npcTiles.has(a.tile)) {
      const old=npcTiles.get(a.tile); old.delete(a.id); if(!old.size) npcTiles.delete(a.tile);
    }
    if(!npcTiles.has(key)) npcTiles.set(key,new Set());
    npcTiles.get(key).add(a.id); a.tile=key;
  }
  function factionData(s) {
    s.factions=(s.factions || []).filter(f=>Number.isInteger(f.id) && f.rank>=0);
    const missing=s.factions.map(f=>f.id).filter(id=>!knownFactions.has(id));
    for (let i=0;i<missing.length;i+=128) {
      for(const r of nativeCall('getFactionReactions',missing.slice(i,i+128))) {
        if (r.reaction>=0 && r.reaction<=3) reactions.set(r.source+':'+r.target,r.reaction);
      }
    }
    missing.forEach(id=>knownFactions.add(id));
    return s;
  }
  function hostile(a,b) {
    let enemy=false,friend=false;
    for(const f of a.factions) for(const g of b.factions) {
      // Friendship and common membership suppress conflicting enemy entries.
      const r=reactions.get(f.id+':'+g.id);
      friend ||= f.id===g.id || r===2 || r===3;
      enemy ||= r===1;
    }
    if(friend || a.aggression===0) return false;
    return a.aggression===3 || (a.aggression===2 && !friend) || (a.aggression===1 && enemy);
  }
  function validState(s) {
    return s && Number.isInteger(s.cellOrWorld) && Array.isArray(s.pos) &&
      s.pos.length===3 && s.pos.every(Number.isFinite) && Array.isArray(s.rot) &&
      s.rot.length===3 && s.rot.every(Number.isFinite) && Number.isInteger(s.aggression) &&
      s.aggression>=0 && s.aggression<=3 && Number.isInteger(s.confidence) && s.confidence>=0 && s.confidence<=4 &&
      Number.isFinite(s.meleeReach) && s.meleeReach>=0 && Number.isFinite(s.meleeAllowance) &&
      s.meleeAllowance>=16 && s.meleeAllowance<=96;
  }
  function walkable(n,s) { return npcWalkable(n.flags,s) && npcSwimRoom(n.points,s); }
  // The engine's state knows a race can swim, not that it cannot walk; the
  // catalogue does (policy.swims), and where it was placed bounds its depth.
  function swimming(s,policy) {
    if(policy && policy.swims) {s.swims=true;s.swimTop=policy.top;}
    return s;
  }
  // Searches for the walkable point nearest a placement or a home, a few
  // tiles at a time on their own tick (#2067). The actor waits for its search.
  // A job is data, its kind saying what its result is for, so a reload can
  // hand it over (#3296).
  const {searching} = kept;
  function seek(job) {
    job.search=search(job.bank,job.from,job.state);
    searching.push(job);
  }
  function searchTick() {
    armed.delete(searchTick);
    const begin=now();
    while(searching.length && now()-begin<4) {
      const job=searching[0];
      if(!job.search.step(begin)) break;
      searching.shift();
      try { found(job,job.search.result()); } catch(e) { reject(job.id,e); }
    }
    wake();
  }
  function found(job,near) {
    const {id,state,saved,bank}=job,policy=policies.get(id);
    if(job.kind==='home') {
      if(near) policy.home=near.pos.slice();
      preparing.push(id);
      return;
    }
    if(!near) throw new Error('No walkable navigation within reach of the placed position');
    const ambush=!!(policy && policy.ambush);
    if(ambush && near.d>AMBUSH_STEP) throw new Error('Ambush placement with no floor within a step');
    if(outsideHome(policy,state.cellOrWorld,near.pos)) {policy.settled=true;policy.home=near.pos.slice();}
    held.set(id,{id,state,saved,bank,near,ambush});
  }
  // An actor set down further from its placement than its leash would never
  // move again, so its home becomes the walkable point nearest the placement:
  // the point it was set down on, found the same way at every start (#2067).
  // A home that only floats over or under walkable ground stays as authored.
  function outsideHome(policy,cell,pos) {
    return policy && !policy.settled && !(cell===policy.cell && distance(policy.home,pos)<=policy.leash);
  }
  function settleHome(id,bank,policy,s) {
    policy.settled=true;
    if(locate(bank,policy.home,s)) return false;
    seek({id,kind:'home',bank,from:policy.home,state:s});
    return true;
  }
  // Off walkable ground at its placement. An ambush waits there until somebody
  // comes near, then steps out; anything else is set down on the nearest
  // walkable point while nobody can see it. Nothing walkable in reach, or an
  // ambush further than a step from the floor (a pipe or a ceiling the game
  // empties by script), stays where the game put it.
  function strand(id,state,saved,bank) {
    seek({id,kind:'floor',bank,from:state.pos,state,saved});
  }
  function emerge(h) {
    const {id,state,saved,bank,near}=h;
    const a={id,cell:state.cellOrWorld,pos:state.pos.slice(),state,node:near.node,
      lift:near.pos[2]-npcSurface(near.node,near.pos),bank,approach:near.pos.slice(),
      path:[],dwell:0,last:now(),sequence:saved && Number.isInteger(saved.sequence) ? saved.sequence : id%997,
      mode:'ambient',savedMode:'ambient',target:0,policy:policies.get(id)};
    actors.set(id,a);queue(a,now());indexActor(a);
    nativeCall('set',id,property,{version:2,sequence:a.sequence,mode:'ambient',cell:a.cell});
  }
  // Runs right after humanTick has read where everybody is.
  function settleHeld() {
    const begin=now();
    for(const [id,h] of held) {
      if(now()-begin>=4) break;
      let seen=Infinity;
      for(const s of humans.values()) if(s.cellOrWorld===h.state.cellOrWorld) seen=Math.min(seen,distance(s.pos,h.state.pos));
      if(h.ambush ? seen>AMBUSH_RANGE : seen<=4096) continue;
      held.delete(id);
      try {
        if(h.ambush) emerge(h);
        else {
          nativeCall('set',id,'locationalData',{cellOrWorldDesc:nativeCall('getDescFromId',h.state.cellOrWorld),
            pos:h.near.pos.slice(),rot:h.state.rot.slice()});
          preparing.push(id);
        }
      } catch(e) {reject(id,e);}
    }
    wake();
  }
  function meshTick() {
    armed.delete(meshTick);
    navigation.work();
    wake();
  }
  function reject(id,error) {
    if(stopped) return;
    unavailable.add(id);failed=unavailable.size;
    // Navigation failure pauses activity, never hands a placed NPC to a client.
    // Native authority validation still rejects human identities and profiles.
    try {nativeCall('setNpcServerControlled',id,true);owned.add(id);nativeCall('stopNpcMovement',id);} catch(e) {}
    if(stopped) return;
    report('NPC '+id.toString(16)+' remains loaded; activity unavailable: '+error);
  }
  function prepareTick() {
    armed.delete(prepareTick);
    const begin=now();
    for(let i=0;i<4 && preparing.length && now()-begin<4;i++) {
      const entry=preparing.shift(),id=typeof entry==='number' ? entry : entry.id;
      try {
        const state=factionData(nativeCall('getNpcAIState',id));
        if(!validState(state) || state.isHuman) throw new Error('Invalid NPC state');
        if(population && !policies.has(id)) {
          const policy=population.configure(id,state,()=>!stopped);
          if(!policy) {excluded.add(id);continue;}
          if(!Array.isArray(policy.home) || policy.home.length!==3 || !policy.home.every(Number.isFinite) ||
              !Number.isInteger(policy.cell) || !Number.isFinite(policy.leash) || policy.leash<=0)
            throw new Error('Invalid NPC habitat policy');
          policies.set(id,policy);
        }
        if(!owned.has(id)) {
          nativeCall('setNpcServerControlled',id,true);
          if(population && population.afterOwnership) population.afterOwnership(id,()=>!stopped);
          owned.add(id);
        }
        const saved=nativeCall('get',id,property);
        swimming(state,policies.get(id));
        const bank=ensureBank(state.cellOrWorld,state.pos);
        if(!bank.ready) { bank.waiting.push({id,state,saved}); continue; }
        const node=locate(bank,state.pos,state);
        if(!node) { strand(id,state,saved,bank); continue; }
        // Set down beyond its leash at an earlier start (#2067).
        const policy=policies.get(id);
        if(outsideHome(policy,state.cellOrWorld,state.pos) && settleHome(id,bank,policy,state)) continue;
        const surface=npcSurface(node,state.pos),lift=state.pos[2]-surface;
        const a={id,cell:state.cellOrWorld,pos:state.pos.slice(),state,node,lift,bank,
          path:[],dwell:0,last:now(),sequence:saved && Number.isInteger(saved.sequence) ? saved.sequence : id%997,
          mode:'ambient',savedMode:'ambient',target:0,policy:policies.get(id)};
        actors.set(id,a);queue(a,now());indexActor(a);
        nativeCall('set',id,property,{version:2,sequence:a.sequence,mode:'ambient',cell:a.cell});
      } catch(e) { reject(id,e); }
    }
    wake();
  }
  function preload() {
    try {
      const batch=nativeCall('loadNpcBatch',cursor,1);
      if(!Number.isInteger(batch.nextCursor) || batch.nextCursor<cursor || batch.nextCursor>batch.total ||
          (batch.nextCursor===cursor && cursor!==batch.total)) throw new Error('Invalid NPC loading cursor');
      cursor=batch.nextCursor;total=batch.total;loaded+=batch.actorIds.length;
      for(const id of batch.actorIds) enroll(id);
      if(cursor<total) schedule(preload,10);
      else report('Shared NPC loading complete: '+loaded+' existing identities; cast preserved');
    } catch(e) { report('Shared NPC loading paused: '+e); }
  }
  function enroll(id) {
    if(enrolled.has(id) || excluded.has(id)) return;
    enrolled.add(id);preparing.push(id);wake();
  }
  function discover() {
    try {
      if(api.getLoadedNpcIds) {
        const ids=nativeCall('getLoadedNpcIds');
        if(population.reconcile) population.reconcile(ids);
        for(const id of ids) enroll(id);
      }
    } catch(e) {report('NPC identity refresh failed: '+e);}
    schedule(discover,5000);
  }
  // Where an actor stands over a navmesh point: its lift above the floor, and
  // a swimmer no higher than its depth. Home checks use this point, the one a
  // step sends, not the floor under it (#2072).
  function standAt(a,p) {
    const z=p[2]+a.lift;
    return [p[0],p[1],a.state && a.state.swims ? Math.min(z,a.state.swimTop) : z];
  }
  function withinHome(a,pos,cell=a.cell) {
    return !a.policy || cell===a.policy.cell && distance(a.policy.home,pos)<=a.policy.leash;
  }
  function humanTick() {
    const next=new Map();
    let everybody=true;
    try {
      for(const id of nativeCall('get',0,'onlinePlayers') || []) {
        try { const s=factionData(nativeCall('getNpcAIState',id)); if(validState(s) && !s.isDead && !s.isDisabled) next.set(id,s); }
        catch(e) { everybody=false;report('NPC observer state unavailable for '+id.toString(16)); }
      }
    } catch(e) { everybody=false;report('NPC observer list unavailable: '+e); }
    humans=next;near=new Set();
    // Nobody is set down unseen unless this tick knows where everybody is.
    if(everybody) settleHeld();
    for(const s of humans.values()) {
      const x=Math.floor(s.pos[0]/512),y=Math.floor(s.pos[1]/512);
      for(let dx=-8;dx<=8;dx++) for(let dy=-8;dy<=8;dy++) {
        for(const id of npcTiles.get(s.cellOrWorld+':'+(x+dx)+':'+(y+dy)) || []) {
          if(distance(actors.get(id).pos,s.pos)<=4096) near.add(id);
        }
      }
    }
    nearOrder=Array.from(near);nearCursor%=Math.max(1,nearOrder.length);wake();
    schedule(humanTick,1000);
  }
  function pathTo(a,targetNode,targetPos) {
    if(!withinHome(a,targetPos)) return null;
    if(a.node===targetNode) return [targetPos];
    const queue=[a.node],previous=new Map([[a.node,null]]);
    for(let i=0;i<queue.length && i<128;i++) {
      const n=queue[i];
      if(n===targetNode) {
        const edges=[];let at=n;
        while(previous.get(at)) {const edge=previous.get(at);edges.push(edge.middle);at=edge.from;}
        return edges.reverse().map(p=>p.map((v,j)=>v+(j===2 ? a.lift : 0))).concat([targetPos]);
      }
      for(const link of n.links) {
        if(!previous.has(link.node) && a.bank.meshes.has(link.node.mesh) && walkable(link.node,a.state) &&
            withinHome(a,standAt(a,link.middle)) && withinHome(a,standAt(a,link.node.center))) {
          previous.set(link.node,{from:n,middle:link.middle});queue.push(link.node);
        }
      }
    }
    return null;
  }
  function ambient(a) {
    const links=a.node.links.filter(l=>a.bank.meshes.has(l.node.mesh) && walkable(l.node,a.state) &&
      withinHome(a,standAt(a,l.middle)) && withinHome(a,standAt(a,l.node.center)));
    a.sequence++;
    if(links.length) {
      const link=links[(a.sequence+a.id)%links.length];
      const lifted=p=>p.map((v,j)=>v+(j===2 ? a.lift : 0));
      a.path=[lifted(link.middle),lifted(link.node.center)];
    } else {
      // A triangle interior is a safe route even without an outgoing edge.
      const corner=a.node.points[a.sequence%3];
      const p=a.node.center.map((v,j)=>v*0.75+corner[j]*0.25+(j===2 ? a.lift : 0));
      if(withinHome(a,p)) a.path=[p];
      else if(a.policy) {
        // A small home circle may fit wholly inside one large triangle.
        // Follow a short segment inside the current face and the home sphere.
        let origin=a.policy.home.slice();
        const homeSurface=npcSurface(a.node,origin);
        if(homeSurface!==null) origin[2]=homeSurface+a.lift;
        else {
          // Project the home onto this face. A saved position can be on the
          // adjacent face while still inside its home range.
          const candidates=a.node.points.map((v,i)=>{
            const first=v.map((n,j)=>n+(j===2 ? a.lift : 0));
            const next=a.node.points[(i+1)%3].map((n,j)=>n+(j===2 ? a.lift : 0));
            const edge=next.map((n,j)=>n-first[j]),size=edge.reduce((n,v)=>n+v*v,0);
            const fraction=Math.max(0,Math.min(1,edge.reduce((n,v,j)=>n+v*(origin[j]-first[j]),0)/Math.max(size,0.001)));
            return first.map((n,j)=>n+edge[j]*fraction);
          });
          origin=candidates.sort((x,y)=>distance(x,a.policy.home)-distance(y,a.policy.home))[0];
        }
        // Vertical projection on a slope can leave the home sphere. The
        // current position is already on this face and inside the leash.
        if(!withinHome(a,origin)) origin=a.pos.slice();
        const delta=p.map((v,j)=>v-origin[j]);
        let low=0,high=1;
        for(let i=0;i<20;i++) {
          const mid=(low+high)/2,point=origin.map((v,j)=>v+delta[j]*mid);
          if(withinHome(a,point)) low=mid;else high=mid;
        }
        const local=origin.map((v,j)=>v+delta[j]*low*0.5);
        local[2]=npcSurface(a.node,local)+a.lift;
        a.path=withinHome(a,local) ? [local] : [];
      }
    }
  }
  function update(a,longest) {
    const at=now(),elapsed=Math.min(longest,Math.max(0,at-a.last));a.last=at;
    const s=swimming(factionData(nativeCall('getNpcAIState',a.id)),a.policy);
    if(!validState(s)) throw new Error('Invalid live state');
    a.state=s;
    if(s.isDead || s.isDisabled || s.immobile) {
      if(!a.paused) nativeCall('stopNpcMovement',a.id);
      a.paused=true;a.path=[];a.target=0;return;
    }
    a.paused=false;
    if(!withinHome(a,s.pos,s.cellOrWorld)) {
      nativeCall('stopNpcMovement',a.id);a.paused=true;a.path=[];a.target=0;return;
    }
    if(a.approach) {
      // An ambush stepping out of its alcove onto the floor beside it, in a
      // straight line at walking pace (#2067). It joins the cast on arrival.
      if(s.cellOrWorld!==a.cell) throw new Error('Ambush moved to another cell before reaching the floor');
      const from=s.pos.slice(),d=distance(from,a.approach),step=Math.min(d,60*elapsed/1000);
      const pos=d>0.001 ? from.map((v,j)=>v+(a.approach[j]-v)*step/d) : a.approach.slice();
      const delta=pos.map((v,j)=>v-from[j]);
      nativeCall('updateNpcMovement',a.id,pos,step>0 ? [0,0,Math.atan2(delta[0],delta[1])*180/Math.PI] : s.rot,step>0 ? 60 : 0);
      if(step>0) moved++;
      a.pos=pos;
      if(step>=d) a.approach=null;
      indexActor(a);
      return;
    }
    if(s.cellOrWorld!==a.cell || distance(s.pos,a.pos)>2) {
      const bank=ensureBank(s.cellOrWorld,s.pos);wake();
      const node=bank.ready && locate(bank,s.pos,s);
      if(!node) throw new Error('Displaced outside prepared local navigation');
      a.cell=s.cellOrWorld;a.bank=bank;a.node=node;a.pos=s.pos.slice();
      a.lift=s.pos[2]-npcSurface(node,s.pos);a.path=[];a.target=0;indexActor(a);
    }
    // A swimmer aims at each point no higher than its depth (#2067).
    const aim=p=>s.swims ? [p[0],p[1],Math.min(p[2],s.swimTop)] : p;
    let target=0,targetState=null,retaliation=false;
    if(s.combatTarget && (humans.has(s.combatTarget) || actors.has(s.combatTarget))) {
      target=s.combatTarget;
      retaliation=true;
      targetState=humans.get(target) || actors.get(target).state;
    } else {
      let best=1200;
      for(const [id,h] of humans) {
        const d=h.cellOrWorld===a.cell ? distance(h.pos,a.pos) : Infinity;
        if(d<best && hostile(s,h)) {target=id;targetState=h;best=d;}
      }
      // NPC combat uses the same spatial index when nobody is connected.
      // Inspect a bounded local sample rather than comparing the full cast.
      const x=Math.floor(a.pos[0]/512),y=Math.floor(a.pos[1]/512);
      let inspected=0;
      search: for(let dx=-2;dx<=2;dx++) for(let dy=-2;dy<=2;dy++) {
        for(const id of npcTiles.get(a.cell+':'+(x+dx)+':'+(y+dy)) || []) {
          if(id===a.id) continue;
          const other=actors.get(id);
          if(!other || other.state.isDead || other.state.isDisabled) continue;
          const d=distance(other.pos,a.pos);
          if(d<best && hostile(s,other.state)) {target=id;targetState=other.state;best=d;}
          if(++inspected>=32) break search;
        }
      }
    }
    if(targetState && (targetState.isDead || targetState.isDisabled || targetState.cellOrWorld!==a.cell ||
        distance(a.pos,targetState.pos)>4096 || !withinHome(a,targetState.pos))) {target=0;targetState=null;}
    if(targetState) {
      try {
        const live=nativeCall('getNpcAIState',target);
        if(!validState(live) || live.isDead || live.isDisabled || (live.isHuman && !live.isConnected) || live.cellOrWorld!==a.cell ||
            distance(a.pos,live.pos)>4096 || !withinHome(a,live.pos)) {target=0;targetState=null;}
        else if(!retaliation && !hostile(s,factionData(live))) {target=0;targetState=null;}
        else targetState=live;
      } catch(e) {target=0;targetState=null;}
    }
    if(targetState) {
      // A shared edge may fit both reciprocal triangles. Prefer the current
      // safe face so tiny height/float differences cannot leave a zero-length
      // route waiting forever for a triangle transition that never happens.
      const currentSurface=npcSurface(a.node,targetState.pos);
      const tn=currentSurface!==null && Math.abs(targetState.pos[2]-currentSurface)<96 && walkable(a.node,s) ?
        a.node : locate(a.bank,targetState.pos,s);
      const destination=tn && [targetState.pos[0],targetState.pos[1],npcSurface(tn,targetState.pos)+a.lift];
      const attackDistance=Math.max(0,Math.min(300,s.meleeReach+targetState.meleeAllowance)-2);
      const reachable=s.confidence===0 || s.meleeReach>0 && destination &&
        Math.abs(destination[2]-targetState.pos[2])<=attackDistance;
      const route=tn && reachable && pathTo(a,tn,destination);
      if(route) {
        const flee=s.confidence===0;
        a.mode=flee ? 'flee' : 'combat';a.target=target;
        if(flee) {
          const links=a.node.links.filter(l=>a.bank.meshes.has(l.node.mesh) && walkable(l.node,s) &&
            withinHome(a,standAt(a,l.middle)) && withinHome(a,standAt(a,l.node.center))).sort((x,y)=>
            distance(y.node.center,targetState.pos)-distance(x.node.center,targetState.pos));
          if(links.length) a.path=[links[0].middle.map((v,j)=>v+(j===2?a.lift:0)),
            links[0].node.center.map((v,j)=>v+(j===2?a.lift:0))];
          else {
            const safe=a.node.points.map(p=>p.map((v,j)=>v*0.6+a.node.center[j]*0.4+(j===2?a.lift:0)))
              .filter(p=>withinHome(a,p)).sort((p,q)=>distance(q,targetState.pos)-distance(p,targetState.pos));
            if(safe.length) a.path=[safe[0]];else ambient(a);
          }
        } else {
          // Route points the actor already stands on are behind it. With none
          // left it has arrived beside the target, which reachable above has
          // put within attack distance. Its triangle need not be the target's:
          // a destination on the edge the two share is reached without ever
          // entering the target's triangle, and the engine's 32-bit copy of a
          // point on that edge can fall just outside the actor's own (#2032:
          // 526e9 and 526ea stood on an edge middle beside their targets and
          // neither moved nor attacked for the whole two minutes).
          const ahead=route.slice();
          while(ahead.length && distance(a.pos,aim(ahead[0]))<0.01) ahead.shift();
          if(!ahead.length || a.node===tn && distance(a.pos,targetState.pos)<=attackDistance) {
            a.path=[];
            if(nativeCall('serverNpcAttack',a.id,target)) attacks++;
          } else a.path=ahead;
        }
      } else {target=0;targetState=null;}
    }
    if(!targetState) {
      if(a.target) {a.path=[];a.dwell=0;}
      a.mode='ambient';a.target=0;
      if(!a.path.length && at>=a.dwell) ambient(a);
    }
    let pos=a.pos.slice(),speed=0;
    while(a.path.length && distance(a.pos,aim(a.path[0]))<0.01) a.path.shift();
    if(a.path.length && at>=a.dwell) {
      const point=aim(a.path[0]),d=distance(pos,point),step=Math.min(d,60*elapsed/1000);
      if(d>0.001 && step>0) {pos=pos.map((v,j)=>v+(point[j]-v)*step/d);speed=60;}
      if(d<=0.001 || step>=d) {a.path.shift();if(!a.path.length && a.mode==='ambient') a.dwell=at+2000+(a.id%5)*1000;}
    }
    // Overlapping floors can contain the same point. Retain the current
    // triangle or a verified neighbor instead of selecting an unrelated one.
    const options=[a.node,...a.node.links.filter(l=>a.bank.meshes.has(l.node.mesh)).map(l=>l.node)];
    const node=options.find(n=>walkable(n,s) && npcSurface(n,pos)!==null &&
      (s.swims || Math.abs(pos[2]-npcSurface(n,pos)-a.lift)<2));
    // A swimmer keeps its height over the bed, never above its depth.
    if(node && s.swims) pos[2]=Math.min(npcSurface(node,pos)+a.lift,s.swimTop);
    if(!withinHome(a,pos)) throw new Error('Movement would leave the home leash');
    if(!node || (node!==a.node && !a.node.links.some(l=>l.node===node))) {
      throw new Error('Movement crossed an unverified navigation edge');
    }
    const delta=pos.map((v,j)=>v-a.pos[j]);
    const rot=speed ? [0,0,Math.atan2(delta[0],delta[1])*180/Math.PI] : s.rot;
    nativeCall('updateNpcMovement',a.id,pos,rot,speed);
    if(speed) moved++;
    a.pos=pos;a.node=node;indexActor(a);
    // Written when it means something, a fight or a flight starting or
    // ending, not as it wanders (#3180). Each write saves the actor's whole
    // record durably, and until 22 Oct 2026 every NPC was written every 30
    // seconds: about 5,000 files every 32 seconds on each server, 640 KB/s,
    // with nobody on. An NPC that only wanders starts after a restart where
    // it was last written, inside its home.
    if(a.mode!==a.savedMode) {
      nativeCall('set',a.id,property,{version:2,sequence:a.sequence,mode:a.mode,cell:a.cell});a.savedMode=a.mode;
    }
  }
  function step(id,longest=SEEN_STEP) {
    const a=actors.get(id);
    if(!a) return;
    try {update(a,longest);} catch(e) {
      reject(id,e);actors.delete(id);
      if(a.tile && npcTiles.has(a.tile)) npcTiles.get(a.tile).delete(id);
    }
  }
  function backgroundTick() {
    const begin=now();let taken=0,moves=0;
    while(due.length && taken<256 && moves<64) {
      const at=now();
      if(at-begin>=4 || due[0].at>at) break;
      const {a}=unqueue(),id=a.id;taken++;
      // Let go by its last step (step's catch): its turn goes with it.
      if(actors.get(id)!==a) continue;
      // A newly connected observer might precede the next spatial refresh.
      if(near.has(id) || Array.from(humans.values()).some(s=>s.cellOrWorld===a.cell && distance(s.pos,a.pos)<=4096)) {
        queue(a,at+NEAR_RECHECK);continue;
      }
      step(id,a.mode==='ambient' ? UNSEEN_EVERY : SEEN_STEP);moves++;background++;
      if(actors.get(id)===a) queue(a,now()+(a.mode==='ambient' ? UNSEEN_EVERY : BUSY_EVERY));
    }
    if(now()-lastReport>=60000) {
      report('Shared NPC activity: '+owned.size+' server owned, '+actors.size+' active, '+loaded+' loaded, '+failed+' stationary, '+(held.size+searching.length)+' waiting off walkable ground; '+
        moved+' movement steps, '+background+' background steps, '+attacks+' accepted attacks, '+navigation.pending()+' mesh jobs pending; '+
        'background work continues without connections');
      const merchantStatus=population && population.merchantStats && population.merchantStats();
      if(merchantStatus) report('NPC merchant purses: '+merchantStatus.verified+'/'+merchantStatus.catalogue+
        ' verified; '+merchantStatus.initialized+' first-time purses; '+((globalThis.__thornswoodMerchantTrade&&globalThis.__thornswoodMerchantTrade.nativeReady())?'native transfer present':'native transfer absent'));
      moved=0;background=0;attacks=0;lastReport=now();
    }
    schedule(backgroundTick,20);
  }
  function nearTick() {
    armed.delete(nearTick);
    const begin=now();
    for(let i=0;i<Math.min(32,nearOrder.length) && now()-begin<4;i++) step(nearOrder[nearCursor++%nearOrder.length]);
    wake();
  }
  // Carried on from the previous load (#3296): each triangle an actor or a
  // held placement stands on is this load's object for it, and each search
  // starts again. One whose mesh is gone is prepared again from the start.
  // Every NPC already owned has its merchant purse read by this load's purse
  // service, as afterOwnership did when it was first owned; nothing else of
  // ownership is done again, because the engine kept it.
  const resuming=[];
  if(carry) {
    const again=id=>{if(!preparing.includes(id)) preparing.push(id);};
    for(const [id,a] of actors) {
      const node=navigation.nodeAt(a.node);
      if(node) {a.node=node;continue;}
      actors.delete(id);
      if(a.tile && npcTiles.has(a.tile)) npcTiles.get(a.tile).delete(id);
      again(id);
    }
    for(const [id,h] of held) {
      const node=navigation.nodeAt(h.near.node);
      if(node) {h.near.node=node;continue;}
      held.delete(id);again(id);
    }
    for(const job of searching) job.search=search(job.bank,job.from,job.state);
    if(population && population.resume) resuming.push(...owned);
    report('Shared NPC runtime carried on from the previous gamemode load: '+actors.size+' active, '+loaded+
      ' loaded, '+(held.size+searching.length)+' waiting off walkable ground, '+preparing.length+' preparing, '+
      navigation.pending()+' mesh jobs pending'+(cursor===total && total>0 ? '; loading complete' : '; loading continues'));
  }
  function resumeTick() {
    const begin=now();
    while(resuming.length && now()-begin<4) {
      const id=resuming.shift();
      // A purse that fails stops its NPC, as it would have at first ownership.
      try {population.resume(id,()=>!stopped);} catch(e) {idle(id);reject(id,e);}
    }
    if(resuming.length) schedule(resumeTick,10);
  }
  if(!carry || cursor<total || total===0) schedule(preload,0);
  arm(prepareTick,10);arm(meshTick,10);
  schedule(humanTick,0);schedule(backgroundTick,20);arm(nearTick,100);arm(searchTick,10);
  if(resuming.length) schedule(resumeTick,0);
  if(population) schedule(discover,5000);
  /*
    LETS GO OF AN ACTOR THAT IS ABOUT TO BE DESTROYED (#2623). Nothing about
    it may stay here: not its activity, its turn in `due` or its place on the
    map tiles, its policy, or the excluded and enrolled marks, so the runtime
    never steps or reports on an actor that is gone.
  */
  function forget(id) {
    idle(id);
    policies.delete(id);owned.delete(id);unavailable.delete(id);enrolled.delete(id);excluded.delete(id);
    failed=unavailable.size;
  }
  // Takes an actor out of everything that would step it, set it down or
  // prepare it, and keeps what is known about it.
  function idle(id) {
    const a=actors.get(id);
    if(a && a.tile && npcTiles.has(a.tile)) npcTiles.get(a.tile).delete(id);
    actors.delete(id);held.delete(id);near.delete(id);
    const without=list=>{for(let i=list.length-1;i>=0;i--) {
      const entry=list[i],entryId=typeof entry==='number' ? entry : entry && entry.id;
      if(entryId===id) list.splice(i,1);
    }};
    // The rest of the heap, sorted by when each is due, is a heap again.
    if(due.some(e=>e.a.id===id)) {
      const rest=due.filter(e=>e.a.id!==id).sort((x,y)=>x.at-y.at);
      due.length=0;for(const e of rest) due.push(e);
    }
    without(nearOrder);without(preparing);without(searching);
    for(const bank of banks.values()) if(bank && Array.isArray(bank.waiting)) without(bank.waiting);
  }
  /*
    STOPS, AND GIVES THE NEXT LOAD OF THE GAMEMODE WHAT THIS ONE KNOWS (#3296),
    for options.carry. Everything in it is data; the searches under way are
    given as what they look for, not as the search itself. Null once stopped.
  */
  function handover() {
    if(stopped) return null;
    stop();
    return {key:options && options.key,actors,preparing,owned,unavailable,reactions,knownFactions,npcTiles,
      enrolled,excluded,policies,held,due,cursor,total,loaded,
      searching:searching.map(({id,kind,bank,from,state,saved})=>({id,kind,bank,from,state,saved})),
      navigation:navigation.carry()};
  }
  return {stop,start,enroll,forget,handover,getHeldIds:()=>[...held.keys(),...searching.map(job=>job.id)],getActorStatus:id=>{const a=actors.get(id);return a && {
    mode:a.mode,target:a.target,pos:a.pos.slice(),path:a.path.map(p=>p.slice()),
    triangle:a.node.index,mesh:a.node.mesh,lastUpdate:a.last,paused:!!a.paused};},
    getStatus:()=>({loaded,controlled:owned.size,active:actors.size,unavailable:failed,held:held.size+searching.length,
    preparing:preparing.length+Array.from(banks.values()).reduce((n,b)=>n+b.waiting.length,0),
    pendingMeshes:navigation.pending(),loadingComplete:cursor===total && total>0})};
}
// NPC SERVER RUNTIME END

