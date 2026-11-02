// ==== thornswood cuffs (#2573) ====
/*
  HANDCUFFS FOR GUARDS (#2573). Patrick, 16 Oct 2026: A and B. Cuffs as an
  action that binds somebody until a guard of that hold frees them, and only
  guards may put the Prisoner's Cuffs on somebody. All of it in the world:
  a press, an item and Skyrim's own animation, no command.

  THE GESTURE IS THE ITEM, NOT A KEY OR A PRESS. A guard puts the cuffs on
  the person in front of them by putting the Prisoner's Cuffs on from their
  own pack (the inventory's Equip), facing that person within arm's reach.
  Not E on the person: E on a person already hands over a letter the presser
  carries for them (#1595, the front plugin's deliverPress), so one press
  would have done two things. Not a look prompt key either: those send a
  chat line (lookVerb), and no slash command is allowed here at all.

  HOW THE SERVER HEARS IT, two engines:
    - With the fork's onEquipItemAttempt (skymp#73, Codex's half of #2262,
      riding the #2060 pin bump; on only with the server setting
      equipItemAttemptEnabled): the pair going on the guard is asked about
      before it is stored. The cuffs act, and the answer is false, so the
      engine leaves the pair in the pack, not worn.
    - Until then, mp.onUpdateEquipmentAttempt, which fires after the engine
      has stored the equipment: a pair newly worn by somebody facing a person
      acts the same way, and the guard's own game takes their pair back off
      (USE_PROPERTY). With the fork event on, the pair never reaches the
      stored equipment, so the two paths cannot both act on one Equip.

  CUFFING. A guard of a hold, facing a person who is not cuffed, puts on a
  pair: it moves from the guard's pack to theirs and they are bound in that
  hold's name. The hold is the hold of the place it happens (holdAt), and it
  has to be one the guard guards; a place the data gives no hold binds in
  the guard's hold when they guard exactly one. Anybody else doing the same
  facing a person is told that only a hold's guards put them on somebody
  (B), and their pair stays theirs to wear: worn with nobody in front of
  them, cuffs are clothing and do nothing.

  BOUND. The prisoner's own game equips the cuffs so they cannot be taken off
  (preventRemoval), plays Skyrim's bound hands idle, the one the Helgen
  prisoners walk with (OffsetBoundStandingStart), and turns off the fighting
  controls, so no weapon or spell can be drawn; anything drawn is put away.
  Nothing in the front plugin turns it back on (#2620); its input line names
  fighting as held (sp.storage.thornswoodControlsHeld).
  They still walk, talk, open doors and use menus. Everybody near sees the
  cuffs on the body and the idle, which the neighbour script plays on that
  body. It is written on the character, so it lasts through a logout, a
  restart and a death, until a guard frees them (A). The server half, which
  trusts no client: a bound person cannot drop the cuffs or put them in a
  container (mayLetGo, from mp.onDropItem and mp.onPutItem), and with the
  fork event on, cannot put a weapon in their hands (mayEquip).

  FREEING. A guard facing the cuffed person puts a pair on the same way: the
  cuffs come off the prisoner, the idle ends, fighting comes back, and the
  prisoner's pair goes into that guard's pack. WHICH guard: any guard of any
  hold (Patrick, 17 Oct 2026 on #2573). Freeing is not tied to a hold, the
  hold that cuffed them or the one they stand in; being a guard is the whole
  of it. Anybody else is told that any guard of any hold can take them off,
  and the prisoner is told the same as the cuffs go on.

  WHERE A GUARD'S CUFFS COME FROM. A guard of any hold who carries no cuffs
  and is not cuffed is issued one pair, at most once a real day per
  character, at the three moments that can make somebody such a guard in the
  world, and at no other time: they arrive (the per-session hook in the
  chargen tick, cameIn()), their join pass is shown (passShown(), for
  somebody who arrived still waiting on it), and they take a guard office on
  the Office page of K (guardOffice()). Not a timer looking at everybody:
  nothing changes in between. Cuffing moves the pair to the prisoner and
  freeing gives it back, so the issue only covers a pair that went away, and
  a guard whose pair went away is issued the next one when they next arrive
  a day or more later.

  THE CLIENT SCRIPTS ACT ONCE, ON A CHANGE. updateOwner and updateNeighbor
  run every frame (see SWING_PROPERTY). What the prisoner's game is told to
  do, it does once, when the record changes (v.at) or in a game that has not
  seen this record yet (a new session, so a fresh ctx.state): fighting off
  and named held, a drawn weapon put away, the pair locked on, the idle
  played. Nothing is put right again every frame or every few seconds,
  because nothing undoes it: the pair is locked on (preventRemoval), with
  fighting off nothing can be drawn, and the two front plugin rescues leave
  a held control alone (#2620). The one thing the game itself throws away
  is the idle, with the body it was played on: a load screen rebuilds the
  prisoner's own body, so their game plays it once more when the cell they
  stand in changes, and everybody else's game plays it once each time the
  prisoner's body is loaded near them. Nothing in them fails quietly: a step
  that throws is written to the game's console, once per record.

  NOTHING ABOUT THE GUARD GOES TO THE NEIGHBOURS. The record everybody near
  sees is bound, hold, at and item. Who put the cuffs on, by profile, is in
  the server log only.
*/
(function () {
  'use strict';
  var g = globalThis;
  var CUFFS_DESC = '10e039:Skyrim.esm';
  var CUFF_PROPERTY = 'thornswoodCuffed';
  var ISSUED_PROPERTY = 'thornswoodCuffsIssued';
  var ISSUE_EVERY_MS = 24 * 3600 * 1000;
  var USE_PROPERTY = 'thornswoodCuffsUsed';
  // Arm's reach, in game units (about 2.8 m), and in front: within 60 degrees
  // either side of the way the guard faces.
  var REACH = 200;
  var FRONT_COS = 0.5;
  var stamp = 0;
  // actorId -> whether their pair was worn at the last look this session.
  var wornWas = {};

  function clog() {
    var a = Array.prototype.slice.call(arguments);
    a.unshift('[cuffs]');
    log.apply(null, a);
  }
  function cuffsId() { return idOf(CUFFS_DESC); }
  function read(id, key) { try { return mp.get(id, key); } catch (e) { return null; } }
  function pidOf(id) { return Number(read(id, 'profileId')) || 0; }
  /*
    Somebody still waiting on their join pass (#410), or with no profile on
    them yet, has no character this server may act on: the number they are
    in the world under is one their client picked. Nothing they do counts
    yet, so they cuff nobody, free nobody and are issued nothing, and on
    onEquipItemAttempt (which guard() does not hold back, it is not in its
    ACTS_AS list) the cuffs give no answer at all rather than a refusal.
  */
  function waiting(id) {
    var pid = pidOf(id);
    if (!(pid > 0)) { return true; }
    var h = g.__thornswoodPassHeld;
    try { return typeof h === 'function' && !!h(pid); } catch (e) { return true; }
  }
  function hex(id) { return (Number(id) >>> 0).toString(16); }
  function carried(id) {
    var b = cuffsId();
    var inv = null;
    try { inv = mp.get(id, 'inventory'); } catch (e) { inv = null; }
    var n = 0;
    var ee = (inv && inv.entries) || [];
    for (var i = 0; i < ee.length; i++) { if (ee[i] && ee[i].baseId === b) { n += Number(ee[i].count) || 0; } }
    return n;
  }
  function cuffedBy(id) {
    var v = read(id, CUFF_PROPERTY);
    return (v && v.bound) ? v : null;
  }
  function guardHolds(pid) {
    var p = g.__thornswoodProperty;
    try {
      var o = (p && p.officeOf) ? p.officeOf(pid) : null;
      return (o && o.guardOf) ? o.guardOf.slice() : [];
    } catch (e) { return []; }
  }
  function town(hold) {
    var p = g.__thornswoodProperty;
    return (p && p.HOLD_TOWN && p.HOLD_TOWN[hold]) || String(hold);
  }
  function holdOfPlace(id) {
    var l = read(id, 'locationalData');
    if (!l || !l.cellOrWorldDesc) { return null; }
    try { return holdAt({ desc: l.cellOrWorldDesc, pos: l.pos }) || null; } catch (e) { return null; }
  }
  function tell(id, line) {
    try { notify(id, line); } catch (e) { clog('could not show', hex(id), 'the line "' + line + '":', e); }
    try { say(id, line); } catch (e2) { clog('could not say to', hex(id), 'the line "' + line + '":', e2); }
  }
  /*
    The record everybody near sees: bound, hold, at, item, and nothing about
    the guard. Their pair's worn state is looked at afresh from here on
    (wornWas), so going into or out of the cuffs is never read as a use.
  */
  function write(id, bound, hold) {
    stamp = Math.max(stamp + 1, Date.now());
    delete wornWas[id];
    mp.set(id, CUFF_PROPERTY, { bound: !!bound, hold: hold, at: stamp, item: cuffsId() });
  }

  /*
    The hold a guard binds in here: the place's, if they guard it; with no
    hold for the place, theirs when they guard exactly one. null otherwise.
  */
  function bindingHold(guardPid, place) {
    var holds = guardHolds(guardPid);
    if (place) { return holds.indexOf(place) !== -1 ? place : null; }
    return holds.length === 1 ? holds[0] : null;
  }

  /*
    May this person free somebody in cuffs? Any guard of any hold (Patrick,
    17 Oct): no hold rule at all.
  */
  function mayFree(guardPid) { return guardHolds(guardPid).length > 0; }

  /*
    The person actorId faces within arm's reach in the same cell, the nearest
    if several; 0 when there is nobody.
  */
  function facing(actorId) {
    var me = read(actorId, 'locationalData');
    if (!me || !me.pos || !me.cellOrWorldDesc) { return 0; }
    var ang = ((Number(me.rot && me.rot[2]) || 0) / 180) * Math.PI;
    var fx = Math.sin(ang), fy = Math.cos(ang);
    var on = [];
    try { on = mp.get(0, 'onlinePlayers') || []; } catch (e) { on = []; }
    var best = 0, bestD = REACH * REACH;
    for (var i = 0; i < on.length; i++) {
      var id = on[i];
      // Everybody online counts as the person in front, profile or not: one
      // still waiting is answered by used(), not looked past.
      if (id === actorId) { continue; }
      var l = read(id, 'locationalData');
      if (!l || !l.pos || l.cellOrWorldDesc !== me.cellOrWorldDesc) { continue; }
      var dx = l.pos[0] - me.pos[0], dy = l.pos[1] - me.pos[1], dz = l.pos[2] - me.pos[2];
      var d = dx * dx + dy * dy + dz * dz;
      if (d > bestD) { continue; }
      var flat = Math.sqrt(dx * dx + dy * dy);
      if (flat > 1 && (dx * fx + dy * fy) / flat < FRONT_COS) { continue; }
      best = id; bestD = d;
    }
    return best;
  }

  function bind(casterId, cp, targetId, tp) {
    var place = holdOfPlace(targetId);
    var hold = bindingHold(cp, place);
    if (!hold) {
      var mine = guardHolds(cp);
      if (!mine.length) {
        tell(casterId, 'Only a hold\'s guards may put Prisoner\'s Cuffs on somebody.');
        return false;
      }
      tell(casterId, 'You are a guard of ' + mine.map(town).join(' and ') + ', and this is ' +
                     (place ? town(place) : 'no hold of yours') + ', so you cannot put cuffs on anybody here.');
      return true;
    }
    if (!takeItemById(casterId, cuffsId(), 1)) { return true; }
    addItem(targetId, CUFFS_DESC, 1);
    write(targetId, true, hold);
    tell(casterId, 'You put the cuffs on them in the name of ' + town(hold) +
                   '. Facing them, put on a pair again to take the cuffs off.');
    tell(targetId, 'A guard of ' + town(hold) + ' puts you in cuffs. Any guard of any hold can take them off.');
    clog(hex(casterId), '(profile ' + cp + ') cuffed', hex(targetId), '(profile ' + tp + ') for', hold);
    return true;
  }

  function free(casterId, cp, targetId, tp, on) {
    if (!mayFree(cp)) {
      tell(casterId, 'They are in the cuffs of ' + town(on.hold) + '. Any guard of any hold can take them off, and you are not a guard.');
      return true;
    }
    var back = takeItemById(targetId, cuffsId(), 1);
    if (back) { addItem(casterId, CUFFS_DESC, 1); }
    write(targetId, false, on.hold);
    tell(casterId, 'You take the cuffs off. ' + (back ? 'Their pair is in your pack.' : ''));
    tell(targetId, 'A guard takes the cuffs off. Your hands are free.');
    clog(hex(casterId), '(profile ' + cp + ') freed', hex(targetId), '(profile ' + tp + ') from the cuffs of', on.hold);
    return true;
  }

  /*
    actorId has put a pair of cuffs on from their pack. True when that was
    about somebody in front of them and has been answered, so the pair does
    not stay on the wearer; false leaves it worn, as clothing.
  */
  function used(actorId) {
    if (waiting(actorId)) { return false; }
    var cp = pidOf(actorId);
    if (cuffedBy(actorId)) { return false; }
    var targetId = facing(actorId);
    if (!targetId) {
      if (guardHolds(cp).length) {
        tell(actorId, 'Face the person you mean to cuff or free, within arm\'s reach, and put the cuffs on again.');
        return true;
      }
      return false;
    }
    // The person in front still waiting on their pass, or with no profile on
    // them yet, has no state of their own loaded: a cuffed record written now
    // would land on a profile that is not yet theirs. Nothing happens, no
    // cuff, no free and no refusal; the pair stays on the wearer as clothing.
    if (waiting(targetId)) { return false; }
    var tp = pidOf(targetId);
    var on = cuffedBy(targetId);
    return on ? free(actorId, cp, targetId, tp, on) : bind(actorId, cp, targetId, tp);
  }

  function isWeapon(baseId) {
    var r = null;
    try { r = (mp.lookupEspmRecordById(Number(baseId) >>> 0) || {}).record || null; } catch (e) { r = null; }
    return !!(r && String(r.type) === 'WEAP');
  }

  /*
    The answer to the fork's onEquipItemAttempt (skymp#73): false keeps the
    item in the pack, not worn. A cuffed person puts no weapon in their
    hands; a pair of cuffs put on by somebody facing a person acts and stays
    in the pack.
  */
  function mayEquip(actorId, baseId) {
    var b = Number(baseId) >>> 0;
    if (cuffedBy(actorId)) {
      if (isWeapon(b)) { tell(actorId, 'Your hands are cuffed.'); return false; }
      return true;
    }
    if (b === cuffsId()) { return !used(actorId); }
    return true;
  }

  /*
    The stored equipment, every time it changes (mp.onUpdateEquipmentAttempt):
    the engine before onEquipItemAttempt. A pair newly worn acts as above,
    and the wearer's own game takes it back off. The first look at somebody
    after they arrive only remembers, so a pair worn at logout does nothing.
    wornWas is declared at the top of the block; cameIn() and wentOut() clear
    a person's entry, so it is per session and holds nobody offline.
  */
  function equipped(actorId, eq) {
    // Not even remembered while waiting: the first look after the pass is
    // the baseline, so a pair put on before it does nothing afterwards.
    if (!eq || typeof eq !== 'object' || waiting(actorId) || cuffedBy(actorId)) { return; }
    var b = cuffsId();
    var ee = (eq.inv && eq.inv.entries) || eq.entries || [];
    var on = false;
    for (var i = 0; i < ee.length; i++) { if (ee[i] && ee[i].baseId === b && ee[i].worn) { on = true; } }
    var was = wornWas[actorId];
    wornWas[actorId] = on;
    if (was === undefined || was || !on) { return; }
    if (used(actorId)) {
      stamp = Math.max(stamp + 1, Date.now());
      try { mp.set(actorId, USE_PROPERTY, { at: stamp, item: b }); } catch (e) { clog('could not hand back the pair of', hex(actorId) + ':', e); }
    }
  }

  /*
    May actorId let go of count of baseId (a drop, or a put into a
    container)? Not the pair locked on their wrists while they are bound.
  */
  function mayLetGo(actorId, baseId, count) {
    if (Number(baseId) !== cuffsId() || !cuffedBy(actorId)) { return true; }
    if (carried(actorId) - (Number(count) || 1) >= 1) { return true; }
    tell(actorId, 'The cuffs are locked on your wrists.');
    return false;
  }

  /* One pair for a guard who has none, at most once a real day. */
  function issue(actorId) {
    if (waiting(actorId)) { return false; }
    var pid = pidOf(actorId);
    var holds = guardHolds(pid);
    if (!holds.length || cuffedBy(actorId) || carried(actorId) > 0) { return false; }
    var last = Number(read(actorId, ISSUED_PROPERTY)) || 0;
    if (Date.now() - last < ISSUE_EVERY_MS) { return false; }
    if (!addItem(actorId, CUFFS_DESC, 1)) { return false; }
    try { mp.set(actorId, ISSUED_PROPERTY, Date.now()); } catch (e) { clog('could not write the issue of', hex(actorId) + ':', e); }
    tell(actorId, 'As Guard of ' + town(holds[0]) + ' you are issued a pair of Prisoner\'s Cuffs. ' +
                  'Facing somebody within arm\'s reach, put the cuffs on from your pack to cuff them, and again to free them.');
    clog('issued a pair of cuffs to', hex(actorId), '(profile ' + pid + ')');
    return true;
  }

  /*
    THE PER-SESSION HOOK (the chargen tick's first sight of somebody, #1642).
    A new session starts with no look at their pair yet, and a guard who is
    not still waiting on their pass is issued theirs now; one who is waiting
    is issued it when the pass is shown (passShown).
  */
  function cameIn(actorId) {
    delete wornWas[actorId];
    if (waiting(actorId)) { return false; }
    return issue(actorId);
  }
  /* Gone from the world (the same tick's offline pass): nothing kept on them. */
  function wentOut(actorId) {
    delete wornWas[actorId];
  }
  /*
    Their join pass was shown (the dispatcher's /joinpass, on the change from
    held to shown only, so the launcher's later passes do nothing here).
  */
  function passShown(pid) {
    pid = Number(pid) || 0;
    if (!pid) { return false; }
    var on = [];
    try { on = mp.get(0, 'onlinePlayers') || []; } catch (e) { clog('could not list who is online for the pass of profile', pid + ':', e); return false; }
    for (var i = 0; i < on.length; i++) {
      if (pidOf(on[i]) === pid) { return issue(on[i]); }
    }
    return false;
  }
  /* They took a guard office on the Office page of K (the property block's office hold). */
  function guardOffice(actorId) {
    return issue(actorId);
  }

  /*
    The lines every client script starts with: step(what, f) runs one thing
    the game is asked to do, and one that throws is written to the game's
    console with what it was, once per record (v.at), not every frame.
  */
  var SCRIPT_HEAD = [
    '  var sp = ctx.sp, st = ctx.state, v = ctx.value;',
    '  if (!v || !v.at || !st) { return; }',
    '  function report(what, e) {',
    '    var seen = st.thornswoodCuffReported || (st.thornswoodCuffReported = {});',
    '    var key = what + " " + v.at;',
    '    if (seen[key]) { return; }',
    '    seen[key] = true;',
    '    sp.printConsole("[thornswood] cuffs: could not " + what + ": " + e);',
    '  }',
    '  function step(what, f) { try { f(); } catch (e) { report(what, e); } }'
  ];

  /*
    The prisoner's own game. Everything once, on a change of record or in a
    game new to it; after that only which cell they stand in is read, so the
    idle a load screen throws away is played once more.
  */
  function ownerScript() {
    return ['(function(){'].concat(SCRIPT_HEAD, [
      '  step("look at the cuffed record", function () {',
      '    var pc = sp.Game.getPlayer();',
      '    if (!pc) { return; }',
      '    var cuffs = v.item ? sp.Game.getFormEx(v.item) : null;',
      '    var cell = pc.getParentCell();',
      '    var where = cell ? cell.getFormID() : 0;',
      '    if (st.thornswoodCuffAt !== v.at) {',
      '      st.thornswoodCuffAt = v.at;',
      '      if (!v.bound) {',
      '        if (!st.thornswoodCuffBound) { return; }',
      '        st.thornswoodCuffBound = false;',
      '        st.thornswoodCuffWhere = 0;',
      '        step("take the cuffs off", function () { if (cuffs) { pc.unequipItem(cuffs, false, true); } });',
      '        step("end the bound idle", function () { sp.Debug.sendAnimationEvent(pc, "OffsetStop"); });',
      '        step("stop naming fighting held", function () { if (sp.storage.thornswoodControlsHeld) { delete sp.storage.thornswoodControlsHeld.fighting; } });',
      '        step("give fighting back", function () { sp.Game.enablePlayerControls(false, true, false, false, false, false, false, false, 0); });',
      '        return;',
      '      }',
      '      st.thornswoodCuffBound = true;',
      '      st.thornswoodCuffWhere = where;',
      '      step("name fighting held", function () { var held = sp.storage.thornswoodControlsHeld || {}; held.fighting = "cuffed"; sp.storage.thornswoodControlsHeld = held; });',
      '      step("turn fighting off", function () { sp.Game.disablePlayerControls(false, true, false, false, false, false, false, false, 0); });',
      '      step("put the weapon away", function () { if (pc.isWeaponDrawn()) { pc.sheatheWeapon(); } });',
      '      step("lock the cuffs on", function () { if (cuffs && pc.getItemCount(cuffs) > 0) { pc.equipItem(cuffs, true, true); } });',
      '      step("play the bound idle", function () { sp.Debug.sendAnimationEvent(pc, "OffsetBoundStandingStart"); });',
      '      return;',
      '    }',
      '    if (!v.bound || !where || st.thornswoodCuffWhere === where) { return; }',
      '    st.thornswoodCuffWhere = where;',
      '    step("play the bound idle after a load", function () { sp.Debug.sendAnimationEvent(pc, "OffsetBoundStandingStart"); });',
      '  });',
      '})();'
    ]).join('\n');
  }

  /* The wearer's own game, once per use: the pair they put on comes back off. */
  function useScript() {
    return ['(function(){'].concat(SCRIPT_HEAD, [
      '  if (st.thornswoodCuffUseAt === v.at) { return; }',
      '  st.thornswoodCuffUseAt = v.at;',
      '  step("take back off the pair that was used", function () {',
      '    var pc = sp.Game.getPlayer();',
      '    var cuffs = v.item ? sp.Game.getFormEx(v.item) : null;',
      '    if (pc && cuffs && pc.isEquipped(cuffs)) { pc.unequipItem(cuffs, false, true); }',
      '  });',
      '})();'
    ]).join('\n');
  }

  /*
    Everybody else's game: the idle on the prisoner's body, once on each
    change, and once each time that body is loaded near them (it comes with
    a fresh body, which does not keep an idle played on the last one).
  */
  function neighborScript() {
    return ['(function(){'].concat(SCRIPT_HEAD, [
      '  step("look at the cuffed record nearby", function () {',
      '    var a = sp.Actor.from(ctx.refr);',
      '    if (!a) { return; }',
      '    var changed = st.thornswoodCuffAt !== v.at;',
      '    st.thornswoodCuffAt = v.at;',
      '    if (!v.bound) {',
      '      if (changed && st.thornswoodCuffBound) {',
      '        st.thornswoodCuffBound = false;',
      '        step("end the bound idle nearby", function () { sp.Debug.sendAnimationEvent(a, "OffsetStop"); });',
      '      }',
      '      return;',
      '    }',
      '    st.thornswoodCuffBound = true;',
      '    if (!a.is3DLoaded()) { st.thornswoodCuffShown = false; return; }',
      '    if (!changed && st.thornswoodCuffShown) { return; }',
      '    st.thornswoodCuffShown = true;',
      '    step("play the bound idle nearby", function () { sp.Debug.sendAnimationEvent(a, "OffsetBoundStandingStart"); });',
      '  });',
      '})();'
    ]).join('\n');
  }

  try {
    mp.makeProperty(CUFF_PROPERTY, {
      isVisibleByOwner: true,
      isVisibleByNeighbors: true,
      updateOwner: ownerScript(),
      updateNeighbor: neighborScript()
    });
  } catch (e) {
    // Made by a previous load: a changed script needs a restart, which a deploy is.
    clog('the', CUFF_PROPERTY, 'property was made already, so its scripts are the last load\'s until a restart:', e);
  }
  try {
    mp.makeProperty(USE_PROPERTY, {
      isVisibleByOwner: true, isVisibleByNeighbors: false,
      updateOwner: useScript(), updateNeighbor: ''
    });
  } catch (e) {
    clog('the', USE_PROPERTY, 'property was made already, so its script is the last load\'s until a restart:', e);
  }
  try {
    mp.makeProperty(ISSUED_PROPERTY, {
      isVisibleByOwner: false, isVisibleByNeighbors: false,
      updateOwner: '', updateNeighbor: ''
    });
  } catch (e) {
    clog('the', ISSUED_PROPERTY, 'property was made already (a reload):', e);
  }

  /*
    ONE ENGINE EVENT, MORE THAN ONE GATE. A cuffed person's weapon, and a
    pair put on facing somebody, go through the fork's onEquipItemAttempt,
    which the strength gate (#2262, #2621) answers too. mp holds one handler
    per event, so this wraps whatever is already there, the same way the
    strength gate does (Waystone, f3e954cb), and whichever loads second holds
    the first:
      - the item is refused when either gate says no (false), allowed only
        when both let it through, the same in either load order;
      - the gate already there is asked first, and when it refuses, this one
        says nothing more, so nobody is told two refusals for one Equip;
      - only false is a no; an answer of nothing (or 0, null, '') is not a
        refusal, and the cuffs still decide;
      - somebody still waiting on their join pass gets no answer from the
        cuffs (a bare return), never a refusal, and the pair does nothing.
    A reload of the gamemode does not stack a second copy:
      - finding its own wrapper from the last load on top (HELD), it takes the
        gate that wrapper was holding;
      - a copy of an earlier load still held inside another gate's wrapper
        (the strength block loads before this one in the file, so on a reload
        it wraps the old cuffs gate) knows it is old (GEN) and only passes on
        what the gate it holds answers, so the cuffs are asked once.
  */
  var HELD = '__thornswoodCuffsHeld';
  var GEN = g.__thornswoodCuffsGen = (Number(g.__thornswoodCuffsGen) || 0) + 1;
  var equipBefore = mp.onEquipItemAttempt;
  if (typeof equipBefore === 'function' && Object.prototype.hasOwnProperty.call(equipBefore, HELD)) { equipBefore = equipBefore[HELD]; }
  if (typeof equipBefore !== 'function') { equipBefore = null; }
  var cuffsGate = guard('onEquipItemAttempt', function (actorId, baseId) {
    // Only a strict false is a refusal, from the gate held or from this one;
    // anything else it answers (true, nothing, 0, null) leaves it to the cuffs.
    var before = equipBefore ? equipBefore(actorId, baseId) : undefined;
    if (before === false) { return false; }
    if (GEN !== g.__thornswoodCuffsGen) { return before; }
    if (waiting(actorId)) { return; }
    return mayEquip(actorId, baseId);
  });
  cuffsGate[HELD] = equipBefore;
  mp.onEquipItemAttempt = cuffsGate;

  g.__thornswoodCuffs = {
    used: used, facing: facing, mayEquip: mayEquip, equipped: equipped, mayFree: mayFree,
    useScript: useScript, USE_PROPERTY: USE_PROPERTY, equipBefore: equipBefore, REACH: REACH,
    mayLetGo: mayLetGo, issue: issue, cameIn: cameIn, wentOut: wentOut, passShown: passShown,
    guardOffice: guardOffice, cuffedBy: cuffedBy,
    bindingHold: bindingHold, ownerScript: ownerScript, neighborScript: neighborScript,
    CUFFS_DESC: CUFFS_DESC, CUFF_PROPERTY: CUFF_PROPERTY, ISSUE_EVERY_MS: ISSUE_EVERY_MS
  };
})();
// ==== end thornswood cuffs ====

