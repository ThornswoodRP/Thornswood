// test-1382-water.js
//
// #1382, drink.md and Patrick's answers of 12 Oct 2026. Water is drawn and
// boiled in the world, never by a command: activating a well with an empty
// bottle fills it, and activating a cooking spot boils the unboiled water you
// carry, a minute at the fire. Well water, Frostreach ice water and boiled
// water are safe; river, lake, sea and standing water are not until boiled.
// After somebody fills at a well, that well is done for them for one in-game
// day; other wells and boiled water still work.
//
// Root cause (#1382, issuecomment-6127861218 and issuecomment-6129142274):
// nothing collected or boiled water and nothing knew where it came from.
// The wells are statics and raise no activation, so the content plugin stands
// a well bucket beside each well it can (#1382), and NEEDS.wellActivators is
// that bucket.
//
// Runs the REAL needs block over a stand-in mp, inventory and clock, and
// reads the REAL onActivate handler and panel. Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'), 'utf8')).split(CR).join('');
const UI = fs.readFileSync(path.join(ROOT, 'game', 'ui', 'thornswood-skills.js'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, ok) {
  if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function slice(a, b) {
  const i = gm.indexOf(a);
  const j = i < 0 ? -1 : gm.indexOf(b, i);
  return (i >= 0 && j >= 0) ? gm.slice(i, j + b.length) : null;
}
function table(name) {
  const m = new RegExp('^const ' + name + ' = (\\{.*\\});$', 'm').exec(gm);
  return m ? JSON.parse(m[1]) : null;
}
const needsBlock = slice('// ==== thornswood needs: hunger, thirst and exhaustion ====', '// ==== end thornswood needs ====');
const WELLS = table('WELLS');
yes('the needs block is in the gamemode', !!needsBlock);
yes('the well table is in the gamemode, read out of the load order', !!WELLS && Array.isArray(WELLS.items) && WELLS.items.length > 0);

const EMPTY = 0xf2012, FULL = 0x13f598;
const COOK = 'a5cb3:Skyrim.esm', WELL_ACT = '18030:Thornswood-Content.esp';
function idOf(d) { return d === 'f2012:Skyrim.esm' ? EMPTY : d === '13f598:WindhelmSSE.esp' ? FULL : 0; }

function rig() {
  const clock = { now: Date.UTC(2026, 9, 12, 17, 0, 0) };
  const store = {}, inv = {}, said = [], fouled = [];
  const mp = {
    makeProperty: function () { },
    get: function (id, key) { if (id === 0 && key === 'onlinePlayers') { return []; } if (key === 'worldOrCellDesc' || key === 'pos') { return null; } return store[id]; },
    set: function (id, key, v) { store[id] = JSON.parse(JSON.stringify(v)); }
  };
  function count(id, b) { return (inv[id] && inv[id][b]) || 0; }
  function addItem(id, desc, n) { const b = idOf(desc); if (!b) { return false; } inv[id] = inv[id] || {}; inv[id][b] = count(id, b) + n; return true; }
  function takeItemById(id, b, n) { if (count(id, b) < n) { return false; } inv[id][b] -= n; return true; }
  const g = { __thornswoodHurt: { exposed: function (id, kind, source) { fouled.push([id, kind, source]); return false; } } };
  const N = new Function('globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
    'guard', 'notify', 'say', 'idOf', 'addItem', 'takeItemById',
    needsBlock + '\nreturn globalThis.__thornswoodNeeds;')(
    g, mp, { now: function () { return clock.now; } }, { log: function () { } },
    function () { return 0; }, function () { }, function (n, f) { return f; },
    function () { }, function (id, line) { said.push(line); }, idOf, addItem, takeItemById);
  return {
    N: N, clock: clock, said: said, fouled: fouled, count: count, addItem: addItem, store: store,
    fire: function (id, away) { N.place(id, 'outdoors', '-', '0', '0', '0', away === undefined ? '-' : String(away)); },
    seed: function (id) { const n = N.fresh(); n.at = clock.now; n.drink = 30; store[id] = n; },
    carry: function (id, src, k) { store[id].water = store[id].water || {}; store[id].water[src] = k; },
    water: function (id) { return (store[id] && store[id].water) || {}; },
    thirst: function (id) { return store[id].drink; }
  };
}

let r = null;
try { r = needsBlock ? rig() : null; } catch (e) { console.log('rig threw: ' + e.message); }
const N = r && r.N;
const ready = !!N && typeof N.activatedWater === 'function';
yes('the needs block answers activations for water', ready);

if (ready) {
  const A = 7;
  r.seed(A);

  // Wells: the content plugin's well bucket is the one activator listed (#1382).
  yes('the well bucket is the one well activator listed', JSON.stringify(N.NEEDS.wellActivators) === JSON.stringify([WELL_ACT]));
  yes('activating anything that is not listed fills nothing', N.activatedWater(A, 'ref:Test.esm', 'other:Test.esm', '') === '');
  yes('a well with no empty bottle fills nothing', /empty bottle/.test(N.activatedWater(A, 'w1:Test.esm', WELL_ACT, '')));
  r.addItem(A, 'f2012:Skyrim.esm', 10);
  yes('a well with an empty bottle fills it clean', /clean/.test(N.activatedWater(A, 'w1:Test.esm', WELL_ACT, '')) &&
    r.water(A).well === 1 && r.count(A, EMPTY) === 9 && r.count(A, FULL) === 1);
  yes('the same well again is on cooldown and says for how long',
    /drawn from this well today/.test(N.activatedWater(A, 'w1:Test.esm', WELL_ACT, '')) &&
    /72 minutes/.test(N.activatedWater(A, 'w1:Test.esm', WELL_ACT, '')));
  const B = 8; r.seed(B); r.addItem(B, 'f2012:Skyrim.esm', 1);
  yes('the cooldown is that person\'s alone', /clean/.test(N.activatedWater(B, 'w1:Test.esm', WELL_ACT, '')));
  yes('another well still works', /clean/.test(N.activatedWater(A, 'w2:Test.esm', WELL_ACT, '')));
  r.clock.now += 71 * 60000;
  yes('still on cooldown inside the day', /drawn from this well today/.test(N.activatedWater(A, 'w1:Test.esm', WELL_ACT, '')));
  r.clock.now += 61 * 1000;
  yes('after one in-game day the well works again', /clean/.test(N.activatedWater(A, 'w1:Test.esm', WELL_ACT, '')));
  yes('the cooldown is one number: 72 real minutes, a game day at twenty times', N.NEEDS.wellCooldownMinutes === 72);
  r.fouled.length = 0;
  let before = r.thirst(A);
  N.consumed(A, FULL);
  yes('well water is 20 and safe without boiling', Math.round(r.thirst(A) - before) === 20 && r.fouled.length === 0);

  // The water bucket by a river or a lake (#1382; Patrick, 20 Oct 2026: lake water is a river's).
  {
    const RIVER_ACT = '18031:Thornswood-Content.esp';
    const C = 9; r.seed(C);
    yes('the water bucket is the one river activator listed', JSON.stringify(N.NEEDS.riverActivators) === JSON.stringify([RIVER_ACT]));
    yes('with no empty bottle it fills nothing', /empty bottle/.test(N.activatedWater(C, 'b1:Test.esm', RIVER_ACT, '')));
    r.addItem(C, 'f2012:Skyrim.esm', 2);
    yes('with one it fills river water, to be boiled', /Boil it/.test(N.activatedWater(C, 'b1:Test.esm', RIVER_ACT, '')) &&
      r.water(C).river === 1 && r.count(C, FULL) === 1);
    yes('and has no cooldown', /Boil it/.test(N.activatedWater(C, 'b1:Test.esm', RIVER_ACT, '')) && r.water(C).river === 2);
  }

  // Unsafe water, worst first.
  r.carry(A, 'well', 0); delete r.store[A].water.well;
  r.carry(A, 'river', 1); r.carry(A, 'standing', 1);
  r.addItem(A, '13f598:WindhelmSSE.esp', 2);
  r.fouled.length = 0;
  before = r.thirst(A);
  N.consumed(A, FULL);
  yes('drinking takes the worst first: standing water, 15, and asks the disease block',
    Math.round(r.thirst(A) - before) === 15 && r.fouled.length === 1 && r.fouled[0][1] === 'fouled' && r.fouled[0][2] === 'standing');

  // Boiling: activating a cooking spot, a minute by the fire.
  r.fire(A, 100);
  yes('activating something that is not a cooking spot boils nothing', N.activatedWater(A, 'b:Test.esm', 'b:Test.esm', 'other:Skyrim.esm') === '');
  yes('activating a cooking spot with unboiled water starts the boil', /over the fire/.test(N.activatedWater(A, 'pot:Test.esm', 'pot:Test.esm', COOK)));
  r.clock.now += 30 * 1000;
  r.fire(A, 400);
  yes('leaving the fire before the minute loses the boil', r.water(A).river === 1 && !r.water(A).boiled &&
    r.said.some(function (l) { return /did not boil/.test(l); }));
  r.fire(A, 100);
  N.activatedWater(A, 'pot:Test.esm', 'pot:Test.esm', COOK);
  r.clock.now += 61 * 1000;
  r.fire(A, 90);
  yes('a minute at the fire boils it', r.water(A).boiled === 1 && !r.water(A).river);
  r.fouled.length = 0;
  before = r.thirst(A);
  N.consumed(A, FULL);
  yes('boiled water is 20 and safe', Math.round(r.thirst(A) - before) === 20 && r.fouled.length === 0);
  yes('a cooking spot with no unboiled water says nothing', N.activatedWater(A, 'pot:Test.esm', 'pot:Test.esm', COOK) === '');
  yes('the cooking keyword is CraftingCookpot, the bench the cooking recipes are made at', N.NEEDS.cookKeyword === COOK);

  // Frostreach ice water is safe, and a bottle never counted is safe.
  r.carry(A, 'ice', 1); r.addItem(A, '13f598:WindhelmSSE.esp', 2);
  r.fouled.length = 0;
  N.consumed(A, FULL); N.consumed(A, FULL);
  yes('Frostreach ice water and a bottle the server never saw filled are safe', r.fouled.length === 0);

  r.carry(A, 'river', 1);
  N.settle(A);
  yes('water carried survives the next read', r.water(A).river === 1);
}

const act = slice("mp.onActivate = guard('onActivate', function (refrId, casterRefrId) {", '\n});');
yes('mp.onActivate asks the needs block about water', !!act && /needsW\.activatedWater\(casterRefrId, refDescW, baseDesc, kwW\)/.test(act));
yes('before the bench gate, and without refusing the press', !!act && act.indexOf('activatedWater') < act.indexOf('benchGate') &&
  !/activatedWater[\s\S]{0,400}return false/.test(act.slice(act.indexOf('activatedWater'), act.indexOf('benchGate'))));
const wm = /^const WORDS = (\[[\s\S]*?\]);$/m.exec(gm);
yes('no /water command: gameplay is never a slash command', !!wm && wm[1].indexOf("'/water'") < 0 && gm.indexOf("word === '/water'") < 0);
yes('and no panel button sends one', UI.indexOf('/water') < 0 && UI.indexOf('Fill water') < 0);

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
