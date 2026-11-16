// test-4583-bed-one-press.js
//
// One press gets a person into an owned bed (#4583).
//
// Vanilla marks most beds Owned, and Skyrim refuses Sleep in one. The front
// plugin used to clear the owner when the bed was pressed, then press it a
// second time "because that press may already have been refused".
//
// MEASURED FROM THE CODE, not guessed. The fork's TESActivateEvent sink
// (EventHandler.cpp) hands the press to the plugins through AddUpdateTask, so
// sp.on('activate') runs on a later update, after Skyrim has already handled
// the press. The owner was always still on the bed when the first press
// landed, and clearing it there could only ever help the second press.
// Nothing in the fork sets an owner (ActorOwner is only in the codegen), so
// the owner is the plugin record's, and it is cleared when the bed comes into
// the world on this machine, which is three ways: its own 3D loading
// (objectLoaded), its whole cell finishing loading (cellFullyLoaded, which
// covers a cell that came in with a save or a login), and the person's own
// cell on the plugin's first frame (#6220: a game call made while the
// plugin file is still being run is refused, so the walk waits for it).
//
// This lifts the shipped bed block and the activate handler out of
// thornswood-front.js and drives them.
//
//   node game/tests/test-4583-bed-one-press.js
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = process.env.FRONT ||
  path.join(__dirname, '..', 'plugins', 'thornswood-front.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const PRESS_OPEN = "  sp.on('activate', guard('activate', (e) => {";

// The bed block: from the keyword list to the line before the activate handler.
const beds = (function () {
  const a = src.indexOf('  const BED_KEYWORDS = [');
  const b = a < 0 ? -1 : src.indexOf(PRESS_OPEN, a);
  return (a >= 0 && b >= 0) ? src.slice(a, b) : null;
})();
const onPress = (function () {
  const a = src.indexOf(PRESS_OPEN);
  const b = a < 0 ? -1 : src.indexOf('\n  }));\n', a);
  return (a >= 0 && b >= 0) ? src.slice(a, b + 6) : null;
})();

yes('the bed block is in the plugin', beds !== null);
yes('the activate handler is in the plugin', onPress !== null);

/* A bed reference with an owner, as Skyrim.esm makes most of them. */
function bed(opts) {
  opts = opts || {};
  const base = {
    getFormID: function () { return 0xd1b0b; },
    getType: function () { return opts.type == null ? 40 : opts.type; },
    getName: function () { return opts.name || 'Bed'; },
    hasKeyword: function (kw) { return kw && kw.name === 'FurnitureBedSingle' && opts.type == null; }
  };
  const self = {
    actorOwner: opts.actor === undefined ? { id: 0x1a67c } : opts.actor,
    factionOwner: opts.faction === undefined ? null : opts.faction,
    presses: 0,
    getFormID: function () { return 0x1a2b3; },
    getBaseObject: function () { return base; },
    getActorOwner: function () { return self.actorOwner; },
    getFactionOwner: function () { return self.factionOwner; },
    setActorOwner: function (v) { self.actorOwner = v; self.ownerTouched = true; },
    setFactionOwner: function (v) { self.factionOwner = v; self.ownerTouched = true; },
    isActivationBlocked: function () { return false; },
    activate: function () { self.presses++; }
  };
  return self;
}

/* A loaded cell, holding the given furniture references. */
function cell(refs) {
  return {
    getNumRefs: function (t) { return t === 40 ? refs.length : 0; },
    getNthRef: function (i, t) { return t === 40 ? refs[i] : null; }
  };
}

/* Runs the bed block and the activate handler, as the plugin does when it
   starts, with the person standing in `here` (or nowhere, at the menu).
   `update()` runs what the plugin asked to run on its first frame. */
function rig(here) {
  const handlers = {}, firstFrame = [], said = [];
  const keywords = {};
  const pc = { id: 0x14, getParentCell: function () { return here || null; } };
  const sp = {
    on: function (what, f) { handlers[what] = f; },
    once: function (what, f) { if (what === 'update') { firstFrame.push(f); } },
    Keyword: { getKeyword: function (n) { return keywords[n] || (keywords[n] = { name: n }); } },
    Game: { getPlayer: function () { return here === undefined ? null : pc; } },
    Utility: { wait: function () { return { then: function () { } }; } },
    ObjectReference: { from: function (f) { return f || null; } }
  };
  const fn = new Function(
    'sp', 'guard', 'say', 'serverBases', 'lastForced', 'lastLogged', 'Date',
    'let reActivating = false;\n' + beds + '\n' + onPress + '\nreturn {};');
  fn(sp, function (n, f) { return f; }, function (l) { said.push(l); },
     {}, {}, {}, { now: function () { return 5000000; } });
  return { load: handlers.objectLoaded, cellLoaded: handlers.cellFullyLoaded,
           press: handlers.activate, said: said,
           update: function () { firstFrame.splice(0).forEach(function (f) { f(); }); } };
}

const ME = { getFormID: function () { return 0x14; } };

if (beds && onPress) {
  // B1: THE POINT. The bed loads, and its owner is gone before anybody presses.
  {
    const r = rig();
    const b = bed();
    if (r.load) { r.load({ object: b, isLoaded: true }); }
    yes('B1 an owned bed has no owner once its 3D has loaded, before any press',
        b.actorOwner === null && b.factionOwner === null);
  }

  // B2: a faction owned bed, the same.
  {
    const r = rig();
    const b = bed({ actor: null, faction: { id: 0x2816c } });
    if (r.load) { r.load({ object: b, isLoaded: true }); }
    yes('B2 a faction owned bed has no owner once loaded', b.factionOwner === null);
  }

  // B3: the press is the person's one press. The plugin presses nothing again
  //     and does not touch the owner at press time, which is a frame too late.
  {
    const r = rig();
    const b = bed();
    if (r.load) { r.load({ object: b, isLoaded: true }); }
    b.ownerTouched = false;
    r.press({ target: b, caster: ME });
    yes('B3 pressing a bed once is one press: the plugin presses it no second time',
        b.presses === 0);
    yes('B3 and the owner is not touched at press time', b.ownerTouched === false);
  }

  // B4: a bed whose 3D loaded BEFORE this plugin registered anything (the
  //     person's own cell when the plugin starts). No objectLoaded ever comes
  //     for it, and it still has no owner by the person's first press, which
  //     can only come after the first frame.
  {
    const b = bed();
    const r = rig(cell([b]));
    r.update();
    yes('B4 a bed loaded before the plugin has no owner by the first press',
        b.actorOwner === null);
    r.press({ target: b, caster: ME });
    yes('B4 and that press is the only one', b.presses === 0);
    yes('B4 and the plugin says how many it cleared', r.said.some(function (l) { return /1 bed/.test(l); }));
  }

  // B5: an unload, a chair and a door are left alone.
  {
    const r = rig();
    const b = bed();
    if (r.load) { r.load({ object: b, isLoaded: false }); }
    yes('B5 an unloading bed is not changed', b.actorOwner !== null);
    const chair = bed({ name: 'Wooden Chair', type: 40 });
    if (r.load) { r.load({ object: chair, isLoaded: true }); }
    yes('B5 a chair keeps its owner', chair.actorOwner !== null);
    const door = bed({ name: 'Bed Chamber Door', type: 29 });
    if (r.load) { r.load({ object: door, isLoaded: true }); }
    yes('B5 a door keeps its owner', door.actorOwner !== null);
  }

  // B6: a cell that finishes loading (a login inside an inn) has every bed in
  //     it cleared, with no objectLoaded for any of them, and its chair kept.
  {
    const r = rig();
    const a = bed(), b = bed({ actor: null, faction: { id: 0x2816c } });
    const chair = bed({ name: 'Wooden Chair', type: 40 });
    if (r.cellLoaded) { r.cellLoaded({ cell: cell([a, chair, b]) }); }
    yes('B6 every bed in a cell that finished loading has no owner',
        a.actorOwner === null && b.factionOwner === null);
    yes('B6 and its chair keeps its owner', chair.actorOwner !== null);
  }

  // B7: at the main menu there is no person and no cell, and nothing throws.
  {
    let threw = null;
    try { rig(undefined).update(); } catch (e) { threw = e; }
    yes('B7 starting at the main menu, with nobody in the world, is quiet', threw === null);
  }
}

// ---------------------------------------------------------------- structure
{
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  yes('nothing says it activated a bed again', code.indexOf('activated again') < 0);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
