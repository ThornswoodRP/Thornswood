// ==== thornswood world stage ====
/*
  THE WORLD STAGE AND THE OFFICE PROCLAMATION (#513).

  #513 is the Thalmor war. Patrick, 17 Oct: Thornswood is player driven, so
  the war is tools for staff and never a script. Nothing here decides what
  happens next, and no timer moves anything. The stages are data, written by
  staff in game/data/war-stages.json, and this block knows no stage by name.

  THE STAGE LIST is WAR_STAGES below, the same table as
  game/data/war-stages.json. The server is sent this file and not game/data,
  so the table is copied in, and tests/test-513-world-stage.js fails if the
  two differ. Each stage has an id, a name and its words, and may carry
  force: free text saying who is behind it (dominion, remnant, proxy, mixed,
  or whatever staff write). force is handed back as it is written. No code
  here reads it to choose anything. The first stage in the list is where the
  world starts, and where it falls back to.

  ONE STAGE FOR THE WHOLE PROVINCE, kept in private/war.json beside
  season.json, so a restart or a deploy does not reset it. worldStage() is
  the one place it is read: the stage, its force and when the world reached
  it. Any block that needs it asks here rather than keeping a copy of its
  own.

    - No file is the start of the world, the first stage. Nothing is written
      and nothing is said.
    - A file that cannot be read, or one whose stage the list does not have,
      is the first stage too, and the log says so once, when this block
      loads. The file is left as it is. If a move is made after that, the
      unreadable file is kept beside it as war.json.unreadable-<time> before
      the new one is written, so nothing on record is lost.

  THE HISTORY. war.json keeps every move the world has made, oldest first:
  the stage and when. The last entry is where the world is now. A move is
  never taken off it, so a change that is meant to be permanent stays on
  record even when a later stage undoes it in the world.

  THE FILE NAMES NOBODY (#2860). It is kept for as long as the world is, and
  a wipe leaves it (scripts/ops/Wipe-Saves.ps1), so it is not a place that
  names people (#2353). Who moved the world, who proposed it, and who
  confirmed or dropped a proposal are in the staff log, which keeps each
  line for its own time, the way the company's terms file does (#2687). Who
  made the proposal waiting now is held in memory for the card and the log
  lines, and after a restart the card says only when it was made.

  STAGE IDS FOLLOW THE PATROL FILE'S KEY RULE. thalmor-patrols.json (#1390)
  gives a patrol cap for each stage under stageMost, keyed by these ids, and
  it takes a key only when it is 1 to 32 lower case letters, digits and
  dashes (/^[a-z0-9-]{1,32}$/, the same as its road ids). So the stage list
  holds ids to that same rule, STAGE_ID below: a stage in war-stages.json
  whose id breaks it is left out of the list and the log says so once when
  this block loads, and a move or a proposal to such an id is refused with
  the rule in words. A stage the patrol file could never key is never a
  stage the world can reach.

  setWorldStage(id, by) moves it, and is a function only: nothing in play
  calls it. An id the list does not have is refused. So is the stage the
  world is already at, so the time it was reached is never reset by
  accident, and so is a move that does not say who made it. Nothing is
  written when it refuses. The file is written whole and then renamed into
  place, so a crash halfway leaves the old stage, not half a file.

  THE SEAM FOR LATER, SERVER PROPOSES AND STAFF CONFIRM. proposeWorldStage
  (id, by) keeps one proposal in war.json, checked the same way as a move,
  and moves nothing: the stage and when, with who in memory only. A later
  proposal replaces it. confirmWorldStage(by) makes the move it proposed, as
  a move by whoever confirmed it, and clears it. dropWorldStageProposal(by) clears it without a move. A direct
  setWorldStage clears it too, because it no longer says where the world
  goes from here. pendingWorldStage() reads it. Staff propose, confirm and
  drop on the Office page of K: THE STAFF CARD, below. Nothing proposes by
  itself yet.

  proclaim(holds, office, title, body) puts one notice on the board of each
  hold named, in the name of an office (the Crown, the Jarl of Haafingar),
  never a person. It is a notice like any other on the wall and under Boards
  on J, kept in the property register with the rest, so it survives a
  restart. There is no fee, no gold moves, and nothing is held on any
  ledger: it is the office's word, not somebody's purchase. The property
  block's officePost does the writing, with the same 60 and 600 limits as a
  person's post. Everybody standing at one of those boards, within the
  board's own reach of 400, is told once in their chat. A hold with no board
  refuses the whole call, and so does anything else wrong with it, and then
  nothing is written and nobody is told. 'all' names every hold that has a
  board.

  THE STAFF CARD below is the only thing in play that calls any of this, and
  only on a staff member's press. Nothing is scripted. The patrol cap is
  #1390's, and nothing here touches it.
*/
(function () {
  'use strict';
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;

  // ==== WAR_STAGES ====
  /* The same table as game/data/war-stages.json. tests/test-513-world-stage.js checks that they agree. */
  var WAR_STAGES = {"version":1,"stages":[{"id":"peace","name":"Peace","text":"The Kingdom is at peace. Nothing in the world changes."}]};
  // ==== end WAR_STAGES ====

  var BY_CHARS = 80;

  /* The patrol file's rule for a stage id (#1390, thalmorPatrolTable's
     stageMost keys and road ids): see STAGE IDS above. */
  var STAGE_ID = /^[a-z0-9-]{1,32}$/;
  var STAGE_ID_WORDS = 'lower case letters, digits and dashes, 1 to 32 of them';
  function idRefusal(id) {
    return 'A stage id is ' + STAGE_ID_WORDS + ', the rule thalmor-patrols.json keys its stages by, and ' +
           JSON.stringify(String(id)) + ' is not one.';
  }

  function wlog() {
    var a = ['[thornswood world stage]'];
    for (var i = 0; i < arguments.length; i++) { a.push(arguments[i]); }
    try { console.log(a.join(' ')); } catch (e) { }
  }

  function stagePath() {
    var fs = require('fs');
    var path = require('path');
    var priv = 'private';
    try {
      var cfg = JSON.parse(fs.readFileSync('server-settings.json', 'utf8'));
      if (cfg && cfg.privDir) { priv = String(cfg.privDir); }
    } catch (e) { }
    try { if (!fs.existsSync(priv)) { fs.mkdirSync(priv, { recursive: true }); } } catch (e2) { }
    return path.join(priv, 'war.json');
  }

  /* The list as staff wrote it, less any stage whose id breaks STAGE_ID. */
  var LISTED = (WAR_STAGES && Array.isArray(WAR_STAGES.stages)) ? WAR_STAGES.stages : [];
  var STAGES = LISTED.filter(function (s) { return !!s && typeof s.id === 'string' && STAGE_ID.test(s.id); });
  LISTED.forEach(function (s) {
    if (STAGES.indexOf(s) < 0) {
      wlog('war-stages.json has a stage left out of the list:', idRefusal(s && s.id));
    }
  });
  function stageList() { return STAGES; }

  /** The stage row for an id, or null when the list has no such stage. */
  function stageOf(id) {
    var list = stageList();
    for (var i = 0; i < list.length; i++) {
      if (list[i] && typeof list[i].id === 'string' && list[i].id === id) { return list[i]; }
    }
    return null;
  }

  /** Where the world starts: the first stage in the list. */
  function startId() {
    var first = stageList()[0];
    return (first && typeof first.id === 'string') ? first.id : '';
  }

  function cleanWho(by) { return typeof by === 'string' ? by.replace(/\s+/g, ' ').trim() : ''; }

  /* One history entry, or the proposal, as it is kept: a stage and when. Never who (#2860). */
  function entryOf(row) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id) { return null; }
    return { id: row.id, at: Number(row.at) || 0 };
  }

  function readState() {
    var fs = require('fs');
    var file = stagePath();
    var fresh = { history: [], pending: null, unreadable: false };
    var text = null;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (e) {
      if (e && e.code === 'ENOENT') { return fresh; }
      wlog('could not read', file + ':', (e && e.message) || e, '; the world is at', startId());
      fresh.unreadable = true;
      return fresh;
    }
    var raw = null;
    try { raw = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch (e2) { raw = null; }
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.history)) {
      wlog(file, 'is not readable; the world is at', startId(), 'and the file is left as it is');
      fresh.unreadable = true;
      return fresh;
    }
    var history = [];
    for (var i = 0; i < raw.history.length; i++) {
      var en = entryOf(raw.history[i]);
      if (en) { history.push(en); }
    }
    var last = history.length ? history[history.length - 1] : null;
    var lost = false;
    if (last && !stageOf(last.id)) {
      wlog(file, 'puts the world at a stage the list does not have (' + JSON.stringify(last.id) +
           '); the world is at', startId(), 'and the file is left as it is');
      lost = true;
    }
    var pending = null;
    if (raw.pending && typeof raw.pending === 'object') {
      var p = entryOf(raw.pending);
      if (p && stageOf(p.id)) { pending = p; }
      else { wlog('the proposal in', file, 'names a stage the list does not have; it is not kept'); }
    }
    return { history: history, pending: pending, unreadable: false, lost: lost };
  }

  var state = readState();
  // Who made the proposal waiting now, as the staff log names them. Memory
  // only: the file names nobody, so after a restart this is ''.
  var proposedBy = '';

  /* The history entry the world is at now, or null at the start. */
  function current() {
    if (state.lost) { return null; }
    return state.history.length ? state.history[state.history.length - 1] : null;
  }

  function currentId() { var c = current(); return c ? c.id : startId(); }

  /** Where the world is: the stage, its force and when it was reached. Who moved it is in the staff log. */
  function worldStage() {
    var c = current();
    var row = stageOf(currentId()) || { id: currentId(), name: '', text: '' };
    return { id: row.id, name: String(row.name || ''), text: String(row.text || ''),
             force: typeof row.force === 'string' ? row.force : '',
             since: c ? c.at : 0 };
  }

  /** Every move the world has made, oldest first. A copy. */
  function worldHistory() { return JSON.parse(JSON.stringify(state.history)); }

  /** The proposal waiting for a yes, or null: its stage, when, and who made it while this start remembers. A copy. */
  function pendingWorldStage() {
    return state.pending ? { id: state.pending.id, at: state.pending.at, by: proposedBy } : null;
  }

  /* Writes the next state whole, or nothing. Answers true when it is on disk. */
  function write(next) {
    var fs = require('fs');
    var file = stagePath();
    try {
      if (state.unreadable && fs.existsSync(file)) {
        fs.renameSync(file, file + '.unreadable-' + Date.now());
      }
      var c = next.history.length ? next.history[next.history.length - 1] : null;
      fs.writeFileSync(file + '.tmp', JSON.stringify({
        id: c ? c.id : startId(), since: c ? c.at : 0,
        history: next.history, pending: next.pending
      }));
      fs.renameSync(file + '.tmp', file);
    } catch (e) {
      wlog('could not write', file + ':', (e && e.message) || e, '; the world stays at', currentId());
      return false;
    }
    state = { history: next.history, pending: next.pending, unreadable: false, lost: false };
    return true;
  }

  /* Why a move to id by who cannot be made, or '' when it can. */
  function refusal(id, who, doing) {
    if (typeof id === 'string' && !STAGE_ID.test(id)) { return idRefusal(id); }
    if (typeof id !== 'string' || !stageOf(id)) { return 'There is no stage called ' + JSON.stringify(String(id)) + '.'; }
    if (!who) { return 'Say who ' + doing + '.'; }
    if (who.length > BY_CHARS) { return 'Who ' + doing + ' is up to ' + BY_CHARS + ' characters.'; }
    // A file whose stage the list lost may still be moved to the start.
    if (!state.lost && id === currentId()) { return 'The world is already at ' + (stageOf(id).name || id) + '.'; }
    return '';
  }

  /* Moves the world to id. byWas is who proposed it, for the log line only. */
  function move(id, who, byWas) {
    var was = currentId();
    var history = state.history.concat([{ id: id, at: Date.now() }]);
    if (!write({ history: history, pending: null })) {
      return { ok: false, why: 'The stage could not be written, so the world stays where it was.' };
    }
    proposedBy = '';
    wlog(who, 'moved the world from', was, 'to', id + (byWas ? ', proposed by ' + byWas : ''));
    return { ok: true, stage: worldStage(), proposedBy: byWas };
  }

  /** Moves the world to stage id. Answers { ok: true, stage } or { ok: false, why }, and writes nothing on a no. */
  function setWorldStage(id, by) {
    var key = typeof id === 'string' ? id.trim() : id;
    var who = cleanWho(by);
    var why = refusal(key, who, 'moved the world');
    if (why) { return { ok: false, why: why }; }
    return move(key, who, '');
  }

  /** Keeps one proposal to move to stage id, and moves nothing. A later one replaces it. */
  function proposeWorldStage(id, by) {
    var key = typeof id === 'string' ? id.trim() : id;
    var who = cleanWho(by);
    var why = refusal(key, who, 'proposes it');
    if (why) { return { ok: false, why: why }; }
    var pending = { id: key, at: Date.now() };
    if (!write({ history: state.history, pending: pending })) {
      return { ok: false, why: 'The proposal could not be written, so nothing changed.' };
    }
    proposedBy = who;
    wlog(who, 'proposed moving the world from', currentId(), 'to', key);
    return { ok: true, pending: pendingWorldStage() };
  }

  /** Makes the move the proposal names, as a move by whoever confirms it. */
  function confirmWorldStage(by) {
    var p = state.pending;
    if (!p) { return { ok: false, why: 'Nothing is proposed.' }; }
    var who = cleanWho(by);
    var why = refusal(p.id, who, 'confirms it');
    if (why) { return { ok: false, why: why }; }
    return move(p.id, who, proposedBy);
  }

  /** Clears the proposal without a move. */
  function dropWorldStageProposal(by) {
    var p = state.pending;
    if (!p) { return { ok: false, why: 'Nothing is proposed.' }; }
    var who = cleanWho(by);
    if (!who) { return { ok: false, why: 'Say who is dropping it.' }; }
    if (!write({ history: state.history, pending: null })) {
      return { ok: false, why: 'The proposal could not be cleared, so it stands.' };
    }
    var byWas = proposedBy;
    proposedBy = '';
    wlog(who, 'dropped', (byWas || 'an earlier') + '\'s proposal to move the world to', p.id);
    return { ok: true, proposedBy: byWas };
  }

  /*
    A notice in an office's name on the boards named, and a line to everybody
    standing at one of them. Answers { ok: true, holds, told } or
    { ok: false, why }. See the top of this block.
  */
  function proclaim(holds, office, title, body) {
    var W = g.__thornswoodProperty;
    if (!W || typeof W.officePost !== 'function' || typeof W.boardHere !== 'function') {
      return { ok: false, why: 'The boards are not loaded, so nothing was put up.' };
    }
    var r = W.officePost(holds, office, title, body);
    if (!r || !r.ok) { return r || { ok: false, why: 'Nothing was put up.' }; }
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { online = []; }
    var line = 'A notice from ' + r.office + ' is up on the board: ' + r.title +
               (/[.!?]$/.test(r.title) ? '' : '.');
    var told = 0;
    for (var i = 0; i < online.length; i++) {
      var hold = null;
      try { hold = W.boardHere(online[i]); } catch (e2) { hold = null; }
      if (!hold || r.holds.indexOf(hold) < 0) { continue; }
      try { say(online[i], line); told++; } catch (e3) { }
      // A board panel that is open shows the new notice now, not at the next push.
      try {
        var soc = g.__thornswoodSocial;
        if (soc && soc.push) { soc.push(online[i], true); }
      } catch (e4) { }
    }
    wlog(r.office, 'proclaimed on', r.holds.join(', ') + ':', r.title, '; told', told);
    return { ok: true, holds: r.holds.slice(), told: told };
  }

  /*
    THE STAFF CARD ON THE OFFICE PAGE (#513, Patrick, 17 Oct): server
    proposes, staff confirm, and nothing is typed. Staff see a card on the
    Office page of K: where the world is, its force when the stage names one,
    and any proposal waiting, with the stage it moves to, who proposed it and
    when. They propose a move to any other stage in the list, and confirm or
    drop the one waiting. The card's buttons send /world, which nobody is
    told to type, and Confirm asks twice on the page before it sends.

    STAFF ONLY, CHECKED HERE ON EVERY LINE. The card is drawn only for staff,
    and the line is never trusted for that: each one asks the same two things
    the #2551 staff buttons ask (settleAs in the property block). Who is staff
    is the chat block's isStaff (__thornswoodIsStaff), and the staff block's
    proof (unproven) wants a chat connection the voice service proved and the
    launcher's pass on hand. Somebody who is not staff is told only that this
    is staff's, and nothing changes.

    A CONFIRM OR A DROP NAMES THE PROPOSAL, its stage and when it was made,
    so a press on a card drawn before somebody else's proposal cannot confirm
    or drop the newer one.

    THE LOG is the staff log, the record the #2551 buttons write: one line in
    thornswood.log and one in for-bot/moderation.log, which the Discord bot
    says in the staff channel (worldpropose, worldconfirm, worlddrop). No
    press is taken when that log is not loaded.

    THE STAGE'S NOTICE. A stage may carry proclamation, { office, holds,
    title, body }, in war-stages.json. When a confirm moves the world to it,
    that notice goes up through proclaim above. It is optional, and a stage
    with none puts nothing up. If the notice is refused, the move still
    stands, the staff member is told why, and the log says so.
  */
  var STAFF_LOG_GONE = 'The staff log is not loaded on this server, so no staff press is taken. Say so in the dev channel.';

  function isStaffNow(pid) {
    var f = g['__thornswoodIsStaff'];
    try { return typeof f === 'function' && !!f(Number(pid) || 0); } catch (e) { return false; }
  }

  function nameOfActor(actorId) {
    try {
      var ap = mp.get(actorId, 'appearance');
      if (ap && ap.name) { return String(ap.name); }
    } catch (e) { }
    return 'somebody';
  }

  /* One stage as the card shows it: id, name, force, and the office of its notice when it has one. */
  function stageCard(row) {
    var out = { id: row.id, name: String(row.name || row.id), force: typeof row.force === 'string' ? row.force : '' };
    var p = row.proclamation;
    if (p && typeof p === 'object' && typeof p.office === 'string' && p.office) { out.notice = p.office; }
    return out;
  }

  /** What the staff card on the Office page draws, or null for anybody who is not staff. */
  function staffView(profileId) {
    if (!isStaffNow(profileId)) { return null; }
    var st = worldStage();
    var p = state.pending;
    var target = p ? stageOf(p.id) : null;
    var tc = target ? stageCard(target) : null;
    return {
      stage: { id: st.id, name: st.name || st.id, force: st.force, text: st.text, since: st.since },
      pending: tc ? { id: p.id, name: tc.name, force: tc.force, notice: tc.notice || '', at: p.at, by: proposedBy } : null,
      stages: stageList().filter(function (r) { return r && typeof r.id === 'string'; }).map(stageCard)
    };
  }

  /* Every staff member's K panel again, so each card says what is true now. */
  function redrawStaff() {
    var c = g.__thornswoodCharacter;
    if (!c || !c.stateOf || !c.writeState) { return; }
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { return; }
    for (var i = 0; i < online.length; i++) {
      var pid = 0;
      try { pid = Number(mp.get(online[i], 'profileId')) || 0; } catch (e2) { pid = 0; }
      if (!pid || !isStaffNow(pid)) { continue; }
      try {
        var s = c.stateOf(online[i]);
        if (s) { c.writeState(online[i], s); }
      } catch (e3) { }
    }
  }

  /* Who made the proposal a confirm or a drop just cleared, as the staff log line says it. */
  function proposer(r) { return r.proposedBy ? 'proposed by ' + r.proposedBy : 'proposed before the last restart'; }

  function samePending(id, at) {
    var p = state.pending;
    return !!p && p.id === String(id || '') && String(at) === String(p.at);
  }

  /*
    The staff card's lines: propose <stage>, confirm <stage> <when> and
    drop <when>. Answers true, because the word is always this block's.
  */
  function command(parts, actorId, profileId, toProfile, cmd) {
    var pid = Number(profileId) || 0;
    var verb = String((parts && parts[1]) || '').toLowerCase();
    if (!isStaffNow(pid)) {
      wlog('a line for the world from profile', pid, 'who is not staff; nothing changed');
      toProfile(profileId, 'Moving the world is staff\'s. Nothing changed.');
      return true;
    }
    var log = g['__thornswoodStaff'];
    if (!log || typeof log.unproven !== 'function' || typeof log.record !== 'function') {
      toProfile(profileId, STAFF_LOG_GONE);
      return true;
    }
    var unproven = log.unproven(cmd, pid);
    if (unproven) { toProfile(profileId, unproven); return true; }
    var name = nameOfActor(actorId);
    // Who, as the history keeps it: the name cut to 60, so it always fits.
    var by = name.slice(0, 60) + ' (profile ' + pid + ')';
    var from = currentId();
    var r;

    if (verb === 'propose') {
      var want = String((parts && parts[2]) || '');
      var replaced = state.pending ? state.pending.id : '';
      r = proposeWorldStage(want, by);
      if (!r.ok) { toProfile(profileId, r.why + ' Nothing changed.'); return true; }
      var row = stageOf(want);
      var force = typeof row.force === 'string' ? row.force : '';
      log.record('worldpropose', pid, name, 0, String(row.name || want),
                 'from ' + from + ' to ' + want + (force ? ', force: ' + force : '') +
                 (replaced ? ', in place of the proposal to ' + replaced : ''),
                 0, { stage: want, from: from, force: force });
      toProfile(profileId, 'You propose moving the world to ' + (row.name || want) + '. It moves only when staff ' +
                'confirm it on this page. It is in the staff log.');
      redrawStaff();
      return true;
    }

    if (verb === 'confirm' || verb === 'drop') {
      if (!state.pending) { toProfile(profileId, 'Nothing is proposed. Nothing changed.'); return true; }
      var id = verb === 'confirm' ? String((parts && parts[2]) || '') : state.pending.id;
      var at = verb === 'confirm' ? (parts && parts[3]) : (parts && parts[2]);
      if (!samePending(id, at)) {
        toProfile(profileId, 'That is not the proposal waiting now. Open the page again to see the one that is. Nothing changed.');
        return true;
      }
      var p = state.pending;
      var target = stageOf(p.id);
      var tname = String((target && target.name) || p.id);
      if (verb === 'drop') {
        r = dropWorldStageProposal(by);
        if (!r.ok) { toProfile(profileId, r.why); return true; }
        log.record('worlddrop', pid, name, 0, tname, proposer(r) + '; the world stays at ' + from,
                   0, { stage: p.id, from: from, proposedBy: r.proposedBy });
        toProfile(profileId, 'You drop the proposal to move the world to ' + tname +
                  '. The world stays where it is. It is in the staff log.');
        redrawStaff();
        return true;
      }
      r = confirmWorldStage(by);
      if (!r.ok) { toProfile(profileId, r.why + ' Nothing changed.'); return true; }
      var tforce = typeof target.force === 'string' ? target.force : '';
      var notice = target.proclamation;
      var put = (notice && typeof notice === 'object')
        ? proclaim(notice.holds, notice.office, notice.title, notice.body) : null;
      if (put && !put.ok) { wlog('the notice for', p.id, 'was refused:', put.why); }
      log.record('worldconfirm', pid, name, 0, tname,
                 'from ' + from + ' to ' + p.id + ', ' + proposer(r) + (tforce ? ', force: ' + tforce : '') +
                 (put ? (put.ok ? '; its notice is up in ' + put.holds.join(', ') : '; its notice was refused: ' + put.why) : ''),
                 0, { stage: p.id, from: from, force: tforce, proposedBy: r.proposedBy,
                      notice: put ? (put.ok ? put.holds.slice() : false) : null });
      toProfile(profileId, 'The world moves to ' + tname + '. It is in the staff log.' +
                (put ? (put.ok ? ' Its notice is up on the board in ' + put.holds.length +
                                 (put.holds.length === 1 ? ' hold.' : ' holds.')
                               : ' Its notice did not go up: ' + put.why) : ''));
      redrawStaff();
      return true;
    }

    toProfile(profileId, 'The world\'s card on the Office page of K proposes, confirms and drops. Nothing changed.');
    return true;
  }

  g.__thornswoodWorldStage = {
    worldStage: worldStage,
    worldHistory: worldHistory,
    setWorldStage: setWorldStage,
    proposeWorldStage: proposeWorldStage,
    confirmWorldStage: confirmWorldStage,
    dropWorldStageProposal: dropWorldStageProposal,
    pendingWorldStage: pendingWorldStage,
    proclaim: proclaim,
    // The staff card on the Office page of K: what it draws, and its lines.
    staffView: staffView,
    command: command,
    stages: function () { return JSON.parse(JSON.stringify(stageList())); }
  };
  if (!startId()) { wlog('the stage list is empty; nothing here can move'); }
  wlog('the world is at', currentId());
})();
// ==== end thornswood world stage ====

