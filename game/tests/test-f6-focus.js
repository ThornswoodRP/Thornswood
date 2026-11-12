// test-f6-focus.js
//
// F6 gives a cursor and gives it back, and Enter still never leaves anybody
// stuck in the world.
//
// WHAT WAS WRONG. Entry 43 on the To Do List. Djinn, 22 September: "the
// cursor icon F6 button does not show/initiate the cursor to choose anything
// and is now stuck on this window and have to task out exit." A panel was on
// screen with no focus claim behind it, and F6 did nothing.
//
// skymp5-client binds F6 to toggle browser focus and Enter to raise it
// (browserService.ts in the fork). applyFocus in thornswood-front.js puts any
// focus nothing claimed straight back down, on the first frame, and that put
// down is what keeps an Enter pressed in the world from leaving somebody
// unable to move. The fix of 22 September (#124) meant to hold F6's focus,
// but only held a focus that had been up 1.2 seconds, and outside the race
// menu nothing ever lasted one frame, so F6 still did nothing. Inside the race
// menu it held the keyboard for two minutes behind a hidden page.
//
// THE PRETEND GAME BEHAVES THE WAY THE FORK DOES IN THE TWO THINGS THAT
// DECIDE THIS.
//
//   skymp5-client asks Input.isKeyPressed on every frame the number of keys
//   held changes (keyboardEventsService.ts), and then toggles focus on F6,
//   raises it on Enter and lowers it on Escape, refusing F6 and Enter while
//   one of its own menus is open (browserService.ts).
//
//   buttonEvent is the game's own input (EventHandler.cpp), and while focus
//   is up DInputHook.cpp hands the game an empty keyboard buffer, so it goes
//   quiet. The notes in this repo disagree about that, so every F6 check runs
//   in both worlds: 'quiet', the fork's reading, and 'loud', where
//   buttonEvent arrives whatever the focus. The fix must not depend on which
//   one is true. An F6 caught only in the key handler passes in the loud
//   world and leaves somebody with a cursor they cannot put down in the quiet
//   one.
//
// Both halves of a frame run in either order, skymp5-client's update first or
// this plugin's, because nothing fixes which goes first.
//
// Run against the text before the change (FRONT=<old file>), the F6 checks
// fail: the focus is down on the first frame.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const SRC = process.env.FRONT ||
            path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

/** The text from one marker up to, but not including, the next. */
function between(start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b);
}

// Everything from the claims to the claim timestamps: anyClaim, the menu
// questions, interrupted, applyFocus, and whatever holds an F6 focus.
const arbiter = between('  const claims = {};', '  /*\n    WHEN EACH CLAIM WENT UP');
// The top of the key handler, which is what buttonEvent reaches first.
const keys = between('    // Reachable only while focus is down', '    /*\n      The skills panel.');
const hideLine = /^      const hide = ([^;]+);/m.exec(src);

yes('the focus arbiter is in the plugin', arbiter !== null);
yes('the top of the key handler is in the plugin', keys !== null);
yes('the browser visibility line is in the plugin', hideLine !== null);
if (!arbiter || !keys || !hideLine) { done(); }

const ESC = 1;
const ENTER = 28;
const F6 = 0x40;
const KEYBOARD = 0;
const MOUSE = 1;
const GAMEPAD = 2;

// skymp5-client's badMenus, spelled the way Ui.isMenuOpen spells them. F6 and
// Enter do nothing while one of these is open.
const SKYMP_BAD = ['Barter Menu', 'Book Menu', 'ContainerMenu', 'Crafting Menu',
  'GiftMenu', 'InventoryMenu', 'Journal Menu', 'Lockpicking Menu', 'Loading Menu',
  'MapMenu', 'RaceSex Menu', 'StatsMenu', 'TweenMenu', 'Console', 'Main Menu'];

