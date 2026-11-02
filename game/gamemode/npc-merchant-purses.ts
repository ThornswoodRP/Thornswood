// NPC MERCHANT PURSES BEGIN
function createPrivateMerchantLedger(fs,path,settings,references,durableWriter) {
  return createPrivateEconomyLedger(fs,path,settings,'merchant',references,durableWriter);
}
function createPrivateEconomyLedger(fs,path,settings,name,references,durableWriter) {
  if(name!=='merchant' && name!=='dungeon-rewards') throw new Error('Unknown private economy ledger');
  const dir=path.resolve(settings.privDir || 'private'),served=path.resolve(settings.dataDir || 'data');
  function realPath(input) {
    let existing=input;const tail=[];
    while(!fs.existsSync(existing)) {
      const parent=path.dirname(existing);
      if(parent===existing) throw new Error('Merchant ledger path cannot be verified');
      tail.unshift(path.basename(existing));existing=parent;
    }
    return path.resolve(fs.realpathSync(existing),...tail);
  }
  function checkPrivate() {
    const relative=path.relative(realPath(served),realPath(dir));
    if(!relative || (!relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative)))
      throw new Error('Merchant ledger must be outside served resources');
  }
  checkPrivate();
  const file=path.join(dir,name+'-ledger.json'),marker=path.join(dir,name+'-ledger.initialized');
  const checksum=doc=>require('crypto').createHash('sha256').update(JSON.stringify([doc.version,doc.entries])).digest('hex');
  function requireMerchantEvidence() {
    if(name==='merchant' && (!fs.existsSync(file) || !fs.existsSync(marker)))
      throw new Error('Saved merchant ledger or initialization evidence is missing');
  }
  function save(doc) {
    checkPrivate();
    const bytes=JSON.stringify({version:doc.version,entries:doc.entries,sha256:checksum(doc)});
    requireMerchantEvidence();
    if(typeof durableWriter==='function') {
      if(durableWriter(name,bytes)!==true) throw new Error('Durable merchant save acknowledgement is missing');
      return true;
    }
    fs.mkdirSync(dir,{recursive:true});
    const tmp=file+'.tmp';
    fs.writeFileSync(tmp,bytes);
    const fd=fs.openSync(tmp,'r+');
    try {fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
    fs.renameSync(tmp,file);
    return true;
  }
  function load() {
    checkPrivate();
    requireMerchantEvidence();
    if(name!=='merchant' && !fs.existsSync(file)) {
      if(fs.existsSync(marker)) throw new Error('Saved merchant ledger is missing');
      if(!Array.isArray(references) || new Set(references).size!==references.length)
        throw new Error('Merchant initialization manifest is required');
      const entries=Object.create(null);
      for(const reference of references) entries[reference]=null;
      save({version:1,entries});
    }
    const doc=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
    if(!doc || typeof doc.sha256!=='string' || doc.sha256!==checksum(doc))
      throw new Error('Saved merchant ledger integrity cannot be verified');
    // Existing documents pass the native path and alias checks before use.
    requireMerchantEvidence();
    if(typeof durableWriter==='function') save(doc);
    // This marker distinguishes a first deployment from a deleted ledger.
    if(name!=='merchant' && !fs.existsSync(marker)) {
      fs.writeFileSync(marker,'1');
      const fd=fs.openSync(marker,'r+');
      try {fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
    }
    return doc;
  }
  return {load,save,durable:typeof durableWriter==='function',namespace:String(settings.thornswoodServer || 'main').toLowerCase()+':'+(path.sep==='\\' ? realPath(file).toLowerCase() : realPath(file))};
}
function npcMerchantManifest(data) {
  const kept=data.keep.filter(row=>row[6]==='trader');
  const history=data.merchantHistory===undefined ? kept.map(row=>row.slice(0,2)) : data.merchantHistory;
  if(!Array.isArray(history) || !history.length) throw new Error('Invalid merchant history manifest');
  const entries=new Map();
  for(const row of history) {
    if(!Array.isArray(row) || row.length!==2 || row.some(value=>typeof value!=='string' || !value) || entries.has(row[0]))
      throw new Error('Invalid merchant history manifest');
    entries.set(row[0],{reference:row[0],base:row[1],active:false});
  }
  for(const row of kept) {
    const identity=entries.get(row[0]);
    if(!identity || identity.base!==row[1] || identity.active) throw new Error('Active merchant catalogue disagrees with history manifest');
    identity.active=true;
  }
  return Array.from(entries.values());
}
function createNpcMerchantPurses(api,data,storage) {
  const invoke=Reflect.apply;
  if(!storage) throw new Error('A durable merchant ledger is required');
  const retirement=data.merchantRoster!==undefined;
  if(retirement && (!data.merchantRoster || typeof data.merchantRoster!=='object' ||
      Object.keys(data.merchantRoster).length!==2 || data.merchantRoster.version!==1 ||
      !['existing','alpha'].includes(data.merchantRoster.worldMode))) throw new Error('Invalid existing-world merchant roster');
  const owners=globalThis.__thornswoodMerchantLedgerOwners || (globalThis.__thornswoodMerchantLedgerOwners=new Map());
  const key=storage.namespace || storage;
  const prior=owners.get(key);
  if(prior && prior.busy) throw new Error('Merchant ledger writer is busy');
  const lease={busy:true};
  owners.set(key,lease);
  try {
  if(typeof storage.load!=='function' || typeof storage.save!=='function') throw new Error('A durable merchant ledger is required');
  const property='thornswoodMerchant',catalogue=new Map(),verified=new Set();
  let initialized=0,active=true;
  function assertOwner() {
    if(!active || owners.get(key)!==lease) throw new Error('Merchant purse service is unavailable');
  }
  function mutate(fn) {
    assertOwner();
    if(lease.busy) throw new Error('Merchant ledger writer is busy');
    lease.busy=true;
    try {return fn();} finally {lease.busy=false;}
  }
  api.makeProperty(property,{isVisibleByOwner:false,isVisibleByNeighbors:false,updateOwner:'',updateNeighbor:''});
  for(const identity of npcMerchantManifest(data)) {
    const id=api.getIdFromDesc(identity.reference);
    if(!Number.isInteger(id) || id<=0 || catalogue.has(id)) throw new Error('Invalid merchant catalogue identity');
    catalogue.set(id,identity);
  }
  let ledger=storage.load();
  assertOwner();
  function valid(state,identity) {
    return state && state.version===1 && state.reference===identity.reference && state.base===identity.base &&
      (state.revision===undefined || Number.isSafeInteger(state.revision) && state.revision>=0) &&
      Number.isInteger(state.purse) && state.purse>=0 && state.purse<=2147483647 &&
      Array.isArray(state.stock) && state.stock.every(row=>row && Number.isInteger(row.baseId) &&
        row.baseId>0 && row.baseId<=0xffffffff && row.baseId!==15 &&
      Number.isInteger(row.count) && row.count>0 && row.count<=2147483647);
  }
  // Version 2 from #2870: supply waits and commission owners name a runtime
  // character by its runtime form id. A version 1 ledger keyed them by
  // formDesc and local form id. It is refused and never read: in the alpha
  // nothing is carried over, so the deploy replaces it with the fresh
  // version 2 ledger scripts\ops\New-AlphaMerchantLedger.js prints
  // (docs\GAMEMODE.md), and merchant stock and purses start again.
  if(ledger && ledger.version===1)
    throw new Error('Saved merchant ledger is version 1, from before #2870, and is not read; with this server stopped, replace it with what node scripts\\ops\\New-AlphaMerchantLedger.js --confirm-discard-alpha prints (the alpha reset: merchant stock and purses start fresh)');
  if(!ledger || ledger.version!==2 || !ledger.entries || typeof ledger.entries!=='object' || Array.isArray(ledger.entries))
    throw new Error('Saved merchant ledger cannot be verified');
  const references=new Map(Array.from(catalogue.values()).map(identity=>[identity.reference,identity]));
  if(Object.keys(ledger.entries).length!==references.size) throw new Error('Saved merchant ledger manifest cannot be verified');
  for(const reference of Object.keys(ledger.entries)) {
    if(!references.has(reference) || (ledger.entries[reference]!==null && !valid(ledger.entries[reference],references.get(reference))))
      throw new Error('Saved merchant ledger entry cannot be verified');
  }
  if(retirement && data.merchantRoster.worldMode==='existing' &&
      Array.from(references.values()).some(identity=>identity.active && ledger.entries[identity.reference]===null))
    throw new Error('Existing-world roster activation requires every retained saved purse');
  function prepare(id,owner) {
    return mutate(()=>prepareState(id,owner));
  }
  function prepareState(id,owner) {
    let saveAttempted=false;
    function assertCurrent() {
      assertOwner();
      if(owner && !owner()) throw new Error('Merchant preparation caller is revoked');
    }
    function call(target,method,...args) {
      assertCurrent();
      const fn=target[method];
      assertCurrent();
      if(target===storage && method==='save') saveAttempted=true;
      const result=invoke(fn,target,args);
      assertCurrent();
      return result;
    }
    assertCurrent();
    const identity=catalogue.get(id);
    if(!identity) return null;
    // Retired identities remain private ledger records, never live traders.
    if(!identity.active) return null;
    const actor=call(api,'getNpcAIState',id);
    if(!actor || actor.isHuman || actor.profileId>0) throw new Error('A human cannot receive an NPC merchant purse');
    if(call(api,'get',id,'baseDesc')!==identity.base) throw new Error('Merchant base does not match its authored reference');
    const projection=call(api,'get',id,property);
    if(projection!==undefined && projection!==null && !valid(projection,identity))
      throw new Error('Saved merchant state cannot be verified');
    let state=ledger.entries[identity.reference];
    if(state===null) {
      if(projection!==undefined && projection!==null) throw new Error('Merchant initialization record is missing');
      state={version:1,reference:identity.reference,base:identity.base,purse:250,stock:[]};
      const next=JSON.parse(JSON.stringify(ledger));
      next.entries[identity.reference]=state;
      // Initialization and balance commit together before the native mirror.
      try {
        assertCurrent();
        const acknowledgement=call(storage,'save',next);
        if(storage.durable===true && acknowledgement!==true) throw new Error('Durable merchant save acknowledgement is missing');
        assertCurrent();
        ledger=next;
        initialized++;
      } catch(error) {if(saveAttempted) active=false;throw error;}
    }
    // Native saves are asynchronous. A lost or older mirror uses the ledger's
    // current balance, including zero; it never creates another grant.
    assertCurrent();
    if(JSON.stringify(projection)!==JSON.stringify(state)) call(api,'set',id,property,JSON.parse(JSON.stringify(state)));
    assertCurrent();
    verified.add(id);
    return JSON.parse(JSON.stringify(state));
  }
  function commit(id, nextState, expectedRevision, requireAcknowledgement, caller) {
    return mutate(()=>commitState(id,nextState,expectedRevision,requireAcknowledgement,caller));
  }
  function commitState(id, nextState, expectedRevision, requireAcknowledgement, caller) {
    assertOwner();
    const identity=catalogue.get(id);
    if(!identity) throw new Error('That is not a guild trader');
    if(!valid(nextState, identity)) throw new Error('Merchant state cannot be verified');
    const previous=ledger.entries[identity.reference];
    if(previous===null || previous===undefined) throw new Error('Merchant initialization record is missing');
    if(identity.active) {
      const actor=api.getNpcAIState(id);
      if(!actor || actor.isHuman || actor.profileId>0) throw new Error('A human cannot receive an NPC merchant purse');
      if(api.get(id,'baseDesc')!==identity.base) throw new Error('Merchant base does not match its authored reference');
    } else if(!previous.pending) throw new Error('A retired merchant can only finish a saved transfer');
    const revision=previous.revision || 0;
    const expected=expectedRevision===undefined ? (nextState.revision || 0) : expectedRevision;
    if(!Number.isSafeInteger(expected) || expected<0) throw new Error('Invalid merchant revision');
    if(revision!==expected) return null;
    if(revision>=Number.MAX_SAFE_INTEGER) throw new Error('Merchant revision is exhausted');
    if(requireAcknowledgement && storage.durable!==true)
      throw new Error('Durable merchant save acknowledgement is unavailable');
    const next=JSON.parse(JSON.stringify(ledger));
    const committed=JSON.parse(JSON.stringify(nextState));
    committed.revision=revision+1;
    next.entries[identity.reference]=committed;
    const write=storage.save;
    assertOwner();
    if(caller!==undefined && (typeof caller!=='function' || caller()!==true)) return null;
    assertOwner();
    try {
      assertOwner();
      const acknowledgement=invoke(write,storage,[next]);
      if(requireAcknowledgement && acknowledgement!==true)
        throw new Error('Durable merchant save acknowledgement is missing');
    } catch(error) {
      // A replacement may have reached disk before an error was reported.
      // Revoke this controller so stale in-memory state cannot overwrite it.
      active=false;
      throw error;
    }
    assertOwner();
    ledger=next;
    if(identity.active) api.set(id, property, JSON.parse(JSON.stringify(committed)));
    assertOwner();
    return JSON.parse(JSON.stringify(committed));
  }
  function compareAndCommit(id, expectedRevision, nextState, caller) {
    return commit(id,nextState,expectedRevision,true,caller);
  }
  function read(id) {
    assertOwner();
    const identity=catalogue.get(id);
    return identity && ledger.entries[identity.reference] ? JSON.parse(JSON.stringify(ledger.entries[identity.reference])) : null;
  }
  function pendingRecords() {
    assertOwner();
    const pending=[];
    for(const [id,identity] of catalogue) {
      const state=ledger.entries[identity.reference];
      if(state && state.pending!==undefined && state.pending!==null) pending.push({merchantId:id,reference:identity.reference,state:JSON.parse(JSON.stringify(state))});
    }
    return pending;
  }
  function ledgerStates() {
    assertOwner();
    // Include inactive historical identities and null entries: a later roster
    // must never make a character's accepted work disappear from admission.
    return Array.from(catalogue,([merchantId,identity])=>({merchantId,reference:identity.reference,
      state:JSON.parse(JSON.stringify(ledger.entries[identity.reference]))}));
  }
  // LETTING GO OF A DELETED CHARACTER (#2351, #2652). who is the release
  // block's: who.profile(profile id) and who.actor(form id) say whether a
  // character is on private\deleted-characters.json. In every entry, retired
  // traders' too:
  //   supply       a supply wait keyed by [form id, profile, what] of theirs
  //                is dropped (the runtime form id, #2870)
  //   commissions  a promise the trader holds for them (commissions.held)
  //                is dropped, so its gold is the trader's to spend again
  //                and it no longer counts toward MAX_HELD; a finished one
  //                cooling down (commissions.cool) goes too. Both are keyed
  //                by the owner merchant-commission-state.js writes,
  //                [runtime form id, '', profile] for a character (#2870)
  //   a trade      still waiting on them is cleared:
  //     debit      the trader's state is still pending.previous (records()
  //                in the trading checks it), so clearing pending leaves it
  //                as it was, as a refused debit does; for a commission the
  //                promise it would have paid is dropped above
  //     credit     the trader already holds pending.next; what was due to
  //                the character goes with their pack, so next stays, and
  //                nothing stamped for them (a supply wait, a commission
  //                cooling down) is kept
  // Purse and stock are never touched: no coin or goods are made or lost.
  // A trader holding something of theirs while a trade with somebody else
  // is still waiting is not changed at all: that trade's saved snapshots
  // and terms are what the trader's state is checked against, so taking
  // the row out of the state alone would stop every trade. The part says so
  // and waits for the next start, by when that trade has settled.
  // Every changed entry goes out in one acknowledged save, as
  // compareAndCommit's are, before the ledger in memory changes; a save
  // that fails revokes this service, as a failed commit does.
  // Each trader's own saved copy (property, kept with that NPC's save) is
  // let go of too, once the ledger is saved: a copy that still names them
  // is written over with what the ledger now holds for that trader. A
  // retired trader is never prepared again, so its copy would otherwise
  // keep them for good; an active one's is put right here as well rather
  // than waiting for prepare(). Only a copy that names them is written, so
  // a run whose ledger was let go at an earlier start but whose copy write
  // did not take still finds and writes that copy.
  // One shape for a character's form id (#2870); game\form-id.js is the
  // original and tests\test-2870-form-id-shape.js keeps this copy the same.
  // A runtime human's formDesc is its local hex alone; a placed form's has a
  // plugin and is never a character (formIdOf gives 0).
  function formIdOf(desc) {
    if (typeof desc !== 'string' || !/^[0-9a-f]{1,6}$/i.test(desc)) return 0;
    var local = parseInt(desc, 16);
    return local > 0 ? 0xff000000 + local : 0;
  }
  function isFormId(n) {
    return Number.isSafeInteger(n) && n > 0xff000000 && n <= 0xffffffff;
  }
  function release(who) {
    return mutate(()=>{
      const counts={merchants:0,supply:0,commissions:0,trades:0,copies:0};
      // Every form id here is the runtime form id, as on the list (#2870).
      const theirs=(id,profile)=>!!(who.profile(profile) || (isFormId(id) && who.actor(id)));
      // A commission key is JSON [owner, job], the owner JSON [form id, plugin, profile].
      const promisedTo=key=>{
        const row=JSON.parse(JSON.parse(key)[0]);
        return !!(who.profile(row[2]) || (!row[1] && theirs(row[0],0)));
      };
      // Whether a trader's saved copy still names them: a supply wait, a
      // commission promise or one cooling down, or a trade waiting on them.
      // A key that does not read names nobody.
      const names=copy=>{
        if(!copy || typeof copy!=='object') return false;
        const supply=copy.supply && typeof copy.supply==='object' ? Object.keys(copy.supply) : [];
        if(supply.some(k=>{
          let owner=null;
          try {owner=JSON.parse(k);} catch(error) {owner=null;}
          return Array.isArray(owner) && owner.length===3 && theirs(owner[0],owner[1]);
        })) return true;
        const books=copy.commissions && typeof copy.commissions==='object' ? copy.commissions : {};
        if(['held','cool'].some(book=>books[book] && typeof books[book]==='object' && Object.keys(books[book]).some(k=>{
          try {return promisedTo(k);} catch(error) {return false;}
        }))) return true;
        const pending=copy.pending;
        return !!(pending && pending.human && theirs(formIdOf(pending.human.desc),pending.human.profileId));
      };
      const next=JSON.parse(JSON.stringify(ledger)),changed=[];
      let busy=0;
      for(const [id,identity] of catalogue) {
        const state=next.entries[identity.reference];
        if(!state) continue;
        let rows=0;
        for(const k of Object.keys(state.supply || {})) {
          let owner=null;
          try {owner=JSON.parse(k);} catch(error) {owner=null;}
          if(Array.isArray(owner) && owner.length===3 && theirs(owner[0],owner[1])) {delete state.supply[k];counts.supply++;rows++;}
        }
        if(state.commissions!==undefined) {
          for(const book of ['held','cool']) {
            for(const k of Object.keys(state.commissions[book])) {
              if(promisedTo(k)) {delete state.commissions[book][k];counts.commissions++;rows++;}
            }
          }
        }
        const pending=state.pending;
        const trade=!!(pending && pending.human && theirs(formIdOf(pending.human.desc),pending.human.profileId));
        if(!trade && !rows) continue;
        if(pending && !trade) {busy++;continue;}
        if(trade) {state.pending=null;counts.trades++;}
        if(!valid(state,identity)) throw new Error('Merchant state cannot be verified');
        const revision=state.revision || 0;
        if(revision>=Number.MAX_SAFE_INTEGER) throw new Error('Merchant revision is exhausted');
        state.revision=revision+1;
        counts.merchants++;
        changed.push([id,identity,state]);
      }
      if(busy) throw new Error(busy+' trader(s) holding something of theirs are waiting on a trade with somebody else, so nothing was let go');
      if(changed.length) {
        try {
          assertOwner();
          if(storage.save(next)!==true) throw new Error('Durable merchant save acknowledgement is missing');
        } catch(error) {active=false;throw error;}
        assertOwner();
        ledger=next;
      }
      // The traders' own saved copies, retired traders' included, from the
      // ledger as it now is. A write that fails stops the part, which waits
      // for the next start and finds the copy again.
      for(const [id,identity] of catalogue) {
        assertOwner();
        if(!names(api.get(id,property))) continue;
        const state=ledger.entries[identity.reference];
        if(names(state)) throw new Error('Merchant state still names a released character');
        api.set(id,property,state===null ? null : JSON.parse(JSON.stringify(state)));
        assertOwner();
        counts.copies++;
      }
      return {counts,saved:true};
    });
  }
  const activeCount=Array.from(catalogue.values()).filter(identity=>identity.active).length;
  return {prepare,read,commit,compareAndCommit,pendingRecords,ledgerStates,release,callerGuard:true,durable:storage.durable===true,namespace:storage.namespace,shutdown:()=>{active=false;},stats:()=>({catalogue:activeCount,retired:catalogue.size-activeCount,verified:verified.size,initialized})};
  } finally {lease.busy=false;}
}
// NPC MERCHANT PURSES END