/*
  WHAT GOES IN A CONTAINER: ordinary goods, with bound quest items refused.

  mp.onPutItem(containerRefrId, actorId, baseId, count) fires before anything
  moves, and PutItemEvent::OnFireSuccess is what removes the items, so
  returning false REFUSES the put and the thing stays in the hand. Measured in
  the fork rather than assumed.

  No container here has a rule of its own any more. The one that did, a chest
  a steward marked as a hold's box, which took only gold and counted it onto
  the hold's ledger, was retired (#2298, Patrick, 15 Oct, decision 3 A): the
  drop box on the notice board is the only box, and it is an activator whose
  contents are the server's record, never a container. The handler stays for
  guard(): a session that has not shown its join pass is refused a put like
  every other act (ACTS_AS, #410). Bound quest items also stay with their work,
  and for the cuffs: the pair locked on a prisoner's wrists cannot be put in
  any container (mayLetGo, #2573). All other valid item identities fall off
  the end.
*/
mp.onPutItem = guard('onPutItem', function (containerRefrId, actorId, baseId, count) {
  if(questItemBlocked(baseId))return false;
  // The pair locked on a prisoner's wrists stays there (#2573).
  var cuffsPut = globalThis.__thornswoodCuffs;
  if (cuffsPut && !cuffsPut.mayLetGo(actorId, baseId, count)) { return false; }
  return;
});

