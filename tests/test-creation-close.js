// test-creation-close.js
//
// While a character is being made there is always a way to close Skyrim, and
// it always asks twice.
//
// Patrick, 24 September: "the k not now button during creatioon doesnt close
// skyrim it exists the menu and lets the roam the room also there is no button
// to close skyrim still while doing the actiual chacrther making and desing
// stuff before naming yourself".
//
// TWO PLACES, AND BOTH ARE RUN HERE.
//
// THE K PANEL, in the hall. drawFoot, closeByHand, closeWord and closeButton
// and the Close button's own onclick are lifted out of thornswood-skills.js
// and run with the button, its label and its K key cap as stand-ins, under a
// pretend clock and pretend timers. While creating the button reads Close
// Skyrim, a first press arms it, a second inside five seconds sends
// 'skills:quit', and a first press left alone disarms. Outside creation it is
// Close and only puts the panel down, as before.
//
// THE FRONT PLUGIN. The close key block, closeGame, the race menu watcher and
// the whole browserMessage handler are lifted out of thornswood-front.js and
// run against a pretend game: menus that open and shut, SkyrimPlatform's texts
// and their visibility, and an engine that counts the times it was asked to
// exit. The panel's 'skills:quit' goes through the real handler into the real
// quit. With the RaceSex Menu open the key pressed twice inside five seconds
// quits and once does not; with the menu shut it does nothing; and the line
// saying so is up exactly while the menu is.
//
// AND THE KEY: F10 by default, CloseGameKey in Thornswood.ini, and not a number
// anything else of ours, RaceMenu's or Skyrim's answers to.
//
// Run it against the code before the change with SKILLS=<that page> and
// FRONT=<that plugin>: the panel reads Not now and a press only puts it down,
// and the plugin has no key, no line and no 'skills:quit', so those fail.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);
const read = function (p) { return fs.readFileSync(p, 'utf8').split(CR).join(''); };

const SKILLS_PATH = process.env.SKILLS || path.join(REPO_DIR, 'game', 'ui', 'thornswood-skills.js');
const FRONT_PATH = process.env.FRONT || path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js');
const INI_PATH = process.env.INI || path.join(REPO_DIR, 'launcher', 'Thornswood.ini');
const page = read(SKILLS_PATH);
const front = read(FRONT_PATH);
const ini = read(INI_PATH);
const gm = read(path.join(REPO_DIR, 'game', 'gamemode.js'));

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
/* From one line to the end of the handler that opens at another. */
function liftSpan(src, first, lastOpen) {
  const a = src.indexOf(first);
  if (a < 0) { return null; }
  const c = src.indexOf(lastOpen, a);
  if (c < 0) { return null; }
  const SHUT = '\n  }));\n';
  const b = src.indexOf(SHUT, c);
  return b < 0 ? null : src.slice(a, b + SHUT.length);
}
/* From one line to the end of the function whose first line comes later. */
function liftTo(src, first, fnFirst) {
  const a = src.indexOf(first);
  if (a < 0) { return null; }
  const c = src.indexOf('\n  ' + fnFirst, a);
  if (c < 0) { return null; }
  const b = src.indexOf('\n  }\n', c);
  return b < 0 ? null : src.slice(a, b + 5);
}
/* One whole line that starts with the given text, if it is there once. */
function liftLine(src, first) {
  const from = '\n  ' + first;
  const a = src.indexOf(from);
  if (a < 0 || src.indexOf(from, a + 1) >= 0) { return null; }
  const b = src.indexOf('\n', a + 1);
  return src.slice(a + 1, b + 1);
}

/* A clock that only moves when told to, and the timers that go with it. */
function makeClock() {
  const c = { now: 1000000, timers: [] };
  c.Date = { now: function () { return c.now; } };
  c.setTimeout = function (fn, ms) { c.timers.push({ at: c.now + (Number(ms) || 0), fn: fn }); return c.timers.length; };
  c.advance = function (ms) {
    const until = c.now + ms;
    for (;;) {
      let next = null;
      c.timers.forEach(function (t) { if (!t.done && t.at <= until && (!next || t.at < next.at)) { next = t; } });
      if (!next) { break; }
      next.done = true;
      c.now = next.at;
      next.fn();
    }
    c.now = until;
  };
  return c;
}

