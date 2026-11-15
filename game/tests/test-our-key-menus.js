// test-our-key-menus.js
//
// P opens the party window and not the game's magic menu, / opens the chat,
// J shuts the game's journal as soon as it is up, and a panel of ours that
// holds the keyboard has a cursor. Issues 957 and 958.
//
// Patrick on dev, 28 September (launcher 1.1.102.4, pack 20260928-2029-dev):
// "The / to chat doesn't work", "P doesn't open party it opens magic",
// "J now opens the vanilla journal first", and "Journal doesn't make your
// cursor appear so I have to click F6". His front log for that session:
//   20:37:41.881 / seen, but StatsMenu is open
//   20:38:37.659 key 25 seen, but MagicMenu is open
//   20:39:27.207 J: the game's journal opened 37ms after the press and was
//                gone 41ms after it was shut
//   20:39:27.221 J: the game's journal took the cursor with it, raised it
//                again for ours
// and no cursor after that last line until F6.
//
// WHAT THIS RUNS. The real text of thornswood-front.js: the focus arbiter
// (claims down to the typing section), everything from
// the J block to the key handler (the J block, ourKeyMenu, the / block) and
// the key handler. Under them is a pretend game in the order that log shows:
//   - the game takes the key first. The menu it opens (Journal for J, Quick
//     Magic for P, Quick Stats for /) is in its menu stack, and raising the
//     cursor for itself, before the plugin hears the key;
//   - that menu's menuOpen reaches the plugin opts.eventLag frames later
//     (37ms in the log, two to five frames);
//   - a closeMenu is a hide the UI does next frame, and the closing menu
//     takes the cursor down with it whoever else wanted it;
//   - opts.cursorLate: the game takes the cursor down once more that many
//     frames after its menu went, which is what left Patrick with none after
//     the J block's one repair;
//   - browser.setFocused(true) raises the Cursor Menu only when it is not up
//     already, and setFocused(false) lowers it only when focus raised it
//     (BrowserApiTilted.cpp in the fork);
//   - since #2384 the fork also shows the Cursor Menu again, on the next UI
//     pass, when it closes under a focus that is still up (the Cursor Menu's
//     own close event, CursorFocus.h). The plugin no longer lowers and
//     raises focus to get it back.
//
// Run it against the code before the change with FRONT=<that file>: the P,
// / and cursor scenarios fail there.
//
// Read only.
const fs = require('fs');
const path = require('path');
const SRC = process.env.FRONT ||
            path.join(__dirname, '..', '..', 'game', 'plugins', 'thornswood-front.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

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
const middle = between(J_MARK, KEYS_OPEN);
const ka = src.indexOf(KEYS_OPEN);
const kb = ka < 0 ? -1 : src.indexOf(SHUT, ka);
const keys = (ka >= 0 && kb >= 0) ? src.slice(ka, kb + SHUT.length) : null;

yes('the focus arbiter is in the plugin', arbiter !== null);
yes('the J block, the / block and the rest up to the key handler are in the plugin', middle !== null);
yes('the key handler is in the plugin', keys !== null);
yes('#2384: no keepCursor, and nothing in the plugin calls it',
    !/keepCursor|CURSOR_TRIES|CURSOR_AGAIN_MS|cursorTries/.test(src));
yes('#2384: no lower and raise of focus to bring the cursor back, and no log line for one',
    !/raised it again/.test(src) &&
    !/setFocused\(false\);\s*sp\.browser\.setFocused\(true\)/.test(src));

const JOURNAL = 'Journal Menu', MAGIC = 'MagicMenu', STATS = 'StatsMenu', CURSOR = 'Cursor Menu';
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

const J = KEY.JOURNAL_KEY, P = KEY.PARTY_KEY, SLASH = KEY.COMMAND_KEY, ESC = KEY.ESC, K = KEY.SKILLS_KEY;
yes('the plugin declares every key the handler reads', !!keys &&
    (keys.match(/\b(?:[A-Z]+_)*KEY\b|\bESC\b/g) || []).every(function (k) { return typeof KEY[k] === 'number'; }));
const MENU_FOR = { 'Journal': JOURNAL, 'Quick Magic': MAGIC, 'Quick Stats': STATS, 'Pause': JOURNAL };

function rig(opts) {
  opts = opts || {};
  const clock = { t: 7000000 };
  const game = {
    frame: 0, open: {}, ui: [], closing: [], tasks: [], shut: [], history: [],
    focus: false, cursorByFocus: false, cursorTakes: [], cursorBack: [],
    controls: Object.assign({ 36: 'Journal', 1: 'Pause', 25: 'Quick Magic', 53: 'Quick Stats' }, opts.controls || {})
  };
  const page = { pending: [], shown: {}, typed: [] };
  const logs = [], threw = [];
  const handlers = {};

  function later(frames, task) { game.tasks.push({ due: game.frame + frames, task: task }); }

  // The game puts a menu up at once, raising the cursor for itself, and
  // tells the plugins opts.eventLag frames later.
  function gameOpens(menu, page_) {
    if (game.open[menu]) { return; }
    game.open[menu] = page_ || true;
    game.history.push({ menu: menu, page: page_, openedAt: game.frame, closedAt: -1 });
    if (!game.open[CURSOR]) { game.open[CURSOR] = true; }
    later(opts.eventLag === undefined ? 2 : opts.eventLag, ['menuOpen', { name: menu }]);
  }
  function gameCloses(menu) {
    if (!game.open[menu]) { return; }
    delete game.open[menu];
    game.history.forEach(function (h) { if (h.menu === menu && h.closedAt < 0) { h.closedAt = game.frame; } });
    cursorGone();
    if (opts.cursorLate) { game.cursorTakes.push(game.frame + opts.cursorLate); }
    later(0, ['menuClose', { name: menu }]);
  }

  // The Cursor Menu taken down by something that is not our focus. The fork
  // (#2384) answers it from the close event: shown again next pass while
  // focus is still up.
  function cursorGone() {
    if (!game.open[CURSOR]) { return; }
    delete game.open[CURSOR];
    game.cursorByFocus = false;
    if (game.focus) { game.cursorBack.push(game.frame + 1); }
  }

  const sp = {
    on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    Ui: { isMenuOpen: function (n) { return !!game.open[n]; } },
    Utility: { isInMenuMode: function () { return Object.keys(game.open).some(function (k) { return k !== CURSOR; }); } },
    TESModPlatform: { closeMenu: function (n) { game.shut.push(n); game.ui.push(['hide', n]); } },
    Input: {
      getMappedKey: function (control) {
        for (const k in game.controls) { if (game.controls[k] === control) { return Number(k); } }
        return -1;
      },
      getNumKeysPressed: function () { return 0; },
      isKeyPressed: function () { return false; }
    },
    browser: {
      isFocused: function () { return game.focus; },
      isVisible: function () { return true; },
      setVisible: function () { },
      setFocused: function (v) {
        v = !!v;
        if (game.focus === v) { return; }
        game.focus = v;
        if (v) {
          if (!game.open[CURSOR]) { game.open[CURSOR] = true; game.cursorByFocus = true; }
        } else if (game.cursorByFocus) {
          delete game.open[CURSOR];
          game.cursorByFocus = false;
        }
      }
    }
  };

  function tell(what) { later(0, ['browserMessage', { arguments: ['thornswood-front', what] }]); }

  const T = {
    ready: true,
    js: function (s) {
      const delay = opts.pageDelay === undefined ? 1 : opts.pageDelay;
      const m = /thornswood(Party|Journal)\.toggle/.exec(s);
      if (m) { page.pending.push({ due: game.frame + delay, panel: m[1].toLowerCase() }); }
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

  const prelude =
    'let keysSeen = 0, sawAnyKey = true;\n' +
    'function rememberKey() { }\n' +
    'function wantTyping(on, fill) { typed.push([on, fill]); }\n' +
    'function lookVerb() { }\n' +
    'function tellServer() { }\n' +
    'function log() { }\n' +
    'function moldPress() { return false; }\n' +
    // The sleep key is the mold's, on a person (#1603). Nobody is looked at here.
    'function sleepPress() { return false; }\n' +
    // Hand over the letter (#1595), Activate on somebody you carry a letter
    // for. Nobody is looked at here; test-1595-deliver.js has the press.
    'function deliverPress() { return false; }\n' +
    // P on somebody not in your party asks them in (#1629). opts.asks puts
    // such a person under the crosshair; test-1629-party-gui.js has the ask.
    'function partyPress() { ' +
    (opts.asks ? 'say("asked the person looked at"); return true;' : 'return false;') + ' }\n' +
    // The same key in the inventory (#1384); no inventory is open here.
    'function repairPress() { return false; }\n' +
    'function furniturePress() { return false; }\n' +
    'function arrangePress() { return false; }\n' +
    // The lock key, X, since #1472, asked only for its own scan code. What it
    // does is test-lock-keypress.js's business.
    'function lockPress() { return false; }\n' +
    // Tend their wounds (#1383), X on a hurt person, and Tend your wounds,
    // H in the inventory. Nobody is looked at and no inventory is open
    // here; test-1383-treatments.js has what they do.
    'function treatPress() { return false; }\nfunction treatSelfPress() { return false; }\n' +
    // A warrior's maneuver key (#1386), 9, scan code 10, which nothing here
    // presses. test-1386-warrior.js has what it does.
    'function maneuverKeyPressed() { }\n' +
    // The help key (#1633), F7, scan code 65, which nothing here presses.
    // test-1633-help-panel.js has what it does.
    'function helpKeyPressed() { }\n' +
    // K on a person a Master could take on (#1634), asked ahead of K; nobody
    // is looked at here. test-1634-apprentice-gui.js has what it does.
    'function apprenticePress() { return false; }\n' +
    keyPrelude('');
  const api = new Function('sp', 'say', 'T', 'Date', 'guard', 'typed',
    prelude + arbiter + '\n' + middle + '\n' + keys +
    '\nreturn { claims: claims, applyFocus: applyFocus };')(
    sp, say, T, { now: function () { return clock.t; } }, guard, page.typed);

  // The plugin's main browserMessage handler, the lines that move the claims.
  sp.on('browserMessage', function (event) {
    const w = event.arguments[1];
    const m = /^(party|journal):(opened|closed)$/.exec(w);
    if (m) { T.claimFocus(m[1], m[2] === 'opened'); }
  });

  function fire(ev, data) { (handlers[ev] || []).forEach(function (fn) { fn(data); }); }

  function frame() {
    game.frame++;
    clock.t += 7;   // 144 frames a second
    game.ui.splice(0).forEach(function (m) { if (m[0] === 'hide') { gameCloses(m[1]); } });
    if (game.cursorTakes.length && game.cursorTakes[0] <= game.frame) {
      game.cursorTakes.shift();
      cursorGone();
    }
    if (game.cursorBack.length && game.cursorBack[0] <= game.frame) {
      game.cursorBack.shift();
      if (game.focus && !game.open[CURSOR]) { game.open[CURSOR] = true; game.cursorByFocus = true; }
    }
    fire('update');
    // The tick: applyFocus.
    api.applyFocus();
    const due = game.tasks.filter(function (t) { return t.due <= game.frame; });
    game.tasks = game.tasks.filter(function (t) { return t.due > game.frame; });
    due.forEach(function (t) { fire(t.task[0], t.task[1]); });
    game.closing.splice(0).forEach(gameCloses);
    page.pending = page.pending.filter(function (p) {
      if (p.due > game.frame) { return true; }
      page.shown[p.panel] = !page.shown[p.panel];
      tell(p.panel + ':' + (page.shown[p.panel] ? 'opened' : 'closed'));
      return false;
    });
  }

  const h = {
    game: game, page: page, logs: logs, threw: threw, api: api, takeCursor: cursorGone,
    press: function (code) {
      if (game.focus) {
        if (code === ESC) {
          ['party', 'journal'].forEach(function (p) {
            if (page.shown[p]) { page.shown[p] = false; tell(p + ':closed'); }
          });
        }
        return;
      }
      const control = game.controls[code] || '';
      const menu = MENU_FOR[control];
      if (menu) {
        // The game's own key toggles its own menu. A closing menu is still
        // open through its close animation, so it goes after the plugin has
        // heard the key.
        if (game.open[menu]) { game.closing.push(menu); }
        else { gameOpens(menu, control === 'Pause' ? 'System' : control); }
      }
      later(0, ['buttonEvent', { code: code, userEventName: control, isDown: true, isUp: false }]);
      later(0, ['buttonEvent', { code: code, userEventName: control, isDown: false, isUp: true }]);
    },
    menuUp: function (menu) { gameOpens(menu, 'own'); },
    run: function (n) { for (let i = 0; i < n; i++) { frame(); } },
    said: function (re) { return logs.some(function (l) { return re.test(l); }); },
    was: function (menu) { return game.history.filter(function (x) { return x.menu === menu; }); }
  };
  tell('journal:ready');
  h.run(3);
  return h;
}

function orders() {
  const out = [];
  [0, 1, 2, 5].forEach(function (eventLag) {
    [0, 1, 3].forEach(function (pageDelay) {
      [0, 3, 40].forEach(function (cursorLate) {
        out.push({ eventLag: eventLag, pageDelay: pageDelay, cursorLate: cursorLate });
      });
    });
  });
  return out;
}

if (arbiter !== null && middle !== null && keys !== null) {
  // -------------------------------------------------- P1: THE BUG, issue 957
  {
    const bad = { party: [], magic: [], refused: [], focus: [], cursor: [], threw: [], after: [] };
    const all = orders();
    all.forEach(function (o) {
      const h = rig(o);
      const name = JSON.stringify(o);
      h.press(P);
      h.run(120);
      if (!h.page.shown.party) { bad.party.push(name); }
      const m = h.was(MAGIC);
      // Up just before the key is heard (openedAt + 1), shut in the next
      // update, gone in the UI pass after: three frames from openedAt.
      if (h.game.open[MAGIC] || !m.length || m[0].closedAt < 0 || m[0].closedAt - m[0].openedAt > 3) {
        bad.magic.push(name + ' ' + JSON.stringify(m));
      }
      if (h.said(/MagicMenu is open/)) { bad.refused.push(name); }
      if (!h.game.focus) { bad.focus.push(name); }
      if (!h.game.open[CURSOR]) { bad.cursor.push(name); }
      if (h.threw.length) { bad.threw.push(name + ' ' + h.threw[0]); }
      h.press(ESC);
      h.run(40);
      if (h.page.shown.party || h.game.focus || h.game.open[CURSOR] || h.game.open[MAGIC]) { bad.after.push(name); }
    });
    function show(list) { list.slice(0, 3).forEach(function (n) { console.log('      ' + n); }); }
    yes('P1 THE BUG: P opens the party window, in all ' + all.length + ' orders', bad.party.length === 0); show(bad.party);
    yes('P1 and the magic menu the same press opened is gone two frames after the key is heard',
        bad.magic.length === 0); show(bad.magic);
    yes('P1 the log never says the magic menu was in the way', bad.refused.length === 0); show(bad.refused);
    yes('P1 the party window holds the keyboard', bad.focus.length === 0); show(bad.focus);
    yes('P1 and has a cursor, even after the magic menu took it down on its way out',
        bad.cursor.length === 0); show(bad.cursor);
    yes('P1 closing it leaves no menu, no cursor and the keyboard with the game', bad.after.length === 0); show(bad.after);
    yes('P1 nothing threw', bad.threw.length === 0); show(bad.threw);
  }

  // ------------------------- P2: the magic menu was already up, P is the game's
  {
    const h = rig();
    h.menuUp(MAGIC);
    h.run(400);
    h.press(P);
    h.run(60);
    yes('P2 P over a magic menu that was up already closes it the game\'s way and opens nothing',
        !h.page.shown.party && !h.game.open[MAGIC] && h.game.shut.length === 0);
    yes('P2 and the log says the magic menu was open', h.said(/MagicMenu is open/));
  }

  // ------------------------------- P3: Quick Magic moved to another key
  {
    const h = rig({ controls: { 25: '', 48: 'Quick Magic' } });
    h.press(P);
    h.run(60);
    yes('P3 with Quick Magic off P, P opens the party window and shuts nothing',
        h.page.shown.party && h.game.shut.length === 0);
    h.press(ESC);
    h.run(30);
    h.press(48);
    h.run(60);
    yes('P3 and the magic menu on its own key stays', !!h.game.open[MAGIC] && h.game.shut.length === 0);
  }

  // ------------------------- P4: a key in the same frame after P is its own
  {
    const h = rig({ pageDelay: Infinity });
    h.press(P);
    h.press(K);
    h.run(60);
    yes('P4 a key pressed with P in the same frame ends P\'s claim: nothing is shut', h.game.shut.length === 0);
  }

  // ------------- P5: P on somebody not in the party asks, the menu still goes
  /*
    #1629. P on somebody who is not in your party sends the ask instead of
    opening the panel. The game took the same press as Quick Magic, and the
    ask must not leave that menu open.
  */
  {
    const bad = { asked: [], panel: [], magic: [], refused: [], threw: [] };
    const all = orders();
    all.forEach(function (o) {
      const h = rig(Object.assign({ asks: true }, o));
      const name = JSON.stringify(o);
      h.press(P);
      h.run(120);
      if (!h.said(/asked the person looked at/)) { bad.asked.push(name); }
      if (h.page.shown.party || h.game.focus) { bad.panel.push(name); }
      const m = h.was(MAGIC);
      if (h.game.open[MAGIC] || !m.length || m[0].closedAt < 0 || m[0].closedAt - m[0].openedAt > 3) {
        bad.magic.push(name + ' ' + JSON.stringify(m));
      }
      if (h.said(/MagicMenu is open/)) { bad.refused.push(name); }
      if (h.threw.length) { bad.threw.push(name + ' ' + h.threw[0]); }
    });
    function show(list) { list.slice(0, 3).forEach(function (n) { console.log('      ' + n); }); }
    yes('P5 P on somebody not in the party asks them, in all ' + all.length + ' orders', bad.asked.length === 0); show(bad.asked);
    yes('P5 and opens no panel and takes no keyboard', bad.panel.length === 0); show(bad.panel);
    yes('P5 and the magic menu the same press opened is gone two frames after the key is heard',
        bad.magic.length === 0); show(bad.magic);
    yes('P5 the log never says the magic menu was in the way', bad.refused.length === 0); show(bad.refused);
    yes('P5 nothing threw', bad.threw.length === 0); show(bad.threw);
  }

  // ------------------------------------------ S1: / in the same fork order
  {
    const bad = [];
    [0, 1, 2, 5].forEach(function (eventLag) {
      const h = rig({ eventLag: eventLag });
      h.press(SLASH);
      h.run(60);
      const ok = h.page.typed.length === 1 && h.page.typed[0][1] === '/' &&
                 !h.game.open[STATS] && h.game.shut.join() === STATS && !h.said(/StatsMenu is open/);
      if (!ok) { bad.push(eventLag + ' ' + JSON.stringify(h.page.typed) + ' ' + h.game.shut.join()); }
    });
    yes('S1 THE BUG: / opens the chat with a slash and the skill tree is shut, whatever the lag', bad.length === 0);
    bad.slice(0, 3).forEach(function (n) { console.log('      ' + n); });
  }

  // ---------------------------------------------- J1: issue 958, the book
  {
    const bad = { ours: [], book: [], early: [], cursor: [], threw: [] };
    // The lag the log measured: 37ms, five frames at 144 a second.
    const all = orders().filter(function (o) { return o.eventLag === 5; });
    all.forEach(function (o) {
      const h = rig(o);
      const name = JSON.stringify(o);
      h.press(J);
      h.run(120);
      if (!h.page.shown.journal) { bad.ours.push(name); }
      if (h.game.open[JOURNAL] || h.game.shut.join() !== JOURNAL) { bad.book.push(name); }
      const b = h.was(JOURNAL)[0];
      // Heard at openedAt + 1, shut in the next update, gone in the UI pass
      // after, not held until its menuOpen came five frames later.
      if (!b || b.closedAt < 0 || b.closedAt - b.openedAt > 3) { bad.early.push(name + ' ' + JSON.stringify(b)); }
      if (!h.game.focus || !h.game.open[CURSOR]) { bad.cursor.push(name); }
      if (h.threw.length) { bad.threw.push(name + ' ' + h.threw[0]); }
    });
    function show(list) { list.slice(0, 3).forEach(function (n) { console.log('      ' + n); }); }
    yes('J1 J opens our journal in all ' + all.length + ' orders', bad.ours.length === 0); show(bad.ours);
    yes('J1 and shuts the game\'s book once', bad.book.length === 0); show(bad.book);
    yes('J1 THE BUG: the book is gone two frames after J is heard, not after its menuOpen arrives',
        bad.early.length === 0); show(bad.early);
    yes('J1 THE BUG: and our journal has the keyboard and a cursor, even when the game takes the cursor again later',
        bad.cursor.length === 0); show(bad.cursor);
    yes('J1 nothing threw', bad.threw.length === 0); show(bad.threw);
  }

  // ----------------------------- J2: Escape's System page, and J over it
  {
    const h = rig();
    h.press(ESC);
    h.run(120);
    yes('J2 Escape opens the System page and it stays', h.game.open[JOURNAL] === 'System' && h.game.shut.length === 0);
    h.press(J);
    h.run(60);
    yes('J2 J on a System page that was up already closes it the game\'s way and shuts nothing',
        !h.game.open[JOURNAL] && h.game.shut.length === 0);
    const e = rig({ pageDelay: Infinity });
    e.press(J);
    e.press(ESC);
    e.run(120);
    yes('J2 Escape in the same frame after J: nothing is shut', e.game.shut.length === 0);
  }

  // ----------------------------------------------- C1: the cursor, alone
  {
    const h = rig();
    T_claim(h, 'party', true);
    h.run(5);
    yes('C1 a claim gets the keyboard and a cursor', h.game.focus && !!h.game.open[CURSOR]);
    let flips = 0;
    for (let i = 0; i < 10; i++) { h.takeCursor(); h.run(3); if (h.game.open[CURSOR]) { flips++; } }
    yes('C1 a cursor something else takes while a claim holds the keyboard comes back, every time (the fork, #2384)',
        flips === 10);
    yes('C1 and the plugin did not lower and raise focus for it', !h.said(/raised it again/) && h.game.focus);
    T_claim(h, 'party', false);
    h.run(5);
    yes('C1 the claim let go takes focus and the cursor down', !h.game.focus && !h.game.open[CURSOR]);
  }
  {
    const h = rig();
    T_claim(h, 'party', true);
    h.run(5);
    h.menuUp(MAGIC);
    h.run(1);
    h.takeCursor();
    h.run(20);
    yes('C2 a game menu up over a claim: the plugin still does nothing to the cursor', !h.said(/raised it again/));
  }
  {
    const h = rig();
    h.takeCursor();
    h.run(20);
    yes('C3 no claim, no focus: nothing is raised', !h.game.focus && !h.game.open[CURSOR]);
  }
}

// A claim as the page's message would make it.
function T_claim(h, who, on) {
  h.game.tasks.push({ due: 0, task: ['browserMessage', { arguments: ['thornswood-front', who + ':' + (on ? 'opened' : 'closed')] }] });
  h.run(1);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
