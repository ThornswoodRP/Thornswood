// test-1382-drug.js
//
// #1382, docs/systems/exhaustion.md "A stimulant": skooma holds the rest
// drain at zero for 10 minutes, then costs 30 rest and 10 hunger; a second
// dose inside the window refreshes the clock and adds the crash again. All
// six drugs on the approved list (issuecomment-6127545395) take it.
//
// Root cause (issuecomment-6130045990): the needs block had no drug state.
//
// Runs the REAL needs block over a stand-in mp and clock. Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const gm = fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'), 'utf8').split(CR).join('');
let pass = 0, fail = 0;
function yes(what, ok) {
  if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function table(name) {
  const m = new RegExp('^const ' + name + ' = (\\{.*\\});$', 'm').exec(gm);
  return m ? JSON.parse(m[1]) : null;
}
const a = gm.indexOf('// ==== thornswood needs: hunger, thirst and exhaustion ====');
const b = gm.indexOf('// ==== end thornswood needs ====');
const needsBlock = (a >= 0 && b > a) ? gm.slice(a, b) : null;
const FOODS = table('FOODS'), GROUPS = table('FOOD_GROUPS');
const ids = {}; let next = 0x100;
[FOODS, GROUPS].forEach(function (t) { if (t) { for (const d in t.items) { if (!ids[d]) { ids[d] = next++; } } } });
function idOf(d) { return ids[d] || 0; }
const DRUGS = ['57a7a:Skyrim.esm', '1391d:Dawnguard.esm', '3f4bd:Skyrim.esm', 'dc172:Skyrim.esm', '936:Gourmet.esp', 'aed90:Skyrim.esm'];

const clock = { now: Date.UTC(2026, 9, 12, 18, 0, 0) };
const store = {};
const mp = {
  makeProperty: function () { },
  get: function (id, key) { if (id === 0 && key === 'onlinePlayers') { return []; } if (key === 'worldOrCellDesc' || key === 'pos') { return null; } return store[id]; },
  set: function (id, key, v) { store[id] = JSON.parse(JSON.stringify(v)); }
};
let N = null;
try {
  N = new Function('globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
    'guard', 'notify', 'say', 'idOf', 'FOODS', 'FOOD_GROUPS', needsBlock + '\nreturn globalThis.__thornswoodNeeds;')(
    { __thornswoodHurt: { exposed: function () { return false; } } }, mp,
    { now: function () { return clock.now; } }, { log: function () { } }, function () { return 0; }, function () { },
    function (n, f) { return f; }, function () { }, function () { }, idOf, FOODS, GROUPS);
} catch (e) { console.log('rig threw: ' + e.message); }

yes('all six drugs are in the drugs group', !!GROUPS && DRUGS.every(function (d) { return GROUPS.items[d] === 'drugs'; }));
const NEEDS = N && N.NEEDS;
yes('the drug is one config row: 10 minutes, 30 rest, 10 hunger', !!NEEDS && !!NEEDS.drug &&
  NEEDS.drug.holdMinutes === 10 && NEEDS.drug.crashRest === 30 && NEEDS.drug.crashFood === 10);

if (N && NEEDS && NEEDS.drug) {
  let who = 1;
  function person() {
    const id = who++;
    const n = N.fresh(); n.at = clock.now; n.food = 50; n.drink = 50; n.rest = 80; store[id] = n;
    return id;
  }
  const rate = NEEDS.drain.rest;   // per hour
  // Without a drug, for scale.
  const P = person();
  clock.now += 5 * 60000; N.settle(P);
  const plainDrop = 80 - store[P].rest;
  yes('rest drains on its own (for scale)', plainDrop > 0 && Math.abs(plainDrop - rate * 5 / 60) < 0.01);

  DRUGS.forEach(function (d, i) {
    const A = person();
    N.consumed(A, idOf(d));
    const food0 = store[A].food, rest0 = store[A].rest;
    clock.now += 5 * 60000; N.settle(A);
    const held = Math.abs(store[A].rest - rest0) < 1e-9;
    clock.now += 6 * 60000; N.settle(A);
    const expect = rest0 - 30 - rate * 1 / 60;
    const crashed = Math.abs(store[A].rest - expect) < 0.01 && Math.abs(store[A].food - (food0 - 30 - 0) ) < 50;
    if (i === 0) {
      yes('skooma holds the rest drain at zero inside the 10 minutes', held);
      yes('then costs 30 rest (plus the minute past the window)', Math.abs(store[A].rest - expect) < 0.01);
      yes('and 10 hunger', Math.abs((food0 - store[A].food) - (10 + NEEDS.drain.food * 11 / 60)) < 0.01);
      yes('the crash is paid once', store[A].drugCrash === 0 && store[A].drugUntil === 0);
    } else {
      yes(d + ' takes the same effect', held && crashed);
    }
  });

  const B = person();
  N.consumed(B, idOf('57a7a:Skyrim.esm'));
  const restB = store[B].rest;
  clock.now += 8 * 60000;
  N.consumed(B, idOf('57a7a:Skyrim.esm'));
  clock.now += 8 * 60000; N.settle(B);
  yes('a second dose refreshes the clock: still held 16 minutes in', Math.abs(store[B].rest - restB) < 1e-9 && store[B].drugCrash === 2);
  clock.now += 3 * 60000; N.settle(B);
  yes('and adds the crash again: 60 rest when it ends', Math.abs(store[B].rest - (restB - 60 - rate * 1 / 60)) < 0.01);

  // A drug is a meal on the food page's 8 seconds (#1382): one swallowed
  // inside them does nothing, so it starts no window and owes no crash.
  const C = person();
  N.consumed(C, idOf('65c98:Skyrim.esm'));   // Bread
  clock.now += 3000;
  N.consumed(C, idOf('57a7a:Skyrim.esm'));   // Skooma inside the 8 seconds
  yes('a drug inside the 8 seconds of a meal does nothing', !store[C].drugUntil && !store[C].drugCrash);
  clock.now += 6000;
  N.consumed(C, idOf('57a7a:Skyrim.esm'));   // after them
  yes('after the 8 seconds it takes', store[C].drugCrash === 1 && store[C].drugUntil > clock.now);

  // High, for the HUD's icon (#3143): on the record while the window is
  // open, kept by a read, and off at the settle that pays the crash.
  const D = person();
  yes('high is not on a record that took nothing', !store[D].drugged);
  N.consumed(D, idOf('57a7a:Skyrim.esm'));
  yes('a dose puts high on the record', store[D].drugged === true);
  clock.now += 5 * 60000; N.settle(D);
  yes('still high 5 minutes in, and a read keeps it', store[D].drugged === true && N.read(D).drugged === true);
  clock.now += 6 * 60000; N.settle(D);
  yes('not high once the window ends and the crash is paid', store[D].drugged === false && store[D].drugCrash === 0);
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