function rig(world, order) {
  const clock = { t: 1000000 };
  const game = { focused: false, menus: new Set(), visible: true,
                 keys: new Set(), other: new Set() };
  const said = [];
  const T = { ready: true };
  const sp = {
    browser: {
      isFocused: function () { return game.focused; },
      setFocused: function (v) { game.focused = !!v; },
      isVisible: function () { return game.visible; },
      setVisible: function (v) { game.visible = !!v; }
    },
    Ui: { isMenuOpen: function (n) { return game.menus.has(n); } },
    // Raising focus opens the game's own CursorMenu, which counts as menu
    // mode. That is the reason the visibility line needs its middle test.
    Utility: { isInMenuMode: function () { return game.menus.size > 0 || game.focused; } },
    // SKSE's count covers every device. Its isKeyPressed takes keyboard codes
    // below 256, so 0x40 is F6 and never a pad's left stick click, and 1 is
    // Escape and never a mouse's right button.
    Input: {
      getNumKeysPressed: function () { return game.keys.size + game.other.size; },
      isKeyPressed: function (k) { return game.keys.has(k); }
    }
  };
  const say = function (t) { said.push(String(t)); };
  const wantTyping = function () { };
  const DateFake = { now: function () { return clock.t; } };
  const fn = new Function('sp', 'say', 'Date', 'ESC', 'wantTyping', 'T',
    arbiter +
    '\nfunction keyDown(e) {\n' + keys + '\n}\n' +
    'function hideNow() { return ' + hideLine[1] + '; }\n' +
    'return { claims: claims, applyFocus: applyFocus, keyDown: keyDown, hideNow: hideNow,' +
    '  watch: typeof watchFocusKeys === "function" ? watchFocusKeys : null,' +
    '  manual: function () { return typeof manualFocusSince === "undefined" ? 0 : manualFocusSince; },' +
    '  cap: typeof MANUAL_FOCUS_MS === "undefined" ? 0 : MANUAL_FOCUS_MS };');
  const api = fn(sp, say, DateFake, ESC, wantTyping, T);

  const r = { clock: clock, game: game, said: said, api: api };

  // skymp5-client's KeyboardEventsService and BrowserService, one update.
  let lastNum = 0;
  function skympUpdate() {
    const n = sp.Input.getNumKeysPressed();
    if (n === lastNum) { return; }
    lastNum = n;
    let bad = false;
    game.menus.forEach(function (m) { if (SKYMP_BAD.indexOf(m) !== -1) { bad = true; } });
    const isDown = function (k) { return sp.Input.isKeyPressed(k); };
    if (!bad && isDown(F6)) { game.focused = !game.focused; }
    if (!bad && isDown(ENTER)) { game.focused = true; }
    if (isDown(ESC) && game.focused) { game.focused = false; }
  }

  // This plugin's update: the tick's two calls, then its visibility line.
  function pluginUpdate() {
    if (api.watch) { api.watch(); }
    api.applyFocus();
    const hide = api.hideNow();
    if (game.visible === hide) { game.visible = !hide; }
  }

  // Key events waiting for the next frame, as SkyrimPlatform queues them.
  const pending = [];
  r.frame = function () {
    while (pending.length) {
      const e = pending.shift();
      if (world === 'loud' || !game.focused) { api.keyDown(e); }
    }
    if (order === 'plugin') { pluginUpdate(); skympUpdate(); }
    else { skympUpdate(); pluginUpdate(); }
    clock.t += 16;
  };
  r.frames = function (n) { for (let i = 0; i < n; i++) { r.frame(); } };
  r.down = function (code, device) {
    if (device) { game.other.add(device + ':' + code); } else { game.keys.add(code); }
    pending.push({ code: code, device: device || KEYBOARD, isDown: true, isUp: false });
  };
  r.up = function (code, device) {
    if (device) { game.other.delete(device + ':' + code); } else { game.keys.delete(code); }
  };
  // A finger on a key for four frames, then off it.
  r.press = function (code, device) {
    r.down(code, device);
    r.frames(4);
    r.up(code, device);
    r.frame();
  };
  return r;
}

const WORLDS = ['quiet', 'loud'];
const ORDERS = ['skymp', 'plugin'];

// ------------------------------------------ F6 at a panel, no claim, and back
WORLDS.forEach(function (world) {
  ORDERS.forEach(function (order) {
    const tag = world + ', ' + order + ' first';
    const r = rig(world, order);
    r.down(F6);
    r.frames(2);
    yes('F6 (' + tag + '): focus is up while the key is still down', r.game.focused);
    r.frames(2);
    r.up(F6);
    r.frames(60);
    yes('F6 (' + tag + '): and still up sixty frames later, so there is a cursor',
        r.game.focused);
    yes('F6 (' + tag + '): and the page is still drawn under that cursor',
        !r.api.hideNow() && r.game.visible);
    r.press(F6);
    r.frames(2);
    yes('F6 again (' + tag + ') gives the keyboard back', !r.game.focused);
    r.frames(60);
    yes('F6 again (' + tag + '): and it stays given back', !r.game.focused);
    r.press(ENTER);
    r.frames(1);
    yes('Enter after an F6 that was given back (' + tag + ') is still put down',
        !r.game.focused);
  });
});

// ------------------------------------------------------------------- Escape
WORLDS.forEach(function (world) {
  ORDERS.forEach(function (order) {
    const tag = world + ', ' + order + ' first';
    const r = rig(world, order);
    r.press(F6);
    r.frames(30);
    r.press(ESC);
    r.frames(60);
    yes('Escape (' + tag + ') gives an F6 focus back', !r.game.focused);
    r.press(ENTER);
    r.frames(1);
    yes('Enter after an F6 that Escape ended (' + tag + ') is still put down',
        !r.game.focused);
  });
});
{
  // Code 1 is Escape only on the keyboard. On a mouse it is the right button
  // and on a pad it is d-pad up, and neither is somebody asking to leave. The
  // loud world, so the key handler hears them too.
  const r = rig('loud', 'skymp');
  r.press(F6);
  r.frames(10);
  r.press(ESC, MOUSE);
  r.press(ESC, GAMEPAD);
  r.frames(10);
  yes('a right click or d-pad up (code 1, not the keyboard) leaves an F6 focus up',
      r.game.focused);
}