// ================================================================ the K panel
const P = {
  drawFoot: liftFrom(page, 'function drawFoot() {', '  '),
  closeByHand: liftFrom(page, 'function closeByHand() {', '  '),
  closeWord: liftFrom(page, 'function closeWord() {', '  '),
  quit: liftTo(page, '  var QUIT_ARM_MS = ', 'function closeButton() {'),
  onclick: liftLine(page, 'elClose.onclick = ')
};
yes('the panel draws its buttons in drawFoot', !!P.drawFoot);
yes('the panel still puts itself down by hand in closeByHand', !!P.closeByHand);
yes('the Close button has an onclick', !!P.onclick);
yes('the panel says what its Close button does, in closeWord', !!P.closeWord);
yes('and presses it in closeButton, which asks twice', !!P.quit && P.quit.indexOf('function closeButton()') >= 0);

function el() {
  const e = { textContent: '', className: '', style: { display: '' } };
  return e;
}

function panelRig(creatingNow) {
  const clock = makeClock();
  const w = { told: [], closed: 0, clock: clock, mine: { creating: !!creatingNow } };
  w.elClose = el(); w.elClose.className = 'tsbtn ghost';
  w.elCloseLabel = el(); w.elCloseLabel.textContent = 'Close';
  w.elCloseKey = el();
  // Help and Settings beside Close (#1633, #3126), not there while creating.
  w.elHelp = el();
  // Change character beside it (#3128), not there while creating either.
  w.elSwitch = el();
  w.elSettings = el();
  const api = { close: function () { w.closed++; } };
  const prelude =
    "var section = 'review', status = '', statusKind = '', footKey = '';\n" +
    // SkillsKey's name, which the Close button's key cap shows (#1919).
    "var keyName = 'K';\n" +
    'function creating() { return !!mine.creating; }\n' +
    'function canConfirm() { return false; }\n' +
    "function hint() { return ''; }\n";
  // P.quit carries closeWord and closeButton with the numbers they share.
  const body = prelude +
    (P.quit || '') + '\n' +
    P.drawFoot + '\n' + P.closeByHand + '\n' + P.onclick + '\n' +
    'return { drawFoot: drawFoot, closeByHand: closeByHand };';
  const made = new Function('Date', 'setTimeout', 'tell', 'api', 'mine',
                            'elClose', 'elCloseLabel', 'elCloseKey', 'elStatus', 'elConfirm', 'elHelp', 'elSwitch', 'elSettings', body)(
    clock.Date, clock.setTimeout,
    function (what, extra) { w.told.push(what + (extra ? ' ' + extra : '')); },
    api, w.mine, w.elClose, w.elCloseLabel, w.elCloseKey, el(), el(), w.elHelp, w.elSwitch, w.elSettings);
  w.draw = made.drawFoot;
  w.hand = made.closeByHand;
  w.press = function () { w.elClose.onclick(); };
  w.label = function () { return w.elCloseLabel.textContent; };
  w.quits = function () { return w.told.filter(function (t) { return t === 'quit'; }).length; };
  w.draw();
  return w;
}