/*
  WHAT A CLIENT CAN ASK THIS SERVER, AND WHAT IT IS TOLD.

  Written down on 24 September for the To Do List entry "The gamemode
  registers four event handlers, so nothing server-side watches for
  griefing", which asked for this before anything else: "Establish what the
  client is allowed to ask the server to do and block the rest at the handler
  level, then log what was allowed."

  Read out of the fork (C:\Thornswood-Dev\skymp, thornswood/engine-changes)
  rather than remembered. PacketParser.cpp is every message a client can
  send, and server_guest_lib\gamemode_events is every event that reaches a
  function on mp. tools\test-audit-handlers.js checks the events and the
  Papyrus names below against the fork whenever the fork is on the machine it
  runs on.

  EVERY EVENT A HANDLER HERE CAN ANSWER. The engine calls mp[name] when it is
  a function, and ScampServerListener::OnMpApiEvent reads what comes back:
  undefined and true let it through, false refuses it (except in the Papyrus
  family, where it refuses nothing), and a throw is logged and lets it
  through. So a handler with no opinion returns nothing at all.
  Fifteen events have a fixed name, and they come first. Two families build
  their name when they fire: the Papyrus family, onPapyrusEvent:<Name>, which
  is the one that hears hits and spells and has its own heading below, and
  custom events, whose name is whatever the client sent (CUSTOM EVENTS AND
  PACKETS).

  THE FIFTEEN WITH A FIXED NAME.

    onActivate    Pressing E on anything. mp.onActivate refuses on named paths
                  only: a bench that is not theirs, a locked door whose client
                  lock did not run (never a door that is a way out, WAY_OUT),
                  the spoils rule, and the stations, crops, plants, fish,
                  game, veins and bodies this server hands out itself. Every
                  other door, chest and item falls off the end, and Skyrim
                  does what it always did.
    onCraft       A finished craft. mp.onCraft refuses a recipe nobody makes
                  here, or one the person's trade, rank or race does not
                  allow; a key with no stamped mold; a hafted thing with no
                  handle in the pack; a brew or an enchantment by somebody
                  whose trade is not that bench's; and a craft that matched no
                  recipe but makes an item a recipe here owns, asked the same
                  race, profession and rank question; and a temper at the
                  sharpening wheel or the armour table (#1384). A refusal
                  keeps their materials.
    onCraftWork   Asked before anything else about a craft, with onCraft's own
                  arguments (CraftService::OnCraftItem, fork #115). A false
                  refuses the craft with nothing taken. mp.onCraftWork names
                  the time the craft is held at the bench by its size, small
                  1 s, medium 5 s, large 15 s (HOW LONG A CRAFT TAKES AT THE
                  BENCH, #3161), and onCraft is asked only when the time is
                  up.
    onPutItem     Putting into a container. Bound quest items and unverified
                  item identities are refused before diagnostics, alongside
                  the join-pass guard and the cuffs on a prisoner's wrists
                  (#2573). No container-specific ledger remains.
    onTakeItem    Taking out of a container or a body. Watched below, and
                  refused for bound quest items or unverifiable identities,
                  and by THE TAKE LIMIT, another person's
                  body or a container in a building another person holds.
                  TakeItemEvent::OnFireSuccess is what removes the items, so
                  a false here refuses the take.
    onDropItem    Dropping from the pack onto the ground. Bound quest items
                  and unverified item identities are refused. MpActor::DropItem stops before RemoveItems on a
                  false. Gold cannot be dropped at all: DropItem returns before
                  the event is raised for Gold001.
    onDying       Health about to reach nothing, asked before the engine
                  kills and before anything is sent (#1626). mp.onDying
                  refuses only for Cheat Death, and then writes dyingHealth,
                  the health the engine keeps them at.
    onDeath       Anything dying. mp.onDeath never refuses. It logs a person's
                  death with the killer's id, and that line is the only record
                  of a fight this file keeps. The hits before it raise
                  onPapyrusEvent:OnHit, which only the warrior maneuvers and
                  the break chance in the durability block listen to (THE
                  PAPYRUS FAMILY, below).
    onRespawn     Logged by mp.onRespawn, never refused.
    onEatItem     Eating or drinking something in the pack. The engine
                  raises it from the client's equip message once it has
                  checked the pack holds the thing (MpActor::OnEquip), then
                  takes one out and applies a potion's effects. mp.onEatItem
                  in the injury and disease block hears it for a potion of
                  cure disease (#1383) and never refuses, and hands every
                  swallow to the needs block (eaten, #3136).
    onSpellCast   A cast the engine has checked (the sender's own actor or one
                  it hosts, alive, with the spell equipped), before it goes
                  out to anybody near, and not the message that interrupts a
                  cast: (caster, spell, how many times its usual time the
                  caster's machine gave its effects). mp.onSpellCast, after
                  the skill perks block, answers through the caster's
                  spellCastDurationMult how long its effects hold on
                  everybody else's machine (Overcharge, #2848); it is 1, the
                  game's own, until a handler sets it. A false refuses
                  nothing: the cast was made on the caster's own machine.
    onReadBook    Reading a book. A spell tome teaches only under the Mage
                  rules (a spell point, the rank, a spell of the rank below),
                  and mp.onReadBook refuses it otherwise, keeping the tome
                  and saying which is missing (THE SPELL TOMES, #1026); it
                  also records a staff's spell for somebody who makes staves
                  (THE STAFF SPELLS, #967). Books stopped moving anybody's
                  rank on 21 September.
    onUpdateAppearanceAttempt
                  A face sent to the server. The engine refuses it by itself
                  unless the server opened the race menu
                  (ActionListener::OnUpdateAppearance), and its OnFireBlocked
                  is not written, so nothing here may ever return false to it.
                  mp.onUpdateAppearanceAttempt holds the one body value in it,
                  weight, to 0 to 100 and drops any field the engine does not
                  know (BODY SHAPE, below, #993). It always returns true.
    onUpdateEquipmentAttempt
                  What somebody is wearing, once the engine has taken it, and
                  the same warning about false. The engine checks it itself,
                  by equipmentSpellCheckEnabled and equipmentSlotCheckEnabled
                  in server-settings.json. mp.onUpdateEquipmentAttempt hears it
                  for the college block (#1387), which takes back a spell the
                  book does not list from somebody's hands, and it returns
                  nothing.
    onEquipItemAttempt
                  Each item an equipment update puts on that the server's
                  record does not already have on, asked once, before the
                  update is stored (ActionListener::OnUpdateEquipment, #2262).
                  A false refuses that item alone: the engine keeps the rest
                  of the update, records the item as in the pack and not
                  worn, and tells the owner's game to take it off. Raised only
                  while equipItemAttemptEnabled is on in server-settings.json.
                  Nothing here answers it yet, so every item goes on.

  THE PAPYRUS FAMILY, mp['onPapyrusEvent:<Name>']. Every Papyrus event the
  engine sends goes through MpForm::SendPapyrusEvent, which wraps it in a
  PapyrusEventEvent and fires it the way the fifteen above are fired, under
  the name "onPapyrusEvent:" followed by the Papyrus name. A handler is called
  with the id of the form the event is sent on, then the Papyrus arguments
  (PapyrusUtils::GetJsValueFromPapyrusValue): a form as { type: 'form', desc },
  a record as { type: 'espm', desc }, None as null, and numbers and flags as
  themselves. These are the names the fork sends:

    OnHit         A hit from a client: (target, aggressor, weapon or spell,
                  null, power, sneak, bash, blocked). ActionListener::OnHit
                  raises it once it has checked that the aggressor is the
                  sender or an actor the sender hosts, that the target is in
                  the same cell or world and, unless it is a bow or crossbow
                  shot, within 4096 units, that the aggressor is alive, and
                  that the weapon or spell is one it has equipped, or a bare
                  fist. It fires before the attack speed and splash checks and
                  before the damage, so a hit those checks then throw away was
                  still raised. The blocked flag is the engine's own decision,
                  made before the event (fork PR 84).
    OnSpellCast   A cast of a spell the caster has equipped, by the sender or
                  an actor it hosts: (caster, spell). Raised after the cast has
                  already gone out to everybody nearby, and not for the second
                  message that interrupts a cast.
    OnObjectEquipped
                  A client's equip message for a weapon, armour, ammunition,
                  a torch, a scroll, a potion, an ingredient or a book the
                  actor holds, or a spell it has learned (MpActor::OnEquip):
                  (actor, item, null).
    OnItemAdded   One kind of item added to a pack or a container by
                  MpObjectReference::AddItem: (the pack or container, item,
                  count, null, null). AddItems, which adds several kinds at
                  once, raises nothing.
    OnActivate    An activation mp.onActivate did not refuse: (the thing, who
                  pressed it).
    SkympOnActivateClose
                  The second press that closes a container the presser had
                  open: (the container, who pressed it).
    OnTriggerEnter, OnTriggerLeave, OnTrigger
                  Something moving into, out of, or about inside a trigger
                  box: (the box, what moved). OnTrigger is raised on every
                  position update while it stays inside.
    OnInit, OnCellLoad, OnLoad
                  A reference the first time a person comes near it: (the
                  reference).
    OnUpdate      A form's registered update coming due: (the form).

  A FALSE HERE REFUSES NOTHING. MpForm::SendPapyrusEvent does not read what
  Fire returns, and PapyrusEventEvent::OnFireSuccess only hands the event to
  the world's Papyrus scripts. So on a false the hit still lands, the spell
  was already cast and the item was already added, and all that is stopped is
  the event reaching a lever's or a quest's own script. That is why nothing
  here may ever return false to this family. This file listens to two
  names: OnHit, for the warrior maneuvers (#1386), the break chance at 0% in
  the durability block (#1384), a wound in the injury block (#1383) and a
  reanimate spell on a person's body (#1387); and OnSpellCast, one handler
  in the injury block, for a healing spell (#1383) and restoration strain
  (#1387). The engine does not build the
  arguments for a name mp has no function for, so the rest of the family
  costs this file nothing.

  WHAT THE ENGINE ANSWERS WITH NO EVENT AT ALL. Movement, animation, animation
  variables, health, magicka and stamina, bow shots (one arrow is taken),
  hosting an NPC nobody connected owns, and the reply to a script the server
  asked the client to run. None of them raises anything a handler here could
  hear. An UpdateProperty message is parsed and dropped.

  HITS AND SPELLS are answered by the engine too, and they do raise an event,
  onPapyrusEvent:OnHit and onPapyrusEvent:OnSpellCast, but only once the
  engine has already let them through and, for a cast, sent it on. So a
  handler here can hear one person hit another and cannot refuse a hit or a
  spell. The engine itself refuses a hit or a cast sent for an actor the
  sender is not hosting.

  CONSOLE COMMANDS, WHICH IS WHERE ITEM CREATION WOULD COME IN. The client
  forwards exactly five (consoleCommandsService.ts): additem, equipitem,
  placeatme, disable and mp. ConsoleCommands::Execute runs EnsureAdmin on
  every one, which throws unless the actor has consoleCommandsAllowed or
  server-settings.json sets enableConsoleCommandsForAll. Nothing in this
  repository sets either, checked with git grep on 24 September, so every one
  is refused for everybody, and a changed client that sends a sixth name gets
  "Unknown command name". There is no console event, so no mp.on handler can
  reach any of this.

  CUSTOM EVENTS AND PACKETS. A custom event reaches mp[name] only when the name
  starts with an underscore (ActionListener::OnCustomEvent). This file defines
  no mp._ function, so every one is answered by nothing. A custom packet goes
  to the server's own systems in skymp5-server\ts, where the login is the one
  that answers it, and never to this file.

  CHAT. A line starting with a slash rides the voice service's socket and is
  queued there under the profile its token proves, or under the profile it
  claims while THORNSWOOD_VOICE_AUTH is not 'on' (voice-server.js defaults it
  to 'log'). The voice service writes every one to its chat log. handle() in
  the chat command block answers it, and WORDS is every word it answers. /tp,
  /goto, /give and /spawn refuse anybody who is not a playtester or an admin,
  and /give and /spawn log what they made. That is the one way a person can
  make an item on this server, and it is logged.

  WHAT IS REFUSED, AND WHY ONLY THAT. The rules page asks for "no griefing",
  and rule 4 in the world says "You cannot empty someone's house because you
  found it unlocked while they were offline". Patrick decided on 28 September
  (issue #475) which takes the server holds to that rule: another person's
  body and another person's containers, online or offline, a few things each
  and only a share of a stack. THE TAKE LIMIT below is that and nothing more.
  A handler that answers false too eagerly shuts every chest in Skyrim for
  everybody at once, so every other take is watched and let through.

  Hits are a different case: nothing here can refuse one, only hear it,
  through onPapyrusEvent:OnHit. The warrior maneuvers listen to it (#1386)
  and change what a hit took only after the engine has applied it, and the
  durability block hears it for the break chance at 0% (#1384), and the
  college block for a reanimate spell landing on a person's body (#1387),
  which it answers by putting the body back down; none of them logs a
  blow. It is raised for every blow the engine takes, a hosted bandit's as
  much as a person's, so which blows are worth a line, one person hitting
  another being the obvious one, belongs to the same decision.
*/

