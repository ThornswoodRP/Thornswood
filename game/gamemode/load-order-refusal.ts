// ==== thornswood load order refusal ====
/*
  A MISMATCHED SESSION IS TOLD, AND CAN BE REFUSED (#402).

  The game's own check (loadOrderVerificationService in the client) compares
  the manifest above against Game.getModName, position by position, by name,
  size and crc32, and on a difference it paints LOAD ORDER ERROR in red and
  carries on. Nothing ends the session and nothing says what to do. On 17 Sep a
  tester's screenshot of the mining bug had that caption on it: he was playing
  a session where every custom object could resolve to something else, and
  reporting what he saw as bugs.

  So the front plugin reports its load order here, every two minutes, and this
  compares it with the manifest. On a difference the person is told in one
  sentence where it goes wrong and to press Fix, and, when the server is set to
  refuse, the session is ended a few seconds later so the sentence lands first.

  THE REPORT. A chat line is capped at 400 characters by the voice service, so
  the list cannot ride it as names. Each plugin is a five hex mark instead,
  FNV-1a over its lowercased name, size and crc32 (loadOrderMark, which the
  front plugin carries a copy of, and tests\test-load-order-refusal.js holds
  the two to each other), sent as

      /loadorder <total> <from> <mark><mark>...

  sixty four marks a line, so any length of list fits. A mark that differs
  names the position, which a single digest over the whole list could not.
  Twenty bits a mark means one wrong plugin in a million goes unseen, which is
  a lot better than the caption everybody ignores.

  NAME ONLY IS ACCEPTED TOO. The front marks the Bethesda masters and the
  Creation Club files by name alone, the same ten Verify.cs leaves out of its
  byte check: Steam owns those, Fix cannot mend them, and a refusal that says
  "press Fix" over one would be a door with no way through. It does the same
  for a plugin whose bytes it could not read. So a position passes when its
  mark matches the server's plugin with bytes or without, and fails only when
  it matches neither.

  PLUGINS AFTER THE SERVER'S LAST ARE LEFT ALONE, as the game's own check
  leaves them (a yellow warning only): they sit after every position the server
  resolves a form by, so nothing of the server's points anywhere else. The
  launcher refuses Play over them anyway. A client list that is SHORTER is a
  mismatch at the first position it does not have.

  WATCHING UNTIL IT IS SWITCHED ON. thornswoodLoadOrderRefuse in
  server-settings.json, true to end the session. Anything else tells the person
  and writes WOULD REFUSE to the log, and they stay. It is a setting and not a
  default because it is a decision (#402 leaves it with Patrick and Djinn): the
  launcher already refuses Play over the same list, and a kick with no process
  restart behind it left a reconnecting character with no world on 17 Sep (see
  clearTheServer). The door works the same way round, with its own enforce.

  WHAT THIS WIDENS, said plainly. The profile id a report arrives under is a
  claim, as for every line on this queue (see the note over rolelist), so with
  refusing on, somebody who can pose as another profile on the voice socket can
  end that person's session. Voice joins with a token close that hole, and
  THORNSWOOD_VOICE_AUTH is on for both voice services (28 Sep).

  NO REPORT IS A MISMATCH TOO (Patrick, 28 Sep: in game, an older launcher or
  front plugin is not kept working; only updating and security are). The front
  sends its report as soon as it has it and again every two minutes, so a
  report lost on the way is sent again. A profile online for GRACE_MS with no
  complete report is treated the way a list that differs is: told, and refused
  when refusing is on. A partial report is no report.

  THE LIGHT PLUGINS TOO (#1715). Once the engine loads light plugins the
  manifest carries their list, in light index order, and a light form id is
  0xFE000000 | (light index << 12) | local id, so a light plugin out of place
  names another plugin's form. The front plugin sends its light list the same
  way, as /loadorderlight, and it is held to the server's light list the same
  way the full one is held to mods: the same marks, the same verdict, the
  same sentence naming the light position. A server whose manifest has no
  light list takes the report and judges nothing by it; one that has a list
  needs both reports before a profile counts as reported.

  THE SERVER'S OWN FAILURES NEVER REFUSE ANYBODY. When this server cannot do
  the check, it logs and lets them stay: no manifest published, or the command
  relay from the voice service not answering (the report rides it, so the
  clock waits until the relay has been up for the whole grace), or the check
  itself throwing.
*/
(function () {
  var g = globalThis;

  var CHUNK = 64;           // marks a line; 64 * 5 plus the words stays under 400
  var WAIT_MS = 120000;     // a report whose last line never came is dropped

  function loadOrderMark(name, size, crc32) {
    var s = String(name == null ? '' : name).trim().toLowerCase();
    if (size !== undefined && size !== null) { s += '|' + Number(size) + '|' + (Number(crc32) >>> 0); }
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return ('00000' + ((h >>> 0) & 0xfffff).toString(16)).slice(-5);
  }

  /*
    The comparison, with nothing else in it. serverMods is the manifest's mods,
    marks the client's list in order. Returns null when they agree, or where
    they part: { at, theirs } with theirs the plugin the server has there.
  */
  function loadOrderVerdict(serverMods, marks) {
    var mods = Array.isArray(serverMods) ? serverMods : [];
    var have = Array.isArray(marks) ? marks : [];
    for (var i = 0; i < mods.length; i++) {
      var m = mods[i] || {};
      if (i >= have.length) { return { at: i, theirs: String(m.filename) }; }
      var mark = String(have[i]).toLowerCase();
      if (mark !== loadOrderMark(m.filename, m.size, m.crc32) &&
          mark !== loadOrderMark(m.filename)) {
        return { at: i, theirs: String(m.filename) };
      }
    }
    return null;
  }

  /** The one sentence, both ways round. */
  function loadOrderSentence(verdict, refusing) {
    return (verdict.light ? 'Your light plugins are not the server\'s from light position '
                          : 'Your plugins are not the server\'s from position ') + verdict.at +
           ', where the server has ' + verdict.theirs + ', so ' +
           (refusing ? 'this session is being ended before anything goes wrong: '
                     : 'what you see may not be what the server means: close the game, ') +
           'press Fix in the launcher, then Play again.';
  }

  function refusing() {
    try {
      var cfg = mp.getServerSettings() || {};
      return cfg.thornswoodLoadOrderRefuse === true;
    } catch (e) { return false; }
  }

  // Half arrived reports, by profile. On globalThis so a hot reload between
  // two lines of one report does not lose the first.
  if (!g.__thornswoodLoadOrderParts) { g.__thornswoodLoadOrderParts = {}; }
  var parts = g.__thornswoodLoadOrderParts;

  /*
    Who has reported and who is online, for the report that never comes.
    reported: profile -> when its last complete report arrived.
    online:   profile -> { joined, clock, actorId, judged } while it is online.
    last:     profile -> { key, at }, the last verdict said, so a report sent
              again every two minutes is not said again every two minutes.
  */
  if (!g.__thornswoodLoadOrderSeen) { g.__thornswoodLoadOrderSeen = { reported: {}, online: {}, last: {} }; }
  var seen = g.__thornswoodLoadOrderSeen;
  // reportedLight: profile -> when its last complete light report arrived
  // (#1715). Added beside an older reload's object rather than replacing it.
  if (!seen.reportedLight) { seen.reportedLight = {}; }

  var GRACE_MS = 300000;          // online this long with no complete report: no report
  var REPORT_BEFORE_MS = 600000;  // a report this long before the character arrived still counts
  var RELAY_STALE_MS = 10000;     // the command poll runs every 1.5 s
  var SAY_AGAIN_MS = 600000;      // the same verdict is said and logged at most this often
  var SWEEP_MS = 15000;

  function actorOfProfile(profileId) {
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { return 0; }
    for (var i = 0; i < online.length; i++) {
      var pid = 0;
      try { pid = Number(mp.get(online[i], 'profileId')) || 0; } catch (e) { pid = 0; }
      if (pid === profileId) { return online[i]; }
    }
    return 0;
  }

  // After the sentence, so it is on screen before the connection goes. Their
  // game is told the session ends (#1157), so it closes its side and does not
  // connect again by itself; the kick is for a game that does not.
  function refuseLater(profileId, actorId, sentence) {
    var line = g.__thornswoodSayLine;
    if (typeof line === 'function') { line(profileId, { end: sentence }); }
    setTimeout(function () {
      var actor = actorId || actorOfProfile(profileId);
      var userId = -1;
      try { userId = mp.getUserByActor(actor); } catch (e) { userId = -1; }
      if (userId === undefined || userId === null || userId < 0) {
        console.log('[thornswood] could not find the connection of profile ' + profileId + ', so they stayed');
        return;
      }
      try { mp.kick(userId); } catch (e) { console.log('[thornswood] could not refuse profile ' + profileId + ': ' + e); }
    }, 5000);
  }

  /* True when this verdict has not been said to this profile lately. */
  function fresh(profileId, key, now) {
    var l = seen.last[profileId];
    if (l && l.key === key && now - l.at < SAY_AGAIN_MS) { return false; }
    seen.last[profileId] = { key: key, at: now };
    return true;
  }

  /*
    One line of a report. tell(text) says a line to the person; actorId is
    their character, which the dispatcher has already waited for. Returns the
    verdict once the whole list is in, and undefined until then.
  */
  function take(profileId, words, actorId, tell) {
    var light = String(words[0]).toLowerCase() === '/loadorderlight';
    var key = (light ? 'light ' : '') + profileId;
    var total = Number(words[1]);
    var from = Number(words[2]);
    var marks = String(words[3] || '').match(/[0-9a-f]{5}/gi) || [];
    if (!(total >= 0) || !(from >= 0) || total > 4096) { return undefined; }

    var now = Date.now();
    for (var k in parts) {
      if (Object.prototype.hasOwnProperty.call(parts, k) && now - parts[k].at > WAIT_MS) { delete parts[k]; }
    }
    var p = parts[key];
    if (from === 0) { p = parts[key] = { total: total, marks: [], at: now }; }
    if (!p || p.total !== total || p.marks.length !== from) {
      console.log('[thornswood] ' + (light ? 'light ' : '') + 'load order report from profile ' + profileId +
                  ' arrived out of order, so it was not checked');
      delete parts[key];
      return undefined;
    }
    p.marks = p.marks.concat(marks);
    p.at = now;
    if (p.marks.length < total) { return undefined; }
    delete parts[key];
    if (light) {
      seen.reportedLight[profileId] = now;
      var lightMods = g.__thornswoodManifestLight;
      // An engine that loads no light plugin: nothing to hold the list to.
      if (!Array.isArray(lightMods)) { return null; }
      return judge(profileId, actorId, tell, lightMods, p.marks.slice(0, total), total, true, now);
    }
    seen.reported[profileId] = now;

    var mods = g.__thornswoodManifestMods;
    if (!Array.isArray(mods) || !mods.length) {
      console.log('[thornswood] load order report from profile ' + profileId +
                  ' not checked: the load order manifest was not published (the line saying why is earlier in this log)');
      return undefined;
    }

    return judge(profileId, actorId, tell, mods, p.marks.slice(0, total), total, false, now);
  }

  /*
    The verdict on one complete list, full or light, said and acted on.
    The same for both: they differ only in the list held to and the words.
  */
  function judge(profileId, actorId, tell, mods, marks, total, light, now) {
    var what = light ? 'light load order' : 'load order';
    var verdict = loadOrderVerdict(mods, marks);
    if (!verdict) {
      if (fresh(profileId, (light ? 'light ' : '') + 'match', now)) {
        console.log('[thornswood] ' + what + ' of profile ' + profileId + ' matches the server\'s, ' +
                    mods.length + (light ? ' light plugins' : ' plugins') +
                    (total > mods.length ? ' and ' + (total - mods.length) + ' after them' : ''));
      }
      return null;
    }
    if (light) { verdict.light = true; }
    var at = (light ? 'light at ' : 'at ') + verdict.at;

    var refuse = refusing();
    if (!refuse) {
      if (fresh(profileId, at, now)) {
        tell(loadOrderSentence(verdict, false));
        // The full one's words are what site\server.js reads the server log
        // for (serverRefusal); the light one's carry the same lead.
        console.log((light ? '[thornswood] WOULD REFUSE profile ' + profileId + ': light load order differs at '
                           : '[thornswood] WOULD REFUSE profile ' + profileId + ': load order differs at ') +
                    verdict.at + ', where the server has ' + verdict.theirs +
                    '. Watching only, they stayed (thornswoodLoadOrderRefuse is not true).');
      }
      return verdict;
    }
    seen.last[profileId] = { key: at, at: now };
    var told = loadOrderSentence(verdict, true);
    tell(told);
    console.log((light ? '[thornswood] refusing profile ' + profileId + ': light load order differs at '
                       : '[thornswood] refusing profile ' + profileId + ': load order differs at ') +
                verdict.at + ', where the server has ' + verdict.theirs);
    refuseLater(profileId, actorId, told);
    return verdict;
  }

  /** The sentence for a report that never came. */
  function noReportSentence(refusing) {
    return 'Your game has not told the server which plugins it loaded, so ' +
           (refusing ? 'this session is being ended before anything goes wrong: '
                     : 'what you see may not be what the server means: close the game, ') +
           'press Fix in the launcher, then Play again.';
  }

  /*
    Once every SWEEP_MS: who has been online GRACE_MS with no complete report.
    online is [{ actorId, profileId }]; tell(profileId, text) says a line.
    Returns the profiles judged this sweep. Pure but for the log, the tell and
    the kick, so the test can drive it with its own clock.
  */
  function sweep(now, online, tell) {
    var mods = g.__thornswoodManifestMods;
    var poll = g.__thornswoodCommandPoll || {};
    // The server's own failures: the clock only runs while the server could
    // have heard a report, and it starts again after any break in the relay.
    var canCheck = Array.isArray(mods) && mods.length > 0 &&
                   !!poll.okAt && now - poll.okAt <= RELAY_STALE_MS;
    var here = {};
    var judged = [];
    for (var i = 0; i < online.length; i++) {
      var pid = Number(online[i] && online[i].profileId) || 0;
      if (!pid) { continue; }
      here[pid] = true;
      var e = seen.online[pid];
      if (!e) { e = seen.online[pid] = { joined: now, clock: now, actorId: 0, judged: false }; }
      e.actorId = online[i].actorId;
      if (!canCheck) { e.clock = now; continue; }
      if (poll.failAt && poll.failAt > e.clock) { e.clock = poll.failAt; }
      if (e.judged) { continue; }
      var r = seen.reported[pid] || 0;
      // A server with a light list needs the light report as well (#1715).
      if (Array.isArray(g.__thornswoodManifestLight)) {
        var rl = seen.reportedLight[pid] || 0;
        r = rl ? Math.min(r, rl) : 0;
      }
      if (r && r >= e.joined - REPORT_BEFORE_MS) { continue; }
      if (now - e.clock < GRACE_MS) { continue; }
      e.judged = true;
      judged.push(pid);
      var refuse = refusing();
      tell(pid, noReportSentence(refuse));
      if (!refuse) {
        console.log('[thornswood] WOULD REFUSE profile ' + pid + ': no load order report in ' +
                    Math.round((now - e.clock) / 1000) + 's online. Watching only, they stayed ' +
                    '(thornswoodLoadOrderRefuse is not true).');
        continue;
      }
      console.log('[thornswood] refusing profile ' + pid + ': no load order report in ' +
                  Math.round((now - e.clock) / 1000) + 's online');
      refuseLater(pid, e.actorId, noReportSentence(refuse));
    }
    for (var k in seen.online) {
      if (Object.prototype.hasOwnProperty.call(seen.online, k) && !here[k]) { delete seen.online[k]; }
    }
    for (var q in seen.reported) {
      if (Object.prototype.hasOwnProperty.call(seen.reported, q) && !here[q] &&
          now - seen.reported[q] > REPORT_BEFORE_MS) { delete seen.reported[q]; }
    }
    for (var ql in seen.reportedLight) {
      if (Object.prototype.hasOwnProperty.call(seen.reportedLight, ql) && !here[ql] &&
          now - seen.reportedLight[ql] > REPORT_BEFORE_MS) { delete seen.reportedLight[ql]; }
    }
    return judged;
  }

  g.__thornswoodLoadOrder = { mark: loadOrderMark, verdict: loadOrderVerdict,
                              sentence: loadOrderSentence, noReport: noReportSentence,
                              take: take, sweep: sweep, chunk: CHUNK, grace: GRACE_MS };

  // The sweep's own failure is the server's, so it logs and refuses nobody.
  if (g.__thornswoodLoadOrderTimer) { clearInterval(g.__thornswoodLoadOrderTimer); }
  g.__thornswoodLoadOrderTimer = setInterval(function () {
    try {
      var list = [];
      var online = mp.get(0, 'onlinePlayers') || [];
      for (var i = 0; i < online.length; i++) {
        var pid = 0;
        try { pid = Number(mp.get(online[i], 'profileId')) || 0; } catch (e) { pid = 0; }
        if (pid) { list.push({ actorId: online[i], profileId: pid }); }
      }
      var say = g.__thornswoodToProfile;
      sweep(Date.now(), list, function (pid, text) { if (say) { say(pid, text); } });
    } catch (e) {
      console.log('[thornswood] load order sweep failed, nobody refused: ' + e);
    }
  }, SWEEP_MS);
})();
// ==== end thornswood load order refusal ====


