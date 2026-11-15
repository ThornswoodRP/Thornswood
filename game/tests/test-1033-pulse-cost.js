// test-1033-pulse-cost.js
//
// The pulse line never takes more than a few milliseconds of one frame.
// Issue #1033, from the #963 performance audit.
//
// MEASURED 28 September on the dev front log: the 'pulse' handler's worst
// single call was 122 ms. Every five seconds, while any menu was up, it asked
// sp.Ui.isMenuOpen for 28 menu names one after another, and sp.browser.isFocused
// and sp.Utility.isInMenuMode as well, all in the same frame.
//
// The plugin now keeps the open menus from the game's menuOpen and menuClose
// events, and the pulse reads that list without asking the game anything.
//
// This lifts the real text (PULSE_MENUS through the pulse handler) out of
// thornswood-front.js and runs it against a pretend game where every native
// call costs a third of a millisecond on the clock the plugin reads, the rate
// the audit measured for #976 (a pretend clock, so the numbers are exact and
// no busy machine can make them flaky). It opens the inventory, the map and
// the console the way a dev session would, and checks:
//   - no single pulse call takes 5 ms or more (the Done when on #1033)
//   - the pulse asks isMenuOpen not once
//   - the line still names exactly the menus that are up, in the old order,
//     says "none of the usual ones" for a menu off the list, and names none
//     once they are closed
//
// Run it against the plugin before the change with FRONT=<that file>: the
// cost and isMenuOpen cases fail there.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = process.env.FRONT || path.join(__dirname, '..', '..', 'game', 'plugins', 'thornswood-front.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const PULSE_OPEN = "  sp.on('update', guard('pulse', () => {";
const SHUT = '\n  }));\n';
const pa = src.indexOf(PULSE_OPEN);
const pb = pa < 0 ? -1 : src.indexOf(SHUT, pa);
// From the menu list when there is one (the plugin after #1033), from the
// handler itself when there is not (the plugin before).
const listAt = src.indexOf('  const PULSE_MENUS = [');
const from = (listAt >= 0 && listAt < pa) ? listAt : pa;
const code = (pa >= 0 && pb >= 0) ? src.slice(from, pb + SHUT.length) : null;
// The line's controls part comes from the real CONTROLS table through
// pulseControls (#2620): the pulse reads the eight flags itself now.
const ca = src.indexOf('  const CONTROLS = [');
const cp = ca < 0 ? -1 : src.indexOf('  function pulseControls() {', ca);
const cb = cp < 0 ? -1 : src.indexOf('\n  }\n', cp);
const controlsCode = (ca >= 0 && cb >= 0) ? src.slice(ca, cb + 4) : '';
yes('the controls block the pulse reads is in the plugin', !!controlsCode);

yes('the pulse handler is in the plugin', code !== null);
yes('the menus it names are kept from menuOpen and menuClose',
    !!code && code.indexOf("sp.on('menuOpen'") >= 0 && code.indexOf("sp.on('menuClose'") >= 0);
if (code === null) {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(1);
}

// A native call, at the audit's measured cost.
const CALL_MS = 1 / 3;
const clock = { t: 1000000 };
function spin(ms) { clock.t += ms; }
const FakeDate = { now: function () { return clock.t; } };

