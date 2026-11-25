// Atomic active spell membership for characters with preserved spell history.
(function () {
  'use strict';
  var g = globalThis;
  function prepare(state) {
    var P = g.__thornswoodProgression, SS = g.__thornswoodStaffSpells;
    if (!SS) { return { ok: false, why: 'the spell catalogue is not running' }; }
    return P.activeKnowledge(state, SS.rankOf);
  }
  function commit(actorId, expected, replacement) {
    if (typeof mp.compareAndSetActorPropertyAndSpells !== 'function') {
      throw new Error('This engine cannot commit character progression and active spells together.');
    }
    if (typeof mp.getActorLearnedSpells !== 'function') { throw new Error('This engine cannot read the full learned spell snapshot.'); }
    var P = g.__thornswoodProgression, SS = g.__thornswoodStaffSpells;
    var runtime = mp.getActorRuntimeIdentity(actorId);
    var identity = mp.getNpcAIState(actorId);
    var current = mp.getActorLearnedSpells(actorId);
    if (!Array.isArray(current) || current.length > 4096 || current.some(function (id, i) {
      return !Number.isInteger(id) || id <= 0 || id >= 0xff000000 || current.indexOf(id) !== i;
    })) { throw new Error('The full learned spell snapshot cannot be read safely.'); }
    current = current.slice();
    var managed = Object.keys(P.SPELL_IDS).map(function (name) { return P.SPELL_IDS[name]; })
      .concat(Object.keys(SS.STAFF_SPELLS)).map(function (desc) { return mp.getIdFromDesc(desc); });
    var college = g.__thornswoodCollege;
    if (!college || !college.spellKind) { throw new Error('The spell type catalogue is not running.'); }
    var history = replacement.spellHistory.otherSpells;
    var next = current.filter(function (id) {
      if (managed.indexOf(id) >= 0) { return false; }
      var kind = college.spellKind(id);
      if (!kind || [0, 1, 2, 3, 4, 5, 10, 11].indexOf(kind.type) < 0) {
        throw new Error('An unrelated spell type cannot be read safely.');
      }
      var desc = mp.getDescFromId(id);
      if (kind.type !== 0 || (typeof INSTRUMENT_SPELL !== 'undefined' && String(INSTRUMENT_SPELL).toLowerCase() === String(desc).toLowerCase())) {
        return true;
      }
      if (history.indexOf(desc) < 0) { history.push(desc); }
      return false;
    });
    var wanted = replacement.spells.known.map(function (name) { return P.SPELL_IDS[name]; })
      .concat(replacement.staffSpells);
    wanted.forEach(function (desc) {
      var id = mp.getIdFromDesc(desc);
      if (!Number.isInteger(id) || id <= 0) { throw new Error('An eligible spell has no form in this load order.'); }
      if (next.indexOf(id) < 0) { next.push(id); }
    });
    return mp.compareAndSetActorPropertyAndSpells(actorId, identity.profileId, {
      name: g.__thornswoodCharacter.PROPERTY, expected: expected, replacement: replacement,
      expectedRuntimeIdentity: runtime, expectedLifeGeneration: identity.lifeGeneration,
      expectedSpells: current, replacementSpells: next
    });
  }
  g.__thornswoodCharacterKnowledge = { prepare: prepare, commit: commit };
})();
