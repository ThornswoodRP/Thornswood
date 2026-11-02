// NPC SERVER STARTUP BEGIN
(function () {
const owner={};
globalThis.__thornswoodNpcStartupOwner=owner;
let merchants=null,trading=null,population=null,runtime=null;
function current() {
  if(globalThis.__thornswoodNpcStartupOwner!==owner) throw new Error('NPC startup ownership is revoked');
}
function cleanup(key,value,method) {
  if(value && typeof value[method]==='function') {
    try {value[method]();} catch(error) {log('NPC startup cleanup failed: '+error);}
  }
  if(globalThis[key]===value) globalThis[key]=null;
}
/*
  WHETHER THE PREVIOUS LOAD'S NPCS CAN CARRY ON IN THIS ONE (#3296). The
  runtime and the population hand over what they know when they stop, and
  this load takes it only when both loads have the same NPC code and the same
  catalogue: the text of the population policy, catalogue and runtime blocks
  and of this block, read from the file that is loading, and the catalogue
  the merchant roles made from it. Anything different takes the full load,
  because what the old load knew may not fit this code.
*/
function carryKey(populationData) {
  const text=require('fs').readFileSync(__filename,'utf8').replace(/\r\n/g,'\n');
  const marker=(name,end)=>'// NPC '+name+(end ? ' END' : ' BEGIN');
  const from=text.indexOf(marker('POPULATION POLICY')),to=text.indexOf(marker('SERVER RUNTIME',true),from);
  const at=text.lastIndexOf(marker('SERVER STARTUP')),until=text.indexOf(marker('SERVER STARTUP',true),at);
  if(from<0 || to<0 || at<0 || until<0) throw new Error('the NPC blocks are not in the loading file');
  return require('crypto').createHash('sha256').update(text.slice(from,to)).update(text.slice(at,until))
    .update(JSON.stringify(populationData)).digest('hex');
}
try {
  const teardownErrors=[],handed={};
  // A runtime or population from before handover() existed only stops.
  const priorControllers=[['__thornswoodMerchantTrade','shutdown'],['__thornswoodNpcRuntime','handover','stop'],
    ['__thornswoodNpcPopulation','handover','stop'],['__thornswoodNpcMerchants','shutdown']]
    .map(([key,...methods])=>[key,methods,globalThis[key]]);
  current();
  for(const [key,methods,prior] of priorControllers) {
    try {
      const method=prior && methods.find(name=>typeof prior[name]==='function');
      if(method) handed[key]=prior[method]();
    }
    catch(error) {teardownErrors.push(error);}
    // Finish every captured controller even if a callback starts a successor.
    // Only the current startup may clear its global slots.
    if(globalThis.__thornswoodNpcStartupOwner===owner && globalThis[key]===prior) globalThis[key]=null;
  }
  current();
  for(const [key] of priorControllers) {
    if(globalThis[key]!==null && globalThis[key]!==undefined)
      teardownErrors.push(new Error('NPC startup controller was replaced during teardown'));
  }
  if(teardownErrors.length) throw teardownErrors[0];
  const cfgNpc = mp.getServerSettings();
  current();
  if (/^(main|dev)$/i.test(String(cfgNpc.thornswoodServer || 'main'))) {
    // Build the winning-record indexes during startup, before scheduled work.
    mp.prepareNpcLoad();
    current();
    const plugins=(cfgNpc.loadOrder || []).map(p=>String(p).split(/[\\/]/).pop());
    if(JSON.stringify(NPC_POPULATION_DATA.plugins)!==JSON.stringify(plugins))
      throw new Error('Merchant catalogue does not match the installed load order');
    // Resolve role evidence before opening a writer. Each native callback may
    // reload the gamemode, so the old startup must stop immediately afterwards.
    const roleNative={};
    for(const key of ['getIdFromDesc','getDescFromId','lookupEspmRecordById','validateInventoryTransaction']) {
      const method=mp[key];
      roleNative[key]=function(...args) {current();const value=Reflect.apply(method,mp,args);current();return value;};
    }
    const roleStage=MERCHANT_TRADING.prepareRoles(NPC_POPULATION_DATA,roleNative);
    current();
    const populationData=roleStage.population;
    let key=null;
    try {key=carryKey(populationData);} catch(error) {log('NPC handover is unavailable: '+error);}
    current();
    const runtimeCarry=handed.__thornswoodNpcRuntime,populationCarry=handed.__thornswoodNpcPopulation;
    const carried=!!(key && runtimeCarry && populationCarry && runtimeCarry.key===key && populationCarry.key===key);
    if(!carried && priorControllers[1][2])
      log('Shared NPC runtime starts over: '+(!runtimeCarry || !populationCarry ? 'the previous gamemode load handed nothing over' :
        !key ? 'this load cannot name its NPC code' : 'the previous gamemode load had other NPC code or another catalogue'));
    const retirement=populationData.merchantRoster!==undefined;
    merchants=createNpcMerchantPurses(mp,populationData,
      createPrivateMerchantLedger(require('fs'),require('path'),cfgNpc,
        npcMerchantManifest(populationData).map(identity=>identity.reference),
        typeof mp.writePrivateEconomyLedger==='function' ? mp.writePrivateEconomyLedger.bind(mp) : null));
    current();
    // A deleted character's supply waits and waiting trade are let go here,
    // once the purses are read and before trading or any tick can act on
    // them (#2351, #2652).
    if(typeof globalThis.__thornswoodRelease==='function') globalThis.__thornswoodRelease('merchants',merchants.release);
    current();
    trading = MERCHANT_TRADING.installMerchantTrading({
        mp: mp,
        g: globalThis,
        // A hair dye is not the plain Bowl a merchant would buy (#2675).
        minted: mintedEntry,
        purses: merchants,
        catalog: roleStage.catalog,
        roleTables: roleStage.roleTables,
        commissions: roleStage.commissions,
        suspended: true,
        retirementRequired: retirement,
        log: function (line) { log(line); }
      });
    function ready() {
      current();
      if(!trading.nativeReady() || retirement && !trading.retirementReady())
        throw new Error('Merchant roster admission is unavailable or legacy work remains');
      current();
    }
    ready();
    population=createNpcPopulation(mp,populationData,plugins,merchants,{suspended:true,
      // #2623: a temporary spawn left from an earlier run is taken out of
      // the world on the next turn of the event loop, never inside the
      // runtime's own preparation pass that asked about it.
      run:serverRunId(),discard:id=>setTimeout(()=>removeSpawned(id),0),
      // #1390: the staff's patrol roads, as the patrol keeper below read them.
      patrols:()=>globalThis.__thornswoodThalmorPatrols,
      // #3296: what the previous load decided, and the key the next one checks.
      key,carry:carried ? populationCarry : null});
    current();
    // Each step it schedules is counted on the minute line (#385).
    runtime = startSharedNpcServerRuntime(
      mp, {setTimeout:(fn,delay)=>setTimeout(counted('npc '+(fn.npcRuntimeTask||'task'),fn),delay), clearTimeout},
      Date.now, text=>log(text),population,{suspended:true,key,carry:carried ? runtimeCarry : null});
    ready();
    // Every fallible constructor and initial timer is staged before this commit attempt.
    population.commit();
    current();
    globalThis.__thornswoodNpcMerchants=merchants;
    globalThis.__thornswoodMerchantTrade=trading;
    globalThis.__thornswoodNpcPopulation=population;
    globalThis.__thornswoodNpcRuntime=runtime;
    if(runtime.start()!==true) throw new Error('NPC runtime activation is unavailable');
    current();
    trading.start();
    current();
  }
} catch (e) {
  cleanup('__thornswoodMerchantTrade',trading,'shutdown');
  cleanup('__thornswoodNpcRuntime',runtime,'stop');
  cleanup('__thornswoodNpcPopulation',population,'stop');
  cleanup('__thornswoodNpcMerchants',merchants,'shutdown');
  log('NPC server runtime failed to start: ' + e);
}
})();
// NPC SERVER STARTUP END

// The release of deleted characters (#2351): which parts did not let go at
// this start, now that every block that keeps a register has loaded. The
// NPC startup, where the merchant purses are read (#2652), is the last.
if (typeof globalThis.__thornswoodReleaseWaiting === 'function') { globalThis.__thornswoodReleaseWaiting(); }

