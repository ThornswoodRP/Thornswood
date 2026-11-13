// test-mold-key.js
//
// Look at a door, press U, and the blank key mold you carry takes that
// lock's shape.
//
// Patrick, 24 September, in order: "you should press e on a un molded door
// to fill the mold", then "not type" /mold, then "actually can we make it a
// different key that is unused in tis scenario and include a prompt when
// loooking at a door to press that key to set a mold".
//
// TWO HALVES, AND BOTH ARE DRIVEN HERE, because neither works alone.
//
// THE CLIENT. The section of thornswood-front.js that draws the line and
// sends the press is lifted out whole, with the real key handler, the real
// menu check and the real ini reader, and run against a pretend game and a
// pretend page. The line shows only for a door, only with a Key Mold in the
// pack, only on a build whose Thornswood-Content.esp has the blank's recipe,
// never over a menu or while the chat has the keyboard, and it goes when the
// person looks away. The key sends /moldhere and that door's id, and on a
// build without the recipe nothing is drawn, nothing is sent, and the
// crosshair is never even asked.
//
// THE SERVER. moldHere and every helper it leans on are lifted out of
// gamemode.js and run against a pretend engine, which answers
// getNeighborsByPosition the way the fork does: a descriptor and a position
// or a throw, and a list that starts with empty slots. Every rule is walked,
// the distance check with a door just inside and just outside reach, and a
// door in another cell. The typed /mold is run too, because holderNearby was
// asking the engine the wrong way and the holder standing beside the smith
// never counted.
//
// And the key itself: U by default, MoldKey in Thornswood.ini, and not a
// number anything else of ours or vanilla Skyrim already answers to.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);
const read = function (p) { return fs.readFileSync(p, 'utf8').split(CR).join(''); };

const FRONT_PATH = process.env.FRONT || path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js');
const GM_PATH = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const front = read(FRONT_PATH);
const gm = read(GM_PATH);
const ini = read(path.join(REPO_DIR, 'launcher', 'Thornswood.ini'));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

/* One function by its whole first line, only if that line is there once. */
function liftFrom(src, first, indent) {
  const from = '\n' + indent + first;
  const a = src.indexOf(from);
  if (a < 0 || src.indexOf(from, a + 1) >= 0) { return null; }
  const end = '\n' + indent + '}\n';
  const b = src.indexOf(end, a + 1);
  return b < 0 ? null : src.slice(a + 1, b + end.length);
}
/* A one line function, the whole line. */
function liftLine(src, first) {
  const from = '\n  ' + first;
  const a = src.indexOf(from);
  if (a < 0 || src.indexOf(from, a + 1) >= 0) { return null; }
  const b = src.indexOf('\n', a + 1);
  return src.slice(a + 1, b + 1);
}
/* From one line to the end of the handler that starts at another. */
function liftSpan(src, first, lastOpen) {
  const a = src.indexOf(first);
  if (a < 0) { return null; }
  const c = src.indexOf(lastOpen, a);
  if (c < 0) { return null; }
  const SHUT = '\n  }));\n';
  const b = src.indexOf(SHUT, c);
  return b < 0 ? null : src.slice(a, b + SHUT.length);
}

// =================================================================== the key
const defM = /(?:const|let) MOLD_KEY\s*=\s*iniNumber\(ini, 'MoldKey', (\d+)\);/.exec(front);
yes('the plugin reads MoldKey out of Thornswood.ini', !!defM);
const MOLD_DEFAULT = defM ? Number(defM[1]) : -1;
yes('and U, scan code 22, is its default', MOLD_DEFAULT === 22);

const iniM = /^\s*MoldKey\s*=\s*(\d+)\s*$/m.exec(ini);
yes('the shipped Thornswood.ini carries MoldKey = 22', !!iniM && Number(iniM[1]) === 22);

