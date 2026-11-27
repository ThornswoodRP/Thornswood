// ==== thornswood staff scene tools (#6628) ====
// The contract, trust boundary and real-game checks are in
// docs/systems/staff-tools.md. Only server-owned properties reach natives.
(function () {
  'use strict';
  var g = globalThis;
  if (!g.__thornswoodCommandTools || !g.__thornswoodCommandTools.register) {
    throw new Error('Staff scene tools require the registered command catalog.');
  }
  var WORDS = ['/fly', '/phase', '/godmode', '/invisible', '/cleareffects', '/killall'];
  var OWNER = 'thornswoodStaffTools', VISIBLE = 'thornswoodStaffVisible';
  var REACH = 1500, MOST = 40, PHASE = 256;
  var active = {}, serial = Number(g.__thornswoodStaffToolsSerial) || 0;
  var RUN = serverRunId();

  function tell(pid, text) { if (g.__thornswoodToProfile) { g.__thornswoodToProfile(pid, text); } }
  function report(word, pid, actor, why, extra) {
    var staff = g.__thornswoodStaff;
    if (staff && staff.record) { staff.record(word.slice(1), pid, nameOf(actor), pid, nameOf(actor), why, 0, extra); }
  }
  function nameOf(actor) {
    try { var appearance = mp.get(actor, 'appearance'); return String(appearance && appearance.name || 'staff'); }
    catch (e) { return 'staff'; }
  }
  function pass(pid) { var seen = g.__thornswoodPassSeen; return seen && seen.passes && seen.passes[pid]; }
  function permitted(cmd, word, pid, actor) {
    var staff = g.__thornswoodStaff;
    if (!staff || !staff.authorizeTool || staff.authorizeTool(cmd,pid,actor,word === '/killall' ? 'admin' : 'playtester')) { return false; }
    return mp.get(actor, 'isDead') === false;
  }
  function vec(v) { return Array.isArray(v) && v.length === 3 && v.every(Number.isFinite); }
  function place(actor) {
    var out = {desc: mp.get(actor, 'worldOrCellDesc'), pos: mp.get(actor, 'pos'), rot: mp.get(actor, 'angle')};
    if (typeof out.desc !== 'string' || !out.desc || !vec(out.pos) || !vec(out.rot)) { throw new Error('actor location is unavailable'); }
    return out;
  }
  function movementRefusal(pid, actor) {
    var state = g.__thornswoodStaffState;
    if (!state || !state.frozen) { return 'The staff restraint state is unavailable.'; }
    var staff = g.__thornswoodStaff;
    if (staff && staff.frozenFor ? staff.frozenFor(pid) : state.frozen[pid]) { return 'Staff have frozen you in place.'; }
    // The jail helper treats an unreadable cell as outside jail. Establish
    // a readable authoritative location before asking that existing helper.
    place(actor);
    var cuffs = g.__thornswoodCuffs, property = g.__thornswoodProperty;
    if (!cuffs || !cuffs.cuffedBy || !property || !property.lockedJailHere) { return 'The restraint checks are unavailable.'; }
    if (cuffs.cuffedBy(actor)) { return 'Your hands are cuffed.'; }
    if (property.lockedJailHere(actor, pid)) { return 'A guard has a cell locked here.'; }
    return '';
  }
  function publish(actor, row) {
    var seq = ++serial; g.__thornswoodStaffToolsSerial = serial;
    row.flight = (row.fly === true || row.godmode === true) && !movementRefusal(row.pid,Number(actor));
    var current = pass(row.pid), until = current ? Number(current.x) : 0;
    row.until = until;
    mp.set(actor, OWNER, {fly: row.flight, godmode: row.godmode === true, seq: seq,run:RUN,until:until});
    mp.set(actor, VISIBLE, {invisible: row.invisible === true, seq: seq,run:RUN,until:until});
  }
  function revoke(actor, row, why) {
    if (row.godmode) {
      var needs = g.__thornswoodNeeds;
      try { if (needs && needs.settle) { needs.settle(Number(actor)); } }
      catch (e) { log('staff tools: needs could not settle before revocation: ' + e); }
      mp.set(actor, 'isGodMode', false);
      try { if (needs && needs.godmodeChanged) { needs.godmodeChanged(Number(actor)); } }
      catch (e) { log('staff tools: needs could not redraw after revocation: ' + e); }
    }
    publish(actor, {});
    delete active[actor];
    report('/tools-off', row.pid, Number(actor), why);
  }
  function tick() {
    Object.keys(active).forEach(function (key) {
      var row = active[key], actor = Number(key);
      try {
        var current = pass(row.pid), roles = g.__thornswoodCommandRoles;
        var online = mp.get(0, 'onlinePlayers');
        if (!Array.isArray(online) || online.indexOf(actor) < 0 ||
            Number(mp.get(actor, 'profileId')) !== row.pid || mp.get(actor, 'isDead') !== false ||
            mp.getActorRuntimeIdentity(actor) !== row.life ||
            !current || !(Number(current.x) > Date.now()) || !roles || !roles.playtester || !roles.playtester(row.pid) ||
            (row.godmode && mp.get(actor, 'isGodMode') !== true)) {
          revoke(actor, row, 'The staff session or its authority ended.'); return;
        }
        if (Number(current.x) !== row.until) { publish(actor,row); }
        var restrained = movementRefusal(row.pid, actor);
        if (row.flight && restrained) {
          row.fly = false; publish(actor, row);
          report('/fly', row.pid, actor, 'off: movement is restrained');
          tell(row.pid, 'Flight ended because movement is restrained.');
        }
        else if (!row.flight && (row.fly || row.godmode) && !restrained) { publish(actor,row); }
      } catch (e) {
        // Failure to read authority must revoke, never renew, a privilege.
        try { revoke(actor, row, 'Staff authority could not be checked.'); }
        catch (failure) { log('staff tools: could not revoke actor ' + actor + ': ' + failure); }
      }
    });
  }
  function toggle(words, current) {
    if (!words.length) { return !current; }
    if (words.length !== 1 || (words[0] !== 'on' && words[0] !== 'off')) { return null; }
    return words[0] === 'on';
  }
  function killable(id, cell, origin) {
    var population = g.__thornswoodNpcPopulation;
    if (!population || !population.staffKillable || !population.staffKillable(id)) { return false; }
    // This native answer establishes actor type, ownership and authored NPC
    // flags. A missing field is not evidence that an actor is safe to kill.
    var s = mp.getNpcAIState(id);
    if (!s || !Number.isInteger(s.profileId) || s.profileId >= 0 ||
        s.isHuman !== false || s.isConnected !== false || s.isServerControlled !== true ||
        s.isEssential !== false || s.isProtected !== false || s.isUnique !== false ||
        s.isDead !== false || s.isDisabled !== false || !Number.isInteger(s.aggression) ||
        s.aggression < 2 || s.aggression > 3 || s.cellOrWorld !== cell || !vec(s.pos)) { return false; }
    return Math.hypot(s.pos[0]-origin[0], s.pos[1]-origin[1], s.pos[2]-origin[2]) <= REACH;
  }
  function killall(pid, actor) {
    var here = place(actor), cell = mp.getIdFromDesc(here.desc);
    if (!Number.isInteger(cell) || cell <= 0) { throw new Error('cell identity is unavailable'); }
    var nearby = mp.getNeighborsByPosition(cell, here.pos);
    if (!Array.isArray(nearby)) { throw new Error('nearby actors are unavailable'); }
    var candidates = [], seen = {}, failed = [], killed = [];
    nearby.forEach(function (id) {
      if (!Number.isInteger(id) || id <= 0 || id === actor || seen[id]) { return; }
      seen[id] = true;
      try {
        if (!killable(id, cell, here.pos)) { return; }
        var pos = mp.getNpcAIState(id).pos;
        candidates.push({id:id, distance:Math.hypot(pos[0]-here.pos[0],pos[1]-here.pos[1],pos[2]-here.pos[2])});
      } catch (e) { /* An unreadable actor is excluded, never presumed an NPC. */ }
    });
    candidates.sort(function (a,b) { return a.distance-b.distance || a.id-b.id; });
    candidates.slice(0,MOST).forEach(function (target) {
      try {
        // Recheck immediately before the write, including all identity flags.
        if (!killable(target.id,cell,here.pos)) { failed.push(target.id); return; }
        mp.set(target.id,'isDead',true);
        if (mp.get(target.id,'isDead') === true) { killed.push(target.id); }
        else { failed.push(target.id); }
      } catch (e) { failed.push(target.id); }
    });
    tell(pid, 'Ended ' + killed.length + ' nearby hostile NPCs. ' + failed.length + ' could not be ended. People and protected NPCs were excluded.');
    report('/killall',pid,actor,'Nearby hostile NPCs only.',{killed:killed,failed:failed,limit:MOST,reach:REACH});
  }
  function command(cmd, word, words, pid, actor) {
    if (WORDS.indexOf(word) === -1) { return false; }
    try {
      if (!permitted(cmd,word,pid,actor)) { tell(pid,'That tool needs your proven playtest or admin session and its current living character.'); return true; }
      var key = word.slice(1), row = active[actor] || {pid:pid,fly:false,godmode:false,invisible:false};
      if (key === 'fly' || key === 'godmode' || key === 'invisible') {
        var actorRuntime = mp.getActorRuntimeIdentity(actor);
        if (typeof actorRuntime !== 'string' || !actorRuntime) {
          throw new Error('actor runtime authority is unavailable');
        }
        if (row.life && row.life !== actorRuntime) {
          revoke(actor,row,'Actor runtime authority changed.');
          row = {pid:pid,fly:false,godmode:false,invisible:false};
        }
        row.life = actorRuntime;
        var on = toggle(words,row[key]);
        if (on === null) { tell(pid,'Use ' + word + ' on or ' + word + ' off.'); return true; }
        if (key === 'fly' && on) {
          var refusal = movementRefusal(pid,actor);
          if (refusal) { tell(pid,refusal + ' Flight is unavailable.'); return true; }
        }
        if (key === 'godmode') {
          if (typeof mp.get(actor,'isGodMode') !== 'boolean') { throw new Error('the server damage-protection API is unavailable'); }
          var modeNeeds = g.__thornswoodNeeds;
          if (!modeNeeds || !modeNeeds.settle || !modeNeeds.godmodeChanged) { throw new Error('the needs mode API is unavailable'); }
          modeNeeds.settle(actor);
          mp.set(actor,'isGodMode',on);
        }
        row[key] = on; active[actor] = row; publish(actor,row);
        if (key === 'godmode') { modeNeeds.godmodeChanged(actor); }
        tell(pid,word + ' is ' + (on ? 'on.' : 'off.') +
          (key === 'fly' && !on && row.godmode ? ' God mode still enables flight while movement is unrestricted.' : ''));
        report(word,pid,actor,on ? 'on' : 'off');
        if (!row.fly && !row.godmode && !row.invisible) { delete active[actor]; }
        return true;
      }
      if (words.length) { tell(pid,word + ' takes no target or other arguments.'); return true; }
      if (key === 'phase') {
        var noMove = movementRefusal(pid,actor);
        if (noMove) { tell(pid,noMove + ' Phasing is unavailable.'); return true; }
        var here = place(actor), heading = here.rot[2] * Math.PI / 180;
        var pos = [here.pos[0]+Math.sin(heading)*PHASE,here.pos[1]+Math.cos(heading)*PHASE,here.pos[2]].map(Math.fround);
        var stuck = g.__thornswoodStuck;
        if (!stuck || !stuck.teleported) { throw new Error('teleport history is unavailable'); }
        mp.set(actor,'locationalData',{cellOrWorldDesc:here.desc,pos:pos,rot:here.rot.slice()});
        var confirmed = place(actor);
        if (confirmed.desc !== here.desc || confirmed.pos.some(function(n,i){return n !== pos[i];})) {
          throw new Error('the native phase move was not applied');
        }
        stuck.teleported(pid,actor);
        report(word,pid,actor,'Forward in the same cell.',{from:here.pos,to:pos});
        tell(pid,'Moved a short distance forward.'); return true;
      }
      if (key === 'cleareffects') {
        var needs = g.__thornswoodNeeds;
        if (!needs || !needs.clearIntoxication) { throw new Error('intoxication state is unavailable'); }
        needs.clearIntoxication(actor);
        report(word,pid,actor,'Alcohol and drug effects cleared.');
        tell(pid,'Your alcohol and drug effects are cleared.'); return true;
      }
      killall(pid,actor); return true;
    } catch (e) {
      if (active[actor]) {
        try { revoke(actor,active[actor],'The tool could not be applied.'); }
        catch (revokeError) { log('staff tools: could not revoke after tool failure: ' + revokeError); }
      }
      tell(pid,'The staff tool could not complete. The server log says why.');
      log('staff tools: ' + word + ' for profile ' + pid + ' failed: ' + e);
      return true;
    }
  }
  function shutdown() {
    var failures = [];
    Object.keys(active).forEach(function(id) {
      try { revoke(Number(id),active[id],'The staff tools reloaded.'); }
      catch (e) { failures.push(e); log('staff tools: could not withdraw actor '+id+' during reload: '+e); }
    });
    // One destroyed/unreadable actor cannot leave every other mode enabled.
    // Still fail the reload visibly and retain the old authority timer.
    if (failures.length) { throw failures[0]; }
  }
  function ownerScript() {
    return [
      '(function(){',
      'var sp=ctx.sp,v=ctx.value||{};if(!sp){return;}',
      'var store=sp.storage;if(!store){sp.printConsole("staff tools: native mode storage unavailable");return;}',
      'var allowed=v.run==='+JSON.stringify(RUN)+'&&Number(v.until)>Date.now();',
      'var signature=String(v.seq)+"|"+allowed;if(ctx.state.thornswoodToolAttempt===signature){return;}ctx.state.thornswoodToolAttempt=signature;',
      'try {',
      ' var fly=allowed&&v.fly===true,god=allowed&&v.godmode===true;',
      ' if((store.thornswoodStaffFlight===true)!==fly){sp.Debug.toggleCollisions();store.thornswoodStaffFlight=fly;}',
      ' if(store.thornswoodStaffGod!==god){sp.Debug.setGodMode(god);store.thornswoodStaffGod=god;}',
      '}catch(e){sp.printConsole("staff tools: could not apply native mode: "+e);}',
      '})();'
    ].join('\n');
  }
  function visibilityScript() {
    return [
      '(function(){var v=ctx.value||{},a=ctx.sp.Actor.from(ctx.refr);if(!a){return;}',
      'var invisible=v.run==='+JSON.stringify(RUN)+'&&Number(v.until)>Date.now()&&v.invisible===true;if(ctx.state.thornswoodStaffInvisible===invisible){return;}',
      'try{a.setAlpha(invisible?0:1,false);ctx.state.thornswoodStaffInvisible=invisible;}',
      'catch(e){ctx.sp.printConsole("staff tools: could not apply visibility: "+e);}})();'
    ].join('\n');
  }
  mp.makeProperty(OWNER,{isVisibleByOwner:true,isVisibleByNeighbors:false,updateOwner:ownerScript(),updateNeighbor:''});
  mp.makeProperty(VISIBLE,{isVisibleByOwner:true,isVisibleByNeighbors:true,updateOwner:visibilityScript(),updateNeighbor:visibilityScript()});
  // The loader clears property registrations on reload. Re-register before
  // the old module withdraws its values, or its writes would be refused.
  if (g.__thornswoodStaffTools) { g.__thornswoodStaffTools.shutdown(); }
  if (g.__thornswoodStaffToolsTimer) { clearInterval(g.__thornswoodStaffToolsTimer); }
  g.__thornswoodStaffToolsTimer = setInterval(guard('staffToolAuthority',tick),1000);
  g.__thornswoodStaffTools = {words:WORDS,command:command,tick:tick,ownerScript:ownerScript,visibilityScript:visibilityScript,
    isInvisible:function(actor){var row=active[actor];return !!(row && row.invisible && pass(row.pid) && Number(pass(row.pid).x)>Date.now());},
    shutdown:shutdown};
  g.__thornswoodCommandTools.register('scene-tools',{
    command:function(cmd,word,parts,pid,actor){return command(cmd,word,parts.slice(1),pid,actor);},
    help:[
      {word:'/fly',role:'playtester',syntax:'/fly [on|off]',text:'Toggle collision-free flight for yourself; restraints still apply.'},
      {word:'/phase',role:'playtester',syntax:'/phase',text:'Move a short distance forward within this cell; restraints still apply.'},
      {word:'/godmode',role:'playtester',syntax:'/godmode [on|off]',text:'Toggle flight, damage protection, lethal valid attacks and paused needs for yourself.'},
      {word:'/invisible',role:'playtester',syntax:'/invisible [on|off]',text:'Hide or show your character.'},
      {word:'/cleareffects',role:'playtester',syntax:'/cleareffects',text:'Clear your alcohol and drug effects without removing injuries or disease.'},
      {word:'/killall',role:'admin',syntax:'/killall',text:'End up to 40 nearby ordinary hostile NPCs; people and protected actors are excluded.'}
    ]
  });
})();
// ==== end thornswood staff scene tools ====
