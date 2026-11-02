// ---------------------------------------------------------------------------
// A teleport that actually teleports.
//
// coc does nothing on this server and never did. SkyMP's client forwards
// exactly five console commands to the server, in
// consoleCommandsService.ts: additem, equipitem, placeatme, disable and mp.
// Everything else, coc and tcl and setstage included, runs in your own game
// and is never sent anywhere, so the server carries on believing you are where
// it put you and moves you back on the next position update. There is no
// setting for this and no way to add a sixth command without recompiling the
// client.
//
// So the teleport is a chat command instead. Chat rides the voice service's
// socket, the voice service now holds any line starting with a slash in a
// queue, and this collects that queue over the loopback trip it was already
// making for the launcher's choices.
//
// /where is the other half. It prints the cell, the position and the angle you
// are standing at, which is what the console was being used for.
// ---------------------------------------------------------------------------
(function () {
  'use strict';

  /*
    A hot reload replaces this block rather than being turned away by it.

    This used to return early when it had already run, which kept an in flight
    countdown alive but meant every edit to a command sat in the file doing
    nothing until somebody restarted the server. The countdown is the only
    thing here worth keeping across a reload, so it lives on globalThis and
    survives on its own, and the timer at the bottom clears the old one before
    arming a new one. Everything else is functions, and replacing those is the
    point of a reload.
  */
  var g = globalThis;

  var VOICE_PORT = voicePort();

  function post(path, payload) {
    var http;
    try { http = require('http'); } catch (e) { return; }
    var body = JSON.stringify(payload);
    var req = http.request({
      host: '127.0.0.1', port: VOICE_PORT, path: path, method: 'POST', timeout: 2000,
      headers: { 'content-type': 'application/json',
                 'content-length': Buffer.byteLength(body) }
    }, function () { });
    req.on('error', function () { });
    req.on('timeout', function () { req.destroy(); });
    req.end(body);
  }

  /** A line in the chat, to one person. */
  // How far out of character talk carries. About the length of a longhouse,
  // which is roughly the group a scene has in it.
  var OOC_RANGE = 4000;

  /*
    The dice, and their limits.

    A thousand sides because somebody will want a percentile and then a
    thousand; a hundred dice because a handful is the point and a screenful is
    not. Decimals are refused rather than rounded: a roll whose shape nobody
    can predict is worse than no roll.
  */
  var ROLL_MAX_SIDES = 1000;
  var ROLL_MAX_DICE = 100;
  var ROLL_DEFAULT_SIDES = 20;

  function toProfile(profileId, text) {
    post('/say', { profileId: profileId, text: text });
  }
  // For the load order sweep, which says a line to somebody who sent nothing.
  g.__thornswoodToProfile = toProfile;

  /*
    The line at the menu (#481): somebody's place, or that it is their turn,
    for the menu page to show. Data rather than words, under a name no person
    can send from (the service puts from 0 on it), and the page takes it out
    of the chat; see thornswood-chat.js.

    And a session the server is ending on purpose (#1157), { end: <the
    sentence they were told> }, said before the kick: their game closes its
    own connection and goes back to the character choice with the sentence on
    it. skymp5-client connects again after every disconnect, so a kick alone
    brought the same session straight back, refused again, for as long as the
    game stayed open. A restart's kick does not say it, because that
    reconnect is wanted.
  */
  var LINE_NAME = 'Thornswood line';
  g.__thornswoodSayLine = function (profileId, what) {
    post('/say', { profileId: profileId, name: LINE_NAME, text: JSON.stringify(what || {}) });
  };

  /*
    actorId for a connected profile, or 0.

    "The server cannot find your character right now" was reported often
    enough to be the normal answer rather than the rare one, and this is why.
    The sweep is the only lookup, it runs on the tick the line arrives, and
    three separate things make it come back empty for somebody who is plainly
    standing in the world:

      - onlinePlayers is read inside a try that returns 0 on a throw, so one
        bad read loses the whole list rather than one entry;
      - mp.get(id, 'profileId') has its own try that turns a throw into 0, and
        an actor part way through spawning throws there;
      - a chat line composed while the character is being moved or re-created
        arrives in the gap where the actor exists but is not yet listed.

    So the answer is remembered. Every successful sweep records it, and a
    sweep that finds nothing falls back to the last actor seen for that
    profile, confirmed by asking that actor who it belongs to. If the actor is
    gone the confirm throws and the fallback is dropped, so this cannot hand
    back a stale character: it only covers the gap where the sweep is blind and
    the actor is still there.
  */
  // On globalThis, so a hot reload does not forget who everybody was and put
  // the gap straight back.
  if (!globalThis.__thornswoodLastActor) { globalThis.__thornswoodLastActor = {}; }
  var lastActor = globalThis.__thornswoodLastActor;

  function actorOf(profileId) {
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { online = []; }
    for (var i = 0; i < online.length; i++) {
      var id = online[i];
      var pid = 0;
      try { pid = Number(mp.get(id, 'profileId')) || 0; } catch (e) { pid = 0; }
      if (pid === profileId) { lastActor[profileId] = id; return id; }
    }

    var had = lastActor[profileId];
    if (had) {
      var still = 0;
      try { still = Number(mp.get(had, 'profileId')) || 0; } catch (e) { still = 0; }
      if (still === profileId) { return had; }
      delete lastActor[profileId];
    }
    return 0;
  }

  /*
    A LINE TYPED WHILE THE CHARACTER IS ON ITS WAY BACK WAITS FOR IT.

    Patrick, 23 September: "Tried to do /give key so I could atleast test that
    way and it said it couldn't find my chacther". He was coming back from a
    deploy at the time.

    The remembered actor above was never going to help, and not because it
    was wrong. A deploy is a new process, so there is nothing remembered to
    fall back on. Measured in the dev server log for that evening: the
    gamemode loaded at 20:39:00.541 and his character came in at 20:39:47.177;
    loaded at 20:44:04.992, in at 20:44:52.111. About 47 seconds both times.
    The voice service is its own process and keeps every slash line typed
    while the server is down, and the polls in those 47 seconds hand them over
    along with anything typed since, before there is a character to run them
    on. So each one was told "cannot find your character" by a server that was
    about to find it.

    So a line that needs a character and has none waits for one. Every tick
    the waiting lines are tried again, and the moment the sweep finds the
    character they run in the order they were typed. A new line from somebody
    who still has lines waiting goes behind them, so a /give then a /tp cannot
    swap places.

    NOTHING HERE WIDENS THE FALLBACK. A waiting line holds the text and never
    an actor, and it runs through handle() like any other line, which does the
    sweep again at that moment. A line kept with the actor it arrived with
    would be kept with exactly the character that no longer exists.

    BOUNDED BOTH WAYS, so nothing grows. A line waits at most HOLD_FOR, twice
    the 47 seconds measured, and is then answered exactly as it always was.
    One person can have HOLD_MAX lines waiting and the server HOLD_ALL, and a
    line past either is answered at once, the old way. The profile id is a
    claim the page makes about itself, so a page sending lines under a hundred
    made up ids is held to HOLD_ALL as well.

    What never waits: /help, and /tp with nothing after it, which need no
    character; a word this server does not answer, which gets its answer now;
    and the client's reports of a moment, /place, /burn and /chopped, because
    a minute later they describe a moment that has passed.
  */
  // On globalThis, so a hot reload keeps what was waiting. It is plain data,
  // the line and when it began to wait, so the reloaded handle() runs it.
  if (!g.__thornswoodHeld) { g.__thornswoodHeld = {}; }
  var held = g.__thornswoodHeld;
  var HOLD_FOR = 90000;
  var HOLD_MAX = 20;
  var HOLD_ALL = 200;
  // The client's reports of a moment, never kept for later (see runsNow).
  var MOMENTS = ['/place', '/burn', '/chopped', '/racemenu', '/racedown', '/tspicked'];
  // Lines from a chat connection that did not prove who it is, logged at most
  // this often per profile (#410).
  var unprovenSaid = {};
  var UNPROVEN_SAY_MS = 600000;
  // The words handle() refuses to anybody on no list (isPlaytester covers dev,
  // staff and admin too), before it ever asks for a character.
  var GATED_WORDS = ['/give', '/spawn', '/tp', '/goto', '/where', '/kick', '/freeze',
    '/unfreeze', '/bring', '/silence', '/unsilence', '/warn', '/spawnat', '/ban', '/unban', '/pk'];

  /* With thornswoodRequirePass on, no pass shown yet for this profile (#410). */
  function passHeld(profileId) {
    var h = g.__thornswoodPassHeld;
    return typeof h === 'function' && h(profileId);
  }

  function runsNow(word, parts) {
    if (word === '/help' || word === '/commands' ||
        word === '/restart' || word === '/shutdown') { return true; }
    if ((word === '/tp' || word === '/goto') && !parts.slice(1).join(' ').trim()) { return true; }
    if (word === '/place' || word === '/burn' || word === '/chopped') { return true; }
    // "The race menu is up" is a moment too, and one replayed a minute late
    // would hold the give up for somebody who has already left it.
    if (word === '/racemenu' || word === '/racedown') { return true; }
    // Kept by profile id, so it needs no character to run.
    if (word === '/modset') { return true; }
    return WORDS.indexOf(word) === -1;
  }

  function heldCount() {
    var n = 0;
    for (var k in held) {
      if (Object.prototype.hasOwnProperty.call(held, k)) { n += held[k].lines.length; }
    }
    return n;
  }

  /** Every line from the voice service, on its way to handle(). */
  function dispatch(cmd) {
    var profileId = Number(cmd && cmd.profileId) || 0;
    var parts = String((cmd && cmd.text) || '').trim().split(/\s+/);
    var word = parts[0].toLowerCase();
    // The launcher's join pass, from the front plugin (#937). Needs no
    // character and answers nothing; see the join pass block.
    if (word === '/joinpass') {
      var jp = g.__thornswoodJoinPass;
      if (jp && profileId) {
        try { jp.take(profileId, parts[1], Date.now()); } catch (eJp) { log('/joinpass failed:', eJp); }
      }
      return;
    }
    // NOTHING TRUSTS AN UNPROVEN NUMBER (#410). With thornswoodRequirePass
    // on, a line counts only from a relay connection whose join token the
    // voice service checked (cmd.proven): any other arrived under a number the
    // page picked for itself, and could be anybody's, so it is not run and
    // not answered (an answer would go to whoever really holds that number).
    // The pass above needs no such proof: it is checked against its own
    // signature and must name the profile it arrives under.
    var jpNow = g.__thornswoodJoinPass;
    var enforcing = false;
    try { enforcing = !!(jpNow && jpNow.requiring && jpNow.requiring()); } catch (eReq) { enforcing = true; }
    if (enforcing && profileId && cmd.proven !== true) {
      var sayKey = 'unproven ' + profileId;
      if (!unprovenSaid[sayKey] || Date.now() - unprovenSaid[sayKey] >= UNPROVEN_SAY_MS) {
        unprovenSaid[sayKey] = Date.now();
        log('not run: ' + word + ' under profile ' + profileId + ' from a chat connection that did not prove who it is (#410)');
      }
      return;
    }
    // The line at the menu while the world is full (#481), from the front
    // plugin: "/line" to wait or say they still are, "/line leave" to go,
    // "/line hand <profile>" to give the place to another of the same game's
    // characters. "/line gone" is the relay's own word that the connection
    // closed, and counts only when the relay marked it so (cmd.relay).
    // Needs no character; the place is the seats block's alone.
    if (word === '/line') {
      var seatsApi = g.__thornswoodSeats;
      if (seatsApi && profileId) {
        try {
          var sub = String(parts[1] || '').toLowerCase();
          if (sub === 'leave') { seatsApi.leave(profileId, seatsApi.liveHow()); }
          else if (sub === 'gone') { if (cmd.relay === true) { seatsApi.gone(profileId, Date.now(), seatsApi.liveHow()); } }
          else if (sub === 'hand') { seatsApi.hand(profileId, Number(parts[2]) || 0, Date.now(), seatsApi.liveHow()); }
          else { seatsApi.want(profileId, Date.now(), seatsApi.liveHow()); }
        } catch (eLine) { log('/line failed:', eLine); }
      }
      return;
    }
    // Are you still here (#1142), from the front plugin: "/afk active" and
    // "/afk here" are somebody at the game, "/afk out" is nobody. See the idle block.
    if (word === '/afk') {
      var idleApi = g.__thornswoodIdle;
      if (idleApi && profileId) {
        try { idleApi.heard(profileId, String(parts[1] || '').toLowerCase(), Date.now(), idleApi.liveHow()); }
        catch (eAfk) { log('/afk failed:', eAfk); }
      }
      return;
    }
    // A session that has not shown its pass yet (#410): its lines wait in the
    // same queue as a line waiting for its character, and run once the pass
    // is here. The client's reports of a moment are dropped rather than kept,
    // as they would describe a moment long gone. If the pass never comes the
    // join pass block ends the session, and what waited is dropped unrun.
    if (enforcing && profileId && passHeld(profileId)) {
      if (MOMENTS.indexOf(word) !== -1) { return; }
      var hq = held[profileId];
      if (!hq) {
        hq = held[profileId] = { lines: [], told: false };
        log('holding', word, 'for profile', profileId, 'until its launcher\'s pass arrives');
      }
      if (hq.lines.length >= HOLD_MAX || heldCount() >= HOLD_ALL) {
        log('dropped', word, 'for profile', profileId, ': no pass yet and the queue is full');
        return;
      }
      hq.lines.push({ cmd: cmd, at: Date.now() });
      return;
    }
    if (!profileId || runsNow(word, parts)) { handle(cmd); return; }

    // REFUSED NOW, NOT AFTER ARRIVAL. A word only a listed tier may run, from
    // somebody on no list, is refused by handle() before it needs a character.
    // Holding it told them "That will run as soon as you arrive" and then
    // refused it 90 seconds later, so the refusal goes first (codex sweep,
    // docs/GAMEMODE-COVERAGE.md).
    if (GATED_WORDS.indexOf(word) !== -1 && typeof isPlaytester === 'function' && !isPlaytester(profileId)) { handle(cmd); return; }

    var q = held[profileId];
    if (!q && actorOf(profileId)) { handle(cmd); return; }
    if ((q && q.lines.length >= HOLD_MAX) || heldCount() >= HOLD_ALL) { handle(cmd); return; }

    if (!q) {
      q = held[profileId] = { lines: [], told: false };
      log('holding', word, 'for profile', profileId, 'until the character is in the world');
    }
    q.lines.push({ cmd: cmd, at: Date.now() });
    // Said once, and never for the client's own lines: /face, a broken
    // lockpick and the load order report are not things anybody typed.
    if (!q.told && word !== '/face' && word !== '/tspicks' &&
        word !== '/loadorder' && word !== '/loadorderlight' && word !== '/racedown') {
      q.told = true;
      toProfile(profileId, 'Your character is not back in the world yet. That will run ' +
                           'as soon as you arrive.');
    }
  }

  /** Once a tick: run what can run now, and answer what has waited too long. */
  function drainHeld() {
    var now = Date.now();
    for (var key in held) {
      if (!Object.prototype.hasOwnProperty.call(held, key)) { continue; }
      var q = held[key];
      var run = [];
      // Waiting for the launcher's pass (#410): nothing runs until it is here,
      // and a line that waited too long is dropped, never run unproven.
      var noPass = passHeld(Number(key));
      if (actorOf(Number(key)) && !noPass) {
        run = q.lines;
        delete held[key];
        log('running', run.length, 'held line(s) for profile', key, 'after',
            Math.round((now - run[0].at) / 1000) + 's');
      } else {
        while (q.lines.length && now - q.lines[0].at >= HOLD_FOR) { run.push(q.lines.shift()); }
        if (!q.lines.length) { delete held[key]; }
        if (run.length && noPass) {
          log('dropped', run.length, 'held line(s) for profile', key, ': its launcher\'s pass never arrived');
          run = [];
        }
        if (run.length) { log('gave up on', run.length, 'held line(s) for profile', key); }
      }
      // Out of the queue before it runs, so a line that throws is not run
      // again on the next tick.
      for (var i = 0; i < run.length; i++) {
        try { handle(run[i].cmd); }
        catch (e) { log('held command threw:', e && e.stack ? e.stack : e); }
      }
    }
  }

  /** key -> where /tp sends staff: each town's start spot, and "<town> inn" for its inn (#2622). */
  function places() {
    var out = {};
    for (var d in PASSAGES) {
      var t = PASSAGES[d];
      if (!t) { continue; }
      // /tp <town> goes where a new character arrives, and /tp <town> inn
      // to the inn spot it used to be (#2622).
      if (t.start) {
        out[t.key] = { desc: t.start.desc, pos: t.start.pos, rot: t.start.rot,
                       town: t.town };
      }
      if (t.arrival) {
        out[t.key + ' inn'] = { desc: t.arrival.desc, pos: t.arrival.pos, rot: t.arrival.rot,
                                town: t.town + '\'s inn' };
      }
    }
    out.hall = { desc: HALL.desc, pos: HALL.pos, rot: HALL.rot, town: 'the creation hall' };
    return out;
  }

  /*
    ============ EVERY NAMED PLACE IN THE LOAD ORDER, NOT JUST NINE TOWNS ====

    Patrick, 22 September: "let's add it so we can tp to any city, town,
    stronghold, anwyehre that is nnamed and not just the main holds."

    THE NAMES ALREADY EXIST AND SO DO THE POSITIONS; nothing new is measured.
    BUILDING_NAME is 852 named places read out of the load order, and
    BUILDING_BY_DOOR is the 4,891 doors that lead into them. A door is a
    placed reference, so at run time it HAS a position and a cell, which is
    exactly what a teleport needs and is the one thing a cell descriptor on
    its own cannot give: dropping somebody at an arbitrary point inside an
    interior lands them in the geometry.

    THE OUTSIDE DOOR IS PREFERRED, deliberately. A building's doors come in
    pairs and either would work, but arriving at the street door means you can
    see where you have been sent and walk away from it. Arriving inside a
    locked room you have never seen is a worse answer even when it is the
    literal one.

    Built once and kept, because it walks 4,891 entries and reads a property
    per door. The map is the same for the life of the process.
  */
  var namedDoors = null;

  /*
    GROUPED BY BUILDING, NOT BY NAME, AND SEVEN HALLS OF THE DEAD ARE WHY.

    The first version keyed on the name alone, and the load order has SEVEN
    separate buildings all called exactly "Hall of the Dead", one per hold.
    They collapsed into a single entry whose door list was all seven mixed
    together, so the name matched exactly and sent whoever asked to whichever
    door happened to resolve first. Silently, and in a different hold.

    Caught by the harness asking whether an ambiguous name asks rather than
    guesses, which it did not. Worth saying plainly: the bug was not that the
    match was fuzzy, it was that a duplicate name looked unique.

    So a shared name is qualified by its hold, out of DATA.cellToHold and the
    capitals table, and both spellings are offered: "hall of the dead" now
    lists the seven, and "hall of the dead (whiterun)" goes straight there.
  */
  function buildNamedDoors() {
    if (namedDoors) { return namedDoors; }
    namedDoors = {};
    try {
      // One entry per BUILDING first, so two buildings with one name stay two.
      var byBuilding = {};
      for (var door in BUILDING_BY_DOOR) {
        if (!Object.prototype.hasOwnProperty.call(BUILDING_BY_DOOR, door)) { continue; }
        var building = BUILDING_BY_DOOR[door];
        if (!BUILDING_NAME[building]) { continue; }
        if (!byBuilding[building]) { byBuilding[building] = []; }
        if (byBuilding[building].length < 6) { byBuilding[building].push(door); }
      }

      // How many buildings share each name.
      var shared = {};
      for (var b1 in byBuilding) {
        if (!Object.prototype.hasOwnProperty.call(byBuilding, b1)) { continue; }
        var n1 = String(BUILDING_NAME[b1]).toLowerCase();
        shared[n1] = (shared[n1] || 0) + 1;
      }

      for (var b in byBuilding) {
        if (!Object.prototype.hasOwnProperty.call(byBuilding, b)) { continue; }
        var name = String(BUILDING_NAME[b]);
        var base = name.toLowerCase();
        var key = base;
        var shown = name;
        if (shared[base] > 1) {
          var town = holdTownOf(b);
          if (town) {
            shown = name + ' (' + town + ')';
            key = shown.toLowerCase();
          } else {
            /*
              Nothing to tell them apart by, so they are numbered and NONE of
              them keeps the plain name.

              Starting at 2 and leaving the first one on the bare name is the
              same bug in a smaller shape: the plain name would then resolve,
              exactly, to one of several, and that is the silent wrong answer
              this whole grouping exists to prevent. Numbered from one, the
              bare name matches nothing exactly and falls through to the
              listing, which asks.
            */
            var k = 1;
            do { key = base + ' ' + k; shown = name + ' ' + k; k++; }
            while (namedDoors[key]);
          }
        }
        if (namedDoors[key]) { continue; }
        namedDoors[key] = { name: shown, plain: base, doors: byBuilding[b] };
      }
    } catch (e) {
      log('could not index the named places for /tp:', e);
    }
    return namedDoors;
  }

  /*
    ============ EVERY ITEM AND EVERY CREATURE THIS SERVER ALREADY NAMES ====

    For /give and /spawn. Built once, out of the tables that were generated
    from the load order for other reasons, so there is no second list to keep
    in step with anything: the ore a vein gives, the plants, the crops, the
    fish, what a body carries, the recipe outputs, and the handful of items
    named as constants.

    An item this file has never named cannot be given. That is the honest
    limit of doing it without a new generated table, and it is a large limit
    in the right direction: several thousand things are named here.
  */
  var thingIndex = null;
  var beastIndex = null;

  function addThing(idx, name, desc) {
    if (!name || !desc) { return; }
    var key = String(name).toLowerCase();
    if (!idx[key]) { idx[key] = { name: String(name), desc: desc }; }
  }

  function buildThings() {
    if (thingIndex) { return thingIndex; }
    var idx = {};
    try {
      // Ores, by what the vein hands over rather than by the vein.
      for (var v in ORES_BY_BASE) {
        if (!Object.prototype.hasOwnProperty.call(ORES_BY_BASE, v)) { continue; }
        addThing(idx, ORES_BY_BASE[v].name, ORES_BY_BASE[v].ore);
      }
      // Plants, crops and water produce all hand over a named thing.
      var tables = [HARVESTS_BY_BASE, CROPS_BY_BASE, FISH_BY_BASE];
      for (var t = 0; t < tables.length; t++) {
        for (var k in tables[t]) {
          if (!Object.prototype.hasOwnProperty.call(tables[t], k)) { continue; }
          var row = tables[t][k];
          if (!row) { continue; }
          if (row.gives) {
            for (var gi = 0; gi < row.gives.length; gi++) {
              addThing(idx, row.gives[gi].name, row.gives[gi].item);
            }
          }
          /*
            'produce' is the field, and guessing it was 'item' cost every
            plant, crop and fish in the game.

            All three of those tables are generated with the same shape:
            { produce, name, rank }. The first version of this looked for
            'item' and 'crop', found neither, and quietly indexed nothing from
            any of them: /give nightshade answered "nothing called that" while
            109 plants sat in the table. Caught by asking for nightshade by
            name rather than by trusting the loop. 'item' is still read
            because the hunt table does use it.
          */
          if (row.produce && row.name) { addThing(idx, row.name, row.produce); }
          if (row.item && row.name) { addThing(idx, row.name, row.item); }
        }
      }
      // What a body carries.
      for (var h in HUNTS_BY_BASE) {
        if (!Object.prototype.hasOwnProperty.call(HUNTS_BY_BASE, h)) { continue; }
        var gives = HUNTS_BY_BASE[h].gives || [];
        for (var q = 0; q < gives.length; q++) { addThing(idx, gives[q].name, gives[q].item); }
      }
      // And the several thousand things anybody can make.
      for (var r in RECIPES_BY_ID) {
        if (!Object.prototype.hasOwnProperty.call(RECIPES_BY_ID, r)) { continue; }
        addThing(idx, RECIPES_BY_ID[r].name, RECIPES_BY_ID[r].out);
      }
      /*
        Every output and ingredient in recipes.json, owned or not. Patrick,
        25 September: "/give Iron Ingot it says Nothing called that".
        RECIPES_BY_ID holds only the recipes a profession owns, so the ingots,
        leather strips and everything else anybody may make, and every
        ingredient, were never named here. ITEM_NAMES is generated by
        scripts/dev/Build-ItemNameTable.js.
      */
      for (var nm in ITEM_NAMES) {
        if (!Object.prototype.hasOwnProperty.call(ITEM_NAMES, nm)) { continue; }
        addThing(idx, ITEM_NAMES[nm][0], ITEM_NAMES[nm][1]);
      }
      // The named constants, so a table's own name wins over a nickname.
      for (var c in ITEMS) {
        if (!Object.prototype.hasOwnProperty.call(ITEMS, c)) { continue; }
        addThing(idx, c, ITEMS[c]);
      }
      /*
        Then every named item in the load order, last, so nothing that already
        answered changes. Patrick, 27 September: "/give is an admin/tester
        command I should be able /give any item I like". ADMIN_ITEMS is
        generated by scripts/dev/Build-AdminNameTables.py, gold included.
      */
      for (var ai in ADMIN_ITEMS) {
        if (!Object.prototype.hasOwnProperty.call(ADMIN_ITEMS, ai)) { continue; }
        addThing(idx, ADMIN_ITEMS[ai][0], ADMIN_ITEMS[ai][1]);
      }
    } catch (e) {
      log('could not index the items for /give:', e);
    }
    thingIndex = idx;
    return thingIndex;
  }

  function buildBeasts() {
    if (beastIndex) { return beastIndex; }
    var idx = {};
    try {
      // The hunt table is keyed BY THE CREATURE's own base record, which is
      // exactly what createActor wants.
      for (var b in HUNTS_BY_BASE) {
        if (!Object.prototype.hasOwnProperty.call(HUNTS_BY_BASE, b)) { continue; }
        addThing(idx, HUNTS_BY_BASE[b].name, b);
      }
      for (var g in GAME_BY_BASE) {
        if (!Object.prototype.hasOwnProperty.call(GAME_BY_BASE, g)) { continue; }
        addThing(idx, GAME_BY_BASE[g].name, g);
      }
      /*
        Then every named actor in the load order: trolls, giants, skeletons,
        draugr, dragons and people. Patrick, 27 September: "/span any npc I
        like not just animals but trolls, giants, skeletons, etc".
        ADMIN_ACTORS is generated by scripts/dev/Build-AdminNameTables.py.
      */
      for (var aa in ADMIN_ACTORS) {
        if (!Object.prototype.hasOwnProperty.call(ADMIN_ACTORS, aa)) { continue; }
        addThing(idx, ADMIN_ACTORS[aa][0], ADMIN_ACTORS[aa][1]);
      }
    } catch (e) {
      log('could not index the creatures for /spawn:', e);
    }
    beastIndex = idx;
    return beastIndex;
  }

  /*
    One name out of an index, or a reason.

    The same shape as findPlace and for the same reason: an exact name wins,
    part of a name is enough when it picks out one thing, and several matches
    are listed rather than chosen between. Handing somebody the wrong sword is
    cheap; teaching them the command lies is not.
  */
  function findIn(idx, want, kind) {
    if (Object.prototype.hasOwnProperty.call(idx, want)) { return idx[want]; }
    var hits = [];
    for (var key in idx) {
      if (!Object.prototype.hasOwnProperty.call(idx, key)) { continue; }
      if (key.indexOf(want) !== -1) { hits.push(key); }
      if (hits.length > 14) { break; }
    }
    if (!hits.length) { return { why: 'Nothing called that. This server knows ' + kind + ' by the names in its own tables.' }; }
    if (hits.length === 1) { return idx[hits[0]]; }
    var names = [];
    for (var i = 0; i < hits.length && i < 12; i++) { names.push(idx[hits[i]].name); }
    return { why: 'Which one: ' + names.join(', ') + (hits.length > 12 ? ', and more' : '') + '.' };
  }

  /*
    A plural or a curly apostrophe is still the same thing: "/give iron
    ingots 5" and a curly apostrophe typed on a phone find Iron Ingot and Nord Hero's
    Bow. The name as typed is tried first, so nothing that worked changes.
  */
  function findThing(want) {
    var idx = buildThings();
    var w = String(want).replace(/[\u2018\u2019`]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
    var hit = findIn(idx, w, 'items');
    if (!hit.desc && /s$/.test(w)) {
      var one = findIn(idx, w.replace(/(es|s)$/, ''), 'items');
      if (one.desc) { return one; }
      one = findIn(idx, w.replace(/s$/, ''), 'items');
      if (one.desc) { return one; }
    }
    return hit;
  }
  (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodResolveItem = function (name) {
    var hit = findThing(name);
    if (!hit || !hit.desc) { return { error: (hit && hit.why) || 'That item is not known.' }; }
    var id = 0;
    try { id = idOf(hit.desc); } catch (e) { id = 0; }
    if (!id || id === 15) { return { error: 'That item is not known.' }; }
    return { name: hit.name || String(name), baseId: id };
  };

  function findBeast(want) { return findIn(buildBeasts(), want, 'creatures'); }
  /*
    A creature's name from its base record, for /despawn's answer, or ''.
    Read out of the /spawn index (buildBeasts), the one reader of
    ADMIN_ACTORS (test-one-mint.js), so a record is turned into the name
    /spawn knows it by and nothing else reads that table.
  */
  function beastName(desc) {
    if (!desc) { return ''; }
    var idx = buildBeasts();
    for (var k in idx) {
      if (Object.prototype.hasOwnProperty.call(idx, k) && idx[k].desc === desc) { return idx[k].name; }
    }
    return '';
  }

  /*
    Any record by its form id, for the things with no name: "/spawn 23aba",
    or "/give 12eb7:Skyrim.esm". Asked only after the names, and only for
    something with a digit in it, so no name is ever taken for an id. A bare
    id is a Skyrim.esm one, and it has to resolve in this load order.
  */
  function byFormId(want) {
    var m = /^(?:0x)?([0-9a-f]{1,6})(?::(\S+\.es[mpl]))?$/i.exec(String(want).trim());
    // A digit in it, so a name like bed or cab is never taken for an id.
    if (!m || !/[0-9]/.test(m[1])) { return null; }
    // What was typed arrives lower-cased, and a record's plugin is named
    // the way the load order spells it.
    var file = m[2] || 'Skyrim.esm';
    var masters = ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'];
    for (var mi = 0; mi < masters.length; mi++) {
      if (masters[mi].toLowerCase() === file.toLowerCase()) { file = masters[mi]; }
    }
    var desc = parseInt(m[1], 16).toString(16) + ':' + file;
    var id = 0;
    try { id = idOf(desc); } catch (e) { id = 0; }
    return id ? { name: desc, desc: desc } : null;
  }

  /** The town a building's hold is named after, or ''. */
  function holdTownOf(buildingDesc) {
    try {
      var hold = DATA.cellToHold[buildingDesc];
      if (!hold) { return ''; }
      var cap = DATA.capitals[hold];
      return (cap && cap.town) ? String(cap.town) : '';
    } catch (e) { return ''; }
  }

  /*
    Where a named place actually is, asked of the world rather than a table.

    Every door is tried in turn and the first one that resolves to a real
    position wins, with an OUTSIDE door preferred over an inside one. A door
    in a plugin that is not in this load order simply answers 0 from idOf and
    is skipped, which is how this stays correct when the collection changes
    without anybody maintaining a second list.
  */
  function namedPlace(key) {
    var entry = buildNamedDoors()[key];
    if (!entry) { return null; }
    var inside = null;
    for (var i = 0; i < entry.doors.length; i++) {
      var id = 0;
      try { id = idOf(entry.doors[i]); } catch (e) { id = 0; }
      if (!id) { continue; }
      var pos = null, cell = '';
      try {
        pos = mp.get(id, 'pos');
        cell = String(mp.get(id, 'worldOrCellDesc') || '');
      } catch (e) { continue; }
      if (!pos || !cell) { continue; }
      var found = { desc: cell, pos: [pos[0], pos[1], pos[2]], rot: [0, 0, 0],
                    town: entry.name };
      // An interior cell is the building itself; anything else is the street.
      if (!Object.prototype.hasOwnProperty.call(BUILDING_NAME, cell)) { return found; }
      if (!inside) { inside = found; }
    }
    return inside;
  }

  /*
    What somebody typed, against the towns first and then every named place.

    Exact match wins outright. Otherwise anything containing the words, which
    is how "bannered" finds The Bannered Mare without anybody having to know
    the article. Several matches are listed rather than guessed between:
    sending somebody to the wrong Hall of the Dead is worse than asking.
  */
  function findPlace(want) {
    var table = places();
    if (Object.prototype.hasOwnProperty.call(table, want)) {
      return { where: table[want] };
    }
    var named = buildNamedDoors();
    if (Object.prototype.hasOwnProperty.call(named, want)) {
      var exact = namedPlace(want);
      return exact ? { where: exact }
                   : { why: named[want].name + ' is in the load order but the server ' +
                            'cannot find a door into it, so there is nowhere to stand.' };
    }
    var hits = [];
    for (var key in named) {
      if (!Object.prototype.hasOwnProperty.call(named, key)) { continue; }
      if (key.indexOf(want) !== -1) { hits.push(key); }
      if (hits.length > 12) { break; }
    }
    if (!hits.length) {
      return { why: 'No place called that. Try a town, or part of a building\'s name: ' +
                    'bannered, jorrvaskr, understone.' };
    }
    if (hits.length === 1) {
      var one = namedPlace(hits[0]);
      return one ? { where: one }
                 : { why: named[hits[0]].name + ' has no door the server can find.' };
    }
    var names = [];
    for (var h = 0; h < hits.length && h < 10; h++) { names.push(named[hits[h]].name); }
    return { why: 'Which one: ' + names.join(', ') +
                  (hits.length > 10 ? ', and more' : '') + '.' };
  }

  function round1(v) { return Math.round(Number(v) * 10) / 10; }

  /*
    The journal verbs, which the J panel speaks.

    Patrick asked for "multiple journals, pages inside them, and sharing
    either a whole journal or a single page with a friend", so the shape is
    journal, page, share, and the panel sends exactly these lines rather than
    having a protocol of its own. That is the same choice the K panel made
    with /pick: one way in. Nobody is told to type them and no help names
    them (Patrick, 4 Oct: buttons, not commands; #1630).

    The separator is two colons because a page has a title and a body and a
    body has newlines in it, and the chat socket is line based. Everything
    after the first :: is the page.
  */
  var journalFullSaid = {};
  var FULL_SAY_MS = 10000;
  function journalCommand(soc, actorId, profileId, parts) {
    var verb = String(parts[1] || '').toLowerCase();
    var s = soc.stateOf(actorId);

    if (!verb || verb === 'list') {
      if (!s.journals.length) { return 'No journals yet. J opens them, and New journal starts one.'; }
      var names = [];
      for (var i = 0; i < s.journals.length; i++) {
        names.push(s.journals[i].title + ' (' + s.journals[i].pages.length + ')');
      }
      return 'Journals: ' + names.join(', ');
    }

    if (verb === 'new') {
      var made = soc.newJournal(actorId, parts.slice(2).join(' '));
      // The full refusal is said once a FULL_SAY_MS per character rather than
      // once per press (#2037).
      if (made.full) {
        var fullAt = journalFullSaid[actorId] || 0;
        if (Date.now() - fullAt < FULL_SAY_MS) { return ''; }
        journalFullSaid[actorId] = Date.now();
      }
      return made.why || ('Started ' + made.journal.title + '.');
    }

    if (verb === 'drop') {
      return soc.dropJournal(actorId, String(parts[2] || '')) ? 'Thrown away.' : 'No such journal.';
    }

    if (verb === 'page') {
      var line = parts.slice(2).join(' ');
      var cut = line.indexOf('::');
      var head = (cut === -1 ? line : line.slice(0, cut)).trim().split(/\s+/);
      var body = cut === -1 ? '' : line.slice(cut + 2);
      var jid = head.shift() || '';
      var pid = head.shift() || '-';
      var title = head.join(' ');
      /*
        THE CHANNEL IS LINE BASED, so the panel sends a page's newlines as the
        two characters backslash n and they are put back here. A page with
        paragraphs in it would otherwise arrive as several chat lines and the
        second one would be read as a command.
      */
      var why = soc.writePage(actorId, jid, pid === '-' ? '' : pid, title,
                              body.split('\\n').join('\n'));
      return why || '';
    }

    if (verb === 'title') {
      var s3 = soc.stateOf(actorId);
      var b3 = soc.findJournal(s3, String(parts[2] || ''));
      if (!b3) { return 'No such journal.'; }
      var want = parts.slice(3).join(' ').trim();
      if (!want) { return 'Call it what?'; }
      b3.title = want.slice(0, 60);
      soc.write(actorId, s3);
      return '';
    }

    if (verb === 'share' || verb === 'unshare') {
      var jid2 = String(parts[2] || '');
      var pid2 = String(parts[3] || '-');
      var who = parts.slice(4).join(' ').trim();
      var s2 = soc.stateOf(actorId);
      var book = soc.findJournal(s2, jid2);
      if (!book) { return 'No such journal.'; }

      if (verb === 'unshare') {
        if (pid2 === '-') { book.shared = {}; }
        else {
          for (var p = 0; p < book.pages.length; p++) {
            if (book.pages[p].id === pid2) { book.pages[p].shared = {}; }
          }
        }
        soc.write(actorId, s2);
        return 'Not shared any more.';
      }

      var resolved = soc.resolveShare(actorId, who);
      if (!resolved.pid) { return resolved.why || 'Share with which friend?'; }
      var refused = soc.share(actorId, jid2, pid2 === '-' ? '' : pid2, resolved.pid);
      if (refused) { return refused; }
      var there = soc.actorForProfile(resolved.pid);
      if (there) {
        try {
          say(there, soc.nameOfPerson(actorId) + ' shared ' +
              (pid2 === '-' ? 'a journal' : 'a page') + ' with you. Press J.');
        } catch (e) { }
      }
      // The name they are on now, then the one the list kept (#1695).
      var fname = there ? soc.nameOfPerson(there) : (soc.stateOf(actorId).friends[resolved.pid] || {}).name;
      return 'Shared with ' + (fname || 'them') + '.';
    }

    return 'journal: new, title, page, share, unshare, drop, list.';
  }

  /*
    WHERE THE HELP IS, and the commands people still type (#1633). The answer
    to /help and /commands, and the end of the answer to a word nobody has.

    The help panel's key is HelpKey in Thornswood.ini, 65 by default, which is
    F7; the server cannot see a rebind, so it names the default and says where
    it moves. tests/test-1633-help-panel.js holds the F7 here to the ini, the
    in-game Settings panel and the plugin. The commands are PLAYER_WORDS, the one list,
    and nothing else. A tester or dev is told their own as well, and nobody
    else is: naming /tp to somebody it then refuses was the first thing a new
    person learned about this server.
  */
  function helpLine(profileId) {
    return 'Help is a panel: F7 opens it, unless you moved it on Settings in ' +
           'the game, and so does Help on the K, P or J panel. Typed in the ' +
           'chat: ' + PLAYER_WORDS.join(', ') + '.' +
           (isPlaytester(profileId)
             ? ' You are ' + roleOf(profileId) + ': /tp <place> moves you and /tp on ' +
               'its own lists the places, /give and /spawn make things, and /where ' +
               'says where you stand.'
             : '');
  }

  function handle(cmd) {
    var profileId = Number(cmd.profileId) || 0;
    if (!profileId) { return; }

    var parts = String(cmd.text || '').trim().split(/\s+/);
    var word = parts[0].toLowerCase();
    var arg = (parts[1] || '').toLowerCase();

    // The plugin, not a person: the race menu just closed on this client.
    // Answered with nothing, whatever the state, and never echoed.
    if (word === '/face') {
      try {
        var cg = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodChargen;
        var faceActor = actorOf(profileId);
        if (cg && cg.faceDone && faceActor) { cg.faceDone(faceActor); }
      } catch (eFace) { log('/face failed:', eFace); }
      return;
    }

    // The plugin, not a person: the race menu is on screen on this client,
    // said when it opens and once a minute while it stays. Answered with
    // nothing, like /face. A different word from /face ON PURPOSE: a gamemode
    // from before this reads any /face as the menu closing and would push the
    // panel over the race menu the moment it opened. An unknown word only
    // earns a "no command called" line, which is harmless and says which half
    // is out of date.
    if (word === '/racemenu') {
      try {
        var cgUp = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodChargen;
        var upActor = actorOf(profileId);
        if (cgUp && cgUp.faceOpen && upActor) { cgUp.faceOpen(upActor); }
      } catch (eUp) { log('/racemenu failed:', eUp); }
      return;
    }

    // The plugin, not a person: the race menu went down with the game
    // (F10 / quit). Not /face done: a half-made face is not finished.
    // A different word so a gamemode from before this only says "no
    // command called", which is harmless.
    if (word === '/racedown') {
      try {
        var cgDown = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodChargen;
        var downActor = actorOf(profileId);
        if (cgDown && cgDown.faceDown && downActor) { cgDown.faceDown(downActor); }
      } catch (eDown) { log('/racedown failed:', eDown); }
      return;
    }

    /*
      A missing character no longer refuses every command.

      This used to stop the dispatcher before it had read the word, so a lookup
      that came back empty answered "The server cannot find your character
      right now" to /help and to /tp with no argument, neither of which needs a
      character at all. Now the commands that need one say so where they need
      it, and the message says what to do about it.
    */
    var actorId = actorOf(profileId);

    // The plugin, not a person: mod settings menu values that changed on this
    // client. Kept by the mod settings block; answered with nothing.
    if (word === '/modset') {
      var mods = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodModSettings;
      if (mods) {
        try { mods.command(profileId, actorId, parts); } catch (eMods) { log('/modset failed:', eMods); }
      }
      return;
    }

    function needCharacter() {
      if (actorId) { return true; }
      toProfile(profileId,
        'The server cannot find your character right now. Give it a moment and ' +
        'try again; if it keeps saying that, say so and what you were doing.');
      return false;
    }

    // A lockpick that broke in somebody's game.
    //
    // Not a human command. The plugin sends it, so it answers nothing, says
    // nothing back, and is deliberately absent from the help text.
    //
    // The server owns the pack. Skyrim destroys the pick in the person's own
    // game and the server never hears about it, so the next inventory re-apply
    // hands it straight back. That is why picks were endless and why a lock
    // could be worked forever. There is no message for this: all 34 types in
    // the protocol were read and none of them say an item was destroyed, so
    // the only route a fact has from a person's game to here is this queue.
    //
    // The profile id is the one the voice service stamped from the connection
    // rather than a number in the text, so the worst a modified client can do
    // with this is throw away its own lockpicks. It is capped anyway, and
    // takeItem refuses when the pack does not hold that many.
    // Profession, class and the tree. The character block owns these
    // words; it gets the same actor and profile id this function has.
    try {
      var charCmd = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodCharacter;
      if (charCmd && charCmd.command(word, parts, actorId, profileId, toProfile, cmd)) { return; }
    } catch (eChar) { log('character command failed:', eChar); }

    /*
      One fall of the axe, reported by the client. See choppedSwing.

      Nothing is ever said back for an ordinary swing, whether it was credited
      or refused: this arrives once or twice a second while somebody chops, and
      a line per swing is the spam Patrick asked to be rid of in the first
      place. The rank line and the tool warning still come through, because
      choppedSwing answers them the same way a press does.
    */
    /*
      ------------------------------------------------- hunger, thirst, rest

      The world hooks replaced the words that drove the needs block, as they
      were always meant to (#1631): eating and drinking is the item (the
      engine's mp.onEatItem, #3136), the meters are the four bars and the
      Body page on K, and the bard is somebody the needs block sees playing
      on the emote wheel.

      /rest    sent by the plugin when somebody sits or lies down, and
               /rest up when they get off; never typed (#1603). What counts
               is what the server saw them press; see "beds" in the property
               block.
    */
    /*
      NOT A COMMAND ANYBODY TYPES. The client reports where somebody is
      standing, as far as temperature cares: fire, indoors, rain, snow, water.
      The server cannot know any of it, the same way it cannot see the axe
      fall at a chopping block, so it is told. Registered in WORDS so the
      dispatcher answers it, and kept out of PLAYER_WORDS so /help never
      invites anybody to type it.
    */
    if (word === '/place') {
      var pl = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodNeeds;
      if (pl && pl.place && actorId) {
        // kind, the weather's form id in hex, night, roof, height. Everything
        // after the word is optional: a client from before the weather half
        // existed sends the word alone and simply has no wind.
        try {
          pl.place(actorId, String(parts[1] || ''), parts[2], parts[3],
                   parts[4], parts[5], parts[6]);
        } catch (e) { }
      }
      return true;
    }

    /*
      The client saying it is on fire, so the server can pass it on.

      Not something anybody types, the same as /place: the server cannot see a
      fire and the client cannot see who is standing next to it, so each end
      reports the half it can. Kept out of PLAYER_WORDS for the same reason,
      and typing it by hand sets you alight, which is its own answer.
    */
    if (word === '/burn') {
      var bn = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodNeeds;
      if (bn && bn.setBurning && actorId) {
        try { bn.setBurning(actorId, String(parts[1] || '') === '1'); } catch (e) { }
      }
      /*
        AND THE SAME TWO REPORTS TIME THE FIRE, so a fire that dealt 30 or
        more is a bad burn afterwards (#1383). See burning() in the injury
        and disease block.
      */
      var burnt = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodHurt;
      if (burnt && burnt.burning && actorId) {
        try {
          var burnLine = burnt.burning(actorId, String(parts[1] || '') === '1');
          if (burnLine) { toProfile(profileId, burnLine); }
        } catch (e) { log('/burn could not time the fire:', e); }
      }
      return true;
    }

    /*
      A carriage or ferry (#1394). Sent by the front plugin as /ride e <id>
      when somebody presses E on a driver, and as /ride and the stop by the
      ride panel's buttons (#1635); nobody types it. The carriages block
      answers it, and takes the fare onto the hold's ledger.
    */
    if (word === '/ride') {
      var rides = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodCarriages;
      if (!rides) { toProfile(profileId, 'That is not running on this server.'); return true; }
      try { rides.command(parts, actorId, profileId, toProfile); } catch (eRide) {
        log('/ride threw:', eRide);
        toProfile(profileId, 'That did not work. Say so in the dev channel.');
      }
      return true;
    }

    /*
      The embassy roll and the remnant roll (#1390). Staff commands: an admin
      writes both, and nobody else is told to type them. The embassy and
      remnant block, after the property block, answers.
    */
    if (word === '/embassy' || word === '/remnant') {
      var accord = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodEmbassy;
      if (!accord) { toProfile(profileId, 'That is not running on this server.'); return true; }
      try { accord.command(word, parts, actorId, profileId, toProfile); } catch (eAccord) {
        log(word + ' threw:', eAccord);
        toProfile(profileId, 'That did not work. Say so in the dev channel.');
      }
      return true;
    }

    /*
      ------------------------------------------- friends, parties and mutes

      Patrick, 22 September: "when you look at someone, you are prompted to
      press buttons: one for friend, one for trade, and one for mute... I just
      want to press a key while looking at them."

      EVERY ONE OF THESE TAKES A FORM ID OR A NAME, and the form id is the one
      that matters. A key press while looking at somebody sends the hex form
      id of whatever is under the crosshair, which is exact. A typed name
      still answers, and it refuses an ambiguous one rather than guessing
      which Bjorn was meant.

      NOBODY IS TOLD TO TYPE /friend, /trade, /mute, /hidename, /yes and /no
      (#1628; Patrick, 4 October: "no more commands for things [people] do").
      Y, H and L on the look prompt, the P panel's Near you, Friends and
      Muted and hidden lists, the trade window and the prompt's Accept and
      Refuse send them, so they are in WORDS and not in PLAYER_WORDS.
    */
    if (word === '/merchant') {
      /*
        E on a person is also the first errand's Cook (#3166), whether or not
        trading is running: the first steps block answers the Cook's words
        for the one Cook of their errand, in reach, and nothing for anybody else.
      */
      var stepsApi = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodFirstSteps;
      if (actorId && stepsApi && stepsApi.spoke && String(parts[1] || '').toLowerCase() === 'e') {
        var cookLine = null;
        try { cookLine = stepsApi.spoke(actorId, parseInt(String(parts[2] || ''), 16) || 0); }
        catch (eSteps) { log('first steps threw at a press on', parts[2], ':', eSteps); }
        if (cookLine) { toProfile(profileId, cookLine); }
      }
      var merchants = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodMerchantTrade;
      if (!merchants) { toProfile(profileId, 'That is not running on this server.'); return true; }
      if (!actorId) { toProfile(profileId, 'You are not in the world yet.'); return true; }
      var merchantAnswer = merchants.command({ actorId: actorId, profileId: profileId, parts: parts });
      if (merchantAnswer && merchantAnswer.view && merchants.push) {
        try { merchants.push(actorId, merchantAnswer.view); } catch (eMerchant) { }
      }
      if (merchantAnswer && merchantAnswer.text) { toProfile(profileId, merchantAnswer.text); }
      return true;
    }

    if (word === '/ship') {
      var shipsApi = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodTradeShips;
      if (!shipsApi || !shipsApi.command) { toProfile(profileId, 'Trade ships are not running on this server.'); return true; }
      if (!actorId) { toProfile(profileId, 'You are not in the world yet.'); return true; }
      var shipSaid = shipsApi.command(parts, actorId, profileId);
      if (shipSaid) { toProfile(profileId, shipSaid); }
      return true;
    }

    if (word === '/stall') {
      var stallsApi = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodStalls;
      if (!stallsApi || !stallsApi.command) { toProfile(profileId, 'Market stalls are not running on this server.'); return true; }
      if (!actorId) { toProfile(profileId, 'You are not in the world yet.'); return true; }
      var stallSaid = stallsApi.command(parts, actorId, profileId, cmd);
      if (stallSaid) { toProfile(profileId, stallSaid); }
      return true;
    }

    if (word === '/cart') {
      var cartsApi = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodTradeCarts;
      if (!cartsApi || !cartsApi.command) { toProfile(profileId, 'Trade carts are not running on this server.'); return true; }
      if (!actorId) { toProfile(profileId, 'You are not in the world yet.'); return true; }
      var cartSaid = cartsApi.command(parts, actorId, profileId);
      if (cartSaid) { toProfile(profileId, cartSaid); }
      return true;
    }

    if (word === '/book') {
      var booksApi = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodBooks;
      if (!booksApi) { toProfile(profileId, 'That is not running on this server.'); return true; }
      if (!actorId) { toProfile(profileId, 'You are not in the world yet.'); return true; }
      var bookAnswer = booksApi.command({ actorId: actorId, profileId: profileId, parts: parts });
      if (bookAnswer) { toProfile(profileId, bookAnswer); }
      return true;
    }

    if (word === '/friend' || word === '/party' || word === '/mute' ||
        word === '/hidename' || word === '/trade' || word === '/journal' ||
        word === '/yes' || word === '/no') {
      var soc = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodSocial;
      if (!soc) { toProfile(profileId, 'That is not running on this server.'); return true; }
      if (!actorId) { toProfile(profileId, 'You are not in the world yet.'); return true; }
      var mine = soc.profileOf(actorId);
      var rest = parts.slice(1).join(' ').trim();

      /* Say yes to whatever is standing. One word for all three offers,
         because somebody being asked does not care which system asked. */
      if (word === '/yes' || word === '/no') {
        var o = soc.standingOffer(mine);
        if (!o) { toProfile(profileId, 'Nobody has asked you anything.'); return true; }
        delete soc.offers[mine];
        var themActor = soc.actorForProfile(o.from);
        if (word === '/no') {
          if (o.kind === 'book') {
            var booksNo = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodBooks;
            if (booksNo) { booksNo.decline(mine); }
          }
          toProfile(profileId, 'You turned ' + o.fromName + ' down.');
          if (themActor) { say(themActor, soc.nameOfPerson(actorId) + ' said no.'); }
          return true;
        }
        /* A book invite stands for 45 seconds even if the person who asked
           has walked off. The book is the group's, not theirs. */
        if (o.kind === 'book') {
          var booksYes = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodBooks;
          if (!booksYes) { toProfile(profileId, 'That is not running on this server.'); return true; }
          var joinedBook = booksYes.accept(mine, soc.nameOfPerson(actorId));
          toProfile(profileId, (joinedBook && joinedBook.text) || 'That offer has gone.');
          if (joinedBook && joinedBook.ok && themActor) {
            say(themActor, soc.nameOfPerson(actorId) + ' joined your book.');
          }
          soc.push(actorId);
          return true;
        }
        if (!themActor) { toProfile(profileId, o.fromName + ' has gone.'); return true; }
        if (o.kind === 'friend') {
          /* BOTH SIDES, because a friends list with one name in it is a
             follower list. Somebody who said yes is a friend of the person
             who asked and the other way round, and unfriending is one sided
             on purpose: you can drop somebody without telling them. */
          soc.addFriend(actorId, themActor);
          soc.addFriend(themActor, actorId);
          toProfile(profileId, 'You and ' + o.fromName + ' are friends.');
          say(themActor, soc.nameOfPerson(actorId) + ' accepted. You are friends.');
        } else if (o.kind === 'party') {
          var joined = soc.joinParty(o.from, mine);
          if (joined) { toProfile(profileId, joined); return true; }
          toProfile(profileId, 'You joined ' + o.fromName + "'s party.");
          say(themActor, soc.nameOfPerson(actorId) + ' joined your party.');
        } else if (o.kind === 'trade') {
          var tr = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodTrade;
          if (!tr || !tr.begin) { toProfile(profileId, 'Trading is not running on this server.'); return true; }
          var started = tr.begin(themActor, actorId);
          if (started) { toProfile(profileId, started); return true; }
        } else if (o.kind === 'dye') {
          /* Somebody offered to dye this person's hair (#2675). The hair dye
             block checks it all again and makes the one write. */
          var hdYes = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodHairDye;
          if (!hdYes || !hdYes.accept) { toProfile(profileId, 'Hair dye is not running on this server.'); return true; }
          var dyed = hdYes.accept(actorId, themActor, o);
          toProfile(profileId, dyed.them);
          if (dyed.dyer) { say(themActor, dyed.dyer); }
        } else if (o.kind === 'apprentice') {
          /* A Master offered to take this person on (#1388). The character
             block holds the record, so it checks again and writes both. */
          var chAp = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodCharacter;
          if (!chAp || !chAp.acceptApprentice) { toProfile(profileId, 'That is not running on this server.'); return true; }
          var tookOn = chAp.acceptApprentice(actorId, themActor, o);
          toProfile(profileId, tookOn.learner);
          if (tookOn.master) { say(themActor, tookOn.master); }
        }
        soc.push(actorId);
        if (themActor) { soc.push(themActor); }
        return true;
      }

      if (word === '/journal') {
        var jr = journalCommand(soc, actorId, profileId, parts);
        if (jr) { toProfile(profileId, jr); }
        soc.push(actorId);
        return true;
      }

      /* /party with nothing after it is about your own party rather than
         about somebody else, so those two go first.

         Every /party line is sent by P on somebody (an ask with their form
         id) or by a button on the P panel (leave, disband, kick, lead, and an
         ask beside a friend). Nobody is told to type one (#1629). */
      // Opening or mounting a panel requests its owner's current view (#1275).
      if (word === '/party' && rest === 'refresh') {
        soc.push(actorId, true);
        return true;
      }
      if (word === '/party' && (rest === '' || rest === 'list')) {
        var pp = soc.partyOf(mine);
        if (!pp) { toProfile(profileId, 'You are not in a party. Look at somebody and press the party key to ask them.'); return true; }
        var names = [];
        for (var pi = 0; pi < pp.members.length; pi++) {
          var pa = soc.actorForProfile(pp.members[pi]);
          names.push(pa ? soc.nameOfPerson(pa) : 'somebody offline');
        }
        toProfile(profileId, 'Your party: ' + names.join(', ') +
                  '. ' + soc.partyNear(actorId) + ' of them here with you.');
        return true;
      }
      if (word === '/party' && rest === 'leave') {
        if (soc.leaveParty(mine)) { toProfile(profileId, 'You left the party.'); }
        else { toProfile(profileId, 'You are not in a party.'); }
        soc.push(actorId);
        return true;
      }
      if (word === '/party' && rest === 'disband') {
        var ended = soc.disbandParty(mine);
        toProfile(profileId, ended || 'The party is ended.');
        soc.push(actorId);
        return true;
      }
      if (word === '/party' && (rest.indexOf('kick ') === 0 || rest.indexOf('lead ') === 0)) {
        var handing = rest.indexOf('lead ') === 0;
        var whom = rest.slice(5).trim();
        var member = soc.partyMember(actorId, whom);
        if (!member.pid) { toProfile(profileId, member.why); return true; }
        var did = handing ? soc.leadParty(mine, member.pid) : soc.kickParty(mine, member.pid);
        toProfile(profileId, did || (handing ? 'They lead the party now.' : 'They left the party.'));
        soc.push(actorId);
        return true;
      }
      if (word === '/friend' && (rest === '' || rest === 'list')) {
        var sv = soc.view(actorId);
        if (!sv.friends.length) { toProfile(profileId, 'No friends yet. Look at somebody and press the friend key.'); return true; }
        var line = [];
        for (var fi = 0; fi < sv.friends.length; fi++) {
          line.push(sv.friends[fi].name + (sv.friends[fi].on ? '' : ' (away)'));
        }
        toProfile(profileId, 'Friends: ' + line.join(', '));
        return true;
      }
      if (word === '/mute' && (rest === '' || rest === 'list')) {
        var sm = soc.stateOf(actorId);
        var mn = [];
        var tn = [];
        for (var mk in sm.muted) {
          if (!Object.prototype.hasOwnProperty.call(sm.muted, mk)) { continue; }
          mn.push(typeof sm.muted[mk] === 'string' ? sm.muted[mk] : mk);
        }
        for (var tk in (sm.textOff || {})) {
          if (!Object.prototype.hasOwnProperty.call(sm.textOff, tk)) { continue; }
          tn.push(typeof sm.textOff[tk] === 'string' ? sm.textOff[tk] : tk);
        }
        toProfile(profileId, (mn.length ? ('Muted: ' + mn.join(', ') + '. ') : 'You have nobody muted. ') +
                  (tn.length ? ('Text off: ' + tn.join(', ') + '.') : 'Nobody\'s text is off.'));
        return true;
      }
      if (word === '/mute' && rest.indexOf('text ') === 0) {
        var textWho = soc.resolveKnown(actorId, rest.slice(5).trim());
        if (!textWho.pid) { toProfile(profileId, textWho.why); return true; }
        var textOn = soc.toggleText(actorId, textWho.pid, textWho.name);
        toProfile(profileId, textOn ? ('You will not read ' + textWho.name + '.')
                                    : ('You will read ' + textWho.name + ' again.'));
        soc.push(actorId);
        return true;
      }
      if (word === '/hidename' && (rest === '' || rest === 'list')) {
        var hn = soc.stateOf(actorId);
        var nn = [];
        for (var nk in (hn.namesOff || {})) {
          if (!Object.prototype.hasOwnProperty.call(hn.namesOff, nk)) { continue; }
          nn.push(typeof hn.namesOff[nk] === 'string' ? hn.namesOff[nk] : nk);
        }
        toProfile(profileId, (hn.namesAll ? 'Every name is hidden. ' : '') +
                  (nn.length ? ('Names hidden: ' + nn.join(', ') + '.') : 'No single name is hidden.'));
        return true;
      }
      if (word === '/hidename' && rest === 'all') {
        var allOn = soc.toggleNamesAll(actorId);
        toProfile(profileId, allOn ? 'Every name above a head is hidden.' : 'Names above heads are shown again.');
        soc.push(actorId);
        return true;
      }
      if (word === '/hidename') {
        var nameWho = soc.resolveKnown(actorId, rest);
        if (!nameWho.pid) { toProfile(profileId, nameWho.why); return true; }
        var nameOn = soc.toggleName(actorId, nameWho.pid, nameWho.name);
        toProfile(profileId, nameOn ? ('You will not see ' + nameWho.name + '\'s name.')
                                    : ('You will see ' + nameWho.name + '\'s name again.'));
        soc.push(actorId);
        return true;
      }
      /*
        A VOICE MUTE TAKES THE SAME PEOPLE AS TEXT AND A NAME (#1628): a
        friend, somebody standing here, or somebody already on your muted
        list, online or not. It is kept on the character the same as those
        two, and the P panel's Muted and hidden list has to be able to unmute
        somebody who has logged off.

        NO OFFER AND NO TELLING THEM. A mute is a decision about your own
        ears; asking permission to stop listening would be absurd, and
        telling somebody they have been muted turns it into an argument.
      */
      if (word === '/mute') {
        var muteWho = soc.resolveKnown(actorId, rest);
        if (!muteWho.pid) { toProfile(profileId, muteWho.why); return true; }
        var on = soc.toggleMute(actorId, muteWho.pid, muteWho.name);
        toProfile(profileId, on ? ('You muted ' + muteWho.name + '.') : ('You unmuted ' + muteWho.name + '.'));
        soc.push(actorId);
        return true;
      }

      /* Remove beside a friend on P sends their profile id (#1695), which is
         exact whatever name they are on now. The list keeps the name they had
         the day you became friends, so the name the row shows is not it. */
      if (word === '/friend' && /^remove [1-9][0-9]*$/.test(rest)) {
        var gonePid = Number(rest.slice(7));
        var sfp = soc.stateOf(actorId);
        if (!sfp.friends[gonePid]) { toProfile(profileId, 'They are not on your friends list.'); return true; }
        var goneActor = soc.actorForProfile(gonePid);
        var goneName = goneActor ? soc.nameOfPerson(goneActor) : String(sfp.friends[gonePid].name || 'That friend');
        soc.dropFriend(actorId, gonePid);
        toProfile(profileId, goneName + ' is no longer on your list.');
        soc.push(actorId);
        return true;
      }

      /* Taking somebody off a list does not need them to be standing there. */
      if (word === '/friend' && rest.indexOf('remove ') === 0) {
        var gone = rest.slice(7).trim().toLowerCase();
        var sf = soc.stateOf(actorId);
        var dropped = '';
        for (var fk in sf.friends) {
          if (!Object.prototype.hasOwnProperty.call(sf.friends, fk)) { continue; }
          var fname = String((sf.friends[fk] && sf.friends[fk].name) || '');
          if (fname.toLowerCase() === gone || fname.toLowerCase().indexOf(gone) === 0) {
            soc.dropFriend(actorId, Number(fk));
            dropped = fname;
            break;
          }
        }
        toProfile(profileId, dropped ? (dropped + ' is no longer on your list.') : 'Nobody on your list by that name.');
        soc.push(actorId);
        return true;
      }

      /*
        A trade that is already open takes verbs rather than a name.

        add, remove, gold, ok and cancel, and the panel sends exactly the same
        lines, the same way the J panel sends /journal. One way in.
      */
      if (word === '/trade') {
        var tr2 = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodTrade;
        if (!tr2) { toProfile(profileId, 'Trading is not running on this server.'); return true; }
        if (String(parts[1] || '').toLowerCase() === 'refresh') {
          tr2.refresh(actorId);
          return true;
        }
        var live = tr2.tradeOf(actorId);
        var verb = String(parts[1] || '').toLowerCase();
        if (live || verb === 'cancel' || verb === 'ok' || verb === 'add' ||
            verb === 'remove' || verb === 'gold' || verb === 'pack' || verb === 'sale') {
          if (!live) { toProfile(profileId, 'You are not trading.'); return true; }
          var out = '';
          if (verb === 'cancel') { out = tr2.cancel(actorId); }
          else if (verb === 'ok') { out = tr2.confirm(actorId); }
          else if (verb === 'gold') { out = tr2.gold(actorId, parts[2]); }
          // The panel's Buy for the company (#1393). Never typed.
          else if (verb === 'sale') { out = tr2.sale(actorId); }
          else if (verb === 'remove') {
            var rbits = parts.slice(2);
            var rn = 0;
            if (rbits.length > 1 && /^[0-9]+$/.test(rbits[rbits.length - 1])) {
              rn = Number(rbits.pop());
            }
            out = tr2.remove(actorId, rbits.join(' '), rn);
          }
          else if (verb === 'add') {
            /* The count is the last word when it is a number, the same rule
               /give uses, so "add iron ore 2" and "add iron ore" both work. */
            var bits = parts.slice(2);
            var n = 1;
            if (bits.length > 1 && /^[0-9]+$/.test(bits[bits.length - 1])) {
              n = Number(bits.pop());
            }
            out = tr2.add(actorId, bits.join(' '), n);
          } else {
            /* Not a verb the trade window sends, while a trade stands: H on
               somebody, or Trade on the P panel (#1628). One trade at a time,
               so no new one, and this one's window is sent again, which opens
               it if it had been closed. Its buttons are the way out; nobody
               is told to type the verbs. */
            tr2.refresh(actorId);
            out = 'You are already in a trade. Its window is open again.';
          }
          if (out) { toProfile(profileId, out); }
          return true;
        }
      }

      /* Ask to party beside a friend on P sends their profile id (#1695):
         whoever that friend is playing now, never a name. */
      var restPid = Number(rest);
      var found = (word === '/party' && String(restPid) === rest && restPid > 0)
        ? soc.friendNow(actorId, restPid) : soc.findPerson(rest);
      if (!found.actorId) { toProfile(profileId, found.why); return true; }
      var them = found.actorId;
      if (them === actorId) { toProfile(profileId, 'That is you.'); return true; }
      var theirPid = soc.profileOf(them);
      var theirName = soc.nameOfPerson(them);

      if (word === '/friend' && soc.isFriend(actorId, theirPid)) {
        soc.dropFriend(actorId, theirPid);
        toProfile(profileId, theirName + ' is no longer on your list.');
        soc.push(actorId);
        return true;
      }

      /* Somebody already in your party is not asked again. P draws "Party
         menu" over them rather than an ask, and this is the server's own
         check of the same thing, for an ask that left as they joined. */
      var askerParty = word === '/party' ? soc.partyOf(mine) : null;
      if (askerParty && askerParty.members.indexOf(theirPid) !== -1) {
        toProfile(profileId, theirName + ' is already in your party.');
        return true;
      }

      var kind = word === '/friend' ? 'friend' : (word === '/party' ? 'party' : 'trade');
      var refused = soc.offer(kind, actorId, them);
      if (refused) { toProfile(profileId, refused); return true; }
      var asked = kind === 'friend' ? 'wants to be friends'
                : (kind === 'party' ? 'is asking you to join their party'
                                    : 'is offering to trade');
      say(them, soc.nameOfPerson(actorId) + ' ' + asked + '. Accept or refuse on the prompt.');
      notify(them, soc.nameOfPerson(actorId) + ' ' + asked);
      toProfile(profileId, 'Asked ' + theirName + '. They have ' +
                Math.round(soc.SOCIAL.offerFor / 1000) + ' seconds.');
      soc.push(actorId);
      soc.push(them);
      return true;
    }

    // A warrior's maneuvers (#1386), as the maneuver panel sends them; nobody
    // is told to type it. See the maneuvers block, after the character
    // block, for what each one does and what the server cannot.
    if (word === '/maneuver') {
      var mvs = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodManeuvers;
      if (!mvs || !mvs.use) {
        toProfile(profileId, 'Maneuvers are not running on this server right now. Say so in the dev channel.');
        return true;
      }
      if (!needCharacter()) { return true; }
      toProfile(profileId, mvs.use(actorId, parts[1]));
      return true;
    }

    /*
      WHERE SOMEBODY IS RESTING, AND NOTHING ELSE (#1631). /rest is the
      plugin's line when somebody sits down, lies down or gets up. /eat,
      /drink and /bard are gone: eating or drinking the item is a meal
      (mp.onEatItem), and the bard is somebody the server sees playing
      (bardSeen, in the needs block). Typed, they get the answer every
      unknown word gets.
      /needs went with them and came back on its own (#2267), above.
    */
    if (word === '/rest') {
      var needs = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodNeeds;
      if (!needs) { toProfile(profileId, 'That is not running on this server.'); return true; }
      if (!needCharacter()) { return true; }
      var where = String(parts[1] || '').toLowerCase();
      var beds = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodBeds;
      if (where === 'up' || where === 'stop') {
        var was = String(needs.settle(actorId).resting || '');
        var off = (beds && beds.off) ? beds.off(actorId) : '';
        needs.resting(actorId, '');
        // Said only when there was a rest to get up from, and not off a
        // seat: the plugin sends this at every piece of furniture it gets
        // off, and people sit at every table (#1603).
        if (was && off !== 'seat') { toProfile(profileId, 'You get up.'); }
        return true;
      }
      /*
        WHAT WAS PRESSED, NEVER THE WORD (#1392, #1607, #1603). The plugin
        says /rest bed when somebody lies down and /rest sit when they sit,
        and the beds in the property block answer by the furniture the server
        saw them press and whether they are still at it: a seat, a seat by a
        fire, a bed by whose it is. Nobody types this, and help never names
        it. See "beds" in the property block.
      */
      if (!beds || !beds.rest) {
        toProfile(profileId, 'Beds are not running on this server right now. Say so in the dev channel.');
        return true;
      }
      var restSaid = beds.rest(actorId, Number(profileId) || 0);
      if (restSaid) { toProfile(profileId, restSaid); }
      return true;
    }

    /*
      THE NEEDS BARS AS TEXT (#2267). Typed, by somebody who hid the bars on
      Settings in the game, or anybody else: Patrick's exception to
      "buttons, not commands" on 11 Oct, because it is another view of the
      bars and the Body page on K rather than something done in the world.
      /need is the same. It reads and says; it changes nothing. See textView
      in the needs block.
    */
    if (word === '/needs' || word === '/need') {
      var needsSaid = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodNeeds;
      if (!needsSaid || !needsSaid.textView) { toProfile(profileId, 'That is not running on this server.'); return true; }
      if (!needCharacter()) { return true; }
      toProfile(profileId, needsSaid.textView(actorId));
      return true;
    }

    if (word === '/chopped') {
      var swung = choppedSwing(actorId);
      if (swung && swung !== ALLOW) {
        notify(actorId, swung);
        say(actorId, swung);
      }
      return true;
    }

    // The client's load order, a line of it at a time. Not a human command:
    // it answers nothing until the whole list is in, and then only when it
    // differs from the server's. See the load order refusal block.
    if (word === '/loadorder' || word === '/loadorderlight') {
      try {
        var lo = (typeof globalThis !== 'undefined' ? globalThis : this).__thornswoodLoadOrder;
        if (lo && lo.take) {
          lo.take(profileId, parts, actorId, function (text) { toProfile(profileId, text); });
        }
      } catch (eLo) { log('/loadorder failed:', eLo); }
      return;
    }

    if (word === '/tspicks') {
      if (!needCharacter()) { return; }
      var picks = Math.max(1, Math.min(20, Number(parts[1]) || 1));
      if (takeItem(actorId, 'a:Skyrim.esm', picks)) {
        log('spent ' + picks + ' lockpick(s) for ' + actorId.toString(16));
      }
      return;
    }

    // A property door's lock opened on this person's machine: a pick
    // (#2680). The property block checks it all again and sends the
    // holder word if it counts.
    if (word === '/tspicked') {
      if (!needCharacter()) { return; }
      var propPick = g.__thornswoodProperty;
      if (propPick && propPick.picked) {
        try { propPick.picked(actorId, profileId, parts[1]); } catch (ePick) { log('/tspicked failed:', ePick); }
      }
      return;
    }

    if (word === '/where') {
      // A dev's and a tester's tool, refused to everybody else the way
      // /give and /spawn are (#1633).
      if (!isPlaytester(profileId)) {
        toProfile(profileId, word + ' is not yours to run. Ask Patrick to add profile ' + profileId + '.');
        return;
      }
      if (!needCharacter()) { return; }
      var pos = [0, 0, 0], ang = [0, 0, 0], cell = '';
      try {
        pos = mp.get(actorId, 'pos') || [0, 0, 0];
        ang = mp.get(actorId, 'angle') || [0, 0, 0];
        cell = String(mp.get(actorId, 'worldOrCellDesc') || '');
      } catch (e) { }
      toProfile(profileId,
        cell + '  pos ' + round1(pos[0]) + ', ' + round1(pos[1]) + ', ' + round1(pos[2]) +
        '  facing ' + round1(ang[2]));
      log('command: /where', actorId.toString(16), cell,
          round1(pos[0]), round1(pos[1]), round1(pos[2]), round1(ang[2]));
      return;
    }

    /*
      Staff: /kick, /freeze, /unfreeze, /bring, /goto <person>, /silence,
      /unsilence, /warn, /spawnat, and /give, /spawn and /tp aimed at a
      person (#412). The staff block at the end of this file does the work
      and says whether it took the line; it reuses /give's, /spawn's and
      /tp's lookups, handed over here. A /give, /spawn, /tp or /goto that
      names no person goes on to the branches below, and /ooc or /roll from
      somebody staff silenced stops here.
    */
    var staffCmd = g.__thornswoodStaff;
    if (staffCmd) {
      try {
        if (staffCmd.command(cmd, word, parts, profileId, actorId, isStaff,
                             { findThing: findThing, findBeast: findBeast,
                               byFormId: byFormId, findPlace: findPlace,
                               beastName: beastName })) { return; }
      } catch (eStaff) { log('staff command failed:', eStaff); }
    }

    if (word === '/tp' || word === '/goto') {
      /*
        Admin only, because the profile id this arrives under is a claim and
        not a fact.

        The chat page joins the voice socket with whatever profile id is in the
        settings file on that machine, the voice service queues the line under
        it, and handle() takes it at its word. So anybody who opens a socket to
        the voice port with somebody else's id could move that person's
        character across Skyrim. It stays until a login hands out a token the
        page has to present.
      */
      if (!isPlaytester(profileId)) {
        /*
          Which list they are not on, because "not yours to run" told nobody
          anything and the answer was always the same whoever asked.

          And whether there is a list at all, because on 19 and 20 September
          there was not: no door.json, so no roster, and none of the three
          written lists set either. Every tier answered no to everybody and the
          refusal read as a decision about that person. A refusal from a server
          that has nothing to check against should say so, or the next person
          to hit this spends the evening looking at their own Discord roles.
        */
        var src = 'none';
        try {
          var g3 = (typeof globalThis !== 'undefined') ? globalThis : this;
          if (typeof g3.__thornswoodRoleSource === 'function') { src = g3.__thornswoodRoleSource(); }
        } catch (e) { }
        var written = rolelist('thornswoodDevs').length + rolelist('thornswoodPlaytesters').length;

        if (src === 'none' && !written) {
          toProfile(profileId,
            'This server has no playtester list to check, so /tp refuses everybody. ' +
            'That is a server fault rather than anything about you: private\door.json ' +
            'is missing, so the roles never arrive. Profile ' + profileId + '.');
          log('/tp refused profile ' + profileId + ' and there is NO ROLE SOURCE AT ALL: ' +
              'no door.json roster and no written lists in server-settings.json');
          return;
        }
        toProfile(profileId,
          'You are not on the playtester or dev list, so /tp is not yours to run. ' +
          'Ask Patrick to add profile ' + profileId + '.');
        log('/tp refused profile ' + profileId + ' (roster: ' + src + ', written: ' + written + ')');
        return;
      }
      /*
        THE WHOLE REST OF THE LINE, because a place name has spaces in it.

        arg is only the first word, which was enough while there were nine
        towns and is not now: "The Bannered Mare" arrived as "the". Same shape
        as /pick spell, which takes the rest of the line for the same reason.
      */
      var wanted = parts.slice(1).join(' ').trim().toLowerCase();
      var table = places();
      if (!wanted) {
        toProfile(profileId, 'Where to: ' + Object.keys(table).sort().join(', ') +
                  ', or the name of any inn, keep, shop or house in the world. ' +
                  'Part of the name is enough.');
        return;
      }
      var found = findPlace(wanted);
      if (!found.where) {
        toProfile(profileId, found.why);
        return;
      }
      var where = found.where;
      // The listing above answers whether or not the sweep found anybody. The
      // move is the part that needs a character to move.
      if (!needCharacter()) { return; }
      try {
        mp.set(actorId, 'locationalData', {
          cellOrWorldDesc: where.desc, pos: where.pos, rot: where.rot
        });
      } catch (e) {
        toProfile(profileId, 'That did not work: ' + e);
        return;
      }
      toProfile(profileId, 'Sent to ' + where.town + '.');
      log('command: /tp', actorId.toString(16), '->', wanted, '=', where.town, where.desc);
      return;
    }

    /*
      /restart is not a chat command any more.

      The profile id a command arrives under is a claim the page makes about
      itself, not something the server checked: the chat page joins the voice
      socket with whatever id is in the settings file on that machine, and
      handle() keyed isAdmin off that. So anybody who opened a socket to the
      voice port carrying an admin's profile id could take the server down.

      The file path is untouched and is how it is actually used: Ship.ps1 and
      Request-Restart.ps1 drop restart.json over ssh, checkRequest below picks
      it up, and the same countdown runs. That path needs the box, not a
      number anybody can type.

      It comes back as a chat command when a login hands each person a token
      the page has to present.
    */
    if (word === '/restart' || word === '/shutdown') {
      /*
        A SENTENCE, NOT A TOOL NAME. This used to answer "Use
        Request-Restart.ps1", which is a file on one machine that almost
        nobody typing /restart has, cannot run, and has never heard of. A
        message to a person names what that person can do; the tool name
        belongs in the log and in the comment above, where it is.
      */
      toProfile(profileId, 'Restarts are not run from chat. Ask whoever runs ' +
                           'the server and they will count everybody down first.');
      log('command:', word, 'from', profileId, 'refused: restarts come from the box');
      return;
    }

    /*
      ------------------------------------------------- /give and /spawn ---

      Patrick, 22 September: "we also need /give and /spwan commands so we can
      give and spawn any item /give iron ore or /give iron ore 2 or /spawn
      chicken /spawn cow 3".

      PLAYTESTER ONLY, and for the same reason /tp is. The profile id a
      command arrives under is a claim the page makes about itself, not
      something the server checked, so anybody who opened a socket to the
      voice port with somebody else's id could hand themselves anything in the
      game. It stays behind that gate until a login hands out a token.

      THE WHOLE LOAD ORDER. Patrick, 27 September: "/give is an admin/tester
      command I should be able /give any item I like and /span any npc I like
      not just animals but trolls, giants, skeletons, etc". So after the
      names this file's own tables give (ores, plants, crops, fish, what a body
      carries, the recipes), /give reads ADMIN_ITEMS, every named item, gold
      included, and /spawn reads ADMIN_ACTORS, every named actor. Both are
      generated by scripts/dev/Build-AdminNameTables.py. Anything with no name
      is reached by its form id: /spawn 23aba, /give 12eb7:Skyrim.esm.
    */
    if (word === '/give' || word === '/spawn') {
      if (!isPlaytester(profileId)) {
        toProfile(profileId, word + ' is not yours to run. Ask Patrick to add profile ' + profileId + '.');
        return;
      }
      if (!needCharacter()) { return; }

      /*
        THE COUNT IS THE LAST WORD, AND ONLY IF IT IS A NUMBER.

        "/give iron ore 2" is two iron ore and "/give iron ore" is one, but
        "/spawn cow 3" and "/spawn horse" have to work the same way, and a
        name can end in a digit. So the last word is taken as a count only
        when it parses as one AND there is something left in front of it.
      */
      var words = parts.slice(1);
      /*
        KEEP, AS THE LAST WORD, MAKES A SPAWN PERMANENT (#2623). Djinn, 17
        October: a spawned creature is never permanent "unless we want to make
        it permanent". So "/spawn wolf 3" is temporary and "/spawn wolf 3
        keep" stays and comes back after it dies. Read before the count, so
        the count is still the last word once keep is off.
      */
      var keep = false;
      if (word === '/spawn' && words.length > 1 && String(words[words.length - 1]).toLowerCase() === 'keep') {
        keep = true;
        words = words.slice(0, words.length - 1);
        if (!mayKeepSpawn(profileId)) {
          toProfile(profileId, 'Only staff can keep a spawn. Leave keep off and it is temporary.');
          log('command: /spawn keep refused profile', profileId);
          return;
        }
      }
      var count = 1;
      if (words.length > 1) {
        var tail = Number(words[words.length - 1]);
        if (isFinite(tail) && tail > 0 && String(Math.floor(tail)) === words[words.length - 1]) {
          count = Math.floor(tail);
          words = words.slice(0, words.length - 1);
        }
      }
      var want = words.join(' ').trim().toLowerCase();
      if (!want) {
        toProfile(profileId, word === '/give'
          ? 'Give what? /give iron ore, or /give iron ore 5.'
          : 'Spawn what? /spawn troll, /spawn giant, or /spawn skeleton 3.');
        return;
      }
      // Forty creatures is plenty for a test and small enough that a typo is
      // not an afternoon of cleaning up after it. Items stack, so /give takes
      // up to a hundred thousand, which is a purse of gold or a crate of arrows.
      var most = (word === '/give') ? 100000 : 40;
      if (count > most) { count = most; }

      var hit = (word === '/give') ? findThing(want) : findBeast(want);
      if (!hit.desc) { hit = byFormId(want) || hit; }
      if (!hit.desc) { toProfile(profileId, hit.why); return; }

      if (word === '/give') {
        if (!addItem(actorId, hit.desc, count)) {
          toProfile(profileId, hit.name + ' is named in this server\'s tables but the ' +
                    'plugin that owns it is not in the load order, so there is nothing to hand you.');
          return;
        }
        toProfile(profileId, 'Given ' + count + ' ' + hit.name + '.');
        log('command: /give', actorId.toString(16), '->', count, hit.name, hit.desc);
        return;
      }

      // /spawn. A few steps in front of where they are standing and facing,
      // which is certainly somewhere real, and spread round them when there
      // are several, so three cows are three cows. placeActors (#959).
      var baseId = idOf(hit.desc);
      if (!baseId) {
        toProfile(profileId, hit.name + '\'s plugin is not in this load order.');
        return;
      }
      var at = null, inCell = '', facing = null;
      try {
        at = mp.get(actorId, 'pos');
        inCell = String(mp.get(actorId, 'worldOrCellDesc') || '');
        facing = mp.get(actorId, 'angle');
      } catch (e) { at = null; }
      if (!at || !inCell) {
        toProfile(profileId, 'The server cannot tell where you are standing.');
        return;
      }
      var put = placeActors(baseId, { desc: inCell, pos: at, rot: facing || [0, 0, 0] }, count, 150, true, keep);
      var made = put.made;
      if (!made) {
        log('/spawn failed on', hit.name + ':', put.why);
        toProfile(profileId, 'Nothing was spawned: ' + (put.why || 'the server would not place it') + '.');
        return;
      }
      toProfile(profileId, 'Spawned ' + made + ' ' + hit.name + (made < count ? ' of the ' + count + ' asked for: ' + put.why : '') + '.' +
        (keep ? ' Kept: it stays, and comes back after it dies.'
              : ' Temporary: when it dies its body lies the usual time, then it is gone, and a restart takes it too. Add keep to make one stay.'));
      log('command: /spawn', actorId.toString(16), '->', made, hit.name, hit.desc, keep ? 'kept' : 'temporary');
      return;
    }

    // ------------------------------------------------------------- ooc ---
    //
    // Brackets worked, but only if everybody remembered them, and a line of
    // out of character talk typed without them lands in the middle of a scene
    // as though somebody's character said it.
    //
    // This is deliberately LOCAL. Out of character talk belongs to the scene
    // it interrupts, not to everybody in Skyrim, and a server wide one would
    // be a second general chat inside the game.
    if (word === '/ooc' || word === '/o') {
      var said = parts.slice(1).join(' ').trim();
      if (!said) {
        toProfile(profileId, 'Say /ooc and then whatever you meant to say.');
        return;
      }
      // Needs a character: who hears it is worked out from where that
      // character is standing.
      if (!needCharacter()) { return; }
      if (said.length > 300) { said = said.slice(0, 300); }

      var myPos = [0, 0, 0], myCell = '';
      try {
        myPos = mp.get(actorId, 'pos') || [0, 0, 0];
        myCell = String(mp.get(actorId, 'worldOrCellDesc') || '');
      } catch (e) { }

      var who = '';
      try {
        var ap = mp.get(actorId, 'appearance');
        who = String((ap && ap.name) || '');
      } catch (e) { }
      if (!who) { who = 'Somebody'; }

      var line = '(( ' + who + ': ' + said + ' ))';

      var near = [];
      try { near = mp.get(0, 'onlinePlayers') || []; } catch (e) { near = []; }

      var heard = 0;
      for (var oi = 0; oi < near.length; oi++) {
        var oid = near[oi], opid = 0;
        try { opid = Number(mp.get(oid, 'profileId')) || 0; } catch (e) { continue; }
        if (!opid) { continue; }

        if (oid !== actorId) {
          var oCell = '', oPos = [0, 0, 0];
          try {
            oCell = String(mp.get(oid, 'worldOrCellDesc') || '');
            oPos = mp.get(oid, 'pos') || [0, 0, 0];
          } catch (e) { continue; }
          // Same room first. Two people at the same coordinates in different
          // cells are not in earshot of each other.
          if (oCell !== myCell) { continue; }
          var dx = oPos[0] - myPos[0], dy = oPos[1] - myPos[1], dz = oPos[2] - myPos[2];
          if ((dx * dx + dy * dy + dz * dz) > (OOC_RANGE * OOC_RANGE)) { continue; }
        }

        toProfile(opid, line);
        heard++;
      }

      if (heard <= 1) {
        toProfile(profileId, 'Nobody near enough to hear that.');
      }
      log('command: /ooc', actorId.toString(16), 'heard by', heard);
      return;
    }

    /*
      ------------------------------------------------------------- the dice

      THE WHOLE VALUE OF A DIE IS THAT NOBODY CHOSE THE NUMBER.

      /roll used to be rolled in thornswood-chat.js, on the roller's own
      machine, and sent as an ordinary chat line: the page turned "/roll 20"
      into the words "rolls 20: 17" and posted them. The comment there said it
      out loud and called it the right trade among five friends. It is not the
      right trade on a server where a steward settles a dispute by asking for
      a roll, because anybody who can open a console can type the sentence
      themselves and nobody can tell the difference.

      So the roll happens here. The page sends the SPEC and never a result,
      this rolls it, and what everybody sees is written by the server. There
      is no line a client can send that produces the same output, because the
      page's own /roll is gone rather than merely discouraged.

      THE SPEC IS THE SAME ONE PEOPLE ALREADY TYPE, deliberately: the number
      is the number of sides, 6x3 is three of them, and a leading d is
      dropped because somebody who has rolled dice before types it on reflex.
      Nobody has to learn anything new.

      HEARD BY THE SAME PEOPLE /ooc IS, and for the same reason: a roll is
      part of a conversation and belongs in the room it happened in.
    */
    if (word === '/roll' || word === '/r') {
      if (!needCharacter()) { return; }
      var spec = parts.slice(1).join('').trim().toLowerCase();
      spec = spec.replace(/\s+/g, '').replace(/(^|[x*])d/g, '$1');
      if (!spec) { spec = String(ROLL_DEFAULT_SIDES); }

      var rm = /^(\d+)(?:[x*](\d+))?$/.exec(spec);
      var rsides = rm ? parseInt(rm[1], 10) : 0;
      var rcount = (rm && rm[2]) ? parseInt(rm[2], 10) : 1;
      if (!rm || !isFinite(rsides) || rsides < 1 || rsides > ROLL_MAX_SIDES ||
          !isFinite(rcount) || rcount < 1 || rcount > ROLL_MAX_DICE) {
        toProfile(profileId,
          'The number is the sides: /roll 20, /roll 1000, or /roll 6x3 for three of them. ' +
          'Whole numbers, 1 to ' + ROLL_MAX_SIDES + ', up to ' + ROLL_MAX_DICE + ' dice.');
        return;
      }

      var rolls = [], total = 0;
      for (var ri = 0; ri < rcount; ri++) {
        var v = 1 + Math.floor(Math.random() * rsides);
        rolls.push(v);
        total += v;
      }

      var rwho = '';
      try {
        var rap = mp.get(actorId, 'appearance');
        rwho = String((rap && rap.name) || '');
      } catch (e) { }
      if (!rwho) { rwho = 'Somebody'; }

      var rline;
      if (rcount === 1) { rline = rwho + ' rolls ' + rsides + ': ' + total; }
      else if (rcount <= 12) {
        rline = rwho + ' rolls ' + rcount + 'x' + rsides + ': ' + rolls.join(' + ') + ' = ' + total;
      } else {
        rline = rwho + ' rolls ' + rcount + 'x' + rsides + ': ' + total;
      }

      var rPos = [0, 0, 0], rCell = '';
      try {
        rPos = mp.get(actorId, 'pos') || [0, 0, 0];
        rCell = String(mp.get(actorId, 'worldOrCellDesc') || '');
      } catch (e) { }

      var rNear = [];
      try { rNear = mp.get(0, 'onlinePlayers') || []; } catch (e) { rNear = []; }
      var rHeard = 0;
      for (var rj = 0; rj < rNear.length; rj++) {
        var rid = rNear[rj], rpid = 0;
        try { rpid = Number(mp.get(rid, 'profileId')) || 0; } catch (e) { continue; }
        if (!rpid) { continue; }
        if (rid !== actorId) {
          var rc = '', rp = [0, 0, 0];
          try {
            rc = String(mp.get(rid, 'worldOrCellDesc') || '');
            rp = mp.get(rid, 'pos') || [0, 0, 0];
          } catch (e) { continue; }
          if (rc !== rCell) { continue; }
          var rdx = rp[0] - rPos[0], rdy = rp[1] - rPos[1], rdz = rp[2] - rPos[2];
          if ((rdx * rdx + rdy * rdy + rdz * rdz) > (OOC_RANGE * OOC_RANGE)) { continue; }
        }
        toProfile(rpid, rline);
        rHeard++;
      }
      log('command: /roll', actorId.toString(16), spec, '=', total, 'heard by', rHeard);
      return;
    }

    // The repair panel (#1384), from the inventory key or a button on the
    // panel. The work is in the durability block; this only hands it the
    // character and the words after /repair.
    if (word === '/repair') {
      if (!needCharacter()) { return; }
      var wear = g.__thornswoodDurability;
      if (!wear) { toProfile(profileId, 'Repair is not running on this server.'); return; }
      var mended = wear.panel(actorId, parts.slice(1));
      if (mended) { toProfile(profileId, mended); }
      return;
    }

    // The preserving panel (#3163), from the inventory key or a button on
    // the panel. The work is in the spoilage block; this only hands it the
    // character and the words after /preserve.
    if (word === '/preserve') {
      if (!needCharacter()) { return; }
      var rot = g.__thornswoodSpoilage;
      if (!rot) { toProfile(profileId, 'Preserving is not running on this server.'); return; }
      var kept = rot.panel(actorId, parts.slice(1));
      if (kept) { toProfile(profileId, kept); }
      return;
    }

    // Hair dye (#2675), from the Hair dye page of K and Dye hair on P. The
    // work is in the hair dye block; this only hands it the character.
    if (word === '/hairdye') {
      if (!needCharacter()) { return; }
      var hairDye = g.__thornswoodHairDye;
      if (!hairDye || !hairDye.command) { toProfile(profileId, 'Hair dye is not running on this server.'); return; }
      var dyeSaid = hairDye.command(parts, actorId);
      if (dyeSaid) { toProfile(profileId, dyeSaid); }
      return;
    }

    // Tending wounds (#1383), from the inventory key, the look prompt's key
    // and the treatment panel's buttons. The work is in the injury and
    // disease block; this only hands it the character and the words.
    if (word === '/treat') {
      if (!needCharacter()) { return; }
      var tending = g.__thornswoodHurt;
      if (!tending || !tending.panel) { toProfile(profileId, 'Tending wounds is not running on this server.'); return; }
      var tended = tending.panel(actorId, parts.slice(1));
      if (tended) { toProfile(profileId, tended); }
      return;
    }

    // Furniture in a held building (#2679), from the inventory key, the
    // crosshair keys and the furniture panel's buttons. The work and every
    // check are in the furniture block; this only hands it the character.
    if (word === '/furniture') {
      if (!needCharacter()) { return; }
      var arrange = g.__thornswoodFurniture;
      if (!arrange) { toProfile(profileId, 'Furniture is not running on this server.'); return; }
      var arranged = arrange.command(actorId, parts.slice(1));
      if (arranged) { toProfile(profileId, arranged); }
      return;
    }

    // Out of a wedged spot (#414). The work is in the stuck block at the end
    // of this file; this only hands it the character.
    if (word === '/stuck') {
      if (!needCharacter()) { return; }
      var stuck = g.__thornswoodStuck;
      if (!stuck) {
        toProfile(profileId, '/stuck is not working on the server right now. /helpme reaches ' +
                  'staff, who can move you by hand.');
        return;
      }
      stuck.command(profileId, actorId);
      return;
    }

    // Asking staff for help, and reporting somebody (#414). The work is in
    // the asking staff block at the end of this file; this only hands it the
    // character, the reply and who counts as staff.
    if (word === '/helpme' || word === '/help-me' || word === '/report') {
      if (!needCharacter()) { return; }
      var askStaff = g.__thornswoodAskStaff;
      if (!askStaff) {
        toProfile(profileId, 'Staff cannot be reached from the game right now. Open a ticket ' +
                  'in the Discord and it will reach them.');
        return;
      }
      askStaff.ask(word === '/report' ? 'report' : 'help', parts, profileId, actorId,
                   toProfile, isDev);
      return;
    }

    // Report a problem on the help panel (#3155), the same block's third
    // kind: to the site, and from there onto the board.
    if (word === '/problem') {
      if (!needCharacter()) { return; }
      var askBoard = g.__thornswoodAskStaff;
      if (!askBoard) {
        toProfile(profileId, 'Problems cannot be sent from the game right now. Post it in ' +
                  '#test-findings in the Discord and it will reach the developers.');
        return;
      }
      askBoard.ask('problem', parts, profileId, actorId, toProfile, isDev);
      return;
    }

    /*
      ------------------------------------------------------------- /help

      THE HELP IS A PANEL (#1633). Patrick, 4 October: no chat commands for
      anything people do. It was a menu and six topics typed into the chat,
      each written as commands; it is the help panel now,
      game/ui/thornswood-help.js, on its own key (HelpKey in Thornswood.ini,
      F7 unless it was moved on Settings in the game) and on Help on
      the K, P and J panels, which opens without the chat and names every key
      as that machine has it bound. Nothing tells anybody to type /help.

      Somebody who types it anyway, out of habit, is told where the panel is
      and the commands that are still typed, the same line a word nobody has
      ends with (helpLine), so the two cannot drift apart.
    */
    if (word === '/help' || word === '/commands') {
      toProfile(profileId, helpLine(profileId));
      return;
    }

    // Anything else beginning with a slash is answered privately, and never
    // put back into the room.
    //
    // It used to be broadcast, on the theory that a slash might be somebody
    // talking rather than a typo. Two things wrong with that. It publishes
    // everybody's mistyped commands to the whole server, and worse, it makes a
    // command that ran and a command that never arrived look identical from
    // the chair: in both cases your line appears in the room and nothing else
    // happens. A screenshot of six commands echoing back could not tell us
    // whether this handler was even running.
    //
    // Now it can. An echo in the room means the line never reached the game
    // server at all, which means the voice service in front of it is not
    // holding slash lines back, which means the copy running up there is old.
    /*
      AND IT DOES NOT ADVERTISE WHAT IT WILL THEN REFUSE.

      This used to end "and /tp <place> for a playtester" to everybody,
      including everybody who is not one, so the first thing a new person
      learned about this server was a command that answers "no". /help two
      lines up has always filtered correctly; this simply forgot to. Since
      #1633 both are helpLine: where the help panel is, and the commands
      people still type, with a tester's own named to a tester alone.
    */
    toProfile(profileId, 'No command called ' + word + '. ' + helpLine(profileId));
  }

  /*
    Restarts, announced rather than sprung.

    Publishing an update means the server comes down, and up to now that landed
    on whoever was playing as a disconnect with no warning: mid dungeon, mid
    fight, with whatever the server had not yet written still unwritten. This
    gives the room notice, repeats it as the time gets shorter, and then puts
    everybody out deliberately so nobody is holding an open session when the
    process dies.

    Kicking at the end is the point, not a courtesy. A client still connected
    when the server stops sits there believing it is in a world nobody is
    keeping any more, and the reconnect that follows is messier than a clean
    exit. mp.kick ends it on our terms.
  */
  // On globalThis, so a hot reload in the middle of a countdown does not lose
  // it and start announcing from ten minutes again. The online.json writer
  // reads the same object to tell the client probe the server is on its way
  // back rather than gone.
  if (!g.__thornswoodRestart) {
    g.__thornswoodRestart = { at: 0, said: {}, why: '', mode: 'update' };
  }
  var restart = g.__thornswoodRestart;

  // Marks at which the room is told again. Anything longer than the notice
  // given is skipped, so /restart 2 does not shout about ten minutes.
  var MARKS = [600, 300, 120, 60, 30, 10];

  function admins() {
    try {
      var cfg = mp.getServerSettings() || {};
      var list = cfg.thornswoodAdmins;
      if (Array.isArray(list) && list.length) { return list.map(Number); }
    } catch (e) { }
    // No written list, no written admin (#410). This used to fall back to one
    // profile number in the source, which anybody could log in under; admin
    // comes from thornswoodAdmins or the site's admin roles, and nothing else.
    return [];
  }

  /*
    Every role below needs the profile proved (#410): with
    thornswoodRequirePass on, a role is held only by a profile whose
    launcher's pass is on hand (__thornswoodPassTrusts, the join pass block),
    because the number a command or a character arrives under is otherwise
    one the client picked. The staff commands ask for the pass and the proven
    chat connection themselves, whatever the switch says (the staff block).
  */
  function passTrusts(profileId) {
    var t = g.__thornswoodPassTrusts;
    return typeof t !== 'function' || !!t(profileId);
  }

  function isAdmin(profileId) {
    if (!passTrusts(profileId)) { return false; }
    if (admins().indexOf(Number(profileId)) !== -1) { return true; }
    // The site's admins, the Owner and Dev roles, by every profile they have
    // checked in with; see the door block. The written list stays for the
    // day the site is down.
    return roleFromDoor('Admin', profileId);
  }

  /*
    Who may run what, in three tiers.

    There was one tier and one name in it, so /tp answered "That one is not
    yours to run" to every developer and every playtester on the server, which
    is what was reported. Asked for by Djinn on 19 Sep: the people running the
    playtest need to move themselves around without asking Patrick to do it.

    The lists live in server-settings.json on the VPS beside thornswoodAdmins,
    as thornswoodDevs and thornswoodPlaytesters, both arrays of profile ids.
    Neither is a secret and neither has a default: a server that names nobody
    has no devs and no playtesters, which is the same as today.

    An admin is a dev is a playtester, so nobody has to be listed twice.

    WHAT THIS WIDENS, said plainly rather than buried. The profile id a chat
    line arrives under is a claim, not a fact: the page joins the voice socket
    with whatever id is in the settings file on that machine, and the service
    queues the line under it. /tp only ever moves the character belonging to
    the id it arrived under, so the worst anybody can do is move a character
    they can already claim to be. Going from one id to a handful widens that by
    a handful, and it is the same hole either way. It closes when a login hands
    the page a token it has to present, which is where this was always going.
  */
  function rolelist(name) {
    try {
      var cfg = mp.getServerSettings() || {};
      var list = cfg[name];
      if (Array.isArray(list) && list.length) { return list.map(Number); }
    } catch (e) { }
    return [];
  }

  /*
    The same question, asked of Discord instead of a hand written list.

    Added 20 September, because the three lists above were the whole answer and
    on the live server not one of them was set. Every tier fell through to the
    single hard coded admin id, which is not an id anybody currently plays, so
    /tp refused every single person including Patrick. The code shipped on 19
    September was right and there was nothing anywhere for it to read.

    The door already fetches this every five minutes and writes it beside
    itself: allowed.json holds everyone the site says may play, and the
    devProfiles inside it are the ones who also hold the dev or admin role. So
    the roles people already have in Discord answer this on their own, and a
    new playtester is a playtester the moment their role lands rather than when
    somebody remembers to add a number to a file.

    The written lists stay and win first. They cost nothing, they work on a
    server with no door configured at all, and they are the way to give
    somebody a tier that their Discord role does not.
  */
  function roleFromDoor(which, profileId) {
    try {
      var g2 = (typeof globalThis !== 'undefined') ? globalThis : this;
      var fn = g2['__thornswoodIs' + which];
      if (typeof fn === 'function') { return !!fn(profileId); }
    } catch (e) { }
    return false;
  }

  function isDev(profileId) {
    if (!passTrusts(profileId)) { return false; }
    if (isAdmin(profileId)) { return true; }
    if (rolelist('thornswoodDevs').indexOf(Number(profileId)) !== -1) { return true; }
    return roleFromDoor('Dev', profileId);
  }

  /*
    Staff, for the moderator commands (#412): the dev tier. The site's
    devProfiles are its access.dev roles, which are the Discord staff roles
    (Owner, Dev, Gamemaster, Moderator, Loremaster; #605), and isDev already
    folds in the admins and the written thornswoodDevs list.
  */
  function isStaff(profileId) {
    return isDev(profileId);
  }
  /*
    The same question for the other blocks (#2551): staff end claims and set
    rent at any building (Patrick, 17 Oct), and the property block asks it
    here, so there is one staff test and not a second copy of it.
  */
  g.__thornswoodIsStaff = isStaff;

  /*
    WHO MAY ADD keep TO /spawn (#2623). Djinn, 17 October: "testers and
    staff for right now. can change later. so make it able to change later
    easily". This one word is the switch: 'playtester' lets testers and staff
    keep a spawn, 'staff' lets only staff. Staff's own aimed spawns
    (/spawnat, /spawn x on someone) are staff only already.
  */
  var SPAWN_KEEP_WHO = 'playtester';
  function mayKeepSpawn(profileId) {
    return SPAWN_KEEP_WHO === 'staff' ? isStaff(profileId) : isPlaytester(profileId);
  }

  function isPlaytester(profileId) {
    if (!passTrusts(profileId)) { return false; }
    if (isDev(profileId)) { return true; }
    if (rolelist('thornswoodPlaytesters').indexOf(Number(profileId)) !== -1) { return true; }
    return roleFromDoor('Allowed', profileId);
  }

  /** What to call somebody in a refusal, so they know which list to be on. */
  function roleOf(profileId) {
    if (isAdmin(profileId)) { return 'admin'; }
    if (isDev(profileId)) { return 'dev'; }
    if (isPlaytester(profileId)) { return 'playtester'; }
    return 'none';
  }

  /** Everybody connected, by profile, so the message goes through the chat. */
  function broadcast(text) {
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { return; }
    for (var i = 0; i < online.length; i++) {
      var pid = 0;
      try { pid = Number(mp.get(online[i], 'profileId')) || 0; } catch (e) { pid = 0; }
      if (pid) { toProfile(pid, text); }
    }
  }

  /*
    A RELOAD THAT CHANGED WHAT THE GAMES RUN (#3196). A gamemode-only dev
    deploy loads this file again in the running server instead of restarting
    it (Patrick's C on 22 Oct 2026), so nobody is put out. The server code
    takes effect at once, but the scripts a game was sent when it joined
    (property update scripts, event sources) stay as they were until it logs
    in again: the engine sends them on a reload only with
    enableGamemodeDataUpdatesBroadcast, which is off. After every load the
    engine says whether a reload changed them, and when it did, the people on
    are asked to log in again. A restart did that for them by dropping them.
  */
  g.__thornswoodGamemodeLoaded = function (load) {
    if (!load || !load.reload || !load.clientScriptsChanged) { return; }
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { online = []; }
    log('reload: what the games run changed, asked', online.length, 'people to log in again');
    broadcast('The server was just updated while you were on. Log out and back in ' +
              'to get all of it; until then some of what you see may be the old version.');
  };

  function clearTheServer() {
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { return; }

    // A notice ends with a word, not a disconnect.
    if (restart.mode === 'notice') {
      broadcast(parting());
      log('notice: told', online.length, 'people, nobody disconnected');
      return;
    }

    // So does an update. The server stays up through a launcher update, and
    // a kick with no process restart behind it leaves the kicked character's
    // actor in a state where the reconnecting client is never sent the world:
    // 17 Sep, one existing character, 13 reconnects after two such kicks,
    // every one of them dead (no hits, no deaths, no hoster changes, "all the
    // NPCs are gone"), while the same character reconnected fine after the
    // 01:00 process restart and fresh characters always worked. The kick
    // gained nothing anyway: the client reconnects on its own in three
    // seconds, and since 1.1.41 the launcher closes the game itself five
    // minutes after it sees the update. The 'restart' mode still kicks, a
    // process restart follows it and that reconnect works.
    if (restart.mode === 'update') {
      broadcast(parting());
      log('update: told', online.length, 'people, nobody disconnected; the launcher closes the game for the update');
      return;
    }

    var gone = 0;
    for (var i = 0; i < online.length; i++) {
      var actorId = online[i];
      try {
        var pid = Number(mp.get(actorId, 'profileId')) || 0;
        if (pid) { toProfile(pid, parting()); }
      } catch (e) { }
      try {
        var userId = mp.getUserByActor(actorId);
        if (userId !== undefined && userId !== null && userId >= 0) {
          mp.kick(userId);
          gone++;
        }
      } catch (e) { log('could not kick', actorId, e); }
    }
    log('restart: cleared the server,', gone, 'disconnected');
  }

  /*
    Arming from one place, because there are two ways in.

    Typing /restart only works if he is standing in the world, and the moment
    that matters most is the one right after Ship.ps1 has published, when he is
    at a terminal and not in the game at all. So the server also watches for a
    file, and the ship script drops that file over ssh. Same countdown either
    way.

    mode decides the wording, not the behaviour. An update needs everybody to
    quit so their launcher can patch; a restart means the server itself is
    going down. Both end in the same kick, because a client left connected to a
    server that has stopped, or running files the rest of the room has moved
    past, is the thing this exists to prevent.
  */
  function arm(seconds, why, mode) {
    restart.at = Date.now() + Math.round(seconds * 1000);
    restart.said = {};
    /*
      Every mark at or above the time asked for is already said.

      restartTick walks MARKS from the largest down and announces the first one
      it has not said yet, one per tick. With said empty, "/restart 1" matched
      600 on the first tick, 300 on the second, 120 on the third and 60 on the
      fourth, so a one minute warning arrived as "10 minutes", "5 minutes",
      "2 minutes" and "1 minute" on four consecutive ticks, in that order.

      Marking them here means the countdown starts at the first one that is
      actually in the future.
    */
    for (var mi = 0; mi < MARKS.length; mi++) {
      if (MARKS[mi] >= seconds) { restart.said[MARKS[mi]] = true; }
    }
    restart.why = why || 'an update';
    restart.mode = (mode === 'restart' || mode === 'notice') ? mode : 'update';
    broadcast(opening(Math.round(seconds / 60)));
  }

  function opening(mins) {
    var when = mins >= 1
      ? mins + (mins === 1 ? ' minute' : ' minutes')
      : 'under a minute';
    /*
      Three modes, and only two of them end with anybody put out.

      notice is the common one and the reason this exists. Pushing a server
      build stops and starts the process, which from a chair looks like a
      freeze and then everything carries on: the client holds its session and
      picks back up, so throwing people out for it is a bigger interruption
      than the thing being warned about. They just want to know why the world
      went still for a moment, and not to be mid swing when it does.
    */
    if (restart.mode === 'notice') {
      return 'Pushing a server update in ' + when + '. Expect a freeze of a ' +
             'few seconds when it lands. You do not need to log out, but do ' +
             'not be mid fight.';
    }
    if (restart.mode === 'restart') {
      return 'The server is going down in ' + when + ' for ' + restart.why +
             '. Get somewhere safe and log out before then.';
    }
    /*
      AND IT ONLY HAPPENS TO PEOPLE WHO NEED IT, which this used to promise
      everybody. Patrick, in the world on 23 September: "The server never
      actually kicked me".

      It did not, and it was right not to. The server does not kick for an
      update at all, on purpose: see clearTheServer, where a kick with no
      process restart behind it left thirteen reconnects dead on 17
      September. The launcher closes the game instead, four and a half
      minutes after IT sees the update. Patrick's launcher had already
      installed that pack before he pressed Play, so it had nothing to
      install and no reason to close anything, and the countdown promised
      him something that was never going to happen.

      So the wording says which half of the room it is talking to.
    */
    return 'An update is out. Everyone has ' + when + ' to finish up. Your ' +
           'launcher closes the game when the countdown ends and installs it, ' +
           'unless it already has this one, in which case nothing happens to ' +
           'you. Get somewhere safe either way.';
  }

  function reminder(when) {
    if (restart.mode === 'notice') {
      return 'Server update in ' + when + '. Brief freeze, nothing to do.';
    }
    if (restart.mode === 'restart') {
      return 'Server going down in ' + when + '. Log out somewhere safe.';
    }
    return when + ' until the update. Your launcher closes the game if it ' +
           'still needs it. Finish up and get somewhere safe.';
  }

  /*
    The banner wording, which is not the chat wording.

    IT SAYS WHAT HAPPENS TO YOUR GAME, IN PLAIN WORDS. Patrick, 23 September:
    "says you will be put in the launcher it should say Game will automatically
    close in one minute for an update or something like that it's not
    descriptivist enough".

    He is right, and the old line was written from the server's side of the
    wire. "You are put back to the launcher" describes what the server does. It
    does not tell somebody in a dungeon that their game is about to shut, which
    is the only fact that matters to them, and it does not say why, so the
    reasonable reading was that something had gone wrong.

    So each mode now says the same three things: what happens to the game, when,
    and what it is for. Short enough to read in a glance, because the chat line
    beside it still carries the detail.

    A notice does not throw anybody out, so it must not say it will: telling
    people they are about to be kicked and then not kicking them is how a
    warning stops being believed. It now says nothing closes, in those words.
  */
  function onScreen(secs) {
    var when = secs >= 60 ? '1 minute' : secs + ' seconds';
    if (restart.mode === 'notice') {
      return 'A server update lands in ' + when + '. The world freezes for a ' +
             'few seconds. Your game does not close.';
    }
    if (restart.mode === 'restart') {
      return 'The server goes down in ' + when + ' for ' + restart.why +
             '. Get somewhere safe and log out.';
    }
    return 'Your game closes automatically in ' + when + ' for an update, ' +
           'unless your launcher already has it. Then it installs and puts ' +
           'you back in.';
  }

  function parting() {
    if (restart.mode === 'notice') {
      return 'Going in now. Hold tight.';
    }
    if (restart.mode === 'restart') {
      return 'Going down now. See you in a few minutes.';
    }
    return 'Update time. If your launcher still needs it, it closes the game ' +
           'now and patches, then you come straight back. If it already has ' +
           'it, carry on.';
  }

  /*
    The drop box. Ship.ps1 writes it over ssh, we act on it and delete it, so a
    file left behind by a crash cannot fire a second time on the next boot.

    RESOLVED AGAINST THE SERVER'S OWN DATA FOLDER, not against the working
    directory. 'data/restart.json' is whatever data folder the process happens
    to have been started from, which is the right one today and is a silent
    failure the day anybody starts the server from somewhere else: the file
    would be written where Ship puts it and looked for somewhere else, and a
    restart request would simply never arrive with nothing saying why.

    server-settings.json names the data folder and the voice feed already
    reads it the same way a few hundred lines up. A settings file that cannot
    be read falls back to the old relative path, which is what has always
    worked.
  */
  var REQUEST = (function () {
    try {
      var rfs = require('fs');
      var rpath = require('path');
      var rcfg = JSON.parse(rfs.readFileSync('server-settings.json', 'utf8'));
      if (rcfg && rcfg.dataDir) { return rpath.join(String(rcfg.dataDir), 'restart.json'); }
    } catch (e) { }
    return 'data/restart.json';
  })();

  function checkRequest() {
    var fs;
    try { fs = require('fs'); } catch (e) { return; }
    var raw;
    try {
      if (!fs.existsSync(REQUEST)) { return; }
      raw = fs.readFileSync(REQUEST, 'utf8');
    } catch (e) { return; }

    try { fs.unlinkSync(REQUEST); } catch (e) { }

    var req;
    try { req = JSON.parse(raw); } catch (e) {
      log('restart request was not readable:', raw);
      return;
    }
    if (!req) { return; }

    if (req.cancel) {
      if (restart.at) {
        restart.at = 0;
        restart.said = {};
        broadcast('That is called off. Carry on.');
        log('restart request: cancelled');
      }
      return;
    }

    var secs = Number(req.seconds);
    if (!(secs > 0)) { secs = 300; }
    if (secs > 7200) { secs = 7200; }

    arm(secs, String(req.why || 'an update'), String(req.mode || 'update'));
    log('restart request:', secs, 'seconds,', restart.mode, ',', restart.why);
  }

  function restartTick() {
    checkRequest();
    if (!restart.at) { return; }
    var left = Math.round((restart.at - Date.now()) / 1000);

    if (left <= 0) {
      restart.at = 0;
      /*
        When it ran out, kept so the probe stays patient across the stop.

        The countdown reaching zero is not the moment the server goes away.
        Deploy-Server waits the countdown plus twenty seconds and then copies
        files up before it starts anything, and in notice and update mode
        clearTheServer does not disconnect anybody, so the server carries on
        answering with restarting already false. The client would read one of
        those answers, forget it had been warned, and quit to the menu when
        the process finally stopped. Which is the exact thing the warning
        exists to prevent.
      */
      restart.went = Date.now();
      restart.said = {};
      clearTheServer();
      return;
    }

    for (var i = 0; i < MARKS.length; i++) {
      var m = MARKS[i];
      if (left <= m && !restart.said[m]) {
        restart.said[m] = true;
        var when = m >= 60
          ? (m / 60) + (m === 60 ? ' minute' : ' minutes')
          : m + ' seconds';
        broadcast(reminder(when));
        /*
          AND ON THE SCREEN FOR THE LAST TWO.

          Patrick: "I need it to do an onscreen warninjg and not just in chat
          at one minute and at 30 seoconds before you get kciked from the
          server incase people miss the message in chat."

          Exactly those two marks and no others. The ten and five minute
          warnings are information and belong in chat; a banner over the
          middle of somebody's screen every few minutes is the thing that
          teaches people to ignore banners. Sixty and thirty seconds are the
          ones with a kick behind them.

          Ten seconds is left alone deliberately: there is nothing anybody can
          do with ten seconds that they could not do with thirty, and it would
          land on top of the thirty second banner.

          AND NOT IN UPDATE MODE, WHERE THE SERVER KICKS NOBODY. Issue #610, a
          tester whose launcher was already up to date: "The game still had the
          big warning for game kicking me for an update even though my launcher
          was already up to date and it never kicked me (Which was correct). It
          should only show in the text chat if I have already updated my
          launcher at this point." He is right. In update mode clearTheServer
          disconnects no one; whether your game closes is your launcher's call,
          and a launcher already holding this pack does nothing to you. The
          server cannot tell from here whose launcher still needs it, so the
          one warning it can give everybody without lying is the chat line,
          which already says "unless your launcher already has it". The banner
          cannot be made true for one person and false for the next, so update
          mode is left to chat and the banner is kept for restart mode, the one
          that actually puts the whole room out.
        */
        if ((m === 60 || m === 30) && restart.mode !== 'update') {
          alertAll(onScreen(m), 'bad', m === 30 ? 12000 : 9000);
        }
        break;
      }
    }
  }

  /*
    WHAT HAS RUN, SO A COMMAND OFFERED TWICE RUNS ONCE.

    The voice service used to empty its queue the moment this asked, before a
    byte of the answer was read, so a batch that failed to parse below was
    lost with nobody told. Now it is asked with ?ack=1: it keeps every command
    until this acknowledges it, and offers it again until then. That makes
    delivery at least once, and a command run twice is a second teleport
    somebody did not ask for, so every id that has run is remembered here and
    skipped when it comes round again.

    On globalThis so a hot reload does not forget, and capped, oldest out. The
    service gives up on a command after five offers, so no id needs keeping
    for long; two thousand is ten full queues.
  */
  if (!g.__thornswoodCommandsRun) {
    g.__thornswoodCommandsRun = { seen: Object.create(null), order: [] };
  }
  var commandsRun = g.__thornswoodCommandsRun;
  var COMMANDS_RUN_KEEP = 2000;

  function markRun(id) {
    if (commandsRun.seen[id] === true) { return; }
    commandsRun.seen[id] = true;
    commandsRun.order.push(id);
    while (commandsRun.order.length > COMMANDS_RUN_KEEP) {
      delete commandsRun.seen[commandsRun.order.shift()];
    }
  }

  function poll() {
    var http;
    try { http = require('http'); } catch (e) { return; }
    var req = http.request({
      // A service from before ?ack=1 reads its routes with the query cut off,
      // so it answers this as it always did: the queue emptied, no ids on the
      // commands, and nothing for this to acknowledge.
      host: '127.0.0.1', port: VOICE_PORT, path: '/commands?ack=1', method: 'GET', timeout: 2000
    }, function (res) {
      var body = '';
      res.on('data', function (d) { body += d; });
      res.on('end', function () {
        var list = [];
        var doc = null;
        // Nothing is acknowledged when this fails, so the service offers the
        // same batch again on the next poll rather than it being lost.
        try { doc = JSON.parse(body) || {}; list = doc.commands || []; } catch (e) { pollSaid(false); return; }
        pollSaid(true);
        relayBoot(doc.boot);
        var ran = [];
        for (var i = 0; i < list.length; i++) {
          var id = (list[i] && list[i].id) ? String(list[i].id) : '';
          // Offered again because an acknowledgement went missing. It has
          // run, so it is acknowledged again and not run a second time.
          if (id && commandsRun.seen[id] === true) { ran.push(id); continue; }
          // Marked before it runs and acknowledged even when it throws: one
          // that threw part way through may already have moved somebody.
          // A line dispatch() holds for a character still on its way back is
          // acknowledged too: it waits in the held queue here from then on,
          // just as it did when the service emptied its queue on every ask.
          if (id) { markRun(id); ran.push(id); }
          try { dispatch(list[i]); }
          catch (e) { log('command threw:', e && e.stack ? e.stack : e); }
        }
        if (ran.length) { post('/commands/ack', { ids: ran }); }
      });
    });
    req.on('error', function () { pollSaid(false); });
    req.on('timeout', function () { pollSaid(false); req.destroy(); });
    req.end();
  }

  // Whether the relay is answering, for the load order sweep: a report rides
  // it, so no report while it is down is the server's failure, not theirs.
  function pollSaid(ok) {
    var s = g.__thornswoodCommandPoll || (g.__thornswoodCommandPoll = { okAt: 0, failAt: 0 });
    if (ok) { s.okAt = Date.now(); } else { s.failAt = Date.now(); }
  }

  /*
    The relay's boot stamp, on every answer. A new one means the voice service
    restarted, and every socket that was waiting in line died with it without
    a word, so the seats block gives each waiting menu a minute to ask again
    (#481). On globalThis, so a hot reload of this file is not taken for one.
  */
  function relayBoot(boot) {
    boot = String(boot || '');
    if (!boot) { return; }
    var was = g.__thornswoodRelayBoot;
    g.__thornswoodRelayBoot = boot;
    if (!was || was === boot) { return; }
    log('the relay restarted (' + was + ' is now ' + boot + ')');
    var seatsApi = g.__thornswoodSeats;
    if (seatsApi) {
      try { seatsApi.relayRestarted(Date.now(), seatsApi.liveHow()); } catch (e) { log('relay restart for the line failed:', e); }
    }
  }

  if (g.__thornswoodCommandTimer) { clearInterval(g.__thornswoodCommandTimer); }
  g.__thornswoodCommandTimer = setInterval(function () {
    // Every tick, whatever the poll brings back, so a waiting line runs within
    // a second and a half of its character arriving. See dispatch.
    try { drainHeld(); } catch (e) { log('held commands threw:', e); }
    try { poll(); } catch (e) { }
    try { restartTick(); } catch (e) { log('restart tick threw:', e); }
  }, 1500);

  // Typed out rather than derived, so it drifts. It had drifted: /plant,
  // /claim and /plot were live and this line had never heard of them, and
  // the one place anybody looks to see what a build answers to is this line
  // in the log.
  console.log('[thornswood] chat commands running:', WORDS.join(', '));
})();
// ==== end thornswood chat commands ====
