// test-1739-look-covered.js
//
// #1739. The look prompt, the panel that names who is under the crosshair
// and the keys for them, came down for nothing: it was drawn from the
// crosshair and the server's near list alone, so it stayed over the
// inventory, the map, the Tab menu and every other menu Skyrim keeps the
// crosshair under, and over our own panels, which the page drew beneath it.
//
// WHAT THIS RUNS. The real look block out of thornswood-front.js, from
// NEAR_EVERY to just before lookVerb (the near list, drawPrompt, LOOK_CSS,
// the crosshair poll and its menu handlers), with the real KEYBOARD_MENUS,
// busyMenuOpen and anyClaim, over a pretend game, a pretend page and a
// pretend clock. FRONT=<path> runs it on another copy of the plugin; on the
// plugin before this change the cases that open a menu or a panel fail.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
const front = (process.env.FRONT ? fs.readFileSync(process.env.FRONT, 'utf8')
  : fs.readFileSync(path.join(ROOT, 'game', 'plugins', 'thornswood-front.js'), 'utf8')).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}
function between(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a);
  return b < 0 ? null : src.slice(a, b);
}

const menus = slice(front, '  const KEYBOARD_MENUS = [', '\n  ];');
const anyClaim = slice(front, '  function anyClaim() {', '\n  }\n');
const gameMenuOpen = slice(front, '  function gameMenuOpen() {', '\n  }\n');
const cache = between(front, '  const MENU_CACHE_MS = 250;', '  // Menus the game can raise while the browser holds the keyboard');
const look = between(front, '  const NEAR_EVERY = 320;', '  function lookVerb(cmd) {');
yes('the look block, the menu list, busyMenuOpen and anyClaim are in the plugin',
    !!(menus && anyClaim && gameMenuOpen && cache && look));

const KEYBOARD_MENUS = menus ? new Function(menus + '\nreturn KEYBOARD_MENUS;')() : [];

const HEX = 'ff000004', OTHER = 'ff000009';

/** A page with just enough of a document for the strings the block hands it. */
function page() {
  const els = {};
  const doc = {
    getElementById: function (id) { return els[id] || null; },
    createElement: function () { return { id: '', style: { cssText: '', display: '' }, innerHTML: '' }; },
    body: { appendChild: function (el) { els[el.id] = el; } }
  };
  return {
    doc: doc,
    shown: function () { const d = els['ts-look']; return !!d && d.style.display !== 'none'; },
    css: function () { const d = els['ts-look']; return d ? d.style.cssText : ''; },
    text: function () { const d = els['ts-look']; return d ? d.innerHTML : ''; }
  };
}

function rig() {
  const w = { open: {}, claims: {}, handlers: {}, logs: [], threw: [], clock: 100000, cross: HEX };
  const pg = page();
  w.page = pg;
  const near = {};
  near[HEX] = { n: 'Second', f: 0, m: 0, y: 0 };
  near[OTHER] = { n: 'Third', f: 1, m: 0, y: 0 };
  const glob = {
    thornswoodNear: near,
    thornswoodSocialServerId: function (id) { return id; }
  };
  const sp = {
    on: function (ev, fn) { (w.handlers[ev] = w.handlers[ev] || []).push(fn); },
    Ui: { isMenuOpen: function (n) { return !!w.open[n]; } },
    Utility: { isInMenuMode: function () { return Object.keys(w.open).some(function (k) { return w.open[k]; }); } },
    Game: {
      getCurrentCrosshairRef: function () {
        if (!w.cross) { return null; }
        const id = parseInt(w.cross, 16);
        return { getFormID: function () { return id; } };
      }
    }
  };
  const T = {
    ready: true,
    js: function (s) { new Function('document', s)(pg.doc); return true; }
  };
  const guard = function (name, fn) {
    return function () {
      try { return fn.apply(null, arguments); }
      catch (err) { w.threw.push(name + ': ' + err); return undefined; }
    };
  };
  const FakeDate = { now: function () { return w.clock; } };
  const prelude =
    "const FRIEND_NAME = 'Y', TRADE_NAME = 'H', MUTE_NAME = 'L', PARTY_NAME = 'P', SLEEP_NAME = 'U';\n" +
    "const APPRENTICE_NAME = 'K', TREAT_NAME = 'X';\n" +
    "function deliverName() { return 'E'; }\n" +
    menus + '\n' + anyClaim + gameMenuOpen + cache + look +
    '\nreturn { looking: function () { return lookingAt; }, busyMenuOpen: busyMenuOpen };';
  const api = new Function('sp', 'T', 'claims', 'say', 'guard', 'globalThis', 'Date', prelude)(
    sp, T, w.claims, function (t) { w.logs.push(String(t)); }, guard, glob, FakeDate);
  w.api = api;
  w.fire = function (ev, arg) { (w.handlers[ev] || []).forEach(function (f) { f(arg); }); };
  // One frame, the clock moved on by ms first.
  w.frame = function (ms) { w.clock += (ms || 0); w.fire('update'); };
  // A poll: far enough on that the crosshair poll runs.
  w.poll = function () { w.frame(400); };
  w.openMenu = function (n) { w.open[n] = true; w.fire('menuOpen', { name: n }); };
  w.closeMenu = function (n) { w.open[n] = false; w.fire('menuClose', { name: n }); };
  return w;
}

