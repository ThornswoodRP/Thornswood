'use strict';
/* #4488: actual staff/join-pass code, actual private files, fresh VM = cold
   restart. No network, game process, or shared private folder is used. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const SOURCE = process.env.RESTRAINT_SOURCES || path.join(ROOT, 'game/gamemode');
const STAFF = fs.readFileSync(path.join(SOURCE, 'staff.ts'), 'utf8');
const JOIN = fs.readFileSync(path.join(SOURCE, 'join-pass.ts'), 'utf8');
const RELEASE = fs.readFileSync(path.join(SOURCE, 'release-of-deleted-characters.ts'), 'utf8');
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-4488-'));
const A = 0xff000101, B = 0xff000202, PID = 1001, TARGET = 2002;
let pass = 0, fail = 0, next = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('PASS ' + name); }
  catch (e) { fail++; console.log('FAIL ' + name + ': ' + e.message); }
}
function fresh() {
  const dir = path.join(TEMP, String(++next));
  fs.mkdirSync(dir);
  return { dir, file: path.join(dir, 'staff-restraints.json'), now: Date.UTC(2026, 10, 25),
    online: [A, B], where: {
      [A]: { desc: '3c:Skyrim.esm', pos: [100, 200, 300], rot: [0, 0, 90] },
      [B]: { desc: '3c:Skyrim.esm', pos: [5000, 6000, 700], rot: [0, 0, 0] }
    }, writes: [], moves: [], fault: '', getFault: false,
    runtime: '12345', life: 0, targetProfile: TARGET, guid: 'target-connection' };
}
function boot(w, prior) {
  const r = prior ? prior.__testRig : { posts: [], told: [], logs: [], kicked: [], timers: [] };
  class Clock extends Date { static now() { return w.now; } }
  function request(opts, cb) {
    const req = { on() { return req; }, destroy() {}, end(body) {
      if (opts.path === '/silenced') r.posts.push(JSON.parse(body));
      if (cb) cb({ resume() {}, on() {} });
    } };
    return req;
  }
  const io = Object.create(fs);
  io.readFileSync = function (file, ...args) {
    if (w.settingsFault && path.normalize(file) === path.join('private', 'staff-restraints.json')) {
      const decoy = '{"version":1,"revision":0,"frozen":{},"silenced":{}}';
      return args[0] ? decoy : Buffer.from(decoy);
    }
    if (file === 'server-settings.json') {
      const text = JSON.stringify({ privDir: w.dir });
      return args[0] ? text : Buffer.from(text);
    }
    if (path.resolve(file) === w.file && w.fault === 'read') throw new Error('injected unreadable book');
    return fs.readFileSync(file, ...args);
  };
  io.renameSync = function (from, to) {
    if (w.failAck && to === path.join(w.dir, 'deleted-characters.taken.json')) throw new Error('injected release acknowledgement refusal');
    return fs.renameSync(from, to);
  };
  io.unlinkSync = function (file) {
    if (w.failAck && file === path.join(w.dir, 'deleted-characters.taken.json')) throw new Error('injected release acknowledgement refusal');
    return fs.unlinkSync(file);
  };
  const box = prior || { Buffer, log: (...a) => r.logs.push(a.join(' ')),
    console: { log: (...a) => r.logs.push(a.join(' ')) },
    voicePort: () => 7778, guard: (name, fn) => fn, Date: Clock,
    setInterval: (fn, every) => { r.timers.push({ fn, every }); return r.timers.length; },
    clearInterval() {}, setTimeout: fn => { r.timers.push({ fn }); return r.timers.length; }, clearTimeout() {},
    require: name => name === 'fs' ? io : name === 'http' ? { request } : require(name),
    __thornswoodToProfile: (pid, text) => r.told.push({ pid, text }),
    mp: {
      getServerSettings: () => {
        if (w.settingsFault) throw new Error('injected unavailable server settings');
        return { privDir: w.dir, forBotDir: path.join(w.dir, 'for-bot') };
      },
      get(id, key) {
        if (!id && key === 'onlinePlayers') return w.online.slice();
        if (key === 'profileId') return id === A ? PID : id === B ? w.targetProfile : 0;
        if (key === 'appearance') return { name: id === A ? 'Staff' : 'Bjorn' };
        if (w.getFault) throw new Error('injected unreadable location');
        if (key === 'worldOrCellDesc') return w.where[id].desc;
        if (key === 'pos') return w.where[id].pos.slice();
        if (key === 'angle') return w.where[id].rot.slice();
      },
      set(id, key, value) {
        if (key !== 'locationalData') throw new Error('unexpected property ' + key);
        w.moves.push({ id, value });
        if (w.moveFault === 'before') throw new Error('injected refused move');
        if (w.moveFault === 'noop') return;
        w.where[id] = { desc: value.cellOrWorldDesc, pos: value.pos.slice(), rot: value.rot.slice() };
        if (w.afterMove) w.afterMove();
        if (w.moveFault === 'after') throw new Error('injected after applied move');
      },
      writeFileWhole(file, text) {
        assert.equal(path.resolve(file), w.file, 'only the fixed restraint book is written');
        w.writes.push(text);
        if (w.beforeWrite) w.beforeWrite(text);
        if (w.fault === 'before') throw new Error('injected refused atomic placement');
        if (w.fault === 'noop') return;
        if (w.fault === 'different') {
          const changed = JSON.parse(text); changed.revision += 10;
          fs.writeFileSync(file, JSON.stringify(changed));
          throw new Error('injected unrelated replacement');
        }
        fs.writeFileSync(file, text);
        if (w.fault === 'after') throw new Error('injected after atomic placement');
      },
      getUserByActor: id => id === A ? 1 : 2,
      getUserGuid: id => id === 2 ? w.guid : 'staff-connection',
      getActorRuntimeIdentity: id => { assert.equal(id, B); return w.runtime; },
      getNpcAIState: id => { assert.equal(id, B); return { profileId: w.targetProfile, lifeGeneration: w.life, isHuman: true, isConnected: true }; },
      kick: id => r.kicked.push(id)
    }
  };
  if (!prior) vm.createContext(box);
  box.__testRig = r;
  vm.runInContext(RELEASE, box, { filename: 'release-of-deleted-characters.ts' });
  vm.runInContext(JOIN, box, { filename: 'join-pass.ts' });
  vm.runInContext(STAFF, box, { filename: 'staff.ts' });
  box.__thornswoodPassSeen.passes[PID] = { x: w.now + 3600000 };
  r.box = box;
  r.command = line => {
    const before = r.told.length, parts = line.split(/\s+/);
    box.__thornswoodStaff.command({ proven: true }, parts[0], parts, PID, A, () => true, {
      findPlace: () => ({ where: { desc: '3c:Skyrim.esm', pos: [999, 888, 777], rot: [0, 0, 0], town: 'Town' } })
    });
    return r.told.slice(before).filter(x => x.pid === PID).map(x => x.text).join('\n');
  };
  return r;
}
try {
  test('freeze and remaining silence survive a genuinely cold staff reload before first voice publication', () => {
    const w = fresh(), one = boot(w);
    assert.match(one.command('/freeze ' + TARGET), /Froze/);
    assert.match(one.command('/silence ' + TARGET + ' 30m'), /Silenced/);
    const saved = fs.readFileSync(w.file, 'utf8');
    w.now += 10 * 60000;
    const two = boot(w);
    assert.deepEqual(JSON.parse(JSON.stringify(two.box.__thornswoodStaffState.frozen[TARGET].pos)), [5000, 6000, 700]);
    assert.equal(two.box.__thornswoodStaff.silencedFor(TARGET), 20);
    assert.equal(two.posts[0].profiles[TARGET], w.now + 20 * 60000);
    assert.equal(fs.readFileSync(w.file, 'utf8'), saved, 'rehydration does not renew a silence');
  });
  test('offline unsilence and unfreeze are persisted rather than resurrected on restart', () => {
    const w = fresh(), one = boot(w);
    one.command('/freeze ' + TARGET); one.command('/silence ' + TARGET + ' 30m');
    w.online = [A];
    const two = boot(w);
    assert.match(two.command('/unsilence ' + TARGET), /can speak again/);
    assert.match(two.command('/unfreeze ' + TARGET), /can move again/);
    const three = boot(w);
    assert.equal(three.box.__thornswoodStaffState.frozen[TARGET], undefined);
    assert.equal(three.box.__thornswoodStaff.silencedFor(TARGET), 0);
    assert.deepEqual(three.posts[0].profiles, {});
  });
  test('a refused placement cannot mutate the live restraint or report success', () => {
    const w = fresh(), one = boot(w);
    one.command('/silence ' + TARGET + ' 30m');
    const before = fs.readFileSync(w.file, 'utf8');
    w.fault = 'before';
    assert.doesNotMatch(one.command('/unsilence ' + TARGET), /can speak again/);
    assert.equal(one.box.__thornswoodStaff.silencedFor(TARGET), 30);
    assert.equal(fs.readFileSync(w.file, 'utf8'), before);
    assert.doesNotMatch(one.command('/freeze ' + TARGET), /Froze/);
    assert.equal(one.box.__thornswoodStaffState.frozen[TARGET], undefined);
  });
  test('exact persisted bytes after write-then-throw count as committed, without a second write', () => {
    const w = fresh(), one = boot(w);
    const count = w.writes.length;
    w.fault = 'after';
    assert.match(one.command('/freeze ' + TARGET), /Froze/);
    assert.equal(w.writes.length, count + 1);
    w.fault = '';
    assert.ok(boot(w).box.__thornswoodStaffState.frozen[TARGET]);
  });
  test('a malformed cold book is preserved, publishes no empty silence list, and refuses admission', () => {
    const w = fresh(); fs.writeFileSync(w.file, '{');
    const one = boot(w);
    assert.equal(one.posts.length, 0);
    assert.equal(one.box.mp.onThornswoodLogin({ userId: 1, profileId: PID, proof: null }), 0);
    assert.doesNotMatch(one.command('/freeze ' + TARGET), /Froze/);
    assert.equal(fs.readFileSync(w.file, 'utf8'), '{');
    assert.ok(one.logs.some(x => /restraint.*(unavailable|unreadable|invalid)/i.test(x)));
  });
  test('expired saved silences do not return on cold start or extend their original deadline', () => {
    const w = fresh(), one = boot(w);
    one.command('/silence ' + TARGET + ' 1m');
    w.now += 60001;
    const two = boot(w);
    assert.equal(two.box.__thornswoodStaff.silencedFor(TARGET), 0);
    assert.deepEqual(two.posts[0].profiles, {});
    assert.equal(two.box.mp.onThornswoodLogin({ userId: 1, profileId: PID, proof: null }), PID);
  });
  for (const raw of ['[]', 'null', 'true', '{}', '{"version":1,"revision":-1,"frozen":{},"silenced":{}}']) {
    test('structured but invalid cold book stays unavailable: ' + raw, () => {
      const w = fresh(); fs.writeFileSync(w.file, raw);
      const one = boot(w);
      assert.equal(one.posts.length, 0);
      assert.equal(one.box.mp.onThornswoodLogin({ userId: 1, profileId: PID, proof: null }), 0);
      assert.doesNotMatch(one.command('/silence ' + TARGET), /Silenced/);
      assert.equal(fs.readFileSync(w.file, 'utf8'), raw);
    });
  }
  test('unreadable cold book cannot clear voice restraints or admit a character', () => {
    const w = fresh(); fs.writeFileSync(w.file, '{'); w.fault = 'read';
    const one = boot(w);
    assert.equal(one.posts.length, 0);
    assert.equal(one.box.mp.onThornswoodLogin({ userId: 1, profileId: PID, proof: null }), 0);
    assert.equal(fs.readFileSync(w.file, 'utf8'), '{');
  });
  test('a missing restraint authority module cannot admit a character', () => {
    const w = fresh(), one = boot(w);
    vm.runInContext('globalThis.__thornswoodStaff = undefined', one.box);
    assert.equal(one.box.mp.onThornswoodLogin({ userId: 1, profileId: PID, proof: null }), 0);
  });
  test('unknown private-folder settings cannot be replaced by a guessed default authority', () => {
    const w = fresh(); w.settingsFault = true;
    const one = boot(w);
    assert.equal(one.posts.length, 0);
    assert.equal(one.box.mp.onThornswoodLogin({ userId: 1, profileId: PID, proof: null }), 0);
    assert.equal(w.writes.length, 0);
  });
  test('hot reload fences an old command closure against writing or changing the new state', () => {
    const w = fresh(), one = boot(w), old = one.box.__thornswoodStaff;
    const two = boot(w, one.box), before = w.writes.length;
    old.command({ proven: true }, '/freeze', ['/freeze', String(TARGET)], PID, A, () => true);
    assert.equal(w.writes.length, before);
    assert.equal(two.box.__thornswoodStaffState.frozen[TARGET], undefined);
    assert.ok(two.told.some(x => /reload|superseded|current/i.test(x.text)));
  });
  test('bad hot-reload read preserves known enforcement and never replaces voice with an empty list', () => {
    const w = fresh(), one = boot(w);
    one.command('/freeze ' + TARGET); one.command('/silence ' + TARGET + ' 30m');
    const before = one.posts.length;
    fs.writeFileSync(w.file, '{');
    const two = boot(w, one.box);
    assert.ok(two.box.__thornswoodStaffState.frozen[TARGET]);
    assert.equal(two.box.__thornswoodStaff.silencedFor(TARGET), 30);
    assert.ok(two.posts.slice(before).every(p => p.profiles[TARGET] > w.now));
    assert.equal(two.box.mp.onThornswoodLogin({ userId: 1, profileId: PID, proof: null }), 0);
    assert.equal(fs.readFileSync(w.file, 'utf8'), '{');
  });
  test('a silent no-op writer cannot authorize a live success that a cold start loses', () => {
    const w = fresh(), one = boot(w);
    const before = fs.readFileSync(w.file, 'utf8'); w.fault = 'noop';
    assert.doesNotMatch(one.command('/freeze ' + TARGET), /Froze/);
    assert.equal(one.box.__thornswoodStaffState.frozen[TARGET], undefined);
    assert.equal(fs.readFileSync(w.file, 'utf8'), before);
  });
  test('an unrelated write/readback revision is never treated as the requested commit', () => {
    const w = fresh(), one = boot(w); w.fault = 'different';
    assert.doesNotMatch(one.command('/freeze ' + TARGET), /Froze/);
    assert.equal(one.box.__thornswoodStaffState.frozen[TARGET], undefined);
  });
  test('a hot reload cannot silently recreate a previously durable book that disappeared', () => {
    const w = fresh(), one = boot(w);
    one.command('/freeze ' + TARGET); fs.unlinkSync(w.file);
    const before = w.writes.length, two = boot(w, one.box);
    assert.equal(w.writes.length, before);
    assert.equal(fs.existsSync(w.file), false);
    assert.ok(two.box.__thornswoodStaffState.frozen[TARGET]);
    assert.equal(two.box.mp.onThornswoodLogin({ userId: 1, profileId: PID, proof: null }), 0);
  });
  test('an externally changed book is never overwritten from the old cached revision', () => {
    const w = fresh(), one = boot(w), changed = JSON.parse(fs.readFileSync(w.file, 'utf8'));
    changed.revision += 5;
    const bytes = JSON.stringify(changed); fs.writeFileSync(w.file, bytes);
    assert.doesNotMatch(one.command('/freeze ' + TARGET), /Froze/);
    assert.equal(fs.readFileSync(w.file, 'utf8'), bytes);
  });
  for (const line of ['/bring ' + TARGET, '/tp ' + TARGET + ' town']) {
    test(line + ': confirmed frozen move updates the durable anchor exactly once without a later return', () => {
      const w = fresh(), one = boot(w);
      one.command('/freeze ' + TARGET);
      assert.match(one.command(line), /Brought|Sent/);
      const dest = w.where[B].pos.slice();
      const two = boot(w);
      assert.deepEqual(Array.from(two.box.__thornswoodStaffState.frozen[TARGET].pos), dest);
      two.box.__thornswoodStaff.freezeTick();
      assert.equal(w.moves.length, 1);
    });
    test(line + ': native applied-then-threw is resolved from exact location, without false refusal', () => {
      const w = fresh(), one = boot(w);
      one.command('/freeze ' + TARGET); w.moveFault = 'after';
      const answer = one.command(line);
      assert.match(answer, /Brought|Sent/);
      assert.doesNotMatch(answer, /did not work|Nothing moved/);
      assert.equal(w.moves.length, 1);
      assert.deepEqual(Array.from(boot(w).box.__thornswoodStaffState.frozen[TARGET].pos), w.where[B].pos);
    });
    test(line + ': silent native no-op cannot report or audit a completed move', () => {
      const w = fresh(), one = boot(w);
      one.command('/freeze ' + TARGET); w.moveFault = 'noop';
      assert.doesNotMatch(one.command(line), /Brought|Sent/);
      assert.deepEqual(Array.from(boot(w).box.__thornswoodStaffState.frozen[TARGET].pos), [5000, 6000, 700]);
      assert.equal(w.moves.length, 1);
    });
    test(line + ': failed final save leaves durable pending, no return/retry, and only target admission refused', () => {
      const w = fresh(), one = boot(w);
      one.command('/freeze ' + TARGET);
      w.afterMove = () => { w.fault = 'before'; };
      const answer = one.command(line);
      assert.match(answer, /Movement may already have occurred/);
      assert.doesNotMatch(answer, /Brought|Sent|Nothing moved/);
      assert.ok(JSON.parse(fs.readFileSync(w.file, 'utf8')).frozen[TARGET].pending);
      one.box.__thornswoodStaff.freezeTick();
      assert.equal(w.moves.length, 1, 'no movement replay or rollback');
      assert.deepEqual(one.kicked, [2]);
      const two = boot(w);
      assert.equal(two.box.mp.onThornswoodLogin({ userId: 2, profileId: TARGET, proof: null }), 0);
      assert.equal(two.box.mp.onThornswoodLogin({ userId: 1, profileId: PID, proof: null }), PID);
      w.fault = ''; w.online = [A];
      assert.match(two.command('/unfreeze ' + TARGET), /can move again/);
      const three = boot(w);
      assert.equal(three.box.mp.onThornswoodLogin({ userId: 2, profileId: TARGET, proof: null }), TARGET);
    });
  }
  for (const fence of ['targetProfile', 'runtime', 'life', 'guid']) {
    test('pending ending never kicks a replacement after its ' + fence + ' changes', () => {
      const w = fresh(), one = boot(w);
      one.command('/freeze ' + TARGET);
      w.afterMove = () => { w.fault = 'before'; w[fence] = typeof w[fence] === 'number' ? w[fence] + 1 : w[fence] + '1'; };
      one.command('/bring ' + TARGET);
      assert.deepEqual(one.kicked, []);
      assert.ok(JSON.parse(fs.readFileSync(w.file, 'utf8')).frozen[TARGET].pending);
    });
  }
  function releaseRequest(w, extra) {
    const done = Object.fromEntries(['saves', 'farms', 'property', 'embassy', 'dungeon', 'cargo', 'stalls', 'carts', 'books', 'merchants'].map(k => [k, w.now]));
    fs.writeFileSync(path.join(w.dir, 'deleted-characters.json'), JSON.stringify({ profiles: [], actors: [], done, ...extra }));
  }
  test('ordinary actor reset keeps profile controls, while person deletion clears only its target', () => {
    const w = fresh(), one = boot(w);
    one.command('/freeze ' + TARGET); one.command('/silence ' + TARGET + ' 30m');
    releaseRequest(w, { actors: [B] });
    const two = boot(w);
    assert.ok(two.box.__thornswoodStaffState.frozen[TARGET]);
    assert.equal(two.box.__thornswoodStaff.silencedFor(TARGET), 30);
    releaseRequest(w, { profiles: [TARGET] });
    const three = boot(w);
    assert.equal(three.box.__thornswoodStaffState.frozen[TARGET], undefined);
    assert.equal(three.box.__thornswoodStaff.silencedFor(TARGET), 0);
  });
  test('explicit zero-actor wipe clears anchors, keeps timed silence, and is acknowledged once', () => {
    const w = fresh(), one = boot(w);
    one.command('/freeze ' + TARGET); one.command('/silence ' + TARGET + ' 30m');
    releaseRequest(w, { clearFreezes: true, freezeWipeIds: ['a'.repeat(32)] });
    const two = boot(w);
    assert.equal(two.box.__thornswoodStaffState.frozen[TARGET], undefined);
    assert.equal(two.box.__thornswoodStaff.silencedFor(TARGET), 30);
    assert.equal(fs.existsSync(path.join(w.dir, 'deleted-characters.taken.json')), false);
    two.command('/freeze ' + TARGET);
    assert.ok(boot(w).box.__thornswoodStaffState.frozen[TARGET], 'a completed wipe does not clear a later freeze');
  });
  test('a committed clear is not replayed after its release acknowledgement fails', () => {
    const w = fresh(), one = boot(w);
    one.command('/freeze ' + TARGET); one.command('/silence ' + TARGET + ' 30m');
    releaseRequest(w, { clearFreezes: true, freezeWipeIds: ['b'.repeat(32)] });
    w.beforeWrite = text => { if (JSON.parse(text).clearedWipes?.includes('b'.repeat(32))) w.failAck = true; };
    const two = boot(w);
    assert.equal(two.box.__thornswoodStaffState.frozen[TARGET], undefined);
    assert.equal(fs.existsSync(path.join(w.dir, 'deleted-characters.taken.json')), true);
    two.command('/freeze ' + TARGET);
    w.failAck = false; w.beforeWrite = null;
    const three = boot(w);
    assert.ok(three.box.__thornswoodStaffState.frozen[TARGET], 'same durable wipe receipt protects a new freeze');
    assert.equal(three.box.__thornswoodStaff.silencedFor(TARGET), 30);
  });
  test('a failed clear is not acknowledged and the explicit request survives restart', () => {
    const w = fresh(), one = boot(w); one.command('/freeze ' + TARGET);
    releaseRequest(w, { clearFreezes: true, freezeWipeIds: ['c'.repeat(32)] });
    w.fault = 'before';
    assert.ok(boot(w).box.__thornswoodStaffState.frozen[TARGET]);
    const pending = JSON.parse(fs.readFileSync(path.join(w.dir, 'deleted-characters.taken.json'), 'utf8'));
    assert.equal(pending.done.restraints, undefined);
    assert.equal(pending.clearFreezes, true);
    w.fault = '';
    assert.equal(boot(w).box.__thornswoodStaffState.frozen[TARGET], undefined);
  });
  for (const extra of [
    { clearFreezes: true }, { clearFreezes: 'true', freezeWipeIds: ['d'.repeat(32)] },
    { clearFreezes: true, freezeWipeIds: ['wrong'] },
    { clearFreezes: true, freezeWipeIds: ['d'.repeat(32), 'd'.repeat(32)] }
  ]) {
    test('malformed wipe authority cannot be consumed or clear a valid anchor: ' + JSON.stringify(extra), () => {
      const w = fresh(), one = boot(w); one.command('/freeze ' + TARGET);
      const before = fs.readFileSync(w.file, 'utf8');
      releaseRequest(w, extra);
      const request = fs.readFileSync(path.join(w.dir, 'deleted-characters.json'), 'utf8');
      assert.ok(boot(w).box.__thornswoodStaffState.frozen[TARGET]);
      assert.equal(fs.readFileSync(w.file, 'utf8'), before);
      assert.equal(fs.readFileSync(path.join(w.dir, 'deleted-characters.json'), 'utf8'), request);
    });
  }
  test('a newly mixed ordinary request cannot inherit an already acknowledged wipe', () => {
    const w = fresh(), one = boot(w); one.command('/freeze ' + TARGET);
    releaseRequest(w, { clearFreezes: true, freezeWipeIds: ['e'.repeat(32)] });
    const file = path.join(w.dir, 'deleted-characters.json'), prior = JSON.parse(fs.readFileSync(file, 'utf8'));
    prior.done.restraints = w.now;
    fs.writeFileSync(path.join(w.dir, 'deleted-characters.taken.json'), JSON.stringify(prior));
    releaseRequest(w, { actors: [B] });
    assert.ok(boot(w).box.__thornswoodStaffState.frozen[TARGET]);
  });
  test('mixed pending wipe and person deletion retain the wipe until its actual clear commits', () => {
    const w = fresh(), one = boot(w); one.command('/freeze ' + TARGET); one.command('/silence ' + TARGET + ' 30m');
    releaseRequest(w, { clearFreezes: true, freezeWipeIds: ['f'.repeat(32)] });
    fs.renameSync(path.join(w.dir, 'deleted-characters.json'), path.join(w.dir, 'deleted-characters.taken.json'));
    releaseRequest(w, { profiles: [3003] }); w.fault = 'before';
    assert.ok(boot(w).box.__thornswoodStaffState.frozen[TARGET]);
    const pending = JSON.parse(fs.readFileSync(path.join(w.dir, 'deleted-characters.taken.json'), 'utf8'));
    assert.deepEqual(pending.freezeWipeIds, ['f'.repeat(32)]);
    assert.equal(pending.done.restraints, undefined);
    w.fault = ''; const three = boot(w);
    assert.equal(three.box.__thornswoodStaffState.frozen[TARGET], undefined);
    assert.equal(three.box.__thornswoodStaff.silencedFor(TARGET), 30);
  });
} finally {
  const resolved = path.resolve(TEMP);
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert.ok(path.basename(resolved).startsWith('thornswood-4488-'));
  fs.rmSync(resolved, { recursive: true, force: true });
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
