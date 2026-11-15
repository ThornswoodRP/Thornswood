// test-journal-key.js
//
// J opens our journal and nothing else, and Escape still opens the game's
// System page exactly as it did.
//
// Patrick, 24 September: "also can you make it so when you press j to open
// your journal it only opens our journal and not the vanilla skyrim jounral
// in the background of our journal".
//
// WHY BOTH HAPPENED. J is Skyrim's own Journal key as well as ours. The key
// reaches the game untouched: the fork's EventHandler.cpp copies every
// InputEvent into an update task for the plugins and returns kContinue, and
// the game's own MenuControls handles the same event, so one press asked for
// our panel AND queued the game's Journal Menu at its Quests page.
//
// THE TRAP. The Journal Menu is also what Escape opens, at its System page,
// where people save, change settings and quit. Anything that switches the
// game's journal off as a whole risks Escape. So the plugin shuts the book
// the moment it opens, and only when the key that just went down was our J
// and the game took it as its 'Journal' control. Escape goes down as 'Pause'.
//
// WHAT THIS RUNS. The real text of three pieces of thornswood-front.js: the
// focus arbiter (claims, applyFocus, T.claimFocus), the J block, and the
// key handler. Under them is a pretend game that keeps the fork's order of
// events, read in its source rather than guessed:
//   - a key press queues the game's menu at once and queues the plugin's
//     buttonEvent as an update task (EventHandler.cpp, AddUpdateTask);
//   - the menu opens when the UI works through its message queue, and its
//     menuOpen is queued as an update task in turn (the same file);
//   - the update event fires, then the update tasks run first in first out
//     (SkyrimPlatform.cpp JsTick, viet TaskQueue.h);
//   - TESModPlatform.closeMenu queues a kHide (PapyrusTESModPlatform.cpp);
//   - browser.setFocused(true) raises the Cursor Menu only when it is not up
//     already, and setFocused(false) lowers it only when focus raised it
//     (BrowserApiTilted.cpp), and since #2384 shows it again when it closes
//     under a focus still up (the Cursor Menu's close event, CursorFocus.h);
//   - while browser focus is up the game and the plugins get no keys; the
//     page does (DInputHook.cpp zeroes the game's keyboard read, and
//     buttonEvent is built from the game's own input).
// The game's own half, which cannot be read here, is taken at its worst: the
// book raises the cursor for itself and takes it down when it closes, and it
// is run with the plugin's update before and after the game's UI pass, with
// the book opening in the same frame and one frame late, and with the page
// answering after zero to four frames. A game that ignores the plugin's
// first close, and one that never closes the book at all, are run too.
//
// Run it against the code before the change with FRONT=<that file>: the J
// scenarios fail there, because nothing shut the book.
//
// THE CLIENT (issue 1016). Patrick, 28 September: "Don't accept the flash
// make the game client change." The fork's client has a list of keys the
// game's menu opener does not see (setMenuOpenKeyBlocked, MenuOpenKeyBlocks in
// platform_lib, its own unit test in the fork). opts.client runs the pretend
// game with that list, kept the way the hook keeps it: a press on the list
// never reaches the game's Journal control unless one of the entry's except
// menus is open. C1 to C7 below run it, and there the book is never drawn at
// all. S1 to S12 run a client without the list: the shut that is left for a
// book that opens anyway.
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

/** The text from one marker up to, but not including, the next. */
function between(start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b);
}

const KEYS_OPEN = "  sp.on('buttonEvent', guard('keys', (e) => {";
const SHUT = '\n  }));\n';
const TYPING = '  // ---------------------------------------------------------------- typing --';
const J_MARK = '  // ------------------------------------------------ J is our journal alone --';

const arbiter = between('  const claims = {};', TYPING);
const ka = src.indexOf(KEYS_OPEN);
const kb = ka < 0 ? -1 : src.indexOf(SHUT, ka);
const keys = (ka >= 0 && kb >= 0) ? src.slice(ka, kb + SHUT.length) : null;
// Absent on the code before the change, which is the point: the rest still
// runs, and the J scenarios show what that code does. The two hooks the key
// handler calls into it are given empty stand-ins then, so it still runs.
const jBlock = between(J_MARK, KEYS_OPEN) || '';
const jStandIns = jBlock ? '' :
  'function journalKeyDown() { }\nfunction journalKeyPressed() { }\n';

yes('the focus arbiter is in the plugin', arbiter !== null);
yes('the key handler is in the plugin', keys !== null);
yes('the J block is in the plugin, before the key handler', jBlock !== '');
// The page's two answers move the claim in the plugin's main browserMessage
// handler. The rig below does the same two things, so they are checked to
// still be what the plugin does.
yes('the plugin claims focus when the journal page says it opened',
    src.indexOf("if (what === 'journal:opened') { T.claimFocus('journal', true); return; }") >= 0);
