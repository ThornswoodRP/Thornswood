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
// #4790: where water came from is the bottle's own record. The water bucket
// fills River Water (the content plugin's), a well fills Glacier Water, and a
// boil turns every River Water carried into Glacier Water in one write of the
// pack. A drink is judged by the bottle drunk, so a river bottle handed on is
// still river water, and the giver's next clean bottle is still clean.
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
const ROOT = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
const gm = require('../../tests/gamemode-tables.js').joined(fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'), 'utf8')).split(CR).join('');
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

const EMPTY = 0xf2012, FULL = 0x13f598, RIVER = 0x5018040;
const COOK = 'a5cb3:Skyrim.esm', WELL_ACT = '18030:Thornswood-Content.esp';
function idOf(d) {
  return d === 'f2012:Skyrim.esm' ? EMPTY : d === '13f598:WindhelmSSE.esp' ? FULL : d === '18040:Thornswood-Content.esp' ? RIVER : 0;
}

function rig() {
  const clock = { now: Date.UTC(2026, 9, 12, 17, 0, 0) };
  const store = {}, inv = {}, said = [], fouled = [];
  const mp = {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return []; }
      if (key === 'worldOrCellDesc' || key === 'pos') { return null; }
      if (key === 'inventory') {
        return { entries: Object.keys(inv[id] || {}).filter(function (b) { return inv[id][b] > 0; })
          .map(function (b) { return { baseId: Number(b), count: inv[id][b] }; }) };
      }
      return store[id];
    },
    set: function (id, key, v) {
      if (key === 'inventory') {
        inv[id] = {};
        v.entries.forEach(function (e) { inv[id][e.baseId] = (inv[id][e.baseId] || 0) + e.count; });
        return;
      }
      store[id] = JSON.parse(JSON.stringify(v));
    }
  };
  function count(id, b) { return (inv[id] && inv[id][b]) || 0; }
  function addItem(id, desc, n) { const b = idOf(desc); if (!b) { return false; } inv[id] = inv[id] || {}; inv[id][b] = count(id, b) + n; return true; }
  function takeItemById(id, b, n) { if (count(id, b) < n) { return false; } inv[id][b] -= n; return true; }
  const g = { __thornswoodHurt: { exposed: function (id, kind, source) { fouled.push([id, kind, source]); return false; } } };
  const N = new Function('globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
    'guard', 'notify', 'say', 'idOf', 'addItem', 'takeItemById', 'log',
    needsBlock + '\nreturn globalThis.__thornswoodNeeds;')(
    g, mp, { now: function () { return clock.now; } }, { log: function () { } },
    function () { return 0; }, function () { }, function (n, f) { return f; },
    function () { }, function (id, line) { said.push(line); }, idOf, addItem, takeItemById, function () { });
  return {
    N: N, clock: clock, said: said, fouled: fouled, count: count, addItem: addItem, takeItemById: takeItemById, store: store,
    fire: function (id, away) { N.place(id, 'outdoors', '-', '0', '0', '0', away === undefined ? '-' : String(away)); },
    seed: function (id) { const n = N.fresh(); n.at = clock.now; n.drink = 30; store[id] = n; },
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
  yes('a well with an empty bottle fills it with Glacier Water, clean', /clean/.test(N.activatedWater(A, 'w1:Test.esm', WELL_ACT, '')) &&
    r.count(A, EMPTY) === 9 && r.count(A, FULL) === 1 && r.count(A, RIVER) === 0);
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
  yes('the needs record keeps no count of where water came from (#4790)', !('water' in r.store[A]));

  // The water bucket by a river or a lake (#1382; Patrick, 20 Oct 2026: lake water is a river's).
  const RIVER_ACT = '18031:Thornswood-Content.esp';
  const C = 9; r.seed(C);
  yes('the water bucket is the one river activator listed', JSON.stringify(N.NEEDS.riverActivators) === JSON.stringify([RIVER_ACT]));
  yes('with no empty bottle it fills nothing', /empty bottle/.test(N.activatedWater(C, 'b1:Test.esm', RIVER_ACT, '')));
  r.addItem(C, 'f2012:Skyrim.esm', 3);
  yes('with one it fills a bottle of River Water, to be boiled (#4790)', /Boil it/.test(N.activatedWater(C, 'b1:Test.esm', RIVER_ACT, '')) &&
    r.count(C, RIVER) === 1 && r.count(C, FULL) === 0);
  yes('and has no cooldown', /Boil it/.test(N.activatedWater(C, 'b1:Test.esm', RIVER_ACT, '')) && r.count(C, RIVER) === 2);
  yes('River Water is a water item the drink rule reads', N.NEEDS.waterItems.river === '18040:Thornswood-Content.esp');

  // #4790: a river bottle handed on is still river water, and the giver's
  // next clean bottle is still clean.
  const D = 10; r.seed(D);
  r.addItem(C, '13f598:WindhelmSSE.esp', 1);
  N.activatedWater(C, 'b1:Test.esm', RIVER_ACT, '');   // a third River Water
  // C hands one River Water to D: the record goes with the bottle.
  r.takeItemById(C, RIVER, 1); r.addItem(D, '18040:Thornswood-Content.esp', 1);
  r.fouled.length = 0;
  before = r.thirst(D);
  N.consumed(D, RIVER);
  yes('a river bottle handed on drinks as river water for whoever has it (#4790)',
    Math.round(r.thirst(D) - before) === 20 && r.fouled.length === 1 && r.fouled[0][0] === D && r.fouled[0][2] === 'river');
  r.fouled.length = 0;
  N.consumed(C, FULL);
  yes('and the giver\'s clean bottle still drinks clean (#4790)', r.fouled.length === 0);

  // Boiling: activating a cooking spot, a minute by the fire.
  r.fire(C, 100);
  yes('activating something that is not a cooking spot boils nothing', N.activatedWater(C, 'b:Test.esm', 'b:Test.esm', 'other:Skyrim.esm') === '');
  yes('activating a cooking spot with River Water starts the boil', /over the fire/.test(N.activatedWater(C, 'pot:Test.esm', 'pot:Test.esm', COOK)));
  r.clock.now += 30 * 1000;
  r.fire(C, 400);
  yes('leaving the fire before the minute loses the boil', r.count(C, RIVER) === 2 &&
    r.said.some(function (l) { return /did not boil/.test(l); }));
  r.fire(C, 100);
  N.activatedWater(C, 'pot:Test.esm', 'pot:Test.esm', COOK);
  r.clock.now += 61 * 1000;
  const fullBefore = r.count(C, FULL);
  r.fire(C, 90);
  yes('a minute at the fire turns every River Water carried into Glacier Water (#4790)',
    r.count(C, RIVER) === 0 && r.count(C, FULL) === fullBefore + 2);
  r.fouled.length = 0;
  before = r.thirst(C);
  N.consumed(C, FULL);
  yes('boiled water is 20 and safe', Math.round(r.thirst(C) - before) === 20 && r.fouled.length === 0);
  yes('a cooking spot with no River Water says nothing', N.activatedWater(C, 'pot:Test.esm', 'pot:Test.esm', COOK) === '');
  yes('the cooking keyword is CraftingCookpot, the bench the cooking recipes are made at', N.NEEDS.cookKeyword === COOK);

  // A drink as the boil finishes: the bottle going down was boiled, and the
  // engine still finds the River Water it takes off after the drink.
  r.addItem(C, '18040:Thornswood-Content.esp', 2);
  N.activatedWater(C, 'pot:Test.esm', 'pot:Test.esm', COOK);
  r.clock.now += 61 * 1000;
  r.fouled.length = 0;
  N.consumed(C, RIVER);
  yes('a river bottle drunk as its boil finishes is clean, and one River Water is left for the engine to take (#4790)',
    r.fouled.length === 0 && r.count(C, RIVER) === 1);
  r.takeItemById(C, RIVER, 1);

  // A bottle the server never saw filled is Glacier Water, and safe.
  r.addItem(A, '13f598:WindhelmSSE.esp', 2);
  r.fouled.length = 0;
  N.consumed(A, FULL); N.consumed(A, FULL);
  yes('a bottle the server never saw filled is safe', r.fouled.length === 0);
}

const act = slice("mp.onActivate = guard('onActivate', function (refrId, casterRefrId) {", '\n});');
yes('mp.onActivate asks the needs block about water', !!act && /needsW\.activatedWater\(casterRefrId, refDescW, baseDesc, kwW\)/.test(act));
yes('before the bench gate, and without refusing the press', !!act && act.indexOf('activatedWater') < act.indexOf('benchGate') &&
  !/activatedWater[\s\S]{0,400}return false/.test(act.slice(act.indexOf('activatedWater'), act.indexOf('benchGate'))));
const wm = /^const WORDS = (\[[\s\S]*?\]);$/m.exec(gm);
yes('no /water command: gameplay is never a slash command', !!wm && wm[1].indexOf("'/water'") < 0 && gm.indexOf("word === '/water'") < 0);
yes('and no panel button sends one', UI.indexOf('/water') < 0 && UI.indexOf('Fill water') < 0);

console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