{
  /*
    Everything else that already answers to a scan code, gathered from the
    files rather than remembered, plus vanilla Skyrim's own keyboard.
  */
  const taken = {};
  function take(code, who) { (taken[code] = taken[code] || []).push(who); }
  let m;
  const rxFront = /iniNumber\(ini, '(\w+)', (\d+)\)/g;
  while ((m = rxFront.exec(front)) !== null) {
    if (m[1] !== 'MoldKey' && m[1] !== 'VoicePort') { take(Number(m[2]), 'front ' + m[1]); }
  }
  const emotes = read(path.join(REPO_DIR, 'game', 'plugins', 'thornswood-emotes.js'));
  const rxEm = /key\('(\w+)', (\d+)\)/g;
  while ((m = rxEm.exec(emotes)) !== null) { take(Number(m[2]), 'emotes ' + m[1]); }
  const voice = read(path.join(REPO_DIR, 'game', 'plugins', 'thornswood-voice.js'));
  const rxVo = /^let (\w+_KEY) = (\d+);/gm;
  while ((m = rxVo.exec(voice)) !== null) { take(Number(m[2]), 'voice ' + m[1]); }
  const mark = read(path.join(REPO_DIR, 'game', 'plugins', 'thornswood-mark.js'));
  const rxMk = /^let (\w+Key) = (\d+);/gm;
  while ((m = rxMk.exec(mark)) !== null) { take(Number(m[2]), 'mark ' + m[1]); }
  const rxIni = /^\s*(\w+)\s*=\s*(\d+)\s*$/gm;
  while ((m = rxIni.exec(ini)) !== null) {
    if (['MoldKey', 'VoicePort', 'Microphone'].indexOf(m[1]) === -1) { take(Number(m[2]), 'ini ' + m[1]); }
  }
  // The rows on Settings in the game (#3126), where the Controls page's were.
  const settingsPage = read(path.join(REPO_DIR, 'game', 'ui', 'thornswood-settings.js'));
  const rxRow = /\{ ini: '(\w+)', def: (-?\d+),/g;
  let rows = 0;
  while ((m = rxRow.exec(settingsPage)) !== null) { rows++; if (m[1] !== 'MoldKey') { take(Number(m[2]), 'Settings ' + m[1]); } }
  // Vanilla Skyrim, keyboard: W A S D, E, R, Q, Z, F, T, M, I, C, X, J, P,
  // Tab, Escape, Space, Shift, Alt, Ctrl, Caps Lock and the hotkeys 1 to 8.
  [17, 30, 31, 32, 18, 19, 16, 44, 33, 20, 50, 23, 46, 45, 36, 25, 15, 1, 57,
   42, 56, 29, 58, 2, 3, 4, 5, 6, 7, 8, 9].forEach(function (c) { take(c, 'Skyrim'); });
  yes('the other keys were found to compare against (' + Object.keys(taken).length +
      ' codes, ' + rows + ' Settings rows)', Object.keys(taken).length > 20 && rows >= 10);
  yes('and nothing else of ours or Skyrim\'s answers to U' +
      (taken[22] ? ' (' + taken[22].join(', ') + ')' : ''), !taken[22]);
}

// ================================================================ the client
const PIECES_FRONT = {
  iniNumber: liftFrom(front, 'function iniNumber(text, key, fallback) {', '  '),
  keyName: liftFrom(front, 'function keyName(code) {', '  '),
  anyClaim: liftFrom(front, 'function anyClaim() {', '  '),
  gameMenuOpen: liftFrom(front, 'function gameMenuOpen() {', '  '),
  busyMenuOpenNow: liftFrom(front, 'function busyMenuOpenNow(except) {', '  '),
  menus: (function () {
    const a = front.indexOf('  const KEYBOARD_MENUS = [');
    const b = a < 0 ? -1 : front.indexOf('\n  ];\n', a);
    return b < 0 ? null : front.slice(a, b + 6);
  })(),
  mold: liftSpan(front, '  const MOLD_EVERY = ', "  sp.on('menuOpen', guard('mold menu',"),
  keys: liftSpan(front, "  sp.on('buttonEvent', guard('keys', (e) => {",
                 "  sp.on('buttonEvent', guard('keys', (e) => {")
};
const missingFront = Object.keys(PIECES_FRONT).filter(function (k) { return !PIECES_FRONT[k]; });
yes('every piece of the plugin half is in thornswood-front.js' +
    (missingFront.length ? ' (missing: ' + missingFront.join(', ') + ')' : ''),
    missingFront.length === 0);

const DOOR = 0x0001a6f4;       // a front door, Skyrim.esm
const OTHER_DOOR = 0x0001b000;
const LEVER = 0x00020000;      // an activator
const MOLD_RUNTIME = 0x0a015495;

/*
  One client: the lifted text over a pretend game and a pretend page. The page
  runs the very scripts the plugin hands it, against a document that keeps
  its elements, so "is the line up" is read off the page and not off the
  plugin's own opinion of it.
*/
function client(opt) {
  opt = opt || {};
  const w = {
    now: 1700000000000,
    recipe: opt.recipe !== false,
    crosshair: null,          // { id, type }
    carried: 1,
    stamped: 0,        // of those, how many carry a door's name
    changesThrow: false,
    menus: {},
    claims: {},
    sent: [], logs: [], verbs: [],
    calls: { crosshair: 0, fromFile: 0, isMenuOpen: 0, count: 0 },
    handlers: {}
  };
  function newPage() {
    const els = {};
    return {
      els: els,
      doc: {
        getElementById: function (id) { return els[id] || null; },
        createElement: function () { return { id: '', style: { cssText: '', display: '' }, innerHTML: '' }; },
        body: { appendChild: function (el) { els[el.id] = el; } }
      }
    };
  }
  w.page = newPage();
  w.reload = function () { w.page = newPage(); };
  const T = {
    ready: true,
    js: function (src) {
      if (!T.ready) { return false; }
      new Function('document', src)(w.page.doc);
      return true;
    },
    hasFocus: function () { return false; }
  };
  w.T = T;
  const sp = {
    on: function (name, fn) { (w.handlers[name] = w.handlers[name] || []).push(fn); },
    // What SkyrimPlatform hands back: a stamped mold is one with a
    // TextDisplayData name, the way skymp5-client applies the server's name.
    getExtraContainerChanges: function (id) {
      if (w.changesThrow) { throw new Error('no container changes'); }
      if (id !== 0x14) { return null; }
      const lists = [];
      if (w.stamped > 0) {
        lists.push([{ type: 'Count', count: w.stamped },
                    { type: 'TextDisplayData', name: 'Key mold for Breezehome' }]);
      }
      return [{ baseId: 0x0f00aaaa, countDelta: 3, extendDataList: [] },
              { baseId: MOLD_RUNTIME, countDelta: w.carried, extendDataList: lists }];
    },
    Game: {
      getPlayer: function () {
        return {
          getFormID: function () { return 0x14; },
          getItemCount: function (form) {
            w.calls.count++;
            return form && form.id === MOLD_RUNTIME ? w.carried : 0;
          }
        };
      },
      getFormFromFile: function (id, file) {
        w.calls.fromFile++;
        if (file !== 'Thornswood-Content.esp' || !w.recipe) { return null; }
        if (id === 0x15496) { return { getFormID: function () { return 0x0a015496; } }; }
        if (id === 0x15495) { return { getFormID: function () { return MOLD_RUNTIME; } }; }
        return null;
      },
      getFormEx: function (id) { return id === MOLD_RUNTIME ? { id: id } : null; },
      getCurrentCrosshairRef: function () {
        w.calls.crosshair++;
        const c = w.crosshair;
        if (!c) { return null; }
        return {
          getFormID: function () { return c.id; },
          getBaseObject: function () { return { getType: function () { return c.type; } }; }
        };
      }
    },
    Ui: { isMenuOpen: function (name) { w.calls.isMenuOpen++; return !!w.menus[name]; } },
    Utility: { isInMenuMode: function () { return false; } }
  };
  const iniText = opt.ini || '';
  const body = [
    PIECES_FRONT.iniNumber, PIECES_FRONT.keyName, PIECES_FRONT.anyClaim,
    PIECES_FRONT.gameMenuOpen, PIECES_FRONT.menus, PIECES_FRONT.busyMenuOpenNow,
    'const MOLD_KEY = iniNumber(iniText, "MoldKey", ' + MOLD_DEFAULT + ');',
    'const MOLD_NAME = keyName(MOLD_KEY);',
    'const FRIEND_KEY = 21, TRADE_KEY = 35, MUTE_KEY = 38, PARTY_KEY = 25, JOURNAL_KEY = 36;',
    'const SKILLS_KEY = 37, CHAT_KEY = 28, ESC = 1;',
    'const COMMAND_KEY = 53; function commandKeyPressed() { }',
    // The / and P watchers on the game's own menus (test-slash-key.js).
    'const OFF_MENU = { openedBy: function () { return ""; }, shutFor: function () { }, keyDown: function () { } };',
    'const statsOnSlash = OFF_MENU, magicOnP = OFF_MENU;',
    'let keysSeen = 0, sawAnyKey = true;',
    'function busyMenuOpen() { return busyMenuOpenNow(); }',
    'function rememberKey() {}',
    'function wantTyping() {}',
    'function lookVerb(cmd) { verbs.push(cmd); return true; }',
    // The J block's two hooks, which the key handler calls on every key and
    // on J. What they do is test-journal-key.js's business, not this one's.
    'function journalKeyDown() {}',
    'function journalKeyPressed() {}',
    // The board, ride and merchant presses, which the key handler asks
    // before anything else since #1430 and #1394. Each answers only the
    // game's Activate event (E on something), and no press here is one.
    // What they do is test-1374-letters.js's, test-1394-fares.js's and
    // test-merchant-traders.js's business.
    // Hand over the letter (#1595), Activate on somebody you carry a letter
    // for, asked first. test-1595-deliver.js has what it does.
    'function deliverPress() { return false; }',
    'function boxPress() { return false; }',
    'function boardPress() { return false; }',
    'function driverPress() { return false; }',
    'function merchantPress() { return false; }',
    // The lock key, X, since #1472. It is asked only for its own scan code,
    // and what it does is test-lock-keypress.js's business.
    'const LOCK_KEY = iniNumber(iniText, "LockKey", 45);',
    'function lockPress() { return false; }',
    // Tend their wounds (#1383), X on a hurt person, and Tend your wounds,
    // H in the inventory. Nobody is looked at and no inventory is open
    // here; test-1383-treatments.js has what they do.
    'const TREAT_KEY = LOCK_KEY, TREAT_SELF_KEY = 35;',
    'function treatPress() { return false; }',
    'function treatSelfPress() { return false; }',
    // Salt or smoke your food (#3163), Y in the inventory. No inventory is
    // open here; test-3163-spoilage.js has what it does.
    'const PRESERVE_KEY = FRIEND_KEY;',
    'function preservePress() { return false; }',
    PIECES_FRONT.mold,
    // The same key after the mold says no: sleeping on a person inside a
    // building you hold (#1603, SLEEP_KEY is MOLD_KEY in the plugin) and a
    // repair kit in the inventory (#1384). Nobody is looked at and no
    // inventory is open here; test-1603-beds.js and test-1384-condition.js
    // have what they do.
    'const SLEEP_KEY = MOLD_KEY;',
    'function sleepPress() { return false; }',
    'function repairPress() { return false; }',
    // The furniture keys (#2679): a piece in hand or under the crosshair, and
    // Arrange furniture in the inventory. No piece and no inventory here;
    // test-2679-furniture.js has what they do.
    'function furniturePress() { return false; }',
    'function arrangePress() { return false; }',
    // And at a forge with a stamped mold, the master key (#2254). No forge
    // is looked at here; test-1637-door-gui.js has what it does.
    'function masterPress() { return false; }',
    // A warrior's maneuver key (#1386), 9, scan code 10, asked ahead of K.
    // No press here is 9; test-1386-warrior.js has what it does.
    'const MANEUVER_KEY = iniNumber(iniText, "ManeuverKey", 10);',
    'function maneuverKeyPressed() {}',
    // The help key (#1633), F7, scan code 65. No press here is F7;
    // test-1633-help-panel.js has what it does.
    'const HELP_KEY = iniNumber(iniText, "HelpKey", 65);',
    'function helpKeyPressed() {}',
    // K on a person a Master could take on (#1634), asked ahead of K. Nobody
    // is looked at here; test-1634-apprentice-gui.js has what it does.
    'const APPRENTICE_KEY = SKILLS_KEY;',
    'function apprenticePress() { return false; }',
    // K on a person while you carry a hair dye (#2675), asked after it. Nobody
    // is looked at here; test-2675-hair-dye-wiring.js has what it does.
    'const HAIR_DYE_KEY = SKILLS_KEY;',
    'function hairDyePress() { return false; }',
    // K on anybody else writes a contract with them (#4561), asked after the
    // two above. Nobody is looked at here; test-4561-contracts.js has what it does.
    'const CONTRACT_KEY = SKILLS_KEY;',
    'function contractPress() { return false; }',
    PIECES_FRONT.keys,
    'return { MOLD_KEY: MOLD_KEY, MOLD_NAME: MOLD_NAME, moldPress: moldPress };'
  ].join('\n');
  const api = new Function('sp', 'T', 'claims', 'tellServer', 'say', 'log', 'guard', 'iniText', 'verbs',
                           body)(sp, T, w.claims,
                                 function (line) { if (line) { w.sent.push(line); } },
                                 function (t) { w.logs.push(String(t)); },
                                 function () { w.logs.push(Array.prototype.join.call(arguments, ' ')); },
                                 function (name, fn) { return fn; },
                                 iniText, w.verbs);
  w.api = api;
  /* A third of a second of game, which is one look. */
  w.tick = function () { w.now += 400; (w.handlers.update || []).forEach(function (f) { f(); }); };
  w.press = function (code) {
    (w.handlers.buttonEvent || []).forEach(function (f) { f({ code: code, isDown: true, isUp: false }); });
  };
  w.menuOpens = function (name) {
    w.menus[name] = true;
    (w.handlers.menuOpen || []).forEach(function (f) { f({ name: name }); });
  };
  w.lineUp = function () {
    const d = w.page.els['ts-mold'];
    return !!d && d.style.display !== 'none';
  };
  w.lineText = function () {
    const d = w.page.els['ts-mold'];
    return d ? String(d.innerHTML).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
  };
  return w;
}

const realNow = Date.now;
let clockOf = null;
Date.now = function () { return clockOf ? clockOf.now : realNow(); };

try {
  if (missingFront.length === 0) {
    // C1: THE DONE-WHEN. A door, a mold, the new plugin: the line names the key.
    {
      const w = client(); clockOf = w;
      w.crosshair = { id: DOOR, type: 29 };
      w.tick();
      yes('C1 looking at a door with a Key Mold in the pack puts the line up', w.lineUp());
      yes('C1 and it names the key and says what it does: "' + w.lineText() + '"',
          w.lineText() === 'U Press your key mold into this lock');
      w.press(22);
      yes('C1 U sends the door to the server, by its id in hex',
          w.sent.length === 1 && w.sent[0] === '/moldhere ' + DOOR.toString(16));
      yes('C1 and the key is used, so it goes no further down the list', w.verbs.length === 0);

      // Looking away takes it down.
      w.crosshair = null;
      w.tick();
      yes('C1 looking away takes the line down', !w.lineUp());
      w.press(22);
      yes('C1 and U with nothing under the crosshair sends nothing', w.sent.length === 1);

      // A lever is not a door.
      w.crosshair = { id: LEVER, type: 24 };
      w.tick();
      yes('C1 a lever is not a door, so no line', !w.lineUp());
      w.press(22);
      yes('C1 and no press', w.sent.length === 1);
    }

    // C2: no mold, no line.
    {
      const w = client(); clockOf = w;
      w.carried = 0;
      w.crosshair = { id: DOOR, type: 29 };
      w.tick();
      yes('C2 a door with no Key Mold in the pack draws nothing', !w.lineUp());
      w.press(22);
      yes('C2 and U sends nothing', w.sent.length === 0);
      w.carried = 2;
      w.tick();
      yes('C2 a mold picked up while looking at it brings the line up on the next look', w.lineUp());
    }

    // C3: the old plugin. Nothing drawn, nothing sent, nothing asked.
    {
      const w = client({ recipe: false }); clockOf = w;
      w.crosshair = { id: DOOR, type: 29 };
      for (let i = 0; i < 20; i++) { w.tick(); }
      yes('C3 on a build without the blank\'s recipe the line never appears', !w.lineUp() &&
          !w.page.els['ts-mold']);
      w.press(22);
      yes('C3 and U sends nothing', w.sent.length === 0);
      yes('C3 the plugin was asked once and remembered: ' + w.calls.fromFile + ' lookup(s)',
          w.calls.fromFile === 1);
      yes('C3 and the quiet path never asks the game what is under the crosshair: ' +
          w.calls.crosshair + ' call(s)', w.calls.crosshair === 0);
      yes('C3 and says why in the log, once',
          w.logs.filter(function (l) { return /no blank key mold recipe/.test(l); }).length === 1);
    }

    // C4: never over a menu.
    {
      const w = client(); clockOf = w;
      w.crosshair = { id: DOOR, type: 29 };
      w.tick();
      yes('C4 the line is up at the door', w.lineUp());
      w.menuOpens('InventoryMenu');
      yes('C4 the inventory opening takes it down at once, before the next look', !w.lineUp());
      w.tick();
      yes('C4 and the next look, with the inventory still open, leaves it down', !w.lineUp());
      w.press(22);
      yes('C4 and U over the inventory sends nothing', w.sent.length === 0);
      delete w.menus.InventoryMenu;
      w.tick();
      yes('C4 the inventory shut, the line comes back', w.lineUp());
      // A menu that takes nothing from anybody does not flicker it.
      w.menuOpens('HUD Menu');
      yes('C4 a menu that is not in anybody\'s way leaves it alone', w.lineUp());
    }

    // C5: the chat or a panel has the keyboard: a u typed is a letter.
    {
      const w = client(); clockOf = w;
      w.crosshair = { id: DOOR, type: 29 };
      w.claims.chat = true;
      w.tick();
      yes('C5 while the chat has the keyboard there is no line', !w.lineUp());
      w.press(22);
      yes('C5 and a u typed into the chat is not a press', w.sent.length === 0);
      w.claims.chat = false;
      w.tick();
      yes('C5 the chat closed, the line is back', w.lineUp());
    }

    // C6: pressing twice in a breath is one line to the server.
    {
      const w = client(); clockOf = w;
      w.crosshair = { id: DOOR, type: 29 };
      w.tick();
      w.press(22); w.press(22); w.press(22);
      yes('C6 three presses in a breath send once', w.sent.length === 1);
      w.now += 1600;
      w.press(22);
      yes('C6 and a press a moment later sends again', w.sent.length === 2);
      w.crosshair = { id: OTHER_DOOR, type: 29 };
      w.press(22);
      yes('C6 a different door is its own press, and the id is read at the press',
          w.sent.length === 3 && w.sent[2] === '/moldhere ' + OTHER_DOOR.toString(16));
    }

    // C7: the look is on a beat, not every frame.
    {
      const w = client(); clockOf = w;
      w.crosshair = { id: DOOR, type: 29 };
      w.tick();
      const before = w.calls.crosshair;
      for (let i = 0; i < 30; i++) { (w.handlers.update || []).forEach(function (f) { f(); }); }
      yes('C7 thirty frames inside one beat ask the crosshair no more times: ' +
          (w.calls.crosshair - before), w.calls.crosshair === before);
    }

    // C8: a page that reloads loses the line with everything else.
    {
      const w = client(); clockOf = w;
      w.crosshair = { id: DOOR, type: 29 };
      w.tick();
      yes('C8 the line is up', w.lineUp());
      w.T.ready = false;
      w.reload();
      w.tick();
      w.T.ready = true;
      w.tick();
      yes('C8 after the page reloads the line is drawn again for the same door', w.lineUp());
      w.T.ready = false;
      w.press(22);
      yes('C8 and nothing is sent while the page is not ready', w.sent.length === 0);
    }

    // C9: a rebind in the ini is the key that works and the letter on screen.
    {
      const w = client({ ini: '[Property]\nMoldKey = 45\n' }); clockOf = w;
      w.crosshair = { id: DOOR, type: 29 };
      w.tick();
      yes('C9 MoldKey = 45 in the ini puts X on the line', w.lineText().indexOf('X ') === 0);
      w.press(22);
      yes('C9 and U no longer does it', w.sent.length === 0);
      w.press(45);
      yes('C9 X does', w.sent.length === 1);
    }

    // C11 (#529): only a blank mold puts the line up. A holder carrying the
    // stamped mold for their own house used to see it at every door.
    {
      const w = client(); clockOf = w;
      w.carried = 1; w.stamped = 1;
      w.crosshair = { id: DOOR, type: 29 };
      w.tick();
      yes('C11 a stamped mold and no blank draws nothing', !w.lineUp());
      w.press(22);
      yes('C11 and U sends nothing', w.sent.length === 0);
      w.carried = 3; w.stamped = 2;
      w.tick();
      yes('C11 a blank beside two stamped ones brings the line up', w.lineUp());
      w.carried = 2;
      w.tick();
      yes('C11 and once the blank is spent it goes', !w.lineUp());
      w.changesThrow = true;
      w.tick();
      yes('C11 if the names in the pack cannot be read, it shows as it did and the server decides', w.lineUp());
    }

    // C10: the social keys are untouched.
    {
      const w = client(); clockOf = w;
      w.crosshair = null;
      w.press(21);
      yes('C10 Y still goes to the friend verb', w.verbs.length === 1 && w.verbs[0] === 'friend');
    }
  }
} finally {
  clockOf = null;
}

// ================================================================ the server
const PIECES_GM = {
  idOf: liftFrom(gm, 'function idOf(descriptor) {', ''),
  holdsNamed: liftFrom(gm, 'function holdsNamed(actorId, baseDesc, label) {', '  '),
  keyLabel: liftLine(gm, 'function keyLabel(building) {'),
  moldLabel: liftLine(gm, 'function moldLabel(building) {'),
  deedLabel: liftLine(gm, 'function deedLabel(building) {'),
  holdsMold: liftLine(gm, 'function holdsMold(actorId, building) {'),
  holdsDeed: liftLine(gm, 'function holdsDeed(actorId, building) {'),
  giveNamed: liftFrom(gm, 'function giveNamed(actorId, baseDesc, label) {', '  '),
  holderOf: liftFrom(gm, 'function holderOf(building) {', '  '),
  nameOf: liftFrom(gm, 'function nameOf(building) {', '  '),
  placeOf: liftFrom(gm, 'function placeOf(building) {', '  '),
  holdOfBuilding: liftFrom(gm, 'function holdOfBuilding(building) {', '  '),
  buildingOf: liftFrom(gm, 'function buildingOf(doorDesc) {', '  '),
  blankMoldsExist: liftFrom(gm, 'function blankMoldsExist() {', '  '),
  takeBlankMold: liftFrom(gm, 'function takeBlankMold(actorId) {', '  '),
  holderNearby: liftFrom(gm, 'function holderNearby(actorId, building, held) {', '  '),
  carriesBlankMold: liftFrom(gm, 'function carriesBlankMold(actorId) {', '  '),
  distanceTo: liftFrom(gm, 'function distanceTo(actorId, refrId) {', '  '),
  moldHere: liftFrom(gm, 'function moldHere(parts, actorId, profileId, toProfile) {', '  '),
  mold: liftFrom(gm, 'function mold(actorId, profileId, toProfile) {', '  ')
};
const missingGm = Object.keys(PIECES_GM).filter(function (k) { return !PIECES_GM[k]; });
yes('every piece of the server half is in gamemode.js' +
    (missingGm.length ? ' (missing: ' + missingGm.join(', ') + ')' : ''),
    missingGm.length === 0);

function quoted(re) { const m = gm.match(re); return m ? m[1] : null; }
const KEY_DESC = quoted(/\n  var KEY = '([^']+)';/);
const MOLD_DESC = quoted(/\n  var MOLD = '([^']+)';/);
const DEED_DESC = quoted(/\n  var DEED = '([^']+)';/);
const RECIPE_DESC = quoted(/\n  var BLANK_MOLD_RECIPE = '([^']+)';/);
const reachM = /\n  var MOLD_REACH = (\d+);/.exec(gm);
const REACH = reachM ? Number(reachM[1]) : NaN;
yes('the records and the reach are read out of the file', !!(KEY_DESC && MOLD_DESC && DEED_DESC && RECIPE_DESC) &&
    REACH > 0);
