// test-select-focus.js
//
// The character choice at the main menu keeps its keyboard for as long as it
// is up, never sits over the world without one, and the two minute cap closes
// the window whose claim it takes, by that window's own name.
//
// Djinn on dev, 24 September: "Sitting on the character select window for too
// long causes you to lose your cursor, pressing F6 doesn't work, and you have
// to esc to quit".
//
// WHAT HAPPENED, read out of the code rather than guessed. Our fork of
// skymp5-client waits at the menu for the page's pick and after three minutes
// (menuChoiceFallbackMs, 180000, in authService.ts) logs in as the last
// character. The world loads under a choice nobody made: the page was never
// acked, the list the launcher wrote was still on disk, and the plugin's world
// path dropped focus and reloaded the page, which drew the choice again. A
// full screen choice over the world, no cursor, a click nobody listens for.
// The game had the keyboard, so Escape reached the System page, and F6 was put
// back down by applyFocus on its next pass.
//
// It was not the two minute F6 cap the To Do List entry named. Update does not
// fire at the main menu, so applyFocus never runs there: two logs on this
// machine from 23 September have no pulse, no frame line and no F6 line
// between the choice going up and the pick. S2 runs that model, and runs the
// worst case beside it, update firing at the menu as well, so nothing on
// update can take the choice's keyboard even if it ever did fire there.
//
// WHAT THIS RUNS. The real text of four pieces of thornswood-front.js: the
// focus arbiter (claims, applyFocus, T.claimFocus), the main menu block (the
// menu tick, menuWhere, menuChose and what follows them), the lines the update
// tick runs when the world arrives, and the two minute cap loop. Around them:
//   - the client, from the fork's browserService.ts and authService.ts: F6 is
//     refused while the Main Menu or a load screen is up, Escape drops focus,
//     a pick logs in, and three minutes without one logs in as the fallback;
//   - the page: index.html draws the choice from the list on disk, beats every
//     two seconds, hides on its ack or its close, and a loadUrl only lands on
//     the next mouse move (Tilted applies it in its mouse move handler);
//   - the panels, each of which answers its own close with '<name>:closed'.
//
// Run it against the code before the change with FRONT=<that file>: the choice
// is left over the world, the select claim does not exist, and the cap closes
// nothing for a party, journal or trade window and three windows for skills.
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

const FOCUS = '  // ---------------------------------------------------------------- focus --';
const TYPING = '  // ---------------------------------------------------------------- typing --';
const ARBITER = between('  const claims = {};', TYPING);
const MENU = between("  sp.on('tick', guard('menu', () => {", FOCUS);
const CAP = between('    for (const who in claimedAt) {', '    checkServer(now);');
const WORLD_START = '      // The world is up, so the main menu block above stands down for';
const WORLD_END = '      phase = 1; at = now;';
const WORLD = between(WORLD_START, WORLD_END);

yes('the focus arbiter is in the plugin', ARBITER !== null);
yes('the main menu block is in the plugin', MENU !== null);
yes('the two minute cap is in the plugin', CAP !== null);
yes('the lines the update tick runs when the world arrives are in the plugin', WORLD !== null);

// The rig delivers the page's messages the way the plugin's browserMessage
// handler does, so those lines are checked to still be what the plugin does.
const DISPATCH = [
  "if (a[0] === 'thornswood' && a[1] === 'select') {",
  'if (id > 0) { menuChose(id); }',
  "menuWhere(parts[1] || '', parts[2] || '');",
  "if (what.indexOf('select:') === 0) {",
  'menuBeatAt = Date.now();'
];
['party', 'journal', 'trade', 'skills'].forEach(function (p) {
  DISPATCH.push("if (what === '" + p + ":opened') { T.claimFocus('" + p + "', true); return; }");
  DISPATCH.push("if (what === '" + p + ":closed') { T.claimFocus('" + p + "', false); return; }");
});
yes('the plugin hands the page\'s messages over the way this rig does',
    DISPATCH.every(function (l) { return src.indexOf(l) >= 0; }));