/*
  WATCHED, NEVER REFUSED: TAKING AND DROPPING.

  Rule 4 goes on: "If you were robbed and it went too far, say so. It gets put
  back." Putting it back needs a record of what was taken, by whom, out of
  what and where, and until these two the server kept none: a take and a drop
  raised an event with nothing on mp to hear it.

  So each one is a line in thornswood.log through log(), the same file as every
  other line here. It names the person by profile and character name, the item
  by its descriptor (the name wornName settled on, because it says which
  plugin a thing came from) and the count, the container or body it came out
  of, and the cell the person was standing in, which for a house is the house.
  Grep for "take:" and "drop:".

  THEY RETURN NOTHING, with one exception, and that is the whole of the
  safety. guard() turns a throw into undefined and every read below has its
  own try, so the worst a fault here can do is a line with less in it. The
  exception is a take THE TAKE LIMIT refuses: a false then, and a "take
  refused:" line. A limit that is missing or throws lets the take through.
*/

/*
  A person is a profile above zero. Measured in the fork: an actor's
  profileId comes out of its change form, and MpChangeForms.h starts it at -1,
  so an NPC answers -1 and not 0. A body that answers -1 is an NPC's, not a
  person's.
*/
function auditProfile(refrId) {
  var pid = 0;
  try { pid = Number(mp.get(refrId, 'profileId')) || 0; } catch (e) { pid = 0; }
  return pid > 0 ? pid : 0;
}