yes('and the reach is a few hundred units, standing at the door: ' + REACH, REACH >= 200 && REACH <= 600);

const HOUSE = '165a7:Skyrim.esm';
const DOOR_DESC = '1a6f4:Skyrim.esm';
const INSIDE_DOOR = 0x000165b0;          // the same house, from inside
const INSIDE_DESC = '165b0:Skyrim.esm';
const DUNGEON_DOOR = 0x0002c000;
const TAMRIEL = '3c:Skyrim.esm';
const HOUSE_CELL = '165a7:Skyrim.esm';

const ALICE = { actor: 0xff000058, pid: 101, name: 'Alice' };   // holds the house
const BOB = { actor: 0xff000059, pid: 202, name: 'Bob' };       // has a blank
const CARL = { actor: 0xff00005a, pid: 303, name: 'Carl' };     // a smith
// Lower than Alice's id, so the engine lists him ahead of her.
const DIRK = { actor: 0xff000057, pid: 404, name: 'Dirk' };     // a stolen deed
const CHEST = 0x000a1b2c;

/*
  The engine, as the fork answers it. getNeighborsByPosition takes a
  descriptor string and a position and throws on anything else
  (NapiHelper::ExtractString), and hands back an array made at its full
  length and then appended to, so the ids come after as many empty slots.
*/
function engine(opt) {
  opt = opt || {};
  const ids = {};
  ids[KEY_DESC] = 0x0a015494; ids[MOLD_DESC] = 0x0a015495;
  ids[DEED_DESC] = 0x0a015493; ids[RECIPE_DESC] = 0x0a015496;
  const descs = {};
  descs[DOOR] = DOOR_DESC; descs[INSIDE_DOOR] = INSIDE_DESC;
  descs[DUNGEON_DOOR] = '2c000:Skyrim.esm';
  const E = {
    packs: {}, cell: {}, pos: {}, pid: {},
    online: [],
    recipe: opt.recipe !== false,
    asked: []
  };
  function place(id, cell, pos) { E.cell[id] = cell; E.pos[id] = pos; }
  place(DOOR, TAMRIEL, [1000, 1000, 0]);
  place(INSIDE_DOOR, HOUSE_CELL, [0, 0, 0]);
  place(DUNGEON_DOOR, TAMRIEL, [1100, 1000, 0]);
  E.place = place;
  E.person = function (p, cell, pos, pack) {
    place(p.actor, cell, pos);
    E.pid[p.actor] = p.pid;
    E.packs[p.actor] = pack || [];
    if (E.online.indexOf(p.actor) === -1) { E.online.push(p.actor); }
  };
  E.offline = function (p) { E.online = E.online.filter(function (a) { return a !== p.actor; }); };
  E.blank = function () { return { baseId: ids[MOLD_DESC], count: 1 }; };
  E.stamped = function (label) { return { baseId: ids[MOLD_DESC], count: 1, name: label }; };
  E.deed = function (label) { return { baseId: ids[DEED_DESC], count: 1, name: label }; };
  E.blanks = function (p) {
    return (E.packs[p.actor || p] || []).reduce(function (n, e) {
      return n + (e.baseId === ids[MOLD_DESC] && !e.name ? e.count : 0);
    }, 0);
  };
  E.molds = function (p, label) {
    return (E.packs[p.actor || p] || []).filter(function (e) {
      return e.baseId === ids[MOLD_DESC] && e.name === label;
    }).length;
  };
  E.mp = {
    getIdFromDesc: function (d) {
      if (!Object.prototype.hasOwnProperty.call(ids, d)) { throw new Error('no such file'); }
      return ids[d];
    },
    getDescFromId: function (id) {
      E.asked.push(id);
      if (!Object.prototype.hasOwnProperty.call(descs, id)) { throw new Error('Form not found'); }
      return descs[id];
    },
    lookupEspmRecordById: function (id) {
      return (E.recipe && id === ids[RECIPE_DESC]) ? { record: { id: id } } : { record: null };
    },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return E.online.slice(); }
      if (key === 'inventory') {
        if (!E.packs[id]) { throw new Error('no inventory'); }
        return { entries: E.packs[id].map(function (e) { return Object.assign({}, e); }) };
      }
      if (key === 'worldOrCellDesc') {
        if (!E.cell[id]) { throw new Error('Form not found'); }
        return E.cell[id];
      }
      if (key === 'pos') {
        if (!E.pos[id]) { throw new Error('Form not found'); }
        return E.pos[id].slice();
      }
      if (key === 'profileId') { return E.pid[id] || 0; }
      return null;
    },
    set: function (id, key, v) {
      if (key === 'inventory') { E.packs[id] = v.entries; }
    },
    getNeighborsByPosition: function (cellDesc, pos) {
      if (typeof cellDesc !== 'string') {
        throw new Error("Expected 'cellOrWorldDesc' to be string, but got '" + cellDesc + "'");
      }
      if (!Array.isArray(pos) || pos.length !== 3) { throw new Error("Expected 'pos' to be an array"); }
      const cx = Math.trunc(pos[0] / 4096), cy = Math.trunc(pos[1] / 4096);
      const found = [];
      Object.keys(E.cell).forEach(function (k) {
        const id = Number(k);
        if (E.cell[id] !== cellDesc) { return; }
        const x = Math.trunc(E.pos[id][0] / 4096), y = Math.trunc(E.pos[id][1] / 4096);
        if (Math.abs(x - cx) <= 1 && Math.abs(y - cy) <= 1) { found.push(id); }
      });
      const arr = new Array(found.length);
      found.forEach(function (id) { arr.push(id); });
      return arr;
    }
  };
  return E;
}

