// test-4526-refusal-lands.js
//
//     node tests/test-4526-refusal-lands.js
//
// A session the join pass refuses is refused again if the kick does not land
// (#4526). The sweep marked a session judged when it set the kick, before
// the kick ran, so a kick that found no connection or threw only logged, and
// every later sweep skipped the session as judged: it stayed in the world.
// Now judged is set only when the kick lands, and one that does not leaves
// the session for the next sweep to refuse again.
//
// The join pass block is lifted out of game/gamemode.js between its markers
// and run in a vm with a stand-in mp whose getUserByActor and kick can be
// told to fail, as test-join-pass-game.js runs it. Read only.
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'), 'utf8').split(String.fromCharCode(13)).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const KEY = 'test-4526-key-not-a-real-one';
function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function mint(o) {
  const body = b64u(JSON.stringify({ p: o.p, s: o.s, v: '1.1.102', d: o.d || '111', i: o.i, x: o.x }));
  return 'jp1.' + body + '.' + b64u(crypto.createHmac('sha256', KEY).update('jp1.' + body).digest());
}

const a = src.indexOf('// ==== thornswood join pass ====');
const b = src.indexOf('// ==== end thornswood join pass ====');
yes('the join pass block is in gamemode.js between its markers', a >= 0 && b > a);
if (!(a >= 0 && b > a)) { console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }

const PRIV = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-4526-'));
fs.writeFileSync(path.join(PRIV, 'door.json'), JSON.stringify({ site: 'https://thornswood.net/dev', key: 'door-key', passKey: KEY }));

const ACTOR = 0xff000a01;
// fails: what the next kicks do, in order: 'lost' (no connection), 'throw' (kick throws), or 'ok'.
function rig(fails) {
  const r = { told: [], logged: [], kicked: [], timers: [], online: [], fails: fails.slice() };
  const box = {
    console: { log: function () { r.logged.push(Array.prototype.join.call(arguments, ' ')); } },
    require: require, Buffer: Buffer,
    Date: Date, Math: Math, Number: Number, String: String, Array: Array, Object: Object, JSON: JSON,
    setTimeout: function (fn) { r.timers.push(fn); return r.timers.length; },
    setInterval: function () { return 1; }, clearInterval: function () { },
    mp: {
      getServerSettings: function () { return { privDir: PRIV, thornswoodServer: 'dev', thornswoodRequirePass: true }; },
      getUserByActor: function (actorId) {
        // Only the kick's own lookup, inside the timer: the sweep also asks
        // for the connection, to tell one session from the next.
        if (r.inTimer && r.fails[0] === 'lost') { r.fails.shift(); return -1; }
        return actorId === ACTOR ? 7 : -1;
      },
      get: function (id, what) {
        if (id === 0 && what === 'onlinePlayers') { return r.online.map(function (o) { return o.actorId; }); }
        for (let i = 0; i < r.online.length; i++) { if (r.online[i].actorId === id) { return r.online[i].profileId; } }
        throw new Error('no such actor');
      },
      kick: function (userId) {
        if (r.fails[0] === 'throw') { r.fails.shift(); throw new Error('no such user ' + userId); }
        if (r.fails[0] === 'ok') { r.fails.shift(); }
        r.kicked.push(userId);
      }
    }
  };
  vm.createContext(box);
  vm.runInContext(src.slice(a, b), box, { filename: 'gamemode.js (join pass)' });
  r.jp = box.__thornswoodJoinPass;
  r.sweep = function (now) { return r.jp.sweep(now, r.online, function (pid, t) { r.told.push(pid + ': ' + t); }); };
  r.fire = function () { const t = r.timers.splice(0); r.inTimer = true; t.forEach(function (fn) { fn(); }); r.inTimer = false; };
  r.online = [{ actorId: ACTOR, profileId: 700 }];
  return r;
}
function refusals(r) { return r.told.filter(function (t) { return /Thornswood launcher/.test(t) && /update/.test(t); }).length; }

const T0 = Date.now();
const G = 180000;

for (const how of ['lost', 'throw']) {
  const what = how === 'lost' ? 'a first kick that finds no connection' : 'a first kick that throws';
  const r = rig([how]);
  r.sweep(T0);
  yes(what + ': judged at the grace', r.sweep(T0 + G + 1000).join() === '700');
  yes(what + ': no second kick is set while the first is on its way', r.sweep(T0 + G + 3000).length === 0 && r.timers.length === 1);
  r.fire();
  yes(what + ': nothing was ended', r.kicked.length === 0);
  yes(what + ': and the log says it did not land and will be refused again',
      r.logged.some(function (s) { return /profile 700/.test(s) && /refused again at the next sweep/.test(s); }));
  yes(what + ': the next sweep refuses the session again', r.sweep(T0 + G + 7000).join() === '700' && refusals(r) === 2);
  r.fire();
  yes(what + ': and that kick ends it', r.kicked.length === 1 && r.kicked[0] === 7);
  r.sweep(T0 + G + 9000); r.fire();
  yes(what + ': once it has landed it is not refused again', r.kicked.length === 1 && refusals(r) === 2);
}

{
  const r = rig(['ok']);
  r.sweep(T0);
  r.sweep(T0 + G + 1000); r.fire();
  r.sweep(T0 + G + 3000); r.sweep(T0 + G + 60000); r.fire();
  yes('a kick that lands the first time: refused once, ended once', r.kicked.length === 1 && refusals(r) === 1);
}

{
  // The kick did not land, and before the next sweep the launcher's pass came.
  const r = rig(['lost']);
  r.sweep(T0);
  r.sweep(T0 + G + 1000); r.fire();
  r.jp.take(700, mint({ p: 700, s: 'dev', i: T0 + G + 2000, x: T0 + G + 600000 }), T0 + G + 2000);
  r.sweep(T0 + G + 4000); r.fire();
  yes('a pass that arrives after a kick that did not land lets the session stay', r.kicked.length === 0 && refusals(r) === 1);
}

{
  // Gone before the kick ran, and back as a new session: the old kick's
  // answer does not touch the new session's record.
  const r = rig(['lost']);
  r.sweep(T0);
  r.sweep(T0 + G + 1000);
  r.online = []; r.sweep(T0 + G + 2000);
  r.online = [{ actorId: ACTOR, profileId: 700 }]; r.sweep(T0 + G + 3000);
  r.fire();
  yes('a session that left and came back is held to its own grace, not the old refusal',
      r.sweep(T0 + G + 5000).length === 0 && r.sweep(T0 + G + 3000 + G + 1000).join() === '700');
}

try { fs.rmSync(PRIV, { recursive: true, force: true }); } catch (e) { }
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