if (menus && anyClaim && gameMenuOpen && cache && look) {
  {
    const w = rig();
    w.poll();
    yes('L1 looking at somebody in the open world draws the prompt with their name',
        w.page.shown() && /Second/.test(w.page.text()));
    w.openMenu('InventoryMenu');
    yes('L2 the inventory opening takes it down at once, before the next poll', !w.page.shown());
    w.poll();
    yes('L3 and it stays down on the polls while the inventory is open', !w.page.shown());
    yes('L3 with one line saying why', w.logs.filter(function (l) { return /look prompt down while InventoryMenu is open/.test(l); }).length === 1);
    w.poll();
    yes('L3 and not a second line for the same menu', w.logs.filter(function (l) { return /look prompt down/.test(l); }).length === 1);
    w.closeMenu('InventoryMenu');
    w.poll();
    yes('L4 closing the inventory puts it back on the next poll', w.page.shown() && /Second/.test(w.page.text()));
    yes('L4 nothing threw', w.threw.length === 0);
  }
  {
    // Another handler read "no menu" just before the menu opened; the
    // quarter second memory must not put the prompt back over it.
    const w = rig();
    w.poll();
    w.clock += 300;
    w.api.busyMenuOpen();
    w.clock += 5;
    w.openMenu('MapMenu');
    w.frame(30);
    yes('L5 a "no menu" read just before the map opened does not put the prompt back over it', !w.page.shown());
  }
  {
    const missed = [];
    KEYBOARD_MENUS.forEach(function (name) {
      const w = rig();
      w.poll();
      w.open[name] = true;   // no event: the poll alone has to see it
      w.poll();
      if (w.page.shown()) { missed.push(name); }
    });
    yes('L6 every menu that takes the keyboard (' + KEYBOARD_MENUS.length + ') keeps the prompt down on the poll' +
        (missed.length ? ': not for ' + missed.join(', ') : ''), KEYBOARD_MENUS.length > 15 && missed.length === 0);
  }
  {
    const w = rig();
    w.poll();
    w.openMenu('Cursor Menu');
    w.openMenu('HUD Menu');
    w.poll();
    yes('L7 the cursor and the HUD, which are not in anybody\'s way, leave it up', w.page.shown());
  }
  {
    const w = rig();
    w.poll();
    w.claims.skills = true;
    w.frame(16);
    yes('L8 one of our panels taking the keyboard takes it down in that same frame', !w.page.shown());
    w.poll();
    yes('L8 and it stays down while the panel is open', !w.page.shown());
    w.claims.skills = false;
    w.poll();
    yes('L8 and is back once the panel lets go', w.page.shown());
  }
  {
    const w = rig();
    w.poll();
    w.claims.chat = true;
    w.frame(16);
    yes('L9 typing in the chat takes it down', !w.page.shown());
  }
  {
    const w = rig();
    w.poll();
    w.openMenu('InventoryMenu');
    w.cross = OTHER;
    w.poll();
    yes('L10 who is looked at is still followed while it is down', w.api.looking() === OTHER && !w.page.shown());
    w.closeMenu('InventoryMenu');
    w.poll();
    yes('L10 so the prompt that comes back is for the person under the crosshair now',
        w.page.shown() && /Third/.test(w.page.text()) && /Remove friend/.test(w.page.text()));
  }
  {
    // Drawn beneath every panel, so a panel opened between two frames covers
    // it rather than wearing it.
    const w = rig();
    w.poll();
    const z = Number((/z-index:(\d+)/.exec(w.page.css()) || [])[1]);
    const ui = path.join(ROOT, 'game', 'ui');
    let lowest = Infinity, lowestIn = '';
    fs.readdirSync(ui).filter(function (f) { return /^thornswood-.*\.js$/.test(f) && f !== 'thornswood-voice.js'; })
      .forEach(function (f) {
        const src = fs.readFileSync(path.join(ui, f), 'utf8');
        (src.match(/z-index:\s*(\d+)/g) || []).forEach(function (m) {
          const n = Number(/(\d+)/.exec(m)[1]);
          if (n >= 2147483000 && n < lowest) { lowest = n; lowestIn = f; }
        });
      });
    yes('L11 the prompt sits beneath every panel (' + z + ' under ' + lowest + ' in ' + lowestIn + ')',
        z > 0 && lowest !== Infinity && z < lowest);
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
