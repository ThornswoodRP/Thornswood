// test-dressed-at-creation.js
//
// A new character is dressed, packed and paid at the moment it is made, and
// nothing asks its game to put anything on afterwards.
//
// WHY. Patrick, 4 October: "my clothes should just stay on from the moment
// someone creates a new character until they take them off", and "as soon as
// they click the new character button in the main menu clothes and gear and
// gold". The engine could not write what a character wears, so creation put
// the shift in the pack marked worn and four asks kept telling the client to
// wear it, one of which put back on clothes somebody had taken off (#1560,
// #1604). The engine's equipment write (fork PR 22) takes an actor no client
// owns, and its spawn calls __thornswoodChargen.created before it hands the
// new character over.
//
// This lifts the real created(), beginAppearance, giveShift,
// dressNewCharacter and the spoils purse out of gamemode.js by text and runs
// them against a stand-in mp that holds the engine's rules for the equipment
// write: refused for an owned actor, refused for something not in the pack,
// refused for an entry that is not worn. GM points it at another copy of the
// file, which is how it was shown to fail on the code before the change.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(__dirname, '..', '..', 'game', 'gamemode.js');
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

function fnOf(head, end) {
  const a = src.indexOf(head);
  const b = a < 0 ? -1 : src.indexOf(end || '\n}\n', a);
  return (a >= 0 && b >= 0) ? src.slice(a, b + (end ? end.length : 2)) : null;
}
const PIECES = {
  faceMark: fnOf('function faceMark(a) {'),
  chargenOf: fnOf('function chargenOf(actorId) {'),
  setChargen: fnOf('function setChargen(actorId, state) {'),
  beginAppearance: fnOf('function beginAppearance(actorId) {'),
  giveShift: fnOf('function giveShift(actorId) {'),
  dressNewCharacter: fnOf('function dressNewCharacter(actorId) {'),
  purse: fnOf('  function purse(actorId) {', '\n  }\n'),
};
const createdAt = src.indexOf('  created: function (actorId) {');
const createdEnd = createdAt < 0 ? -1 : src.indexOf('\n  },\n', createdAt);
const created = createdAt >= 0 && createdEnd >= 0
  ? src.slice(createdAt + '  created: '.length, createdEnd + '\n  }'.length) : null;
const CHARGEN_SRC = (/\nconst CHARGEN = (\{[^\n]*\});/.exec(src) || [])[1] || null;
const HALL_SRC = (/\nconst HALL = (\{[\s\S]*?\n\});/.exec(src) || [])[1] || null;
const PROP = (/\nconst CHARGEN_PROPERTY = '([^']+)';/.exec(src) || [])[1] || null;
const PURSE = Number((/\n  var PURSE = (\d+);/.exec(src) || [])[1]) || 0;

for (const k of Object.keys(PIECES)) { yes(k + ' is in the file', !!PIECES[k]); }
yes('created() is in the file', !!created);
yes('and so are the shift, the hall and the purse', !!CHARGEN_SRC && !!HALL_SRC && !!PROP && PURSE > 0);
if (fail) { done(); }

const CHARGEN = JSON.parse(CHARGEN_SRC);
const HALL = new Function('return ' + HALL_SRC)();
const ids = { '1be1a:Skyrim.esm': 0x1be1a, '1be1b:Skyrim.esm': 0x1be1b };
const GOLD = 0xf;

/*
  The engine, as far as these calls reach it. The equipment record is checked
  the way EquipmentBinding::Set checks it in the fork (PR 22), and is counted
  there.
*/
function world(ownedIds) {
  const props = {};
  const writes = [];
  const lines = [];
  const owned = new Set(ownedIds || []);
  const copy = v => v === undefined ? v : JSON.parse(JSON.stringify(v));
  const mp = {
    get(id, key) {
      const v = (props[id] || {})[key];
      if (v !== undefined) { return copy(v); }
      if (key === 'inventory') { return { entries: [] }; }
      if (key === 'equipment') { return { inv: { entries: [] }, numChanges: 0 }; }
      if (key === 'worldOrCellDesc') { return HALL.desc; }
      return undefined;
    },
    set(id, key, value) {
      if (key === 'equipment') {
        if (owned.has(id)) {
          throw new Error("mp.set can only change 'equipment' for an actor no client owns");
        }
        const pack = mp.get(id, 'inventory').entries;
        for (const e of value.inv.entries) {
          if (!e.worn && !e.wornLeft) { throw new Error("mp.set 'equipment': not marked worn"); }
          if (!pack.some(p => p.baseId === e.baseId)) { throw new Error("mp.set 'equipment': not in its inventory"); }
        }
        value = { inv: value.inv, numChanges: mp.get(id, 'equipment').numChanges + 1 };
      }
      (props[id] = props[id] || {})[key] = copy(value);
      writes.push(key);
    },
  };
  const log = (...a) => lines.push(a.join(' '));
  const purse = new Function('mp', 'GOLD', 'PURSE', 'PURSE_PROPERTY', 'slog',
    PIECES.purse + '\nreturn purse;')(mp, GOLD, PURSE, 'thornswoodPurse', log);
  const g = { __thornswoodSpoils: { purse: purse } };
  const firstSeen = new Map();
  const make = new Function('mp', 'log', 'idOf', 'SHIFT', 'HALL', 'CHARGEN_PROPERTY', 'CHARGEN_ENABLED',
    'firstSeen', 'sendToHall', 'tellOnce', 'tellKeptCharacter', 'globalThis',
    PIECES.faceMark + '\n' + PIECES.chargenOf + '\n' + PIECES.setChargen + '\n' +
    PIECES.giveShift + '\n' + PIECES.dressNewCharacter + '\n' + PIECES.beginAppearance + '\n' +
    'return ' + created + ';');
  const createdFn = make(mp, log, d => ids[d] || 0, CHARGEN.shift, HALL, PROP, true,
    firstSeen, () => false, () => {}, () => false, g);
  return { mp, writes, lines, created: createdFn };
}

