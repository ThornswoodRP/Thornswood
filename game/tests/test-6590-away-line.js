// test-6590-away-line.js
//
// #6590. A tester came back on main with Rest still at 24 and the server had
// nothing to say why: how long they were away, what they logged out on, and
// the meters before and after the time away were never written down. The
// logging out table (docs/systems/exhaustion.md) gives 24 back as 24 for
// anybody who logged out on their feet or a seat, and Rest 100 after a night
// in a bed that gives one, so the two can only be told apart by that line.
//
// Runs the REAL needs block over the stand-in mp test-1764-away-no-rest.js
// uses, with console.log caught: one line on the arrival, saying the time
// away, the place, rest, hunger and thirst before and after, and whether a
// night was slept; none on a settle that is not an arrival.
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(__dirname, '..', '..', 'game', 'gamemode.js');
const gm = fs.readFileSync(SRC, 'utf8').split(String.fromCharCode(13)).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}
const a = gm.indexOf('// ==== thornswood needs: hunger, thirst and exhaustion ====');
const b = gm.indexOf('// ==== end thornswood needs ====');
const needsBlock = a < 0 || b < 0 ? null : gm.slice(a, b);
yes('the needs block is in the gamemode', !!needsBlock);
if (!needsBlock) { done(); } else {

const HOUR = 3600000;

function rig() {
  const store = {};
  const clock = { now: Date.UTC(2026, 10, 18, 2, 0, 0) };
  const gone = {};
  const named = {};
  const lines = [];
  const g = {};
  g.__thornswoodCharacter = { stateOf: function () { return { v: 1 }; }, writeState: function () { } };
  g.__thornswoodBeds = { off: function () { return ''; } };
  const mp = {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return Object.keys(store).map(Number).filter(function (id) { return !gone[id]; }); }
      if (key === 'worldOrCellDesc') { return 'cell:X.esm'; }
      return store[id];
    },
    set: function (id, key, v) { store[id] = JSON.parse(JSON.stringify(v)); }
  };
  const FakeDate = { now: function () { return clock.now; } };
  const api = new Function('globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
    'guard', 'notify', 'say', needsBlock + '\nreturn globalThis.__thornswoodNeeds;')(
    g, mp, FakeDate, { log: function (s) { lines.push(String(s)); } }, function () { return 0; }, function () { },
    function (n, f) { named[n] = f; return f; },
    function () { }, function () { });
  return {
    N: api, store: store, clock: clock, lines: lines,
    leave: function (id) { gone[id] = true; named.needsTick(); },
    back: function (id) { delete gone[id]; },
    seed: function (id) { const n = api.fresh(); n.at = clock.now; store[id] = n; },
    away: function () { return lines.filter(function (l) { return / back after /.test(l); }); }
  };
}

const ME = 0xff000001;

/* Rest 24, resting in kind (or on their feet), logged out, back after ms. */
function trip(kind, ms) {
  const r = rig();
  r.seed(ME);
  r.N.settle(ME);              // their first sight this run, itself an arrival
  r.lines.length = 0;
  r.clock.now += 60000;
  r.N.settle(ME);              // online a minute later: not an arrival
  const onlineLines = r.away().length;
  const n0 = r.store[ME];
  n0.rest = 24;
  r.store[ME] = n0;
  if (kind) { r.N.resting(ME, kind); }
  r.leave(ME);
  r.clock.now += ms;
  r.back(ME);
  const n = r.N.settle(ME);
  const first = r.away();
  r.clock.now += 60000;
  r.N.settle(ME);
  return { n: n, onlineLines: onlineLines, first: first, after: r.away() };
}

{
  const t = trip('', 9 * HOUR);
  const line = t.first[0] || '';
  yes('no line for a settle while they are online', t.onlineLines === 0);
  yes('one line on the arrival', t.first.length === 1);
  yes('it says how long they were away (540m): ' + line, / back after 540m,/.test(line));
  yes('it says they logged out on their feet', /logged out on their feet:/.test(line));
  yes('it says Rest 24 stayed 24, as the table gives for their feet', t.n.rest === 24 && /rest 24 -> 24,/.test(line));
  yes('it says hunger and thirst before and after', /hunger \d+ -> \d+, thirst \d+ -> \d+/.test(line));
  yes('it says no night was given', /\(no night given\)$/.test(line));
  yes('and a settle after the arrival says nothing more', t.after.length === 1);
}
{
  const t = trip('bed', 9 * HOUR);
  const line = t.first[0] || '';
  yes('own bed and back a night later: the line names the bed and the night: ' + line,
      /logged out on bed:/.test(line) && /rest 24 -> 100,/.test(line) && /\(a night slept\)$/.test(line) && t.n.rest === 100);
}
{
  const t = trip('sit', 9 * HOUR);
  const line = t.first[0] || '';
  yes('a seat, a night away: named, and 24 stays 24 with no night given: ' + line,
      /logged out on sit:/.test(line) && /rest 24 -> 24,/.test(line) && /\(no night given\)$/.test(line));
}

done();
}