let panelQuits = [];   // every 'quit' the panel sent, for the front below
if (P.drawFoot && P.closeByHand && P.onclick) {
  // While creating: the button says what it does, and K is not on it.
  {
    const w = panelRig(true);
    yes('K1 while creating the button reads Close Skyrim', w.label() === 'Close Skyrim');
    yes('K1 and the K key cap is not shown beside it, because K never closes the game',
        w.elCloseKey.style.display === 'none');
    yes('K1 nor Help (#1633) nor Settings (#3126): while creating this panel is the whole of what there is to do',
        w.elHelp.style.display === 'none' && w.elSettings.style.display === 'none');
    yes('K1 nor Change character (#3128)', w.elSwitch.style.display === 'none');
  }
  // One press arms it, and nothing is sent.
  {
    const w = panelRig(true);
    w.press();
    yes('K2 one press says Press again to close Skyrim', w.label() === 'Press again to close Skyrim');
    yes('K2 and turns the button to its warning colours', / danger/.test(w.elClose.className));
    yes('K2 and sends nothing: no quit, no Not now, the panel stays up',
        w.quits() === 0 && w.told.length === 0 && w.closed === 0);
    w.clock.advance(5000);
    yes('K3 THE STRAY CLICK: five seconds later it is Close Skyrim again, and nothing was sent',
        w.label() === 'Close Skyrim' && w.quits() === 0 && !/ danger/.test(w.elClose.className));
    w.press();
    yes('K3 and a press after that only arms it again', w.label() === 'Press again to close Skyrim' && w.quits() === 0);
  }
  // Two presses inside five seconds send the quit, once.
  {
    const w = panelRig(true);
    w.press();
    w.clock.advance(4900);
    w.press();
    yes('K4 THE BUG: two presses inside five seconds send the quit', w.quits() === 1);
    yes('K4 and nothing else: no Not now to the server, the panel is not put down',
        w.told.length === 1 && w.closed === 0);
    yes('K4 the button says it is closing', w.label() === 'Closing Skyrim');
    w.press(); w.press();
    yes('K4 more presses while it closes send nothing more', w.quits() === 1);
    panelQuits = w.told.slice();
    w.clock.advance(6000);
    yes('K5 a game still here six seconds on puts the button back', w.label() === 'Close Skyrim');
    yes('K5 and tells the front so', w.told.indexOf('quit did not take, the game is still here') >= 0);
  }
  // The five seconds are a limit, not a delay.
  {
    const w = panelRig(true);
    w.press();
    w.clock.advance(5000);
    w.press();
    yes('K6 a second press at five seconds is a first press again, not a quit', w.quits() === 0);
  }
  // Outside creation it is Close, as it always was.
  {
    const w = panelRig(false);
    yes('K7 in the world the button reads Close', w.label() === 'Close');
    yes('K7 with the K key cap beside it', w.elCloseKey.style.display === '');
    yes('K7 and Help beside it, which opens the help panel (#1633)', w.elHelp.style.display === '');
    yes('K7 and Change character (#3128)', w.elSwitch.style.display === '');
    w.press();
    yes('K7 a press puts the panel down', w.closed === 1);
    w.press();
    yes('K7 and two presses never send a quit or anything else', w.quits() === 0 && w.told.length === 0);
  }
  // Escape and K put the panel down while creating, as Djinn asked, and never
  // close the game.
  {
    yes('K8 Escape still puts the panel down by hand',
        /e\.key === 'Escape'\) \{ closeByHand\(\);/.test(page));
    yes('K8 and K still toggles it by hand',
        /toggle: function \(\) \{\s*if \(root\.className === 'gone'\) \{ api\.open\(\); \} else \{ closeByHand\(\); \}/.test(page));
    const w = panelRig(true);
    w.hand();
    yes('K8 which puts the panel down and holds the reminder off, and closes no game',
        w.closed === 1 && w.told.join('|') === 'pick later' && w.quits() === 0);
  }
}

/*
  NO '/pick later' BEFORE THE QUIT, and this is why that is safe: the gamemode
  starts the reminder again from nothing when the character comes back, so a
  session that is ending has nothing to hold off.
*/
yes('the gamemode starts the creation reminder again on every new session',
    /if \(state\.seenAt !== cameOnC\) \{\s*state\.seenAt = cameOnC;\s*state\.remindAt = now;/.test(gm));

// ============================================================== the front
const F = {
  iniNumber: liftFrom(front, 'function iniNumber(text, key, fallback) {', '  '),
  keyName: liftFrom(front, 'function keyName(code) {', '  '),
  raceMenuOpen: liftFrom(front, 'function raceMenuOpen() {', '  '),
  race: liftSpan(front, '  let raceWasOpen = false;', "guard('race', () => {"),
  closeKey: liftSpan(front, '  let closingGame = false;', "guard('close key', (e) => {"),
  closeGame: liftFrom(front, 'function closeGame(from) {', '  '),
  creatingFrom: liftTo(front, '  let skillsCreating = false;', 'function skillsCreatingFrom(json) {'),
  messages: liftSpan(front, "  sp.on('browserMessage', guard('browserMessage', (event) => {",
                     "guard('browserMessage', (event) => {")
};
yes('the plugin reads keys out of Thornswood.ini with iniNumber', !!F.iniNumber);
yes('the plugin asks whether the RaceSex Menu is open', !!F.raceMenuOpen);
yes('the plugin tells the server when the race menu closes', !!F.race);
yes('the plugin hears the pages in one browserMessage handler', !!F.messages);
yes('the plugin has a close key for the RaceSex Menu, and its line', !!F.closeKey);
yes('the plugin ends the game in one closeGame', !!F.closeGame);
yes('the plugin keeps the server\'s last word on whether this character is being created', !!F.creatingFrom);

const RACE = 'RaceSex Menu';

function frontRig(opts) {
  opts = opts || {};
  const clock = makeClock();
  const w = { open: {}, texts: {}, textCount: 0, vis: 'inheritBrowser', exits: 0, quitGames: 0,
              js: [], logs: [], server: [], threw: [], handlers: {}, clock: clock };
  const sp = {
    on: function (ev, fn) { (w.handlers[ev] = w.handlers[ev] || []).push(fn); },
    Ui: { isMenuOpen: function (n) { return !!w.open[n]; } },
    Utility: { getINIInt: function (k) { return k === 'iSize W:Display' ? 2560 : (k === 'iSize H:Display' ? 1440 : 0); } },
    createText: function (x, y, s, c) { const id = ++w.textCount; w.texts[id] = { x: x, y: y, s: s, c: c, size: 1 }; return id; },
    setTextString: function (id, s) { if (!w.texts[id]) { throw new Error('no text ' + id); } w.texts[id].s = s; },
    getTextString: function (id) { if (!w.texts[id]) { throw new Error('no text ' + id); } return w.texts[id].s; },
    destroyText: function (id) { delete w.texts[id]; },
    setTextSize: function (id, n) { if (w.texts[id]) { w.texts[id].size = n; } },
    setTextsVisibility: function (v) { w.vis = v; },
    getTextsVisibility: function () { return w.vis; },
    browser: { setFocused: function () { }, setVisible: function () { } },
    win32: { exitProcess: function () { w.exits++; } },
    Debug: { quitGame: function () { w.quitGames++; } }
  };
  const T = { js: function (s) { w.js.push(s); return true; }, claimFocus: function () { } };
  const guard = function (name, fn) {
    return function () {
      try { return fn.apply(null, arguments); }
      catch (err) { w.threw.push(name + ': ' + err); return undefined; }
    };
  };
  const body =
    F.iniNumber + '\n' + (F.keyName || 'function keyName(c) { return "#" + c; }\n') + '\n' +
    F.raceMenuOpen + '\n' +
    // The code before the change has none of these; the race watcher there
    // does not read closingGame, so it is only declared when the block is.
    (F.closeKey || '') + '\n' + (F.closeGame || '') + '\n' + (F.creatingFrom || '') + '\n' +
    F.race + '\n' + F.messages + '\n';
  new Function('sp', 'T', 'Date', 'ini', 'log', 'say', 'guard', 'tellServer', 'treeFromView', 'treeFromMap',
               'maneuversFromView', 'perksFromView', 'overheadMessage', body)(
    sp, T, clock.Date, opts.ini === undefined ? '' : opts.ini,
    function () { w.logs.push(Array.prototype.slice.call(arguments).join(' ')); },
    function (t) { w.logs.push(String(t)); },
    guard,
    function (line) { w.server.push(line); },
    function () { }, function () { }, function () { }, function () { },
    // The words above heads, asked first by the handler (#3941); none of
    // these messages is one, and test-3941-chat-not-logged.js runs it.
    function () { return false; });
  w.update = function () { (w.handlers.update || []).forEach(function (f) { f(); }); };
  w.frames = function (ms) {
    // Updates every 50ms of pretend time, the way a slow frame rate would.
    for (let t = 0; t < ms; t += 50) { clock.advance(50); w.update(); }
  };
  w.press = function (code) {
    (w.handlers.buttonEvent || []).forEach(function (f) { f({ code: code, isDown: true, isUp: false }); });
    (w.handlers.buttonEvent || []).forEach(function (f) { f({ code: code, isDown: false, isUp: true }); });
  };
  w.page = function (what) {
    (w.handlers.browserMessage || []).forEach(function (f) { f({ arguments: ['thornswood-front', what] }); });
  };
  w.lines = function () {
    return Object.keys(w.texts).map(function (k) { return w.texts[k]; });
  };
  // What a person can actually see: a text exists, and the texts are drawn,
  // which with the browser hidden over the menu means switched 'on'.
  w.shown = function () { return w.vis === 'on' ? w.lines().map(function (t) { return t.s; }) : []; };
  return w;
}

const F10 = 68;

if (F.iniNumber && F.raceMenuOpen && F.race && F.messages) {
  // The K panel's quit, through the real handler into the real exit.
  {
    const w = frontRig();
    w.page('skills:view ' + JSON.stringify({ panel: { creating: true, towns: [] } }));
    const sent = panelQuits.length ? panelQuits : ['quit'];
    sent.forEach(function (t) { w.page('skills:' + t); });
    yes('F1 the K panel\'s two presses, while creating, close Skyrim', w.exits === 1);
    yes('F1 through the same quit the character page uses: the browser put down first',
        w.js.some(function (s) { return s.indexOf('#ts-select video') >= 0; }));
    yes('F1 nothing threw', w.threw.length === 0);
  }
  {
    const w = frontRig();
    w.page('skills:view ' + JSON.stringify({ panel: { creating: false } }));
    w.page('skills:quit');
    yes('F2 a quit from the panel when the server says creation is over closes nothing', w.exits === 0 && w.quitGames === 0);
    const v = frontRig();
    v.page('skills:quit');
    yes('F2 and neither does one before the server has said anything', v.exits === 0 && v.quitGames === 0);
    const u = frontRig();
    u.page('skills:view ' + JSON.stringify({ panel: { creating: true } }));
    u.page('skills:view ' + JSON.stringify({ panel: { creating: false } }));
    u.page('skills:quit');
    yes('F2 nor one after the home was chosen and creation ended', u.exits === 0);
    u.page('skills:quit did not take, the game is still here');
    yes('F2 the panel saying the quit did not take is only written down', u.exits === 0 && u.threw.length === 0);
  }
  {
    const w = frontRig();
    w.page('select:quit');
    yes('F3 the character page\'s Close the game still closes the game', w.exits === 1);
  }

  // The close key in the RaceSex Menu.
  {
    const w = frontRig();
    w.frames(400);
    yes('R1 in the world there is no line', w.lines().length === 0 && w.vis === 'inheritBrowser');
    w.press(F10); w.press(F10);
    yes('R1 THE WORLD: F10 twice with the RaceSex Menu shut does nothing', w.exits === 0 && w.quitGames === 0);
    yes('R1 and puts no line up', w.lines().length === 0);

    w.open[RACE] = true;
    w.frames(400);
    const seen = w.shown();
    yes('R2 with the RaceSex Menu open one line is shown: "' + seen.join(' | ') + '"',
        seen.length === 1 && seen[0] === 'F10 twice closes Skyrim');
    const line = w.lines()[0] || {};
    yes('R2 at the top of the screen, in the middle', line.x === 1280 && line.y > 0 && line.y < 1440 / 5);

    w.press(F10);
    yes('R3 one press does not close the game', w.exits === 0);
    yes('R3 and the line says to press it again', w.shown()[0] === 'Press F10 again to close Skyrim');
    // The line is looked at five times a second, so it is back within a
    // fifth of a second of the five; the press itself is timed exactly.
    w.frames(5200);
    yes('R3 five seconds on it has not closed and the line is as it was',
        w.exits === 0 && w.shown()[0] === 'F10 twice closes Skyrim');
    w.press(F10);
    w.frames(1000);
    yes('R3 a press after that is a first press again', w.exits === 0);

    w.press(F10);
    yes('R4 THE BUG: F10 twice inside five seconds with the RaceSex Menu open closes Skyrim',
        w.exits === 1);
    yes('R4 nothing threw', w.threw.length === 0);
  }
  {
    // The five seconds, to the millisecond, at the press.
    const w = frontRig();
    w.open[RACE] = true;
    w.frames(200);
    w.press(F10);
    w.clock.advance(4999);
    w.press(F10);
    yes('R4 a second press 4.999 seconds after the first closes it', w.exits === 1);
    const v = frontRig();
    v.open[RACE] = true;
    v.frames(200);
    v.press(F10);
    v.clock.advance(5000);
    v.press(F10);
    yes('R4 and one at 5 seconds does not: it is a first press again', v.exits === 0);
  }
  {
    const w = frontRig();
    w.open[RACE] = true;
    w.frames(200);
    w.press(F10);
    w.open[RACE] = false;
    w.frames(400);
    yes('R5 the line goes when the menu shuts', w.lines().length === 0);
    yes('R5 and the texts go back to following the browser', w.vis === 'inheritBrowser');
    yes('R5 and the menu shutting is told to the server as the face done, as before',
        w.server.indexOf('/face done') >= 0);
    w.press(F10);
    yes('R5 a press armed in the menu does not carry into the world', w.exits === 0);
    w.open[RACE] = true;
    w.frames(200);
    w.press(F10);
    yes('R5 nor into the next time the menu opens', w.exits === 0);
  }
  {
    // Somebody else's key, and the other keys of ours.
    const w = frontRig();
    w.open[RACE] = true;
    w.frames(200);
    [63, 67, 28, 15, 1, 57, 25, 36, 37].forEach(function (c) { w.press(c); w.press(c); });
    yes('R6 no other key closes the game from the menu', w.exits === 0);
  }
  {
    // The race menu shutting because the game is being closed is not a face.
    const w = frontRig();
    w.open[RACE] = true;
    w.frames(200);
    w.press(F10); w.press(F10);
    w.open[RACE] = false;
    w.frames(200);
    yes('R7 a race menu that shuts because the game is closing is not told to the server as a finished face',
        w.exits === 1 && w.server.indexOf('/face done') === -1);
    yes('R7 and the server is told the menu is down, so a still-connected player can be asked again',
        w.server.indexOf('/racedown') >= 0);
  }
  {
    // Every text cleared from under the line, and its id handed to somebody
    // else's name, the way destroyAllTexts would leave it.
    const w = frontRig();
    w.open[RACE] = true;
    w.frames(200);
    w.texts = {}; w.textCount = 0;
    const name = w.textCount + 1;
    w.texts[name] = { x: 10, y: 10, s: 'Fenwick', c: [1, 1, 1, 0.8], size: 0.5 }; w.textCount = name;
    w.frames(400);
    yes('R9 a line cleared from under it comes back, and somebody else\'s text is not written over',
        w.texts[name].s === 'Fenwick' && w.shown().indexOf('F10 twice closes Skyrim') >= 0);
    w.press(F10);
    yes('R9 and it still says to press again', w.shown().indexOf('Press F10 again to close Skyrim') >= 0 && w.texts[name].s === 'Fenwick');
    w.open[RACE] = false;
    w.frames(400);
    yes('R9 and when the menu shuts only our line goes, and the texts follow the browser again',
        !!w.texts[name] && w.lines().length === 1 && w.vis === 'inheritBrowser');
  }
  {
    // Rebound in Thornswood.ini.
    const w = frontRig({ ini: '[Creation]\nCloseGameKey = 65\n' });
    w.open[RACE] = true;
    w.frames(200);
    yes('R8 CloseGameKey in Thornswood.ini moves the key, and the line says which',
        w.shown()[0] === 'F7 twice closes Skyrim');
    w.press(F10); w.press(F10);
    yes('R8 and F10 is then nothing', w.exits === 0);
    w.press(65); w.press(65);
    yes('R8 and the new key works', w.exits === 1);
  }
}

// ================================================================== the key
const defM = /(?:const|let) CLOSE_GAME_KEY = iniNumber\(ini, 'CloseGameKey', (\d+)\);/.exec(front);
yes('the plugin reads CloseGameKey out of Thornswood.ini', !!defM);
const KEY = defM ? Number(defM[1]) : -1;
yes('and F10, scan code 68, is its default', KEY === F10);
const iniM = /^\s*CloseGameKey\s*=\s*(\d+)\s*$/m.exec(ini);
yes('the shipped Thornswood.ini carries CloseGameKey = 68', !!iniM && Number(iniM[1]) === F10);
{
  /*
    Everything else that already answers to a scan code, gathered from the
    files where they are ours, and measured on 24 September where they are
    not: RaceMenu's racesex_menu.swf and Skyrim's controlmap.txt from the game
    folder, which a build machine does not have.
  */
  const taken = {};
  function take(code, who) { (taken[code] = taken[code] || []).push(who); }
  let m;
  const rxFront = /iniNumber\(ini, '(\w+)', (\d+)\)/g;
  while ((m = rxFront.exec(front)) !== null) {
    if (m[1] !== 'CloseGameKey' && m[1] !== 'VoicePort') { take(Number(m[2]), 'front ' + m[1]); }
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
    if (['CloseGameKey', 'VoicePort', 'Microphone'].indexOf(m[1]) === -1) { take(Number(m[2]), 'ini ' + m[1]); }
  }
  // Every row on Settings in the game (#3126), ours and the mods', but the
  // close key's own.
  const settingsPage = read(path.join(REPO_DIR, 'game', 'ui', 'thornswood-settings.js'));
  let rows = 0;
  const rxOurs = /\{ ini: '(\w+)', def: (-?\d+),/g;
  while ((m = rxOurs.exec(settingsPage)) !== null) { rows++; if (m[1] !== 'CloseGameKey') { take(Number(m[2]), 'Settings ' + m[1]); } }
  const modsAt = front.indexOf('const MOD_KEYS = [');
  const modList = modsAt >= 0 ? front.slice(modsAt, front.indexOf('];', modsAt)) : '';
  const rxMods = /\['(\w+)', '\w+', '\w+', (-?\d+)\]/g;
  while ((m = rxMods.exec(modList)) !== null) { rows++; take(Number(m[2]), 'Settings ' + m[1]); }
  // The mod settings menu, a key by name: F4.
  if (/iniValue\(menu, 'ToggleKey'\) \|\| 'F4'/.test(front)) { take(62, 'Settings menu'); }
  // skymp5-client, compiled in: F1 names, F2 the overlay, F6 focus.
  [59, 60, 64].forEach(function (c) { take(c, 'skymp5-client'); });
  // Skyrim's controlmap.txt in play: Quicksave F5, Quickload F9, CameraPath
  // F12, Escape, Tab, the console and the letters and numbers it uses.
  [63, 67, 88, 1, 15, 41, 17, 30, 31, 32, 18, 19, 16, 44, 33, 20, 50, 23, 46, 45,
   36, 25, 24, 38, 57, 42, 56, 29, 58, 2, 3, 4, 5, 6, 7, 8, 9, 10].forEach(function (c) { take(c, 'Skyrim'); });
  // RaceMenu in the RaceSex Menu: its controls map to the keys above (F5 and
  // F9 for its presets), and by code Tab, Enter, Shift, Alt and Space.
  [63, 67, 15, 28, 42, 56, 57].forEach(function (c) { take(c, 'RaceMenu'); });
  yes('the other keys were found to compare against (' + Object.keys(taken).length +
      ' codes, ' + rows + ' Settings rows)', Object.keys(taken).length > 30 && rows >= 20);
  yes('and nothing else of ours, RaceMenu\'s or Skyrim\'s answers to the close key' +
      (taken[KEY] ? ' (' + taken[KEY].join(', ') + ')' : ''), KEY > 0 && !taken[KEY]);
  // The name is typed into a box on this same menu, so a letter would be
  // pressed by anybody called Fenwick.
  yes('and it is a function key, never a letter somebody types into the name box',
      [59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 87, 88].indexOf(KEY) >= 0);
}

// The social key guard (pull request 291) stays: the five keys over the
// RaceSex Menu are game\tests\test-social-keys.js, and it is not touched here.
yes('the social keys still wait out the RaceSex Menu',
    /if \(e\.code === FRIEND_KEY \|\| e\.code === TRADE_KEY \|\| e\.code === MUTE_KEY \|\|/.test(front) &&
    /const KEYBOARD_MENUS = \[[\s\S]*?'RaceSex Menu'/.test(front));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