function auditPerson(actorId) {
  var id = Number(actorId) || 0;
  var name = '';
  try {
    var ap = mp.get(id, 'appearance');
    name = String((ap && ap.name) || '');
  } catch (e) { name = ''; }
  var pid = auditProfile(id);
  if (!pid) { return '0x' + id.toString(16) + (name ? ' (' + name + ')' : ''); }
  return 'profile ' + pid + ' (' + (name || 'no name') + ', 0x' + id.toString(16) + ')';
}

function auditItem(baseId) {
  var id = Number(baseId) || 0;
  var desc = '';
  try { desc = String(mp.getDescFromId(id) || ''); } catch (e) { desc = ''; }
  return desc || ('0x' + id.toString(16));
}

function auditSource(refrId) {
  var id = Number(refrId) || 0;
  if (auditProfile(id)) { return 'the body of ' + auditPerson(id); }
  var base = '';
  try { base = String(mp.get(id, 'baseDesc') || ''); } catch (e) { base = ''; }
  return '0x' + id.toString(16) + (base ? ' (' + base + ')' : '');
}

function auditCell(actorId) {
  var cell = '';
  try { cell = String(mp.get(actorId, 'worldOrCellDesc') || ''); } catch (e) { cell = ''; }
  return cell || 'a cell the server could not read';
}

