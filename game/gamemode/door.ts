// ==== thornswood door ====
// ---------------------------------------------------------------- the door ---
//
// The server has had no access control of any kind. Anyone who knows the
// address connects, and the address is about to be on a public website.
//
// This watches who turns up and compares them against an allow list. It starts
// in WATCH mode and kicks nobody, because it was written without a way to test
// it against a live server, and a door that wrongly turns everybody away is a
// worse outage than the hole it closes. Run it for a day, read the log, and
// only then set "enforce": true.
//
// The allow list lives at <dataDir>/allowed.json:
//
//     { "enforce": false, "profiles": [123, 456], "devProfiles": [123], "note": "..." }
//
// enforce      false logs and lets everyone in. true tells anybody not listed
//              why and ends their session (turnAway, #1894).
// profiles     the profileId of each person allowed in. The launcher shows a
//              person's profile id on the Diagnostics page.
// devProfiles  the subset who also hold the dev or admin role. Read by
//              __thornswoodIsDev below, for gating a command rather than a
//              connection.
//
// No file means the door is off entirely and this costs one failed stat per
// thirty seconds.
(function () {
  var fs = null, path = null;
  try { fs = require('fs'); path = require('path'); } catch (e) { return; }
  if (!fs || !path) return;

  var dataDir = 'data';
  var privDir = 'private';
  var serverKind = 'main';
  try {
    var cfg = JSON.parse(fs.readFileSync('server-settings.json', 'utf8'));
    if (cfg && cfg.dataDir) dataDir = String(cfg.dataDir);
    if (cfg && cfg.privDir) privDir = String(cfg.privDir);
    if (cfg && cfg.thornswoodServer) serverKind = String(cfg.thornswoodServer).trim().toLowerCase() || 'main';
  } catch (e) { }


  /*
    Make the folder before writing into it.

    privDir held door.json, allowed.json and characters.json on 18 September
    and on 20 September the whole folder was gone. Every write into it is
    wrapped in a try, so a missing folder is not an error anybody sees: the
    character register silently stops being saved, the door silently never
    fetches a roster, and /tp silently refuses everybody because the list it
    reads was never written. That is three separate reports with one cause and
    no log line between them.

    One mkdir at load costs nothing and there is no case where the right answer
    is to carry on writing into a folder that is not there.
  */
  function ensureDir(d) {
    try {
      if (d && !fs.existsSync(d)) {
        fs.mkdirSync(d, { recursive: true });
        console.log('[thornswood] made the missing folder ' + d);
      }
    } catch (e) {
      console.log('[thornswood] could not make ' + d + ': ' + e);
    }
  }
  ensureDir(privDir);

  var FILE = path.join(privDir, 'allowed.json');
  var LOG  = path.join(privDir, 'door.log');

  var list = null;       // null means no file, door off
  var readAt = 0;
  // The hold offices the site reads from Discord roles (#2551): the ten holds
  // as the ledgers name them, and the four offices.
  var OFFICE_HOLDS = ['whiterun', 'solitude', 'riften', 'markarth', 'windhelm',
                      'falkreath', 'morthal', 'dawnstar', 'winterhold', 'ravenrock'];
  var OFFICE_KINDS = ['jarl', 'court', 'steward', 'guard'];

  function load() {
    var now = Date.now();
    if (now - readAt < 30000) return list;
    readAt = now;
    try {
      var doc = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''));
      var ids = {};
      if (Array.isArray(doc.profiles)) {
        for (var i = 0; i < doc.profiles.length; i++) {
          var n = Number(doc.profiles[i]);
          if (n) ids[n] = true;
        }
      }
      // Who among them also holds the dev or admin role, from the same
      // answer, so a command gate elsewhere in this file can ask without a
      // second trip anywhere.
      var devIds = {};
      if (Array.isArray(doc.devProfiles)) {
        for (var j = 0; j < doc.devProfiles.length; j++) {
          var dn = Number(doc.devProfiles[j]);
          if (dn) devIds[dn] = true;
        }
      }
      // The site's admins (the Owner and Dev roles, unless its config says
      // otherwise), so an Owner's new character is an admin in here too and
      // not only the one profile number written into server-settings.json.
      var adminIds = {};
      if (Array.isArray(doc.adminProfiles)) {
        for (var a = 0; a < doc.adminProfiles.length; a++) {
          var an = Number(doc.adminProfiles[a]);
          if (an) adminIds[an] = true;
        }
      }
      // The hold offices (#2551), each profile's, from its account's Discord
      // roles ("Jarl of Whiterun", "Whiterun Court", "Steward of Whiterun",
      // "Guard of Whiterun"), which the site reads. The roles are the one
      // truth: nothing in the game keeps a list of who holds what. Read field
      // by field: an office is one of the four, a hold one of the ten.
      var offices = {};
      var od = (doc.offices && typeof doc.offices === 'object') ? doc.offices : {};
      for (var ok in od) {
        if (!Object.prototype.hasOwnProperty.call(od, ok)) continue;
        var opid = Number(ok);
        if (!(opid > 0) || !od[ok] || typeof od[ok] !== 'object') continue;
        var orow = { jarl: [], court: [], steward: [], guard: [] };
        for (var oi = 0; oi < OFFICE_KINDS.length; oi++) {
          var ol = Array.isArray(od[ok][OFFICE_KINDS[oi]]) ? od[ok][OFFICE_KINDS[oi]] : [];
          for (var oj = 0; oj < ol.length; oj++) {
            var oh = String(ol[oj]);
            if (OFFICE_HOLDS.indexOf(oh) !== -1 && orow[OFFICE_KINDS[oi]].indexOf(oh) === -1) orow[OFFICE_KINDS[oi]].push(oh);
          }
        }
        offices[opid] = orow;
      }
      // A hold whose Jarl role two accounts hold (#2551): the site has
      // already taken it off both, and names the profiles so the game can
      // tell each of them why.
      var clash = [];
      if (Array.isArray(doc.jarlClash)) {
        for (var ci = 0; ci < doc.jarlClash.length; ci++) {
          var cr = doc.jarlClash[ci] || {};
          var ch = String(cr.hold || '');
          if (OFFICE_HOLDS.indexOf(ch) === -1) continue;
          var cps = [];
          var crp = Array.isArray(cr.profiles) ? cr.profiles : [];
          for (var cj = 0; cj < crp.length; cj++) { var cn = Number(crp[cj]); if (cn > 0) cps.push(cn); }
          clash.push({ hold: ch, profiles: cps });
        }
      }
      sayClash(clash);
      // Who holds one of the Discord staff roles itself (#481), for the staff
      // seats. Not devProfiles: that also counts the site's hand written
      // admins list, which is not a role.
      var staffRoleIds = {};
      if (Array.isArray(doc.staffRoleProfiles)) {
        for (var sr = 0; sr < doc.staffRoleProfiles.length; sr++) {
          var sid = Number(doc.staffRoleProfiles[sr]);
          if (sid) staffRoleIds[sid] = true;
        }
      }
      // Business Owner, the Discord role a business book is founded from, and
      // each faction's Leader role, whose holder owns that faction's book
      // (#3317). Same answer as the staff seats. Absent until the site sends
      // them.
      var businessIds = {};
      if (Array.isArray(doc.businessOwnerProfiles)) {
        for (var bo = 0; bo < doc.businessOwnerProfiles.length; bo++) {
          var bid = Number(doc.businessOwnerProfiles[bo]);
          if (bid) businessIds[bid] = true;
        }
      }
      // Leader role name -> the profiles of the account that holds it: one
      // book per faction, owned by whoever holds its Leader role, and it
      // moves with the role (Patrick, 22 Oct, page card q-3317-faction-books,
      // A). The Faction Owner role it replaces is gone.
      var leadRoles = {};
      var fl = doc.factionLeaderProfiles;
      if (fl && typeof fl === 'object' && !Array.isArray(fl)) {
        for (var lr in fl) {
          if (!Object.prototype.hasOwnProperty.call(fl, lr) || !/^[^\n]{1,96} Leader$/.test(lr) ||
              !Array.isArray(fl[lr])) continue;
          for (var lp = 0; lp < fl[lr].length; lp++) {
            var lid = Number(fl[lr][lp]);
            if (!lid) continue;
            if (!leadRoles[lid]) leadRoles[lid] = [];
            if (leadRoles[lid].indexOf(lr) === -1) leadRoles[lid].push(lr);
          }
        }
      }
      // The Discord role named Dev, not every staff seat. A Dev may found
      // one business and one faction. The other seats only open a book.
      var devRoleIds = {};
      if (Array.isArray(doc.devRoleProfiles)) {
        for (var dv = 0; dv < doc.devRoleProfiles.length; dv++) {
          var dvid = Number(doc.devRoleProfiles[dv]);
          if (dvid) devRoleIds[dvid] = true;
        }
      }
      // The trading company's Discord role (#1393), from the same answer.
      // An application like a Jarl's: asked for in Discord, given by a person.
      var companyIds = {};
      if (Array.isArray(doc.companyProfiles)) {
        for (var co = 0; co < doc.companyProfiles.length; co++) {
          var coid = Number(doc.companyProfiles[co]);
          if (coid) companyIds[coid] = true;
        }
      }
      var accounts = {};
      if (Array.isArray(doc.people)) {
        for (var pe = 0; pe < doc.people.length; pe++) {
          var person = doc.people[pe];
          if (!person || !Array.isArray(person.profiles)) continue;
          for (var pf = 0; pf < person.profiles.length; pf++) {
            var pp = Number(person.profiles[pf]);
            if (pp) accounts[pp] = String(person.id);
          }
        }
      }
      // Banned (#412) or dead for good (#1010): the site leaves these off
      // the list and sends them in the same answer, and the staff block ends
      // the session saying which and why. Profile -> until (0: no end).
      var barred = {};
      if (Array.isArray(doc.pk)) {
        for (var bk = 0; bk < doc.pk.length; bk++) {
          var kn = Number(doc.pk[bk]);
          if (kn) barred[kn] = 0;
        }
      }
      if (Array.isArray(doc.bans)) {
        for (var bb = 0; bb < doc.bans.length; bb++) {
          var ban = doc.bans[bb] || {};
          var bu = Number(ban.until) || 0;
          var bps = Array.isArray(ban.profiles) ? ban.profiles : [];
          for (var bq = 0; bq < bps.length; bq++) {
            var bn = Number(bps[bq]);
            // The one that lasts longest; 0 lasts for good.
            if (bn && barred[bn] !== 0) barred[bn] = bu ? Math.max(barred[bn] || 0, bu) : 0;
          }
        }
      }
      list = { enforce: doc.enforce === true, ids: ids, devIds: devIds, adminIds: adminIds, offices: offices, clash: clash, staffRoleIds: staffRoleIds, devRoleIds: devRoleIds, businessIds: businessIds, leadRoles: leadRoles, companyIds: companyIds, accounts: accounts, barred: barred, count: Object.keys(ids).length };
    } catch (e) {
      list = null;
    }
    return list;
  }

  /*
    Whether this profile's Discord account holds the dev or playtest role,
    right now, as of the last five minute refresh from the site.

    On globalThis because this whole module is one closed IIFE and the command
    handler that wants this lives in a different one further down the file.
    False whenever there is nothing to ask, which is a door that is off
    entirely (no door.json) rather than a reason to trust nobody: it is a
    ceiling raised for people who already hold a role, never a floor.
  */
  /*
    And only for a profile the join pass has proved, once
    thornswoodRequirePass is on (#410): every role below is keyed on a profile
    number, which on its own is one the client picked. The door's own check
    of who may connect reads the list directly and is not changed by this;
    it has to run before any pass can have arrived.
  */
  function passProved(profileId) {
    var t = globalThis.__thornswoodPassTrusts;
    return typeof t !== 'function' || !!t(profileId);
  }
  (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodIsDev = function (profileId) {
    var l = load();
    return passProved(profileId) && !!(l && l.devIds && l.devIds[Number(profileId)]);
  };
  (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodIsAdmin = function (profileId) {
    var l = load();
    return passProved(profileId) && !!(l && l.adminIds && l.adminIds[Number(profileId)]);
  };
  // A Discord staff role on the account, for the staff seats (#481).
  (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodHoldsStaffRole = function (profileId) {
    var l = load();
    return passProved(profileId) && !!(l && l.staffRoleIds && l.staffRoleIds[Number(profileId)]);
  };
  // Business Owner, the Leader roles held, and the Discord account a book is
  // founded on.
  (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodBookRoles = function (profileId) {
    var l = load();
    var n = Number(profileId);
    var proved = passProved(n);
    return {
      staff: proved && !!(l && l.staffRoleIds && l.staffRoleIds[n]),
      dev: proved && !!(l && l.devRoleIds && l.devRoleIds[n]),
      business: proved && !!(l && l.businessIds && l.businessIds[n]),
      leads: (proved && l && l.leadRoles && l.leadRoles[n]) ? l.leadRoles[n].slice() : [],
      account: (l && l.accounts && l.accounts[n]) ? String(l.accounts[n]) : ('p:' + n)
    };
  };

  /*
    THE HOLD OFFICES OF A PROFILE (#2551). Patrick, 15 Oct: a Jarl's hold
    comes from their "Jarl of <Hold>" Discord role, and each hold's Court,
    Steward and Guards are Discord roles that hold's Jarl gives. So every
    office is read from the account's roles, through the site, and nothing in
    the game keeps a copy: { jarl: [holds], court: [...], steward: [...],
    guard: [...] }, empty for a profile the pass has not proved. A Jarl role
    two accounts hold is already off both (the site's jarlClashes).

    The office is the account's, so every character on it holds it: the role
    is the one truth, and the seat that tied the Jarl office to one character
    is gone with the hold choice (#2508, replaced by #2551).

    The property block reads these through officeOf, the one place.
  */
  function officesIn(l, n) {
    var row = (l && l.offices && Object.prototype.hasOwnProperty.call(l.offices, n)) ? l.offices[n] : null;
    return { jarl: row ? row.jarl.slice() : [], court: row ? row.court.slice() : [],
             steward: row ? row.steward.slice() : [], guard: row ? row.guard.slice() : [] };
  }
  (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodOffices = function (profileId) {
    var n = Number(profileId) || 0;
    return officesIn(passProved(n) ? load() : null, n);
  };
  /*
    The same, for a record the server already holds about a profile and not
    for a press arriving now: who held a jail claim made before the jail rule
    (endPreRuleJailClaims, at server start, when nobody has sent a pass). Never
    for a live action: a live action is keyed on a profile the pass proves.
  */
  (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodOfficesOnRecord = function (profileId) {
    var n = Number(profileId) || 0;
    return officesIn(load(), n);
  };
  /*
    Everybody who holds one office of one hold, for the Jarl's Office page:
    one row per Discord account, with every profile of it the list knows, so
    the page can name whichever of its characters is in the world.
  */
  /*
    The Discord account a profile is on, as the site named it, or '' when the
    list names no account for it. A hold office is one character's (#2551,
    Patrick, 16 Oct): the role is the account's, and the property block keeps
    which of the account's characters holds it.
  */
  /* Whether there is a list of the roles at all, read from the site (#2551). */
  (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodRolesKnown = function () {
    return !!load();
  };
  (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodAccountOf = function (profileId) {
    var l = load();
    var n = Number(profileId) || 0;
    return (l && l.accounts && l.accounts[n]) ? String(l.accounts[n]) : '';
  };
  (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodOfficeHolders = function (office, hold) {
    var l = load();
    var out = [];
    var byAccount = {};
    if (!l || !l.offices || OFFICE_KINDS.indexOf(String(office)) === -1) return out;
    for (var k in l.offices) {
      if (!Object.prototype.hasOwnProperty.call(l.offices, k)) continue;
      if (l.offices[k][office].indexOf(String(hold)) === -1) continue;
      var n = Number(k);
      var acct = (l.accounts && l.accounts[n]) ? String(l.accounts[n]) : ('p:' + n);
      if (!Object.prototype.hasOwnProperty.call(byAccount, acct)) {
        byAccount[acct] = { account: acct, profiles: [] };
        out.push(byAccount[acct]);
      }
      byAccount[acct].profiles.push(n);
    }
    return out;
  };
  /*
    The holds whose Jarl role this profile's account holds with another
    account, so neither acts. onRecord: for a record the server holds, the
    way __thornswoodOfficesOnRecord is, without the pass.
  */
  (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodJarlClash = function (profileId, onRecord) {
    var l = load();
    var n = Number(profileId) || 0;
    var out = [];
    if (!l || !Array.isArray(l.clash) || (!onRecord && !passProved(n))) return out;
    for (var i = 0; i < l.clash.length; i++) {
      if (l.clash[i].profiles.indexOf(n) !== -1 && out.indexOf(l.clash[i].hold) === -1) out.push(l.clash[i].hold);
    }
    return out;
  };

  /*
    The Free Skyrim Trading Company's Discord role on the account (#1393).
    Accepted on an application in Discord, the same shape as a Jarl's. It is
    what lets a character handle a company sale, in the property block.
  */
  (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodIsCompany = function (profileId) {
    var l = load();
    return passProved(profileId) && !!(l && l.companyIds && l.companyIds[Number(profileId)]);
  };

  /*
    And the playtest roster, which is the same list the door already keeps.

    A profile is only in allowed.json at all because the site asked Discord and
    got back somebody who may play, so being on it IS holding the play role.
    That is what makes this worth reading for a command gate: it is the same
    fact, already fetched, already five minutes fresh, and nobody has to
    maintain a second copy of it by hand.
  */
  (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodIsAllowed = function (profileId) {
    var l = load();
    return passProved(profileId) && !!(l && l.ids && l.ids[Number(profileId)]);
  };

  /*
    Whether the role lists are actually answering, for the startup line.

    A door that was never configured returns false to every question above,
    silently, and that is exactly how /tp came to refuse everybody on 19 and 20
    September: the code was right and there was no list anywhere for it to
    read. Saying so once at startup is the difference between a bug somebody
    reports and a line somebody notices.
  */
  (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodRoleSource = function () {
    var l = load();
    if (!l) { return 'none'; }
    return Object.keys(l.ids).length + ' allowed, ' + Object.keys(l.devIds || {}).length + ' dev';
  };

  /*
    One line on the console and one in door.log. door.log is kept for 90
    days, the gamemode's own log's time (the keeping times block below,
    #2353). A write that fails used to be caught and dropped with nothing
    said, so a door whose log had stopped looked like a quiet door: it is
    said on the console once for each new reason, and once when the file
    takes a line again.
  */
  var logFailed = '';
  function note(line) {
    var stamp = new Date().toISOString();
    console.log('[thornswood door] ' + line);
    try {
      fs.appendFileSync(LOG, stamp + '  ' + line + '\n');
      if (logFailed) {
        logFailed = '';
        console.log('[thornswood door] ' + LOG + ' takes lines again');
      }
    } catch (e) {
      var why = String((e && (e.code || e.message)) || e);
      if (why !== logFailed) {
        logFailed = why;
        console.log('[thornswood door] could not write ' + LOG + ' (' + why + '), so the door\'s lines are on the console only');
      }
    }
  }

  // Everybody this pass has already decided about, so a person is judged once
  // per visit rather than every two seconds for as long as they are standing
  // there.
  var judged = {};

  // When the list last came down from the site, when the site was last asked
  // for an unknown profile, and when each connection was first seen. A
  // character made a minute ago is on the site (the launcher checks the
  // chosen profile in at the main menu) and not on a list that is up to five
  // minutes old; on 20 September that refused /tp to Patrick's new character
  // for the rest of the refresh window, and with the door enforcing it would
  // have turned them away. So an unknown profile makes the door ask the site
  // again, at most once in twenty seconds, and hold its judgement until the
  // answer is in or thirty seconds have gone.
  var listAt = 0;
  var askedAt = 0;
  var seenAt = {};

  /*
    Who was let in, with the profile they came in on and the list that let
    them in, so a list that lands without them judges them again.

    From the To Do List, entry 143: "an active session is severed when the ban
    is written". judged above is cleared only when somebody leaves, so a ban
    that took a profile off the list at the next refresh reached nobody who
    was already in the world. They stayed until they logged out.

    ONLY A LIST THAT LANDED DOES THIS. A refresh that failed, was rate limited
    or could not reach Discord for anybody returns before it moves listAt, and
    one that came back empty carries nobody, so neither touches anybody already
    in. One that reached Discord for some people and not others does land, but
    the ones it could not check keep the standing they had (keepWhatFailed
    below), so they are left alone too. A Discord hiccup that throws the whole
    server out at once is the outage the watch-only start above was written to
    avoid.
  */
  var letIn = {};

  /*
    TOLD WHY, AND THE SESSION STAYS ENDED (#1894).

    This kicked at once and said nothing. skymp5-client connects again after
    every disconnect and logs in as the same character, so the same session
    came straight back, was judged again once it was seen, and was kicked
    again, and the person was never told why. Every other place that ends a
    session on purpose says why first (#1157): the sentence in their chat, the
    same sentence as { end } on the line their character choice reads, so
    their game closes its own connection and goes back to the choice with it,
    and the kick a few seconds later for a game that does not close itself.
    The door does the same, after the same five seconds as the join pass.

    The dev server's list is its staff only (/dev/api/allowed), so applying
    is not what somebody turned away there needs to do. And somebody off the
    list because they are banned or their character is dead for good is left
    to the staff block, which ends the session with that and its reason: the
    door ticks every two seconds and the ban sweep every ten, so the door
    would end it first and tell a banned person to apply.
  */
  var TURN_AWAY_MS = 5000;
  var TURNED_AWAY = serverKind === 'dev'
    ? 'You are not on the list of people who may play on the dev server, which is for staff, so the ' +
      'session is being ended. To play Thornswood, open the Thornswood launcher, not Thornswood Dev, and press Play.'
    : 'You are not on the list of people who may play on Thornswood, so the session is being ended. ' +
      'Read thornswood.net/join to apply, and press Play in the launcher once you are accepted.';

  function turnAway(pid, actorId) {
    if (pid) {
      var tell = g.__thornswoodToProfile;
      var line = g.__thornswoodSayLine;
      if (typeof tell === 'function') { tell(pid, TURNED_AWAY); }
      if (typeof line === 'function') { line(pid, { end: TURNED_AWAY }); }
    }
    note('turning away profile ' + (pid || 'unknown') + ' (actor ' + actorId.toString(16) + ')' +
         (pid ? ', told why' : ', with no profile to tell why'));
    setTimeout(function () {
      var userId = -1;
      try { userId = mp.getUserByActor(actorId); } catch (e) { userId = -1; }
      if (userId === undefined || userId === null || userId < 0) {
        note('profile ' + (pid || 'unknown') + ' had already gone when the kick came');
        return;
      }
      try {
        mp.kick(userId);
        note('turned away profile ' + (pid || 'unknown') + ' (actor ' + actorId.toString(16) + ')');
      } catch (e) {
        note('could not turn away profile ' + (pid || 'unknown') + ': ' + e);
      }
    }, TURN_AWAY_MS);
  }

  function tick() {
    var conf = load();
    if (!conf) return;                       // no allowed.json, door is off

    var online;
    try { online = mp.get(0, 'onlinePlayers'); } catch (e) { return; }
    if (!Array.isArray(online)) return;

    var here = {};
    var now = Date.now();
    for (var i = 0; i < online.length; i++) here[online[i]] = true;
    for (var k in judged) { if (!here[k]) delete judged[k]; }
    for (var k2 in seenAt) { if (!here[k2]) delete seenAt[k2]; }
    for (var k3 in letIn) { if (!here[k3]) delete letIn[k3]; }

    for (var j = 0; j < online.length; j++) {
      var actorId = online[j];
      if (judged[actorId]) {
        var was = letIn[actorId];
        if (!was || was.at >= listAt || !conf.count) continue;
        if (conf.ids[was.pid]) { was.at = listAt; continue; }
        delete judged[actorId];
        delete letIn[actorId];
        note('profile ' + was.pid + ' dropped off the list while in the world (actor ' +
             actorId.toString(16) + '), judging them again');
      }
      if (!seenAt[actorId]) seenAt[actorId] = now;

      var pid = 0;
      try { pid = Number(mp.get(actorId, 'profileId')) || 0; } catch (e) { pid = 0; }

      var ok = pid && conf.ids[pid];
      if (!ok && listAt < seenAt[actorId] && now - seenAt[actorId] < 30000) {
        if (now - askedAt > 20000) {
          askedAt = now;
          note('profile ' + (pid || 'unknown') + ' is not on the list yet, asking the site again');
          try { refresh(); } catch (e) { note('refresh threw: ' + e); }
        }
        continue;
      }
      judged[actorId] = true;
      if (ok) {
        letIn[actorId] = { pid: pid, at: listAt };
        note('let in profile ' + pid + ' (actor ' + actorId.toString(16) + ')');
        continue;
      }

      if (!conf.enforce) {
        note('WOULD TURN AWAY profile ' + (pid || 'unknown') +
             ' (actor ' + actorId.toString(16) + '). Watching only, they stayed. ' +
             conf.count + ' profiles on the list.');
        continue;
      }

      var bar = pid ? conf.barred[pid] : undefined;
      if (bar !== undefined && (!bar || bar > now)) {
        note('profile ' + pid + ' is banned or dead for good, so the staff block ends the session and says why');
        continue;
      }
      turnAway(pid, actorId);
    }
  }

  // ------------------------------------------------------------ refresh ---
  //
  // The list comes from the site, which is the only thing that knows Discord
  // roles. <dataDir>/door.json holds where to ask and the key to ask with:
  //
  //     { "site": "https://thornswood.net", "key": "<the bot key>" }
  //
  // No file means no refreshing, and the door uses whatever allowed.json
  // already says. "enforce" is never touched by this: turning the door on is a
  // decision, not something a web request gets to make.
  /*
    SAID ONCE, AND SAYING WHAT TO DO ABOUT IT.

    Patrick, 21 September, after an evening on this: "still can't tp says no
    list", and before that "well it should pull the roles from discord
    automaticlly bruh". It should, and it could not, and nothing anywhere said
    why.

    MEASURED with Check-Roster on both servers: private held characters.json
    and nothing else. No door.json on live, none on dev, so the door has never
    had a config to fetch WITH, allowed.json has never been written, and every
    tier of every role check has been answering no to everybody on both
    servers. Set-Door.ps1 -Connect is what writes that file, and every install
    deleted the folder it lives in until that was fixed the same night, so it
    was almost certainly written once and quietly wiped.

    EVERY FAILURE ON THIS PATH WAS SILENT, which is the whole reason it cost an
    evening. This function returned on a missing file, refresh is on a timer so
    it returned again five minutes later, and /tp said "you are not on the
    list" to the owner of the server. Three symptoms, one missing file, no line
    anywhere.

    So it says so, once, and names the script that fixes it. Once because this
    runs every five minutes forever and a line each time is a log nobody reads.
    The KEY IS NEVER TOUCHED HERE: the file is named, never its contents.
  */
  var doorSaid = false;

  /*
    ONE PERSON WHO COULD NOT BE CHECKED IS NOT A REASON TO KEEP EVERYBODY STALE.

    From the To Do List: "one rate-limited lookup throws the whole list
    away". The site marked its whole answer failed when any single lookup
    failed, and this kept the old list for everybody, so a ban, a new tester
    or a removed role waited on the one person Discord would not answer for.

    The site now names the profiles it could not check, in failedProfiles.
    Each of those keeps exactly the standing it had in the file before: on
    the list if it was, off it if it was not, and the same in devProfiles and
    adminProfiles. A failed lookup can neither let somebody in nor turn
    somebody away. Everybody else takes the fresh answer.

    Only called when the site named who failed AND reached somebody; the
    check in refresh() below still keeps the whole list when it did not.
  */
  function keepWhatFailed(doc, had) {
    var failed = {};
    for (var i = 0; i < doc.failedProfiles.length; i++) {
      var f = Number(doc.failedProfiles[i]);
      if (f) failed[f] = true;
    }
    function merged(fresh, old) {
      var out = Array.isArray(fresh) ? fresh.slice() : [];
      var seen = {};
      for (var j = 0; j < out.length; j++) seen[Number(out[j])] = true;
      if (Array.isArray(old)) {
        for (var k = 0; k < old.length; k++) {
          var n = Number(old[k]);
          if (n && failed[n] && !seen[n]) { seen[n] = true; out.push(n); }
        }
      }
      return out;
    }
    // The people rows are what Set-Door.ps1 prints, so a kept profile keeps
    // the row that names whose it is.
    var people = Array.isArray(doc.people) ? doc.people.slice() : [];
    var named = {};
    for (var p = 0; p < people.length; p++) if (people[p]) named[String(people[p].id)] = true;
    var oldPeople = Array.isArray(had.people) ? had.people : [];
    for (var q = 0; q < oldPeople.length; q++) {
      var row = oldPeople[q];
      if (!row || named[String(row.id)] || !Array.isArray(row.profiles)) continue;
      for (var r = 0; r < row.profiles.length; r++) {
        if (failed[Number(row.profiles[r])]) { named[String(row.id)] = true; people.push(row); break; }
      }
    }
    // The hold offices (#2551) are a map by profile: a profile that could
    // not be checked keeps the offices it had in the file, and no other.
    var offices = {};
    var fresh = (doc.offices && typeof doc.offices === 'object') ? doc.offices : {};
    var stale = (had.offices && typeof had.offices === 'object') ? had.offices : {};
    for (var fo in fresh) if (Object.prototype.hasOwnProperty.call(fresh, fo) && !failed[Number(fo)]) offices[fo] = fresh[fo];
    for (var so in stale) if (Object.prototype.hasOwnProperty.call(stale, so) && failed[Number(so)]) offices[so] = stale[so];
    // The faction Leader roles (#3317) are a map by role: a profile that could
    // not be checked keeps the Leader roles it had in the file, and no other.
    var leaders = {};
    var freshLead = (doc.factionLeaderProfiles && typeof doc.factionLeaderProfiles === 'object') ? doc.factionLeaderProfiles : {};
    var staleLead = (had.factionLeaderProfiles && typeof had.factionLeaderProfiles === 'object') ? had.factionLeaderProfiles : {};
    function lead(from, keep) {
      for (var role in from) {
        if (!Object.prototype.hasOwnProperty.call(from, role) || !Array.isArray(from[role])) continue;
        for (var lp = 0; lp < from[role].length; lp++) {
          var pid = Number(from[role][lp]);
          if (!pid || !!failed[pid] !== keep) continue;
          if (!leaders[role]) leaders[role] = [];
          if (leaders[role].indexOf(pid) === -1) leaders[role].push(pid);
        }
      }
    }
    lead(freshLead, false);
    lead(staleLead, true);
    return {
      profiles: merged(doc.profiles, had.profiles),
      devProfiles: merged(doc.devProfiles, had.devProfiles),
      adminProfiles: merged(doc.adminProfiles, had.adminProfiles),
      offices: offices,
      staffRoleProfiles: merged(doc.staffRoleProfiles, had.staffRoleProfiles),
      businessOwnerProfiles: merged(doc.businessOwnerProfiles, had.businessOwnerProfiles),
      factionLeaderProfiles: leaders,
      devRoleProfiles: merged(doc.devRoleProfiles, had.devRoleProfiles),
      companyProfiles: merged(doc.companyProfiles, had.companyProfiles),
      people: people
    };
  }

  /*
    A HOLD'S JARL ROLE HELD BY TWO ACCOUNTS (#2551). Patrick, 15 Oct: neither
    acts as Jarl until staff fix it, and staff are told which accounts. The
    site tells staff, in the staff channel; this says it once in the door's
    log when the list changes, so the server's own log shows why a Jarl
    could not act.
  */
  var clashSaid = '';
  function sayClash(clashes) {
    var holds = [];
    for (var i = 0; Array.isArray(clashes) && i < clashes.length; i++) {
      if (clashes[i] && clashes[i].hold) holds.push(String(clashes[i].hold));
    }
    var now = holds.sort().join(', ');
    if (now === clashSaid) return;
    clashSaid = now;
    note(now ? 'two or more Discord accounts hold the Jarl role of ' + now +
               ', so neither acts as Jarl there until staff take the role from all but one'
             : 'no Jarl role of a hold is held by more than one account now');
  }

  /*
    done, when given, hears whether the list was written: true once
    allowed.json holds the site's answer, false for every way it was not. An
    office change made in the game (#2551) asks for the list once, right after
    the site set the role, and redraws the pages when it is in.
  */
  function refresh(done) {
    var told = false;
    var tell = function (ok) {
      if (told || typeof done !== 'function') { return; }
      told = true;
      try { done(ok); } catch (e) { note('refresh: what waited on it threw: ' + e); }
    };
    var conf;
    try {
      conf = JSON.parse(fs.readFileSync(path.join(privDir, 'door.json'), 'utf8')
                          .replace(/^\uFEFF/, ''));
    } catch (e) {
      if (!doorSaid) {
        doorSaid = true;
        console.log('[thornswood] there is no ' + path.join(privDir, 'door.json') +
                    ', so the door never fetches, allowed.json is never written, ' +
                    'and every role check refuses everybody including the owner. ' +
                    'Set-Door.ps1 -Connect writes it.');
      }
      tell(false);
      return;
    }
    if (!conf || !conf.site || !conf.key) {
      if (!doorSaid) {
        doorSaid = true;
        console.log('[thornswood] ' + path.join(privDir, 'door.json') +
                    ' is there but has no site or no key, so the door cannot ' +
                    'fetch. Set-Door.ps1 -Connect rewrites it.');
      }
      tell(false);
      return;
    }
    doorSaid = false;

    var https;
    try { https = require('https'); } catch (e) { tell(false); return; }

    // The key goes in a header, never the address. An address is what a web
    // server writes down, and this key is the door's whole secret. Entry 248.
    var url = String(conf.site).replace(/\/+$/, '') + '/api/allowed';
    var req;
    try {
      req = https.get(url, { headers: { 'X-Thornswood-Key': String(conf.key) } }, function (resp) {
        var buf = '';
        resp.on('data', function (d) { buf += d; });
        resp.on('end', function () {
          var doc;
          try { doc = JSON.parse(buf); } catch (e) {
            note('the site sent something that is not a list: ' + buf.slice(0, 120));
            tell(false);
            return;
          }
          if (resp.statusCode !== 200) {
            note('the site refused the list, ' + resp.statusCode +
                 (doc && doc.error ? ' (' + doc.error + ')' : ''));
            tell(false);
            return;
          }
          // Keeping the old list is the safe failure. Writing a short one built
          // while Discord was unreachable would turn away everybody missing
          // from it. A site that names who failed (failedProfiles) and reached
          // Discord for somebody (a profile came back) gets the partial write
          // below instead, which keeps just those as they were; a site older
          // than that, or one that reached nobody, keeps the whole list.
          if (doc.lookupFailed &&
              !(Array.isArray(doc.failedProfiles) && doc.failedProfiles.length &&
                Array.isArray(doc.profiles) && doc.profiles.length)) {
            /*
              AND WHY. This said only that the site could not reach Discord,
              and on 22 September that one line was the whole of what anybody
              knew after an evening of looking. The site works the reason out
              in plain words and used to throw it away one line after it knew
              it; it sends it now. A wrong token, a bot that may not read
              members, a rate limit and no token at all are four different
              fixes and they read identically without this.
            */
            note('the site could not reach Discord, keeping the list as it was' +
                 (doc.lookupFailedWhy ? ': ' + doc.lookupFailedWhy
                                      : '. The site did not say why, so it is ' +
                                        'running a build older than 22 September.'));
            tell(false);
            return;
          }
          /*
            THE LAST SILENT BRANCH IN THIS CHAIN, AND IT IS THE ONE THAT WOULD
            HAVE HURT MOST.

            Every other way this can fail already says so: a body that is not
            JSON, a status that is not 200, Discord being unreachable, the
            write failing, the request erroring, the timeout. This one returned
            on a two hundred with a perfectly good JSON document that simply
            had no profiles array in it, and said nothing at all. The door
            would keep refreshing every five minutes, forever, and allowed.json
            would never appear, which reads from the outside exactly like the
            missing door.json that cost 21 September.
          */
          if (!Array.isArray(doc.profiles)) {
            note('the site answered 200 but sent no profiles list. Keys it sent: ' +
                 Object.keys(doc || {}).join(', '));
            tell(false);
            return;
          }

          var enforce = false;
          var had = {};
          try {
            had = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, '')) || {};
            enforce = had.enforce === true;
          } catch (e) { }

          if (doc.lookupFailed) {
            var kept = keepWhatFailed(doc, had);
            doc.profiles = kept.profiles;
            doc.devProfiles = kept.devProfiles;
            doc.adminProfiles = kept.adminProfiles;
            doc.offices = kept.offices;
            doc.staffRoleProfiles = kept.staffRoleProfiles;
            doc.businessOwnerProfiles = kept.businessOwnerProfiles;
            doc.factionLeaderProfiles = kept.factionLeaderProfiles;
            doc.devRoleProfiles = kept.devRoleProfiles;
            doc.companyProfiles = kept.companyProfiles;
            doc.people = kept.people;
            note(doc.failedProfiles.length + ' profiles could not be checked with Discord ' +
                 'and keep the standing they had' +
                 (doc.lookupFailedWhy ? ': ' + doc.lookupFailedWhy : ''));
          }

          // Whole, never in place (#2740): Set-Door reads it on the box while
          // the server runs, and an in-place write read half way is no list.
          try {
            mp.writeFileWhole(FILE, JSON.stringify({
              enforce: enforce,
              profiles: doc.profiles,
              devProfiles: Array.isArray(doc.devProfiles) ? doc.devProfiles : [],
              adminProfiles: Array.isArray(doc.adminProfiles) ? doc.adminProfiles : [],
              // The hold offices by profile, and the Jarl roles two accounts
              // hold (#2551), from the Discord roles the site reads.
              offices: (doc.offices && typeof doc.offices === 'object') ? doc.offices : {},
              jarlClash: Array.isArray(doc.jarlClash) ? doc.jarlClash : [],
              // The Discord staff roles themselves, for the staff seats (#481).
              staffRoleProfiles: Array.isArray(doc.staffRoleProfiles) ? doc.staffRoleProfiles : [],
              businessOwnerProfiles: Array.isArray(doc.businessOwnerProfiles) ? doc.businessOwnerProfiles : [],
              // Each faction's Leader role, by name, and the profiles of the
              // account that holds it: that faction's book is theirs (#3317).
              factionLeaderProfiles: (doc.factionLeaderProfiles && typeof doc.factionLeaderProfiles === 'object' &&
                                      !Array.isArray(doc.factionLeaderProfiles)) ? doc.factionLeaderProfiles : {},
              devRoleProfiles: Array.isArray(doc.devRoleProfiles) ? doc.devRoleProfiles : [],
              // The Free Skyrim Trading Company's role (#1393), for a
              // company sale. Without this line the door read a list it
              // never wrote.
              companyProfiles: Array.isArray(doc.companyProfiles) ? doc.companyProfiles : [],
              people: doc.people || [],
              // Staff bans with why and until (#412), from the site's own
              // file rather than Discord, so they are fresh even when the
              // lists above were kept. The staff block ends a banned session.
              bans: Array.isArray(doc.bans) ? doc.bans : [],
              // Characters staff have killed for good (#1010). The staff
              // block ends one quietly if it is in the world.
              pk: Array.isArray(doc.pk) ? doc.pk : [],
              at: new Date().toISOString(),
              note: 'Written by the gamemode from the site. Set enforce true to turn the door on.'
            }, null, 2));
            readAt = 0;                       // make the next tick re-read it
            listAt = Date.now();
            note('list refreshed from the site, ' + doc.profiles.length + ' profiles, ' +
                 (Array.isArray(doc.devProfiles) ? doc.devProfiles.length : 0) + ' dev, ' +
                 (Array.isArray(doc.adminProfiles) ? doc.adminProfiles.length : 0) + ' admin');
            /*
              The roles may have changed, so whoever keeps which character
              holds an office (the property block, #2551) reads them now: a
              role taken in Discord ends that character's office at once.
            */
            var heard = (typeof globalThis !== 'undefined') ? globalThis.__thornswoodRolesRead : null;
            if (typeof heard === 'function') {
              try { heard(); } catch (e) { note('the offices could not read the new roles: ' + e); }
            }
            tell(true);
          } catch (e) {
            note('could not write ' + FILE + ': ' + e);
            tell(false);
          }
        });
      });
      req.setTimeout(10000, function () { try { req.destroy(); } catch (e) { } });
      req.on('error', function (e) { note('could not reach the site: ' + e.message); tell(false); });
    } catch (e) { note('refresh failed: ' + e); tell(false); }
  }

  var g = (typeof globalThis !== 'undefined') ? globalThis : this;

  /*
    The list again, now, once (#2551): after a Jarl's office change in the
    game the site has set the role, and this reads it back so the office
    holds in the world at once rather than at the next five minute refresh.
    done hears whether the new list was written.
  */
  g.__thornswoodDoorReadNow = function (done) {
    try { refresh(done); } catch (e) { note('refresh threw: ' + e); if (typeof done === 'function') { done(false); } }
  };

  /*
    ASK THE SITE TO DO SOMETHING (#2551): a POST of JSON to the site the door
    names, with the door's key in the X-Thornswood-Key header, the way the
    list is fetched. The one thing asked today is a Jarl's office change
    (/api/office). done(why, doc): why is '' when the site answered with JSON,
    and otherwise says what went wrong in words; doc is the site's answer.
    Never retried: a change that did not go through is the Jarl's to press
    again, told why.
  */
  g.__thornswoodAskSite = function (route, body, done) {
    var finish = function (why, doc) { if (typeof done === 'function') { try { done(why, doc || null); } catch (e) { note('the site\'s answer to ' + route + ' threw: ' + e); } } };
    var conf = null;
    try { conf = JSON.parse(fs.readFileSync(path.join(privDir, 'door.json'), 'utf8').replace(/^\uFEFF/, '')); } catch (e) { conf = null; }
    if (!conf || !conf.site || !conf.key) { finish('this server has no door.json naming the site, so the site cannot be asked'); return; }
    var https;
    try { https = require('https'); } catch (e) { finish('this server cannot make a request'); return; }
    var data = JSON.stringify(body || {});
    var settled = false;
    var once = function (why, doc) { if (settled) { return; } settled = true; finish(why, doc); };
    try {
      var u = new URL(String(conf.site).replace(/\/+$/, '') + route);
      var req = https.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname, method: 'POST',
                                headers: { 'X-Thornswood-Key': String(conf.key), 'Content-Type': 'application/json',
                                           'Content-Length': Buffer.byteLength(data) } }, function (resp) {
        var buf = '';
        resp.on('data', function (d) { buf += d; });
        resp.on('end', function () {
          var doc = null;
          try { doc = JSON.parse(buf); } catch (e) { doc = null; }
          if (!doc) { note('the site answered ' + route + ' with something that is not JSON, ' + resp.statusCode); once('the site did not answer properly (' + resp.statusCode + ')'); return; }
          if (resp.statusCode !== 200) { note('the site refused ' + route + ', ' + resp.statusCode); once('the site refused the request (' + resp.statusCode + ')', doc); return; }
          once('', doc);
        });
      });
      req.setTimeout(15000, function () { try { req.destroy(); } catch (e) { } });
      req.on('error', function (e) { note('could not reach the site for ' + route + ': ' + e.message); once('the site could not be reached'); });
      req.end(data);
    } catch (e) { note('asking the site ' + route + ' failed: ' + e); once('the request could not be made'); }
  };

  if (g.__thornswoodDoorRefresh) { try { clearInterval(g.__thornswoodDoorRefresh); } catch (e) { } }
  g.__thornswoodDoorRefresh = setInterval(function () {
    try { refresh(); } catch (e) { note('refresh threw: ' + e); }
  }, 300000);
  try { refresh(); } catch (e) { }

  if (g.__thornswoodDoorTimer) { try { clearInterval(g.__thornswoodDoorTimer); } catch (e) { } }
  g.__thornswoodDoorTimer = setInterval(function () {
    try { tick(); } catch (e) { note('tick failed: ' + e); }
  }, 2000);

  var first = load();
  if (first) {
    console.log('[thornswood door] ' + (first.enforce ? 'ENFORCING' : 'watching only') +
                ', ' + first.count + ' profiles allowed');
  } else {
    console.log('[thornswood door] no ' + FILE + ', the door is off and anybody can connect');
  }
})();
// ==== end thornswood door ====

