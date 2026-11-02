// ==== thornswood stuck ====
/*
  /STUCK, FOR SOMEBODY WEDGED IN THE WORLD (#414).

  Patrick, 28 September, the rules this follows:
    - it takes you back a few steps, to a recent spot where you were standing
      safely, out of a short trail the server keeps of where each character
      has been; when no such spot is known, or the one it knows is the same
      stuck place, it sends you to the nearest temple instead;
    - once every 5 minutes for each character;
    - refused outright while you are dead, with a line saying why;
    - in a fight it is a soft lock: a 15 second wait, cancelled if you are hit
      or you move, with a line either way; out of a fight it works at once;
    - it is only for being truly stuck, the rules say so, and misuse can mean
      a warning or a ban from staff. So every use that moves somebody, and
      every wait a fight cancelled, is written to for-bot/moderation.log, the
      staff record #412 built, which the Discord bot says in the staff
      channel: the character, the profile, the Discord account from the join
      pass, where from, where to, and when. The reply says it is logged.

  Everything is on the server. The client is not asked anything: a client
  that could say "I am not in a fight" could skip the wait.

  IN A FIGHT, as the server can see it. The server has no combat state of its
  own and no hit event reaches this file, so a fight is either of two things
  the server does hold, sampled once a second: the character's health went
  down (the server applies weapon damage itself, ActionListener::OnWeaponHit),
  or its last animation event was a swing, a bash, a bow draw or a cast. Either
  in the last 15 seconds counts. Being hurt by anything counts, a fall
  included, which errs on the side of the wait.

  THE TRAIL. Every 3 seconds, for each character in the world who is alive
  and not still being made: a new point when they are 200 units or more from
  the last one, or in another cell, 10 kept. A sample that dropped more than
  300 units since the last one is a fall and never becomes a point, so
  somebody who fell through the world is not sent back into the air.

  WHICH POINT. The newest one at least 256 units from where they are now (any
  point in another cell counts), and not within 256 units of where their last
  /stuck started, which is a place already known to be a trap. And when they
  are still standing where their last /stuck put them, the trail is not
  trusted at all: that spot is the same stuck place, so it is the temple.

  WHICH TEMPLE: TEMPLES below, the nearest one on the same map. Every temple
  inside is an interior, so the distance is measured to its door on the
  map outside:
    - standing outdoors in Tamriel or one of the five walled cities, which all
      share Tamriel's coordinates: from where they stand, over the five
      mainland temples;
    - on Solstheim: Raven Rock's, the only temple on that map;
    - indoors, or on any other map (Blackreach, Sovngarde, the Soul Cairn):
      from the newest trail point on one of those two maps, which is where
      they went in; failing that, the capital of the hold the cell is in
      (DATA.cellToHold and DATA.capitals, the same tables the death respawn
      reads); failing that, Whiterun's, the death respawn's own fallback.

  Nothing here is kept on disk. A restart forgets the trail and the 5 minutes,
  which only ever lets somebody use it sooner, once.
*/
(function () {
  'use strict';
  var g = globalThis;
  var fs = null, path = null;
  try { fs = require('fs'); path = require('path'); } catch (e) { }

  var AGAIN_MS = 5 * 60 * 1000;   // once every 5 minutes for each character
  // How long the last use is remembered: the 5 minutes, and where it started
  // and put them, which is what makes a second use in the same trap go to
  // the temple rather than back into it.
  var REMEMBER_MS = 60 * 60 * 1000;
  var WAIT_MS = 15000;            // the wait when in a fight
  var FIGHT_MS = 15000;           // hurt or swinging this recently is a fight
  var TICK_MS = 1000;
  var TRAIL_MS = 3000;            // between trail samples
  var TRAIL_KEEP = 10;
  var TRAIL_STEP = 200;           // units from the last point before a new one
  var SAME_PLACE = 256;           // units: closer than this is the same place
  var FALL = 300;                 // units dropped between samples: a fall
  var MOVE_SLACK = 100;           // units moved during the wait: cancelled
  var FIGHT_ANIM = /attack|bash|bowdraw|begincast|spellcast|swing/i;

  /*
    THE TEMPLES, with where each number comes from.

    desc, pos and rot: the point inside the temple the death respawn has
    sent people to since it shipped, read out of the Respawn - Death Overhaul
    marker in that cell (REFR DATA, radians turned to degrees), kept in
    game\data\data.json as destinations.<key>.temple and installed in DATA.
    door and doorWorld: the temple's door on the map outside, the same
    record's entrancePos and entranceWorld. The cell names are the load
    order's own, out of BUILDING_NAME. tests\test-stuck.js checks every number
    here against DATA and every cell against BUILDING_NAME, so this table
    cannot drift from what the respawn uses.
  */
  var TEMPLES = [
    { key: 'whiterun', name: 'the Temple of Kynareth in Whiterun', frame: 'tamriel',
      desc: '165a7:Skyrim.esm', pos: [1056.2, 254.9, 63], rot: [0, 0, -90],
      door: [23280, -3368], doorWorld: '1a26f:Skyrim.esm' },
    { key: 'solitude', name: 'the Temple of the Divines in Solitude', frame: 'tamriel',
      desc: '16a02:Skyrim.esm', pos: [2769.2, 921.3, 288], rot: [0, 0, -90],
      door: [-58079.7, 110488.4], doorWorld: '37edf:Skyrim.esm' },
    { key: 'windhelm', name: 'the Temple of Talos in Windhelm', frame: 'tamriel',
      desc: '16785:Skyrim.esm', pos: [-1, -1510, 149.8], rot: [0, 0, -180],
      door: [133910.9, 38718.9], doorWorld: '1691d:Skyrim.esm' },
    { key: 'markarth', name: 'the Temple of Dibella in Markarth', frame: 'tamriel',
      desc: '16df3:Skyrim.esm', pos: [-1872, -1456, 64], rot: [0, 0, 0],
      door: [-176816, 4500], doorWorld: '16d71:Skyrim.esm' },
    { key: 'riften', name: 'the Temple of Mara in Riften', frame: 'tamriel',
      desc: '16bd7:Skyrim.esm', pos: [-1408, -384, 68], rot: [0, 0, 0],
      door: [176376, -97022], doorWorld: '16bb4:Skyrim.esm' },
    { key: 'ravenrock', name: 'the temple in Raven Rock', frame: 'solstheim',
      desc: '17ec3:Dragonborn.esm', pos: [1.4, -542.8, 0], rot: [0, 0, -1.28],
      door: [32848.4, 35142], doorWorld: '800:Dragonborn.esm' }
  ];
  var FALLBACK = 'whiterun';

  /*
    Which maps share which coordinates. Tamriel (3c) and the five walled
    cities, whose worldspaces are the doorWorld of the five mainland temples
    above and are laid out in Tamriel's coordinates; and Solstheim, which is
    not. Anything else has coordinates of its own and is never measured
    against these.
  */
  var FRAME = {
    '3c:skyrim.esm': 'tamriel', '1a26f:skyrim.esm': 'tamriel', '37edf:skyrim.esm': 'tamriel',
    '1691d:skyrim.esm': 'tamriel', '16d71:skyrim.esm': 'tamriel', '16bb4:skyrim.esm': 'tamriel',
    '800:dragonborn.esm': 'solstheim'
  };
  function frameOf(desc) { return FRAME[String(desc || '').toLowerCase()] || ''; }

  // On globalThis, so a hot reload keeps the trails, the 5 minutes and any
  // wait in progress. Keyed by character (actor id), which is what the
  // 5 minutes are counted against; waits by profile, since a profile has
  // one character in the world at a time.
  if (!g.__thornswoodStuckState) { g.__thornswoodStuckState = { chars: {}, used: {}, waiting: {} }; }
  var state = g.__thornswoodStuckState;

  function slog() {
    var a = ['stuck:'];
    for (var i = 0; i < arguments.length; i++) { a.push(arguments[i]); }
    log(a.join(' '));
  }
  function tell(pid, text) {
    var t = g.__thornswoodToProfile;
    if (t && pid) { t(pid, text); }
  }
  function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
  function dist3(a, b) {
    var dx = a[0] - b[0], dy = a[1] - b[1], dz = (a[2] || 0) - (b[2] || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  function samePlace(a, b) {
    return !!(a && b && a.desc === b.desc && dist3(a.pos, b.pos) < SAME_PLACE);
  }
  function hex(id) { return (Number(id) >>> 0).toString(16); }
  function where(p) {
    if (!p) { return 'somewhere unknown'; }
    return p.desc + ' (' + round1(p.pos[0]) + ', ' + round1(p.pos[1]) + ', ' + round1(p.pos[2]) + ')';
  }
  function settings() {
    try { return mp.getServerSettings() || {}; } catch (e) { return {}; }
  }
  function serverName() {
    return String(settings().thornswoodServer || '').trim().toLowerCase() || 'main';
  }
  function nameOf(actorId) {
    try {
      var ap = mp.get(actorId, 'appearance');
      var n = String((ap && ap.name) || '');
      if (n) { return n.slice(0, 60); }
    } catch (e) { }
    return 'somebody';
  }
  function isDead(actorId) {
    try { return !!mp.get(actorId, 'isDead'); } catch (e) { return false; }
  }
  function inCreation(actorId) {
    try {
      var cg = g.__thornswoodChargen;
      return !!(cg && cg.inCreation && cg.inCreation(actorId));
    } catch (e) { return false; }
  }
  function placeOf(actorId) {
    try {
      var desc = String(mp.get(actorId, 'worldOrCellDesc') || '');
      var pos = mp.get(actorId, 'pos');
      if (!desc || !pos) { return null; }
      var rot = [0, 0, 0];
      try { rot = (mp.get(actorId, 'angle') || [0, 0, 0]).slice(0, 3); } catch (e) { }
      return { desc: desc, pos: [Number(pos[0]) || 0, Number(pos[1]) || 0, Number(pos[2]) || 0], rot: rot };
    } catch (e) { return null; }
  }
  function health(actorId) {
    try {
      var p = mp.get(actorId, 'percentages');
      var h = p ? Number(p.health) : NaN;
      return isNaN(h) ? -1 : h;
    } catch (e) { return -1; }
  }
  function charOf(actorId) {
    var k = hex(actorId);
    if (!state.chars[k]) { state.chars[k] = { trail: [], hp: -1, anim: '', fightAt: 0, last: null }; }
    return state.chars[k];
  }

  /* The Discord account the join pass for this profile named, or ''. */
  function accountOf(pid) {
    var seen = g.__thornswoodPassSeen;
    var p = seen && seen.passes ? seen.passes[pid] : null;
    return (p && p.d) ? String(p.d) : '';
  }

  // ---------------------------------------------------------------- tick --
  /* One character, once a second: the signs of a fight. */
  function sample(actorId, now) {
    var c = charOf(actorId);
    var hp = health(actorId);
    if (hp >= 0 && c.hp >= 0 && hp < c.hp - 0.001) { c.fightAt = now; }
    if (hp >= 0) { c.hp = hp; }
    var anim = '';
    try { anim = String(mp.get(actorId, 'lastAnimEvent') || ''); } catch (e) { anim = ''; }
    if (anim && anim !== c.anim && FIGHT_ANIM.test(anim)) { c.fightAt = now; }
    c.anim = anim;
  }

  /* One character, every few seconds: the trail. */
  function trailOne(actorId, now) {
    var c = charOf(actorId);
    if (isDead(actorId) || inCreation(actorId)) { c.last = null; return; }
    var here = placeOf(actorId);
    if (!here) { return; }
    var falling = !!(c.last && c.last.desc === here.desc && c.last.pos[2] - here.pos[2] > FALL);
    c.last = here;
    if (falling) { return; }
    var top = c.trail.length ? c.trail[c.trail.length - 1] : null;
    if (top && top.desc === here.desc && dist3(top.pos, here.pos) < TRAIL_STEP) { return; }
    here.at = now;
    c.trail.push(here);
    while (c.trail.length > TRAIL_KEEP) { c.trail.shift(); }
  }

  /*
    Two timers, each making the same reads every time it runs: the fight signs
    and any wait once a second, the trail every TRAIL_MS.
  */
  function trailTick() {
    var now = Date.now();
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { online = []; }
    for (var i = 0; i < online.length; i++) {
      try { trailOne(online[i], now); } catch (e) { }
    }
  }

  function tick() {
    var now = Date.now();
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { online = []; }
    var here = {};
    for (var i = 0; i < online.length; i++) {
      here[hex(online[i])] = true;
      try { sample(online[i], now); } catch (e) { }
    }
    // Somebody who left takes their trail with them; the 5 minutes stay.
    for (var k in state.chars) {
      if (Object.prototype.hasOwnProperty.call(state.chars, k) && !here[k]) { delete state.chars[k]; }
    }
    for (var u in state.used) {
      if (Object.prototype.hasOwnProperty.call(state.used, u) && now - state.used[u].at >= REMEMBER_MS) {
        delete state.used[u];
      }
    }
    waitTick(now);
  }

  // ------------------------------------------------------------ where to --
  /* The spot a few steps back, or null. */
  function backSpot(actorId, here) {
    var c = charOf(actorId);
    var before = state.used[hex(actorId)];
    // Still where the last /stuck put them: that spot is the stuck place.
    if (before && before.to && samePlace(before.to, here)) { return null; }
    for (var i = c.trail.length - 1; i >= 0; i--) {
      var t = c.trail[i];
      if (samePlace(t, here)) { continue; }
      if (before && before.from && samePlace(t, before.from)) { continue; }
      return t;
    }
    return null;
  }

  /* Where on a map this person is, for measuring: { frame, x, y } or null. */
  function mapSpot(actorId, here) {
    var f = frameOf(here.desc);
    if (f) { return { frame: f, x: here.pos[0], y: here.pos[1] }; }
    var c = charOf(actorId);
    for (var i = c.trail.length - 1; i >= 0; i--) {
      var tf = frameOf(c.trail[i].desc);
      if (tf) { return { frame: tf, x: c.trail[i].pos[0], y: c.trail[i].pos[1] }; }
    }
    var hold = null;
    try { hold = DATA.cellToHold[here.desc] || null; } catch (e) { hold = null; }
    if (hold === 'DLC2SolstheimLocation') {
      var rr = templeByKey('ravenrock');
      return { frame: 'solstheim', x: rr.door[0], y: rr.door[1] };
    }
    var cap = null;
    try { cap = hold ? DATA.capitals[hold] : null; } catch (e) { cap = null; }
    if (cap && cap.pos) { return { frame: 'tamriel', x: cap.pos[0], y: cap.pos[1] }; }
    return null;
  }

  function templeByKey(key) {
    for (var i = 0; i < TEMPLES.length; i++) { if (TEMPLES[i].key === key) { return TEMPLES[i]; } }
    return null;
  }

  function nearestTemple(spot) {
    var best = null, bestD = Infinity;
    if (spot) {
      for (var i = 0; i < TEMPLES.length; i++) {
        var t = TEMPLES[i];
        if (t.frame !== spot.frame) { continue; }
        var dx = t.door[0] - spot.x, dy = t.door[1] - spot.y;
        var d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = t; }
      }
    }
    return best || templeByKey(FALLBACK);
  }

  // ------------------------------------------------------------- record --
  /*
    One line in thornswood.log and one in moderation.log, the file the staff
    block writes (#412) and the bot says in the staff channel. why is written
    to be read after the person's name.
  */
  function record(pid, actorId, name, why, extra) {
    var account = accountOf(pid);
    var line = name + ' (profile ' + pid + ', character ' + hex(actorId) +
               (account ? ', Discord ' + account : ', no join pass on hand') + ') ' + why;
    slog(line);
    if (!fs || !path) { return; }
    var row = { at: new Date().toISOString(), server: serverName(), did: 'stuck',
                by: pid, byName: name, who: pid, whoName: name,
                character: hex(actorId), account: account,
                why: String(why + ' Character ' + hex(actorId) +
                            (account ? ', Discord ' + account : ', no join pass on hand') + '.').slice(0, 600) };
    for (var k in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, k)) { row[k] = extra[k]; }
    }
    // In for-bot beside private, which the bot reads by a rule on the folder (#2321).
    var s = settings();
    var dir = String(s.forBotDir || path.join(path.dirname(String(s.privDir || 'private')), 'for-bot'));
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'moderation.log'), JSON.stringify(row) + '\n');
    } catch (e) {
      slog('could not write moderation.log, so the staff channel will not hear of it: ' + e);
    }
  }

  var LOGGED = '/stuck is only for being truly stuck: every use is logged for staff, and ' +
               'using it for anything else can mean a warning or a ban.';

  function minutesLeft(ms) {
    var m = Math.max(1, Math.ceil(ms / 60000));
    return m === 1 ? 'a minute' : m + ' minutes';
  }

  // --------------------------------------------------------------- move --
  function move(pid, actorId, now) {
    var here = placeOf(actorId);
    if (!here) {
      tell(pid, 'The server cannot tell where you are right now, so /stuck did not move you. ' +
                'Try again in a moment; /helpme reaches staff if it keeps saying this.');
      slog('profile ' + pid + ' could not be placed, nothing moved');
      return false;
    }
    var back = backSpot(actorId, here);
    var dest, how, templeName = '';
    if (back) {
      dest = { desc: back.desc, pos: back.pos.slice(), rot: (back.rot || [0, 0, 0]).slice() };
      how = 'trail';
    } else {
      var t = nearestTemple(mapSpot(actorId, here));
      dest = { desc: t.desc, pos: t.pos.slice(), rot: t.rot.slice() };
      how = 'temple';
      templeName = t.name;
    }
    try {
      mp.set(actorId, 'locationalData', { cellOrWorldDesc: dest.desc, pos: dest.pos, rot: dest.rot });
    } catch (e) {
      tell(pid, '/stuck could not move you (' + e + '). /helpme reaches staff, who can move you by hand.');
      slog('profile ' + pid + ' could not be moved: ' + e);
      return false;
    }
    state.used[hex(actorId)] = { at: now, from: here, to: dest };
    var c = charOf(actorId);
    c.last = null;
    var name = nameOf(actorId);
    var said = how === 'trail'
      ? 'Sent back to where you were standing a moment ago.'
      : 'No safe spot near you was known, so you were sent to ' + templeName + '.';
    tell(pid, said + ' ' + LOGGED + ' You can use it again in 5 minutes.');
    record(pid, actorId, name,
           (how === 'trail' ? 'used /stuck and was sent back a few steps'
                            : 'used /stuck and was sent to ' + templeName) +
           ', from ' + where(here) + ' to ' + where(dest) + '.',
           { result: how,
             from: { desc: here.desc, pos: [round1(here.pos[0]), round1(here.pos[1]), round1(here.pos[2])] },
             to: { desc: dest.desc, pos: [round1(dest.pos[0]), round1(dest.pos[1]), round1(dest.pos[2])] } });
    return true;
  }

  // --------------------------------------------------------------- wait --
  function cancel(pid, w, because, said) {
    delete state.waiting[pid];
    tell(pid, said);
    record(pid, w.actorId, nameOf(w.actorId),
           'used /stuck in a fight and the wait was cancelled because ' + because +
           ', at ' + where(w.from) + '. Nobody was moved.',
           { result: 'cancelled', because: because,
             from: { desc: w.from.desc, pos: [round1(w.from.pos[0]), round1(w.from.pos[1]), round1(w.from.pos[2])] } });
  }

  function waitTick(now) {
    for (var k in state.waiting) {
      if (!Object.prototype.hasOwnProperty.call(state.waiting, k)) { continue; }
      var pid = Number(k);
      var w = state.waiting[k];
      var still = 0;
      try { still = Number(mp.get(w.actorId, 'profileId')) || 0; } catch (e) { still = 0; }
      if (still !== pid) {
        delete state.waiting[k];
        slog('profile ' + pid + ' left during the /stuck wait, nothing moved');
        continue;
      }
      if (isDead(w.actorId)) {
        cancel(pid, w, 'they died',
               '/stuck was cancelled because you died. You will wake at the nearest temple. ' +
               'This use is logged for staff.');
        continue;
      }
      var hp = health(w.actorId);
      if (hp >= 0 && w.hp >= 0 && hp < w.hp - 0.001) {
        cancel(pid, w, 'they were hit',
               '/stuck was cancelled because you were hit. Get clear of the fight and try again. ' +
               'This use is logged for staff.');
        continue;
      }
      if (hp >= 0) { w.hp = hp; }
      var here = placeOf(w.actorId);
      if (here && (here.desc !== w.from.desc || dist3(here.pos, w.from.pos) > MOVE_SLACK)) {
        cancel(pid, w, 'they moved',
               '/stuck was cancelled because you moved. Stand still for the whole 15 seconds, ' +
               'or walk out if you can. This use is logged for staff.');
        continue;
      }
      if (now - w.at >= WAIT_MS) {
        delete state.waiting[k];
        move(pid, w.actorId, now);
      }
    }
  }

  // ------------------------------------------------------------ command --
  /* Called from handle() with the character already found. */
  function command(pid, actorId, now) {
    now = now || Date.now();
    if (isDead(actorId)) {
      tell(pid, 'You are dead, so /stuck cannot move you. You will wake at the nearest temple; ' +
                'if you are stuck after that, use /stuck again.');
      slog('profile ' + pid + ' refused: dead');
      return;
    }
    if (inCreation(actorId)) {
      tell(pid, '/stuck works once your character is made and in the world. Finish at the panel ' +
                'and you will be sent to your town.');
      slog('profile ' + pid + ' refused: still making the character');
      return;
    }
    var frozen = g.__thornswoodStaffState && g.__thornswoodStaffState.frozen;
    if (frozen && frozen[pid]) {
      tell(pid, 'Staff have you frozen in place, so /stuck cannot move you. Wait here and ' +
                'somebody will talk to you.');
      slog('profile ' + pid + ' refused: frozen by staff');
      return;
    }
    /*
      A LOCKED CELL IS NOT A WEDGE (#502). Patrick, 12 October: /stuck does
      not move someone out of a locked cell. The server knows the room and
      not which side of a cell door somebody stands, so this is kept at the
      room: in a jail where a guard has a cell locked, it moves nobody but
      that hold's guards (lockedJailHere in the property block).
    */
    var jailProp = g.__thornswoodProperty;
    var inJail = (jailProp && jailProp.lockedJailHere) ? jailProp.lockedJailHere(actorId, pid) : null;
    if (inJail) {
      tell(pid, 'A guard has a cell locked here in ' + inJail + ', so /stuck does not move anybody out ' +
                'of the jail. Walk out if you can, or ask a guard. /helpme reaches staff if you are truly stuck.');
      slog('profile ' + pid + ' refused: in ' + inJail + ' while a guard has a cell locked');
      return;
    }
    var w = state.waiting[pid];
    if (w) {
      tell(pid, 'Your /stuck is already counting down: ' +
                Math.max(1, Math.ceil((WAIT_MS - (now - w.at)) / 1000)) + ' seconds left. ' +
                'Stand still; being hit or moving cancels it.');
      return;
    }
    var used = state.used[hex(actorId)];
    if (used && now - used.at < AGAIN_MS) {
      tell(pid, '/stuck works once every 5 minutes for each character. You can use it again in ' +
                minutesLeft(used.at + AGAIN_MS - now) + '. If you cannot wait, /helpme reaches staff.');
      slog('profile ' + pid + ' refused: used ' + Math.round((now - used.at) / 1000) + 's ago');
      return;
    }
    var c = charOf(actorId);
    if (c.fightAt && now - c.fightAt < FIGHT_MS) {
      var from = placeOf(actorId);
      if (!from) {
        tell(pid, 'The server cannot tell where you are right now, so /stuck did not start. ' +
                  'Try again in a moment.');
        return;
      }
      state.waiting[pid] = { actorId: actorId, at: now, from: from, hp: health(actorId) };
      tell(pid, 'You have been in a fight in the last 15 seconds, so /stuck waits 15 seconds ' +
                'first. Stand still: being hit or moving cancels it. Every use is logged for staff.');
      slog('profile ' + pid + ' started the 15 second wait at ' + where(from));
      return;
    }
    move(pid, actorId, now);
  }

  g.__thornswoodStuck = {
    command: command, tick: tick, trailTick: trailTick, sample: sample, backSpot: backSpot, mapSpot: mapSpot,
    nearestTemple: nearestTemple, frameOf: frameOf, state: state, TEMPLES: TEMPLES,
    AGAIN_MS: AGAIN_MS, WAIT_MS: WAIT_MS, FIGHT_MS: FIGHT_MS, TICK_MS: TICK_MS, TRAIL_MS: TRAIL_MS
  };

  if (g.__thornswoodStuckTimer) { try { clearInterval(g.__thornswoodStuckTimer); } catch (e) { } }
  g.__thornswoodStuckTimer = setInterval(guard('stuckTick', tick), TICK_MS);
  if (g.__thornswoodStuckTrailTimer) { try { clearInterval(g.__thornswoodStuckTrailTimer); } catch (e) { } }
  g.__thornswoodStuckTrailTimer = setInterval(guard('stuckTrail', trailTick), TRAIL_MS);
  log('stuck: ready, once every 5 minutes, a 15 second wait in a fight, logged for staff');
})();
// ==== end thornswood stuck ====