mp.onTakeItem = guard('onTakeItem', function (sourceRefrId, actorId, baseId, count) {
  if(questItemBlocked(baseId))return false;
  var limit = globalThis.__thornswoodTakeLimit;
  var no = null;
  try { no = (limit && limit.take) ? limit.take(sourceRefrId, actorId, baseId, count) : null; }
  catch (e) { no = null; }
  if (no) {
    log('take refused:', auditPerson(actorId), 'asked for', Number(count) || 0, auditItem(baseId),
        'from', auditSource(sourceRefrId), 'in', auditCell(actorId), '(' + no + ')');
    return false;
  }
  log('take:', auditPerson(actorId), 'took', Number(count) || 0, auditItem(baseId),
      'from', auditSource(sourceRefrId), 'in', auditCell(actorId));
});

mp.onDropItem = guard('onDropItem', function (actorId, baseId, count) {
  if(questItemBlocked(baseId))return false;
  // The pair locked on a prisoner's wrists is not dropped (#2573).
  var cuffsDrop = globalThis.__thornswoodCuffs;
  if (cuffsDrop && !cuffsDrop.mayLetGo(actorId, baseId, count)) { return false; }
  log('drop:', auditPerson(actorId), 'dropped', Number(count) || 0, auditItem(baseId),
      'in', auditCell(actorId));
  // The engine puts the piece's extra, its condition in the name included,
  // on the dropped reference and gives it back on the pickup (#1719).
});

