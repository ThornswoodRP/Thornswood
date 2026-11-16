// test-profession-visible.js
//
// The client can see its own profession, and is told it as it arrives.
//
// WHY. Issue #509. The chargen property was made invisible to its owner, so a
// character whose old trade is still on it (migrate() leaves bard, merchant,
// priest, scholar and thief there) was shown no trade at all. It is now made
// the same as the character property the K panel reads: seen by its owner,
// not by neighbours. And the first tick that sees somebody online says their
// profession back to them through notify(), which proves the route.
//
// This cuts ensureProperties and chargenTick out of gamemode.js and drives
// them with a stand-in mp.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = process.env.GAMEMODE ||
            path.join(REPO_DIR, 'game', 'gamemode.js');
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

/** A top level function, from its first line to the brace that closes it. */
function cut(head) {
  const a = src.indexOf(head);
  if (a < 0) return null;
  const b = src.indexOf('\n}\n', a);
  return b < 0 ? null : src.slice(a, b + 3);
}

// ------------------------------------------------ the property is visible --

const ensure = cut('function ensureProperties() {');
yes('gamemode.js still has ensureProperties', ensure !== null);
if (!ensure) done();

const made = {};
const propBox = {
  mp: { makeProperty: function (name, opts) { made[name] = opts; } },
  CHARGEN_PROPERTY: 'thornswoodChargen', TOOL_PROPERTY: 'thornswoodTools',
  DEPOSIT_PROPERTY: 'thornswoodDeposit', SWING_PROPERTY: 'thornswoodSwing',
  PUTBACK_PROPERTY: 'thornswoodPutBack',
  ALERT_PROPERTY: 'thornswoodAlert',
  swingScript: function () { return ''; },
  putBackScript: function () { return ''; }, alertScript: function () { return ''; }
};
vm.runInNewContext(ensure + '\nensureProperties();', propBox,
                   { filename: 'gamemode.js ensureProperties' });

const chargen = made.thornswoodChargen;
yes('the chargen property is made', !!chargen);
if (!chargen) done();

// What the character property (the one the K panel reads, and the one the
// skill property became) is made with, read from its own makeProperty call.
const charAt = src.indexOf('mp.makeProperty(CHAR_PROPERTY, {');
const charOpts = charAt < 0 ? '' : src.slice(charAt, src.indexOf('});', charAt));
const ownerMatch = /isVisibleByOwner:\s*(true|false)/.exec(charOpts);
const neighMatch = /isVisibleByNeighbors:\s*(true|false)/.exec(charOpts);
yes('the character property is still made with both flags', !!ownerMatch && !!neighMatch);
if (!ownerMatch || !neighMatch) done();

yes('the chargen property is seen by its owner',
    chargen.isVisibleByOwner === true);
yes('the same as the character property (owner ' + ownerMatch[1] + ')',
    String(chargen.isVisibleByOwner) === ownerMatch[1]);
yes('and, like it, by no neighbour (neighbours ' + neighMatch[1] + ')',
    chargen.isVisibleByNeighbors === false &&
    String(chargen.isVisibleByNeighbors) === neighMatch[1]);

// ------------------------------------------- the profession is said back --

const tick = cut('function chargenTick() {');
yes('gamemode.js still has chargenTick', tick !== null);
if (!tick) done();

// Who is on, and what each one is.
let room = {};
let said = [];
let logged = [];
const box = {
  mp: {
    get: function (id, what) {
      if (id === 0 && what === 'onlinePlayers') return Object.keys(room).map(Number);
      if (what === 'isDead') return false;
      return undefined;
    }
  },
  CHARGEN_ENABLED: true,
  SETTLE_MS: 10000,
  firstSeen: new Map(),
  Date: Date, Set: Set, Array: Array, String: String, Number: Number,
  log: function () { logged.push(Array.prototype.slice.call(arguments).join(' ')); },
  say: function () { },
  notify: function (actorId, text) { said.push({ id: actorId, text: text }); },
  resolveArrival: function () { return null; }
};
box.globalThis = box;
box.__thornswoodProgression = {
  TABLE: { professions: {
    smith: { name: 'Smith' },
    mage: { name: 'Mage' }
  } },
  has: function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
};
box.__thornswoodCharacter = {
  grantKnown: function () { return 0; },
  stateOf: function (id) { return room[id]; },
  nameOf: function (k) { return k.charAt(0).toUpperCase() + k.slice(1); }
};
vm.runInNewContext(tick, box, { filename: 'gamemode.js chargenTick' });
const run = box.chargenTick;
yes('chargenTick is a function', typeof run === 'function');
if (typeof run !== 'function') done();

room = {
  1: { prof: 'smith', half: 'platewright' },
  2: { prof: 'mage', half: null },
  3: { prof: null, half: null },
  4: { prof: 'toString', half: null }
};
run();
function lineFor(id) {
  const hit = said.filter(function (s) { return s.id === id; });
  return hit.length ? hit.map(function (s) { return s.text; }).join(' | ') : null;
}
yes('a smith is told their profession and half (got ' + lineFor(1) + ')',
    lineFor(1) === 'Your profession: Smith, Platewright.');
yes('a mage, with no half, is told the profession alone (got ' + lineFor(2) + ')',
    lineFor(2) === 'Your profession: Mage.');
yes('somebody with no profession is told nothing', lineFor(3) === null);
yes('a profession key that is not in the table says nothing', lineFor(4) === null);

said = [];
run();
yes('the second tick, with everybody still on, says nothing again', said.length === 0);

room = {};
run();
room = { 1: { prof: 'smith', half: 'platewright' } };
said = [];
run();
yes('leaving and coming back is a new arrival, told again',
    lineFor(1) === 'Your profession: Smith, Platewright.');

// A character block that throws does not stop the tick.
box.__thornswoodCharacter.stateOf = function () { throw new Error('boom'); };
room = { 5: { prof: 'smith' } };
said = [];
logged = [];
let threw = false;
try { run(); } catch (e) { threw = true; }
yes('a broken state read is logged, not thrown',
    !threw && said.length === 0 &&
    logged.some(function (l) { return l.indexOf('could not say the profession') >= 0; }));

done();
