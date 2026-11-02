// ==== thornswood idle ====
/*
  NOBODY IDLE KEEPS A SEAT (#1142).

  Patrick, 29 Sep: "we also need an AFK kick in game after 15 mins idle with
  the opportunity for a menu to pop after that 15 minutes with the option to
  click I am still here, if they do click I'm still here it resets, if not it
  kicks them to the main menu where they can rechoose their character and
  they automatically rejoin the queue with the same 1 minute to join rule".
  Agreed the same day: the window counts down 60 seconds, and staff get the
  check too.

  THE GAME ASKS. thornswood-front.js watches the keys, the mouse and the
  character. After 15 minutes with none of them it puts up "Are you still
  here?" (thornswood-afk.js) with an "I am still here" button and a 60 second
  countdown. Pressed, it says "/afk here" and the 15 minutes start again. Not
  pressed, it says "/afk out", leaves the world and shows the character
  choice. While it sees input it says "/afk active", every two minutes at
  most, so this knows somebody is there while the character stands still (a
  crafting menu, a long talk, the camera turned in third person).

  THE SERVER JUDGES. Every SAMPLE_MS this looks at everybody in the world:
  where the character stands and which way it faces. Nothing moved and
  nothing from their game for SERVER_IDLE_MS, which is the game's 15 minutes
  and its 60 seconds with two minutes to spare, and this moves them out
  itself, whether or not their game ever asked. Somebody in character
  creation is never idle.

  MOVED OUT, either way the same (out below): the seats block frees the seat
  and puts them at the end of the line (the next in line is told at its next
  sweep), their menu is told over the relay, and a game that has not left by
  itself is ended KICK_AFTER_MS later. thornswood.log and moderation.log say
  who and why, and the Discord bot says moderation.log in the staff channel.
*/
(function () {
  var g = globalThis;

  var SAMPLE_MS = 5000;
  var ASK_MIN = 15;                           // the game's own numbers, for the words
  var WINDOW_S = 60;
  var SERVER_IDLE_MS = (ASK_MIN * 60 + WINDOW_S + 120) * 1000;
  var MOVE_UNITS = 16;                        // a quarter of a metre
  var TURN_DEGREES = 2;
  var LEFT_KEEP_MS = 60000;                   // an "/afk out" can arrive just after the game has gone
  var OUT_RESET_MS = 20000;                   // moved out and here again after this: judged afresh (the seats block's 15 s, and a sample)

  // On globalThis, so a hot reload does not start everybody's clock again.
  // by: profile -> { actorId, last, pos, rot, out }; left: profile -> when they left the world.
  if (!g.__thornswoodIdleState) { g.__thornswoodIdleState = { by: {}, left: {} }; }
  var state = g.__thornswoodIdleState;
  if (!state.left) { state.left = {}; }

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function turned(a, b) {
    var d = Math.abs((Number(a) || 0) - (Number(b) || 0)) % 360;
    return Math.min(d, 360 - d);
  }
  function changed(was, at) {
    if (!was || !was.pos || !at || !at.pos) { return false; }
    var dx = at.pos[0] - was.pos[0], dy = at.pos[1] - was.pos[1], dz = at.pos[2] - was.pos[2];
    if (dx * dx + dy * dy + dz * dz > MOVE_UNITS * MOVE_UNITS) { return true; }
    var r0 = was.rot || [0, 0, 0], r1 = at.rot || [0, 0, 0];
    return turned(r0[0], r1[0]) > TURN_DEGREES || turned(r0[2], r1[2]) > TURN_DEGREES;
  }

  /*
    Once every SAMPLE_MS. online is [{ actorId, profileId }]; how is
    { place(actorId) -> { pos, rot } or null, creating(actorId),
    out(pid, actorId, why) }. Returns the profiles moved out this time.
  */
  function sweep(now, online, how) {
    var here = {};
    var moved = [];
    for (var i = 0; i < online.length; i++) {
      var pid = Number(online[i] && online[i].profileId) || 0;
      if (!pid) { continue; }
      var actorId = online[i].actorId;
      here[pid] = true;
      var at = null;
      try { at = how.place(actorId); } catch (e) { at = null; }
      var e = state.by[pid];
      if (!e || e.actorId !== actorId) {
        state.by[pid] = { actorId: actorId, last: now, pos: at && at.pos, rot: at && at.rot, out: 0 };
        delete state.left[pid];
        continue;
      }
      if (e.out) {
        // Still or again in the world well after being moved out: back in the
        // same character (a seat of their own, or refused by the seats block),
        // so a fresh clock. The engine keeps one actor per character, so a
        // quick way back in looks the same as never having left.
        if (now - e.out > OUT_RESET_MS) { state.by[pid] = { actorId: actorId, last: now, pos: at && at.pos, rot: at && at.rot, out: 0 }; }
        continue;
      }
      var creating = false;
      try { creating = !!how.creating(actorId); } catch (e2) { creating = false; }
      if (creating || changed(e, at)) { e.last = now; }
      if (at) { e.pos = at.pos; e.rot = at.rot; }
      if (now - e.last >= SERVER_IDLE_MS) {
        e.out = now;
        moved.push(pid);
        how.out(pid, actorId, 'nothing moved and nothing came from their game for ' +
                Math.round((now - e.last) / 60000) + ' minutes, so the server moved them');
      }
    }
    for (var k in state.by) {
      if (own(state.by, k) && !here[k]) { delete state.by[k]; state.left[k] = now; }
    }
    for (var q in state.left) {
      if (own(state.left, q) && now - state.left[q] > LEFT_KEEP_MS) { delete state.left[q]; }
    }
    return moved;
  }

  /*
    One "/afk <word>" from the relay, under the profile it came from. active
    and here are somebody at the game; out is their game taking them out
    because nobody pressed "I am still here". Only for a profile that is in
    the world or has just left it, so a stray line moves nobody and writes
    nothing to the staff log.
  */
  function heard(pid, word, now, how) {
    pid = Number(pid) || 0;
    if (!pid) { return 'nobody'; }
    var e = state.by[pid];
    if (word === 'active' || word === 'here') {
      if (e) { e.last = now; }
      return e ? word : 'not in the world';
    }
    if (word === 'out') {
      if (e && e.out) { return 'already'; }
      if (!e && !state.left[pid]) { return 'not in the world'; }
      if (e) { e.out = now; }
      delete state.left[pid];
      how.out(pid, e ? e.actorId : 0, 'no answer to "Are you still here?" within ' + WINDOW_S +
              ' seconds, after ' + ASK_MIN + ' minutes with nothing from the keyboard, mouse or character');
      return 'out';
    }
    return 'unknown';
  }

  function nameOf(actorId) {
    try {
      var ap = mp.get(actorId, 'appearance');
      var n = String((ap && ap.name) || '');
      if (n) { return n; }
    } catch (e) { }
    return 'somebody';
  }
  function settings() {
    try { return mp.getServerSettings() || {}; } catch (e) { return {}; }
  }

  /*
    The staff log: one line in moderation.log, which the Discord bot says in
    the staff channel. It goes in for-bot beside private (forBotDir when the
    settings name one), because the bot reads it by a rule on that folder,
    which a file made later takes; private is SYSTEM's and Administrators'
    alone (#2321).
  */
  function record(pid, name, why) {
    var fs = null, path = null;
    try { fs = require('fs'); path = require('path'); } catch (e) { return; }
    var s = settings();
    var row = { at: new Date().toISOString(), server: String(s.thornswoodServer || '').trim().toLowerCase() || 'main',
                did: 'idle', by: pid, byName: name, who: pid, whoName: name, why: String(why || '').slice(0, 300) };
    var dir = String(s.forBotDir || path.join(path.dirname(String(s.privDir || 'private')), 'for-bot'));
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'moderation.log'), JSON.stringify(row) + '\n');
    } catch (e) {
      console.log('[thornswood] idle: could not write moderation.log, so the staff channel will not hear of it: ' + e);
    }
  }

  function out(pid, actorId, why) {
    var now = Date.now();
    var name = actorId ? nameOf(actorId) : 'somebody';
    var seats = g.__thornswoodSeats;
    var still = false;
    if (actorId) {
      try { var u = mp.getUserByActor(actorId); still = u !== undefined && u !== null && u >= 0; } catch (e) { still = false; }
    }
    if (seats) {
      try { seats.idleOut(pid, now, seats.liveHow(), still ? actorId : 0); }
      catch (e) { console.log('[thornswood] idle: the seats block would not take profile ' + pid + ': ' + e); }
    }
    console.log('[thornswood] idle: ' + name + ' (profile ' + pid + ') was taken out of the world to the ' +
                'character choice and put in line: ' + why);
    record(pid, name, why);
  }

  function liveHow() {
    return {
      place: function (actorId) {
        var pos = mp.get(actorId, 'pos');
        if (!pos) { return null; }
        var rot = [0, 0, 0];
        try { rot = (mp.get(actorId, 'angle') || [0, 0, 0]).slice(0, 3); } catch (e) { }
        return { pos: [Number(pos[0]) || 0, Number(pos[1]) || 0, Number(pos[2]) || 0], rot: rot };
      },
      creating: function (actorId) {
        var cg = g.__thornswoodChargen;
        return !!(cg && cg.inCreation && cg.inCreation(actorId));
      },
      out: out
    };
  }

  g.__thornswoodIdle = {
    sweep: sweep, heard: heard, liveHow: liveHow, state: state,
    serverIdle: SERVER_IDLE_MS, askMinutes: ASK_MIN, windowSecs: WINDOW_S
  };

  if (g.__thornswoodIdleTimer) { clearInterval(g.__thornswoodIdleTimer); }
  g.__thornswoodIdleTimer = setInterval(function () {
    try {
      var list = [];
      var online = mp.get(0, 'onlinePlayers') || [];
      for (var i = 0; i < online.length; i++) {
        var pid = 0;
        try { pid = Number(mp.get(online[i], 'profileId')) || 0; } catch (e) { pid = 0; }
        if (pid) { list.push({ actorId: online[i], profileId: pid }); }
      }
      sweep(Date.now(), list, liveHow());
    } catch (e) {
      console.log('[thornswood] idle sweep failed: ' + e);
    }
  }, SAMPLE_MS);

  console.log('[thornswood] idle: after ' + ASK_MIN + ' minutes with no input the game asks "Are you still here?" ' +
              'for ' + WINDOW_S + ' seconds; the server moves anybody still for ' +
              Math.round(SERVER_IDLE_MS / 60000) + ' minutes itself');
})();
// ==== end thornswood idle ====


