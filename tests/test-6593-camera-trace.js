'use strict';
// Executes the actual opt-in game test plugin with synthetic API/clock/disk only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const pluginPass = require('./fixtures/plugin-pass');
const source = fs.readFileSync(path.join(__dirname, '../game/plugins/thornswood-test.js'), 'utf8');
let passed = 0;
let failed = 0;
function test(name, run) {
  try { run(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}
function fixture(trace = true, options = {}) {
  let now = 10000;
  let cameraReads = 0;
  const state = { pos: [11, 22, 333], camera: 9, focus: false, control: true, epoch: 1 };
  const steps = options.steps || [{ do: 'wait', for: 'time', ms: options.ms || 10000, ...(trace ? { cameraTrace: true } : {}) }, { do: 'end' }];
  const files = { '../Profile/dev-allowed.txt': 'yes',
    'Data/Platform/thornswood-test-run.json': JSON.stringify({ id: 'synthetic', steps }) };
  const handlers = {};
  const pc = { getParentCell: () => ({ getFormID: () => 10, getName: () => 'PRIVATE CELL' }),
    getWorldSpace: () => ({ getFormID: () => 20 }), is3DLoaded: () => true,
    getPositionX: () => state.pos[0], getPositionY: () => state.pos[1], getPositionZ: () => state.pos[2],
    getScale: () => 1, getRace: () => ({ getFormID: () => 123 }) };
  const sp = { on: (name, fn) => (handlers[name] ||= []).push(fn), printConsole() {},
    getPlatformVersion: () => 'fixture', browser: { isFocused: () => state.focus },
    Game: { getPlayer: () => pc, getCurrentCrosshairRef: () => null,
      getCameraState: () => { cameraReads++; return state.camera; },
      isCamSwitchControlsEnabled: () => state.control, isLookingControlsEnabled: () => state.control },
    storage: {} };
  function owner() { sp.storage.ownerOutfitDiagnostic = JSON.stringify({ epoch: state.epoch, at: now,
    target: { pos: [11, 22, 33], worldOrCell: 20, rot: [0, 0, 0] },
    desired: [{ name: 'PRIVATE PERSON' }], profileId: 999 }); }
  owner();
  const fakeFs = { readFileSync(p) { if (!(p in files)) throw Error('absent'); return files[p]; },
    appendFileSync(p, text) { files[p] = (files[p] || '') + text; }, unlinkSync(p) { delete files[p]; } };
  const box = { skyrimPlatform: sp, require: name => { assert.equal(name, 'fs'); return fakeFs; },
    Date: { now: () => now }, console, JSON, Number, String, Math, Array, Object, RegExp, isFinite };
  vm.createContext(box);
  pluginPass.load(box, source, { filename: 'thornswood-test.js' });
  const fire = (name, event) => (handlers[name] || []).forEach(fn => fn(event));
  const lines = () => String(files['Data/Platform/thornswood-test-results.jsonl'] || '').split('\n').filter(Boolean).map(JSON.parse);
  return { state, sp, owner, fire, lines,
    ack(ok = true) { const ask = lines().filter(r => r.t === 'ask').at(-1); assert.ok(ask); files['Data/Platform/thornswood-test-ack.txt'] = JSON.stringify({ n: ask.n, ok, note: 'synthetic Windows acknowledgment' }); },
    elapse(ms) { now += ms; },
    frame(ms = 16) { now += ms; fire('update'); fire('tick'); },
    wheel(extra = {}) { fire('buttonEvent', { device: 1, code: 8, isDown: true, ...extra }); },
    receipts() { return lines().filter(r => r.t === 'camera-trace'); },
    get reads() { return cameraReads; } };
}

test('ordinary test runs never read camera state or emit a trace', () => {
  const f = fixture(false); f.frame(); f.wheel(); f.frame();
  assert.equal(f.reads, 0); assert.equal(f.receipts().length, 0);
});

test('opt-in world wait observes its first ready update before passing or requesting a wheel', () => {
  const f = fixture(true, { steps: [
    { do: 'wait', for: 'world', timeout: 300000, cameraTrace: true },
    { do: 'wheel', delta: 120, cameraTrace: true }, { do: 'end' }
  ] });
  f.fire('menuOpen', { name: 'Loading Menu' });
  f.frame(35000);
  assert.equal(f.reads, 0); assert.equal(f.receipts().length, 0);
  assert.ok(!f.lines().some(r => r.t === 'ask' && r.do === 'wheel'));
  f.fire('menuClose', { name: 'Loading Menu' });
  f.state.pos[2] = 444; f.state.camera = 0; f.frame();
  const ready = f.receipts().find(r => r.phase === 'start' && r.i === 0);
  assert.ok(ready); assert.deepEqual(ready.sample.actorXYZ, [11, 22, 444]);
  assert.equal(ready.sample.cameraState, 0); assert.equal(ready.sample.cameraWorldAvailable, false);
  const lines = f.lines();
  assert.ok(lines.findIndex(r => r.t === 'camera-trace' && r.i === 0) <
    lines.findIndex(r => r.t === 'step' && r.i === 0 && r.ok));
  f.frame();
  const before = f.receipts().find(r => r.phase === 'wheel-request-before');
  assert.ok(before); assert.equal(before.i, 1);
  assert.ok(f.lines().some(r => r.t === 'ask' && r.do === 'wheel'));
  f.ack(); f.frame(300); f.frame(); f.frame(300);
  assert.ok(f.lines().some(r => r.t === 'step' && r.i === 1 && r.ok));
});

test('normal world wait stays unobserved and a traced world timeout does not sample an unready world', () => {
  const normal = fixture(false, { steps: [{ do: 'wait', for: 'world' }, { do: 'end' }] });
  normal.frame(); assert.equal(normal.reads, 0); assert.equal(normal.receipts().length, 0);
  const missing = fixture(true, { steps: [{ do: 'wait', for: 'world', timeout: 100, cameraTrace: true }] });
  missing.fire('menuOpen', { name: 'Loading Menu' }); missing.frame(101);
  assert.equal(missing.reads, 0); assert.equal(missing.receipts().length, 0);
  assert.ok(missing.lines().some(r => r.t === 'step' && !r.ok));
});
test('opt-in baseline separates actual actor height from authoritative target without private names', () => {
  const f = fixture(); f.frame();
  const r = f.receipts().find(r => r.phase === 'start');
  assert.ok(r); assert.deepEqual(r.sample.actorXYZ, [11, 22, 333]);
  assert.deepEqual(r.sample.targetXYZ, [11, 22, 33]); assert.equal(r.sample.actorTargetZ, 300);
  assert.equal(r.sample.cameraState, 9); assert.equal(r.sample.cameraWorldAvailable, false);
  assert.equal(r.sample.cameraWorldXYZ, null); assert.equal(r.sample.cameraActorDistance, null);
  assert.ok(!JSON.stringify(f.receipts()).includes('PRIVATE'));
  assert.ok(!JSON.stringify(f.receipts()).includes('profileId'));
});
test('wheel pairs a prior update sample with next and settled updates, never calling game APIs on buttonEvent', () => {
  const f = fixture(); f.frame(); f.elapse(25); const n = f.reads; f.wheel(); assert.equal(f.reads, n);
  f.state.camera = 0; f.frame(); f.frame(300);
  const r = f.receipts();
  assert.deepEqual(r.filter(r => r.wheel === 1).map(r => r.phase), ['wheel-before', 'wheel-after', 'wheel-settled']);
  const after = r.find(r => r.phase === 'wheel-after');
  assert.deepEqual(after.actorDeltaXYZ, [0, 0, 0]); assert.equal(after.sameOwnerEpoch, true);
  assert.equal(after.sample.cameraState, 0); assert.equal(after.beforeSampleAgeMs, 25);
});
test('actual actor movement and target-owner changes are distinguished', () => {
  const f = fixture(); f.frame(); f.wheel(); f.state.pos[2] += 5; f.frame();
  assert.deepEqual(f.receipts().find(r => r.phase === 'wheel-after').actorDeltaXYZ, [0, 0, 5]);
  const g = fixture(); g.frame(); g.wheel(); g.state.epoch++; g.owner(); g.frame();
  const changed = g.receipts().find(r => r.phase === 'wheel-after');
  assert.equal(changed.sameOwnerEpoch, false);
});
test('only game mouse-wheel downs count; menus, focus and controls remain observations', () => {
  const f = fixture(); f.frame();
  f.wheel({ device: 0 }); f.wheel({ code: 7 }); f.wheel({ isDown: false, isUp: true });
  f.wheel({ isRepeating: true }); f.wheel({ isHeld: true });
  assert.equal(f.receipts().filter(r => r.phase === 'wheel-before').length, 0);
  f.state.focus = true; f.state.control = false;
  f.fire('menuOpen', { name: 'InventoryMenu' }); f.frame(300); f.wheel(); f.frame();
  const r = f.receipts().find(r => r.phase === 'wheel-after');
  assert.equal(r.sample.browserFocus, true); assert.equal(r.sample.cameraControls, false);
  assert.deepEqual(r.sample.menus, ['InventoryMenu']);
});
test('missing APIs and malformed target data are explicit unknowns, with no raw payload', () => {
  const f = fixture(); delete f.sp.Game.getCameraState;
  f.sp.storage.ownerOutfitDiagnostic = '{PRIVATE broken'; f.frame();
  const r = f.receipts()[0]; assert.ok(r); assert.equal(r.sample.cameraState, null);
  assert.equal(r.sample.targetXYZ, null); assert.equal(r.sample.actorTargetZ, null);
  assert.ok(!JSON.stringify(f.receipts()).includes('PRIVATE'));
});
test('a different location never reports target height error or a same-location actor delta', () => {
  const f = fixture();
  f.sp.storage.ownerOutfitDiagnostic = JSON.stringify({ epoch: 1, at: 9000,
    target: { pos: [11, 22, 33], worldOrCell: 99 } });
  f.frame();
  const start = f.receipts()[0].sample;
  assert.equal(start.targetAgeMs, 1016); assert.equal(start.targetLocationMatches, false);
  assert.equal(start.actorTargetZ, null);
  f.wheel();
  f.sp.Game.getPlayer = () => ({ getParentCell: () => ({ getFormID: () => 99 }),
    getPositionX: () => 11, getPositionY: () => 22, getPositionZ: () => 333 });
  f.frame();
  assert.equal(f.receipts().find(r => r.phase === 'wheel-after').actorDeltaXYZ, null);
});
test('overlapping wheel attempts keep separate pairs and the trace stops on leaving its step', () => {
  const f = fixture(true, { ms: 1000 }); f.frame(); f.wheel(); f.wheel({ code: 9 });
  f.frame(); f.frame(300);
  for (const n of [1, 2]) {
    assert.deepEqual(f.receipts().filter(r => r.wheel === n).map(r => r.phase), ['wheel-before', 'wheel-after', 'wheel-settled']);
  }
  f.frame(1000); f.frame(); const n = f.reads; f.wheel(); f.frame(1000);
  assert.equal(f.reads, n);
});
test('trace has a hard time and wheel/receipt budget and cannot rearm within the step', () => {
  const f = fixture(true, { ms: 90000 }); f.frame();
  for (let n = 0; n < 50; n++) { f.wheel(); f.frame(300); }
  assert.ok(f.receipts().filter(r => r.phase === 'wheel-before').length <= 8);
  f.frame(31000); const n = f.reads; f.wheel(); f.frame(1000);
  assert.equal(f.reads, n); assert.ok(f.receipts().length <= 64);
  assert.ok(f.receipts().some(r => r.phase === 'end'));
});
test('rapid camera-state changes reserve the final receipt and stop sampling at the receipt budget', () => {
  const f = fixture(true, { ms: 90000 }); f.frame();
  for (let n = 0; n < 80; n++) { f.state.camera = n % 2; f.frame(250); }
  const reads = f.reads; f.frame(500);
  assert.equal(f.reads, reads); assert.equal(f.receipts().length, 64);
  assert.equal(f.receipts().at(-1).phase, 'end');
});
test('explicit platform wheel captures before/ack/settled even with no game wheel event', () => {
  const f = fixture(true, { steps: [{ do: 'wheel', delta: 120, cameraTrace: true }, { do: 'end' }] });
  f.frame();
  const ask = f.lines().find(r => r.t === 'ask'); assert.ok(ask); assert.equal(ask.do, 'wheel'); assert.equal(ask.arg, 120);
  assert.ok(f.receipts().some(r => r.phase === 'wheel-request-before'));
  assert.ok(!f.lines().some(r => r.t === 'step'));
  f.state.camera = 0; f.ack(); f.frame(300); f.frame(); f.frame(300);
  const paired = f.receipts().filter(r => r.eventSource === 'platform-request');
  assert.deepEqual(paired.map(r => r.phase), ['wheel-request-before', 'wheel-ack-after', 'wheel-ack-settled']);
  assert.equal(paired.at(-1).platformAccepted, true); assert.deepEqual(paired.at(-1).actorDeltaXYZ, [0, 0, 0]);
  assert.ok(f.lines().find(r => r.t === 'step' && r.do === 'wheel' && r.ok));
});
test('a rejected platform wheel still captures after states and fails its step without retry', () => {
  const f = fixture(true, { steps: [{ do: 'wheel', delta: -120, cameraTrace: true }, { do: 'end' }] });
  f.frame(); f.ack(false); f.frame(300); f.frame(); f.frame(300);
  const after = f.receipts().find(r => r.phase === 'wheel-ack-settled');
  assert.ok(after); assert.equal(after.platformAccepted, false);
  assert.ok(f.lines().find(r => r.t === 'step' && r.do === 'wheel' && !r.ok));
  assert.equal(f.lines().filter(r => r.t === 'ask' && r.do === 'wheel').length, 1);
});
test('a wheel request requires explicit local trace and exactly one signed detent', () => {
  for (const step of [{ do: 'wheel', delta: 120 }, { do: 'wheel', delta: 240, cameraTrace: true },
    { do: 'wheel', delta: 120.5, cameraTrace: true }]) {
    const f = fixture(true, { steps: [step, { do: 'end' }] }); f.frame();
    assert.ok(f.lines().some(r => r.t === 'step' && !r.ok));
    assert.ok(!f.lines().some(r => r.t === 'ask' && r.do === 'wheel'));
  }
});
test('smoke list reuses exact owned-character entry and opts into exactly two bounded wheel requests', () => {
  const load = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'real-client', name), 'utf8')).steps;
  const normal = load('dev-release.json'); const smoke = load('camera-smoke.json');
  const world = normal.findIndex(s => s.do === 'wait' && s.for === 'world');
  assert.ok(world >= 0);
  assert.deepEqual(smoke.slice(0, world), normal.slice(0, world));
  assert.deepEqual(smoke[world], { ...normal[world], cameraTrace: true });
  const end = world + 1;
  assert.deepEqual(smoke.slice(end).map(s => s.do), ['wheel', 'wait', 'wheel', 'wait', 'shot', 'end']);
  assert.deepEqual(smoke.slice(end).filter(s => s.do === 'wheel').map(s => s.delta), [120, -120]);
  assert.ok(smoke.slice(end).filter(s => s.do === 'wheel').every(s => s.cameraTrace === true));
  assert.ok(smoke.slice(end).filter(s => s.do === 'wait').every(s => s.ms === 500 && s.cameraTrace === true));
});
test('runner refuses public publication of an opted-in camera trace before writing its run file', () => {
  const file = path.join(__dirname, '../scripts/dev/Run-RealClient.ps1');
  const script = fs.readFileSync(file, 'utf8');
  const guard = script.indexOf('Camera trace stays local');
  assert.ok(guard >= 0 && guard < script.indexOf('[IO.File]::WriteAllText($runFile'));
  // Execute only this actual parsed guard against synthetic flags/steps, never
  // the runner's installed-game, launcher, Windows input or publication code.
  const probe = `
$ErrorActionPreference='Stop'
$file=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(file).toString('base64')}'))
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Parse failure'}
$guard=$ast.Find({param($node) $node -is [Management.Automation.Language.IfStatementAst] -and $node.Extent.Text.Contains('Camera trace stays local')},$true)
if(-not $guard){throw 'Missing guard'}
$cases=@(@{publish=$true;trace=$true;refused=$true},@{publish=$false;trace=$true;refused=$false},@{publish=$true;trace=$false;refused=$false})
foreach($case in $cases){
  $Publish=$case.publish; $stepsJson=@{steps=@(@{cameraTrace=$case.trace})}; $refused=$false
  try{&([scriptblock]::Create($guard.Extent.Text))}catch{$refused=$true}
  if($refused -ne $case.refused){throw 'Publication guard mismatch'}
}
Write-Output '3 actual guard cases passed; no runner execution'
`;
  const result = require('node:child_process').spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(probe, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /3 actual guard cases passed/);
});
console.log(passed + ' passed, ' + failed + ' failed; no physical runtime');
if (failed) process.exitCode = 1;