// ----------------------------------------------------- held down, and a cap
ORDERS.forEach(function (order) {
  const r = rig('quiet', order);
  r.down(F6);
  r.frames(120);
  yes('F6 held for two seconds (' + order + ' first) stays up, it does not flicker',
      r.game.focused);
  yes('and it is one F6 in the log, not one a frame',
      r.said.filter(function (s) { return /^F6: /.test(s); }).length === 1);
  r.up(F6);
  r.frames(10);
  yes('and letting go changes nothing', r.game.focused);
});
{
  const r = rig('quiet', 'skymp');
  r.press(F6);
  r.frames(10);
  yes('the F6 hold has a cap', r.api.cap > 0 && r.api.cap <= 300000);
  r.clock.t += r.api.cap + 1000;
  r.frames(2);
  yes('an F6 focus nobody gives back comes back on its own at the cap', !r.game.focused);
  yes('and the log says so', r.said.some(function (s) { return /taking it back/.test(s); }));
}

// ------------------------------------------------ Enter never traps anybody
ORDERS.forEach(function (order) {
  const r = rig('quiet', order);
  r.down(ENTER);
  r.frames(2);
  yes('Enter in the world with nothing claiming (' + order + ' first): ' +
      'focus is down by the next frame', !r.game.focused);
  r.frames(60);
  r.up(ENTER);
  r.frames(60);
  yes('Enter (' + order + ' first): and stays down', !r.game.focused);
});

// ------------------------------------------------------------ a real claim
{
  const r = rig('quiet', 'skymp');
  r.press(F6);
  r.frames(10);
  r.api.claims.skills = true;      // the K panel opened and said so
  r.frames(10);
  yes('a panel that claims focus takes over from F6', r.game.focused && r.api.manual() === 0);
  r.api.claims.skills = false;     // and closed
  r.frames(2);
  yes('and when it closes the keyboard comes back, F6 does not linger', !r.game.focused);
}
ORDERS.forEach(function (order) {
  const r = rig('quiet', order);
  r.api.claims.skills = true;
  r.frames(2);
  r.press(F6);                     // skymp5-client toggles it down under the claim
  r.frames(2);
  yes('F6 while a claim holds focus (' + order + ' first) changes nothing: ' +
      'the claim keeps it', r.game.focused && r.api.manual() === 0);
});

// --------------------------------------------------------- the race menu
ORDERS.forEach(function (order) {
  const r = rig('quiet', order);
  r.game.menus.add('RaceSex Menu');
  r.press(F6);
  r.frames(60);
  yes('F6 in the race menu (' + order + ' first) raises nothing: ' +
      'the race menu keeps the keyboard', !r.game.focused);
});
{
  // Something else raised focus during the race menu.
  const r = rig('quiet', 'skymp');
  r.game.menus.add('RaceSex Menu');
  r.game.focused = true;
  r.frames(10);
  yes('a focus nothing asked for in the race menu gets its second of grace',
      r.game.focused);
  r.frames(100);           // 1.6 seconds
  yes('and is then taken back, not held for two minutes behind a hidden page',
      !r.game.focused);
}
{
  const r = rig('quiet', 'skymp');
  r.press(F6);
  r.frames(10);
  r.game.menus.add('Loading Menu');
  r.frames(2);
  yes('a load screen opening by itself ends an F6 focus', !r.game.focused);
  r.game.menus.delete('Loading Menu');
  r.frames(10);
  yes('and it does not come back when the load screen goes', !r.game.focused);
}

// ------------------------------------------------------------ not a pad
WORLDS.forEach(function (world) {
  const r = rig(world, 'skymp');
  r.press(F6, GAMEPAD);    // 0x40 on a pad is the left stick click
  r.frames(10);
  yes('the left stick click (0x40 from a gamepad, ' + world + ') is not F6', !r.game.focused);
});

// ---------------------------------------------------------- the wiring
{
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  yes('the tick asks after F6 and Escape just before it settles focus',
      /watchFocusKeys\(\);\s*applyFocus\(\);/.test(code));
  yes('F6_KEY is 0x40, the DirectInput code skymp5-client binds',
      /const F6_KEY = 0x40;/.test(code));
  yes('F6 and Escape are asked of Input.isKeyPressed, which works with focus up',
      /sp\.Input\.isKeyPressed\(F6_KEY\)/.test(code) && /sp\.Input\.isKeyPressed\(ESC\)/.test(code));
  // One place decides, or one press would toggle twice and cancel itself in
  // the world where buttonEvent is loud.
  const a = code.indexOf("sp.on('buttonEvent', guard('keys'");
  const b = a < 0 ? -1 : code.indexOf("sp.on('update', guard('tick'", a);
  const handler = a >= 0 && b > a ? code.slice(a, b) : '';
  yes('the key handler is found', handler.length > 0);
  yes('and it does not answer F6 as well', handler.length > 0 &&
      !/F6_KEY|f6Pressed/.test(handler));
}

done();