/*
  BODY SHAPE: HEIGHT AND WEIGHT, NOTHING ELSE (#993).

  Patrick, 28 September: "I don't want jiggle physics or the ability to change
  boob/pussy/dick/ass/nipple related stuff during creation." For men and women
  alike. Height and weight stay.

  WHAT A CLIENT CAN SEND. The one thing a client sends about its body is the
  appearance (UpdateAppearanceMessage), and the engine keeps eleven fields of
  it: isFemale, raceId, weight, skinColor, hairColor, headpartIds,
  headTextureSetId, options (the face sliders), presets (the face presets),
  tints and name (Appearance.h). Nothing in it is a breast, a butt, a genital
  or a nipple: RaceMenu's body sliders and body morphs are NiOverride data on
  the person's own machine and SkyMP never sends them, so nobody else's game
  ever draws them. Height is the same, on the person's own machine only.

  WEIGHT IS THE ONE THAT CARRIES SHAPE. The game draws a body between its thin
  and heavy meshes by weight, and the difference between those two meshes is
  mostly chest, hips and seat. The race menu offers 0 to 100; a changed client
  can send 300 or -200, which draws that difference three times over, and the
  engine stores it and sends it on to everybody near (ActionListener.cpp
  OnUpdateAppearance). So weight is held to 0 to 100 here, and anything that is
  not one of the eleven fields is dropped, so a field some later client adds
  cannot carry a shape through either.

  WHEN. mp.onUpdateAppearanceAttempt hears every appearance the engine stored,
  straight after it was stored and sent on. A corrected one is set back with
  mp.set, which stores it and sends it to everybody who can see that person
  (AppearanceBinding::Set), so the stretched body lasts one message. It always
  returns true: its refusal is not written in the engine (see the list of
  events above), and the engine decides the race menu question itself.

  CHARACTERS MADE BEFORE THIS. thornswoodBodyReset in server-settings.json,
  on unless it is false (Patrick, 28 September: existing characters are reset
  to the default body shape, height and weight stay adjustable). Each
  character is looked at once when it comes online and its stored appearance
  is put through the same check. The person's own machine clears any body
  slider it still holds on its own (thornswood-front.js, "body shape").
*/
const BODY_APPEARANCE_FIELDS = ['isFemale', 'raceId', 'weight', 'skinColor', 'hairColor',
  'headpartIds', 'headTextureSetId', 'options', 'presets', 'tints', 'name'];
const BODY_WEIGHT_MIN = 0;
const BODY_WEIGHT_MAX = 100;
// What a weight that is not a number at all becomes: the middle of the slider.
const BODY_WEIGHT_DEFAULT = 50;

function bodyResetWanted() {
  try {
    const s = mp.getServerSettings();
    if (s && s.thornswoodBodyReset === false) { return false; }
  } catch (e) {
    // no settings object. on is the default Patrick chose.
  }
  return true;
}

/**
 * The appearance with only height-and-weight body shape left in it, and what
 * was changed. Null when there is no appearance to look at.
 */
function bodyShapeGuard(appearance) {
  if (!appearance || typeof appearance !== 'object' || Array.isArray(appearance)) { return null; }
  const out = {};
  const changes = [];
  for (const k of Object.keys(appearance)) {
    if (BODY_APPEARANCE_FIELDS.indexOf(k) < 0) { changes.push('dropped ' + k); continue; }
    out[k] = appearance[k];
  }
  if (Object.prototype.hasOwnProperty.call(appearance, 'weight')) {
    const w = Number(appearance.weight);
    let held = w;
    if (appearance.weight === null || appearance.weight === '' || !isFinite(w)) { held = BODY_WEIGHT_DEFAULT; }
    else if (w < BODY_WEIGHT_MIN) { held = BODY_WEIGHT_MIN; }
    else if (w > BODY_WEIGHT_MAX) { held = BODY_WEIGHT_MAX; }
    if (held !== appearance.weight) {
      changes.push('weight ' + String(appearance.weight) + ' -> ' + held);
    }
    out.weight = held;
  }
  return { appearance: out, changes: changes };
}

/** Puts one character's stored appearance through bodyShapeGuard. */
function bodyShapeCheck(actorId, appearance, why) {
  const r = bodyShapeGuard(appearance);
  if (!r || !r.changes.length) { return false; }
  mp.set(actorId, 'appearance', r.appearance);
  log('body shape:', auditPerson(actorId), why + ':', r.changes.join(', '));
  return true;
}

mp.onUpdateAppearanceAttempt = guard('onUpdateAppearanceAttempt', function (actorId, appearance, isAllowed) {
  if (isAllowed) { bodyShapeCheck(actorId, appearance, 'sent'); }
  if (isAllowed && hasStoredAppearance(appearance)) {
    const st = chargenOf(actorId);
    if (st && st.stage === 'appearance') {
      beginChoosing(actorId, st, 'the face arrived');
    }
  }
  return true;
});

(function bodyResetExisting() {
  const g = globalThis;
  if (g.__thornswoodBodyReset) { clearInterval(g.__thornswoodBodyReset); g.__thornswoodBodyReset = null; }
  if (!bodyResetWanted()) {
    log('body shape: characters made before the body sliders went are left as they are (thornswoodBodyReset is false)');
    return;
  }
  const seen = new Set();
  g.__thornswoodBodyReset = setInterval(guard('bodyResetExisting', function () {
    let online;
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { return; }
    const here = new Set(online);
    for (const id of Array.from(seen)) { if (!here.has(id)) { seen.delete(id); } }
    for (const id of online) {
      if (seen.has(id)) { continue; }
      seen.add(id);
      let a = null;
      try { a = mp.get(id, 'appearance'); } catch (e) { a = null; }
      bodyShapeCheck(id, a, 'made before the body sliders went');
    }
  }), 5000);
})();

