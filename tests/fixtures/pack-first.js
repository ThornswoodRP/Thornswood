'use strict';
/*
  tests/fixtures/pack-first.js

  What the harnesses that post on a board or put in the drop box need since
  #4901, when those moves began to take out of a pack the way the merchant
  and quest moves do: through packFirst, with the engine's inventory
  receipts, landing only once the pack is saved.

  receipts(mp) gives a pretend engine the receipts packFirst reads, and a
  save that keeps up with every write, so a move lands as it is made. That
  is the world these harnesses test, where nobody restarts mid-move. What
  a held back save and a restart do is tests/test-4901-pack-first.js.
  It keeps what the pretend engine already has, and reads the person's
  profile from mp.get(id, 'profileId') unless it answers getNpcAIState.

  pieces(prop) is the source a harness that lifts single functions out of
  the property block puts beside them: packFirst, goldCut, the landings,
  and packs wired to that harness's own save(). A landing the harness did
  not lift what it needs for is never called.
*/

function receipts(mp) {
  const live = new Map();
  const ids = new Map();
  const markers = new Map();
  const get = mp.get.bind(mp);
  mp.get = function (id, key) {
    return key === 'thornswoodPropertyDebit' || key === 'thornswoodFurnitureDebit'
      ? markers.get(id + ':' + key) ?? null : get(id, key);
  };
  if (typeof mp.makeProperty !== 'function') { mp.makeProperty = function () {}; }
  const descOf = typeof mp.getDescFromId === 'function' ? mp.getDescFromId.bind(mp) : null;
  mp.getDescFromId = function (id) {
    const d = descOf ? descOf(id) : (Number(id) >>> 0).toString(16);
    ids.set(String(d), Number(id) >>> 0);
    return d;
  };
  if (typeof mp.getIdFromDesc !== 'function') {
    mp.getIdFromDesc = function (desc) { return ids.get(String(desc)) || 0; };
  }
  if (typeof mp.getNpcAIState !== 'function') {
    mp.getNpcAIState = function (id) {
      let pid = 0;
      try { pid = Number(mp.get(id, 'profileId')) || 0; } catch (e) { pid = 0; }
      return pid > 0 ? { isHuman: true, profileId: pid } : null;
    };
  }
  const owner = mp.getNpcAIState.bind(mp);
  mp.getNpcAIState = function (id) {
    const ai = owner(id);
    return ai ? { lifeGeneration: 0, ...ai } : null;
  };
  mp.getActorRuntimeIdentity = function () { return '123'; };
  mp.admitPackDebit = function (actor, change) {
    const ai = mp.getNpcAIState(actor);
    if (!ai) { return null; }
    return change({ desc: mp.getDescFromId(actor), profileId: ai.profileId }, function () { return true; });
  };
  mp.writeFileWhole = function (path, contents) {
    const fs = require('fs');
    fs.writeFileSync(path + '.tmp', contents);
    fs.renameSync(path + '.tmp', path);
  };
  mp.getInventoryReceipt = function (id) { return live.get(Number(id) >>> 0) || 'null'; };
  mp.getSavedInventoryReceipt = mp.getInventoryReceipt;
  mp.compareAndSetInventory = function (id, expected, receipt, next, sequence, profile) {
    const now = mp.get(id, 'inventory');
    if (mp.getInventoryReceipt(id) !== receipt ||
        JSON.stringify((now && now.entries) || []) !== JSON.stringify(expected.entries)) { return false; }
    const was = receipt === 'null' ? 0 : JSON.parse(receipt).sequence;
    if (!(sequence > was)) { throw new Error('Inventory receipt sequence must advance'); }
    mp.set(id, 'inventory', { entries: JSON.parse(JSON.stringify(next.entries)) });
    live.set(Number(id) >>> 0, JSON.stringify({ actor: mp.getDescFromId(id), profile: profile, sequence: sequence }));
    return true;
  };
  mp.compareAndSetInventoryAndProperty = function (id, expected, receipt, next, sequence, profile, property) {
    if (mp.get(id, property.name) !== property.expected ||
        mp.getActorRuntimeIdentity(id) !== property.expectedRuntimeIdentity ||
        mp.getNpcAIState(id).lifeGeneration !== property.expectedLifeGeneration) { return false; }
    const changed = mp.compareAndSetInventory(id, expected, receipt, next, sequence, profile);
    if (changed) { markers.set(id + ':' + property.name, property.replacement); }
    return changed;
  };
  return mp;
}

function cut(text, start, end) {
  const a = text.indexOf(start);
  if (a < 0) { throw new Error('the property block has no ' + start.trim()); }
  const b = text.indexOf(end, a + start.length);
  if (b < 0) { throw new Error('the property block does not end ' + start.trim()); }
  return text.slice(a, b + end.length);
}

const LANDINGS = ['landBoxGold', 'landBoxLeft', 'landPost', 'landLetter', 'landHaul'];

function pieces(prop) {
  return [
    cut(prop, '  // -- pack first (#4901), begin --', '  // -- pack first (#4901), end --'),
    cut(prop, '  function goldCut(', '\n  }\n'),
    LANDINGS.map(function (n) { return cut(prop, '  function ' + n + '(', '\n  }\n'); }).join('\n'),
    'var debits = [];',
    'var packs = packFirst(mp, function () { return debits; }, function () { save(); return true; }, {',
    "  'box-gold': landBoxGold, 'box-left': landBoxLeft, post: landPost, letter: landLetter, haul: landHaul",
    "}, function () { }, 'thornswoodPropertyDebit', function (land, row, paid) {",
    '  debits.splice(debits.indexOf(row), 1);',
    '  const line = land(row, paid); save(); return line;',
    '}, globalThis.crypto.randomUUID.bind(globalThis.crypto), mp.admitPackDebit);'
  ].join('\n');
}

function attachScenarioReservation(world) {
  // Board scenarios use no NPC load order. Exercise the real reservation
  // against an empty merchant ledger and the scenario's native stand-in.
  const box = world.box();
  const { createSettlement } = require('../../game/merchant-settlement');
  const { createNativeMerchantTransfer } = require('../../game/merchant-trading');
  const settlement = createSettlement({
    world: 'board scenario',
    purses: {
      pendingRecords: function () { return []; },
      read: function () { return null; },
      compareAndCommit: function () { throw new Error('the scenario has no merchant ledgers'); }
    },
    transfer: createNativeMerchantTransfer(box.mp)
  });
  box.__thornswoodMerchantTrade = {
    withQuestInventoryMutation: settlement.withInventoryMutation,
    shutdown: settlement.shutdown
  };
}

module.exports = { receipts: receipts, pieces: pieces, LANDINGS: LANDINGS, attachScenarioReservation: attachScenarioReservation };
