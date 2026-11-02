// test-1382-potion-window.js
//
// #1382, potions.md: "Inside 60 seconds, the first potion does what it says.
// The second heals or buffs at 50%. The third at 25%. The fourth and after do
// the sip of thirst and nothing else. The window is from the first swallow."
//
// Root cause (#1382): the engine applies a potion in onEatItem and the
// gamemode could only let it through whole. The engine now takes a scale
// (eatItemScale, skymp #62) and this checks the gamemode hands it the right
// one, before anything lands. Runs the REAL needs block over a stand-in mp
// and a clock turned by hand, and reads the REAL onEatItem handler.
//
// Read only.
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
function slice(a, b) {
  const i = gm.indexOf(a);
  const j = i < 0 ? -1 : gm.indexOf(b, i);
  return (i >= 0 && j >= 0) ? gm.slice(i, j + b.length) : null;
}
const needsBlock = slice('// ==== thornswood needs: hunger, thirst and exhaustion ====', '// ==== end thornswood needs ====');
yes('the needs block is in the gamemode', !!needsBlock);

const POTION = 0x39be5, FOOD = 0x64b3f, BREWED = 0xff000123;
const GOODBERRY = 0x2844d3;
const FOODS = { items: { 'potion:T.esm': { k: 'potion' }, 'food:T.esm': { k: 'food' }, 'berry:T.esm': { k: 'food' } } };
// Goodberry's food table kind is food, and its group says potion (#1382).
const FOOD_GROUPS = { items: { 'berry:T.esm': 'potion' } };
function idOf(d) { return d === 'potion:T.esm' ? POTION : d === 'food:T.esm' ? FOOD : d === 'berry:T.esm' ? GOODBERRY : 0; }

function rig() {
  const clock = { now: Date.UTC(2026, 9, 12, 16, 0, 0) };
  const store = {};
  const mp = {
    makeProperty: function () { },
    get: function (id, key) { if (id === 0 && key === 'onlinePlayers') { return []; } return store[id]; },
    set: function (id, key, v) { store[id] = JSON.parse(JSON.stringify(v)); }
  };
  const g = {};
  const api = new Function('globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
    'guard', 'notify', 'say', 'FOODS', 'FOOD_GROUPS', 'idOf', needsBlock + '\nreturn globalThis.__thornswoodNeeds;')(
    g, mp, { now: function () { return clock.now; } }, { log: function () { } },
    function () { return 0; }, function () { }, function (n, f) { return f; },
    function () { }, function () { }, FOODS, FOOD_GROUPS, idOf);
  return { N: api, clock: clock };
}

let r = null;
try { r = needsBlock ? rig() : null; } catch (e) { console.log('rig threw: ' + e.message); }
const N = r && r.N;
yes('the needs block hands out potionScale', !!N && typeof N.potionScale === 'function');

if (N && typeof N.potionScale === 'function') {
  const s = [1, 2, 3, 4, 5].map(function () { return N.potionScale(7, POTION); });
  yes('first potion whole, second half, third a quarter', s[0] === 1 && s[1] === 0.5 && s[2] === 0.25);
  yes('the fourth and after do nothing', s[3] === 0 && s[4] === 0);
  yes('somebody else has their own window', N.potionScale(8, POTION) === 1);
  yes('food is never scaled', N.potionScale(7, FOOD) === 1);
  r.clock.now += 59 * 1000;
  yes('still inside the minute from the first swallow', N.potionScale(7, POTION) === 0);
  r.clock.now += 1000;
  yes('a minute after the first swallow the window starts again', N.potionScale(7, POTION) === 1);
  yes('a brewed potion counts in the same window', N.potionScale(7, BREWED) === 0.5);
  yes('Goodberry, a potion by its group, counts too', N.potionScale(7, GOODBERRY) === 0.25);
  yes('the window is 60 seconds and the scales are the page\'s',
    N.NEEDS.potion.windowSeconds === 60 && JSON.stringify(N.NEEDS.potion.scales) === '[1,0.5,0.25,0]');
  yes('the sip of thirst is still 5', N.NEEDS.potion.def === 5);
}

const eat = slice("mp.onEatItem = guard('onEatItem', function (actorId, baseId) {", '\n  });');
// It asks effectScale since #2682, which is the potion window for anything a
// food strip does not take to nothing (test-2682-meal-help.js has the strip).
yes('onEatItem asks the needs block for the scale', !!eat && /effectScale\(actorId, Number\(baseId\) \|\| 0\)/.test(eat));
yes('and effectScale is the potion window for a potion', !!N && typeof N.effectScale === 'function' && /function effectScale\(actorId, baseId\) \{[\s\S]{0,160}?return potionScale\(actorId, baseId\);/.test(gm));
yes('and hands anything under whole to the engine as eatItemScale',
  !!eat && /if \(scale < 1\) \{ mp\.set\(actorId, 'eatItemScale', scale\); \}/.test(eat));
yes('before the cure and the withered count', !!eat && eat.indexOf('effectScale') !== -1 && eat.indexOf('effectScale') < eat.indexOf('swallowed('));

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