function boot(E, claims, smiths) {
  const body = [
    'var KEY = ' + JSON.stringify(KEY_DESC) + ';',
    'var MOLD = ' + JSON.stringify(MOLD_DESC) + ';',
    'var DEED = ' + JSON.stringify(DEED_DESC) + ';',
    'var BLANK_MOLD_RECIPE = ' + JSON.stringify(RECIPE_DESC) + ';',
    'var blankMoldsKnown = false;',
    'var MOLD_REACH = ' + REACH + ';',
    'var BUILDING_BY_DOOR = {}; BUILDING_BY_DOOR[' + JSON.stringify(DOOR_DESC) + '] = ' + JSON.stringify(HOUSE) + ';',
    'BUILDING_BY_DOOR[' + JSON.stringify(INSIDE_DESC) + '] = ' + JSON.stringify(HOUSE) + ';',
    'var BUILDING_NAME = {}; BUILDING_NAME[' + JSON.stringify(HOUSE) + '] = "Breezehome";',
    // A house the hold table does not name, so its labels are its name alone (#3899).
    'var BUILDING_HOLD = {}; var HOLD_TOWN = {}; var LABEL_NO = {};',
    'function lapseDays() { return 14; }',
    'function save() {}',
    'function pushAll() {}',
    'function plog() {}',
    'function here() { return ' + JSON.stringify(HOUSE) + '; }',
    'function isSmith(actorId) { return smiths.indexOf(actorId) !== -1; }'
  ];
  for (const k in PIECES_GM) { body.push(PIECES_GM[k]); }
  body.push('return { moldHere: moldHere, mold: mold };');
  const api = new Function('mp', 'claims', 'smiths', body.join('\n'))(E.mp, claims, smiths || []);
  api.say = function (p, word, arg) {
    const told = {};
    const to = function (pid, m) { (told[pid] = told[pid] || []).push(m); };
    const parts = [word].concat(arg === undefined ? [] : [arg]);
    if (word === '/moldhere') { api.moldHere(parts, p.actor, p.pid, to); }
    else { api.mold(p.actor, p.pid, to); }
    return told;
  };
  return api;
}

