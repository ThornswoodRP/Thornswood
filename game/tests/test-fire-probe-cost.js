// test-fire-probe-cost.js
//
// The fire probe never takes more than a few milliseconds of one frame.
// Issue #976, from the #963 performance audit.
//
// MEASURED 28 September on the dev front log: the place tick's worst single
// call was 385 ms, when it walked a cell holding 402 references of the four
// form types in one go, about 1 ms of native calls per reference. Resolving
// the 62 fire bases was another burst of 186 native calls in one frame.
//
// This lifts the real walk (CELL_TYPES through walkCellSlice) and the real
// probe (fireBases through fireDistance, fireWalkTick included) out of the
// plugin and runs them against a pretend cell of 402 references where every
// native call costs a third of a millisecond on the clock the plugin reads,
// the rate the audit measured (a pretend clock, so the numbers are exact and
// no busy machine can make them flaky). It times every call the place tick
// and the 'fire walk' handler make, frame by frame, until the walk is done,
// and checks:
//   - no single call takes 5 ms or more (the Done when on #976)
//   - the walk finishes, and finds exactly the lit fires of ours in the cell
//   - a cell change mid walk drops the old walk and walks the new cell
//   - nothing is walked while no walk is under way (the handler is one test)
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = process.env.FRONT || path.join(__dirname, '..', '..', 'game', 'plugins', 'thornswood-front.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function lift(from, fnName) {
  const a = src.indexOf(from);
  if (a < 0) { return null; }
  const f = src.indexOf('function ' + fnName + '(', a);
  if (f < 0) { return null; }
  const END = '\n  }\n';
  const b = src.indexOf(END, f);
  return b < 0 ? null : src.slice(a, b + END.length);
}

const walk = lift('  const CELL_TYPES = [', 'walkCellSlice');
const fires = lift('  let fireBases = 0;', 'fireDistance');
yes('the sliced cell walk is in the plugin', walk !== null);
yes('the fire probe is in the plugin', fires !== null);
yes('the walk has its own frame handler', /sp\.on\('update', guard\('fire walk', fireWalkTick\)\);/.test(src));
yes('the place tick no longer walks the cell whole (no refsInCell)', src.indexOf('refsInCell(') === -1);
if (walk === null || fires === null) {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(1);
}

// A native call, at the audit's measured cost.
const CALL_MS = 1 / 3;
// The pretend clock. A native call moves it on by its cost; nothing else
// does, so what a call "took" is exactly the native work it did.
const clock = { t: 1000 };
function spin(ms) { clock.t += ms; }
function now() { return clock.t; }
function msSince(t0) { return clock.t - t0; }

// 62 bases, like the real table. The first four are fires placed below.
const BASES = [];
for (let i = 0; i < 62; i++) { BASES.push(['Skyrim.esm', 0x13b40 + i]); }
const FIRE_A = 0x13b40, FIRE_B = 0x13b41, FIRE_OFF = 0x13b42, FIRE_FAR = 0x13b43;

function ref(base, x, y, z, off) {
  return {
    getBaseObject: function () { spin(CALL_MS); return { getFormID: function () { spin(CALL_MS); return base; } }; },
    getPositionX: function () { return x; },
    getPositionY: function () { return y; },
    getPositionZ: function () { return z; },
    isDisabled: function () { spin(CALL_MS); return !!off; }
  };
}

// 402 references across the four types, four of them fires of ours.
function busyCell(id) {
  const byType = { 24: [], 34: [], 36: [], 42: [] };
  const types = [24, 34, 36, 42];
  for (let i = 0; i < 398; i++) { byType[types[i % 4]].push(ref(0x500000 + i, 5000 + i, 0, 0)); }
  byType[24].splice(10, 0, ref(FIRE_A, 100, 0, 0));
  byType[34].splice(50, 0, ref(FIRE_B, 1000, 0, 0));
  byType[36].splice(70, 0, ref(FIRE_OFF, 20, 0, 0, true));
  byType[42].push(ref(FIRE_FAR, 3000, 0, 0));
  let calls = 0;
  const cell = {
    getFormID: function () { return id; },
    getNumRefs: function (t) { spin(CALL_MS); calls++; return byType[t].length; },
    getNthRef: function (i, t) { spin(CALL_MS); calls++; return byType[t][i]; }
  };
  cell.calls = function () { return calls; };
  cell.size = 402;
  return cell;
}

function harness(start, precise) {
  const logs = [];
  const log = function () { logs.push(Array.prototype.join.call(arguments, ' ')); };
  const where = { cell: start };
  const me = {
    getParentCell: function () { return where.cell; },
    getFurnitureReference: function () { return null; }
  };
  const sp = {
    Game: {
      getPlayer: function () { return me; },
      getFormEx: function (id) { spin(CALL_MS); return { id: id }; },
      getFormFromFile: function (id) { spin(CALL_MS); return { id: id }; }
    },
    Form: {
      from: function (raw) {
        spin(CALL_MS);
        return raw ? { getFormID: function () { spin(CALL_MS); return raw.id; } } : null;
      }
    }
  };
  // The plugin reads performance.now where the runtime has one and Date.now
  // where it does not; both read the pretend clock, Date.now in whole ms.
  const perf = precise ? { now: function () { return clock.t; } } : undefined;
  const date = { now: function () { return 1700000000000 + Math.floor(clock.t); } };
  const fn = new Function('sp', 'log', 'FIRE_BASES', 'FIRE_FILES', 'FIRE_REACH', 'FIRE_INSIDE', 'performance', 'Date', 'PLACED_WATERS', 'WADE_DEEP',
    walk + fires +
    '\nreturn { distance: fireDistance, tick: fireWalkTick,' +
    ' walking: function () { return !!fireWalk; },' +
    ' walked: function () { return fireWalked; }, hits: function () { return fireHits; } };');
  const api = fn(sp, log, BASES, ['Skyrim.esm'], 300, 90, perf, date, [], 70);
  api.logs = logs;
  api.me = me;
  api.where = where;
  api.sp = sp;
  return api;
}

