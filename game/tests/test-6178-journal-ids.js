// test-6178-journal-ids.js
//
// #6178. A journal's id was the millisecond it was made and a random number
// under 1000, so two journals one character made in the same millisecond
// shared an id about one time in a thousand. findJournal then answered the
// first of them for both, so a page written into the second, and a share of
// it, went to the first. test-social.js runs on a clock that does not move,
// and failed U0 and U3 that way in the merge queue on 521ed2e.
//
// Here the real social block runs on a clock that does not move and a
// random number that never changes, so a collision is not one run in a
// thousand but every run: the ids must be unique by how they are made.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');

const REPO_DIR = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (detail !== undefined ? '  (' + detail + ')' : '')); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

const a = src.indexOf('// ==== thornswood social:');
const b = a < 0 ? -1 : src.indexOf('// ==== end thornswood social ====', a);
yes('the social block is in the gamemode', a >= 0 && b > a);
if (!(a >= 0 && b > a)) { done(); }
const social = src.slice(a, b);

// The engine keeps a property as JSON: what is read back is a copy, never
// the object that was set.
function world() {
  const store = {};
  const g = {};
  const mp = {
    makeProperty: function () {},
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return Object.keys(store).map(Number); }
      const row = store[id];
      if (!row || row[key] === undefined) { return undefined; }
      return JSON.parse(JSON.stringify(row[key]));
    },
    set: function (id, key, v) { if (!store[id]) { store[id] = {}; } store[id][key] = JSON.parse(JSON.stringify(v)); },
    lookupEspmRecordById: function () { return null; }
  };
  // The clock never moves and the dice always land the same.
  const still = Object.create(Math);
  still.random = function () { return 0.5; };
  new Function('globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
    'guard', 'say', 'notify', 'Math', 'Number', 'String', 'Object', 'Array', 'JSON', 'isFinite', 'parseInt',
    require('../../tests/fixtures/ordinary-quest-items') + social)(
    g, mp, { now: function () { return 1700000000000; } }, { log: function () {} },
    function () { return 1; }, function () {}, function (n, f) { return f; },
    function () {}, function () {}, still, Number, String, Object, Array, JSON, isFinite, parseInt);
  return { soc: g.__thornswoodSocial, store: store };
}

const w = world();
const M = 0xff000001;
w.store[M] = { profileId: 101, appearance: { name: 'Bjorn' } };
const first = w.soc.newJournal(M, 'First').journal;
const second = w.soc.newJournal(M, 'Second').journal;
yes('J1 two journals made in the same millisecond have different ids',
    !!first && !!second && first.id !== second.id, first && second && first.id + ' ' + second.id);

w.soc.writePage(M, second.id, '', 'Into the second', 'here');
const after = w.soc.stateOf(M);
yes('J2 a page written into the second journal is in the second, not the first',
    w.soc.findJournal(after, first.id).pages.length === 0 &&
    w.soc.findJournal(after, second.id).pages.length === 1);

// Dropping one and making another in the same millisecond still gives an id
// nobody holds, read back the way the engine hands the state back.
w.soc.dropJournal(M, first.id);
const third = w.soc.newJournal(M, 'Third').journal;
const ids = w.soc.stateOf(M).journals.map(function (j) { return j.id; });
yes('J3 a journal made after one was dropped takes an id no journal held',
    !!third && third.id !== first.id && third.id !== second.id && ids.length === 2 && ids[0] !== ids[1], ids.join(' '));

// The longest id is still the length test-2563-journal-length.js holds a
// Save line to: j, nine characters of time, two more.
yes('J4 an id is no longer than j, nine characters of time and two more',
    [first, second, third].every(function (j) { return j && j.id.length <= 12 && /^j[0-9a-z]+$/.test(j.id); }));

done();
