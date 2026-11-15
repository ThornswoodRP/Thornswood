'use strict';
/*
  The settings in the game, as a panel (#3126).

  Patrick's ask on #3126: every setting in the launcher that is really an
  in-game setting is in the game's own settings, every key binding included,
  and his answer on #3146: the launcher keeps Play, news, update,
  diagnostics, account and the display settings that need a restart, and
  everything else moves into the game. Until this panel the field of view,
  how long the chat stays up, the needs bars and every key were set on the
  launcher's Settings and Controls pages, with Skyrim closed, and took effect
  at the next start. Here they are set with the game running and take effect
  at once.

  Opened from Settings on the help panel (the help key, F7) and on the K, P
  and J panels, beside their Help. It holds the keyboard like every other
  panel, so it hears its own keys: Escape closes it, and Change listens for
  the next key or thumb button and hands it to thornswood-front.js.

  THE FRONT DECIDES AND WRITES. This page never touches a file. It says what
  was asked, the front checks it (a key another Thornswood key already has,
  one of the game's own controls, the game client's F1, F2 and F6), writes
  Data\SKSE\Plugins\Thornswood.ini, applies it, and hands the whole state
  back with a line saying what happened. So what is drawn here is always
  what the file says.

  Every Thornswood key is in KEYS below, its row, its group and its
  default: the defaults are the template's, launcher\Thornswood.ini, and
  tests/test-thornswood-keys.js holds the three (this list, the template and
  the plugins' own defaults) together. The keys of the other mods (SkyUI,
  True Directional Movement, Better Third Person Selection) are shown as
  they are set, read by the front from MCM Helper's files, and are changed
  on each mod's own page under Mod Configuration, because MCM Helper keeps
  its settings in memory and writes them back over anything else on the way
  out. The mod settings window's key is SKSE Menu Framework's own, and is
  changed inside that window.

  THE CONTRACT with thornswood-front.js:
    window.thornswoodSettings = { open(), close(), toggle(), isOpen(), setState(state) }
    state  { fov: { value, min, max, def }, chatFade, chatChoices, needsBars,
             keys: { IniName: code }, mods: { id: code }, said }
    page -> plugin  'settings:ready' | 'settings:opened' | 'settings:closed'
                    'settings:set <Name> <value>'  Fov, ChatFade, NeedsBars, or an IniName with a scan code
*/
(function () {
  if (window.thornswoodSettings) { return; }

  var ID = 'ts-settings';
  var shown = false;
  var root = null;
  var tab = 'keys';
  var listening = '';      // the IniName waiting for a key, or ''

  /*
    THORNSWOOD'S OWN KEYS. ini is the name in Thornswood.ini, def the
    template's scan code. The words are what the launcher's Controls page
    said, without the launcher.
  */
  var KEYS = [
    { ini: 'ChatKey', def: 28, group: 'Panels and chat', label: 'Talk in chat',
      what: 'Hands the keyboard to the chat box and puts the cursor in it. Escape gives it back to the game.' },
    { ini: 'CommandKey', def: 53, group: 'Panels and chat', label: 'Type a command',
      what: 'Opens the chat with a slash already typed, for what is still typed there: /stuck, /helpme and /report, how a line is said (/me, /do, /w, /s, /y and /ooc), /roll, /needs for the needs bars as text, and staff and dev commands.' },
    { ini: 'HelpKey', def: 65, group: 'Panels and chat', label: 'Help',
      what: 'Opens the help panel: talking, people, living, work, land and getting help, with every key named as it is bound here. Help on the K, P and J panels opens it too, and its Settings opens this panel.' },
    { ini: 'SkillsKey', def: 37, group: 'Panels and chat', label: 'Profession, class and skill tree',
      what: 'Your profession, your class and the skill tree. A Master looking at somebody they could take on as an apprentice sees this key named under the crosshair. Looking at anybody else, it writes a contract with them.' },
    { ini: 'PartyKey', def: 25, group: 'Panels and chat', label: 'Friends and party',
      what: 'Who your friends are, who is online, your party, and the bonus for working together.' },
    { ini: 'JournalKey', def: 36, group: 'Panels and chat', label: 'Journals',
      what: 'Your journals and their pages, and every town\'s notice board.' },
    { ini: 'ManeuverKey', def: 10, group: 'Panels and chat', label: 'A warrior\'s maneuvers',
      what: 'Opens a small panel with the maneuvers you hold. Press a number or click one to start it.' },

    { ini: 'FriendKey', def: 21, group: 'People and places', label: 'Add or remove a friend',
      what: 'While you are looking at somebody, asks them to be friends, or takes them off your list.' },
    { ini: 'TradeWithKey', def: 35, group: 'People and places', label: 'Offer a trade',
      what: 'While you are looking at somebody, offers to trade. In your inventory, while you have a wound to tend, the same key opens the panel that tends it.' },
    { ini: 'MuteThemKey', def: 38, group: 'People and places', label: 'Mute somebody',
      what: 'While you are looking at somebody, stops you hearing them. Yours only: they are not told.' },
    { ini: 'MoldKey', def: 22, group: 'People and places', label: 'Press a key mold into a lock',
      what: 'While you are looking at a building\'s door with a blank key mold in your pack, presses it into the lock. Looking at somebody inside a building you hold, lets them sleep there for a night, or ends their night. In your inventory, with a repair kit in your pack, opens the repair panel.' },
    { ini: 'LockKey', def: 45, group: 'People and places', label: 'Claim, lock or unlock a door',
      what: 'At a door of the building you just opened, claims the building when nobody holds it, and locks or unlocks it when it is yours. At a forge, carrying a key mold pressed into a door, it cuts a key from the mold. At a crop, it claims the farm around it. Looking at somebody with a wound to tend, opens the panel that tends it.' },

    { ini: 'WheelKey', def: 34, group: 'Emote wheel', label: 'The emote wheel',
      what: 'Eight quick slots in the middle, and every emote in a list you can search. While the wheel is open, 1 to 8 play a slot.' },
    { ini: 'PageKey', def: 15, group: 'Emote wheel', label: 'Search the wheel',
      what: 'With the wheel open, moves to the search so you can type a name.' },
    { ini: 'CloseKey', def: 1, group: 'Emote wheel', label: 'Close the wheel',
      what: 'Shuts the wheel without playing anything. Escape always does too.' },
    { ini: 'StopKey', def: 49, group: 'Emote wheel', label: 'Stand up',
      what: 'Breaks you out of an idle that has no natural end, whether or not the wheel is open.' },

    { ini: 'PushToTalk', def: 47, group: 'Voice', label: 'Hold to talk',
      what: 'Everyone near you hears you while it is held, quieter the further away they stand.' },
    { ini: 'VoiceModeKey', def: 48, group: 'Voice', label: 'Whisper, talk or yell',
      what: 'Steps your voice from a whisper to your normal voice to a yell and round again.' },
    { ini: 'VoiceLockKey', def: 24, group: 'Voice', label: 'Keep talking',
      what: 'Locks the microphone open until you press it again, for a song or a long speech.' },

    { ini: 'CloseGameKey', def: 68, group: 'Making a character', label: 'Close Skyrim while making a character',
      what: 'Pressed twice while you are making your character, closes Skyrim. Nowhere else, so it cannot end a session in the world.' }
  ];

  /*
    THE OTHER MODS' KEYS, shown as they are set and changed where they live.
    id is what the front reads them under (MOD_KEYS in thornswood-front.js).
  */
  var MCM = '\'s page under Mod Configuration, in the pause menu.';
  var MODS = [
    { id: 'menu', group: 'Mod settings', label: 'The mod settings window',
      what: 'TrueHUD, Precision and the rest of the newer mods. Its key is changed in that window\'s own settings.' },
    { id: 'search', group: 'Inventory (SkyUI)', label: 'Search', what: 'Types into the search box of any inventory, container or barter list. Changed on SkyUI' + MCM },
    { id: 'switchtab', group: 'Inventory (SkyUI)', label: 'Switch column', what: 'Jumps between the two halves of a container or a trade. Changed on SkyUI' + MCM },
    { id: 'equipmode', group: 'Inventory (SkyUI)', label: 'Equip mode', what: 'Held down, equips to the other hand. Changed on SkyUI' + MCM },
    { id: 'favadd', group: 'Favourites (SkyUI)', label: 'Add to a group', what: 'In the favourites menu, puts the highlighted item into a group. Changed on SkyUI' + MCM },
    { id: 'favuse', group: 'Favourites (SkyUI)', label: 'Equip a whole group', what: 'In the favourites menu, equips everything in the highlighted group. Changed on SkyUI' + MCM },
    { id: 'favicon', group: 'Favourites (SkyUI)', label: 'Set a group\'s icon', what: 'In the favourites menu, changes a group\'s icon. Changed on SkyUI' + MCM },
    { id: 'favstate', group: 'Favourites (SkyUI)', label: 'Change how a group equips', what: 'In the favourites menu, switches between equip, unequip and toggle. Changed on SkyUI' + MCM },
    { id: 'favfocus', group: 'Favourites (SkyUI)', label: 'Move between items and groups', what: 'In the favourites menu, moves between the item list and the group list. Changed on SkyUI' + MCM },
    { id: 'favhot1', group: 'Favourites (SkyUI)', label: 'Group 1 in the world', what: 'Equips favourites group one without opening anything. Changed on SkyUI' + MCM },
    { id: 'favhot2', group: 'Favourites (SkyUI)', label: 'Group 2 in the world', what: 'Equips favourites group two. Changed on SkyUI' + MCM },
    { id: 'favhot3', group: 'Favourites (SkyUI)', label: 'Group 3 in the world', what: 'Equips favourites group three. Changed on SkyUI' + MCM },
    { id: 'favhot4', group: 'Favourites (SkyUI)', label: 'Group 4 in the world', what: 'Equips favourites group four. Changed on SkyUI' + MCM },
    { id: 'lock', group: 'Combat (True Directional Movement)', label: 'Lock on', what: 'Holds the camera on whatever you are aiming at. Changed on True Directional Movement' + MCM },
    { id: 'lockleft', group: 'Combat (True Directional Movement)', label: 'Switch target left', what: 'Moves the lock to the next thing on your left. Changed on True Directional Movement' + MCM },
    { id: 'lockright', group: 'Combat (True Directional Movement)', label: 'Switch target right', what: 'Moves the lock to the next thing on your right. Changed on True Directional Movement' + MCM },
    { id: 'lockbehind', group: 'Combat (True Directional Movement)', label: 'Look past your target', what: 'Swings the camera behind whatever you are locked on to. Changed on True Directional Movement' + MCM },
    { id: 'cyclehold', group: 'Reaching things (Better Third Person Selection)', label: 'Cycle modifier', what: 'Held down, the two keys below step through everything you could reach. Changed on Better Third Person Selection' + MCM },
    { id: 'cycleup', group: 'Reaching things (Better Third Person Selection)', label: 'Next thing', what: 'With the modifier held, moves the activate prompt to the next thing in range. Changed on Better Third Person Selection' + MCM },
    { id: 'cycledown', group: 'Reaching things (Better Third Person Selection)', label: 'Previous thing', what: 'With the modifier held, moves the activate prompt back one. Changed on Better Third Person Selection' + MCM }
  ];

  /*
    BOUND INSIDE THE GAME, AND WORTH KNOWING: the rows the launcher's
    Controls page ended on, which are not keys anybody sets here. QuickLoot
    is the example of a mod with its own page under Mod Configuration
    (QuickLootIEMCM.pex is in the build); tests/test-sunhelm-gone.js checks
    that no mod named here has left the collection.
  */
  var ALSO = [
    { group: 'Bound inside the game', key: 'Mod Configuration',
      what: 'In the pause menu: the classic SkyUI settings pages. QuickLoot and the older mods live here, and this is where their keys are changed.' },
    { group: 'Bound inside the game', key: 'E  /  R at a container',
      what: 'Loot without opening anything. Your Activate key takes the highlighted item, R takes the lot. Changed on QuickLoot\'s page under Mod Configuration.' },
    { group: 'Bound inside the game', key: 'Your Activate key',
      what: 'Picks up, talks, opens. Skyrim\'s own, under Settings, Controls in the pause menu.' },
    { group: 'Worth knowing', key: 'Esc',
      what: 'The game does not pause. Menus stay live for everyone else, so do not sort your bags mid fight.' },
    { group: 'Worth knowing', key: '~',
      what: 'The console. Using it on a shared world is how saves get broken, so leave it alone.' }
  ];

  /*
    SCAN CODES BY NAME, the DirectInput numbering Thornswood.ini, SkyUI and
    the rest speak, and what buttonEvent reports. Mouse buttons ride past the
    keyboard at 256.
  */
  var DIK = {
    1: 'Escape', 2: '1', 3: '2', 4: '3', 5: '4', 6: '5', 7: '6', 8: '7', 9: '8', 10: '9', 11: '0',
    12: '-', 13: '=', 14: 'Backspace', 15: 'Tab', 16: 'Q', 17: 'W', 18: 'E', 19: 'R', 20: 'T',
    21: 'Y', 22: 'U', 23: 'I', 24: 'O', 25: 'P', 26: '[', 27: ']', 28: 'Enter', 29: 'Left Ctrl',
    30: 'A', 31: 'S', 32: 'D', 33: 'F', 34: 'G', 35: 'H', 36: 'J', 37: 'K', 38: 'L', 39: ';',
    40: '\'', 41: '`', 42: 'Left Shift', 43: '\\', 44: 'Z', 45: 'X', 46: 'C', 47: 'V', 48: 'B',
    49: 'N', 50: 'M', 51: ',', 52: '.', 53: '/', 54: 'Right Shift', 55: 'Num *', 56: 'Left Alt',
    57: 'Space', 58: 'Caps Lock', 59: 'F1', 60: 'F2', 61: 'F3', 62: 'F4', 63: 'F5', 64: 'F6',
    65: 'F7', 66: 'F8', 67: 'F9', 68: 'F10', 69: 'Num Lock', 70: 'Scroll Lock',
    71: 'Num 7', 72: 'Num 8', 73: 'Num 9', 74: 'Num -', 75: 'Num 4', 76: 'Num 5', 77: 'Num 6',
    78: 'Num +', 79: 'Num 1', 80: 'Num 2', 81: 'Num 3', 82: 'Num 0', 83: 'Num .', 87: 'F11', 88: 'F12',
    156: 'Num Enter', 157: 'Right Ctrl', 181: 'Num /', 183: 'Print Screen', 184: 'Right Alt',
    197: 'Pause', 199: 'Home', 200: 'Up', 201: 'Page up', 203: 'Left', 205: 'Right', 207: 'End',
    208: 'Down', 209: 'Page down', 210: 'Insert', 211: 'Delete',
    256: 'Left mouse', 257: 'Right mouse', 258: 'Middle mouse', 259: 'Mouse 4', 260: 'Mouse 5',
    264: 'Wheel up', 265: 'Wheel down'
  };

  function nameOf(code) {
    // SKSE Menu Framework names its key ("F4") rather than numbering it.
    if (typeof code === 'string') { return code; }
    var n = Number(code);
    if (!(n >= 0)) { return 'not bound'; }
    return DIK[n] || ('code ' + n);
  }

  /*
    WHAT A KEY PRESS IS, as a scan code. The browser reports the Windows
    virtual key (keyCode), which is what the launcher's Controls page caught
    too, and only the keys that page offered are taken: the function keys,
    the letters and numbers, and the few others that make sense for a panel
    or a toggle, with Enter, so the chat key can go back to it. Escape is not
    one: it gives up listening.
  */
  var BY_VK = {
    8: 14, 9: 15, 13: 28, 20: 58, 19: 197, 33: 201, 34: 209, 35: 207, 36: 199, 45: 210, 46: 211,
    144: 69, 145: 70, 186: 39, 187: 13, 188: 51, 189: 12, 190: 52, 191: 53, 192: 41,
    219: 26, 220: 43, 221: 27, 222: 40
  };
  var LETTERS = 'QWERTYUIOP';
  var i;
  for (i = 0; i < LETTERS.length; i++) { BY_VK[LETTERS.charCodeAt(i)] = 16 + i; }
  LETTERS = 'ASDFGHJKL';
  for (i = 0; i < LETTERS.length; i++) { BY_VK[LETTERS.charCodeAt(i)] = 30 + i; }
  LETTERS = 'ZXCVBNM';
  for (i = 0; i < LETTERS.length; i++) { BY_VK[LETTERS.charCodeAt(i)] = 44 + i; }
  for (i = 1; i <= 9; i++) { BY_VK[48 + i] = 1 + i; }
  BY_VK[48] = 11;
  for (i = 1; i <= 10; i++) { BY_VK[111 + i] = 58 + i; }
  BY_VK[122] = 87; BY_VK[123] = 88;

  function codeOfKey(ev) {
    var vk = Number(ev.keyCode || ev.which || 0);
    // Shift, Ctrl and Alt come as one virtual key each; only the right hand
    // ones were offered, because the left are Skyrim's sprint, sneak and more.
    if (vk === 16 || vk === 17 || vk === 18) {
      if (ev.location !== 2) { return -1; }
      return vk === 16 ? 54 : (vk === 17 ? 157 : 184);
    }
    return BY_VK.hasOwnProperty(vk) ? BY_VK[vk] : -1;
  }

  var state = {
    fov: { value: 65, min: 60, max: 140, def: 65 },
    chatFade: 10, chatChoices: [5, 10, 15, 20, 0], needsBars: true,
    keys: {}, mods: {}, said: ''
  };

  function tell(what) {
    try { window.skyrimPlatform.sendMessage('thornswood-front', 'settings:' + what); }
    catch (e) { }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* The help panel's look, which is the P and K panels'. */
  var CSS = [
    '#' + ID + '{position:fixed;inset:0;z-index:2147483110;display:none;',
    '  background:radial-gradient(ellipse at center,rgba(0,0,0,.50) 0%,rgba(0,0,0,.72) 100%);',
    '  font-family:"Palatino Linotype",Palatino,Georgia,serif;color:#d9cfb4}',
    '#' + ID + '.on{display:grid;place-items:center}',
    '#' + ID + ' .panel{width:920px;max-width:calc(100vw - 48px);height:680px;',
    '  max-height:calc(100vh - 48px);display:grid;grid-template-rows:auto auto 1fr auto;',
    '  background:rgba(11,10,8,.94);border:1px solid rgba(198,170,109,.42);',
    '  outline:1px solid rgba(198,170,109,.14);outline-offset:4px;',
    '  box-shadow:0 24px 80px rgba(0,0,0,.7);overflow:hidden}',
    '#' + ID + ' h2{margin:0;padding:18px 24px 14px;font-size:26px;font-weight:normal;line-height:1.1;',
    '  color:#f6e9c8;border-bottom:1px solid rgba(198,170,109,.22)}',
    '#' + ID + ' .nav{padding:12px 24px;display:flex;gap:8px;flex-wrap:wrap;',
    '  border-bottom:1px solid rgba(198,170,109,.22)}',
    '#' + ID + ' .body{overflow:auto;padding:16px 24px;font-size:16px;line-height:1.45}',
    '#' + ID + ' .group{margin:14px 0 6px;font-size:13px;letter-spacing:.3em;text-transform:uppercase;color:#c6aa6d}',
    '#' + ID + ' .row{display:grid;grid-template-columns:120px 1fr auto;gap:14px;align-items:center;',
    '  padding:9px 0;border-top:1px solid rgba(198,170,109,.14)}',
    '#' + ID + ' .key{font-family:Consolas,monospace;font-size:15px;color:#e9d19b}',
    '#' + ID + ' .label{color:#f6e9c8}',
    '#' + ID + ' .what{font-size:14px;color:rgba(217,207,180,.7)}',
    '#' + ID + ' .note{font-size:14.5px;font-style:italic;color:rgba(217,207,180,.7);margin:0 0 10px}',
    '#' + ID + ' .line{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:8px 0 16px}',
    '#' + ID + ' input[type=range]{width:360px}',
    '#' + ID + ' .foot{padding:12px 24px;border-top:1px solid rgba(198,170,109,.22);',
    '  display:flex;gap:10px;align-items:center;font-size:14px;font-style:italic;color:rgba(217,207,180,.75)}',
    '#' + ID + ' button{font-family:inherit;font-style:normal;font-weight:normal;cursor:pointer;',
    '  border:1px solid rgba(198,170,109,.55);background:rgba(0,0,0,.25);color:#e9d19b;',
    '  padding:6px 12px;font-size:15px;line-height:20px;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap}',
    '#' + ID + ' button.go{background:#c6aa6d;border-color:#e9d19b;color:#1b1205}'
  ].join('\n');

  var TABS = [
    { id: 'keys', title: 'Keys' },
    { id: 'screen', title: 'Screen and chat' }
  ];

  function build() {
    if (root) { return root; }
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.id = ID;
    root.innerHTML =
      '<div class="panel">' +
      '<h2>Settings</h2>' +
      '<div class="nav" id="' + ID + '-nav"></div>' +
      '<div class="body" id="' + ID + '-body"></div>' +
      '<div class="foot"><span id="' + ID + '-foot"></span><span style="flex:1"></span>' +
      '<button id="' + ID + '-close">Close</button></div>' +
      '</div>';
    document.body.appendChild(root);
    root.querySelector('#' + ID + '-close').onclick = close;

    /*
      The page hears its own keys: while the browser holds the keyboard no
      plugin sees one (see thornswood-bridge.js). Listening, the next key is
      the answer and Escape gives up; otherwise Escape closes.
    */
    document.addEventListener('keydown', function (ev) {
      if (!shown) { return; }
      var k = String(ev.key || '');
      if (listening) {
        if (ev.preventDefault) { ev.preventDefault(); }
        if (k === 'Escape') { listening = ''; state.said = 'Left it as it was.'; draw(); return; }
        var code = codeOfKey(ev);
        if (code < 0) {
          state.said = 'That key cannot be used here. Try a function key, a letter, a number, or something like Insert.';
          draw();
          return;
        }
        answer(code);
        return;
      }
      if (k === 'Escape') {
        if (ev.preventDefault) { ev.preventDefault(); }
        close();
      }
    });
    /*
      The two thumb buttons, which are not key presses (the launcher's
      Controls page learned that from Grim Reefer, 21 September: push to talk
      on Mouse 4 or 5 is common because the game does not use them). Left,
      right and middle are never taken.
    */
    document.addEventListener('mousedown', function (ev) {
      if (!shown || !listening) { return; }
      if (ev.button === 3 || ev.button === 4) {
        if (ev.preventDefault) { ev.preventDefault(); }
        answer(ev.button === 3 ? 259 : 260);
      }
    });
    return root;
  }

  function answer(code) {
    var ini = listening;
    listening = '';
    state.said = 'Setting ' + labelOf(ini).toLowerCase() + ' to ' + nameOf(code) + '.';
    draw();
    tell('set ' + ini + ' ' + code);
  }

  function labelOf(ini) {
    for (var k = 0; k < KEYS.length; k++) { if (KEYS[k].ini === ini) { return KEYS[k].label; } }
    return ini;
  }

  function keysHtml() {
    var out = '<p class="note">Change, then the key you want, or a thumb button on your mouse. ' +
      'It works at once. Escape leaves it as it was.</p>';
    var group = '';
    for (var k = 0; k < KEYS.length; k++) {
      var r = KEYS[k];
      if (r.group !== group) { group = r.group; out += '<div class="group">' + esc(group) + '</div>'; }
      var code = state.keys.hasOwnProperty(r.ini) ? state.keys[r.ini] : r.def;
      var wait = listening === r.ini;
      out += '<div class="row"><div class="key">' + esc(wait ? 'press a key' : nameOf(code)) + '</div>' +
        '<div><div class="label">' + esc(r.label) + '</div><div class="what">' + esc(r.what) + '</div></div>' +
        '<button data-key="' + esc(r.ini) + '"' + (wait ? ' class="go"' : '') + '>' +
        (wait ? 'Listening' : 'Change') + '</button></div>';
    }
    group = '';
    for (var m = 0; m < MODS.length; m++) {
      var o = MODS[m];
      if (!state.mods.hasOwnProperty(o.id)) { continue; }
      if (o.group !== group) { group = o.group; out += '<div class="group">' + esc(group) + '</div>'; }
      out += '<div class="row"><div class="key">' + esc(nameOf(state.mods[o.id])) + '</div>' +
        '<div><div class="label">' + esc(o.label) + '</div><div class="what">' + esc(o.what) + '</div></div>' +
        '<span></span></div>';
    }
    group = '';
    for (var a = 0; a < ALSO.length; a++) {
      var w = ALSO[a];
      if (w.group !== group) { group = w.group; out += '<div class="group">' + esc(group) + '</div>'; }
      out += '<div class="row"><div class="key">' + esc(w.key) + '</div>' +
        '<div><div class="what">' + esc(w.what) + '</div></div><span></span></div>';
    }
    out += '<p class="note" style="margin-top:14px">F1 and F2 are the game client\'s, the names over heads ' +
      'and its overlay, and cannot be moved. Skyrim\'s own controls are under Settings, Controls in the pause menu.</p>';
    return out;
  }

  function screenHtml() {
    var f = state.fov;
    var out = '<div class="group">Field of view</div>' +
      '<div class="line"><input type="range" id="' + ID + '-fov" min="' + f.min + '" max="' + f.max +
      '" step="1" value="' + f.value + '"><span class="key" id="' + ID + '-fovnum">' + f.value + '</span>' +
      '<button id="' + ID + '-fovdef">Skyrim\'s own, ' + f.def + '</button></div>' +
      '<p class="note">How much of the world fits on screen, from ' + f.min + ' to ' + f.max + '. It changes as you let go.</p>';
    out += '<div class="group">Hide the chat after a new line</div><div class="line">';
    for (var c = 0; c < state.chatChoices.length; c++) {
      var s = state.chatChoices[c];
      out += '<button data-fade="' + s + '"' + (s === state.chatFade ? ' class="go"' : '') + '>' +
        (s === 0 ? 'Never' : s + ' s') + '</button>';
    }
    out += '</div><p class="note">' + (state.chatFade === 0
      ? 'Never: the chat stays on screen all the time.'
      : 'The chat hides ' + state.chatFade + ' seconds after its last line, whoever sent it. A new line brings it back, and so does opening the chat.') + '</p>';
    out += '<div class="group">Needs bars</div><div class="line">' +
      '<button data-bars="1"' + (state.needsBars ? ' class="go"' : '') + '>Shown</button>' +
      '<button data-bars="0"' + (!state.needsBars ? ' class="go"' : '') + '>Hidden</button></div>' +
      '<p class="note">Hunger, Thirst, Rest and Temp. Hidden, your needs carry on as before, the Body page on ' +
      esc(nameOf(state.keys.hasOwnProperty('SkillsKey') ? state.keys.SkillsKey : 37)) +
      ' shows all of them, and /needs in the chat says them as a line of text.</p>';
    out += '<p class="note">Resolution, the display mode, the frame limit and VSync need the game to start ' +
      'again, so they stay on the launcher\'s Settings.</p>';
    return out;
  }

  function draw() {
    if (!root) { return; }
    var nav = root.querySelector('#' + ID + '-nav');
    var body = root.querySelector('#' + ID + '-body');
    var foot = root.querySelector('#' + ID + '-foot');
    var html = '';
    for (var t = 0; t < TABS.length; t++) {
      html += '<button data-tab="' + TABS[t].id + '"' + (TABS[t].id === tab ? ' class="go"' : '') + '>' +
        esc(TABS[t].title) + '</button>';
    }
    nav.innerHTML = html;
    var tabs = nav.querySelectorAll('button[data-tab]');
    for (var b = 0; b < tabs.length; b++) {
      tabs[b].onclick = function () { listening = ''; tab = this.getAttribute('data-tab'); draw(); };
    }
    var top = body.scrollTop;
    body.innerHTML = tab === 'keys' ? keysHtml() : screenHtml();
    body.scrollTop = top;
    wire(body);
    foot.textContent = state.said || 'Escape closes this.';
  }

  function wire(body) {
    var each = function (sel, fn) {
      var list = body.querySelectorAll(sel);
      for (var n = 0; n < list.length; n++) { list[n].onclick = fn; }
    };
    each('button[data-key]', function () {
      listening = this.getAttribute('data-key');
      state.said = 'Press the key you want for ' + labelOf(listening).toLowerCase() + ', or Escape to leave it.';
      draw();
    });
    each('button[data-fade]', function () { tell('set ChatFade ' + this.getAttribute('data-fade')); });
    each('button[data-bars]', function () { tell('set NeedsBars ' + this.getAttribute('data-bars')); });
    var fov = body.querySelector('#' + ID + '-fov');
    if (fov) {
      var num = body.querySelector('#' + ID + '-fovnum');
      fov.oninput = function () { if (num) { num.textContent = this.value; } };
      fov.onchange = function () { tell('set Fov ' + this.value); };
    }
    var def = body.querySelector('#' + ID + '-fovdef');
    if (def) { def.onclick = function () { tell('set Fov ' + state.fov.def); }; }
  }

  /* Everything as the file has it, from the front, with what happened. */
  function setState(s) {
    if (!s || typeof s !== 'object') { return; }
    if (s.fov && typeof s.fov === 'object') { state.fov = s.fov; }
    if (typeof s.chatFade === 'number') { state.chatFade = s.chatFade; }
    if (s.chatChoices && s.chatChoices.length) { state.chatChoices = s.chatChoices; }
    if (typeof s.needsBars === 'boolean') { state.needsBars = s.needsBars; }
    if (s.keys && typeof s.keys === 'object') { state.keys = s.keys; }
    if (s.mods && typeof s.mods === 'object') { state.mods = s.mods; }
    state.said = typeof s.said === 'string' ? s.said : '';
    if (shown) { draw(); }
  }

  function open() {
    build();
    listening = '';
    state.said = '';
    draw();
    if (shown) { return; }
    shown = true;
    root.className = 'on';
    tell('opened');
  }

  function close() {
    if (!shown) { return; }
    shown = false;
    listening = '';
    if (root) { root.className = ''; }
    tell('closed');
  }

  function toggle() { if (shown) { close(); } else { open(); } }

  window.thornswoodSettings = {
    open: open, close: close, toggle: toggle, setState: setState,
    isOpen: function () { return shown; },
    // For the harness: the rows and the names, read rather than retyped.
    KEYS: KEYS, MODS: MODS, nameOf: nameOf
  };
  build();
  tell('ready');
})();
