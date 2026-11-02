// ==== thornswood voice feed, added by Add-VoiceFeed.ps1 ====
// ----------------------------------------------------------------- voice ---
// Proximity voice, server side.
//
// The voice service runs beside this server and needs one thing from it:
// where everybody is, five times a second. It gets it from here rather than
// from anybody's game, which means voice does not care which client build a
// person runs, and nobody can move their own voice by editing a file.
//
// Everything below is deliberately best effort. A voice service that is down,
// slow or not installed must never be able to take the game server with it, so
// every call is wrapped and failures are counted rather than thrown.
(function () {
  var VOICE_PORT = voicePort();
  var EVERY_MS = 200;
  var http = null;

  try { http = require('http'); } catch (e) { return; }
  if (!http) return;

  var failures = 0;
  var complained = false;
  var inFlight = false;

  function send(payload) {
    if (inFlight) return;           // never queue: a late position is worthless
    inFlight = true;

    var body = JSON.stringify(payload);
    var req = http.request({
      host: '127.0.0.1', port: VOICE_PORT, path: '/positions', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
    }, function (res) {
      res.resume();
      res.on('end', function () { inFlight = false; failures = 0; complained = false; });
    });

    req.on('error', function () {
      inFlight = false;
      failures++;
      // Once, then quiet. Nobody needs this five times a second for an hour.
      if (failures === 25 && !complained) {
        complained = true;
        console.log('[thornswood] voice service is not answering on ' + VOICE_PORT +
                    '. Proximity voice is off; everything else is unaffected.');
      }
    });
    req.setTimeout(1000, function () { try { req.destroy(); } catch (e) { } });
    req.end(body);
  }

  /*
    Which party somebody is in, or '' for none.

    The voice service only tells each person about the people near enough to
    hear and about their own party, wherever they are, because the party
    strip draws an arrow to every member off this feed (entry 282). It cannot
    know the parties itself, so each row carries one. Read at tick time, not
    once here, because the social block that keeps the parties loads further
    down this file.
  */
  function partyFor(profileId) {
    try {
      var soc = globalThis.__thornswoodSocial;
      return String((soc && soc.inParty && soc.inParty[profileId]) || '');
    } catch (e) { return ''; }
  }

  // Stored and cleared like the chargen timers, so a hot reload replaces
  // this feed rather than adding a second one that never stops.
  if (globalThis.__thornswoodVoiceFeed) {
    try { clearInterval(globalThis.__thornswoodVoiceFeed); } catch (e) { }
  }
  globalThis.__thornswoodVoiceFeed = setInterval(guard('voiceFeed', function () {
    var who = [];
    try {
      var online = mp.get(0, 'onlinePlayers') || [];
      for (var i = 0; i < online.length; i++) {
        var id = online[i];
        try {
          var pos = mp.get(id, 'pos');
          if (!pos) continue;
          var angle = mp.get(id, 'angle') || [0, 0, 0];
          // Each read once: five times a second for everybody on, an
          // appearance read twice was ten parses a person a second (#385).
          var pid = mp.get(id, 'profileId');
          var look = mp.get(id, 'appearance');
          who.push({
            profileId: pid,
            actor: id,
            pos: pos,
            angleZ: angle[2],
            // Two people in the same room share this string. Two people either
            // side of a loading door do not, which is exactly the line voice
            // should stop at.
            cell: String(mp.get(id, 'worldOrCellDesc') || ''),
            name: String(look && look.name || ''),
            party: partyFor(pid)
          });
        } catch (e) { }
      }
    } catch (e) { return; }

    // Sent with nobody in the world too, because it also carries the join
    // pass switch, which the voice service follows for the connections of
    // people still at the menu (#410).
    var jp = globalThis.__thornswoodJoinPass;
    var requirePass = !!(jp && jp.requiring && jp.requiring());
    try { send({ who: who, requirePass: requirePass }); } catch (e) { }
  }), EVERY_MS);

  // ------------------------------------------------------------- online ---
  // How many people are awake, written where the launcher can read it.
  //
  // There is no way to ask a SkyMP server how busy it is: its networking has
  // no status packet, and the public list the old build used belongs to the
  // old multiplayer mod and this server never reports to it. But the server already
  // serves its resources folder over HTTP, so a small file dropped in there is
  // readable by every launcher without opening anything new or inventing a
  // protocol.
  try {
    var fs = require('fs');
    var path = require('path');
    var dataDir = 'data';
    var privDir = 'private';
    try {
      var cfg = JSON.parse(fs.readFileSync('server-settings.json', 'utf8'));
      if (cfg && cfg.dataDir) dataDir = String(cfg.dataDir);
      if (cfg && cfg.privDir) privDir = String(cfg.privDir);
    } catch (e) { }

    var onlineFile = path.join(dataDir, 'online.json');
    var lastWritten = -1;

    /*
      Both files below are written whole with the engine's mp.writeFileWhole
      (#2740), never in place: the site reads online.json from disk, every
      launcher and game asks the port for it, and the deploys read both over
      ssh, so a read that landed on an in-place write found an empty or cut
      short file. A write the engine refuses (a reader that opened the file
      without sharing delete) leaves the file as it was and is said on the
      console, once for each new reason, and what it held is not counted as
      written, so the next pass two seconds on writes what is true then.
    */
    var namesFailed = '';
    var onlineFailed = '';
    var sayWriteFailed = function (file, e, said) {
      var why = String((e && e.message) || e);
      if (why !== said) { console.log('[thornswood] could not write ' + file + ': ' + why); }
      return why;
    };

    /*
      Who is on, by character name, for the deploy scripts (issue #520).

      Deploy-DevGamemode and Deploy-Server read the count before they stop
      anything and warn the room, but a count cannot say whose evening is
      about to be interrupted. The names go into the private folder, never
      next to online.json: that folder is served over HTTP to anybody who
      asks, and who is on right now is nobody else's business. The deploy
      reads this one over ssh.
    */
    var namesFile = path.join(privDir, 'online-names.json');
    var lastNames = null;

    // Cleared on a hot reload, so reloading does not leave two writers
    // racing each other over the same file.
    if (globalThis.__thornswoodOnlineWriter) {
      try { clearInterval(globalThis.__thornswoodOnlineWriter); } catch (e) { }
    }
    var lastRestarting = false;
    var lastMax = -1;
    var lastLine = -1;
    var lastFull = null;

    globalThis.__thornswoodOnlineWriter = setInterval(function () {
      var n = 0;
      var on = [];
      try { on = mp.get(0, 'onlinePlayers') || []; n = on.length; } catch (e) { return; }

      // Written on its own test, before the count's: one person leaving and
      // another arriving between two passes leaves the count where it was.
      var names = [];
      for (var i = 0; i < on.length; i++) {
        var nm = '';
        try { nm = String((mp.get(on[i], 'appearance') || {}).name || ''); } catch (e) { }
        if (!nm) {
          try { nm = 'profile ' + mp.get(on[i], 'profileId'); } catch (e) { nm = 'somebody'; }
        }
        names.push(nm);
      }
      names.sort();
      var namesKey = names.join('\n');
      if (namesKey !== lastNames) {
        try {
          mp.writeFileWhole(namesFile, JSON.stringify({ at: Date.now(), names: names }));
          lastNames = namesKey;
          namesFailed = '';
        } catch (e) {
          namesFailed = sayWriteFailed(namesFile, e, namesFailed);
        }
      }

      /*
        Whether a countdown is running, for the client's own probe.

        thornswood-front.js watches this folder to decide the server is still
        there, and quits to the main menu after a run of misses. A restart
        people were told to sit through looks identical to the server being
        gone, so everybody who did as they were told got thrown out anyway.
        The countdown state lives on globalThis so this writer can see it from
        another block.
      */
      var restarting = false;
      try {
        var r = globalThis.__thornswoodRestart;
        var nowR = Date.now();
        /*
          Counting down, or stopped counting down within the last three
          minutes. Three is longer than the stop, copy and start in
          Deploy-Server, and being wrong this way only ever delays a quit.
          After the restart this process is fresh, the record is empty again,
          and the next pass writes false.

          Both halves are needed and neither is enough on its own. restartTick
          runs every 1500 ms and this every 2000 ms, so for up to a tick after
          the deadline passes the countdown is over and nothing has recorded
          that yet: at is in the past and went is not set. Asking how long ago
          at was, rather than whether it is still ahead, covers that gap, and
          went covers the rest once the tick has zeroed at.
        */
        restarting = !!(r && ((r.at && nowR - r.at < 180000) ||
                             (r.went && nowR - r.went < 180000)));
      } catch (e) { restarting = false; }

      // Only when something moves. This file sits in a folder the server
      // serves, and rewriting it twice a second for no reason is churn nobody
      // asked for.
      // And the most the world holds at once (#481), so the launcher and the
      // site say "N of M" from the server's own number. M is every seat, the
      // staff seats too, not the number the door turns people away past:
      // Patrick, 12 Oct, "the real cap is 30 but 25 for people with non staff
      // roles I still want it to say of 30 awake tho". So 30 on main and 5 on
      // dev, which has no staff seats over its 5. Whether somebody picking
      // now would wait is full, below, which the seats block works out.
      var max = 0;
      try {
        var seatsApi = globalThis.__thornswoodSeats;
        var settingsNow = mp.getServerSettings() || {};
        var capNow = seatsApi ? seatsApi.cap(settingsNow) : 0;
        max = capNow ? capNow + seatsApi.staffSeats(settingsNow) : 0;
      } catch (e) { max = 0; }
      // And how many wait at the menu, and whether somebody picking now would
      // wait too, from the seats block (#481): the menu reads full to decide
      // between joining and taking a place in line, the site to say so.
      var line = 0, full = false;
      try {
        var seatsNow = globalThis.__thornswoodSeats ? globalThis.__thornswoodSeats.status() : null;
        line = seatsNow ? Number(seatsNow.line) || 0 : 0;
        full = !!(seatsNow && seatsNow.full);
      } catch (e) { line = 0; full = false; }
      if (n === lastWritten && restarting === lastRestarting && max === lastMax &&
          line === lastLine && full === lastFull) return;
      try {
        mp.writeFileWhole(onlineFile, JSON.stringify({
          now: n, at: Date.now(), restarting: restarting, max: max, line: line, full: full
        }));
      } catch (e) {
        onlineFailed = sayWriteFailed(onlineFile, e, onlineFailed);
        return;
      }
      onlineFailed = '';
      lastWritten = n;
      lastRestarting = restarting;
      lastMax = max;
      lastLine = line;
      lastFull = full;
    }, 2000);

    console.log('[thornswood] online count published at ' + onlineFile);
  } catch (e) { }

  console.log('[thornswood] voice position feed running, pushing to 127.0.0.1:' + VOICE_PORT);
})();
// ==== end thornswood voice feed ====