yes('and lets it go when the page says it closed',
    src.indexOf("if (what === 'journal:closed') { T.claimFocus('journal', false); return; }") >= 0);

const JOURNAL = 'Journal Menu';
const CURSOR = 'Cursor Menu';
/*
  The keys as the plugin declares them: every `const ..._KEY` and ESC at the
  top of its scope, in its order, read through the plugin's own iniNumber from
  a Thornswood.ini that is empty unless a case gives it lines. Read from the
  plugin rather than typed here (#1652): a typed copy kept the friend key on G
  after #529 moved it to Y, so the harness pressed a key the plugin no longer
  reads.
*/
const KEY_DECLS = (src.match(/^  (?:const|let) (?:[A-Z]+_)*KEY\b[^;\n]*;|^  const ESC = \d+;/gm) || []).join('\n');
const INI_AT = src.indexOf('  function iniNumber(text, key, fallback) {');
const INI_NUMBER = INI_AT < 0 ? '' : src.slice(INI_AT, src.indexOf('\n  }\n', INI_AT) + 4);
function keyPrelude(iniText) {
  return 'const ini = ' + JSON.stringify(iniText || '') + ';\n' + INI_NUMBER + KEY_DECLS + '\n';
}
yes('the plugin reads its keys through iniNumber', INI_NUMBER !== '' && KEY_DECLS !== '');
const KEY = INI_NUMBER === '' ? {} : new Function(keyPrelude('') + 'return { ' +
  (KEY_DECLS.match(/(?:const|let) \w+/g) || []).map(function (d) { d = d.replace(/^(?:const|let) /, ''); return d + ': ' + d; }).join(', ') + ' };')();

// U is the mold key, which the game's journal is moved onto in S4 and ours in S5.
const J = KEY.JOURNAL_KEY, ESC = KEY.ESC, U = KEY.MOLD_KEY;
yes('the plugin declares every key the handler reads', !!keys &&
    (keys.match(/\b(?:[A-Z]+_)*KEY\b|\bESC\b/g) || []).every(function (k) { return typeof KEY[k] === 'number'; }));

