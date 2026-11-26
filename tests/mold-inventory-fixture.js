'use strict';
// Models the existing native CAS/receipt signature; native implementation and
// publication ordering are source-verified in the pinned engine, not proved here.
module.exports = function nativeBoundary(E) {
  const copy = x => JSON.parse(JSON.stringify(x));
  const receipt = {}, saved = {}, runtime = {}, calls = [];
  let busy = false, uncertain = false, hook;
  const reserved = new Set();
  const identity = id => E.pid[id] ? {desc:desc(id),profileId:E.pid[id]} : null;
  const desc = id => id.toString(16);
  const previousDesc = E.mp.getDescFromId;
  E.mp.getDescFromId = id => E.pid[id] ? desc(id) : previousDesc(id);
  E.mp.getActorRuntimeIdentity = id => runtime[id] || '100';
  E.mp.getInventoryReceipt = id => receipt[id] || 'null';
  E.mp.getSavedInventoryReceipt = id => saved[id] || 'null';
  E.mp.validateInventoryTransaction = value => {
    if (!value || !Array.isArray(value.entries) || !value.entries.every(e =>
      Number.isInteger(e.baseId) && e.baseId > 0 && Number.isInteger(e.count) && e.count > 0)) throw Error('invalid native inventory');
    return true;
  };
  E.mp.compareAndSetInventory = (actor, expected, oldReceipt, replacement, sequence, profile) => {
    const entryRuntime = E.mp.getActorRuntimeIdentity(actor);
    const call = {actor,expected:copy(expected),receipt:oldReceipt,next:copy(replacement),sequence,profile};
    calls.push(call);
    const fault = hook && hook(call,calls.length);
    if (fault === 'throw-before') throw Error('native precommit failure');
    if (fault === false) return false;
    if (E.mp.getActorRuntimeIdentity(actor) !== entryRuntime) return false;
    if (E.pid[actor] !== profile) throw Error('native profile mismatch');
    if (E.mp.getInventoryReceipt(actor) !== oldReceipt ||
      JSON.stringify({entries:E.packs[actor]}) !== JSON.stringify(expected)) return false;
    const old = JSON.parse(oldReceipt);
    if (!Number.isSafeInteger(sequence) || sequence !== (old ? old.sequence+1 : 1)) throw Error('invalid sequence');
    E.mp.validateInventoryTransaction(replacement);
    E.packs[actor] = copy(replacement.entries);
    receipt[actor] = JSON.stringify({actor:desc(actor),profile,sequence});
    if (fault === 'throw-after') throw Error('native committed before publication failure');
    return true;
  };
  function mutate(actor, change, holder) {
    if (busy || uncertain || reserved.has(actor) ||
        E.mp.getSavedInventoryReceipt(actor) !== E.mp.getInventoryReceipt(actor)) return {ok:false,why:'waiting'};
    busy = true;
    try {
      const recipient = holder === undefined ? undefined : identity(holder);
      if (holder !== undefined && (!recipient || reserved.has(holder) ||
          E.mp.getSavedInventoryReceipt(holder) !== E.mp.getInventoryReceipt(holder))) return {ok:false,why:'waiting'};
      const result = change(identity(actor),() => busy,recipient);
      if (result && result.uncertain) uncertain = true;
      return result;
    } finally {busy=false;}
  }
  const merchants = {
    withQuestInventoryMutation: mutate,
    withPairedInventoryMutation(actor, holder, change) { return mutate(actor,change,holder); }
  };
  return {calls,merchants,runtime,receipt,saved,reserved,
    hook(fn) {hook=fn;},
    ack() {Object.assign(saved,receipt);},
    uncertain:() => uncertain};
};
