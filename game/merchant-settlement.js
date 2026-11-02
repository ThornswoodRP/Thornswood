'use strict';

var MAX_PENDING = 25;
var MAX_INVENTORY_BYTES = 128 * 1024;
var MAX_INTENT_BYTES = 512 * 1024;
var MAX_COUNT = 2147483647;
var COMMISSION_STATE=typeof MERCHANT_COMMISSION_STATE!=='undefined'?MERCHANT_COMMISSION_STATE:require('./merchant-commission-state');
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function merchantSnapshot(value, compact, extended) {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Pending merchant snapshot cannot be verified.');
  var supply=value.supply===undefined ? {} : value.supply;
  if(!supply || typeof supply!=='object' || Array.isArray(supply) ||
      (!compact || value.purse!==undefined || value.stock!==undefined) &&
      (!Number.isInteger(value.purse) || value.purse<0 || value.purse>MAX_COUNT || !Array.isArray(value.stock) ||
        !value.stock.every(function(row) {return row && Number.isInteger(row.baseId) && row.baseId>0 && row.baseId<=0xffffffff &&
          row.baseId!==15 && Number.isInteger(row.count) && row.count>0 && row.count<=MAX_COUNT;})))
    throw new Error('Pending merchant snapshot cannot be verified.');
  var snapshot={purse:value.purse,stock:value.stock,supply:supply};
  if(extended) {
    snapshot.commissions=COMMISSION_STATE.read(value.commissions);
    if(!compact)COMMISSION_STATE.spendable(snapshot);
  }
  return snapshot;
}
function pendingSnapshot(pending,value,compact) {return merchantSnapshot(value,compact,pending.version===4);}
function bounded(value, limit) {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > limit) throw new Error('The trade is too large.');
  return value;
}
function inventory(value) {
  if (!value || !Array.isArray(value.entries) || Object.keys(value).length !== 1) throw new Error('Inventory cannot be verified.');
  var total=0;
  value.entries.forEach(function (row) {
    if (!row || !Number.isInteger(row.baseId) || row.baseId <= 0 || row.baseId > 0xffffffff ||
        !Number.isInteger(row.count) || row.count <= 0 || row.count > MAX_COUNT) throw new Error('Inventory cannot be verified.');
    total+=row.count;
    if(total>0xffffffff) throw new Error('Inventory total is too large.');
  });
  return bounded(copy(value), MAX_INVENTORY_BYTES);
}
function metadataKey(entry) {
  var out = {};
  Object.keys(entry).sort().forEach(function (key) { if (key !== 'count') out[key] = entry[key]; });
  return JSON.stringify(out);
}
function addEntries(snapshot, entries) {
  var next = inventory(snapshot);
  inventory({entries:entries}).entries.forEach(function (entry) {
    var key = metadataKey(entry);
    var held = next.entries.find(function (row) { return metadataKey(row) === key; });
    if (held) {
      if (held.count + entry.count > MAX_COUNT) throw new Error('Inventory count is too large.');
      held.count += entry.count;
    } else next.entries.push(copy(entry));
  });
  return inventory(next);
}
// skip, when given, names entries that are not the plain item even though
// they are on its record (a hair dye on the Bowl, #2675): they are never taken.
function takeEntries(snapshot, baseId, count, skip) {
  var next = inventory(snapshot), taken = [], left = count;
  for (var i = 0; i < next.entries.length && left > 0; i++) {
    var row = next.entries[i];
    if (row.baseId !== baseId) continue;
    if (typeof skip === 'function' && skip(row)) continue;
    var n = Math.min(left, row.count);
    taken.push(Object.assign({}, copy(row), {count:n}));
    row.count -= n; left -= n;
  }
  if (left) throw new Error('You are not carrying that.');
  next.entries = next.entries.filter(function (row) { return row.count > 0; });
  return {inventory:inventory(next), entries:taken};
}
function receiptAt(human, sequence) {
  return JSON.stringify({actor:human.desc, profile:human.profileId, sequence:sequence});
}
function sequenceOf(receipt, human) {
  var doc = JSON.parse(receipt);
  if (doc === null) return 0;
  if (!doc || Object.keys(doc).length !== 3 || doc.actor !== human.desc || doc.profile !== human.profileId ||
      !Number.isSafeInteger(doc.sequence) || doc.sequence < 1) throw new Error('Inventory receipt cannot be verified.');
  return doc.sequence;
}