/*
  The pretend game, the page and SkyrimPlatform between them.

  opts.controls     the game's control map: key code -> control name
  opts.noNames      buttonEvent arrives with an empty userEventName
  opts.journalKey   JournalKey from Thornswood.ini (ours)
  opts.pageDelay    frames before the page does what it was asked; Infinity
                    for a page that never answers
  opts.openLag      the book opens one UI pass late
  opts.spFirst      the plugins' update runs before the game's UI pass
  opts.noPanel      thornswood-journal.js never said it was in
  opts.notReady     the overlays are not in yet (T.ready false)
  opts.refuse       the game ignores its Journal control (controls off)
  opts.stubborn     how many of the plugin's closes the book ignores
  opts.client       the client keeps listed keys from the game's menu opener
                    (issue 1016)
*/
function rig(opts) {
  opts = opts || {};
  const clock = { t: 5000000 };
  const game = {
    frame: 0,
    open: {},
    ui: [],
    later: [],
    tasks: [],
    shut: [],
    books: [],
    focus: false,
    cursorByFocus: false,
    stubborn: opts.stubborn || 0,
    // The client's list, 'userEvent:code' -> except menus, and every call.
    kept: {},
    keptCalls: [],
    controls: Object.assign({ 36: 'Journal', 1: 'Pause', 22: '' }, opts.controls || {})
  };
  const page = { shown: false, pending: [], toggles: 0 };
  const logs = [], threw = [];
  const handlers = {};

  function queueUi(m) {
    if (opts.openLag && m.type === 'show') { game.later.push(m); } else { game.ui.push(m); }
  }

  const sp = {
    on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    Ui: { isMenuOpen: function (n) { return !!game.open[n]; } },
    Utility: { isInMenuMode: function () { return Object.keys(game.open).length > 0; } },
    TESModPlatform: {
      closeMenu: function (n) {
        game.shut.push(n);
        game.ui.push({ menu: n, type: 'hide', byPlugin: true });
      }
    },
    Input: {
      getMappedKey: function (control) {
        for (const k in game.controls) {
          if (game.controls[k] === control) { return Number(k); }
        }
        return -1;
      }
    },
    setMenuOpenKeyBlocked: opts.client ? function (userEvent, code, on, except) {
      game.keptCalls.push({ userEvent: userEvent, code: code, on: on, except: except });
      if (on) { game.kept[userEvent + ':' + code] = (except || []).slice(); }
      else { delete game.kept[userEvent + ':' + code]; }
    } : undefined,
    browser: {
      isFocused: function () { return game.focus; },
      setFocused: function (v) {
        v = !!v;
        if (game.focus === v) { return; }
        game.focus = v;
        if (v) {
          if (!game.open[CURSOR]) {
            game.ui.push({ menu: CURSOR, type: 'show' });
            game.cursorByFocus = true;
          }
        } else if (game.cursorByFocus) {
          game.ui.push({ menu: CURSOR, type: 'hide' });
          game.cursorByFocus = false;
        }
      }
    }
  };

  function tell(what) {
    game.tasks.push(['browserMessage', { arguments: ['thornswood-front', what] }]);
  }

  const T = {
    ready: !opts.notReady,
    js: function (s) {
      const delay = opts.pageDelay === undefined ? 1 : opts.pageDelay;
      if (s.indexOf('thornswoodJournal.toggle') >= 0) {
        page.pending.push({ due: game.frame + delay, act: 'toggle' });
      } else if (s.indexOf('thornswoodJournal.close') >= 0) {
        page.pending.push({ due: game.frame + delay, act: 'close' });
      }
      return true;
    }
  };
  const say = function (t) { logs.push(String(t)); };
  const guard = function (name, fn) {
    return function () {
      try { return fn.apply(null, arguments); }
      catch (e) { threw.push(name + ': ' + (e && e.stack ? e.stack : e)); return undefined; }
    };
  };
  const clockDate = { now: function () { return clock.t; } };

  const prelude =
    'let keysSeen = 0, sawAnyKey = false;\n' +
    'function rememberKey() { }\n' +
    'function wantTyping() { }\n' +
    'function lookVerb() { }\n' +
    // The mold key's check runs first in the handler. With no door under the
    // crosshair it passes every key on, which is what this stands in for.
    'function moldPress() { return false; }\n' +
    // The sleep key is the mold's, on a person (#1603). Nobody is looked at here.
    'function sleepPress() { return false; }\n' +
    // Hand over the letter (#1595), Activate on somebody you carry a letter
    // for. Nobody is looked at here; test-1595-deliver.js has the press.
    'function deliverPress() { return false; }\n' +
    // The same key's check in the inventory (#1384). No inventory is open
    // here, so it passes every key on as well.
    "function repairPress() { return false; }\n" +
    "function furniturePress() { return false; }\n" +
    "function arrangePress() { return false; }\n" +
    // The same key at a forge with a stamped mold, the master key (#2254).
    // No forge is looked at here; test-1637-door-gui.js has the press.
    'function masterPress() { return false; }\n' +
    'function lockPress() { return false; }\n' +
    // Tend their wounds (#1383), X on a hurt person, and Tend your wounds,
    // H in the inventory. Nobody is looked at and no inventory is open
    // here; test-1383-treatments.js has what they do.
    'function treatPress() { return false; }\nfunction treatSelfPress() { return false; }\n' +
    // A warrior's maneuvers (#1386), 9, and the help panel (#1633), F7, which
    // nothing here presses; test-1386-warrior.js and test-1633-help-panel.js
    // have what they do. K on a person a Master could take on (#1634) and P on
    // somebody not in your party (#1629): nobody is looked at here.
    'function maneuverKeyPressed() { }\nfunction helpKeyPressed() { }\n' +
    'function apprenticePress() { return false; }\nfunction partyPress() { return false; }\n' +
    // JournalKey in Thornswood.ini, read by the plugin's own iniNumber.
    keyPrelude(opts.journalKey ? 'JournalKey=' + opts.journalKey + '\n' : '');
  const make = new Function('sp', 'say', 'T', 'Date', 'guard',
    prelude + arbiter + '\n' + jBlock + jStandIns + '\n' + keys + '\nreturn { claims: claims };');
  make(sp, say, T, clockDate, guard);

  // The two lines of the plugin's main browserMessage handler checked above.
  sp.on('browserMessage', function (event) {
    const w = event.arguments[1];
    if (w === 'journal:opened') { T.claimFocus('journal', true); }
    if (w === 'journal:closed') { T.claimFocus('journal', false); }
  });

  function fire(ev, data) {
    (handlers[ev] || []).forEach(function (fn) { fn(data); });
  }

  function processUi() {
    while (game.ui.length) {
      const m = game.ui.shift();
      if (m.menu === CURSOR) {
        if (m.type === 'show') { game.open[CURSOR] = true; } else { delete game.open[CURSOR]; }
        continue;
      }
      if (m.type === 'show' && !game.open[m.menu]) {
        game.open[m.menu] = m.page || true;
        game.books.push({ page: m.page, openedAt: game.frame, closedAt: -1 });
        // The book raises the cursor for itself.
        if (!game.open[CURSOR]) { game.open[CURSOR] = true; }
        game.tasks.push(['menuOpen', { name: m.menu }]);
      } else if (m.type === 'hide' && game.open[m.menu]) {
        if (m.byPlugin && game.stubborn > 0) { game.stubborn--; continue; }
        delete game.open[m.menu];
        const last = game.books[game.books.length - 1];
        if (last && last.closedAt < 0) { last.closedAt = game.frame; }
        // And takes it down with it, whoever else wanted it: the worst case.
        // The fork (#2384) sees the Cursor Menu close under a focus still up
        // and queues its show again.
        if (game.open[CURSOR]) {
          delete game.open[CURSOR];
          game.cursorByFocus = false;
          if (game.focus) { game.ui.push({ menu: CURSOR, type: 'show' }); game.cursorByFocus = true; }
        }
        game.tasks.push(['menuClose', { name: m.menu }]);
      }
    }
  }

  function pageStep() {
    const still = [];
    page.pending.forEach(function (p) {
      if (p.due > game.frame) { still.push(p); return; }
      if (p.act === 'toggle') {
        page.toggles++;
        page.shown = !page.shown;
        tell(page.shown ? 'journal:opened' : 'journal:closed');
      } else if (p.act === 'close' && page.shown) {
        page.shown = false;
        tell('journal:closed');
      }
    });
    page.pending = still;
  }

  function frame() {
    game.frame++;
    clock.t += 16;
    if (!opts.spFirst) { processUi(); }
    fire('update');
    const due = game.tasks.splice(0);
    due.forEach(function (t) { fire(t[0], t[1]); });
    if (opts.spFirst) { processUi(); }
    pageStep();
    game.ui.push.apply(game.ui, game.later.splice(0));
  }

  const h = {
    game: game, page: page, logs: logs, threw: threw,
    /* A key press, as the fork delivers it. */
    press: function (code) {
      if (game.focus) {
        // The page has the keyboard. Its own Escape closes it.
        if (code === ESC && page.shown) { page.shown = false; tell('journal:closed'); }
        return;
      }
      const control = game.controls[code] || '';
      const book = game.open[JOURNAL];
      // MenuOpenKeyBlockHook.cpp: a listed press is a no to the game's menu
      // opener unless an except menu is up.
      const except = game.kept[control + ':' + code];
      const keptFromGame = !!except && !except.some(function (n) { return !!game.open[n]; });
      if (control === 'Journal' && !opts.refuse && !keptFromGame) {
        queueUi({ menu: JOURNAL, type: book ? 'hide' : 'show', page: 'Quests' });
      }
      if (control === 'Pause') {
        queueUi({ menu: JOURNAL, type: book ? 'hide' : 'show', page: 'System' });
      }
      const name = opts.noNames ? '' : control;
      game.tasks.push(['buttonEvent', { code: code, userEventName: name, isDown: true, isUp: false, device: 0 }]);
      game.tasks.push(['buttonEvent', { code: code, userEventName: name, isDown: false, isUp: true, device: 0 }]);
    },
    /* Something other than a key opens the book, a quest script say. */
    scriptOpens: function () { game.ui.push({ menu: JOURNAL, type: 'show', page: 'Quests' }); },
    /* One of the game's own menus, the inventory say, is up. */
    menu: function (name, up) { if (up) { game.open[name] = true; } else { delete game.open[name]; } },
    run: function (n) { for (let i = 0; i < n; i++) { frame(); } },
    said: function (text) { return logs.some(function (l) { return l.indexOf(text) >= 0; }); }
  };

  // The page loads, the bridge says so, and then the journal panel mounts.
  tell('bridge is up');
  if (!opts.noPanel) { tell('journal:ready'); }
  h.run(3);
  return h;
}

