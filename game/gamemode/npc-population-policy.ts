// NPC POPULATION POLICY BEGIN
/*
  THALMOR PATROLS (#1390). docs/systems/thalmor.md: "A patrol is 2 to 4. They
  are on the roads between holds. They do not spawn inside a walled city. At
  most 3 patrols in the province at once, and only one on a given road."

  Which roads, how many on each, how long a dead one takes to come back, how
  far one strays and whether any patrol is out at all are staff settings in
  game/data/thalmor-patrols.json, never code. thalmorPatrolTable checks that
  file and answers the roads that may stand: on, in Tamriel, clear of every
  walled town and village, 2 to 4 points each, and no more roads than
  thalmorPatrolCap. A road that fails is refused with its reason and the rest
  still stand. A file that is not version 1, or has a setting out of range, is
  thrown out whole, and then nothing is stood up or taken down.

  WALLED TOWNS. A city worldspace is not Tamriel, so the world check keeps a
  patrol out of every walled city with its own worldspace. A town or village
  on Tamriel's own ground is known by the catalogue's kept city placements
  (traders and the few town animals, habitat city): no point of a road may be
  closer to one than THALMOR_PATROL_CITY_CLEARANCE plus the road's leash, so
  a member never strays into the street either.
*/
const THALMOR_PATROL_WORLD='3c:Skyrim.esm';
const THALMOR_PATROL_CITY_CLEARANCE=8192;
// The one place the province cap is read (#2697). Staff may give a cap for
// each world stage in the same file (stageMost, by stage id); the patrol
// keeper reads the current stage from the world stage register (#2685) and
// hands it in as table.stage. With no stage, no register, or no entry for the
// stage, the cap is the plain most. Code names no stage and no number.
function thalmorPatrolCap(table) {
  if(typeof table.stage==='string' && table.stageMost &&
      Object.prototype.hasOwnProperty.call(table.stageMost,table.stage)) return table.stageMost[table.stage];
  return table.most;
}
function thalmorPatrolTable(doc,keep,stage) {
  const desc=/^[0-9a-f]{1,8}:[^:\\/]+\.es[mpl]$/i;
  const whole=(v,lo,hi)=>Number.isInteger(v) && v>=lo && v<=hi;
  if(!doc || typeof doc!=='object' || Array.isArray(doc) || doc.version!==1 ||
      typeof doc.on!=='boolean' || !Array.isArray(doc.roads))
    throw new Error('thalmor-patrols.json needs version 1, on and roads');
  const most=doc.most===undefined ? 3 : doc.most;
  const returnMinutes=doc.returnMinutes===undefined ? 45 : doc.returnMinutes;
  const leash=doc.leash===undefined ? 1536 : doc.leash;
  const tier=doc.tier===undefined ? null : doc.tier;
  if(!whole(most,0,10) || !whole(returnMinutes,1,1440) || !whole(leash,256,8192) ||
      !(tier===null || whole(tier,0,5)))
    throw new Error('thalmor-patrols.json has most, returnMinutes, leash or tier out of range');
  const stageMost=doc.stageMost===undefined ? {} : doc.stageMost;
  if(!stageMost || typeof stageMost!=='object' || Array.isArray(stageMost) ||
      !Object.keys(stageMost).every(k=>/^[a-z0-9-]{1,32}$/.test(k) && whole(stageMost[k],0,10)))
    throw new Error('thalmor-patrols.json has a stageMost that is not stage ids with a cap of 0 to 10');
  const towns=(Array.isArray(keep) ? keep : []).filter(r=>Array.isArray(r) && r[7]==='city' &&
    r[2]===THALMOR_PATROL_WORLD && Array.isArray(r[3]) && r[3].length===3);
  const table={on:doc.on,most,stageMost:Object.assign({},stageMost),
    stage:typeof stage==='string' && stage ? stage : null,roads:[],refused:[]},seen=new Set();
  for(const r of doc.roads) {
    const id=r && typeof r.id==='string' ? r.id : '';
    const refuse=why=>table.refused.push({id:id || '?',why});
    if(!/^[a-z0-9-]{1,32}$/.test(id) || seen.has(id)) {refuse('needs an id of its own: lower case letters, digits and dashes');continue;}
    seen.add(id);
    if(typeof r.on!=='boolean') {refuse('needs on, true or false');continue;}
    if(r.world!==THALMOR_PATROL_WORLD) {refuse('is not on Tamriel\'s roads ('+THALMOR_PATROL_WORLD+')');continue;}
    if(!Array.isArray(r.points) || r.points.length<2 || r.points.length>4 ||
        !r.points.every(p=>Array.isArray(p) && p.length===3 && p.every(Number.isFinite)))
      {refuse('needs 2 to 4 points, one for each of the patrol');continue;}
    if(!Array.isArray(r.bases) || r.bases.length!==r.points.length ||
        !r.bases.every(b=>typeof b==='string' && desc.test(b)))
      {refuse('needs one base, an NPC record as a descriptor, for each point');continue;}
    const back=r.returnMinutes===undefined ? returnMinutes : r.returnMinutes;
    const reach=r.leash===undefined ? leash : r.leash;
    if(!whole(back,1,1440) || !whole(reach,256,8192)) {refuse('has returnMinutes or leash out of range');continue;}
    const town=towns.find(t=>r.points.some(p=>Math.hypot(p[0]-t[3][0],p[1]-t[3][1])<THALMOR_PATROL_CITY_CLEARANCE+reach));
    if(town) {refuse('has a point in or beside a walled town or village (near '+town[0]+')');continue;}
    if(!r.on || !doc.on) continue;
    if(table.roads.length>=thalmorPatrolCap(table)) {refuse('is over the province cap of '+thalmorPatrolCap(table));continue;}
    table.roads.push({id,name:typeof r.name==='string' ? r.name.slice(0,80) : id,bases:r.bases.slice(),
      points:r.points.map(p=>p.slice()),returnMinutes:back,leash:reach,tier});
  }
  return table;
}
function createNpcPopulation(api,data,plugins,merchants,options) {
  const invoke=Reflect.apply;
  if(data.version!==1 || JSON.stringify(data.plugins)!==JSON.stringify(plugins))
    throw new Error('NPC population catalogue does not match the installed load order');
  const allowed=new Map(),byBase=new Map(),configured=new Map(),counts=new Map();
  const resolve=(desc,call)=>{
    const id=typeof call==='function' ? call('getIdFromDesc',desc) : api.getIdFromDesc(desc);
    if(!Number.isInteger(id) || id<=0) throw new Error('Unresolved NPC catalogue identity: '+desc);
    return id;
  };
  // No cut list (#2468). Every placed actor the catalogue cuts is switched
  // off at the record by Thornswood-Last.esp, the last plugin in this
  // server's load order, and the engine never makes a reference that is
  // initially disabled (WorldState::AttachEspmRecord), saved forms included.
  // The list that was handed to setNpcPlacementExclusions here did the same
  // job for the server only; each person's game drew those actors until its
  // world cleaner removed them, which was the flash.
  for(const row of data.keep) {
    const id=resolve(row[0]),base=resolve(row[1]),cell=resolve(row[2]);
    if(!Array.isArray(row[3]) || row[3].length!==3 || !row[3].every(Number.isFinite) ||
        !Number.isInteger(row[5]) || row[5]<=0 || row[5]>1440 || !(row[4]>0))
      throw new Error('Invalid NPC catalogue placement');
    if((row[6]==='transport' || row[13]!==undefined) &&
        !(row[6]==='transport' && ['Coach Driver','Ferry Operator','Ship Captain'].includes(row[13])) &&
        !(row[6]==='trader' && ['Smith','Woodworker','Tailor','Enchanter','Cook','Alchemist'].includes(row[13]) &&
          data.merchantRoles && Object.prototype.hasOwnProperty.call(data.merchantRoles,row[0]) &&
          data.merchantRoles[row[0]]===row[13]))
      throw new Error('Invalid NPC role title');
    const rule={row,id,base,cell,bucket:row[10] || row[0]};
    allowed.set(id,rule);
    if(!byBase.has(base)) byBase.set(base,[]);
    byBase.get(base).push(rule);
    counts.set(rule.bucket,(counts.get(rule.bucket)||0)+1);
  }
  // What the previous load of the gamemode had decided (#3296), from its
  // handover(): each NPC's rule and policy, and the habitat counts that
  // include them. The NPC SERVER STARTUP block passes it only when both loads
  // have the same NPC code and catalogue. The policies are the same objects
  // the runtime's carry holds, so a home it moves is moved in both.
  const carried=options && options.carry;
  if(carried) {
    counts.clear();
    for(const [bucket,count] of carried.counts) counts.set(bucket,count);
    for(const [id,entry] of carried.configured) configured.set(id,entry);
  }
  api.makeProperty('thornswoodNpcHome',{isVisibleByOwner:false,isVisibleByNeighbors:false,updateOwner:'',updateNeighbor:''});
  api.makeProperty('thornswoodNpcCommanded',{isVisibleByOwner:false,isVisibleByNeighbors:false,updateOwner:'',updateNeighbor:''});
  // A Thalmor patrol member (#1390) carries {road, slot}, set by the patrol
  // keeper before admission. Never the commanded marker: a patrol is not a
  // staff spawn, and it never joins a natural habitat bucket either.
  api.makeProperty('thornswoodNpcPatrol',{isVisibleByOwner:false,isVisibleByNeighbors:false,updateOwner:'',updateNeighbor:''});
  const patrolSlots=new Map(carried ? carried.patrolSlots : []);
  // The rule for a patrol member, from the staff's road: its home is its own
  // point, its leash and return are the road's, its bucket is the road, capped
  // at the road's points, so there is only one group on a road. 'discard'
  // takes it out of the world: its road is off, gone or over the province cap,
  // its slot is past the road's points or already filled, or staff changed the
  // record for that point. With no readable table nothing is decided: it stays
  // switched off and nothing is deleted. A held table (the keeper could not
  // read the world stage, so this stage's cap is not known) keeps what stands:
  // a member that is its road's, slot's and record's own is admitted with no
  // cap, and anything else stays switched off, never deleted.
  function patrolRule(id,mark,base,call) {
    const table=options && typeof options.patrols==='function' ? options.patrols() : null;
    if(!table || !Array.isArray(table.roads)) return null;
    const out=table.hold===true ? null : 'discard';
    const road=table.roads.find(r=>r.id===mark.road);
    if(!road || !Number.isInteger(mark.slot) || mark.slot<0 || mark.slot>=road.points.length) return out;
    let wanted=0;
    try {wanted=resolve(road.bases[mark.slot],call);} catch(e) {return null;}
    if(wanted!==base) return out;
    const key=road.id+'#'+mark.slot,holder=patrolSlots.get(key);
    if(holder!==undefined && holder!==id) return out;
    const up=new Set([...patrolSlots.keys()].map(k=>k.split('#')[0]));
    if(table.hold!==true && !up.has(road.id) && up.size>=thalmorPatrolCap(table)) return 'discard';
    return {cell:resolve(THALMOR_PATROL_WORLD,call),patrol:key,bucket:'patrol:'+road.id,
      row:[null,road.bases[mark.slot],THALMOR_PATROL_WORLD,road.points[mark.slot].slice(),road.leash,
        road.returnMinutes,'enemy','road',road.tier,road.points.length,'patrol:'+road.id,0,'highelf']};
  }
  let committed=false,closed=false,attempted=false;
  function commit() {
    if(closed) throw new Error('NPC population activation is revoked');
    if(committed) return true;
    if(attempted) throw new Error('NPC population commit was already attempted');
    attempted=true;
    committed=true;
    return true;
  }
  if(!options || options.suspended!==true) commit();
  // A population can outlive one caller. Fence that caller without revoking
  // the shared population or purse service used by its successor.
  function whileCurrent(owner,fallback,work) {
    const revoked={};
    const current=()=>committed && !closed && (!owner || owner());
    function check() {if(!current()) throw revoked;}
    function call(method,...args) {
      check();
      const fn=api[method];
      check();
      const result=invoke(fn,api,args);
      check();
      return result;
    }
    if(!current()) return fallback;
    try {const result=work(call,current);return current() ? result : fallback;}
    catch(error) {if(error===revoked || !current()) return fallback;throw error;}
  }
  function configure(id,state,owner) {
    return whileCurrent(owner,null,(call)=>configureCurrent(id,state,call));
  }
  function configureCurrent(id,state,call) {
    if(!committed || closed) return null;
    if(state.isHuman) return null;
    if(configured.has(id)) return configured.get(id).policy;
    let rule=allowed.get(id),home;
    if(!rule && id>=0xff000000) {
      const base=resolve(call('get',id,'baseDesc'),call);
      const saved=call('get',id,'thornswoodNpcHome');
      const validHome=saved && Number.isInteger(saved.cell) && Array.isArray(saved.home) &&
        saved.home.length===3 && saved.home.every(Number.isFinite);
      const anchor=validHome ? saved.home : state.pos,cell=validHome ? saved.cell : state.cellOrWorld;
      // A Thalmor patrol member (#1390): its road and slot decide, never a
      // habitat row or the spawn command's marker.
      const patrolMark=call('get',id,'thornswoodNpcPatrol');
      const patrolled=!!patrolMark && typeof patrolMark==='object' && typeof patrolMark.road==='string';
      if(patrolled) {
        const verdict=patrolRule(id,patrolMark,base,call);
        if(verdict==='discard') {
          if(options && typeof options.discard==='function') options.discard(id);
          return null;
        }
        rule=verdict;
      }
      // The spawn command's marker (#2623): {keep:true} for one staff kept,
      // {run} for a temporary one, and plain true from before that split,
      // which nobody chose to keep.
      const marker=patrolled ? null : call('get',id,'thornswoodNpcCommanded');
      const commanded=marker===true || (!!marker && typeof marker==='object' &&
        (marker.keep===true || typeof marker.run==='string'));
      const kept=commanded && marker!==true && marker.keep===true;
      if(commanded && !kept && !(options && typeof options.run==='string' && marker.run===options.run)) {
        // A temporary spawn from an earlier run of the server, standing
        // because it never died. It is not admitted, and the gamemode takes
        // it out of the world (removeSpawned) after this returns.
        if(options && typeof options.discard==='function') options.discard(id);
        return null;
      }
      if(commanded && Number.isInteger(cell) && cell>0 && Array.isArray(anchor) &&
          anchor.length===3 && anchor.every(Number.isFinite)) {
        // Only trusted spawn commands set this private marker. They keep
        // authority and a saved home without joining a natural habitat cap.
        rule={cell,commanded:true,keep:kept,row:[null,base,call('getDescFromId',cell),anchor,1024,45,null,null,0]};
      } else if(!commanded && !patrolled) rule=(byBase.get(base)||[]).filter(r=>r.cell===cell &&
        (!saved || !saved.source || saved.source===r.row[0]) &&
        Math.hypot(...r.row[3].map((v,j)=>v-anchor[j]))<=r.row[4])
        .sort((a,b)=>Math.hypot(...a.row[3].map((v,j)=>v-anchor[j]))-
          Math.hypot(...b.row[3].map((v,j)=>v-anchor[j])))[0];
      if(rule && !rule.commanded && !rule.patrol && (counts.get(rule.bucket)||0)>=(rule.row[9]||4)) rule=null;
      if(closed) return null;
      if(rule) {
        // A patrol member's home is always its road's point, so staff moving
        // a point moves the member's home at the next start.
        home=rule.patrol ? rule.row[3].slice() : validHome ? saved.home.slice() : state.pos.slice();
        call('set',id,'thornswoodNpcHome',{home,cell:rule.cell,
          source:rule.commanded ? 'command' : rule.patrol ? rule.bucket : rule.row[0]});
        if(closed) return null;
        call('set',id,'spawnPoint',{cellOrWorldDesc:rule.row[2],pos:home,rot:[0,0,0]});
        if(closed) return null;
      }
    }
    if(!rule) {
      // Native placement exclusions handle authored references. Dynamic NPCs
      // must also pass a species, habitat and shared density check.
      if(id>=0xff000000) {call('set',id,'isDisabled',true);}
      return null;
    }
    if(rule.row[13]) {
      const desc=call('getDescFromId',id);
      if(closed) return null;
      call('callPapyrusFunction','method','ObjectReference','SetDisplayName',
        {type:'form',desc},[rule.row[13],true]);
      if(closed) return null;
    }
    call('set',id,'spawnDelay',rule.row[5]*60);
    if(closed) return null;
    // row[11]: 1 the race swims and cannot walk, 2 an ambush placement (#2067).
    const flags=rule.row[11] || 0;
    const policy={home:home || rule.row[3].slice(),cell:rule.cell,leash:rule.row[4],
      swims:!!(flags&1),ambush:!!(flags&2)};
    // A swimmer stays below the depth the game placed it at.
    if(policy.swims) policy.top=rule.row[3][2];
    if(id>=0xff000000 && !rule.commanded) counts.set(rule.bucket,(counts.get(rule.bucket)||0)+1);
    configured.set(id,{policy,rule});
    if(rule.patrol) patrolSlots.set(rule.patrol,id);
    return policy;
  }
  function afterOwnership(id,owner) {
    return whileCurrent(owner,undefined,(call,current)=>{
      if(!committed || closed) return;
      const entry=configured.get(id);
      if(entry && api.setNpcDifficultyTier) call('setNpcDifficultyTier',id,entry.rule.row[8] || 0);
      if(closed) return;
      if(entry && merchants) merchants.prepare(id,current);
    });
  }
  function release(id) {
    const entry=configured.get(id);
    if(id>=0xff000000 && entry) {
      if(!entry.rule.commanded) counts.set(entry.rule.bucket,Math.max(0,(counts.get(entry.rule.bucket)||0)-1));
      if(entry.rule.patrol && patrolSlots.get(entry.rule.patrol)===id) patrolSlots.delete(entry.rule.patrol);
      configured.delete(id);
    }
  }
  // An NPC carried on from the previous load has its purse read by this
  // load's purse service, the part of afterOwnership the engine does not keep.
  function resume(id,owner) {
    return whileCurrent(owner,undefined,(call,current)=>{
      if(!committed || closed) return;
      if(configured.has(id) && merchants) merchants.prepare(id,current);
    });
  }
  // Stops, and gives the next load what this one decided, for options.carry.
  function handover() {
    if(closed) return null;
    closed=true;
    return {key:options && options.key,configured,counts,patrolSlots};
  }
  return {configure,afterOwnership,resume,handover,release,commit,stop:()=>{closed=true;},merchantStats:()=>merchants && merchants.stats(),reconcile:ids=>{
    const live=new Set(ids);
    for(const id of configured.keys()) if(id>=0xff000000 && !live.has(id)) release(id);
  },admit:(id,state,owner)=>whileCurrent(owner,false,(call,current)=>{
    if(!configure(id,state,current)) return false;
    call('setNpcServerControlled',id,true);
    afterOwnership(id,current);
    return current();
  }),returnMinutes:id=>{
    const entry=configured.get(id),rule=entry ? entry.rule : allowed.get(id);
    return rule && rule.row[5];
  },isTemporary:id=>{
    // A spawn staff did not keep (#2623): removed when it dies.
    const entry=configured.get(id);
    return !!(entry && entry.rule.commanded && !entry.rule.keep);
  },spawned:()=>{
    // Every creature a spawn command made that is still held here, kept or
    // not, alive or dead: what staff's /despawn chooses from (#2623).
    const out=[];
    for(const [id,entry] of configured) if(entry && entry.rule && entry.rule.commanded) out.push({id,keep:entry.rule.keep===true});
    return out;
  }};
}
// NPC POPULATION POLICY END

