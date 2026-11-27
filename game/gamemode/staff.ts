// ==== thornswood staff ====
/*
  WHAT A MODERATOR CAN DO IN THE WORLD. Issue #412, "A moderator has no powers
  in the game at all": a moderator watching somebody break a rule at midnight
  had nothing to press but a Discord role the game never read.

    /kick <person> [why]          ends their session, a few seconds after telling them
    /freeze <person> [why]        holds them where they stand, across a reconnect
    /unfreeze <person>            lets them go
    /bring <person>               moves them to you
    /goto <person>                moves you to them (/goto <place> is still the place teleport)
    /silence <person> [length] [why]   minutes or /ban's length forms; a day at most, 30 minutes unless said
    /unsilence <person>           lets them speak again
    /warn <person> <why>          tells them, in their chat, that staff have warned them
    /give <person> <item> [count]         puts it in their pack
    /spawn <creature> [count] on <person> and /spawnat <person> <creature> [count]
                                  puts it beside them
    /tp <person> <place or person>        sends them there

  The last three were asked for by Patrick on 28 September. They reuse the
  lookups /give, /spawn and /tp already have (every named item, every named
  actor, every town and named building, or a form id), handed in by handle().
  /give, /spawn and /tp that name no person are left to those branches, which
  is how a playtester's /give iron ore still works.

    /ban <person> <how long> <why>        this one character: 30m, 2h, 3d, 1w, or forever
    /unban <person>                       lifts the ban on this character
    /banaccount <person> <how long> <why> the whole Discord account: every character
                                          on it, and any new one
    /unbanaccount <person>                lifts the ban on the account
    /pk <person> <why>                    the character dies for good (#1010)
    /unpk <person or character> <why>     an admin undoes a PK made by mistake
    /note <person> <text>                 kept against them, for staff to read
    /hurt <person> [what]                 a wound, a disease or an agreed loss on
                                          them, for a scene or a yes given out of
                                          character, or what they carry (#1383;
                                          the injury and disease block says what)

  One character or the whole account, and PK, are Patrick's of 28 September
  (#1010). A PK is not a ban: the character can never be played or picked
  again, it is kept rather than deleted so staff can use it in events, the
  account can make a new character, and it is quiet: only the staff member
  and the person whose character it was are told, nobody else.

  /unpk is Patrick's of 29 September: the admin role only, never the other
  staff roles, with a reason. The dead character is not in the world, so the
  site finds it (a profile number, the start of its name, or its owner, by
  name or in the world). It comes back into a free slot on its account, and
  when every slot is taken the site says so and nothing changes. The PK
  stays on the site's record with the undo beside it.

  Bans and notes are kept on the site (Patrick, 28 September: "put the bans
  and notes on the site"), through its keyed /api/staff/game routes with the
  door's key, the way /report reaches it. The site leaves a banned person out
  of the door's list and sends the bans with why and until; the sweep below
  ends the session of anybody banned who is online, whenever the ban was
  made, and tells them both. A ban made here also ends their session at once.
  A person for these can be a profile number, so somebody who has left can
  still be banned or noted.

  A person is a name (the start of it is enough while it is unique), the form
  id the crosshair gives, or a profile number. Every one answers the moderator
  in their own chat, tells the person it was done to, writes one line to
  thornswood.log, and writes one line to for-bot/moderation.log, which the
  Discord bot reads and says in the staff channel (bot.py, watch_moderation),
  so there is a record outside the game that a hot reload cannot lose.

  WHO MAY. The staff roles: handle() passes isStaff, which is isDev, which is
  the site's access.dev roles (Owner, Dev, Gamemaster, Moderator, Loremaster)
  by way of devProfiles in allowed.json, plus the admins and the written
  thornswoodDevs list. Anybody else is told "That one is not yours to run."

  WHO IS ASKING, which is the part that makes this safe to ship. The profile id
  a command arrives under is what the voice relay says, and on its own that is
  a claim. So a staff command also needs both of:
    - proven: the voice service checked this connection's join token, and says
      so on every queued command (voice-server.js, commands.push);
    - the join pass (#937, #943): a valid pass for this profile, from an up to
      date launcher, is on hand right now. The site signs one only for the
      account that owns the character.
  Either missing and the command is refused with a sentence that says which.
  No fallback for a launcher or plugin that sends no pass: that is the
  standing rule, and here it is also the security one.
*/
(function () {
  'use strict';
  var g = globalThis;
  var fs = null, path = null, http = null;
  try { fs = require('fs'); path = require('path'); http = require('http'); } catch (e) { }

  var WORDS_STAFF = ['/kick', '/freeze', '/unfreeze', '/bring', '/goto',
                     '/silence', '/unsilence', '/warn', '/spawnat',
                     '/freezeaccount', '/unfreezeaccount', '/silenceaccount', '/unsilenceaccount',
                     '/ban', '/unban', '/note', '/banaccount', '/unbanaccount', '/pk', '/unpk',
                     '/hurt', '/despawn', '/craftstaff'];
  var DESPAWN_REACH = 1500;         // units: about 21 m, the creature beside or near you
  var BAN_SWEEP_MS = 10000;        // how often online people are checked against bans
  var SITE_WAIT_MS = 8000;
  // Everybody's (or a playtester's) words that staff can also aim at a person.
  var AIMED = ['/give', '/spawn', '/tp'];
  var GIVE_MOST = 100000;           // the same caps as /give and /spawn
  var SPAWN_MOST = 40;
  var SPAWN_AWAY = 150;             // units from the person, so it is beside them
  var REFUSED = 'That one is not yours to run.';
  // What a silenced person cannot say through the game server. Plain lines,
  // /me, /do, /w, /s and /ooc are held back by the voice service itself.
  var SILENCED_WORDS = ['/ooc', '/o', '/roll', '/r'];
  var KICK_AFTER_MS = 4000;         // long enough to read the line first
  var FREEZE_EVERY_MS = 1000;
  var FREEZE_SLACK = 64;            // units, a little under a metre
  var FREEZE_SAY_EVERY_MS = 30000;
  var SILENCE_DEFAULT_MIN = 30;
  var SILENCE_MAX_MIN = 24 * 60;
  var SILENCE_PUSH_MS = 30000;      // the voice service is told again this often

  // On globalThis, so a hot reload keeps who is frozen and who is silenced.
  if (!g.__thornswoodStaffState) { g.__thornswoodStaffState = { frozen: {}, silenced: {} }; }
  var state = g.__thornswoodStaffState;
  var restraintGeneration = (g.__thornswoodRestraintGeneration || 0) + 1;
  g.__thornswoodRestraintGeneration = restraintGeneration;
  var restraintFile = null;
  try {
    var restraintSettings = mp.getServerSettings();
    if (!object(restraintSettings) || (restraintSettings.privDir !== undefined &&
        (typeof restraintSettings.privDir !== 'string' || !restraintSettings.privDir))) { throw new Error('private folder settings are invalid'); }
    restraintFile = path.join(restraintSettings.privDir || 'private', 'staff-restraints.json');
  } catch (e) { log('staff restraints: could not establish the private folder: ' + e); }
  var restraintBytes = null, restraintRevision = 0, restraintWipes = [], restraintsReady = false;

  // One private authority. Runtime notice timestamps and ban overlays do not
  // belong in this book. A stale hot-reload closure cannot become its writer.
  function currentRestraints() { return g.__thornswoodRestraintGeneration === restraintGeneration; }
  function object(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function profileKey(k) { return /^[1-9][0-9]*$/.test(k) && Number.isSafeInteger(Number(k)); }
  function accountKey(k) { return typeof k === 'string' && /^[0-9]{1,32}$/.test(k); }
  function vector(v) { return Array.isArray(v) && v.length === 3 && v.every(function (n) { return typeof n === 'number' && Number.isFinite(n); }); }
  function anchor(v) {
    if (!object(v) || typeof v.desc !== 'string' || !v.desc || v.desc.length > 512 ||
        !vector(v.pos) || !vector(v.rot) || !Number.isSafeInteger(v.by) || v.by <= 0) {
      throw new Error('invalid freeze anchor');
    }
    var out = { desc: v.desc, pos: v.pos.slice(), rot: v.rot.slice(), by: v.by };
    if (v.pending !== undefined) {
      if (!object(v.pending) || typeof v.pending.desc !== 'string' || !v.pending.desc ||
          v.pending.desc.length > 512 || !vector(v.pending.pos) || !vector(v.pending.rot)) {
        throw new Error('invalid pending movement');
      }
      out.pending = { desc: v.pending.desc, pos: v.pending.pos.slice(), rot: v.pending.rot.slice() };
    }
    return out;
  }
  function restraintDocument(v) {
    if (!object(v) || (v.version !== 1 && v.version !== 2) || !Number.isSafeInteger(v.revision) || v.revision < 0 ||
        !object(v.frozen) || !object(v.silenced)) { throw new Error('invalid restraint book'); }
    var wipes = v.clearedWipes === undefined ? [] : v.clearedWipes;
    if (!Array.isArray(wipes) || wipes.some(function (id) { return typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id); }) ||
        new Set(wipes).size !== wipes.length) { throw new Error('invalid freeze-wipe receipts'); }
    var out = { version: v.version, revision: v.revision, frozen: {}, silenced: {}, clearedWipes: wipes.slice() };
    Object.keys(v.frozen).forEach(function (k) {
      if (!profileKey(k)) { throw new Error('invalid frozen profile'); }
      out.frozen[k] = anchor(v.frozen[k]);
    });
    Object.keys(v.silenced).forEach(function (k) {
      var s = v.silenced[k];
      if (!profileKey(k) || !object(s) || !Number.isSafeInteger(s.until) || s.until <= 0 ||
          !Number.isSafeInteger(s.by) || s.by <= 0) {
        throw new Error('invalid silence');
      }
      out.silenced[k] = { until: s.until, by: s.by };
    });
    if (v.version === 1 && (v.accountFrozen !== undefined || v.accountSilenced !== undefined)) throw new Error('account controls require version 2');
    if (v.version === 2) {
      if (!object(v.accountFrozen) || !object(v.accountSilenced)) throw new Error('invalid account control maps');
      out.accountFrozen = {}; out.accountSilenced = {};
      Object.keys(v.accountFrozen).forEach(function (account) {
        var row = v.accountFrozen[account];
        if (!accountKey(account) || !object(row) || !profileKey(String(row.profile))) throw new Error('invalid account freeze');
        out.accountFrozen[account] = { profile: Number(row.profile), anchor: anchor(row.anchor) };
      });
      Object.keys(v.accountSilenced).forEach(function (account) {
        var row = v.accountSilenced[account];
        if (!accountKey(account) || !object(row) || !profileKey(String(row.profile)) ||
            !Number.isSafeInteger(row.until) || row.until <= 0 || !Number.isSafeInteger(row.by) || row.by <= 0) throw new Error('invalid account silence');
        out.accountSilenced[account] = { profile: Number(row.profile), until: row.until, by: row.by };
      });
    }
    return out;
  }
  function restraintSnapshot(revision) {
    var doc = { version: 1, revision: revision, frozen: state.frozen, silenced: state.silenced, clearedWipes: restraintWipes };
    if (Object.keys(state.accountFrozen || {}).length || Object.keys(state.accountSilenced || {}).length) {
      doc.version = 2; doc.accountFrozen = state.accountFrozen; doc.accountSilenced = state.accountSilenced;
    }
    return doc;
  }
  function restraintUnavailable(why) {
    restraintsReady = false;
    log('staff restraints unavailable: ' + why + '. Repair the private book; new admissions and restraint changes are refused.');
  }
  function readRestraintBytes() {
    if (!restraintFile || !fs) { throw new Error('private restraint storage is unavailable'); }
    var bytes = fs.readFileSync(restraintFile);
    if (bytes.length > 4 * 1024 * 1024) { throw new Error('restraint book exceeds 4 MiB'); }
    var text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) { throw new Error('restraint book is not UTF-8'); }
    return text;
  }
  function encodeRestraints(doc) {
    var bytes = JSON.stringify(doc);
    if (Buffer.byteLength(bytes, 'utf8') > 4 * 1024 * 1024) { throw new Error('staged restraint book exceeds 4 MiB'); }
    return bytes;
  }
  function acceptRestraints(doc, bytes) {
    state.frozen = doc.frozen; state.silenced = doc.silenced;
    state.accountFrozen = doc.accountFrozen || {}; state.accountSilenced = doc.accountSilenced || {};
    restraintRevision = doc.revision; restraintBytes = bytes; restraintsReady = true;
    g.__thornswoodRestraintBookKnown = restraintFile;
    restraintWipes = doc.clearedWipes;
  }
  function loadRestraints() {
    if (!currentRestraints()) { return false; }
    try {
      var bytes;
      try { bytes = readRestraintBytes(); }
      catch (e) {
        if (!e || e.code !== 'ENOENT' || restraintBytes !== null || g.__thornswoodRestraintBookKnown === restraintFile) { throw e; }
        // First upgrade can carry real in-process restraints from the former
        // memory-only module. Validate them before their first durable save.
        var initial = restraintDocument({ version: 1, revision: 0, frozen: state.frozen, silenced: state.silenced });
        bytes = encodeRestraints(initial);
        fs.mkdirSync(path.dirname(restraintFile), { recursive: true });
        try { mp.writeFileWhole(restraintFile, bytes); }
        catch (writeError) { if (readRestraintBytes() !== bytes) { throw writeError; } }
        if (readRestraintBytes() !== bytes) { throw new Error('initial restraint book was not placed'); }
      }
      acceptRestraints(restraintDocument(JSON.parse(bytes)), bytes);
      return true;
    } catch (e) { restraintUnavailable(e); return false; }
  }
  function restraintReady() { return currentRestraints() && (restraintsReady || loadRestraints()); }
  function saveRestraints(change) {
    if (!restraintReady()) { return false; }
    try {
      if (readRestraintBytes() !== restraintBytes) { throw new Error('restraint book changed outside its current writer'); }
      var doc = restraintDocument(restraintSnapshot(restraintRevision + 1));
      change(doc);
      if (Object.keys(doc.accountFrozen || {}).length || Object.keys(doc.accountSilenced || {}).length) {
        doc.version = 2; doc.accountFrozen = doc.accountFrozen || {}; doc.accountSilenced = doc.accountSilenced || {};
      } else { doc.version = 1; delete doc.accountFrozen; delete doc.accountSilenced; }
      doc = restraintDocument(doc);
      var next = encodeRestraints(doc);
      var writeError = null;
      try { mp.writeFileWhole(restraintFile, next); } catch (e) { writeError = e; }
      var observed = readRestraintBytes();
      if (observed !== next) {
        if (observed !== restraintBytes) { restraintUnavailable('unrecognized write outcome'); }
        log('staff restraints: change was not committed: ' + (writeError || 'the requested bytes were not placed'));
        return false;
      }
      acceptRestraints(doc, next);
      return true;
    } catch (e) { restraintUnavailable(e); return false; }
  }
  function requireRestraintSave(pid, change) {
    if (saveRestraints(change)) { return true; }
    tell(pid, currentRestraints() ? 'The restraint change could not be saved. No success was recorded; staff must check the private restraint book.'
                                : 'The staff module was reloaded. Use the current command again.');
    return false;
  }
  loadRestraints();
  if (typeof g.__thornswoodRelease === 'function') {
    g.__thornswoodRelease('restraints', function (who) {
      if (!restraintReady()) { return { saved: false }; }
      var wipes = who.freezeWipeIds ? who.freezeWipeIds() : [];
      var unseen = wipes.filter(function (id) { return restraintWipes.indexOf(id) === -1; });
      var freezes = Object.keys(state.frozen).filter(function (pid) { return unseen.length || who.profile(pid); });
      var silences = Object.keys(state.silenced).filter(function (pid) { return who.profile(pid); });
      var accountFreezes = unseen.length ? Object.keys(state.accountFrozen) : [];
      var saved = true;
      if (freezes.length || silences.length || unseen.length || accountFreezes.length) {
        saved = saveRestraints(function (doc) {
          freezes.forEach(function (pid) { delete doc.frozen[pid]; });
          silences.forEach(function (pid) { delete doc.silenced[pid]; });
          accountFreezes.forEach(function (account) { delete doc.accountFrozen[account]; });
          doc.clearedWipes = doc.clearedWipes.concat(unseen);
        });
      }
      return { saved: saved, counts: { freezes: freezes.length + accountFreezes.length, silences: silences.length, wipes: unseen.length } };
    });
  }
  // Bans made here, until the door's next list carries them; and who is
  // already on their way out, so the sweep tells them once.
  if (!state.banned) { state.banned = {}; }
  var bansLoadedAt = Date.now();  // old hot-reload overlays have no acknowledgement time
  if (!state.ending) { state.ending = {}; }
  // Characters killed for good here (#1010), until the door's list carries them.
  if (!state.pk) { state.pk = {}; }
  // PKs an admin undid here, so the door's older list does not end them again.
  if (!state.unpk) { state.unpk = {}; }
  // Bans lifted here, so the door's list, which can carry a lifted ban for up
  // to its five minute refresh, does not end their session again meanwhile.
  if (!state.lifted) { state.lifted = {}; }
  migrateScopes(state.banned);
  migrateScopes(state.lifted);

  // Existing hot reloads can carry a single receipt or lift per character.
  function migrateScopes(records) {
    Object.keys(records).forEach(function (pid) {
      var record = records[pid];
      if (!record.scope && record.at === undefined && record.until === undefined) { return; }
      var scopes = {};
      scopes[record.scope || 'account'] = record;
      records[pid] = scopes;
    });
  }
  function recordScope(records, pid, scope, record) {
    if (!records[pid]) { records[pid] = {}; }
    records[pid][scope] = record;
  }
  function forgetScope(records, pid, scope) {
    var scopes = records[pid];
    if (!scopes) { return; }
    delete scopes[scope];
    if (!scopes.account && !scopes.character) { delete records[pid]; }
  }
  function pruneScopes(records, expired) {
    Object.keys(records).forEach(function (pid) {
      var scopes = records[pid];
      Object.keys(scopes).forEach(function (scope) {
        if (expired(scopes[scope])) { forgetScope(records, pid, scope); }
      });
    });
  }

  function settings() {
    try { return mp.getServerSettings() || {}; } catch (e) { return {}; }
  }
  function serverName() {
    return String(settings().thornswoodServer || '').trim().toLowerCase() || 'main';
  }
  /* In for-bot beside private, which the bot reads by a rule on the folder;
     private is SYSTEM's and Administrators' alone (#2321). */
  function recordFile() {
    if (!path) { return ''; }
    var s = settings();
    return path.join(String(s.forBotDir || path.join(path.dirname(String(s.privDir || 'private')), 'for-bot')), 'moderation.log');
  }

  function tell(pid, text) {
    var t = g.__thornswoodToProfile;
    if (t && pid) {
      try { t(pid, text); }
      catch (e) { log('staff: notification could not reach profile ' + pid + ': ' + e); }
    }
  }

  function online() {
    try { return mp.get(0, 'onlinePlayers') || []; } catch (e) { return []; }
  }
  function profileOf(actorId) {
    try { return Number(mp.get(actorId, 'profileId')) || 0; } catch (e) { return 0; }
  }
  function nameOf(actorId) {
    try {
      var ap = mp.get(actorId, 'appearance');
      var n = String((ap && ap.name) || '');
      if (n) { return n; }
    } catch (e) { }
    return 'somebody';
  }
  function actorFor(pid) {
    var all = online();
    for (var i = 0; i < all.length; i++) {
      if (profileOf(all[i]) === pid) { return all[i]; }
    }
    return 0;
  }

  /*
    Somebody, by what the moderator typed. A profile number first, because it
    is exact and works for somebody who has left (for /unsilence); then the
    social block's finder, the same one the friend and trade keys use (a form
    id, or a name or the start of one).
  */
  function find(want) {
    want = String(want || '').trim();
    if (!want) { return { actorId: 0, pid: 0, why: 'Who?' }; }
    if (/^\d{3,}$/.test(want)) {
      var n = Number(want);
      var a = actorFor(n);
      if (a) { return { actorId: a, pid: n, name: nameOf(a), why: '' }; }
    }
    var soc = g.__thornswoodSocial;
    var hit = (soc && soc.findPerson) ? soc.findPerson(want)
                                      : { actorId: 0, why: 'Nobody here by that name.' };
    if (hit && hit.actorId) {
      return { actorId: hit.actorId, pid: profileOf(hit.actorId), name: nameOf(hit.actorId), why: '' };
    }
    if (/^\d{3,}$/.test(want)) {
      return { actorId: 0, pid: Number(want), name: 'profile ' + want, why: 'Profile ' + want + ' is not in the world.' };
    }
    return { actorId: 0, pid: 0, why: (hit && hit.why) || 'Nobody here by that name.' };
  }

  /* The longest run of words from the front that names exactly one person,
     so "Bjorn Iron-Hand spamming" finds Bjorn Iron-Hand and leaves "spamming". */
  function takePerson(words) {
    var first = null;
    for (var n = words.length; n >= 1; n--) {
      var r = find(words.slice(0, n).join(' '));
      if (r.actorId) { r.rest = words.slice(n); return r; }
      if (n === 1) { first = r; }
    }
    first = first || { actorId: 0, pid: 0, why: 'Who?' };
    first.rest = words.slice(1);
    return first;
  }

  /*
    Whether the one asking has proved who they are, or the reason they have
    not. See WHO IS ASKING above.
  */
  function unproven(cmd, pid) {
    if (!cmd || cmd.proven !== true) {
      return 'Staff commands need the chat to have proved who you are, and this ' +
             'connection has not. Close the game, open the Thornswood launcher and ' +
             'press Play.';
    }
    var seen = g.__thornswoodPassSeen;
    var p = seen && seen.passes ? seen.passes[pid] : null;
    if (!p || !(Number(p.x) > Date.now())) {
      return 'Staff commands need your launcher\'s pass, and the server has none for ' +
             'you right now. Leave the Thornswood launcher open while you play; if it ' +
             'still says this in a minute, restart the game from the launcher.';
    }
    return '';
  }

  // Shared boundary for self-only playtest tools and admin utilities. These
  // roles are the command router's existing tiers, including explicit lists.
  // A profile in a message alone never authorizes an action on an actor.
  function authorizeTool(cmd, pid, actorId, tier) {
    if (['playtester','staff','admin'].indexOf(tier) === -1) { return REFUSED; }
    var proof = unproven(cmd,pid);
    if (proof) { return proof; }
    try {
      var roles = g.__thornswoodCommandRoles;
      if (!roles || typeof roles[tier] !== 'function' || !roles[tier](pid)) { return REFUSED; }
      if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(actorId) || actorId <= 0 ||
          online().indexOf(actorId) === -1 || Number(mp.get(actorId,'profileId')) !== pid) {
        return 'The command needs your own current character in the world.';
      }
    } catch (e) { return 'The command could not verify your current character and role.'; }
    return '';
  }

  /*
    One line in thornswood.log and one in moderation.log for the bot. extra,
    when given, is more of the same row: the property block's staff presses
    name the building and its hold (#2551).
  */
  function record(did, by, byName, who, whoName, why, minutes, extra) {
    log('staff: ' + byName + ' (profile ' + by + ') ' + did + ' ' + whoName +
        ' (profile ' + who + ')' + (minutes ? ' for ' + minutes + ' minutes' : '') +
        (why ? ': ' + why : ''));
    if (!fs) { return; }
    var row = { at: new Date().toISOString(), server: serverName(), did: did,
                by: by, byName: byName, who: who, whoName: whoName,
                why: String(why || '').slice(0, 300) };
    if (minutes) { row.minutes = minutes; }
    for (var k in (extra || {})) {
      if (Object.prototype.hasOwnProperty.call(extra, k) && !Object.prototype.hasOwnProperty.call(row, k)) { row[k] = extra[k]; }
    }
    try {
      fs.mkdirSync(path.dirname(recordFile()), { recursive: true });
      fs.appendFileSync(recordFile(), JSON.stringify(row) + '\n');
    } catch (e) {
      log('staff: could not write ' + recordFile() + ', so the staff channel will not hear of it: ' + e);
    }
  }

  function placeOf(actorId) {
    try {
      var desc = mp.get(actorId, 'worldOrCellDesc'), pos = mp.get(actorId, 'pos'), rot = mp.get(actorId, 'angle');
      if (typeof desc !== 'string' || !desc || !vector(pos) || !vector(rot)) { return null; }
      return { desc: desc, pos: pos.slice(), rot: rot.slice() };
    } catch (e) { return null; }
  }
  function moveTo(actorId, where) {
    mp.set(actorId, 'locationalData', { cellOrWorldDesc: where.desc, pos: where.pos, rot: where.rot });
    var stuck = g.__thornswoodStuck;
    if (stuck && stuck.resetTrail) { stuck.resetTrail(actorId); }
  }

  function movementIdentity(pid, actor) {
    var native = mp.getNpcAIState(actor), runtime = mp.getActorRuntimeIdentity(actor), user = mp.getUserByActor(actor);
    if (!native || native.profileId !== pid || native.isHuman !== true || native.isConnected !== true ||
        !Number.isSafeInteger(native.lifeGeneration) || native.lifeGeneration < 0 ||
        typeof runtime !== 'string' || !/^[1-9][0-9]{0,19}$/.test(runtime) || !Number.isInteger(user) || user < 0 ||
        profileOf(actor) !== pid || online().indexOf(actor) < 0) { throw new Error('character identity changed'); }
    var guid = mp.getUserGuid(user);
    if (typeof guid !== 'string' || !guid) { throw new Error('connection identity unavailable'); }
    return { actor: actor, pid: pid, runtime: runtime, life: native.lifeGeneration, user: user, guid: guid };
  }
  function sameMovementIdentity(who) {
    try {
      var now = movementIdentity(who.pid, who.actor);
      return now.runtime === who.runtime && now.life === who.life && now.user === who.user && now.guid === who.guid;
    } catch (e) { return false; }
  }
  function holdPendingMovement(who, caller) {
    var release = accountFreeze(who.pid) ? '/unfreezeaccount ' + who.pid + (state.frozen[who.pid] ? ' and /unfreeze ' + who.pid : '') : '/unfreeze ' + who.pid;
    tell(caller, 'Movement may already have occurred, but its frozen position could not be confirmed and saved. The character is held out until staff check the problem and explicitly ' + release + '.');
    log('staff restraints: profile ' + who.pid + ' has pending movement; no teleport retry or rollback was requested');
    var sentence = 'A staff move could not be confirmed and saved. Staff must resolve your frozen character before you return.';
    if (!sameMovementIdentity(who)) { return; }
    try { sessionEnds(who.pid, sentence); } catch (e) { log('staff restraints: pending-move session notice failed: ' + e); }
    // The notice can call transport code. Recheck the entire connection/life
    // immediately before ending it; never act on a replacement character.
    if (sameMovementIdentity(who)) {
      try { mp.kick(who.user); } catch (e) { log('staff restraints: could not end pending-move connection: ' + e); }
    }
  }
  function samePlace(a, b) {
    return a && b && a.desc === b.desc && a.pos.every(function (n, i) { return n === b.pos[i]; }) &&
      a.rot.every(function (n, i) { return n === b.rot[i]; });
  }
  function moveStaffPerson(mover, movedPid, dest, caller) {
    var frozen, who;
    if (!currentRestraints()) { tell(caller, 'The staff module was reloaded. Use the current command again.'); return false; }
    if (!restraintReady()) { tell(caller, 'Staff restraint authority is unavailable. No movement was requested.'); return false; }
    frozen = frozenFor(movedPid);
    if (frozen) {
      if (frozen.pending) { tell(caller, 'That frozen character already has unresolved movement. Check the problem and explicitly /unfreeze ' + movedPid + '.'); return false; }
      try { who = movementIdentity(movedPid, mover); }
      catch (e) { tell(caller, 'The server could not verify that character. No movement was requested.'); return false; }
      if (!requireRestraintSave(caller, function (doc) {
        frozenAnchors(movedPid, doc).forEach(function (value) {
          value.pending = { desc: dest.desc, pos: dest.pos.slice(), rot: dest.rot.slice() };
        });
      })) { return false; }
      if (!sameMovementIdentity(who)) { holdPendingMovement(who, caller); return false; }
    }
    try { mp.set(mover, 'locationalData', { cellOrWorldDesc: dest.desc, pos: dest.pos, rot: dest.rot }); }
    catch (e) { log('staff: native movement returned an error; checking the actual location: ' + e); }
    var observed = placeOf(mover);
    if (frozen) {
      if (!observed || !sameMovementIdentity(who) || !saveRestraints(function (doc) {
        frozenAnchors(movedPid, doc).forEach(function (value) {
          value.desc = observed.desc; value.pos = observed.pos.slice(); value.rot = observed.rot.slice(); delete value.pending;
        });
      })) { holdPendingMovement(who, caller); return false; }
    }
    if (!samePlace(observed, dest)) {
      tell(caller, 'The requested destination was not confirmed. No successful move was recorded.'); return false;
    }
    // A post-move trail publication failure cannot turn a confirmed move and
    // saved anchor into an apparent refusal that invites duplicate movement.
    try {
      var stuck = g.__thornswoodStuck;
      if (stuck && stuck.resetTrail) { stuck.resetTrail(mover); }
    } catch (e) { log('staff: confirmed movement could not reset the stuck trail: ' + e); }
    return true;
  }

  // ------------------------------------------------------------ silence --
  function accountOnRecord(pid) {
    try { var value = g.__thornswoodAccountOf && g.__thornswoodAccountOf(pid); return accountKey(value) ? value : ''; }
    catch (e) { return ''; }
  }
  function verifiedAccount(pid) {
    var jp = g.__thornswoodJoinPass, seen = g.__thornswoodPassSeen;
    try {
      var pass = seen && seen.passes && seen.passes[pid];
      return jp && jp.proven(pid, Date.now()) && pass && accountKey(pass.d) ? pass.d : '';
    } catch (e) { return ''; }
  }
  function identityAccount(pid) { return verifiedAccount(pid) || accountOnRecord(pid); }
  function accountFreeze(pid, doc) {
    var account = identityAccount(pid), entries = (doc || state).accountFrozen || {};
    var row = account && entries[account];
    return row && row.profile === Number(pid) ? row.anchor : null;
  }
  function frozenFor(pid) { return accountFreeze(pid) || state.frozen[pid] || null; }
  function frozenAnchors(pid, doc) {
    var values = [], character = doc.frozen[pid], account = accountFreeze(pid, doc);
    if (character) values.push(character);
    if (account) values.push(account);
    return values;
  }
  function accountFreezesActive() { return Object.keys(state.accountFrozen || {}).length > 0; }
  function restraintAdmission(pid, account, beforeProof) {
    if (!restraintReady() || (state.frozen[pid] && state.frozen[pid].pending)) return false;
    if (beforeProof || !accountFreezesActive()) return true;
    var owner = account === undefined ? identityAccount(pid) : account;
    if (!accountKey(owner)) return false;
    var row = state.accountFrozen[owner];
    return !row || (row.profile === Number(pid) && !row.anchor.pending);
  }
  function silencedFor(pid) {
    var now = Date.now(), s = state.silenced[pid], until = s ? s.until : 0;
    var account = identityAccount(pid), entries = state.accountSilenced || {};
    if (account && entries[account]) until = Math.max(until, entries[account].until);
    if (!account) Object.keys(entries).forEach(function (key) { until = Math.max(until, entries[key].until); });
    return until > now ? Math.max(1, Math.ceil((until - now) / 60000)) : 0;
  }
  var accountVoiceAt = 0, accountVoiceReady = false;
  function accountModeReady() {
    return settings().thornswoodAccountRestraints === true && accountVoiceReady &&
      Date.now() - accountVoiceAt <= SILENCE_PUSH_MS * 2 &&
      online().every(function (actor) { return !!verifiedAccount(profileOf(actor)); });
  }

  function accountCommand(word, words, pid, me) {
    var clearing = word === '/unfreezeaccount' || word === '/unsilenceaccount';
    var freezing = word === '/freezeaccount' || word === '/unfreezeaccount';
    var explicit = clearing && /^account:[0-9]{1,32}$/.test(words[0] || '');
    var them = explicit ? { pid: 0, name: 'Account', rest: words.slice(1) } : takePerson(words);
    var mine = verifiedAccount(pid), owner = explicit ? words[0].slice(8) :
      (them.actorId ? verifiedAccount(them.pid) : accountOnRecord(them.pid));
    if (!mine || !owner) { tell(pid, 'A verified account identity is unavailable. Nothing changed.'); return true; }
    if (mine === owner) { tell(pid, 'You cannot change a restraint on your account.'); return true; }
    var entries = freezing ? state.accountFrozen : state.accountSilenced;
    var previous = entries[owner];
    if (!clearing && !accountModeReady()) { tell(pid, 'Account restraint mode is unavailable or not ready. Nothing changed.'); return true; }
    if (clearing && !previous) { tell(pid, 'That account has no ' + (freezing ? 'freeze' : 'silence') + '.'); return true; }
    var value, mins = SILENCE_DEFAULT_MIN, reason = (them.rest || []).join(' ').trim();
    if (!clearing && freezing) {
      if (!them.actorId) { tell(pid, 'The original character must be online to freeze its account.'); return true; }
      if (previous && (previous.profile !== them.pid || previous.anchor.pending)) {
        tell(pid, 'Release the existing account freeze before changing its original character or unresolved movement.'); return true;
      }
      var spot = placeOf(them.actorId);
      if (!spot) { tell(pid, 'The original character position is unavailable. Nothing changed.'); return true; }
      spot.by = pid; value = { profile: them.pid, anchor: spot };
    } else if (!clearing) {
      var rest = them.rest || [];
      if (rest.length) {
        var length = banLength(rest[0]);
        if (length > 0 && Number.isFinite(length)) { mins = Math.min(SILENCE_MAX_MIN, length); reason = rest.slice(1).join(' ').trim(); }
        else if (/^[+-]?(?:\d|\.)/.test(rest[0]) || length === 0) {
          tell(pid, 'That silence length is not valid. Nothing changed.'); return true;
        }
      }
      value = { profile: them.pid, until: Date.now() + mins * 60000, by: pid };
    }
    if (!freezing) {
      var accounts = {}, profiles = {};
      Object.keys(state.accountSilenced).forEach(function (key) { accounts[key] = state.accountSilenced[key].until; });
      Object.keys(state.silenced).forEach(function (key) { profiles[key] = state.silenced[key].until; });
      if (clearing) delete accounts[owner]; else accounts[owner] = value.until;
      if (Buffer.byteLength(JSON.stringify({ profiles: profiles, accountProtocol: 1, accountRevision: restraintRevision + 1, accounts: accounts })) > 20000) {
        tell(pid, 'The voice restraint list is full. Nothing changed.'); return true;
      }
    }
    if (!requireRestraintSave(pid, function (doc) {
      if (!doc.accountFrozen) doc.accountFrozen = {};
      if (!doc.accountSilenced) doc.accountSilenced = {};
      var target = freezing ? doc.accountFrozen : doc.accountSilenced;
      if (clearing) delete target[owner]; else target[owner] = value;
    })) return true;
    function completed(ok) {
      if (!ok) {
        tell(pid, 'The account silence change was saved; voice confirmation is pending. Do not repeat the command.');
        record(word.slice(1) + 'pending', pid, me, them.pid || previous.profile, them.name, reason, clearing ? 0 : mins);
        return;
      }
      var remains = them.pid && (freezing ? frozenFor(them.pid) : silencedFor(them.pid));
      tell(pid, clearing ? ('Account ' + (freezing ? 'freeze' : 'silence') + ' lifted.' + (remains ? ' The character restraint still applies.' : '')) :
        (freezing ? 'Froze ' + them.name + "'s account. Other characters on it cannot enter." : 'Silenced ' + them.name + "'s account for " + mins + ' minutes.'));
      record(word.slice(1), pid, me, them.pid || previous.profile, them.name, reason, freezing || clearing ? 0 : mins);
      online().forEach(function (actor) {
        var target = profileOf(actor);
        if (identityAccount(target) !== owner) return;
        var held = freezing ? frozenFor(target) : silencedFor(target);
        tell(target, clearing ? ('Staff lifted the account ' + (freezing ? 'freeze' : 'silence') +
          (held ? '; your character restraint still applies.' : '.')) :
          (freezing ? 'Staff froze your account. This character stays here; your other characters cannot enter.' :
            'Staff silenced your account for ' + mins + ' minutes. Voice and speech stop across your characters.'));
      });
    }
    if (freezing) { completed(true); freezeTick(); } else pushSilenced(completed);
    return true;
  }

  /* The whole list to the voice service, which holds back their lines. */
  function pushSilenced(confirmed) {
    var finished = false;
    function finish(ok) { if (finished) return; finished = true; if (confirmed) confirmed(ok); }
    if (!http || !restraintReady()) { finish(false); return; }
    var now = Date.now();
    var list = {};
    var expired = Object.keys(state.silenced).filter(function (k) { return state.silenced[k].until <= now; });
    var expiredAccounts = Object.keys(state.accountSilenced || {}).filter(function (k) { return state.accountSilenced[k].until <= now; });
    if (expired.length || expiredAccounts.length) {
      saveRestraints(function (doc) {
        expired.forEach(function (k) { delete doc.silenced[k]; });
        expiredAccounts.forEach(function (k) { delete doc.accountSilenced[k]; });
      });
      // Pruning can discover a changed or unreadable book. Keep voice's last
      // confirmed list until the private authority can be read again.
      if (!restraintsReady) { finish(false); return; }
    }
    for (var k in state.silenced) {
      if (!Object.prototype.hasOwnProperty.call(state.silenced, k)) { continue; }
      if (state.silenced[k].until > now) { list[k] = state.silenced[k].until; }
    }
    var accounts = {};
    Object.keys(state.accountSilenced || {}).forEach(function (key) { accounts[key] = state.accountSilenced[key].until; });
    var revision = restraintRevision;
    var body = JSON.stringify({ profiles: list, accountProtocol: 1, accountRevision: revision, accounts: accounts });
    if (Buffer.byteLength(body) > 20000) { accountVoiceReady = false; finish(false); return; }
    try {
      var req = http.request({
        host: '127.0.0.1', port: voicePort(), path: '/silenced', method: 'POST', timeout: 2000,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
      }, function (res) {
        var reply = '', size = 0;
        if (res.statusCode !== 200) { accountVoiceReady = false; try { res.resume(); } catch (e) { } finish(false); return; }
        res.on('data', function (chunk) { size += chunk.length; if (size <= 4096) reply += chunk; });
        res.on('end', function () {
          if (!currentRestraints()) { finish(false); return; }
          var value = null; try { value = JSON.parse(reply); } catch (e) { }
          var applied = size <= 4096 && value && value.accountProtocol === 1 && value.accountRevision === revision;
          accountVoiceReady = applied && value.accountReady === true;
          if (accountVoiceReady) accountVoiceAt = Date.now();
          finish(!!applied && restraintRevision === revision);
        });
        res.on('error', function () { accountVoiceReady = false; finish(false); });
      });
      req.on('error', function () { accountVoiceReady = false; finish(false); });
      req.on('timeout', function () { accountVoiceReady = false; finish(false); req.destroy(); });
      req.end(body);
    } catch (e) { accountVoiceReady = false; finish(false); }
  }

  // ------------------------------------------------------------- freeze --
  /* Anybody frozen who has moved is put back. Kept by profile, so leaving and
     coming back does not undo it. */
  function freezeTick() {
    if (!currentRestraints()) { return; }
    var now = Date.now();
    var players = online();
    for (var i = 0; i < players.length; i++) {
      var a = players[i], k = profileOf(a), account = identityAccount(k);
      var scope = account && (state.accountFrozen || {})[account];
      if (accountFreezesActive() && (!account || (scope && scope.profile !== k))) {
        var who;
        try { who = movementIdentity(k, a); } catch (e) { continue; }
        var sentence = 'An account freeze prevents this character from entering. Staff must release the account.';
        tell(k, sentence);
        if (!sameMovementIdentity(who)) continue;
        try { sessionEnds(k, sentence); } catch (e) { log('staff restraints: account-freeze session notice failed'); }
        if (sameMovementIdentity(who)) { try { mp.kick(who.user); } catch (e) { } }
        continue;
      }
      var f = frozenFor(k);
      if (!f) continue;
      if (f.pending) { continue; }
      var here = placeOf(a);
      if (!here) { continue; }
      var dx = here.pos[0] - f.pos[0], dy = here.pos[1] - f.pos[1], dz = here.pos[2] - f.pos[2];
      if (here.desc === f.desc && dx * dx + dy * dy + dz * dz <= FREEZE_SLACK * FREEZE_SLACK) { continue; }
      try { moveTo(a, f); } catch (e) { continue; }
      if (!f.saidAt || now - f.saidAt >= FREEZE_SAY_EVERY_MS) {
        f.saidAt = now;
        tell(Number(k), 'Staff have you frozen in place. Wait here and somebody will talk to you.');
      }
    }
  }

  // ---------------------------------------- give, spawn and tp at a person --
  /* A count as the last word, only when it is a number with something before it. */
  function countOff(words) {
    if (words.length > 1 && /^\d+$/.test(words[words.length - 1])) {
      return { words: words.slice(0, words.length - 1), count: Number(words[words.length - 1]) };
    }
    return { words: words, count: 1 };
  }
  function lower(ws) { return ws.join(' ').trim().toLowerCase(); }
  /* keep as the last word: the spawn stays for good (#2623). */
  function keepOff(words) {
    if (words.length && String(words[words.length - 1]).toLowerCase() === 'keep') {
      return { words: words.slice(0, words.length - 1), keep: true };
    }
    return { words: words, keep: false };
  }

  /*
    What an aimed line asks for, or null when it names no person, which leaves
    it to handle(): "/give iron ore" is a playtester's own /give, "/tp whiterun"
    their own /tp.
  */
  function aimed(word, words) {
    if (word === '/give' || word === '/spawnat') {
      var p = takePerson(words);
      if (!p.actorId || !p.rest.length) { return word === '/spawnat' ? { kind: 'spawn', them: p, want: '' } : null; }
      var k = word === '/spawnat' ? keepOff(p.rest) : { words: p.rest, keep: false };
      var c = countOff(k.words);
      return { kind: word === '/give' ? 'give' : 'spawn', them: p, want: lower(c.words), count: c.count, keep: k.keep };
    }
    if (word === '/spawn') {
      // keep may close the line ("/spawn wolf 3 on Bob keep") or the part
      // before on ("/spawn wolf 3 keep on Bob").
      var kEnd = keepOff(words);
      words = kEnd.words;
      var at = -1;
      for (var i = words.length - 2; i >= 1; i--) {
        if (String(words[i]).toLowerCase() === 'on') { at = i; break; }
      }
      if (at < 0) { return null; }
      var who = takePerson(words.slice(at + 1));
      if (!who.actorId) { return null; }
      var kLeft = keepOff(words.slice(0, at));
      var left = countOff(kLeft.words);
      var n = left.count;
      if (who.rest.length === 1 && /^\d+$/.test(who.rest[0])) { n = Number(who.rest[0]); }
      else if (who.rest.length) { return null; }
      return { kind: 'spawn', them: who, want: lower(left.words), count: n, keep: kEnd.keep || kLeft.keep };
    }
    if (word === '/tp') {
      var t = takePerson(words);
      if (!t.actorId || !t.rest.length) { return null; }
      return { kind: 'tp', them: t, to: t.rest };
    }
    return null;
  }

  /* Places a creature beside where, spread round them. The new reference from
     mp.place(base) and then a locationalData move, because createActor's first
     argument is the id the NEW actor gets, not the record to make it from. */
  function spawnBeside(baseId, where, count, keep) {
    // The one placing /spawn uses too, so a fix to it reaches both (#959).
    return placeActors(baseId, where, count, SPAWN_AWAY, true, keep);
  }

  function doAimed(a, pid, actorId, me, look) {
    var them = a.them;
    if (!them.actorId) { tell(pid, them.why); return true; }
    if (a.kind === 'tp' && them.pid === pid && frozenFor(pid)) {
      tell(pid, 'Staff have you frozen in place, so you cannot teleport yourself. Ask another staff member to move or release you.');
      return true;
    }

    if (a.kind === 'give') {
      var hit = look.findThing(a.want);
      if (!hit.desc && look.byFormId) { hit = look.byFormId(a.want) || hit; }
      if (!hit.desc) { tell(pid, hit.why); return true; }
      var n = Math.min(a.count, GIVE_MOST);
      if (!addItem(them.actorId, hit.desc, n)) {
        tell(pid, hit.name + ' is named in this server\'s tables but its plugin is not in the load order, so there is nothing to give.');
        return true;
      }
      tell(pid, 'Gave ' + them.name + ' ' + n + ' ' + hit.name + '.');
      if (them.pid !== pid) { tell(them.pid, 'Staff gave you ' + n + ' ' + hit.name + '.'); }
      record('give', pid, me, them.pid, them.name, n + ' ' + hit.name, 0);
      return true;
    }

    if (a.kind === 'spawn') {
      if (!a.want) {
        tell(pid, 'Spawn what? /spawnat ' + them.name + ' troll, or /spawn troll 3 on ' + them.name + '.');
        return true;
      }
      var beast = look.findBeast(a.want);
      if (!beast.desc && look.byFormId) { beast = look.byFormId(a.want) || beast; }
      if (!beast.desc) { tell(pid, beast.why); return true; }
      var baseId = idOf(beast.desc);
      if (!baseId) { tell(pid, beast.name + '\'s plugin is not in this load order.'); return true; }
      var spot = placeOf(them.actorId);
      if (!spot || !spot.desc) { tell(pid, 'The server cannot tell where ' + them.name + ' is right now. Try again.'); return true; }
      var r = spawnBeside(baseId, spot, Math.min(a.count, SPAWN_MOST), a.keep === true);
      if (!r.made) {
        tell(pid, 'Nothing was spawned beside ' + them.name + ': ' + (r.why || 'the server would not place it') + '.');
        log('staff: spawning ' + beast.name + ' beside ' + them.name + ' failed: ' + r.why);
        return true;
      }
      tell(pid, 'Spawned ' + r.made + ' ' + beast.name + ' beside ' + them.name + '.' +
        (a.keep ? ' Kept: it stays, and comes back after it dies.'
                : ' Temporary: when it dies its body lies the usual time, then it is gone, and a restart takes it too. Add keep to make one stay.'));
      if (them.pid !== pid) { tell(them.pid, 'Staff put ' + r.made + ' ' + beast.name + ' beside you.'); }
      record('spawn', pid, me, them.pid, them.name, r.made + ' ' + beast.name, 0);
      return true;
    }

    // tp: another person first, then /tp's own places.
    var dp = takePerson(a.to);
    var dest = null, destName = '';
    if (dp.actorId && !dp.rest.length) {
      dest = placeOf(dp.actorId);
      destName = dp.name;
    } else {
      var fp = look.findPlace(lower(a.to));
      if (!fp.where) { tell(pid, fp.why); return true; }
      dest = { desc: fp.where.desc, pos: fp.where.pos, rot: fp.where.rot || [0, 0, 0] };
      destName = fp.where.town;
    }
    if (!dest || !dest.desc) { tell(pid, 'The server cannot tell where that is right now. Try again.'); return true; }
    if (!moveStaffPerson(them.actorId, them.pid, dest, pid)) { return true; }
    tell(pid, 'Sent ' + them.name + ' to ' + destName + '.');
    if (them.pid !== pid) { tell(them.pid, 'Staff sent you to ' + destName + '.'); }
    record('tp', pid, me, them.pid, them.name, 'to ' + destName, 0);
    return true;
  }

  // ------------------------------------------------------ bans and notes --
  /*
    One keyed call to the site's /api/staff/game/<what>. done(true, answer)
    on a 200, done(false, why, answer) for anything else, once; the answer
    is null when there was none, and its message, when there is one, is a
    sentence for the staff member (/unpk's). The key goes in a
    header and never the address, like the door's own fetch; door.json names
    the site with /dev on the end on the dev server.
  */
  function siteCall(what, row, done) {
    var once = false;
    function end(ok, v, j) { if (!once) { once = true; done(ok, v, j || null); } }
    var conf = null;
    try {
      conf = JSON.parse(fs.readFileSync(path.join(String(settings().privDir || 'private'), 'door.json'), 'utf8')
                          .replace(/^\uFEFF/, ''));
    } catch (e) { conf = null; }
    if (!conf || !conf.site || !conf.key) { end(false, 'this server has no door.json naming the site'); return; }
    var url;
    try { url = new URL(String(conf.site).replace(/\/+$/, '') + '/api/staff/game/' + what); }
    catch (e) { end(false, 'the site address in door.json is not an address'); return; }
    var lib;
    try { lib = require(url.protocol === 'http:' ? 'http' : 'https'); } catch (e) { end(false, 'no ' + url.protocol); return; }
    var body = JSON.stringify(row);
    var req;
    try {
      req = lib.request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
                   'X-Thornswood-Key': String(conf.key) }
      }, function (resp) {
        var buf = '';
        resp.on('data', function (d) { buf += d; });
        resp.on('end', function () {
          var j = null;
          try { j = JSON.parse(buf); } catch (e) { j = null; }
          if (resp.statusCode === 200 && j && j.ok) { end(true, j); return; }
          end(false, 'the site answered ' + resp.statusCode + (j && j.error ? ' (' + j.error + ')' : ''), j);
        });
      });
    } catch (e) { end(false, String((e && e.message) || e)); return; }
    req.on('error', function (e) { end(false, String((e && e.message) || e)); });
    try { req.setTimeout(SITE_WAIT_MS, function () { req.destroy(); end(false, 'the site took too long'); }); } catch (e) { }
    req.end(body);
  }

  /* "30m", "2h", "3d", "1w", a bare number of minutes, or "forever": minutes,
     0 for good, or -1 when it is none of those. */
  function banLength(word) {
    var w = String(word || '').toLowerCase();
    if (w === 'forever' || w === 'perm' || w === 'permanent' || w === 'permanently') { return 0; }
    var m = /^(\d+)(m|min|mins|h|hr|hrs|d|day|days|w|wk|wks)?$/.exec(w);
    if (!m || !(Number(m[1]) > 0)) { return -1; }
    var u = (m[2] || 'm').charAt(0);
    return Number(m[1]) * (u === 'h' ? 60 : u === 'd' ? 1440 : u === 'w' ? 10080 : 1);
  }
  function untilText(until) {
    if (!(Number(until) > 0)) { return 'for good'; }
    return 'until ' + new Date(Number(until)).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }

  /* Every active ban the door's last list carried, and the ones made here since. */
  // Once the site has taken over, a transient missing file during hot reload
  // cannot erase its last confirmed bans either.
  var confirmedBans = state.confirmedBans || (state.confirmedBans = { list: [], requestedAt: 0 });
  var bansRead = { at: 0, list: confirmedBans.list, pk: [], banAt: confirmedBans.requestedAt };
  function readDoor(now) {
    if (now - bansRead.at < BAN_SWEEP_MS) { return; }
    bansRead.at = now;
    var list = null, pk = [], written = 0, bansRequested = 0, hasBanStamp = false;
    try {
      var doc = JSON.parse(fs.readFileSync(path.join(String(settings().privDir || 'private'), 'allowed.json'), 'utf8')
                             .replace(/^\uFEFF/, ''));
      if (doc && Array.isArray(doc.bans) && doc.bans.every(function (ban) { return ban && Array.isArray(ban.profiles); })) {
        list = doc.bans;
      }
      if (doc && Array.isArray(doc.pk)) { pk = doc.pk; }
      written = Date.parse(String((doc && doc.at) || '')) || 0;
      if (list) {
        hasBanStamp = !!doc.bansRequestedAt;
        bansRequested = Date.parse(String(doc.bansRequestedAt || '')) || 0;
      }
    } catch (e) { list = null; pk = []; }
    bansRead.pk = pk;
    bansRead.written = written;
    // The site's confirmed newer request now owns these bans, including a
    // lift made on the site. A late older request or unreadable list does not.
    if (list && bansRequested > confirmedBans.requestedAt && bansRequested <= written && written <= now) {
      bansRead.list = confirmedBans.list = list;
      bansRead.banAt = confirmedBans.requestedAt = bansRequested;
      pruneScopes(state.banned, function (ban) {
        return bansRequested > (Number(ban.at) || bansLoadedAt);
      });
    } else if (list && !hasBanStamp && !confirmedBans.requestedAt) {
      // Read old door files until the first confirmed snapshot arrives. A
      // broken file cannot erase the last known list or its ban-specific time.
      bansRead.list = list;
      bansRead.banAt = written;
    }
    // A lift the door's ban list has caught up with needs remembering no longer.
    pruneScopes(state.lifted, function (lift) { return bansRead.banAt > lift.at; });
    // The same for a PK made or undone here: once the list is newer it says
    // which holds, so a PK an admin undid on the site stops counting here too.
    for (var p in state.pk) {
      if (Object.prototype.hasOwnProperty.call(state.pk, p) && written > (Number(state.pk[p].at) || 0)) { delete state.pk[p]; }
    }
    for (var u in state.unpk) {
      if (Object.prototype.hasOwnProperty.call(state.unpk, u) && written > state.unpk[u].at) { delete state.unpk[u]; }
    }
  }
  /* Every character killed for good (#1010): the door's list and this server's own. */
  function pkNow(now) {
    readDoor(now);
    var out = {};
    for (var i = 0; i < bansRead.pk.length; i++) {
      var d = Number(bansRead.pk[i]);
      if (d > 0 && !(state.unpk[d] && state.unpk[d].at >= (bansRead.written || 0))) { out[d] = true; }
    }
    for (var k in state.pk) {
      if (Object.prototype.hasOwnProperty.call(state.pk, k)) { out[Number(k)] = true; }
    }
    return out;
  }
  // Account bans govern the whole account. Within one kind, keep the
  // longest active ban; a permanent ban outlasts every timed one.
  function preferredBan(have, next) {
    if (!have) { return next; }
    var account = (have.scope || 'account') === 'account';
    var nextAccount = (next.scope || 'account') === 'account';
    if (account !== nextAccount) { return nextAccount ? next : have; }
    var until = Number(have.until) || 0;
    var nextUntil = Number(next.until) || 0;
    if (until && (!nextUntil || nextUntil > until)) { return next; }
    return have;
  }
  function bansNow(now) {
    readDoor(now);
    var out = {};
    for (var i = 0; i < bansRead.list.length; i++) {
      var b = bansRead.list[i] || {};
      var until = Number(b.until) || 0;
      if (until && until <= now) { continue; }
      var ps = Array.isArray(b.profiles) ? b.profiles : [];
      var scope = String(b.scope || 'account');
      for (var j = 0; j < ps.length; j++) {
        var p = Number(ps[j]);
        if (!(p > 0)) { continue; }
        var lifts = state.lifted[p];
        var lift = lifts && lifts[scope];
        if (lift && lift.at >= bansRead.banAt) { continue; }
        out[p] = preferredBan(out[p], { why: String(b.why || ''), until: until, scope: scope });
      }
    }
    pruneScopes(state.banned, function (ban) { return ban.until && ban.until <= now; });
    Object.keys(state.banned).forEach(function (pid) {
      var scopes = state.banned[pid];
      Object.keys(scopes).forEach(function (scope) {
        out[pid] = preferredBan(out[pid], scopes[scope]);
      });
    });
    return out;
  }

  /* Tell them why and until when, then end the session a few seconds later. */
  function endBanned(pid, actorId, ban, now) {
    if (state.ending[pid] && now - state.ending[pid] < 60000) { return; }
    state.ending[pid] = now;
    var told;
    if (ban.scope === 'character') {
      told = 'Staff have banned this character ' + untilText(ban.until) +
             (ban.why ? ': ' + ban.why : '') + '. Your session is being ended. ' +
             'You can still play your other characters.';
    } else {
      told = 'You are banned from Thornswood ' + untilText(ban.until) +
             (ban.why ? ': ' + ban.why : '') + '. Your session is being ended.';
    }
    tell(pid, told);
    log('staff: ending the session of profile ' + pid + ', ' +
        (ban.scope === 'character' ? 'character ' : '') + 'banned ' + untilText(ban.until));
    endLater(pid, actorId, told);
  }
  /*
    Their game is told the session ends (#1157), on the line its character
    choice reads, so it closes its side and goes back to the choice with the
    sentence. skymp5-client connects again after every disconnect, so the kick
    alone brought the same session straight back. The kick is for a game that
    does not close.
  */
  function sessionEnds(pid, sentence) {
    var line = g.__thornswoodSayLine;
    if (typeof line === 'function' && pid) { line(pid, { end: sentence }); }
  }
  function endLater(pid, actorId, sentence) {
    sessionEnds(pid, sentence);
    setTimeout(function () {
      var userId = -1;
      try { userId = mp.getUserByActor(actorId); } catch (e) { userId = -1; }
      if (userId === undefined || userId === null || userId < 0) { return; }
      try { mp.kick(userId); } catch (e) { log('staff: could not end the session of profile ' + pid + ': ' + e); }
    }, KICK_AFTER_MS);
  }

  /* A character killed for good (#1010): only the one playing it is told,
     and the session ends. Nothing is said to anybody else. */
  function endPk(pid, actorId, now) {
    if (state.ending[pid] && now - state.ending[pid] < 60000) { return; }
    state.ending[pid] = now;
    var told = 'This character has died for good and cannot be played again. Your session is ' +
               'being ended. Press Play in the launcher to pick another character or make a new one.';
    tell(pid, told);
    log('staff: ending the session of profile ' + pid + ', whose character is dead for good');
    endLater(pid, actorId, told);
  }

  /* Anybody banned or dead for good who is online, whoever did it and wherever. */
  function banSweep() {
    var now = Date.now();
    var bans = bansNow(now);
    var dead = pkNow(now);
    var all = online();
    for (var i = 0; i < all.length; i++) {
      var pid = profileOf(all[i]);
      if (pid && dead[pid]) { endPk(pid, all[i], now); }
      else if (pid && bans[pid]) { endBanned(pid, all[i], bans[pid], now); }
    }
  }

  function banOrNote(word, words, pid, me, them) {
    if (!them.pid) { tell(pid, them.why); return true; }
    var rest = them.rest || [];
    if (word === '/ban' || word === '/banaccount') {
      var whole = word === '/banaccount';
      if (them.pid === pid) { tell(pid, 'That is you.'); return true; }
      var minutes = banLength(rest[0]);
      var why = rest.slice(1).join(' ').trim();
      if (minutes < 0 || !why) {
        tell(pid, 'Say how long and why: ' + word + ' ' + them.name + ' 3d spamming the market. ' +
                  'How long is 30m, 2h, 3d, 1w or forever. ' +
                  (whole ? '/banaccount bans every character on their account; /ban bans only this one.'
                         : '/ban bans only this character; /banaccount bans every character on their account.'));
        return true;
      }
      siteCall(whole ? 'banaccount' : 'ban', { profileId: them.pid, name: them.name, byProfileId: pid, byName: me,
                                              why: why, minutes: minutes }, function (ok, v) {
        if (!ok) { tell(pid, 'The site did not take the ban, so nothing changed: ' + v + '.'); return; }
        var until = Number(v.until) || 0;
        var covers = whole && Array.isArray(v.profiles) && v.profiles.length ? v.profiles : [them.pid];
        var now = Date.now();
        var ban = { why: why, until: until, scope: whole ? 'account' : 'character', at: now };
        for (var i = 0; i < covers.length; i++) {
          var p = Number(covers[i]);
          if (!(p > 0)) { continue; }
          recordScope(state.banned, p, ban.scope, ban);
          forgetScope(state.lifted, p, ban.scope);
          var a = (p === them.pid && them.actorId) || actorFor(p);
          if (a) { endBanned(p, a, bansNow(now)[p], now); }
        }
        tell(pid, whole
          ? ('Banned ' + them.name + '\'s whole account, every character on it and any new one, ' + untilText(until) + '.')
          : ('Banned the character ' + them.name + ' ' + untilText(until) + '. Their other characters can still play.'));
        if (whole) { record('banaccount', pid, me, them.pid, them.name, untilText(until) + ': ' + why, 0); }
        else { record('ban', pid, me, them.pid, them.name, untilText(until) + ': ' + why, 0); }
      });
      return true;
    }
    if (word === '/unban' || word === '/unbanaccount') {
      var wholeU = word === '/unbanaccount';
      siteCall(wholeU ? 'unbanaccount' : 'unban', { profileId: them.pid, name: them.name, byProfileId: pid, byName: me },
        function (ok, v) {
          if (!ok) { tell(pid, 'The site did not take that, so nothing changed: ' + v + '.'); return; }
          var now = Date.now();
          var covers = wholeU && Array.isArray(v.profiles) && v.profiles.length ? v.profiles : [them.pid];
          for (var i = 0; i < covers.length; i++) {
            var p = Number(covers[i]);
            var scope = wholeU ? 'account' : 'character';
            forgetScope(state.banned, p, scope);
            delete state.ending[p];
            // The door's list can still carry it for a few minutes.
            if (v.was) { recordScope(state.lifted, p, scope, { at: now }); }
          }
          if (wholeU) {
            tell(pid, v.was ? ('The ban on ' + them.name + '\'s account is lifted.') : (them.name + '\'s account was not banned.'));
          } else {
            tell(pid, v.was ? ('The ban on the character ' + them.name + ' is lifted.') : ('The character ' + them.name + ' was not banned.'));
          }
          if (v.was && wholeU) { record('unbanaccount', pid, me, them.pid, them.name, '', 0); }
          else if (v.was) { record('unban', pid, me, them.pid, them.name, '', 0); }
        });
      return true;
    }
    if (word === '/pk') {
      if (them.pid === pid) { tell(pid, 'That is you.'); return true; }
      var whyPk = rest.join(' ').trim();
      if (!whyPk) {
        tell(pid, 'Say why: /pk ' + them.name + ' died in the siege of Whiterun. The character dies for good ' +
                  'and can never be played again; it is kept for staff, and nobody else is told.');
        return true;
      }
      siteCall('pk', { profileId: them.pid, name: them.name, byProfileId: pid, byName: me, why: whyPk },
        function (ok, v) {
          if (!ok) { tell(pid, 'The site did not take the PK, so nothing changed: ' + v + '.'); return; }
          state.pk[them.pid] = { at: Number(v.at) || Date.now() };
          if (v.was) { tell(pid, them.name + ' was already dead for good.'); return; }
          tell(pid, them.name + ' is dead for good. The character is kept for staff and can never be played ' +
                    'again; their account can make a new one. Nobody else was told.');
          record('pk', pid, me, them.pid, them.name, whyPk, 0);
          var a = them.actorId || actorFor(them.pid);
          if (a) { endPk(them.pid, a, Date.now()); }
        });
      return true;
    }
    var text = rest.join(' ').trim();
    if (!text) { tell(pid, 'Note what? /note ' + them.name + ' <what staff should know>.'); return true; }
    siteCall('note', { profileId: them.pid, name: them.name, byProfileId: pid, byName: me, text: text },
      function (ok, v) {
        if (!ok) { tell(pid, 'The site did not keep the note: ' + v + '.'); return; }
        tell(pid, 'Noted against ' + them.name + '. Staff see it on the site.');
        record('note', pid, me, them.pid, them.name, text, 0);
      });
    return true;
  }

  /*
    /unpk <person or character> <why> (#1010, Patrick, 29 September): an
    admin undoes a PK made by mistake. The admin role only; the site asks
    Discord again and refuses anybody else with the same line. The dead
    character is not in the world, so a profile number or a person in the
    world is sent as that, and anything else as the words, for the site to
    find by the dead character's name or its owner's.
  */
  var ONLY_ADMIN = 'Only an admin can undo a PK.';
  function unpk(words, pid, me) {
    var adm = g.__thornswoodIsAdmin;
    var isAdm = true;
    try { if (typeof adm === 'function') { isAdm = !!adm(pid); } } catch (e) { isAdm = false; }
    if (!isAdm) {
      tell(pid, ONLY_ADMIN);
      log('staff: /unpk refused profile ' + pid + ', who is staff but not an admin');
      return true;
    }
    var row = { byProfileId: pid, byName: me };
    var why = '';
    if (/^\d{3,}$/.test(words[0])) {
      row.profileId = Number(words[0]);
      why = words.slice(1).join(' ').trim();
    } else {
      var them = takePerson(words);
      if (them.actorId && them.pid) {
        row.personProfileId = them.pid;
        row.personName = them.name;
        why = (them.rest || []).join(' ').trim();
      } else {
        row.words = words.slice(0, 40);
      }
    }
    if (!row.words && !why) {
      tell(pid, 'Say why: /unpk ' + words[0] + ' made by mistake. The character comes back from the dead, ' +
                'and the PK stays on the record with your reason beside it.');
      return true;
    }
    if (why) { row.why = why; }
    siteCall('unpk', row, function (ok, v, j) {
      if (!ok) {
        tell(pid, (j && j.message) ? String(j.message) : ('The site did not undo the PK, so nothing changed: ' + v + '.'));
        return;
      }
      var p = Number(v.profileId) || 0;
      var name = String(v.name || '') || ('profile ' + p);
      if (!v.was) { tell(pid, name + ' is not dead for good, so there was nothing to undo.'); return; }
      delete state.pk[p];
      delete state.ending[p];
      state.unpk[p] = { at: Date.now() };
      tell(pid, name + ' is no longer dead for good and can be played again from a free slot. ' +
                'The PK stays on the record with your reason beside it.');
      record('unpk', pid, me, p, name, String(v.why || why), 0);
    });
    return true;
  }

  // ------------------------------------------------------------ command --
  /*
    Called from handle() with the queued command, its word and parts, the
    profile and actor it came from, isStaff, and /give's, /spawn's and /tp's
    lookups (findThing, findBeast, byFormId, findPlace). True when this
    answered the line, false to let handle() carry on.
  */
  function command(cmd, word, parts, pid, actorId, isStaff, look) {
    if (!currentRestraints()) { tell(pid, 'The staff module was reloaded. Use the current command again.'); return true; }
    if (SILENCED_WORDS.indexOf(word) !== -1) {
      var left = silencedFor(pid);
      if (!left) { return false; }
      tell(pid, 'Staff have silenced you for another ' + left +
                (left === 1 ? ' minute' : ' minutes') + ', so that did not reach anybody.');
      return true;
    }
    var isAimed = AIMED.indexOf(word) !== -1;
    if (!isAimed && WORDS_STAFF.indexOf(word) === -1) { return false; }

    var staff = false;
    try { staff = !!isStaff(pid); } catch (e) { staff = false; }
    var words = parts.slice(1);

    // /give, /spawn and /tp at a person are staff's; anything else is left.
    if (isAimed) {
      if (!staff || !look) { return false; }
      var am = aimed(word, words);
      if (!am) { return false; }
      var whyA = unproven(cmd, pid);
      if (whyA) {
        tell(pid, whyA);
        log('staff: ' + word + ' refused profile ' + pid + ', ' +
            (cmd && cmd.proven === true ? 'no join pass on hand' : 'the voice service did not prove the connection'));
        return true;
      }
      return doAimed(am, pid, actorId, actorId ? nameOf(actorId) : ('profile ' + pid), look);
    }

    // /goto a place is the playtester teleport in handle(); only a person is ours.
    if (word === '/goto') {
      if (!staff || !words.length) { return false; }
      var gp = takePerson(words);
      if (!gp.actorId || gp.rest.length) { return false; }
    }

    if (!staff) {
      tell(pid, REFUSED);
      log('staff: ' + word + ' refused profile ' + pid + ', who is not staff');
      return true;
    }
    var why = unproven(cmd, pid);
    if (why) {
      tell(pid, why);
      log('staff: ' + word + ' refused profile ' + pid + ', ' +
          (cmd && cmd.proven === true ? 'no join pass on hand' : 'the voice service did not prove the connection'));
      return true;
    }

    var me = actorId ? nameOf(actorId) : ('profile ' + pid);
    if (['/freeze', '/unfreeze', '/silence', '/unsilence', '/freezeaccount', '/unfreezeaccount', '/silenceaccount', '/unsilenceaccount'].indexOf(word) !== -1 && !restraintReady()) {
      tell(pid, 'Staff restraint authority is unavailable. The private restraint book must be repaired before changing it.');
      return true;
    }
    if (word === '/goto' && frozenFor(pid)) {
      tell(pid, 'Staff have you frozen in place, so you cannot teleport yourself. Ask another staff member to move or release you.');
      return true;
    }
    /*
      /DESPAWN: TAKE A SPAWNED CREATURE OUT FOR GOOD (#2623). Djinn, 17 Oct:
      a creature made with keep stays and comes back, and staff need a way
      to end that once it is no longer wanted. Takes no person: it is the
      spawned creature nearest you, within DESPAWN_REACH and in your own cell
      or worldspace, alive or dead, kept or not. Only something a spawn
      command made (the NPC population's commanded rule), never a creature
      or a person the world put there. removeSpawned does the removal, the
      same one a temporary spawn gets, so it does not come back at a restart.
    */
    if (word === '/despawn') {
      var here = actorId ? placeOf(actorId) : null;
      if (!here || !here.desc) { tell(pid, 'The server cannot tell where you are right now. Try again.'); return true; }
      var pop = g.__thornswoodNpcPopulation;
      var made = (pop && pop.spawned) ? pop.spawned() : [];
      var best = null, bestD = DESPAWN_REACH * DESPAWN_REACH;
      for (var di = 0; di < made.length; di++) {
        var at = placeOf(made[di].id);
        if (!at || at.desc !== here.desc) { continue; }
        var dx = at.pos[0] - here.pos[0], dy = at.pos[1] - here.pos[1], dz = at.pos[2] - here.pos[2];
        var d2 = dx * dx + dy * dy + dz * dz;
        if (d2 <= bestD) { best = made[di]; bestD = d2; }
      }
      if (!best) { tell(pid, 'No spawned creature within about 20 metres of you. Stand next to it and try again.'); return true; }
      var what = 'creature';
      try { what = (look && look.beastName && look.beastName(String(mp.get(best.id, 'baseDesc') || ''))) || what; } catch (eName) { }
      if (!removeSpawned(best.id)) { tell(pid, 'The ' + what + ' could not be removed. The server log says why.'); return true; }
      tell(pid, 'Removed the ' + (best.keep ? 'kept ' : '') + what + ' nearest you, for good. It does not come back.');
      record('despawn', pid, me, 0, '', (best.keep ? 'kept ' : '') + what + ' ' + best.id.toString(16), 0);
      return true;
    }
    // The crafting card on the Office page of K (#3167): the staff crafting block answers it.
    if (word === '/craftstaff') {
      var craft = g.__thornswoodStaffCraft;
      if (!craft || !craft.command) {
        tell(pid, 'The staff crafting tools are not running on this server. Say so in the dev channel.');
        return true;
      }
      return craft.command(words, pid, actorId, me, look);
    }
    if (!words.length) {
      tell(pid, word + ' who? ' + word + ' <name, or the start of it, or a profile number>.');
      return true;
    }
    if (word === '/spawnat') {
      if (!look) { tell(pid, 'The server has no creature list to spawn from right now.'); return true; }
      return doAimed(aimed(word, words), pid, actorId, me, look);
    }
    if (word === '/unpk') { return unpk(words, pid, me); }
    if (['/freezeaccount', '/unfreezeaccount', '/silenceaccount', '/unsilenceaccount'].indexOf(word) !== -1) {
      return accountCommand(word, words, pid, me);
    }
    if (word === '/ban' || word === '/unban' || word === '/note' ||
        word === '/banaccount' || word === '/unbanaccount' || word === '/pk') {
      return banOrNote(word, words, pid, me, takePerson(words));
    }
    var them = takePerson(words);
    var reason = (them.rest || []).join(' ').trim();

    // Never lifted by the person it is on (#4932): a silenced person's slash
    // commands still reach here and a frozen one can still type, so naming
    // yourself is refused the way /silence and /freeze refuse it.
    if (word === '/unsilence') {
      if (!them.pid) { tell(pid, them.why); return true; }
      if (them.pid === pid) { tell(pid, 'That is you.'); return true; }
      if (!state.silenced[them.pid]) { tell(pid, them.name + ' is not silenced.'); return true; }
      if (!requireRestraintSave(pid, function (doc) { delete doc.silenced[them.pid]; })) { return true; }
      pushSilenced();
      var stillSilenced = silencedFor(them.pid);
      tell(them.pid, stillSilenced ? 'Your account silence still applies.' : 'Staff have let you speak again.');
      tell(pid, stillSilenced ? 'The account silence still applies.' : them.name + ' can speak again.');
      record(stillSilenced ? 'unsilencepartial' : 'unsilence', pid, me, them.pid, them.name, '', 0);
      return true;
    }
    if (word === '/unfreeze') {
      if (!them.pid) { tell(pid, them.why); return true; }
      if (them.pid === pid) { tell(pid, 'That is you.'); return true; }
      if (!state.frozen[them.pid]) { tell(pid, them.name + ' is not frozen.'); return true; }
      if (!requireRestraintSave(pid, function (doc) { delete doc.frozen[them.pid]; })) { return true; }
      var stillFrozen = frozenFor(them.pid);
      tell(them.pid, stillFrozen ? 'Your account freeze still applies.' : 'Staff have let you go. You can move again.');
      tell(pid, stillFrozen ? 'The account freeze still applies.' : them.name + ' can move again.');
      record(stillFrozen ? 'unfreezepartial' : 'unfreeze', pid, me, them.pid, them.name, '', 0);
      return true;
    }
    if (word === '/silence') {
      if (!them.pid) { tell(pid, them.why); return true; }
      if (them.pid === pid) { tell(pid, 'That is you.'); return true; }
      var mins = SILENCE_DEFAULT_MIN;
      var rest = them.rest || [];
      if (rest.length) {
        var length = banLength(rest[0]);
        if (length > 0 && Number.isFinite(length)) {
          mins = Math.min(SILENCE_MAX_MIN, length);
          reason = rest.slice(1).join(' ').trim();
        } else if (/^[+-]?(?:\d|\.)/.test(rest[0]) || length === 0) {
          tell(pid, 'That silence length is not valid. Use minutes, 30m, 2h or 1d; a day at most. Nothing changed.');
          return true;
        }
      }
      if (!requireRestraintSave(pid, function (doc) {
        doc.silenced[them.pid] = { until: Date.now() + mins * 60000, name: them.name, by: pid };
      })) { return true; }
      pushSilenced();
      tell(them.pid, 'Staff have silenced you for ' + mins + ' minutes' +
                     (reason ? ': ' + reason + '.' : '.') +
                     ' Your voice, what you type, the words above your head, and the speaking mark stop until then. Your name stays.');
      tell(pid, 'Silenced ' + them.name + ' for ' + mins + ' minutes. /unsilence ' +
                them.name + ' ends it sooner.');
      record('silence', pid, me, them.pid, them.name, reason, mins);
      return true;
    }

    // Everything below needs the person in the world.
    if (!them.actorId) { tell(pid, them.why); return true; }

    if (word === '/hurt') {
      var hurt = g.__thornswoodHurt;
      if (!hurt || !hurt.staff) { tell(pid, 'Wounds and disease are not running on this server.'); return true; }
      var hurtSaid = hurt.staff(them.actorId, them.rest || [], me);
      tell(pid, them.name + ': ' + hurtSaid.staff);
      if (hurtSaid.them) { tell(them.pid, hurtSaid.them); }
      if ((them.rest || []).length) { record('hurt', pid, me, them.pid, them.name, reason, 0); }
      return true;
    }

    if (word === '/warn') {
      if (!reason) { tell(pid, 'Warn them about what? /warn ' + them.name + ' <what they did>.'); return true; }
      tell(them.pid, 'A warning from staff: ' + reason + '. Read the rules on thornswood.net; ' +
                     'the next step is being removed from the world.');
      tell(pid, 'Warned ' + them.name + '.');
      record('warn', pid, me, them.pid, them.name, reason, 0);
      return true;
    }
    if (word === '/kick') {
      if (them.pid === pid) { tell(pid, 'That is you.'); return true; }
      var kicked = 'Staff have ended your session' + (reason ? ': ' + reason + '.' : '.') +
                   ' Read the rules on thornswood.net before you come back.';
      tell(them.pid, kicked);
      sessionEnds(them.pid, kicked);
      tell(pid, 'Removing ' + them.name + ' from the world.');
      record('kick', pid, me, them.pid, them.name, reason, 0);
      var gone = them.actorId;
      setTimeout(function () {
        var userId = -1;
        try { userId = mp.getUserByActor(gone); } catch (e) { userId = -1; }
        if (userId === undefined || userId === null || userId < 0) {
          log('staff: could not find the connection of ' + them.name + ' to kick; they had already left');
          return;
        }
        try { mp.kick(userId); } catch (e) { log('staff: could not kick ' + them.name + ': ' + e); }
      }, KICK_AFTER_MS);
      return true;
    }
    if (word === '/freeze') {
      if (them.pid === pid) { tell(pid, 'That is you.'); return true; }
      if (state.frozen[them.pid] && state.frozen[them.pid].pending) {
        tell(pid, 'That frozen character has unresolved movement. Check the problem and explicitly /unfreeze ' + them.pid + ' first.'); return true;
      }
      var spot = placeOf(them.actorId);
      if (!spot || !spot.desc) { tell(pid, 'The server cannot tell where ' + them.name + ' is right now. Try again.'); return true; }
      spot.by = pid;
      if (!requireRestraintSave(pid, function (doc) { doc.frozen[them.pid] = spot; })) { return true; }
      tell(them.pid, 'Staff have frozen you in place' + (reason ? ': ' + reason + '.' : '.') +
                     ' Wait here and somebody will talk to you.');
      tell(pid, 'Froze ' + them.name + '. /unfreeze ' + them.name + ' lets them go.');
      record('freeze', pid, me, them.pid, them.name, reason, 0);
      return true;
    }
    if (word === '/bring' || word === '/goto') {
      if (them.pid === pid) { tell(pid, 'That is you.'); return true; }
      if (!actorId) {
        tell(pid, 'The server cannot find your character right now. Give it a moment and try again.');
        return true;
      }
      var mover = (word === '/bring') ? them.actorId : actorId;
      var dest = placeOf(word === '/bring' ? actorId : them.actorId);
      if (!dest || !dest.desc) { tell(pid, 'The server cannot tell where that is right now. Try again.'); return true; }
      // Somebody frozen and then brought stays frozen where they were brought.
      var movedPid = (word === '/bring') ? them.pid : pid;
      if (!moveStaffPerson(mover, movedPid, dest, pid)) { return true; }
      if (word === '/bring') {
        tell(them.pid, 'Staff brought you to them.');
        tell(pid, 'Brought ' + them.name + ' to you.');
        record('bring', pid, me, them.pid, them.name, '', 0);
      } else {
        tell(pid, 'Sent to ' + them.name + '.');
        record('goto', pid, me, them.pid, them.name, '', 0);
      }
      return true;
    }
    return false;
  }

  if (g.__thornswoodStaffTimer) { try { clearInterval(g.__thornswoodStaffTimer); } catch (e) { } }
  g.__thornswoodStaffTimer = setInterval(guard('staffFreezeTick', freezeTick), FREEZE_EVERY_MS);
  if (g.__thornswoodBanTimer) { try { clearInterval(g.__thornswoodBanTimer); } catch (e) { } }
  g.__thornswoodBanTimer = setInterval(guard('staffBanSweep', banSweep), BAN_SWEEP_MS);
  if (g.__thornswoodSilenceTimer) { try { clearInterval(g.__thornswoodSilenceTimer); } catch (e) { } }
  g.__thornswoodSilenceTimer = setInterval(guard('staffSilencePush', pushSilenced), SILENCE_PUSH_MS);
  // Once at load, so a voice service that restarted, or a reload, hears the list.
  pushSilenced();

  g.__thornswoodStaff = {
    command: command, find: find, takePerson: takePerson, unproven: unproven, record: record,
    authorizeTool: authorizeTool, tell: tell, nameOf: nameOf, actorFor: actorFor,
    freezeTick: freezeTick, pushSilenced: pushSilenced, silencedFor: silencedFor,
    restraintAdmission: restraintAdmission, accountFreezesActive: accountFreezesActive, frozenFor: frozenFor,
    banSweep: banSweep, banLength: banLength, bansNow: bansNow, pkNow: pkNow,
    state: state, REFUSED: REFUSED, WORDS: WORDS_STAFF
  };
  log('staff commands ready: ' + WORDS_STAFF.join(', ') + ', and ' + AIMED.join(', ') +
      ' at a person, for the staff roles with a join pass');
})();
// ==== end thornswood staff ====

