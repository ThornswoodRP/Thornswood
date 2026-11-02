// ==== thornswood mod settings ====
/*
  ============================================================================
  MOD SETTINGS MENUS THAT WOULD OTHERWISE RESET EVERY SESSION. Issue #488.

  A classic SkyUI menu keeps what somebody chose in the save, and there is no
  save here: the character lives on the server. So Apocalypse, AHZmoreHUD,
  atlas map markers, Skyrim Unbound and chfshVariousActions started from the
  plugin's own values every time the game started. Patrick decided on
  28 September to keep them for all five. Atlas Map Markers leaves the
  collection with revision 6, because its page does not allow it in a
  collection (#3649), and its 98 globals are no longer kept, so four are.

  WHAT CAN BE KEPT IS WHAT IS IN A GLOB RECORD, and nothing else. A classic
  menu's own variables live in its script, which Skyrim Platform cannot write;
  a global variable it can. scripts\mods\Audit-ModMenus.js -v reads the
  plugins and lists the globals wired to those menus, and MOD_GLOBALS
  below is that list: plugin, editor id, and the id inside the plugin, which
  does not move when the load order does. The MCM Helper menus need nothing,
  because they keep their 421 settings in ini files on the machine, and
  SkyUI_SE's three script values are out of reach.

  THE CHANNEL IS THE ONE /place ALREADY USES. The front plugin reads
  those globals when the game's journal (where the menus live) opens and
  again when it closes, and sends what moved as /modset lines over the chat
  socket. This block keeps them per character, by profile id, in
  private\mod-settings.json, written to a temp copy and renamed over the old
  one the same way characters.json is. When the character is in the world the
  values go back through an owner-visible property whose updateOwner script
  sets each global on that person's own machine, edge triggered on a stamp
  like the swing and the alert, because updateOwner runs every frame.

  WHAT A CLIENT CAN SEND IS BOUNDED. Only the 78 names below, only plain
  numbers, at most MOD.pairs a line, each name and number short, and at most
  MOD.profiles characters in the file. Anything else is refused and logged.
  The profile id is the one the voice service stamped from the connection, so
  the worst a modified client can do is set its own menus.
  ============================================================================
*/
(function () {
  'use strict';
  var g = (typeof globalThis !== 'undefined') ? globalThis : this;
  var fs = null, path = null;
  try { fs = require('fs'); path = require('path'); } catch (e) { return; }

  function mlog() {
    var a = ['[thornswood mods]'];
    for (var i = 0; i < arguments.length; i++) { a.push(arguments[i]); }
    try { console.log(a.join(' ')); } catch (e) { }
  }

  var MOD_SETTINGS_PROPERTY = 'thornswoodModSettings';

  var MOD = {
    // How often the online list is walked for somebody who just came in.
    every: 3000,
    // The most name=value pairs taken from one line. A line is cut at 400
    // characters by the voice service, so a real one never comes near this.
    pairs: 40,
    // The longest editor id in the list is 53 characters.
    name: 64,
    // A float written out in full is under 25 characters.
    number: 32,
    // Hotkeys, percentages, multipliers and switches, none near this.
    most: 1e9,
    // Characters kept in the file before a new one is refused.
    profiles: 5000
  };

  /*
    Written out of Audit-ModMenus.js on 28 September against the shipping
    load order: 31 + 40 + 98 + 6 + 1 = 176. Atlas Map Markers' 98 came out
    with it (#3649): 31 + 40 + 6 + 1 = 78. test-mod-settings.js checks this
    table and the one in thornswood-front.js are the same, name for name.
  */
  var MOD_GLOBALS = {
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

  // name -> [plugin, id inside it]. Own properties only, so a name like
  // __proto__ or constructor is never found.
  var BY_NAME = {};
  var TOTAL = 0;
  Object.keys(MOD_GLOBALS).forEach(function (file) {
    Object.keys(MOD_GLOBALS[file]).forEach(function (name) {
      BY_NAME[name] = [file, MOD_GLOBALS[file][name]];
      TOTAL++;
    });
  });
  function known(name) {
    return Object.prototype.hasOwnProperty.call(BY_NAME, name) ? BY_NAME[name] : null;
  }

  var privDir = 'private';
  try {
    var cfg = JSON.parse(fs.readFileSync('server-settings.json', 'utf8'));
    if (cfg && cfg.privDir) { privDir = String(cfg.privDir); }
  } catch (e) { }
  try { if (!fs.existsSync(privDir)) { fs.mkdirSync(privDir, { recursive: true }); } } catch (e) { }
  var FILE = path.join(privDir, 'mod-settings.json');

  /*
    The book: profile id -> { name: number }. Read at load, so a restart
    starts from what was written. Anything in the file that is not a known
    name with a finite number is dropped as it is read, so a hand edit or an
    older table cannot put a stray value on anybody's machine.
  */
  var book = {};
  try {
    var had = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    var who = had && had.who;
    if (who && typeof who === 'object') {
      Object.keys(who).forEach(function (pid) {
        if (!/^\d{1,12}$/.test(pid) || !who[pid] || typeof who[pid] !== 'object') { return; }
        var row = {};
        var n = 0;
        Object.keys(who[pid]).forEach(function (name) {
          var v = who[pid][name];
          if (known(name) && typeof v === 'number' && isFinite(v) && Math.abs(v) <= MOD.most) {
            row[name] = v; n++;
          }
        });
        if (n) { book[pid] = row; }
      });
    }
  } catch (e) { book = {}; }

  /* Whole, with the engine's mp.writeFileWhole (#2740); see the roster's write(). */
  function write() {
    try {
      mp.writeFileWhole(FILE, JSON.stringify({ at: Date.now(), who: book }));
      return true;
    } catch (e) {
      mlog('could not write', FILE + ':', e);
      return false;
    }
  }

  /* A plain decimal number and nothing else: no hex, no Infinity, no NaN. */
  function numberOf(text) {
    var s = String(text);
    if (!s || s.length > MOD.number) { return NaN; }
    if (!/^-?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?$/i.test(s)) { return NaN; }
    var v = Number(s);
    if (!isFinite(v) || Math.abs(v) > MOD.most) { return NaN; }
    return v;
  }

  /*
    What goes on the property: the values grouped by plugin, as the id inside
    the plugin and the number, so the script on the client needs no table.
  */
  function payload(pid, at) {
    var row = book[String(pid)];
    if (!row) { return null; }
    var set = {};
    var n = 0;
    Object.keys(row).forEach(function (name) {
      var where = known(name);
      if (!where) { return; }
      (set[where[0]] = set[where[0]] || []).push([where[1], row[name]]);
      n++;
    });
    return n ? { at: at, set: set } : null;
  }

  /*
    Run on the person's own machine EVERY FRAME for as long as the property
    holds a value (see the note over SWING_PROPERTY), so it is edge triggered
    on v.at: a value that has not changed costs one comparison. The world may
    not be up the first time it runs, so a pass that finds none of the globals
    is tried again a second later, up to thirty times, and then left.
  */
  function putBackScript() {
    return [
      '(function(){',
      '  try {',
      '    var v = ctx.value;',
      '    if (!v || !v.at || !v.set) { return; }',
      '    var st = ctx.state;',
      '    if (!st) { return; }',
      '    if (st.thornswoodModsAt === v.at) { return; }',
      '    var now = Date.now();',
      '    if (st.thornswoodModsFor !== v.at) { st.thornswoodModsFor = v.at; st.thornswoodModsTries = 0; st.thornswoodModsLast = 0; }',
      '    if (now - (st.thornswoodModsLast || 0) < 1000) { return; }',
      '    st.thornswoodModsLast = now;',
      '    st.thornswoodModsTries = (st.thornswoodModsTries || 0) + 1;',
      '    var sp = ctx.sp;',
      '    var put = 0, miss = 0;',
      '    for (var file in v.set) {',
      '      if (!Object.prototype.hasOwnProperty.call(v.set, file)) { continue; }',
      '      var rows = v.set[file];',
      '      if (!rows || !rows.length) { continue; }',
      '      for (var i = 0; i < rows.length; i++) {',
      '        var id = Number(rows[i] && rows[i][0]);',
      '        var val = Number(rows[i] && rows[i][1]);',
      '        if (!id || !isFinite(val)) { miss++; continue; }',
      '        try {',
      '          var gv = sp.GlobalVariable.from(sp.Game.getFormFromFile(id, String(file)));',
      '          if (gv) { gv.setValue(val); put++; } else { miss++; }',
      '        } catch (e) { miss++; }',
      '      }',
      '    }',
      '    if (put > 0 || st.thornswoodModsTries >= 30) {',
      '      st.thornswoodModsAt = v.at;',
      '      try { sp.printConsole("[thornswood] mod settings put back: " + put + " set, " + miss + " not found"); } catch (e) { }',
      '    }',
      '  } catch (e) { }',
      '})();'
    ].join('\n');
  }

  /*
    Who has been sent their values this session: actor id -> the stamp. Kept
    on globalThis so a hot reload does not send everybody's again.
  */
  if (!g.__thornswoodModSent) { g.__thornswoodModSent = {}; }
  var sent = g.__thornswoodModSent;

  function send(actorId, pid, at) {
    var v = payload(pid, at);
    if (!v) { return false; }
    try { mp.set(actorId, MOD_SETTINGS_PROPERTY, v); return true; }
    catch (e) { mlog('could not set the property on', actorId.toString(16) + ':', e); return false; }
  }

  /* Once every MOD.every: anybody newly in the world gets their values. */
  function tick() {
    var online = [];
    try { online = mp.get(0, 'onlinePlayers') || []; } catch (e) { return; }
    var here = {};
    for (var i = 0; i < online.length; i++) {
      var actorId = online[i];
      here[actorId] = true;
      if (sent[actorId]) { continue; }
      var pid = 0;
      try { pid = Number(mp.get(actorId, 'profileId')) || 0; } catch (e) { pid = 0; }
      if (!pid) { continue; }
      var at = Date.now();
      sent[actorId] = { at: at, pid: pid };
      if (send(actorId, pid, at)) { mlog('put back the mod settings for profile', pid); }
    }
    Object.keys(sent).forEach(function (k) { if (!here[k]) { delete sent[k]; } });
  }

  /*
    One /modset line: "/modset Name=value Name=value ...". Returns what was
    taken and what was refused, for the log and for the test. Nothing is said
    back in the chat: nobody typed it.
  */
  function take(pid, parts) {
    var out = { took: 0, refused: [] };
    var key = String(Number(pid) || 0);
    if (key === '0') { out.refused.push('no profile'); return out; }
    var row = book[key];
    if (!row && Object.keys(book).length >= MOD.profiles) {
      out.refused.push('the file is full');
      return out;
    }
    var fresh = row ? null : {};
    var target = row || fresh;
    var changed = false;
    for (var i = 1; i < parts.length; i++) {
      var pair = String(parts[i] || '');
      if (!pair) { continue; }
      if (i > MOD.pairs) { out.refused.push(pair.slice(0, 24) + ' (too many on one line)'); continue; }
      var eq = pair.indexOf('=');
      var name = eq > 0 ? pair.slice(0, eq) : '';
      if (!name || name.length > MOD.name || !known(name)) {
        out.refused.push(pair.slice(0, 24) + ' (not a setting this server keeps)');
        continue;
      }
      var v = numberOf(pair.slice(eq + 1));
      if (isNaN(v)) { out.refused.push(name + ' (not a number)'); continue; }
      if (target[name] !== v) { target[name] = v; changed = true; }
      out.took++;
    }
    if (fresh && out.took) { book[key] = fresh; }
    if (changed) { write(); }
    return out;
  }

  function command(pid, actorId, parts) {
    var r = take(pid, parts);
    if (r.refused.length) { mlog('refused from profile', pid + ':', r.refused.join(', ')); }
    // Keep the property current under the same stamp, so the next login
    // carries the new values without this one setting them again.
    if (r.took && actorId && sent[actorId]) { send(actorId, pid, sent[actorId].at); }
    return r;
  }

  try {
    mp.makeProperty(MOD_SETTINGS_PROPERTY, {
      isVisibleByOwner: true, isVisibleByNeighbors: false,
      updateOwner: putBackScript(), updateNeighbor: ''
    });
  } catch (e) { /* already made by a previous load */ }

  if (g.__thornswoodModTimer) { try { clearInterval(g.__thornswoodModTimer); } catch (e) { } }
  g.__thornswoodModTimer = setInterval(guard('modSettingsTick', tick), MOD.every);

  g.__thornswoodModSettings = {
    MOD: MOD, MOD_GLOBALS: MOD_GLOBALS, MOD_SETTINGS_PROPERTY: MOD_SETTINGS_PROPERTY,
    FILE: FILE, book: book, known: known, numberOf: numberOf, payload: payload,
    putBackScript: putBackScript, take: take, command: command, tick: tick, sent: sent
  };

  mlog('ready:', TOTAL, 'settings in', Object.keys(MOD_GLOBALS).length, 'menus,',
       Object.keys(book).length, 'characters kept in', FILE);
})();
// ==== end thornswood mod settings ====