if (arbiter !== null && keys !== null) {
  // ------------------------------------------------ S1: THE BUG, every order
  {
    const variants = [];
    [false, true].forEach(function (spFirst) {
      [0, 1].forEach(function (openLag) {
        [0, 1, 2, 4].forEach(function (pageDelay) {
          variants.push({ spFirst: spFirst, openLag: openLag, pageDelay: pageDelay });
        });
      });
    });
    const bad = { ours: [], book: [], once: [], flash: [], focus: [], cursor: [], threw: [],
                  after: [], measured: [] };
    let repaired = 0;
    variants.forEach(function (v) {
      const h = rig(v);
      const name = JSON.stringify(v);
      h.press(J);
      h.run(60);
      if (!h.page.shown) { bad.ours.push(name); }
      if (h.game.open[JOURNAL]) { bad.book.push(name); }
      if (h.game.shut.length !== 1 || h.game.shut[0] !== JOURNAL) { bad.once.push(name); }
      const b = h.game.books[0];
      if (!b || b.page !== 'Quests' || b.closedAt < 0 || b.closedAt - b.openedAt > 2) { bad.flash.push(name); }
      if (!h.game.focus) { bad.focus.push(name); }
      if (!h.game.open[CURSOR]) { bad.cursor.push(name); }
      if (h.threw.length) { bad.threw.push(name + ' ' + h.threw[0]); }
      if (!h.logs.some(function (l) { return /opened \d+ms after the press and was gone \d+ms after/.test(l); })) {
        bad.measured.push(name);
      }
      if (h.said('raised it again for ours')) { repaired++; }
      // And closing ours leaves nothing behind: no book, no cursor, keyboard
      // back with the game.
      h.press(ESC);
      h.run(30);
      if (h.page.shown || h.game.focus || h.game.open[CURSOR] || h.game.open[JOURNAL]) { bad.after.push(name); }
    });
    function show(list) { list.slice(0, 3).forEach(function (n) { console.log('      ' + n); }); }
    yes('S1 J opens our journal, in all ' + variants.length + ' orders', bad.ours.length === 0); show(bad.ours);
    yes('S1 THE BUG: and the game\'s journal is not left open behind it', bad.book.length === 0); show(bad.book);
    yes('S1 it was shut exactly once, by name', bad.once.length === 0); show(bad.once);
    yes('S1 the book that opened was the Quests page, and it was up two frames at most',
        bad.flash.length === 0); show(bad.flash);
    yes('S1 our journal holds the keyboard', bad.focus.length === 0); show(bad.focus);
    yes('S1 and has a cursor, whichever of the page and the close landed first',
        bad.cursor.length === 0); show(bad.cursor);
    yes('S1 #2384: the plugin never lowers and raises focus for the cursor (' + repaired + ' of ' +
        variants.length + ' orders)', repaired === 0);
    yes('S1 the log says how long after J the book opened and how long it took to go',
        bad.measured.length === 0); show(bad.measured);
    yes('S1 closing ours leaves no book, no cursor and the keyboard with the game',
        bad.after.length === 0); show(bad.after);
    yes('S1 nothing threw', bad.threw.length === 0); show(bad.threw);
  }

  // ---------------------------------------------- S2: Escape, as it always was
  {
    let ok = true, none = true;
    [false, true].forEach(function (spFirst) {
      const h = rig({ spFirst: spFirst });
      h.press(ESC);
      h.run(120);
      if (h.game.open[JOURNAL] !== 'System') { ok = false; }
      if (h.game.shut.length) { none = false; }
    });
    yes('S2 Escape opens the game\'s System page and it stays open', ok);
    yes('S2 and nothing here closes anything', none);
  }

  // --------------------------------- S3: Escape straight after J is still Escape
  {
    // The game took J, but the page never answered, so the keyboard stayed
    // with the game and the next key is the game's.
    const h = rig({ pageDelay: Infinity });
    h.press(J);
    h.run(2);
    h.press(ESC);
    h.run(120);
    yes('S3 Escape pressed a moment after J opens the System page and it stays',
        h.game.open[JOURNAL] === 'System');

    // The game ignored J (its journal control off), so nothing used up the
    // press and only the key that went down after it can disarm it.
    const r = rig({ refuse: true, pageDelay: Infinity });
    r.press(J);
    r.run(1);
    r.press(ESC);
    r.run(120);
    yes('S3 and when J opened nothing, Escape a frame later is still not shut',
        r.game.open[JOURNAL] === 'System' && r.game.shut.length === 0);

    // No key at all after J: the claim runs out.
    const q = rig({ refuse: true, pageDelay: Infinity });
    q.press(J);
    q.run(100);
    q.scriptOpens();
    q.run(60);
    yes('S3 and a book opened by something else well after J is left alone',
        q.game.open[JOURNAL] === 'Quests' && q.game.shut.length === 0);
  }

  // ------------------------------- S4: the game's journal moved off J, to U
  {
    const h = rig({ controls: { 36: '', 22: 'Journal' } });
    h.press(J);
    h.run(60);
    yes('S4 with the game\'s journal on U, J opens ours and shuts nothing',
        h.page.shown && !h.game.open[JOURNAL] && h.game.shut.length === 0);
    h.press(ESC);
    h.run(30);
    h.press(U);
    h.run(120);
    yes('S4 and U opens the game\'s journal, which stays',
        h.game.open[JOURNAL] === 'Quests' && h.game.shut.length === 0 && !h.page.shown);
    // Until #1652 this harness typed its keys and had no MANEUVER_KEY, so U
    // threw inside the handler and the checks above passed on the throw.
    yes('S4 and nothing threw', h.threw.length === 0); show(h.threw);

    const n = rig({ controls: { 36: '', 22: 'Journal' }, noNames: true });
    n.press(J);
    n.run(60);
    n.press(ESC);
    n.run(30);
    n.press(U);
    n.run(120);
    yes('S4 the same when the key arrives without a control name',
        n.game.shut.length === 0 && n.game.open[JOURNAL] === 'Quests');

    // J is not the game's journal here, so a book that something else opens
    // straight after it is not J's to shut.
    const s = rig({ controls: { 36: '', 22: 'Journal' } });
    s.press(J);
    s.run(2);
    s.scriptOpens();
    s.run(60);
    yes('S4 and a book something else opens just after that J is left alone',
        s.game.open[JOURNAL] === 'Quests' && s.game.shut.length === 0);
  }

  // ------------------------------- S5: ours moved off J in Thornswood.ini, to U
  {
    const h = rig({ journalKey: U });
    h.press(J);
    h.run(120);
    yes('S5 with ours on U, J opens the game\'s journal as before, and it stays',
        h.game.open[JOURNAL] === 'Quests' && h.game.shut.length === 0 && !h.page.shown);
    h.press(ESC);   // the book's own way out
    h.run(30);
    h.press(U);
    h.run(60);
    yes('S5 and U opens ours with nothing shut',
        h.page.shown && !h.game.open[JOURNAL] && h.game.shut.length === 0);
  }

  // ------------------------------ S6: no control names on any key at all
  {
    const h = rig({ noNames: true });
    h.press(J);
    h.run(60);
    yes('S6 without names, J is still known by the game\'s mapped key, and shut',
        h.page.shown && !h.game.open[JOURNAL] && h.game.shut.length === 1);
    const e = rig({ noNames: true });
    e.press(ESC);
    e.run(120);
    yes('S6 and Escape without a name still opens the System page, which stays',
        e.game.open[JOURNAL] === 'System' && e.game.shut.length === 0);
  }

  // ------------------------------------ S7: our panel is not there to open
  {
    const h = rig({ noPanel: true });
    h.press(J);
    h.run(120);
    yes('S7 our panel never mounted: J opens the game\'s journal and leaves it',
        h.game.open[JOURNAL] === 'Quests' && h.game.shut.length === 0);

    const n = rig({ notReady: true });
    n.press(J);
    n.run(120);
    yes('S7 and before the overlays are in, the same',
        n.game.open[JOURNAL] === 'Quests' && n.game.shut.length === 0);

    // The page reloads: the panel is gone until it says it is in again.
    const r = rig();
    r.game.tasks.push(['browserMessage', { arguments: ['thornswood-front', 'bridge is up'] }]);
    r.run(2);
    r.press(J);
    r.run(120);
    yes('S7 and after the page reloads without it, the same',
        r.game.open[JOURNAL] === 'Quests' && r.game.shut.length === 0);
    r.press(ESC);   // to our page, which closes
    r.run(30);
    r.press(ESC);   // to the game's book, which closes
    r.run(30);
    r.game.tasks.push(['browserMessage', { arguments: ['thornswood-front', 'journal:ready'] }]);
    r.run(2);
    r.press(J);
    r.run(60);
    yes('S7 until it is back, and then J is ours alone again',
        !r.game.open[JOURNAL] && r.game.shut.length === 1);

    // The plugin came back after the page had already said ready, so it
    // never heard it. The panel opening tells it instead, from the next J on.
    const m = rig({ noPanel: true });
    m.press(J);
    m.run(60);
    yes('S7 a plugin that missed ready leaves the first J as it was',
        m.page.shown && m.game.open[JOURNAL] === 'Quests' && m.game.shut.length === 0);
    m.press(ESC);   // to our page, which closes
    m.run(30);
    m.press(ESC);   // to the game's book, which closes
    m.run(30);
    m.press(J);
    m.run(60);
    yes('S7 and learns from our panel opening, so the next J is ours alone',
        m.page.shown && !m.game.open[JOURNAL] && m.game.shut.length === 1);
  }

  // ------------------------------ S8: J while the System page is already up
  {
    const h = rig();
    h.press(ESC);
    h.run(30);
    h.press(J);
    h.run(60);
    yes('S8 J on the System page closes the book the game\'s way, opens ours, shuts nothing',
        !h.game.open[JOURNAL] && h.page.shown && h.game.shut.length === 0);
    h.press(ESC);   // to our page, which closes
    h.run(30);
    h.press(ESC);   // to the game
    h.run(120);
    yes('S8 and the next Escape opens the System page again, which stays',
        h.game.open[JOURNAL] === 'System' && h.game.shut.length === 0);
  }

  // ------------------------- S9: Escape and J in the same frame, either order
  {
    // Escape first: the game opens its book for Escape, and J's press lands
    // on a book that is already on its way. That book may be the System page,
    // so it is left alone.
    let ok = true;
    [false, true].forEach(function (spFirst) {
      const h = rig({ spFirst: spFirst });
      h.press(ESC);
      h.press(J);
      h.run(120);
      if (h.game.open[JOURNAL] !== 'System' || h.game.shut.length) { ok = false; }
    });
    yes('S9 Escape then J in the same frame: the System page opens and stays', ok);

    // J first: Escape went down after it, so the book is Escape's to keep.
    const h = rig();
    h.press(J);
    h.press(ESC);
    h.run(120);
    yes('S9 J then Escape in the same frame: nothing is shut',
        h.game.shut.length === 0 && !!h.game.open[JOURNAL]);
  }

  // --------------------------- S10: the book ignores the first close
  {
    const h = rig({ stubborn: 1 });
    h.press(J);
    h.run(120);
    yes('S10 a book that ignored the first close is asked once more and goes',
        !h.game.open[JOURNAL] && h.game.shut.length === 2);
    yes('S10 and our journal is still the one on screen, with a cursor',
        h.page.shown && h.game.focus && !!h.game.open[CURSOR]);
    yes('S10 and the log says how long it took', h.said('was gone 1'));
  }

  // --------------------------- S11: the book will not close at all
  {
    const h = rig({ stubborn: 50 });
    h.press(J);
    h.run(200);
    yes('S11 a book that never closes is asked twice and no more',
        h.game.shut.length === 2);
    yes('S11 and that is said in the log', h.said('is still open'));
    h.run(300);
    yes('S11 and nothing keeps asking after', h.game.shut.length === 2);
    yes('S11 nothing threw', h.threw.length === 0);
  }

  // ------------- S12: a key after the shut is the person's, not the retry's
  {
    // The book ignored the close and our page never answered, so the keyboard
    // is with the game. The person shuts the book themselves with Escape and
    // presses Escape again for the System page. The second close must not
    // land on it.
    const h = rig({ stubborn: 1, pageDelay: Infinity });
    h.press(J);
    h.run(3);
    h.press(ESC);
    h.run(10);
    yes('S12 Escape closed the book the game\'s way', !h.game.open[JOURNAL]);
    h.press(ESC);
    h.run(150);
    yes('S12 and the System page it opened next stays, with nothing asked again',
        h.game.open[JOURNAL] === 'System' && h.game.shut.length === 1);
  }

  // ------------------------------------ C1: THE FLASH, with the new client
  {
    const variants = [];
    [false, true].forEach(function (spFirst) {
      [0, 1].forEach(function (openLag) {
        [0, 1, 2, 4].forEach(function (pageDelay) {
          variants.push({ client: true, spFirst: spFirst, openLag: openLag, pageDelay: pageDelay });
        });
      });
    });
    const bad = { kept: [], ours: [], drawn: [], shut: [], focus: [], after: [], threw: [] };
    variants.forEach(function (v) {
      const h = rig(v);
      const name = JSON.stringify(v);
      const k = h.game.kept['Journal:' + J];
      if (!k || k.indexOf('InventoryMenu') < 0 || k.indexOf(JOURNAL) < 0) { bad.kept.push(name); }
      h.press(J);
      h.run(60);
      if (!h.page.shown) { bad.ours.push(name); }
      if (h.game.books.length !== 0) { bad.drawn.push(name); }
      if (h.game.shut.length !== 0) { bad.shut.push(name); }
      if (!h.game.focus || !h.game.open[CURSOR]) { bad.focus.push(name); }
      h.press(ESC);
      h.run(30);
      if (h.page.shown || h.game.focus || h.game.open[CURSOR] || h.game.open[JOURNAL]) { bad.after.push(name); }
      if (h.threw.length) { bad.threw.push(name + ' ' + h.threw[0]); }
    });
    const show = function (list) { list.slice(0, 3).forEach(function (n) { console.log('      ' + n); }); };
    yes('C1 once our panel is in, the client is told to keep J (as Journal) from the game, ' +
        'except over the game\'s own menus and its book', bad.kept.length === 0); show(bad.kept);
    yes('C1 J opens our journal, in all ' + variants.length + ' orders', bad.ours.length === 0); show(bad.ours);
    yes('C1 THE FLASH: the game\'s journal is never drawn, not for one frame',
        bad.drawn.length === 0); show(bad.drawn);
    yes('C1 so nothing is shut', bad.shut.length === 0); show(bad.shut);
    yes('C1 our journal holds the keyboard, with a cursor, without F6', bad.focus.length === 0); show(bad.focus);
    yes('C1 closing ours leaves no book, no cursor and the keyboard with the game',
        bad.after.length === 0); show(bad.after);
    yes('C1 nothing threw', bad.threw.length === 0); show(bad.threw);
  }

  // ------------------------------------------- C2: Escape is not on the list
  {
    let ok = true;
    [false, true].forEach(function (spFirst) {
      const h = rig({ client: true, spFirst: spFirst });
      h.press(ESC);
      h.run(120);
      if (h.game.open[JOURNAL] !== 'System' || h.game.shut.length) { ok = false; }
    });
    yes('C2 Escape opens the game\'s System page and it stays', ok);
  }

  // ----------------------------- C3: J over the game's own menus is the game's
  {
    const h = rig({ client: true });
    h.menu('InventoryMenu', true);
    h.press(J);
    h.run(60);
    yes('C3 J in the inventory opens the game\'s quest log as it always did, and not ours',
        h.game.open[JOURNAL] === 'Quests' && !h.page.shown && h.game.shut.length === 0);

    const s = rig({ client: true });
    s.press(ESC);
    s.run(30);
    s.press(J);
    s.run(60);
    yes('C3 J on the System page closes the book the game\'s way and opens ours',
        !s.game.open[JOURNAL] && s.page.shown && s.game.shut.length === 0);
  }

  // --------------------------------------------- C4: rebinds on either side
  {
    const h = rig({ client: true, controls: { 36: '', 22: 'Journal' } });
    h.press(J);
    h.run(60);
    yes('C4 with the game\'s journal on U, J opens ours and no book',
        h.page.shown && h.game.books.length === 0);
    h.press(ESC);
    h.run(30);
    h.press(U);
    h.run(120);
    yes('C4 and U still opens the game\'s journal, which stays',
        h.game.open[JOURNAL] === 'Quests' && h.game.shut.length === 0);

    const o = rig({ client: true, journalKey: U });
    o.press(J);
    o.run(120);
    yes('C4 with ours on U, J opens the game\'s journal as before, and it stays',
        o.game.open[JOURNAL] === 'Quests' && !o.page.shown && o.game.shut.length === 0);
    o.press(ESC);
    o.run(30);
    o.press(U);
    o.run(60);
    yes('C4 and U opens ours with no second book drawn',
        o.page.shown && o.game.books.length === 1 && !o.game.open[JOURNAL]);
  }

  // ------------------------------- C5: only while our panel is in and ready
  {
    const n = rig({ client: true, noPanel: true });
    const keptBefore = !!n.game.kept['Journal:' + J];
    n.press(J);
    n.run(120);
    yes('C5 our panel never mounted: J is not kept, the game\'s journal opens and stays',
        !keptBefore && n.game.open[JOURNAL] === 'Quests');

    const r = rig({ client: true, notReady: true });
    yes('C5 before the overlays are ready, J is not kept', !r.game.kept['Journal:' + J]);

    const p = rig({ client: true });
    p.game.tasks.push(['browserMessage', { arguments: ['thornswood-front', 'bridge is up'] }]);
    p.run(2);
    yes('C5 a page that reloads takes J off the list', !p.game.kept['Journal:' + J]);
    p.game.tasks.push(['browserMessage', { arguments: ['thornswood-front', 'journal:ready'] }]);
    p.run(2);
    yes('C5 and puts it back once our panel is in again', !!p.game.kept['Journal:' + J]);
  }

  // ---------------------------------- C6: the client is told only on a change
  {
    const h = rig({ client: true });
    h.run(200);
    h.press(J);
    h.run(60);
    const c = h.game.keptCalls.filter(function (entry) { return entry.userEvent === 'Journal'; });
    yes('C6 in 263 frames and a J the client is told twice: off at load, on when the panel is in',
        c.length === 2 && c[0].on === false && c[1].on === true &&
        c[1].userEvent === 'Journal' && c[1].code === J);
  }

  // ------------------------------------------ C7: a client without the list
  {
    const h = rig();
    h.run(100);
    yes('C7 a client without the list is said in the log once, and nothing throws',
        h.logs.filter(function (l) { return l.indexOf('could not keep J from the game') >= 0; }).length === 1 &&
        h.threw.length === 0);
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
