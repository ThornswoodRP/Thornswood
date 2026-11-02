// test-1764-away-no-rest.js
//
// #1764. The time somebody is logged out was counted at the rest rate of the
// seat or bed they logged out on. settle brings the meters up to now with
// restingGain, and on an arrival n.resting is still the place they left on,
// so the whole time away (up to 48 hours) gained that rate before arrived()
// decided the fill. exhaustion.md: "You are resting only while the place is
// true", and nobody comes back into the world sitting or lying down (#1734).
// Measured on main before the fix, Rest 30 and back 9 hours later: standing
// 0.0, a seat 97.5, a bed nobody can lend you 100, a seat by a fire 100.
//
// Runs the REAL needs block over the stand-in mp test-1606-logout-fill.js
// uses: lie or sit down at Rest 30, log out, come back, and read the meters.
//
// Since #2246 (Patrick, 12 Oct 2026) what the time away drains is the row of
// NEEDS.away for where they logged out: nothing in a bed indoors, half the
// clock and never under 25 anywhere else, and a night on a bedroll or a bed
// on the road leaves rest at least 50. So "the drain alone" below is that
// row's drain, floor and night, worked out here from the table, and never
// the place's rate per hour.
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(__dirname, '..', 'game', 'gamemode.js');
const gm = fs.readFileSync(SRC, 'utf8').split(String.fromCharCode(13)).join('');

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
const a = gm.indexOf('// ==== thornswood needs: hunger, thirst and exhaustion ====');
const b = gm.indexOf('// ==== end thornswood needs ====');
const needsBlock = a < 0 || b < 0 ? null : gm.slice(a, b);
yes('the needs block is in the gamemode', !!needsBlock);
if (!needsBlock) { done(); }

const HOUR = 3600000;
const MIN = 60000;

function rig(startAt, g) {
  const store = {};
  const clock = { now: startAt || Date.UTC(2026, 9, 4, 20, 0, 0) };
  const said = [];
  const gone = {};
  const named = {};
  const redrawn = [];
  const off = [];
  g = g || {};
  g.__thornswoodCharacter = {
    stateOf: function () { return { v: 1 }; },
    writeState: function (id) { redrawn.push(id); }
  };
  g.__thornswoodBeds = { off: function (id) { off.push(id); return ''; } };
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
    g, mp, FakeDate, { log: function () { } }, function () { return 0; }, function () { },
    function (n, f) { named[n] = f; return f; },
    function () { }, function (id, line) { said.push({ id: id, line: line }); });
  return {
    N: api, g: g, mp: mp, store: store, clock: clock, said: said, redrawn: redrawn, off: off,
    tick: function () { named.needsTick(); },
    leave: function (id) { gone[id] = true; named.needsTick(); },
    back: function (id) { delete gone[id]; },
    seed: function (id, at) { const n = api.fresh(); n.at = at || clock.now; store[id] = n; },
    slept: function (id) {
      return said.filter(function (s) { return s.id === id && /slept well/i.test(s.line); }).length;
    }
  };
}

const ME = 0xff000001;

/* Rest 30, resting in kind (or standing), logged out, back after away. The
   first settle after coming back is the arrival. */
function away(kind, ms, first) {
  const r = rig();
  r.seed(ME);
  r.N.settle(ME);
  const n0 = r.store[ME];
  n0.rest = 30;
  r.store[ME] = n0;
  if (kind) { r.N.resting(ME, kind); }
  const was = JSON.parse(JSON.stringify(r.store[ME]));
  r.leave(ME);
  r.clock.now += ms;
  r.back(ME);
  const n = first === 'tick' ? (r.tick(), r.N.read(ME)) : r.N.settle(ME);
  return { r: r, was: was, n: n, drain: r.N.NEEDS.drain.rest };
}

// ---- the source, read ----------------------------------------------------
{
  const code = needsBlock.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  yes('settle counts no rest gain on an arrival', /var gain = arriving \? 0 : restingGain\(actorId, n\);/.test(code));
}

// ---- the issue's measurement: Rest 30, back 9 hours later -------------------
const N = rig().N.NEEDS;
/* Rest 30 after ms away from kind, by NEEDS.away alone: the row's share of
   the clock, never under its floor from above it, then the night's rest. */
function want(kind, ms) {
  const row = N.away[kind || 'up'];
  let v = Math.max(0, 30 - N.drain.rest * row.drain * ms / HOUR);
  if (row.floor > 0 && 30 > row.floor && v < row.floor) { v = row.floor; }
  if (ms >= N.sleptFor && v < row.rest) { v = row.rest; }
  return v;
}
['', 'sit', 'rough', 'campfire', 'camp'].forEach(function (kind) {
  const t = away(kind, 9 * HOUR);
  const w = want(kind, 9 * HOUR);
  yes('9 hours away from ' + (kind ? kind + ' (' + N.recover[kind] + ' an hour)' : 'standing') +
      ' comes back at Rest ' + t.n.rest.toFixed(1) + ', the drain and the night alone (' + w + '), not the place\'s rate',
      Math.abs(t.n.rest - w) < 1e-9 && t.n.rest < 30 + (kind ? N.recover[kind] : 0) * 9 && t.r.slept(ME) === 0);
});

// ---- an hour away, where the drain shows ------------------------------------
['', 'sit', 'rough', 'campfire', 'camp'].forEach(function (kind) {
  const t = away(kind, HOUR);
  const w = want(kind, HOUR);
  yes('an hour away from ' + (kind || 'standing') + ' is ' + w + ', not more: ' + t.n.rest.toFixed(2),
      Math.abs(t.n.rest - w) < 1e-9 && w < 30 + (kind ? N.recover[kind] : 0));
});
{
  const t = away('sit', HOUR, 'tick');
  yes('whichever reader comes first: the needs tick counts the hour away the same way',
      Math.abs(t.n.rest - want('sit', HOUR)) < 1e-9);
}
{
  const t = away('bed', 20 * MIN);
  yes('your own bed, away less than a night: no fill, and the time away gained nothing (it drains nothing there since #2246)',
      Math.abs(t.n.rest - want('bed', 20 * MIN)) < 1e-9 && t.n.rest === 30 && t.r.slept(ME) === 0);
}

// ---- the logout fill (#1606) still counts for the beds that give it ----------
['bed', 'inn'].forEach(function (kind) {
  const t = away(kind, 9 * HOUR);
  yes('logging out in ' + (kind === 'bed' ? 'your own bed' : 'a bed you are allowed in') +
      ' and back a night later still fills rest to 100, once',
      t.n.rest === 100 && t.r.slept(ME) === 1 && t.n.resting === '');
});

// ---- online the whole time, the place is true and counts ---------------------
{
  const r = rig();
  r.seed(ME);
  r.N.settle(ME);
  const n0 = r.store[ME];
  n0.rest = 30;
  r.store[ME] = n0;
  r.N.resting(ME, 'sit');
  r.clock.now += HOUR;
  const n = r.N.settle(ME);
  yes('online on a seat for an hour still gains the seat\'s rate: ' + n.rest.toFixed(2),
      Math.abs(n.rest - (30 + N.recover.sit - N.drain.rest)) < 1e-9);
}

done();
