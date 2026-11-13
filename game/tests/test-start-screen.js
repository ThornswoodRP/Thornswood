// test-start-screen.js
//
// The start screen: the sealed scroll and the character slots, held to what
// five reports out of the Discord launcher thread asked for. They were filed
// as issues #619, #621, #622, #623 and #624, closed once as already written
// up, and reopened because no build anybody was given behaved this way.
//
//   #624  The sealed scroll opens only when it is clicked. Typing in another
//         window while the game sits on the start screen opens nothing and
//         moves nobody on. A click opens the scroll, a click presses
//         Continue, and no key does either.
//   #619  The sealed scroll glows, so it reads as something to click.
//   #621  Continue gives the whole three minutes to choose. Time spent
//         reading the scroll is not taken off the time to pick a character.
//   #622  The start screen waits. Nobody is logged in as their last
//         character for sitting on the scroll or the slots, unless they
//         ticked "Start without the scroll next time", and then it is three
//         minutes on the slots as before.
//   #623  A way to bring the scroll back: a tick box over Close the game.
//
// WHAT THIS DOES NOT DO. It does not draw the page. The choice page builds
// itself from innerHTML and reads back with querySelector, and a fake page
// good enough to run it would be a bigger guess than the thing it checked.
// So the page half is read: the rules that make those five true are single
// lines and they are pinned by name, the way test-issue-616.js pins the two
// halves of that report. The front half is RUN: menuWatch is lifted out of
// thornswood-front.js and driven against a fake win32, a fake browser and a
// clock, because what it does is timing and a read cannot show timing.
//
//   node game/tests/test-start-screen.js
//   FRONT=<file> SELECT=<file> node game/tests/test-start-screen.js   (older copies)
//
// Read only.
'use strict';
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);

const FRONT = process.env.FRONT || path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js');
const SELECT = process.env.SELECT || path.join(REPO_DIR, 'game', 'ui', 'thornswood-select.js');
const front = fs.readFileSync(FRONT, 'utf8').split(CR).join('');
const page = fs.readFileSync(SELECT, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

/** The text from one marker up to, but not including, the next. */
function between(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b);
}

// ============================================ #609  the painting as it is ==