// And after the lifted world lines the tick loads the page and drops focus,
// which the rig does in the same order.
{
  const at = src.indexOf(WORLD_END);
  const after = at < 0 ? '' : src.slice(at, at + 400);
  yes('the world path then loads the page and drops focus, as the rig does',
      after.indexOf('sp.browser.loadUrl(UI_URL);') >= 0 &&
      after.indexOf('sp.browser.setFocused(false);') >= 0);
}

const FRAME = 16;
const FALLBACK_MS = 180000;          // menuChoiceFallbackMs in the fork's authService.ts
const PAGE = 'file:///C:/Thornswood/Game/Data/Platform/UI/index.html';
const LAST = 1247972239;             // the settings' profileId, the last character played
const PICK = 700151273;
const PANELS = { skills: 'thornswoodSkills', party: 'thornswoodParty',
                 journal: 'thornswoodJournal', trade: 'thornswoodTrade' };

/*
  opts.fallback       the settings' profileId the client falls back to; 0 for none
  opts.updateAtMenu   the worst case: update fires at the menu too, and runs
                      applyFocus and the cap there every frame
  opts.world          start in the world, with no choice on disk
*/
function rig(opts) {
  opts = opts || {};
  const clock = { t: 5000000 };
  const start = clock.t;
  const logs = [], threw = [], closes = [], jsSaid = [];
  const handlers = {};
  const inbox = [];

  const game = {
    stage: opts.world ? 'world' : 'menu',
    open: opts.world ? {} : { 'Main Menu': true },
    systemPage: false,
    loadingAt: 0
  };
  const browser = { focused: false, actualFocused: false, visible: false, pendingUrl: null, drops: 0, raises: 0 };
  const page = {
    list: !opts.world, choice: !opts.world, picked: 0, acked: false, ackAt: 0,
    beatAt: start, panels: {}
  };
  const client = {
    waiting: !opts.world, since: start, fallback: opts.fallback || 0, loginAt: 0
  };
  const world = { uncaused: 0 };

  function tell(a) { inbox.push(a); }

  const sp = {
    on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    Ui: { isMenuOpen: function (n) { return !!game.open[n]; } },
    Utility: { isInMenuMode: function () { return Object.keys(game.open).length > 0; } },
    browser: {
      isFocused: function () { return browser.focused; },
      setFocused: function (v) {
        v = !!v;
        if (browser.focused && !v) { browser.drops++; }
        if (!browser.focused && v) { browser.raises++; }
        browser.focused = v;
        browser.actualFocused = v;
      },
      isVisible: function () { return browser.visible; },
      setVisible: function (v) {
        browser.visible = !!v;
        // NirnLab hides also remove native focus. SkyrimPlatform's getter
        // continues returning its separate wantedIsFocused value.
        if (opts.nirnlab && !v) { browser.actualFocused = false; }
      },
      loadUrl: function (u) { browser.pendingUrl = u; return true; }
    }
  };

  const T = {
    js: function (s) {
      jsSaid.push(s);
      const m = /window\.(thornswood[A-Za-z]+)\.close\(\)/.exec(s);
      if (m) {
        closes.push(m[1]);
        if (m[1] === 'thornswoodSelect') { page.choice = false; }
        for (const p in PANELS) {
          if (PANELS[p] === m[1] && page.panels[p]) {
            page.panels[p] = false;
            tell(['thornswood-front', p + ':closed']);
          }
        }
      }
      if (s.indexOf('"where "+location.href') >= 0) {
        tell(['thornswood-front', 'where ' + PAGE + ' ' + (page.choice ? 'select' : 'bare')]);
      }
      if (s.indexOf('thornswoodSelect.acked') >= 0 && !page.acked) {
        page.acked = true;
        page.ackAt = clock.t;
      }
      return true;
    }
  };
  const log = function () { logs.push(Array.prototype.join.call(arguments, ' ')); };
  const say = function (t) { logs.push(String(t)); };
  const guard = function (name, fn) {
    return function () {
      try { return fn.apply(null, arguments); }
      catch (e) { threw.push(name + ': ' + (e && e.stack ? e.stack : e)); return undefined; }
    };
  };
  const fakeFs = {
    writeFileSync: function () { },
    appendFileSync: function () { },
    unlinkSync: function (p) {
      if (/thornswood-characters\.js$/.test(p) && page.list) { page.list = false; return; }
      throw new Error('ENOENT: ' + p);
    },
    readFileSync: function () { throw new Error('ENOENT'); },
    readdirSync: function () { return []; }
  };
  const req = function (name) { if (name === 'fs') { return fakeFs; } throw new Error('no ' + name); };
  const clockDate = { now: function () { return clock.t; } };
  const glob = { get __thornswoodInWorld() { return game.stage === 'world'; },
                 get __thornswoodUncausedLoad() { return world.uncaused; } };

  const prelude =
    'const chooseAtMenu = true;\n' +
    'let menuPhase = 0;\n' +
    'let menuAt = 0;\n' +
    'const loadedAt = Date.now();\n' +
    "const CHOICE_FILE = 'Data/Platform/thornswood-choice.txt';\n" +
    "const CHARACTERS_FILE = 'Data/Platform/thornswood-characters.json';\n" +
    "const INTRO_FILE = 'Data/Platform/thornswood-intro.txt';\n" +
    // What menuWatch keeps between ticks: the scroll setting this start began
    // under, whether Continue has been pressed, and when it last spoke.
    'let menuIntroOff = false;\n' +
    'let menuWent = false;\n' +
    'let menuStayAt = 0;\n' +
    'let menuFgAt = 0;\n' +
    'let menuFgWas = null;\n' +
    // Back at the choice after being idle (#1142); never, here.
    'let menuAgain = null;\n' +
    "const UI_URL = '" + PAGE + "';\n" +
    'let PROFILE = ' + (opts.fallback || 0) + ';\n' +
    'let menuChosenId = 0, menuChosenAt = 0, menuSaidAt = 0, menuSaidTimes = 0;\n' +
    // Saying the choice again is test-menu-choice.js's business.
    'function keepSayingChoice() { }\n' +
    'function chosenOnDisk() { return false; }\n' +
    "function readText() { return ''; }\n" +
    "function inject(name) { T.js('inject ' + name); }\n";
  const tail =
    '\nfunction cap(now) {\n' + CAP + '\n}\n' +
    'function worldArrives() {\n' + WORLD + '\n}\n' +
    'function deliver(a) {\n' +
    "  if (a[0] === 'thornswood' && a[1] === 'select') {\n" +
    '    const id = Number(a[2]) || 0;\n' +
    '    if (id > 0) { menuChose(id); }\n' +
    '    return;\n' +
    '  }\n' +
    "  if (a[0] === 'thornswood-front' && String(a[1]).indexOf('where ') === 0) {\n" +
    '    const parts = String(a[1]).split(/\\s+/);\n' +
    "    menuWhere(parts[1] || '', parts[2] || '');\n" +
    '    return;\n' +
    '  }\n' +
    '  const what = String(a[1]);\n' +
    "  if (what.indexOf('select:') === 0) { menuBeatAt = Date.now(); return; }\n" +
    "  const m = /^(party|journal|trade|skills):(opened|closed)$/.exec(what);\n" +
    "  if (m) { T.claimFocus(m[1], m[2] === 'opened'); }\n" +
    '}\n' +
    'return { claims: claims, applyFocus: applyFocus, cap: cap, worldArrives: worldArrives,\n' +
    '         deliver: deliver, phase: function () { return menuPhase; } };';

  const make = new Function('sp', 'say', 'log', 'T', 'Date', 'guard', 'require', 'globalThis',
                            prelude + ARBITER + '\n' + MENU + tail);
  const api = make(sp, say, log, T, clockDate, guard, req, glob);

  // The update tick, as far as focus and the page go.
  let uphase = 0, uat = 0;
  function update() {
    const now = clock.t;
    if (game.stage !== 'world') {
      if (opts.updateAtMenu) { api.applyFocus(); api.cap(now); }
      return;
    }
    if (uphase === 0) {
      if (sp.Utility.isInMenuMode()) { return; }
      api.worldArrives();
      uphase = 1; uat = now;
      sp.browser.loadUrl(PAGE);
      sp.browser.setVisible(true);
      sp.browser.setFocused(false);
      return;
    }
    if (uphase >= 2) { api.applyFocus(); }
    if (uphase === 1 && now - uat > 1200) { uphase = 2; uat = now; return; }
    if (uphase === 2 && now - uat > 600) { uphase = 3; uat = now; return; }
    if (uphase !== 3) { return; }
    api.applyFocus();
    api.cap(now);
  }

  function pageStep() {
    const now = clock.t;
    // The pick again every two seconds until it is acked.
    if (page.picked && !page.acked && now - page.pickedAt >= 2000) {
      page.pickedAt = now;
      tell(['thornswood', 'select', page.picked]);
    }
    if (page.acked && page.ackAt && now - page.ackAt >= 1200) { page.choice = false; page.ackAt = 0; }
    if (page.choice && !page.picked && now - page.beatAt >= 2000) {
      page.beatAt = now;
      tell(['thornswood-front', 'select:alive']);
    }
  }

  function clientStep() {
    const now = clock.t;
    if (client.waiting && now - client.since >= FALLBACK_MS) {
      client.waiting = false;
      if (client.fallback > 0) { client.loginAt = now; }
    }
    if (client.loginAt && game.stage === 'menu' && now - client.loginAt >= 2000) {
      game.stage = 'loading';
      game.open = { 'Loading Menu': true };
      game.loadingAt = now;
      sp.browser.setVisible(false);    // a bad menu, so the client hides the browser
    }
    if (game.stage === 'loading' && now - game.loadingAt >= 3000) {
      game.stage = 'world';
      game.open = {};
      sp.browser.setVisible(true);     // the last bad menu closed
    }
  }

  function frame(noTick) {
    clock.t += FRAME;
    if (!noTick) { (handlers.tick || []).forEach(function (f) { f(); }); }
    update();
    const due = inbox.splice(0);
    due.forEach(function (a) {
      if (a[0] === 'thornswood' && a[1] === 'select' && client.waiting) {
        client.waiting = false;
        client.loginAt = clock.t;
      }
      if (a[1] === 'bridge is up' && uphase >= 2) { uphase = 1; uat = clock.t; }
      api.deliver(a);
    });
    pageStep();
    clientStep();
  }

  const h = {
    api: api, game: game, browser: browser, page: page, logs: logs, threw: threw,
    closes: closes, js: jsSaid, clock: clock,
    run: function (ms, each) {
      const end = clock.t + ms;
      while (clock.t < end) { frame(false); if (each) { each(); } }
    },
    runNoTick: function (ms) {
      const end = clock.t + ms;
      while (clock.t < end) { frame(true); }
    },
    held: function () {
      return Object.keys(api.claims).filter(function (k) { return api.claims[k]; });
    },
    said: function (text) { return logs.some(function (l) { return l.indexOf(text) >= 0; }); },
    /* A click on a slot: the page sends its pick at once and every two seconds. */
    pick: function (id) {
      page.picked = id;
      page.pickedAt = clock.t;
      tell(['thornswood', 'select', id]);
    },
    /* The mouse moves, which is when Tilted applies a waiting loadUrl. */
    mouseMove: function () {
      if (!browser.pendingUrl) { return; }
      browser.pendingUrl = null;
      page.choice = page.list;
      page.picked = 0; page.acked = false; page.ackAt = 0; page.panels = {};
      tell(['thornswood-front', 'bridge is up']);
    },
    /* The client's own keys, from browserService.ts. */
    press: function (key) {
      const bad = game.stage !== 'world';
      if (key === 'Escape') {
        if (browser.focused) { sp.browser.setFocused(false); }
        else if (game.stage === 'world') { game.systemPage = true; }
      }
      if (key === 'F6' && !bad) { sp.browser.setFocused(!browser.focused); }
    },
    open: function (p) {
      page.panels[p] = true;
      tell(['thornswood-front', p + ':opened']);
    },
    /* The arbiter's own entry point, the one every plugin claims through. */
    claim: function (who, on) { T.claimFocus(who, on); },
    hideByClient: function () { sp.browser.setVisible(false); }
  };
  return h;
}