function canonical(value) {
  if(Array.isArray(value)) return value.map(canonical);
  if(value && typeof value==='object') {
    var out=Object.create(null);
    Object.keys(value).sort().forEach(function(key) {out[key]=canonical(value[key]);});
    return out;
  }
  return value;
}
function digest(value) {return require('crypto').createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');}
function rows(snapshot) {return inventory(snapshot).entries.map(function(entry) {return {entry:entry,label:''};});}
function stockRows(stock) {
  var out=stock.map(function(row) {
    if(row.baseId===15) throw new Error('Merchant stock cannot be verified.');
    if(typeof row.name!=='string' || !row.name) throw new Error('Merchant stock cannot be verified.');
    var entry=row.entry===undefined ? {baseId:row.baseId,count:row.count} : row.entry;
    if(!entry || entry.baseId!==row.baseId || entry.count!==row.count) throw new Error('Merchant stock cannot be verified.');
    return {entry:copy(entry),label:row.name};
  });
  inventory({entries:out.map(function(row) {return row.entry;})});
  return out;
}
function bag(items, labelled) {
  var result=new Map();
  items.forEach(function(row) {
    var metadata=copy(row.entry);delete metadata.count;
    var key=JSON.stringify([labelled?row.label:'',canonical(metadata)]),held=result.get(key);
    if(held) held.count+=row.entry.count;
    else result.set(key,{entry:row.entry,label:row.label,count:row.entry.count});
  });
  return result;
}
function difference(before, after, labelled) {
  var old=bag(before,labelled), next=bag(after,labelled), result=[];
  next.forEach(function(row,key) {
    if(!old.has(key) || old.get(key).count<row.count) throw new Error('Merchant transfer does not conserve inventory.');
  });
  old.forEach(function(row,key) {
    var count=row.count-(next.has(key)?next.get(key).count:0);
    if(count) result.push({entry:Object.assign({},copy(row.entry),{count:count}),label:row.label});
  });
  return result;
}
function goodsDigest(items) {
  return digest(Array.from(bag(items,false),function(pair) {return [pair[0],pair[1].count];}).sort(function(a,b) {return a[0]<b[0]?-1:a[0]>b[0]?1:0;}));
}
function goldCount(items) {
  var total=0;
  items.forEach(function(row) {
    if(row.entry.baseId!==15) throw new Error('Merchant gold cannot be verified.');
    total+=row.entry.count;
  });
  if(total>MAX_COUNT) throw new Error('Merchant gold cannot be verified.');
  return total;
}

// Native receipt writes are atomic with the human inventory. Ledger writes are
// synchronous durable replacements. Neither is inferred from elapsed time.
function createSettlement(deps) {
  var purses = deps.purses, transfer = deps.transfer, world = deps.world;
  var now = deps.now || function () { return Date.now(); };
  var active = true, cursor = 0, busy = false;
  var errors = new Map();
  /*
    How each transfer this instance finished ended, by its pending id, until
    the trading layer asks (#5419). A transfer finishes in a later tick, once
    the engine's save storage has acknowledged its receipts, never inside the
    begin() that armed it, so this is the only way its outcome reaches the
    person and the hold's trade count. Bounded: an outcome nobody asks for
    (a person who walked away) is let go with the oldest.
  */
  var outcomes = new Map(), MAX_OUTCOMES = 4 * MAX_PENDING;
  function finished(pendingId, how) {
    outcomes.delete(pendingId); outcomes.set(pendingId, how);
    while (outcomes.size > MAX_OUTCOMES) outcomes.delete(outcomes.keys().next().value);
    return true;
  }
  function released(id, state, pending) {
    return !!save(id, state, Object.assign({}, copy(state), {pending:null}), pending.id) && finished(pending.id, 'released');
  }
  function report(id, error) {
    var message=String(error.message || error);
    if(errors.get(id)!==message && deps.log) deps.log('merchant settlement ' + id.toString(16) + ': ' + message);
    errors.set(id,message);
  }
  function available() {
    return active && !!world && !!purses && purses.durable !== false && typeof purses.compareAndCommit === 'function' &&
      typeof purses.pendingRecords === 'function' && typeof purses.read === 'function' &&
      !!transfer && typeof transfer.validate==='function' && transfer.available();
  }
  function humanKey(human) {
    if(!human || typeof human.desc!=='string' || !Number.isSafeInteger(human.profileId) || human.profileId<=0 || human.profileId>MAX_COUNT) return '';
    // FormDesc emits local hex alone for runtime humans and hex:plugin for
    // placed forms. Compare numeric ids so leading zeros cannot split a lock;
    // a runtime human by its runtime form id, the one shape (#2870).
    var parts=/^([0-9a-f]{1,6})(?::([^:\/\\\x00-\x1f\x7f]+\.(?:esm|esp|esl)))?$/i.exec(human.desc);
    if(!parts) return '';
    if(!parts[2]) return COMMISSION_STATE.formIdOf(parts[1]) ? JSON.stringify([COMMISSION_STATE.formIdOf(parts[1]),'',human.profileId]) : '';
    return JSON.stringify([parseInt(parts[1],16),parts[2].toLowerCase(),human.profileId]);
  }
  function nativeRows(snapshot) {
    var value=inventory(snapshot);
    if(transfer.validate(value)!==true || !active) throw new Error('Native inventory cannot be verified.');
    return rows(value);
  }
  function compact(pending) {
    return pending.phase==='credit' && pending.expected===undefined && pending.debit===undefined &&
      pending.previous && pending.previous.purse===undefined && pending.previous.stock===undefined;
  }
  // A supply wait names its character by runtime form id (#2870).
  function supplier(owner,human) {
    var id=COMMISSION_STATE.formIdOf(human && human.desc);
    return id>0 && owner[0]===id;
  }
  function supplyTransition(pending,previous,next,fresh,moved) {
    if(pending.kind!=='supply') {
      if(!equal(canonical(previous.supply),canonical(next.supply))) throw new Error('Merchant supply cannot be verified.');
      return;
    }
    var key=changedSupplyKey(previous,next), before=copy(previous.supply), after=copy(next.supply), owner;
    if(!key) throw new Error('Merchant supply cannot be verified.');
    delete before[key];delete after[key];
    if(!equal(canonical(before),canonical(after))) throw new Error('Merchant supply cannot be verified.');
    try {owner=JSON.parse(key);} catch(error) {owner=null;}
    if(fresh || pending.terms!==undefined) {
      if(!Array.isArray(owner) || owner.length!==3 || !supplier(owner,pending.human) || owner[1]!==pending.human.profileId ||
          typeof owner[2]!=='string' || !owner[2] || owner[2]!==owner[2].toLowerCase()) throw new Error('Merchant supply owner cannot be verified.');
      if(moved) {
        var labels=Array.from(new Set(moved.map(function(row) {return row.label;})));
        if(labels.length!==1 || owner[2]!==labels[0].toLowerCase()) throw new Error('Merchant supply owner cannot be verified.');
      }
    } else if(Array.isArray(owner) && (owner.length!==3 || !supplier(owner,pending.human) || owner[1]!==pending.human.profileId ||
        typeof owner[2]!=='string' || !owner[2]))
      throw new Error('Merchant supply owner cannot be verified.');
  }
  function conservation(pending, fresh) {
    bounded(pending,MAX_INTENT_BYTES);
    var credit=nativeRows({entries:pending.credit}), next=pendingSnapshot(pending,pending.next);
    stockRows(next.stock);
    if(pending.creditAttempt!==undefined) {
      nativeRows(pending.creditAttempt.expected);nativeRows(pending.creditAttempt.replacement);
      if(!equal(pending.creditAttempt.replacement,addEntries(pending.creditAttempt.expected,pending.credit)))
        throw new Error('Merchant recovery inventory cannot be verified.');
    }
    var isCompact=compact(pending), previous=pendingSnapshot(pending,pending.previous,isCompact);
    supplyTransition(pending,previous,next,fresh);
    if(isCompact) {
      if(pending.kind==='buy') {
        if(!credit.length || credit.some(function(row) {return row.entry.baseId===15;})) throw new Error('Merchant goods cannot be verified.');
      } else goldCount(credit);
      if(pending.terms!==undefined) {
        var terms=pending.terms;
        if(!terms || terms.version!==(pending.version===4?2:1) || terms.kind!==pending.kind || Object.keys(terms).length!==(pending.version===4?8:7) ||
            !Number.isInteger(terms.gold) || terms.gold<0 || terms.gold>MAX_COUNT ||
            ![terms.goods,terms.credit,terms.next,terms.previousSupply].every(function(hash) {return typeof hash==='string' && /^[0-9a-f]{64}$/.test(hash);}) ||
            terms.credit!==goodsDigest(credit) || terms.next!==digest(next) || terms.previousSupply!==digest(previous.supply) ||
            (pending.kind==='buy'?terms.goods!==goodsDigest(credit):terms.gold!==goldCount(credit)))
          throw new Error('Merchant compact terms cannot be verified.');
        if(pending.version===4) {
          if(terms.previousCommissions!==digest(previous.commissions))throw new Error('Commission terms cannot be verified.');
          commissionTransition(pending,previous,next,null,terms.gold);
        }
      }
      return pending.terms;
    }
    // A saved full transfer must still fit its eventual native replacement.
    nativeRows(addEntries(pending.debit,pending.credit));
    var removed=difference(nativeRows(pending.expected),nativeRows(pending.debit),false);
    var moved=pending.kind==='buy'?difference(stockRows(previous.stock),stockRows(next.stock),true):
      difference(stockRows(next.stock),stockRows(previous.stock),true);
    if(!moved.length || moved.some(function(row) {return row.entry.baseId===15;})) throw new Error('Merchant goods cannot be verified.');
    var gold=pending.kind==='buy'?next.purse-previous.purse:previous.purse-next.purse;
    if(gold<0 || gold>MAX_COUNT || (pending.kind==='buy'?
      goldCount(removed)!==gold || goodsDigest(credit)!==goodsDigest(moved):
      removed.some(function(row) {return row.entry.baseId===15;}) || goodsDigest(removed)!==goodsDigest(moved) || goldCount(credit)!==gold))
      throw new Error('Merchant transfer does not conserve goods and gold.');
    supplyTransition(pending,previous,next,fresh,moved);
    if(pending.version===4)commissionTransition(pending,previous,next,moved,gold);
    var summary={version:pending.version===4?2:1,kind:pending.kind,gold:gold,goods:goodsDigest(moved),credit:goodsDigest(credit),next:digest(next),previousSupply:digest(previous.supply)};
    if(pending.version===4)summary.previousCommissions=digest(previous.commissions);
    if(pending.terms!==undefined && !equal(canonical(pending.terms),canonical(summary))) throw new Error('Merchant terms cannot be verified.');
    return summary;
  }
  function commissionTransition(pending,previous,next,moved,gold) {
    if(pending.kind!=='commission') {
      if(!equal(canonical(previous.commissions),canonical(next.commissions)))throw new Error('Commission promises cannot change in an ordinary trade.');
      if(previous.purse!==undefined&&pending.kind!=='buy'&&gold>COMMISSION_STATE.spendable(previous))
        throw new Error('The merchant gold is reserved for commissions.');
      return;
    }
    var removed=Object.keys(previous.commissions.held).filter(function(key){return !Object.prototype.hasOwnProperty.call(next.commissions.held,key);});
    if(removed.length!==1)throw new Error('Commission completion must release exactly one promise.');
    var key=removed[0],row=previous.commissions.held[key],at=COMMISSION_STATE.cooldownAt(next.commissions.cool[key]);
    if(COMMISSION_STATE.key(pending.human,row.job)!==key||!Number.isSafeInteger(at)||at<row.at||gold!==row.gold)
      throw new Error('Commission owner or payment cannot be verified.');
    var finished=COMMISSION_STATE.finish(previous.commissions,pending.human,row.job,row.token,at);
    if(!finished.ok||!equal(canonical(finished.next),canonical(next.commissions)))throw new Error('Commission promise transition cannot be verified.');
    if(moved) {
      var promised=row.goods||[{item:row.item,count:row.count,unit:row.unit}],totals=new Map();
      moved.forEach(function(item){
        var good=promised.find(function(good){return item.entry.baseId===good.item.baseId&&item.label===good.item.name;});
        if(!good)throw new Error('Commission goods cannot be verified.');
        totals.set(item.entry.baseId,(totals.get(item.entry.baseId)||0)+item.entry.count);
      });
      if(promised.some(function(good){return totals.get(good.item.baseId)!==good.count;}))throw new Error('Commission goods cannot be verified.');
    }
  }
  function records() {
    try {
      var all=purses.pendingRecords(), merchants=new Set(), references=new Set(), transactions=new Set(), humans=new Set(), receipts=new Set();
      if(!Array.isArray(all) || all.length>MAX_PENDING) throw new Error('Pending merchant records cannot be verified.');
      all.forEach(function(record) {
        var state=record && record.state, pending=state && state.pending;
        if(!record || !state || !Number.isInteger(record.merchantId) || record.merchantId<=0 || record.merchantId>0xffffffff ||
            record.reference!==state.reference || !valid(pending,state)) throw new Error('Pending merchant records cannot be verified.');
        if(pending.version!==4&&state.commissions!==undefined)throw new Error('Legacy transfer cannot own commission promises.');
        var previous=pendingSnapshot(pending,pending.previous,pending.phase==='credit'), next=pendingSnapshot(pending,pending.next);
        if(!equal(pendingSnapshot(pending,state),pending.phase==='debit'?previous:next)) throw new Error('Pending merchant records cannot be verified.');
        conservation(pending,false);
        [[merchants,record.merchantId],[references,record.reference],[transactions,pending.id],[humans,humanKey(pending.human)],
          [receipts,pending.debitReceipt],[receipts,pending.finalReceipt]].forEach(function(pair) {
          if(pair[0].has(pair[1])) throw new Error('Pending merchant records cannot be verified.');
          pair[0].add(pair[1]);
        });
      });
      var latest=purses.pendingRecords();
      if(!active || !equal(all,latest)) throw new Error('Merchant settlement changed during validation.');
      return all;
    } catch(error) {active=false;throw error;}
  }
  function admitted(human, reference, reserveCapacity) {
    var pending = records(), key = humanKey(human);
    if (!key || reserveCapacity!==false && pending.length >= MAX_PENDING) return false;
    return pending.every(function (record) {
      var other = record.state.pending.human;
      return humanKey(other) && humanKey(other) !== key && record.reference !== reference;
    });
  }
  function save(id, state, next, intentId, caller) {
    if (!active || intentId && (!state.pending || state.pending.id !== intentId)) return null;
    try {
      if(caller!==undefined&&purses.callerGuard!==true)throw new Error('Guarded commission writes are unavailable.');
      var committed = purses.compareAndCommit(id, state.revision || 0, next, caller);
      return active ? committed : null;
    } catch (error) {
      // The replacement may be durable even when its acknowledgement failed.
      // Only a newly loaded ledger can decide what happened.
      active = false;
      throw error;
    }
  }
  function identity(pending) {
    var id = transfer.resolve(pending.human.desc);
    if (!id) return 0;
    var human = transfer.identity(id);
    return equal(human, pending.human) ? id : 0;
  }
  function valid(pending, state) {
    return state && pending && (pending.version===2 && pending.terms===undefined || (pending.version===3||pending.version===4) && pending.terms!==undefined) && pending.world === world &&
      pending.reference === state.reference && pending.base === state.base &&
      typeof pending.id === 'string' && pending.id.length>0 && humanKey(pending.human) &&
      (['buy','sell','supply'].indexOf(pending.kind)>=0||pending.version===4&&pending.kind==='commission') &&
      (pending.phase === 'debit' || pending.phase === 'credit') &&
      Number.isSafeInteger(pending.sequence) && pending.sequence > 0 && pending.sequence < Number.MAX_SAFE_INTEGER &&
      pending.debitReceipt === receiptAt(pending.human, pending.sequence) &&
      pending.finalReceipt === receiptAt(pending.human, pending.sequence + 1) &&
      (pending.phase==='credit' && pending.expectedReceipt===undefined && pending.expected===undefined && pending.debit===undefined &&
        pending.previous && pending.previous.purse===undefined && pending.previous.stock===undefined ||
        pending.expectedReceipt===(pending.sequence===1?'null':receiptAt(pending.human,pending.sequence-1)));
  }
  function commitMerchant(id, state) {
    var pending = state.pending;
    if (!equal(pendingSnapshot(pending,state), pendingSnapshot(pending,pending.previous))) return null;
    return save(id, state, creditState(state), pending.id);
  }
  function creditState(state) {
    var next = Object.assign({}, copy(state), pendingSnapshot(state.pending,copy(state.pending.next)));
    next.pending.phase = 'credit';
    // Saved debit is conclusive. Its original snapshots are no longer read
    // in this phase; retaining them would crowd out the recovery snapshots.
    delete next.pending.expected;
    delete next.pending.debit;
    delete next.pending.expectedReceipt;
    next.pending.previous = {supply:copy(next.pending.previous.supply || {}),
      ...(state.pending.version===4?{commissions:copy(state.pending.previous.commissions)}:{})};
    return next;
  }
  function pruneSupplyHistory(id, state, wait) {
    if (!available() || busy) return null;
    busy = true;
    try {
      records();
      var current = purses.read(id);
      if (!current || current.pending || !equal(current, state)) return null;
      try {merchantSnapshot(current,false,current.commissions!==undefined);} catch(error) {active=false;throw error;}
      var next = copy(current), changed = false, at = now();
      Object.keys(next.supply || {}).forEach(function (key) {
        var stamp = next.supply[key];
        if (Number.isSafeInteger(stamp) && stamp > 0 && at - stamp >= wait) {
          delete next.supply[key]; changed = true;
        }
      });
      return changed ? save(id, current, next) : current;
    } finally { busy = false; }
  }
  function changedSupplyKey(previous, next) {
    var before = previous.supply || {}, after = next.supply || {};
    var keys = Object.keys(after).filter(function (key) { return before[key] !== after[key]; });
    return keys.length === 1 && Number.isSafeInteger(after[keys[0]]) && after[keys[0]] > 0 ? keys[0] : null;
  }
  function complete(id, state) {
    var pending = state.pending, next = Object.assign({}, copy(state), {pending:null});
    if (pending.kind === 'supply') {
      // Completion, including legacy intents, follows the exact saved final
      // receipt. A disconnect cannot consume the six-hour window in advance.
      var key = changedSupplyKey(pending.previous, pending.next), at = now();
      if (!key || !Number.isSafeInteger(at) || at <= 0) throw new Error('Supply completion cannot be verified.');
      next.supply[key] = at;
    }
    if(pending.kind==='commission') {
      var keys=Object.keys(pending.previous.commissions.held).filter(function(key){return !Object.prototype.hasOwnProperty.call(pending.next.commissions.held,key);});
      var completedAt=now();
      if(keys.length!==1||!Number.isSafeInteger(completedAt)||completedAt<COMMISSION_STATE.cooldownAt(pending.next.commissions.cool[keys[0]]))
        throw new Error('Commission settlement time cannot be verified.');
      if(Array.isArray(next.commissions.cool[keys[0]]))next.commissions.cool[keys[0]][0]=completedAt;
      else next.commissions.cool[keys[0]]=completedAt;
    }
    return !!save(id, state, next, pending.id) && finished(pending.id, 'done');
  }
  function reconcile(id, checked) {
    if (!available()) return false;
    var state = purses.read(id), pending = state && state.pending;
    if (!valid(pending, state) || !equal(state,checked)) return false;
    var humanId = identity(pending);
    if (!active || !humanId) return false;
    var live = transfer.receipt(humanId), saved = transfer.saved(humanId);
    if (!active) return false;
    if (live === pending.finalReceipt) {
      if (pending.phase !== 'credit' || saved !== pending.finalReceipt ||
          !equal(pendingSnapshot(pending,state), pendingSnapshot(pending,pending.next))) return false;
      return complete(id, state);
    }
    if (pending.phase === 'debit') {
      if (live === pending.expectedReceipt) {
        // Replaying the identical debit is safe only against its original
        // snapshot and receipt. A refused snapshot remains reserved.
        if (!active) return false;
        if (!equal(transfer.inventory(humanId), pending.expected)) {
          // Calls are synchronous and busy fences this instance. An unchanged
          // original receipt proves this transaction never changed inventory,
          // including after restart. No original inventory restoration is needed.
          return released(id, state, pending);
        }
        if (!active) return false;
        var currentHumanId=identity(pending);
        if (!active || currentHumanId!==humanId) return false;
        var changed = transfer.cas(humanId, pending.expected, pending.expectedReceipt, pending.debit, pending.sequence, pending.human.profileId);
        if (!active) return false;
        live = transfer.receipt(humanId); saved = transfer.saved(humanId);
        if (changed === false && live === pending.expectedReceipt)
          return released(id, state, pending);
      }
      if (live !== pending.debitReceipt || saved !== pending.debitReceipt || !active) return false;
      state = commitMerchant(id, state);
      if (!state || !active) return false;
      pending = state.pending;
    }
    if (live !== pending.debitReceipt || saved !== pending.debitReceipt || !active) return false;
    // A pre-upgrade credit intent may still contain the saved debit snapshots.
    // Compact it durably before building or replacing a recovery attempt.
    var compact = creditState(state);
    if (!equal(compact, state)) {
      state = save(id, state, bounded(compact, MAX_INTENT_BYTES), pending.id);
      if (!state || !active) return false;
      pending = state.pending;
    }
    var current = inventory(transfer.inventory(humanId));
    if (!pending.creditAttempt || !equal(pending.creditAttempt.expected, current)) {
      var next = copy(state);
      next.pending.creditAttempt = {expected:current,replacement:addEntries(current, pending.credit)};
      if(transfer.validate(next.pending.creditAttempt.replacement)!==true) throw new Error('Native inventory validation failed.');
      state = save(id, state, bounded(next, MAX_INTENT_BYTES), pending.id);
      if (!state || !active) return false;
      pending = state.pending;
    }
    if (!active) return false;
    var currentHumanId=identity(pending);
    if (!active || currentHumanId!==humanId) return false;
    transfer.cas(humanId, pending.creditAttempt.expected, pending.debitReceipt,
      pending.creditAttempt.replacement, pending.sequence + 1, pending.human.profileId);
    // A notification may throw after CAS changed inventory. The saved intent
    // and final receipt, rather than this return value, determine completion.
    if (!active || transfer.receipt(humanId) !== pending.finalReceipt || transfer.saved(humanId) !== pending.finalReceipt) return false;
    return complete(id, state);
  }
  function begin(offer) {
    if (!available() || busy) return {accepted:false,done:false,reason:'Trading is unavailable.'};
    busy = true;
    try {
      var human = transfer.identity(offer.humanId), state = purses.read(offer.merchantId);
      if (!human || human.profileId !== offer.profileId || !state || state.pending ||
          !equal(state, offer.previous) || !admitted(human, state.reference))
        return {accepted:false,done:false,reason:'A transfer is waiting.'};
      var previous;
      var version=state.commissions!==undefined?4:3;
      try {previous=merchantSnapshot(state,false,version===4);merchantSnapshot(offer.next,false,version===4);}
      catch(error) {active=false;throw error;}
      if (offer.kind === 'supply') {
        var key = changedSupplyKey(state, offer.next), owner;
        try { owner = JSON.parse(key); } catch (error) { owner = null; }
        if (!Array.isArray(owner) || owner.length !== 3 || !supplier(owner, human) ||
            owner[1] !== human.profileId || typeof owner[2] !== 'string' || !owner[2])
          throw new Error('Supply cooldown cannot be verified.');
      }
      var expected = inventory(transfer.inventory(offer.humanId));
      if (!equal(expected, offer.expected)) return {accepted:false,done:false,reason:'Your inventory changed. Choose the trade again.'};
      var receipt = transfer.receipt(offer.humanId), sequence = sequenceOf(receipt, human) + 1;
      if (transfer.saved(offer.humanId) !== receipt)
        return {accepted:false,done:false,reason:'Your previous inventory change is waiting on the save.'};
      if (!Number.isSafeInteger(sequence + 1)) throw new Error('Inventory receipt sequence is exhausted.');
      var pending = {version:version,id:world + ':' + state.reference + ':' + (state.revision || 0),world:world,
        reference:state.reference,base:state.base,human:human,kind:offer.kind,phase:'debit',
        previous:copy(previous),next:copy(offer.next),
        expected:expected,expectedReceipt:receipt,debit:inventory(offer.debit),credit:inventory({entries:offer.credit}).entries,
        sequence:sequence,debitReceipt:receiptAt(human,sequence),finalReceipt:receiptAt(human,sequence+1)};
      // Use the same native validator as CAS, including its serialized-byte
      // representation. No separate JS estimate can substitute for that check.
      [expected,pending.debit,addEntries(pending.debit,pending.credit)].forEach(function (snapshot) {
        if(transfer.validate(snapshot)!==true) throw new Error('Native inventory validation failed.');
      });
      pending.terms=conservation(pending,true);
      var armed = Object.assign({}, copy(state), {pending:pending});
      if(!valid(pending,state)) {active=false;throw new Error('Pending merchant records cannot be verified.');}
      // Either recovery inventory can reach the native/JS inventory limit.
      // Reserve both plus the JSON envelope before charging, including later
      // inventory growth. The 512 KiB intent bound stays unchanged.
      var recovery = creditState(armed);
      if (Buffer.byteLength(JSON.stringify(recovery), 'utf8') + 2 * MAX_INVENTORY_BYTES + 64 > MAX_INTENT_BYTES)
        throw new Error('The trade is too large to recover.');
      if (!save(offer.merchantId, state, bounded(armed, MAX_INTENT_BYTES),undefined,offer.caller)) return {accepted:false,done:false,reason:'The offer changed.'};
      var done = false;
      if (active) {
        try {
          var checked=records().find(function(record) {return record.merchantId===offer.merchantId;});
          done=!!checked && reconcile(offer.merchantId,checked.state);
        }
        catch (error) { report(offer.merchantId,error); if (!active) throw error; }
      }
      var after = active && purses.read(offer.merchantId);
      var cancelled = after && !after.pending && equal(pendingSnapshot(pending,after),pendingSnapshot(pending,pending.previous));
      if (done || cancelled) outcomes.delete(pending.id);
      return {accepted:!cancelled,done:done && !cancelled,id:pending.id,
        reason:cancelled ? 'Your inventory changed. Choose the trade again.' : done ? '' : 'The transfer is waiting on the save.'};
    } finally { busy = false; }
  }
  function tick() {
    if (!available() || busy) return [];
    busy = true;
    try {
      var all = records(), changed = [];
      for (var i = 0; i < Math.min(MAX_PENDING, all.length) && active; i++) {
        var record = all[(cursor + i) % all.length];
        try { if(reconcile(record.merchantId,record.state)) {changed.push(record.merchantId);errors.delete(record.merchantId);} }
        catch (error) { report(record.merchantId,error); if (!active) throw error; }
      }
      cursor = all.length ? (cursor + MAX_PENDING) % all.length : 0;
      return changed;
    } finally { busy = false; }
  }
  function withInventoryMutation(actorId,change) {
    if(!available() || busy)return {ok:false,why:'unavailable'};
    busy=true;
    var leased=true;
    try {
      var human=transfer.identity(actorId);
      if(!human || !admitted(human,'',false))return {ok:false,why:'waiting'};
      if(transfer.saved(actorId)!==transfer.receipt(actorId))return {ok:false,why:'waiting'};
      if(!active)return {ok:false,why:'unavailable'};
      var result=change(human,function(){return active && leased;});
      // Unknown receipts revoke all writers until a reload reads durable state.
      if(result && result.uncertain)active=false;
      return result;
    } finally {leased=false;busy=false;}
  }
  function canInventoryMutation(actorId) {
    if(!available() || busy)return false;
    busy=true;
    try {
      var human=transfer.identity(actorId);
      return !!human && admitted(human,'',false) && transfer.saved(actorId)===transfer.receipt(actorId) && active;
    } finally {busy=false;}
  }
  function canRetire() {
    if(!available() || busy) return false;
    busy=true;
    try {return records().every(function(record) {return record.state.pending.version===3||record.state.pending.version===4;});}
    finally {busy=false;}
  }
  function changeCommissions(id,state,next,human,caller,action) {
    if(!available()||busy||purses.callerGuard!==true||typeof caller!=='function')return null;
    busy=true;
    try {
      if(!humanKey(human)||!admitted(human,state.reference,false))return null;
      var current=purses.read(id);
      if(!current||current.pending||!equal(current,state)||
        !equal(merchantSnapshot(state),merchantSnapshot(next)))return null;
      COMMISSION_STATE.spendable(state);COMMISSION_STATE.spendable(next);
      var prior=copy(state),replacement=copy(next);
      delete prior.commissions;delete replacement.commissions;
      if(!equal(canonical(prior),canonical(replacement))||!action||!['reserve','cancel'].includes(action.kind)||
        !Number.isSafeInteger(action.at)||action.at<=0||action.at>now())throw new Error('Commission metadata action cannot be verified.');
      var changed=action.kind==='reserve'?
        COMMISSION_STATE.reserve(state.commissions,human,action.job,action.terms,action.at,state.purse):
        COMMISSION_STATE.cancel(state.commissions,human,action.job,action.token,action.at);
      if(!changed.ok||!equal(canonical(changed.next),canonical(next.commissions)))
        throw new Error('Commission metadata transition cannot be verified.');
      return save(id,state,next,undefined,caller);
    } finally {busy=false;}
  }
  // A finished transfer's outcome, 'done' or 'released', once; null while it waits or when it is not known.
  function outcome(pendingId) {
    if (!outcomes.has(pendingId)) return null;
    var how = outcomes.get(pendingId); outcomes.delete(pendingId);
    return how;
  }
  return {begin:begin,tick:tick,outcome:outcome,available:available,canRetire:canRetire,changeCommissions:changeCommissions,pruneSupplyHistory:pruneSupplyHistory,
    withInventoryMutation:withInventoryMutation,canInventoryMutation:canInventoryMutation,shutdown:function () { active=false; }};
}

module.exports = {createSettlement:createSettlement,stockRows:stockRows,inventory:inventory,takeEntries:takeEntries,
  addEntries:addEntries,metadataKey:metadataKey,MAX_PENDING:MAX_PENDING};
