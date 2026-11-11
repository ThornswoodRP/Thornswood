// ---------------------------------------------------------------------------
// Thornswood front: the one plugin that owns the browser.
//
// There is exactly one browser and three things wanted it. The emote wheel
// called loadUrl on a page of its own, which replaced the chat and the names
// above heads; whichever called loadUrl last won, and since the wheel opens
// later than the front starts, the wheel always won. That is why the chat never
// appeared even after the files were installed.
//
// So one page is loaded, once, by this file, and everything else mounts itself
// into it as an overlay. Nobody else calls loadUrl, nobody else sets visible,
// and nobody else sets focused.
//
// It also fixes the address. SkyrimPlatform's default is the bare string
// 'file:///Data/Platform/UI/index.html', which CEF reads from the filesystem
// root: C:\Data\Platform\UI, which does not exist on any install. Plugins run
// in the game's own Node instance with the game folder as the working
// directory, so cwd is the anchor.
//
// Plugins share a global scope. A top level `function log()` becomes a property
// of that shared object and the last plugin loaded silently replaces everybody
// else's. Every plugin here is wrapped so nothing leaks, and anything
// deliberately shared goes on globalThis.Thornswood by name.
// ---------------------------------------------------------------------------

(function () {
  'use strict';

  // ------------------------------------------------------------ whose game ----
  // Skyrim Platform loads every plugin in Data/Platform/Plugins, whichever server
  // skymp5-client is about to join. Somebody who also plays another server starts
  // it from this same Skyrim, so on 2026-09-16 Thornswood's voice indicator sat
  // on top of that server's menu. Whichever launcher ran last wrote
  // skymp5-client-settings.txt, and its server-ip says whose game this is. Not
  // ours: this file does nothing at all. Unreadable: carry on, as before.
  //
  // Ours is the address in Thornswood.ini's ServerAddress line when there is
  // one, and the game's own name below when there is not: the launcher writes
  // that name into server-ip, never the box's address (#3690), so a server
  // move is a DNS record and nothing here.
  //
  // This is the one copy (issue #485). The other plugins in game/plugins hold
  // no check of their own: this file publishes it below as
  // globalThis.Thornswood.whoseGame, only once it has said ours, and each of
  // them asks it on the first tick and stays idle when it is not there.
  // tests/test-whose-game-gate.js holds that together.
  if (!thornswoodGame()) { return; }
  function thornswoodGame() {
    const ours = ['play.thornswood.net'];
    let ip = '';
    try {
      const fs = require('fs');
      try {
        const m = fs.readFileSync('Data/SKSE/Plugins/Thornswood.ini', 'utf8')
          .match(/^\s*ServerAddress\s*=\s*([^\s;]+)/m);
        if (m) { ours.push(m[1]); }
      } catch (e) { }
      let raw = fs.readFileSync('Data/Platform/Plugins/skymp5-client-settings.txt', 'utf8');
      if (raw.charCodeAt(0) === 0xFEFF) { raw = raw.slice(1); }
      ip = String((JSON.parse(raw) || {})['server-ip'] || '').trim();
    } catch (e) { return true; }
    if (ip && ours.indexOf(ip) < 0) {
      try { skyrimPlatform.printConsole('[thornswood] the client points at ' + ip + ', not this server. Every Thornswood plugin idle.'); } catch (e) { }
      return false;
    }
    // The client can point at us and this still not be our session: another
    // server's launcher that never rewrites the client settings leaves our
    // address in them. So the launcher leaves a note when it starts the game
    // and takes it away when the game closes. No fresh note, not our session.
    try {
      const note = String(require('fs').readFileSync('Data/Platform/thornswood-session.txt', 'utf8')).trim();
      const first = note.split(/\s+/)[0];
      let when = Number(first);           // unix milliseconds from the launcher
      if (!isFinite(when) || when < 1e12) { when = Date.parse(first); }
      if (isFinite(when) && Math.abs(Date.now() - when) < 24 * 3600 * 1000) { return true; }
      try { skyrimPlatform.printConsole('[thornswood] the launcher\'s session note is stale, so this is another server\'s session. Every Thornswood plugin idle.'); } catch (e) { }
    } catch (e) {
      try { skyrimPlatform.printConsole('[thornswood] the launcher left no session note, so this is another server\'s session. Every Thornswood plugin idle.'); } catch (e2) { }
    }
    return false;
  }

  const sp = skyrimPlatform;

  const T = (globalThis.Thornswood = globalThis.Thornswood || {});
  // The whose-game check, for the other plugins (see above). Published before
  // the line under it, so a second load of this file hands over a current copy.
  T.whoseGame = thornswoodGame;
  if (T.front) return;      // already loaded, do not load the page twice
  T.front = true;
  // Each other plugin that reads Thornswood.ini puts a reader here, and the
  // Settings panel's changes are handed to every one (applySettings, #3126).
  T.settingsListeners = T.settingsListeners || [];

  const UI_PATH = 'Data/Platform/UI/index.html';
  const OVERLAYS = ['thornswood-chat.js', 'thornswood-emotes.js', 'thornswood-voice.js',
                    'thornswood-skills.js', 'thornswood-party.js',
                    'thornswood-journal.js', 'thornswood-board.js', 'thornswood-trade.js', 'thornswood-merchant.js',
                    'thornswood-repair.js', 'thornswood-treat.js', 'thornswood-maneuvers.js', 'thornswood-ride.js',
                    'thornswood-help.js', 'thornswood-settings.js', 'thornswood-afk.js', 'thornswood-box.js', 'thornswood-ship.js',
                    'thornswood-preserve.js', 'thornswood-furniture.js', 'thornswood-stall.js'];
  const LOG_FILE = 'Data/Platform/thornswood-front.log';
  const INI = 'Data/SKSE/Plugins/Thornswood.ini';
  const CLIENT_SETTINGS = 'Data/Platform/Plugins/skymp5-client-settings.txt';

  const UI_URL = (function () {
    try {
      var root = process.cwd().replace(/\\/g, '/').replace(/\/+$/, '');
      return encodeURI('file:///' + root + '/' + UI_PATH);
    } catch (e) {
      return 'file:///' + UI_PATH;
    }
  })();

  // Not under Data/Platform/Plugins. SkyrimPlatform watches that folder and
  // reloads every plugin whenever anything in it changes, so a log file written
  // there is a plugin reload per line: a black screen and a dead keyboard.
  let fsm = null;
  try { fsm = require('fs'); fsm.writeFileSync(LOG_FILE, ''); } catch (e) { fsm = null; }

  // Every line carries the clock, because a report that the K panel opened
  // late after the face (20 September) had nothing in this log to measure it
  // against: the server's log is timed and this one was not.
  function clock() {
    const d = new Date();
    const two = function (n) { return (n < 10 ? '0' : '') + n; };
    return two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()) + '.' +
           ('00' + d.getMilliseconds()).slice(-3);
  }

  function log() {
    const line = '[front] ' + clock() + ' ' + Array.prototype.slice.call(arguments).join(' ');
    try { sp.printConsole(line); } catch (e) { }
    if (fsm) { try { fsm.appendFileSync(LOG_FILE, line + '\n'); } catch (e) { fsm = null; } }
  }

  let lastOwnerOutfitNote = '';
  function logOwnerOutfitTransition() {
    try {
      const note = sp.storage && sp.storage.ownerOutfitDiagnostic;
      if (typeof note !== 'string' || note === lastOwnerOutfitNote) { return; }
      lastOwnerOutfitNote = note;
      log('native outfit:', note);
    } catch (e) { }
  }

  /*
    WHERE THE FRAME GOES, because nobody has ever been able to say.

    Patrick, 21 September: "it's really laggy and I don't know why we need to
    do some performance enhcanments", and on 23 September: it is on BOTH
    servers. That second half is the useful one. The dev server simulates
    interior NPCs only and the live one simulates every NPC in Skyrim, so if
    both feel the same then the number of simulated NPCs is not the cost, and
    the entry on the list says plainly that nothing should be optimised before
    that answer is known.

    What both servers share is this plugin. Nineteen handlers run on
    sp.on('update'), which in skymp5-client is EVERY FRAME, and three of them
    used to do real work every frame before they were given a heartbeat: the
    swing, the skills panel and the door locks, the last of those only on
    23 September.

    So the frame is measured rather than guessed at. Every handler already
    goes through guard(), so this is the one place that can time all of them
    without touching nineteen bodies. Two Date.now() calls per handler per
    frame is a rounding error against what the handlers themselves do, and the
    report is one line every thirty seconds naming the five that cost the most.

    READ IT AS: worst is the single slowest call, which is what a stutter
    feels like, and total is where the time actually went. A handler that is
    1ms every frame costs more than one that is 40ms once a minute.
  */
  const spent = {};
  let frames = 0;
  let spentAt = 0;
  const SPENT_EVERY = 30000;

  /*
    AND WHAT THE FRAME LOOKS LIKE, 20 October (#385). The line above said how
    many frames and how much of them was this plugin, and on 17 October in
    Whiterun it said 28 to 45 frames a second with this plugin at 1 to 5% of
    a core, so the rest of the frame went somewhere this line could not see.
    Three more numbers make the same spot with the NPCs on and off decide it:

      longest   the longest gap between two frames, which is what a stutter
                is, and how many gaps were over 50ms. A gap of a second or
                more is a load screen, not a stutter, and is counted apart.
      drawn     how many forms the SkyMP client is keeping in the world for
                the server, and how many of those are actors. Every one is
                updated by the client every frame, and the NPCs are most of
                them, so this is the number the NPC switch moves.
  */
  const HITCH_MS = 50;
  const PAUSE_MS = 1000;
  let frameAt = 0;
  let longestFrame = 0;
  let hitches = 0;
  let pauses = 0;

  function drawnByClient() {
    try {
      /* The engine's storage answers a key nobody set with a function, not
         undefined (the fork's storageProxy.js), so the view is read by type
         (#3333). */
      const view = sp.storage.view;
      const views = (view && typeof view === 'object' && typeof view.getFormViews === 'function')
        ? view.getFormViews() : null;
      if (!views) { return 'not known'; }
      let forms = 0;
      let actors = 0;
      const n = views.getFormViewsArrayLength();
      for (let i = 0; i < n; i++) {
        const v = views.getNthFormView(i);
        if (!v) { continue; }
        forms++;
        const id = v.getLocalRefrId();
        if (id && sp.Actor.from(sp.Game.getFormEx(id))) { actors++; }
      }
      return forms + ' forms, ' + actors + ' of them actors';
    } catch (e) {
      return 'not known (' + e + ')';
    }
  }

  function guard(name, fn) {
    return function () {
      const began = Date.now();
      try { return fn.apply(null, arguments); }
      catch (e) { log(name, 'threw:', e && e.stack ? e.stack : e); return undefined; }
      finally {
        const took = Date.now() - began;
        const row = spent[name] || (spent[name] = { ms: 0, runs: 0, worst: 0 });
        row.ms += took;
        row.runs++;
        if (took > row.worst) { row.worst = took; }
      }
    };
  }

  /*
    Counted here rather than inside guard, because guard wraps every handler
    and a frame is one pass through all of them. The 'pulse' handler is the
    one that already runs on a five second beat and is always registered, so
    it is the cheapest honest marker of a frame having happened.
  */
  function frameWent() {
    frames++;
    const now = Date.now();
    if (frameAt) {
      const gap = now - frameAt;
      if (gap >= PAUSE_MS) { pauses++; }
      else {
        if (gap > longestFrame) { longestFrame = gap; }
        if (gap > HITCH_MS) { hitches++; }
      }
    }
    frameAt = now;
    if (!spentAt) { spentAt = now; return; }
    if (now - spentAt < SPENT_EVERY) { return; }
    const seconds = (now - spentAt) / 1000;
    spentAt = now;

    const rows = [];
    for (const k in spent) {
      if (Object.prototype.hasOwnProperty.call(spent, k)) {
        rows.push({ name: k, ms: spent[k].ms, runs: spent[k].runs, worst: spent[k].worst });
      }
    }
    rows.sort(function (a, b) { return b.ms - a.ms; });
    const total = rows.reduce(function (t, r) { return t + r.ms; }, 0);

    log('frame: ' + Math.round(frames / seconds) + ' updates a second, ' +
        total + 'ms of plugin in ' + Math.round(seconds) + 's (' +
        (total / Math.max(1, seconds) / 10).toFixed(1) + '% of one core), worst five: ' +
        rows.slice(0, 5).map(function (r) {
          return r.name + ' ' + r.ms + 'ms/' + r.runs + ' runs, worst ' + r.worst + 'ms';
        }).join('; ') +
        '; longest frame ' + longestFrame + 'ms, ' + hitches + ' over ' + HITCH_MS + 'ms, ' +
        pauses + ' pause(s) of a second or more; the client draws ' + drawnByClient());

    for (const k in spent) {
      if (Object.prototype.hasOwnProperty.call(spent, k)) {
        spent[k].ms = 0; spent[k].runs = 0; spent[k].worst = 0;
      }
    }
    frames = 0;
    longestFrame = 0;
    hitches = 0;
    pauses = 0;
  }

  T.log = log;

  /**
   * A line in the log.
   *
   * This used to also put every line in the corner of the screen, on the
   * reasoning that a log somebody has to go and find is a round trip and if
   * enter does nothing the reason should be on screen at that moment. That was
   * true while one key was being chased and false the rest of the time, and
   * the rest of the time is what people actually play in. A pulse every five
   * seconds counting keystrokes is not something anybody should be reading
   * over their own game, next to notifications from their actual mods.
   *
   * So the log takes everything and the screen takes nothing, unless somebody
   * deliberately calls the one below.
   */
  function say(text) {
    log(text);
  }
  T.say = say;

  /**
   * A line in the corner of the screen, for the handful of things a person
   * needs to be told rather than a log needs to record.
   */
  /*
    ON SCREEN AND IN THE LOG, for the handful of things a person must see.

    This existed, worked and had no callers at all: everything went through
    say(), which is log only. That was right for a week of chasing a keystroke
    and wrong the moment anybody who is not us plays, because a log somebody
    has to go and find is not a message.

    The bar for using it is deliberately high. A notification interrupts
    somebody's game and sits over their screen next to their own mods' ones, so
    it is for a thing that is happening TO them and that they can act on: they
    are on fire, the fire is out, the console is not theirs. Everything else
    stays in the log where it belongs.
  */
  function note(text) {
    try { sp.Debug.notification('ThornsWood: ' + text); } catch (e) { }
    log(text);
  }
  T.note = note;

  T.js = function (src) {
    try { sp.browser.executeJavaScript(src); return true; }
    catch (e) { log('executeJavaScript failed:', e); return false; }
  };

  T.ready = false;

  // ------------------------------------------------------------- settings --
  function readText(p) {
    try { return require('fs').readFileSync(p, 'utf8'); } catch (e) { return ''; }
  }

  function iniNumber(text, key, fallback) {
    const m = text.match(new RegExp('^\\s*' + key + '\\s*=\\s*(\\d+)', 'm'));
    return m ? (Number(m[1]) || fallback) : fallback;
  }

  let ini = readText(INI);
  let CHAT_KEY = iniNumber(ini, 'ChatKey', 28);       // Enter
  // Opens the chat with a slash already in it, ready for a command. /, which
  // is the game's Quick Stats; see STATS_MENU below for why that stays shut.
  let COMMAND_KEY = iniNumber(ini, 'CommandKey', 53);  // /
  /*
    Profession, Class and Skill Tree. K, which was the minimap's settings
    panel until 20 September; that moved to F10 in Keys.cs and this took the
    letter, because a panel somebody opens once is worth less than the menu
    the whole progression system lives in.
  */
  let SKILLS_KEY = iniNumber(ini, 'SkillsKey', 37);   // K
  const VOICE_PORT = iniNumber(ini, 'VoicePort', 7778);
  /*
    How long the chat stays up after its last line, and whether the needs bars
    are drawn, from the Settings panel in the game (ChatFade and NeedsBars in
    Thornswood.ini, #3126). Both go to the page in window.THORNSWOOD, which is
    where the chat and the bars live, at load and again whenever the panel
    changes one (chatSettingsToPage). Not iniNumber, because 0 is a real
    answer here: it is the chat staying up for good, and iniNumber turns 0
    into its fallback. Anything that is not one of the panel's choices is ten.
  */
  function chatFadeOf(text) {
    const m = text.match(/^\s*ChatFade\s*=\s*(\d+)\s*$/im);
    const v = m ? Number(m[1]) : 10;
    return CHAT_FADE_CHOICES.indexOf(v) >= 0 ? v : 10;
  }
  function needsBarsOf(text) { return !/^\s*NeedsBars\s*=\s*0\s*$/im.test(text); }
  // In the order the Settings panel offers them; 0 is never.
  const CHAT_FADE_CHOICES = [5, 10, 15, 20, 0];
  let CHAT_FADE = chatFadeOf(ini);
  let NEEDS_BARS = needsBarsOf(ini);
  /*
    Where voice lives: https://thornswood.net/voice, or /voice-dev on the dev
    build. Written by the launcher at every Play, the same way VoicePort is,
    and always https since #1304, when the raw port it used to fall back to
    was shut and the chat stopped opening anything but wss.
  */
  const VOICE_URL = (function () {
    const m = ini.match(/^\s*VoiceUrl\s*=\s*(\S+)/m);
    return m ? String(m[1]).replace(/\/+$/, '') : '';
  })();
  /*
    The four social keys, and P and J are Patrick's own choices:
    "P for the Party menu... J for Journal".

    DirectInput scan codes, the same as ChatKey and SkillsKey above, because
    that is what buttonEvent hands back. Y, H and L do nothing in vanilla
    Skyrim and are only armed while somebody is under the crosshair, so even a
    mod that wanted one of them would keep it the rest of the time.
  */
  let PARTY_KEY   = iniNumber(ini, 'PartyKey', 25);      // P
  let JOURNAL_KEY = iniNumber(ini, 'JournalKey', 36);    // J
  let FRIEND_KEY  = iniNumber(ini, 'FriendKey', 21);     // Y, not G: G is the emote wheel (#529)
  let TRADE_KEY   = iniNumber(ini, 'TradeWithKey', 35);  // H
  /*
    MuteThemKey, NOT MuteKey. MuteKey is already in this same file and is the
    microphone's, once a row on the Controls page with nothing reading it
    (it went in #529). Reusing the name would have made one launcher row set
    two different things.

    L rather than G, B or N: WheelKey is G, VoiceModeKey is B and StopKey is
    N, all of them in this file already.
  */
  let MUTE_KEY    = iniNumber(ini, 'MuteThemKey', 38);   // L
  /*
    The key mold, pressed into the lock of the door under the crosshair.
    Patrick, 24 September: "actually can we make it a different key that is
    unused in tis scenario and include a prompt when loooking at a door to
    press that key to set a mold". Not E, because E opens the door. U, scan
    code 22, because vanilla Skyrim binds nothing to it and neither does
    anything of ours: not a default in this file or in the emote, voice and
    mark plugins, not a value in Thornswood.ini and not a row on the
    launcher's Controls page, checked on 24 September and held there by
    test-mold-key.js. Like G, H and L it only means anything while its
    prompt is up.
  */
  let MOLD_KEY    = iniNumber(ini, 'MoldKey', 22);       // U
  let LOCK_KEY    = iniNumber(ini, 'LockKey', 45);       // X
  /*
    The holder's sleep key on the look prompt (#1603). Patrick: the holder
    names who may sleep there "with buttons and GUI, not commands". THE MOLD'S
    KEY, U, and not a new one: every letter is already Skyrim's or ours, and
    test-thornswood-keys.js holds no two of ours on one default. The two never
    meet: the mold is armed only while a door is under the crosshair, and this
    only while a person is, inside a building you hold. Rebinding MoldKey moves
    both, and its row on Settings says so.
  */
  let SLEEP_KEY   = MOLD_KEY;
  /*
    A Master's "Take on as apprentice" on the look prompt (#1634). K, THE
    SKILLS KEY, and not a new one: every letter is already Skyrim's or ours,
    and what it does is open the K panel anyway, on its Masters and
    apprentices page with the person under the crosshair and a Take on for
    each half the server says could be meant. Only while the server's near
    list puts the row there; the rest of the time K is K. See
    apprenticePress.
  */
  let APPRENTICE_KEY = SKILLS_KEY;
  /*
    "Dye their hair" on the look prompt (#2675). K again, for the same
    reason: it opens the K panel, on its Hair dye page with the person under
    the crosshair and an Offer to dye on each dye you carry. Only while the
    server's near list says you carry one (hd). A Master's Take on wins the
    key when both apply; Dye hair under Near you on P is there either way.
    See hairDyePress.
  */
  let HAIR_DYE_KEY = SKILLS_KEY;
  /*
    "Tend their wounds" on the look prompt (#1383). THE LOCK KEY, X, and not
    a new one: every letter is already Skyrim's or ours. The two never meet:
    the lock key answers only with a door, a crop or a forge under the
    crosshair (lockKeyNow), and this only with a person the server's near
    list says has a wound to tend. Rebinding LockKey moves both, and its
    row on Settings says so. See treatPress.
  */
  let TREAT_KEY = LOCK_KEY;
  /*
    "Tend your wounds" in the inventory (#1383). THE TRADE KEY, H: in the
    inventory the social keys refuse to act, Skyrim's controlmap.txt binds
    nothing to H (measured 24 September, tests/test-creation-close.js), and
    U, the key the repair kit uses there, can be up at the same time as this.
    See treatSelfPress.
  */
  let TREAT_SELF_KEY = TRADE_KEY;
  /*
    "Salt or smoke your food" in the inventory (#3163). THE FRIEND KEY, Y,
    and not a new one: every letter is already Skyrim's or ours. In the
    inventory the social keys refuse to act and Skyrim binds nothing to Y,
    and U, H and X, the other three keys with a line there, are other keys,
    so all four lines can be up at once. Rebinding FriendKey moves both. See
    preservePress.
  */
  let PRESERVE_KEY = FRIEND_KEY;
  /*
    A warrior's maneuvers (#1386): opens the maneuver panel. 9, scan code 10:
    1 to 8 are the game's own favourites hotkeys (and the emote slots while
    the wheel is open), and every letter is already one of ours or the game's.
  */
  let MANEUVER_KEY = iniNumber(ini, 'ManeuverKey', 10);  // 9
  /*
    The help panel (#1633): what /help said, as keys and panels, opened
    without the chat. Patrick's answer on #1633: its own key, on the
    launcher's Controls page then and on Settings in the game since #3126,
    and Help on the K, P and J panels. F7, scan code 65:
    every letter is already Skyrim's or ours, F1 to F4 are SkyUI's
    favourite groups (F1 and F2 the client's as well), F5 and F9 save and
    load, F6 is the client's, F8 the mark and F10 closing Skyrim at
    creation; tests/test-1633-help-panel.js checks it the way
    test-mold-key.js checks U.
  */
  let HELP_KEY = iniNumber(ini, 'HelpKey', 65);          // F7
  /*
    Five keys the help panel names that are read by the voice and emote
    plugins and not used here: the help says the key as this machine has it.
    The stop key gets somebody out of an idle they are stuck in, and the
    voice lock keeps the microphone open (#4548).
  */
  let TALK_KEY = iniNumber(ini, 'PushToTalk', 47);       // V
  let VOICE_MODE_KEY = iniNumber(ini, 'VoiceModeKey', 48); // B
  let WHEEL_KEY = iniNumber(ini, 'WheelKey', 34);        // G
  let STOP_KEY = iniNumber(ini, 'StopKey', 49);          // N
  let VOICE_LOCK_KEY = iniNumber(ini, 'VoiceLockKey', 24); // O
  /* What the prompt calls them. Read off the scan code so a rebind in the ini
     changes the letter on the screen as well as the key that works. */
  function keyName(code) {
    const letters = {
      16: 'Q', 17: 'W', 18: 'E', 19: 'R', 20: 'T', 21: 'Y', 22: 'U', 23: 'I',
      24: 'O', 25: 'P', 30: 'A', 31: 'S', 32: 'D', 33: 'F', 34: 'G', 35: 'H',
      36: 'J', 37: 'K', 38: 'L', 44: 'Z', 45: 'X', 46: 'C', 47: 'V', 48: 'B',
      49: 'N', 50: 'M',
      2: '1', 3: '2', 4: '3', 5: '4', 6: '5', 7: '6', 8: '7', 9: '8', 10: '9', 11: '0',
      // The help panel names the chat keys and its own (#1633).
      28: 'Enter', 53: '/',
      59: 'F1', 60: 'F2', 61: 'F3', 62: 'F4', 63: 'F5', 64: 'F6', 65: 'F7',
      66: 'F8', 67: 'F9', 68: 'F10', 87: 'F11', 88: 'F12',
      // The rest the Settings panel offers (#3126), so a key moved there is
      // named on the prompts as it is on the panel, and Escape, the wheel's
      // close key unless it is moved.
      1: 'Escape', 12: '-', 13: '=', 14: 'Backspace', 15: 'Tab', 26: '[', 27: ']', 39: ';', 40: '\'',
      41: '`', 43: '\\', 51: ',', 52: '.', 54: 'Right Shift', 58: 'Caps Lock', 69: 'Num Lock',
      70: 'Scroll Lock', 157: 'Right Ctrl', 184: 'Right Alt', 197: 'Pause', 199: 'Home',
      201: 'Page up', 207: 'End', 209: 'Page down', 210: 'Insert', 211: 'Delete',
      259: 'Mouse 4', 260: 'Mouse 5'
    };
    return letters[code] || ('#' + code);
  }
  let PARTY_NAME = keyName(PARTY_KEY);
  let FRIEND_NAME = keyName(FRIEND_KEY);
  let TRADE_NAME = keyName(TRADE_KEY);
  let MUTE_NAME = keyName(MUTE_KEY);
  let MOLD_NAME = keyName(MOLD_KEY);
  let SLEEP_NAME = keyName(SLEEP_KEY);
  let APPRENTICE_NAME = keyName(APPRENTICE_KEY);
  let HAIR_DYE_NAME = keyName(HAIR_DYE_KEY);
  let LOCK_NAME = keyName(LOCK_KEY);
  let MANEUVER_NAME = keyName(MANEUVER_KEY);
  let HELP_NAME = keyName(HELP_KEY);
  let TREAT_NAME = keyName(TREAT_KEY);
  let TREAT_SELF_NAME = keyName(TREAT_SELF_KEY);
  let PRESERVE_NAME = keyName(PRESERVE_KEY);

  /*
    A KEY CHANGED IN THE GAME (#3126). The Settings panel writes
    Thornswood.ini (setSetting, below) and this reads it again, so every key
    above and every name the prompts show is the file's from the next press.
    Each line is its declaration's again, with the default the Settings
    panel's list (SETTINGS_KEYS, below) gives it, and
    tests/test-3126-settings.js holds the two together.
  */
  function readKeys(text) {
    ini = text;
    CHAT_KEY = iniNumber(ini, 'ChatKey', SETTINGS_KEYS.ChatKey);
    COMMAND_KEY = iniNumber(ini, 'CommandKey', SETTINGS_KEYS.CommandKey);
    SKILLS_KEY = iniNumber(ini, 'SkillsKey', SETTINGS_KEYS.SkillsKey);
    CHAT_FADE = chatFadeOf(ini);
    NEEDS_BARS = needsBarsOf(ini);
    PARTY_KEY = iniNumber(ini, 'PartyKey', SETTINGS_KEYS.PartyKey);
    JOURNAL_KEY = iniNumber(ini, 'JournalKey', SETTINGS_KEYS.JournalKey);
    FRIEND_KEY = iniNumber(ini, 'FriendKey', SETTINGS_KEYS.FriendKey);
    TRADE_KEY = iniNumber(ini, 'TradeWithKey', SETTINGS_KEYS.TradeWithKey);
    MUTE_KEY = iniNumber(ini, 'MuteThemKey', SETTINGS_KEYS.MuteThemKey);
    MOLD_KEY = iniNumber(ini, 'MoldKey', SETTINGS_KEYS.MoldKey);
    LOCK_KEY = iniNumber(ini, 'LockKey', SETTINGS_KEYS.LockKey);
    SLEEP_KEY = MOLD_KEY;
    APPRENTICE_KEY = SKILLS_KEY;
    HAIR_DYE_KEY = SKILLS_KEY;
    TREAT_KEY = LOCK_KEY;
    TREAT_SELF_KEY = TRADE_KEY;
    PRESERVE_KEY = FRIEND_KEY;
    MANEUVER_KEY = iniNumber(ini, 'ManeuverKey', SETTINGS_KEYS.ManeuverKey);
    HELP_KEY = iniNumber(ini, 'HelpKey', SETTINGS_KEYS.HelpKey);
    TALK_KEY = iniNumber(ini, 'PushToTalk', SETTINGS_KEYS.PushToTalk);
    VOICE_MODE_KEY = iniNumber(ini, 'VoiceModeKey', SETTINGS_KEYS.VoiceModeKey);
    WHEEL_KEY = iniNumber(ini, 'WheelKey', SETTINGS_KEYS.WheelKey);
    STOP_KEY = iniNumber(ini, 'StopKey', SETTINGS_KEYS.StopKey);
    VOICE_LOCK_KEY = iniNumber(ini, 'VoiceLockKey', SETTINGS_KEYS.VoiceLockKey);
    PARTY_NAME = keyName(PARTY_KEY);
    FRIEND_NAME = keyName(FRIEND_KEY);
    TRADE_NAME = keyName(TRADE_KEY);
    MUTE_NAME = keyName(MUTE_KEY);
    MOLD_NAME = keyName(MOLD_KEY);
    SLEEP_NAME = keyName(SLEEP_KEY);
    APPRENTICE_NAME = keyName(APPRENTICE_KEY);
    HAIR_DYE_NAME = keyName(HAIR_DYE_KEY);
    LOCK_NAME = keyName(LOCK_KEY);
    MANEUVER_NAME = keyName(MANEUVER_KEY);
    HELP_NAME = keyName(HELP_KEY);
    TREAT_NAME = keyName(TREAT_KEY);
    TREAT_SELF_NAME = keyName(TREAT_SELF_KEY);
    PRESERVE_NAME = keyName(PRESERVE_KEY);
    CLOSE_GAME_KEY = iniNumber(ini, 'CloseGameKey', SETTINGS_KEYS.CloseGameKey);
    CLOSE_GAME_NAME = keyName(CLOSE_GAME_KEY);
  }
  /*
    HANDING OVER A LETTER (#1595). Patrick, 4 Oct: /deliver becomes a key on
    the look prompt, shown while you carry a letter for the person under the
    crosshair. Which key was not said; the question is on #1595 and this is
    its suggested answer: E, Skyrim's own Activate, on that person, the way E
    works on a board, a driver or a trader. Every letter is already Skyrim's
    or ours, and U, the one other key a person under the crosshair can have,
    is the holder's Let sleep here (#1603), which can be up at the same time.
    0 means the Activate control, wherever the person has bound it; a scan
    code here (MOLD_KEY, say) puts it on that key instead.
  */
  const DELIVER_KEY = 0;
  function deliverName() {
    if (DELIVER_KEY) { return keyName(DELIVER_KEY); }
    let code = 0;
    try { code = sp.Input.getMappedKey('Activate', 0); } catch (e) { code = 0; }
    // 18 is E, Skyrim's own default for Activate, when the game does not say.
    return keyName(code > 0 && code < 256 ? code : 18);
  }

  const ESC = 1;

  const client = (function () {
    try { return JSON.parse(readText(CLIENT_SETTINGS)) || {}; } catch (e) { return {}; }
  })();
  const HOST = String(client['server-ip'] || '');

  /*
    THE SERVER'S OWN RESOURCE PORT, the HTTP beside the game port that serves
    online.json, server-bases.json and the load order manifest. The rule is
    SkyMp.ResourcePortFor's: 3000 for the main server on 7777, the game port
    plus one for any other, so 7788 for the dev server on 7787.

    Every address here that talks to the game server's HTTP is made from this
    one line (#1264). Until 29 Sep the server probe and the server handled
    bases asked port 3000 whatever server the game was on, so a game on the
    dev server watched the live server. On 29 Sep the dev server went down
    three times under people in the world, the probe kept hearing live answer,
    and nobody was taken back to the menu: they stood in a world with no
    server behind it until they closed the game themselves.
  */
  const SERVER_PORT = Number(client['server-port']) || 7777;
  const RESOURCE_PORT = SERVER_PORT === 7777 ? 3000 : SERVER_PORT + 1;
  const RESOURCE_URL = HOST ? 'http://' + HOST + ':' + RESOURCE_PORT : '';

  /*
    The token that says which profile may join the voice room.

    Fetched by the launcher, which is the only thing here holding a Discord
    ticket, and left in the same folder it already uses for the push to talk
    state: the last one it minted for this game, or nothing.

    Empty is not an error to report here. The service refuses a handshake
    without one, and says so in its own log.
  */
  function joinToken() {
    for (const d of ['Data/Platform/', '../Profile/']) {
      const raw = readText(d + 'voice-token.txt').trim();
      if (raw) { return raw; }
    }
    return '';
  }
  // v2.<profile>.<minted>.<nonce>.<mac>: whose a token is, or 0.
  function tokenProfile(tok) { return Number(String(tok || '').split('.')[1]) || 0; }

  /*
    ASKING FOR ONE (#1322). A token opens one connection and is good for two
    minutes, so nothing here keeps one. When the chat is about to connect and
    has none it says 'token? <profile>', and this writes the ask into
    voice-token-ask.txt, "<profile> <time>", in the two folders the voice
    plugin uses for push to talk, so every ask is a change the launcher's
    watch on that folder wakes for. The launcher mints a token for that
    character and writes it to voice-token.txt, and the tick hands it to the
    chat (tokenWant, below; lineTick at the menu).
  */
  let tokenWant = 0;           // the profile an ask is out for, 0 for none
  function askToken(id) {
    id = Number(id) || 0;
    if (id <= 0) { return; }
    tokenWant = id;
    let wrote = false;
    for (const d of ['Data/Platform/', '../Profile/']) {
      try { require('fs').writeFileSync(d + 'voice-token-ask.txt', id + ' ' + Date.now() + '\n'); wrote = true; }
      catch (e) { }
    }
    if (!wrote) { log('could not write voice-token-ask.txt, so the launcher was not asked for a join token'); }
  }
  // Whose session this is. From the settings file until 20 September; now the
  // settings hold the last one played and the real answer comes from the main
  // menu (the block below), so this is reassigned when the choice is made.
  let PROFILE = Number((client.gameData || {}).profileId) || 0;
  // For the other plugins, which read the settings file and so had the
  // character played last rather than the one picked (#3128): voice asks
  // this, and follows a pick made again at the choice in the game.
  T.profile = function () { return PROFILE; };

  /*
    Whose a join pass is: its p, or 0 (#3128). jp1.<payload>.<mac>, the
    payload base64url JSON the site signs (readPass in gamemode.js reads the
    same). Only read here, never trusted: the server checks the signature.
    A pass is put in storage and sent only for the character this game is
    now, so a character picked again at the choice in the game is never
    offered the one before it's pass while the launcher fetches its own.
  */
  function passProfile(raw) {
    const parts = String(raw || '').split('.');
    if (parts.length !== 3 || parts[0] !== 'jp1') { return 0; }
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let bits = 0, acc = 0, text = '';
    for (let i = 0; i < parts[1].length; i++) {
      const v = A.indexOf(parts[1].charAt(i));
      if (v < 0) { return 0; }
      acc = ((acc << 6) | v) & 0xffffff;
      bits += 6;
      if (bits >= 8) { bits -= 8; text += String.fromCharCode((acc >> bits) & 255); }
    }
    try { return Number(JSON.parse(text).p) || 0; } catch (e) { return 0; }
  }

  // ------------------------------------------------- the main menu choice --
  /*
    Who you are is chosen at the game's main menu, not in the launcher.

    Asked for by Patrick on 20 September. The launcher writes the list of this
    install's characters to thornswood-characters.json and sets
    gameData.chooseAtMenu in the client settings; our fork of skymp5-client
    then waits at the menu instead of logging in as gameData.profileId. This
    block loads the page into the browser at the menu, hands the list to
    thornswood-select.js, and the page's pick goes straight to the client as

        sendMessage('thornswood', 'select', profileId)

    which the client hears (it is a browserMessage like any other) and logs in
    as. This plugin hears the same message, remembers the profile for the
    voice join and the chat, and writes it to thornswood-choice.txt for the
    launcher, which fetches the voice token for that profile and keeps the
    books.

    It runs on tick and not on update, because update does not fire at the
    main menu (it needs the Papyrus VM, which needs a game). Nothing here
    calls into the game, only the browser and the disk, which is what tick is
    allowed. The rest of this file waits for update as before and finds the
    page already loaded, which it handles the same way it handles a reload.

    With no list on disk (an older launcher) the settings' profileId is sent
    as the choice at once, so nobody sits at a menu that asks nothing.
  */
  const CHOICE_FILE = 'Data/Platform/thornswood-choice.txt';
  const CHARACTERS_FILE = 'Data/Platform/thornswood-characters.json';
  const FORGET_FILE = 'Data/Platform/thornswood-forget.txt';
  // "Start without the scroll next time" on the choice page (Djinn, 24
  // September): "off" in here and the launcher tells the page, and the
  // injected list below carries it too. Anything else, or no file, shows it.
  const INTRO_FILE = 'Data/Platform/thornswood-intro.txt';
  const chooseAtMenu = !!((client.gameData || {}).chooseAtMenu);
  let menuPhase = 0;
  let menuAt = 0;
  const loadedAt = Date.now();
  // The scroll setting as it stood when this start began, read once below.
  // Not moved by the tick box on either screen: that box is about the next
  // start, and the wait this session was decided before anybody saw it.
  let menuIntroOff = false;
  let menuWent = false;     // Continue was pressed on the scroll
  let menuStayAt = 0;
  let menuFgAt = 0;
  let menuFgWas = null;
  // Back at the choice after being moved out for being idle (#1142):
  // { id, name } of the character they were, until the world is up again.
  let menuAgain = null;

  function chosenOnDisk() {
    try { return !!readText(CHOICE_FILE).trim(); } catch (e) { return false; }
  }


  /*
    ------------------------------------------- which race the body is (#614)

    Patrick via Smeagle: any clothes a Goblin or Riekling wears break on rejoin
    or leaving a building, the neck sits wrong and the body shows through. What
    answered it took every worn piece off and put it back on at each cell
    change, and that is what left people undressed at a door and on arriving
    in their home town (4 October), so it is gone and the cause is measured
    here instead.

    The lead: skymp5-client sets the race on the character's base record
    (TESModPlatform.setNpcRace in applyAppearanceCommon) and never on the
    character itself, so after the body is rebuilt the body and the clothes can
    be built for two different races. This writes both down each time the cell
    changes, for everybody, and changes nothing: the character's own race
    (Actor.GetRace) and its base record's (ActorBase.GetRace). One line a cell.

    Four times a second, not every frame (#963): the old remount check was the
    costliest handler in the frame when it read the race on every one.
  */
  let raceReadCell = -1;
  let raceReadAt = 0;
  function raceName(race) {
    if (!race) { return 'none'; }
    let name = '';
    try { name = String(race.getName() || ''); } catch (e) { name = ''; }
    let id = 0;
    try { id = race.getFormID(); } catch (e) { id = 0; }
    return (name || '(no name)') + ' ' + id.toString(16);
  }
  function raceReadTick() {
    const at = Date.now();
    if (at - raceReadAt < 250) { return; }
    raceReadAt = at;
    let pc = null;
    try { pc = sp.Game.getPlayer(); } catch (e) { return; }
    if (!pc) { return; }
    let cellId = 0;
    try {
      const cell = pc.getParentCell();
      cellId = cell ? cell.getFormID() : 0;
    } catch (e) { cellId = 0; }
    if (!cellId || cellId === raceReadCell) { return; }
    raceReadCell = cellId;
    let own = null, base = null;
    try { own = sp.Actor.from(pc).getRace(); } catch (e) { own = null; }
    try { base = sp.ActorBase.from(pc.getBaseObject()).getRace(); } catch (e) { base = null; }
    let same = false;
    try { same = !!own && !!base && own.getFormID() === base.getFormID(); } catch (e) { same = false; }
    log('race at cell ' + cellId.toString(16) + ': the character ' + raceName(own) +
        ', its base record ' + raceName(base) + (same ? '' : ', NOT THE SAME'));
  }

  /*
    KEEP SAYING THE CHOICE UNTIL THE WORLD ACTUALLY LOADS.

    The page sends its pick to skymp5-client and repeats it every two seconds
    until something says it heard, because the page is up long before the
    plugins are: SkyrimPlatform loads index.html at start and runs plugins
    about fifteen seconds later. That repeat is the only thing covering the
    gap, and menuChose below was ending it from the wrong side of the room.

    This plugin is not skymp5-client. Its own browserMessage handler sees the
    pick, writes the choice file and acks the page, which hides the menu and
    stops the repeat. skymp5-client's AuthService only acts on that same
    message while it is waiting for it, and it starts waiting when it gets
    authNeeded. If the person clicked before that, AuthService's handler
    returned early, this plugin acked anyway, the page went quiet, and the
    pick was gone for good. No authAttempt, so no join, so the menu vanishes
    and the main menu is where you stay. That is what a tester reported twice,
    and what Djinn hit: "click make a new character and then are stuck on the
    main menu with selector menu gone".

    So the plugin takes the repeat over rather than ending it. A duplicate
    costs nothing: once AuthService has taken one it clears its own wait and
    every later copy falls to `default: break` in its switch.

    __thornswoodInWorld is the flag the tick sets when the world is really
    there, so arriving is what stops this and not a guess about timing.
  */
  const MENU_SAY_EVERY = 2000;
  const MENU_SAY_FOR = 90000;
  let menuChosenId = 0;
  let menuChosenAt = 0;
  let menuSaidAt = 0;
  let menuSaidTimes = 0;
  let menuGiveUpTold = false;

  function keepSayingChoice(now) {
    let here = false;
    try { here = !!globalThis.__thornswoodInWorld; } catch (e) { here = false; }
    if (here) {
      log('menu: in the world as profile', menuChosenId, 'so the choice is done');
      menuChosenId = 0;
      menuAgain = null;
      return;
    }
    if (now - menuChosenAt > MENU_SAY_FOR) {
      if (!menuGiveUpTold) {
        menuGiveUpTold = true;
        log('menu: said profile', menuChosenId, 'for',
            Math.round(MENU_SAY_FOR / 1000) + 's and the world never loaded.',
            'The client never took the choice. Nothing more this can do.');
      }
      menuChosenId = 0;
      return;
    }
    if (now - menuSaidAt < MENU_SAY_EVERY) { return; }
    menuSaidAt = now;
    menuSaidTimes++;
    /*
      Said out loud the first time and then every ten, because this log is the
      only place anybody can see this working. On a machine where the client
      was ready the choice is taken at once and none of these ever appear, so
      a run that shows them is a run that would have been stuck before.
    */
    if (menuSaidTimes === 1 || menuSaidTimes % 10 === 0) {
      /*
        THE TWO FLAGS ARE THE WHOLE DIAGNOSIS, so they go in the line.

        remoteServer.ts decides whether to load the world with
        `alreadyInAGame = __thornswoodInWorld || __thornswoodUncausedLoad > 0`,
        and when that is true it stands down and leaves the moving to the
        other spawn path. At a real main menu there is no other path, so
        nothing happens at all and the person sits there.

        21 September: a tester picked a character, the server logged him
        connected and put him in the creation hall correctly, and his own
        machine never left the main menu. Everything up to that point was
        provable from the server log and this one. That decision was not,
        because nothing wrote either flag down.

        uncaused is the count of game loads SkyrimPlatform did not ask for.
        Start On Save made one on every launch that had a save to load, until
        it left the build (issue #394). If it reads above zero here, at a main
        menu, something else loaded a save, and that guard is why the world
        never came.
      */
      let inWorld = '?', uncaused = '?';
      try { inWorld = String(!!globalThis.__thornswoodInWorld); } catch (e) { }
      try { uncaused = String(Number(globalThis.__thornswoodUncausedLoad) || 0); } catch (e) { }

      /*
        AND WHAT IS IN THE SAVES FOLDER, which is the question this whole
        entry now turns on and which nobody can answer without walking to the
        stuck machine.

        sp.loadGame builds a synthetic save and loads it, and it leaves the
        file behind. On a machine where this works the folder holds exactly one
        file, TESMODPLATFORM-<guid>.ess. So:

          EMPTY means loadGame was never called at all, and the fault is above
          it, in whatever decides to call it or in the message never arriving.

          A TESMODPLATFORM FILE means loadGame ran and Skyrim refused the save,
          which on a fresh install points at the mod files being incomplete.

        Those two answers go to completely different places, which is exactly
        why it is worth one line in a log rather than one trip to somebody's
        house. The launcher redirects My Games into the Thornswood Profile
        folder, so the path here is the redirected one and not the real
        Documents.

        Guarded to nothing: a client with no fs, or a folder that is not there
        yet, says so instead of stopping the retry that is the point of this
        function.
      */
      let saves = 'unknown';
      try {
        const fsm2 = require('fs');
        /*
          RELATIVE TO THE GAME FOLDER, which is where the process runs: the
          crash logs record "Working Directory: C:\Thornswood\Game", and the
          log file this function writes to is 'Data/Platform/...' for the same
          reason. The Profile folder sits BESIDE Game, not inside it, so this
          is one level up. Written relative rather than absolute so the dev
          build, which lives in Thornswood-DevBuild, answers about its own
          saves and not about the play install's.
        */
        const dir = '../Profile/MyGames/Saves';
        const names = fsm2.readdirSync(dir);
        const ess = names.filter(function (n) { return /\.ess$/i.test(n); });
        const plat = ess.filter(function (n) { return /^TESMODPLATFORM/i.test(n); });
        saves = ess.length + ' save(s), ' + plat.length + ' from loadGame' +
                (plat.length ? ' (' + plat[0] + ')' : '');
      } catch (e) {
        saves = 'could not read the saves folder: ' + ((e && e.message) || e);
      }

      log('menu: the client has not taken profile', menuChosenId, 'yet, saying it again',
          '(' + menuSaidTimes + ').',
          'inWorld=' + inWorld, 'uncausedLoads=' + uncaused, 'saves: ' + saves);
    }
    T.js('try{window.skyrimPlatform.sendMessage("thornswood","select",' +
         menuChosenId + ');}catch(e){}');
  }

  sp.on('tick', guard('menu', () => {
    if (!chooseAtMenu) { return; }
    const now = Date.now();

    // The choice holds the keyboard by name, the way every panel does, for as
    // long as it is up and not a tick longer, whichever path below ended it.
    // First, so nothing that throws further down can leave it held.
    T.claimFocus('select', choiceUp());

    // The game refused to build the save for the pick (#1994): the choice comes back.
    if (loadRefused()) { return; }

    // Which window the keys are going to, and the two words that hold the
    // client's wait open. Both are needed for as long as the choice is up and
    // neither can be left to the page alone: see menuWatch.
    if (choiceUp()) { menuWatch(now); }

    // Before the phase check, because menuChose parks the phase at 9 and this
    // has to go on running after it.
    if (menuChosenId) { keepSayingChoice(now); }
    // The line at the menu while the world is full (#481).
    lineTick(now);

    if (menuPhase === 9) { return; }

    /*
      No loadUrl here, ever. What the browser's own log showed on 20
      September at 15:09: SkyrimPlatform loads Data/Platform/UI/index.html
      itself at start, fifteen seconds before any plugin runs, so the page
      is already ours and already drawing the choice from the list the
      launcher wrote. Tilted applies a loadUrl only inside its mouse move
      handler, so the one this block used to issue sat until the first
      mouse move and then navigated away from the page the person was
      looking at. That was the vanish, four times over.

      So this asks the page where it is and what it has, and only fills in
      what is missing: an index.html from before this change gets the list
      and the script injected; a browser on some other address (none known)
      gets a loadUrl as a last resort and the wait that comes with it.

      Shown from the start (#3129). The page was drawn and hidden for those
      fifteen seconds, with the game's own menu picture the only thing on
      screen, because SkyrimPlatform makes its browser hidden and nothing
      showed it before this tick. The fork's SkyrimPlatform now shows and
      focuses it as it is made ([Browser] ShowAtStart, on unless the ini
      says false), and skymp5-client no longer hides it as it loads when the
      choice is made here. The setVisible and setFocused below are what
      shows it when ShowAtStart is off.
    */
    if (menuPhase === 0) {
      // 100 ms, was 600 (Djinn, 25 September: the still before the loop was up too long).
      if (now - loadedAt < 100) { return; }
      if (!menuAgain && chosenOnDisk()) { menuPhase = 9; log('menu: a choice is already on disk for this session'); return; }
      // Read once, here, because menuWatch below needs it on every tick and
      // the page is not always the one that told us (menuWhere only reads it
      // when the page came up without the choice already drawn).
      menuIntroOff = readText(INTRO_FILE).trim() === 'off';
      try {
        sp.browser.setVisible(true);
        sp.browser.setFocused(true);
      } catch (e) {
        log('menu: no browser backend:', e);
        menuPhase = 9;
        return;
      }
      menuPhase = 1; menuAt = now; menuAsked = 0;
      log('menu: showing the page and asking where it is');
      return;
    }

    if (menuPhase === 1) {
      // Ask once a second until the page answers (browserMessage below).
      if (now - menuAsked > 1000) {
        menuAsked = now;
        T.js('try{window.skyrimPlatform.sendMessage("thornswood-front","where "+location.href+" "+(window.thornswoodSelect?"select":(window.THORNSWOOD_SELECT?"list":"bare")));}catch(e){}');
      }
      // Nothing back in five seconds: the page is not ours or not up. Load
      // ours; Tilted applies it on the next mouse move, which is the wait
      // this block otherwise avoids.
      if (now - menuAt > 5000 && !menuLoaded) {
        menuLoaded = true;
        log('menu: the page did not answer in five seconds, loading ours');
        try { sp.browser.loadUrl(UI_URL); } catch (e) { }
        menuAt = now;
      }
      return;
    }

    if (menuPhase === 2) {
      /*
        The page's own pulse, and a reload when it stops. Kept from the
        earlier cut as the safety net: the page beats every two seconds
        while the choice is up; six seconds of silence and this reloads it,
        three times at most, and says so.
      */
      if (menuBeatAt && now - menuBeatAt > 6000) {
        if (menuReloads >= 3) {
          if (!menuGaveUp) {
            menuGaveUp = true;
            log('menu: the page went silent three times; leaving it.',
                menuIntroOff
                  ? 'The scroll is switched off for this person, so the client falls back to the last character after three minutes.'
                  : 'The scroll is on, so menuWatch goes on telling the client to wait and nothing falls back.');
          }
        } else {
          menuReloads++;
          log('menu: the page went silent for six seconds, loading it again (' + menuReloads + ' of 3)');
          try { sp.browser.loadUrl(UI_URL); sp.browser.setVisible(true); sp.browser.setFocused(true); } catch (e) { }
          menuPhase = 1; menuAt = now; menuAsked = 0; menuBeatAt = 0; menuLoaded = true;
          return;
        }
      }

      /*
        Held up and held focused, four times a second, until the choice is
        made. skymp5-client's BrowserService hides the browser for every
        menu it calls bad, the main menu among them, and shows it again
        only when none is open, which at the main menu is never; and its
        Escape handler and login path both drop focus.
      */
      if (now - menuAt > 250) {
        menuAt = now;
        let vis = true, foc = true;
        try { vis = !!sp.browser.isVisible(); } catch (e) { }
        try { foc = !!sp.browser.isFocused(); } catch (e) { }
        if (!vis) {
          // NirnLab hiding also drops its real focus, while SkyrimPlatform's
          // getter still reports the requested focus. Restore both together.
          try { sp.browser.setVisible(true); sp.browser.setFocused(true); } catch (e) { }
          if (!menuHidTold) { menuHidTold = true; log('menu: something hid the browser while the choice was up; shown again'); }
        }
        if (!foc) {
          try { sp.browser.setFocused(true); } catch (e) { }
          if (!menuBlurTold) { menuBlurTold = true; log('menu: something took the mouse off the page while the choice was up; taken back'); }
        }
      }
    }
  }));
  let menuAsked = 0;
  let menuLoaded = false;

  /*
    The page answered "where": its address and whether the choice is
    mounted. Ours with the choice up: done, watch it. Ours without: an
    index.html from before 20 September, so the list and the script go in
    by hand. Anything else: load ours.
  */
  function menuWhere(href, has) {
    if (menuPhase !== 1) { return; }
    const ours = /\/Data\/Platform\/UI\/index\.html$/i.test(String(href));
    if (!ours) {
      if (!menuLoaded) {
        menuLoaded = true;
        log('menu: the browser is on', href, 'and not our page; loading ours');
        try { sp.browser.loadUrl(UI_URL); } catch (e) { }
      }
      return;
    }
    if (has === 'select') {
      menuPhase = 2; menuAt = Date.now(); menuBeatAt = Date.now();
      log('menu: the page is ours and the choice is up');
      return;
    }
    // Ours, but the page did not bring the choice up itself.
    let list = null;
    try { list = JSON.parse(readText(CHARACTERS_FILE)); } catch (e) { list = null; }
    if (!list || !Array.isArray(list.characters)) {
      if (PROFILE > 0) {
        T.js('try{window.skyrimPlatform.sendMessage("thornswood","select",' + PROFILE + ');}catch(e){}');
        log('menu: no character list on disk, so joining as profile', PROFILE, 'from the settings');
      } else {
        log('menu: no character list on disk and no profile in the settings; the client will wait and then say so');
      }
      try { sp.browser.setFocused(false); } catch (e) { }
      menuPhase = 9;
      return;
    }
    try { if (readText(INTRO_FILE).trim() === 'off') { list.intro = false; } } catch (e) { }
    // Back from being idle (#1142): no scroll and no theme, and the page
    // starts in the place in line this game holds for the character it was.
    // Ended by the server (#1157): the slots, with the server's sentence over
    // them, and no place in line.
    // Change character on K (#3128): the slots and nothing over them, with
    // the character they just left lit and named, since a character made in
    // this game has no name in the list the launcher wrote at its pick.
    if (menuAgain) {
      list.intro = false; list.music = '';
      if (menuAgain.ended) { list.ended = String(menuAgain.ended); }
      else if (menuAgain.switched) {
        list.last = menuAgain.id;
        list.characters.forEach(function (c) {
          if (c && Number(c.profileId) === menuAgain.id && !c.name && menuAgain.name) { c.name = menuAgain.name; }
        });
      }
      else { list.away = menuAgain; }
    }
    // Written by the front, so the page knows the front is in and does not
    // say it is still loading (#5140).
    list.front = true;
    if (has !== 'list' || menuAgain) { T.js('window.THORNSWOOD_SELECT=' + JSON.stringify(list) + ';'); }
    inject('thornswood-select.js');
    menuPhase = 2; menuAt = Date.now(); menuBeatAt = Date.now();
    log('menu: the page is ours without the choice; put it in,', list.characters.length, 'character(s) listed');
  }
  let menuHidTold = false;
  let menuBlurTold = false;
  let menuBeatAt = 0;
  let menuReloads = 0;
  let menuGaveUp = false;

  /* The page chose. Called from the browserMessage handler below. */
  function menuChose(id) {
    PROFILE = id;
    try {
      require('fs').writeFileSync(CHOICE_FILE, id + ' ' + Date.now() + '\n');
    } catch (e) {
      log('menu: could not write the choice for the launcher:', e);
    }
    menuPhase = 9;
    T.claimFocus('select', false);
    try { sp.browser.setFocused(false); } catch (e) { }
    // The page repeats its pick every two seconds until this says it heard,
    // because the page can be up long before this plugin is. Acking stops
    // that repeat, so this plugin takes it over in the same breath rather
    // than leaving nobody saying it: see keepSayingChoice above for what
    // happened when nobody did.
    /*
      ONLY THE FIRST TIME STARTS THE CLOCK, and that is not a detail.

      Every resend asks the page to send its pick again, the page does, and
      that arrives back here as another call to this function. Setting the
      clock on each one meant the ninety second give up could never expire
      while the retry was doing its job: it was reset two seconds before it
      was due, for ever. Exactly the shape of the chargen nudge that sat
      unreachable behind its own guard.

      PROVED IN A TESTER'S LOG, 21 September: the resends ran from 17:35:55 to
      17:38:01, which is 126 seconds, and nothing gave up at 90.
    */
    if (menuChosenId !== id) {
      menuChosenId = id;
      menuChosenAt = Date.now();
      menuSaidAt = Date.now();
      menuSaidTimes = 0;
    }
    T.js('try{window.thornswoodSelect&&window.thornswoodSelect.acked();}catch(e){}');
    // The list the launcher wrote for the page. Gone now, so the page
    // reload in the world (phase 0 below) does not bring the choice back.
    try { require('fs').unlinkSync('Data/Platform/UI/thornswood-characters.js'); } catch (e) { }
    if (lineId) {
      log('menu: profile', lineId, 'leaves the line for the world after',
          Math.round((Date.now() - lineSince) / 1000) + 's');
      lineId = 0;
    }
    log('menu: chosen profile', id);
    if (menuAgain) { pickedAgain(id); relogAs(id); }
  }

  /*
    PICKED AGAIN AT THE CHOICE IN THE GAME, maybe as somebody else (#3128).

    The page, the chat's connection and the join pass in storage all outlive
    the world: they were the character this game was before it came back to
    the choice (the idle check, the server ending the session, or Change
    character on K). A pick at the menu at the start of a game is before any
    of them exist; a pick here is not, so each is moved to the new one here.

    - The chat (and voice, which rides on its socket) joins again as the
      new character: rejoinAs closes the connection and opens it as id,
      asking the launcher for that character's own token, and does nothing
      for the same character.
    - The join pass in storage, which skymp5-client answers the game
      server's login challenge with, goes when it is another character's.
      The client then waits for one, and the joinpass block puts this
      character's there once the launcher has fetched it (passProfile).
  */
  function pickedAgain(id) {
    T.js('try{window.thornswoodNet&&window.thornswoodNet.rejoinAs(' + id + ',"");}catch(e){}');
    let jp = null;
    try { jp = sp.storage.thornswoodJoinPass; } catch (e) { jp = null; }
    if (jp && typeof jp === 'object' && passProfile(jp.pass) !== id) {
      try { sp.storage.thornswoodJoinPass = null; } catch (e) { }
      log('menu: the join pass in storage was another character\'s, so the login waits for profile', id + '\'s own');
    }
  }

  /*
    BACK INTO THE WORLD FROM THE CHOICE THIS GAME CAME BACK TO (#1142).

    skymp5-client takes a pick only while it waits for its first login, which
    was long ago, and afkOut closed its connection. So the connection is
    opened again here, to the address the client itself connected to: the
    login it sends on connecting reads the profile from
    storage.authGameData (AuthService.handleConnectionAccepted in the fork),
    and the world loads as it does after any reconnect. keepSayingChoice says
    the pick every two seconds, so this goes once while a connection is up or
    on its way.
  */
  let relogAt = 0;
  // targetIp and targetPort are read by type: a key nobody set in storage is
  // a function, not undefined (the fork's storageProxy.js, #3333).
  function relogAs(id) {
    const now = Date.now();
    if (now - relogAt < 15000) { return; }
    let up = false;
    try { up = !!sp.mpClientPlugin.isConnected(); } catch (e) { up = false; }
    if (up) { return; }
    relogAt = now;
    try {
      sp.storage.authGameData = { local: { profileId: id } };
      const ip = sp.storage.targetIp;
      const host = String((typeof ip === 'string' && ip) || HOST || '');
      const port = (typeof sp.storage.targetPort === 'number' && sp.storage.targetPort) ||
                   Number(client['server-port']) || 7777;
      sp.mpClientPlugin.createClient(host, port);
      log('menu: back into the world as profile', id, 'through', host + ':' + port);
    } catch (e) {
      log('menu: could not connect again as profile', id + ':', e);
    }
  }

  /*
    ------------------------------------------------- the line at the menu (#481)

    Patrick, 29 Sep: a full world lets people "in the main menu if full but
    they sit there until a slot is free and it's their turn to join".

    The page no longer hands its pick straight to the client. It says
    'select:want <id>' here, and this asks the server's online.json (the same
    HTTP the load order manifest and the server probe use) whether somebody
    picking now would wait. Not full, or no answer in LINE_ASK_MS: go(), and
    the pick goes to the client exactly as before; the gamemode's seats block
    still judges the arrival.

    Full: the person stays at the menu with the page up, and waits in line.
    The line is the gamemode's, so this only says who is waiting: it opens
    the chat's relay at the menu (the voice join token the launcher fetches
    for the picked character proves who is asking), sends the launcher's
    join pass, and says "/line" every LINE_EVERY_MS. The gamemode answers the
    page directly with the place and, when a seat frees and it is their turn,
    go; the page then sends the pick and the world loads. Nothing is asked of
    the person while they wait: the "/line" is this plugin's. Closing the
    game closes the chat's connection, and the relay tells the gamemode at
    once, which drops the place (Patrick, 29 Sep); the "/line" every
    LINE_EVERY_MS is only how a menu asks again after the relay restarts. The
    choice file is written at once, because that is what makes the launcher
    fetch the token and the pass for this character.

    The client is told 'stay' while this waits, so its three minute fallback
    never logs in as the last character played in the middle of the line.
  */
  const LINE_PASS_FILE = 'Data/Platform/thornswood-pass.txt';
  const LINE_ASK_MS = 5000;
  const LINE_EVERY_MS = 10000;
  const LINE_PASS_EVERY_MS = 60000;
  // Made when first needed, on the server's own resource port (RESOURCE_URL).
  let lineHttp = null;
  function lineClient() {
    if (lineHttp) { return lineHttp; }
    try {
      lineHttp = RESOURCE_URL ? new sp.HttpClient(RESOURCE_URL) : null;
    } catch (e) { lineHttp = null; }
    return lineHttp;
  }
  let lineAsk = null;      // { id, at, seq } while online.json is asked about a pick
  let lineAskSeq = 0;
  let lineId = 0;          // the profile waiting in line, 0 for nobody
  let lineSince = 0;
  let lineTickAt = 0;
  let lineSaidAt = 0;
  let lineStayAt = 0;
  let linePassAt = 0;
  let linePassSent = '';
  let lineToken = '';
  let lineTokenAt = 0;
  let lineToldLauncher = false;
  let lineAskedAt = 0;
  /* How often the line asks the launcher for this character's token again
     while it has none. The launcher's fetch is a request over the network,
     and one that fails writes nothing, so the ask is repeated rather than
     waited on for ever; the page already says the line waits for the
     launcher (#1322). */
  const LINE_TOKEN_ASK_MS = 15000;

  /* The page picked. A seat, or the line. */
  function lineWant(id) {
    // The character already waiting: the page only looked at the slots
    // (back from being idle, #1142), so it goes back to its place.
    if (id === lineId) {
      T.js('try{window.thornswoodSelect&&window.thornswoodSelect.line(' + JSON.stringify({ id: id }) + ');}catch(e){}');
      return;
    }
    if ((lineAsk && lineAsk.id === id) || id === menuChosenId) { return; }
    // Another of this game's characters takes the place it already holds.
    if (lineId) { lineHand(id); return; }
    if (!lineClient()) { lineGo(id, 'no server address to ask'); return; }
    const seq = ++lineAskSeq;
    lineAsk = { id: id, at: Date.now(), seq: seq };
    log('menu: profile', id, 'picked, asking the server whether there is a seat');
    try {
      lineHttp.get('/online.json', undefined, guard('line ask', (res) => {
        if (!lineAsk || lineAsk.seq !== seq) { return; }
        lineAsk = null;
        let o = null;
        try {
          o = (res && res.status >= 200 && res.status < 300) ? JSON.parse(String(res.body || '{}')) : null;
        } catch (e) { o = null; }
        if (o && o.full === true) { lineStart(id, o); return; }
        lineGo(id, o ? 'a seat is free (' + (Number(o.now) || 0) + ' in the world)'
                     : 'the server did not say, so the pick goes and the server judges it');
      }));
    } catch (e) {
      lineAsk = null;
      lineGo(id, 'could not ask the server: ' + e);
    }
  }

  function lineGo(id, why) {
    log('menu: profile', id, 'goes in:', why);
    T.js('try{window.thornswoodSelect&&window.thornswoodSelect.go();}catch(e){}');
  }

  function lineStart(id, o) {
    lineId = id;
    lineSince = Date.now();
    lineTickAt = 0; lineSaidAt = 0; lineStayAt = 0; linePassAt = 0;
    linePassSent = ''; lineToken = ''; lineTokenAt = 0; lineToldLauncher = false; lineAskedAt = 0;
    PROFILE = id;
    try { require('fs').writeFileSync(CHOICE_FILE, id + ' ' + Date.now() + '\n'); }
    catch (e) { log('menu: could not write the choice for the launcher:', e); }
    T.js('try{window.thornswoodSelect&&window.thornswoodSelect.line(' + JSON.stringify({ id: id }) + ');}catch(e){}');
    if (o) {
      log('menu: the world is full (' + (Number(o.now) || 0) + ' in it, ' + (Number(o.max) || 0) +
          ' seats, ' + (Number(o.line) || 0) + ' waiting), so profile', id, 'waits at the menu for a place in line');
    } else {
      log('menu: profile', id, 'waits at the menu in the place in line this game already holds');
    }
  }

  /*
    Another of this game's characters takes the place in line (#1142).

    Back at the choice after being moved out for being idle, the place is the
    character they were, over the connection that was that character's in the
    world. The connection says "/line hand <new>" while it is still the one
    that holds the place, so nobody else can give a place away, and then
    lineTick opens it again as the new character once the launcher has its
    token (thornswoodNet.rejoinAs), whose first "/line" takes the place.
  */
  function lineHand(id) {
    const from = lineId;
    T.js('try{window.thornswoodNet&&window.thornswoodNet.say(' + JSON.stringify('/line hand ' + id) + ',{quiet:true});}catch(e){}');
    log('menu: profile', from, 'hands its place in line to profile', id);
    lineStart(id, null);
  }

  /* Every tick at the menu. */
  function lineTick(now) {
    if (lineAsk && now - lineAsk.at > LINE_ASK_MS) {
      const id = lineAsk.id;
      lineAsk = null;
      lineGo(id, 'the server took more than ' + (LINE_ASK_MS / 1000) + 's to say whether there is a seat, ' +
                 'so the pick goes and the server judges it');
    }
    if (!lineId || now - lineTickAt < 1000) { return; }
    lineTickAt = now;

    if (now - lineStayAt >= 10000) {
      lineStayAt = now;
      T.js('try{window.skyrimPlatform.sendMessage("thornswood","stay");}catch(e){}');
    }

    // The relay needs this character's own voice join token, which the
    // launcher mints when asked (#1322).
    const tok = joinToken();
    if (!tok || tokenProfile(tok) !== lineId) {
      if (now - lineAskedAt >= LINE_TOKEN_ASK_MS) { lineAskedAt = now; askToken(lineId); }
      if (!lineToldLauncher && now - lineSince > 5000) {
        lineToldLauncher = true;
        T.js('try{window.thornswoodSelect&&window.thornswoodSelect.line(' +
             JSON.stringify({ id: lineId, phase: 'launcher' }) + ');}catch(e){}');
        log('menu: no voice join token for profile', lineId, 'yet, so the line waits for the launcher');
      }
      return;
    }
    if (tok !== lineToken) {
      if (!lineToken) { log('menu: joining the relay as profile', lineId, 'to wait in line'); }
      if (tokenWant === lineId) { tokenWant = 0; }
      lineToken = tok;
      lineTokenAt = now;
      lineSaidAt = 0;
    }
    // Every two seconds while the relay is still coming up (the chat script
    // loads and joins after this first asks, and a say before it is there
    // goes nowhere), then every LINE_EVERY_MS.
    const early = now - lineTokenAt < 20000;
    if (now - lineSaidAt < (early ? 2000 : LINE_EVERY_MS)) { return; }
    lineSaidAt = now;

    // Idempotent, so a page the silence watch reloaded gets all of it back.
    T.js('try{if(!window.thornswoodNet){window.THORNSWOOD=' + JSON.stringify({
      host: HOST, port: VOICE_PORT, profileId: lineId, name: '', token: tok, base: VOICE_URL,
      chatFade: CHAT_FADE, needsBars: NEEDS_BARS
    }) + ';}}catch(e){}');
    inject('thornswood-chat.js');
    // rejoinAs only takes the token while the connection is already this
    // character's, and opens it again as this one when it is another's.
    T.js('try{window.thornswoodNet&&window.thornswoodNet.rejoinAs(' + lineId + ',' + JSON.stringify(tok) + ');' +
         'window.thornswoodSelect&&window.thornswoodSelect.line(' + JSON.stringify({ id: lineId }) + ');}catch(e){}');

    // The pass when it is new and every minute, as the world does (#937), so
    // a staff role can be seated ahead of the line and a required pass is on hand.
    const pass = readText(LINE_PASS_FILE).trim();
    const passOk = /^jp1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(pass) && passProfile(pass) === lineId;
    if (passOk && (early || pass !== linePassSent || now - linePassAt >= LINE_PASS_EVERY_MS)) {
      linePassSent = pass;
      linePassAt = now;
      T.js('try{window.thornswoodNet&&window.thornswoodNet.say(' + JSON.stringify('/joinpass ' + pass) + ',{quiet:true});}catch(e){}');
    }
    T.js('try{window.thornswoodNet&&window.thornswoodNet.say("/line",{quiet:true});}catch(e){}');
  }

  /* Close the game from the page: give the place up now, before the connection closes. */
  function lineLeave() {
    if (!lineId) { return; }
    T.js('try{window.thornswoodNet&&window.thornswoodNet.say("/line leave",{quiet:true});}catch(e){}');
    log('menu: profile', lineId, 'gave up their place in line');
    lineId = 0;
  }

  /*
    ------------------------------------------------- are you still here (#1142)

    Patrick, 29 Sep: "we also need an AFK kick in game after 15 mins idle with
    the opportunity for a menu to pop after that 15 minutes with the option to
    click I am still here, if they do click I'm still here it resets, if not
    it kicks them to the main menu where they can rechoose their character and
    they automatically rejoin the queue with the same 1 minute to join rule".
    The window counts down 60 seconds, and staff get it too (agreed the same
    day).

    INPUT is a key or a mouse button (buttonEvent), the mouse moving
    (mouseMove), a gamepad stick (thumbstickEvent), a key held while a panel
    or the chat has the keyboard (Input.getNumKeysPressed, which the browser
    does not hide), or the character moving or turning. Somebody in the race
    menu is never idle. While input comes this says "/afk active" every
    AFK_ACTIVE_EVERY_MS at most, so the server's own watch (the idle block in
    gamemode.js) knows somebody is there while the character stands still.

    AFTER AFK_MS with none, thornswood-afk.js puts up "Are you still here?"
    with its countdown and the keyboard (the 'afk' claim, so the button can be
    clicked). "I am still here" says "/afk here" and starts the 15 minutes
    again. No press in AFK_WINDOW_S: "/afk out", and afkOut takes the game out
    of the world. The server can also say so over the relay (its own watch
    moved them): chat.js hands that here as 'afk:out server'.

    OUT OF THE WORLD: the connection to the game server closes
    (mpClientPlugin.destroyClient, so skymp5-client does not reconnect as the
    same character), the game goes to the main menu, and the character choice
    comes back up with the place in line the server gave them. This game keeps
    that place as the character it was (lineStart), over the same chat
    connection; picking another character hands it over (lineHand), and their
    turn is the same minute to press Join now. Joining opens the connection
    again (relogAs).
  */
  const AFK_MS = 15 * 60000;
  const AFK_WINDOW_S = 60;
  const AFK_SAMPLE_MS = 500;
  const AFK_ACTIVE_EVERY_MS = 120000;
  const AFK_MOVE_UNITS = 8;
  const AFK_TURN_DEGREES = 0.5;
  let afkLastInput = Date.now();
  let afkTouched = false;     // set by the input events between samples
  let afkSampleAt = 0;
  let afkWas = null;          // { x, y, z, az, ax } at the last sample
  let afkAskAt = 0;           // the window went up, 0 while it is down
  let afkSaidAt = 0;
  let afkSince = false;       // input since the last "/afk active"
  let afkHere = false;        // in the world at the last sample
  let afkGone = false;        // taken out, until the world is up again
  let afkOutAsked = '';       // afkOut wanted from outside update (the relay), done on the next one
  let sessionEndAsked = '';   // sessionEnded wanted from the relay (#1157), with the server's sentence

  function afkTouch() { afkTouched = true; }
  try { sp.on('buttonEvent', afkTouch); } catch (e) { log('idle: no buttonEvent:', e); }
  try { sp.on('mouseMove', afkTouch); } catch (e) { log('idle: no mouseMove:', e); }
  try { sp.on('thumbstickEvent', afkTouch); } catch (e) { log('idle: no thumbstickEvent:', e); }

  function afkTurned(a, b) {
    const d = Math.abs((Number(a) || 0) - (Number(b) || 0)) % 360;
    return Math.min(d, 360 - d);
  }

  /* Whether anything came from the person since the last sample. */
  function afkInput() {
    let any = afkTouched;
    afkTouched = false;
    if (keysHeldNow() > 0) { any = true; }
    let at = null;
    try {
      const pc = sp.Game.getPlayer();
      if (pc) {
        at = { x: pc.getPositionX(), y: pc.getPositionY(), z: pc.getPositionZ(),
               az: pc.getAngleZ(), ax: pc.getAngleX() };
      }
    } catch (e) { at = null; }
    if (at && afkWas) {
      const dx = at.x - afkWas.x, dy = at.y - afkWas.y, dz = at.z - afkWas.z;
      if (dx * dx + dy * dy + dz * dz > AFK_MOVE_UNITS * AFK_MOVE_UNITS ||
          afkTurned(at.az, afkWas.az) > AFK_TURN_DEGREES || afkTurned(at.ax, afkWas.ax) > AFK_TURN_DEGREES) {
        any = true;
      }
    }
    if (at) { afkWas = at; }
    return any;
  }

  function afkAsk(now) {
    afkAskAt = now;
    log('idle: nothing from the keyboard, mouse or character in', AFK_MS / 60000, 'minutes, asking "Are you still here?"');
    // For a page that has not loaded the window yet; the window reads it when it comes in.
    T.js('try{window.THORNSWOOD_AFK_ASK=' + AFK_WINDOW_S + ';' +
         'if(window.thornswoodAfk){window.THORNSWOOD_AFK_ASK=0;window.thornswoodAfk.ask(' + AFK_WINDOW_S + ');}}catch(e){}');
    inject('thornswood-afk.js');
    T.claimFocus('afk', true);
  }

  function afkClose() {
    afkAskAt = 0;
    T.js('try{window.THORNSWOOD_AFK_ASK=0;window.thornswoodAfk&&window.thornswoodAfk.close();}catch(e){}');
    T.claimFocus('afk', false);
  }

  /* "I am still here" was pressed. */
  function afkStillHere() {
    if (!afkAskAt) { return; }
    log('idle: "I am still here" pressed after', Math.round((Date.now() - afkAskAt) / 1000) + 's');
    afkClose();
    afkLastInput = Date.now();
    afkSince = false;
    afkSaidAt = Date.now();
    tellServer('/afk here');
  }

  /* Out of the world, to the character choice, with the place in line. In update only (quitToMainMenu is Papyrus). */
  function afkOut(why) {
    if (afkGone) { return; }
    afkGone = true;
    const me = PROFILE;
    const name = myName();
    log('idle: ' + why + ', so out of the world to the character choice as profile', me, '(' + (name || 'no name') + ')');
    tellServer('/afk out');
    afkClose();
    try { globalThis.__thornswoodInWorld = false; } catch (e) { }
    try { sp.mpClientPlugin.destroyClient(); } catch (e) { log('idle: could not close the connection to the game server:', e); }
    try { sp.Game.quitToMainMenu(); } catch (e) { log('idle: could not go to the main menu:', e); }
    if (!chooseAtMenu || !(me > 0)) {
      log('idle: this game does not choose its character at the menu, so it stays at the main menu');
      return;
    }
    backToChoice({ id: me, name: name });
    // The place the server keeps for them: this game waits in line as the
    // character it was, and says "/line" as that one from now on.
    lineStart(me, null);
  }

  /* The character choice again, after the world (afkOut, sessionEnded). again is menuAgain. */
  function backToChoice(again) {
    // The choice the world left behind goes, so the page asks for a fresh one
    // (menuWhere) and the choice comes up again with the list the launcher wrote.
    T.js('try{var o=window.thornswoodSelect;if(o&&o.close){o.close();}' +
         'var ids=["ts-select","ts-select-css","ts-thornswood-select-js"];' +
         'for(var i=0;i<ids.length;i++){var n=document.getElementById(ids[i]);if(n&&n.parentNode){n.parentNode.removeChild(n);}}' +
         'window.thornswoodSelect=undefined;window.THORNSWOOD_SELECT=undefined;}catch(e){}');
    menuAgain = again;
    menuPhase = 0; menuAt = Date.now(); menuAsked = 0; menuLoaded = false;
    menuBeatAt = 0; menuReloads = 0; menuGaveUp = false; menuChosenId = 0;
    relogAt = 0;
  }

  /*
    THE GAME REFUSED TO BUILD THE PICK'S SAVE (#1994).

    A character picked at the menu is loaded from a save SkyrimPlatform builds
    on the spot. When it cannot build it (a form it cannot name, such as a
    face part from a plugin past the end of this game's lists, or a starting
    pack it cannot write), skymp5-client's LoadGameService logs the reason,
    hands it here in __thornswoodLoadRefused and loads nothing. Until 10 Oct
    upstream's catch loaded the character again with no appearance at all, and
    they arrived with the menu template's face, race and gear, which is what
    Patrick saw on dev on 5 Oct and nothing said why.

    The game is still at the main menu, so nothing is quit: the connection
    closes (destroyClient, so the client has nothing to connect again) and the
    choice comes back with a sentence over the slots, the way it does when the
    server ends a session. A pick connects again (relogAs). On tick, because
    the main menu has no update.
  */
  const LOAD_REFUSED_WORDS = 'That character could not be loaded: this game could not build their save, so nothing was loaded. ' +
                             'The reason is in the logs this game sends when it closes. Tell staff the time and which character it was.';
  function loadRefused() {
    let why = '';
    try { why = String(globalThis.__thornswoodLoadRefused || ''); } catch (e) { why = ''; }
    if (!why) { return false; }
    try { globalThis.__thornswoodLoadRefused = ''; } catch (e) { }
    const me = menuChosenId || PROFILE;
    log('menu: the game refused to build the save for profile', me + ', so nothing loads and the choice comes back:', why);
    try { sp.mpClientPlugin.destroyClient(); } catch (e) { log('menu: could not close the connection to the game server:', e); }
    backToChoice({ id: me, name: '', ended: LOAD_REFUSED_WORDS });
    return true;
  }

  /*
    THE SERVER ENDED THIS SESSION ON PURPOSE (#1157).

    A refusal at the door, a missing join pass or load order report, a ban, a
    character dead for good, a staff /kick. The server says the sentence, then
    says { end: <that sentence> } on the line (chat.js hands it here as
    'session:end'), and kicks a few seconds later. skymp5-client connects
    again after every disconnect and logs in as the same character
    (networkingService.ts and AuthService.handleConnectionAccepted in the
    fork), so the kick alone brought the same session straight back, to be
    told the same sentence and ended again, for as long as the game stayed open.

    So the game ends its own side first, the way afkOut does: the connection
    closes (destroyClient, so the client has no disconnect to answer and
    nothing to connect again), the game goes to the main menu, and the
    character choice comes back with the sentence on it and no place in line.
    Nothing connects again until the person picks a character (relogAs). In
    update only (quitToMainMenu is Papyrus).

    What it ends is the connection, so that is what it asks about: a game that
    has already closed its own (moved out, or ended once already) has nothing
    to end, and one that picked again and is still loading into the world has.
  */
  function sessionEnded(sentence) {
    let up = false;
    try { up = !!sp.mpClientPlugin.isConnected(); } catch (e) { up = false; }
    if (!up) { log('session: the server ended a session this game had already closed'); return; }
    afkGone = true;
    const me = PROFILE;
    log('session: the server ended it ("' + sentence + '"), so the connection is closed and the game goes ' +
        'to the character choice as profile', me + '; nothing connects again until a character is picked');
    afkClose();
    try { globalThis.__thornswoodInWorld = false; } catch (e) { }
    try { sp.mpClientPlugin.destroyClient(); } catch (e) { log('session: could not close the connection to the game server:', e); }
    try { sp.Game.quitToMainMenu(); } catch (e) { log('session: could not go to the main menu:', e); }
    if (!chooseAtMenu || !(me > 0)) {
      log('session: this game does not choose its character at the menu, so it stays at the main menu');
      return;
    }
    backToChoice({ id: me, name: myName(), ended: sentence });
  }

  /*
    THE ENGINE TURNED THE CONNECTION AWAY (#1893).

    A refusal at the engine's own door (no free incoming connections, IP
    recently connected, already connected, banned) never reaches the gamemode,
    so nothing says { end } for it. The fork's networkingService.ts no longer
    answers it with a new connection: it closes the client and leaves the
    reason in storage.thornswoodConnectionDenied ({ error, at }). This shows
    it at the character choice the way sessionEnded shows the server's
    sentence, and nothing connects again until a character is picked
    (relogAs). A hot reload does not show an old one again.
  */
  let deniedSeenAt = 0;
  // By type: an unset key in storage is a function, not undefined (#3333).
  function deniedInStorage() {
    try {
      const d = sp.storage.thornswoodConnectionDenied;
      return (d && typeof d === 'object') ? d : null;
    } catch (e) { return null; }
  }
  deniedSeenAt = Number((deniedInStorage() || {}).at) || 0;
  function connectionDenied(reason) {
    const me = PROFILE;
    const sentence = 'The server turned the connection away' + (reason ? ': ' + reason : '.');
    log('session: ' + sentence + ' The game goes to the character choice as profile', me + '; nothing connects again until a character is picked');
    afkGone = true;
    afkClose();
    try { globalThis.__thornswoodInWorld = false; } catch (e) { }
    try { sp.mpClientPlugin.destroyClient(); } catch (e) { log('session: could not close the connection to the game server:', e); }
    try { sp.Game.quitToMainMenu(); } catch (e) { log('session: could not go to the main menu:', e); }
    if (!chooseAtMenu || !(me > 0)) {
      log('session: this game does not choose its character at the menu, so it stays at the main menu');
      return;
    }
    backToChoice({ id: me, name: myName(), ended: sentence });
  }
  sp.on('update', guard('idle check', () => {
    const now = Date.now();
    const denied = deniedInStorage();
    if (denied && (Number(denied.at) || 0) > deniedSeenAt) {
      deniedSeenAt = Number(denied.at) || 0;
      connectionDenied(String(denied.error || ''));
      return;
    }
    if (afkOutAsked) {
      const why = afkOutAsked;
      afkOutAsked = '';
      afkOut(why);
      return;
    }
    if (sessionEndAsked) {
      const sentence = sessionEndAsked;
      sessionEndAsked = '';
      sessionEnded(sentence);
      return;
    }
    if (now - afkSampleAt < AFK_SAMPLE_MS) { return; }
    afkSampleAt = now;
    let here = false;
    try { here = !!globalThis.__thornswoodInWorld; } catch (e) { here = false; }
    if (here && !afkHere) {
      // Into the world, the first time or back from the choice: the clock starts now.
      afkGone = false;
      afkLastInput = now;
      afkWas = null;
      afkTouched = false;
    }
    afkHere = here;
    if (!here || afkGone) {
      if (afkAskAt) { afkClose(); }
      return;
    }
    if (afkAskAt) {
      // The window is up: only its button counts, and the game goes when its minute does.
      if (now - afkAskAt >= AFK_WINDOW_S * 1000) {
        afkOut('no answer to "Are you still here?" in ' + AFK_WINDOW_S + ' seconds');
      }
      return;
    }
    let creating = false;
    try { creating = raceMenuOpen(); } catch (e) { creating = false; }
    if (afkInput() || creating) {
      afkLastInput = now;
      afkSince = true;
    }
    if (afkSince && now - afkSaidAt >= AFK_ACTIVE_EVERY_MS) {
      afkSaidAt = now;
      afkSince = false;
      tellServer('/afk active');
    }
    if (now - afkLastInput >= AFK_MS) { afkAsk(now); }
  }));

  /*
    ------------------------------------------------- change character (#3128)

    Patrick's ask: switch to another character from inside the game, without
    closing Skyrim and going back through the launcher, and the same screen
    picks a slot, makes a new character and deletes one. His answer on the
    report page, 22 Oct: any time out of combat, after a 10 s wait in place.

    THE WAY OUT IS THE ONE THE IDLE CHECK TAKES. Change character on the K
    panel says 'skills:switch'. The character has to be out of combat, and
    then stand where it is for SWITCH_WAIT_MS, a line a second saying how long
    is left. Moving more than SWITCH_MOVE_UNITS, getting into combat, losing
    health, dying or leaving the world stops it and says why; the button
    again stops it too. At the end the connection to the game server closes
    (destroyClient, so skymp5-client does not connect again as the same
    character), the game goes to the main menu, and the character choice
    comes up with the slots, the one just left lit (backToChoice). A slot
    plays that character, an empty one makes a new one and the delete icon
    forgets one, the way the choice at the start of a game does; a pick
    connects again (relogAs) as whoever was picked (pickedAgain).

    The game server sees a connection close, as when somebody quits, so the
    character left is put away the same way. Out of combat is this game's
    check: closing Skyrim leaves at any moment, so a check on the server
    would hold nobody who wanted out, and the wait is there so a switch is
    not a way out of a fight.

    In update only: quitToMainMenu and the reads of the character are
    Papyrus, and the K panel's message arrives on tick.
  */
  const SWITCH_WAIT_MS = 10000;
  const SWITCH_MOVE_UNITS = 32;
  let switchAsked = false;   // the button was pressed, for the next update
  let switchAt = 0;          // when the wait began, 0 while there is none
  let switchFrom = null;     // { x, y, z, hp } when it began
  let switchSaid = 0;        // the whole seconds left that were last said

  /* What would stop a switch now, in words, or '' when nothing would. */
  function switchHeld(pc) {
    if (!pc) { return 'there is no character'; }
    try { if (pc.isDead()) { return 'your character is dead'; } } catch (e) { }
    try { if (pc.isInCombat()) { return 'you are in combat'; } } catch (e) { }
    return '';
  }

  function switchWhere(pc) {
    try {
      return { x: pc.getPositionX(), y: pc.getPositionY(), z: pc.getPositionZ(),
               hp: pc.getActorValue('Health') };
    } catch (e) { return null; }
  }

  function switchStop(why) {
    switchAt = 0;
    switchFrom = null;
    switchSaid = 0;
    note('Change of character stopped: ' + why + '.');
  }

  function switchStart(now) {
    if (!chooseAtMenu || !(PROFILE > 0)) {
      note('This game does not choose its character in the game. Close Skyrim and press Play to pick another.');
      return;
    }
    let pc = null;
    try { pc = sp.Game.getPlayer(); } catch (e) { pc = null; }
    const held = switchHeld(pc);
    if (held) { note('You cannot change character now: ' + held + '.'); return; }
    switchFrom = switchWhere(pc);
    if (!switchFrom) { note('You cannot change character now: your character could not be found.'); return; }
    switchAt = now;
    switchSaid = 0;
    log('change character: profile', PROFILE, 'asked; waiting', SWITCH_WAIT_MS / 1000 + 's in place');
  }

  function switchLeave() {
    const me = PROFILE;
    const name = myName();
    switchAt = 0;
    switchFrom = null;
    log('change character: ' + SWITCH_WAIT_MS / 1000 + 's in place and out of combat, so out of the world ' +
        'to the character choice as profile', me, '(' + (name || 'no name') + ')');
    afkGone = true;
    afkClose();
    try { globalThis.__thornswoodInWorld = false; } catch (e) { }
    try { sp.mpClientPlugin.destroyClient(); } catch (e) { log('change character: could not close the connection to the game server:', e); }
    try { sp.Game.quitToMainMenu(); } catch (e) { log('change character: could not go to the main menu:', e); }
    backToChoice({ id: me, name: name, switched: true });
  }

  sp.on('update', guard('change character', () => {
    const now = Date.now();
    if (switchAsked) {
      switchAsked = false;
      if (switchAt) { switchStop('as you asked'); return; }
      switchStart(now);
      return;
    }
    if (!switchAt) { return; }
    let here = false;
    try { here = !!globalThis.__thornswoodInWorld; } catch (e) { here = false; }
    if (!here || afkGone) { switchStop('you left the world'); return; }
    let pc = null;
    try { pc = sp.Game.getPlayer(); } catch (e) { pc = null; }
    const held = switchHeld(pc);
    if (held) { switchStop(held); return; }
    const at = switchWhere(pc);
    if (!at) { switchStop('your character could not be found'); return; }
    const dx = at.x - switchFrom.x, dy = at.y - switchFrom.y, dz = at.z - switchFrom.z;
    if (dx * dx + dy * dy + dz * dz > SWITCH_MOVE_UNITS * SWITCH_MOVE_UNITS) { switchStop('you moved'); return; }
    // Against the most it has been since the wait began, so health coming
    // back first does not hide a hit after it.
    if (at.hp < switchFrom.hp) { switchStop('you were hurt'); return; }
    switchFrom.hp = at.hp;
    const left = Math.ceil((SWITCH_WAIT_MS - (now - switchAt)) / 1000);
    if (left <= 0) { switchLeave(); return; }
    if (left !== switchSaid) {
      switchSaid = left;
      note('Changing character in ' + left + (left === SWITCH_WAIT_MS / 1000 ? '. Stay where you are.' : '.'));
    }
  }));

  /* The choice is on screen and this block is holding it up: asking the page
     where it is (1) or watching it (2). */
  function choiceUp() { return menuPhase === 1 || menuPhase === 2; }

  /*
    TWO THINGS THE CHOICE PAGE CANNOT DO FOR ITSELF, every tick that it is up.

    WHICH WINDOW THE KEYS ARE GOING TO. Djinn, 25 September: the sealed scroll
    opened at 16:23:50 with nobody at the game, because four key presses typed
    into another program reached it (thornswood-input.log for that window: fg
    another window, focus 0, keys 4). The scroll was made click only the same
    day; the slots behind it were not, and they play the lit character on
    Enter, so the same stray keys still took somebody into the world as
    whoever happened to be lit. A page has no way to ask who has the keyboard.
    sp.win32.foregroundWindow does, and the pulse already asks it every five
    seconds once the world is up. So it is asked once a second here and the
    answer is handed to the page, which swallows every key while the game is
    behind something else. A client with no win32 is never told and the page
    keeps what it did before. Once a second and not four times, because this
    is a Windows call and the page starts out swallowing keys anyway: the only
    thing a slower answer costs is a moment before the keys of somebody really
    at the game start working.

    THE WAIT THE CLIENT IS HOLDING. With the scroll on, the page tells the
    client ('thornswood','stay') so nobody is logged in as their last
    character for sitting at the start screen, and ('thornswood','choosing')
    when Continue starts the choice. Both were the page's alone, and the page
    is the part that dies: the silence watch above reloads it three times and
    then leaves it, and from that moment nothing said either word and the
    three minute fallback was back without anybody being told. So this says
    them too, on the same ten seconds, exactly the way keepSayingChoice took
    the pick's repeat over from the page after the same lesson. A client from
    before those words ignores both.
  */
  function menuWatch(now) {
    if (now - menuFgAt > 1000) {
      menuFgAt = now;
      let fg = null;
      try {
        if (sp.win32 && typeof sp.win32.foregroundWindow === 'function') {
          fg = sp.win32.foregroundWindow();
        }
      } catch (e) { fg = null; }
      if (fg) {
        const here = !!fg.isGame;
        T.js('try{window.thornswoodSelect&&window.thornswoodSelect.keys(' +
             (here ? 'true' : 'false') + ');}catch(e){}');
        // Said when it changes and never on the repeats, so the log shows
        // when somebody left the game and came back and nothing else.
        if (menuFgWas !== here) {
          menuFgWas = here;
          log('menu: the keys are going to', here ? 'the game' : ('another window (' + (fg.exe || fg.title || 'unnamed') + '), so the choice page ignores them'));
        }
      }
    }

    if (menuIntroOff) { return; }
    if (now - menuStayAt < 10000) { return; }
    menuStayAt = now;
    T.js('try{window.skyrimPlatform.sendMessage("thornswood","stay");' +
         (menuWent ? 'window.skyrimPlatform.sendMessage("thornswood","choosing");' : '') +
         '}catch(e){}');
  }

  /*
    The page's own ask, 'select:keycheck <n>' (#591): a key landed with no
    answer from the last moment, so it is held until Windows is asked again,
    now rather than on the next second. The answer carries the same n, which
    is what lets the page act on the held key. Nothing is written to the log:
    menuWatch already says when the keyboard moves.
  */
  function menuKeyCheck(ask) {
    const n = Number(ask) || 0;
    let fg = null;
    try {
      if (sp.win32 && typeof sp.win32.foregroundWindow === 'function') {
        fg = sp.win32.foregroundWindow();
      }
    } catch (e) { fg = null; }
    const here = !!(fg && fg.isGame);
    T.js('try{window.thornswoodSelect&&window.thornswoodSelect.keys(' +
         (here ? 'true' : 'false') + ',' + n + ');}catch(e){}');
  }

  /*
    THE WORLD ARRIVED WITH THE CHOICE STILL UP AND NOTHING PICKED.

    Djinn on dev, 24 September: "Sitting on the character select window for
    too long causes you to lose your cursor, pressing F6 doesn't work, and you
    have to esc to quit".

    Too long is three minutes. Our fork of skymp5-client waits at the menu for
    the page's pick and, after menuChoiceFallbackMs (180000, authService.ts),
    logs in as the settings' profileId, the last character played. The world
    then loads under a choice nobody made. menuChose never ran, so the page
    was never acked and never hid itself, and the list the launcher wrote was
    still on disk. The update tick then did what it always does when the
    world is up: stopped this block, dropped focus and reloaded the page, and
    the reload drew the choice again from that list. A full screen choice
    over the world with no cursor, and a click the client no longer listens
    for. The game had the keyboard, so Escape reached the System page. F6 did
    raise focus, and applyFocus put it back down on its next pass, because a
    focus nothing claimed is only held inside character creation.

    It was never the two minute F6 cap. Update does not fire at the main
    menu, so applyFocus never runs there: the two logs on this machine from
    23 September (the dev build's at 20:07, the live one's at 10:20) have no
    pulse, no frame line and no F6 line between the choice going up and the
    pick, and the 20:07 one had the choice up for 57 seconds.

    So the page goes the way a pick takes it: the claim is let go, the page
    is told to close, and the list is removed so the reload in the world
    cannot bring it back. The person is in the world as the character the
    client chose for them, with their keyboard.
  */
  function menuGone() {
    T.claimFocus('select', false);
    T.js('try{window.thornswoodSelect&&window.thornswoodSelect.close();}catch(e){}');
    try { require('fs').unlinkSync('Data/Platform/UI/thornswood-characters.js'); } catch (e) { }
    // The uncaused load count tells the client's three minute fallback apart
    // from a save something else loaded, which is a different fault.
    let uncaused = '?';
    try { uncaused = String(Number(globalThis.__thornswoodUncausedLoad) || 0); } catch (e) { }
    log('menu: the world loaded with the choice still up and nothing picked here',
        '(the client logs in as the last character, profile ' + PROFILE + ', after three minutes',
        'without a pick; uncausedLoads=' + uncaused + '; the scroll was ' + (menuIntroOff ? 'off for this person, which is when that fallback is meant to happen' : 'ON, so this should not have happened: the client took no notice of stay') + ').',
        'Taking the choice down so it does not sit over the world with no cursor');
  }

  // ---------------------------------------------------------------- focus --
  // One arbiter, because focus is the thing that kept going wrong.
  //
  // browser.setFocused(true) raises DInputHook::ChromeFocus, and while that is
  // up the game gets no keyboard and no mouse at all. skymp5-client binds Enter
  // and F6 to raise it whenever none of its own menus are open, and binds only
  // Escape to lower it, which is why an Enter pressed in the world used to
  // leave you standing in Riften unable to move.
  //
  // So nothing sets it directly. Everything that wants the mouse claims it by
  // name, and this puts the flag where the claims say it should be, every
  // frame, in both directions.
  const claims = {};

  function anyClaim() {
    for (const k in claims) { if (claims[k]) return true; }
    return false;
  }

  /**
   * True while character creation is on screen.
   *
   * The one place focus is never touched. setFocused(false) also sends a hide
   * to the game's own CursorMenu whenever the matching setFocused(true) is what
   * opened it, and that hide landing on the race menu's cursor is how the
   * cursor kept disappearing mid creation. skymp5-client already refuses to
   * raise focus there, so there is nothing to lower either.
   */
  function raceMenuOpen() {
    try { return !!sp.Ui.isMenuOpen('RaceSex Menu'); } catch (e) { return false; }
  }

  function gameMenuOpen() {
    try { return sp.Utility.isInMenuMode(); } catch (e) { return true; }
  }

  /**
   * A menu that owns the keyboard, asked for by name.
   *
   * Utility.isInMenuMode was the gate on the chat key and it is the wrong
   * question. Your log said so four times:
   *
   *     [front] chat key seen, but the game says a menu is open
   *
   * while you were standing in the world. It answers yes for things that are
   * not in anybody's way, the browser's own CursorMenu among them, which is
   * raised and lowered by the very focus handling this file does. So enter was
   * being swallowed by a menu that exists because of the chat.
   *
   * This asks about the menus that actually mean something instead. The list is
   * skymp5-client's own badMenus, which it uses for the same purpose, plus the
   * few that take text.
   *
   * Every name here is Skyrim's own, and Skyrim is not consistent about the
   * space: some have one and some do not, and Ui.isMenuOpen answers no to a
   * name that is off by a character rather than saying it has never heard of
   * it. 'Favorites Menu' was such a name. The quick favourites menu, the one
   * on Q, is 'FavoritesMenu', so for as long as somebody had it open this file
   * believed no menu was open at all: the chat key, the emote wheel and the
   * old stuck and controls watchdogs (#2620) all treated it as open world. The magic
   * menu was simply missing. Both are what skymp5-client's own isBadMenuShown
   * asks for, spelled the way it spells them.
   */
  const KEYBOARD_MENUS = [
    'Console', 'Crafting Menu', 'ContainerMenu', 'Dialogue Menu', 'FavoritesMenu',
    'GiftMenu', 'InventoryMenu', 'Journal Menu', 'Lockpicking Menu', 'Loading Menu',
    'MagicMenu', 'MapMenu', 'RaceSex Menu', 'StatsMenu', 'TweenMenu', 'Main Menu',
    'MessageBoxMenu', 'Book Menu', 'Sleep/Wait Menu', 'Barter Menu', 'Training Menu',
  ];

  /*
    Asked at most four times a second, not thirty times a frame.

    busyMenuOpen walks twenty menus and calls into the game for each one, and
    three update handlers call it every frame, so the real cost was about sixty
    native calls per frame for an answer that cannot change between two frames
    in any way a person could act on. A menu opening a quarter of a second
    later than it might have is not something anybody can see; sixty calls a
    frame is.
  */
  const MENU_CACHE_MS = 250;
  let menuCachedAt = 0;
  let menuCached = '';

  // except: a menu our own key just opened, which is being shut for it
  // (ourKeyMenu below), and so is not in the way.
  function busyMenuOpenNow(except) {
    let asked = false;
    for (const name of KEYBOARD_MENUS) {
      if (except && name === except) { asked = true; continue; }
      try {
        if (sp.Ui.isMenuOpen(name)) { return name; }
        asked = true;
      } catch (e) { }
    }
    // Ui.isMenuOpen answered nothing at all, so fall back to the blunt test
    // rather than handing the keyboard over blind.
    if (!asked) { return gameMenuOpen() ? 'a menu' : ''; }
    return '';
  }

  function busyMenuOpen() {
    const now = Date.now();
    if (now - menuCachedAt < MENU_CACHE_MS) { return menuCached; }
    menuCachedAt = now;
    menuCached = busyMenuOpenNow();
    return menuCached;
  }

  // Menus the game can raise while the browser holds the keyboard, which is
  // to say the ones that need no key press: a load screen, a quit, a forced
  // message box, somebody talking to you.
  const SELF_OPENING_MENUS = [
    'Loading Menu', 'Main Menu', 'MessageBoxMenu', 'Dialogue Menu', 'RaceSex Menu',
  ];

  function interrupted() {
    for (const name of SELF_OPENING_MENUS) {
      try { if (sp.Ui.isMenuOpen(name)) { return name; } } catch (e) { }
    }
    return '';
  }

  // Focus that is up while nothing here claimed it, and since when.
  let strayFocusSince = 0;

  /*
    A PANEL TAKES THE KEYBOARD AT ONCE, KEYS DOWN OR NOT. Issues 528 and 898.

    Djinn on dev, 24 September: after picking a character F and the mouse
    wheel stopped at a very close third person view and Tab did not open the
    Tween Menu. His platform log for that session names it:

      14:59:36.506 input: 84 keys in 5s, browser focus no, menu yes [RaceSex Menu]
      14:59:41.108 focus claimed by party (holding: party)
      14:59:44.104 focus released by party (holding: nobody)
      14:59:46.512 input: 1878 keys in 5s, browser focus no, menu yes [RaceSex Menu]
      15:00:01.522 input: 1800 keys in 5s, browser focus yes, menu no, controls on

    Shift and P were down, for the P in the name he typed, when the party
    window opened and raised focus. DInputHook.cpp in the fork handed the
    game none of the keyboard while focus was up, key ups included, so the
    game held Shift and P down for the rest of the session. Blade (K, 25
    September) and Djinn (the emote wheel and K, 26 and 27 September) hit
    the same.

    Issue 528 made this plugin hold a claim back until every key was up, for
    up to a second. Issue 898 fixed it where it happens: the fork's
    DInputHook now lets the key up of every key the game holds through while
    focus is up (HeldKeyRelease, in the client that records\client-build.json
    names), and still withholds every key down. So a panel takes the keyboard
    on the frame it asks, and a key that was down comes up in the game when
    it is let go. The wait is gone; nothing here has to know which keys are
    down.

    keysHeldNow is SKSE's count of the keys under the fingers, which the idle
    watch reads.
  */
  function keysHeldNow() {
    try { return sp.Input.getNumKeysPressed() || 0; } catch (e) { return 0; }
  }

  /**
   * Put the focus flag where the claims say it should be.
   *
   * The line that used to be here said: if nothing wants focus and the race
   * menu is open, leave it alone. That was to protect the cursor, because
   * setFocused(false) also sends a hide to the game's own CursorMenu. What it
   * actually built was a trap with no way out.
   *
   * Something raised focus during character creation. While focus is up
   * DirectInput is withheld from the game, so escape, enter and every other
   * key did nothing, and the one thing that could have put it back refused to,
   * for as long as the race menu was open, which was forever because you
   * cannot finish a race menu you cannot press a key in. Your log shows it
   * exactly: one line saying keys work, and then nothing ever again.
   *
   * So the guard is now a pause rather than a veto. A second of grace, which
   * covers the flicker it was written for, and then the keyboard comes back
   * whatever is on screen. A cursor that blinks is a cosmetic problem. A
   * keyboard that never returns is somebody closing the game through the task
   * manager.
   */
  function applyFocus() {
    let up;
    try { up = !!sp.browser.isFocused(); } catch (e) { return; }
    /*
      F6 IS A PERSON, NOT A STRAY, AND NOW IT IS ASKED FOR BY NAME.

      skymp5-client binds F6 to toggling browser focus. Somebody looking at a
      panel with no claim behind it presses F6, focus goes up, and this
      function put it straight back down on the very next frame, for ever. No
      cursor, and with focus down the browser is sent no keys and no clicks
      either, so the panel's own Escape and Close are unreachable: Task
      Manager was the only way out, which is exactly what Djinn reported on
      22 September.

      THE FIRST ANSWER TO THAT DID NOT WORK, AND THIS IS WHY. It held an
      unexplained focus once it had been up 1.2 seconds. Outside the race menu
      nothing ever got to 1.2 seconds: the first frame fell through to the put
      down below, so F6 at a panel still did nothing. tools\test-f6-focus.js
      run against that text has the focus down again on the first frame.
      Inside the race menu it did hold, for two minutes, with the browser
      hidden because a menu was open and nothing claimed: a keyboard taken
      from the race menu and given to a page nobody could see.

      AND THE PUT DOWN ON THE FIRST FRAME HAS TO STAY. skymp5-client binds
      Enter to raise focus as well (browserService.ts in the fork, at the
      commit client-build.json records), and that put down is the only thing
      that stops an Enter pressed in the world leaving somebody unable to
      move. So the two keys are told apart at the key rather than guessed at
      here: F6 is watched for by watchFocusKeys below, and the focus it asks
      for counts as a claim until F6 or Escape gives it back, a claim comes
      along and takes over, a menu opens by itself, or MANUAL_FOCUS_MS runs
      out. Every other focus nothing asked for, Enter's included, goes back
      down exactly as it did before.
    */
    const claimed = anyClaim();
    if (claimed) { manualFocusSince = 0; }
    const want = claimed || manualFocusHeld();

    if (up === want) { strayFocusSince = 0; return; }

    if (!want) {
      if (!strayFocusSince) { strayFocusSince = Date.now(); }
      const waited = Date.now() - strayFocusSince;
      if (raceMenuOpen() && waited < 1200) { return; }
      if (waited >= 1200) {
        say('something took the keyboard and nothing here asked for it, taking it back');
      }
    }

    try { sp.browser.setFocused(want); } catch (e) { }
    strayFocusSince = 0;
  }

  /*
    When somebody's own F6 raised focus, and how long that is allowed to last.

    Two minutes, the same number and the same reasoning as every other cap in
    this file: far longer than anybody spends reading a panel, far shorter
    than giving up on the game. Without it, a focus raised by F6 and never
    lowered would be a keyboard that never comes back, which is the fault the
    caps exist for.
  */
  let manualFocusSince = 0;
  const MANUAL_FOCUS_MS = 120000;

  /** Whether an F6 focus still stands, ending it when it should end. */
  function manualFocusHeld() {
    if (!manualFocusSince) { return false; }
    // A load screen, a message box or somebody talking to you needs the
    // keyboard the page is holding, the same reason the chat box is shut.
    const over = interrupted();
    if (over) {
      say('F6 focus given back, ' + over + ' opened');
      manualFocusSince = 0;
      return false;
    }
    if (Date.now() - manualFocusSince < MANUAL_FOCUS_MS) { return true; }
    say('F6 focus has been up for ' + Math.round(MANUAL_FOCUS_MS / 60000) +
        ' minutes, taking it back');
    manualFocusSince = 0;
    return false;
  }

  /*
    F6, AND THE ESCAPE THAT ENDS IT, ARE ASKED OF THE KEYBOARD, NOT WAITED FOR
    AS KEY EVENTS. 0x40 is F6's DirectInput scan code, the code
    skymp5-client's own binding asks for (DxScanCode.F6).

    buttonEvent cannot hear the F6 that gives the keyboard back. It is built
    from the game's own input events (the kButton case in EventHandler.cpp in
    the fork), and while focus is up DInputHook.cpp hands the game no key
    downs, only the key up of a key it already held (issue 898). The snapshot it reads first goes to the browser and
    nowhere else: OnKeyStateChange in the fork's main.cpp returns at once
    unless the browser has focus, and then only injects the key into it.
    This machine's platform log for 23 September agrees: the K panel held
    focus from 10:21:04 to 10:21:31, a class, a profession and a town were
    picked in it with the mouse, and every five second line in between says
    "input: 0 keys in 5s, browser focus yes". Not one button event of any
    kind reached this file while focus was up. An F6 caught there would
    raise focus, and the F6 meant to lower it would never arrive:
    skymp5-client would lower it and applyFocus would raise it again, for two
    minutes.

    skymp5-client hears F6 with focus up because it asks Input.isKeyPressed
    whenever the number of keys held changes (keyboardEventsService.ts in the
    fork). This asks the same question the same way, so the two see the same
    presses, for one call a frame, the same one skymp5-client already makes.
    Both codes are keyboard codes to Input.isKeyPressed, so the left stick
    click (0x40 from a pad) and the right mouse button (1 from a mouse) are
    neither of them.

    Set outright rather than toggled, because skymp5-client toggles on the
    same press and two toggles cancel: whichever of the two runs first, the
    arbiter above ends up where this says. Nothing while a claim holds the
    keyboard, since focus is already up and the claim decides when it comes
    down. Nothing in a menu that owns the keyboard either, which is
    skymp5-client's own list of menus it refuses F6 in plus the few that take
    text (KEYBOARD_MENUS above): in the race menu a raised focus is a keyboard
    taken from the race menu and handed to a page that is hidden.

    Escape ends it too, the way skymp5-client's own Escape binding lowers
    focus.
  */
  const F6_KEY = 0x40;
  let f6Was = false;
  let escWas = false;
  let keysHeldWas = -1;

  function watchFocusKeys() {
    if (!T.ready) { return; }
    let held;
    try { held = sp.Input.getNumKeysPressed(); } catch (e) { return; }
    if (held === keysHeldWas) { return; }
    keysHeldWas = held;
    let f6 = false;
    let esc = false;
    try {
      f6 = !!sp.Input.isKeyPressed(F6_KEY);
      esc = !!sp.Input.isKeyPressed(ESC);
    } catch (e) { return; }
    const f6Down = f6 && !f6Was;
    const escDown = esc && !escWas;
    f6Was = f6;
    escWas = esc;
    if (escDown && manualFocusSince) {
      manualFocusSince = 0;
      say('Escape, the F6 keyboard goes back to the game');
    }
    if (f6Down) { f6Pressed(); }
  }

  function f6Pressed() {
    if (anyClaim()) { return; }
    if (manualFocusSince) {
      manualFocusSince = 0;
      say('F6 again, the keyboard goes back to the game');
      applyFocus();
      return;
    }
    const busy = busyMenuOpen();
    if (busy) {
      say('F6 seen, but ' + busy + ' is open');
      return;
    }
    manualFocusSince = Date.now();
    say('F6: the cursor is on the overlay until F6 or Escape, or ' +
        Math.round(MANUAL_FOCUS_MS / 60000) + ' minutes');
    applyFocus();
  }

  /*
    WHEN EACH CLAIM WENT UP, so the cap below can cover all of them.

    Focus withholds DirectInput, so a claim that goes up and never comes down
    is indistinguishable from the game freezing: the keyboard stops reaching
    the game AND stops reaching every plugin that would otherwise notice.
    There were three watchdogs and every one of them tested claims.chat, so the
    K panel and the emote wheel could each leave somebody with a dead keyboard
    and nothing would ever take it back. Djinn has twice reported the game
    going down with no crash log, once on pressing K.

    Found by the audit of 21 September.
  */
  const claimedAt = {};

  /*
    WHICH WINDOW EACH CLAIM BELONGS TO, so the cap below closes that one.

    Until 24 September the cap closed something only for the skills claim,
    and then it closed the party and journal windows along with it. A party,
    journal or trade claim was released with its window left drawn and no
    cursor, the same trap the cap was written to end. Found by the review of
    the J journal.

    The trade window's close hides it and leaves the trade to the server: the
    next change to either pile draws it again, and so does H, or Trade on the
    P panel, while the trade stands (#1628), which puts Walk away back. The
    wheel's name is thornswoodEmotes, and the page's close sends __close so
    the plugin's open follows (#1918). The select window is only ever capped
    once its choice is no longer up.
  */
  const CAP_CLOSES = {
    skills: 'thornswoodSkills', party: 'thornswoodParty', journal: 'thornswoodJournal',
    board: 'thornswoodBoard', repair: 'thornswoodRepair', treat: 'thornswoodTreat', preserve: 'thornswoodPreserve',
    trade: 'thornswoodTrade', merchant: 'thornswoodMerchant', select: 'thornswoodSelect', wheel: 'thornswoodEmotes',
    afk: 'thornswoodAfk', maneuvers: 'thornswoodManeuvers', ride: 'thornswoodRide',
    help: 'thornswoodHelp', settings: 'thornswoodSettings', box: 'thornswoodBox', ship: 'thornswoodShip', stall: 'thornswoodStall'
  };

  T.claimFocus = function (who, on) {
    if (!!claims[who] === !!on) return;
    claims[who] = !!on;
    claimedAt[who] = on ? Date.now() : 0;
    // Logged every time, because a claim that goes up and does not come down is
    // indistinguishable from the game freezing: focus withholds DirectInput,
    // so the keyboard stops reaching the game AND stops reaching every plugin
    // that would otherwise notice something was wrong. When somebody says a
    // key locked everything up, this line is the only place the answer lives.
    say('focus ' + (on ? 'claimed by ' : 'released by ') + who +
        ' (holding: ' + (Object.keys(claims).filter(function (k) { return claims[k]; })
                          .join(', ') || 'nobody') + ')');
    applyFocus();
  };
  T.hasFocus = function (who) { return !!claims[who]; };

  /*
    A PANEL THAT HOLDS THE KEYBOARD HAS A CURSOR (#958) is the fork's job,
    not this file's (#2384). browser.setFocused only queues the Cursor
    Menu's show, so a check on the next frame always found it down, and the
    lower and raise that used to answer it fired on every claim and queued
    a hide on top of the show still on its way. BrowserApiTilted.cpp now
    keeps the show it asked for until the game opens the menu, and shows it
    again from the Cursor Menu's own close event when something else (the
    console closing, a game menu that used the cursor) takes it down while
    focus is up. Nothing here lowers and raises focus to bring it back.
  */

  // ---------------------------------------------------------------- typing --
  // Asked for, not taken.
  //
  // The keyboard is only handed over once the page has said it has a box to
  // type into, and it is handed back on a message from the page.
  //
  // A plugin cannot hear a key press as a buttonEvent while focus is up.
  // DInputHook::GetDeviceData does read the keyboard and call
  // ProcessKeyboardData before it checks ChromeFocus, but ProcessKeyboardData
  // feeds OnKeyStateChange in the fork's main.cpp, which only injects the key
  // into the browser. buttonEvent comes from the game's own input events, and
  // the game gets no key downs; since issue 898 it gets only the key up of a
  // key it already held (HeldKeyRelease), so nothing stays held:
  //
  //     if (hr == DI_OK) { ProcessKeyboardData(rawData); ... }   // to the page
  //     g_heldKeys.Filter(..., listening)                        // the game
  //
  // So no press reaches the game or the plugins; only the page hears keys.
  // Escape below is caught by asking Input.isKeyPressed, the way F6 is (see
  // watchFocusKeys), not by waiting for a buttonEvent, and the cap further down
  // does not need any key at all. Both exist because everything that routes
  // through the page is one stopPropagation away from leaving somebody frozen.
  //
  // Which is exactly what went wrong. Enter raised focus whether or not
  // anything had drawn a chat box, and when there was no box there was nothing
  // on screen and nothing listening: a cursor, no movement, and a fight to get
  // back out.
  let asked = 0;        // when we last asked the page to take the keyboard
  let beat = 0;         // when the page last said it still has it
  let heldSince = 0;    // when the keyboard was handed over, for the hard cap
  let boxReady = false; // the page has said, once, that it has a chat box

  // prefill is typed into an empty box as it opens: '/' from the command key.
  function wantTyping(on, prefill) {
    if (on) {
      if (claims.chat) return;
      const fill = JSON.stringify(String(prefill || ''));

      // Once the page has reported a box, the keyboard goes over immediately
      // and the page is told afterwards. Waiting for the answer first was
      // correct and slow: a round trip through executeJavaScript, the page's
      // reply, and the next update tick, during which enter did nothing and a
      // second press did nothing either, because `asked` was set.
      //
      // The safety that made the wait worth it is still here and does not need
      // the wait: the heartbeat below takes the keyboard back on its own if the
      // page stops answering, and typing-fail takes it back at once.
      if (boxReady) {
        beat = Date.now();
        heldSince = Date.now();
        T.claimFocus('chat', true);
        T.js('try{if(window.thornswoodChat){window.thornswoodChat.focusInput(' + fill + ');window.thornswoodChat.state();}else{window.skyrimPlatform.sendMessage("thornswood-front","the page has no chat object, so there is nothing to type into");}}catch(e){try{window.skyrimPlatform.sendMessage("thornswood-front","focusInput threw "+e);}catch(e2){}}');
        return;
      }

      if (asked) return;
      asked = Date.now();
      T.js('try{if(window.thornswoodChat){window.thornswoodChat.focusInput(' + fill + ');window.thornswoodChat.state();}else{window.skyrimPlatform.sendMessage("thornswood-front","the page has no chat object, so there is nothing to type into");}}catch(e){try{window.skyrimPlatform.sendMessage("thornswood-front","focusInput threw "+e);}catch(e2){}}');
      return;
    }
    asked = 0;
    heldSince = 0;
    if (!claims.chat) return;
    T.js('try{window.thornswoodChat&&window.thornswoodChat.blurInput();}catch(e){}');
    // Not waiting for the answer. If the page is in a state where it cannot
    // reply, the keyboard has to come back anyway.
    T.claimFocus('chat', false);
  }

  T.setTyping = wantTyping;
  T.isTyping = function () { return !!claims.chat; };

  // Said once, so a log with nothing in it can be told apart from a log that
  // never had anything to say. If this line is missing, the plugin is not being
  // given key events at all and nothing below it can possibly work.
  let sawAnyKey = false;

  /*
   * A pulse, so a lock can be told apart from the two things it looks like.
   *
   * When the keyboard dies the moment the microphone opens, there are two
   * completely different worlds and no way to tell them apart from the chair:
   *
   *   keys still arriving here  the game is being starved on purpose, which
   *                             means something has raised browser focus and
   *                             DInputHook is zeroing the game's read while
   *                             still feeding plugins.
   *   keys stop here too        DirectInput itself is gone, which is the game
   *                             losing the device rather than anybody taking
   *                             it, and nothing in this build can cause that
   *                             by raising a flag.
   *
   * Every fix so far has been aimed at the first world on the assumption it
   * was that one. This says which it is. Five seconds is often enough to see
   * the gap and rare enough to read.
   */
  let keysSeen = 0;

  /*
   * The last twenty key presses, so the thing that opens the console has to
   * say which key it is on.
   *
   * The console opening is the lock. Two config changes aimed at the two mods
   * whose hotkeys collide with keys held while playing did not stop it, which
   * means the opener is a third thing and guessing at mod lists one at a time
   * is not converging. Every key press passes through this file already, so
   * the cheapest possible answer is to remember the recent ones and print them
   * the moment the console appears. Whatever scan code is sitting at the end
   * of that list is the hotkey, and the hotkey names the mod.
   *
   * Twenty entries of two numbers. It costs nothing and it is only ever read
   * on the one event that matters.
   */
  const recentKeys = [];

  function rememberKey(code) {
    recentKeys.push([code, Date.now()]);
    if (recentKeys.length > 20) { recentKeys.shift(); }
  }

  function recentKeysText() {
    if (!recentKeys.length) { return 'nothing at all'; }
    const now = Date.now();
    const parts = [];
    for (let i = 0; i < recentKeys.length; i++) {
      parts.push(recentKeys[i][0] + ' (' + (now - recentKeys[i][1]) + 'ms ago)');
    }
    return parts.join(', ');
  }
  let lastPulse = 0;

  /*
   * The console opens by itself, and while it is open the game ignores you.
   *
   * That is the whole lockup. The pulse caught it:
   *
   *     input: 173 keys in 5s, browser focus no, menu yes [Console Native UI Menu]
   *
   * 173 keys means the keyboard is fine and the plugin is getting every press.
   * The game is not, because a menu has the input, and the menu is the
   * console. Stuck running follows from the same thing: the last movement the
   * game saw is the last one it will ever see, so the character keeps going.
   *
   * Nobody opened it. It appears on its own, and so far only ever within a
   * second or two of the browser opening a capture device, which is why this
   * looked like a microphone problem for most of a day.
   *
   * Shut it. TESModPlatform.CloseMenu queues a hide for a menu by name, and it
   * is bound in the VM even though the generated type declarations predate it,
   * which is why this goes through the proxy rather than a typed call.
   *
   * Deliberately not conditional on anything. There is no legitimate way for
   * this menu to be open on this build: the console is not how anybody plays
   * here, and a console somebody opened on purpose being shut is a smaller
   * problem than a console nobody opened taking the keyboard.
   */
  /*
   * The client switching itself to single player, said out loud.
   *
   * skymp5-client used to do that whenever a loadGame event arrived that it did
   * not believe it caused: message box, connection closed, syncing stopped.
   * Both halves were invisible from here. The modal took the keyboard, and the
   * disconnect is why the character carried on running with nothing correcting
   * them.
   *
   * It fired on every launch, because Skyrim has no command line for loading a
   * save and this build used Start On Save to walk into the right character,
   * until it left the build (issue #394). That load was real and SkyMP did not
   * cause it, so the guard was right about the facts and wrong about what they
   * meant.
   *
   * The disconnect is patched out in skymp5-client.js and the count is kept
   * here instead, because how often this happens is worth knowing even now
   * that it costs nothing.
   */
  let saidSingle = 0;
  let saidMove = 0;

  sp.on('update', guard('singleplayer', () => {
    let n = 0;
    try { n = Number(globalThis.__thornswoodUncausedLoad) || 0; } catch (e) { return; }
    if (n <= saidSingle) { return; }
    saidSingle = n;
    say('a save was loaded that SkyMP did not cause (' + n + ' so far). ' +
        'still connected; this used to disconnect and lock the keyboard.');
  }));

  /*
   * Which of the two spawn paths put the character in the world.
   *
   * skymp5-client has two and they race on one flag. One moves the character
   * with moveRefrToPosition. The other writes a save on the spot and loads it,
   * which when Start On Save was in the build meant reverting the save it had
   * just finished loading and never coming back out of it. That is the infinite loading
   * screen, and the second path is now told to stand down whenever there is
   * already a game to be in.
   *
   * Worth a line in the log either way. If this stops appearing, the spawn went
   * back through the load and the loading screen is the next thing to expect.
   */
  sp.on('update', guard('spawnpath', () => {
    let n = 0;
    try { n = Number(globalThis.__thornswoodSpawnedByMove) || 0; } catch (e) { return; }
    if (n <= saidMove) { return; }
    saidMove = n;
    say('spawn: the save reload stood down, moving the character instead (' +
        n + ' so far)');
  }));

  /*
   * Every activation, said out loud.
   *
   * Handles, levers and cages do nothing when pressed, and taking the
   * activation block off activators did not change it, which makes sense now:
   * dealWithRef only ever runs on refs the server already knows about, and a
   * lever in a dungeon is not one of those. So it was never blocked by us and
   * something else is eating it.
   *
   * There are only three things it can be and this tells them apart in one
   * press. No line at all means the game never registered an activation, so
   * the press is being lost before anything here sees it. A line with blocked
   * yes means something set blockActivation on that ref and it is still set. A
   * line with blocked no, followed by nothing happening on screen, means the
   * activation ran and the Papyrus script behind it did not, which is a
   * different problem in a different place.
   */
  // Set while we are re-activating something, so our own call does not come
  // back through this handler and recurse.
  let reActivating = false;
  const lastForced = {};

  /*
    Whether the door rescue runs. It does not, and the long comment in the
    type 29 branch below is the incident that switched it off on 16 September.

    It has a name now because it was a bare return with thirty-one lines
    behind it, which reads as a mistake rather than as a decision: anybody
    tidying the file would have deleted the block, and the next person wanting
    cage gates to work would have started from nothing. The flag says the code
    is kept on purpose and says where to turn it on, and turning it on still
    needs what the comment asks for, which is a signal only a real key press
    produces.
  */
  const DOOR_RESCUE = false;

  /*
    Bases the server answers for, so they are not activated twice.

    Every ACTI below is re-activated with default processing off, because some
    vanilla handle and lever scripts never start under SkyMP. The client
    forwards that second activation too, so anything the server handles ran
    twice per press: a quarry strike and then "the seam needs 20 more seconds".

    The gamemode writes the list into the same folder this file already probes,
    as runtime form ids. Until it arrives the set is empty, which is exactly
    the behaviour this file had before, so a server that has not been deployed
    yet changes nothing.
  */
  const serverBases = {};
  let serverBasesAsked = 0;
  /* target -> when its activation was last written down. See the log line
     in the activate handler: one per press was one per door in the town. */
  const lastLogged = {};

  /*
   * Which browser backend is actually running.
   *
   * SkyrimPlatform has two: tilted, which is the original CEF stack living in
   * src/tilted and is where DInputHook, ChromeFocus and every input bug chased
   * in this file comes from, and nirnlab, which replaces it with the NirnLab UI
   * Platform SKSE plugin. BrowserApi.cpp picks between them from
   * SkyrimPlatform.ini, and "auto" is NOT a choice: it logs "Auto mode not
   * implemented yet" and falls back to tilted, which upstream's own source
   * calls legacy.
   *
   * Worth one line at startup, because the difference decides whether
   * BrowserApiTilted::SetFocused exists at all, and that function is the only
   * writer of the flag that zeroes every keyboard read.
   */
  try {
    const b = sp.browser.getBackend();
    say('browser backend: ' + ((b && b.name) || 'unknown'));
  } catch (e) {
    say('browser backend: could not ask (' + e + ')');
  }

  /*
    Beds are sleepable for everybody (#839).

    Vanilla marks most beds Owned by an NPC or a faction, and Sleep/Wait then
    refuses them. Under SkyMP there is nobody home to ask, so an Owned bed is
    just a bed nobody can rest in. Clear the owner on a bed press (and ask
    again if it was owned, because that press may already have been refused),
    and when somebody actually lies down tell the server /rest bed so the
    exhaustion meter recovers the way Blade's pitch asked.

    Claimed-property beds are left as a later gate if Patrick wants one: the
    done line for #839 is ordinary beds sleepable, not a new property lock.
  */
  const BED_KEYWORDS = [
    'FurnitureBedDouble', 'FurnitureBedSingle', 'FurnitureBedRoll',
    'isBedRoll', 'VendorItemBed'
  ];
  const BED_NAME = /\b(bed|cot|bunk|mattress|pallet|bedroll|sleeping\s*bag)\b/i;

  function isBedRef(ref) {
    if (!ref) { return false; }
    let base = null;
    try { base = ref.getBaseObject(); } catch (e) { return false; }
    if (!base) { return false; }
    try {
      if (base.getType() !== 40) { return false; }
    } catch (e) { return false; }
    for (let i = 0; i < BED_KEYWORDS.length; i++) {
      try {
        const kw = sp.Keyword.getKeyword(BED_KEYWORDS[i]);
        if (kw && base.hasKeyword(kw)) { return true; }
      } catch (e) { }
    }
    try {
      const n = base.getName() || '';
      if (BED_NAME.test(n)) { return true; }
    } catch (e) { }
    return false;
  }

  function clearBedOwnership(ref) {
    if (!isBedRef(ref)) { return false; }
    let cleared = false;
    try {
      if (ref.getActorOwner()) { ref.setActorOwner(null); cleared = true; }
    } catch (e) { }
    try {
      if (ref.getFactionOwner()) { ref.setFactionOwner(null); cleared = true; }
    } catch (e) { }
    return cleared;
  }

  sp.on('activate', guard('activate', (e) => {
    // Declared here, once, for the whole handler. It used to be declared
    // further down, after the door block, and a const is not usable
    // before its line: every door press threw "Cannot access 'now'
    // before initialization" and the door rescue below never ran.
    const now = Date.now();

    /*
      SOMEBODY ELSE'S PRESS IS NOT OURS.

      Patrick, 21 September, from playing it: "Theres a weird thing when yoiu
      walk my quarries an npc will spawn and force you to start mining when one
      you didnt click on it and two you have no pickaxe and arent a miner".
      His clip shows him walking past the quarry with nothing under the
      crosshair while the server says "Only a miner can work a seam. Ask one."
      four times over, and "Only a farmer can bring a crop in" three times.

      This event fires for EVERY activation in the loaded area, by anybody. The
      comment on the log line below already said so: "every door an NPC opens
      and every crate anybody walks past". Whiterun's own miners and farmhands
      work their seams and their crops all day, and every one of those strikes
      arrived here.

      And then the ACTI branch at the bottom re-activated the thing AS THE
      PERSON: `e.target.activate(pc, false)`, with pc fetched from
      Game.getPlayer(). So an NPC swinging at a vein made us activate that vein
      on the person's behalf, which ran the vanilla mine script on them, which
      is the animation and the marker Patrick read as an NPC spawning and
      forcing him to mine. The same call is forwarded to the server, which is
      where the four refusals came from: the server was answering presses he
      never made.

      caster is the actionRef out of TESActivateEvent, set in EventHandler.cpp
      next to target. 0x14 is the person's own reference and is fixed for every
      Skyrim there has ever been. An activation with no actionRef at all
      (caster 0) is the game activating something while a cell loads, which is
      likewise not a press, so it is dropped with the rest.
    */
    let casterId = 0;
    try { casterId = e.caster ? e.caster.getFormID() : 0; } catch (err) { }
    if (casterId !== 0x14) { return; }

    if (reActivating) { return; }

    let target = 0, base = 0, type = -1, blocked = 'unknown', name = '';
    try { target = e.target ? e.target.getFormID() : 0; } catch (err) { }
    try {
      const b = e.target ? e.target.getBaseObject() : null;
      if (b) { base = b.getFormID(); type = b.getType(); name = b.getName() || ''; }
    } catch (err) { }
    try { blocked = e.target.isActivationBlocked() ? 'yes' : 'no'; } catch (err) { }
    /*
      Not a line per press.

      This wrote a line, and appended it to a file, for every activation
      anywhere in the loaded area, which in a town is every door an NPC opens
      and every crate anybody walks past. The same target within two seconds
      is the same person pressing the same thing, and is the case this was
      written to watch, so it is still logged; the rest is not.
    */
    if (!lastLogged[target] || now - lastLogged[target] > 2000) {
      lastLogged[target] = now;
      say('activate: ' + (name || 'something') +
          ' target ' + target.toString(16) +
          ' base ' + base.toString(16) +
          ' type ' + type +
          ' blocked ' + blocked);
    }

    /*
      Activators get one real activation, asked for explicitly.

      The log settled what was happening and ruled out everything cheap. The
      event fires, the ref is not blocked, and the handle still does nothing,
      and no handle or lever script appears anywhere in the Papyrus log. So the
      game registers the press and the script behind it never starts.

      This asks for the activation again with abDefaultProcessingOnly FALSE,
      which is the argument that says run the attached script rather than only
      the built in behaviour. If something upstream is consuming the press
      before the script sees it, this is the press the script gets.

      Only ACTI, because that is what a handle, a lever, a chain and a cage bar
      are. Doors and containers are left alone: their state is shared and the
      server owns it, and this would open them twice. Once every two seconds
      per ref, so holding the key down does not toggle a lever back and forth.

      If a handle starts working, that was it. If a handle now works twice, the
      script was running all along and the problem is what it is linked to. Both
      are answers.
    */
    /*
      A door the server never answers gets activated anyway, eventually.

      Cage Gate came back "type 29 blocked yes". Doors are the one thing still
      blocked on purpose, because their open state is shared and the server is
      supposed to be the one that opens them: press, the block holds, an Activate
      goes up, the server replies, the client activates. That works for a door
      somebody walks through. It cannot work for a cage gate, because what opens
      a cage gate is a chain running a Papyrus script, and the server has no
      scripts, so the reply never comes and the press is simply lost.

      So the server gets first refusal, and then this asks. A second and a half
      later, if the ref is still there, still within reach, and still in the
      same open state it was in, nothing answered and the door is activated
      properly. A load door is gone from under this long before then, and the
      distance check is the second guard against acting on one.
    */
    if (type === 29) {
      /*
        The rescue below is OFF, and it has to stay off until it can tell a
        press from an echo.

        The activate event does not only fire for the person's own press. It
        also fires when the server answers that press and the client
        activates the door on its behalf, and for whatever the game activates
        on its own while a cell loads. This code cannot tell those apart, so
        on 2026-09-16, the first day it actually ran (a misplaced const had
        thrown on its first line until then), it saw the server's own
        activation of the inn door as an unanswered press, waited a second
        and a half, and activated the door itself. That door is a load door,
        so the person was sent through it, which fired activate again, and
        they were pulled through the same door every three seconds for as
        long as they stood within reach of it: "loads in, loads in again,
        then keeps flashing".

        Cage gates stay unsolved for now. A rescue for them needs a signal
        that only a real key press produces, not the activate event.
      */
      if (!DOOR_RESCUE) { return; }

      const id = target;
      let openWas = -1;
      try { openWas = e.target.getOpenState(); } catch (err) { return; }
      if (lastForced[id] && now - lastForced[id] < 3000) { return; }
      lastForced[id] = now;

      sp.Utility.wait(1.5).then(guard('doorrescue', () => {
        const refr = sp.ObjectReference.from(sp.Game.getFormEx(id));
        if (!refr) { return; }
        let openNow = -1;
        try { openNow = refr.getOpenState(); } catch (err) { return; }
        if (openNow !== openWas) { return; }

        const pc = sp.Game.getPlayer();
        if (!pc) { return; }
        const dx = refr.getPositionX() - pc.getPositionX();
        const dy = refr.getPositionY() - pc.getPositionY();
        const dz = refr.getPositionZ() - pc.getPositionZ();
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) > 400) { return; }

        try {
          reActivating = true;
          try { refr.activate(pc, false); } finally { reActivating = false; }
          say('  nothing answered for ' + (name || 'that door') +
              ', activated it here instead');
        } catch (err) {
          reActivating = false;
          say('  rescuing ' + (name || 'that door') + ' threw: ' + err);
        }
      }));
      return;
    }

    // Furniture: beds only. Clear Owned so Sleep/Wait works (#839).
    if (type === 40) {
      let wasOwned = false;
      try {
        wasOwned = !!(e.target.getActorOwner() || e.target.getFactionOwner());
      } catch (err) { }
      let bed = false;
      try { bed = isBedRef(e.target); } catch (err) { }
      if (bed) {
        try { clearBedOwnership(e.target); } catch (err) { }
        if (wasOwned) {
          // This press may already have been refused as Owned. Ask again.
          try {
            const pc = sp.Game.getPlayer();
            if (pc) {
              reActivating = true;
              try { e.target.activate(pc, false); }
              finally { reActivating = false; }
              say('  cleared ownership on ' + (name || 'a bed') + ', activated again');
            }
          } catch (err) {
            reActivating = false;
            say('  clearing bed ownership threw: ' + err);
          }
        }
      }
      return;
    }

    if (type !== 24) { return; }

    // The server already answers for this one, and the client forwards the
    // re-activation too, so asking again is what made every press count twice.
    if (base && serverBases[base]) { return; }

    if (lastForced[target] && now - lastForced[target] < 2000) { return; }
    lastForced[target] = now;

    try {
      const pc = sp.Game.getPlayer();
      if (!pc) { return; }
      reActivating = true;
      try {
        e.target.activate(pc, false);
        say('  asked ' + (name || 'it') + ' to run its own script');
      } finally {
        reActivating = false;
      }
    } catch (err) {
      reActivating = false;
      say('  re-activating ' + (name || 'it') + ' threw: ' + err);
    }
  }));

  /*
    A lock that has just been opened is handed straight back to the server.

    While a door or a chest is locked the client deliberately does not block it,
    so Skyrim runs its own handling and the mini game appears. The bundle does
    put the block back once the thing is no longer locked, but only the next time
    it builds a view of that reference, which is long after the pick. In between,
    the press that finishes the mini game is handled entirely by Skyrim: the chest
    swings open here and nowhere else, so the server never made this person its
    occupant and never sent the contents, and every item taken out of it is thrown
    away on arrival. That is the chest that cannot be looted.

    So the block goes back on the moment the lock opens rather than whenever the
    view is next made. This is the same flag the bundle would set itself, set
    earlier, so it is not fighting it.

    Containers and doors only. An unlocked display case is still Skyrim's.
  */
  // When each property door last told the server it opened (#2680), so one
  // pick is one line.
  const pickSaid = {};
  sp.on('lockChanged', guard('lockchanged', (e) => {
    const ref = e ? e.lockedObject : null;
    if (!ref) { return; }

    let locked = true;
    try { locked = ref.isLocked(); } catch (err) { return; }
    if (locked) { return; }

    let type = -1;
    try {
      const b = ref.getBaseObject();
      type = b ? b.getType() : -1;
    } catch (err) { }
    if (type !== 28 && type !== 29) { return; }

    let id = 0;
    try { id = ref.getFormID(); } catch (err) { }

    try {
      ref.blockActivation(true);
      say('lock opened on ' + id.toString(16) + ', handed it back to the server');
    } catch (err) {
      say('could not hand ' + id.toString(16) + ' back to the server: ' + err);
    }

    /*
      A PROPERTY DOOR THAT OPENED HERE IS A PICK (#2680), and the server is
      told, so its holder can be sent word. The lock script publishes the
      doors the server shut to this person and takes a door off that list
      before it opens one itself, so a door still on it that is open now was
      opened by Skyrim's lockpicking. The server checks it all again.
    */
    if (type === 29 && id) {
      let shutHere = null;
      try { shutHere = globalThis.__thornswoodPropertyShut; } catch (err) { shutHere = null; }
      const now = Date.now();
      if (shutHere && shutHere[id] && !(pickSaid[id] && now - pickSaid[id] < 10000)) {
        pickSaid[id] = now;
        say('property door ' + id.toString(16) + ' opened on its lock, telling the server');
        tellServer('/tspicked ' + id.toString(16));
      }
    }
  }));

  /*
    A lockpick that broke is reported to the server, because the server owns
    the pack and Skyrim only destroyed it here.

    Breaking a pick is a local event. The server's copy of the inventory still
    holds it, and the re-apply a few seconds later hands it straight back, so
    picks never ran out and a lock could be worked forever.

    There is no message for this. All 34 message types in the protocol were
    read and none of them say an item was destroyed. The only ones that shrink
    a pack are put, take, drop, craft and a bow shot, and upstream solved the
    same problem for arrows by adding a message type, which needs a client we
    do not build. So this rides the one channel that already exists: the chat
    overlay's socket to the voice service, which queues any line starting with
    a slash for the gamemode to collect. It arrives a second or two late.

    A destroyed item is the one with no destination. The shipped bundle reads
    it the same way in its own drop handler, which is where the shape comes
    from.
  */
  const LOCKPICK = 0xa;
  const toServer = [];

  /*
    say marks every line as pressed rather than typed (#2251, #2732), and
    quiet asks the chat page to queue it without saying "Not connected yet"
    over it. Patrick, 24 September, over a tester in the creation hall who
    had typed nothing: "it says mulitple trimes he wasnt connected yet". The
    two are separate answers in thornswood-chat.js (TWO ANSWERS, over send).
  */
  function tellServer(line) {
    if (line) { toServer.push(line); }
    if (toServer.length > 20) { toServer.splice(0, toServer.length - 20); }
    if (!T.ready) { return; }
    while (toServer.length) {
      const sent = T.js('try{window.thornswoodNet&&window.thornswoodNet.say(' +
                        JSON.stringify(toServer[0]) + ',{quiet:true});}catch(e){}');
      if (!sent) { return; }
      toServer.shift();
    }
  }

  /*
    ------------------------------------------------- lying down in a bed (#839)

    Ownership clear on activate makes Sleep/Wait open. This half tells the
    exhaustion meter: furnitureEnter on a bed is /rest bed, on any other
    furniture /rest sit, and furnitureExit is /rest up. Nobody types them
    (#1603). The server answers by the furniture it saw pressed, so a chair
    is a seat, a chair by a fire is a campfire, and a forge or a chopping
    block is nothing and is answered with nothing (chopping has its own
    watcher below). This side only says which of the two it saw.
  */
  let restSent = false;
  /* #843: chairs/benches leave controls off with no menu. ownTheCharacter,
     holdSprintGate and holdNpcClear refuse to fight that state when
     notOurs() says so. getFurnitureReference alone can flicker null while
     still seated, so furnitureEnter/Exit keep a seated flag too. */
  let seatedInFurniture = false;

  try {
    sp.on('furnitureEnter', guard('bedenter', (e) => {
      let actorId = 0;
      try { actorId = e.actor ? e.actor.getFormID() : 0; } catch (err) { }
      if (actorId !== 0x14) { return; }
      const ref = e ? e.target : null;
      if (!ref) { return; }
      seatedInFurniture = true;
      try { clearBedOwnership(ref); } catch (err) { }
      let bed = false;
      try { bed = isBedRef(ref); } catch (err) { }
      restSent = true;
      tellServer(bed ? '/rest bed' : '/rest sit');
      say(bed ? 'resting in a bed' : 'sitting down');
    }));
    sp.on('furnitureExit', guard('bedexit', (e) => {
      let actorId = 0;
      try { actorId = e.actor ? e.actor.getFormID() : 0; } catch (err) { }
      if (actorId !== 0x14) { return; }
      seatedInFurniture = false;
      if (!restSent) { return; }
      restSent = false;
      tellServer('/rest up');
      say('got up');
    }));
    say('watching for beds');
  } catch (e) {
    say('could not watch for beds: ' + e);
  }

  /*
    ------------------------------------------------- every fall of the axe

    Patrick, 21 September: "the chopping block is still not always doing the
    animation and not always giving the wood apon hit still".

    THE SERVER SEES A PRESS AND SKYRIM DOES THE SWINGING. A chopping block is a
    FURN record, so pressing it puts the person into Skyrim's own chopping
    furniture and the axe falls over and over with the server hearing nothing.
    Vanilla's own block script would have handed wood over per swing and it
    does not run here, for the same reason MineOreScript does not and the
    Whiterun gate stays locked. So one press was one handover and every swing
    after it was free exercise.

    The events do pass through here, so this is the only place that can count
    them. Each one is reported as /chopped on the chat overlay socket, the same
    channel a broken lockpick already rides, and the server decides whether it
    is worth anything: choppedSwing credits nobody it has not just watched
    press a block, and no faster than an axe can fall. Typing the word is
    worth nothing.

    WHICH EVENT IS THE FALL. The four IdleWoodChop records in Skyrim.esm are
    Start, EnterInstant, Stop and Exit, and those are the session, not the
    swing: the fall itself is an annotation inside the animation and it does
    not have to be one of those names. So this matches a family rather than a
    name, and WRITES DOWN, ONCE EACH, EVERY EVENT IT SAW DURING A SESSION THAT
    IT DID NOT COUNT. After one session at a block the log names the real
    event, and this can be narrowed to exactly it instead of guessed at again.
  */
  const CHOP_START = /woodchop.*(start|enter)/i;
  const CHOP_END = /woodchop.*(stop|exit)|idlechairexitstart|idleforcedefaultstate/i;
  // The fall. Broad on purpose until the log says what it actually is.
  const CHOP_HIT = /chop|hit|impact|swing/i;
  /* A session is only this long without another event, so somebody who walks
     away mid animation is not left counted as chopping. */
  const CHOP_IDLE_MS = 15000;
  let chopping = 0;          // when the session started, 0 for none
  let chopSeen = 0;          // when an event last arrived
  const chopUnknown = {};    // event names seen and not counted, once each

  /*
    ---------------------------------------------- and every fall of the pick

    THIS WATCHES AND REPORTS NOTHING, ON PURPOSE.

    Patrick, 22 September: "you dont get the ore as it hits the vein". The ore
    used to arrive on the press; the server now holds it back until the pick
    lands, and "when the pick lands" is a constant in the gamemode,
    SWING_LAND_MS, because nothing on the server can see inside an animation.
    The strike is an annotation in IdlePickaxeEnter and this hook is the only
    place on either machine that annotation passes through.

    So this writes down, once each, every event a mining swing emits, exactly
    the way the chopping watcher above it did before the axe was understood.
    After one session at a seam the log names the real strike event, and
    SWING_LAND_MS can be replaced by it instead of guessed at twice.

    It never returns and never counts: IdleChairExitStart ends a mining swing
    AND a chopping session, so a branch here that swallowed events would take
    them off the axe. Everything below still sees every event it did.
  */
  const MINE_START = /pickaxe.*(enter|start)/i;
  const MINE_END = /pickaxe.*(exit|stop)|idlechairexitstart|idleforcedefaultstate/i;
  const MINE_IDLE_MS = 15000;
  let mining = 0;
  let mineSeen = 0;
  const mineEvents = {};

  function watchTheSwing(name, now) {
    if (MINE_START.test(name)) {
      mining = now; mineSeen = now;
      say('mining: swing started on ' + name);
      return;
    }
    if (!mining) { return; }
    if (now - mineSeen > MINE_IDLE_MS) { mining = 0; return; }
    mineSeen = now;
    if (MINE_END.test(name)) {
      // Read before mining is zeroed, or every swing is reported as 0ms long.
      say('mining: swing ended on ' + name + ', ' + (now - mining) + 'ms in');
      mining = 0;
      return;
    }
    if (!mineEvents[name]) {
      mineEvents[name] = true;
      say('mining: ' + name + ' arrived ' + (now - mining) + 'ms into the swing');
    }
  }

  try {
    sp.hooks.sendAnimationEvent.add({
      enter: (ctx) => {
        try {
          const name = String(ctx.animEventName || '');
          if (!name) { return; }
          const now = Date.now();

          watchTheSwing(name, now);

          if (CHOP_START.test(name)) {
            chopping = now; chopSeen = now;
            say('chopping: session started on ' + name);
            return;
          }
          if (!chopping) { return; }
          if (now - chopSeen > CHOP_IDLE_MS) { chopping = 0; return; }
          chopSeen = now;

          if (CHOP_END.test(name)) {
            chopping = 0;
            say('chopping: session ended on ' + name);
            return;
          }
          if (CHOP_HIT.test(name)) {
            tellServer('/chopped');
            return;
          }
          // Not counted, and worth knowing about exactly once.
          if (!chopUnknown[name]) {
            chopUnknown[name] = true;
            say('chopping: saw ' + name + ' and did not count it as a swing');
          }
        } catch (err) { }
      },
      leave() { }
    }, 0x14, 0x14);
    say('watching for the axe');
  } catch (e) {
    say('could not watch for the axe, so wood comes per press only: ' + e);
  }

  /*
    WHAT THE GAME SAYS IS IN EACH HAND WHEN A WEAPON IS DRAWN (#2039).

    A measurement, not a fix. With nothing equipped, M1 sometimes draws with
    the one-handed weapon ready pose and swing instead of raising the fists,
    and only in some sessions: a later login on the same character raises the
    fists. The server's saved record is the same either way (both hands empty,
    every spell slot 0; read on dev on 8 Oct for ff000033 and ff000036), so
    the difference is in the game's own state, and nothing logged it.

    So this writes one line when the character's draw or attack starts: the
    animation event, what is equipped in each hand, the item type the game
    reports for each hand, and the hand types the behaviour graph is using
    (iLeftHandType, iRightHandType), which is what picks the pose. At most one
    line every two seconds. It changes nothing in play.

    The hook only notes the event; the reads happen on the next frame, outside
    the hook, and the frame handler returns at once while nothing is noted.
  */
  const HANDS_EVENT = /^(WeaponDraw|weaponDraw|AttackStart|attackStart|BowDraw|bowDraw)/;
  const HANDS_EVERY_MS = 2000;
  let handsAsked = '';
  let handsSaidAt = 0;

  function handsLine(eventName) {
    const pc = sp.Game.getPlayer();
    if (!pc) { return; }
    const part = (label, read) => {
      let v;
      try { v = read(); } catch (e) { v = 'threw'; }
      return label + ' ' + v;
    };
    const formOf = (f) => {
      if (!f) { return 'none'; }
      let id = 0, name = '';
      try { id = f.getFormID() >>> 0; } catch (e) { id = 0; }
      try { name = f.getName() || ''; } catch (e) { name = ''; }
      return id.toString(16) + (name ? ' (' + name + ')' : '');
    };
    say('hands at ' + eventName + ': ' + [
      part('right weapon', () => formOf(pc.getEquippedWeapon(false))),
      part('left weapon', () => formOf(pc.getEquippedWeapon(true))),
      part('right object', () => formOf(pc.getEquippedObject(1))),
      part('left object', () => formOf(pc.getEquippedObject(0))),
      part('right type', () => pc.getEquippedItemType(1)),
      part('left type', () => pc.getEquippedItemType(0)),
      part('iRightHandType', () => pc.getAnimationVariableInt('iRightHandType')),
      part('iLeftHandType', () => pc.getAnimationVariableInt('iLeftHandType')),
      part('weapon out', () => (pc.isWeaponDrawn() ? 'yes' : 'no'))
    ].join(', '));
  }

  try {
    sp.hooks.sendAnimationEvent.add({
      enter: (ctx) => {
        try {
          const name = String(ctx.animEventName || '');
          if (!handsAsked && HANDS_EVENT.test(name)) { handsAsked = name; }
        } catch (err) { /* a hook must not throw into the game; this only notes a name */ }
      },
      leave() { }
    }, 0x14, 0x14);
  } catch (e) {
    say('could not watch the hands at a draw: ' + e);
  }

  sp.on('update', guard('hands', () => {
    if (!handsAsked) { return; }
    const name = handsAsked;
    handsAsked = '';
    const now = Date.now();
    if (now - handsSaidAt < HANDS_EVERY_MS) { return; }
    handsSaidAt = now;
    handsLine(name);
  }));

  /*
    WHAT THE CHARACTER IS LEFT IN AFTER A MINING SPELL (#2244).

    A measurement, not a fix. After a spell with the pickaxe only in the pack,
    the character cannot jump, sprint or use a forge until a pickaxe is
    equipped and taken off again. The spell ends with IdleChairExitStart and
    IdleForceDefaultState (swingScript in the gamemode), and those do not
    clear whatever holds them; the equip does. #2289 cycled the pick to clear
    it, which is a band-aid and was reverted (#2306). Nothing has said what
    the state is.

    So this writes the character's state as lines in this log: when a mining
    spell ends, again half a second and three seconds later, and again after
    the next equip or unequip, which is what frees them. Each line has the sit
    state, whether a weapon is out, the hand types, and the behaviour graph
    variables that gate jumping, sprinting and furniture. Every animation
    event in the five seconds after the end is written down too, once each.
    Comparing the stuck lines with the line after the equip names the
    variable that changed, and the event that clears it can then be sent
    instead. It changes nothing in play.
  */
  const AFTER_BOOLS = ['bAnimationDriven', 'bMotionDriven', 'bIsSynced', 'bAllowRotation',
    'bInJumpState', 'IsEquipping', 'IsUnequipping', 'IsAttacking', 'IsSprinting', 'bSprintOK',
    'bEquipOk', 'bAnimObjectLoaded', 'bHeadTrackSpine', 'bInFurnitureState', 'IsInFurniture',
    'bWantCastLeft', 'bWantCastRight', 'Is1HM', 'IsShouting', 'IsStaggering', 'IsBlocking'];
  const AFTER_INTS = ['iState', 'iFurnitureState', 'iSyncIdleLocomotion', 'iRightHandType',
    'iLeftHandType', 'iWantBlock', 'iGetUpType'];
  const AFTER_EVENTS_MS = 5000;
  let afterPick = false;         // a pickaxe idle started and has not ended
  let afterAsked = [];           // [label, when] to read on a later frame
  let afterEnded = 0;            // when the last mining spell ended, 0 for none
  let afterWaitEquip = false;    // a line is still owed for the next equip
  let afterEvents = {};          // event names written since the last end, once each

  /*
    ONLY THE CHARACTER'S OWN EQUIP COUNTS. The game sends equip and unequip
    for every actor near the camera, so an NPC drawing a sword after the spell
    used to take the one "after the next equip" line before the person had
    touched their pickaxe, and the line that should show what the equip
    changed showed the state they were still stuck in.
  */
  function afterMine(e) {
    try {
      const pc = sp.Game.getPlayer();
      return !!(e && e.actor && pc && e.actor.getFormID() === pc.getFormID());
    } catch (err) { return false; }
  }

  function afterLine(label) {
    const pc = sp.Game.getPlayer();
    if (!pc) { return; }
    const part = (name, read) => {
      let v;
      try { v = read(); } catch (e) { v = 'threw'; }
      return name + ' ' + v;
    };
    const parts = [
      part('sit', () => pc.getSitState()),
      part('sleep', () => pc.getSleepState()),
      part('weapon out', () => (pc.isWeaponDrawn() ? 'yes' : 'no')),
      part('right type', () => pc.getEquippedItemType(1)),
      part('left type', () => pc.getEquippedItemType(0))
    ];
    AFTER_BOOLS.forEach((n) => parts.push(part(n, () => (pc.getAnimationVariableBool(n) ? 1 : 0))));
    AFTER_INTS.forEach((n) => parts.push(part(n, () => pc.getAnimationVariableInt(n))));
    parts.push(part('Speed', () => Math.round(pc.getAnimationVariableFloat('Speed'))));
    say('after mining, ' + label + ': ' + parts.join(', '));
  }

  try {
    sp.hooks.sendAnimationEvent.add({
      enter: (ctx) => {
        try {
          const name = String(ctx.animEventName || '');
          if (!name) { return; }
          const now = Date.now();
          if (MINE_START.test(name)) { afterPick = true; return; }
          if (/^idlechairexitstart$/i.test(name) && afterPick) {
            afterPick = false;
            afterEnded = now;
            afterWaitEquip = true;
            afterEvents = {};
            afterAsked.push(['at the end (' + name + ')', now], ['0.5 s later', now + 500], ['3 s later', now + 3000]);
            return;
          }
          if (afterEnded && now - afterEnded < AFTER_EVENTS_MS && !afterEvents[name]) {
            afterEvents[name] = true;
            say('after mining: ' + name + ' sent ' + (now - afterEnded) + 'ms after the end');
          }
        } catch (err) { /* a hook must not throw into the game; this only notes a name */ }
      },
      leave() { }
    }, 0x14, 0x14);
  } catch (e) {
    say('could not watch the state after mining: ' + e);
  }

  sp.on('equip', guard('after mining equip', (e) => {
    if (!afterWaitEquip || !afterMine(e)) { return; }
    afterWaitEquip = false;
    afterAsked.push(['after the next equip', Date.now() + 200]);
  }));
  sp.on('unequip', guard('after mining unequip', (e) => {
    if (!afterEnded || afterWaitEquip || !afterMine(e)) { return; }
    afterAsked.push(['after the next unequip', Date.now() + 200]);
    afterEnded = 0;
  }));

  sp.on('update', guard('after mining', () => {
    if (!afterAsked.length) { return; }
    const now = Date.now();
    const due = afterAsked.filter((a) => a[1] <= now);
    if (!due.length) { return; }
    afterAsked = afterAsked.filter((a) => a[1] > now);
    due.forEach((a) => afterLine(a[0]));
  }));
  sp.on('containerChanged', guard('picks', (e) => {
    if (!e) { return; }

    let base = 0;
    try { base = e.baseObj ? e.baseObj.getFormID() : 0; } catch (err) { return; }
    if (base !== LOCKPICK) { return; }

    // Nothing received it, so it was destroyed rather than moved.
    let gone = false;
    try { gone = !e.newContainer || e.newContainer.getFormID() === 0; } catch (err) { gone = true; }
    if (!gone) { return; }

    // And it came off this person, not out of a chest somewhere.
    let mine = 0;
    try { mine = sp.Game.getPlayer().getFormID(); } catch (err) { return; }
    let from = 0;
    try { from = e.oldContainer ? e.oldContainer.getFormID() : 0; } catch (err) { return; }
    if (!mine || from !== mine) { return; }

    const n = Math.max(1, Math.min(20, Number(e.numItems) || 1));
    say('lockpick broke x' + n + ', asking the server to spend it');
    tellServer('/tspicks ' + n);
  }));

  const CONSOLE_MENUS = ['Console Native UI Menu', 'Console'];
  let consoleSince = 0;
  /*
    SAY IT ON THE SCREEN, NOT ONLY IN A LOG ON THE VPS.

    From the To Do List: "Pressing tilde makes the console flash and vanish,
    silently, forever, and nothing says why... Anti-cheat behaviour is
    disclosed. Say it on the rules page and put a line on screen when it
    triggers: the console is disabled on Thornswood. The explanation is
    already written, it just goes to a file on the VPS."

    Every message this block produced went through say(), which writes to
    thornswood-front.log and nowhere else. From the chair it is a console that
    opens for a fifth of a second and shuts, every time, with no explanation
    anywhere, which reads as a broken game rather than as a rule.

    Debug.notification is Skyrim's own corner message and needs no browser, so
    it lands whether or not the overlay ever mounted.

    ONCE, THEN EVERY FIVE MINUTES. Somebody who presses tilde out of habit
    four times in a row does not need telling four times, and somebody who
    comes back an hour later has forgotten.
  */
  const CONSOLE_SAY_EVERY = 300000;
  let consoleToldAt = 0;

  function shutConsole(which) {
    // Printed before the close, so it is in the log even if closing throws.
    say('the ' + which + ' is open. Keys just before it, newest last: ' +
        recentKeysText());
    const now = Date.now();
    if (now - consoleToldAt > CONSOLE_SAY_EVERY) {
      consoleToldAt = now;
      try {
        note('the console is switched off here');
      } catch (e) { }
      /*
        And in the chat, where it stays on screen long enough to read and can
        be scrolled back to. thornswoodChat.add is the widget's own way in,
        the same one thornswood-chat.js note() uses; there is no note on the
        object itself. Guarded, because the overlay may never have mounted and
        the corner message above has to be enough on its own.
      */
      T.js('try{window.thornswoodChat&&window.thornswoodChat.add&&' +
           'window.thornswoodChat.add([{text:"The console is switched off on ' +
           'Thornswood. It is the same rule for everybody.",color:"#d9ab52"}],' +
           '"plain");}catch(e){}');
    }
    try {
      sp.TESModPlatform.closeMenu(which);
      say('the ' + which + ' opened on its own and has been shut');
      return true;
    } catch (e) {
      say('the ' + which + ' opened on its own and closeMenu threw: ' + e);
      return false;
    }
  }

  /*
    The race menu closing, told to the server as a line. The server waits
    for the face to arrive on the change form and reads it as new when its
    mark changed; a face confirmed as it was, or a name kept, changes no
    mark, and until 20 September that left people standing until they
    walked. The menu closing is the fact itself, and this is the one place
    that can see it.
  */
  /*
    AND THE RACE MENU BEING UP, told as /racemenu when it opens and once a
    minute while it stays.

    Djinn, 22 September: "Sitting in the selector window, it automatically
    timed me out to name choice without any input commands". The server's five
    minute give up could not tell somebody making a face from a race menu that
    never opened, fired on him at 300 seconds exactly, and pushed the K panel
    over a race menu the client cannot close. This is the one place that can
    see the menu, so it says so, and the server holds the give up while the
    reports keep coming (FACE_SEEN_MS in the gamemode). Only once the overlays
    are in: a line queued before then would arrive late and say something
    that is no longer true.
  */
  let raceWasOpen = false;
  let raceToldAt = 0;
  const RACE_BEAT_MS = 60000;
  sp.on('update', guard('race', () => {
    const open = raceMenuOpen();
    if (open && T.ready && Date.now() - raceToldAt >= RACE_BEAT_MS) {
      if (!raceToldAt) { log('the race menu is up, telling the server once a minute while it is'); }
      raceToldAt = Date.now();
      tellServer('/racemenu');
    }
    if (open === raceWasOpen) { return; }
    raceWasOpen = open;
    if (!open) {
      raceToldAt = 0;
      // closingGame is F10 twice or the quit paths. A face left half made
      // is not /face done, so that word is not sent. The server still has
      // to learn the menu is down: if faceOpenAt stays set, a player who
      // is still connected is never asked again. /racedown is that fact.
      if (closingGame) {
        log('the race menu closed with the game closing, telling the server it is down');
        tellServer('/racedown');
        return;
      }
      log('the race menu closed, telling the server');
      tellServer('/face done');
    }
  }));

  /*
    ------------------------------------------------- body shape stays as made (#993)

    Patrick, 28 September: "I don't want jiggle physics or the ability to
    change boob/pussy/dick/ass/nipple related stuff during creation." For men
    and women alike. Height and weight stay.

    Where each of those controls comes from, and what takes it away:
    - The body morph sliders (the women's body's, with its breast, nipple and
      genital shapes, and the men's body's) and the genital sliders of the
      skeleton: the launcher leaves their scripts out of the game folder
      (OwnGame.BodyShapeFiles), so those pages of the menu never appear.
    - RaceMenu's own Left and Right Breast, Breast Curve and Glute sliders sit
      in RaceMenu's archive beside Height, which stays, so they cannot be left
      out. This undoes them: twice a second while the menu is up, any scale,
      move or turn on those bones is taken off, so the slider moves and the
      body does not.
    - And any body morph on the character is cleared, which is also what
      takes a changed body off a character made before this: out of the menu
      it looks every ten seconds.
    Height is the scale on the root bone and weight is the game's own, and
    neither is touched. Only the person's own character: SkyMP never sends
    these to anybody else. The server's half is BODY SHAPE in gamemode.js.
  */
  const BODY_NODES = [
    // RaceMenu's own and XPMSE's breast and seat bones.
    'NPC L Breast', 'NPC R Breast', 'NPC L Breast01', 'NPC R Breast01',
    'NPC L Breast P1', 'NPC R Breast P1', 'NPC L Breast P2', 'NPC R Breast P2',
    'NPC L Breast P3', 'NPC R Breast P3', 'NPC L Breast01 P1', 'NPC R Breast01 P1',
    'NPC L Breast01 P2', 'NPC R Breast01 P2', 'NPC L Breast01 P3', 'NPC R Breast01 P3',
    'L Breast01', 'L Breast02', 'L Breast03', 'R Breast01', 'R Breast02', 'R Breast03',
    'NPC L Butt', 'NPC R Butt',
    // The skeleton's genital bones, and the women's body's.
    'NPC GenitalsBase [GenBase]', 'NPC GenitalsScrotum [GenScrot]',
    'NPC L GenitalsScrotum [LGenScrot]', 'NPC R GenitalsScrotum [RGenScrot]',
    'NPC Genitals01 [Gen01]', 'NPC Genitals02 [Gen02]', 'NPC Genitals03 [Gen03]',
    'NPC Genitals04 [Gen04]', 'NPC Genitals05 [Gen05]', 'NPC Genitals06 [Gen06]',
    'CME GenitalsBase [GenBase]', 'CME GenitalsScrotum [GenScrot]',
    'CME Genitals01 [Gen01]', 'CME Genitals02 [Gen02]', 'CME Genitals03 [Gen03]',
    'CME Genitals04 [Gen04]', 'CME Genitals05 [Gen05]',
    'NPC L Pussy02', 'NPC R Pussy02', 'VaginaB1', 'Clitoral1',
  ];
  const BODY_OPEN_MS = 500;
  const BODY_SHUT_MS = 10000;
  let bodyAt = 0;
  let bodyWasOpen = false;
  let bodyUndone = 0;
  let bodyNoSkee = false;

  function niOverride(fn) {
    return sp.callNative.apply(null, ['NiOverride', fn, undefined].concat(Array.prototype.slice.call(arguments, 1)));
  }

  /** Takes body morphs and those bones' changes off the person's character. How many it took off. */
  function bodyShapeReset() {
    if (bodyNoSkee) { return 0; }
    let pc = null;
    try { pc = sp.Game.getPlayer(); } catch (e) { return 0; }
    if (!pc) { return 0; }
    let female = false;
    try { const b = pc.getActorBase(); female = !!b && b.getSex() === 1; } catch (e) { female = false; }
    let undone = 0;
    try {
      const names = niOverride('GetMorphNames', pc);
      if (names && names.length) {
        niOverride('ClearMorphs', pc);
        niOverride('UpdateModelWeight', pc);
        undone += names.length;
      }
    } catch (e) {
      // No RaceMenu in this game: nothing can have set any of it either.
      bodyNoSkee = true;
      log('body shape: NiOverride is not there, so there is nothing to undo:', e);
      return 0;
    }
    for (const node of BODY_NODES) {
      for (const firstPerson of [false, true]) {
        let keys = null;
        try { keys = niOverride('GetNodeTransformKeys', pc, firstPerson, female, node); } catch (e) { keys = null; }
        if (!keys || !keys.length) { continue; }
        for (const k of keys) {
          niOverride('RemoveNodeTransformScale', pc, firstPerson, female, node, k);
          niOverride('RemoveNodeTransformPosition', pc, firstPerson, female, node, k);
          niOverride('RemoveNodeTransformRotation', pc, firstPerson, female, node, k);
          undone++;
        }
        niOverride('UpdateNodeTransform', pc, firstPerson, female, node);
      }
    }
    return undone;
  }

  sp.on('update', guard('body shape', () => {
    const open = raceMenuOpen();
    const now = Date.now();
    if (open === bodyWasOpen && now - bodyAt < (open ? BODY_OPEN_MS : BODY_SHUT_MS)) { return; }
    bodyWasOpen = open;
    bodyAt = now;
    bodyUndone += bodyShapeReset();
    // Said once the menu is down, not twice a second while somebody drags.
    if (bodyUndone && !open) {
      log('body shape: took', bodyUndone, 'body change(s) back off the character; height and weight are left as made');
      bodyUndone = 0;
    }
  }));

  /*
    ------------------------------------------ closing Skyrim while making a face

    Patrick, 24 September: "there is no button to close skyrim still while
    doing the actiual chacrther making and desing stuff before naming
    yourself". The face and body are made in Skyrim's own RaceSex Menu,
    which owns the mouse, and skymp5-client hides the browser for the whole
    of it (badMenus in browserService.ts), so nothing on our page can be
    shown there, let alone clicked. A key is the only way in.

    F10 PRESSED TWICE within five seconds, and only while the RaceSex Menu
    is open. The first press arms it and the line on screen says to press it
    again; five seconds without a second press disarms it. With the menu
    shut the key does nothing at all, so it can never end a session in the
    world. The quit is closeGame, the same one the character page's Close
    the game uses.

    WHY F10, checked on 24 September against what is really bound rather
    than remembered, and held there by tools\test-creation-close.js:
      RaceMenu, which draws this menu here, reads Accept, Activate, Cancel,
      the four directions, Jump, Quicksave (F5), Quickload (F9), Ready
      Weapon, Shout, Sneak, Sprint, Toggle POV and Wait, and Tab, Enter,
      Shift, Alt and Space by code: read out of racesex_menu.swf in the game
      folder. Skyrim's own controlmap.txt (Skyrim - Interface.bsa) has F5,
      F9 and F12 in play; its other function key rows are the debug
      overlay's. skymp5-client holds F1, F2 and F6. SkyUI's four favourite
      group keys are F1 to F4, the mod settings menu is F4, and
      thornswood-mark.js has F8. F10 was the minimap's settings panel until
      the minimap left the build on 20 September (Keys.cs), and nothing else
      of ours or in the installed mods' ini files answers to it. And the
      name box on this same menu takes letters, which is why it is not one.

    CloseGameKey in Thornswood.ini, like every other key here, and 68 when
    it is not there.

    THE LINE. SkyrimPlatform draws its own texts (createText, the call
    skymp5-client draws the names above heads with), not the page, but by
    default only while the browser is visible: 'inheritBrowser', TextApi.h
    in the fork. So while the menu is open the texts are switched 'on', and
    when it closes they go back to what they were. For those minutes a name
    above somebody else in the hall can show over the menu too; that is the
    whole cost, and it ends with the menu.
  */
  let closingGame = false;   // set by closeGame, read by the race menu above
  let CLOSE_GAME_KEY = iniNumber(ini, 'CloseGameKey', 68);   // F10
  let CLOSE_GAME_NAME = keyName(CLOSE_GAME_KEY);
  const CLOSE_ARM_MS = 5000;
  const CLOSE_LINE_EVERY = 200;
  const CLOSE_LINE_COLOUR = [0.91, 0.82, 0.61, 0.95];   // the K panel's gold
  let closeArmedAt = 0;
  let closeLineId = 0;
  let closeLineSaid = '';
  let closeTextsOn = false;    // this block switched the texts on
  let closeTextsWere = '';     // and what they were before it did
  let closeLineAt = 0;

  function closeLineText() {
    return closeArmedAt ? 'Press ' + CLOSE_GAME_NAME + ' again to close Skyrim'
                        : CLOSE_GAME_NAME + ' twice closes Skyrim';
  }

  /* Up, or brought up to date. Only ever called with the menu open. The
     line is ours while its id still says our words: destroyAllTexts, which
     any plugin may call, empties every text and starts SkyrimPlatform's ids
     again from one (TextsCollection.cpp in the fork), so the id can be gone
     or be somebody's name, and then a new line is made rather than their
     text written over. */
  function closeLineShow() {
    const text = closeLineText();
    if (closeLineId) {
      let ours = false;
      try { ours = sp.getTextString(closeLineId) === closeLineSaid; } catch (e) { ours = false; }
      if (ours && text === closeLineSaid) { return; }
      if (ours) {
        try { sp.setTextString(closeLineId, text); closeLineSaid = text; return; } catch (e) { }
      }
      closeLineId = 0;
    }
    let w = 0, h = 0;
    try {
      w = Number(sp.Utility.getINIInt('iSize W:Display')) || 0;
      h = Number(sp.Utility.getINIInt('iSize H:Display')) || 0;
    } catch (e) { }
    if (!w || !h) { w = 1920; h = 1080; }
    try {
      closeLineId = sp.createText(Math.round(w / 2), Math.round(h * 0.06), text, CLOSE_LINE_COLOUR);
      closeLineSaid = text;
    } catch (e) {
      closeLineId = 0;
      log('close key: could not put the line up:', e);
      return;
    }
    try { sp.setTextSize(closeLineId, 0.5); } catch (e) { }
    if (!closeTextsOn) {
      try {
        closeTextsWere = typeof sp.getTextsVisibility === 'function' ? String(sp.getTextsVisibility() || '') : '';
        sp.setTextsVisibility('on');
        closeTextsOn = true;
      } catch (e) { log('close key: could not switch the texts on over the menu:', e); }
    }
    log('close key: the RaceSex Menu is open, the line says "' + text + '"');
  }

  /* Down, and the texts back to what they were. The id is only destroyed
     while it still says our words, for the reason above. */
  function closeLineHide() {
    closeArmedAt = 0;
    if (closeLineId) {
      try { if (sp.getTextString(closeLineId) === closeLineSaid) { sp.destroyText(closeLineId); } } catch (e) { }
      closeLineId = 0;
      closeLineSaid = '';
      log('close key: the RaceSex Menu is shut, the line is down');
    }
    if (closeTextsOn) {
      try { sp.setTextsVisibility(closeTextsWere || 'inheritBrowser'); } catch (e) { }
      closeTextsOn = false;
      closeTextsWere = '';
    }
  }

  sp.on('update', guard('close key line', () => {
    const now = Date.now();
    if (now - closeLineAt < CLOSE_LINE_EVERY) { return; }
    closeLineAt = now;
    if (closeArmedAt && now - closeArmedAt >= CLOSE_ARM_MS) { closeArmedAt = 0; }
    if (raceMenuOpen()) { closeLineShow(); } else { closeLineHide(); }
  }));

  sp.on('buttonEvent', guard('close key', (e) => {
    if (!e.isDown || e.isUp || e.code !== CLOSE_GAME_KEY) { return; }
    // Asked at the press, never cached: this is the one gate between a key
    // and the end of somebody's session.
    if (!raceMenuOpen()) { closeArmedAt = 0; return; }
    const now = Date.now();
    if (closeArmedAt && now - closeArmedAt < CLOSE_ARM_MS) {
      closeArmedAt = 0;
      closeGame('the close key, in the RaceSex Menu');
      return;
    }
    closeArmedAt = now;
    log('close key: pressed once in the RaceSex Menu, once more inside ' +
        (CLOSE_ARM_MS / 1000) + ' seconds closes Skyrim');
    closeLineShow();
  }));

  sp.on('update', guard('console', () => {
    let open = '';
    for (const name of CONSOLE_MENUS) {
      try { if (sp.Ui.isMenuOpen(name)) { open = name; break; } } catch (e) { }
    }
    if (!open) { consoleSince = 0; return; }

    // A moment's grace, so a console opened and closed inside one frame is not
    // chased, and so the log records how long it was actually up.
    const now = Date.now();
    if (!consoleSince) { consoleSince = now; return; }
    if (now - consoleSince < 400) { return; }

    consoleSince = 0;
    shutConsole(open);
  }));

  /*
   * The eight control flags, read for the log and nothing else (#2620).
   *
   * Skyrim's EnablePlayerControls and DisablePlayerControls take these flags.
   * Two timers used to sit here, the controls watchdog and the stuck rescue,
   * that switched every control back on and took the character off the AI
   * without knowing who had switched them off. The tester logs from 24
   * September to 16 October say what they were catching: the mining furniture
   * switching fighting and camera off on purpose, which #843 taught notOurs()
   * to see, and nothing else. The keyboard lock they were written for was the
   * engine's console idle branch, switched off in the fork. Nothing in this
   * tree switches a control off or turns AI driven on, so both are gone.
   *
   * What stays is the reading: the five second input line below names any
   * control that is off, so a control that ever sticks again is in the log
   * with its name, which is the trail to whatever switched it off.
   */
  const CONTROLS = [
    ['movement', 'isMovementControlsEnabled'],
    ['fighting', 'isFightingControlsEnabled'],
    ['camera', 'isCamSwitchControlsEnabled'],
    ['looking', 'isLookingControlsEnabled'],
    ['sneaking', 'isSneakingControlsEnabled'],
    ['menus', 'isMenuControlsEnabled'],
    ['activate', 'isActivateControlsEnabled'],
    ['journal', 'isJournalControlsEnabled']
  ];

  /*
    CONTROLS THE SERVER HOLDS OFF ON PURPOSE (#2573, #2620).

    Whoever switches a control off on purpose says so in sp.storage
    .thornswoodControlsHeld: a name per control (the names in CONTROLS) with
    the reason. The cuffs' own property script sets 'fighting' while somebody
    is bound and takes it off when they are freed (#2573). sp.storage, not a
    variable here, because the property script runs outside this file.

    Nothing in this file switches a held control back on, or any other: the
    input line reads the record so the log tells a control held off on
    purpose apart from one that is off with nobody saying why.
  */
  function heldOff() {
    let h = null;
    try { h = sp.storage.thornswoodControlsHeld || null; } catch (e) { h = null; }
    const out = [];
    if (h && typeof h === 'object') {
      for (const k of Object.keys(h)) { if (h[k]) { out.push(k); } }
    }
    return out;
  }

  /*
    Two states where controls being off is the game doing its job: death, and
    sitting in anything (chairs, benches, beds, carts, mining, chopping).
    Dying and sitting both switch controls off on purpose and open no menu.
    ownTheCharacter, holdSprintGate and holdNpcClear leave both alone.

    Both answers are cheap and both are wrapped, because a build without one
    of these natives must not take its callers down with it. Cached at a
    quarter second: several handlers ask every frame, and getPlayer, isDead
    and the furniture and sit reads do not need answering thirty times a
    frame (measured 26 September, #1033 audit).
  */
  const CONTROLS_CACHE_MS = 250;
  let notOursCachedAt = 0;
  let notOursCached = '';

  function notOursNow() {
    let pc = null;
    try { pc = sp.Game.getPlayer(); } catch (e) { return ''; }
    if (!pc) { return ''; }
    try { if (pc.isDead()) { return 'dead'; } } catch (e) { }
    /* Chair/bench kick-out (#843). Sitting turns controls off with no menu.
       enablePlayerControls / setPlayerAIDriven(false) stood people up. Three
       signals, any one is enough: the enter/exit flag, the furniture ref,
       and getSitState (non-zero = waiting to sit, sitting, or standing up).
       The ref alone used to flicker null and the old watchdog kicked them out. */
    try {
      if (typeof seatedInFurniture !== 'undefined' && seatedInFurniture) {
        return 'in furniture';
      }
    } catch (e) { }
    try {
      const f = pc.getFurnitureReference();
      if (f) { return 'in furniture'; }
    } catch (e) { }
    try {
      if (typeof pc.getSitState === 'function') {
        const sit = pc.getSitState();
        if (sit) { return 'in furniture'; }
      }
    } catch (e) { }
    return '';
  }

  function notOurs() {
    const now = Date.now();
    if (now - notOursCachedAt < CONTROLS_CACHE_MS) { return notOursCached; }
    notOursCachedAt = now;
    notOursCached = notOursNow();
    return notOursCached;
  }

  function readControlsNow() {
    const off = [];
    for (const pair of CONTROLS) {
      try {
        const fn = sp.Game[pair[1]];
        if (typeof fn !== 'function') { continue; }
        if (!fn.call(sp.Game)) { off.push(pair[0]); }
      } catch (e) { }
    }
    return off;
  }

  /* The input line's controls part: on, or off with the names, and what the
     server holds off on purpose named on its own (heldOff). Asked once every
     five seconds, by the pulse only. */
  function pulseControls() {
    const held = heldOff();
    const off = readControlsNow().filter((name) => held.indexOf(name) === -1);
    return (off.length ? ', controls off [' + off.join(', ') + ']' : ', controls on') +
      (held.length ? ', held [' + held.join(', ') + ']' : '');
  }

  /*
    ------------------------------------- three chopping blocks, taken away

    Djinn, 22 September, "Removal from area - Woodworking chopping Blocks":
    Solitude, Solitude Stables and Dragon Bridge, with a coordinate each.
    Patrick: "I want them actually removed and not there visible anymore."

    THE SERVER CANNOT DO THIS AND NEITHER CAN A GAMEMODE. Refusing the press
    only makes a block that does nothing, which is what the first attempt did
    and is not what was asked: the block is still standing there. Deleting a
    placed reference means editing the plugin that placed it, which is a
    rebuild, a pack, and a server that will not start if it goes wrong.

    So it is done where it can be done. Skyrim Platform runs on the machine
    that is drawing the block and ObjectReference.disable is the engine's own
    "this is not here", the same call the game uses for every object a quest
    takes out of the world. Every person running this plugin stops seeing them,
    which is everybody.

    BY FORM ID, MEASURED FROM THE PLUGINS. Djinn, 24 September, on dev, with
    three screenshots of a Wood Chopping Block and "E Use" under the
    crosshair: "The ones I gave you coords for are not removed". So every
    placed reference in the load order was read (99 plugins, last one wins)
    for what stands at each of his points:

      Solitude          d6ae9:Skyrim.esm, 103 units from the point, in
                        SolitudeWorld. Skyrim.esm files it in the cell at
                        -16,25; Populated Cities Towns Villages
                        Legendary.esp overrides it into a PERSISTENT
                        reference in that worldspace's persistent cell.
      Solitude Stables  a9ee1:Skyrim.esm, 61 units away, Tamriel, an
                        ordinary reference in the cell at -19,23.
      Dragon Bridge     abf83:Skyrim.esm, 132 units away, Tamriel, a
                        PERSISTENT reference in Tamriel's persistent cell,
                        standing in the cell at -25,19.

    All three are base 7022e, WoodChoppingBlock. No other of the 128 placed
    blocks on the three chopping block bases is within 400 units of any
    point; the nearest is 4,638 units from Dragon Bridge.

    So the walk of the cell somebody stands in was the wrong question twice
    over. Two of the three are filed under a persistent cell rather than
    the cell they stand in, and the third could only be found from inside
    its own cell, not from the one next to it. Asking for the three by form id
    finds each one wherever the person stands and cannot catch a fourth.
    Whether the engine also lists a persistent reference under its exterior
    cell at run time was not measured, because that needs the game running;
    asking by form id does not depend on it. The base and the position are
    still checked, once, so an override that moved one or made it something
    else leaves it alone and says so.

    AGAIN WHENEVER IT COMES BACK, which is the other half of the report.
    SkyMP's own client puts it back. Every time the server streams a
    Skyrim.esm reference to this machine (walking into range, coming back
    after leaving, reconnecting), the fork's skymp5-client remoteServer.ts
    onCreateActorMessage calls ModelApplyUtils.applyModelIsDisabled(refr,
    !!msg.props['disabled']), and the server writes that flag as
    "isDisabled" (skymp5-server CreateActorMessage.h), so it always reads
    false and the client calls refr.enable(true). The old code marked a
    site done after its first disable and never looked again. Now each
    site is checked every four seconds while somebody is near it, and
    taken out again when it is back, with one line each time.

    ONLY WHEN SOMEBODY IS NEAR. An ordinary reference is not in memory until
    its cell loads, and nothing is asked of the game from anywhere else, so
    away from these three places the cost is one distance sum per site every
    four seconds.
  */
  /*
    ======================= WALKING A CELL FOR A BASE =======================

    Game.findClosestReferenceOfType FINDS PERSISTENT REFERENCES, and almost
    nothing anybody stands next to is one. Two features in this file asked it
    for things and quietly got nothing, for the whole of their lives:

      the fire probe, which read "62 bases, 0 in reach, 0 threw" standing in
      the Bannered Mare's fire pit, in its cooking fire, and in the brazier
      outside it, on 23 September

      the chopping blocks at Solitude, the stables and Dragon Bridge, which
      have never once written their own "took the chopping block out of the
      world" line in any log on this machine

    Neither was a table problem or a radius problem. Cell.getNumRefs and
    getNthRef see everything in the cell, temporary references included, so
    that is what the fire probe uses now. The chopping blocks moved on again,
    to their own form ids: see the note above this one.

    THE FORM TYPES ARE THE FILTER AND THEY MATTER: walking every reference in
    an exterior cell is thousands of native calls. Activator 24, static 34,
    movable static 36 and furniture 42 are the four the fire table is built
    from, and the chopping blocks are furniture.
  */
  const CELL_TYPES = [24, 34, 36, 42];

  /*
    A SLICE A FRAME, NOT THE CELL IN ONE GO. Issue #976, from the #963 audit:
    the walk used to run whole inside the place tick, and a cell holding 402
    references of those four types cost that one frame 385 ms, a visible
    hitch every time somebody walked into a busy cell or an empty walk was
    retried. Now each frame takes the references that fit in FIRE_SLICE_MS
    and stops, and the next frame carries on where it left off. Only numbers
    are kept between frames: a native object does not survive the frame it
    was made in (see "THE IDS, RESOLVED ONCE" below), so the cell is asked
    for again in each slice, and whether a fire is switched off is asked in
    the same slice that fetched it.
  */
  /*
    The slice is measured with performance.now where the runtime has it
    (SkyrimPlatform's Node does), which reads fractions of a millisecond.
    Date.now only reads whole ones, so "2 ms gone" by it can be nearly 3, and
    the slice is 1 ms on that clock to stay under the same ceiling.
  */
  const SLICE_PRECISE = typeof performance === 'object' && !!performance &&
                        typeof performance.now === 'function';
  const sliceNow = SLICE_PRECISE
    ? function () { return performance.now(); }
    : function () { return Date.now(); };
  const FIRE_SLICE_MS = SLICE_PRECISE ? 2 : 1;

  /**
   * One slice of a walk of `cell`. `w` is { t, i, n, walked, out } and holds
   * where the walk has got to, between frames. Every lit reference whose base
   * is one of `want` goes into w.out as [x, y, z]; nothing in here moves, so
   * the finished list is kept by the caller. Stops once FIRE_SLICE_MS has
   * gone since `began`, the start of the slice, which the caller may already
   * have spent some of. Given no `began` it starts the clock itself and
   * takes at least one reference. True once the walk is finished.
   */
  function walkCellSlice(cell, w, want, onThrew, began) {
    const from = began || sliceNow();
    // A slice of our own always gets something done; a shared one that is
    // already spent does nothing, and the next frame's slice is all walk.
    let took = began ? 1 : 0;
    while (w.t < CELL_TYPES.length) {
      if (took > 0 && sliceNow() - from >= FIRE_SLICE_MS) { return false; }
      if (w.n < 0) {
        took++;
        try { w.n = cell.getNumRefs(CELL_TYPES[w.t]); } catch (e) {
          if (onThrew) { onThrew(e); }
          w.t++; w.i = 0; w.n = -1;
          continue;
        }
      }
      while (w.i < w.n) {
        if (took > 0 && sliceNow() - from >= FIRE_SLICE_MS) { return false; }
        const i = w.i++;
        took++;
        w.walked++;
        try {
          const r = cell.getNthRef(i, CELL_TYPES[w.t]);
          if (!r) { continue; }
          const b = r.getBaseObject();
          if (!b || !want[b.getFormID()]) { continue; }
          // A fire somebody has switched off is still a placed reference.
          // The toggled ones are the reason this asks rather than trusting
          // the base.
          let off = false;
          try { off = !!r.isDisabled(); } catch (e) { off = false; }
          if (off) { continue; }
          w.out.push([r.getPositionX(), r.getPositionY(), r.getPositionZ(), b.getFormID()]);
        } catch (e) {
          if (onThrew) { onThrew(e); }
        }
      }
      w.t++; w.i = 0; w.n = -1;
    }
    return true;
  }

  const BLOCK_BASES = [0x7022e, 0xa91bf, 0x10f575];
  // ref is the placed reference at the point, read out of the plugins on
  // 24 September (see "three chopping blocks, taken away" above). All three
  // are Skyrim.esm's own, which is always load index 00, so the local id is
  // the id the game uses.
  const BLOCKS_GONE = [
    { where: 'Solitude', pos: [-64263, 106003.5, -8377.8], ref: 0xd6ae9 },
    { where: 'Solitude Stables', pos: [-76193.3, 96600.6, -11435], ref: 0xa9ee1 },
    { where: 'Dragon Bridge', pos: [-101780.7, 80484.5, -12522.7], ref: 0xabf83 }
  ];
  const BLOCK_FIND = 400;      // how close to the point the block has to be
  const BLOCK_NEAR = 6000;     // how close YOU have to be for it to be loaded
  const blockDone = {};        // never again this session: not ours, or it threw
  const blockChecked = {};     // base and position read once and right
  const blockTook = {};        // how many times each has been taken out
  let blockAt = 0;

  sp.on('update', guard('blocksgone', () => {
    const now = Date.now();
    if (now - blockAt < 4000) { return; }
    blockAt = now;

    let pc = null;
    try { pc = sp.Game.getPlayer(); } catch (e) { return; }
    if (!pc) { return; }
    let px = 0, py = 0, pz = 0;
    try { px = pc.getPositionX(); py = pc.getPositionY(); pz = pc.getPositionZ(); }
    catch (e) { return; }

    for (let i = 0; i < BLOCKS_GONE.length; i++) {
      if (blockDone[i]) { continue; }
      const site = BLOCKS_GONE[i];
      const dx = px - site.pos[0], dy = py - site.pos[1], dz = pz - site.pos[2];
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) > BLOCK_NEAR) { continue; }

      /*
        ASKED FOR BY FORM ID, NOT WALKED FOR. A walk of the parent cell can
        only find a block filed under the cell the person stands in, and two
        of these three are filed under a persistent cell instead. See the
        note over BLOCKS_GONE. Nothing back is an ordinary reference whose
        cell has not loaded yet, which is not a failure: it is asked for
        again in four seconds.
      */
      let ref = null;
      try { ref = sp.ObjectReference.from(sp.Game.getFormEx(site.ref)); } catch (e) { ref = null; }
      if (!ref) { continue; }

      // Checked once: the id was measured, and a load order that changes
      // what stands there must leave it alone rather than take something
      // else out of the world.
      if (!blockChecked[i]) {
        let why = '';
        try {
          const base = ref.getBaseObject();
          const id = base ? base.getFormID() : 0;
          const dx2 = ref.getPositionX() - site.pos[0];
          const dy2 = ref.getPositionY() - site.pos[1];
          const dz2 = ref.getPositionZ() - site.pos[2];
          const off = Math.sqrt(dx2 * dx2 + dy2 * dy2 + dz2 * dz2);
          if (BLOCK_BASES.indexOf(id) < 0) {
            why = 'its base is ' + id.toString(16) + ', which is not a chopping block';
          } else if (off > BLOCK_FIND) {
            why = 'it stands ' + Math.round(off) + ' units from the point';
          }
        } catch (e) {
          why = 'it could not be read: ' + e;
        }
        if (why) {
          say('left the ' + site.where + ' reference ' + site.ref.toString(16) + ' alone: ' + why);
          blockDone[i] = true;
          continue;
        }
        blockChecked[i] = true;
      }

      let gone = false;
      try { gone = ref.isDisabled(); } catch (e) { gone = false; }
      if (gone) { continue; }
      try {
        // disable answers a promise. Nothing waits on it: the block either
        // goes or it does not, and a failure is worth one line, not a stall.
        const p = ref.disable(false);
        if (p && typeof p.then === 'function') { p.then(function () { }, function () { }); }
        blockTook[i] = (blockTook[i] || 0) + 1;
        if (blockTook[i] === 1) {
          say('took the chopping block at ' + site.where + ' out of the world');
        } else {
          say('the ' + site.where + ' chopping block came back and was taken out again (' +
              blockTook[i] + ' times this session)');
        }
      } catch (e) {
        say('could not take the ' + site.where + ' chopping block out: ' + e);
        blockDone[i] = true;   // do not try it every four seconds forever
      }
    }
  }));

  /*
    ------------------------------------------- where you are standing

    Patrick, 23 September, with five screenshots: the temperature meter read
    "Fine 50" outside at night, beside a lit brazier in Whiterun, inside the
    Bannered Mare, and standing in the middle of the Bannered Mare's fire pit.
    "not any warmer when near or in fire or in a building also make so if you
    are in a fire you catch on fire", and then "yeah forges and stuff like
    that should be included too because they are hot".

    THE METER WAS NEVER BROKEN. The needs block has moved temperature toward a
    target since it was written, and /place is the command that sets the
    target. Nothing ever sent it. n.place was '' on every character, the target
    was always comfort, and the number sat on 50 for ever. A whole system that
    worked perfectly and was never asked a question.

    IT HAS TO BE THE CLIENT. Whether it is snowing on you, whether you are
    swimming, whether you are under a roof and whether there is a fire in front
    of you are facts about the machine drawing the world. The server holds a
    position and a cell descriptor and cannot answer one of them. So this
    measures them here and reports the answer the same way a fall of the axe is
    reported, over the chat socket, and the server does the rest.

    THE FIRE BASES ARE MEASURED, NOT TYPED. tools\fires.json is built by
    tools\Build-FireTable.js out of Skyrim.esm: 44 base records whose model is
    one of the fire effects or wood fires, plus the forge, skyforge, smelter
    and cooking spit markers, with the unlit versions dropped by the rule
    rather than by hand. Rebuild it with:

        node tools\Build-FireTable.js

    and tools\test-temp.js fails if this list and that file have drifted
    apart, which is the only thing keeping a hand edit here honest.
  */
  /*
    A CRAFTING STATION WARMS YOU AND DOES NOT SET YOU ON FIRE (#2259).

    Rows marked 'craft' are the forge, skyforge, smelter, kiln and cooking
    spit markers, kind "craft" in fires.json. They count for the warmth and
    never for the catch: using one seats you on it, which read as standing
    in the coals, and the Whiterun forge gave a bad burn within seconds of
    sitting down at it. tests/test-temp.js fails if these marks and the
    table's kinds drift apart, so a rebuild cannot quietly undo it.
  */
  const FIRE_BASES = [
    ['Skyrim.esm', 0x13b40],   // FXFire01
    ['Skyrim.esm', 0x13b42],   // FXFire02
    ['Skyrim.esm', 0x33da4],   // FXfireWithEmbersHeavy
    ['Skyrim.esm', 0x33da9],   // FXfireWithEmbersLight
    ['Skyrim.esm', 0x35f47],   // Campfire01LandBurning
    ['Skyrim.esm', 0x35f49],   // Campfire01Burning
    ['Skyrim.esm', 0x35f4a],   // FireplaceWood01Burning
    ['Skyrim.esm', 0x42521],   // bwcStatuePuzzleFlame
    ['Skyrim.esm', 0x4318b],   // FXfireWithEmbersLogs01
    ['Skyrim.esm', 0x48748, 'craft'],   // CraftingBlacksmithForgeSTATIC
    ['Skyrim.esm', 0x4c5ce],   // GiantCampfire01BurningSnow01
    ['Skyrim.esm', 0x4c5cf],   // GiantCampfire01BurningSnow01B
    ['Skyrim.esm', 0x51577],   // GiantCampfire01Burning
    ['Skyrim.esm', 0x68adb, 'craft'],   // CraftingCookingFireSpit
    ['Skyrim.esm', 0x90ca4],   // Campfire01LandBurning_ReachDirt01
    ['Skyrim.esm', 0x951d8],   // Campfire01LandBurningReachDirt01
    ['Skyrim.esm', 0x9c6ce, 'craft'],   // CraftingSmelterMarker1
    ['Skyrim.esm', 0xa9230],   // Campfire01LandBurning_Heavy_SN
    ['Skyrim.esm', 0xaa71c],   // FXfireWithEmbers02Toggle
    ['Skyrim.esm', 0xb6c08],   // Campfire01LandBurningPineForest01
    ['Skyrim.esm', 0xbbcf1, 'craft'],   // CraftingBlackSmithForgeSkyforge
    ['Skyrim.esm', 0xbf9e1, 'craft'],   // CraftingBlackSmithForgeWR
    ['Skyrim.esm', 0xc2bf1],   // Campfire01LandBurningCoastalBeach01
    ['Skyrim.esm', 0xc6918],   // Campfire01LandBurningFallForestDirt01
    ['Skyrim.esm', 0xcae0b, 'craft'],   // CraftingBlackSmithForge
    ['Skyrim.esm', 0xcbb23],   // Campfire01LandBurningFrozenMarshDirtSlope01
    ['Skyrim.esm', 0xcbb2f],   // Campfire01LandBurningRocks01
    ['Skyrim.esm', 0xcd823],   // FXfireWithEmbers01_lite
    ['Skyrim.esm', 0xcd824],   // FXfireWithEmbers01_Cheap
    ['Skyrim.esm', 0xd61b6],   // BFXFireVol01
    ['Skyrim.esm', 0xd61be],   // BFXFireVolCorner
    ['Skyrim.esm', 0xdb682],   // Campfire01LandBurningDirt01
    ['Skyrim.esm', 0xe7c9a],   // Campfire01LandBurningRiverBedEdge01
    ['Skyrim.esm', 0xef77f],   // BFXFireVolCornerRound
    ['Skyrim.esm', 0xf2ac6],   // BFXFireVolCornerRoundNoFloor
    ['Skyrim.esm', 0xf597f],   // GiantCampfire01BurningDirt01
    ['Skyrim.esm', 0xf6304],   // GiantCampfire01BurningDirt02Blank
    ['Skyrim.esm', 0xfb9b0],   // Campfire01LandBurningFieldGrass01
    ['Skyrim.esm', 0x101a51],   // Campfire01LandBurningTundra01
    ['Skyrim.esm', 0x106112],   // FXfireWithEmbersHeavySCALED
    ['Skyrim.esm', 0x1092e2],   // FXfireWithEmbersHeavyToggle
    ['Skyrim.esm', 0x1094ab],   // FXFireSovngarde
    ['Skyrim.esm', 0x10acc0],   // GiantCampfire01BurningNoLand
    ['Skyrim.esm', 0x10d820],   // Campfire01LandBurningCaveBaseGround02
    ['Dawnguard.esm', 0x1838f],   // DLC1VC_EmbersToggleable
    ['Dragonborn.esm', 0x18616],   // Campfire01LandBurning_SnowRocks
    ['Dragonborn.esm', 0x18619],   // Campfire01LandBurning_LDirtSnowPath
    ['Dragonborn.esm', 0x289e8],   // Campfire01LandBurning_Ash
    ['Dragonborn.esm', 0x2c0b0],   // Campfire01LandBurningDirtPath01
    ['Embers XD.esm', 0x13010e],   // GiantCampfire01BurningDirt02
    ['Embers XD.esp', 0x6a956],   // FXfireWithEmbersLight04
    ['Embers XD.esp', 0x982a3],   // FXfireWithEmbersLogs02
    ['Embers XD.esp', 0xc5bb1],   // FXfireWithEmbersLogs03
    ['Embers XD.esp', 0xe92ff],   // FXfireWithEmbersLogs04
    ['Embers XD.esp', 0x102800],   // Campfire01LandBurningCaveBaseGround01
    ['Embers XD.esp', 0x13010e],   // GiantCampfire01BurningDirt02
    ['Embers XD.esp', 0x135210],   // FXFirepit01
    ['Embers XD.esp', 0x171e23],   // Campfire01LandBurningMineFloorDirt01
    ['Embers XD.esp', 0x17c025],   // Campfire01LandBurningGrassSnow01
    ['Embers XD.esp', 0x17c026],   // FXfireWithEmbersLightSilent
    ['Embers XD.esp', 0x19f73f],   // FXfireWithEmbersLight02
    ['Embers XD.esp', 0x19f741],   // FXfireWithEmbers01_brazier
    // #608 near a forge: these editor ids do not begin with the old craft prefixes.
    ['North Keep.esp', 0x21152, 'craft'],   // CraftingNKPBlackSmithForge
    ['Dawnguard.esm', 0xf812, 'craft'],   // DLC1DawnguardCraftingBlackSmithForge
    ['Dragonborn.esm', 0x3cf6e, 'craft'],   // DLC2CraftingBlackSmithForge
    ['Dragonborn.esm', 0x2b074, 'craft'],   // DLC2CraftingBlackSmithSkaalForge
    ['Thornswood-Content.esp', 0x1547e, 'craft'],   // ThornswoodCraftingCharcoalKilnMarker
  ];
  // The plugins the list spans, for the log line when they are resolved.
  const FIRE_FILES = ["Skyrim.esm","Dawnguard.esm","Dragonborn.esm","Embers XD.esm","Embers XD.esp","North Keep.esp","Thornswood-Content.esp"];

  // Standing at a fire, and standing IN one. A campfire is about a hundred
  // units across, so 300 is warming your hands and 90 is in the coals.
  const FIRE_REACH = 300;
  const FIRE_INSIDE = 90;
  /*
    How often the world is asked. Four seconds while nothing is near, one
    second once a fire is in reach, because the second number is what decides
    whether somebody is burning and four seconds of that is four seconds of
    standing in a fire taking nothing.
  */
  const PLACE_SLOW = 4000;
  const PLACE_FAST = 1000;
  // How often the tick writes a line even when its answer has not moved. See
  // the heartbeat below: without it, a dead tick and a steady one read the
  // same in the log.
  const PLACE_BEAT = 30000;
  // How far the water can be over your feet and still be wading. A character
  // is about 128 units tall, so this is roughly waist deep.
  const WADE_DEEP = 70;
  /*
    PLACED WATER, READ OUT OF THE RECORDS (#2302).

    There used to be a feet slack of 24 here (#608): wading counted with the
    cell's water plane up to 24 units BELOW the actor's position, on the
    guess that getPositionZ is "the actor root, not a true feet probe". It
    was never measured, and the records say it could not have worked. A
    reference's position is its base, so an actor's is its feet. The Temple
    of Kynareth (CELL 165a7 in Skyrim.esm) has XCLW 0, so getWaterLevel
    answers 0 there, while its pool is a placed activator,
    Water1024ClearAnkleStill (an ACTI with a WNAM), at z 48, and nothing in
    that room stands lower than z 32. 0 minus 32 or more is never above -24.
    The cell plane and the pool are different objects, and getWaterLevel only
    knows the plane.

    So the place tick reads both: the cell plane, which counts only when it
    is above the feet, and every placed water in the cell, which the cell walk
    keeps with the fires (activator 24 is one of its four types). Each row is
    [plugin, local id, x1, y1, x2, y2]: an ACTI with a WNAM and its OBND
    footprint. scripts\dev\Build-WaterTable.js writes the line below from the
    load order; do not edit it by hand. The footprint is taken unrotated and
    unscaled, which is exact for the square WaterNNN planes Bethesda places.
  */
  const PLACED_WATERS = [["Skyrim.esm",1074089,-512,-512,512,512],["Skyrim.esm",1075745,-512,-512,512,512],["Skyrim.esm",1075749,-512,-512,512,512],["Skyrim.esm",1076822,-1024,-1024,1024,1024],["Skyrim.esm",1081285,-512,-512,512,512],["Skyrim.esm",1084157,-1024,-1024,1024,1024],["Skyrim.esm",1084161,-512,-1024,512,1024],["Skyrim.esm",1092911,-512,-512,512,512],["Skyrim.esm",1100481,-512,-512,512,512],["Skyrim.esm",1100484,-512,-512,512,512],["Skyrim.esm",1100487,-512,-512,512,512],["Skyrim.esm",1100489,-512,-512,512,512],["Skyrim.esm",1100491,-512,-512,512,512],["Skyrim.esm",1100493,-512,-512,512,512],["Skyrim.esm",1105428,-256,-764,238,582],["Skyrim.esm",1105429,-256,-764,238,582],["Skyrim.esm",1108346,-2524,-2009,781,1292],["Skyrim.esm",1108347,-2499,-2833,845,511],["Skyrim.esm",1108349,-730,-1068,737,399],["Dawnguard.esm",72882,-512,-512,512,512],["Water for ENB (Shades of Skyrim).esp",1199413,-512,-512,512,512],["Water for ENB (Shades of Skyrim).esp",1220156,-512,-512,512,512],["Water for ENB (Shades of Skyrim).esp",1220159,-512,-512,512,512],["Dawnguard.esm",84869,-512,-512,512,512],["Skyrim.esm",87080,-512,-512,512,512],["Skyrim.esm",90254,-461,-1246,401,1163],["Skyrim.esm",95913,-461,-1246,401,1163],["Skyrim.esm",95915,-1057,-360,771,1348],["Skyrim.esm",95918,-1057,-360,771,1348],["Dragonborn.esm",104986,-512,-512,512,512],["Dawnguard.esm",105623,-512,-512,512,512],["Dawnguard.esm",106658,-512,-512,512,512],["Dawnguard.esm",7191,-512,-512,512,512],["Dragonborn.esm",121793,-512,-512,512,512],["Dragonborn.esm",126667,-512,-512,512,512],["Dragonborn.esm",155877,-2048,-2048,2048,2048],["SkyrimSewers.esp",161631,-512,-1024,512,1024],["Dawnguard.esm",10545,-512,-512,512,512],["Dragonborn.esm",175592,-455,-455,455,455],["Dragonborn.esm",175594,-394,-394,394,394],["Dragonborn.esm",179924,-512,-512,512,512],["Dragonborn.esm",210968,-512,-1024,512,1024],["Dragonborn.esm",226073,-512,-512,512,512],["Skyrim.esm",230449,-1116,-176,575,1471],["Dragonborn.esm",236396,-154,-152,148,199],["Skyrim.esm",240771,-512,-512,512,512],["Dragonborn.esm",250615,-197,-218,197,176],["Skyrim.esm",269133,-631,-1675,564,364],["Dawnguard.esm",17078,-121,-117,117,118],["Dawnguard.esm",17086,-120,-120,119,120],["Skyrim.esm",333178,-63,-24,63,23],["Dawnguard.esm",20882,-512,-512,512,512],["Skyrim.esm",337728,-896,-928,928,896],["Dawnguard.esm",24847,-512,-512,512,512],["Skyrim.esm",404064,-512,-512,512,512],["Dawnguard.esm",27540,-512,-1024,512,1024],["Skyrim.esm",463813,-512,-512,512,512],["Skyrim.esm",478953,-512,-512,512,512],["Skyrim.esm",501175,-3253,-1149,0,605],["Skyrim.esm",501208,-1787,-1149,1466,605],["Skyrim.esm",501237,-1116,-176,575,1471],["Skyrim.esm",517671,-512,-512,512,512],["Water for ENB.esm",2048,-1057,-360,771,1348],["Water for ENB.esm",2049,-1057,-360,771,1348],["Water for ENB.esm",2050,-1057,-360,771,1348],["Water for ENB.esm",2051,-1057,-360,771,1348],["Water for ENB.esm",2052,-1057,-360,771,1348],["Water for ENB.esm",2053,-512,-512,512,512],["Water for ENB.esm",2054,-886,-1845,810,2163],["Water for ENB.esm",2055,-344,-1177,335,116],["Water for ENB.esm",2056,-344,-1177,335,116],["Water for ENB.esm",2057,-107,-1054,134,1],["Water for ENB.esm",2058,-344,-1177,335,135],["Water for ENB.esm",2059,-344,-1177,335,116],["Water for ENB.esm",2061,-170,-225,188,230],["Water for ENB.esm",2062,-119,-179,134,168],["Water for ENB.esm",2063,-141,-189,141,199],["Water for ENB.esm",2064,-512,-512,512,512],["Water for ENB.esm",2066,-512,-512,512,512],["Water for ENB.esm",2096,-767,-26,1481,1247],["Water for ENB.esm",2098,-512,-512,512,512],["Skyrim.esm",543981,-2521,-2042,3041,808],["Skyrim.esm",548809,-1125,-1173,1173,1125],["Skyrim.esm",548812,-724,-724,724,724],["Skyrim.esm",548866,-76,-721,154,552],["Skyrim.esm",548870,-154,-721,87,560],["Skyrim.esm",593202,-450,-274,450,274],["Skyrim.esm",598311,-120,-120,119,120],["Skyrim.esm",619134,-154,-152,148,199],["Skyrim.esm",773926,-2048,-2048,2048,2048],["Skyrim.esm",793924,-512,-512,512,512],["Skyrim.esm",837555,-512,-512,512,512],["Skyrim.esm",837557,-1024,-1024,1024,1024],["Skyrim.esm",837558,-512,-1024,512,1024],["Skyrim.esm",837560,-512,-512,512,512],["Skyrim.esm",837561,-1024,-1024,1024,1024],["Skyrim.esm",837562,-512,-1024,512,1024],["Dawnguard.esm",52593,-512,-1024,512,1024],["Skyrim.esm",858612,-512,-512,512,512],["Skyrim.esm",934358,-512,-512,512,512],["Skyrim.esm",946557,-512,-512,512,512],["Skyrim.esm",1000818,-512,-512,512,512],["Skyrim.esm",1036492,-256,-256,255,256],["Skyrim.esm",1036493,-256,-256,255,256],["Skyrim.esm",1036503,-176,-166,171,215],["Skyrim.esm",1036508,-154,-152,148,199],["Skyrim.esm",1040529,-154,-152,148,199]];
  // FireFXShader, 0001b212 in Skyrim.esm, read out of the EFSH records. This
  // is the engine's own "this thing is burning", the one fire damage uses.
  const FIRE_SHADER = 0x1b212;
  // Per second in the coals. Survivable for a few seconds, fatal if somebody
  // walks in and makes a cup of tea, which is the point. The server times each
  // fire by the /burn reports and multiplies by this same number to tell a bad
  // burn (HURT.burn.perSecond in gamemode.js, #1383): change both together.
  const BURN_PER_SECOND = 7;

  let placeAt = 0;
  let placeSaid = '';
  let placeFire = -1;

  /*
    WHAT THE FIRE PROBE ACTUALLY DID, because on 23 September it did nothing
    and said nothing.

    Patrick, in the world: "temp isnt working right or fgetting caught on fire
    and taking damage base was 51 I gotta closer and closer to the fire until I
    was standing in it and it stayed the same temp the whole time."

    MEASURED from that session's plugin log. The place tick wrote ONE line, at
    10:20:38, and not another in the ninety seconds after it, while the input
    pulse next to it kept writing every five seconds. So the tick was alive and
    the line it composes never changed, which means the fire distance stayed at
    nothing while he walked into a fire.

    AND NOTHING SAID WHY, because fireDistance swallows every error per base:
    forty four bases that all throw and forty four bases that all resolve and
    find nothing produce the same silent -1. That is the fault this block is
    here to close. The numbers below are counted on every probe and written
    into the heartbeat line, so one session answers which of the two it is and
    what the error was if it is the first.
  */
  let fireBases = 0;      // how many of them resolved to a form at all
  let fireHits = 0;       // how many fires of ours are in this cell
  let fireThrew = 0;      // how many threw
  let fireWhy = '';       // the first thing one of them threw
  let fireWalked = 0;     // how many things in the cell were looked at
  /*
    WHAT THE CELL SAID ABOUT WATER, for the heartbeat line.

    Patrick, 23 September: "Stood in the water in the temple in Whiterun temp
    stayed the same". The client reported `indoors` the whole time he was in
    it, so the server was never told about any water and behaved correctly on
    what it was told.

    Wading is the cell's water level against where somebody is standing, and
    that is the only thing Skyrim Platform exposes: an Actor has isSwimming
    and a Cell has getWaterLevel, and there is no submerged depth and no
    is-in-water anywhere in the API. So either that pool's cell answers a
    level nowhere near his feet, or it answers nothing at all, and those are
    different problems with different answers. Neither can be told apart from
    out here, so the numbers go in the line.
  */
  let waterSaid = '';
  /*
    The placed waters of PLACED_WATERS, by runtime id: id -> [x1, y1, x2, y2].
    Resolved once, the way the fire bases are, by the walk's own slice.
    waterHere is the walk's list of them in this cell, [x, y, z, id] each.
  */
  let waterBox = null;
  let waterHere = null;
  let walkWant = null;      // fires and placed waters together, for the walk
  let fireCell = -1;      // the cell the list below was made for
  let fireHere = null;    // where the fires in it are
  let placeBeat = 0;      // when the heartbeat last wrote

  /*
    THE IDS, RESOLVED ONCE. NOT THE FORMS.

    A fire from a mod cannot be reached by the id written in the plugin,
    because a runtime id carries the plugin's place in the load order and
    that moves whenever anybody adds a mod. Game.getFormFromFile is the
    engine's own answer: the file and the id inside it, which do not move.
    Skyrim.esm is index 00 always, so those go the direct way and it is the
    same call underneath.

    A FORM DOES NOT SURVIVE THE FRAME IT WAS MADE IN, and the first version of
    this kept the 62 Form objects for the session because "the answer cannot
    change inside a session". The answer does not; the wrapper does.
    SkyrimPlatform hands out native objects from a pool that it rolls over,
    and one kept past its frame throws on the next use:

      SP3NativeValueCasts::JsObjectToNativeObject - Invalid
      _skyrimPlatform_indexInPool: 109, expected to be in [5201, 5212) range

    Every one of the 62 threw that, on every probe, for the whole of
    23 September. The heartbeat line read "62 bases, 0 in reach, 62 threw"
    and that is the only reason it was found rather than guessed at again:
    fireDistance swallows errors per base, so 62 that throw and 62 that find
    nothing both come out as no fire. WHAT IT COST: no warmth from any fire,
    so the temperature never moved whether you were across the room or
    standing in the coals, and nobody ever caught fire either, because both
    read the same distance.

    So what is kept is the runtime id, which is a number and keeps perfectly,
    and the form is asked for again in the frame it is used in. That is one
    extra call per base per probe, and the probe already makes one.
  */
  let fireIds = null;
  let fireWant = null;      // the same ids as a set, for the walk
  /*
    Resolved a slice at a time as well (#976): sixty odd lookups in one frame
    is its own hitch. fireIdAt is how far through FIRE_BASES the resolving
    has got and fireIdOut what it has found so far.

    ONE PASS, AND ITS ANSWER STANDS (#2590, 16 Oct). Only the walk resolves,
    and the walk starts only once somebody stands in a cell. Skyrim reads
    every plugin's records before its main menu, so by then each base either
    exists or never will this session: there is nothing for a second pass to
    wait for. The pass that found nothing used to be asked again every
    FIRE_IDS_RETRY (4 s), in case "the world" was "not up yet"; nothing was
    ever measured behind that, and both sessions in the front logs on One
    (5 and 15 Oct) resolved 67 of 67 on the first pass. A pass that finds
    none now says so once, with the first error, and the probe stands down
    for the session rather than asking again.
  */
  let fireIdAt = 0;
  let fireIdOut = [];

  /**
   * Resolves PLACED_WATERS into waterBox, all at once: the table is a handful
   * of rows, and a row that does not resolve is a plugin not in this load
   * order, which is no water to find.
   */
  function resolveWaterIds() {
    waterBox = {};
    for (let i = 0; i < PLACED_WATERS.length; i++) {
      const row = PLACED_WATERS[i];
      try {
        const raw = (row[0] === 'Skyrim.esm')
          ? sp.Game.getFormEx(row[1])
          : sp.Game.getFormFromFile(row[1], row[0]);
        const base = sp.Form.from(raw);
        const id = base ? base.getFormID() : 0;
        if (id) { waterBox[id] = [row[2], row[3], row[4], row[5]]; }
      } catch (e) { }
    }
    return waterBox;
  }

  /**
   * The placed water somebody at (px, py, pz) is wading in, as
   * { id, top, deep }, or null. Wading is inside the water's footprint with
   * its surface above the feet and under WADE_DEEP over them.
   */
  function placedWaterAt(px, py, pz, waters, deepest) {
    let best = null;
    for (let i = 0; i < waters.length; i++) {
      const w = waters[i];
      const box = waterBox && waterBox[w[3]];
      if (!box) { continue; }
      if (px < w[0] + box[0] || px > w[0] + box[2] ||
          py < w[1] + box[1] || py > w[1] + box[3]) { continue; }
      const deep = w[2] - pz;
      if (deep > 0 && deep < deepest && (!best || deep < best.deep)) {
        best = { id: w[3], top: w[2], deep: deep };
      }
    }
    return best;
  }

  /** The runtime ids of FIRE_BASES, or [] until the walk has resolved them. */
  function fireIdList() {
    return fireIds || [];
  }

  /**
   * Resolves the next of FIRE_BASES, as many as fit in FIRE_SLICE_MS from
   * `from`, and at least one. Only the walk calls it, as part of its slice.
   * Returns the ids once every base has been asked for, [] until then.
   */
  function resolveFireIds(from) {
    if (fireIds) { return fireIds; }
    let did = 0;
    while (fireIdAt < FIRE_BASES.length) {
      if (did > 0 && sliceNow() - from >= FIRE_SLICE_MS) { return []; }
      const file = FIRE_BASES[fireIdAt][0];
      const local = FIRE_BASES[fireIdAt][1];
      fireIdAt++;
      did++;
      try {
        const raw = (file === 'Skyrim.esm')
          ? sp.Game.getFormEx(local)
          : sp.Game.getFormFromFile(local, file);
        const base = sp.Form.from(raw);
        // Read here, in the frame the form was made in, which is the only
        // place it can be read.
        if (base) {
          const id = base.getFormID();
          if (id) { fireIdOut.push(id); if (FIRE_BASES[fireIdAt - 1][2] === 'craft') { fireCraft[id] = true; } }
        }
      } catch (e) {
        if (!fireWhy) { fireWhy = String((e && e.message) || e); }
      }
    }
    const out = fireIdOut;
    fireIdAt = 0;
    fireIdOut = [];
    fireIds = out;
    fireWant = {};
    for (let i = 0; i < out.length; i++) { fireWant[out[i]] = true; }
    log('fires: ' + out.length + ' of ' + FIRE_BASES.length +
        ' bases resolved, across ' + FIRE_FILES.length + ' plugin(s)' +
        (out.length ? '' : ', so no fire warms or burns anybody this session' +
          (fireWhy ? '; the first one threw: ' + fireWhy : '')));
    return fireIds;
  }

  /*
    THE FIRES IN THIS CELL, WALKED ONCE.

    THE ENGINE CALL THIS REPLACES FINDS PERSISTENT REFERENCES ONLY, and a
    fire is almost never one. Game.findClosestReferenceOfType answered null
    for all 62 bases everywhere: standing in the Bannered Mare's own fire
    pit, standing in its cooking fire, standing in the brazier outside it,
    standing in a fire bowl on a farm. The probe read "62 bases, 0 in reach,
    0 threw" through all of it, which is the call working exactly as
    documented and being the wrong call: the FX fire placed in an inn is a
    temporary reference in that cell, and those functions do not see one.
    That is why nothing ever warmed anybody, and no amount of fixing the
    table would have changed it.

    Cell.getNumRefs and getNthRef see everything in the cell, temporary
    included, so the cell is walked once and the fires in it are kept with
    their positions. A fire does not move, so the list is good until the cell
    changes, and every probe after that is a handful of subtractions instead
    of sixty two native calls.

    FOUR FORM TYPES, WHICH ARE THE FOUR THE TABLE IS BUILT FROM: activator
    24, static 34, movable static 36 and furniture 42. Filtering costs
    nothing and walking every reference in an exterior cell costs a great
    deal.
  */
  /*
    WHEN A WALK IS BELIEVED: ONCE THE CELL HAS SAID IT IS IN (#2590).

    A cell is walked when somebody first stands in it. If it has not finished
    loading by then, the walk can miss what is still coming in, so when the
    engine says the cell underfoot is fully loaded (cellFullyLoaded, the event
    behind Papyrus's OnCellLoad, "every object in this cell is loaded and
    ready") it is walked again, and that walk's list is kept for the stay,
    empty or not. A cell that had finished loading before anybody stood in it
    (an exterior cell loads with the grid around you, ahead of you) sends
    nothing more, and its first walk is the one kept.

    This replaces a retry on a clock. #608 (27 Sep) kept a full list for the
    cell and walked an empty one again every FIRE_EMPTY_RETRY (8 s) for as
    long as it stayed empty, against "bases not resolved yet, cell not fully
    loaded, or a forge room whose FX had not appeared", none of it measured.
    What the front logs on One show (5 and 15 Oct): the first walk of the
    race menu room looked at 49 things and the ones 11 s later at 58, so a
    walk does run before a cell is in; and every walk of a cell already
    walked found as many fires as the first one had (five walks of one room
    found 0 each time, two of an exterior cell 0, and others 4 and 4, 11 and
    11, 6 and 6). The retry only ever walked empty rooms again, and a full
    list from a walk run too soon was never redone at all.
  */
  // The walk under way, { cell, t, i, n, walked, out }, or null. See
  // walkCellSlice. The 'fire walk' handler below the place tick carries it on
  // a slice a frame; the place tick reads whatever list is finished. While a
  // cell is walked again, the list from its first walk stands until the new
  // one is done.
  let fireWalk = null;

  function newFireWalk(cellId) {
    return { cell: cellId, t: 0, i: 0, n: -1, walked: 0, out: [] };
  }

  function fireSpotsHere(pc) {
    let cellId = 0;
    let cell = null;
    try {
      cell = pc.getParentCell();
      cellId = cell ? cell.getFormID() : 0;
    } catch (e) { cellId = 0; }
    if (cellId !== fireCell) { fireCell = cellId; fireHere = null; waterHere = null; fireWalk = null; }
    if (!cell) { return []; }

    // Start the cell's walk, or carry the one under way on by a slice, and
    // answer with what is known now: nothing until the first walk is done,
    // which is a few frames in a busy cell.
    if (!fireHere && !fireWalk) { fireWalk = newFireWalk(cellId); }
    if (fireWalk) { fireWalkStep(cell); }
    return fireHere || [];
  }

  /** One slice of the walk under way, in `cell`, the cell it was started in. */
  function fireWalkStep(cell) {
    const w = fireWalk;
    if (!w) { return; }
    // One slice for both: resolving the bases first while they are not all
    // in, then the walk with whatever time is left of it.
    const began = sliceNow();
    if (!fireIds) {
      resolveFireIds(began);
      if (!fireIds) { return; }
    }
    if (!waterBox) { resolveWaterIds(); }
    fireBases = fireIds.length;
    // No base resolved: there is nothing to look for in any cell.
    if (!fireIds.length && !Object.keys(waterBox).length) {
      fireWalk = null; fireHere = []; waterHere = []; fireHits = 0; return;
    }
    if (!walkWant) {
      walkWant = {};
      for (const k in fireWant) { walkWant[k] = true; }
      for (const k in waterBox) { walkWant[k] = true; }
    }
    const done = walkCellSlice(cell, w, walkWant, function (e) {
      fireThrew++;
      if (!fireWhy) { fireWhy = String((e && e.message) || e); }
    }, began);
    fireWalked = w.walked;
    if (!done) { return; }

    fireWalk = null;
    fireHere = w.out.filter(function (p) { return !!fireWant[p[3]]; });
    waterHere = w.out.filter(function (p) { return !!waterBox[p[3]]; });
    fireHits = fireHere.length;
    // fireWalked, not walked: naming the walk's own counter here threw on
    // every cell change from #184 on, 80 times in the dev log of 23
    // September, and the place report for that tick never went.
    log('fires: ' + fireHere.length + ' of ours in this cell, out of ' + fireWalked +
        ' thing(s) looked at' +
        (waterHere.length ? ', and ' + waterHere.length + ' placed water(s)' : ''));
  }

  /**
   * The 'fire walk' handler: a walk under way goes on by one slice a frame
   * until it is done. Nothing to do costs one comparison. A walk whose cell
   * is no longer the one underfoot is dropped; the place tick starts the
   * next one for the cell somebody is in now.
   */
  function fireWalkTick() {
    if (!fireWalk) { return; }
    let cell = null;
    try {
      const pc = sp.Game.getPlayer();
      cell = pc ? pc.getParentCell() : null;
      if (!cell || cell.getFormID() !== fireWalk.cell) { fireWalk = null; return; }
    } catch (e) { fireWalk = null; return; }
    fireWalkStep(cell);
  }

  /**
   * The 'fire cell loaded' handler, on cellFullyLoaded. Only the cell
   * somebody is standing in, and only once it has been walked or is being
   * walked: a cell that finishes loading before anybody stands in it is
   * walked whole when they do. The line says what the walk before it had
   * seen, so the log shows what loading late cost.
   */
  function fireCellLoaded(event) {
    let id = 0;
    try { id = (event && event.cell) ? event.cell.getFormID() : 0; } catch (e) { id = 0; }
    if (!id || id !== fireCell) { return; }
    log('fires: cell ' + id.toString(16) + ' finished loading after it was walked (' +
        (fireHere ? fireHere.length + ' of ours, out of ' + fireWalked + ' thing(s) looked at'
                  : 'that walk was not done, at ' + fireWalked + ' thing(s)') +
        '), so it is walked again');
    fireWalk = newFireWalk(id);
  }

  // Runtime ids of the 'craft' rows: warmth only, never the catch (#2259).
  const fireCraft = {};
  // The nearest lit fire that is not a crafting station, set by fireDistance.
  let fireFlame = -1;

  /** The nearest spot in reach, or `best`; fireFlame gets the nearest that is no station. */
  function fireNearest(px, py, pz, spots, best) {
    for (let i = 0; i < spots.length; i++) {
      const dx = spots[i][0] - px;
      const dy = spots[i][1] - py;
      const dz = spots[i][2] - pz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > FIRE_REACH) { continue; }
      if (best < 0 || dist < best) { best = dist; }
      if (!fireCraft[spots[i][3]] && (fireFlame < 0 || dist < fireFlame)) { fireFlame = dist; }
    }
    return best;
  }

  /** How far the nearest lit fire is, or -1 when there is none in reach. */
  function fireDistance(px, py, pz, pc) {
    /*
      USING A FORGE (OR SMELTER, OR COOKING SPIT) IS STANDING IN THE HEAT.

      The craft markers in FIRE_BASES are furniture. Activating one seats you
      on that reference; the visual flames may sit a little off the marker, or
      Embers may have swapped the FX for a base we do not list. Either way the
      person at the anvil is in the forge. #608: chilly in a burning forge,
      and it never set anybody on fire. getFurnitureReference is the engine's
      own answer for which station you are at.
    */
    fireFlame = -1;
    try {
      const furn = pc.getFurnitureReference ? pc.getFurnitureReference() : null;
      if (furn) {
        const b = furn.getBaseObject();
        const id = b ? b.getFormID() : 0;
        if (id) {
          const ids = fireIdList();
          for (let f = 0; f < ids.length; f++) {
            if (ids[f] === id) { return fireNearest(px, py, pz, fireSpotsHere(pc), 0); }
          }
        }
      }
    } catch (e) { }
    return fireNearest(px, py, pz, fireSpotsHere(pc), -1);
  }

  sp.on('update', guard('race read', raceReadTick));

  // The fire probe's cell walk, a slice a frame (#976). See walkCellSlice.
  sp.on('update', guard('fire walk', fireWalkTick));
  // The cell underfoot finished loading after its walk: walk it again (#2590).
  sp.on('cellFullyLoaded', guard('fire cell loaded', fireCellLoaded));

  sp.on('update', guard('place', () => {
    const now = Date.now();
    // Fast only when a fire is close enough to be about to burn somebody.
    // Merely standing at one is 44 native calls a second for nothing.
    const close = placeFire >= 0 && placeFire <= FIRE_INSIDE * 2;
    if (now - placeAt < (close ? PLACE_FAST : PLACE_SLOW)) { return; }
    placeAt = now;

    let pc = null;
    try { pc = sp.Game.getPlayer(); } catch (e) { return; }
    if (!pc) { return; }
    let px = 0, py = 0, pz = 0;
    try { px = pc.getPositionX(); py = pc.getPositionY(); pz = pc.getPositionZ(); }
    catch (e) { return; }

    let swimming = false;
    try { swimming = !!pc.isSwimming(); } catch (e) { }
    let indoors = false;
    let wading = false;
    try {
      const cell = pc.getParentCell();
      if (cell) {
        indoors = !!cell.isInterior();
        /*
          WADING IS NOT SWIMMING, and Patrick asked for the difference by
          name: "different temperatures for different water types like ice,
          galciers, fresh water, shallow, etc".

          isSwimming only answers once somebody's feet have left the bottom.
          Standing knee deep in a river in the Pale reads as dry land to it,
          which is the wrong answer in the one situation people are actually
          in most of the time. Water above their feet and below swimming is
          wading, and there are two kinds of water (#2302): the cell's own
          plane, and the placed waters the cell walk keeps (PLACED_WATERS).
          pz is the actor's position, which is its feet.

          A cell with no water answers a level far below anywhere anybody
          stands, so the subtraction comes out negative and the plane stays
          dry without needing to ask whether there is water at all.
        */
        fireSpotsHere(pc);
        const placed = placedWaterAt(px, py, pz, waterHere || [], WADE_DEEP);
        const level = cell.getWaterLevel();
        let planeSaid = 'the cell has no readable water level';
        if (isFinite(level)) {
          const deep = level - pz;
          wading = deep > 0 && deep < WADE_DEEP;
          planeSaid = 'water level ' + Math.round(level) + ', feet at ' +
                      Math.round(pz) + ', so ' + Math.round(deep) + ' deep';
        }
        if (placed) {
          wading = true;
          waterSaid = planeSaid + ', wading in placed water ' +
                      placed.id.toString(16) + ', surface at ' +
                      Math.round(placed.top) + ', ' + Math.round(placed.deep) + ' deep';
        } else {
          waterSaid = planeSaid + (wading ? ', wading' : (isFinite(level) ? ', dry' : ''));
        }
      }
    } catch (e) { }
    let sky = 0;
    let skyId = 0;
    try {
      const w = sp.Weather.getCurrentWeather();
      if (w) { sky = w.getClassification(); skyId = w.getFormID(); }
    } catch (e) { }

    /*
      THE REST OF THE WEATHER, AND THE REST OF THE PLACE.

      Patrick, 23 September: "the temp should also account for wind and all
      other weather reelated and environment factors".

      WIND IS NOT ON THE WEATHER OBJECT. Weather.pex has getWindDirection and
      getWindDirectionRange and no speed at all, so the only way to know how
      hard it is blowing is the WTHR record, which is on the server in
      tools\weather.json. So the weather's form id goes over with everything
      else and the server looks it up.

      NIGHT is what is on the sky, not GameDaysPassed.

      Patrick / Discord close-out #841: day and night for warmth must match
      what people see. SkyMP's TimeService drives the sky from the GameHour
      global (form 0x38), set from UTC (plus optional hoursOffset) every two
      seconds. Utility.getCurrentGameTime reads GameDaysPassed instead, and
      TimeService never writes that global, so the fractional day can say
      afternoon while the sky is night (or the other way). Warmth then cooled
      people in daylight or skipped the night bite when it was dark.

      So night is GameHour itself: under 6 or at/after 20, the same cut the
      old clock used, but against the value that paints the sky.

      HEIGHT is the one environment factor that needs nothing but a number
      already in hand. The tundra sits near zero, High Hrothgar is above
      twelve thousand and the Throat of the World is past twenty five, and
      being up there should feel like being up there.
    */
    let night = 0;
    try {
      // GameHour 0x38: same global TimeService writes for the sky (#841).
      const gh = sp.GlobalVariable.from(sp.Game.getFormEx(0x38));
      const hour = gh ? gh.getValue() : 12;
      night = (hour < 6 || hour >= 20) ? 1 : 0;
    } catch (e) { }
    // Asking is 44 native calls, and nobody in the water is at a fire.
    fireFlame = -1;
    const fire = swimming ? -1 : fireDistance(px, py, pz, pc);
    placeFire = fire;

    /*
      ONE WORD, IN ORDER OF WHAT WINS.

      Water first, because being in it beats everything else about a place.
      Then fire, which beats a roof: the point of the Bannered Mare is the fire
      in the middle of it. Then the roof, then the weather, and outdoors last,
      which is slightly cool rather than neutral so that walking into a
      building is felt. Everything the server does not know a word for is
      comfortable, so a client from before this says nothing and its owner
      simply has no weather.
    */
    let kind = 'outdoors';
    if (swimming) { kind = 'water'; }
    else if (wading) { kind = 'shallow'; }
    else if (indoors) { kind = 'indoors'; }
    else if (sky === 3) { kind = 'snow'; }
    else if (sky === 2) { kind = 'rain'; }

    /*
      ONE LINE, AND IT IS SENT WHEN ANY OF IT CHANGES.

      kind, the weather's form id, night, whether there is a roof, the height,
      and how far the nearest fire is. The server has a number for all of it;
      a client that sends only the word still works, because everything after
      the first is optional on that end.

      THE FIRE IS A DISTANCE AND NOT A WORD, which is Patrick, 23 September:
      "temperature should be relative too so like if I am further away or
      closer to a fire it slowly rises and lowers as I walk away from the
      fire". It used to be one of the words up there and it beat every other
      one, so a campfire in a blizzard was worth the same as an inn hearth and
      one pace back turned it off like a switch. Now it is added on top of
      wherever you already are, tapering to nothing at reach.

      EVERYTHING IS ROUNDED AND THE WHOLE LINE IS COMPARED AS A STRING, which
      is what stops this sending a line every second. The height goes to the
      nearest five hundred and the fire to the nearest twenty five, so walking
      up to a hearth is about a dozen lines and standing at it is none.
    */
    const line = '/place ' + kind + ' ' + (skyId ? skyId.toString(16) : '-') +
                 ' ' + night + ' ' + (indoors ? 1 : 0) +
                 ' ' + Math.round(pz / 500) * 500 +
                 ' ' + (fire >= 0 ? Math.round(fire / 25) * 25 : '-');
    if (line !== placeSaid) {
      placeSaid = line;
      tellServer(line);
      say('standing in ' + kind + (fire >= 0 ? ', fire ' + Math.round(fire) + ' away' : '') +
          (night ? ', at night' : '') + (indoors ? ', under a roof' : ''));
      placeBeat = now;
    }
    else if (now - placeBeat >= PLACE_BEAT) {
      /*
        A LINE EVEN WHEN NOTHING CHANGED, once every half minute.

        Without this, a tick that has stopped and a tick whose answer never
        changes look identical in the log, and on 23 September that cost a
        whole session: one line at 10:20:38 and nothing after it, with no way
        to tell which had happened.

        It carries what the fire probe did, because that is the part that was
        silent. 44 resolved, 0 hits means the bases are fine and there is
        genuinely no fire of ours in reach, which points at the list. Anything
        in threw means the probe itself is broken and the reason is printed.
        And whatever the crosshair is on is named, so walking up to a fire and
        looking at it says what that fire actually is, which is the one thing
        nobody could find out from here.
      */
      placeBeat = now;
      let looking = '';
      try {
        const at = sp.Game.getCurrentCrosshairRef();
        if (at) {
          const b = at.getBaseObject();
          looking = ', looking at ' + (b ? ('base ' + b.getFormID().toString(16) +
                    ' "' + (b.getName() || '') + '"') : 'something with no base');
        }
      } catch (e) { }
      say('place: ' + line + '  [fire probe: ' + fireBases + ' bases, ' + fireHits +
          ' in this cell of ' + fireWalked + ' looked at, ' + fireThrew + ' threw' +
          (fireWhy ? ' (' + fireWhy + ')' : '') + ']' +
          (waterSaid ? '  [' + waterSaid + ']' : '') + looking);
    }

    /*
      AND IF YOU ARE STANDING IN IT, YOU BURN.

      Patrick: "make so if you are in a fire you catch on fire". Vanilla
      Skyrim does not do this. The Bannered Mare's fire pit is set dressing and
      you can stand in the coals all night, which is what the fifth screenshot
      is: a character up to his knees in a fire, reading Fine 50.

      Done here rather than on the server because the server cannot see the
      fire and because damage belongs on the machine that is drawing it.
      DamageActorValue is the engine's own call and goes through everything
      health normally goes through.
    */
    if (fireFlame >= 0 && fireFlame <= FIRE_INSIDE) {
      if (burnUntil < now) { note('you are standing in the fire'); }
      // Refreshed rather than set, so walking out of the coals lets it go
      // within about a second instead of burning for the full catch.
      burnUntil = Math.max(burnUntil, now + 1500);
    }
  }));

  /*
    ---------------------------------------------------- burning, and catching

    Patrick, 23 September: "make so if you are in a fire you catch on fire",
    and then "when people catch fire it should be able to spread to other
    people if they ade close enough".

    ONE CLOCK, TWO WAYS TO START IT. Standing in the coals refreshes it every
    beat of the place tick. The server sets it through the thornswoodBurn
    property when somebody alight is standing next to you, because the server
    is the only end that knows where everybody is. Both write the same
    burnUntil, so there is no argument about which of them gets to put it out.

    AND IT REPORTS ITSELF, because the spreading is the server's half and it
    cannot see a fire. One line when it starts and one when it stops, over the
    chat socket, the same channel a fall of the axe goes down.
  */
  const BURN_TICK = 1000;
  // The server lets go of somebody who stops reporting after three of its own
  // beats, so this has to say so again while it is still alight. Every three
  // seconds rather than every one, because it goes down the chat socket.
  const BURN_REPORT = 3000;
  let burnUntil = 0;
  let burnTold = false;
  let burnAt = 0;
  // When the flames were last put back on. See the burning tick.
  let burnFxAt = 0;
  const BURN_FX_EVERY = 3000;
  let burnSaidAt = 0;

  // The hook the gamemode's property script calls. On the global on purpose:
  // an updateOwner script is evaluated in its own scope and this is the only
  // thing the two of them share.
  try {
    globalThis.thornswoodCatchFire = function (ms) {
      const add = Number(ms) || 5000;
      burnUntil = Math.max(burnUntil, Date.now() + add);
    };
  } catch (e) { }

  sp.on('update', guard('burning', () => {
    const now = Date.now();
    if (now - burnAt < BURN_TICK) { return; }
    burnAt = now;

    const alight = burnUntil > now;
    if (alight === burnTold && !alight) { return; }

    let pc = null;
    try { pc = sp.Game.getPlayer(); } catch (e) { return; }
    if (!pc) { return; }

    if (alight) {
      try { pc.damageActorValue('Health', BURN_PER_SECOND); } catch (e) { }
      /*
        THE FLAMES ARE PUT BACK ON, over and over, for as long as it burns.

        Patrick, 23 September: "when I am on fire the fire on me goes away
        after awhile even if I am still in the fire but OI still correctly
        keep taking damage its just visibly wrong though".

        An effect shader is played once and runs for as long as the shader
        itself says, which is a few seconds: it was written for a spell
        landing on somebody, not for standing in a fire pit. Playing it once
        when the burning started meant the flames ran out while the burning
        carried on, so the one thing on screen telling somebody they are on
        fire stopped while the damage did not.

        So it is played again every BURN_FX_EVERY while they are alight.
        Playing a shader that is already running on the same target is what
        the engine does to itself constantly; it does not stack into anything.
      */
      if (!burnTold || (now - burnFxAt) >= BURN_FX_EVERY) {
        burnFxAt = now;
        try {
          const shader = sp.EffectShader.from(sp.Game.getFormEx(FIRE_SHADER));
          if (shader) { shader.play(pc, 0); }
        } catch (e) { }
      }
      if (!burnTold) {
        burnTold = true;
        note('you have caught fire');
      }
      if (now - burnSaidAt >= BURN_REPORT) {
        burnSaidAt = now;
        tellServer('/burn 1');
      }
      return;
    }

    burnTold = false;
    burnSaidAt = 0;
    burnFxAt = 0;
    try {
      const shader = sp.EffectShader.from(sp.Game.getFormEx(FIRE_SHADER));
      if (shader) { shader.stop(pc); }
    } catch (e) { }
    tellServer('/burn 0');
    note('the fire is out');
  }));

  /*
    ------------------------------------------ who you are looking at

    Patrick, 22 September: "when you look at someone, you are prompted to
    press buttons: one for friend, one for trade, and one for mute. Currently
    the looking at people doesnt have the trade menu and when it did you had
    to use youyr cursor and a bunch of other bs I just want to press a key
    while looking at them."

    THE CROSSHAIR HAS ALWAYS BEEN AVAILABLE AND WAS NEVER USED. Skyrim
    Platform exposes Game.getCurrentCrosshairRef and a crosshairRefChanged
    event, and before today neither appeared anywhere in this repo. That is
    the whole reason the old trade menu needed a mouse: nothing was asking the
    game what was under the crosshair.

    WHAT THE CLIENT CANNOT ANSWER. A crosshair reference is a form id. It does
    not say whether that is a person, a bandit or a barrel, and it carries no
    profile and no name that the server would recognise. So the server
    publishes who is near you, form id to name, on the thornswoodNear
    property, and this matches against it. Anything not in that list draws no
    prompt at all, which is why looking at a chicken does nothing.

    POLLED RATHER THAN EVENT DRIVEN, deliberately. crosshairRefChanged exists,
    but the prompt also has to redraw when the SERVER's picture changes: a
    friend request accepted while you are still looking at somebody should
    turn "Add friend" into "Remove friend" without them stepping out of your
    crosshair and back into it. One poll answers both and costs one native
    call every third of a second.
  */
  const NEAR_EVERY = 320;
  let nearAt = 0;
  let lookingAt = '';      // the form id hex the prompt is currently drawn for
  let lookingSig = '';     // what the prompt says, so it is not redrawn per poll

  function nearList() {
    try {
      const w = globalThis.thornswoodNear;
      return (w && typeof w === 'object') ? w : null;
    } catch (e) { return null; }
  }

  /** Draw or clear the little panel that names them and the three keys. */
  function drawPrompt(row) {
    const sig = row ? (row.n + '|' + row.f + '|' + row.m + '|' + row.y + '|' + (row.s || 0) + '|' + (row.c || '') +
                       '|' + (row.d || 0) + '|' + (row.a ? JSON.stringify(row.a) : '') + '|' + (row.hd || 0) +
                       '|' + (row.t || 0)) : '';
    if (sig === lookingSig) { return; }
    lookingSig = sig;
    if (!row) {
      T.js('try{var d=document.getElementById("ts-look");if(d){d.style.display="none";}}catch(e){}');
      return;
    }
    /*
      Built here and handed over as one string, the same as the HUD. The page
      is never asked to have a function for it, so an overlay from before this
      existed still draws it.
    */
    const keyRow = function (key, what, on) {
      return '<div style="margin-top:7px;white-space:nowrap">' +
             '<span style="display:inline-block;min-width:34px;text-align:center;' +
             'border:2px solid rgba(217,171,82,.75);border-radius:6px;padding:2px 7px;' +
             'margin-right:12px;color:#d9ab52;font-family:Georgia,serif">' + key + '</span>' +
             '<span style="color:' + (on ? '#8fb85e' : '#efe4cc') + '">' + what + '</span></div>';
    };
    const html =
      '<div style="font-size:26px;color:#efe4cc;margin-bottom:4px">' + row.n +
      (row.y ? '<span style="color:#8fb85e;font-size:18px"> &middot; your party</span>' : '') +
      '</div>' +
      /*
        A scar they agreed to (#1383): injury.md, "a line other people can be
        told when they look at you". The server writes it with no markup in
        it, and nothing that could be markup is let through here either.
      */
      (row.c ? '<div style="font-size:16px;font-style:italic;color:#c9b99a;margin-bottom:4px;' +
               'max-width:420px;white-space:normal">' + String(row.c).replace(/[<>&"]/g, '') + '</div>' : '') +
      keyRow(FRIEND_NAME, row.f ? 'Remove friend' : 'Add friend', !!row.f) +
      keyRow(TRADE_NAME, 'Trade', false) +
      keyRow(MUTE_NAME, row.m ? 'Unmute' : 'Mute', !!row.m) +
      keyRow(PARTY_NAME, row.y ? 'Party menu' : 'Ask to party', !!row.y) +
      // Only for a holder looking at somebody inside a building they hold:
      // the server's near list says so (#1603). See sleepPress.
      (row.s ? keyRow(SLEEP_NAME, row.s === 2 ? 'Stop letting sleep here' : 'Let sleep here',
                      row.s === 2) : '') +
      // Only while you carry a letter for them: the near list's d (#1595).
      // See deliverPress.
      (row.d ? keyRow(deliverName(), 'Hand over the letter', false) : '') +
      // Only for a Master looking at somebody they could take on: the
      // server's near list says so, with the halves (#1634). See
      // apprenticePress.
      (Array.isArray(row.a) && row.a.length ? keyRow(APPRENTICE_NAME, 'Take on as apprentice', false) : '') +
      // Only while you carry a hair dye, and the key is not Take on's: the
      // near list's hd (#2675). See hairDyePress.
      (row.hd && !(Array.isArray(row.a) && row.a.length) ? keyRow(HAIR_DYE_NAME, 'Dye their hair', false) : '') +
      // Only while they have a wound somebody could tend: the near list's t
      // (#1383). See treatPress.
      (row.t ? keyRow(TREAT_NAME, 'Tend their wounds', false) : '');

    T.js('(function(){try{' +
         'var d=document.getElementById("ts-look");' +
         'if(!d){d=document.createElement("div");d.id="ts-look";' +
         'd.style.cssText=' + JSON.stringify(LOOK_CSS) + ';' +
         'document.body.appendChild(d);}' +
         'd.innerHTML=' + JSON.stringify(html) + ';' +
         'd.style.display="";' +
         '}catch(e){}})();');
  }

  /*
    Right of centre and a little below the crosshair, which is where Skyrim
    puts its own activate prompt and is where an eye already is. Never over
    the crosshair itself: a panel you cannot see past is worse than no panel.

    BENEATH OUR PANELS (#1739). It stood at 2147483400, above every panel
    (2147483000 to 2147483300), so a panel opened while somebody was under
    the crosshair had the prompt drawn on top of it. It sits with the key
    mold line now, under all of them, and it is taken down while any of them
    is open (see lookCoveredBy).
  */
  const LOOK_CSS =
    'position:fixed;left:54%;top:46%;z-index:2147482900;pointer-events:none;' +
    'font-family:Georgia,serif;font-size:19px;letter-spacing:.03em;' +
    'background:rgba(12,10,8,.62);border:2px solid rgba(0,0,0,.65);' +
    'border-radius:9px;padding:11px 16px 14px;' +
    'text-shadow:0 2px 4px rgba(0,0,0,.95)';

  /*
    NEVER OVER A MENU OR A PANEL (#1739). A tester, on dev and main: the
    panel that names who you look at "doesn't disappear when opening other
    menus and things, and it gets in the way". The crosshair poll below drew
    it from two things only, the crosshair and the server's near list, and
    asked nothing about what else was on screen. Skyrim keeps the same
    reference under the crosshair while one of its menus is up, so the
    prompt stayed drawn over the inventory, the magic menu, the map, the
    Tab menu, a container, a trader's barter, a book, the favourites on Q
    and every other menu in KEYBOARD_MENUS; and over our own panels (K, P,
    J, the trade window, a trader's wares, the board, help, the maneuvers,
    the emote wheel and the rest of CAP_CLOSES) and the chat while it is
    being typed in, which the page draws beneath it.

    So what is open is part of what it is drawn from: nothing that holds
    the keyboard (a claim, the same list the focus arbiter keeps) and none
    of Skyrim's menus that take it. Who is being looked at is still
    followed while it is down, so the keys and the prompt are right the
    moment the menu closes.
  */
  let lookCover = '';      // what the prompt was last taken down for, for one line each time

  function lookCoveredBy() {
    for (const k in claims) { if (claims[k]) { return 'the ' + k + ' panel'; } }
    return busyMenuOpen();
  }

  /*
    WHAT THE GAME ITSELF OFFERS ON A PERSON, said once each time you look at
    somebody new (#2473). Patrick, 12 Oct: the game's own "Talk to" prompt
    shows over a person, twice, over the look panel, the adventure menu and
    the name tags. Two things in this build can draw it, and nothing here
    says which one is on screen:

      the HUD's own line, the activate text Skyrim gives any actor whose race
        allows talking to it. The client blocks a person's activation every
        frame (movementApply.ts blockActivation(true)), which sends the press
        to scripts instead of the dialogue, and leaves the text standing.
      Better Third Person Selection, in the collection, which in third person
        copies that text into a widget of its own drawn at the person, above
        the head for an actor (its MCM settings.ini: the 3D widget on in
        third person, fWidgetZOffsetAdditionalNPC), which is where the name
        tag and the speaking mark are.

    So this writes what the HUD's line holds, whether that mod's menu is up,
    which camera you are in and whether the activation is blocked. Two
    sessions, one in each camera, settle which layer is which and whether
    the two copies are the HUD and that widget, before anything is changed.
    It reads; it changes nothing.
  */
  function gamePromptSaid(ref) {
    const bits = [];
    let cam = -1;
    try { cam = Number(sp.Game.getCameraState()); } catch (e) { cam = -1; }
    // SKSE's numbers: 0 first person, 8 and 9 the two third person states.
    bits.push('camera ' + (cam === 0 ? 'first person' : (cam === 8 || cam === 9) ? 'third person' : String(cam)));
    const read = function (target) {
      try { return String(sp.Ui.getString('HUD Menu', target) || ''); } catch (e) { return '?'; }
    };
    bits.push('the HUD line "' + read('_root.HUDMovieBaseInstance.RolloverText.text') + '"' +
              ' / "' + read('_root.HUDMovieBaseInstance.RolloverInfoText.text') + '"');
    let btps = 'unknown';
    try { btps = sp.Ui.isMenuOpen('BTPS Menu') ? 'up' : 'not up'; } catch (e) { btps = 'unknown'; }
    bits.push('Better Third Person Selection\'s widget menu ' + btps);
    let blocked = 'unknown';
    try { blocked = ref.isActivationBlocked() ? 'yes' : 'no'; } catch (e) { blocked = 'unknown'; }
    bits.push('activation blocked ' + blocked);
    return ': ' + bits.join(', ');
  }

  // A claim is a variable read, so it is asked every frame and a panel takes
  // the prompt down in the frame it opens, not on the next poll.
  sp.on('update', guard('crosshair', () => {
    if (lookingSig && anyClaim()) { drawPrompt(null); }
    const now = Date.now();
    if (now - nearAt < NEAR_EVERY) { return; }
    nearAt = now;

    const near = nearList();
    if (!near) { lookingAt = ''; drawPrompt(null); return; }

    let ref = null;
    try { ref = sp.Game.getCurrentCrosshairRef(); } catch (e) { ref = null; }
    if (!ref) { lookingAt = ''; drawPrompt(null); return; }

    let hex = '';
    // Dynamic references have different local and server IDs (#1275).
    try {
      const convert = globalThis.thornswoodSocialServerId;
      const serverId = typeof convert === 'function' ? convert(ref.getFormID() >>> 0) : 0;
      if (serverId) { hex = (serverId >>> 0).toString(16); }
    } catch (e) { hex = ''; }
    if (!hex) { lookingAt = ''; drawPrompt(null); return; }

    const row = Object.prototype.hasOwnProperty.call(near, hex) ? near[hex] : null;
    if (!row) { lookingAt = ''; drawPrompt(null); return; }

    if (hex !== lookingAt) {
      lookingAt = hex;
      say('looking at ' + row.n + ' (' + hex + ')' + gamePromptSaid(ref));
    }
    const cover = lookCoveredBy();
    if (cover !== lookCover) {
      if (cover) { say('look prompt down while ' + cover + ' is open'); }
      lookCover = cover;
    }
    drawPrompt(cover ? null : row);
  }));

  /*
    One of Skyrim's menus takes the prompt down the moment it opens, rather
    than on the next poll, and the menu memory busyMenuOpen keeps for a
    quarter of a second is let go of, so a "no menu" read just before the
    menu opened cannot put the prompt back over it. Closing lets go of it
    too, so the prompt is back on the next poll.
  */
  sp.on('menuOpen', guard('look menu', (e) => {
    if (KEYBOARD_MENUS.indexOf(String((e && e.name) || '')) === -1) { return; }
    menuCachedAt = 0;
    drawPrompt(null);
  }));
  sp.on('menuClose', guard('look menu closed', (e) => {
    if (KEYBOARD_MENUS.indexOf(String((e && e.name) || '')) === -1) { return; }
    menuCachedAt = 0;
  }));

  /*
    The four keys, and they only mean anything while somebody is under the
    crosshair.

    That is what makes them safe to put on letters. G, H and B do nothing in
    this game on their own, and even if a mod took one of them the prompt is
    the only thing that arms these: with nobody in front of you the key falls
    through to whatever else wants it.

    P and J are Patrick's own choices and are the exception: those two open
    their panels whether or not anybody is being looked at, because a party
    menu you can only open by staring at a friend is not a menu. P on
    somebody who is not in your party asks them in instead (partyPress).
  */
  function lookVerb(cmd) {
    if (!lookingAt) { return false; }
    const line = '/' + cmd + ' ' + lookingAt;
    if (!T.ready) { note('The social connection is loading. Try again in a moment.'); return true; }
    // These are deliberate actions: say marks the line as a key press, and
    // with no quiet the chat says when it is queued offline (#2732).
    const sent = T.js('(function(){try{if(window.thornswoodNet&&window.thornswoodNet.say){' +
      'window.thornswoodNet.say(' + JSON.stringify(line) + ');return;}}catch(e){}' +
      'try{window.skyrimPlatform.sendMessage("thornswood-front","social:unavailable");}catch(e){}})();');
    if (!sent) { note('Could not send the social request. Try again in a moment.'); }
    say(cmd + ' on ' + lookingAt);
    return true;
  }

  /*
    Let the person under the crosshair sleep in the building you hold, or end
    their night (#1603). Only while the prompt offers it, which is the server
    saying so on the near list, and the server measures all of it again when
    the line arrives. Answers whether it was used, so the key falls through
    when it was not.
  */
  /*
    Hand the person under the crosshair the letters you carry for them
    (#1595). Only while the prompt offers it, which is the server's near list
    saying you carry one for them, and deliver measures the name, the reach
    and the cell again when the line arrives. Answers whether it was used,
    so an E on anybody else goes on to the board, the driver or the trader.
  */
  function deliverPress(e) {
    if (!e || !lookingAt) { return false; }
    if (DELIVER_KEY ? e.code !== DELIVER_KEY : e.userEventName !== 'Activate') { return false; }
    if (claims.chat) { return false; }
    if (busyMenuOpenNow()) { return false; }
    const near = nearList();
    const row = (near && Object.prototype.hasOwnProperty.call(near, lookingAt)) ? near[lookingAt] : null;
    if (!row || !row.d) { return false; }
    return lookVerb('deliver');
  }

  function sleepPress() {
    if (!lookingAt) { return false; }
    if (claims.chat) { return false; }
    if (busyMenuOpenNow()) { return false; }
    const near = nearList();
    const row = (near && Object.prototype.hasOwnProperty.call(near, lookingAt)) ? near[lookingAt] : null;
    if (!row || !row.s) { return false; }
    return lookVerb('sleephere');
  }

  /*
    Take the person under the crosshair on as an apprentice (#1634). Only
    while the prompt offers it, which is the server's near list naming the
    halves this Master could take them on in. Nothing is sent from here:
    the K panel opens on Masters and apprentices with that person and a
    Take on for each half, and its button sends the line, so the choice of
    half is made before the offer goes. The server asks every rule again
    when it arrives. Answers whether it was used, so K falls through to
    opening or closing the panel when it was not.
  */
  function apprenticePress() {
    if (!lookingAt) { return false; }
    if (claims.chat) { return false; }
    if (T.hasFocus('skills')) { return false; }
    if (busyMenuOpenNow()) { return false; }
    const near = nearList();
    const row = (near && Object.prototype.hasOwnProperty.call(near, lookingAt)) ? near[lookingAt] : null;
    if (!row || !Array.isArray(row.a) || !row.a.length) { return false; }
    const who = { id: lookingAt, name: String(row.n || ''), halves: row.a };
    T.js('try{if(window.thornswoodSkills&&window.thornswoodSkills.takeOn){' +
         'window.thornswoodSkills.takeOn(' + JSON.stringify(who) + ');}}catch(e){}');
    say('take on as apprentice: ' + lookingAt);
    return true;
  }

  /*
    Offer to dye the hair of the person under the crosshair (#2675). Only
    while the prompt offers it: the server's near list saying you carry a
    dye. Nothing is sent from here: the K panel opens on Hair dye with that
    person, and its Offer to dye sends the line once the dye is chosen. The
    server checks it all again. Answers whether it was used.
  */
  function hairDyePress() {
    if (!lookingAt) { return false; }
    if (claims.chat) { return false; }
    if (T.hasFocus('skills')) { return false; }
    if (busyMenuOpenNow()) { return false; }
    const near = nearList();
    const row = (near && Object.prototype.hasOwnProperty.call(near, lookingAt)) ? near[lookingAt] : null;
    if (!row || !row.hd) { return false; }
    const who = { id: lookingAt, name: String(row.n || '') };
    T.js('try{if(window.thornswoodSkills&&window.thornswoodSkills.dyeFor){' +
         'window.thornswoodSkills.dyeFor(' + JSON.stringify(who) + ');}}catch(e){}');
    say('dye their hair: ' + lookingAt);
    return true;
  }

  /*
    Tend the wounds of the person under the crosshair (#1383). Only while the
    prompt offers it, which is the server's near list saying they have a
    wound somebody could tend. It sends /treat with their form id, and the
    server answers with the treatment panel for them (game/ui/thornswood-treat.js),
    measuring the reach again. Answers whether it was used, so X falls
    through when it was not.
  */
  function treatPress() {
    if (!lookingAt) { return false; }
    if (claims.chat) { return false; }
    if (busyMenuOpenNow()) { return false; }
    const near = nearList();
    const row = (near && Object.prototype.hasOwnProperty.call(near, lookingAt)) ? near[lookingAt] : null;
    if (!row || !row.t) { return false; }
    return lookVerb('treat');
  }

  /*
    P on somebody who is not in your party asks them in (#1629), the way Y
    sends /friend: the prompt says "Ask to party" for exactly them, from the
    near list's y flag. On a party member the prompt says "Party menu", and
    with nobody looked at there is no prompt; either way this answers false
    and the key opens the panel. Nobody types /party any more (Patrick,
    4 Oct: buttons, not commands); this and the P panel are what send it,
    and the server checks the ask again when it arrives.

    No menu check here. The key handler has already made it for P, and the
    game's Quick Magic, which this same press opened, is let through there
    and shut by magicOnP; asking busyMenuOpenNow would refuse every press.
  */
  function partyPress() {
    if (!lookingAt) { return false; }
    const near = nearList();
    const row = (near && Object.prototype.hasOwnProperty.call(near, lookingAt)) ? near[lookingAt] : null;
    if (!row || row.y) { return false; }
    return lookVerb('party');
  }

  /*
    Who is in front of you, for the group book on J (#1630). factions.md: "You
    invite the character in front of you, or by name". The J panel cannot see
    the crosshair, so as it opens it is told who the look prompt is drawn
    for: the same form id Y, H and L send, and the name the server put on the
    near list. Its group tab then offers Invite with that name, and the line
    it sends is /book invite with the id, which the server checks again.
    Nobody in front clears it, so the button is there only while it applies.
    A listener of its own, so the J key handling (#1016) is left alone.
  */
  sp.on('browserMessage', guard('journal facing', (event) => {
    const a = event && event.arguments;
    if (!a || a[0] !== 'thornswood-front' || a[1] !== 'journal:opened') { return; }
    const near = nearList();
    const row = (lookingAt && near && Object.prototype.hasOwnProperty.call(near, lookingAt)) ? near[lookingAt] : null;
    const facing = row ? { id: lookingAt, name: String(row.n || '') } : null;
    T.js('try{if(window.thornswoodJournal&&window.thornswoodJournal.setFacing){' +
         'window.thornswoodJournal.setFacing(' + JSON.stringify(facing) + ');}}catch(e){}');
  }));

  /*
    ------------------------------------------ a key mold, into a door's lock

    Patrick, 24 September, in order: "you should press e on a un molded door
    to fill the mold", then "not type" /mold, then "actually can we make it a
    different key that is unused in tis scenario and include a prompt when
    loooking at a door to press that key to set a mold".

    So while somebody carrying a Key Mold looks at a door, one line under the
    crosshair names the key, and the key sends /moldhere with that door's form
    id. The server decides everything else: that it is a door of a building,
    that they are standing at it, and every rule /mold keeps. The id is a
    hint and nothing more. The server's own distance check is what makes it
    safe, so nothing here is the gate.

    ONLY WITH THE PLUGIN THAT HAS BLANKS. The blank key mold's recipe is
    0x15496 in Thornswood-Content.esp. The live build has that file from the
    Nexus collection, which does not carry the record yet; a dev release has
    carried our own copy since #251. A build without the record has no blank
    to press, so on it nothing is drawn and nothing is sent. It is
    asked once, when the world is up, and remembered, because a plugin does
    not gain a record while the game runs. What is kept is the Key Mold's
    runtime id and not the form, for the reason under THE IDS, RESOLVED ONCE.

    ONLY FOR A BLANK (#529). Which door a mold is for is the name on it, and
    getItemCount counts the record, so a stamped mold and a blank look the
    same through it, and every holder saw the line at every door. The name
    reaches the game as TextDisplayData on the item, the same place
    skymp5-client reads it back from (sync/inventory.ts in the fork), so the
    named molds are counted out of getExtraContainerChanges and taken off.
    If that cannot be read, nothing is taken off: the line shows as it did,
    and the server still refuses a stamped mold on the press.

    ON THE CROSSHAIR POLL'S BEAT, a third of a second, never every frame. On a
    build without the recipe that is one comparison and no call into the game.
    With it, one call for the crosshair and two to ask whether it is a door;
    only for a door are the menus and the pack asked.

    NEVER OVER A MENU, and never while the chat or a panel holds the
    keyboard. The key reaches this file even while somebody is typing, and a
    u typed into the chat has to stay a letter. The menus are asked fresh
    rather than out of busyMenuOpen's quarter second memory, because a
    remembered "no menu" from just before the inventory opened would put the
    line back over it; that walk only happens while a door is under the
    crosshair. And a menu opening takes the line down at once, below, rather
    than on the next look.
  */
  const MOLD_EVERY = 320;
  const MOLD_FILE = 'Thornswood-Content.esp';
  const MOLD_RECIPE = 0x15496;   // COBJ ThornswoodRecipeKeyMold, the blank's recipe
  const MOLD_ITEM = 0x15495;     // MISC, the Key Mold itself
  const DOOR_TYPE = 29;          // a DOOR base, the same test the activate handler makes
  let moldAt = 0;
  let moldBase = -1;       // -1 not asked yet, 0 not in this build, else the Key Mold's runtime id
  let moldDoor = '';       // the door the line is up for, its form id in hex
  let moldShown = false;
  let moldSentFor = '';
  let moldSentAt = 0;

  /** Whether this build has blank molds, found out once the world is up. */
  function moldReady() {
    if (moldBase >= 0) { return moldBase > 0; }
    let pc = null;
    try { pc = sp.Game.getPlayer(); } catch (e) { pc = null; }
    if (!pc) { return false; }
    try {
      const recipe = sp.Game.getFormFromFile(MOLD_RECIPE, MOLD_FILE);
      const item = recipe ? sp.Game.getFormFromFile(MOLD_ITEM, MOLD_FILE) : null;
      moldBase = item ? (item.getFormID() || 0) : 0;
    } catch (e) {
      // Not remembered. A throw is not an answer, so it is asked again.
      return false;
    }
    log(moldBase ? 'key molds: this build has blanks, so ' + MOLD_NAME + ' presses one into a door'
                 : 'key molds: no blank key mold recipe in ' + MOLD_FILE + ', so no prompt and no key');
    return moldBase > 0;
  }

  /*
    How many of the Key Molds carried have a name, which is a door's. 0 when
    it cannot tell. base is the Key Mold's runtime id when the caller has its
    own (the lock key at a forge, #1637), and moldBase otherwise.
  */
  function stampedMolds(pc, base) {
    const want = base || moldBase;
    let named = 0;
    try {
      const changes = sp.getExtraContainerChanges(pc.getFormID()) || [];
      for (let i = 0; i < changes.length; i++) {
        if (!changes[i] || changes[i].baseId !== want) { continue; }
        const lists = changes[i].extendDataList || [];
        for (let j = 0; j < lists.length; j++) {
          let n = 1, name = false;
          (lists[j] || []).forEach(function (x) {
            if (!x) { return; }
            if (x.type === 'Count') { n = Number(x.count) || 1; }
            if (x.type === 'TextDisplayData' && x.name) { name = true; }
          });
          if (name) { named += n; }
        }
      }
    } catch (e) { named = 0; }
    return named;
  }

  /** The door under the crosshair, in hex, while a blank Key Mold could go into it. '' otherwise. */
  function moldDoorNow() {
    if (!moldReady()) { return ''; }
    if (anyClaim()) { return ''; }
    let ref = null;
    try { ref = sp.Game.getCurrentCrosshairRef(); } catch (e) { ref = null; }
    if (!ref) { return ''; }
    let door = false;
    try {
      const b = ref.getBaseObject();
      door = !!b && b.getType() === DOOR_TYPE;
    } catch (e) { door = false; }
    if (!door) { return ''; }
    if (busyMenuOpenNow()) { return ''; }
    let carried = 0;
    let pc = null;
    try {
      pc = sp.Game.getPlayer();
      const mold = sp.Game.getFormEx(moldBase);
      carried = (pc && mold) ? pc.getItemCount(mold) : 0;
    } catch (e) { carried = 0; }
    if (!(carried > 0)) { return ''; }
    if (!(carried - stampedMolds(pc) > 0)) { return ''; }
    let hex = '';
    try { hex = (ref.getFormID() >>> 0).toString(16); } catch (e) { hex = ''; }
    return hex;
  }

  /*
    Under the crosshair and centred, in the K panel's colours. Not right of
    centre where the look prompt sits: for a door that is where Skyrim draws
    its own "Open", and a line over it would hide the one the person needs.
    Beneath our panels, which stand at 2147483000, so one opened while the
    line is up covers it for the moment before the next look takes it down.
  */
  const MOLD_CSS =
    'position:fixed;left:50%;top:62%;transform:translateX(-50%);z-index:2147482900;' +
    'pointer-events:none;white-space:nowrap;' +
    'font-family:"Palatino Linotype",Palatino,Georgia,serif;font-size:19px;letter-spacing:.03em;' +
    'color:#d9cfb4;background:rgba(11,10,8,.72);border:1px solid rgba(198,170,109,.42);' +
    'padding:8px 16px 9px;text-shadow:0 2px 4px rgba(0,0,0,.95)';

  /** The line up or down. Only remembered once the page has taken it. */
  function drawMold(on) {
    if (on === moldShown) { return; }
    if (!on) {
      if (T.js('try{var d=document.getElementById("ts-mold");if(d){d.style.display="none";}}catch(e){}')) {
        moldShown = false;
      }
      return;
    }
    const html =
      '<span style="display:inline-block;min-width:26px;text-align:center;margin-right:12px;' +
      'padding:1px 7px;border:1px solid rgba(233,209,155,.55);border-bottom-width:2px;' +
      'border-radius:3px;background:rgba(0,0,0,.35);color:#e9d19b">' + MOLD_NAME + '</span>' +
      'Press your key mold into this lock';
    if (T.js('(function(){try{' +
             'var d=document.getElementById("ts-mold");' +
             'if(!d){d=document.createElement("div");d.id="ts-mold";' +
             'd.style.cssText=' + JSON.stringify(MOLD_CSS) + ';' +
             'document.body.appendChild(d);}' +
             'd.innerHTML=' + JSON.stringify(html) + ';' +
             'd.style.display="";' +
             '}catch(e){}})();')) {
      moldShown = true;
    }
  }

  /*
    One look: the line up for a door a mold could go into, down for anything
    else. While the page is not ready there is nothing to draw on, and a page
    that reloaded has lost the line with everything else, so it is forgotten
    and drawn again once the page is back.
  */
  function moldLook() {
    if (!T.ready) { moldShown = false; moldDoor = ''; return; }
    const hex = moldDoorNow();
    if (hex && hex !== moldDoor) { say('a key mold could go into door ' + hex); }
    moldDoor = hex;
    drawMold(!!hex);
  }

  /*
    The key. Asked again at the moment it goes down rather than read off the
    last look, so the id sent is the door under the crosshair at the press.
    Answers whether it was used, so the key falls through when it was not.
    One line per door per second and a half, so pressing twice in a breath
    is not two refusals in the chat.
  */
  function moldPress() {
    if (!T.ready) { return false; }
    const hex = moldDoorNow();
    moldDoor = hex;
    drawMold(!!hex);
    if (!hex) { return false; }
    const now = Date.now();
    if (hex === moldSentFor && now - moldSentAt < 1500) { return true; }
    moldSentFor = hex;
    moldSentAt = now;
    tellServer('/moldhere ' + hex);
    say('pressed a key mold into door ' + hex);
    return true;
  }

  sp.on('update', guard('mold', () => {
    const now = Date.now();
    if (now - moldAt < MOLD_EVERY) { return; }
    moldAt = now;
    moldLook();
  }));

  // A menu that takes the keyboard takes the line down the moment it opens.
  sp.on('menuOpen', guard('mold menu', (e) => {
    if (!moldShown) { return; }
    if (KEYBOARD_MENUS.indexOf(String((e && e.name) || '')) === -1) { return; }
    moldDoor = '';
    drawMold(false);
  }));

  /*
    ------------------------------------- the lock key: a door, a forge (#1637)

    Patrick, 4 October: no chat commands for anything people do, only
    buttons and GUI. The lock key (X unless LockKey moved it) used to send
    /lock at whatever door was opened last, and claiming, unlocking and
    cutting a key were typed. Now it does what one line under the crosshair
    says, and only while that line is up:

      a door of the building you just     Claim when nobody holds it, Lock or
      opened                              Unlock when it is yours. The
                                          suggested answer on #1637: one key,
                                          and the line says which it will do.
      a forge, carrying a key mold that   Cut a key.
      has been pressed into a door
      a crop (#1636)                      What is in the ground and whose farm
                                          it is, E's Sow a Cabbage when the
                                          press would sow it, and Claim this
                                          farm when the key would claim it.

    THE DOOR'S WORD IS THE SERVER'S. Which building a door belongs to, who
    holds it and whether it is locked are all in the register, so the server
    writes thornswoodDoorLine on every door of a building somebody opens and
    after every press (doorLine in the property block): the word, the name,
    and that building's doors by form id. The line is up while one of those
    doors is under the crosshair, either half of a front door, for as long as
    the server still takes it as the door just opened.

    THE FORGE IS KNOWN BY ITS BASE, the six forges of the bench table in the
    gamemode (BENCH_BY_BASE rows for CraftingSmithingForge), resolved by file
    and local id like the drivers below, and held to that table by
    tests/test-1637-door-gui.js. The mold is a Key Mold with a door's name on
    it, counted the way the mold key counts them.

    A CROP ASKS (#1636). A plot's state is on the plot, where nobody's client
    can read it, and whose farm it is is in the claims file. So a crop that
    stays under the crosshair for a second look sends /plot and its id, and
    the server writes the answer on thornswoodPlotLine (plotLine in the
    farming block) for this person alone. Asked again every PLOT_ASK_MS while
    it is looked at, so the minutes move, and never for a crop only swept
    past. The crops are known by base, every base CROPS answers in the
    gamemode, held to that table by tests/test-1636-farm-gui.js.

    The key sends /claim, /lock, /unlock or /key with the id under the
    crosshair. Those are the lines the server always answered, nobody is told
    to type them, and the server checks everything again: the door just
    opened, the holder, the smith, the forge, the mold and the ingot, and at
    a plot the class, the reach and whose ground it is.

    Never over a menu or while the chat has the keyboard, on the crosshair
    poll's beat, and down the moment a menu takes the keyboard, for the
    reasons the mold line gives.
  */
  const LOCK_EVERY = 320;
  // The mold line's look, a line lower, so the two never sit on each other:
  // a holder carrying a blank who looks at their own door has both.
  const LOCK_CSS =
    'position:fixed;left:50%;top:67%;transform:translateX(-50%);z-index:2147482900;' +
    'pointer-events:none;white-space:nowrap;' +
    'font-family:"Palatino Linotype",Palatino,Georgia,serif;font-size:19px;letter-spacing:.03em;' +
    'color:#d9cfb4;background:rgba(11,10,8,.72);border:1px solid rgba(198,170,109,.42);' +
    'padding:8px 16px 9px;text-shadow:0 2px 4px rgba(0,0,0,.95)';
  const FORGE_BASES = [
    ['Skyrim.esm', 0x1a2ad], ['Skyrim.esm', 0xbf9e1], ['Skyrim.esm', 0xcae0b],
    ['Dragonborn.esm', 0x2b074], ['Dragonborn.esm', 0x3cf6e], ['North Keep.esp', 0x21152]
  ];
  const CROP_BASES = [
    ['Skyrim.esm', 0xbcf48], ['Skyrim.esm', 0xbb952], ['Skyrim.esm', 0xbcf47],
    ['Skyrim.esm', 0xbe3e6], ['Skyrim.esm', 0xbb953], ['Dragonborn.esm', 0x206e8],
    ['JKs Skyrim.esp', 0x2493e], ['JKs Skyrim.esp', 0x2493d], ['JKs Skyrim.esp', 0x2c91],
    ['JKs Skyrim.esp', 0x3274], ["JK's Whiterun's Outskirts.esp", 0x1503ff],
    ["JK's Whiterun's Outskirts.esp", 0x18d5d7], ["JK's Whiterun's Outskirts.esp", 0x141081],
    ["JK's Whiterun's Outskirts.esp", 0x141088],
    // The HearthFires garden planters, plots since #3141.
    ['HearthFires.esm', 0x1045e], ['HearthFires.esm', 0x1045f], ['HearthFires.esm', 0x10460],
    ['HearthFires.esm', 0x110b9], ['HearthFires.esm', 0x110ba], ['HearthFires.esm', 0x110cd]
  ];
  /*
    A MARKET STALL (#3160). Stalls are fixed market stalls (Patrick, 22 Oct
    2026), and a stall's counter is a static, which the crosshair never
    names. So the line goes up by where somebody stands: within a stall's
    reach of the point in front of its counter, in its world or cell, with
    nothing else of the lock key's under the crosshair, the line says Market
    stall, and the lock key sends /stall open and the stall's id. The server
    checks again that they stand there, and its panel does the rest
    (game/ui/thornswood-stall.js).
  */
  // MARKET STALL SPOTS BEGIN
  // Built by scripts\dev\Build-MarketStallsGamemode.js out of game\data\market-stalls.json. Do not hand edit.
  const STALL_SPOTS = [
    ["falkreath-e0b1", 0x3c, "Skyrim.esm", -54113, -34305, -3633, 335],
    ["falkreath-e0b2", 0x3c, "Skyrim.esm", -54413, -34602, -3620, 335],
    ["markarth-473a0", 0x16d71, "Skyrim.esm", -174050, 5729, -3363, 183],
    ["markarth-473a1", 0x16d71, "Skyrim.esm", -174136, 6065, -3328, 183],
    ["markarth-7de", 0x3c, "Skyrim.esm", -168656, 6632, -4331, 183],
    ["morthal-bc995", 0x3c, "Skyrim.esm", -85314, 57199, -11567, 254],
    ["morthal-bc996", 0x3c, "Skyrim.esm", -85377, 57518, -11568, 254],
    ["riften-1b1f7a", 0x16bb4, "Skyrim.esm", 176485, -98728, 11211, 260],
    ["riften-1b1f7c", 0x16bb4, "Skyrim.esm", 176213, -99094, 11207, 202],
    ["riften-1dd1", 0x16bb4, "Skyrim.esm", 172370, -96376, 11128, 202],
    ["riften-1dd2", 0x16bb4, "Skyrim.esm", 172370, -96231, 11128, 202],
    ["riften-cc524", 0x16bb4, "Skyrim.esm", 173755, -96726, 11104, 252],
    ["riften-cc52d", 0x16bb4, "Skyrim.esm", 173079, -97352, 11104, 309],
    ["riften-cc52e", 0x16bb4, "Skyrim.esm", 173779, -97306, 11104, 257],
    ["solitude-1aa3b", 0x3c, "Skyrim.esm", -59552, 100648, -13958, 224],
    ["solitude-2a11", 0x37edf, "Skyrim.esm", -61093, 105827, -8410, 224],
    ["solitude-2a1b", 0x37edf, "Skyrim.esm", -61315, 105933, -8418, 209],
    ["solitude-2a49", 0x37edf, "Skyrim.esm", -60786, 105792, -8410, 224],
    ["solitude-357d", 0x37edf, "Skyrim.esm", -59225, 107632, -8021, 224],
    ["solitude-46f5", 0x37edf, "Skyrim.esm", -60730, 104169, -8307, 224],
    ["solitude-4725", 0x37edf, "Skyrim.esm", -61764, 104094, -8307, 224],
    ["solitude-50c6a", 0x37edf, "Skyrim.esm", -61161, 104924, -8335, 224],
    ["solitude-5133", 0x3c, "Skyrim.esm", -58740, 101161, -13959, 224],
    ["solitude-64b8c", 0x37edf, "Skyrim.esm", -61200, 104536, -8334, 224],
    ["solitude-64b8d", 0x37edf, "Skyrim.esm", -61605, 104462, -8333, 224],
    ["whiterun-1908f", 0x1a26f, "Skyrim.esm", 21453, -7327, -3587, 254],
    ["whiterun-5b2e4", 0x1a26f, "Skyrim.esm", 25242, -7425, -3393, 254],
    ["whiterun-5bee6", 0x1a26f, "Skyrim.esm", 25156, -7089, -3400, 314],
    ["whiterun-6b0b6", 0x1a26f, "Skyrim.esm", 24382, -7187, -3399, 335],
    ["whiterun-b7f00", 0x3c, "Skyrim.esm", 12937, -10803, -4726, 238],
    ["whiterun-fe7f", 0x1a26f, "Skyrim.esm", 24312, -6755, -3422, 270],
    ["windhelm-383a6", 0x1691d, "Skyrim.esm", 130794, 36455, -12272, 236],
    ["windhelm-38403", 0x1691d, "Skyrim.esm", 130808, 35750, -12276, 236],
    ["windhelm-38404", 0x1691d, "Skyrim.esm", 130560, 36224, -12272, 236],
    ["windhelm-80c33", 0x3c, "Skyrim.esm", 135265, 30774, -12565, 202],
    ["windhelm-8b01e", 0x1691d, "Skyrim.esm", 134225, 39412, -12049, 236],
    ["windhelm-8b0a", 0x1691d, "Skyrim.esm", 129842, 36459, -12272, 236],
    ["windhelm-8b0fb", 0x3c, "Skyrim.esm", 135301, 30408, -12581, 177],
    ["windhelm-8b6c", 0x1691d, "Skyrim.esm", 130415, 35648, -12272, 236],
    ["windhelm-a48fc", 0x1691d, "Skyrim.esm", 137951, 38182, -12643, 208],
    ["windhelm-b4bb", 0x1691d, "Skyrim.esm", 137721, 38748, -12660, 219],
    ["windhelm-f3c74", 0x1691d, "Skyrim.esm", 131041, 35666, -12272, 219],
    ["windhelm-f3c75", 0x1691d, "Skyrim.esm", 130560, 36016, -12272, 219],
    ["winterhold-76d1", 0x3c, "Skyrim.esm", 114289, 104184, -9405, 202],
    ["winterhold-76d3", 0x3c, "Skyrim.esm", 114562, 104038, -9392, 183],
    ["winterhold-76e1", 0x3c, "Skyrim.esm", 114011, 103748, -9225, 202],
    ["winterhold-76e2", 0x3c, "Skyrim.esm", 113403, 100147, -8954, 183],
    ["winterhold-76e4", 0x3c, "Skyrim.esm", 113628, 100266, -9020, 202],
    ["winterhold-76e5", 0x3c, "Skyrim.esm", 112678, 100814, -8953, 202],
    ["winterhold-76e6", 0x3c, "Skyrim.esm", 112650, 100647, -8944, 202]
  ];
  // MARKET STALL SPOTS END
  let stallWorlds = null;  // null not resolved yet, else { stall id: runtime world or cell id }
  const PLOT_ASK_MS = 10000;     // asked again this often while one crop is looked at
  const PLOT_LINE_MS = 30000;    // an answer older than this is not drawn
  let lockAt = 0;
  let lockShown = '';      // what the line says while it is up, '' while it is down
  let lockSentFor = '';
  let lockSentAt = 0;
  let forgeIds = null;     // null not found yet, else { runtime id: true }
  let cropIds = null;
  let keyMoldId = -1;      // -1 not asked yet, 0 not in this build, else the Key Mold's runtime id
  let plotLookHex = '';    // the crop under the crosshair at the last look
  let plotAskedFor = '';
  let plotAskedAt = 0;

  /* A list of bases by file and local id as runtime ids, or null until the world answers for any. */
  function basesOf(list) {
    const out = {};
    let found = 0;
    for (let i = 0; i < list.length; i++) {
      try {
        const form = sp.Game.getFormFromFile(list[i][1], list[i][0]);
        const id = form ? (form.getFormID() >>> 0) : 0;
        if (id) { out[id] = true; found++; }
      } catch (err) { }
    }
    return found ? { ids: out, found: found } : null;
  }

  // Remembered once the world answers for any of them; asked again until then.
  function forgeIdSet() {
    if (forgeIds) { return forgeIds; }
    const got = basesOf(FORGE_BASES);
    if (!got) { return {}; }
    forgeIds = got.ids;
    say('forges for the lock key: ' + got.found + ' of ' + FORGE_BASES.length + ' bases found');
    return forgeIds;
  }

  function cropIdSet() {
    if (cropIds) { return cropIds; }
    const got = basesOf(CROP_BASES);
    if (!got) { return {}; }
    cropIds = got.ids;
    say('crops for the line at a plot: ' + got.found + ' of ' + CROP_BASES.length + ' bases found');
    return cropIds;
  }

  /** The server's answer for this crop, while it is new enough to draw. */
  function plotLineNow(hex) {
    let v = null;
    try { v = globalThis.thornswoodPlotLine; } catch (e) { v = null; }
    if (!v || typeof v !== 'object' || v.hex !== hex) { return null; }
    if (Date.now() - (Number(v.seen) || 0) > PLOT_LINE_MS) { return null; }
    return v;
  }

  /*
    Ask the server about the crop under the crosshair: on the second look at
    the same one, so a crop swept past is never asked about, and then every
    PLOT_ASK_MS for as long as it stays there.
  */
  function askPlot(hex) {
    const t = Date.now();
    if (hex !== plotLookHex) { plotLookHex = hex; return; }
    const v = plotLineNow(hex);
    if (v && t - (Number(v.seen) || 0) < PLOT_ASK_MS) { return; }
    if (hex === plotAskedFor && t - plotAskedAt < PLOT_ASK_MS) { return; }
    plotAskedFor = hex;
    plotAskedAt = t;
    tellServer('/plot ' + hex);
  }

  function keyMoldNow() {
    if (keyMoldId >= 0) { return keyMoldId; }
    try {
      if (!sp.Game.getPlayer()) { return 0; }
      const item = sp.Game.getFormFromFile(MOLD_ITEM, MOLD_FILE);
      keyMoldId = item ? (item.getFormID() >>> 0) : 0;
    } catch (e) {
      // Not remembered. A throw is not an answer, so it is asked again.
      return 0;
    }
    return keyMoldId;
  }

  /** The line the server wrote for the door just opened, while it still counts. */
  function doorLineNow() {
    let v = null;
    try { v = globalThis.thornswoodDoorLine; } catch (e) { v = null; }
    if (!v || typeof v !== 'object' || !v.x || !Array.isArray(v.d)) { return null; }
    if (Date.now() - (Number(v.seen) || 0) > (Number(v.left) || 0)) { return null; }
    return v;
  }

  const LOCK_WORDS = { claim: 'Claim ', lock: 'Lock ', unlock: 'Unlock ' };

  /** The lock key's line at a stall: what stallAt finds, with no menu over it. */
  function stallNow() {
    const s = stallAt();
    if (!s || busyMenuOpenNow()) { return null; }
    return { hex: s, verb: 'stall open', words: 'Market stall' };
  }

  /** The id of the stall somebody is standing at, by STALL_SPOTS, or ''. */
  function stallAt() {
    if (!STALL_SPOTS.length) { return ''; }
    let pc = null;
    try { pc = sp.Game.getPlayer(); } catch (e) { pc = null; }
    if (!pc) { return ''; }
    if (!stallWorlds) {
      const got = {};
      let found = 0;
      for (let i = 0; i < STALL_SPOTS.length; i++) {
        try {
          const f = sp.Game.getFormFromFile(STALL_SPOTS[i][1], STALL_SPOTS[i][2]);
          const id = f ? (f.getFormID() >>> 0) : 0;
          if (id) { got[STALL_SPOTS[i][0]] = id; found++; }
        } catch (e) { }
      }
      if (!found) { return ''; }
      stallWorlds = got;
      say('market stalls for the lock key: ' + found + ' of ' + STALL_SPOTS.length + ' found');
    }
    let where = 0, x = 0, y = 0, z = 0;
    try {
      const w = pc.getWorldSpace();
      const c = pc.getParentCell();
      where = w ? (w.getFormID() >>> 0) : (c ? (c.getFormID() >>> 0) : 0);
      x = pc.getPositionX(); y = pc.getPositionY(); z = pc.getPositionZ();
    } catch (e) { return ''; }
    if (!where) { return ''; }
    // Two stalls side by side reach over each other: the nearer one is the one at hand.
    let best = '', bestD = Infinity;
    for (let i = 0; i < STALL_SPOTS.length; i++) {
      const s = STALL_SPOTS[i];
      if (stallWorlds[s[0]] !== where) { continue; }
      const dx = x - s[3], dy = y - s[4], dz = z - s[5];
      const d = dx * dx + dy * dy + dz * dz;
      if (d <= s[6] * s[6] && d < bestD) { best = s[0]; bestD = d; }
    }
    return best;
  }

  /** What the lock key would do right now: { hex, verb, words }, or null. */
  function lockKeyNow() {
    if (anyClaim()) { return null; }
    return lockKeyRef() || stallNow();
  }

  /** What the lock key would do at what is under the crosshair: a door, a crop or a forge. */
  function lockKeyRef() {
    let ref = null;
    try { ref = sp.Game.getCurrentCrosshairRef(); } catch (e) { ref = null; }
    if (!ref) { return null; }
    let type = 0, baseId = 0, hex = '';
    try {
      const b = ref.getBaseObject();
      type = b ? b.getType() : 0;
      baseId = b ? (b.getFormID() >>> 0) : 0;
      hex = (ref.getFormID() >>> 0).toString(16);
    } catch (e) { return null; }
    if (type === DOOR_TYPE) {
      const v = doorLineNow();
      if (!v || v.d.indexOf(hex) === -1 ||
          !Object.prototype.hasOwnProperty.call(LOCK_WORDS, v.x)) { return null; }
      if (busyMenuOpenNow()) { return null; }
      return { hex: hex, verb: v.x, words: LOCK_WORDS[v.x] + String(v.n || 'this building') };
    }
    if (baseId && cropIdSet()[baseId]) {
      if (busyMenuOpenNow()) { return null; }
      const p = plotLineNow(hex);
      return { hex: hex, plot: true, verb: p && p.x ? 'claim' : '', words: p ? p.x : '',
               info: p ? p.t : '', e: p ? p.e : '' };
    }
    if (!baseId || !forgeIdSet()[baseId]) { return null; }
    const mold = keyMoldNow();
    if (!mold) { return null; }
    if (busyMenuOpenNow()) { return null; }
    let pc = null, carried = 0;
    try {
      pc = sp.Game.getPlayer();
      const form = sp.Game.getFormEx(mold);
      carried = (pc && form) ? pc.getItemCount(form) : 0;
    } catch (e) { carried = 0; }
    if (!(carried > 0) || !(stampedMolds(pc, mold) > 0)) { return null; }
    // And the mold key's row for the master key, cut again from the same mold
    // for two iron ingots (#2254). See masterPress.
    return { hex: hex, verb: 'key', words: 'Cut a key from your key mold',
             master: 'Cut a master key from your key mold, 2 iron ingots' };
  }

  function plainWords(text) { return String(text || '').replace(/[<>&"]/g, ''); }
  function lockRow(key, words) {
    return '<div style="margin-top:2px"><span style="display:inline-block;min-width:26px;' +
      'text-align:center;margin-right:12px;padding:1px 7px;border:1px solid rgba(233,209,155,.55);' +
      'border-bottom-width:2px;border-radius:3px;background:rgba(0,0,0,.35);color:#e9d19b">' +
      key + '</span>' + plainWords(words) + '</div>';
  }

  /*
    The line up with what lockKeyNow found, or down for nothing: at a plot
    the server's words first and then a row for each key that does
    something there, E before the lock key; at a door or a forge the lock
    key's row alone. Only remembered once the page has taken it.
  */
  function drawLock(now) {
    const info = now && now.info ? plainWords(now.info) : '';
    const rows = [];
    if (now && now.e) { rows.push(lockRow('E', now.e)); }
    if (now && now.words) { rows.push(lockRow(LOCK_NAME, now.words)); }
    if (now && now.master) { rows.push(lockRow(MOLD_NAME, now.master)); }
    const html = (info ? '<div style="font-size:16px;color:#c9b99a;margin-bottom:3px">' + info + '</div>' : '') +
                 rows.join('');
    if (html === lockShown) { return; }
    if (!html) {
      if (T.js('try{var d=document.getElementById("ts-lock");if(d){d.style.display="none";}}catch(e){}')) {
        lockShown = '';
      }
      return;
    }
    if (T.js('(function(){try{' +
             'var d=document.getElementById("ts-lock");' +
             'if(!d){d=document.createElement("div");d.id="ts-lock";' +
             'd.style.cssText=' + JSON.stringify(LOCK_CSS) + ';' +
             'document.body.appendChild(d);}' +
             'd.innerHTML=' + JSON.stringify(html) + ';' +
             'd.style.display="";' +
             '}catch(e){}})();')) {
      lockShown = html;
    }
  }

  function lockLook() {
    if (!T.ready) { lockShown = ''; return; }
    const now = lockKeyNow();
    if (now && now.plot) { askPlot(now.hex); } else { plotLookHex = ''; }
    drawLock(now);
  }

  /*
    The key. Asked again at the moment it goes down, so what is sent is what
    is under the crosshair at the press. Answers whether it was used, so the
    key falls through when no line is up. The same word for the same thing
    once in a second and a half, so a double press is not a second answer.
  */
  function lockPress() {
    if (!T.ready) { return false; }
    if (claims.chat) { return false; }
    const now = lockKeyNow();
    drawLock(now);
    if (!now || !now.verb) { return false; }
    const sig = now.verb + ' ' + now.hex;
    const t = Date.now();
    if (sig === lockSentFor && t - lockSentAt < 1500) { return true; }
    lockSentFor = sig;
    lockSentAt = t;
    tellServer('/' + sig);
    say('pressed ' + LOCK_NAME + ' for /' + sig);
    return true;
  }

  /*
    THE MASTER KEY AT A FORGE (#2254). Patrick, 12 Oct 2026: a lost master
    key is cut again from the building's mold for two iron ingots. At a forge
    with a stamped mold in the pack the lock key's line has a second row, the
    mold key's, and the mold key sends /key with the forge's id and master.
    U means nothing else there: the mold's own line wants a door, the sleep
    key a person, the repair line the inventory. The server checks the rest:
    the smith, the forge, the mold, the holder standing there and the ingots.
  */
  let masterSentFor = '';
  let masterSentAt = 0;
  function masterPress() {
    if (!T.ready) { return false; }
    if (claims.chat) { return false; }
    const now = lockKeyNow();
    drawLock(now);
    if (!now || !now.master) { return false; }
    const sig = 'key ' + now.hex + ' master';
    const t = Date.now();
    if (sig === masterSentFor && t - masterSentAt < 1500) { return true; }
    masterSentFor = sig;
    masterSentAt = t;
    tellServer('/' + sig);
    say('pressed ' + MOLD_NAME + ' for /' + sig);
    return true;
  }

  sp.on('update', guard('lock line', () => {
    const now = Date.now();
    if (now - lockAt < LOCK_EVERY) { return; }
    lockAt = now;
    lockLook();
  }));

  sp.on('menuOpen', guard('lock menu', (e) => {
    if (!lockShown) { return; }
    if (KEYBOARD_MENUS.indexOf(String((e && e.name) || '')) === -1) { return; }
    drawLock(null);
  }));

  /*
    ------------------------------------- a repair kit, used from the inventory

    #1384, and Patrick's rule of 4 October: commands only for dev and staff,
    and everything people do takes buttons and GUI. A kit mends a
    piece (docs/systems/durability.md), and a kit is a MISC, which Skyrim's
    inventory cannot use: E on one does nothing and tells nobody. So while
    the inventory is open and a repair kit is in the pack, one line at the
    bottom names a key, and that key shuts the inventory and asks the server
    for the repair panel (game/ui/thornswood-repair.js). The server answers
    with the rows on the panel's own property, and the panel's buttons send
    the rest. /repair is that ask; nobody is told to type it.

    THE KEY IS THE MOLD KEY, U. Every letter is taken by Skyrim or by us, and
    U only means anything while its own line is up. The mold's line needs
    the world with no menu open and a door under the crosshair, and the
    sleep key's (SLEEP_KEY, the same U) a person under it with no menu open;
    this one needs the inventory open. None of them is up with another, and
    moldPress and sleepPress have already said no before this is asked.

    ONLY WITH THE PLUGIN THAT HAS KITS. The three kits are 0x154b0, 0x154b1
    and 0x154b2 in Thornswood-Content.esp (scripts/mods/Add-ContentRecords.py).
    A build without them has no kit to carry, so nothing is drawn and nothing
    is sent. Asked once, when the world is up, and remembered as runtime ids,
    for the reason under THE IDS, RESOLVED ONCE.
  */
  const KIT_FILE = 'Thornswood-Content.esp';
  const KIT_ITEMS = [0x154b0, 0x154b1, 0x154b2];   // MISC Weapon Kit, Armor Kit, Sewing Kit
  const INVENTORY_MENU = 'InventoryMenu';
  let kitBases = null;     // null not asked yet, [] none in this build, else runtime ids
  let repairShown = false;

  /** Whether this build has repair kits, found out once the world is up. */
  function kitsReady() {
    if (kitBases) { return kitBases.length > 0; }
    let pc = null;
    try { pc = sp.Game.getPlayer(); } catch (e) { pc = null; }
    if (!pc) { return false; }
    const found = [];
    try {
      for (const local of KIT_ITEMS) {
        const form = sp.Game.getFormFromFile(local, KIT_FILE);
        const id = form ? (form.getFormID() >>> 0) : 0;
        if (id) { found.push(id); }
      }
    } catch (e) {
      // Not remembered. A throw is not an answer, so it is asked again.
      return false;
    }
    kitBases = found;
    log(found.length ? 'repair kits: this build has them, so the inventory offers ' + MOLD_NAME
                     : 'repair kits: no kit records in ' + KIT_FILE + ', so no line in the inventory');
    return found.length > 0;
  }

  /** How many repair kits the pack holds, of the three. */
  function kitsCarried() {
    if (!kitsReady()) { return 0; }
    let pc = null;
    try { pc = sp.Game.getPlayer(); } catch (e) { pc = null; }
    if (!pc) { return 0; }
    let n = 0;
    for (const id of kitBases) {
      try {
        const form = sp.Game.getFormEx(id);
        n += form ? (Number(pc.getItemCount(form)) || 0) : 0;
      } catch (e) { }
    }
    return n;
  }

  // At the bottom of the inventory, in the mold line's colours.
  const REPAIR_CSS =
    'position:fixed;left:50%;bottom:12%;transform:translateX(-50%);z-index:2147482900;' +
    'pointer-events:none;white-space:nowrap;' +
    'font-family:"Palatino Linotype",Palatino,Georgia,serif;font-size:19px;letter-spacing:.03em;' +
    'color:#d9cfb4;background:rgba(11,10,8,.72);border:1px solid rgba(198,170,109,.42);' +
    'padding:8px 16px 9px;text-shadow:0 2px 4px rgba(0,0,0,.95)';

  /** The line up or down. Only remembered once the page has taken it. */
  function drawRepairLine(on) {
    if (on === repairShown) { return; }
    if (!on) {
      if (T.js('try{var d=document.getElementById("ts-repair-line");if(d){d.style.display="none";}}catch(e){}')) {
        repairShown = false;
      }
      return;
    }
    const html =
      '<span style="display:inline-block;min-width:26px;text-align:center;margin-right:12px;' +
      'padding:1px 7px;border:1px solid rgba(233,209,155,.55);border-bottom-width:2px;' +
      'border-radius:3px;background:rgba(0,0,0,.35);color:#e9d19b">' + MOLD_NAME + '</span>' +
      'Mend a piece with your repair kit';
    if (T.js('(function(){try{' +
             'var d=document.getElementById("ts-repair-line");' +
             'if(!d){d=document.createElement("div");d.id="ts-repair-line";' +
             'd.style.cssText=' + JSON.stringify(REPAIR_CSS) + ';' +
             'document.body.appendChild(d);}' +
             'd.innerHTML=' + JSON.stringify(html) + ';' +
             'd.style.display="";' +
             '}catch(e){}})();')) {
      repairShown = true;
    }
  }

  sp.on('menuOpen', guard('repair line up', (e) => {
    if (!e || e.name !== INVENTORY_MENU) { return; }
    drawRepairLine(!!T.ready && kitsCarried() > 0);
  }));
  sp.on('menuClose', guard('repair line down', (e) => {
    if (!e || e.name !== INVENTORY_MENU) { return; }
    drawRepairLine(false);
  }));

  /*
    The key, in the inventory. Asked again at the press: the inventory open,
    nothing typing, a kit in the pack. Answers whether it was used, so the
    key falls through when it was not.
  */
  function repairPress() {
    if (!T.ready || claims.chat) { return false; }
    let open = false;
    try { open = !!sp.Ui.isMenuOpen(INVENTORY_MENU); } catch (e) { open = false; }
    if (!open) { return false; }
    if (!(kitsCarried() > 0)) { drawRepairLine(false); return false; }
    drawRepairLine(false);
    try { sp.TESModPlatform.closeMenu(INVENTORY_MENU); }
    catch (err) { say('repair: closeMenu threw on the inventory: ' + err); }
    tellServer('/repair');
    say('pressed ' + MOLD_NAME + ' in the inventory with a repair kit, asked the server for the repair panel');
    return true;
  }

  /*
    ------------------------------------- your own wounds, tended from the inventory

    #1383. A bandage, a splint, a poultice and a physicker's remedy are MISC
    records, which Skyrim's inventory cannot use, and torn cloth and setting
    a bone are no item at all. So it is the repair kit's pattern: while the
    inventory is open and you have a wound somebody could tend, one line at
    the bottom names a key, and that key shuts the inventory and asks the
    server for the treatment panel (game/ui/thornswood-treat.js), whose
    buttons send the rest. /treat is that ask; nobody is told to type it.

    Whether there is anything to tend is the server's: its injury and
    disease block writes it on your own record, and the owner's script puts
    it on thornswoodHurtCare. Above the repair line, so both can be up.
  */
  let treatSelfShown = false;
  const TREAT_SELF_CSS = REPAIR_CSS.replace('bottom:12%', 'bottom:17%');

  function hurtCare() {
    try { return !!globalThis.thornswoodHurtCare; } catch (e) { return false; }
  }

  /** The line up or down. Only remembered once the page has taken it. */
  function drawTreatSelfLine(on) {
    if (on === treatSelfShown) { return; }
    if (!on) {
      if (T.js('try{var d=document.getElementById("ts-treat-line");if(d){d.style.display="none";}}catch(e){}')) {
        treatSelfShown = false;
      }
      return;
    }
    const html =
      '<span style="display:inline-block;min-width:26px;text-align:center;margin-right:12px;' +
      'padding:1px 7px;border:1px solid rgba(233,209,155,.55);border-bottom-width:2px;' +
      'border-radius:3px;background:rgba(0,0,0,.35);color:#e9d19b">' + TREAT_SELF_NAME + '</span>' +
      'Tend your wounds';
    if (T.js('(function(){try{' +
             'var d=document.getElementById("ts-treat-line");' +
             'if(!d){d=document.createElement("div");d.id="ts-treat-line";' +
             'd.style.cssText=' + JSON.stringify(TREAT_SELF_CSS) + ';' +
             'document.body.appendChild(d);}' +
             'd.innerHTML=' + JSON.stringify(html) + ';' +
             'd.style.display="";' +
             '}catch(e){}})();')) {
      treatSelfShown = true;
    }
  }

  sp.on('menuOpen', guard('treat line up', (e) => {
    if (!e || e.name !== INVENTORY_MENU) { return; }
    drawTreatSelfLine(!!T.ready && hurtCare());
  }));
  sp.on('menuClose', guard('treat line down', (e) => {
    if (!e || e.name !== INVENTORY_MENU) { return; }
    drawTreatSelfLine(false);
  }));

  /*
    The key, in the inventory. Asked again at the press: the inventory open,
    nothing typing, something to tend. Answers whether it was used, so the
    key falls through when it was not.
  */
  function treatSelfPress() {
    if (!T.ready || claims.chat) { return false; }
    let open = false;
    try { open = !!sp.Ui.isMenuOpen(INVENTORY_MENU); } catch (e) { open = false; }
    if (!open) { return false; }
    if (!hurtCare()) { drawTreatSelfLine(false); return false; }
    drawTreatSelfLine(false);
    try { sp.TESModPlatform.closeMenu(INVENTORY_MENU); }
    catch (err) { say('treat: closeMenu threw on the inventory: ' + err); }
    tellServer('/treat');
    say('pressed ' + TREAT_SELF_NAME + ' in the inventory with a wound to tend, asked the server for the treatment panel');
    return true;
  }

  /*
    ------------------------------------- salting and smoking food, from the inventory

    #3163. Food spoils (docs/systems/spoilage.md), and a cook keeps raw meat
    and fish by salting or smoking it. There is no item to use for that, so
    it is the repair kit's pattern: while the inventory is open and the
    server says you may preserve something you carry, one line at the bottom
    names a key, and that key shuts the inventory and asks the server for
    the preserving panel (game/ui/thornswood-preserve.js), whose buttons
    send the rest. /preserve is that ask; nobody is told to type it.

    Whether there is anything to preserve is the server's: you have to be a
    cook and carry raw food that spoils, and its spoilage block writes that
    on the thornswoodPreserveLine property, whose owner's script sets
    globalThis.thornswoodPreserveLine. Above the furniture line, so all four
    can be up.
  */
  let preserveShown = false;
  const PRESERVE_CSS = REPAIR_CSS.replace('bottom:12%', 'bottom:27%');

  function preserveCan() {
    try { return !!globalThis.thornswoodPreserveLine; } catch (e) { return false; }
  }

  /** The line up or down. Only remembered once the page has taken it. */
  function drawPreserveLine(on) {
    if (on === preserveShown) { return; }
    if (!on) {
      if (T.js('try{var d=document.getElementById("ts-preserve-line");if(d){d.style.display="none";}}catch(e){}')) {
        preserveShown = false;
      }
      return;
    }
    const html =
      '<span style="display:inline-block;min-width:26px;text-align:center;margin-right:12px;' +
      'padding:1px 7px;border:1px solid rgba(233,209,155,.55);border-bottom-width:2px;' +
      'border-radius:3px;background:rgba(0,0,0,.35);color:#e9d19b">' + PRESERVE_NAME + '</span>' +
      'Salt or smoke your food';
    if (T.js('(function(){try{' +
             'var d=document.getElementById("ts-preserve-line");' +
             'if(!d){d=document.createElement("div");d.id="ts-preserve-line";' +
             'd.style.cssText=' + JSON.stringify(PRESERVE_CSS) + ';' +
             'document.body.appendChild(d);}' +
             'd.innerHTML=' + JSON.stringify(html) + ';' +
             'd.style.display="";' +
             '}catch(e){}})();')) {
      preserveShown = true;
    }
  }

  sp.on('menuOpen', guard('preserve line up', (e) => {
    if (!e || e.name !== INVENTORY_MENU) { return; }
    drawPreserveLine(!!T.ready && preserveCan());
  }));
  sp.on('menuClose', guard('preserve line down', (e) => {
    if (!e || e.name !== INVENTORY_MENU) { return; }
    drawPreserveLine(false);
  }));

  /*
    The key, in the inventory. Asked again at the press: the inventory open,
    nothing typing, something to preserve. Answers whether it was used, so
    the key falls through when it was not.
  */
  function preservePress() {
    if (!T.ready || claims.chat) { return false; }
    let open = false;
    try { open = !!sp.Ui.isMenuOpen(INVENTORY_MENU); } catch (e) { open = false; }
    if (!open) { return false; }
    if (!preserveCan()) { drawPreserveLine(false); return false; }
    drawPreserveLine(false);
    try { sp.TESModPlatform.closeMenu(INVENTORY_MENU); }
    catch (err) { say('preserve: closeMenu threw on the inventory: ' + err); }
    tellServer('/preserve');
    say('pressed ' + PRESERVE_NAME + ' in the inventory with food to preserve, asked the server for the preserving panel');
    return true;
  }

  /*
    ------------------------------------- furniture in a building you hold (#2679)

    Setting a chair, a bed or a chest down, moving it and picking it up again,
    with keys and a panel and nothing typed (Patrick, 4 October). The server
    decides who may (the holder, or whoever carries the deed or the master
    key) and writes what these lines need on thornswoodFurnitureLine: may,
    the building's name, every piece of it you may touch as the server's id
    in hex, and the piece in your hands with how long it stays there. This
    file only draws the lines and sends what a key means; the furniture
    block in game/gamemode.js checks everything again.

    THREE LINES, never two at once:
      in the inventory     the lock key, Arrange furniture: shuts the
                           inventory and asks for the furniture panel
                           (game/ui/thornswood-furniture.js), whose Place
                           buttons set a piece down in front of you
      a piece under the    the mold key, Move it; the lock key, Pick it up
      crosshair
      a piece in hand      the mold key, Set it down here; the lock key, Turn it

    THE LOCK KEY IN THE INVENTORY, not the mold key: the repair line has U
    there while a kit is carried, and X means nothing else in the inventory
    (the treatment line is H). In the world a piece is no door, forge, crop
    or person, so neither key means anything else on one; a piece in hand
    takes both keys first, because that is what you are doing.

    The server is asked for the line when you walk into another cell and
    each time the inventory opens, so a building you just claimed shows the
    line on the next open.
  */
  const FURNITURE_CSS = REPAIR_CSS.replace('bottom:12%', 'bottom:22%');
  const PIECE_CSS = LOCK_CSS.replace('top:67%', 'top:72%');
  const FURNITURE_ASK_MS = 1500;
  let arrangeShown = false;
  let pieceShown = '';
  let furnitureCell = -1;
  let furnitureAskedAt = 0;
  let pieceAt = 0;
  let pieceSentFor = '';
  let pieceSentAt = 0;

  function furnitureLine() {
    let v = null;
    try { v = globalThis.thornswoodFurnitureLine; } catch (e) { v = null; }
    return (v && typeof v === 'object') ? v : null;
  }

  function askFurniture(force) {
    const t = Date.now();
    if (!force && t - furnitureAskedAt < FURNITURE_ASK_MS) { return; }
    furnitureAskedAt = t;
    tellServer('/furniture look');
  }

  /** The line up or down in the inventory. Only remembered once the page has taken it. */
  function drawArrangeLine(on) {
    if (on === arrangeShown) { return; }
    if (!on) {
      if (T.js('try{var d=document.getElementById("ts-furniture-line");if(d){d.style.display="none";}}catch(e){}')) {
        arrangeShown = false;
      }
      return;
    }
    const v = furnitureLine();
    const html = lockRow(LOCK_NAME, 'Arrange furniture' + (v && v.n ? ' in ' + v.n : ''));
    if (T.js('(function(){try{' +
             'var d=document.getElementById("ts-furniture-line");' +
             'if(!d){d=document.createElement("div");d.id="ts-furniture-line";' +
             'd.style.cssText=' + JSON.stringify(FURNITURE_CSS) + ';' +
             'document.body.appendChild(d);}' +
             'd.innerHTML=' + JSON.stringify(html) + ';' +
             'd.style.display="";' +
             '}catch(e){}})();')) {
      arrangeShown = true;
    }
  }

  function inventoryOpen() {
    try { return !!sp.Ui.isMenuOpen(INVENTORY_MENU); } catch (e) { return false; }
  }

  sp.on('menuOpen', guard('furniture line up', (e) => {
    if (!e || e.name !== INVENTORY_MENU) { return; }
    askFurniture(true);
    const v = furnitureLine();
    drawArrangeLine(!!T.ready && !!(v && v.may));
  }));
  sp.on('menuClose', guard('furniture line down', (e) => {
    if (!e || e.name !== INVENTORY_MENU) { return; }
    drawArrangeLine(false);
  }));

  /* The lock key in the inventory, inside a building you may arrange. */
  function arrangePress() {
    if (!T.ready || claims.chat) { return false; }
    if (!inventoryOpen()) { return false; }
    const v = furnitureLine();
    if (!v || !v.may) { drawArrangeLine(false); return false; }
    drawArrangeLine(false);
    try { sp.TESModPlatform.closeMenu(INVENTORY_MENU); }
    catch (err) { say('furniture: closeMenu threw on the inventory: ' + err); }
    tellServer('/furniture');
    say('pressed ' + LOCK_NAME + ' in the inventory in ' + (v.n || 'a building') + ', asked for the furniture panel');
    return true;
  }

  /** The piece in your hands, while it is still there, as its server id in hex. */
  function pieceInHand() {
    const v = furnitureLine();
    if (!v || !v.may || !v.c) { return ''; }
    return (Date.now() - (Number(v.seen) || 0) < (Number(v.left) || 0)) ? v.c : '';
  }

  /** The piece under the crosshair that you may touch, as its server id in hex, or ''. */
  function pieceLookedAt() {
    const v = furnitureLine();
    if (!v || !v.may || !Array.isArray(v.p) || !v.p.length) { return ''; }
    let ref = null;
    try { ref = sp.Game.getCurrentCrosshairRef(); } catch (e) { ref = null; }
    if (!ref) { return ''; }
    let hex = '';
    // Every piece is a reference the server placed, so its local id is not the server's (#1275).
    try {
      const convert = globalThis.thornswoodSocialServerId;
      const serverId = typeof convert === 'function' ? convert(ref.getFormID() >>> 0) : 0;
      if (serverId) { hex = (serverId >>> 0).toString(16); }
    } catch (e) { hex = ''; }
    return hex && v.p.indexOf(hex) !== -1 ? hex : '';
  }

  /** What the two keys do in the world right now: { hand, hex, rows }, or null. */
  function pieceKeysNow() {
    if (anyClaim() || busyMenuOpenNow()) { return null; }
    const hand = pieceInHand();
    if (hand) {
      return { hand: hand, hex: hand, info: 'Carrying a piece',
               rows: [lockRow(MOLD_NAME, 'Set it down here'), lockRow(LOCK_NAME, 'Turn it')] };
    }
    const hex = pieceLookedAt();
    if (!hex) { return null; }
    return { hand: '', hex: hex, info: '',
             rows: [lockRow(MOLD_NAME, 'Move it'), lockRow(LOCK_NAME, 'Pick it up')] };
  }

  function drawPiece(now) {
    const html = now ? (now.info ? '<div style="font-size:16px;color:#c9b99a;margin-bottom:3px">' +
                                   plainWords(now.info) + '</div>' : '') + now.rows.join('') : '';
    if (html === pieceShown) { return; }
    if (!html) {
      if (T.js('try{var d=document.getElementById("ts-furniture-piece");if(d){d.style.display="none";}}catch(e){}')) {
        pieceShown = '';
      }
      return;
    }
    if (T.js('(function(){try{' +
             'var d=document.getElementById("ts-furniture-piece");' +
             'if(!d){d=document.createElement("div");d.id="ts-furniture-piece";' +
             'd.style.cssText=' + JSON.stringify(PIECE_CSS) + ';' +
             'document.body.appendChild(d);}' +
             'd.innerHTML=' + JSON.stringify(html) + ';' +
             'd.style.display="";' +
             '}catch(e){}})();')) {
      pieceShown = html;
    }
  }

  /* The cell you stand in, so walking into another one asks for the line again. */
  function cellNow() {
    try {
      const pc = sp.Game.getPlayer();
      const cell = pc ? pc.getParentCell() : null;
      return cell ? (cell.getFormID() >>> 0) : 0;
    } catch (e) { return -1; }
  }

  sp.on('update', guard('furniture line', () => {
    const now = Date.now();
    if (now - pieceAt < LOCK_EVERY) { return; }
    pieceAt = now;
    if (!T.ready) { pieceShown = ''; arrangeShown = false; return; }
    const cell = cellNow();
    if (cell !== -1 && cell !== furnitureCell) { furnitureCell = cell; askFurniture(true); }
    if (inventoryOpen()) {
      const v = furnitureLine();
      drawArrangeLine(!!(v && v.may));
      drawPiece(null);
      return;
    }
    drawPiece(pieceKeysNow());
  }));

  /*
    The mold key or the lock key in the world, on a piece or with one in
    hand. Asked again at the press. The same thing once in a third of a
    second, so Turn can be pressed as fast as anybody likes and a double
    press of Move is still one.
  */
  function furniturePress(code) {
    if (!T.ready || claims.chat) { return false; }
    const now = pieceKeysNow();
    drawPiece(now);
    if (!now) { return false; }
    let line = '';
    if (now.hand) { line = code === MOLD_KEY ? 'down' : 'turn'; }
    else { line = (code === MOLD_KEY ? 'move ' : 'pick ') + now.hex; }
    const t = Date.now();
    if (line === pieceSentFor && t - pieceSentAt < 330) { return true; }
    pieceSentFor = line;
    pieceSentAt = t;
    tellServer('/furniture ' + line);
    say('pressed ' + (code === MOLD_KEY ? MOLD_NAME : LOCK_NAME) + ' for /furniture ' + line);
    return true;
  }

  /*
    ------------------------------------- your party: the name, the map, the way

    Patrick, 22 September, asked the party menu to let people "see their name
    tag colour, see them on the map and compass". Those three did not ship with
    the rest of the party work, because none of them is something a browser
    overlay can draw: the name above somebody's head is the client's own text,
    and the compass and the map belong to the game.

    ALL THREE ARE HERE NOW, and each one is done where it can actually be done.

    THE NAME, and this is the one that looked impossible and was not.
    skymp5-client draws the tag itself, in formView.ts:

        this.textNameId = createText(x, y, refr.getDisplayName(), [1, 1, 1, 0.8]);

    A plugin cannot reach into that. But the client hands the id straight back
    out: SweetTaffyNicknamesService writes every one of them into
    sp.storage.idTextNickname, keyed BY FORM ID, and that is exactly the key
    the server's party list carries. setTextColor takes the id. So the colour
    is a table lookup and one call, with no change to the client at all.

    THE MAP. MapMarker is STAT 0x00000010 in Skyrim.esm, read out of the file
    rather than remembered. One marker is placed per party member, named after
    them, added to the map with fast travel OFF, and moved to wherever the
    server last said they were. It is taken out of the world the moment they
    leave the party, because a marker nobody owns is worse than no marker.

    THE COMPASS is NOT here and is not the game's compass. Skyrim's compass
    draws quest targets and map markers and nothing a plugin can add to
    directly; putting a party on it properly needs a quest with an alias per
    member inside an esp, which is a Creation Kit change and a plugin rebuild.
    What is drawn instead is a strip of our own, in thornswood-party.js, out of
    positions the overlay already has five times a second. It says the same
    thing the compass would say, in a place this server controls, and it
    updates three times as often.
  */
  const MAP_MARKER_BASE = 0x00000010;    // STAT MapMarker, Skyrim.esm
  const PARTY_EVERY = 1200;
  // What a party member's name is written in. Green, the same green the HUD
  // uses for a meter that is fine, so the two read as one game.
  const PARTY_COLOUR = [0.56, 0.72, 0.37, 0.95];
  const PLAIN_COLOUR = [1, 1, 1, 0.8];   // what the client itself uses
  const HIDDEN_COLOUR = [1, 1, 1, 0];    // the tag stays, the letters do not

  let partyAt = 0;
  let partySaid = '';
  const partyMarks = {};      // form id hex -> the marker reference
  /*
    WHAT EACH NAME TAG WAS LAST WRITTEN, by the TAG, not by the person (#2474).

    This used to be one flag per person, "this person's name is green", set
    the first time their tag was coloured and kept until they left the party.
    But the client throws a tag away and makes a new one, in its own white,
    every time somebody stops being drawn: they step behind something, walk
    past 1000 units, sneak, change cell, or you simply turn your back on them
    (formView.ts removes the tag the moment the head is behind the camera).
    The flag was still set, so the new tag was never coloured, and a party
    member's name was green only until the first time you looked away. The
    same flag shape left a hidden name showing for up to a pass after its tag
    came back.

    So what is kept is the tag id each person's colour was written into, and
    the colour written. A tag id the client has not had before is a new tag:
    it is coloured once, as it appears. A tag that already has the colour it
    should have is left alone, whatever happens to it. Text ids only grow
    (TextsCollection.cpp counts up, and only destroyAllTexts, which neither
    the client nor any plugin here calls, starts them again), so a new tag
    never reuses an old id.
  */
  const tagWrote = {};        // form id hex -> { id: text id, colour: 'party' | 'hidden' | 'plain' }
  let tagParty = {};          // form id hex -> true: in your party (the server's party list)
  let tagHide = {};           // form id hex -> true: you hid their name (near list or party row h)

  function partyList() {
    try {
      const m = globalThis.thornswoodPartyAt;
      return Array.isArray(m) ? m : [];
    } catch (e) { return []; }
  }

  /*
    The client's own table of name tags, by form id.

    Written by SweetTaffyNicknamesService every time one is created and
    deleted, which is why this is read fresh each frame rather than kept: a
    tag is destroyed and remade whenever somebody walks out of sight and back.
    Keyed by the server's form id (formViewArray.ts passes form.refrId, the id
    the server sent), the same id the party list and the near list carry.
  */
  function nameTags() {
    try {
      const t = sp.storage['idTextNickname'];
      return (t && typeof t === 'object') ? t : null;
    } catch (e) { return null; }
  }

  /*
    Who should be green and who should be blank, from what the server sent.
    Read on the party tick. A hidden name is the same tag with no ink: Hide
    every name blanks the whole table, one person is the near list's h flag,
    or the party row's, for somebody who is in the party and not standing
    close enough to be near. Hidden wins over green, so a hidden party name
    stays blank rather than green.
  */
  function tagWants(want) {
    const party = {};
    for (const hex in want) {
      if (Object.prototype.hasOwnProperty.call(want, hex)) { party[hex] = true; }
    }
    const hide = {};
    const near = nearList() || {};
    for (const hex in near) {
      if (!Object.prototype.hasOwnProperty.call(near, hex)) { continue; }
      if (near[hex] && near[hex].h) { hide[String(hex)] = true; }
    }
    for (const hex in want) {
      if (!Object.prototype.hasOwnProperty.call(want, hex)) { continue; }
      if (want[hex] && want[hex].h) { hide[String(hex)] = true; }
    }
    tagParty = party;
    tagHide = hide;
  }

  const TAG_COLOURS = { party: PARTY_COLOUR, hidden: HIDDEN_COLOUR, plain: PLAIN_COLOUR };
  let tagSaid = '';

  /*
    Every frame, because that is when the client makes a tag: its own update
    draws a new one in white, and this writes its colour in the same frame or
    the next, rather than up to a party tick later. Only a tag whose id or
    wanted colour changed is written, so a frame with nothing new is a read of
    a small table and no calls at all.
  */
  sp.on('update', guard('name tags', () => {
    const tags = nameTags();
    if (!tags) { return; }
    let hideAll = false;
    try { hideAll = !!globalThis.thornswoodHideAllNames; } catch (e) { hideAll = false; }
    const seen = {};
    let wrote = 0;
    for (const key in tags) {
      if (!Object.prototype.hasOwnProperty.call(tags, key)) { continue; }
      const textId = tags[key];
      if (textId === undefined || textId === null) { continue; }
      const hex = Number(key).toString(16);
      seen[hex] = true;
      const colour = (hideAll || tagHide[hex]) ? 'hidden' : (tagParty[hex] ? 'party' : 'plain');
      const had = tagWrote[hex];
      if (had && had.id === textId && had.colour === colour) { continue; }
      // A brand new tag that should be plain already is: the client made it white.
      if (colour !== 'plain' || (had && had.id === textId)) {
        try { sp.setTextColor(textId, TAG_COLOURS[colour]); wrote++; }
        catch (e) { say('name tag: setTextColor threw for ' + hex + ': ' + e); continue; }
      }
      tagWrote[hex] = { id: textId, colour: colour };
    }
    // A tag the client threw away is forgotten, so its next one is new.
    for (const hex in tagWrote) {
      if (!Object.prototype.hasOwnProperty.call(tagWrote, hex)) { continue; }
      if (!seen[hex]) { delete tagWrote[hex]; }
    }
    if (wrote) {
      const said = Object.keys(tagWrote).filter(h => tagWrote[h].colour !== 'plain')
        .map(h => h + ' ' + tagWrote[h].colour).sort().join(', ');
      if (said !== tagSaid) { tagSaid = said; say('name tags: ' + (said || 'all plain')); }
    }
  }));

  function markerFor(hex, name) {
    if (partyMarks[hex]) { return partyMarks[hex]; }
    let ref = null;
    try {
      const base = sp.Form.from(sp.Game.getFormEx(MAP_MARKER_BASE));
      if (!base) { return null; }
      const pc = sp.Game.getPlayer();
      if (!pc) { return null; }
      // Not persistent: a marker that outlived the session would be a
      // permanent pin on everybody's map with nothing behind it.
      ref = pc.placeAtMe(base, 1, false, false);
      if (!ref) { return null; }
      try { ref.setDisplayName(name, true); } catch (e) { }
      // false: no fast travel. Somebody's position is a thing to walk to.
      try { ref.addToMap(false); } catch (e) { }
      partyMarks[hex] = ref;
      say('put a map marker down for ' + name);
    } catch (e) {
      say('could not place a map marker for ' + name + ': ' + e);
      return null;
    }
    return ref;
  }

  function dropMarker(hex) {
    const ref = partyMarks[hex];
    delete partyMarks[hex];
    if (!ref) { return; }
    try {
      // disable first, so it stops drawing even if the delete is refused.
      const off = ref.disable(false);
      if (off && typeof off.then === 'function') { off.then(function () { }, function () { }); }
      const gone = ref.delete();
      if (gone && typeof gone.then === 'function') { gone.then(function () { }, function () { }); }
    } catch (e) { }
  }

  sp.on('update', guard('party markers', () => {
    const now = Date.now();
    if (now - partyAt < PARTY_EVERY) { return; }
    partyAt = now;

    const list = partyList();
    const want = {};
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      if (!row || !row.a) { continue; }
      want[String(row.a)] = row;
    }

    tagWants(want);

    // A marker for everybody in the party, moved to where the server last
    // said they were.
    for (const hex in want) {
      if (!Object.prototype.hasOwnProperty.call(want, hex)) { continue; }
      const row = want[hex];
      const ref = markerFor(hex, String(row.n || 'somebody'));
      if (!ref) { continue; }
      const pos = row.p || [0, 0, 0];
      try {
        const moved = ref.setPosition(Number(pos[0]) || 0, Number(pos[1]) || 0,
                                      Number(pos[2]) || 0);
        if (moved && typeof moved.then === 'function') { moved.then(function () { }, function () { }); }
      } catch (e) { }
    }

    // And nothing left behind for somebody who has gone.
    for (const hex in partyMarks) {
      if (!Object.prototype.hasOwnProperty.call(partyMarks, hex)) { continue; }
      if (want[hex]) { continue; }
      say('taking the map marker back for ' + hex);
      dropMarker(hex);
    }

    /*
      The overlay draws the strip, so it needs the same list. Handed over
      rather than fetched: the page has no way to read a plugin's variables,
      and this is already the one place that knows when the list changed.
    */
    const sig = JSON.stringify(list);
    if (sig !== partySaid) {
      partySaid = sig;
      T.js('try{window.thornswoodParty&&window.thornswoodParty.setWhere&&' +
           'window.thornswoodParty.setWhere(' + JSON.stringify(list) + ');}catch(e){}');
    }
  }));

  /*
    Words above a head, an emote's name on that same line, and the
    speaking mark. The name tag is the client's, and this does not
    touch it: hiding a name leaves the words and the mark where they
    are. One line at a time, for six seconds. The mark is not words.

    THE MARK IS LIVE, the way the microphone at the bottom of your own
    screen is (#2474, Patrick, 12 Oct: "it should be live and reflective
    like the one on your screen"). It is up while their talk key is down,
    gone when it is up, and while it is up it breathes on the same beat as
    yours: full to 58% and back over 1.15 seconds (twPulse in
    thornswood-voice.js). Its colour is the distance they are speaking at,
    the same three colours your own microphone takes while you speak
    (docs/systems/voice.md): whisper pale blue, ordinary white, yell amber.
    Never the party's green, which is the name's alone. It is a round dot
    out of Barlow-SemiBold, Thornswood's own sprite font from the OFL face
    (game\ours, scripts\mods\Build-SpriteFont.py), because the asterisk in
    the client's own Tavern was eleven pixels high. Until #1317 it was
    DIN-Pro-bold, a picture of a commercial face nobody may hand on.
  */
  const HEAD_MS = 6000;
  const HEAD_COLOUR = [0.95, 0.91, 0.82, 0.95];
  const MARK_COLOUR = {
    whisper: [0.62, 0.78, 0.95, 0.95],
    local: [1, 1, 1, 0.95],
    yell: [0.93, 0.68, 0.22, 0.95]
  };
  const MARK_TEXT = '\u2022';            // a bullet, in Barlow-SemiBold.spritefont
  const MARK_FONT = 'Barlow-SemiBold';   // game\ours\Data\Platform\Fonts (#1317)
  const MARK_SIZE = 1.8;                 // nine pixels of dot at 1.0, so sixteen
  const MARK_BEAT_MS = 1150;             // twPulse's 1.15s
  const MARK_LOW = 0.58;                 // twPulse's low point
  const overheadHeads = {};
  const overheadMarks = {};
  let overheadScreen = [1920, 1080];
  let overheadScreenAt = 0;

  function overheadDrop(rec) {
    if (!rec || !rec.id) { return; }
    try {
      if (sp.getTextString(rec.id) === rec.said) { sp.destroyText(rec.id); }
    } catch (e) { }
    rec.id = 0;
    rec.said = '';
  }

  /*
    font and size are for the mark (MARK_FONT, MARK_SIZE); words leave them
    out and keep the client's Tavern at half size. The colour is written
    whenever it is not the one last written, which is what lets the mark
    breathe and lets it change colour when the speaker changes distance
    without being made again.
  */
  function overheadPut(rec, x, y, text, colour, font, size) {
    if (rec.id) {
      let ours = false;
      try { ours = sp.getTextString(rec.id) === rec.said; } catch (e) { ours = false; }
      if (ours) {
        try {
          if (text !== rec.said) { sp.setTextString(rec.id, text); rec.said = text; }
          sp.setTextPos(rec.id, x, y);
          if (String(colour) !== rec.colour) { sp.setTextColor(rec.id, colour); rec.colour = String(colour); }
          return;
        } catch (e) { }
      }
      rec.id = 0;
    }
    try {
      rec.id = sp.createText(x, y, text, colour);
      rec.said = text;
      rec.colour = String(colour);
      if (font) { try { sp.setTextFont(rec.id, font); } catch (e3) { } }
      try { sp.setTextSize(rec.id, size || 0.5); } catch (e2) { }
    } catch (e) {
      rec.id = 0;
      rec.said = '';
    }
  }

  /*
    THE SERVER'S FORM ID IS NOT THIS MACHINE'S (#2474). Words and marks come
    keyed by the actor id the server knows, out of the voice feed (the
    gamemode's voiceFeed sends mp's own id). The character standing in front
    of you is a reference the client placed itself, with an id this machine
    gave it, and the two are not the same number: the same split #1275 found
    for the crosshair, which is why the look prompt converts the other way
    through thornswoodSocialServerId. Looking the server's id up as if it
    were this machine's found nobody, or somebody else, so no mark and no
    words ever stood over another person. The client converts it
    (remoteIdToLocalId in worldViewMisc.ts), handed out by the gamemode's
    near script as thornswoodSocialClientId.
  */
  function localRef(serverId) {
    const id = Number(serverId) || 0;
    if (!id) { return null; }
    let local = 0;
    try {
      const convert = globalThis.thornswoodSocialClientId;
      local = typeof convert === 'function' ? (Number(convert(id >>> 0)) || 0) : 0;
    } catch (e) { local = 0; }
    if (!local) { return null; }
    try { return sp.ObjectReference.from(sp.Game.getFormEx(local >>> 0)); }
    catch (e) { return null; }
  }

  /* The head, in screen pixels, or null when it is behind the camera
     or not loaded. Your own line uses the character you are playing. */
  function overheadPoint(key) {
    let refr = null;
    try {
      if (key === 'self') { refr = sp.Game.getPlayer(); }
      else { refr = localRef(key); }
    } catch (e) { refr = null; }
    if (!refr) { return null; }
    let x = 0, y = 0, z = 0, node = false;
    try {
      x = sp.NetImmerse.getNodeWorldPositionX(refr, 'NPC Head [Head]', false);
      y = sp.NetImmerse.getNodeWorldPositionY(refr, 'NPC Head [Head]', false);
      z = sp.NetImmerse.getNodeWorldPositionZ(refr, 'NPC Head [Head]', false);
      node = !(x === 0 && y === 0 && z === 0);
    } catch (e) { node = false; }
    if (!node) {
      try {
        x = refr.getPositionX();
        y = refr.getPositionY();
        z = refr.getPositionZ() + 128;
      } catch (e2) { return null; }
    } else {
      z += 32;
    }
    let p = null;
    try { p = sp.worldPointToScreenPoint([x, y, z]); } catch (e) { return null; }
    const head = p && p[0];
    if (!head || !(head[2] > 0)) { return null; }
    const w = overheadScreen[0], h = overheadScreen[1];
    return {
      x: Math.round(head[0] * w),
      y: Math.round((1 - head[1]) * h)
    };
  }

  /*
    The chat's and voice's messages for the lines above heads: 'head:' with
    the words somebody said near you, 'headclear:' when staff silence them,
    and 'marks:' with who is speaking. True when the message was one of
    those, so the browserMessage handler below returns before its last line,
    which logs whatever nothing took (#3941). These carry other people's
    words and ids, and thornswood-front.log goes up with the session's logs.
    They used to have a browserMessage listener of their own, so the main
    one never knew they were taken and logged every one.
  */
  function overheadMessage(what) {
    if (what.indexOf('headclear:') === 0) {
      const pid = Number(what.slice(10)) || 0;
      for (const k in overheadHeads) {
        if (!Object.prototype.hasOwnProperty.call(overheadHeads, k)) { continue; }
        if (Number(overheadHeads[k].profile) !== pid) { continue; }
        overheadDrop(overheadHeads[k]);
        delete overheadHeads[k];
      }
      return true;
    }
    if (what.indexOf('head:') === 0) {
      let doc = null;
      try { doc = JSON.parse(what.slice(5)); } catch (e) { doc = null; }
      if (!doc || !doc.who || !doc.text) { return true; }
      const key = String(doc.who);
      const had = overheadHeads[key];
      if (had && had.text !== String(doc.text)) { overheadDrop(had); }
      overheadHeads[key] = {
        text: String(doc.text),
        profile: Number(doc.profile) || 0,
        until: Date.now() + HEAD_MS,
        id: had && had.text === String(doc.text) ? had.id : 0,
        said: had && had.text === String(doc.text) ? had.said : ''
      };
      return true;
    }
    if (what.indexOf('marks:') === 0) {
      let list = null;
      try { list = JSON.parse(what.slice(6)); } catch (e) { list = null; }
      if (!Array.isArray(list)) { return true; }
      const want = {};
      for (let i = 0; i < list.length; i++) {
        const row = list[i];
        if (!row || !row.a) { continue; }
        want[String(row.a)] = row.m === 'whisper' || row.m === 'yell' ? row.m : 'local';
      }
      for (const k in overheadMarks) {
        if (!Object.prototype.hasOwnProperty.call(overheadMarks, k)) { continue; }
        if (want[k]) { overheadMarks[k].mode = want[k]; continue; }
        overheadDrop(overheadMarks[k]);
        delete overheadMarks[k];
      }
      for (const k in want) {
        if (!Object.prototype.hasOwnProperty.call(want, k)) { continue; }
        if (!overheadMarks[k]) { overheadMarks[k] = { mode: want[k], id: 0, said: '' }; }
      }
      return true;
    }
    return false;
  }

  sp.on('update', guard('overhead', () => {
    const now = Date.now();
    let any = false;
    for (const k in overheadHeads) {
      if (!Object.prototype.hasOwnProperty.call(overheadHeads, k)) { continue; }
      if (now >= overheadHeads[k].until) {
        overheadDrop(overheadHeads[k]);
        delete overheadHeads[k];
        continue;
      }
      any = true;
    }
    for (const k in overheadMarks) {
      if (Object.prototype.hasOwnProperty.call(overheadMarks, k)) { any = true; break; }
    }
    if (!any) { return; }
    if (now - overheadScreenAt > 2000) {
      overheadScreenAt = now;
      let w = 0, h = 0;
      try {
        w = Number(sp.Utility.getINIInt('iSize W:Display')) || 0;
        h = Number(sp.Utility.getINIInt('iSize H:Display')) || 0;
      } catch (e) { }
      if (w && h) { overheadScreen = [w, h]; }
    }
    const seen = {};
    // twPulse: full, down to MARK_LOW halfway through the beat, full again.
    const phase = (now % MARK_BEAT_MS) / MARK_BEAT_MS;
    const breath = MARK_LOW + (1 - MARK_LOW) * (0.5 + 0.5 * Math.cos(phase * 2 * Math.PI));
    function drawOne(key) {
      if (seen[key]) { return; }
      seen[key] = true;
      const words = overheadHeads[key];
      const mark = overheadMarks[key];
      const at = overheadPoint(key);
      if (!at) {
        if (words) { overheadDrop(words); }
        if (mark) { overheadDrop(mark); }
        return;
      }
      if (words) { overheadPut(words, at.x, at.y - 28, words.text, HEAD_COLOUR); }
      if (mark) {
        const base = MARK_COLOUR[mark.mode] || MARK_COLOUR.local;
        const colour = [base[0], base[1], base[2], Math.round(base[3] * breath * 100) / 100];
        overheadPut(mark, at.x, at.y - (words ? 46 : 28), MARK_TEXT, colour, MARK_FONT, MARK_SIZE);
      }
    }
    for (const k in overheadHeads) {
      if (Object.prototype.hasOwnProperty.call(overheadHeads, k)) { drawOne(k); }
    }
    for (const k in overheadMarks) {
      if (Object.prototype.hasOwnProperty.call(overheadMarks, k)) { drawOne(k); }
    }
  }));

  /*
   * Jump and sprint.
   *
   * The probe that used to sit here wrote one line per press saying whether
   * the game sent the animation, whether a hook blanked it on the way, or
   * whether the behaviour graph turned it down. It has run, and the answer on
   * 19 September is the same on every press, in Data\Platform\thornswood-
   * front.log:
   *
   *   probe jump: refused, JumpDirectionalStart went through and the
   *   animation graph turned it down. stamina 100 (100%, base 100), speed
   *   369, running yes, in the air no, encumbered no, sneaking no, swimming
   *   no, mounted no, controls on
   *
   *   probe sprint: refused, SprintStart went through and the animation
   *   graph turned it down. stamina 100 (100%, base 100), running yes ...
   *
   * So the key arrives, the game sends the event, nothing blanks it, and the
   * graph says no with full stamina and every control enabled. That is the end
   * of WORKING-NOTES entry 212's diagnosis, which was SunHelm and the server
   * fighting over stamina. Stamina was never the problem.
   *
   * It is not the behaviour files either. The shipped graph was read against
   * the vanilla one it was generated from, Nemesis_0_master.xml, which sits
   * beside it: the two jump transitions, events 637 and 639, carry no
   * condition in either, and the only condition on the sprint transition,
   * event 12, is bSprintOK == 1 in both. A Nemesis patch that gated jump would
   * show up as a condition string in 0_master.hkx that the vanilla file does
   * not have, and the only one there is Precision's, about collision.
   *
   * What is left is the state of the character when the key is pressed, and
   * two states make the graph refuse both events while leaving walking and
   * running working. Neither is ever right for the person's own character:
   *
   *   AI driven   the character is handed to the AI, which walks it where the
   *               keys say and has no jump and no sprint in it. There is no
   *               getter, which is why it has survived every check in this
   *               file, and whoever turns it on is the one meant to turn it
   *               off, so anything that throws or disconnects leaves it on.
   *   IsNPC       a graph variable. Set, the graph takes the branch written
   *               for everybody who is not the person playing, and that branch
   *               has no jump or sprint transition to take.
   *
   * Both are put back where they belong on a two second heartbeat.
   *
   * THAT WAS NOT IT, and this is written here rather than tidied away because
   * the next person will otherwise have the same idea. 1.1.53 shipped the two
   * corrections above and jump and sprint are exactly as broken. The probe
   * lines from that build say why they cannot have been the cause:
   *
   *   jump: refused, JumpDirectionalStart went through and the animation graph
   *   turned it down. stamina 100 (100%), speed 369, running yes, in the air
   *   no, bSprintOK yes, IsNPC no, bIsSynced no, bAnimationDriven no,
   *   controls on
   *
   * Every gate reads clear and both events are still refused. The corrections
   * stay because AI driven has no getter and nothing else keeps it off, but
   * they are not a fix for this and must not be reported as one.
   *
   * #2387, 16 October: the corrections are gone. The real cause was the other
   * launcher's build of MpClientPlugin.dll, replaced by the fork's own client
   * on 20 September (1.1.61.1), after which jump and sprint work. Nothing in
   * the fork writes IsNPC, bSprintOK or AI driven on the local character, and
   * no log since has a line saying a correction had to act. The heartbeat that
   * cleared IsNPC, the per-frame clear and the held sprint gate are removed
   * rather than kept as insurance: a flag put back on a timer hides the next
   * real cause. The probe below still names any gate that reads wrong.
   *
   * The useful part is bSprintOK. It is the ONLY condition on the sprint
   * transition, in 0_master and mt_behavior both. A transition being evaluated
   * cannot refuse with its only condition satisfied, so that transition is not
   * being evaluated at all: the state machine holding it is not the active one,
   * and the jump transitions live in the same place. Which is why the state
   * line now carries bIsInMT, IsFirstPerson, bAttached and currentDefaultState,
   * the four things the shipped graph uses to decide which branch is live.
   *
   * One thing ruled out cheaply and worth not repeating: the behaviour files
   * in the Thornswood game folder are byte for byte the ones in the Steam copy
   * Vortex deploys into, so this is not the folder the launcher builds.
   *
   * That does NOT mean go and try it in Skyrim through Steam. Steam updates
   * its copy on launch and every one of these servers runs a downgraded exe,
   * so that test costs the install, a re-downgrade and an Anniversary upgrade
   * nobody asked for. It was suggested here once and it was wrong.
   *
   * The four variables above answer the same question from an ordinary
   * session. bIsInMT reading no while running means the character is not in
   * the branch that holds jump and sprint, which makes this the graph. All
   * four reading normal while both events are still refused means the graph is
   * in the right place and something between the key and the graph is doing
   * it, which makes it this server. If an offline run is ever genuinely
   * needed, it is this folder's own skse64_loader.exe with MpClientPlugin.dll
   * moved aside under Checks.OffSuffix, and never Steam's copy.
   *
   * bSprintOK is held open separately, while the sprint key is down and
   * Skyrim's own rule says it should be: it is the whole of the game's
   * decision about sprinting and the one condition the graph actually reads.
   *
   * Dying, sitting in anything and riding are left alone. A cart ride is the
   * one time the AI is supposed to have the character, and it is furniture, so
   * notOurs() already names it.
   *
   * The probe stays, quieter. A press that jumps writes nothing; a press the
   * graph still refuses writes one line with the gates beside it, so a fix
   * that stops working says so instead of going quiet.
   */
  const PROBE_WINDOW_MS = 800;    // how long a key press waits for its animation
  const PROBE_GAP_MS = 1500;      // one line per action this often, however hard it is mashed
  const probeSeen = [];           // { name, out, ok, at }, from the hook
  const probePresses = [];        // { kind, at, state }, from the keys
  const probeLast = { jump: 0, sprint: 0 };
  const probeKeys = { jump: -1, sprint: -1, at: 0 };
  // A hook that never runs or always throws would make every press read
  // "no event", which is a verdict. So every line says how the hook is doing.
  let probeHookCalls = 0;
  let probeHookErrors = 0;
  /*
    And whether the flag the whole verdict rests on is ever true.

    "refused" means animationSucceeded came back false. A build where that
    property was not wired would answer false for every event in the game and
    every press would read "refused", which is a diagnosis made of nothing. The
    string is in SkyrimPlatformImpl.dll on this build, so it is real here, but
    a count costs one integer and settles it from the log instead of from a
    grep over a DLL that ships from somewhere else and can change under us.

    Any event at all counts, not only jump and sprint: JumpLand and JumpFall
    come through constantly and those succeed in a game where anything works.
    All-false across thousands is the instrument lying, not the graph refusing.
  */
  let probeHookOk = 0;
  let probeHookNo = 0;
  let probeTallyAt = 0;

  function probeStart(kind, name) {
    return kind === 'jump' ? /^Jump(Standing|Directional)Start/i.test(name) : name === 'SprintStart';
  }

  try {
    // 0x14 to 0x14 is your own character and nobody else's.
    sp.hooks.sendAnimationEvent.add({
      enter: function (ctx) {
        probeHookCalls++;
        try {
          const name = String(ctx.animEventName || '');
          // Empty means a hook before this one already blanked it.
          if (name === '' || /^Jump/i.test(name) || name === 'SprintStart') {
            ctx.storage.set('thornswoodProbe', name);
          }
        } catch (e) { probeHookErrors++; }
      },
      leave: function (ctx) {
        try {
          // Every event that passes through, not only the ones kept below: the
          // tally is about whether the flag answers at all.
          if (ctx.animationSucceeded) { probeHookOk++; } else { probeHookNo++; }
          if (!ctx.storage.has('thornswoodProbe')) { return; }
          probeSeen.push({
            name: ctx.storage.get('thornswoodProbe'),
            out: String(ctx.animEventName || ''),
            ok: !!ctx.animationSucceeded,
            at: Date.now()
          });
          if (probeSeen.length > 32) { probeSeen.shift(); }
        } catch (e) { probeHookErrors++; }
      }
    }, 0x14, 0x14);
  } catch (e) {
    log('probe: could not hook animation events:', e);
  }

  function probeVerdict(p) {
    let blanked = false;
    for (const s of probeSeen) {
      if (s.at < p.at - 100 || s.at > p.at + PROBE_WINDOW_MS) { continue; }
      if (probeStart(p.kind, s.name)) {
        if (s.out === '') { return 'cancelled, a hook blanked ' + s.name; }
        if (!s.ok) { return 'refused, ' + s.name + ' went through and the animation graph turned it down'; }
        return 'played ' + s.name;
      }
      if (s.name === '') { blanked = true; }
    }
    if (blanked) { return 'cancelled, an animation was blanked before this file saw its name'; }
    return 'no event, the game never sent the ' + p.kind + ' animation';
  }

  /* A graph variable a build might not have must not take the caller down
     with it. False is the answer that makes everything below do nothing. */
  function varBool(pc, name) {
    try { return !!pc.getAnimationVariableBool(name); } catch (e) { return false; }
  }

  /* The same read for the log, where "not in this build" and "no" are not the
     same answer and telling them apart is the whole point of the line. */
  function varText(pc, name) {
    try { return pc.getAnimationVariableBool(name) ? 'yes' : 'no'; } catch (e) { return 'unknown'; }
  }

  function varInt(pc, name) {
    try { return String(pc.getAnimationVariableInt(name)); } catch (e) { return 'unknown'; }
  }

  // ==== broken limbs (#1383) ====
  /*
    A BROKEN LEG REFUSES SPRINT, the half of a break that is not an actor
    value. docs/systems/injury.md: "A leg: ... sprint is refused." The server
    keeps the break on the character and its screen script hands this file
    globalThis.thornswoodBrokenLimbs, { leg }, the same way it hands
    thornswoodHurtCare. The -8 speed and the -0.15 melee already ride on the
    skills panel, and a broken arm's dearer block is charged by the server
    when it charges the block (gamemode.js, BLOCK.brokenArm), so nothing of
    the arm is done here.

    bSprintOK is the only condition on the sprint transition (see
    holdSprintGate below, measured on 20 September), so with a broken leg the
    gate is held SHUT while the sprint key is down instead of open, and a
    sprint already running is stopped. The game's own refusals work the same
    way: over encumbered, out of stamina.

    Both callers run under guard(), so a call the game refuses reaches the
    guard's log rather than being swallowed here. Self contained, with sp
    handed in, so tests/test-1383-limbs-brews.js can run it over a fake sp.
  */
  const brokenLimbs = (function (sp) {
    const TELL_EVERY_MS = 30000;
    let toldLegAt = 0;

    function leg() {
      const l = globalThis.thornswoodBrokenLimbs;
      return !!(l && l.leg);
    }

    /* Shut the sprint gate on a broken leg. True when it did, so the caller
       does not hold the gate open again on the same frame. */
    function refuseSprint(pc) {
      if (!pc || !leg()) { return false; }
      if (pc.getAnimationVariableBool('bSprintOK')) { pc.setAnimationVariableBool('bSprintOK', false); }
      if (pc.isSprinting()) { sp.Debug.sendAnimationEvent(pc, 'SprintStop'); }
      const now = Date.now();
      if (now - toldLegAt > TELL_EVERY_MS) {
        toldLegAt = now;
        sp.Debug.notification('Your broken leg will not take a sprint.');
      }
      return true;
    }

    return { refuseSprint: refuseSprint, leg: leg };
  })(sp);
  // ==== end broken limbs ====

  /**
   * A broken leg holds the sprint gate shut while the sprint key is down
   * (#1383). bSprintOK is the only condition on the sprint transition, in
   * 0_master and in mt_behavior both, so with it shut SprintStart is refused
   * however much stamina there is. Nothing here holds the gate open any more
   * (#2387): that chased another launcher's client, which the fork replaced.
   */
  let sprintHeldSince = 0;   // while the sprint key is down, and only then
  function holdSprintShut() {
    if (!sprintHeldSince || !brokenLimbs.leg()) { return; }
    // A release this file never saw, because a menu or the wheel took the
    // keyboard mid press. Eight seconds is longer than anybody sprints in one
    // hold and short enough that it cannot stay stuck.
    if (Date.now() - sprintHeldSince > 8000) { sprintHeldSince = 0; return; }
    brokenLimbs.refuseSprint(sp.Game.getPlayer());
  }

  function probeState() {
    let pc = null;
    try { pc = sp.Game.getPlayer(); } catch (e) { pc = null; }
    if (!pc) { return 'no character'; }
    const bits = [];
    const yn = (b) => (b ? 'yes' : 'no');
    function ask(label, fn) {
      try { bits.push(label + ' ' + fn()); } catch (e) { bits.push(label + ' unknown'); }
    }
    ask('stamina', () => Math.round(pc.getActorValue('Stamina')) + ' (' +
      Math.round(pc.getActorValuePercentage('Stamina') * 100) + '%, base ' +
      Math.round(pc.getBaseActorValue('Stamina')) + ')');
    ask('regen', () => pc.getActorValue('StaminaRate') + ' x ' + pc.getActorValue('StaminaRateMult') + '%');
    ask('speed', () => Math.round(pc.getAnimationVariableFloat('Speed')));
    ask('running', () => yn(pc.isRunning()));
    ask('sprinting', () => yn(pc.isSprinting()));
    ask('in the air', () => yn(pc.getAnimationVariableBool('bInJumpState')));
    ask('encumbered', () => yn(pc.isOverEncumbered()));
    ask('sneaking', () => yn(pc.isSneaking()));
    ask('swimming', () => yn(pc.isSwimming()));
    ask('mounted', () => yn(pc.isOnMount()));
    ask('weapon out', () => yn(pc.isWeaponDrawn()));
    // The gates themselves, so a line that says "refused" also says which one
    // said no rather than leaving the next reader to run the whole thing again.
    ask('bSprintOK', () => varText(pc, 'bSprintOK'));
    ask('IsNPC', () => varText(pc, 'IsNPC'));
    ask('bIsSynced', () => varText(pc, 'bIsSynced'));
    ask('bAnimationDriven', () => varText(pc, 'bAnimationDriven'));
    /*
      Which branch of the graph the character is actually in.

      Those four above all came back clear on 19 September and both events were
      still refused, with bSprintOK yes and SprintStart turned down anyway. That
      is the interesting part: bSprintOK is the ONLY condition on the sprint
      transition, in 0_master and in mt_behavior both, so a transition that is
      being evaluated cannot refuse with it set. It follows that the transition
      is not being evaluated, which means the state machine holding it is not the
      active one, and the jump transitions live in the same place.

      These four are what decide that. bIsInMT is a condition in the shipped
      graph in as many words. bAttached and currentDefaultState gate the attach
      of the sub-behaviours in four separate conditions. IsFirstPerson picks
      between two whole branches. None of them is forced here: they belong to
      the graph and writing them would be lying to it. They are read so the next
      line says which branch the character was in when it said no.
    */
    ask('bIsInMT', () => varText(pc, 'bIsInMT'));
    ask('IsFirstPerson', () => varText(pc, 'IsFirstPerson'));
    ask('bAttached', () => varInt(pc, 'bAttached'));
    ask('currentDefaultState', () => varInt(pc, 'currentDefaultState'));
    const theirs = notOurs();
    if (theirs) { bits.push(theirs); }
    const off = readControlsNow();
    bits.push(off.length ? 'controls off [' + off.join(', ') + ']' : 'controls on');
    return bits.join(', ');
  }

  sp.on('buttonEvent', guard('jump and sprint keys', (e) => {
    // By the game's own name for the control, so a rebound key still counts.
    // The key codes are the fallback for an event that arrives without one.
    let kind = '';
    if (e.userEventName === 'Jump' || (!e.userEventName && e.code === probeKeys.jump)) { kind = 'jump'; }
    if (e.userEventName === 'Sprint' || (!e.userEventName && e.code === probeKeys.sprint)) { kind = 'sprint'; }
    if (!kind) return;

    // Sprint is a hold, not a press: a broken leg holds the gate shut for as
    // long as somebody is holding the key (#1383).
    if (kind === 'sprint') {
      if (e.isUp) { sprintHeldSince = 0; }
      else if (e.isDown && !sprintHeldSince) { sprintHeldSince = Date.now(); }
      // A broken leg (#1383): shut on the press itself, the frame the graph
      // reads the gate, not only on the next update.
      if (e.isDown && !e.isUp && brokenLimbs.leg()) {
        const legPc = sp.Game.getPlayer();
        if (legPc) { brokenLimbs.refuseSprint(legPc); }
      }
    }

    if (!e.isDown || e.isUp) return;
    // The chat or the wheel has the keyboard, or a menu does: not a jump.
    if (anyClaim() || busyMenuOpen()) return;

    const now = Date.now();
    if (now - probeLast[kind] < PROBE_GAP_MS) return;
    probeLast[kind] = now;
    probePresses.push({ kind: kind, at: now, state: '', moving: true });
  }));

  sp.on('update', guard('jump and sprint', () => {
    const now = Date.now();
    if (now - probeKeys.at > 30000) {
      const first = !probeKeys.at;
      probeKeys.at = now;
      try { probeKeys.jump = sp.Input.getMappedKey('Jump', 0); } catch (e) { }
      try { probeKeys.sprint = sp.Input.getMappedKey('Sprint', 0); } catch (e) { }
      if (first) {
        say('jump and sprint: jump is key ' + probeKeys.jump + ', sprint is key ' +
            probeKeys.sprint + '. Every press writes a line now, the one that worked as ' +
            'well as the one that did not, with which branch of the graph the character ' +
            'was in and how many animations have succeeded at all.');
      }
    }

    holdSprintShut();

    // The character is only fetched on a frame that has a press to resolve.
    let pc = null;
    if (probePresses.length) {
      try { pc = sp.Game.getPlayer(); } catch (e) { pc = null; }
    }

    if (!probePresses.length) return;
    for (const p of probePresses) {
      if (!p.state) {
        p.state = probeState();
        try { p.moving = pc ? pc.getAnimationVariableFloat('Speed') > 1 : true; } catch (e) { p.moving = true; }
      }
    }
    while (probePresses.length && now - probePresses[0].at >= PROBE_WINDOW_MS) {
      const p = probePresses.shift();
      const verdict = probeVerdict(p);
      /*
        A press that worked is written down too, and it was a mistake to hide
        it. The last run wrote nothing but "refused", which reads as a graph
        turning everything down, and it was impossible to tell from the log
        whether this file had ever seen a jump succeed on any machine. One line
        per action per 1.5 s is already the limit, so it is not much noise and
        it is the difference between a measurement and an assumption.
      */
      // A sprint key pressed standing still is Skyrim saying no, not a bug, and
      // it is most of what anybody presses. That one still goes unsaid.
      if (p.kind === 'sprint' && !p.moving && verdict.indexOf('no event') === 0) { continue; }
      say(p.kind + ': ' + verdict + '. ' + p.state + '. hook saw ' +
          probeHookCalls + ' events, ' + probeHookOk + ' of them succeeded and ' +
          probeHookNo + ' did not' +
          (probeHookErrors ? ', and threw ' + probeHookErrors + ' times' : ''));
    }
  }));

  /*
    ---------------------------------------------------- no bounty for anything

    Patrick, 11 October (#502): "there should be no bounties at all added
    when killing NPCs". Then on 12 October, the same issue: no bounty for
    anything, killing, attacking, theft, pickpocketing or trespass, "the
    whole bounty system should be removed in its entirety". Guards are
    people now, and no NPC guard comes back.

    WHERE A BOUNTY CAME FROM, measured on 12 October. Nothing Thornswood
    wrote adds one: no line of the gamemode, these plugins or the fork's
    server calls modCrimeGold or setCrimeGold. It is Skyrim's own crime
    system, running here in each person's game. A crime against a member of
    a faction that tracks crime, or against something it owns, adds that
    faction's gold for the crime to its bounty: murder, assault, trespass,
    pickpocketing, theft, escaping jail and being seen to turn into a
    werewolf. A faction on Use Defaults takes the amounts from the game's
    settings and the rest carry their own (CrimeFactionReach, the Companions,
    the Skaal), so zeroing the settings would have left some, and the answer
    is on each faction instead: its six ignore flags, which tell the game a
    crime of that kind against a member is not a crime against it at all.
    Every faction that tracks crime is listed, 83 of them, read out of the
    load order by scripts\dev\Build-CrimeTable.py; game\data\crime-factions.json
    says what each one charged. Escape has no flag, and the game adds it only
    to somebody it jailed, which it does to nobody here: there is no NPC
    guard, and the json lists every script that sends anybody to jail or adds
    gold by itself, and why none of them can run.

    WHEN. A faction's flags are the game's own record, so they are set once
    a game is loaded, which is when the world this session plays in starts,
    and before that no crime can be committed. Each one is read back and the
    log says how many took all six, so the line is a measurement and not a
    hope.
  */
  // ==== NO_BOUNTY_FACTIONS, generated ====
  // One row a faction: its form id in its plugin, the plugin, its editor id.
  // Generated by scripts\dev\Build-CrimeTable.py; do not hand edit.
  const NO_BOUNTY_FACTIONS = [
    [0x5211, "HearthFires.esm", "BYOHHousecarlFalkreathCrimeFaction"],
    [0x5212, "HearthFires.esm", "BYOHHousecarlHjaalmarchCrimeFaction"],
    [0x5213, "HearthFires.esm", "BYOHHousecarlPaleCrimeFaction"],
    [0x48362, "Skyrim.esm", "CompanionsFaction"],
    [0x10b1fc, "Skyrim.esm", "CrimeFactionCidhnaMine"],
    [0x267e3, "Skyrim.esm", "CrimeFactionEastmarch"],
    [0x28170, "Skyrim.esm", "CrimeFactionFalkreath"],
    [0x10f72b, "Skyrim.esm", "CrimeFactionGreybeard"],
    [0x29db0, "Skyrim.esm", "CrimeFactionHaafingar"],
    [0x2816d, "Skyrim.esm", "CrimeFactionHjaalmarch"],
    [0x28848, "Skyrim.esm", "CrimeFactionImperial"],
    [0x10cee9, "Skyrim.esm", "CrimeFactionKhajiitCaravans"],
    [0x2b036, "Skyrim.esm", "CrimeFactionNull"],
    [0x28713, "Skyrim.esm", "CrimeFactionOrcs"],
    [0x2816e, "Skyrim.esm", "CrimeFactionPale"],
    [0x2816c, "Skyrim.esm", "CrimeFactionReach"],
    [0x2816b, "Skyrim.esm", "CrimeFactionRift"],
    [0x28849, "Skyrim.esm", "CrimeFactionSons"],
    [0x10a794, "Skyrim.esm", "CrimeFactionThievesGuild"],
    [0x267ea, "Skyrim.esm", "CrimeFactionWhiterun"],
    [0x2816f, "Skyrim.esm", "CrimeFactionWinterhold"],
    [0xed167, "Skyrim.esm", "DA06YamarzCrimeFaction"],
    [0x8942f, "Skyrim.esm", "DA11CannibalFaction"],
    [0x1bdb3, "Skyrim.esm", "DarkBrotherhoodFaction"],
    [0x10fe28, "Skyrim.esm", "DB09TowerFaction"],
    [0xe7c27, "Skyrim.esm", "DBCrimeFactionMaro"],
    [0xedddf, "Skyrim.esm", "DBRecuringContact10CrimeFaction"],
    [0xeddde, "Skyrim.esm", "DBRecuringContact1CrimeFaction"],
    [0xedddd, "Skyrim.esm", "DBRecuringContact2CrimeFaction"],
    [0xedddc, "Skyrim.esm", "DBRecuringContact3CrimeFaction"],
    [0xedddb, "Skyrim.esm", "DBRecuringContact4CrimeFaction"],
    [0xeddda, "Skyrim.esm", "DBRecuringContact5CrimeFaction"],
    [0xeddd9, "Skyrim.esm", "DBRecuringContact6CrimeFaction"],
    [0xeddd8, "Skyrim.esm", "DBRecuringContact7CrimeFaction"],
    [0xeddd7, "Skyrim.esm", "DBRecuringContact8CrimeFaction"],
    [0xeddd6, "Skyrim.esm", "DBRecuringContact9CrimeFaction"],
    [0xe7b9d, "Skyrim.esm", "DBRecuringTarget10CrimeFaction"],
    [0xe7b9e, "Skyrim.esm", "DBRecuringTarget1CrimeFaction"],
    [0xe7b9f, "Skyrim.esm", "DBRecuringTarget2CrimeFaction"],
    [0xe7ba0, "Skyrim.esm", "DBRecuringTarget3CrimeFaction"],
    [0xe7ba1, "Skyrim.esm", "DBRecuringTarget4CrimeFaction"],
    [0xe7ba2, "Skyrim.esm", "DBRecuringTarget5CrimeFaction"],
    [0xe7ba3, "Skyrim.esm", "DBRecuringTarget6CrimeFaction"],
    [0xe7ba4, "Skyrim.esm", "DBRecuringTarget7CrimeFaction"],
    [0xe7ba5, "Skyrim.esm", "DBRecuringTarget8CrimeFaction"],
    [0xe7ba6, "Skyrim.esm", "DBRecuringTarget9CrimeFaction"],
    [0x14b5b, "Dawnguard.esm", "DLC1MothPriestCrimeFaction"],
    [0x137ba, "Dawnguard.esm", "DLC1SeranaCrimeFaction"],
    [0x17f71, "Dawnguard.esm", "DLC1VampireCrimeFaction"],
    [0x145c3, "Dawnguard.esm", "DLC1WE01AttackPlayerFaction"],
    [0x18279, "Dragonborn.esm", "DLC2CrimeRavenRockFaction"],
    [0x1dc61, "Dragonborn.esm", "DLC2dunFrostmoonWerewolvesFaction"],
    [0x38562, "Dragonborn.esm", "DLC2HirelingTeldrynCrimeFaction"],
    [0x31786, "Dragonborn.esm", "DLC2SkaalDialogueFaction"],
    [0x27291, "Dragonborn.esm", "DLC2SkaalShamanFaction"],
    [0x18f9a, "Dragonborn.esm", "DLC2SkaalVillageCitizenFaction"],
    [0x2173a, "Dragonborn.esm", "DLC2SV02ThalmorCrimeFaction"],
    [0x17ebd, "Dragonborn.esm", "DLC2TameDragonFaction"],
    [0x3d126, "Dragonborn.esm", "DLC2ThirskNordCrimeFaction"],
    [0x108232, "Skyrim.esm", "dunPOIWitchAniseCrimeFaction"],
    [0x103aec, "Skyrim.esm", "HirelingBelrandCrimeFaction"],
    [0x103366, "Skyrim.esm", "HirelingErikCrimeFaction"],
    [0x103367, "Skyrim.esm", "HirelingJenassaCrimeFaction"],
    [0x103368, "Skyrim.esm", "HirelingMarcurioCrimeFaction"],
    [0x103369, "Skyrim.esm", "HirelingStenvarCrimeFaction"],
    [0x10336a, "Skyrim.esm", "HirelingVorstagCrimeFaction"],
    [0x10336b, "Skyrim.esm", "HousecarlMarkarthCrimeFaction"],
    [0x10336c, "Skyrim.esm", "HousecarlRiftenCrimeFaction"],
    [0x10336d, "Skyrim.esm", "HousecarlSolitudeCrimeFaction"],
    [0x10336e, "Skyrim.esm", "HousecarlWhiterunCrimeFaction"],
    [0x10336f, "Skyrim.esm", "HousecarlWindhelmCrimeFaction"],
    [0x622e6, "Skyrim.esm", "KarthwastenSilverFishGuards"],
    [0x88ee4, "Skyrim.esm", "MS07BanditFaction"],
    [0x13cab, "Populated Cities Towns Villages Legendary.esp", "ssssDawnstarMercenaryMixHIRELING"],
    [0x13cac, "Populated Cities Towns Villages Legendary.esp", "ssssFalkreathMercenaryMixHIRELING"],
    [0x13cad, "Populated Cities Towns Villages Legendary.esp", "ssssMarkarthMercenaryMixHIRELING"],
    [0x13cae, "Populated Cities Towns Villages Legendary.esp", "ssssMorthalMercenaryMixHIRELING"],
    [0x13caf, "Populated Cities Towns Villages Legendary.esp", "ssssRiftenMercenaryMixHIRELING"],
    [0x13cb0, "Populated Cities Towns Villages Legendary.esp", "ssssSolitudeMercenaryMixHIRELING"],
    [0x13cb1, "Populated Cities Towns Villages Legendary.esp", "ssssWhiterunMercenaryMixHIRELING"],
    [0x13cb2, "Populated Cities Towns Villages Legendary.esp", "ssssWindhelmMercenaryMixHIRELING"],
    [0x13cb3, "Populated Cities Towns Villages Legendary.esp", "ssssWinterholdMageMercenaryMixHIRELING"],
    [0x522b6, "Skyrim.esm", "WIGenericCrimeFaction"],
  ];
  // ==== end NO_BOUNTY_FACTIONS ====
  // Murder, assault, stealing, trespass, pickpocket and werewolf, as the FACT
  // record and SKSE's SetFactionFlag number them.
  const IGNORE_CRIMES = [0x80, 0x100, 0x200, 0x400, 0x2000, 0x10000];

  function noBounty() {
    const took = [], absent = [], refused = [];
    for (let i = 0; i < NO_BOUNTY_FACTIONS.length; i++) {
      const row = NO_BOUNTY_FACTIONS[i];
      let f = null;
      try { f = sp.Faction.from(sp.Game.getFormFromFile(row[0], row[1])); } catch (e) { f = null; }
      if (!f) { absent.push(row[2]); continue; }
      try {
        let all = true;
        for (let j = 0; j < IGNORE_CRIMES.length; j++) {
          f.setFactionFlag(IGNORE_CRIMES[j]);
          if (!f.isFactionFlagSet(IGNORE_CRIMES[j])) { all = false; }
        }
        if (all) { took.push(row[2]); }
        else { refused.push(row[2] + ' (the flags did not stay)'); }
      } catch (e) {
        refused.push(row[2] + ' (' + e + ')');
      }
    }
    say('no bounty for any crime: ' + took.length + ' of ' + NO_BOUNTY_FACTIONS.length +
        ' crime factions now ignore murder, assault, theft, trespass, pickpocketing and werewolves' +
        (absent.length ? '; not in this load order: ' + absent.join(', ') : '') +
        (refused.length ? '; REFUSED: ' + refused.join(', ') : ''));
  }

  sp.on('loadGame', guard('no bounty', noBounty));

  /*
    The town gates are no longer opened here (#2484). Bethesda ships the
    Whiterun main gate (1b1f1) and Riften's two outer leaves (42284, 42286)
    locked, and this used to unlock them every thirty seconds. Thornswood-Last.esp
    (scripts/mods/Build-LastPlugin.py, GATES) now carries the three without
    their lock, so they load unlocked. A claimed gate is still locked by the
    property block's lock script (#615).
  */
  /*
    WHICH MENUS ARE UP, FROM THE GAME'S OWN EVENTS. Issue 1033.

    The pulse below names the open menus when isInMenuMode says there is one.
    It used to find them by asking isMenuOpen for each of these 28 names, one
    after another in the same frame as its other asks, every five seconds
    while any menu was up; the #963 audit measured the pulse's worst single
    call at 122 ms. The game says when a menu opens and closes, so the names are kept
    here as menuOpen and menuClose come, and the pulse reads them without
    asking the game anything.
  */
  const PULSE_MENUS = [
    'Console', 'Console Native UI Menu', 'Loading Menu', 'Main Menu',
    'MessageBoxMenu', 'Dialogue Menu', 'RaceSex Menu', 'InventoryMenu',
    'MagicMenu', 'MapMenu', 'StatsMenu', 'ContainerMenu', 'Journal Menu',
    'Sleep/Wait Menu', 'Crafting Menu', 'Book Menu', 'Lockpicking Menu',
    'Barter Menu', 'FavoritesMenu', 'TweenMenu', 'Fader Menu',
    'LoadWaitSpinner', 'Training Menu', 'GiftMenu', 'Quantity Menu',
    'Tutorial Menu', 'Credits Menu', 'TitleSequence Menu'
  ];
  const pulseMenusUp = {};
  sp.on('menuOpen', guard('pulse menu open', (e) => {
    if (e && e.name) { pulseMenusUp[e.name] = true; }
  }));
  sp.on('menuClose', guard('pulse menu close', (e) => {
    if (e && e.name) { delete pulseMenusUp[e.name]; }
  }));

  sp.on('update', guard('pulse', () => {
    logOwnerOutfitTransition();
    // One pass through the handlers is one frame. See frameWent above.
    frameWent();

    const now = Date.now();
    if (!lastPulse) { lastPulse = now; return; }
    if (now - lastPulse < 5000) { return; }
    lastPulse = now;

    let focused = 'unknown';
    try { focused = sp.browser.isFocused() ? 'yes' : 'no'; } catch (e) { }
    let menu = 'unknown';
    try { menu = sp.Utility.isInMenuMode() ? 'yes' : 'no'; } catch (e) { }

    // Which menu, when there is one.
    //
    // isInMenuMode says a menu is open and says nothing about what. The last
    // run showed it turning on at the exact moment the keyboard died, which
    // rules out everything focus related and makes the name of that menu the
    // whole question: a menu the game opened deliberately is a different bug
    // from a menu that is an artefact of the window losing foreground.
    let names = '';
    if (menu === 'yes') {
      const open = PULSE_MENUS.filter(function (n) { return pulseMenusUp[n] === true; });
      names = open.length ? (' [' + open.join(', ') + ']') : ' [none of the usual ones]';
    }

    // Read now, every flag, whatever else is going on (#2620). A menu or a
    // chair switching some off is named here like anything else; the menu
    // part of the line says which.
    const controls = pulseControls();

    /*
      Which window Windows is sending the keys to.
     
      This is the last thing the pulse could not see, and it is the difference
      between a bug and somebody alt tabbing. Both look identical from in here:
      no menu, no browser focus, controls on, and either no keys arriving at all
      or keys arriving that the game does nothing with. DirectInput hands the
      keyboard back the instant the window stops being the foreground one, so
      the game goes deaf either way.
     
      So it is asked outright, and the answer is named in the log. The game
      being behind one of our own windows is a bug and gets fixed below. The
      game being behind Discord is a person who alt tabbed and gets left alone.
    */
    let fg = null;
    try {
      if (sp.win32 && typeof sp.win32.foregroundWindow === 'function') {
        fg = sp.win32.foregroundWindow();
      }
    } catch (e) { fg = null; }

    let where = '';
    if (fg && !fg.isGame) {
      const who = fg.ourProcess
        ? 'one of our own windows'
        : ((fg.exe || 'another app') + ', not ours');
      const named = fg.title || fg.className || '';
      where = ', keyboard is going to ' + who + (named ? ' (' + named + ')' : '');
    }

    say('input: ' + keysSeen + ' keys in 5s, browser focus ' + focused +
        ', menu ' + menu + names + controls + where);
    keysSeen = 0;

    /*
      This reports and does nothing else, deliberately.

      It used to call SetForegroundWindow on the game whenever the foreground
      was one of our own windows, on the reasoning that Windows would refuse
      the call in the only case where it would be unwelcome. That was a guess
      dressed up as a safeguard, and it was shipped on a session where the game
      was already freezing. A frozen game holding the cursor clip is bad enough
      on its own; a five second timer repeatedly shoving that window back in
      front took a stuck game and made the whole desktop unusable, mouse
      included.

      Nothing here acts on the keyboard again until the log has actually named
      what takes it. Diagnosing first and acting second is the order that
      should have been used the first time.
    */
  }));

  // ------------------------------------------------ J is our journal alone --
  /*
    J OPENS OUR JOURNAL AND NOTHING ELSE.

    Patrick, 24 September: "also can you make it so when you press j to open
    your journal it only opens our journal and not the vanilla skyrim jounral
    in the background of our journal". J is Skyrim's own Journal key as well
    as ours, so one press opened both: our panel, and the game's Journal Menu
    at its Quests page behind it.

    THE CLIENT KEEPS J FROM THE GAME (issue 1016, keepJournalKey below). A
    plugin cannot: buttonEvent is not a gate, the fork's EventHandler.cpp
    copies each key into an update task and returns kContinue, so the game's
    own MenuControls has the same key untouched and has already asked for its
    menu by the time this file hears J. So the fork's client has a list of
    keys its menu opener does not see (setMenuOpenKeyBlocked), and J goes on
    it while our panel is in. The shut described below is what is left for a
    book that opens anyway, and its log line says when one does.

    And the game's journal cannot be switched off as a whole, because the
    Journal Menu is also what Escape opens, at its System page, which is where
    people change settings and quit (#3127 took saving off it). The journal flag on
    DisablePlayerControls is documented as leaving only the System page of
    the book, which takes the quest log mods still write to away from Escape
    as well.

    So the book is shut the moment it opens, when J opened it, with the same
    TESModPlatform.closeMenu that shuts the console.

    J IS TOLD FROM ESCAPE BY THE GAME'S OWN NAME FOR THE KEY. Every key
    arrives carrying the control it went down as: J is 'Journal' and Escape is
    'Pause' (RE::UserEvents in CommonLibSSE). Only a press of our key that the
    game also took as 'Journal' arms this. Any other key going down disarms
    it, so an Escape pressed after J is Escape's. An Escape that went down in
    the same breath just before J stops J arming at all, because the book
    that opens next may be the System page. Either way the System page is
    never the book that gets shut.

    The name carries a rebind too. Somebody who moved the game's journal off
    J keeps it on their own key, untouched, and somebody who moved ours off J
    (the Journals row in the launcher's keys, JournalKey in Thornswood.ini)
    gets the game's journal on J as before.

    Only while our own panel is in. If thornswood-journal.js never mounted, J
    opens the game's journal the way it always did rather than nothing.

    The quest log is still there: Escape opens the same book, and its Quests
    page is one of the tabs beside System.

    tools\test-journal-key.js runs this block and the key handler below
    against a pretend game kept in the fork's order of events.
  */
  const JOURNAL_MENU = 'Journal Menu';
  // The book opens in the same frame as J or the next; the rest is room for
  // a slow frame. Any key going down in between ends it sooner.
  const JOURNAL_PRESS_MS = 1000;
  // An Escape this close before J went down with it.
  const JOURNAL_PAUSE_MS = 150;
  // A book still up this long after it was shut is asked once more, and one
  // still up after the second is given up on and said in the log.
  const JOURNAL_AGAIN_MS = 1000;
  const JOURNAL_WATCH_MS = 2000;
  let journalPanelIn = false;
  let journalPressAt = 0;
  let journalPauseAt = 0;
  let journalShutAt = 0;
  let journalLag = 0;
  let journalAsked = 0;
  let journalGone = false;
  // When the book's menuOpen came (0 once its menuClose has), and whether it
  // was up already when J was heard. See the note on shutJournalForJ below.
  let journalOpenAt = 0;
  let journalUpAtPress = false;

  // The key code is the fallback for an event that arrives without a name,
  // the same as the jump and sprint probe.
  function gameJournalPress(e) {
    if (e.userEventName) { return e.userEventName === 'Journal'; }
    try { return sp.Input.getMappedKey('Journal', 0) === e.code; } catch (err) { return false; }
  }

  // Every key that goes down, J included, from the key handler below.
  function journalKeyDown(e) {
    journalPressAt = 0;
    journalUpAtPress = false;
    journalShutAt = 0;
    if (e.userEventName === 'Pause' || (!e.userEventName && e.code === ESC)) {
      journalPauseAt = Date.now();
    }
  }

  // Our J, after journalKeyDown: the game took this same press as its own
  // journal, so the book that opens next is shut.
  function journalKeyPressed(e) {
    if (!journalPanelIn || !gameJournalPress(e)) { return; }
    if (Date.now() - journalPauseAt < JOURNAL_PAUSE_MS) { return; }
    journalPressAt = Date.now();
    // Up already, and new: this J opened it. Shut in the next update (#958,
    // the note on shutJournalForJ below).
    let up = false;
    try { up = !!sp.Ui.isMenuOpen(JOURNAL_MENU); } catch (err) { up = false; }
    journalUpAtPress = up && (!journalOpenAt || Date.now() - journalOpenAt < JOURNAL_PRESS_MS);
  }

  function shutJournal() {
    journalAsked++;
    try { sp.TESModPlatform.closeMenu(JOURNAL_MENU); return true; }
    catch (err) { say('J: closeMenu threw on the game\'s journal: ' + err); return false; }
  }

  sp.on('browserMessage', guard('journal panel', (event) => {
    const a = event && event.arguments;
    if (!a || a[0] !== 'thornswood-front') { return; }
    // The panel opening says it is in as well, for this file coming back
    // after the page had already said ready.
    if (a[1] === 'journal:ready' || a[1] === 'journal:opened') { journalPanelIn = true; }
    // A page that reloads has lost the panel until it is put back.
    if (a[1] === 'bridge is up') { journalPanelIn = false; }
  }));

  /*
    J NEVER REACHES THE GAME'S JOURNAL. Issue 1016.

    Patrick, 28 September, after #958 shut the book in the next update: "Don't
    accept the flash make the game client change." The book was still drawn
    for a frame or two, because the game opens it on the press before any
    plugin hears J.

    The fork's client keeps a list of keys the game's menu opener does not
    see (MenuOpenKeyBlocks in platform_lib, hooked into MenuOpenHandler in
    MenuOpenKeyBlockHook.cpp). While our panel is in and the overlays are
    ready, our key going down as the game's 'Journal' control is on it, so
    the game never asks for its book and nothing is drawn. This file still
    hears J in buttonEvent.

    Only as 'Journal': Escape goes down as 'Pause' and opens the System page
    as always. Somebody who moved the game's journal off J keeps it on their
    key, and somebody who moved ours off J gets the game's journal on J.

    Not while one of the game's own menus is up (KEYBOARD_MENUS, the Journal
    Menu among them): there J is the game's as it always was, which is also
    when the key handler below leaves ours shut. So J in the inventory still
    opens the game's quest log, and J on the System page closes it.

    Checked every frame against a boolean, and the client is told only when
    it changes. null at load, so a reloaded plugin sets the client's list
    whatever an earlier copy left in it.
  */
  let journalKeyKept = null;
  let journalKeySaid = false;
  function keepJournalKey(on) {
    if (journalKeyKept === on) { return; }
    journalKeyKept = on;
    try { sp.setMenuOpenKeyBlocked('Journal', JOURNAL_KEY, on, KEYBOARD_MENUS); }
    catch (err) {
      if (!journalKeySaid) { journalKeySaid = true; say('J: the client could not keep J from the game: ' + err); }
    }
  }

  sp.on('update', guard('journal key kept', () => {
    keepJournalKey(journalPanelIn && !!T.ready);
  }));

  /*
    SHUT AS SOON AS IT IS UP, NOT WHEN ITS menuOpen COMES. Issue 958.

    Patrick on dev, 28 September: "J now opens the vanilla journal first".
    His log from that session: "J: the game's journal opened 37ms after the
    press and was gone 41ms after it was shut". The book is in the game's
    menu stack well before its menuOpen reaches this file (P found the magic
    menu already up at the press in the same log), so waiting for the event
    kept the book on screen for 37ms that did not need to be. So a book that
    is up already when J is heard is shut in the next update, which still
    lets an Escape that went down in the same frame end J's claim first.
    menuOpen stays the path for a book that is not up at the press: one that
    turns up between frames may be Escape's, whose key has not been heard
    yet, and its menuOpen comes after that key does. A book whose menuOpen
    came longer ago than JOURNAL_PRESS_MS was up before J, and is left alone.

    This makes the book's time on screen shorter, not nothing: the game opens
    its book on the same press before any plugin hears it. Since issue 1016
    the client keeps J from the game (keepJournalKey above), so this is only
    for a book that opens anyway.
  */
  // upAlready: the book was up when J was heard, so it opened with the press.
  function shutJournalForJ(upAlready) {
    journalLag = upAlready ? 0 : Date.now() - journalPressAt;
    journalPressAt = 0;
    journalUpAtPress = false;
    journalAsked = 0;
    journalGone = false;
    if (shutJournal()) { journalShutAt = Date.now(); }
  }

  sp.on('menuOpen', guard('journal shut', (e) => {
    if (!e || e.name !== JOURNAL_MENU) { return; }
    journalOpenAt = Date.now();
    if (!journalPressAt) { return; }
    if (Date.now() - journalPressAt > JOURNAL_PRESS_MS) { journalPressAt = 0; return; }
    shutJournalForJ();
  }));

  sp.on('menuClose', guard('journal closed', (e) => {
    if (e && e.name === JOURNAL_MENU) { journalOpenAt = 0; }
  }));

  sp.on('update', guard('journal up', () => {
    if (!journalPressAt || !journalUpAtPress) { return; }
    journalUpAtPress = false;
    let up = false;
    try { up = !!sp.Ui.isMenuOpen(JOURNAL_MENU); } catch (err) { up = false; }
    if (up) { shutJournalForJ(true); }
  }));

  /*
    AFTER THE SHUT: THE BOOK WENT, AND THE CURSOR STAYED WITH OURS.

    Watched for two seconds after a shut and at no other time.

    The book going is measured, not assumed: one line in the log says how
    long after J it opened and how long after the shut it was gone, which is
    the flash somebody might see. A book still up a second after the shut is
    asked once more, because a book left open behind ours is the thing this
    block is for, and one still up after two seconds is said in the log.

    The cursor is not this block's business any more (#2384). The book
    taking the Cursor Menu down with it as it closes, under a panel of ours
    that holds focus, is answered in the fork, from the Cursor Menu's close
    event (BrowserApiTilted.cpp, CursorFocus.h).
  */
  sp.on('update', guard('journal after', () => {
    if (!journalShutAt) { return; }
    const since = Date.now() - journalShutAt;
    try {
      if (sp.Ui.isMenuOpen(JOURNAL_MENU)) {
        if (since > JOURNAL_WATCH_MS) {
          journalShutAt = 0;
          say('J: the game\'s journal is still open ' + since + 'ms after it was shut, asked ' +
              journalAsked + ' times');
        } else if (since > JOURNAL_AGAIN_MS && journalAsked < 2) {
          shutJournal();
        }
        return;
      }
      if (!journalGone) {
        journalGone = true;
        say('J: the game\'s journal opened ' + journalLag + 'ms after the press and was gone ' +
            since + 'ms after it was shut');
      }
      journalShutAt = 0;
    } catch (err) { journalShutAt = 0; }
  }));

  // ---------------------------------------------- mod settings menus (#488)
  /*
    WHAT A MOD SETTINGS MENU CHANGED, SENT TO THE SERVER TO KEEP.

    A classic SkyUI menu keeps its choices in the save, and there is no save
    here, so Apocalypse, AHZmoreHUD, atlas map markers, Skyrim Unbound and
    chfshVariousActions started from their defaults every session (Atlas
    leaves the collection with revision 6, #3649, and its menu is no longer
    kept). What a menu writes into a GLOB record can be read from here and put
    back, and those are the 78 below, out of scripts\mods\Audit-ModMenus.js -v: plugin,
    editor id, and the id inside the plugin, which does not move when the load
    order does. The gamemode keeps the same table (test-mod-settings.js checks
    the two agree) and refuses any name that is not in it.

    READ WHEN THE JOURNAL OPENS AND CLOSES, where the menus live, and once a
    minute for the few a hotkey flips (AHZmoreHUD's widget toggle). Never per
    frame: a read is 78 native calls. Only what moved since the last read is
    sent, as /modset Name=value lines over the chat socket like /place, packed
    under the 400 characters the voice service keeps of a line.

    PUTTING THEM BACK IS THE SERVER'S: an updateOwner script on the
    thornswoodModSettings property sets each global when the character comes
    in. When that lands after the first read here, the next read sees the
    restored values as moved and sends them back, which changes nothing.

    Runtime ids are kept, never forms: a form does not outlive its frame (see
    fireIdList).
  */
  const MOD_GLOBALS = {
    'Apocalypse - Magic of Skyrim.esp': {
      WB_Alteration_ThrummingStone_Global_Delay: 0xa6ec1,
      WB_Alteration_TranasasReversal_Global_XP: 0x98ff9,
      WB_Alteration_Undermine_Global_Mult: 0x98ffc, WB_Alteration_Undermine_Global_XP: 0x98ffb,
      WB_Conjuration_AtronachMark_Global_XP: 0x3ba29,
      WB_Conjuration_ConjureAvengingWraith_Global_Mult: 0x17aaf,
      WB_Conjuration_ConjureDremoraAssassin_Global_Health: 0x1a60d,
      WB_Conjuration_ConjureLich_Global_Cost: 0x1b649,
      WB_Conjuration_ConjureLich_Global_Cost_DualCast: 0x1b64a,
      WB_Destruction_ShockScythe_Global_Threshold: 0x24e48,
      WB_Destruction_Shockbloom_Global_Percentage: 0x2283f,
      WB_Destruction_Shockbloom_Global_XP: 0x3996f, WB_General_Global_XP: 0x43cef,
      WB_Illusion_Counterspell_Global_Percentage: 0x207bd,
      WB_Illusion_EmpathicAgony_Global_XP: 0x321bd, WB_Illusion_Global_AllowNNPC: 0x40bef,
      WB_Illusion_HarrowingDirge_Global_Percentage: 0x20d36,
      WB_Illusion_HarrowingDirge_Global_XP: 0x30c19, WB_Illusion_Lobotomize_Global_Mult2: 0x73b52,
      WB_Illusion_Lobotomize_Global_XP: 0x71ad2, WB_Illusion_MagickaVoid_Global_XP: 0x71ad5,
      WB_Illusion_MimicsCloak_Global_XP: 0x30c1f, WB_Illusion_PaleMoon_Global_Drain: 0x32c8f,
      WB_Illusion_ScreamOfPain_Global_XP: 0x321b9,
      WB_Restoration_Bloodseeker_Global_Mult: 0x71ad7,
      WB_Restoration_Bloodseeker_Global_XP: 0x71ad6,
      WB_Restoration_CullingRune_Global_Threshold: 0x3527a,
      WB_Restoration_CullingRune_Global_XP: 0x35279,
      WB_Restoration_FingerOfDeath_Global_Percentage: 0x1e196,
      WB_Restoration_KingsHeart_Global_EnableCraftingSkills: 0xba90a,
      WB_Restoration_WellingBlood_Global_Threshold: 0x1fcd4
    },
    'AHZmoreHUD.esp': {
      AHZActivationMode: 0x145b4, AHZBottomWidgetRightAligned: 0x10513,
      AHZBottomWidgetScale: 0x1b15b, AHZBottomWidgetXPercent: 0xdf5e,
      AHZBottomWidgetYPercent: 0xdf5f, AHZDisplayDelay: 0x227b9, AHZEffectsWidgetStyle: 0x10fd9,
      AHZEnemyLevelMax: 0x1e72a, AHZEnemyLevelMin: 0x1e72b, AHZHotKey: 0x145b3,
      AHZHotkeyToggles: 0x16604, AHZIconSize: 0x25d94, AHZIngredientsWidgetStyle: 0x10fda,
      AHZInventoryWidgetRightAligned: 0x10514, AHZInventoryWidgetScale: 0x1b15d,
      AHZInventoryWidgetXPercent: 0xffaf, AHZInventoryWidgetYPercent: 0xffb0,
      AHZShowBookSkill: 0x1507a, AHZShowBooksRead: 0x11aa1, AHZShowBottomWidget: 0x9963,
      AHZShowBottomWidgetAlways: 0x242a2, AHZShowEffectsWidget: 0x10fdb,
      AHZShowEnchantmentKnown: 0x1ec8d, AHZShowEnemyHealthStats: 0x24d6c,
      AHZShowEnemyLevel: 0x1d1a5, AHZShowEnemyMagickaMeter: 0x24d68,
      AHZShowEnemyMagickaStats: 0x24d6b, AHZShowEnemySoulLevel: 0x24805,
      AHZShowEnemyStaminaMeter: 0x24d69, AHZShowEnemyStaminaStats: 0x24d6a,
      AHZShowIngredientWidget: 0x22ed, AHZShowInventoryCount: 0xffae,
      AHZShowInventoryCountWithZero: 0x25831, AHZShowTargetWeight: 0x155dd, AHZShowVW: 0x19112,
      AHZShowWeightClass: 0x11aa2, AHZSideWidgetScale: 0x1b15c, AHZSideWidgetXPercent: 0xdf61,
      AHZSideWidgetYPercent: 0xdf60, AHZToggleState: 0x14b17
    },
    'Skyrim Unbound.esp': {
      DelayDragonLevel1: 0x1209c, DelayDragonLevel2: 0x1209d, DelayDragonMax: 0xfae4,
      DelayDragonMin: 0xfae3, UnlockShouts: 0x1209b, WhiterunThanePrerequisite: 0xb8eb5e
    },
    'chfshVariousActions.esp': {
      chfshVAMenuHotkey: 0x539c
    }
  };
  const MOD_LINE = 380;          // the voice service keeps 400 characters of a line
  const MOD_LINES_AT_ONCE = 8;   // tellServer holds 20 lines, so leave room
  const MOD_AGAIN_MS = 5000;     // what did not fit goes this much later
  const MOD_BEAT_MS = 60000;
  let modIds = null;     // [name, runtime id], resolved once
  let modSeen = null;    // name -> the value last read or sent
  let modAgainAt = 0;
  let modBeatAt = 0;

  function modIdList() {
    if (modIds) { return modIds; }
    const out = [];
    let total = 0;
    for (const file in MOD_GLOBALS) {
      if (!Object.prototype.hasOwnProperty.call(MOD_GLOBALS, file)) { continue; }
      const rows = MOD_GLOBALS[file];
      for (const name in rows) {
        if (!Object.prototype.hasOwnProperty.call(rows, name)) { continue; }
        total++;
        try {
          const form = sp.Form.from(sp.Game.getFormFromFile(rows[name], file));
          const id = form ? form.getFormID() : 0;
          if (id) { out.push([name, id]); }
        } catch (e) { }
      }
    }
    // Nothing at all means the data is not loaded yet: ask again next time.
    if (!out.length) { return []; }
    modIds = out;
    log('mod settings: ' + out.length + ' of ' + total + ' globals found');
    return modIds;
  }

  function modRead() {
    const ids = modIdList();
    if (!ids.length) { return null; }
    const now = {};
    for (let i = 0; i < ids.length; i++) {
      try {
        const gv = sp.GlobalVariable.from(sp.Game.getFormEx(ids[i][1]));
        const v = gv ? gv.getValue() : NaN;
        if (typeof v === 'number' && isFinite(v)) { now[ids[i][0]] = v; }
      } catch (e) { }
    }
    return now;
  }

  function modCheck() {
    const now = modRead();
    if (!now) { return; }
    // The first read is where things stand, not a change.
    if (!modSeen) { modSeen = now; return; }
    const moved = [];
    for (const name in now) {
      if (Object.prototype.hasOwnProperty.call(now, name) && modSeen[name] !== now[name]) { moved.push(name); }
    }
    if (!moved.length) { return; }
    const lines = [];
    let line = '/modset';
    let took = 0;
    for (let i = 0; i < moved.length; i++) {
      const pair = moved[i] + '=' + String(now[moved[i]]);
      if (line.length + 1 + pair.length > MOD_LINE) {
        lines.push(line);
        line = '/modset';
        if (lines.length >= MOD_LINES_AT_ONCE) { break; }
      }
      line += ' ' + pair;
      modSeen[moved[i]] = now[moved[i]];
      took++;
    }
    if (line !== '/modset') { lines.push(line); }
    for (let i = 0; i < lines.length; i++) { tellServer(lines[i]); }
    if (took < moved.length) { modAgainAt = Date.now() + MOD_AGAIN_MS; }
    log('mod settings: sent ' + took + ' of ' + moved.length + ' changed value(s) in ' + lines.length + ' line(s)');
  }

  sp.on('menuOpen', guard('mod settings open', (e) => {
    if (e && e.name === JOURNAL_MENU) { modCheck(); }
  }));
  sp.on('menuClose', guard('mod settings close', (e) => {
    if (e && e.name === JOURNAL_MENU) { modCheck(); }
  }));
  sp.on('update', guard('mod settings beat', () => {
    const t = Date.now();
    if (modAgainAt && t >= modAgainAt) { modAgainAt = 0; modBeatAt = t; modCheck(); return; }
    if (t - modBeatAt < MOD_BEAT_MS) { return; }
    modBeatAt = t;
    modCheck();
  }));
  // ---------------------------------------------- end mod settings menus

  /*
    / OPENS THE CHAT WITH A SLASH IN IT, AND ONLY THE CHAT.

    Patrick, 27 September: "can we also make / pull up the text chat and enter
    slash and not the vanilla skyrims skill tree thingg and only the chat".

    / is the game's Quick Stats, the skill tree. The native client keeps
    that control from its menu opener while our overlays are ready, before
    the game can request StatsMenu. This file still hears the key and opens
    chat with / typed. A separate rebound Quick Stats key stays available.
    The shared watcher below remains a fallback for menus opened otherwise.

    A tree that was already up before / went down is left alone, and so is
    the /: in the tree, / is the game's key for closing it. The shutting is
    ourKeyMenu's, below, which P uses for the magic menu the same way.
  */
  // ------------------------------------ the game's menu on one of our keys --
  /*
    A GAME MENU THAT OUR KEY OPENED IS SHUT. Issues 957 and 958.

    P is the game's Quick Magic, and its menu is shut when this press opened
    it. The same watcher handles a skill tree opened outside the native slash
    block below. It follows the game's name for the press, so somebody who
    moved Quick Stats or Quick Magic to another key keeps it there untouched.

    WHAT WENT WRONG ON DEV, 28 September (Patrick's front log):
      20:37:41.881 / seen, but StatsMenu is open
      20:38:37.659 key 25 seen, but MagicMenu is open
    The game has its menu in the stack by the time this file hears the key,
    and the menuOpen event that says so comes later: the J block's line from
    the same session measures it, "the game's journal opened 37ms after the
    press". The / code asked isMenuOpen at the press, found the tree up, had
    no menuOpen yet to say it was new, and took it for a tree that was up
    before /. P had no shutting at all, so the magic menu it opened made the
    menu check refuse the party window.

    So a menu counts as opened by this press when it is up and its menuOpen
    has not come yet, or came within PRESS_MS. One that opened longer ago was
    up before the press, and the key is the game's.

    A menu up at the press is shut in the next update rather than inside the
    key handler, so any other key that went down in the same frame (Escape
    above all) still ends the claim first. A menu not up at the press is shut
    at its menuOpen, never by asking in an update: a menu that turns up in
    the stack between frames may be Escape's, whose key this file has not
    heard yet, and the menuOpen comes after that key does.

    A menu still up a second after the shut is asked once more, and one still
    up after two is said in the log and left.
  */
  const OUR_KEY_PRESS_MS = 1000;

  function ourKeyMenu(menu, control, key, what) {
    let openAt = 0;     // when its menuOpen came, 0 once its menuClose has
    let pressAt = 0;    // our key went down and the game took it as control
    let upAtPress = false;  // and the menu was already up when it did
    let shutAt = 0;
    let asked = 0;

    function took(e) {
      if (e.userEventName) { return e.userEventName === control; }
      try { return sp.Input.getMappedKey(control, 0) === e.code; } catch (err) { return false; }
    }
    function up() {
      try { return !!sp.Ui.isMenuOpen(menu); } catch (err) { return false; }
    }
    function fresh() { return !openAt || Date.now() - openAt < OUR_KEY_PRESS_MS; }
    function shut() {
      pressAt = 0;
      upAtPress = false;
      asked++;
      // The clock runs from the first ask, so asking again does not restart it.
      if (asked === 1) { shutAt = Date.now(); }
      try { sp.TESModPlatform.closeMenu(menu); }
      catch (err) { say(key + ': closeMenu threw on ' + what + ': ' + err); shutAt = 0; }
    }

    sp.on('menuOpen', guard(key + ' menu open', (e) => {
      if (!e || e.name !== menu) { return; }
      openAt = Date.now();
      if (!pressAt) { return; }
      const lag = openAt - pressAt;
      pressAt = 0;
      if (lag > OUR_KEY_PRESS_MS) { return; }
      asked = 0;
      shut();
    }));
    sp.on('menuClose', guard(key + ' menu close', (e) => {
      if (e && e.name === menu) { openAt = 0; }
    }));
    sp.on('update', guard(key + ' menu after', () => {
      if (pressAt && upAtPress) {
        upAtPress = false;
        if (up()) { asked = 0; shut(); }
      }
      if (!shutAt) { return; }
      const since = Date.now() - shutAt;
      if (!up()) { shutAt = 0; return; }
      if (since > 2000) {
        shutAt = 0;
        say(key + ': ' + what + ' is still open ' + since + 'ms after it was shut, asked ' + asked + ' times');
      } else if (since > 1000 && asked < 2) {
        shut();
      }
    }));

    return {
      // The menu's name when this press has it up already, so the menu
      // check lets ours open over it; '' otherwise.
      openedBy: function (e) { return took(e) && up() && fresh() ? menu : ''; },
      // Ours opens on this press: the game's menu goes, now or when it opens.
      shutFor: function (e) {
        if (!took(e)) { return; }
        pressAt = Date.now();
        upAtPress = up() && fresh();
      },
      // Any key going down ends the last press's claim.
      keyDown: function () { pressAt = 0; upAtPress = false; }
    };
  }

  const STATS_MENU = 'StatsMenu';
  // The native MenuOpenHandler hook rejects this control before Skyrim asks
  // for StatsMenu. Closing a menu after buttonEvent cannot prevent a flash.
  // Both names and codes must match, so a separate rebound skill key remains
  // the game's. Existing game menus retain their own keyboard handling.
  let commandKeyKept = null;
  let commandKeySaid = false;
  function keepCommandKey(on) {
    if (commandKeyKept === on) { return; }
    commandKeyKept = on;
    try {
      sp.setMenuOpenKeyBlocked('Quick Stats', COMMAND_KEY, on, KEYBOARD_MENUS);
    } catch (err) {
      if (!commandKeySaid) {
        commandKeySaid = true;
        say('/: the client could not keep the skill key from the game: ' + err);
      }
    }
  }
  // Reset an earlier plugin copy's entry, and track overlay availability.
  keepCommandKey(!!T.ready);
  sp.on('update', guard('command key kept', () => {
    keepCommandKey(!!T.ready);
  }));

  const statsOnSlash = ourKeyMenu(STATS_MENU, 'Quick Stats', '/', 'the skill tree');
  const magicOnP = ourKeyMenu('MagicMenu', 'Quick Magic', 'P', 'the magic menu');

  function commandKeyPressed(e) {
    if (claims.chat) { return; }
    const busy = busyMenuOpenNow(statsOnSlash.openedBy(e));
    if (busy) { say('/ seen, but ' + busy + ' is open'); return; }
    statsOnSlash.shutFor(e);
    say('/ seen, opening the chat with a slash in it');
    wantTyping(true, '/');
  }

  /*
    THE NOTICE BOARDS AND THEIR DROP BOXES ARE THE SERVER'S (#2516). This
    plugin used to put every board down itself: placeAtMe where the person
    stood, then setPosition to the town, and two seconds later getFormEx no
    longer found a copy moved into a cell that was not loaded, so it put
    another down at the person, for every far town, for ever (Patrick on dev,
    12 Oct). The server now stands one board and one box per hold as its own
    references, sent to every game, and answers E on each: the board opens
    the board's panel, the box the box's (Patrick, 12 Oct, #2298). Nothing
    here places, finds or presses either.

    What is left is the reach: the board's panel says where its board is
    ('board:near'), and both panels close when you walk out of reach of it.
  */
  const BOARD_REACH = 400;
  let boardNear = null;
  let boardWatchAt = 0;

  function boardDist(px, py, pz, spot) {
    const dx = px - spot.x, dy = py - spot.y, dz = pz - spot.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /* The board the server says you are near, while you are within 1500 of it. */
  function boardAimSpot(pc, px, py, pz) {
    if (boardNear && boardDist(px, py, pz, boardNear) <= 1500) { return boardNear; }
    return null;
  }

  /*
    A CARRIAGE OR FERRY DRIVER OPENS HIS PANEL (#1394, #1635).

    Pressing E on a driver opens the carriage mod's own talk, and that talk
    does not know the hold's ledger: its ride is a fade on this machine that
    the server undoes, because the server refuses a move it did not make.
    So the same press also tells the server which driver it was, as
    /ride e <id>, the way the merchant press does, and the server answers
    with where this driver goes and what each stop costs, which
    game/ui/thornswood-ride.js draws. A stop's Ride button there is the ride
    that counts. Nobody types a line (Patrick, 4 Oct: no chat commands for
    what people do).

    THE DRIVERS ARE KNOWN BY THEIR BASE, the same rows as the carriages block
    in the gamemode (tests/test-1394-fares.js holds the two lists together).
    A base from a plugin is asked for by its file and its own id, because a
    runtime id carries the plugin's place in the load order. Kept as numbers,
    never as forms: a form does not outlive its frame (see THE IDS, RESOLVED
    ONCE, above). A first press before the world answers resolves nothing and
    is tried again on the next one.
  */
  const RIDE_DRIVER_BASES = [
    ['CFTO.esp', 0x6ae98], ['CFTO.esp', 0x6ae97], ['CFTO.esp', 0x6ae99],
    ['CFTO.esp', 0x6ae96], ['CFTO.esp', 0x6ae95], ['CFTO.esp', 0xbbf8f],
    ['CFTO.esp', 0xbbf8c], ['CFTO.esp', 0xbbf8d], ['CFTO.esp', 0x1be45a],
    ['CFTO.esp', 0x14c5a], ['CFTO.esp', 0xaa08], ['CFTO.esp', 0x2d4c09],
    ['CFTO.esp', 0xaa0b], ['CFTO.esp', 0xaa07], ['CFTO.esp', 0x158ffc],
    ['CFTO.esp', 0xaa09], ['CFTO.esp', 0xfb28], ['CFTO.esp', 0xfb24],
    ['CFTO.esp', 0x14c52], ['CFTO.esp', 0x2e1e6], ['CFTO.esp', 0x332f5],
    ['CFTO.esp', 0x332ed], ['CFTO.esp', 0x14c6e], ['CFTO.esp', 0x14c78],
    ['CFTO.esp', 0x14c6c], ['Dragonborn.esm', 0x182ae], ['Dragonborn.esm', 0x2582b]
  ];
  let rideDriverIds = null;

  /*
    THE RIDE PANEL WAITS FOR THE MOD'S CONVERSATION (#1635). The same E opens
    the carriage mod's own talk, the Dialogue Menu, and a panel that took the
    keyboard while that is up would leave the talk with no keys. So the
    panel is up only while no menu is. When the page says the server's view
    has come ('ride:wants'), it opens at once if no menu is open, or when the
    menu that is open closes. A menu the game raises over the panel (the
    talk opening after the server answered, a load screen) closes the panel,
    and it waits again. It is over when you walk out of reach of the driver
    you pressed, the reach the server measures (RIDE_REACH in the carriages
    block), and when the page closes it: Step back, Escape, or the server
    after a ride that went. The driver is kept as his local form id, never
    as a form, and asked for in the frame it is used.
  */
  const RIDE_REACH = 400;
  let rideDriver = 0;
  let rideState = '';
  let rideWatchAt = 0;

  function rideInReach() {
    if (!rideDriver) { return false; }
    try {
      const pc = sp.Game.getPlayer();
      const ref = sp.ObjectReference.from(sp.Game.getFormEx(rideDriver));
      if (!pc || !ref) { return false; }
      const dx = pc.getPositionX() - ref.getPositionX();
      const dy = pc.getPositionY() - ref.getPositionY();
      const dz = pc.getPositionZ() - ref.getPositionZ();
      return Math.sqrt(dx * dx + dy * dy + dz * dz) <= RIDE_REACH;
    } catch (err) { return false; }
  }

  // except: the menu that is closing right now, which is not in the way.
  function rideOpenIfFree(except) {
    if (rideState !== 'waiting') { return; }
    if (!rideInReach()) { rideState = ''; return; }
    if (busyMenuOpenNow(except)) { return; }
    T.js('try{window.thornswoodRide&&window.thornswoodRide.open();}catch(e){}');
  }

  function rideDriverIdSet() {
    if (rideDriverIds) { return rideDriverIds; }
    const out = {};
    let found = 0;
    for (let i = 0; i < RIDE_DRIVER_BASES.length; i++) {
      try {
        const form = sp.Game.getFormFromFile(RIDE_DRIVER_BASES[i][1], RIDE_DRIVER_BASES[i][0]);
        const id = form ? (form.getFormID() >>> 0) : 0;
        if (id) { out[id] = true; found++; }
      } catch (err) { }
    }
    if (found) {
      rideDriverIds = out;
      say('carriage and ferry drivers: ' + found + ' of ' + RIDE_DRIVER_BASES.length + ' bases found');
    }
    return out;
  }

  function driverPress(e) {
    if (!e || e.userEventName !== 'Activate') { return false; }
    if (claims.chat || busyMenuOpen()) { return false; }
    let ref = null;
    try { ref = sp.Game.getCurrentCrosshairRef(); } catch (err) { ref = null; }
    if (!ref) { return false; }
    let baseId = 0;
    try {
      const base = ref.getBaseObject();
      if (!base || base.getType() !== 43) { return false; }
      baseId = base.getFormID() >>> 0;
    } catch (err) { return false; }
    if (!baseId || !rideDriverIdSet()[baseId]) { return false; }
    let hex = '';
    let localId = 0;
    try {
      const convert = globalThis.thornswoodSocialServerId;
      localId = ref.getFormID() >>> 0;
      const serverId = typeof convert === 'function' ? (convert(localId) >>> 0) : localId;
      if (serverId) { hex = serverId.toString(16); }
    } catch (err) { hex = ''; }
    if (!hex) { return false; }
    rideDriver = localId;
    tellServer('/ride e ' + hex);
    say('asked the server where driver ' + hex + ' goes');
    return true;
  }

  sp.on('menuOpen', guard('ride panel waits', (e) => {
    if (rideState !== 'up' || !e || SELF_OPENING_MENUS.indexOf(e.name) < 0) { return; }
    rideState = 'waiting';
    T.js('try{window.thornswoodRide&&window.thornswoodRide.close();}catch(e){}');
  }));

  sp.on('menuClose', guard('ride panel opens', (e) => {
    rideOpenIfFree(e && e.name ? e.name : '');
  }));

  sp.on('update', guard('ride distance', () => {
    if (!rideState) { return; }
    const now = Date.now();
    if (now - rideWatchAt < 250) { return; }
    rideWatchAt = now;
    if (rideInReach()) { return; }
    rideState = '';
    T.js('try{window.thornswoodRide&&window.thornswoodRide.close();}catch(e){}');
  }));

  function merchantPress(e) {
    if (!e || e.userEventName !== 'Activate') { return false; }
    if (claims.chat || busyMenuOpen()) { return false; }
    let ref = null;
    try { ref = sp.Game.getCurrentCrosshairRef(); } catch (err) { ref = null; }
    if (!ref) { return false; }
    let type = 0;
    try { type = ref.getBaseObject().getType(); } catch (err) { return false; }
    if (type !== 43) { return false; }
    let hex = '';
    try {
      const convert = globalThis.thornswoodSocialServerId;
      const localId = ref.getFormID() >>> 0;
      const serverId = typeof convert === 'function' ? (convert(localId) >>> 0) : localId;
      if (serverId) { hex = serverId.toString(16); }
    } catch (err) { hex = ''; }
    if (!hex) { return false; }
    tellServer('/merchant e ' + hex);
    return true;
  }

  sp.on('update', guard('board distance', () => {
    if (!T.hasFocus('board')) { return; }
    const now = Date.now();
    if (now - boardWatchAt < 250) { return; }
    boardWatchAt = now;
    let pc = null;
    try { pc = sp.Game.getPlayer(); } catch (e) { pc = null; }
    if (!pc) { return; }
    let dist = 99999;
    try {
      const spot = boardAimSpot(pc, pc.getPositionX(), pc.getPositionY(), pc.getPositionZ());
      if (spot) { dist = boardDist(pc.getPositionX(), pc.getPositionY(), pc.getPositionZ(), spot); }
    } catch (e) { dist = 99999; }
    if (dist > BOARD_REACH) {
      T.js('try{window.thornswoodBoard&&window.thornswoodBoard.close();}catch(e){}');
    }
  }));

  // The drop box's panel closes when you walk away from its board, as the board's does.
  let boxWatchAt = 0;
  sp.on('update', guard('box distance', () => {
    if (!T.hasFocus('box')) { return; }
    const now = Date.now();
    if (now - boxWatchAt < 250) { return; }
    boxWatchAt = now;
    let pc = null;
    try { pc = sp.Game.getPlayer(); } catch (e) { pc = null; }
    if (!pc) { return; }
    let dist = 99999;
    try {
      const spot = boardAimSpot(pc, pc.getPositionX(), pc.getPositionY(), pc.getPositionZ());
      if (spot) { dist = boardDist(pc.getPositionX(), pc.getPositionY(), pc.getPositionZ(), spot); }
    } catch (e) { dist = 99999; }
    if (dist > BOARD_REACH) {
      T.js('try{window.thornswoodBox&&window.thornswoodBox.close();}catch(e){}');
    }
  }));

  // A market stall's panel closes when you walk away from the stall (#3160).
  let stallWatchAt = 0;
  sp.on('update', guard('stall distance', () => {
    if (!T.hasFocus('stall')) { return; }
    const now = Date.now();
    if (now - stallWatchAt < 250) { return; }
    stallWatchAt = now;
    if (!stallAt()) {
      T.js('try{window.thornswoodStall&&window.thornswoodStall.close();}catch(e){}');
    }
  }));

  sp.on('buttonEvent', guard('keys', (e) => {
    keysSeen++;
    if (!e.isDown || e.isUp) return;

    rememberKey(e.code);
    // Any key going down ends J's claim on the next Journal Menu, Escape
    // above all. See JOURNAL_MENU above.
    journalKeyDown(e);
    // And any key ends a / or P press's claim on the next skill tree or magic
    // menu. See ourKeyMenu above.
    statsOnSlash.keyDown();
    magicOnP.keyDown();

    if (!sawAnyKey) {
      sawAnyKey = true;
      // The one fact that decides everything else. If this never appears, no
      // plugin in this build is being given keys and the wheel, the chat and
      // the mark key are all dead for the same reason.
      say('keys work, first one was scan code ' + e.code);
    }

    if (!T.ready) return;

    // E on somebody you carry a letter for hands it over (#1595), before the
    // trader's E below takes any press on a person.
    if (deliverPress(e)) return;
    if (driverPress(e)) return;
    if (merchantPress(e)) return;

    // Reachable only while focus is down, which is the only time it is needed.
    if (e.code === ESC) { wantTyping(false); return; }

    /*
      The skills panel. Not while the chat has the keyboard, because the key
      would be a letter somebody is typing, and not while a real menu is up.
      The panel is asked to toggle; whether it actually opened comes back as
      a browserMessage, and that is what moves the focus claim. The page can
      close itself on Escape, so it is the one that knows.
    */
    /*
      The social keys. The three verbs need somebody under the crosshair and
      say nothing when there is not; P and J open their panels regardless,
      except that P on somebody not in your party asks them in.
    */
    // The mold key, and only while a door is under the crosshair and a Key
    // Mold is in the pack. Otherwise it is not used and goes on down the list.
    // A piece of furniture in hand or under the crosshair, in a building you
    // may arrange (#2679): the mold key moves or sets it down, the lock key
    // picks it up or turns it. In the inventory the lock key is Arrange
    // furniture. See furniturePress and arrangePress.
    if ((e.code === MOLD_KEY || e.code === LOCK_KEY) && furniturePress(e.code)) { return; }
    if (e.code === LOCK_KEY && arrangePress()) { return; }
    if (e.code === MOLD_KEY && moldPress()) { return; }
    // The same key on a person inside a building you hold. See SLEEP_KEY.
    if (e.code === SLEEP_KEY && sleepPress()) { return; }
    // The same key in the inventory, with a repair kit in the pack (#1384).
    if (e.code === MOLD_KEY && repairPress()) { return; }
    // The same key at a forge with a stamped mold: the master key (#2254).
    if (e.code === MOLD_KEY && masterPress()) { return; }
    if (e.code === LOCK_KEY && lockPress()) { return; }
    // The same key on a hurt person under the crosshair (#1383). See TREAT_KEY.
    if (e.code === TREAT_KEY && treatPress()) { return; }
    // The trade key in the inventory, with a wound to tend (#1383). See TREAT_SELF_KEY.
    if (e.code === TREAT_SELF_KEY && treatSelfPress()) { return; }
    // The friend key in the inventory, for a cook with raw food (#3163). See PRESERVE_KEY.
    if (e.code === PRESERVE_KEY && preservePress()) { return; }
    /*
      The five social keys work in the open world, and P and J can always
      close their own panel. Djinn on dev, 24 September: "The party menu
      actually opens when hitting shift P during character creation while
      naming your character." Unlike K below, these had no guard at all, so
      a letter typed into the name box, or pressed over the inventory or the
      map, opened one of our panels on top of the game's menu.

      Asked of the game at the press rather than through busyMenuOpen's
      quarter second cache, so a menu that closed a moment ago cannot
      swallow the key. The Journal Menu does not count against J: J is the
      game's own journal key as well, the game may have opened its book
      before this runs, and shutting that book is the J block's job
      (JOURNAL_MENU above). The magic menu does not count against P when
      this same press opened it, for the same reason: P is the game's Quick
      Magic, and ourKeyMenu above shuts what it opened (issue 957).
    */
    if (e.code === FRIEND_KEY || e.code === TRADE_KEY || e.code === MUTE_KEY ||
        e.code === PARTY_KEY || e.code === JOURNAL_KEY) {
      if (claims.chat) { return; }
      const closing = (e.code === PARTY_KEY && T.hasFocus('party')) ||
                      (e.code === JOURNAL_KEY && T.hasFocus('journal'));
      const pOpened = e.code === PARTY_KEY ? magicOnP.openedBy(e) : '';
      if (!closing) {
        for (const name of KEYBOARD_MENUS) {
          if (e.code === JOURNAL_KEY && name === JOURNAL_MENU) { continue; }
          if (name === pOpened) { continue; }
          let up = false;
          try { up = !!sp.Ui.isMenuOpen(name); } catch (err) { up = false; }
          if (up) { say('key ' + e.code + ' seen, but ' + name + ' is open'); return; }
        }
      }
    }
    if (e.code === FRIEND_KEY) { lookVerb('friend'); return; }
    if (e.code === TRADE_KEY) { lookVerb('trade'); return; }
    if (e.code === MUTE_KEY) { lookVerb('mute'); return; }
    if (e.code === PARTY_KEY) {
      // On somebody not in your party it asks them (#1629); otherwise it is
      // the panel. While the panel holds the keyboard no buttonEvent comes,
      // and the page closes itself on P (#1919).
      if (T.hasFocus('party') || !partyPress()) {
        T.js('try{window.thornswoodParty&&window.thornswoodParty.toggle();}catch(e){}');
      }
      // The game took this same press as its Quick Magic: shut that menu,
      // whichever of the two P did.
      magicOnP.shutFor(e);
      return;
    }
    if (e.code === JOURNAL_KEY) {
      T.js('try{window.thornswoodJournal&&window.thornswoodJournal.toggle();}catch(e){}');
      // The game took this same press as its own journal: shut that one
      // when it opens. See JOURNAL_MENU above.
      journalKeyPressed(e);
      return;
    }

    if (e.code === MANEUVER_KEY) { maneuverKeyPressed(); return; }
    if (e.code === HELP_KEY) { helpKeyPressed(); return; }

    // K on a person a Master could take on opens K on them (#1634).
    if (e.code === APPRENTICE_KEY && apprenticePress()) { return; }
    // K on a person while you carry a hair dye opens K's Hair dye on them (#2675).
    if (e.code === HAIR_DYE_KEY && hairDyePress()) { return; }
    if (e.code === SKILLS_KEY) {
      if (claims.chat) { return; }
      const busyNow = busyMenuOpen();
      if (!T.hasFocus('skills') && busyNow) {
        say('skills key seen, but ' + busyNow + ' is open');
        return;
      }
      T.js('try{window.thornswoodSkills&&window.thornswoodSkills.toggle();}catch(e){}');
      return;
    }

    if (e.code === COMMAND_KEY) { commandKeyPressed(e); return; }

    if (e.code !== CHAT_KEY) return;

    // Not while a real menu is up: Enter means something to every one of them.
    const busy = busyMenuOpen();
    if (!claims.chat && busy) {
      say('chat key seen, but ' + busy + ' is open');
      return;
    }
    say(claims.chat ? 'chat key seen, closing the box' : 'chat key seen, asking the page');
    wantTyping(!claims.chat);
  }));

  // ------------------------------------------------------------- overlays --
  // Each overlay is fetched by the page rather than pasted in as source, so it
  // stays a file that can be edited without touching any plugin.
  function inject(file) {
    const id = 'ts-' + file.replace(/[^a-z0-9]/gi, '-');
    return T.js(
      '(function(){' +
      'if(document.getElementById("' + id + '")){return;}' +
      'var s=document.createElement("script");' +
      's.id="' + id + '";' +
      's.src="' + file + '";' +
      's.onerror=function(){try{window.skyrimPlatform.sendMessage("thornswood-front","could not fetch ' + file + '");}catch(e){}};' +
      's.onload=function(){try{window.skyrimPlatform.sendMessage("thornswood-front","' + file + ' is in");}catch(e){}};' +
      '(document.head||document.documentElement).appendChild(s);' +
      '})();'
    );
  }

  function myName() {
    try {
      const pc = sp.Game.getPlayer();
      if (!pc) return '';
      let n = '';
      try { n = pc.getDisplayName() || ''; } catch (e) { n = ''; }
      if (!n) { try { n = pc.getBaseObject().getName() || ''; } catch (e) { n = ''; } }
      return String(n).trim();
    } catch (e) { return ''; }
  }

  // ------------------------------------------------------------------ tick --
  let phase = 0;
  let at = 0;
  let sentName = '';
  // The last join token handed to the browser, or on disk when it was
  // injected, and when the file was last read for an ask (see tokenWant).
  let lastToken = '';
  let tokenAt = 0;

  sp.on('update', guard('tick', () => {
    const now = Date.now();

    // Not at the first tick. The Tilted backend draws through a D3D11 render
    // hook, and early on the game is still tearing its swap chain down and
    // rebuilding it around every load screen. Loading a page into that is how
    // you get a wheel painted over the loading screen.
    if (phase === 0) {
      let pc = null;
      try { pc = sp.Game.getPlayer(); } catch (e) { pc = null; }
      if (gameMenuOpen() || !pc) return;

      /*
        Left where anything without a virtual machine can read it.

        skymp5-client decides whether to spawn somebody by reloading a save or
        by moving them, and it decides from a tick handler, where every call
        into the game throws. So it cannot ask the game anything. This runs in
        update, where the calls work, and the answer to the only question it
        needs is already settled right here: there is a character and no menu,
        so there is a game to be in.
      */
      try { globalThis.__thornswoodInWorld = true; } catch (e) { }

      // Cleared again on the way out, below. Nothing in the shipped client
      // bundle reads this today, so it costs nothing either way, but a flag
      // that is only ever set true is a flag that lies the moment anything
      // does start reading it.

      // The world is up, so the main menu block above stands down for
      // good; it used to stand down on the first update instead, which is
      // not the same moment and is not a moment this file can be sure of.
      // A choice still up here was never made: see menuGone.
      if (choiceUp()) { menuGone(); }
      menuPhase = 9;
      phase = 1; at = now;
      try {
        sp.browser.loadUrl(UI_URL);
        sp.browser.setVisible(true);
        sp.browser.setFocused(false);
        log('loading', UI_URL);
      } catch (e) {
        log('no browser backend:', e);
        phase = 9;
      }
      return;
    }

    /*
      The focus arbiter waits until our own overlays are in.

      It used to start the moment the browser existed, to cover the few seconds
      between the world loading and the overlays going in, because skymp5-client
      bound Enter to raise focus and nothing lowered it. That binding is gone
      now, and running early costs something real instead.

      The login widget is skymp5-client's page in this same browser, and it
      needs focus to be typed into. Nothing here claims focus on its behalf, so
      the arbiter saw focus up with no claim and took it back after a second,
      every second. From the outside that is a login box that accepts a few
      characters and then goes dead with the game already holding the keyboard,
      which is the freeze at character creation that has to be alt tabbed out
      of.

      Phase two is our overlays being in, which is after login, in the world,
      and is the first moment anything here has any business deciding who gets
      the keyboard.
    */
    if (phase >= 2) {
      // F6 and Escape first, so the focus they ask for is settled this frame.
      watchFocusKeys();
      applyFocus();
    }

    // Give the page time to parse before asking it to fetch anything. It is a
    // file on the same disk, so this is a pause, not a download.
    if (phase === 1 && now - at > 1200) {
      phase = 2; at = now;
      sentName = myName() || 'Traveller';
      // No token: whatever is on disk was minted for an earlier try and may
      // be spent, so the chat asks for its own when it connects (#1322).
      lastToken = joinToken();
      T.js('window.THORNSWOOD=' + JSON.stringify({
        host: HOST, port: VOICE_PORT, profileId: PROFILE, name: sentName,
        token: '', base: VOICE_URL,
        chatFade: CHAT_FADE, needsBars: NEEDS_BARS
      }) + ';');
      OVERLAYS.forEach(inject);
      // The token itself is never logged. It is what somebody would need to
      // join as this person, and this log is a file on disk.
      log('overlays injected. host', HOST + ':' + VOICE_PORT, 'profile', PROFILE,
          'as', sentName, '; the chat asks the launcher for its join token');
      return;
    }

    if (phase === 2 && now - at > 600) {
      phase = 3; at = now;
      T.ready = true;
      keepCommandKey(true);
      T.js('try{window.thornswoodChat&&window.thornswoodChat.show();}catch(e){}');
      log('ready');
      // Anything queued for the server before ready, which is always the
      // skills panel's '/pick refresh' (the panel mounts before this line),
      // goes now rather than on the next pick. Until 20 September it sat in
      // the queue and a person who never picked never saw their own state.
      tellServer('');
      return;
    }

    if (phase !== 3) return;

    try {
      // ---- visible --------------------------------------------------------
      // Visible is not only about what is drawn. TPInputService injects every
      // mouse move, click and key into CEF whenever the render handler reports
      // itself visible, asking nothing about focus. So it is held on while you
      // are playing, because that is when the chat and the names have to be on
      // screen, and held off in every game menu, because that is when CEF
      // answering a mouse move takes the cursor away from the menu that needs
      // it. Tilted's visibility is a plain bool other code flips, so both
      // directions have to be held rather than set.
      //
      // Never hidden while this file is the reason a menu is open. Raising
      // focus opens the game's own CursorMenu, so asking isInMenuMode here
      // would hide the browser at the exact moment somebody was handed the
      // chat box: the box vanishes, and because TPInputService only injects
      // input while the render handler reports itself visible, every letter
      // typed after that goes nowhere. That is the chat that draws, takes the
      // cursor, and then will not accept a word.
      //
      // An F6 focus is the same case with no claim behind it. Without the
      // middle test its CursorMenu turns this answer to hide, and the cursor F6
      // asked for would come up over a page no longer drawn or sent a click.
      const hide = !anyClaim() && !manualFocusSince && gameMenuOpen();
      if (sp.browser.isVisible() === hide) { sp.browser.setVisible(!hide); }

      // A menu opening while the chat box has the keyboard would leave the
      // caret in the box and the menu unusable, so the box is closed for it.
      //
      // Only these, and not busyMenuOpen's whole list. While focus is up the
      // game has no keyboard and no mouse, so nobody can open an inventory or
      // a map; the only menus that can appear are the ones the game raises by
      // itself. Asking the wide question here is how the box kept being taken
      // away half a second after it was given.
      if (claims.chat) {
        const over = interrupted();
        if (over) {
          say('closing the chat box, ' + over + ' opened');
          wantTyping(false);
        }
      }

      applyFocus();
    } catch (e) { }

    // Two watchdogs, because the worst outcome here is somebody standing in a
    // town unable to move and unable to say so.
    //
    // The first: a request the page never answered. Four seconds and the ask
    // is dropped, so enter simply did nothing.
    if (asked && now - asked > 4000) {
      asked = 0;
      say('asked the page for the keyboard and it never answered');
    }
    // The second: the page took it and then stopped talking, which is what a
    // crashed or reloaded front looks like from here. The keyboard comes back
    // whether or not anybody asks for it.
    if (claims.chat && beat && now - beat > 12000) {
      beat = 0;
      T.claimFocus('chat', false);
      log('the chat box went quiet, taking the keyboard back');
    }

    // The third, and the only one that does not trust the page at all.
    //
    // The heartbeat above catches a page that died. It cannot catch a page that
    // is perfectly healthy and simply never closes the box, which is what a
    // swallowed keystroke looks like: the beat keeps coming, typing=yes
    // forever, and the person cannot move. Holding the keyboard is capped
    // outright. Two minutes is far longer than anybody spends writing one line
    // and far shorter than giving up on the game.
    if (claims.chat && heldSince && now - heldSince > 120000) {
      heldSince = 0;
      T.js('try{window.thornswoodChat&&window.thornswoodChat.blurInput();}catch(e){}');
      T.claimFocus('chat', false);
      log('the chat box has held the keyboard for two minutes, taking it back');
    }

    /*
      THE SAME CAP FOR EVERY OTHER CLAIM, which had none at all.

      The three watchdogs above all test claims.chat. The chat box is not the
      only thing that takes the keyboard: the K panel claims 'skills' and the
      emote wheel claims 'wheel', and neither had a way back. A panel that
      never says it closed, a page that reloads with the wheel up, or any
      throw between raising the claim and lowering it left the person unable to
      move, with no key able to reach the plugin that would have fixed it.

      Two minutes, the same number and the same reasoning: far longer than
      anybody spends in a menu, far shorter than giving up on the game. The
      claim is released by name so the log says which one it was, which is the
      only evidence anybody will have next time.
    */
    /*
      AND IT CLOSES THE PANEL, RATHER THAN ONLY DROPPING THE CLAIM.

      Djinn, 22 September: a panel was up, F6 gave no cursor, and the only way
      out was Task Manager. This loop is how that happens.

      Taking the claim back without telling the page leaves the panel DRAWN
      with nobody claiming focus. applyFocus then forces focus to match the
      claims every frame, so pressing F6 raises it and the very next frame
      puts it straight back down: the cursor never appears. And with focus
      down the browser is sent no key, no click and no mouse move at all, so
      the panel's own Escape and its Close button are both unreachable. The
      only way out left was the K key, and nothing on screen says so.

      Two minutes is a real session at the skills panel, not an anomaly: the
      plugin log for 22 September shows a single sitting of 67 seconds, so
      this fires on people who are simply reading.

      So the panel is asked to close first and the claim follows. Now the
      rescue leaves somebody looking at the world with their keyboard back,
      which is what it was always meant to do.
    */
    for (const who in claimedAt) {
      if (who === 'chat') { continue; }
      // Sitting at the character choice is not a stuck keyboard, it is the one
      // thing to do there. Only while it is up: see menuGone.
      if (who === 'select' && choiceUp()) { continue; }
      if (!claims[who] || !claimedAt[who]) { continue; }
      if (now - claimedAt[who] > 120000) {
        log('the ' + who + ' claim has held the keyboard for two minutes, closing it and taking it back');
        // Each window by its own name, and only that one: see CAP_CLOSES.
        const win = CAP_CLOSES[who];
        if (win) { T.js('try{window.' + win + '&&window.' + win + '.close();}catch(e){}'); }
        T.claimFocus(who, false);
      }
    }

    checkServer(now);
    askServerBases(now);

    // Five seconds between saying so and doing it, so the line is readable and
    // so a server that comes straight back up is not made into an outage.
    /*
      AND THE LINE IS ON THE SCREEN, WITH THE COUNTDOWN.

      Entry 159 on the To Do List: "Connection to the server was lost,
      returning to the main menu, on screen, with the countdown. Every online
      game does this." Until now the five seconds were a bare delay with
      nothing drawn, and the one sentence explaining them went to the log.

      Drawn here, in update, and not where the outage is noticed: onStrike
      says why a note there never reaches the screen.

      One line for each whole second, not one per frame, because
      Debug.notification queues every call and a frame's worth would still be
      scrolling past long after the quit. The first line carries the reason
      whichever second it lands on, so a slow first frame cannot leave
      somebody looking at a bare number.
    */
    if (leaving && now - leaving >= 0 && now - leaving <= 5000) {
      /* Close the game connection on the first second, not after the quit.
         skymp5-client reconnects the moment a connection drops and then
         moves you to the last place the server had, which is a few feet
         behind where you were walking, and that move wins over the menu.
         The idle kick already closes it first for the same reason. */
      if (!leftClosed) {
        leftClosed = true;
        try {
          if (sp.mpClientPlugin && sp.mpClientPlugin.destroyClient) {
            sp.mpClientPlugin.destroyClient();
          }
        } catch (e) { log('could not close the connection to the game server:', e); }
      }
      const left = Math.max(1, Math.ceil((5000 - (now - leaving)) / 1000));
      if (left !== leavingSaid) {
        note((leavingSaid ? '' : 'the connection to the server was lost, ') +
             'returning to the main menu in ' + left);
        leavingSaid = left;
      }
    }
    if (leaving && now - leaving > 5000) {
      leaving = now + 3600000;   // never twice
      // No longer in the world, and said so before the quit rather than after,
      // because after it there is no tick to say it in.
      try { globalThis.__thornswoodInWorld = false; } catch (e) { }
      try {
        if (sp.mpClientPlugin && sp.mpClientPlugin.destroyClient) {
          sp.mpClientPlugin.destroyClient();
        }
      } catch (e) { log('could not close the connection to the game server:', e); }
      try {
        sp.Game.quitToMainMenu();
      } catch (e) {
        log('could not quit to the main menu:', e);
        // On screen, because this is the one path where the person is left
        // standing in a world with no server behind it.
        note('the server is down. Close the game and press Play again.');
      }
    }

    // The name is a guess until the race menu has been through, so it is
    // checked now and then rather than once. setName reconnects, which is
    // cheap and is the only way the service will take a new one.
    if (now - at > 5000) {
      at = now;
      const n = myName();
      if (n && n !== sentName) {
        sentName = n;
        T.js('try{window.thornswoodNet&&window.thornswoodNet.setName(' +
             JSON.stringify(n) + ');}catch(e){}');
        log('name is now', n);
      }
    }

    /*
      The token the chat asked for (#1322). The chat says 'token? <profile>'
      when it is about to connect and has none, askToken writes the ask, the
      launcher writes its answer to voice-token.txt, and this hands it over:
      the file is read once a second while an ask is out, and not at all
      otherwise. setToken sends a try that is waiting on it at once.

      It used to read the file every five minutes and pass on whatever the
      launcher had renewed there, the same hour long token the launcher's own
      page held. A token opens one connection now, so one nobody asked for is
      no use to anybody.
    */
    if (tokenWant && now - tokenAt > 1000) {
      tokenAt = now;
      const tok = joinToken();
      if (tok && tok !== lastToken && tokenProfile(tok) === tokenWant) {
        lastToken = tok;
        tokenWant = 0;
        T.js('try{window.thornswoodNet&&window.thornswoodNet.setToken(' +
             JSON.stringify(tok) + ');}catch(e){}');
        // Never the token itself, same as at injection.
        log('join token handed to the chat');
      }
    }
  }));

  // ------------------------------------------------------------ the server --
  // A black screen is not an answer.
  //
  // When the server stops, which it does on purpose every time an update is
  // published, the client does not say so and does not put anybody back
  // anywhere. It sits there, and after a moment the screen goes black, and the
  // only way out is the task manager.
  //
  // There is nothing in the client to hook for this, so it is asked directly.
  // The server's resources folder (RESOURCE_URL: 3000 on the main server, 7788
  // on dev) is the same HTTP the load order manifest comes from: if it answers, the server is up; if it stops answering several times
  // in a row, it is not. Several, because one slow reply is not an outage and
  // throwing somebody out of Windhelm over a dropped packet is worse than the
  // thing being fixed.
  const PROBE_MS = 10000;
  /*
    Twelve, not four.

    Four strikes is forty seconds, and a server deploy takes longer than that.
    So did a restart people had been told to sit through: the countdown said
    stay, the process went down for a minute, and everybody who did as they
    were told was dropped to the main menu anyway. Two minutes is longer than
    any restart this server has taken and still short enough that a real
    outage is not a black screen forever.

    And a countdown is not an outage at all. The gamemode writes "restarting"
    into online.json while one is running, so the answer that arrives just
    before the process stops says what is about to happen, and the strikes
    that follow are ignored until it comes back.
  */
  const PROBE_STRIKES = 12;
  /* How long a "restarting" seen in online.json keeps the probe patient.
     Longer than any restart so far, and it only ever delays a quit. */
  const RESTART_GRACE_MS = 600000;
  /*
    How long one probe may go unanswered before it counts as a strike.

    The flag that says a probe is out used to be cleared only by that probe's
    own answer, so one request that never came back switched this watchdog
    off for the rest of the session. And a request can take a long time to
    come back: the fork's HttpClient.cpp gives its httplib client no timeouts,
    and cpp-httplib 0.40.0 defaults both the connect and the read timeout to
    300 seconds. A server that accepts the connection and then says nothing
    held each probe for five minutes, so twelve strikes took an hour. And a
    request that throws on its worker thread never calls back at all: the
    pool keeps the error in a future HttpClient.cpp never reads, so the flag
    stayed set for good.

    So a probe that has not answered in fifteen seconds is a probe that did
    not answer: it counts as a strike and the next one goes out. Twelve of
    those is three minutes, against two for a server that refuses outright.
    Only clearing the flag was not enough, because the stuck requests would
    still take five minutes each to fail. An answer that arrives after its
    deadline still resets the count when it says the server is up, so a slow
    reply is not an outage.

    Never shorter than PROBE_MS. Every request waits on one pool of three
    threads shared with every other plugin, and a shorter deadline stacks
    more of them behind a server that has stopped answering.
  */
  const PROBE_DEADLINE_MS = 15000;

  let probe = null;
  try { probe = RESOURCE_URL ? new sp.HttpClient(RESOURCE_URL) : null; } catch (e) { probe = null; }

  // Asked for once, and again every ten minutes in case the server was
  // deployed while somebody was playing. Failure is silent and harmless.
  function askServerBases(now) {
    if (!probe) { return; }
    if (serverBasesAsked && now - serverBasesAsked < 600000) { return; }
    serverBasesAsked = now;
    try {
      probe.get('/server-bases.json', undefined, guard('bases', (res) => {
        if (!res || res.status < 200 || res.status >= 300) { return; }
        let list = [];
        try { list = (JSON.parse(String(res.body || '{}')) || {}).bases || []; }
        catch (e) { return; }
        let n = 0;
        for (const id of list) {
          const num = Number(id);
          if (num > 0 && !serverBases[num]) { serverBases[num] = true; n++; }
        }
        if (n) { log('the server answers for', n, 'more bases, not re-activating those'); }
      }));
    } catch (e) { }
  }

  let strikes = 0;
  let probing = false;
  let lastProbe = 0;
  /* When the probe now out was sent, and which one it is. See PROBE_DEADLINE_MS. */
  let probeStartedAt = 0;
  let probeSeq = 0;
  let leaving = 0;
  /* The game connection was closed for this outage, so a reconnect cannot
     put them back where they were standing. See the countdown above. */
  let leftClosed = false;
  /* The last whole second the way-out countdown put on screen, 0 before the
     first. See the quit in the tick above, the only place that can draw it. */
  let leavingSaid = 0;
  /* When the server last said a countdown was running. See PROBE_STRIKES. */
  let toldRestarting = 0;

  function checkServer(now) {
    if (!probe || leaving) return;
    if (probing && now - probeStartedAt > PROBE_DEADLINE_MS) {
      probing = false;
      log('the server has not answered in', PROBE_DEADLINE_MS / 1000, 'seconds');
      strikes++;
      onStrike();
    }
    if (probing || leaving) return;
    if (now - lastProbe < PROBE_MS) return;
    lastProbe = now;
    probeStartedAt = now;
    probing = true;
    const seq = ++probeSeq;
    try {
      probe.get('/online.json', undefined, guard('probe', (res) => {
        // An answer to a probe the deadline already counted. If it says the
        // server is up that still counts; if not, the strike is already in,
        // and the flag belongs to the probe that went out after it.
        const late = seq !== probeSeq || !probing;
        if (!late) { probing = false; }
        const ok = res && res.status >= 200 && res.status < 500;
        if (ok) {
          // The server said it is going down on purpose. Remember that, so
          // the silence that follows is read as a restart and not an outage.
          try {
            const body = JSON.parse(String(res.body || '{}'));
            if (body && body.restarting) {
              if (!toldRestarting) {
                log('the server says it is restarting, staying put');
              }
              toldRestarting = Date.now();
            } else {
              toldRestarting = 0;
            }
          } catch (e) { }
          if (strikes) { log('the server is answering again'); }
          strikes = 0;
          return;
        }
        if (late) { return; }
        strikes++;
        onStrike();
      }));
    } catch (e) {
      probing = false;
      strikes++;
      onStrike();
    }
  }

  function onStrike() {
    if (leaving) return;
    // Told to expect this. A restart is not an outage, and the whole point of
    // warning people was so they would not be thrown out for it.
    if (toldRestarting && Date.now() - toldRestarting < RESTART_GRACE_MS) {
      log('the server did not answer,', strikes, 'of', PROBE_STRIKES +
          ', but it said it was restarting, so waiting');
      return;
    }
    if (strikes < PROBE_STRIKES) {
      log('the server did not answer,', strikes, 'of', PROBE_STRIKES);
      return;
    }
    leaving = Date.now();
    /*
      A LOG LINE, NOT A NOTE, AND ON PURPOSE.

      This runs inside the probe's HttpClient callback, and SkyrimPlatform
      delivers those from its tick (TickImpl in SkyrimPlatform.cpp, in the
      fork), where there is no Papyrus VM. CallNativeApi.cpp throws "can't be
      called in this context" for any game call without one, and note()
      swallows that throw, so a note here would only ever reach the log again,
      which is the bug entry 159 was about. The quit in the update tick above
      draws the message and the countdown, where game calls work.

      The other way in is a probe that passed PROBE_DEADLINE_MS, which
      checkServer counts from the update tick, where a note would work. It is
      left to the same place anyway, so there is one message and one
      countdown however the outage was noticed.
    */
    say('the server has gone down, going back to the menu');
    log('server unreachable', PROBE_STRIKES, 'times running, quitting to the main menu');
  }

  /*
    Close the game, the one way this file ends Skyrim, for the three things
    that ask: the character choice page's Close the game ('select:quit'),
    the K panel's Close Skyrim while creating ('skills:quit'), and the close
    key in the RaceSex Menu (CLOSE_GAME_KEY). Every one of them asks twice
    before it gets here, so nothing here asks again.

    The two notes on 'select:quit' in the handler below say why this is
    win32.exitProcess and not Debug.quitGame, and why the browser is put down
    first. They were written for the character page and hold for all three:
    exitProcess needs no Papyrus, so it works from a tick as well as from
    the key's update.

    closingGame goes up first, so the race menu closing as the game comes
    apart is told as /racedown, not as a finished face.
  */
  function closeGame(from) {
    closingGame = true;
    log('menu: closing the game, asked from ' + from);
    try {
      T.js('try{' +
           'var v=document.querySelector("#ts-select video");' +
           'if(v){v.pause();v.removeAttribute("src");v.load();}' +
           'var a=document.querySelectorAll("audio");' +
           'for(var i=0;i<a.length;i++){a[i].pause();a[i].removeAttribute("src");}' +
           '}catch(e){}');
    } catch (e) { }
    try { sp.browser.setFocused(false); } catch (e) { }
    try { sp.browser.setVisible(false); } catch (e) { }

    let asked = false;
    try {
      if (sp.win32 && typeof sp.win32.exitProcess === 'function') {
        sp.win32.exitProcess();
        asked = true;
      }
    } catch (e) {
      log('menu: win32.exitProcess threw:', e);
    }
    if (!asked) {
      // Older clients have no win32. Debug.quitGame will almost certainly
      // throw from a tick for the reason in the notes, but a refusal that is
      // logged is better than none, and the page's own timeout puts the
      // button back.
      try { sp.Debug.quitGame(); asked = true; }
      catch (e) { log('menu: nothing could close the game:', e); }
    }
    if (asked) { log('menu: asked the engine to exit'); }
    else { closingGame = false; }
  }

  /*
    Whether the server's last word on this character is that it is being
    created. Read off the view the K panel passes back ('skills:view', see
    the tree block), so 'skills:quit' is taken only from somebody the server
    itself says is still creating, whatever the page thinks.
  */
  let skillsCreating = false;
  function skillsCreatingFrom(json) {
    try {
      const v = JSON.parse(String(json));
      const p = (v && v.panel && typeof v.panel === 'object') ? v.panel : v;
      skillsCreating = !!(p && p.creating);
    } catch (e) { }
  }

  sp.on('browserMessage', guard('browserMessage', (event) => {
    const a = event.arguments;
    if (!a) return;
    // The main menu's pick, addressed to skymp5-client and overheard here.
    if (a[0] === 'thornswood' && a[1] === 'select') {
      const id = Number(a[2]) || 0;
      if (id > 0) { menuChose(id); }
      return;
    }
    if (a[0] === 'thornswood-front' && String(a[1]).indexOf('where ') === 0) {
      const parts = String(a[1]).split(/\s+/);
      menuWhere(parts[1] || '', parts[2] || '');
      return;
    }
    if (a[0] !== 'thornswood-front') return;
    const what = String(a[1]);

    // Words above heads and speaking marks, never logged (overheadMessage).
    if (overheadMessage(what)) { return; }

    // A held key on the choice page asking who has the keyboard now (#591).
    if (what.indexOf('select:keycheck ') === 0) {
      menuBeatAt = Date.now();
      menuKeyCheck(what.slice(16));
      return;
    }

    // The chat is about to connect and has no join token (#1322).
    if (what.indexOf('token? ') === 0) {
      askToken(what.slice(7));
      return;
    }

    // The delete icon at the menu: one id, for the launcher, which drops the
    // character from its list on its next poll. The character stays on the
    // server; this is the old launcher's Delete, moved into the game.
    // The scroll in front of the choice: its checkbox, and the way back.
    // One word on disk for the launcher to pass on next time.
    if (what === 'select:intro off' || what === 'select:intro on') {
      try { require('fs').writeFileSync(INTRO_FILE, what.slice(13) + '\n'); }
      catch (e) { log('menu: could not write the scroll setting:', e); }
      log('menu: the scroll at the start is now', what.slice(13));
      // menuIntroOff is deliberately left where it was. That flag decides
      // whether this start waits for ever or falls back after three minutes,
      // and this tick box is about the next start. Somebody who ticks "Show
      // the sealed scroll next time" on the slots still has the three minutes
      // they had a moment ago, which is what they came in under.
      menuBeatAt = Date.now();
      return;
    }
    /*
      Continue was pressed on the scroll, so the choice starts now and the
      client's three minutes start with it. The page says this word to the
      client itself; it is repeated from here as well, because the page is the
      part that dies. See menuWatch.
    */
    if (what === 'select:choosing') {
      if (!menuWent) {
        menuWent = true;
        log('menu: Continue was pressed, so the three minutes to choose start now');
      }
      menuStayAt = 0;
      menuBeatAt = Date.now();
      return;
    }
    if (what.indexOf('select:forget ') === 0) {
      const gid = Number(what.slice(14)) || 0;
      if (gid > 0) {
        try { require('fs').appendFileSync(FORGET_FILE, gid + '\n'); }
        catch (e) { log('menu: could not write the forget for the launcher:', e); }
        log('menu: forgetting character', gid);
      }
      return;
    }
    /*
      Close the game, asked for from the character choice page.

      Patrick, 22 September: "add a close game button in the main menu with
      the chacrther selector". There was no way out of that page except
      alt-tabbing and killing the process, which is also what somebody does
      when the page itself is stuck, and Djinn's "Timed out" report ends with
      exactly that: "have to task out exit".

      Debug.quitGame is the engine's own exit and is what the main menu's Quit
      does. It goes through the front rather than the page because nothing in
      a browser can close Skyrim, and the page already talks to this plugin.

      The page asks twice before sending this, so there is no confirm here: a
      message that only arrives after somebody has said yes to leaving is not
      one to second guess.
    */
    // Are you still here (#1142); see the idle check.
    if (what === 'afk:here') { afkStillHere(); return; }
    if (what.indexOf('afk:out') === 0) {
      // From the relay (the server moved them) or the page; the move itself
      // needs update, where quitToMainMenu can run.
      if (!afkGone && !afkOutAsked) { afkOutAsked = 'the server moved them out for being idle'; }
      return;
    }
    if (what.indexOf('afk:') === 0) { log('idle window:', what.slice(4)); return; }
    // The server is ending this session (#1157), from the relay; the move
    // itself needs update, where quitToMainMenu can run. See sessionEnded.
    if (what === 'session:end') {
      if (!sessionEndAsked) { sessionEndAsked = String(a[2] || 'The server ended this session.'); }
      return;
    }
    // The pick, asking for a seat first (#481); see the line block.
    if (what.indexOf('select:want ') === 0) {
      menuBeatAt = Date.now();
      const wid = Number(what.slice(12)) || 0;
      if (wid > 0) { lineWant(wid); }
      return;
    }
    if (what === 'select:quit') {
      log('menu: closing the game, asked from the character choice page');
      // Nothing about the line may stop the quit.
      try { lineLeave(); } catch (e) { }
      /*
        win32.exitProcess, NOT Debug.quitGame, and the difference is the whole
        bug.

        Patrick, 22 September: "close game button in main menu doesnt wokr
        just says closing game forever", then "O it eventually closed it after
        like a whole minuite or so".

        Debug.quitGame is a PAPYRUS native. Every one of those needs a live VM
        and stack, which SkyrimPlatform only has inside its update handler:
        CallNativeApi throws "can't be called in this context" when the VM
        pointer is null. A browserMessage does not arrive inside one. It comes
        off a CEF thread and is handed over as a tick task, and tick tasks run
        with no VM at all, so the call threw every single time and the catch
        below ate it. thornswood-emotes.js has the same lesson written out at
        length, and solves it by queueing to update.

        QUEUEING WOULD NOT HAVE HELPED HERE. This button is only ever pressed
        at the main menu, and there is no update event at the main menu: the
        update loop is driven by a Papyrus native, so with no game loaded it
        never fires. That is why the whole character choice block in this file
        runs on tick rather than update.

        win32.exitProcess is a plain function with no Papyrus anywhere near
        it: it sets the engine's own quitGame flag, which is what
        Debug.quitGame ends up doing anyway. It works from a tick.

        The minute he waited was the game shutting down on its own terms after
        he gave up and closed it another way, not this call working slowly.
      */
      /*
        THE BROWSER IS PUT DOWN FIRST, AND THAT IS THE SLOW PART.

        Patrick, after the first fix: "close game button in main menu takes too
        long to actually close the game."

        Asking the engine to quit is instant. What is not is the unwind:
        SkyrimPlatform starts CEF with a multi threaded message loop, a
        windowless renderer and a separate browser subprocess, and CefShutdown
        is never called anywhere in the tree. So the UI, IO and renderer
        threads and the child process are left for the operating system to
        reap while the game is already coming apart, which is a well known way
        to sit there for a long time.

        And at the moment this button is pressed the page is doing its
        heaviest work: the character chooser is playing a looping background
        video and the theme track. An active video and audio pipeline inside a
        windowless CEF at teardown is the worst case of an already bad case.

        None of that can be fixed from here, since the shutdown is the
        engine's. What CAN be done is arriving at it with less to unwind: stop
        the media, drop focus, hide the browser, and only then ask to exit.

        The code these two notes describe is closeGame, above this handler,
        since the K panel's Close Skyrim and the close key in the RaceSex
        Menu end the game the same way.
      */
      closeGame('the character choice page');
      return;
    }
    // The character choice page reports in plain lines: ready, alive, the
    // first mouse move, the music, the pick. Every one is a pulse for the
    // silence watch above; the alive beats are not written down, the rest are.
    if (what.indexOf('select:') === 0) {
      menuBeatAt = Date.now();
      if (what.indexOf('select:alive') !== 0) { log('choice page:', what.slice(7)); }
      return;
    }
    // The loading screen (#3130) says when it went up and down by the page's
    // own clock, and how far the loop played. Sent during a load, so they
    // reach this log after it: the times in them are the record, not this
    // log's.
    if (what.indexOf('load:') === 0) { log('loading screen:', what.slice(5)); return; }

    /*
      The skills panel says when it opens and closes rather than being
      assumed. It can close itself on Escape, and a focus claim left up after
      that is a keyboard that never comes back, which is the failure
      claimFocus logs every single time for exactly this reason.
    */
    /*
      The three social panels say when they open and close, the same as the
      skills panel and for the same reason: a panel can close itself on
      Escape, and a focus claim left up after that is a keyboard that never
      comes back.
    */
    if (what === 'social:unavailable') {
      note('The social connection is loading. Try again in a moment.'); return;
    }
    if (what === 'party:opened' || what === 'journal:opened' || what === 'board:opened') {
      tellServer('/party refresh');
    }
    if (what === 'party:opened') { T.claimFocus('party', true); return; }
    if (what === 'party:closed') { T.claimFocus('party', false); return; }
    if (what === 'journal:opened') { T.claimFocus('journal', true); return; }
    if (what === 'journal:closed') { T.claimFocus('journal', false); return; }
    if (what === 'board:opened') { T.claimFocus('board', true); return; }
    if (what === 'board:closed') { T.claimFocus('board', false); return; }
    // The hold's drop box (#2298): its own panel, opened by E on the box.
    if (what === 'box:opened') { T.claimFocus('box', true); return; }
    if (what === 'box:closed') { T.claimFocus('box', false); return; }
    if (what === 'box:ready') { log('the drop box panel is in'); return; }
    // The trade ships' panel (#2700): a dock crate's E, or Ports and routes on K.
    if (what === 'ship:opened') { T.claimFocus('ship', true); return; }
    if (what === 'ship:closed') { T.claimFocus('ship', false); return; }
    if (what === 'ship:ready') { log('the trade ships panel is in'); return; }
    // A market stall's panel (#3160): the lock key at a stall.
    if (what === 'stall:opened') { T.claimFocus('stall', true); return; }
    if (what === 'stall:closed') { T.claimFocus('stall', false); return; }
    if (what === 'stall:ready') { log('the market stall panel is in'); return; }
    if (what.indexOf('board:near ') === 0) {
      const bits = what.slice('board:near '.length).trim().split(/\s+/);
      if (bits[0] === 'none' || bits.length < 3) { boardNear = null; return; }
      let hold = '';
      let bx, by, bz;
      if (bits.length >= 4 && !isFinite(Number(bits[0]))) {
        hold = bits[0];
        bx = Number(bits[1]); by = Number(bits[2]); bz = Number(bits[3]);
      } else {
        bx = Number(bits[0]); by = Number(bits[1]); bz = Number(bits[2]);
      }
      if (!isFinite(bx) || !isFinite(by) || !isFinite(bz)) { boardNear = null; return; }
      boardNear = { hold: hold, x: bx, y: by, z: bz };
      return;
    }
    if (what === 'maneuvers:opened') { T.claimFocus('maneuvers', true); return; }
    if (what === 'maneuvers:closed') { T.claimFocus('maneuvers', false); return; }
    if (what === 'maneuvers:ready') { log('the maneuver panel is in'); maneuversToPage(); return; }
    if (what === 'help:opened') { T.claimFocus('help', true); return; }
    if (what === 'help:closed') { T.claimFocus('help', false); return; }
    if (what === 'help:ready') { log('the help panel is in'); helpToPage(); return; }
    // Report a problem (#3155): to the game server as /problem, which takes
    // where the character stands itself and sends it on to the site.
    if (what.indexOf('help:problem ') === 0) {
      const text = what.slice(13).replace(/\s+/g, ' ').trim().slice(0, 1000);
      if (text) { log('help: a problem report sent,', text.length, 'characters'); tellServer('/problem ' + text); }
      return;
    }
    // The Settings panel (#3126): opened from Settings on the help, K, P and
    // J panels; every change it asks for is checked and written here.
    if (what === 'settings:opened') { T.claimFocus('settings', true); settingsToPage(''); return; }
    if (what === 'settings:closed') { T.claimFocus('settings', false); return; }
    if (what === 'settings:ready') { log('the settings panel is in'); settingsToPage(''); return; }
    if (what.indexOf('settings:set ') === 0) {
      const bits = what.slice('settings:set '.length).trim().split(/\s+/);
      setSetting(bits[0], bits[1]);
      return;
    }
    if (what === 'trade:opened') { T.claimFocus('trade', true); return; }
    if (what === 'trade:closed') { T.claimFocus('trade', false); return; }
    if (what === 'repair:opened') { T.claimFocus('repair', true); return; }
    if (what === 'repair:closed') { T.claimFocus('repair', false); return; }
    if (what === 'repair:ready') { log('the repair panel is in'); return; }
    if (what === 'preserve:opened') { T.claimFocus('preserve', true); return; }
    if (what === 'preserve:closed') { T.claimFocus('preserve', false); return; }
    if (what === 'preserve:ready') { log('the preserving panel is in'); return; }
    if (what === 'furniture:opened') { T.claimFocus('furniture', true); return; }
    if (what === 'furniture:closed') { T.claimFocus('furniture', false); return; }
    if (what === 'furniture:ready') { log('the furniture panel is in'); return; }
    if (what === 'treat:opened') { T.claimFocus('treat', true); return; }
    if (what === 'treat:closed') { T.claimFocus('treat', false); return; }
    if (what === 'treat:ready') { log('the treatment panel is in'); return; }
    if (what === 'merchant:opened') { T.claimFocus('merchant', true); return; }
    if (what === 'merchant:closed') { T.claimFocus('merchant', false); return; }
    if (what === 'merchant:ready') {
      log('the merchant panel is in');
      return;
    }
    // The ride panel (#1635): see THE RIDE PANEL WAITS above.
    if (what === 'ride:wants') { rideState = 'waiting'; rideOpenIfFree(''); return; }
    if (what === 'ride:opened') { rideState = 'up'; T.claimFocus('ride', true); return; }
    if (what === 'ride:closed') {
      T.claimFocus('ride', false);
      if (rideState === 'up') { rideState = ''; }
      return;
    }
    if (what === 'ride:ready') { log('the ride panel is in'); return; }
    if (what === 'party:ready' || what === 'journal:ready' || what === 'trade:ready' || what === 'board:ready') {
      // The P panel closes on P itself while it holds the keyboard, so it
      // is told which key P is (#1919).
      if (what === 'party:ready') {
        T.js('try{window.thornswoodParty&&window.thornswoodParty.setKey&&window.thornswoodParty.setKey(' +
             JSON.stringify(PARTY_NAME) + ');}catch(e){}');
      }
      // And the J panel on J, wherever the Settings panel has put it (#3126).
      if (what === 'journal:ready') {
        T.js('try{window.thornswoodJournal&&window.thornswoodJournal.setKey&&window.thornswoodJournal.setKey(' +
             JSON.stringify(keyName(JOURNAL_KEY)) + ');}catch(e){}');
      }
      tellServer(what === 'trade:ready' ? '/trade refresh' : '/party refresh');
      log('the ' + what.split(':')[0] + ' panel is in');
      return;
    }

    /*
      Close Skyrim, from the K panel while creating. The page offers it only
      while creating and asks twice first (closeButton in
      thornswood-skills.js); this also asks the server's own last word, so
      nothing outside creation can end the game from here.
    */
    if (what === 'skills:quit') {
      if (!skillsCreating) {
        log('skills: the panel asked to close the game, but the server last said this character is not being created; not closing');
        return;
      }
      closeGame('the K panel, while creating');
      return;
    }
    if (what.indexOf('skills:quit ') === 0) { log('skills:', what.slice(7)); return; }

    if (what === 'skills:opened') { T.claimFocus('skills', true); return; }
    // Change character (#3128); the wait itself runs in update.
    if (what === 'skills:switch') { switchAsked = true; return; }
    if (what === 'skills:closed') { T.claimFocus('skills', false); return; }
    if (what === 'skills:ready' || what === 'skills:refresh') {
      if (what === 'skills:ready') {
        log('the skills panel is in');
        // The K panel closes on K itself while it holds the keyboard, so it
        // is told which key K is (#1919).
        T.js('try{window.thornswoodSkills&&window.thornswoodSkills.setKey&&window.thornswoodSkills.setKey(' +
             JSON.stringify(keyName(SKILLS_KEY)) + ');}catch(e){}');
      }
      // The panel mounts after the first property write of the session, so
      // it asks the server to say again what this character already is, and
      // asks again every time it opens. The answer comes back through the
      // property's own updateOwner script.
      //
      // That script hands the view to the page and never to this file, so the
      // page is asked to pass it back before the answer to that refresh
      // arrives. See the tree block below.
      treeForwardInstall();
      tellServer('/pick refresh');
      return;
    }
    if (what.indexOf('skills:pick ') === 0) {
      /*
        Sent to the server as a slash line over the chat socket, the same
        route a broken lockpick travels. The voice service stamps the profile
        id from the connection, so what arrives is "this person picked",
        never "this text claims to be". The server answers by rewriting the
        property, which is what redraws the panel; a refusal comes back as a
        chat line saying why.
      */
      const rest = what.slice(12).trim();
      log('skills: picked', rest, '- sent as /pick');
      tellServer('/pick ' + rest);
      return;
    }

    /*
      The panel view, passed back out of the page. Two spellings, because two
      halves can send it: the forwarder this file puts on the panel's setData
      sends the whole view, and a panel that decides to send the totals on its
      own can send the map by itself. The same numbers arriving twice cost
      nothing; an unchanged map is never applied twice.
    */
    if (what.indexOf('skills:view ') === 0) {
      skillsCreatingFrom(what.slice(12));
      treeFromView(what.slice(12));
      maneuversFromView(what.slice(12));
      perksFromView(what.slice(12));
      return;
    }
    if (what.indexOf('skills:effects ') === 0) { treeFromMap(what.slice(15)); return; }

    if (what === 'typing') { beat = Date.now(); return; }
    if (what === 'typing-idle') {
      log('nobody typed for a while, the box is giving the keyboard back');
      return;
    }

    if (what === 'typing-on') {
      asked = 0;
      beat = Date.now();
      T.claimFocus('chat', true);
      return;
    }

    if (what === 'typing-off') {
      asked = 0;
      T.claimFocus('chat', false);
      return;
    }

    if (what === 'typing-fail') {
      asked = 0;
      boxReady = false;
      T.claimFocus('chat', false);
      say('the page has no chat box, so the keyboard stays with the game');
      return;
    }

    if (what === 'chat is up') {
      boxReady = true;
      log('chat box is ready, enter is immediate from here');
      return;
    }

    /*
      The page can be reloaded out from under us, and on some machines it is.
     
      The bridge announces itself once per page load. Seeing it again after the
      overlays have gone in does not mean the bridge restarted, it means the
      page did, and everything our scripts built went with it: the chat box, the
      microphone indicator, the wheel. The scripts themselves are gone too.
     
      Nothing noticed, because by then this file has reached its last phase and
      stops injecting. One machine's log is the whole story:
     
          overlays injected
          thornswood-voice.js is in
          ready
          bridge is up            <- the page went away here
     
      followed by a session of "the page has no chat box" and a voice log that
      never gets past being told to open a microphone. Same files as everybody
      else, same build, and nothing on screen, because the browser was showing
      a page our overlays had already been removed from.
     
      Whoever reloads it, the answer from here is the same: go back and put them
      in again. Injection already refuses to add a script twice, so a spurious
      one costs nothing.
    */
    if (what === 'bridge is up') {
      if (phase >= 2) {
        say('the page reloaded after the overlays went in, putting them back');
        phase = 1;
        at = Date.now();
        boxReady = false;
        T.ready = false;
        keepCommandKey(false);
        try { T.claimFocus('chat', false); } catch (e) { }
      }
      return;
    }

    log(what);
  }));

  // ------------------------------------------------- the map's calendar --
  /*
    THE MAP'S CALENDAR: THE DATE, THE SEASON AND THE SERVER CLOCK (#3156).

    Patrick, 22 Oct 2026, on his page: C, on the map menu. A strip at the top
    of the screen while MapMenu is up, gone the moment it closes:

      26th of Frostfall, 4E 252
      Autumn, winter in 3 days
      Server clock 9:46 AM MDT, yours 4:46 PM

    THE DATE is the game's own calendar, the globals the game's map line
    reads (GameDay 0x37, GameMonth 0x36, GameYear 0x35), which the engine's
    TimeService writes from today's date in UTC. It is read here rather than
    worked out again, so this line and the game's never disagree. There is
    no day of the week: the game counts that from GameDaysPassed, which
    TimeService never writes (#841), so it is not the same for two people.

    THE SEASON AND THE SERVER CLOCK are the server's, handed over by the
    calendar property (gamemode.js, THE DATE, THE SEASON AND THE SERVER CLOCK
    ON THE MAP) through globalThis.thornswoodCalendar, as the drunk screen's
    is. The server clock is the box's zone put on this machine's own clock,
    the clock the sky already runs on. Yours shows only when your zone is not
    the server's. Before the server has said anything, the date shows alone.

    Read once a second while the map is up, and written to the page only when
    a line changed, which is once a minute.
  */
  const MAP_MENU = 'MapMenu';
  const MAP_CAL_ID = 'ts-map-calendar';
  const MAP_CAL_EVERY_MS = 1000;
  // GameMonth counts from 0, Morning Star.
  const MONTHS = ['Morning Star', 'Sun\'s Dawn', 'First Seed', 'Rain\'s Hand', 'Second Seed', 'Midyear',
                  'Sun\'s Height', 'Last Seed', 'Hearthfire', 'Frostfall', 'Sun\'s Dusk', 'Evening Star'];
  const GAME_DAY = 0x37;
  const GAME_MONTH = 0x36;
  const GAME_YEAR = 0x35;
  let mapCalendar = null;   // what the server last handed over
  let mapUp = false;
  let mapCalAt = 0;
  let mapCalShown = '';
  let mapCalUnread = false; // the calendar could not be read, said once a map

  globalThis.thornswoodCalendar = function (v) { mapCalendar = v; mapCalShown = ''; };

  function ordinal(n) {
    const t = n % 100;
    if (t >= 11 && t <= 13) { return n + 'th'; }
    if (n % 10 === 1) { return n + 'st'; }
    if (n % 10 === 2) { return n + 'nd'; }
    if (n % 10 === 3) { return n + 'rd'; }
    return n + 'th';
  }

  function clock12(h, m) {
    const hh = h % 12 === 0 ? 12 : h % 12;
    return hh + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' AM' : ' PM');
  }

  function gameGlobal(id) {
    const gv = sp.GlobalVariable.from(sp.Game.getFormEx(id));
    return gv ? Math.floor(gv.getValue()) : NaN;
  }

  function mapDateLine() {
    let day = NaN, month = NaN, year = NaN;
    try {
      day = gameGlobal(GAME_DAY);
      month = gameGlobal(GAME_MONTH);
      year = gameGlobal(GAME_YEAR);
    } catch (e) {
      if (!mapCalUnread) { mapCalUnread = true; log('map calendar: the game\'s calendar could not be read: ' + e); }
      return '';
    }
    if (!(day >= 1 && day <= 31) || !(month >= 0 && month <= 11) || !(year >= 1)) {
      if (!mapCalUnread) {
        mapCalUnread = true;
        log('map calendar: the game\'s calendar reads day ' + day + ', month ' + month + ', year ' + year + ', so no date');
      }
      return '';
    }
    return ordinal(day) + ' of ' + MONTHS[month] + ', 4E ' + year;
  }

  function untilWords(ms) {
    const H = 3600000;
    if (ms >= 36 * H) { return 'in ' + Math.round(ms / (24 * H)) + ' days'; }
    if (ms >= 90 * 60000) { return 'in ' + Math.round(ms / H) + ' hours'; }
    return 'within the hour';
  }

  function capital(w) { return w.charAt(0).toUpperCase() + w.slice(1); }

  function mapSeasonLine(cal, now) {
    if (!cal || !cal.season) { return ''; }
    const line = capital(cal.season);
    if (!cal.next || !(cal.turns > now)) { return line; }
    return line + ', ' + cal.next + ' ' + untilWords(cal.turns - now);
  }

  function mapClockLine(cal, now) {
    if (!cal || typeof cal.off !== 'number' || !isFinite(cal.off)) { return ''; }
    const s = new Date(now + cal.off * 60000);
    let line = 'Server clock ' + clock12(s.getUTCHours(), s.getUTCMinutes()) + (cal.tz ? ' ' + cal.tz : '');
    const here = new Date(now);
    if (-here.getTimezoneOffset() !== cal.off) {
      line += ', yours ' + clock12(here.getHours(), here.getMinutes());
    }
    return line;
  }

  function mapCalendarLines(now) {
    return [mapDateLine(), mapSeasonLine(mapCalendar, now), mapClockLine(mapCalendar, now)]
      .filter(function (l) { return !!l; });
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /*
    The strip, in the needs HUD's own pixels (--ts, gamemode.js hudScript):
    the screen's height over 720 or its width over 1280, whichever is smaller,
    so it sits in the same place at every screen size. Centred at the top,
    where the map has nothing of its own.
  */
  const MAP_CAL_CSS = '--ts:min(0.078125vw,0.1388889vh);' +
    'position:fixed;left:50vw;top:calc(50vh - 350 * var(--ts));transform:translateX(-50%);' +
    'z-index:2147483500;pointer-events:none;text-align:center;white-space:nowrap;' +
    'font-family:Georgia,serif;font-size:calc(11 * var(--ts));line-height:1.35;color:#efe4cc;' +
    'background:rgba(12,10,8,.62);border:calc(1 * var(--ts)) solid rgba(0,0,0,.65);' +
    'border-radius:calc(4 * var(--ts));padding:calc(4 * var(--ts)) calc(10 * var(--ts));' +
    'text-shadow:0 1px 3px rgba(0,0,0,.95)';

  function drawMapCalendar(now) {
    const lines = mapCalendarLines(now);
    const text = lines.join('\n');
    if (text === mapCalShown) { return; }
    mapCalShown = text;
    if (!lines.length) { hideMapCalendar(); return; }
    const html = lines.map(function (l) { return '<div>' + escapeHtml(l) + '</div>'; }).join('');
    T.js('(function(){try{' +
         'var d=document.getElementById(' + JSON.stringify(MAP_CAL_ID) + ');' +
         'if(!d){d=document.createElement("div");d.id=' + JSON.stringify(MAP_CAL_ID) + ';' +
         'd.style.cssText=' + JSON.stringify(MAP_CAL_CSS) + ';document.body.appendChild(d);}' +
         'd.innerHTML=' + JSON.stringify(html) + ';' +
         '}catch(e){}})();');
  }

  function hideMapCalendar() {
    T.js('(function(){try{var d=document.getElementById(' + JSON.stringify(MAP_CAL_ID) + ');' +
         'if(d&&d.parentNode){d.parentNode.removeChild(d);}}catch(e){}})();');
  }

  sp.on('menuOpen', guard('map calendar open', (e) => {
    if (!e || e.name !== MAP_MENU) { return; }
    mapUp = true;
    mapCalAt = 0;
    mapCalShown = '';
    mapCalUnread = false;
  }));
  sp.on('menuClose', guard('map calendar close', (e) => {
    if (!e || e.name !== MAP_MENU) { return; }
    mapUp = false;
    mapCalShown = '';
    hideMapCalendar();
  }));
  sp.on('update', guard('map calendar', () => {
    if (!mapUp) { return; }
    const now = Date.now();
    if (now - mapCalAt < MAP_CAL_EVERY_MS) { return; }
    mapCalAt = now;
    drawMapCalendar(now);
  }));
  // ------------------------------------------------ end the map's calendar --

  // ------------------------------------------------------- the screen look --
  /*
    docs/systems/drink.md and exhaustion.md: drunk, high, a hangover and
    withdrawal each have a look of their own (Patrick, 12 Oct 2026, decision 3
    on #1382 for drunk; 22 Oct 2026 on #3153 for the rest: "I also want visual
    affects"). The server decides which one shows (lookNow in gamemode.js) and
    the needs HUD script hands the word here through globalThis.thornswoodLook,
    the one thing the two scopes share, as thornswoodCatchFire is.

    Each look is a content plugin record of Thornswood's own
    (scripts/mods/Add-ContentRecords.py, THE SCREEN LOOKS): drunk is double
    vision, blur and a sway as the head turns; high is colour and light turned
    up with a warm wash; a hangover is light too bright and colour drained;
    withdrawal is grey, hard and cold at the edges. None is animatable, so
    each holds for as long as it is applied: applied as the cross fade
    modifier while the server says so, cross faded into the next when the
    word changes, and taken off when it is nothing. Skyrim keeps one cross
    fade modifier at a time, so it is only ever taken off after this applied
    one.
  */
  const LOOK_FILE = 'Thornswood-Content.esp';
  const LOOKS = { drunk: 0x18020, high: 0x18021, hangover: 0x18022, withdrawal: 0x18023 };
  const LOOK_FADE = 3.0;   // seconds, in and out
  let lookWanted = '';
  let lookShown = '';
  // A content plugin older than a record: said once, and nothing drawn for it.
  const lookMissing = {};

  globalThis.thornswoodLook = function (name) {
    lookWanted = Object.prototype.hasOwnProperty.call(LOOKS, name) ? name : '';
  };

  sp.on('update', guard('look', () => {
    const want = (lookWanted && !lookMissing[lookWanted]) ? lookWanted : '';
    if (want === lookShown) { return; }
    if (!want) {
      sp.ImageSpaceModifier.removeCrossFade(LOOK_FADE);
      lookShown = '';
      return;
    }
    const mod = sp.ImageSpaceModifier.from(sp.Game.getFormFromFile(LOOKS[want], LOOK_FILE));
    if (!mod) {
      log('look: no', want, 'record in', LOOK_FILE, 'so nothing is drawn for it');
      lookMissing[want] = true;
      return;
    }
    mod.applyCrossFade(LOOK_FADE);
    lookShown = want;
  }));

  // ----------------------------------------------- what the skill tree adds --
  /*
    The tree has to change the character, and the server cannot do it.

    Base health, magicka and stamina are worked out from the race record when
    the character is made (skymp5-server, GetBaseActorValues.cpp), and our own
    Thornswood-Content.esp holds no spell, magic effect or perk record to hand
    out, which is what a parse of it says. So the server owns the arithmetic
    and this file owns the hand that puts it on the character. It decides
    nothing else: a value the server did not send is a value nothing here
    touches.

    WHAT ARRIVES. A map of what the tree adds up to, only the entries that are
    not zero:

        { health: 25, magicka: 10, stamina: 0, carryWeight: 40, speedMult: 3 }

    and anything else of the same shape. The key is a Skyrim actor value name
    in lower camel case and goes through to the game as it arrives, because
    the game's own names are case insensitive: skymp5-client.js sets "health"
    and "Aggression" in the same breath (line 5453 and its neighbours).

    HOW IT ARRIVES. The property's updateOwner script runs inside
    skymp5-client and hands the view to window.thornswoodSkills.setData in the
    page. It never reaches this file. So the page is asked to pass it back:
    treeForwardInstall puts a wrapper on setData that sends the view out as a
    browserMessage, the same route every other line from the panel travels,
    and it goes in when the panel says it is ready, before the /pick refresh
    that answer comes from.

    SET, NOT MOD. setActorValue writes the base value to a number this block
    worked out. modActorValue adds to whatever is in front of it, and a
    repeated add is the whole failure being avoided here: the view is pushed
    again every time anything about the character changes, and a session of
    adds is somebody growing without limit. Every pass here works out one
    total, the natural value plus what the tree adds, and sets that, so the
    same map applied a second time lands on the same number. getBaseActorValue
    reads the base back, which is what the total is worked out from.

    WHAT NATURAL IS. The base with this plugin's own change taken back out of
    it. The record below keeps both halves of the last pass, what was added
    and what the base was left reading, because our change is not always still
    there: skymp5-client rewrites health, magicka, stamina and their rates
    from the server's spawn props every time it spawns somebody
    (skymp5-client.js line 5453). So the base only counts as ours when it
    still reads exactly what we set it to. Anything else and the base in front
    of us is the natural one already and there is nothing of ours to take
    back.

    The block between the markers is lifted out by
    <scratchpad>\treeapplytest.js, which drives it against a fake
    skyrimPlatform. Moving the markers moves the test.
  */
  // >>> tree apply: begin >>>

  /* The map the server last sent, waiting for a frame that can call the game. */
  let treeWant = null;
  /* That map as sorted text, so a view saying the same thing costs nothing. */
  let treeSig = '';
  /* Set while treeWant has not been put on the character yet. */
  let treeDirty = false;
  /* lower case name -> { name, add, total }: what was added and what the base
     was left reading. See WHAT NATURAL IS above. */
  let treeMine = {};

  /*
    The wrapper the page runs. Idempotent: the flag it leaves means a second
    install does nothing, and a page that reloads takes the flag with it, so
    the next 'skills:ready' puts a fresh one on the fresh panel.
  */
  const TREE_FORWARD = [
    '(function(){try{',
    '  var s = window.thornswoodSkills;',
    '  if (!s || s.__thornswoodTreeForward) { return; }',
    '  var was = s.setData;',
    '  s.setData = function(table, got){',
    '    try { window.skyrimPlatform.sendMessage("thornswood-front",',
    '          "skills:view " + JSON.stringify(got || null)); } catch(e) {}',
    '    return was.apply(this, arguments);',
    '  };',
    '  s.__thornswoodTreeForward = true;',
    '}catch(e){}})();'
  ].join('\n');

  function treeForwardInstall() {
    try { T.js(TREE_FORWARD); } catch (e) { log('tree: could not ask the page to pass the view back:', e); }
  }

  /* Only names the game could have, only numbers, and nothing that adds up to
     zero, which is the same as not being sent. */
  function treeNumbers(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') { return out; }
    for (const k in raw) {
      if (!Object.prototype.hasOwnProperty.call(raw, k)) { continue; }
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(k)) { continue; }
      const n = Number(raw[k]);
      if (!isFinite(n) || n === 0) { continue; }
      out[k] = n;
    }
    return out;
  }

  function treeSigOf(map) {
    const keys = Object.keys(map).sort();
    const parts = [];
    for (let i = 0; i < keys.length; i++) { parts.push(keys[i] + '=' + map[keys[i]]); }
    return parts.join(',');
  }

  /* A map has arrived. Nothing is called on the game here: this can be any
     frame at all, and the calls only work in update. */
  function treeSeen(map) {
    const sig = treeSigOf(map);
    if (sig === treeSig && !treeDirty) { return; }
    treeWant = map;
    treeDirty = true;
  }

  /* The whole panel view. The totals are its own field and nothing else in it
     is read, because a view is full of numbers that are not actor values. */
  function treeFromView(json) {
    let v = null;
    try { v = JSON.parse(String(json)); } catch (e) { log('tree: the view did not parse:', e); return; }
    if (!v || typeof v !== 'object') { return; }
    let raw = {};
    if (v.effects && typeof v.effects === 'object') { raw = v.effects; }
    else if (v.panel && v.panel.effects && typeof v.panel.effects === 'object') { raw = v.panel.effects; }
    treeSeen(treeNumbers(raw));
  }

  /* The map on its own. */
  function treeFromMap(json) {
    let m = null;
    try { m = JSON.parse(String(json)); } catch (e) { log('tree: the totals did not parse:', e); return; }
    if (!m || typeof m !== 'object') { return; }
    if (m.effects && typeof m.effects === 'object') { m = m.effects; }
    treeSeen(treeNumbers(m));
  }

  function treeApplyNow(pc) {
    const next = treeWant || {};
    const mine = {};
    const said = [];
    /* Every value this block last touched, so it can be taken back, and every
       value the server is sending now. Nothing else is looked at. */
    const todo = {};
    for (const key in treeMine) { todo[key] = treeMine[key].name; }
    for (const k in next) { todo[k.toLowerCase()] = k; }

    for (const key in todo) {
      const name = todo[key];
      const add = Number(next[name] || 0) || 0;
      const rec = treeMine[key];
      try {
        const base = Number(pc.getBaseActorValue(name));
        if (!isFinite(base)) {
          if (rec) { mine[key] = rec; }
          log('tree: the game had no number for', name + ', leaving it alone');
          continue;
        }
        const natural = (rec && base === rec.total) ? base - rec.add : base;
        const want = natural + add;
        if (want !== base) { pc.setActorValue(name, want); }
        if (add) {
          mine[key] = { name: name, add: add, total: want };
          said.push(name + ' ' + (add > 0 ? '+' : '') + add + ' (' + want + ')');
        }
      } catch (e) {
        /* The set threw, so the base is whatever it was and the old record is
           still the truth about it. Said once and not retried: the next view
           that says something different comes through here again. */
        if (rec) { mine[key] = rec; }
        log('tree: could not set', name + ':', e);
      }
    }

    treeMine = mine;
    treeSig = treeSigOf(next);
    log('tree:', said.length
      ? ('the server\'s totals are on the character: ' + said.join(', '))
      : 'the server sends no totals, so anything this plugin added is off again');
  }

  /*
    After the world and not before. __thornswoodInWorld is the flag the tick
    above sets the moment there is a character and no menu, which is the same
    signal this file already uses for the browser, and update is the event
    where calls into the game work at all.
  */
  sp.on('update', guard('tree', () => {
    if (!treeDirty) { return; }
    let here = false;
    try { here = !!globalThis.__thornswoodInWorld; } catch (e) { here = false; }
    if (!here) { return; }
    let pc = null;
    try { pc = sp.Game.getPlayer(); } catch (e) { pc = null; }
    if (!pc) { return; }
    treeDirty = false;
    treeApplyNow(pc);
  }));

  // <<< tree apply: end <<<

  // ------------------------------------ what a filled perk does on this machine --
  /*
    THE FILLED PERKS THAT HAPPEN ON THE PERSON'S OWN MACHINE (#1385).

    docs/systems/skill-tree.md is the table. The server fires every perk it
    can reach (the skill perks block in game/gamemode.js). These
    happen where it cannot: what a stagger, a sprint, a power attack and a
    fall do to you is worked out by the game on your own machine, and the
    health and stamina that leaves is what skymp5-client sends the server
    (sendInputsService.ts, a change of values the server takes as it comes,
    ActionListener::OnChangeValues).

    WHICH ARE HELD comes off the K panel's view, the same view the tree hand
    and the maneuver rows read (skills:view): its perks, the server's own
    list (P.perks over the tree, forPanel in the character block). A view
    with no list says nothing about perks and changes nothing here.

    UNSHAKEABLE, "nothing staggers you while you are blocking"
    (site/data/site/classes.md, the Resilience row). A stagger is the
    animation event staggerStart on your own character, 0x14: the same event
    Plant refuses below, and skymp5-client's deathService refuses on
    everybody else's characters, in the same sendAnimationEvent hook. While
    Unshakeable is held and your block is up it is blanked, so the game
    never starts it. AnimationSource sends only an event that played, so
    nobody else sees it either: the fork's #57 plays a stagger that came
    over the network, and this one never goes out. Script functions cannot
    be called inside a hook, so whether the block is up is the game's own
    IsBlocking read once a frame in update, the variable skymp5-client reads
    every frame to send your block to the server (movementGet.ts), the same
    way its own combat service hands sprint and stamina to its hooks. The
    server refuses its own Break and Wreck on a blocking holder the same
    way (staggerOf in the maneuvers block).

    WINDWALKER, the fall. Fall damage is the game's own sum, from three game
    settings that are the person's own character's: fJumpFallHeightMin,
    fJumpFallHeightMult and fJumpFallHeightExponent. Everybody else has a
    set of their own, the same names ending in NPC. Both sets were read out
    of Skyrim.esm on 12 Oct and nothing in the load order overrides either.
    So fJumpFallHeightMult is 0 while Windwalker is held: the sum comes to
    nothing however far the fall, for this character and nobody else.

    TIRELESS. Running costs nothing in this game and neither does a plain
    swing. A sprint, a power attack and a shield bash do, and each is the
    game's own sum from game settings (Skyrim.esm, overridden by nothing in
    the load order; skymp5-server's attack costs are SweetPie's only, and
    this server does not load SweetPie): fSprintStaminaDrainMult for a
    sprint, fStaminaAttackWeaponBase plus fStaminaAttackWeaponMult times the
    weapon's weight for a power attack, and fStaminaBashBase and
    fStaminaPowerBashBase for a bash and a power bash. A bash counts as a
    swing (Patrick, 12 Oct: one rule for every attack). Each is held at half
    while Tireless is held. These have no second set for everybody else, so
    an NPC this machine runs pays half as well, which Patrick kept (12 Oct).

    PACK MULE, "being overloaded does not slow you". Being overloaded has
    one effect here: the game makes you walk, on your own machine, and no
    game setting changes that. The engine fork's client keeps a list of
    characters the game does not hold to their carry weight (Patrick chose
    the engine change on 12 Oct, #1385): for one on it, the game's own
    Actor::IsOverEncumbered answers no, so it never makes you walk, and the
    fork's movement sends your run to everybody else as it plays. While Pack
    Mule is held, your own character is on that list. The inventory still
    shows your real carry weight.

    OVERCHARGE, "one spell in five ... holds twice as long". A spell's
    effects run on the machine that runs the actor they land on, and the
    game gives each one its duration there. The engine fork counts the casts
    this machine makes for a character with a rule on it
    (setCastDurationEvery): every fifth spell of yours that holds (one you
    cast and let go, with an effect that lasts a time and none that takes
    health) holds twice as long here, and the cast says so to the server.
    The server counts the same casts by the same rule (holdsLonger in the
    skill perks block) and tells everybody else's machine to hold it twice
    as long too. While Overcharge is held, your own character has that rule;
    the numbers are the gamemode's PERKS.overcharge, inEvery and longer.

    SET FROM THE GAME'S OWN VALUE, NOT FROM A NUMBER WRITTEN HERE. What a
    setting read before this file first touched it is kept in sp.storage,
    which outlives a plugin reload in the same game, so a reload never takes
    this file's own write for the game's. A perk not held puts the game's
    own value back. Each change is one line in the log.

    The block between the markers is lifted out by tests/test-1385-perks.js,
    which drives it against a fake skyrimPlatform.
  */
  // >>> machine perks: begin >>>

  /* perk -> { game setting: the share of the game's own value it is held at }. */
  const PERK_SETTINGS = {
    windwalker: { fJumpFallHeightMult: 0 },
    tireless: {
      fSprintStaminaDrainMult: 0.5, fStaminaAttackWeaponBase: 0.5, fStaminaAttackWeaponMult: 0.5,
      fStaminaBashBase: 0.5, fStaminaPowerBashBase: 0.5
    }
  };

  let perksHeld = {};               // perk -> true, the view's list
  let perksSig = null;              // that list as text, null until a view has said
  let perksDirty = false;           // the settings have not caught up with perksHeld yet
  let unshakeableBlocking = false;  // IsBlocking at the last frame, read only while Unshakeable is held
  let unshakeableRefused = 0;       // staggers refused while blocking, for the log
  let unshakeableOpen = 0;          // staggers that played with the block down, for the log
  let unshakeableSaid = 0;
  let unshakeableOpenSaid = 0;
  let packMuleKept = null;          // what the client's list was last told, null until a view has said
  let overchargeKept = null;        // what the client's cast count was last told, null until a view has said

  /* Overcharge's other half: every fifth cast that holds, twice as long. */
  const OVERCHARGE = { every: 5, longer: 2 };

  /* The whole panel view, as treeFromView takes it. Only its perks are read. */
  function perksFromView(json) {
    let v = null;
    try { v = JSON.parse(String(json)); } catch (e) { return; }
    if (!v || typeof v !== 'object') { return; }
    const view = (v.panel && typeof v.panel === 'object') ? v.panel : v;
    if (!Array.isArray(view.perks)) { return; }
    const held = {};
    for (let i = 0; i < view.perks.length; i++) {
      const k = view.perks[i];
      if (typeof k === 'string' && /^[a-z]+$/.test(k)) { held[k] = true; }
    }
    const sig = Object.keys(held).sort().join(',');
    if (sig === perksSig) { return; }
    perksSig = sig;
    perksHeld = held;
    perksDirty = true;
    if (!held.unshakeable) { unshakeableBlocking = false; }
  }

  function perkNatural() {
    let kept = null;
    try { kept = sp.storage.thornswoodPerkNatural; } catch (e) { kept = null; }
    if (!kept || typeof kept !== 'object') {
      kept = {};
      try { sp.storage.thornswoodPerkNatural = kept; } catch (e) { }
    }
    return kept;
  }

  /* Every setting a perk touches: the game's own value times the share of
     each perk held that names it. Only in update, where the calls work. */
  function perkSettingsNow() {
    const natural = perkNatural();
    const share = {};
    for (const key in PERK_SETTINGS) {
      for (const name in PERK_SETTINGS[key]) {
        if (!Object.prototype.hasOwnProperty.call(share, name)) { share[name] = 1; }
        if (perksHeld[key]) { share[name] *= PERK_SETTINGS[key][name]; }
      }
    }
    const said = [];
    for (const name in share) {
      try {
        if (typeof natural[name] !== 'number') {
          const was = Number(sp.Game.getGameSettingFloat(name));
          if (!isFinite(was)) { log('perks: the game has no number for', name + ', leaving it alone'); continue; }
          natural[name] = was;
        }
        const want = natural[name] * share[name];
        if (Number(sp.Game.getGameSettingFloat(name)) === want) { continue; }
        sp.Game.setGameSettingFloat(name, want);
        said.push(name + ' ' + want + (share[name] === 1 ? ', the game\'s own' : ', from the game\'s ' + natural[name]));
      } catch (e) {
        /* Said once and not retried: the next view that changes what is
           held comes through here again. */
        log('perks: could not set', name + ':', e);
      }
    }
    if (said.length) { log('perks: ' + said.join('; ')); }
  }

  /* Your own character on the client's list while Pack Mule is held, and off
     it while not. Told only when it changes; null at load, so a reloaded
     plugin sets the list whatever an earlier copy left in it. */
  function packMuleNow() {
    const on = !!perksHeld.packmule;
    if (packMuleKept === on) { return; }
    packMuleKept = on;
    try {
      sp.setOverEncumberedIgnored(0x14, on);
      log('perks: Pack Mule ' + (on ? 'held, so carrying past your carry weight does not make you walk'
                                    : 'not held, so carrying past your carry weight makes you walk, as the game does'));
    } catch (e) {
      /* Said once and not retried: the next view that changes what is
         held comes through here again. */
      log('perks: could not set Pack Mule:', e);
    }
  }

  /* Your own character's casts counted while Overcharge is held, and not
     while not. Told only when it changes; null at load, so a reloaded
     plugin sets the rule whatever an earlier copy left. */
  function overchargeNow() {
    const on = !!perksHeld.overcharge;
    if (overchargeKept === on) { return; }
    overchargeKept = on;
    try {
      sp.setCastDurationEvery(0x14, on ? OVERCHARGE.every : 0, on ? OVERCHARGE.longer : 1);
      log('perks: Overcharge ' + (on ? 'held, so every ' + OVERCHARGE.every + 'th spell of yours that holds holds ' +
                                       OVERCHARGE.longer + ' times as long'
                                     : 'not held, so every spell of yours holds its own time'));
    } catch (e) {
      /* Said once and not retried: the next view that changes what is
         held comes through here again. */
      log('perks: could not set Overcharge:', e);
    }
  }

  try {
    sp.hooks.sendAnimationEvent.add({
      enter: function (ctx) {
        if (!perksHeld.unshakeable) { return; }
        if (!unshakeableBlocking) { unshakeableOpen++; return; }
        ctx.animEventName = '';
        unshakeableRefused++;
      },
      leave: function () { }
    }, 0x14, 0x14, 'staggerStart');
  } catch (e) {
    log('unshakeable: could not hook animation events, so Unshakeable stops only the server\'s own staggers:', e);
  }

  sp.on('update', guard('perks', () => {
    if (perksDirty) {
      perksDirty = false;
      perkSettingsNow();
      packMuleNow();
      overchargeNow();
    }
    if (perksHeld.unshakeable) {
      let pc = null;
      try { pc = sp.Game.getPlayer(); } catch (e) { pc = null; }
      let up = false;
      if (pc) { try { up = !!pc.getAnimationVariableBool('IsBlocking'); } catch (e) { up = false; } }
      unshakeableBlocking = up;
    }
    // One line for each stagger, said outside the hook.
    if (unshakeableRefused !== unshakeableSaid) {
      unshakeableSaid = unshakeableRefused;
      say('unshakeable: refused a stagger while blocking (' + unshakeableRefused + ' so far)');
    }
    if (unshakeableOpen !== unshakeableOpenSaid) {
      unshakeableOpenSaid = unshakeableOpen;
      say('unshakeable: a stagger played with the block down (' + unshakeableOpen + ' so far)');
    }
  }));

  // <<< machine perks: end <<<

  // ------------------------------------------------- a warrior's maneuvers --
  /*
    #1386. Patrick, 4 October: no chat commands for anything people do. So a
    warrior's maneuver is a key and a panel, not /maneuver typed into the
    chat. The maneuver key (ManeuverKey in Thornswood.ini, 9 by default,
    because 1 to 8 are the game's favourites hotkeys and every letter is
    somebody's) opens
    game/ui/thornswood-maneuvers.js, which lists the rows this character
    holds; a number or a click there sends /maneuver <name> to the server
    through the chat's socket, the way the trade and party keys do, and the
    server's answer comes back in the chat. The relay is collected every one
    and a half seconds (the chat commands block in the gamemode), so a
    maneuver starts within a second or two of the press.

    THE ROWS come off the character panel's view, the same view the tree
    hand reads (skills:view, see treeFromView), as v.panel.maneuvers: the
    name, the stamina and whether its wait is over. The server redraws that
    view when one starts and when its wait ends, so nothing here keeps a
    clock. A character who holds none has no rows, and the key says so.

    The panel holds the keyboard while it is up, under the 'maneuvers' claim,
    so 1 to 8 reach the panel and not the game's own hotkeys. It says when it opens and closes, the same as every other panel,
    and the cap closes it like the rest (CAP_CLOSES).
  */
  let maneuverRows = [];

  function maneuversToPage() {
    T.js('try{window.thornswoodManeuvers&&window.thornswoodManeuvers.setRows(' +
         JSON.stringify(maneuverRows) + ',' + JSON.stringify(MANEUVER_NAME) + ');}catch(e){}');
  }

  /* The whole panel view, as treeFromView takes it. Only v.panel.maneuvers
     is read. */
  function maneuversFromView(json) {
    let v = null;
    try { v = JSON.parse(String(json)); } catch (e) { return; }
    if (!v || typeof v !== 'object') { return; }
    const view = (v.panel && typeof v.panel === 'object') ? v.panel : v;
    const list = Array.isArray(view.maneuvers) ? view.maneuvers : [];
    const rows = [];
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (!r || typeof r.key !== 'string' || !/^[a-z]+$/.test(r.key)) { continue; }
      rows.push({ key: r.key, name: String(r.name || r.key), stamina: Number(r.stamina) || 0,
                  cooldown: Number(r.cooldown) || 0, ready: !!r.ready });
      if (r.key === 'plant') { plantSeen(!!r.on, Number(r.seconds) || 0); }
    }
    if (!list.some(function (r) { return r && r.key === 'plant'; })) { plantSeen(false, 0); }
    const was = JSON.stringify(maneuverRows);
    maneuverRows = rows;
    if (JSON.stringify(rows) !== was) { maneuversToPage(); }
  }

  /*
    PLANT: "You are not staggered for 8 seconds" (#1386). The server refuses
    the staggers it sends itself (Break and Wreck). Every other one, a power
    attack, a shield bash, a shout, a spell, is played by the game on the
    person's own machine as the animation event staggerStart on their own
    character, which passes through Skyrim Platform's sendAnimationEvent
    hook; skymp5-client's deathService blanks that same event in that same
    hook to keep staggers off everybody else's characters. So while the
    view says Plant is on, staggerStart for 0x14, your own character, is
    blanked and the stagger never starts.

    The view's on turns false when the server's window ends, and the server
    redraws the view then. If that redraw never arrives (the connection
    dropped), the row's own length, seconds from the moment on was first
    seen, is the end: nothing here outlasts the maneuver.
  */
  let plantUntil = 0;     // when this machine stops refusing staggers, 0 for not planted
  let plantRefused = 0;   // staggers refused in this Plant, for the log
  let plantSaid = 0;

  function plantSeen(on, secs) {
    const now = Date.now();
    if (!on) {
      if (plantUntil) {
        say('plant: over, ' + plantRefused + ' stagger(s) refused');
        plantUntil = 0;
      }
      return;
    }
    if (plantUntil && now < plantUntil) { return; }   // the same Plant, seen again
    const len = Math.max(0, Math.min(60, secs)) * 1000;
    if (!len) { return; }
    plantUntil = now + len;
    plantRefused = 0;
    plantSaid = 0;
    say('plant: no stagger lands on this character for ' + (len / 1000) + ' seconds');
  }

  try {
    sp.hooks.sendAnimationEvent.add({
      enter: function (ctx) {
        if (!plantUntil || Date.now() >= plantUntil) { return; }
        ctx.animEventName = '';
        plantRefused++;
      },
      leave: function () { }
    }, 0x14, 0x14, 'staggerStart');
  } catch (e) {
    log('plant: could not hook animation events, so Plant stops only the server\'s own staggers:', e);
  }

  // One line for each stagger refused, said outside the hook.
  sp.on('update', guard('plant', () => {
    if (plantRefused === plantSaid) { return; }
    plantSaid = plantRefused;
    say('plant: refused a stagger (' + plantRefused + ' in this Plant)');
  }));

  /* The maneuver key, with the panel shut: a panel up holds the keyboard, and
     then the page hears the key and closes itself. */
  function maneuverKeyPressed() {
    if (claims.chat) { return; }
    const busyNow = busyMenuOpen();
    if (busyNow) { say('maneuver key seen, but ' + busyNow + ' is open'); return; }
    if (skillsCreating) { return; }
    if (!maneuverRows.length) {
      note('You have no maneuvers. They are a warrior\'s, on the half you picked.');
      return;
    }
    maneuversToPage();
    T.js('try{window.thornswoodManeuvers&&window.thornswoodManeuvers.open();}catch(e){}');
  }

  // ------------------------------------------------------------ the help --
  /*
    #1633. Patrick, 4 October: no chat commands for anything people do, and
    /help was a menu typed into the chat. The help key (HelpKey in
    Thornswood.ini, F7 by default) opens game/ui/thornswood-help.js, and so
    does Help on the K, P and J panels, which the page does on its own. The
    page holds the topics; this hands it the name of every key it mentions,
    as this machine has them bound, so a rebind on Settings is what the help
    says, at once (helpToPage runs again on every change). E is the game's Activate, wherever that is bound.

    The panel holds the keyboard while it is up, under the 'help' claim, and
    says when it opens and closes like every other panel; the cap closes it
    like the rest (CAP_CLOSES). With the panel up the page hears this key
    and Escape and closes itself.
  */
  function helpKeys() {
    return {
      help: HELP_NAME, chat: keyName(CHAT_KEY), command: keyName(COMMAND_KEY),
      skills: keyName(SKILLS_KEY), party: PARTY_NAME, journal: keyName(JOURNAL_KEY),
      friend: FRIEND_NAME, trade: TRADE_NAME, mute: MUTE_NAME, mold: MOLD_NAME,
      lock: LOCK_NAME, maneuver: MANEUVER_NAME, talk: keyName(TALK_KEY),
      voiceMode: keyName(VOICE_MODE_KEY), wheel: keyName(WHEEL_KEY), activate: deliverName(),
      stop: keyName(STOP_KEY), voiceLock: keyName(VOICE_LOCK_KEY)
    };
  }

  function helpToPage() {
    T.js('try{window.thornswoodHelp&&window.thornswoodHelp.setKeys(' +
         JSON.stringify(helpKeys()) + ');}catch(e){}');
  }

  /* The help key. With the panel up the page hears it and closes itself, so
     this sees it only when the panel holds no keyboard; it closes it then
     too. Not while the chat has the keyboard or one of the game's own menus
     is up, the same as K. */
  function helpKeyPressed() {
    if (claims.chat) { return; }
    if (T.hasFocus('help')) {
      T.js('try{window.thornswoodHelp&&window.thornswoodHelp.close();}catch(e){}');
      return;
    }
    const busyNow = busyMenuOpen();
    if (busyNow) { say('help key seen, but ' + busyNow + ' is open'); return; }
    helpToPage();
    T.js('try{window.thornswoodHelp&&window.thornswoodHelp.open();}catch(e){}');
  }

  // -------------------------------------------------------- the settings --
  /*
    #3126. Patrick: every setting in the launcher that is really an in-game
    setting is in the game's own settings, every key binding included; and on
    #3146, the launcher keeps Play, news, update, diagnostics, account and
    the display settings that need a restart. The Settings panel
    (game/ui/thornswood-settings.js) is opened from Settings on the help
    panel and on the K, P and J panels. The page never touches a file: it
    sends 'settings:set <Name> <value>', and this checks the value, writes
    Thornswood.ini in place, reads it back, and applies it at once:

      - a key: readKeys above, the menu key blocks moved to the new key, the
        names the help, P, J, K and maneuver panels show, and every other
        plugin that reads Thornswood.ini, through T.settingsListeners;
      - the field of view: fovChanged;
      - how long the chat stays up and whether the needs bars are drawn:
        window.THORNSWOOD, which the chat page reads (chatSettingsToPage).

    The panel's state always comes back from the file, with a line saying
    what was done or why not, so what it shows is what is set.
  */

  /* Every Thornswood key the panel offers, by its name in Thornswood.ini.
     The same list as KEYS in thornswood-settings.js (the harness checks). */
  const SETTINGS_KEYS = {
    ChatKey: 28, CommandKey: 53, HelpKey: 65, SkillsKey: 37, PartyKey: 25, JournalKey: 36,
    ManeuverKey: 10, FriendKey: 21, TradeWithKey: 35, MuteThemKey: 38, MoldKey: 22, LockKey: 45,
    WheelKey: 34, PageKey: 15, CloseKey: 1, StopKey: 49,
    PushToTalk: 47, VoiceModeKey: 48, VoiceLockKey: 24, CloseGameKey: 68
  };
  const SETTINGS_LABELS = {
    ChatKey: 'Talk in chat', CommandKey: 'Type a command', HelpKey: 'Help',
    SkillsKey: 'the character panel', PartyKey: 'Friends and party', JournalKey: 'Journals',
    ManeuverKey: 'a warrior\'s maneuvers', FriendKey: 'Add or remove a friend',
    TradeWithKey: 'Offer a trade', MuteThemKey: 'Mute somebody', MoldKey: 'Press a key mold into a lock',
    LockKey: 'Claim, lock or unlock a door', WheelKey: 'the emote wheel', PageKey: 'Search the wheel',
    CloseKey: 'Close the wheel', StopKey: 'Stand up', PushToTalk: 'Hold to talk',
    VoiceModeKey: 'Whisper, talk or yell', VoiceLockKey: 'Keep talking',
    CloseGameKey: 'Close Skyrim while making a character'
  };

  /*
    The keys the panel can catch: the ones the launcher's Controls page
    offered (letters, numbers, function keys and a handful of others), and
    Enter, so the chat key can go back to it, by scan code. Escape is not
    one; it gives up listening. A key's own default is always allowed.
  */
  const SETTINGS_OFFERED = (function () {
    const out = {};
    const add = function (c) { out[c] = true; };
    for (let c = 2; c <= 13; c++) { add(c); }          // 1 to 0, - and =
    for (let c = 14; c <= 28; c++) { add(c); }         // Backspace, Tab, Q to P, [ ], Enter
    for (let c = 30; c <= 41; c++) { add(c); }         // A to L, ; ' `
    for (let c = 43; c <= 54; c++) { add(c); }         // \ Z to M , . / Right Shift
    for (let c = 58; c <= 70; c++) { add(c); }         // Caps Lock, F1 to F10, Num and Scroll Lock
    [87, 88, 157, 184, 197, 199, 201, 207, 209, 210, 211, 259, 260].forEach(add);
    return out;
  })();

  /* The game client's own, compiled in: names over heads, its overlay, its focus. */
  const CLIENT_KEYS = { 59: 'F1 shows and hides the names over heads', 60: 'F2 hides the game client\'s overlay',
                        64: 'F6 is the game client\'s' };

  /*
    Skyrim's own controls that a Thornswood key on top would take away:
    moving, acting and the menus that are not ours to shadow. Journal, Quick
    Stats, Quick Magic and Tween Menu are not here: J, / and P take the first
    three on purpose, and Tab is the wheel's search only while it is open.
  */
  const GAME_CONTROLS = ['Forward', 'Back', 'Strafe Left', 'Strafe Right', 'Activate', 'Jump',
    'Sprint', 'Sneak', 'Run', 'Toggle Always Run', 'Auto-Move', 'Ready Weapon', 'Shout',
    'Toggle POV', 'Wait', 'Favorites', 'Quick Inventory', 'Quick Map', 'Left Attack/Block',
    'Right Attack/Block'];

  function gameControlOn(code) {
    for (let n = 0; n < GAME_CONTROLS.length; n++) {
      for (let device = 0; device <= 1; device++) {
        let got = -1;
        try { got = Number(sp.Input.getMappedKey(GAME_CONTROLS[n], device)); } catch (e) { got = -1; }
        if (got === code) { return GAME_CONTROLS[n]; }
      }
    }
    return '';
  }

  /*
    THE OTHER MODS' KEYS, read from where each keeps them, for the panel to
    show. MCM Helper keeps what a person chose in Data/MCM/Settings/<mod>.ini
    over the mod's own Data/MCM/Config/<mod>/settings.ini; the defaults are
    the mods' own. A mod whose files are not here is left off.
  */
  const MOD_KEYS = [
    ['search', 'SkyUI_SE', 'iSearchKey', 57], ['switchtab', 'SkyUI_SE', 'iSwitchTabKey', 56],
    ['equipmode', 'SkyUI_SE', 'iEquipModeKey', 42], ['favadd', 'SkyUI_SE', 'iFavoriteGroupAddKey', 33],
    ['favuse', 'SkyUI_SE', 'iFavoriteGroupUseKey', 19], ['favicon', 'SkyUI_SE', 'iFavoriteSetIconKey', 56],
    ['favstate', 'SkyUI_SE', 'iFavoriteEquipStateKey', 20], ['favfocus', 'SkyUI_SE', 'iFavoriteToggleFocusKey', 57],
    ['favhot1', 'SkyUI_SE', 'iFavoriteGroupUseHotkey1', 59], ['favhot2', 'SkyUI_SE', 'iFavoriteGroupUseHotkey2', 60],
    ['favhot3', 'SkyUI_SE', 'iFavoriteGroupUseHotkey3', 61], ['favhot4', 'SkyUI_SE', 'iFavoriteGroupUseHotkey4', 62],
    ['lock', 'TrueDirectionalMovement', 'uTargetLockKey', 258],
    ['lockleft', 'TrueDirectionalMovement', 'uSwitchTargetLeftKey', -1],
    ['lockright', 'TrueDirectionalMovement', 'uSwitchTargetRightKey', -1],
    ['lockbehind', 'TrueDirectionalMovement', 'uTargetLockBehindTargetKey', -1],
    ['cyclehold', 'BetterThirdPersonSelection', 'iObjectCycleModifierKey', 42],
    ['cycleup', 'BetterThirdPersonSelection', 'iCycleUpKey', 264],
    ['cycledown', 'BetterThirdPersonSelection', 'iCycleDownKey', 265]
  ];

  function iniValue(text, key) {
    const lines = String(text || '').split(/\r?\n/);
    const rx = new RegExp('^\\s*' + key + '\\s*=\\s*(.*?)\\s*$', 'i');
    for (let n = 0; n < lines.length; n++) {
      const t = lines[n].trim();
      if (t[0] === ';' || t[0] === '#') { continue; }
      const m = rx.exec(lines[n]);
      if (m) { return m[1]; }
    }
    return null;
  }

  function modKeys() {
    const out = {};
    const files = {};
    for (let n = 0; n < MOD_KEYS.length; n++) {
      const row = MOD_KEYS[n];
      const mod = row[1];
      if (!files[mod]) {
        files[mod] = {
          user: readText('Data/MCM/Settings/' + mod + '.ini'),
          own: readText('Data/MCM/Config/' + mod + '/settings.ini')
        };
      }
      const f = files[mod];
      if (!f.own && !f.user) { continue; }
      let raw = iniValue(f.user, row[2]);
      if (raw === null) { raw = iniValue(f.own, row[2]); }
      const v = raw === null ? NaN : Math.round(Number(raw));
      out[row[0]] = isFinite(v) ? v : row[3];
    }
    // SKSE Menu Framework names its key ("F4") rather than numbering it.
    const menu = readText('Data/SKSE/Plugins/SKSEMenuFramework.ini');
    if (menu) { out.menu = String(iniValue(menu, 'ToggleKey') || 'F4'); }
    return out;
  }

  function settingsState(said) {
    const keys = {};
    for (const k in SETTINGS_KEYS) { keys[k] = iniNumber(ini, k, SETTINGS_KEYS[k]); }
    return {
      fov: { value: wantedFov || FOV_DEFAULT, min: FOV_MIN, max: FOV_MAX, def: FOV_DEFAULT },
      chatFade: CHAT_FADE, chatChoices: CHAT_FADE_CHOICES, needsBars: NEEDS_BARS,
      keys: keys, mods: modKeys(), said: said || ''
    };
  }

  function settingsToPage(said) {
    T.js('try{window.thornswoodSettings&&window.thornswoodSettings.setState(' +
         JSON.stringify(settingsState(said)) + ');}catch(e){}');
  }

  /* How long the chat stays up and whether the needs bars are drawn, to the
     chat page, which reads them off window.THORNSWOOD. */
  function chatSettingsToPage() {
    T.js('try{var c=window.THORNSWOOD=window.THORNSWOOD||{};c.chatFade=' + CHAT_FADE +
         ';c.needsBars=' + NEEDS_BARS + ';window.thornswoodChat&&window.thornswoodChat.settings&&' +
         'window.thornswoodChat.settings();}catch(e){}');
  }

  /*
    Thornswood.ini with one line changed, the way the launcher's writers did
    it: the line rewritten where it is with its own spacing, comments and
    every other line left alone, a second copy dropped, and a key the file
    does not have yet added at the end. null takes the line out, which is how
    a setting goes back to its default.
  */
  function iniWith(text, key, value) {
    const nl = text.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
    const lines = text.length ? text.split(/\r?\n/) : [];
    const rx = new RegExp('^(\\s*)(' + key + ')(\\s*=\\s*)', 'i');
    const out = [];
    let done = false;
    for (let n = 0; n < lines.length; n++) {
      const t = lines[n].trim();
      const m = (t[0] === ';' || t[0] === '#') ? null : rx.exec(lines[n]);
      if (!m) { out.push(lines[n]); continue; }
      if (done || value === null) { continue; }
      out.push(m[1] + m[2] + m[3] + value);
      done = true;
    }
    if (!done && value !== null) {
      let end = out.length;
      while (end > 0 && out[end - 1].trim() === '') { end--; }
      out.splice(end, 0, key + ' = ' + value);
    }
    let joined = out.join(nl);
    if (joined && joined.slice(-nl.length) !== nl) { joined += nl; }
    return joined;
  }

  /* Why a key cannot go where it was asked, or '' when it can. */
  function keyRefusal(name, code) {
    const keyN = keyName(code);
    if (!SETTINGS_OFFERED[code] && code !== SETTINGS_KEYS[name]) { return 'That key cannot be used here. Try a function key, a letter, a number, or something like Insert.'; }
    if (CLIENT_KEYS[code]) { return CLIENT_KEYS[code] + ', so it cannot be ' + SETTINGS_LABELS[name].toLowerCase() + ' as well.'; }
    for (const other in SETTINGS_KEYS) {
      if (other === name) { continue; }
      if (iniNumber(ini, other, SETTINGS_KEYS[other]) === code) {
        return keyN + ' is already ' + SETTINGS_LABELS[other].toLowerCase() + '. Move that one first.';
      }
    }
    const control = gameControlOn(code);
    if (control) { return keyN + ' is Skyrim\'s ' + control + '. Move it under Settings, Controls in the pause menu first.'; }
    return '';
  }

  /* The page asked for one change. Checked, written, read back, applied. */
  function setSetting(name, raw) {
    let value;
    let said;
    if (name === 'Fov') {
      const v = Math.round(Number(raw));
      if (!(v >= FOV_MIN && v <= FOV_MAX)) { settingsToPage('The field of view goes from ' + FOV_MIN + ' to ' + FOV_MAX + '.'); return; }
      value = v === FOV_DEFAULT ? null : String(v);
      said = v === FOV_DEFAULT ? 'Field of view back to Skyrim\'s own, ' + FOV_DEFAULT + '.' : 'Field of view set to ' + v + '.';
    } else if (name === 'ChatFade') {
      const v = Number(raw);
      if (CHAT_FADE_CHOICES.indexOf(v) < 0) { settingsToPage('That is not one of the choices.'); return; }
      value = v === 10 ? null : String(v);
      said = v === 0 ? 'The chat stays on screen all the time.' : 'The chat hides ' + v + ' seconds after its last line.';
    } else if (name === 'NeedsBars') {
      const shown = String(raw) !== '0';
      value = shown ? null : '0';
      said = shown ? 'The needs bars are shown.' : 'The needs bars are hidden. The Body page on ' + keyName(SKILLS_KEY) + ' shows them.';
    } else if (Object.prototype.hasOwnProperty.call(SETTINGS_KEYS, name)) {
      const code = Math.round(Number(raw));
      if (code === iniNumber(ini, name, SETTINGS_KEYS[name])) { settingsToPage('It is ' + keyName(code) + ' already.'); return; }
      const why = keyRefusal(name, code);
      if (why) { settingsToPage(why); return; }
      value = String(code);
      said = SETTINGS_LABELS[name].charAt(0).toUpperCase() + SETTINGS_LABELS[name].slice(1) + ' is now ' + keyName(code) + '.';
    } else {
      log('settings: the page asked for', name, 'which is not a setting');
      return;
    }

    const before = readText(INI);
    const after = iniWith(before, name, value);
    try { require('fs').writeFileSync(INI, after); }
    catch (e) {
      log('settings: could not write', INI, e);
      settingsToPage('Could not save that. Thornswood.ini could not be written.');
      return;
    }
    applySettings(readText(INI));
    log('settings:', name, value === null ? '(default)' : value);
    settingsToPage(said);
  }

  /*
    Thornswood.ini changed: every key, the field of view and the chat, and
    every panel and plugin that names or reads one, from the file as it is now.
  */
  function applySettings(text) {
    const journalWas = JOURNAL_KEY;
    const commandWas = COMMAND_KEY;
    readKeys(text);
    // The game's menu opener ignores our key while it is blocked, so the old
    // key is let go and the new one held on the next frame.
    if (journalWas !== JOURNAL_KEY && journalKeyKept) {
      try { sp.setMenuOpenKeyBlocked('Journal', journalWas, false, KEYBOARD_MENUS); } catch (e) { }
      journalKeyKept = null;
    }
    if (commandWas !== COMMAND_KEY && commandKeyKept) {
      try { sp.setMenuOpenKeyBlocked('Quick Stats', commandWas, false, KEYBOARD_MENUS); } catch (e) { }
      commandKeyKept = null;
    }
    fovChanged(text);
    chatSettingsToPage();
    helpToPage();
    maneuversToPage();
    T.js('try{window.thornswoodParty&&window.thornswoodParty.setKey&&window.thornswoodParty.setKey(' +
         JSON.stringify(PARTY_NAME) + ');' +
         'window.thornswoodJournal&&window.thornswoodJournal.setKey&&window.thornswoodJournal.setKey(' +
         JSON.stringify(keyName(JOURNAL_KEY)) + ');' +
         'window.thornswoodSkills&&window.thornswoodSkills.setKey&&window.thornswoodSkills.setKey(' +
         JSON.stringify(keyName(SKILLS_KEY)) + ');}catch(e){}');
    const others = T.settingsListeners || [];
    for (let n = 0; n < others.length; n++) {
      try { others[n](text); } catch (e) { log('settings: a plugin threw reading the new settings:', e); }
    }
  }

  /*
    Write the game's real load order to disk, once, on the first update.

    The server compares its own list against this one POSITIONALLY, by name and
    size and crc32, and refuses the session on any disagreement. Working out
    what the game actually loaded from plugins.txt is guesswork: Skyrim puts
    masters first, then light plugins, then the rest, and plugins.txt records
    none of that ordering. Game.getModName walks the real thing in the real
    order, so it is the only honest source for what the server's loadOrder has
    to be set to.

    One file, written once per session, so the two lists can be reconciled from
    ground truth instead of from a best guess.

    getModCount COUNTS REGULAR PLUGINS ONLY. Light ones live in their own index
    behind getLightModCount, and leaving them out is correct for this file,
    because the server's list drops them too and this file has to match it
    positionally. It was not correct for the sentence underneath, which called
    60 of 102 plugins the real load order. On 20 September that read as a
    collection with 42 mods missing from it and sent somebody looking through
    Vortex for a fault that was not there: every one of the 42 was loaded and
    light, confirmed by reading bit 0x200 out of each TES4 header.

    So the light ones are written beside it rather than into it. Nothing that
    consumes the first file sees any change, and the question "where are the
    other 42" now has an answer sitting next to it instead of needing a header
    parser to work out.
  */
  let dumpedOrder = false;
  let orderToReport = null;
  // The light plugins, for the light half of the report (#1715). Null on a
  // build without the light index, which then sends the full half alone.
  let lightToReport = null;
  sp.on('update', guard('loadorder', () => {
    if (dumpedOrder) { return; }
    dumpedOrder = true;
    try {
      const fs = require('fs');

      const names = [];
      const n = sp.Game.getModCount();
      for (let i = 0; i < n; i++) {
        const name = sp.Game.getModName(i);
        if (name) { names.push(name); }
      }
      // Before the write, so a file that cannot be written still reports.
      orderToReport = names.slice();
      fs.writeFileSync('Data/Platform/thornswood-loadorder.txt',
                       names.join('\n') + '\n');

      /* A build without the light index must still get the file above, so this
         is separate and its failure is not the other one's. */
      const light = [];
      try {
        const ln = sp.Game.getLightModCount();
        for (let i = 0; i < ln; i++) {
          const name = sp.Game.getLightModName(i);
          if (name) { light.push(name); }
        }
        // Before the write, as for the full list.
        lightToReport = light.slice();
        fs.writeFileSync('Data/Platform/thornswood-plugins-light.txt',
                         light.join('\n') + '\n');
      } catch (e2) {
        log('could not write the light plugin list:', e2);
      }

      say('wrote ' + names.length + ' regular plugins, in load order, to ' +
          'Data/Platform/thornswood-loadorder.txt, and ' + light.length +
          ' light plugins to thornswood-plugins-light.txt. That is ' +
          (names.length + light.length) + ' loaded in total. The first file is ' +
          'the one the server reconciles against and it holds regular plugins ' +
          'only, on purpose. A mod in neither file is genuinely not loaded; a ' +
          'mod in the second one is loaded.');
    } catch (e) {
      log('could not write the load order:', e);
    }
  }));

  /*
    And the same list to the server, which compares it with its manifest and
    tells the person, in one sentence, where it parts and to press Fix (#402).
    The game's own check only paints LOAD ORDER ERROR and carries on, and on
    17 Sep a tester reported bugs from a session showing that caption.

    Five hex a plugin, because a chat line stops at 400 characters: see the
    load order refusal block in gamemode.js, which carries the other copy of
    loadOrderMark. tests\test-load-order-refusal.js holds the two together.

    The ten files Steam owns go by name alone, the ones Verify.cs leaves out of
    its byte check, because Fix cannot mend them and the sentence says press
    Fix. That also skips reading Skyrim.esm, a quarter of a gigabyte. The rest
    are read one plugin a frame, since getFileInfo reads the whole file for its
    crc32 and sixty of them in one frame would be a hitch you could see.
  */
  const LOAD_ORDER_STOREFRONT = [
    'skyrim.esm', 'update.esm', 'dawnguard.esm', 'hearthfires.esm', 'dragonborn.esm',
    'ccbgssse001-fish.esm', 'ccbgssse025-advdsgs.esm', 'ccbgssse037-curios.esl',
    'ccqdrsse001-survivalmode.esl', '_resourcepack.esl'
  ];
  const LOAD_ORDER_CHUNK = 64;

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
    SENT AGAIN EVERY TWO MINUTES, for the life of the game. The server treats a
    profile online five minutes with no complete report as a list that differs,
    so a report lost on the way (the voice service restarting, the server
    restarting under a session that carries on, a line dropped from a full
    queue) must not stay lost. The server says a verdict it has already said at
    most every ten minutes, so this is quiet on the other end.
  */
  const LOAD_ORDER_RESEND_MS = 120000;
  const orderMarks = [];
  const lightMarks = [];
  let orderSentAt = 0;
  function markOf(name) {
    let mark = loadOrderMark(name);
    if (LOAD_ORDER_STOREFRONT.indexOf(String(name).toLowerCase()) < 0) {
      try {
        const info = sp.getFileInfo(name);
        if (info) { mark = loadOrderMark(name, info.size, info.crc32); }
      } catch (e) {
        log('could not read ' + name + ' for the load order report, sent by name only:', e);
      }
    }
    return mark;
  }
  // One list after the other, under its own word: the server holds the
  // light plugins to its light list, where a light index is a place (#1715).
  function sendMarks(word, marks) {
    const total = marks.length;
    for (let from = 0; from < total; from += LOAD_ORDER_CHUNK) {
      tellServer(word + ' ' + total + ' ' + from + ' ' + marks.slice(from, from + LOAD_ORDER_CHUNK).join(''));
    }
  }
  sp.on('update', guard('loadorderreport', () => {
    if (!orderToReport) { return; }
    if (orderMarks.length < orderToReport.length) {
      orderMarks.push(markOf(orderToReport[orderMarks.length]));
      return;
    }
    if (lightToReport && lightMarks.length < lightToReport.length) {
      lightMarks.push(markOf(lightToReport[lightMarks.length]));
      return;
    }
    const now = Date.now();
    if (orderSentAt && now - orderSentAt < LOAD_ORDER_RESEND_MS) { return; }
    const first = !orderSentAt;
    orderSentAt = now;
    sendMarks('/loadorder', orderMarks);
    if (lightToReport) { sendMarks('/loadorderlight', lightMarks); }
    if (first) {
      say('reported ' + orderMarks.length + ' plugins' +
          (lightToReport ? ' and ' + lightMarks.length + ' light plugins' : '') +
          ' to the server to check against its own');
    }
  }));

  /*
    The join pass (#937). The game server ends a session that has not shown it
    one: a short lived note, signed by the site, that this character came
    through an up to date Thornswood launcher. The launcher fetches it when a
    character is picked at the menu and every four minutes after, and leaves it
    in thornswood-pass.txt. It goes over the command relay at once when it
    changes and every minute, so a relay or server restart never leaves the
    server without one. Never written to the log: it is good for ten minutes
    to whoever holds it.
  */
  const PASS_FILE = 'Data/Platform/thornswood-pass.txt';
  /*
    The pass's own key (#1320). The launcher leaves it beside the pass, named
    by the pass's mac, and the client the fork builds answers the game
    server's login challenge with the pass and a mac over that connection's
    nonce under this key (skymp5-client, thornswoodLoginProof.ts), read from
    storage.thornswoodJoinPass. Paired only with the pass it was given for,
    and never logged.
  */
  const PASS_KEY_FILE = 'Data/Platform/thornswood-pass-key.txt';
  const PASS_RESEND_MS = 60000;
  const PASS_READ_MS = 5000;
  let passSent = '';
  let passSentAt = 0;
  let passReadAt = 0;
  sp.on('update', guard('joinpass', () => {
    const now = Date.now();
    if (now - passReadAt < PASS_READ_MS) { return; }
    passReadAt = now;
    const raw = readText(PASS_FILE).trim();
    if (!/^jp1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw)) { return; }
    // The one before's, until the launcher has this character's (#3128).
    if (passProfile(raw) !== PROFILE) { return; }
    const keyLine = readText(PASS_KEY_FILE).trim().split(' ');
    if (keyLine.length === 2 && keyLine[0] === raw.split('.')[2] && /^[A-Za-z0-9_-]{16,128}$/.test(keyLine[1])) {
      sp.storage.thornswoodJoinPass = { pass: raw, key: keyLine[1] };
    }
    if (raw === passSent && now - passSentAt < PASS_RESEND_MS) { return; }
    const first = !passSent;
    passSent = raw;
    passSentAt = now;
    tellServer('/joinpass ' + raw);
    if (first) { log('sent the launcher\'s join pass to the server'); }
  }));

  /*
    Field of view, from the Settings panel in the game.

    Skyrim's own fDefaultWorldFOV is not enough here. The game rewrites it at
    various points, mods fight over it, and a value in an ini only lands when
    the game reads that ini. Setting it at runtime and putting it back whenever
    the camera changes is the only version that holds, which is why the working
    RP servers carry a service to do exactly this.

    Read from Thornswood.ini, the same file the keys come from, which the
    Settings panel in the game writes (#3126) and reads again through
    fovChanged. Absent or nonsense leaves the game alone entirely rather than
    forcing a default on anybody.
  */
  const FOV_INI = 'Data/SKSE/Plugins/Thornswood.ini';
  const FOV_MIN = 60;
  const FOV_MAX = 140;
  // Skyrim's own. A setting equal to this is the same as no setting, and the
  // panel does not write it at all, but checking here as well means a file
  // edited by hand costs nothing either.
  const FOV_DEFAULT = 65;

  /* The field of view a Thornswood.ini asks for, or 0 for Skyrim's own. */
  function fovOf(text) {
    const m = String(text || '').match(/^\s*Fov\s*=\s*(\d+(?:\.\d+)?)\s*$/m);
    if (!m) { return 0; }
    const v = Number(m[1]);
    if (v === FOV_DEFAULT) {
      log('fov is set to Skyrim\'s own ' + FOV_DEFAULT + ', leaving the camera alone');
      return 0;
    }
    if (v >= FOV_MIN && v <= FOV_MAX) { return v; }
    log('fov ' + v + ' is outside ' + FOV_MIN + ' to ' + FOV_MAX + ', ignoring it');
    return 0;
  }

  let wantedFov = fovOf(readText(FOV_INI));

  function setFov(v) {
    try {
      if (typeof sp.Game.setCameraFOV === 'function') {
        sp.Game.setCameraFOV(v, v);
      } else if (typeof sp.setCameraFOV === 'function') {
        sp.setCameraFOV(v, v);
      } else {
        log('this build has no setCameraFOV, leaving the field of view alone');
        wantedFov = 0;
      }
    } catch (e) { }
  }

  function applyFov() {
    if (!wantedFov) { return; }
    setFov(wantedFov);
  }

  /*
    The panel changed it. Applied now, and a field of view put back to
    Skyrim's own is set to that once, because the camera keeps whatever it
    was last given until the game next resets it.
  */
  function fovChanged(text) {
    const was = wantedFov;
    wantedFov = fovOf(text);
    if (wantedFov) { applyFov(); say('field of view set to ' + wantedFov); }
    else if (was) { setFov(FOV_DEFAULT); say('field of view back to Skyrim\'s own ' + FOV_DEFAULT); }
  }

  let fovAt = 0;
  sp.on('update', guard('fov', () => {
    if (!wantedFov) { return; }
    // Cheap, and it has to be repeated: loading, a menu, mounting a horse
    // and anything that swaps the camera all put it back to the game's own
    // number. Once a second is under the noise floor and is not noticeable
    // when something else has just reset it.
    const now = Date.now();
    if (now - fovAt < 1000) { return; }
    fovAt = now;
    applyFov();
  }));
  try { sp.on('cameraStateChanged', guard('fovcam', () => { applyFov(); })); } catch (e) { }
  if (wantedFov) { say('field of view set to ' + wantedFov); }

  /*
    HOW FAR PEOPLE AND NPCS ARE DRAWN, the same for everybody (#963).

    Patrick, 28 September: lower the draw distance for everyone to one value
    we set, not left to each person's settings. The launcher writes it into
    SkyrimPrefs.ini before every Play (Enforce.ActorFade in launcher\app\
    Enforce.cs, which must say the same number as ACTOR_FADE; the harness
    tests\test-963-perf-settings.ps1 holds the two together), so the game
    starts on it. This holds it for the session: the Display menu's Actor
    Fade slider changes it in memory, and this puts it back. One ini read
    every five seconds.
  */
  const ACTOR_FADE = 10;
  const ACTOR_FADE_KEY = 'fLODFadeOutMultActors:LOD';
  let actorFadeAt = 0;
  let actorFadeSet = 0;
  let actorFadeFailed = false;
  sp.on('update', guard('actor fade', () => {
    const now = Date.now();
    if (now - actorFadeAt < 5000) { return; }
    actorFadeAt = now;
    let cur = NaN;
    try { cur = Number(sp.Utility.getINIFloat(ACTOR_FADE_KEY)); } catch (e) { return; }
    if (Math.abs(cur - ACTOR_FADE) < 0.01) { return; }
    try { sp.Utility.setINIFloat(ACTOR_FADE_KEY, ACTOR_FADE); } catch (e) {
      if (!actorFadeFailed) { actorFadeFailed = true; log('actor fade: could not set it:', e); }
      return;
    }
    actorFadeSet++;
    // Said the first few times only: somebody dragging the slider back and
    // forth is not worth a line every five seconds.
    if (actorFadeSet <= 3) {
      log('actor fade was ' + cur + ', put back to ' + ACTOR_FADE + ', the same for everybody');
    }
  }));

  /*
    WHERE THIS GAME DRAWS EACH NOTICE BOARD AND DROP BOX (#2516). A measurement,
    not a fix. The server stands every board and box (standBoard in
    gamemode.js) and logs its point and angle in its 'boards: stood' line.
    Patrick on dev, 15 Oct, saw the boards each wrong by a different amount
    and some boxes off their shelves. This writes, once per reference, where
    this game drew it: when its 3D first loads near the person, and again two
    seconds later, once skymp5-client's FormView has moved it from where it
    is made (at the person) to the server's point. Set the two lines beside
    the server's to read the angle and the box's point as drawn.
  */
  const DRAWN_FILE = 'Thornswood-Content.esp';
  const DRAWN_BOARD = 0x593b;    // BOARD_BASE_DESC in gamemode.js, the message board
  const DRAWN_BOX = 0x154d0;     // BOX_BASE_DESC, the drop box
  let drawnBases = null;         // { board, box } runtime base ids, once read
  const drawnSeen = {};          // reference id -> true once it has been written
  const drawnLater = [];         // { id, what, at } to be written again once settled

  function drawnLine(ref, what, when) {
    let cell = 0, world = 0;
    try { const c = ref.getParentCell(); cell = c ? c.getFormID() : 0; } catch (e) { }
    try { const w = ref.getWorldSpace(); world = w ? w.getFormID() : 0; } catch (e) { }
    const f = function (n) { return Math.round(Number(n) * 10) / 10; };
    log('board drawn:', what, (ref.getFormID() >>> 0).toString(16), when, 'at',
        f(ref.getPositionX()) + ',' + f(ref.getPositionY()) + ',' + f(ref.getPositionZ()),
        'angle', f(ref.getAngleX()) + ',' + f(ref.getAngleY()) + ',' + f(ref.getAngleZ()),
        'cell', cell.toString(16), 'world', world.toString(16));
  }

  sp.on('objectLoaded', guard('board drawn', (e) => {
    if (!e || !e.isLoaded || !e.object) { return; }
    const ref = sp.ObjectReference.from(e.object);
    if (!ref) { return; }
    const id = ref.getFormID() >>> 0;
    if (drawnSeen[id]) { return; }
    if (!drawnBases) {
      const b = sp.Game.getFormFromFile(DRAWN_BOARD, DRAWN_FILE);
      const x = sp.Game.getFormFromFile(DRAWN_BOX, DRAWN_FILE);
      drawnBases = { board: b ? b.getFormID() >>> 0 : 0, box: x ? x.getFormID() >>> 0 : 0 };
    }
    const base = ref.getBaseObject();
    const bid = base ? base.getFormID() >>> 0 : 0;
    const what = !bid ? '' : bid === drawnBases.board ? 'board' : bid === drawnBases.box ? 'drop box' : '';
    if (!what) { return; }
    drawnSeen[id] = true;
    drawnLine(ref, what, 'loaded');
    drawnLater.push({ id: id, what: what, at: Date.now() });
  }));

  sp.on('update', guard('board drawn later', () => {
    if (!drawnLater.length || Date.now() - drawnLater[0].at < 2000) { return; }
    const one = drawnLater.shift();
    const ref = sp.ObjectReference.from(sp.Game.getFormEx(one.id));
    if (ref) { drawnLine(ref, one.what, 'settled'); }
  }));

  log('loaded. browser:', typeof sp.browser, 'chat key', CHAT_KEY);
})();