function rig(opts) {
  opts = opts || {};
  const w = { up: {}, lines: [], handlers: {}, asked: { isMenuOpen: 0, isInMenuMode: 0, isFocused: 0, foreground: 0, controls: 0 } };
  const spent = {};
  const sp = {
    on: function (ev, fn) { (w.handlers[ev] = w.handlers[ev] || []).push(fn); },
    Ui: { isMenuOpen: function (n) { w.asked.isMenuOpen++; spin(CALL_MS); return !!w.up[n]; } },
    Utility: {
      isInMenuMode: function () {
        w.asked.isInMenuMode++; spin(CALL_MS);
        return Object.keys(w.up).length > 0;
      }
    },
    Game: (function () {
      const g = { getPlayer: function () { return null; } };
      ['isMovementControlsEnabled', 'isFightingControlsEnabled', 'isCamSwitchControlsEnabled',
       'isLookingControlsEnabled', 'isSneakingControlsEnabled', 'isMenuControlsEnabled',
       'isActivateControlsEnabled', 'isJournalControlsEnabled'].forEach(function (n) {
        g[n] = function () { w.asked.controls++; spin(CALL_MS); return true; };
      });
      return g;
    })(),
    browser: { isFocused: function () { w.asked.isFocused++; spin(CALL_MS); return false; } },
    win32: opts.noWin32 ? undefined : {
      foregroundWindow: function () { w.asked.foreground++; spin(CALL_MS); return { isGame: true }; }
    }
  };
  // The plugin's guard, timing on the same clock.
  function guard(name, fn) {
    return function () {
      const began = clock.t;
      try { return fn.apply(null, arguments); }
      finally {
        const took = clock.t - began;
        const row = spent[name] || (spent[name] = { ms: 0, runs: 0, worst: 0 });
        row.ms += took; row.runs++;
        if (took > row.worst) { row.worst = took; }
      }
    };
  }
  const prelude = 'let lastPulse = 0;\nlet keysSeen = 0;\nvar seatedInFurniture = false;\n' + controlsCode + '\n';
  new Function('sp', 'guard', 'say', 'logOwnerOutfitTransition', 'frameWent', 'Date', prelude + code)(
    sp, guard, function (t) { w.lines.push(String(t)); }, function () { }, function () { }, FakeDate);
  function fire(ev, e) { (w.handlers[ev] || []).forEach(function (f) { f(e); }); }
  w.open = function (name) { w.up[name] = true; fire('menuOpen', { name: name }); };
  w.close = function (name) { delete w.up[name]; fire('menuClose', { name: name }); };
  // Seconds of frames at 60 a second. Time between frames passes on the
  // clock outside any handler.
  w.frames = function (seconds) {
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) {
      spin(1000 / 60);
      fire('update');
    }
  };
  w.pulse = function () { return spent.pulse || { ms: 0, runs: 0, worst: 0 }; };
  w.last = function () { return w.lines.length ? w.lines[w.lines.length - 1] : ''; };
  return w;
}

{
  // A dev session that opens menus: the inventory, the map, the console.
  const w = rig();
  w.frames(6);
  yes('with no menu up the line says menu no and names none: ' + w.last(),
      /menu no,/.test(w.last()) && w.last().indexOf('[') < 0);

  w.open('InventoryMenu');
  w.frames(6);
  yes('with the inventory open the line names it: ' + w.last(), w.last().indexOf('menu yes [InventoryMenu]') >= 0);
  w.close('InventoryMenu');

  w.open('MapMenu');
  w.frames(6);
  yes('with the map open the line names it: ' + w.last(), w.last().indexOf('menu yes [MapMenu]') >= 0);

  w.open('InventoryMenu');
  w.frames(6);
  yes('two up are named in the old order: ' + w.last(), w.last().indexOf('menu yes [InventoryMenu, MapMenu]') >= 0);
  w.close('InventoryMenu');
  w.close('MapMenu');

  w.open('Console');
  w.frames(6);
  yes('with the console open the line names it: ' + w.last(), w.last().indexOf('menu yes [Console]') >= 0);
  w.close('Console');

  w.open('Mod Configuration Menu');
  w.frames(6);
  yes('a menu off the list is "none of the usual ones": ' + w.last(),
      w.last().indexOf('menu yes [none of the usual ones]') >= 0);
  w.close('Mod Configuration Menu');

  w.frames(6);
  yes('once every menu is closed the line names none again: ' + w.last(),
      /menu no/.test(w.last()) && w.last().indexOf('[') < 0);

  const p = w.pulse();
  yes('the pulse wrote one line every five seconds (8 in 42 s), wrote ' + w.lines.length, w.lines.length === 8);
  yes('the pulse\'s worst single call is under 5 ms (was about 10 ms here and 122 ms on dev), worst ' +
      p.worst.toFixed(2) + ' ms', p.worst < 5);
  yes('the pulse asked isMenuOpen 0 times (was 28 on every line with a menu up), asked ' + w.asked.isMenuOpen,
      w.asked.isMenuOpen === 0);
  yes('it still asks isInMenuMode, browser focus and the foreground window once a line (8 each), asked ' +
      [w.asked.isInMenuMode, w.asked.isFocused, w.asked.foreground].join('/'),
      w.asked.isInMenuMode === 8 && w.asked.isFocused === 8 && w.asked.foreground === 8);
  yes('it reads the eight control flags once a line (64 in 8 lines), read ' + w.asked.controls,
      w.asked.controls === 64);
  yes('and the line says controls on: ' + w.last(), /controls on/.test(w.last()));
}

{
  // A client with no win32 to ask: the line is the same, minus the window.
  const w = rig({ noWin32: true });
  w.open('InventoryMenu');
  w.frames(6);
  yes('with no win32 the line still names the inventory: ' + w.last(), w.last().indexOf('menu yes [InventoryMenu]') >= 0);
  yes('and its worst call is under 5 ms, worst ' + w.pulse().worst.toFixed(2) + ' ms', w.pulse().worst < 5);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