// One frame: the place tick's probe (every frame here, harder than the real
// one second beat) and the 'fire walk' handler. Each call is timed.
function frame(h, x, stats) {
  let t0 = now();
  const d = h.distance(x, 0, 0, h.me);
  let ms = msSince(t0);
  if (ms > stats.worst) { stats.worst = ms; stats.worstWhat = 'place'; }
  t0 = now();
  h.tick();
  ms = msSince(t0);
  if (ms > stats.worst) { stats.worst = ms; stats.worstWhat = 'fire walk'; }
  stats.frames++;
  return d;
}

// Both clocks: performance.now (SkyrimPlatform's Node) and Date.now only.
[true, false].forEach(function (precise) {
  const on = precise ? 'performance.now' : 'Date.now only';

  // S1: walking into the busy cell, frame by frame until the walk is done.
  {
    const cell = busyCell(0x1605e);
    const h = harness(cell, precise);
    const stats = { worst: 0, worstWhat: '', frames: 0 };
    let d = -1;
    const began = now();
    for (let i = 0; i < 5000; i++) {
      d = frame(h, 50, stats);
      if (!h.walking() && d >= 0) { break; }
    }
    const total = msSince(began);
    console.log('      ' + on + ': 402 references in ' + stats.frames + ' frames, ' + total.toFixed(0) +
                ' ms of native work in all, worst single call ' + stats.worst.toFixed(2) + ' ms (' + stats.worstWhat + ')');
    yes('S1 ' + on + ': no single call of the probe takes 5 ms or more (worst ' + stats.worst.toFixed(2) + ' ms)', stats.worst < 5);
    yes('S1 ' + on + ': the walk finishes', !h.walking());
    yes('S1 ' + on + ': every reference was looked at', h.walked() === cell.size);
    yes('S1 ' + on + ': it finds the three lit fires of ours and not the one switched off', h.hits() === 3);
    yes('S1 ' + on + ': the nearest lit fire is 50 away', d === 50);
    yes('S1 ' + on + ': the log says so',
        h.logs.indexOf('fires: 3 of ours in this cell, out of 402 thing(s) looked at') >= 0);

    // S2: the finished list is kept. Another frame asks nothing of the cell.
    const asked = cell.calls();
    const s2 = { worst: 0, worstWhat: '', frames: 0 };
    for (let i = 0; i < 30; i++) { frame(h, 1000, s2); }
    yes('S2 ' + on + ': once walked, the cell is not asked again', cell.calls() === asked);
    yes('S2 ' + on + ': and the probe costs nothing (worst ' + s2.worst.toFixed(2) + ' ms)', s2.worst < 0.5);
  }

  // S3: a door mid walk. The old walk is dropped and the new cell is walked.
  {
    const first = busyCell(0x1000);
    const h = harness(first, precise);
    const stats = { worst: 0, worstWhat: '', frames: 0 };
    for (let i = 0; i < 5; i++) { frame(h, 50, stats); }
    yes('S3 ' + on + ': a walk is under way after five frames', h.walking());
    const second = busyCell(0x2000);
    h.where.cell = second;
    let d = -1;
    for (let i = 0; i < 5000; i++) {
      d = frame(h, 1000, stats);
      if (!h.walking() && d >= 0) { break; }
    }
    yes('S3 ' + on + ': the new cell is walked whole', h.walked() === second.size && !h.walking());
    yes('S3 ' + on + ': and the probe answers for it', d === 0);
    yes('S3 ' + on + ': still no call of 5 ms or more (worst ' + stats.worst.toFixed(2) + ' ms)', stats.worst < 5);
  }
});

// S4: nothing to do costs nothing. No walk, and the handler asks nothing.
{
  const cell = busyCell(0x3000);
  const h = harness(cell, true);
  for (let i = 0; i < 1000; i++) { h.tick(); }
  yes('S4 the fire walk handler with no walk under way asks the game nothing', cell.calls() === 0);
}

// S5: the world not up. The bases resolve to nothing, and that costs one
// slice every few seconds, not one every frame.
{
  const cell = busyCell(0x4000);
  const h = harness(cell, true);
  h.sp.Form.from = function () { spin(CALL_MS); return null; };
  let resolving = 0;
  const was = h.sp.Game.getFormEx;
  h.sp.Game.getFormEx = function (id) { resolving++; return was(id); };
  const stats = { worst: 0, worstWhat: '', frames: 0 };
  // Ten seconds of frames at sixty a second, pretend time moving with them.
  for (let i = 0; i < 600; i++) { clock.t += 16; frame(h, 50, stats); }
  yes('S5 bases that never resolve are asked for in bursts, not every frame (' + resolving + ' lookups in 10 s)',
      resolving <= 62 * 4);
  yes('S5 and no call reaches 5 ms (worst ' + stats.worst.toFixed(2) + ' ms)', stats.worst < 5);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