function held() {
  const c = {};
  c[HOUSE] = { by: ALICE.pid, name: ALICE.name, touched: Date.now(), locked: false };
  return c;
}
const LABEL = 'Key mold for Breezehome';
const DEED_LABEL = 'Deed to Breezehome';
const HEX = DOOR.toString(16);
function first(told, p) { return ((told[p.pid] || [])[0]) || ''; }

if (missingGm.length === 0 && KEY_DESC && MOLD_DESC && DEED_DESC && RECIPE_DESC && REACH > 0) {
  // S1: THE DONE-WHEN. Bob, with a blank, at Alice's door, Alice beside him.
  {
    const E = engine();
    E.person(ALICE, TAMRIEL, [1100, 1050, 0]);
    E.person(BOB, TAMRIEL, [1080, 1000, 0], [E.blank()]);
    const s = boot(E, held(), []);
    const told = s.say(BOB, '/moldhere', HEX);
    yes('S1 the blank comes out of Bob\'s pack', E.blanks(BOB) === 0);
    yes('S1 and a mold for the house goes into the holder\'s, not his', E.molds(ALICE, LABEL) === 1 &&
        E.molds(BOB, LABEL) === 0);
    yes('S1 Bob is told in a plain sentence: "' + first(told, BOB) + '"',
        /You press the blank into the lock of Breezehome/.test(first(told, BOB)));
    yes('S1 and so is Alice', /The mold for Breezehome is yours/.test(first(told, ALICE)));
    yes('S1 pressing is not a smith\'s work: nobody here is a smith and it worked',
        E.molds(ALICE, LABEL) === 1 && !/isSmith/.test(PIECES_GM.moldHere));
  }

  // S2: the holder presses it into her own lock, alone.
  {
    const E = engine();
    E.person(ALICE, TAMRIEL, [1050, 1000, 0], [E.blank(), E.blank()]);
    const s = boot(E, held());
    const told = s.say(ALICE, '/moldhere', HEX);
    yes('S2 the holder alone at her own door gets the mold in her own pack',
        E.molds(ALICE, LABEL) === 1 && E.blanks(ALICE) === 1);
    yes('S2 and is told it is in her pack', /in your pack/.test(first(told, ALICE)) &&
        (told[ALICE.pid] || []).length === 1);
  }

  // S3: too far from that door, which is the gate the client cannot open.
  {
    const E = engine();
    E.person(ALICE, TAMRIEL, [1000 + REACH + 1, 1000, 0], [E.blank()]);
    const s = boot(E, held());
    const told = s.say(ALICE, '/moldhere', HEX);
    yes('S3 one unit past reach is refused: "' + first(told, ALICE) + '"',
        /too far from the door of Breezehome/.test(first(told, ALICE)));
    yes('S3 and nothing is spent or made', E.blanks(ALICE) === 1 && E.molds(ALICE, LABEL) === 0);
    E.place(ALICE.actor, TAMRIEL, [1000 + REACH - 1, 1000, 0]);
    s.say(ALICE, '/moldhere', HEX);
    yes('S3 one unit inside reach is not', E.molds(ALICE, LABEL) === 1);
  }
  {
    const E = engine();
    E.person(ALICE, TAMRIEL, [1000, 1000, 0], [E.blank()]);
    const s = boot(E, held());
    const told = s.say(ALICE, '/moldhere', INSIDE_DOOR.toString(16));
    yes('S3 the inside half of the door, named from outside, is another cell and refused',
        /too far/.test(first(told, ALICE)) && E.blanks(ALICE) === 1);
    E.place(ALICE.actor, TAMRIEL, [1000, 1000, 5000]);
    const told2 = s.say(ALICE, '/moldhere', HEX);
    yes('S3 and height counts: a door straight below by five thousand units is too far',
        /too far/.test(first(told2, ALICE)) && E.blanks(ALICE) === 1);
  }

  // S4: a door that is no building, and ids that are no id.
  {
    const E = engine();
    E.person(ALICE, TAMRIEL, [1050, 1000, 0], [E.blank()]);
    const s = boot(E, held());
    const t1 = s.say(ALICE, '/moldhere', DUNGEON_DOOR.toString(16));
    yes('S4 a door no building owns is refused: "' + first(t1, ALICE) + '"',
        /does not belong to a building/.test(first(t1, ALICE)));
    const t2 = s.say(ALICE, '/moldhere', 'zz');
    const t3 = s.say(ALICE, '/moldhere');
    const t4 = s.say(ALICE, '/moldhere', HEX + 'junk');
    const t5 = s.say(ALICE, '/moldhere', '123456789');
    yes('S4 junk, nothing, a number with a tail and nine digits are all refused the same way',
        [t2, t3, t4, t5].every(function (t) { return /does not belong to a building/.test(first(t, ALICE)); }));
    yes('S4 and junk never reaches the engine at all', E.asked.length === 1);
    yes('S4 and nothing is spent', E.blanks(ALICE) === 1);
  }

  // S5: the old plugin, where no blank can exist.
  {
    const E = engine({ recipe: false });
    E.person(ALICE, TAMRIEL, [1050, 1000, 0], [E.blank()]);
    const s = boot(E, held());
    const told = s.say(ALICE, '/moldhere', HEX);
    // And names nothing to type: no chat commands for what people do (#1637).
    yes('S5 with no blank mold recipe on the server it says so, with nothing to type: "' +
        first(told, ALICE) + '"', /no blank key molds/.test(first(told, ALICE)) &&
        !/\/\w/.test(first(told, ALICE)));
    yes('S5 and makes nothing', E.molds(ALICE, LABEL) === 0);
  }

  // S6: no blank, only a stamped mold for somewhere else.
  {
    const E = engine();
    E.person(ALICE, TAMRIEL, [1050, 1000, 0], [E.stamped('Key mold for Honeyside')]);
    const s = boot(E, held());
    const told = s.say(ALICE, '/moldhere', HEX);
    yes('S6 a stamped mold is not a blank: "' + first(told, ALICE) + '"',
        /carrying no blank key mold/.test(first(told, ALICE)));
    yes('S6 and the stamped one is untouched', E.molds(ALICE, 'Key mold for Honeyside') === 1 &&
        E.molds(ALICE, LABEL) === 0);
  }

  // S7: nobody holds it.
  {
    const E = engine();
    E.person(BOB, TAMRIEL, [1050, 1000, 0], [E.blank()]);
    const s = boot(E, {});
    const told = s.say(BOB, '/moldhere', HEX);
    yes('S7 a house nobody holds has no lock to take: "' + first(told, BOB) + '"',
        /Nobody holds Breezehome/.test(first(told, BOB)));
    yes('S7 and the blank stays', E.blanks(BOB) === 1);
  }

  // S8: the holder is not there. Patrick's own rule for molds.
  {
    const E = engine();
    E.person(ALICE, HOUSE_CELL, [0, 0, 0]);                   // inside, another cell
    E.person(BOB, TAMRIEL, [1050, 1000, 0], [E.blank()]);
    const s = boot(E, held());
    const told = s.say(BOB, '/moldhere', HEX);
    yes('S8 the holder in another cell is not standing there: "' + first(told, BOB) + '"',
        /has to be here/.test(first(told, BOB)));
    yes('S8 and the blank stays with Bob', E.blanks(BOB) === 1 && E.molds(ALICE, LABEL) === 0);

    E.place(ALICE.actor, TAMRIEL, [1100, 1000, 0]);
    E.offline(ALICE);
    const told2 = s.say(BOB, '/moldhere', HEX);
    yes('S8 and a holder who is offline where she stood does not count either',
        /has to be here/.test(first(told2, BOB)) && E.blanks(BOB) === 1);
  }

  // S9: a chest with the deed in it is not a householder.
  {
    const E = engine();
    E.place(CHEST, TAMRIEL, [1060, 1000, 0]);
    E.packs[CHEST] = [E.deed(DEED_LABEL)];
    E.person(BOB, TAMRIEL, [1050, 1000, 0], [E.blank()]);
    const s = boot(E, held());
    const told = s.say(BOB, '/moldhere', HEX);
    yes('S9 a chest holding the deed beside the door does not stand in for the holder',
        /has to be here/.test(first(told, BOB)) && E.molds(CHEST, LABEL) === 0 && E.blanks(BOB) === 1);
  }

  // S10: there is already a mold, in either pack.
  {
    const E = engine();
    E.person(ALICE, TAMRIEL, [1100, 1000, 0], [E.stamped(LABEL)]);
    E.person(BOB, TAMRIEL, [1050, 1000, 0], [E.blank()]);
    const s = boot(E, held());
    const told = s.say(BOB, '/moldhere', HEX);
    yes('S10 a mold already in the holder\'s pack is refused: "' + first(told, BOB) + '"',
        /already a mold for Breezehome/.test(first(told, BOB)));
    yes('S10 and the blank is not spent on a second one', E.blanks(BOB) === 1 && E.molds(ALICE, LABEL) === 1);
  }
  {
    const E = engine();
    E.person(ALICE, TAMRIEL, [1100, 1000, 0]);
    E.person(BOB, TAMRIEL, [1050, 1000, 0], [E.blank(), E.stamped(LABEL)]);
    const s = boot(E, held());
    const told = s.say(BOB, '/moldhere', HEX);
    yes('S10 and one already in the presser\'s pack is refused too',
        /already a mold/.test(first(told, BOB)) && E.blanks(BOB) === 1 && E.molds(ALICE, LABEL) === 0);
  }

  // S11: a blank beside a stamped mold: only the blank is spent.
  {
    const E = engine();
    E.person(ALICE, TAMRIEL, [1050, 1000, 0],
             [E.stamped('Key mold for Honeyside'), { baseId: E.mp.getIdFromDesc(MOLD_DESC), count: 3 }]);
    const s = boot(E, held());
    s.say(ALICE, '/moldhere', HEX);
    yes('S11 one blank of three is spent and the Honeyside mold is untouched',
        E.blanks(ALICE) === 2 && E.molds(ALICE, 'Key mold for Honeyside') === 1 &&
        E.molds(ALICE, LABEL) === 1);
  }

  // S12: the typed /mold. A smith, the holder beside him. Until this change
  // the engine was asked with a bare id, threw, and the holder never counted.
  {
    const E = engine();
    E.person(ALICE, TAMRIEL, [1100, 1000, 0]);
    E.person(CARL, TAMRIEL, [1050, 1000, 0], [E.blank()]);
    const s = boot(E, held(), [CARL.actor]);
    const told = s.say(CARL, '/mold');
    yes('S12 /mold by a smith with the holder standing beside him works now: "' +
        first(told, CARL) + '"', /You cut a mold for Breezehome/.test(first(told, CARL)));
    yes('S12 and the mold is the holder\'s', E.molds(ALICE, LABEL) === 1 && E.blanks(CARL) === 0);
    const told2 = s.say(BOB, '/mold');
    yes('S12 and /mold is still a smith\'s word', /a smith's work/.test(first(told2, BOB)));
  }

  // S13 (#529): a stolen deed beside the real holder. Dirk comes first in the
  // engine's list; the mold still goes to Alice.
  {
    const E = engine();
    E.person(DIRK, TAMRIEL, [1090, 1000, 0], [E.deed(DEED_LABEL)]);
    E.person(ALICE, TAMRIEL, [1100, 1050, 0]);
    E.person(BOB, TAMRIEL, [1080, 1000, 0], [E.blank()]);
    const s = boot(E, held());
    s.say(BOB, '/moldhere', HEX);
    yes('S13 with the holder there, the mold is hers and not the deed carrier\'s',
        E.molds(ALICE, LABEL) === 1 && E.molds(DIRK, LABEL) === 0 && E.blanks(BOB) === 0);
  }
  {
    const E = engine();
    E.person(DIRK, TAMRIEL, [1090, 1000, 0], [E.deed(DEED_LABEL)]);
    E.person(BOB, TAMRIEL, [1080, 1000, 0], [E.blank()]);
    const c = held(); c[HOUSE].by = BOB.pid;
    const s = boot(E, c);
    s.say(BOB, '/moldhere', HEX);
    yes('S13 and when the holder is the one pressing, a deed beside him does not take it',
        E.molds(BOB, LABEL) === 1 && E.molds(DIRK, LABEL) === 0);
  }

  // S14 (#529): no holder there, two deed carriers: the one pressing first.
  {
    const E = engine();
    E.person(DIRK, TAMRIEL, [1090, 1000, 0], [E.deed(DEED_LABEL)]);
    E.person(BOB, TAMRIEL, [1080, 1000, 0], [E.blank(), E.deed(DEED_LABEL)]);
    const s = boot(E, held());
    s.say(BOB, '/moldhere', HEX);
    yes('S14 with no holder there, the deed carrier pressing is asked before one nearby',
        E.molds(BOB, LABEL) === 1 && E.molds(DIRK, LABEL) === 0);
  }
}

// ============================================================ the routing
{
  const code = gm;
  yes('the property block answers /moldhere with moldHere',
      /if \(word === '\/moldhere'\) \{ return moldHere\(parts, actorId, profileId, toProfile\); \}/.test(code));
  const a = code.indexOf("    if (word === '/plant' || word === '/claim' || word === '/plot' ||");
  const b = a < 0 ? -1 : code.indexOf(') {', a);
  const cond = (a >= 0 && b > a) ? code.slice(a, b) : '';
  yes('and the chat hands /moldhere on to the property block, with a character to act as',
      cond.indexOf("'/moldhere'") !== -1);
  function list(name) {
    const i = code.indexOf('const ' + name + ' = [');
    const j = i < 0 ? -1 : code.indexOf('];', i);
    if (j < 0) { return []; }
    try { return new Function('return ' + code.slice(code.indexOf('[', i), j + 1) + ';')(); }
    catch (e) { return []; }
  }
  const WORDS = list('WORDS');
  const PLAYER_WORDS = list('PLAYER_WORDS');
  yes('/moldhere is a word the server answers, so it is never "unknown command"',
      WORDS.indexOf('/moldhere') !== -1);
  yes('and it is not in /help: the plugin sends it, nobody types it',
      PLAYER_WORDS.length > 5 && PLAYER_WORDS.indexOf('/moldhere') === -1);
}

Date.now = realNow;
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