// Djinn, 1 October: the backdrop is shown at its own size, centred, at its
// own speed, with the still under it while Skyrim and the mods load. No zoom
// or drift (it cropped and rescaled the art and moved the ledge out from
// under the sealed scroll) and no playbackRate.
yes('the painting is not zoomed, drifted or re-cropped',
    page.indexOf('tsPaintDrift') < 0 &&
    !/\.bg video\{[^']*(transform|animation|object-position)/.test(page));
yes('the loop plays at its own speed',
    page.indexOf('playbackRate') < 0);
yes('the still goes behind the loop at once, so it shows while the game loads',
    page.indexOf("if (LIST.still) { try { elBg.style.backgroundImage") >= 0 &&
    page.indexOf("if (LIST.still) { try { elBg.style.backgroundImage") < page.indexOf('if (LIST.video) {'));

// The open scroll is smaller than the painted title and sits under it.
yes('the open scroll is 34% of the stage, centred under the title',
    page.indexOf("'#ts-select .intro .open{position:absolute;left:50%;top:62%;width:34%;") >= 0 &&
    page.indexOf('100%{opacity:1;left:50%;top:62%;') >= 0);

// ================================================ #619  the scroll glows ==

// The halo is one rule and one keyframe. It sits behind the picture of the
// sealed scroll, it is gold, it breathes, and it goes out when the scroll is
// opened. It takes no pointer events, which is the line that keeps the thing
// that says "click me" from being the thing that eats the click.
const halo = between(page, "'#ts-select .intro .halo{", "'#ts-select .intro .flash{") || '';
yes('there is a halo behind the sealed scroll', halo !== '');
yes('it is drawn under the scroll, in the same stage, so it moves with it',
    page.indexOf('<div class="halo"></div><img class="closed"') >= 0);
yes('it is candle gold and soft, a radial gradient out to nothing',
    /radial-gradient\(ellipse closest-side,rgba\(255,222,150/.test(halo) &&
    /transparent 100%\)\}/.test(halo));
yes('it breathes rather than sitting still', /animation:tsGlow /.test(halo) &&
    page.indexOf('@keyframes tsGlow{from{opacity:.35}to{opacity:1}}') >= 0);
yes('it fades the moment the scroll is opened',
    page.indexOf("'#ts-select .intro.opening .halo{animation:tsFade .3s ease forwards}'") >= 0);
yes('and it never swallows the click it is advertising', /pointer-events:none/.test(halo));

// ======================== #624  the scroll opens only when it is clicked ==

// Half one: while the scroll is up every key is swallowed and nothing else
// is bound to a key. Only .closed's click opens it and only .go's click
// continues.
const introKey = between(page, '  function introKey(ev) {', '\n  }\n') || '';
yes('while the scroll is up every key is swallowed',
    /if \(!introPhase\) return false;/.test(introKey) &&
    /ev\.preventDefault\(\);/.test(introKey) &&
    /return true;/.test(introKey));
yes('and nothing in it opens, continues or skips anything',
    !/introOpen|introEnd|\.checked/.test(introKey));
yes('the seal breaks on a click and on nothing else',
    page.indexOf(".querySelector('.closed').onclick = introOpen;") >= 0);
yes('Continue is a click and on nothing else',
    page.indexOf(".querySelector('.go').onclick = function () {") >= 0);
yes('a swallowed key is written down, so a repeat of 25 September is provable',
    /strayKey\('the sealed scroll only opens for a click'\)/.test(introKey));

// Half two, which the first pass left open and which #624 also asks for: the
// slots behind the scroll play the lit character on Enter, so the same stray
// keys moved somebody on. Every key on this page is now refused unless the
// front has said the game is the window Windows is sending keys to.
const keysCount = between(page, '  function keysCount() {', '\n  }\n') || '';
yes('the page decides whether a key counts at all', keysCount !== '');
yes('it starts out refusing: nothing has said the game has the keyboard',
    /var keysHere = false;/.test(page) && /var keysSaidAt = 0;/.test(page));
yes('and it keeps refusing once the answer is stale, rather than trusting an old yes',
    /keysSaidAt\) < 5000/.test(keysCount));
yes('the front is the one that answers, through the page\'s own handle',
    /keys: keysSay,/.test(page) &&
    /function keysSay\(on, ask\) \{\s*frontHere\(\);\s*keysHere = !!on;\s*keysSaidAt = Date\.now\(\);/.test(page));
yes('a client that never answers leaves the keys as they were, from the first mouse move',
    /if \(!keysSaidAt\) return moved;/.test(keysCount));
const onKey = between(page, '  function onKey(ev) {', '\n  }\n') || '';
yes('and every key on the slots goes through that gate before Enter can play anybody',
    onKey.indexOf('if (!keysCount()) {') >= 0 &&
    onKey.indexOf('if (!keysCount()) {') < onKey.indexOf('holdKey(ev.key)') &&
    onKey.indexOf('holdKey(ev.key)') < onKey.indexOf('if (keyAct(ev.key))'));

// Running it, because a read cannot show the staleness rule working.
if (keysCount) {
  const run = new Function('moved', 'keysHere', 'keysSaidAt', 'Date',
                           keysCount + '\n}\nreturn keysCount();');
  const at = function (now) { return { now: function () { return now; } }; };
  yes('with nothing said and no mouse on the page, a key does nothing',
      run(false, false, 0, at(1000)) === false);
  yes('with nothing said but the mouse here, the keys work as they always did',
      run(true, false, 0, at(1000)) === true);
  yes('told the game is behind another window, a key does nothing',
      run(true, false, 1000, at(1200)) === false);
  yes('told the game has the keyboard, a key counts',
      run(false, true, 1000, at(1200)) === true);
  yes('and a yes nobody has repeated for five seconds stops counting',
      run(false, true, 1000, at(6500)) === false);
}

// ============ #591  a key counts on an answer given after it, not before ==
//
// The page's key handling, lifted out whole and run against a clock, a fake
// front and fake slots: the second between two once a second answers is
// where a key typed into Discord still played the lit character.
const KEYS = between(page, '  var keysHere = false;', "\n  window.addEventListener('keydown', onKey, true);");
yes('#591: the page\'s key handling can be lifted out', KEYS !== null);
if (KEYS) {
  const keyRig = function () {
    const st = { now: 10000, told: [], played: 0, timers: [], drawn: 0, forgot: 0, moved: false };
    const clock = { now: function () { return st.now; } };
    const make = new Function('root', 'introKey', 'slots', 'draw', 'play', 'forget', 'tell', 'Date', 'setTimeout', 'clearTimeout', 'st', 'frontHere',
      'var moved = false, asking = 0, at = 0;\n' + KEYS + '\n' +
      'return { onKey: onKey, keys: keysSay, at: function () { return at; }, asking: function () { return asking; } };');
    const api = make({ className: '' }, function () { return false; },
      function () { return [{ id: 1, c: 1 }, { id: 2, c: 1 }]; },
      function () { st.drawn++; }, function () { st.played++; }, function () { st.forgot++; },
      function (s) { st.told.push(s); }, clock,
      function (fn, ms) { const t = { fn: fn, at: st.now + ms, live: true }; st.timers.push(t); return t; },
      function (t) { if (t) t.live = false; }, st,
      function () { }); // #5140: the front is in; test-5140-start-focus.js holds that half
    const run = function (ms) {
      st.now += ms;
      st.timers.forEach(function (t) { if (t.live && t.at <= st.now) { t.live = false; t.fn(); } });
    };
    const key = function (k) { let stopped = false; api.onKey({ key: k, preventDefault: function () { stopped = true; } }); return stopped; };
    const asks = function () { return st.told.filter(function (s) { return s.indexOf('keycheck ') === 0; }); };
    return { st: st, api: api, run: run, key: key, asks: asks };
  };
  {
    const r = keyRig();
    r.api.keys(true);          // the once a second answer: the game
    r.run(600);                // ... and then they alt tab and type
    yes('#591: Enter with an answer from 600 ms ago is not acted on yet', r.key('Enter') === true && r.st.played === 0);
    yes('#591: and the page asks the front again at once', r.asks().length === 1 && r.asks()[0] === 'keycheck 1');
    r.run(20);
    r.api.keys(false, 1);      // the answer to that ask: Discord
    yes('#591: told another window has the keyboard, the held Enter plays nobody', r.st.played === 0);
    r.run(2000);
    yes('#591: and it does not come back later either', r.st.played === 0);
  }
  {
    const r = keyRig();
    r.api.keys(true);
    r.run(600);
    r.key('Enter');
    r.run(20);
    r.api.keys(true, 1);
    yes('#591: told the game has the keyboard, the held Enter plays the lit character', r.st.played === 1);
  }
  {
    const r = keyRig();
    r.api.keys(true);
    r.run(600);
    r.key('Enter');
    r.api.keys(true);          // a once a second yes, read before the key, landing after it
    yes('#591: a yes that is not the answer to the ask does not release the key', r.st.played === 0);
    r.run(1100);
    yes('#591: with no answer to the ask inside a second, the key is dropped', r.st.played === 0);
    r.api.keys(true, 1);
    yes('#591: and a late answer finds nothing left to play', r.st.played === 0);
  }
  {
    const r = keyRig();
    r.api.keys(true);
    r.run(50);
    yes('#591: with an answer from the last 150 ms the key acts at once, as before', r.key('ArrowDown') === true && r.api.at() === 1 && r.asks().length === 0);
  }
  {
    const r = keyRig();
    r.api.keys(true);
    r.run(600);
    r.key('ArrowDown'); r.key('ArrowDown'); r.key('ArrowDown');
    yes('#591: keys in a burst share one ask', r.asks().length === 1);
    r.api.keys(true, 1);
    yes('#591: and are all played back in order once the game is confirmed', r.api.at() === 1);
  }
  {
    const r = keyRig();
    r.api.keys(true);
    r.run(600);
    yes('#591: a key the page has no use for is held but not stopped', r.key('a') === false);
  }
  {
    const r = keyRig();
    r.st.now = 10000;
    // No front ever answered: keysSaidAt stays 0, and the first mouse move rule holds.
    yes('#591: a client that never answers is never asked either', (r.key('Enter'), r.asks().length === 0));
  }
}
const KEYCHECK = between(front, '  function menuKeyCheck(ask) {', '\n  }\n');
yes('#591: the front answers the page\'s ask', KEYCHECK !== null &&
    front.indexOf("if (what.indexOf('select:keycheck ') === 0) {") >= 0 &&
    front.indexOf("if (what.indexOf('select:keycheck ') === 0) {") < front.indexOf("if (what.indexOf('select:') === 0) {"));
if (KEYCHECK) {
  const ask = function (fg, noWin32, throws) {
    const said = [];
    const sp = { win32: noWin32 ? undefined : { foregroundWindow: function () { if (throws) throw new Error('x'); return fg; } } };
    new Function('sp', 'T', KEYCHECK + '\n}\nmenuKeyCheck("7");')(sp, { js: function (s) { said.push(s); } });
    return said.join('');
  };
  yes('#591: the front asks Windows now and answers with the same number',
      ask({ isGame: true }).indexOf('keys(true,7)') >= 0);
  yes('#591: another window in front is a no', ask({ isGame: false }).indexOf('keys(false,7)') >= 0);
  yes('#591: and so is a Windows call that fails, rather than silence', ask(null, false, true).indexOf('keys(false,7)') >= 0);
}

// ================== #621  Continue gives the whole three minutes to choose ==

yes('Continue tells the client the choice starts now',
    page.indexOf("window.skyrimPlatform.sendMessage('thornswood', 'choosing')") >= 0);
yes('and tells the front, so the front can say it too',
    /introWent = true;[\s\S]{0,400}tell\('choosing'\);/.test(page));
yes('and it is said again on the beat, not once into a client that may not be listening',
    /if \(introWent\) \{\s*try \{ window\.skyrimPlatform\.sendMessage\('thornswood', 'choosing'\); \}/.test(page));
yes('the front hears Continue and remembers it for its own repeats',
    front.indexOf("if (what === 'select:choosing') {") >= 0 &&
    /if \(what === 'select:choosing'\) \{\s*if \(!menuWent\) \{\s*menuWent = true;/.test(front));

// ======================== #622  the start screen waits for you ==

yes('with the scroll on the page tells the client to wait',
    /if \(LIST\.intro !== false && beats % 5 === 0\) \{\s*try \{ window\.skyrimPlatform\.sendMessage\('thornswood', 'stay'\); \}/.test(page));
// Until the pick is taken rather than made (#481): somebody waiting in line
// at the menu sits on the page, and its beat is what keeps it from reloading.
yes('every ten seconds, on a two second beat, until the pick is taken',
    /\}, 2000\);/.test(page) && /if \(acked \|\| root\.className === 'gone'\) \{ clearInterval\(beat\); return; \}/.test(page));
yes('with the scroll off it says nothing, so the three minutes work as before',
    page.indexOf('LIST.intro !== false && beats % 5 === 0') >= 0);
yes('the front says the same two words from its own tick, so the wait outlives the page',
    /T\.js\('try\{window\.skyrimPlatform\.sendMessage\("thornswood","stay"\);' \+/.test(front));
yes('and the setting that decides it is read once, at the start, not taken off the tick box',
    front.indexOf("menuIntroOff = readText(INTRO_FILE).trim() === 'off';") >= 0 &&
    /menuIntroOff is deliberately left where it was/.test(front));

// ========================= #623  an easy way to bring the sealed scroll back ==

const backBox = between(page, '  function showBackBox() {', '\n  }\n') || '';
yes('there is a tick box to bring the scroll back', backBox !== '');
yes('it says what it does, in those words',
    backBox.indexOf("'Show the sealed scroll next time'") >= 0);
yes('it sits above Close the game',
    backBox.indexOf("root.querySelector('.foot').insertBefore(backRow, root.querySelector('.quitrow'))") >= 0);
yes('ticked brings the scroll back, unticked keeps going straight to the slots',
    /introSay = backTick\.checked \? 'intro on' : 'intro off';/.test(backBox));
yes('and the front writes that one word down for the launcher to pass on',
    front.indexOf("if (what === 'select:intro off' || what === 'select:intro on') {") >= 0 &&
    front.indexOf('writeFileSync(INTRO_FILE, what.slice(13)') >= 0);
yes('it is up when the scroll was off at this start',
    /\} else if \(LIST\.intro === false\) \{\s*showBackBox\(\);\s*\}/.test(page));
yes('and up when the scroll was switched off on the scroll itself, so it is not a one way door',
    /if \(box && box\.checked\) \{ introSay = 'intro off'; tell\(introSay\); showBackBox\(\); \}/.test(page));
yes('and it is only ever drawn once',
    /if \(backShown\) return;\s*backShown = true;/.test(backBox));

// ==================== the front's half, run rather than read ==============
//
// menuWatch is what answers the page about the keyboard and what keeps
// saying stay and choosing. Lifted out and driven against a fake win32, a
// fake browser and a clock.

const WATCH = between(front, '  function menuWatch(now) {', '\n  }\n');
yes('menuWatch is in the plugin', WATCH !== null);

function rig(opts) {
  opts = opts || {};
  const said = [];
  const logs = [];
  const state = { fg: opts.fg, introOff: !!opts.introOff, went: !!opts.went };
  const sp = { win32: opts.noWin32 ? undefined : { foregroundWindow: function () { return state.fg; } } };
  const T = { js: function (s) { said.push(s); } };
  const log = function () { logs.push(Array.prototype.join.call(arguments, ' ')); };
  const make = new Function('sp', 'T', 'log', 'state',
    'let menuFgAt = 0, menuFgWas = null, menuStayAt = 0;\n' +
    'let menuIntroOff = state.introOff, menuWent = state.went;\n' +
    WATCH + '\n}\n' +
    'return { watch: menuWatch, went: function (v) { menuWent = v; } };');
  const api = make(sp, T, log, state);
  return {
    said: said, logs: logs, state: state,
    tick: function (now) { api.watch(now); },
    went: api.went,
    keysSaid: function () {
      return said.filter(function (s) { return s.indexOf('thornswoodSelect.keys(') >= 0; })
                 .map(function (s) { return s.indexOf('keys(true)') >= 0; });
    },
    stays: function () { return said.filter(function (s) { return s.indexOf('"stay"') >= 0; }).length; },
    choosings: function () { return said.filter(function (s) { return s.indexOf('"choosing"') >= 0; }).length; }
  };
}

const GAME = { isGame: true, exe: 'SkyrimSE.exe' };
const OTHER = { isGame: false, exe: 'Discord.exe', title: 'Discord' };

if (WATCH) {
  // The keyboard answer.
  {
    const r = rig({ fg: OTHER, introOff: true });
    r.tick(10000);
    yes('with the keys going to another window the page is told to ignore them',
        r.keysSaid().length === 1 && r.keysSaid()[0] === false);
    yes('and the log names the window, once',
        r.logs.filter(function (l) { return l.indexOf('another window') >= 0; }).length === 1);
    r.state.fg = OTHER;
    r.tick(11001);
    yes('the page is told again on every pass, because it forgets after five seconds',
        r.keysSaid().length === 2);
    yes('and the log does not repeat itself while nothing has changed',
        r.logs.filter(function (l) { return l.indexOf('another window') >= 0; }).length === 1);
    r.state.fg = GAME;
    r.tick(12002);
    yes('back at the game, the page is told the keys count',
        r.keysSaid().length === 3 && r.keysSaid()[2] === true);
    yes('and that change is written down too',
        r.logs.filter(function (l) { return l.indexOf('going to the game') >= 0; }).length === 1);
  }
  {
    const r = rig({ fg: GAME, introOff: true });
    r.tick(10000);
    r.tick(10500);
    yes('it asks Windows once a second and not on every tick', r.keysSaid().length === 1);
  }
  {
    const r = rig({ noWin32: true, introOff: true });
    r.tick(10000);
    r.tick(20000);
    yes('a client with no win32 to ask is never told either way, so the page keeps what it had',
        r.keysSaid().length === 0);
  }

  // The wait.
  {
    const r = rig({ fg: GAME, introOff: false });
    r.tick(10000);
    yes('with the scroll on, the first pass tells the client to wait', r.stays() === 1);
    r.tick(15000);
    yes('and not again inside ten seconds', r.stays() === 1);
    r.tick(20001);
    yes('and again after ten seconds', r.stays() === 2);
    yes('and Continue has not been pressed, so nothing says the choice has started',
        r.choosings() === 0);
    r.went(true);
    r.tick(30002);
    yes('once Continue has been pressed both words go out together',
        r.stays() === 3 && r.choosings() === 1);
  }
  {
    const r = rig({ fg: GAME, introOff: true });
    r.tick(10000);
    r.tick(30000);
    r.tick(60000);
    yes('with the scroll switched off the front says nothing, so the three minutes stand',
        r.stays() === 0 && r.choosings() === 0);
    yes('and it still answers about the keyboard, which is not the scroll\'s business',
        r.keysSaid().length === 3);
  }
}

// ======================================= the two are wired to each other ==

yes('the front only does any of this while the choice is actually up',
    front.indexOf('if (choiceUp()) { menuWatch(now); }') >= 0);
yes('and the page hands the front a way in that the front uses by that name',
    page.indexOf('keys: keysSay,') >= 0 &&
    front.indexOf('window.thornswoodSelect.keys(') >= 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
