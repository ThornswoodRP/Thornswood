'use strict';
// Actual client walk and water query. Fixed world points use the pinned
// CommonLib b93280e8 NiMatrix3 XYZ row-dot convention, not generic Rz.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const source = fs.readFileSync(process.env.FRONT || path.join(__dirname, '../plugins/thornswood-front.js'), 'utf8').replace(/\r/g, '');
function lift(name) {
  const a = source.indexOf('  function ' + name + '('), b = source.indexOf('\n  }\n', a);
  assert(a >= 0 && b > a, name + ' exists'); return source.slice(a, b + 5);
}
let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message); } }
const box = { 101: [10, -20, 100, 40], 102: [-512, -512, 512, 512] };
const at = new Function('waterBox', lift('placedWaterAt') + ';return placedWaterAt;')(box);
const row = (scale = 1, ax = 0, ay = 0, az = 0) => [0, 0, 48, 101, scale, ax, ay, az];
function wet(x, y, z, r, top = 48) {
  const got = at(x, y, z, [r], 70); assert(got, 'inside water');
  assert(Math.abs(got.top - top) < 1e-7, 'world surface');
  assert(Math.abs(got.deep - (top - z)) < 1e-7, 'world vertical depth');
}
test('known identity transform retains ordinary footprint and depth', () => wet(80, 10, 32, row()));
test('double scale reaches the actual longer edge', () => wet(160, 0, 32, row(2)));
test('half scale excludes the old unscaled edge', () => assert.equal(at(75, 0, 32, [row(.5)], 70), null));
test('clockwise yaw90 includes the fixed off-center world point', () => wet(10, -80, 32, row(1, 0, 0, 90)));
test('clockwise yaw90 excludes the unrotated long edge', () => assert.equal(at(80, 0, 32, [row(1, 0, 0, 90)], 70), null));
test('negative yaw uses the opposite fixed world point', () => wet(-10, 80, 32, row(1, 0, 0, -90)));
test('whole turns preserve the same orientation', () => wet(10, -80, 32, row(1, 0, 0, 450)));
test('yaw45 respects asymmetric bounds rather than an enclosing square', () => {
  wet(90 / Math.sqrt(2), -70 / Math.sqrt(2), 32, row(1, 0, 0, 45));
  assert.equal(at(95, 35, 32, [row(1, 0, 0, 45)], 70), null);
});
test('a rotated footprint includes its edge and excludes a point just beyond it', () => {
  wet(140 / Math.sqrt(2), -60 / Math.sqrt(2), 32, row(1, 0, 0, 45));
  assert.equal(at(140.01 / Math.sqrt(2), -60.01 / Math.sqrt(2), 32, [row(1, 0, 0, 45)], 70), null);
});
test('translation and scale compose around the reference origin', () => {
  const r = row(2, 0, 0, 90); r[0] = 1000; r[1] = -2000; r[2] = 100;
  wet(1020, -2160, 84, r, 100);
});
test('tilted X plus yaw intersects the surface before inverse footprint', () => wet(10, -40 * Math.sqrt(3), 72, row(1, 30, 0, 90), 88));
test('tilted Y changes the actual water height', () => wet(40 * Math.sqrt(3), 10, 72, row(1, 0, 30, 0), 88));
test('all three Euler axes match a fixed independently calculated world point', () => {
  const top = 88 + 2.5 * Math.sqrt(3);
  wet(5 * Math.sqrt(3), 2.5 - 40 * Math.sqrt(3), top - 16, row(1, 30, 30, 90), top);
});
test('Temple pool remains16 deep with explicit known identity transform', () => wet(10, -20, 32, [0, 0, 48, 102, 1, 0, 0, 0]));
test('surface, rim and too-deep feet retain strict wading bounds', () => {
  for (const z of [48, 60, -22, -23]) assert.equal(at(80, 0, z, [row()], 70), null);
});
test('overlapping water still chooses the nearest surface above the feet', () => {
  const upper = row(); upper[2] = 60;
  assert.equal(at(80, 0, 32, [upper, row()], 70).top, 48);
});
test('missing transforms never silently become identity', () => assert.equal(at(80, 0, 32, [[0, 0, 48, 101]], 70), null));
for (const [index, value] of [[0, NaN], [1, Infinity], [2, NaN], [4, 0], [4, -1], [4, NaN], [5, NaN], [6, Infinity], [7, '90']]) {
  test('malformed transform refuses index' + index + ' value' + String(value), () => {
    const r = row(); r[index] = value; assert.equal(at(80, 0, 32, [r], 70), null);
  });
}
test('vertical and numerically singular planes refuse a guessed height', () => {
  assert.equal(at(80, 0, 32, [row(1, 90)], 70), null);
  assert.equal(at(80, 0, 32, [row(1, 89.99999999)], 70), null);
});
test('bad bounds and unknown water bases refuse', () => {
  box[103] = [0, 0, Infinity, 1]; box[104] = [100, 0, 10, 40];
  for (const id of [103, 104, 105]) { const r = row(); r[3] = id; assert.equal(at(80, 0, 32, [r], 70), null); }
});
// Every call crossing the native boundary is charged, including positions.
const walkStart = source.indexOf('  const CELL_TYPES = [');
const walkEnd = source.indexOf('\n  }\n', source.indexOf('  function walkCellSlice(')) + 5;
const walkSource = source.slice(walkStart, walkEnd);
function rig(specs, precise = true) {
  let clock = 1000, frame = 0, nativeCalls = 0, transformCalls = 0;
  const errors = [], ticks = [], w = { t: 0, i: 0, n: -1, walked: 0, out: [] };
  function native(fn, lease) { return () => { assert.equal(lease, frame, 'native wrapper used only in its frame'); clock += 1 / 3; nativeCalls++; return fn(); }; }
  function ref(spec, index) {
    const lease = frame, r = {};
    r.getFormID = native(() => spec.ref === undefined ? 5000 + index : spec.ref, lease);
    r.getBaseObject = native(() => ({ getFormID: native(() => spec.base, lease) }), lease);
    r.isDisabled = native(() => { if (spec.throw === 'isDisabled') throw Error('unknown disabled state'); return !!spec.off; }, lease);
    for (const [method, value] of [['getPositionX', 0], ['getPositionY', 0], ['getPositionZ', 48]]) r[method] = native(() => spec[method] === undefined ? value : spec[method], lease);
    for (const [method, value] of [['getScale', 2], ['getAngleX', 0], ['getAngleY', 0], ['getAngleZ', 90]]) {
      r[method] = native(() => { transformCalls++; if (spec.throw === method) throw Error('fixture unreadable transform'); return spec[method] === undefined ? value : spec[method]; }, lease);
      if (spec.missing === method) delete r[method];
    }
    return r;
  }
  const walk = new Function('performance', 'Date', walkSource + ';return walkCellSlice;')(
    precise ? { now: () => clock } : undefined, { now: () => Math.floor(clock) });
  let done = false;
  function tick(prior = 1 / 3) {
    frame++; const start = clock, lease = frame;
    const cell = { getNumRefs: type => { clock += 1 / 3; nativeCalls++; return type === 24 ? specs.length : 0; }, getNthRef: i => { clock += 1 / 3; nativeCalls++; return ref(specs[i], i); } };
    // Shared resolving work consumes some of the same frame before the walk.
    const began = precise ? clock : Math.floor(clock); clock += prior;
    done = walk(cell, w, { 101: true, 201: true }, e => errors.push(String(e)), began, { 101: true });
    ticks.push(clock - start);
  }
  return { w, errors, ticks, tick, finish() { for (let n = 0; n < 1000 && !done; n++) tick(); assert(done, 'bounded walk completes'); },
    transformCalls: () => transformCalls, nativeCalls: () => nativeCalls };
}
test('the actual reference walk captures scale and Euler angles as numbers', () => {
  const r = rig([{ base: 101 }]); r.finish(); assert.deepEqual(r.w.out[0], row(2, 0, 0, 90));
});
test('non-water fire paths never ask transform getters', () => {
  const r = rig([{ base: 201 }]); r.finish(); assert.equal(r.transformCalls(), 0); assert.deepEqual(r.w.out[0], [0, 0, 48, 201]);
});
for (const spec of [{ off: true }, { throw: 'getScale' }, { missing: 'getAngleX' }, { throw: 'isDisabled' }, { getScale: 0 }, { getAngleY: NaN }, { getPositionZ: Infinity }]) {
  test('disabled or unreadable current reference is not recorded as water ' + JSON.stringify(spec), () => {
    const r = rig([{ base: 101, ...spec }]); r.finish(); assert.equal(r.w.out.length, 0);
  });
}
for (const precise of [true, false]) test('water-heavy shared slices retain the less-than5ms bound precise=' + precise, () => {
  const r = rig(Array.from({ length: 42 }, (_, i) => ({ base: i % 3 ? 101 : 201 })), precise); r.finish();
  assert.equal(r.w.out.length, 42); assert(Math.max(...r.ticks) < 5, 'worst slice=' + Math.max(...r.ticks));
  assert(r.ticks.length > 1, 'work stays sliced'); assert(r.transformCalls() >= 28 * 4, 'real transform reads occurred');
});
test('a water following cheap nonmatching refs stays below5ms with every native charged', () => {
  const r = rig(Array.from({ length: 42 }, (_, i) => ({ base: i % 2 ? 101 : 301 })));
  r.finish(); assert.equal(r.w.out.length, 21);
  assert(Math.max(...r.ticks) < 5, 'worst slice=' + Math.max(...r.ticks));
});
test('pending capture stores only numeric identity and honors an exhausted shared budget', () => {
  const r = rig([{ base: 101 }]); r.tick();
  assert.deepEqual(Object.keys(r.w.water).sort(), ['base', 'i', 'ref', 't']);
  assert(Object.values(r.w.water).every(Number.isFinite));
  const before = JSON.stringify(r.w.water), calls = r.nativeCalls();
  r.tick(3); assert.equal(JSON.stringify(r.w.water), before);
  assert.equal(r.nativeCalls(), calls, 'no native call after the shared budget is spent');
  r.finish(); assert.equal(r.w.out.length, 1);
});
for (const change of [spec => spec.ref = 9000, spec => spec.base = 201]) {
  test('a replaced index or changed base refuses pending geometry without retry', () => {
    const specs = [{ base: 101 }], r = rig(specs); r.tick(); change(specs[0]); r.finish();
    assert.equal(r.w.out.length, 0); assert.equal(r.errors.length, 1); assert.equal(r.transformCalls(), 0);
  });
}
test('pending water yields when shared work already spent half the slice', () => {
  const r = rig([{ base: 101 }]); r.tick(); const before = r.nativeCalls();
  r.tick(5 / 3); assert.equal(r.nativeCalls(), before, 'late shared work cannot precede a full water snapshot');
  r.finish(); assert.equal(r.w.out.length, 1);
});
test('water snapshot plus nearly half a precise shared slice remains below5ms', () => {
  const r = rig([{ base: 101 }]); r.tick(); r.tick(.99); r.finish();
  const worst = Math.max(...r.ticks); console.log('MEASURE charged shared snapshot worst=' + worst.toFixed(3) + 'ms');
  assert(worst < 5); assert.equal(r.w.out.length, 1);
});
test('capture reads current positions and transforms after numeric discovery', () => {
  const specs = [{ base: 101 }], r = rig(specs); r.tick();
  specs[0].getPositionZ = 100; specs[0].getScale = .5;
  r.finish(); assert.deepEqual(r.w.out[0], [0, 0, 100, 101, .5, 0, 0, 90]);
});
// Full shared fire/water lifecycle: actual fireSpotsHere, fireWalkTick and
// cellFullyLoaded handler, with per-frame-expiring native wrappers.
const probesStart = source.indexOf('  let fireBases = 0;');
const probesEnd = source.indexOf('\n  }\n', source.indexOf('  function fireDistance(')) + 5;
const probes = source.slice(probesStart, probesEnd);
function lifecycle() {
  let frame = 0;
  const a = { id: 1, rows: [] }, b = { id: 2, rows: [] }, state = { cell: a };
  function lease(fn) { const made = frame; return (...args) => { assert.equal(made, frame, 'current-frame wrapper'); return fn(...args); }; }
  function ref(spec, index) {
    return { getFormID: lease(() => spec.id || 1000 + index),
      getBaseObject: lease(() => ({ getFormID: lease(() => 101) })),
      isDisabled: lease(() => false),
      getPositionX: lease(() => 0), getPositionY: lease(() => 0), getPositionZ: lease(() => 48),
      getScale: lease(() => spec.scale), getAngleX: lease(() => 0), getAngleY: lease(() => 0), getAngleZ: lease(() => 0) };
  }
  function cell(spec) {
    return { getFormID: lease(() => spec.id), getNumRefs: lease(type => type === 24 ? spec.rows.length : 0),
      getNthRef: lease(index => ref(spec.rows[index], index)) };
  }
  const pc = () => ({ getParentCell: () => cell(state.cell), getFurnitureReference: () => null });
  const sp = { Game: { getPlayer: pc, getFormEx: id => ({ id }) }, Form: { from: raw => ({ getFormID: () => raw.id }) } };
  const api = new Function('sp', 'log', 'FIRE_BASES', 'FIRE_FILES', 'FIRE_REACH', 'FIRE_INSIDE', 'performance', 'Date', 'clientTable',
    walkSource + probes + ';return {spots:fireSpotsHere,tick:fireWalkTick,loaded:fireCellLoaded,water:()=>waterHere,walking:()=>!!fireWalk};')(
    sp, () => {}, [], [], 300, 90, { now: () => 1000 }, { now: () => 1000 }, () => [['Skyrim.esm', 101, -100, -20, 100, 20]]);
  function step() { frame++; api.tick(); }
  return { a, b, state, api, probe() { frame++; return api.spots(pc()); }, step,
    loaded(spec = state.cell) { frame++; api.loaded({ cell: cell(spec) }); },
    finish() { for (let n = 0; n < 100 && api.walking(); n++) step(); assert.equal(api.walking(), false); } };
}
test('late-loaded water appears only after the existing current-cell loaded event and sliced replacement', () => {
  const h = lifecycle(); h.probe(); h.finish(); assert.deepEqual(h.api.water(), []);
  h.a.rows.push({ scale: 2 }); h.probe(); assert.deepEqual(h.api.water(), [], 'no timer rewalk');
  h.loaded(h.b); h.finish(); assert.deepEqual(h.api.water(), [], 'unrelated cell event has no effect');
  h.loaded(); assert.deepEqual(h.api.water(), [], 'old completed list remains until replacement');
  h.finish(); assert.equal(h.api.water()[0][4], 2);
});
test('a current-cell rewalk preserves prior results until complete and replaces the old transform', () => {
  const h = lifecycle(); h.a.rows.push({ scale: 2 }); h.probe(); h.finish();
  assert.equal(h.api.water()[0][4], 2); h.a.rows[0].scale = .5; h.loaded(); h.step();
  assert.equal(h.api.water()[0][4], 2); h.finish(); assert.equal(h.api.water()[0][4], .5);
});
test('changing cells drops a pending water capture and never publishes it into the new cell', () => {
  const h = lifecycle(); h.a.rows.push({ scale: 2 }); h.probe(); assert(h.api.walking());
  h.state.cell = h.b; h.step(); assert.equal(h.api.walking(), false);
  h.probe(); h.finish(); assert.deepEqual(h.api.water(), []);
  h.state.cell = h.a; h.probe(); h.finish(); assert.equal(h.api.water().length, 1);
});
console.log(pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0;
