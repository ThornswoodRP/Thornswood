// SHARED RESOURCE STOCK BEGIN
function createSharedResourceStock(api, now) {
  const property='thornswoodResourceStock';
  api.makeProperty(property,{isVisibleByOwner:false,isVisibleByNeighbors:false,updateOwner:'',updateNeighbor:''});
  function read(ref) {
    const state=api.get(ref,property);
    if(state===null || state===undefined) return {version:1,readyAt:0,life:0,dead:false,dressed:false};
    if(!state || state.version!==1 || !Number.isSafeInteger(state.readyAt) || state.readyAt<0 ||
        !Number.isSafeInteger(state.life) || state.life<0 || typeof state.dead!=='boolean' || typeof state.dressed!=='boolean')
      throw new Error('Invalid persisted resource stock');
    return {...state};
  }
  function left(ref,span) {
    if(!Number.isSafeInteger(span) || span<=0) throw new Error('Invalid resource interval');
    return Math.max(0,read(ref).readyAt-now());
  }
  function grantReserved(ref,before,reserved,grant,fence) {
    if(fence && (fence()!==true || JSON.stringify(read(ref))!==JSON.stringify(before)))return {ok:false,waitMs:0};
    api.set(ref,property,reserved);
    function restore() {
      if(fence) {
        try {
          if(fence()!==true || JSON.stringify(read(ref))!==JSON.stringify(reserved))return;
        }catch(error){return;}
      }
      api.set(ref,property,before);
    }
    try {
      if(grant()===false) {restore();return {ok:false,waitMs:0};}
      return {ok:true,waitMs:0};
    } catch(error) {
      restore();
      throw error;
    }
  }
  function take(ref,span,grant) {
    const waitMs=left(ref,span);
    if(waitMs>0) return {ok:false,waitMs};
    const before=read(ref),deadline=now()+span;
    if(!Number.isSafeInteger(deadline)) throw new Error('Invalid resource deadline');
    return grantReserved(ref,before,{...before,readyAt:deadline},grant);
  }
  function recordDeath(ref,fence) {
    const state=read(ref);
    const generation=lifeGeneration(ref);
    if(state.dead && (generation===undefined || state.generation===generation)) return;
    if(fence && (fence()!==true || JSON.stringify(read(ref))!==JSON.stringify(state)))return false;
    api.set(ref,property,{...state,generation,life:state.life+1,dead:true,dressed:false});
  }
  function lifeGeneration(ref) {
    if(!api.getNpcAIState) return undefined;
    const generation=api.getNpcAIState(ref).lifeGeneration;
    if(generation===undefined) return undefined;
    if(!Number.isSafeInteger(generation) || generation<0) throw new Error('Invalid native NPC life generation');
    return generation;
  }
  function recordRespawn(ref) {
    if(api.get(ref,'isDead')!==false) return false;
    const state=read(ref);
    api.set(ref,property,{...state,generation:lifeGeneration(ref),dead:false,dressed:false});
    return true;
  }
  function dress(ref,grant,fence) {
    if(fence && fence()!==true)return {ok:false,waitMs:0};
    if(api.get(ref,'isDead')!==true) return {ok:false,waitMs:0};
    let before=read(ref);
    const generation=lifeGeneration(ref);
    if(!before.dead || generation!==undefined && before.generation!==generation) {
      if(recordDeath(ref,fence)===false)return {ok:false,waitMs:0};before=read(ref);
    }
    if(before.dressed) return {ok:false,waitMs:0};
    return grantReserved(ref,before,{...before,dressed:true},grant,fence);
  }
  return {left,take,recordDeath,recordRespawn,dress};
}
// SHARED RESOURCE STOCK END

try { globalThis.__thornswoodResourceStock=createSharedResourceStock(mp,()=>Date.now()); }
catch(error) { log('Shared resource stock could not start: '+error); }