/*
  THE TAKE LIMIT: A FEW THINGS FROM ANOTHER PERSON, AND ONLY A SHARE OF A STACK.

  Patrick, 28 September, issue #475: "Bodies and storages even if they are
  offline they should be allowed to take some things. They should not be
  allowed to just take alot off of them and if they take spetum it should only
  be a percentages and still count as one of the few so let's say they can take
  3 things and if they are taking something that is a stack only a percentage
  of that stack". Rule 4 on the rules page says the same thing in the world's
  words: "Take something. Take a good thing. Leave the rest".

  WHAT IS LIMITED. A take from another person's body, and a take from a
  container in a building another person holds (the property register,
  holderOf, which is the one record of who owns what). Whether that person is
  online makes no difference. Everything else is let through untouched: a
  world container nobody holds, an NPC's body, your own body and anything in
  a building you hold.

  THE RULE. At most TAKE_LIMIT takes per taker, per body or container, per
  TAKE_WINDOW_MS. A stack counts as one take, and one take may carry off no
  more than STACK_SHARE of that stack, rounded down and never less than one.
  The taker is a profile, not a character, so a second character on the same
  account does not start a fresh count.

  WHY 24 HOURS AND NOT A RESPAWN. A body here is the person's own actor: it
  gets up where it respawns and falls again as the same reference, so there is
  no new body to hang a fresh count on, and a container has no natural end at
  all. One real day is the same answer for both, and it is easy to say in
  chat. The window starts at the first take and the fourth is refused until it
  has run out.

  WHY A TAKE OVER THE SHARE IS REFUSED RATHER THAN SHRUNK. The engine hands
  mp.onTakeItem a count and moves exactly that count on success
  (TakeItemEvent::OnFireSuccess, RemoveItems on the entry it was given, which
  is const). A handler can only say yes or no. So the taker is told in chat how
  many of that stack they may take, and takes again.

  THE CLIENT MOVES THE ITEM FIRST and then asks (containersService.ts), so on a
  refusal the taker's own pack is sent back to them as the server has it, the
  same message every successful take sends, and the thing leaves their pack
  again. It is still in the body or container, and opening it again shows it.

  THE COUNTS SURVIVE A RESTART, in the private folder as take-limit.json,
  written to a temp copy and renamed like characters.json. A deploy restarts
  the server, and a limit that a restart forgets is a limit a thief waits out.
  Rows past their window are dropped whenever the file is read or written.
*/
(function () {
  'use strict';
  var g = globalThis;

  // How many takes one person may make from one body or one container.
  var TAKE_LIMIT = 3;
  // How long those takes are counted for: 24 real hours from the first one.
  var TAKE_WINDOW_MS = 24 * 60 * 60 * 1000;
  // How much of one stack one take may carry off: a quarter, rounded down, at least 1.
  var STACK_SHARE = 0.25;

  var fs = null, path = null;
  try { fs = require('fs'); path = require('path'); } catch (e) { return; }

  var privDir = 'private';
  try {
    var cfg = JSON.parse(fs.readFileSync('server-settings.json', 'utf8'));
    if (cfg && cfg.privDir) { privDir = String(cfg.privDir); }
  } catch (e) { }
  var FILE = path.join(privDir, 'take-limit.json');

  function now() { return Date.now(); }

  // "<taker profile>|<source form id in hex>" -> { n: takes counted, at: first take }
  var counts = loadCounts();

  function loadCounts() {
    var out = {};
    var raw = null;
    try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return out; }
    var rows = (raw && typeof raw === 'object' && raw.counts && typeof raw.counts === 'object')
      ? raw.counts : {};
    var t = now();
    for (var k in rows) {
      if (!Object.prototype.hasOwnProperty.call(rows, k) || k === '__proto__') { continue; }
      var r = rows[k];
      var n = Number(r && r.n) || 0;
      var at = Number(r && r.at) || 0;
      if (n <= 0 || at <= 0 || t - at >= TAKE_WINDOW_MS) { continue; }
      out[k] = { n: n, at: at };
    }
    return out;
  }

  function saveCounts() {
    var t = now();
    for (var k in counts) {
      if (Object.prototype.hasOwnProperty.call(counts, k) && t - counts[k].at >= TAKE_WINDOW_MS) {
        delete counts[k];
      }
    }
    // Whole, with the engine's mp.writeFileWhole (#2740). Until then a temp
    // file and node's renameSync, and when Windows refused the rename (it
    // does while any other program has the file open) the counts were
    // written in place after all. A refused write now leaves the last counts
    // written whole and says so here.
    try {
      fs.mkdirSync(privDir, { recursive: true });
      mp.writeFileWhole(FILE, JSON.stringify({ at: t, counts: counts }));
    } catch (e) {
      console.log('[thornswood] could not write the take limit: ' + e);
    }
  }

  function profileOf(refrId) {
    var pid = 0;
    try { pid = Number(mp.get(refrId, 'profileId')) || 0; } catch (e) { pid = 0; }
    return pid > 0 ? pid : 0;
  }

  /*
    Whose this body or container is, or null when it is nobody's. A body
    answers its own profile id (an NPC answers -1, which is nobody). A
    container answers whoever holds the building it stands in, found by the
    cell it is in, since a building here is its interior cell.
  */
  function ownerOf(refrId) {
    var pid = profileOf(refrId);
    if (pid) { return { pid: pid, what: 'body' }; }
    var prop = g.__thornswoodProperty;
    if (!prop || !prop.holderOf) { return null; }
    var cell = '';
    try { cell = String(mp.get(refrId, 'worldOrCellDesc') || ''); } catch (e) { cell = ''; }
    if (!cell) { return null; }
    var held = null;
    try { held = prop.holderOf(cell); } catch (e) { held = null; }
    var by = held ? (Number(held.by) || 0) : 0;
    return by > 0 ? { pid: by, what: 'container' } : null;
  }

  /*
    How many of this item the body or container holds before the take.

    A STACK IS ONE RECORD AND ONE NAME (#2675). A hair dye is a Bowl entry
    with the dye's name, and three dyes beside forty plain bowls are a stack
    of three, not of forty three. The engine tells this handler the record
    and the count and not which entry they came from (TakeItemEvent in the
    fork: "TODO: implement extra data"), so of the named stacks that could
    have given that many, the smallest is the one counted: the share is never
    worked out in the taker's favour. With one name on the record, which is
    every record but a named one, it is the whole stack, as before.
  */
  function stackOf(refrId, baseId, n) {
    var inv = null;
    try { inv = mp.get(refrId, 'inventory'); } catch (e) { inv = null; }
    var entries = (inv && inv.entries) || [];
    var byName = {};
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || Number(e.baseId) !== Number(baseId)) { continue; }
      var key = typeof e.name === 'string' ? 'n:' + e.name : '-';
      byName[key] = (byName[key] || 0) + (Number(e.count) || 0);
    }
    var least = 0, total = 0;
    for (var k in byName) {
      if (!Object.prototype.hasOwnProperty.call(byName, k)) { continue; }
      total += byName[k];
      if (byName[k] >= (n || 1) && (!least || byName[k] < least)) { least = byName[k]; }
    }
    return least || total;
  }

  /* Send the taker their pack as the server has it, so a refused item leaves it. */
  function packAsServerHasIt(actorId) {
    try { mp.set(actorId, 'inventory', mp.get(actorId, 'inventory')); } catch (e) { }
  }

  function refuse(actorId, text, why) {
    say(actorId, text);
    packAsServerHasIt(actorId);
    return why;
  }

  /*
    The answer to one take: null lets it through, a short reason refuses it
    (mp.onTakeItem logs the reason and answers false).
  */
  function limitTake(sourceRefrId, actorId, baseId, count) {
    var taker = profileOf(actorId);
    if (!taker) { return null; }
    var owner = ownerOf(sourceRefrId);
    if (!owner || owner.pid === taker) { return null; }

    var n = Number(count) || 0;
    if (n < 1) { n = 1; }
    var key = taker + '|' + ((Number(sourceRefrId) || 0) >>> 0).toString(16);
    var row = Object.prototype.hasOwnProperty.call(counts, key) ? counts[key] : null;
    if (row && now() - row.at >= TAKE_WINDOW_MS) { row = null; }
    var used = row ? row.n : 0;
    var where = owner.what === 'body' ? 'this body' : 'this container';

    if (used >= TAKE_LIMIT) {
      var hours = Math.max(1, Math.ceil((row.at + TAKE_WINDOW_MS - now()) / 3600000));
      return refuse(actorId, 'You have already taken ' + TAKE_LIMIT + ' things from ' + where +
                    '. Leave the rest. You may take again in ' + hours +
                    (hours === 1 ? ' hour.' : ' hours.'),
                    'the limit of ' + TAKE_LIMIT + ' takes');
    }

    var stack = stackOf(sourceRefrId, baseId, n);
    if (stack < n) { stack = n; }
    if (stack > 1) {
      var share = Math.max(1, Math.floor(stack * STACK_SHARE));
      if (n > share) {
        return refuse(actorId, 'You may take up to ' + share + ' of those ' + stack +
                      ', not ' + n + '. Only ' + Math.round(STACK_SHARE * 100) +
                      '% of a stack may be taken from ' + where + '.',
                      'over the share, ' + share + ' of ' + stack);
      }
    }

    counts[key] = { n: used + 1, at: row ? row.at : now() };
    saveCounts();
    return null;
  }

  g.__thornswoodTakeLimit = {
    take: limitTake, ownerOf: ownerOf,
    TAKE_LIMIT: TAKE_LIMIT, TAKE_WINDOW_MS: TAKE_WINDOW_MS, STACK_SHARE: STACK_SHARE
  };
})();
// end of the take limit