if (ARBITER !== null && MENU !== null && CAP !== null && WORLD !== null) {
  {
    const h = rig({ nirnlab: true });
    h.run(1000);
    h.hideByClient();
    yes('NirnLab startup hide drops real mouse focus while the getter stays true',
        !h.browser.actualFocused && h.browser.focused && !h.browser.visible);
    h.run(500);
    yes('the choice restores real mouse focus when it restores visibility',
        h.browser.visible && h.browser.actualFocused && h.api.claims.select);
    h.pick(PICK);
    h.run(10000);
    yes('after entry the choice releases native mouse focus',
        h.game.stage === 'world' && !h.browser.actualFocused && !h.api.claims.select);
    yes('the NirnLab startup sequence throws nothing', h.threw.length === 0);
  }
  // ---------------------------------------------------- S1: THE BUG, Djinn's
  {
    const h = rig({ fallback: LAST });
    let upAtMenu = true;
    h.run(FALLBACK_MS - 5000, function () {
      if (h.api.phase() === 2 && !h.browser.focused) { upAtMenu = false; }
    });
    yes('S1 the choice is up and holds the keyboard until the client gives up waiting',
        h.page.choice && upAtMenu && h.api.phase() === 2);
    yes('S1 held by name, as the select claim', h.api.claims.select === true);
    h.run(5000 + 2000 + 3000 + 3000);
    yes('S1 the client logged in as the last character and the world is up',
        h.game.stage === 'world');
    yes('S1 THE BUG: the choice is not left drawn over the world', !h.page.choice);
    h.mouseMove();
    h.run(3000);
    yes('S1 and the reload the mouse lets in does not draw it again', !h.page.choice);
    yes('S1 the list the launcher wrote is gone', !h.page.list);
    yes('S1 nothing holds the keyboard and the game has it',
        h.held().length === 0 && !h.browser.focused);
    h.press('Escape');
    yes('S1 so Escape reaches the game\'s System page, as it did', h.game.systemPage);
    yes('S1 the log says the world came with nothing picked, and the uncaused load count',
        h.said('nothing picked here') && h.said('uncausedLoads=0'));
    yes('S1 and says when the select claim went up and when it was let go',
        h.said('focus claimed by select') && h.said('focus released by select'));
    yes('S1 nothing threw', h.threw.length === 0);
    h.threw.slice(0, 2).forEach(function (t) { console.log('      ' + t.split('\n')[0]); });
  }

  // ------------------------------------ S2: ten minutes at the choice, untouched
  {
    const TEN = 10 * 60 * 1000;
    // No profile to fall back to, so the client never logs in on its own.
    [false, true].forEach(function (worst) {
      const h = rig({ fallback: 0, updateAtMenu: worst });
      h.run(2000);
      const drops = h.browser.drops;
      let down = 0, unclaimed = 0;
      h.run(TEN, function () {
        if (!h.browser.focused) { down++; }
        if (!h.api.claims.select) { unclaimed++; }
      });
      const name = worst ? ' (update firing at the menu too)' : ' (tick only, as the game runs)';
      yes('S2 ten minutes at the choice, focus up every frame' + name, down === 0);
      yes('S2 and nothing took it back' + name,
          h.browser.drops === drops && !h.said('taking it back'));
      yes('S2 the select claim held the whole time' + name, unclaimed === 0);
      yes('S2 the choice is still up' + name, h.page.choice && h.api.phase() === 2);
      yes('S2 nothing threw' + name, h.threw.length === 0);
    });

    // The client's Escape drops focus at the menu. The block puts it back.
    const e = rig({ fallback: 0 });
    e.run(5 * 60 * 1000);
    e.press('Escape');
    const at = e.clock.t;
    let back = 0;
    e.run(2000, function () { if (!back && e.browser.focused) { back = e.clock.t - at; } });
    yes('S2 an Escape at the choice is undone inside 300ms (' + back + 'ms)', back > 0 && back <= 300);
    yes('S2 and the select claim never let go for it', e.api.claims.select === true);
    // F6 is the client's, and it refuses it while the Main Menu is up.
    e.press('F6');
    e.run(500);
    yes('S2 F6 at the menu leaves the choice as it was', e.browser.focused && e.page.choice);
  }

  // ------------------------------------------ S3: a pick lets the claim go
  {
    const h = rig({ fallback: LAST });
    h.run(30000);
    yes('S3 before the pick the choice is held by name', h.api.claims.select === true);
    h.pick(PICK);
    h.run(FRAME);
    yes('S3 the pick lets the select claim go at once', h.api.claims.select !== true);
    yes('S3 and gives the keyboard back', !h.browser.focused);
    h.run(2000 + 3000 + 3000);
    yes('S3 the client logged in and the world is up', h.game.stage === 'world');
    h.mouseMove();
    h.run(3000);
    yes('S3 in the world: no choice drawn, no list, no claim, the keyboard with the game',
        !h.page.choice && !h.page.list && h.held().length === 0 && !h.browser.focused);
    yes('S3 and the world path did not call it an unmade choice', !h.said('nothing picked here'));
    yes('S3 nothing threw', h.threw.length === 0);
  }

  // ------------------------- S4: the cap closes the window it takes, by name
  {
    Object.keys(PANELS).forEach(function (p) {
      const h = rig({ world: true });
      h.run(3000);
      h.open(p);
      h.run(60000);
      const early = h.closes.length === 0 && h.api.claims[p] === true && h.browser.focused;
      h.run(62000);
      yes('S4 ' + p + ': nothing closed and the keyboard held before two minutes', early);
      yes('S4 ' + p + ': at two minutes its own window is closed, by name, and no other',
          h.closes.length === 1 && h.closes[0] === PANELS[p]);
      yes('S4 ' + p + ': the window is gone and the claim with it',
          !h.page.panels[p] && h.api.claims[p] !== true);
      yes('S4 ' + p + ': the keyboard is back with the game', !h.browser.focused);
      yes('S4 ' + p + ': nothing threw', h.threw.length === 0);
    });

    // Two windows up at once: the older one is capped first and alone.
    const h = rig({ world: true });
    h.run(3000);
    h.open('skills');
    h.run(60000);
    h.open('party');
    h.run(62000);
    yes('S4 skills capped at two minutes closes the K panel only',
        h.closes.join(',') === 'thornswoodSkills');
    yes('S4 and the party window opened a minute later stays, with its claim and the cursor',
        h.page.panels.party === true && h.api.claims.party === true && h.browser.focused);
    h.run(60000);
    yes('S4 until its own two minutes, when it is closed by name too',
        h.closes.join(',') === 'thornswoodSkills,thornswoodParty' && !h.page.panels.party);

    // The wheel is capped as before, and closing it closes no panel.
    const w = rig({ world: true });
    w.run(3000);
    w.claim('wheel', true);          // the way thornswood-emotes.js raises it
    w.run(60000);
    const wheelEarly = w.api.claims.wheel === true && w.browser.focused;
    w.run(62000);
    const panelNames = Object.keys(PANELS).map(function (p) { return PANELS[p]; });
    yes('S4 wheel: still taken back at two minutes, with no panel closed along with it',
        wheelEarly && w.api.claims.wheel !== true && !w.browser.focused &&
        w.closes.every(function (n) { return panelNames.indexOf(n) < 0; }));
  }

  // ---------------- S5: select is capped like any claim once its choice is gone
  {
    // A release that was missed somewhere leaves the claim up in the world.
    // The menu tick lets it go on its very next pass.
    const h = rig({ world: true });
    h.run(3000);
    yes('S5 the world is up and the choice is not', h.game.stage === 'world' && h.api.phase() === 9);
    h.claim('select', true);
    h.run(FRAME);
    yes('S5 a select claim left up in the world is let go on the next tick',
        h.api.claims.select !== true && !h.browser.focused);

    // And with no tick at all, the cap takes it at two minutes like any other
    // claim, closing the choice by name, so the keyboard always comes back.
    const n = rig({ world: true });
    n.run(3000);
    n.claim('select', true);
    n.runNoTick(60000);
    const held = n.api.claims.select === true && n.browser.focused;
    n.runNoTick(62000);
    yes('S5 with no tick, the select claim is held until two minutes', held);
    yes('S5 then the cap takes it, closes the choice by name, and gives the keyboard back',
        n.api.claims.select !== true && n.closes.indexOf('thornswoodSelect') >= 0 &&
        !n.browser.focused);
    yes('S5 nothing threw', h.threw.length === 0 && n.threw.length === 0);
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
