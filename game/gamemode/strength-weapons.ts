// ==== thornswood strength weapons ====
/*
  STRENGTH AND THE HEAVY WEAPONS (#2262).

  Patrick, 16 Oct 2026 on #2262: Might (the skill tree sub-skill, 0 to 5,
  docs/systems/skill-tree.md) is the strength stat. A weapon weighing 30 to
  44 needs Might 3, and the Giant's Club or anything weighing 45 or more
  needs Might 5. Keyed off the weapon's own weight, never a record id, so a
  playable Giant's Club the collection adds later is gated the moment it is
  in the load order, with nothing here to edit.

  WHY THE ENGINE EVENT AND NOT onUpdateEquipmentAttempt. That one fires after
  the engine has already saved the equipment, and its OnFireBlocked is not
  written, so a false there changes nothing; mp.set of 'equipment' throws for
  an actor a client owns; and an unequip snippet sent to the client is skipped
  by a modified client while the server record still says the club is worn.
  So the gate is onEquipItemAttempt(actorId, baseId), added on the fork
  (Codex's half of #2262, riding the #2060 pin bump): it fires once for each
  item newly worn, BEFORE the save, and a false drops that item from the
  update, the client unequips it and it stays in the pack. With no handler
  the engine behaves as it always has, so this block is inert on an engine
  that does not yet raise the event.

  LOGIN NEVER STRIPS A WEAPON. The fork asks only about an item the update
  puts on that the server's saved record does not already have on
  (ActionListener::OnUpdateEquipment, alreadyWornIds). At login the record is
  the saved one, so the client's first report after spawn, which names what
  the game put back on, matches it and asks about nothing that was worn when
  they left. Only an item newly put on reaches this gate.

  NO CHARACTER, NO DECISION. guard() does not hold this event for somebody
  still waiting on their join pass (it is not in ACTS_AS, and must not be:
  a false there would refuse everything they put on). So the gate answers
  nothing (undefined, which the engine treats as allowed) while:
    - the join pass still holds their profile (__thornswoodPassHeld), since
      the character on that actor is not yet proven theirs;
    - the actor has no character record, or one that is not a loaded state
      (the character block's own test: an object with v 1), or a state with
      no tree yet.
  It reads the record straight off the actor and never calls stateOf, which
  would migrate, and so write, a character the moment somebody equips. A
  missing tree is not Might 0: that would strip a weapon from somebody whose
  character simply is not in yet. Once the character is in, the gate
  applies.

  The weight is the WEAP record's DATA: value u32 at 0, weight float at 4,
  damage u16 at 8 (libespm WEAP.h). A record that is not a WEAP, or has no
  readable DATA, is never refused: armour, spells and torches are not this
  rule's business, and a weapon whose weight cannot be read is not guessed.

  Only an actor with a character record is gated. An NPC has no Might.

  The K panel (game/ui/thornswood-skills.js, the Might row) shows the same
  two thresholds; tests/test-2262-strength-weapons.js holds the two equal.
*/
(function () {
  'use strict';
  var g = globalThis;

  var STRENGTH = {
    // Heaviest first: the first row a weapon reaches is its requirement.
    tiers: [
      { weight: 45, might: 5 },
      { weight: 30, might: 3 }
    ],
    refused: 'You are not strong enough to wield this.'
  };

  function slog() {
    var a = ['[thornswood strength]'].concat([].slice.call(arguments));
    try { console.log(a.join(' ')); } catch (e) { }
  }
  function hex(id) { return (Number(id) >>> 0).toString(16); }

  var weights = {};
  /* The weapon's weight, or null when the record is not a WEAP or cannot be read. */
  function weightOf(baseId) {
    var id = Number(baseId) >>> 0;
    if (!id) { return null; }
    if (Object.prototype.hasOwnProperty.call(weights, id)) { return weights[id]; }
    var w = null;
    var res = null;
    try { res = mp.lookupEspmRecordById(id) || null; } catch (e) { res = null; }
    var rec = res && res.record;
    if (rec && String(rec.type) === 'WEAP') {
      var fields = rec.fields || [];
      for (var i = 0; i < fields.length; i++) {
        if (!fields[i] || String(fields[i].type) !== 'DATA') { continue; }
        var b = fields[i].data || [];
        if (b.length >= 8) {
          var view = new DataView(new ArrayBuffer(4));
          for (var k = 0; k < 4; k++) { view.setUint8(k, b[4 + k] & 0xff); }
          var f = view.getFloat32(0, true);
          if (isFinite(f) && f >= 0) { w = f; }
        }
        break;
      }
    }
    weights[id] = w;
    return w;
  }

  /* Might a weight needs: 0 for every ordinary weapon. */
  function needFor(weight) {
    if (weight === null || weight === undefined || !isFinite(weight)) { return 0; }
    for (var i = 0; i < STRENGTH.tiers.length; i++) {
      if (weight >= STRENGTH.tiers[i].weight) { return STRENGTH.tiers[i].might; }
    }
    return 0;
  }
  function needOf(baseId) { return needFor(weightOf(baseId)); }

  /*
    The person's Might points, or null when there is no loaded character to
    decide from (see NO CHARACTER, NO DECISION above).
  */
  function joinPassHolds(actorId) {
    var held = g.__thornswoodPassHeld;
    if (typeof held !== 'function') { return false; }
    var pid = 0;
    try { pid = Number(mp.get(actorId, 'profileId')) || 0; } catch (e) { pid = 0; }
    return pid > 0 && !!held(pid);
  }
  function mightOf(actorId) {
    var ch = g.__thornswoodCharacter;
    if (!ch || !ch.PROPERTY) { return null; }
    if (joinPassHolds(actorId)) { return null; }
    var s = null;
    try { s = mp.get(actorId, ch.PROPERTY); } catch (e) { s = null; }
    if (!s || typeof s !== 'object' || s.v !== 1) { return null; }
    if (!s.tree || typeof s.tree !== 'object') { return null; }
    return Math.max(0, Number(s.tree.might) || 0);
  }

  function lines(need) { return [STRENGTH.refused, 'Needs Might ' + need]; }

  /*
    The answer to onEquipItemAttempt: true lets the item be worn, false drops
    it from the update and leaves it in the pack, undefined is no decision
    (no loaded character yet) and lets it through. Told in the world (the
    notification and the chat line), never through a command.
  */
  function allow(actorId, baseId) {
    var need = needOf(baseId);
    if (!need) { return true; }
    var might = mightOf(actorId);
    if (might === null) { return undefined; }
    if (might >= need) { return true; }
    var l = lines(need);
    slog(hex(actorId), 'refused', hex(baseId), '(weight ' + weightOf(baseId) + ', Might ' + might + ' of ' + need + ')');
    notify(actorId, l[0]);
    notify(actorId, l[1]);
    say(actorId, l[0] + ' ' + l[1] + '.');
    return false;
  }

  /*
    ONE ENGINE EVENT, MORE THAN ONE GATE. The cuffs (#2573, #2618) answer
    onEquipItemAttempt as well, and mp holds one handler per event, so a plain
    assignment would throw away whichever block registered first. This one
    wraps whatever is already there instead, and the cuffs do the same with
    whatever they find, so whichever loads second holds the first:
      - the item is refused when either gate says no (false), and allowed
        only when both let it through;
      - the gate already there is asked first, and when it refuses, this one
        says nothing more, so a person never gets two refusals for one press;
      - only false is a no. A handler that answers nothing, or throws inside
        guard() (which then answers undefined), is not a refusal, the same as
        the engine reads it.
    The answer is the same in either load order. A reload of this file finds
    its own wrapper from the last load on mp and takes the gate it was holding
    (HELD below), so the chain never grows a second copy of this gate.
  */
  var HELD = '__thornswoodStrengthHeld';
  var before = mp.onEquipItemAttempt;
  if (typeof before === 'function' && Object.prototype.hasOwnProperty.call(before, HELD)) { before = before[HELD]; }
  if (typeof before !== 'function') { before = null; }
  var gate = guard('onEquipItemAttempt', function (actorId, baseId) {
    if (before && before(actorId, baseId) === false) { return false; }
    return allow(actorId, baseId);
  });
  gate[HELD] = before;
  mp.onEquipItemAttempt = gate;

  g.__thornswoodStrength = {
    STRENGTH: STRENGTH, weightOf: weightOf, needFor: needFor, needOf: needOf,
    mightOf: mightOf, joinPassHolds: joinPassHolds, allow: allow, lines: lines, before: before
  };
  slog('ready');
})();
// ==== end thornswood strength weapons ====
