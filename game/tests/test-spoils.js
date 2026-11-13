// test-spoils.js
//
// Nothing is spawned in the world: no weapons, no armour, no tools, no gold.
//
// Patrick, 21 September: "all weapons, armour, tools, and gold are not spawned
// in the world at all. Not on the ground, not in containers, or display cases,
// not anywhere in the world unless made by someone or from the starter ones for
// Farmer, Miner, and Woodworker".
//
// And then, 22 September, having played it: "goldf, weaops, and armor are
// propley not able to be picked up off the ground but are still found in chests
// and able to be looted when they shouoldnt be."
//
// THE GROUND HALF ALWAYS WORKED AND THE CHEST HALF NEVER DID, because a
// container's contents were copied out of the plugin by the engine
// (EnsureBaseContainerAdded) after this block's hook had run. The gamemode
// chased that with timers. Now the engine never puts a record's contents in a
// container (forbiddenBaseContainer, #3078), so this block does not touch a
// container at all, and this file checks that it does not: no write, no mark,
// no timer. tests\test-3078-containers-empty.js checks the setting itself.
//
// It drives the REAL spoils block out of gamemode.js over a fake mp and a fake
// clock, the way test-needs.js does.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const A = '// ==== thornswood spoils ====';
const B = '// ==== end thornswood spoils ====';
const a = src.indexOf(A);
const b = a < 0 ? -1 : src.indexOf(B, a);
const block = (a >= 0 && b >= 0) ? src.slice(a, b) : null;
yes('the spoils block is in the gamemode', block !== null);

/*
  The rig.

  Four things only a live server has: the espm lookup that says what kind of
  record a form is, the descriptor to id resolution, the tool table, and
  setTimeout. The timers are CAUGHT rather than run, so a test can decide
  whether the engine got round to filling the container before they fire, which
  is the whole question.
*/
function rig() {
  const store = {};       // refrId -> { inventory, stripped }
  const kinds = {};       // baseId -> record type
  const timers = [];
  const said = [];
  const ids = {};
  let nextId = 0x100;

  function idOf(desc) {
    if (!ids[desc]) { ids[desc] = nextId++; }
    return ids[desc];
  }
  const Fake = {
    makeProperty: function () { },
    get: function (id, key) {
      const row = store[id] || {};
      if (key === 'inventory') { return { entries: (row.inventory || []).slice() }; }
      return row[key];
    },
    set: function (id, key, v) {
      if (!store[id]) { store[id] = {}; }
      if (key === 'inventory') { store[id].inventory = (v && v.entries) || []; return; }
      store[id][key] = v;
    },
    lookupEspmRecordById: function (baseId) {
      const t = kinds[baseId];
      return t ? { record: { type: t } } : null;
    }
  };

  const putBacks = [];
  const fn = new Function(
    'globalThis', 'mp', 'console', 'idOf', 'TOOLS', 'setTimeout', 'putBack',
    'Math', 'Number', 'String', 'Object', 'Array', 'Date',
    block + '\nreturn globalThis.__thornswoodSpoils;');
  const g = {};
  const api = fn(
    g, Fake, { log: function (s) { said.push(String(s)); } },
    idOf,
    { pick: { accept: ['pick:X.esm'] }, shovel: { accept: ['shovel:X.esm'] } },
    function (f, ms) { timers.push({ f: f, ms: ms }); return timers.length; },
    function (actorId, refrId) { putBacks.push([actorId, refrId]); },
    Math, Number, String, Object, Array, Date);
  api.putBacks = putBacks;

  api.idOf = idOf;
  api.said = said;
  api.store = store;
  /** Declare what kind of record a descriptor is. */
  api.kind = function (desc, type) { kinds[idOf(desc)] = type; return idOf(desc); };
  api.put = function (refrId, entries) {
    if (!store[refrId]) { store[refrId] = {}; }
    store[refrId].inventory = entries;
  };
  api.inv = function (refrId) { return (store[refrId] || {}).inventory || []; };
  api.timers = timers;
  /** Run every timer due at or before ms, in order, once. */
  api.fire = function (ms) {
    const due = timers.filter(t => t.ms <= ms);
    timers.length = 0;
    due.forEach(t => t.f());
    return due.length;
  };
  return api;
}

