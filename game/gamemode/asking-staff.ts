// ==== thornswood asking staff ====
/*
  ASKING STAFF FOR HELP, AND REPORTING SOMEBODY, FROM INSIDE THE GAME (#414).

  Until this the only way to reach a moderator was to leave the game and open
  a ticket in the Discord, so a person stuck in a wall or being harassed at
  midnight had nothing to press. Two commands now:

    /helpme <what is wrong>          (/help-me as well)
    /report <name> <what they did>

  Each one goes three places at once:

    - to every member of staff who is in the world right now, as a private
      line in their chat, EXCEPT the person being reported, so a report about
      a moderator is never read first by that moderator;
    - to the site, on a keyed route (/api/report/game, or /dev/api/report/game
      for the dev server, because the dev door.json names the site with /dev
      on the end), which writes it into the inbox the admins read;
    - and from that inbox the Discord bot says it in the staff channel, which
      is how the site's public report page already reaches staff.

  The person who asked is told which of those it reached, after the site has
  answered, so "sent" is never said about something that was not.

  NOT ANONYMOUS, AND NOT A WAY TO SPAM. A line only counts from a character
  that is in the world; the site only takes these from a caller holding the
  door key, which is the game server and nobody else; and the limits below
  hold one profile to a handful an hour and the whole server to a few dozen.
  The site keeps its own count per profile on top of this one.

  WHAT A REPORT IS WORTH, SAID PLAINLY. The profile id a chat line arrives
  under is a claim the client makes, not a fact (see /tp in handle()). The
  record says so, so nobody reads it as more authoritative than it is. Nothing
  here keeps any chat around the report: what somebody said stays wherever
  the chat log already keeps it, and a moderator reads it there.

  /stuck, the escape hatch the issue also names, is the stuck block right
  after this one, built to Patrick's rules of 28 September.

  REPORT A PROBLEM (#3155), the third kind. Patrick, 21 Oct: testers get a
  button that files a board issue with their log and where they are. The
  button is on the help panel and its line is /problem, which nobody types.
  It goes to the site the same way, kind 'problem', and is said to no staff
  in the world: it is for the developers, and the bot files it on the board
  from the inbox. The site ties it to the session the launcher has open for
  that account, so the issue points at that session's logs.
*/
(function () {
  'use strict';
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var fs = null, path = null;
  try { fs = require('fs'); path = require('path'); } catch (e) { return; }

  function slog() {
    var a = ['[thornswood staff]'];
    for (var i = 0; i < arguments.length; i++) { a.push(arguments[i]); }
    try { console.log(a.join(' ')); } catch (e) { }
  }

  var LIMIT = {
    // One profile: this many of either kind in an hour. The site takes five
    // an hour from one profile as well, so this is the one people meet.
    hour: 5,
    // /helpme again within this long is the same call, not a new one.
    helpEvery: 5 * 60 * 1000,
    // The same person reported by the same person within this long.
    sameEvery: 60 * 60 * 1000,
    // The whole server, because the profile id is a claim and a script could
    // send lines under a hundred made up ones.
    all: 30,
    // How long the site gets to answer before the person is told it did not.
    wait: 8000,
    // The longest a reason is kept, and a name.
    said: 300,
    name: 60,
    // The longest a problem report is kept: a bug wants more words than a
    // call for help (#3155). The site keeps the same.
    problem: 1000
  };

  // On globalThis, so a hot reload does not hand everybody a fresh allowance.
  if (!g.__thornswoodAskSeen) { g.__thornswoodAskSeen = { by: {}, all: [] }; }
  var seen = g.__thornswoodAskSeen;

  function prune(now) {
    var cut = now - 60 * 60 * 1000;
    seen.all = seen.all.filter(function (t) { return t > cut; });
    for (var k in seen.by) {
      if (!Object.prototype.hasOwnProperty.call(seen.by, k)) { continue; }
      var kept = seen.by[k].filter(function (r) { return r.at > cut; });
      if (kept.length) { seen.by[k] = kept; } else { delete seen.by[k]; }
    }
  }

  function minutes(ms) {
    var m = Math.max(1, Math.ceil(ms / 60000));
    return m === 1 ? 'a minute' : m + ' minutes';
  }

  /** Why this one is refused, in a sentence, or '' when it may go. */
  function refusal(kind, profileId, aboutKey, now) {
    prune(now);
    var mine = seen.by[profileId] || [];
    if (mine.length >= LIMIT.hour && kind === 'problem') {
      return 'That is ' + LIMIT.hour + ' reports and calls to staff from you in the last hour, ' +
             'which is as many as the game takes. Try again in ' +
             minutes(mine[0].at + 60 * 60 * 1000 - now) + ', or post it in #test-findings in the Discord.';
    }
    if (mine.length >= LIMIT.hour) {
      return 'That is ' + LIMIT.hour + ' calls to staff from you in the last hour, which is ' +
             'as many as the game takes. Try again in ' +
             minutes(mine[0].at + 60 * 60 * 1000 - now) +
             ', or open a ticket in the Discord if it cannot wait.';
    }
    for (var i = mine.length - 1; i >= 0; i--) {
      var r = mine[i];
      if (kind === 'help' && r.kind === 'help' && now - r.at < LIMIT.helpEvery) {
        return 'Staff already have your call for help from ' + minutes(now - r.at) +
               ' ago. Somebody will come to you; try again in ' +
               minutes(r.at + LIMIT.helpEvery - now) + ' if nobody has.';
      }
      // The same problem sent twice: aboutKey is its words for this kind.
      if (kind === 'problem' && r.kind === 'problem' && aboutKey && r.about === aboutKey &&
          now - r.at < LIMIT.sameEvery) {
        return 'You sent that problem ' + minutes(now - r.at) + ' ago, and it is on its way ' +
               'to the board. Anything new about it can go in #test-findings in the Discord.';
      }
      if (kind === 'report' && r.kind === 'report' && aboutKey && r.about === aboutKey &&
          now - r.at < LIMIT.sameEvery) {
        return 'You reported them ' + minutes(now - r.at) + ' ago and staff have it. ' +
               'Anything new about the same thing can go in a ticket in the Discord.';
      }
    }
    if (seen.all.length >= LIMIT.all) {
      return 'Staff are taking a lot of calls from the game right now. Open a ticket ' +
             'in the Discord and it will reach them.';
    }
    return '';
  }

  function taken(kind, profileId, aboutKey, now) {
    if (!seen.by[profileId]) { seen.by[profileId] = []; }
    seen.by[profileId].push({ kind: kind, about: aboutKey || '', at: now });
    seen.all.push(now);
  }

  function nameOf(actorId) {
    try {
      var ap = mp.get(actorId, 'appearance');
      return String((ap && ap.name) || '').slice(0, LIMIT.name);
    } catch (e) { return ''; }
  }

  function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }

  /** Everybody in the world: [{ actorId, profileId, name }]. */
  function everyone() {
    var out = [], online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { online = []; }
    for (var i = 0; i < online.length; i++) {
      var pid = 0;
      try { pid = Number(mp.get(online[i], 'profileId')) || 0; } catch (e) { pid = 0; }
      if (pid) { out.push({ actorId: online[i], profileId: pid, name: nameOf(online[i]) }); }
    }
    return out;
  }

  /*
    Who a report is about, out of "/report Lydia Stormblade shoved me off the
    bridge". Names have spaces, so the longest name of somebody in the world
    that the line starts with wins; then a first name that only one person in
    the world has; and failing both, the first word, kept as typed, because a
    person who has already logged off can still be reported.
  */
  function whoAbout(words, people) {
    var line = words.join(' ').toLowerCase();
    var best = null, bestName = '';
    for (var i = 0; i < people.length; i++) {
      var n = String(people[i].name || '').toLowerCase().trim();
      if (!n) { continue; }
      if ((line === n || line.indexOf(n + ' ') === 0) && n.length > bestName.length) {
        best = people[i];
        bestName = n;
      }
    }
    if (best) {
      var used = bestName.split(/\s+/).length;
      return { name: best.name, person: best, rest: words.slice(used).join(' ').trim() };
    }
    var first = String(words[0] || '').toLowerCase();
    var same = people.filter(function (p) {
      return String(p.name || '').toLowerCase().trim().split(/\s+/)[0] === first;
    });
    if (first && same.length === 1) {
      return { name: same[0].name, person: same[0], rest: words.slice(1).join(' ').trim() };
    }
    return { name: String(words[0] || '').slice(0, LIMIT.name), person: null,
             rest: words.slice(1).join(' ').trim() };
  }

  /** Where the site is and the key to it, from the door's own file. */
  function door() {
    var privDir = 'private';
    try {
      var cfg = JSON.parse(fs.readFileSync('server-settings.json', 'utf8'));
      if (cfg && cfg.privDir) { privDir = String(cfg.privDir); }
    } catch (e) { }
    try {
      var conf = JSON.parse(fs.readFileSync(path.join(privDir, 'door.json'), 'utf8')
                              .replace(/^\uFEFF/, ''));
      if (conf && conf.site && conf.key) { return { site: String(conf.site), key: String(conf.key) }; }
    } catch (e) { }
    return null;
  }

  /*
    The post to the site. done(true) once the site has written it into the
    inbox, done(false, why) for anything else, and done is called once.
    The key goes in a header and never the address, like the door's fetch.
  */
  function toSite(row, done) {
    var once = false;
    function end(ok, why) { if (!once) { once = true; done(ok, why || ''); } }
    var conf = door();
    if (!conf) { end(false, 'no door.json'); return; }
    var url;
    try { url = new URL(conf.site.replace(/\/+$/, '') + '/api/report/game'); }
    catch (e) { end(false, 'the site address in door.json is not an address'); return; }
    var lib;
    try { lib = require(url.protocol === 'http:' ? 'http' : 'https'); }
    catch (e) { end(false, 'no ' + url.protocol); return; }
    var body = JSON.stringify(row);
    var req;
    try {
      req = lib.request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json',
                   'content-length': Buffer.byteLength(body),
                   'X-Thornswood-Key': conf.key }
      }, function (resp) {
        var buf = '';
        resp.on('data', function (d) { buf += d; });
        resp.on('end', function () {
          if (resp.statusCode === 200) { end(true); return; }
          var why = 'the site answered ' + resp.statusCode;
          try { var j = JSON.parse(buf); if (j && j.error) { why += ' (' + j.error + ')'; } } catch (e) { }
          end(false, why);
        });
      });
    } catch (e) { end(false, String((e && e.message) || e)); return; }
    req.on('error', function (e) { end(false, String((e && e.message) || e)); });
    try { req.setTimeout(LIMIT.wait, function () { req.destroy(); end(false, 'the site took too long'); }); } catch (e) { }
    req.end(body);
  }

  /*
    One call to staff. Called from handle() with the character already found,
    and with handle()'s own toProfile and staff test, so a reply goes out
    exactly the way every other command's does.
  */
  function ask(kind, parts, profileId, actorId, toProfile, isStaff) {
    var now = Date.now();
    var words = parts.slice(1).filter(Boolean);
    var people = everyone();
    var mine = nameOf(actorId) || 'Somebody';
    var about = null, said = '';

    if (kind === 'report') {
      if (words.length < 2) {
        toProfile(profileId, 'Say /report, the name of the person, and what they did: ' +
                  '/report Lydia shoved me off the bridge. It goes to staff and nobody else.');
        return;
      }
      about = whoAbout(words, people);
      said = about.rest;
      if (!said) {
        toProfile(profileId, 'Say what ' + about.name + ' did after the name, so staff know ' +
                  'what they are looking for.');
        return;
      }
      if (about.person && about.person.profileId === profileId) {
        toProfile(profileId, 'That is you. /helpme reaches staff if something is wrong.');
        return;
      }
    } else if (kind === 'problem') {
      said = words.join(' ');
      if (!said) {
        toProfile(profileId, 'Say what went wrong in the box on the help panel, then press Send.');
        return;
      }
    } else {
      said = words.join(' ');
    }
    said = said.slice(0, kind === 'problem' ? LIMIT.problem : LIMIT.said);

    var aboutKey = about ? (about.person ? 'p' + about.person.profileId
                                         : 'n' + about.name.toLowerCase())
                         : (kind === 'problem' ? 's' + said.toLowerCase() : '');
    var no = refusal(kind, profileId, aboutKey, now);
    if (no) { toProfile(profileId, no); return; }
    taken(kind, profileId, aboutKey, now);

    var pos = [0, 0, 0], cell = '';
    try {
      pos = mp.get(actorId, 'pos') || [0, 0, 0];
      cell = String(mp.get(actorId, 'worldOrCellDesc') || '');
    } catch (e) { }

    // Staff in the world, told now. Never the person reported, and never the
    // one asking, who is told separately below. Never for a problem, which
    // is for the developers and the board, not for whoever is on shift.
    var told = 0;
    if (kind !== 'problem') {
      var line = kind === 'help'
        ? '[staff] ' + mine + ' asks for help at ' + (cell || 'somewhere unknown') +
          (said ? ': ' + said : '.')
        : '[staff] ' + mine + ' reported ' + about.name + ': ' + said +
          ' (at ' + (cell || 'somewhere unknown') + ')';
      for (var i = 0; i < people.length; i++) {
        var p = people[i];
        if (p.profileId === profileId) { continue; }
        if (about && about.person && p.profileId === about.person.profileId) { continue; }
        var staff = false;
        try { staff = !!isStaff(p.profileId); } catch (e) { staff = false; }
        if (!staff) { continue; }
        toProfile(p.profileId, line);
        told++;
      }
    }

    var row = {
      kind: kind,
      profileId: profileId,
      name: mine,
      about: about ? about.name : '',
      aboutProfileId: (about && about.person) ? about.person.profileId : 0,
      said: said,
      cell: cell,
      pos: [round1(pos[0]), round1(pos[1]), round1(pos[2])],
      at: now,
      staffTold: told
    };
    slog(kind === 'help' ? '/helpme' : '/' + kind, 'from profile', profileId,
         about ? 'about ' + (row.aboutProfileId || JSON.stringify(row.about)) : '',
         'at', cell, 'staff in the world told:', told);

    toSite(row, function (ok, why) {
      if (!ok) { slog('the site did not take it:', why); }
      if (kind === 'problem') {
        toProfile(profileId, ok
          ? 'Your problem report reached the site and goes on the board for the developers, ' +
            'with where you are and the logs of this game once you close it. Thank you.'
          : 'Your problem report could not reach the site, so nothing was filed. Post it in ' +
            '#test-findings in the Discord and it will reach the developers.');
        return;
      }
      var inWorld = told
        ? (told === 1 ? 'A member of staff in the world has it now'
                      : told + ' members of staff in the world have it now')
        : 'Nobody from staff is in the world right now';
      var what = kind === 'help' ? 'Your call for help' : 'Your report';
      if (ok) {
        toProfile(profileId, what + ' reached staff. ' + inWorld +
                  ', and it is in the staff channel in the Discord, where somebody will pick it up.' +
                  (kind === 'report' ? ' Nobody else was told.' : ''));
      } else if (told) {
        toProfile(profileId, what + ' reached staff in the world: ' + inWorld.toLowerCase() +
                  '. It could not reach the staff channel in the Discord, so if nobody comes to ' +
                  'you, open a ticket there.');
      } else {
        toProfile(profileId, what + ' did not reach anybody: nobody from staff is in the world ' +
                  'and the site could not be reached. Open a ticket in the Discord (' +
                  (kind === 'help' ? 'I need help' : 'Report somebody') + ') and it will.');
      }
    });
  }

  g.__thornswoodAskStaff = {
    ask: ask, whoAbout: whoAbout, refusal: refusal, taken: taken, seen: seen,
    LIMIT: LIMIT, toSite: toSite, door: door
  };
  slog('ready: /helpme and /report reach staff in the world and the staff channel');
})();
// ==== end thornswood asking staff ====

