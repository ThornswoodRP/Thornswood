/// ==== thornswood seats ====
/*
  HOW MANY ARE IN THE WORLD AT ONCE, AND THE LINE PAST IT (#481).

  Patrick, 28 Sep: at most 25 people at once for the alpha, raised later.
  Patrick, 29 Sep: "5 staff seats for now and only allow those seats to be
  filled by the discord roles, we need a queue system as well that lets them
  in the main menu if full but they sit there until a slot is free and it's
  their turn to join".

  THE NUMBERS. thornswoodMostOnline in server-settings.json is the seats
  anybody may take. maxPlayers is the engine's slot count, written above it,
  and the difference is the staff seats. The deploy scripts write both from
  records\most-online.json, the one place they live (25 and 5, so maxPlayers
  30). No thornswoodMostOnline means nobody is turned away and nobody waits.

  A SEAT IS AN ACCOUNT'S, NOT A CHARACTER'S (#2887). The seats count
  characters, so the join pass block ends a second game from a Discord
  account already in the world, on both servers. 25 seats are 25 people.

  WHO MAY TAKE A STAFF SEAT. Only a profile whose Discord account holds one of
  the site's staff roles (access.dev, which folds access.admin in: Owner, Dev,
  Gamemaster, Moderator, Loremaster), from staffRoleProfiles in allowed.json,
  and only with a valid join pass on hand, because a profile id on its own is
  a claim (#937). The written thornswoodAdmins and thornswoodDevs lists and the
  site's hand written admins list are not Discord roles and do not count here.
  Staff in the world are counted into the staff seats first, so staff never
  keep anybody else out of the 25.

  THE LINE. Somebody who picks a character at the menu while the world is
  full does not join. The front plugin keeps them at the menu and says
  "/line" over the command relay every LINE_EVERY_MS; the relay knows who
  they are by their voice join token, and "/joinpass" rides the same way.
  The line lives here and only here, in the order each profile first asked:
  nothing a client sends moves its place. When a seat frees, the first in
  line has it held for them (GRANT_MS to arrive) and is told to come in, and
  their menu joins by itself. A staff role with a pass is given a staff seat
  at once, ahead of the line.

  A PLACE GOES WITH THE CONNECTION. Patrick, 29 Sep: "they shouldn't need to
  check in while waiting in the queue ... just have it automatically lose a
  player's spot when they disconnect." The relay (voice-server.js) knows when
  the socket that said "/line" closes, and says "/line gone" under that
  profile at once, marked as its own; that is gone() below, and the place
  goes then. Closing the game from the page says "/line leave" first. Two
  backstops for a close that never arrives: a new relay (it restarted, and
  its sockets died with it) gives every waiting menu RELAY_BACK_MS to ask
  again, which the menus do by themselves every LINE_EVERY_MS once their chat
  is back, so a restart keeps the line in order; and a place not heard from
  for LINE_SILENT_MS while the relay answers goes. While the relay does not
  answer at all, nobody's silence counts.

  MOVED OUT FOR BEING IDLE (#1142, the idle block below). idleOut() frees the
  seat at once and puts the person at the end of the line. Their menu then
  shows the character choice, and any of their characters can take the place:
  the menu says "/line hand <profile>" under the one that holds it, and that
  profile's first "/line" within HAND_MS takes it over.

  AT THE DOOR. Everybody in the world when this starts keeps their seat, so a
  hot reload never ends a session. After that an arrival is seated when a
  seat was held for them, or when nobody is waiting and a seat is free, or,
  holding a staff role with a pass, when a staff seat is free (a staff role
  still waiting on its pass gets STAFF_WAIT_MS). Anybody else came in past
  the line: they are told one plain line, the log says "door: full", and the
  session ends KICK_AFTER_MS later. The site no longer refuses Play for
  numbers; it says there may be a wait, and the menu shows the place.
*/
(function () {
  var g = globalThis;

  var SWEEP_MS = 2000;
  var STAFF_WAIT_MS = 60000;   // a staff role arriving over the number: this long to show a join pass
  var KICK_AFTER_MS = 10000;   // after the line, so it is on screen first
  var LINE_SILENT_MS = 600000; // backstop: nothing from a waiting menu this long, while the relay answers, and the place goes
  var RELAY_BACK_MS = 60000;   // after a relay restart: this long for each waiting menu to ask again
  var HAND_MS = 120000;        // a place handed to another of the same game's characters waits this long for it
  var OUT_FOR_MS = 15000;      // moved out for being idle: not judged as an arrival for this long while their game leaves
  var GRANT_MS = 60000;        // a seat held for the one whose turn it is, this long to arrive (Patrick, 29 Sep: a minute)
  var SAY_AGAIN_MS = 10000;    // a place is said again this often even when it has not moved
  var LINE_EVERY_MS = 10000;   // how often the menu says it is still waiting (the front's side)

  function sentence(cap) {
    return 'Thornswood is full: ' + cap + ' people are in the world, the most it holds at ' +
           'once during the alpha, and others are waiting at the menu for a seat. Close the ' +
           'game and press Play again to take your place in line.';
  }

  // On globalThis, so a hot reload keeps who holds a seat and the line.
  // seated: profile -> when; waiting: staff profile -> since; refused: profile -> when;
  // line: [{ p, since, seen, said, saidAt, back?, handTo?, handAt?, closed?, idle? }] in order;
  // held: profile -> { at, staff, handTo?, handAt? }; out: profile -> when moved out for being idle.
  if (!g.__thornswoodSeatState) {
    g.__thornswoodSeatState = { seated: {}, waiting: {}, refused: {}, primed: false };
  }
  var state = g.__thornswoodSeatState;
  if (!state.line) { state.line = []; }
  if (!state.held) { state.held = {}; }
  if (!state.out) { state.out = {}; }
  if (!state.status) { state.status = { line: 0, full: false }; }

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function settings() {
    try { return mp.getServerSettings() || {}; } catch (e) { return {}; }
  }
  /* The number, or 0 for none. */
  function capOf(s) {
    var n = Number((s || settings()).thornswoodMostOnline);
    return (n > 0 && Math.floor(n) === n) ? n : 0;
  }
  /* The staff seats: the engine's slots over the number, or 0. */
  function staffSeatsOf(s) {
    s = s || settings();
    var cap = capOf(s);
    var most = Number(s.maxPlayers);
    if (!cap || !(most > cap) || Math.floor(most) !== most) { return 0; }
    return most - cap;
  }

  function lineIndex(pid) {
    for (var i = 0; i < state.line.length; i++) { if (state.line[i].p === pid) { return i; } }
    return -1;
  }

  /*
    Once every SWEEP_MS. online is [{ actorId, profileId }] in the engine's
    order; how is { cap, staffSeats, holdsStaffRole(pid), hasPass(pid, now),
    tell(pid, text), line(pid, what), end(pid, actorId), log(line), relayOk }.
    relayOk false means the relay is not answering the command poll.
    Returns what it decided this sweep.
  */
  function sweep(now, online, how) {
    var cap = how.cap;
    var extra = cap ? (how.staffSeats || 0) : 0;
    var out = { seated: 0, refused: [], staffOver: [], waiting: [], granted: [], dropped: [] };
    function holds(pid) { try { return !!how.holdsStaffRole(pid); } catch (e) { return false; } }
    function proven(pid) { try { return !!how.hasPass(pid, now); } catch (e) { return false; } }

    var here = {};
    for (var i = 0; i < online.length; i++) {
      var p = Number(online[i] && online[i].profileId) || 0;
      if (p) { here[p] = online[i].actorId; }
    }
    var lists = [state.seated, state.waiting, state.refused, state.out];
    for (var l = 0; l < lists.length; l++) {
      for (var k in lists[l]) {
        if (own(lists[l], k) && here[k] === undefined) { delete lists[l][k]; }
      }
    }
    // Moved out for being idle and still here after their game had time to
    // leave: the session was ended (endLater), so from now on they are an
    // arrival like anybody, and one past the line is refused.
    for (var o in state.out) {
      if (own(state.out, o) && now - state.out[o] > OUT_FOR_MS) { delete state.out[o]; }
    }
    // The same for somebody refused. The engine keeps one actor per character
    // and skymp5-client connects again by itself after a session ends, so a
    // way back in between two sweeps looked like never having left, and the
    // refusal was never made again: judged afresh once the end has had its time.
    for (var rf in state.refused) {
      if (own(state.refused, rf) && now - state.refused[rf] > OUT_FOR_MS) { delete state.refused[rf]; }
    }
    // Everybody already in the world when this started keeps their seat.
    if (!state.primed) {
      state.primed = true;
      var kept = 0;
      for (var q in here) {
        if (own(here, q)) { state.seated[q] = now; kept++; }
      }
      if (kept) { how.log('[thornswood] seats: ' + kept + ' already in the world keep their seats'); }
    }

    // Arrivals a seat was held for go first: that seat is already counted.
    for (var a = 0; a < online.length; a++) {
      var ap = Number(online[a] && online[a].profileId) || 0;
      if (!ap || state.seated[ap] || state.out[ap] || !state.held[ap]) { continue; }
      state.seated[ap] = now;
      delete state.held[ap];
      how.log('[thornswood] seats: profile ' + ap + ' took the seat held for them');
    }

    // The line: whoever is in the world now is off it, and so is a place the
    // backstops say has gone (a close arriving from the relay is gone() below).
    var relayOk = how.relayOk !== false;
    var still = [];
    for (var n = 0; n < state.line.length; n++) {
      var e = state.line[n];
      if (state.seated[e.p]) { continue; }
      // The relay is not answering, so nothing could have been heard: silence does not count.
      if (!relayOk) { e.seen = now; still.push(e); continue; }
      var lost = '';
      if (e.handTo && now - e.handAt > HAND_MS) {
        if (e.closed) {
          lost = 'their game closed after handing it to profile ' + e.handTo + ', who never asked for it';
        } else {
          how.log('[thornswood] line: profile ' + e.handTo + ' never asked for the place profile ' + e.p +
                  ' handed it, so profile ' + e.p + ' keeps it');
        }
        delete e.handTo; delete e.handAt; delete e.closed;
      }
      if (!lost && e.back && now > e.back) {
        lost = 'the relay restarted and their menu did not ask again within ' + Math.round(RELAY_BACK_MS / 1000) + 's';
      } else if (!lost && !e.back && now - e.seen > LINE_SILENT_MS) {
        lost = 'nothing from their menu in ' + Math.round((now - e.seen) / 60000) +
               ' minutes, and the relay never said their game closed';
      }
      if (lost) {
        out.dropped.push(e.p);
        how.log('[thornswood] line: profile ' + e.p + ' lost their place: ' + lost);
        continue;
      }
      still.push(e);
    }
    state.line = still;
    for (var h in state.held) {
      if (own(state.held, h) && now - state.held[h].at > GRANT_MS) {
        delete state.held[h];
        how.log('[thornswood] seats: the seat held for profile ' + h + ' went unused for ' +
                Math.round(GRANT_MS / 1000) + 's, so it goes to the next in line');
      }
    }

    // Who is where. Staff in the world or on their way count into the staff seats first.
    var total = 0, staffIn = 0, held = 0, heldStaff = 0;
    for (var s in state.seated) {
      if (own(state.seated, s)) { total++; if (holds(Number(s))) { staffIn++; } }
    }
    for (var hs in state.held) {
      if (own(state.held, hs)) { held++; if (state.held[hs].staff) { heldStaff++; } }
    }
    function publicFree() {
      if (!cap) { return 1; }
      return cap - (total + held - Math.min(staffIn + heldStaff, extra));
    }
    function anyFree() {
      if (!cap) { return 1; }
      return cap + extra - (total + held);
    }
    function grant(pid, staff, why) {
      state.held[pid] = { at: now, staff: staff };
      held++;
      if (staff) { heldStaff++; }
      out.granted.push(pid);
      how.log('[thornswood] seats: a seat is held for profile ' + pid + ', ' + why);
      how.line(pid, { go: true, secs: Math.round(GRANT_MS / 1000) });
    }

    // A staff role with a pass skips the line into a staff seat.
    var rest = [];
    for (var f = 0; f < state.line.length; f++) {
      var w = state.line[f];
      if (cap && anyFree() > 0 && holds(w.p) && proven(w.p)) {
        grant(w.p, true, 'a staff role, ahead of the line');
        continue;
      }
      rest.push(w);
    }
    state.line = rest;
    // Then the line in order, while a seat anybody may take is free.
    while (state.line.length && publicFree() > 0) {
      var first = state.line.shift();
      grant(first.p, holds(first.p), cap ? 'first in line' : 'nobody is turned away for numbers');
    }
    // And everybody still waiting is told their place when it moves.
    for (var t = 0; t < state.line.length; t++) {
      var we = state.line[t];
      if (we.said !== t + 1 || we.saidOf !== state.line.length || now - we.saidAt >= SAY_AGAIN_MS) {
        we.said = t + 1;
        we.saidOf = state.line.length;
        we.saidAt = now;
        how.line(we.p, { place: t + 1, of: state.line.length });
      }
    }

    // Everybody else who has just arrived.
    for (var j = 0; j < online.length; j++) {
      var pid = Number(online[j] && online[j].profileId) || 0;
      if (!pid || state.seated[pid] || state.refused[pid] || state.out[pid]) { continue; }
      var staff = holds(pid);
      if (!cap || (!state.line.length && publicFree() > 0)) {
        state.seated[pid] = now;
        delete state.waiting[pid];
        total++;
        if (staff) { staffIn++; }
        continue;
      }
      var reason = '';
      if (staff && anyFree() > 0) {
        if (proven(pid)) {
          state.seated[pid] = now;
          delete state.waiting[pid];
          total++;
          staffIn++;
          out.staffOver.push(pid);
          how.log('[thornswood] seats: profile ' + pid + ' holds a staff role, seated in a staff seat (' +
                  total + ' in the world, the number is ' + cap + ')');
          continue;
        }
        if (!state.waiting[pid]) { state.waiting[pid] = now; }
        if (now - state.waiting[pid] < STAFF_WAIT_MS) { out.waiting.push(pid); continue; }
        reason = ' (a staff role, but no join pass was shown)';
      } else if (staff) {
        reason = ' (a staff role, but every staff seat is taken)';
      }
      state.refused[pid] = now;
      delete state.waiting[pid];
      out.refused.push(pid);
      how.log('[thornswood] door: full, refusing profile ' + pid + ': ' + total + ' of ' + cap +
              ' already in the world' + (state.line.length ? ', ' + state.line.length + ' waiting in line' : '') +
              reason);
      how.tell(pid, sentence(cap));
      // Their game closes its side and goes back to the choice (#1157).
      how.line(pid, { end: sentence(cap) });
      how.end(pid, online[j].actorId);
    }

    out.seated = total;
    state.status = { line: state.line.length, full: !!cap && (state.line.length > 0 || publicFree() <= 0) };
    return out;
  }

  /*
    One "/line" from the menu, under the profile the relay says sent it. A
    first ask goes to the end of the line; a later one only says they are
    still there. Somebody a seat is held for is told again to come in, so a
    lost answer is never a lost turn. With thornswoodRequirePass on, nobody
    waits without a join pass on hand, since without one they could not stay.
  */
  function want(pid, now, how) {
    pid = Number(pid) || 0;
    if (!pid) { return 'nobody'; }
    if (state.seated[pid]) { return 'in the world'; }
    if (state.held[pid]) {
      how.line(pid, { go: true, secs: Math.max(0, Math.ceil((GRANT_MS - (now - state.held[pid].at)) / 1000)) });
      return 'held';
    }
    var at = lineIndex(pid);
    if (at >= 0) { state.line[at].seen = now; delete state.line[at].back; return 'waiting'; }
    // A place or a held seat another of this game's characters handed to this one (#1142).
    for (var hh in state.held) {
      if (own(state.held, hh) && state.held[hh].handTo === pid && now - state.held[hh].handAt <= HAND_MS) {
        state.held[pid] = { at: state.held[hh].at, staff: state.held[hh].staff };
        delete state.held[hh];
        how.log('[thornswood] seats: profile ' + pid + ' takes the seat held for profile ' + hh + ', which handed it over');
        how.line(pid, { go: true, secs: Math.max(0, Math.ceil((GRANT_MS - (now - state.held[pid].at)) / 1000)) });
        return 'held';
      }
    }
    for (var hl = 0; hl < state.line.length; hl++) {
      var he = state.line[hl];
      if (he.handTo === pid && now - he.handAt <= HAND_MS) {
        how.log('[thornswood] line: profile ' + pid + ' takes the place profile ' + he.p + ' handed it, ' +
                (hl + 1) + ' of ' + state.line.length);
        he.p = pid; he.seen = now; he.said = 0; he.saidAt = 0;
        delete he.handTo; delete he.handAt; delete he.closed; delete he.back;
        return 'handed';
      }
    }
    var hasOne = false;
    try { hasOne = !!how.hasPass(pid, now); } catch (e) { hasOne = false; }
    if (how.requirePass && !hasOne) { how.line(pid, { pass: true }); return 'no pass'; }
    state.line.push({ p: pid, since: now, seen: now, said: 0, saidAt: 0 });
    how.log('[thornswood] line: profile ' + pid + ' is waiting at the menu, ' + state.line.length + ' in line');
    return 'joined';
  }

  /* "/line leave": the menu let go of its place on purpose. */
  function leave(pid, how) {
    pid = Number(pid) || 0;
    var at = lineIndex(pid);
    if (at >= 0) {
      state.line.splice(at, 1);
      how.log('[thornswood] line: profile ' + pid + ' left the line');
    }
    if (state.held[pid]) {
      delete state.held[pid];
      how.log('[thornswood] seats: profile ' + pid + ' let go of the seat held for them');
    }
  }

  /*
    "/line gone", from the relay itself: the connection that asked for this
    place has closed, so the game is closed, crashed or off the network, and
    the place goes now (Patrick, 29 Sep). A seat already held for them is left
    to run out its minute: pressing Join now loads the world, which can close
    and open the page's connection on the way in, and the minute is short.
    A place just handed to another of the same game's characters is kept for
    that character (hand below).
  */
  function gone(pid, now, how) {
    pid = Number(pid) || 0;
    var at = lineIndex(pid);
    if (at < 0) { return 'not waiting'; }
    var e = state.line[at];
    if (e.handTo && now - e.handAt <= HAND_MS) {
      e.closed = now;
      how.log('[thornswood] line: profile ' + pid + ' closed its connection after handing its place to profile ' +
              e.handTo + ', so the place waits for that one');
      return 'handed';
    }
    state.line.splice(at, 1);
    how.log('[thornswood] line: profile ' + pid + ' lost their place: their game closed its connection to the relay');
    return 'dropped';
  }

  /*
    "/line hand <profile>": the menu this place belongs to switched to another
    of its characters (after being moved out for being idle, the choice
    offers any of them). The connection that holds the place says so before
    it becomes the other character's, so only the holder can give it away,
    and the other takes it with its first "/line" within HAND_MS.
  */
  function hand(pid, to, now, how) {
    pid = Number(pid) || 0;
    to = Number(to) || 0;
    if (!pid || !to || pid === to) { return 'nothing'; }
    var at = lineIndex(pid);
    var what = at >= 0 ? state.line[at] : state.held[pid];
    if (!what) { return 'nothing'; }
    what.handTo = to;
    what.handAt = now;
    how.log('[thornswood] line: profile ' + pid + ' hands its ' + (at >= 0 ? 'place in line' : 'held seat') +
            ' to profile ' + to + ', another character of the same game');
    return 'handing';
  }

  /*
    Moved out of the world for being idle (#1142): the seat frees now, the next
    in line is told at the next sweep, and they wait at the end of the line at
    the menu. actorId is given while they are still in the world: they are not
    judged as an arrival for OUT_FOR_MS, and a game that has not left by then
    has its session ended.
  */
  function idleOut(pid, now, how, actorId) {
    pid = Number(pid) || 0;
    if (!pid) { return 'nobody'; }
    var had = !!state.seated[pid];
    delete state.seated[pid];
    delete state.waiting[pid];
    delete state.refused[pid];
    if (actorId) {
      state.out[pid] = now;
      how.end(pid, actorId);
    }
    if (lineIndex(pid) < 0 && !state.held[pid]) {
      state.line.push({ p: pid, since: now, seen: now, said: 0, saidAt: 0, idle: true });
      how.log('[thornswood] line: profile ' + pid + ' was moved out for being idle and waits at the menu, ' +
              state.line.length + ' in line');
    }
    how.line(pid, { afk: 'out' });
    return had ? 'seat freed' : 'in line';
  }

  /* The relay restarted: every waiting menu has RELAY_BACK_MS to ask again. */
  function relayRestarted(now, how) {
    for (var i = 0; i < state.line.length; i++) { state.line[i].back = now + RELAY_BACK_MS; }
    if (state.line.length) {
      how.log('[thornswood] line: the relay restarted; the ' + state.line.length + ' waiting keep their places ' +
              'if their menus ask again within ' + Math.round(RELAY_BACK_MS / 1000) + 's');
    }
    return state.line.length;
  }

  function endLater(pid, actorId) {
    setTimeout(function () {
      var userId = -1;
      try { userId = mp.getUserByActor(actorId); } catch (e) { userId = -1; }
      if (userId === undefined || userId === null || userId < 0) {
        console.log('[thornswood] seats: profile ' + pid + ' left before the session was ended');
        return;
      }
      try { mp.kick(userId); } catch (e) { console.log('[thornswood] seats: could not end profile ' + pid + ': ' + e); }
    }, KICK_AFTER_MS);
  }

  /* The Discord staff roles, as the site knows them; see the door block. */
  function holdsStaffRole(pid) {
    var f = g.__thornswoodHoldsStaffRole;
    return typeof f === 'function' ? !!f(pid) : false;
  }
  function hasPass(pid, now) {
    var seen = g.__thornswoodPassSeen;
    var p = seen && seen.passes ? seen.passes[pid] : null;
    return !!(p && Number(p.x) > now);
  }

  function liveHow() {
    var s = settings();
    var say = g.__thornswoodToProfile;
    // The chat commands block's poll of the relay (pollSaid): answering unless its last try failed.
    var poll = g.__thornswoodCommandPoll;
    // The join pass block's one reading of the switch, which fails closed
    // (#1319), as the dispatcher asks it.
    var jp = g.__thornswoodJoinPass;
    var requirePass = false;
    try { requirePass = !!(jp && jp.requiring && jp.requiring()); } catch (eReq) { requirePass = true; }
    return {
      cap: capOf(s), staffSeats: staffSeatsOf(s), requirePass: requirePass,
      relayOk: !poll || !poll.failAt || poll.okAt >= poll.failAt,
      holdsStaffRole: holdsStaffRole, hasPass: hasPass,
      tell: function (p, text) { if (say) { say(p, text); } },
      // The chat commands block posts it to the menu page (__thornswoodSayLine).
      line: function (p, what) { var f = g.__thornswoodSayLine; if (typeof f === 'function') { f(p, what); } },
      end: endLater,
      log: function (line) { console.log(line); }
    };
  }

  g.__thornswoodSeats = {
    sweep: sweep, want: want, leave: leave, liveHow: liveHow,
    gone: gone, hand: hand, idleOut: idleOut, relayRestarted: relayRestarted,
    cap: capOf, staffSeats: staffSeatsOf, sentence: sentence,
    status: function () { return state.status; },
    staffWait: STAFF_WAIT_MS, kickAfter: KICK_AFTER_MS, lineSilent: LINE_SILENT_MS,
    relayBack: RELAY_BACK_MS, handFor: HAND_MS, outFor: OUT_FOR_MS,
    grantFor: GRANT_MS, lineEvery: LINE_EVERY_MS
  };

  if (g.__thornswoodSeatTimer) { clearInterval(g.__thornswoodSeatTimer); }
  g.__thornswoodSeatTimer = setInterval(function () {
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
      console.log('[thornswood] seats sweep failed: ' + e);
    }
  }, SWEEP_MS);

  var capNow = capOf();
  console.log('[thornswood] seats: ' + (capNow
    ? 'at most ' + capNow + ' in the world at once, ' + staffSeatsOf() + ' staff seats over it for the ' +
      'Discord staff roles, and a line at the menu past that'
    : 'no thornswoodMostOnline in server-settings.json, so nobody is turned away for numbers'));
})();
// ==== end thornswood seats ====