if (block) {
  const api = rig();
  const CHEST = api.kind('chest:Skyrim.esm', 'CONT');
  const SWORD = api.kind('sword:Skyrim.esm', 'WEAP');
  const BREAD = api.kind('bread:Skyrim.esm', 'FOOD');
  const GOLD = api.GOLD;
  const PICK = api.idOf('pick:X.esm');

  // ------------------------------------------------------ what counts
  // Nothing the world placed is handed over, so nothing here sorts what is a
  // spoil: a container starts empty (#3078) and the floor is switched off in
  // Thornswood-Last.esp (#3077). What stays is what other blocks ask of it.
  {
    yes('there is no spoil list left to sort by: no isSpoil, SPOIL_TYPES, isCutOut or isJailKey',
        api.isSpoil === undefined && api.isJailKey === undefined &&
        !/function isSpoil\(|SPOIL_TYPES|isCutOut|CUT_OUTS|isJailKey/.test(block));
    yes('the engine still names a record kind', api.kindOf(SWORD) === 'WEAP' && api.kindOf(BREAD) === 'FOOD');
    yes('a form the engine cannot name is an empty answer', api.kindOf(0xdead) === '');
    yes('a tool off the TOOLS table is still known', api.isTool(PICK) && !api.isTool(BREAD));
    yes('and gold is still Gold001', GOLD === 0x0000000F);
  }

  /*
    ------------------------------------------------------ THE FLOOR

    Patrick, 21 Oct 2026 (#3077): "don't spawn floor items anymore at all no
    matter what they are". Nothing a plugin placed lies on the floor any more:
    Thornswood-Last.esp switches every one off (tests/test-3077-floor-items.js
    holds the plugin to that). So a press on anything that is not a container
    is never refused here, whoever placed it, and the block carries no floor
    refusal and no coin purse rule to fall back on.
  */
  {
    const placed = 0x00012345;   // below 0xff000000: a plugin put it there
    const dropped = 0xff000123;  // above it: a person put it there
    yes('a press on a sword is never refused here, placed or dropped',
        api.activate(1, placed, 'sword:Skyrim.esm') === null && api.activate(1, dropped, 'sword:Skyrim.esm') === null);
    const flower = api.kind('flower:Skyrim.esm', 'FLOR');
    yes('nor on a flora of any kind, and nothing is put back for one',
        api.activate(7, placed, 'd790c:Skyrim.esm') === null && api.activate(7, placed, 'flower:Skyrim.esm') === null &&
        api.putBacks.length === 0 && flower > 0);
    yes('the block has no floor refusal line and no coin purse rule left in it',
        !/put here by the world/.test(block) && !/isPurse|PURSES|putBack\(/.test(block) &&
        api.isPurse === undefined && api.PURSES === undefined);
  }

  /*
    ------------------------------------------------------ THE CHEST (#3078)

    The engine puts nothing of a container's record in it, so whatever is in
    a chest at the press is somebody's, and the press leaves it exactly as it
    is: no write, no mark, no timer.
  */
  {
    const chest = 0x00055555;
    const g2 = rig();
    g2.kind('chest:Skyrim.esm', 'CONT');
    g2.kind('sword:Skyrim.esm', 'WEAP');
    g2.kind('bread:Skyrim.esm', 'FOOD');
    const sword = g2.idOf('sword:Skyrim.esm'), bread = g2.idOf('bread:Skyrim.esm');
    const stored = [
      { baseId: sword, count: 3 },
      { baseId: g2.GOLD, count: 60 },
      { baseId: bread, count: 2 }
    ];
    g2.put(chest, stored.slice());
    const answer = g2.activate(1, chest, 'chest:Skyrim.esm');
    yes('a chest opens as it always did', answer === null);
    yes('and what a person stored in it stays, sword and gold included',
        JSON.stringify(g2.inv(chest)) === JSON.stringify(stored));
    yes('nothing is written on the chest', Object.keys(g2.store[chest]).join() === 'inventory');
    yes('and no timer is set to come back to it', g2.timers.length === 0);
  }

  // Nothing in the block reads or empties a container any more.
  {
    yes('there is no strip, no emptied mark and no timer in the spoils block',
        !/function strip\(/.test(block) && !/thornswoodStripped/.test(block) &&
        !/STRIPPED_PROPERTY/.test(block) && !/setTimeout/.test(block));
    yes('and the reason is written in it',
        /forbiddenBaseContainer/.test(block) && /#3078/.test(block));
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
