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
// the world on this machine: objectLoaded, when its 3D loads.
//
// This lifts the shipped handlers out of thornswood-front.js and drives them.
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

function lift(open, shut) {
  const a = src.indexOf(open);
  const b = a < 0 ? -1 : src.indexOf(shut, a);
  return (a >= 0 && b >= 0) ? src.slice(a, b + shut.length) : null;
}

// The bed helpers, from the keyword list to the end of clearBedOwnership.
const helpers = (function () {
  const a = src.indexOf('  const BED_KEYWORDS = [');
  const b = a < 0 ? -1 : src.indexOf('\n  function clearBedOwnership', a);
  const c = b < 0 ? -1 : src.indexOf('\n  }\n', b);
  return (a >= 0 && c >= 0) ? src.slice(a, c + 4) : null;
})();
const onPress = lift("  sp.on('activate', guard('activate', (e) => {", '\n  }));\n');
const onLoad = lift("  sp.on('objectLoaded', guard('bed owner', (e) => {", '\n  }));\n');

yes('the bed helpers are in the plugin', helpers !== null);
yes('the activate handler is in the plugin', onPress !== null);
yes('a bed\'s owner is cleared when it comes into the world (objectLoaded)', onLoad !== null);

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
    ownerTouchedAtPress: false,
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

function rig() {
  const handlers = {}, said = [];
  const keywords = {};
  const sp = {
    on: function (what, f) { handlers[what] = f; },
    Keyword: { getKeyword: function (n) { return keywords[n] || (keywords[n] = { name: n }); } },
    Game: { getPlayer: function () { return { id: 0x14 }; } },
    Utility: { wait: function () { return { then: function () { } }; } },
    ObjectReference: { from: function (f) { return f || null; } }
  };
  const fn = new Function(
    'sp', 'guard', 'say', 'serverBases', 'lastForced', 'lastLogged', 'Date',
    'let reActivating = false;\n' + helpers + '\n' + (onLoad || '') + '\n' + onPress + '\nreturn {};');
  fn(sp, function (n, f) { return f; }, function (l) { said.push(l); },
     {}, {}, {}, { now: function () { return 5000000; } });
  return { load: handlers.objectLoaded, press: handlers.activate, said: said };
}

const ME = { getFormID: function () { return 0x14; } };

if (helpers && onPress) {
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

  // B4: even a bed still owned at the press (one that loaded before this
  //     plugin) is not pressed again: a second press is never the answer.
  {
    const r = rig();
    const b = bed();
    r.press({ target: b, caster: ME });
    yes('B4 an owned bed is never pressed a second time by the plugin', b.presses === 0);
  }

  // B5: an unload, a chair and a door are left alone.
  {
    const r = rig();
    const b = bed();
    if (r.load) { r.load({ object: b, isLoaded: false }); }
    yes('B5 an unloading bed is not changed', b.actorOwner !== null);
    const chair = bed({ name: 'Wooden Chair', type: 40 });
    chair.getBaseObject().hasKeyword = function () { return false; };
    if (r.load) { r.load({ object: chair, isLoaded: true }); }
    yes('B5 a chair keeps its owner', chair.actorOwner !== null);
    const door = bed({ name: 'Bed Chamber Door', type: 29 });
    if (r.load) { r.load({ object: door, isLoaded: true }); }
    yes('B5 a door keeps its owner', door.actorOwner !== null);
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