// ---------------------------------------------------- the moment it is made
{
  const w = world();
  w.created(0xff000021);
  const pack = w.mp.get(0xff000021, 'inventory').entries;
  const eq = w.mp.get(0xff000021, 'equipment');
  yes('the shift is in the pack', pack.some(e => e.baseId === 0x1be1a) && pack.some(e => e.baseId === 0x1be1b));
  yes('the starting purse is in the pack',
    pack.some(e => e.baseId === GOLD && e.count === PURSE));
  yes('and the shift is worn in the equipment record the client dresses from',
    eq.inv.entries.length === 2 &&
    eq.inv.entries.every(e => e.worn === true && (e.baseId === 0x1be1a || e.baseId === 0x1be1b)));
  yes('written once', eq.numChanges === 1 && w.writes.filter(k => k === 'equipment').length === 1);
  yes('the creation stage is written before anything goes in the pack',
    w.writes.indexOf(PROP) >= 0 && w.writes.indexOf(PROP) < w.writes.indexOf('inventory'));
  yes('every pack write, the purse included, comes before the record, which may only name what is in it',
    w.writes.indexOf('equipment') > 0 && w.writes.lastIndexOf('inventory') < w.writes.indexOf('equipment'));
  yes('the log says it was dressed before it was handed over',
    w.lines.some(l => /dressed in 2 thing\(s\) before it was handed over/.test(l)));
}

// ------------------------------------------ and only at the moment it is made
{
  // Should anything ever call created() after the hand-over, the engine
  // refuses the write, creation goes on, and the log says so.
  const w = world([0xff000022]);
  let threw = null;
  try { w.created(0xff000022); } catch (e) { threw = e; }
  yes('an owned character is not dressed by the server, and creation does not throw', threw === null);
  yes('the refusal is in the log',
    w.lines.some(l => /could not be dressed/.test(l)));
  yes('and its record is left as its game reported it',
    w.mp.get(0xff000022, 'equipment').inv.entries.length === 0);
}

// ------------------------------------------------------ nothing asks again
{
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  // wornNow stays: it only reads the record, for the embassy (#1390).
  for (const gone of ['wearThese', 'wearWhatIsWorn', 'dressIfBare', 'wearScript',
                      'WEAR_PROPERTY', 'thornswoodWear', 'DRESS_TRIES', 'DRESS_EVERY']) {
    yes('no ' + gone + ' left in the gamemode', !new RegExp('\\b' + gone + '\\b').test(code));
  }
  // Two writes, each in the one function named for it: dressNewCharacter
  // dresses a new character, and since #2145 (#1651) durability's setRecord
  // renames a worn piece in the record when the pack renames it, changing
  // nothing worn (EquipmentBinding::Set in the fork). Any third write, or
  // either one moving out of its function, is a dress ask coming back.
  const writers = [];
  const writeAt = /mp\.set\([^,]+, 'equipment'/g;
  for (let m = writeAt.exec(code); m; m = writeAt.exec(code)) {
    const before = code.slice(0, m.index);
    const named = [];
    const fnAt = /function (\w+)\(|(\w+): function \(/g;
    for (let f = fnAt.exec(before); f; f = fnAt.exec(before)) { named.push(f[1] || f[2]); }
    writers.push(named[named.length - 1]);
  }
  yes('the equipment record is written in two places, dressNewCharacter and the rename in setRecord',
    writers.length === 2 && writers[0] === 'dressNewCharacter' && writers[1] === 'setRecord');
  const front = fs.readFileSync(path.join(__dirname, '..', '..', 'game', 'plugins', 'thornswood-front.js'), 'utf8')
    .split(CR).join('').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  yes('and the front plugin does not put the shift on by itself',
    !/wearTheShift|SHIFT_IDS/.test(front));
}

done();
